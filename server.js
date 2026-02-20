const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'super_secret_trading_key_change_me_in_prod';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to SQLite database.');

        // Create Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT
        )`);

        // Create Trades Table
        db.run(`CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            pair TEXT,
            side TEXT,
            entry REAL,
            sl REAL,
            tp REAL,
            result REAL,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, () => {
            // Attempt to add column in case it doesn't exist in an older DB schema
            db.run(`ALTER TABLE trades ADD COLUMN image_url TEXT`, (err) => { });
        });
    }
});

// --- Auth Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

// --- AUTHENTICATION ROUTES ---

// Register
app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email and password are required' });
    }

    db.get('SELECT email, username FROM users WHERE email = ? OR username = ?', [email, username], (err, row) => {
        if (row) {
            return res.status(400).json({ error: 'Email or Username already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hashedPassword], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to register user' });
            }
            res.status(201).json({ message: 'User registered successfully', userId: this.lastID });
        });
    });
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err || !user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    });
});

// --- TRADE ROUTES ---

// Get all trades for user
app.get('/api/trades', authenticateToken, (req, res) => {
    db.all('SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch trades' });
        }
        res.json(rows);
    });
});

// Add a trade
app.post('/api/trades', authenticateToken, upload.single('image'), (req, res) => {
    const { pair, side, entry, sl, tp, result, note } = req.body;
    const userId = req.user.id;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    if (!pair || !side || entry === undefined) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Pair, side, and entry are required' });
    }

    const query = `INSERT INTO trades (user_id, pair, side, entry, sl, tp, result, note, image_url) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(query, [userId, pair, side, entry, sl, tp, result || 0, note, imageUrl], function (err) {
        if (err) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(500).json({ error: 'Failed to add trade' });
        }
        res.status(201).json({ message: 'Trade added successfully', tradeId: this.lastID });
    });
});

// Delete a trade
app.delete('/api/trades/:id', authenticateToken, (req, res) => {
    const tradeId = req.params.id;
    const userId = req.user.id;

    db.run('DELETE FROM trades WHERE id = ? AND user_id = ?', [tradeId, userId], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete trade' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Trade not found or unauthorized' });
        }
        res.json({ message: 'Trade deleted successfully' });
    });
});

// --- STATS ROUTE ---
app.get('/api/stats', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all('SELECT result FROM trades WHERE user_id = ?', [userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch stats' });
        }

        const totalTrades = rows.length;
        let winCount = 0;
        let lossCount = 0;
        let totalPnl = 0;

        rows.forEach(trade => {
            totalPnl += (trade.result || 0);
            if (trade.result > 0) {
                winCount++;
            } else if (trade.result < 0) {
                lossCount++;
            }
        });

        const winrate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(2) : 0;

        res.json({
            totalTrades,
            wins: winCount,
            losses: lossCount,
            winrate: parseFloat(winrate),
            totalPnl
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

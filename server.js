const express = require('express');
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'super_secret_trading_key_change_me_in_prod';
const isVercel = process.env.VERCEL === '1';

// Middleware
app.use(cors());
app.use(express.json());
const publicPath = isVercel ? path.join(process.cwd(), 'public') : path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Initialize Database Tables
async function initDb() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL
            );
        `;

        await sql`
            CREATE TABLE IF NOT EXISTS trades (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                pair VARCHAR(50) NOT NULL,
                side VARCHAR(10) NOT NULL,
                entry NUMERIC NOT NULL,
                sl NUMERIC,
                tp NUMERIC,
                result NUMERIC DEFAULT 0,
                note TEXT,
                image_url TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log('PostgreSQL Database initialized successfully.');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

initDb();

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
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email and password are required' });
    }

    try {
        const { rows: existingUsers } = await sql`SELECT email, username FROM users WHERE email = ${email} OR username = ${username}`;

        if (existingUsers.length > 0) {
            return res.status(400).json({ error: 'Email or Username already exists' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);

        const { rows } = await sql`
            INSERT INTO users (username, email, password) 
            VALUES (${username}, ${email}, ${hashedPassword}) 
            RETURNING id
        `;

        res.status(201).json({ message: 'User registered successfully', userId: rows[0].id });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message || 'Failed to register user' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { rows } = await sql`SELECT * FROM users WHERE email = ${email}`;
        const user = rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const validPassword = bcrypt.compareSync(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, SECRET_KEY, { expiresIn: '30d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message || 'Internal server error during login' });
    }
});

// --- TRADE ROUTES ---

// Get all trades for user
app.get('/api/trades', authenticateToken, async (req, res) => {
    try {
        const { rows } = await sql`SELECT * FROM trades WHERE user_id = ${req.user.id} ORDER BY created_at DESC`;
        res.json(rows);
    } catch (error) {
        console.error('Fetch trades error:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

// Add a trade
app.post('/api/trades', authenticateToken, async (req, res) => {
    const { pair, side, entry, sl, tp, result, note, image_url } = req.body;
    const userId = req.user.id;

    if (!pair || !side || entry === undefined) {
        return res.status(400).json({ error: 'Pair, side, and entry are required' });
    }

    try {
        const { rows } = await sql`
            INSERT INTO trades (user_id, pair, side, entry, sl, tp, result, note, image_url) 
            VALUES (${userId}, ${pair}, ${side}, ${entry}, ${sl || null}, ${tp || null}, ${result || 0}, ${note || null}, ${image_url || null})
            RETURNING id
        `;

        res.status(201).json({ message: 'Trade added successfully', tradeId: rows[0].id });
    } catch (error) {
        console.error('Add trade error:', error);
        res.status(500).json({ error: 'Failed to add trade' });
    }
});

// Delete a trade
app.delete('/api/trades/:id', authenticateToken, async (req, res) => {
    const tradeId = req.params.id;
    const userId = req.user.id;

    try {
        const { rowCount } = await sql`DELETE FROM trades WHERE id = ${tradeId} AND user_id = ${userId}`;

        if (rowCount === 0) {
            return res.status(404).json({ error: 'Trade not found or unauthorized' });
        }
        res.json({ message: 'Trade deleted successfully' });
    } catch (error) {
        console.error('Delete trade error:', error);
        res.status(500).json({ error: 'Failed to delete trade' });
    }
});

// --- STATS ROUTE ---
app.get('/api/stats', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const { rows } = await sql`SELECT result FROM trades WHERE user_id = ${userId}`;

        const totalTrades = rows.length;
        let winCount = 0;
        let lossCount = 0;
        let totalPnl = 0;

        rows.forEach(trade => {
            // PostgreSQL returns NUMERIC decimal columns as strings in node-postgres by default, so we parse it
            const pnl = parseFloat(trade.result) || 0;
            totalPnl += pnl;
            if (pnl > 0) {
                winCount++;
            } else if (pnl < 0) {
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
    } catch (error) {
        console.error('Fetch stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Start server only if not in serverless environment
if (!isVercel) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;

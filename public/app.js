const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api';

// State
let isLoginMode = true;
let currentUser = null;

// DOM Elements
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const navAuthButtons = document.getElementById('nav-auth-buttons');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const toggleAuthBtn = document.getElementById('toggle-auth-mode');
const authToggleText = document.getElementById('auth-toggle-text');
const notificationArea = document.getElementById('notification-area');
const usernameGroup = document.getElementById('username-group');
const usernameInput = document.getElementById('username');

// Modal Elements
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const closeImageModalBtn = document.getElementById('close-image-modal');

const detailsModal = document.getElementById('details-modal');
const closeDetailsBtns = [document.getElementById('close-details-modal'), document.getElementById('close-details-btn-bottom')];

// Store trades globally to access on click
let allTrades = [];

// Startup Logic
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkAuth();
});

// Theme Logic
const themeToggleBtn = document.getElementById('theme-toggle');
const htmlEl = document.documentElement;

function initTheme() {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        htmlEl.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        htmlEl.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    }
}

themeToggleBtn.addEventListener('click', () => {
    htmlEl.classList.toggle('dark');
    localStorage.setItem('theme', htmlEl.classList.contains('dark') ? 'dark' : 'light');
});

// Notifications
function showNotification(message, type = 'success') {
    notificationArea.textContent = message;
    const successClass = 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800';
    const errorClass = 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-400 dark:border-red-800';

    notificationArea.className = `mb-4 p-4 rounded-lg font-medium text-center shadow border transition-colors duration-300 ${type === 'success' ? successClass : errorClass}`;
    notificationArea.classList.remove('hidden');
    setTimeout(() => {
        notificationArea.classList.add('hidden');
    }, 4000);
}

// Check Authentication
function checkAuth() {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        showDashboard();
    } else {
        showAuth();
    }
}

// View Management
function showAuth() {
    authView.classList.remove('hidden');
    dashboardView.classList.add('hidden');
    navAuthButtons.innerHTML = '';
}

function showDashboard() {
    authView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    navAuthButtons.innerHTML = `
        <span class="text-sm text-gray-400 self-center hidden sm:inline-block">@${currentUser.username || currentUser.email.split('@')[0]}</span>
        <button onclick="logout()" class="text-sm bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded border border-red-500/20 transition duration-300">Logout</button>
    `;
    loadStats();
    loadTrades();
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    currentUser = null;
    showAuth();
}

// Auth Form Toggle
toggleAuthBtn.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
        authTitle.textContent = 'Login to your account';
        authSubmitBtn.textContent = 'Login';
        authToggleText.textContent = 'Don\'t have an account?';
        toggleAuthBtn.textContent = 'Register here';
        usernameGroup.classList.add('hidden');
        usernameInput.required = false;
    } else {
        authTitle.textContent = 'Create an account';
        authSubmitBtn.textContent = 'Register';
        authToggleText.textContent = 'Already have an account?';
        toggleAuthBtn.textContent = 'Login here';
        usernameGroup.classList.remove('hidden');
        usernameInput.required = true;
    }
});

// Auth Submit
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const endpoint = isLoginMode ? '/auth/login' : '/auth/register';

    try {
        const payload = isLoginMode ? { email, password } : { username, email, password };
        const res = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Authentication failed');

        if (isLoginMode) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            currentUser = data.user;
            authForm.reset();
            showDashboard();
            showNotification('Logged in successfully!');
        } else {
            showNotification('Registration successful! Please login.');
            isLoginMode = true;
            toggleAuthBtn.click(); // Reset to login mode visually
            toggleAuthBtn.click(); // fix toggle state click issue
            isLoginMode = true;
            authTitle.textContent = 'Login to your account';
            authSubmitBtn.textContent = 'Login';
            authToggleText.textContent = 'Don\'t have an account?';
            toggleAuthBtn.textContent = 'Register here';
            document.getElementById('password').value = '';
        }

    } catch (err) {
        showNotification(err.message, 'error');
    }
});

// --- API Helpers ---
const authFetch = async (url, options = {}) => {
    const token = localStorage.getItem('token');
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    // Don't set Content-Type if we're sending FormData so browser can set boundary
    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${API_URL}${url}`, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error('Session expired');
    }
    return res;
};

// --- Dashboard Logic ---

// Load Stats
async function loadStats() {
    try {
        const res = await authFetch('/stats');
        const data = await res.json();

        document.getElementById('stat-total').textContent = data.totalTrades;
        document.getElementById('stat-winrate').textContent = `${data.winrate}%`;
        document.getElementById('stat-wins').textContent = data.wins;
        document.getElementById('stat-losses').textContent = data.losses;

        const pnlEl = document.getElementById('stat-pnl');
        pnlEl.textContent = `${data.totalPnl >= 0 ? '+' : ''}${data.totalPnl.toFixed(2)}`;
        pnlEl.className = `text-3xl font-bold mt-1 ${data.totalPnl >= 0 ? 'text-success' : 'text-danger'}`;
    } catch (e) {
        console.error('Failed to load stats', e);
    }
}

// Load Trades
async function loadTrades() {
    try {
        const res = await authFetch('/trades');
        const data = await res.json();
        allTrades = data;
        renderTrades(data);
    } catch (e) {
        console.error('Failed to load trades', e);
    }
}

// Render Trades
function renderTrades(trades) {
    const tbody = document.getElementById('trade-list-body');
    const emptyState = document.getElementById('empty-state');

    tbody.innerHTML = '';

    if (trades.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    trades.forEach(trade => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors';

        const isBuy = trade.side === 'BUY';
        const sideClass = isBuy ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-500' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-500';
        const pnlValue = trade.result || 0;
        const pnlClass = pnlValue >= 0 ? 'text-success' : 'text-danger';
        const date = new Date(trade.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        const imageHtml = trade.image_url
            ? `<button onclick="openImageModal('${trade.image_url}', event)" class="text-primary hover:text-blue-400 transition" title="View Chart">
                <svg class="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
               </button>`
            : `<span class="text-gray-400 dark:text-gray-600">-</span>`;

        // Wrap the row contents in a way that respects click to open details
        tr.className = 'hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors cursor-pointer group';
        tr.onclick = (e) => {
            // Only open details if we didn't click inside the image or action button wrappers
            if (e.target.closest('button')) return;
            openDetailsModal(trade.id);
        };

        tr.innerHTML = `
            <td class="py-3 px-2 text-sm text-gray-500 dark:text-gray-400">${date}</td>
            <td class="py-3 px-2 font-semibold text-gray-900 dark:text-white tracking-wide">${trade.pair}</td>
            <td class="py-3 px-2">
                <span class="px-2 py-1 text-xs font-bold rounded ${sideClass}">${trade.side}</span>
            </td>
            <td class="py-3 px-2 text-gray-900 dark:text-white">${trade.entry}</td>
            <td class="py-3 px-2 text-sm text-gray-600 dark:text-gray-500">
                ${trade.sl ? `<span class="text-danger">${trade.sl}</span>` : '-'} / 
                ${trade.tp ? `<span class="text-success">${trade.tp}</span>` : '-'}
            </td>
            <td class="py-3 px-2 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate" title="${trade.note || ''}">${trade.note || '-'}</td>
            <td class="py-3 text-center">${imageHtml}</td>
            <td class="py-3 px-2 text-right font-bold ${pnlClass}">
                ${pnlValue > 0 ? '+' : ''}${pnlValue}
            </td>
            <td class="py-3 text-center">
                <button onclick="deleteTrade(${trade.id})" class="text-gray-500 hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded transition">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Add Trade Form Submit
document.getElementById('trade-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append('pair', document.getElementById('pair').value.toUpperCase());
    formData.append('side', document.getElementById('side').value);
    formData.append('entry', document.getElementById('entry').value);

    const sl = document.getElementById('sl').value;
    if (sl) formData.append('sl', sl);

    const tp = document.getElementById('tp').value;
    if (tp) formData.append('tp', tp);

    const result = document.getElementById('result').value;
    if (result) formData.append('result', result);

    const note = document.getElementById('note').value;
    if (note) formData.append('note', note);

    const imageFile = document.getElementById('image').files[0];
    if (imageFile) {
        formData.append('image', imageFile);
    }

    try {
        const res = await authFetch('/trades', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to add trade');
        }

        showNotification('Trade added successfully!');
        document.getElementById('trade-form').reset();

        // Refresh data
        loadStats();
        loadTrades();

    } catch (err) {
        showNotification(err.message, 'error');
    }
});

// Delete Trade
async function deleteTrade(id) {
    if (!confirm('Are you sure you want to delete this trade?')) return;

    try {
        const res = await authFetch(`/trades/${id}`, { method: 'DELETE' });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete trade');
        }

        showNotification('Trade deleted');
        loadStats();
        loadTrades();

    } catch (err) {
        showNotification(err.message, 'error');
    }
}

// --- Modal Logic ---

// Image Modal
window.openImageModal = function (url, event) {
    if (event) event.stopPropagation(); // prevent opening details modal
    modalImage.src = url;
    imageModal.classList.remove('hidden');
    setTimeout(() => {
        imageModal.classList.remove('opacity-0');
        imageModal.classList.add('opacity-100');
    }, 10);
};

function closeImageModal() {
    imageModal.classList.remove('opacity-100');
    imageModal.classList.add('opacity-0');
    setTimeout(() => {
        imageModal.classList.add('hidden');
        modalImage.src = '';
    }, 300);
}

closeImageModalBtn.addEventListener('click', closeImageModal);
imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) closeImageModal();
});

// Trade Details Modal
window.openDetailsModal = function (id) {
    const trade = allTrades.find(t => t.id === id);
    if (!trade) return;

    // Populate data
    document.getElementById('detail-pair').textContent = trade.pair;

    const sideBadge = document.getElementById('detail-side');
    sideBadge.textContent = trade.side;
    sideBadge.className = `text-xs px-2 py-1 font-bold rounded ${trade.side === 'BUY' ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-500' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-500'}`;

    document.getElementById('detail-entry').textContent = trade.entry;
    document.getElementById('detail-sl').textContent = trade.sl || '-';
    document.getElementById('detail-tp').textContent = trade.tp || '-';

    const pnlBadge = document.getElementById('detail-pnl');
    const pnlVal = trade.result || 0;
    pnlBadge.textContent = `${pnlVal > 0 ? '+' : ''}${pnlVal} $`;
    pnlBadge.className = `font-bold ${pnlVal >= 0 ? 'text-success' : 'text-danger'}`;

    document.getElementById('detail-note').textContent = trade.note || 'No notes provided for this trade.';
    document.getElementById('detail-date').textContent = new Date(trade.created_at).toLocaleString();

    // Chart Preview
    const chartWrapper = document.getElementById('detail-chart-wrapper');
    const chartImg = document.getElementById('detail-chart-img');
    const viewImgBtn = document.getElementById('detail-view-img-btn');

    if (trade.image_url) {
        chartImg.src = trade.image_url;
        viewImgBtn.onclick = () => openImageModal(trade.image_url);
        chartWrapper.classList.remove('hidden');
    } else {
        chartWrapper.classList.add('hidden');
    }

    // Open Modal with animation
    detailsModal.classList.remove('hidden');
    setTimeout(() => {
        detailsModal.classList.remove('opacity-0');
        detailsModal.classList.add('opacity-100');
        detailsModal.querySelector('.transform').classList.remove('scale-95');
        detailsModal.querySelector('.transform').classList.add('scale-100');
    }, 10);
};

function closeDetailsModal() {
    detailsModal.classList.remove('opacity-100');
    detailsModal.classList.add('opacity-0');
    detailsModal.querySelector('.transform').classList.add('scale-95');
    detailsModal.querySelector('.transform').classList.remove('scale-100');

    setTimeout(() => {
        detailsModal.classList.add('hidden');
    }, 300);
}

closeDetailsBtns.forEach(btn => btn.addEventListener('click', closeDetailsModal));
detailsModal.addEventListener('click', (e) => {
    if (e.target === detailsModal) closeDetailsModal();
});

// Global Keyboard Events
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!imageModal.classList.contains('hidden')) closeImageModal();
        else if (!detailsModal.classList.contains('hidden')) closeDetailsModal();
    }
});

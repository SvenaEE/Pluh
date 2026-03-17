const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration (use memory store for Vercel)
app.use(session({
    secret: process.env.SESSION_SECRET || 'coinflip-jack-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// Use /tmp for database on Vercel (writable directory)
const dbPath = process.env.VERCEL ? '/tmp/database.db' : './database.db';
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        balance INTEGER DEFAULT 500,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        balance INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_leaderboard_balance ON leaderboard(balance DESC)`);
});

// Helper functions
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// API Routes
app.post('/api/check-username', async (req, res) => {
    const { username } = req.body;
    try {
        const row = await dbGet('SELECT username FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        res.json({ exists: !!row });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    
    try {
        const exists = await dbGet('SELECT username FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        if (exists) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        
        await dbRun('INSERT INTO users (id, username, password, balance) VALUES (?, ?, ?, 500)',
            [userId, username, hashedPassword]);
        
        await dbRun('INSERT INTO leaderboard (user_id, username, balance) VALUES (?, ?, 500)',
            [userId, username]);
        
        req.session.userId = userId;
        req.session.username = username;
        
        res.json({ 
            success: true, 
            user: { 
                id: userId, 
                username, 
                balance: 500 
            } 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        
        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                username: user.username, 
                balance: user.balance 
            } 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/current-user', async (req, res) => {
    if (!req.session.userId) {
        return res.json({ user: null });
    }
    
    try {
        const user = await dbGet('SELECT id, username, balance FROM users WHERE id = ?', [req.session.userId]);
        res.json({ user: user || null });
    } catch (err) {
        res.json({ user: null });
    }
});

app.post('/api/update-balance', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { balance } = req.body;
    
    if (typeof balance !== 'number' || balance < 0) {
        return res.status(400).json({ error: 'Invalid balance' });
    }
    
    try {
        await dbRun('UPDATE users SET balance = ? WHERE id = ?',
            [balance, req.session.userId]);
        
        await dbRun(`INSERT INTO leaderboard (user_id, username, balance) 
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET 
                balance = excluded.balance,
                updated_at = CURRENT_TIMESTAMP`,
            [req.session.userId, req.session.username, balance]);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Balance update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT username, balance FROM leaderboard 
            ORDER BY balance DESC LIMIT 5`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/user-rank/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const row = await dbGet(`WITH ranked AS (
                SELECT user_id, username, balance, 
                       ROW_NUMBER() OVER (ORDER BY balance DESC) as rank
                FROM leaderboard
            )
            SELECT rank FROM ranked WHERE user_id = ?`, [userId]);
        res.json({ rank: row ? row.rank : null });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Serve HTML for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel serverless
module.exports = app;

// Only listen if running directly (not on Vercel)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

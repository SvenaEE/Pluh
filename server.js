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

app.use(session({
    secret: 'coinflip-jack-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Database setup
const dbPath = path.join(__dirname, 'database.db');
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add demo data if empty
    db.get('SELECT COUNT(*) as count FROM leaderboard', (err, row) => {
        if (row && row.count === 0) {
            const demoUsers = [
                { username: "CryptoKing", balance: 12500 },
                { username: "LuckyLuke", balance: 8700 },
                { username: "MinesMaster", balance: 5400 },
                { username: "JackpotJoe", balance: 3200 },
                { username: "CoinFlipPro", balance: 2100 }
            ];
            
            demoUsers.forEach(user => {
                const userId = uuidv4();
                db.run('INSERT INTO users (id, username, password, balance) VALUES (?, ?, ?, ?)',
                    [userId, user.username, bcrypt.hashSync("demo123", 10), user.balance]);
                
                db.run('INSERT INTO leaderboard (user_id, username, balance) VALUES (?, ?, ?)',
                    [userId, user.username, user.balance]);
            });
        }
    });
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
        const user = await dbGet('SELECT username FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        res.json({ exists: !!user });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    try {
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
            user: { id: userId, username, balance: 500 } 
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
        
        res.json({ 
            success: true, 
            user: { id: user.id, username: user.username, balance: user.balance } 
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/current-user', async (req, res) => {
    if (!req.session.userId) return res.json({ user: null });
    
    try {
        const user = await dbGet('SELECT id, username, balance FROM users WHERE id = ?', [req.session.userId]);
        res.json({ user: user || null });
    } catch (err) {
        res.json({ user: null });
    }
});

app.post('/api/update-balance', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { balance } = req.body;
    
    try {
        await dbRun('UPDATE users SET balance = ? WHERE id = ?', [balance, req.session.userId]);
        
        await dbRun(`INSERT INTO leaderboard (user_id, username, balance) 
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET 
                balance = excluded.balance,
                updated_at = CURRENT_TIMESTAMP`,
            [req.session.userId, req.session.username, balance]);
        
        res.json({ success: true });
        
    } catch (error) {
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

app.get('/api/leaderboard/all', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT username, balance FROM leaderboard 
            ORDER BY balance DESC LIMIT 50`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/user-rank/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const allUsers = await dbAll(`SELECT user_id FROM leaderboard ORDER BY balance DESC`);
        const rank = allUsers.findIndex(u => u.user_id === userId) + 1;
        res.json({ rank: rank > 0 ? rank : null });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Serve HTML
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

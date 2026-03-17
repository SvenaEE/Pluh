const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
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

// Session configuration
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

// MongoDB connection - REPLACE WITH YOUR ACTUAL CONNECTION STRING
const uri = process.env.MONGODB_URI || "mongodb+srv://tyocheatergd_db_user:8115wvUtVnDO20xn@cluster0.bsdlt94.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("coinflip_jack");
        console.log("✅ Connected to MongoDB!");
        
        // Create indexes
        await db.collection("users").createIndex({ username: 1 }, { unique: true });
        await db.collection("leaderboard").createIndex({ balance: -1 });
        await db.collection("leaderboard").createIndex({ user_id: 1 }, { unique: true });
        
        // Check if leaderboard is empty and add demo data
        const count = await db.collection("leaderboard").countDocuments();
        if (count === 0) {
            console.log("Adding demo leaderboard data...");
            const demoUsers = [
                { username: "CryptoKing", balance: 12500 },
                { username: "LuckyLuke", balance: 8700 },
                { username: "MinesMaster", balance: 5400 },
                { username: "JackpotJoe", balance: 3200 },
                { username: "CoinFlipPro", balance: 2100 }
            ];
            
            for (const user of demoUsers) {
                const userId = uuidv4();
                const hashedPassword = await bcrypt.hash("demo123", 10);
                
                await db.collection("users").insertOne({
                    id: userId,
                    username: user.username,
                    password: hashedPassword,
                    balance: user.balance,
                    created_at: new Date(),
                    is_demo: true
                });
                
                await db.collection("leaderboard").insertOne({
                    user_id: userId,
                    username: user.username,
                    balance: user.balance,
                    updated_at: new Date()
                });
            }
        }
    } catch (error) {
        console.error("❌ MongoDB connection error:", error);
    }
}
connectDB();

// Slur filter - English and Swedish bad words
const SLURS = new Set([
    // English slurs
    'nigger', 'nigga', 'faggot', 'fag', 'cunt', 'bitch', 'whore', 'slut',
    'retard', 'spastic', 'chink', 'gook', 'kike', 'spic', 'wetback',
    'tranny', 'shemale', 'dyke', 'fuck', 'shit', 'asshole', 'dick',
    'pussy', 'cock', 'bastard', 'motherfucker',
    
    // Swedish slurs
    'neger', 'negrer', 'blattar', 'blatte', 'svartskalle', 'zigenare',
    'tattare', 'lapp', 'fitta', 'kuk', 'knulla', 'hora', 'jävlar',
    'fan', 'helvete', 'satan', 'jävla', 'äckel', 'bög', 'homo',
    'fjolla', 'cp', 'efterbliven', 'särskola', 'rasist'
]);

const BAD_PATTERNS = [
    /n[i1]gg[ae3]r/i, /f[a4]gg[o0]t/i, /c[u0]nt/i, /b[i1]tch/i,
    /wh[o0]r[e3]/i, /sl[u0]t/i, /r[e3]t[a4]rd/i, /ch[i1]nk/i,
    /sp[i1]c/i, /k[i1]k[e3]/i, /d[i1]ck/i, /p[u0]ssy/i,
    /f[i1]tt[a4]/i, /k[u0]k/i, /h[o0]r[a4]/i, /bl[a4]tt[e3]/i,
    /n[e3]g[e3]r/i, /sv[a4]rtsk[a4]ll[e3]/i
];

function containsSlur(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    
    for (const slur of SLURS) {
        if (lower.includes(slur)) return true;
    }
    
    for (const pattern of BAD_PATTERNS) {
        if (pattern.test(text)) return true;
    }
    
    const repeatedCheck = lower.replace(/(.)\1{2,}/g, '$1$1');
    for (const slur of SLURS) {
        if (repeatedCheck.includes(slur)) return true;
    }
    
    return false;
}

// API Routes
app.post('/api/check-username', async (req, res) => {
    const { username } = req.body;
    
    if (containsSlur(username)) {
        return res.status(400).json({ error: 'Username contains inappropriate language' });
    }
    
    try {
        const user = await db.collection("users").findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        });
        res.json({ exists: !!user });
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
    
    if (containsSlur(username)) {
        return res.status(400).json({ error: 'Username contains inappropriate language' });
    }
    
    try {
        const exists = await db.collection("users").findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        });
        
        if (exists) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        
        await db.collection("users").insertOne({
            id: userId,
            username: username,
            password: hashedPassword,
            balance: 500,
            created_at: new Date(),
            is_demo: false
        });
        
        await db.collection("leaderboard").insertOne({
            user_id: userId,
            username: username,
            balance: 500,
            updated_at: new Date()
        });
        
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
        const user = await db.collection("users").findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        });
        
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
        const user = await db.collection("users").findOne(
            { id: req.session.userId },
            { projection: { id: 1, username: 1, balance: 1 } }
        );
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
        await db.collection("users").updateOne(
            { id: req.session.userId },
            { $set: { balance: balance } }
        );
        
        await db.collection("leaderboard").updateOne(
            { user_id: req.session.userId },
            { 
                $set: { 
                    balance: balance,
                    username: req.session.username,
                    updated_at: new Date()
                } 
            },
            { upsert: true }
        );
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Balance update error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.collection("leaderboard")
            .find({})
            .sort({ balance: -1 })
            .limit(5)
            .project({ username: 1, balance: 1, _id: 0 })
            .toArray();
        
        res.json(leaderboard);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/leaderboard/all', async (req, res) => {
    try {
        const leaderboard = await db.collection("leaderboard")
            .find({})
            .sort({ balance: -1 })
            .limit(50)
            .project({ username: 1, balance: 1, _id: 0 })
            .toArray();
        
        res.json(leaderboard);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/user-rank/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const allUsers = await db.collection("leaderboard")
            .find({})
            .sort({ balance: -1 })
            .project({ user_id: 1 })
            .toArray();
        
        const rank = allUsers.findIndex(u => u.user_id === userId) + 1;
        res.json({ rank: rank > 0 ? rank : null });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Serve HTML for all routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export for Vercel
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

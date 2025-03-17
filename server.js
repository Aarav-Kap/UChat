const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);

// Hardcoded MongoDB URI and Session Secret
const MONGODB_URI = 'mongodb+srv://admin:Aarav123@cluster0.0g3yi.mongodb.net/ulischat?retryWrites=true&w=majority&appName=Cluster0';
const SESSION_SECRET = 'UlisChat_Secret_2025!@#xK9pLmQ2';

// MongoDB Connection with improved error handling
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000 // Timeout after 5 seconds
})
    .then(() => console.log('Connected to MongoDB successfully'))
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1); // Exit if MongoDB connection fails
    });

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true }
});
const User = mongoose.model('User', userSchema);

// Session Store
const store = new MongoDBStore({
    uri: MONGODB_URI,
    collection: 'sessions',
    ttl: 14 * 24 * 60 * 60 // 14 days session expiration
});

store.on('error', err => {
    console.error('Session store error:', err.message);
});

// Middleware setup
app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(cookieParser());

// Session store readiness middleware
app.use((req, res, next) => {
    if (!mongoose.connection.readyState) {
        console.error('MongoDB not connected, cannot proceed with session store');
        return res.status(503).json({ error: 'Database unavailable, please try again later' });
    }
    if (!store.ready) {
        console.warn('Session store not ready, attempting to proceed without session');
        req.session = req.session || {}; // Fallback to in-memory session (temporary)
        return next();
    }
    next();
});

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        maxAge: 2592000000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Note: NODE_ENV isn't set, defaults to undefined
        sameSite: 'lax'
    }
}));

app.get('/', (req, res) => {
    console.log('GET / - Serving login page');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', async (req, res) => {
    console.log('POST /login - Login attempt', req.body);
    const { username, password } = req.body;
    if (!username || username.length < 3 || !password) {
        console.log('POST /login - Invalid username or password');
        return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
    }
    try {
        let user = await User.findOne({ username });
        if (!user) {
            user = new User({ username });
            await user.save();
            console.log(`POST /login - Created new user: ${username}`);
        }
        req.session.user = { username, color: req.body.color || '#1E90FF', language: req.body.language || 'en' };
        req.session.save(err => {
            if (err) {
                console.error('Session save error during login:', err.message);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log(`POST /login - Success for username: ${username}, session:`, req.session);
            res.json({ success: true });
        });
    } catch (err) {
        console.error('POST /login - Error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/user', (req, res) => {
    console.log('GET /user - Fetching user data', req.session);
    try {
        if (!req.session || !req.session.user) {
            console.log('GET /user - No session or user data found, redirecting to login');
            return res.status(401).json({ error: 'Not logged in' });
        }
        const { username, color, language } = req.session.user;
        console.log(`GET /user - Success: username=${username}, color=${color}, language=${language}`);
        res.json({ username, color, language });
    } catch (error) {
        console.error('GET /user - Error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/change-username', async (req, res) => {
    console.log('POST /change-username - Attempting to change username');
    const { newUsername } = req.body;
    if (!newUsername || newUsername.length < 3) {
        console.log('POST /change-username - Invalid new username');
        return res.status(400).json({ error: 'New username must be at least 3 characters long' });
    }
    if (req.session && req.session.user) {
        try {
            const existingUser = await User.findOne({ username: newUsername });
            if (existingUser) {
                return res.status(400).json({ error: 'Username already taken' });
            }
            await User.findOneAndUpdate({ username: req.session.user.username }, { username: newUsername });
            req.session.user.username = newUsername;
            req.session.save(err => {
                if (err) console.error('Session save error:', err.message);
            });
            console.log(`POST /change-username - Success: newUsername=${newUsername}`);
            res.json({ success: true });
        } catch (err) {
            console.error('POST /change-username - Error:', err.message);
            res.status(500).json({ error: 'Failed to change username' });
        }
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/change-color', (req, res) => {
    console.log('POST /change-color - Changing color');
    const { color } = req.body;
    if (req.session && req.session.user) {
        req.session.user.color = color;
        req.session.save(err => {
            if (err) console.error('Session save error:', err.message);
        });
    }
    console.log(`POST /change-color - Success: color=${color}`);
    res.json({ success: true });
});

app.post('/update-language', (req, res) => {
    console.log('POST /update-language - Updating language');
    const { language } = req.body;
    if (req.session && req.session.user) {
        req.session.user.language = language;
        req.session.save(err => {
            if (err) console.error('Session save error:', err.message);
        });
    }
    console.log(`POST /update-language - Success: language=${language}`);
    res.json({ success: true });
});

app.get('/logout', (req, res) => {
    console.log('GET /logout - Logging out');
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('GET /logout - Error destroying session:', err.message);
                return res.status(500).json({ error: 'Failed to logout' });
            }
            res.clearCookie('connect.sid');
            console.log('GET /logout - Session destroyed');
            res.redirect('/');
        });
    } else {
        console.warn('GET /logout - No session to destroy');
        res.redirect('/');
    }
});

const connectedUsers = new Map();

io.on('connection', socket => {
    console.log(`Socket connected: ${socket.id}`);
    socket.on('chat message', msg => {
        console.log(`Broadcasting main chat message: ${JSON.stringify(msg)}`);
        io.emit('chat message', { ...msg, senderId: socket.id });
    });

    socket.on('dm message', msg => {
        const recipientSocket = connectedUsers.get(msg.recipientId);
        console.log(`Sending DM from ${socket.id} to ${msg.recipientId}: ${JSON.stringify(msg)}`);
        socket.emit('dm message', { ...msg, senderId: socket.id });
        if (recipientSocket) {
            recipientSocket.emit('dm message', { ...msg, senderId: socket.id });
        }
    });

    socket.on('typing', username => {
        console.log(`${username} is typing`);
        socket.broadcast.emit('typing', username);
    });

    socket.on('stop typing', () => {
        console.log('Stop typing event');
        socket.broadcast.emit('stop typing');
    });

    socket.on('name change', data => {
        console.log(`Name change: ${data.oldUsername} to ${data.newUsername}`);
        connectedUsers.set(socket.id, { ...connectedUsers.get(socket.id), username: data.newUsername });
        io.emit('name change', data);
        io.emit('user list', Array.from(connectedUsers.values()));
    });

    socket.on('color change', data => {
        console.log(`Color change for ${data.id}: ${data.color}`);
        connectedUsers.set(socket.id, { ...connectedUsers.get(socket.id), color: data.color });
        io.emit('color change', data);
        io.emit('user list', Array.from(connectedUsers.values()));
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        connectedUsers.delete(socket.id);
        io.emit('user count', connectedUsers.size);
        io.emit('user list', Array.from(connectedUsers.values()));
    });

    const user = { id: socket.id, username: socket.handshake.query.username, color: socket.handshake.query.color };
    connectedUsers.set(socket.id, user);
    io.emit('user count', connectedUsers.size);
    io.emit('user list', Array.from(connectedUsers.values()));
});

http.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
});
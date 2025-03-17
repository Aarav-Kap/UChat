const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables from the hosting platform

// Log the MONGODB_URI to debug
console.log('MONGODB_URI:', process.env.MONGODB_URI);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use(cookieParser());

const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);

const store = new MongoDBStore({
    uri: process.env.MONGODB_URI,
    collection: 'sessions'
});

store.on('error', err => {
    console.error('Session store error:', err);
});

store.on('connected', () => {
    console.log('Session store connected to MongoDB');
});

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'UlisChat_Secret_2025!@#xK9pLmQ2',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { 
        maxAge: 2592000000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Secure in production (HTTPS)
        sameSite: 'lax', // Compatible with cross-site requests
        domain: undefined // Let the browser handle the domain
    }
});

app.use(sessionMiddleware);

// Share session with Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

app.get('/', (req, res) => {
    console.log('GET / - Serving login page, session:', req.session);
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    console.log('POST /login - Login attempt, body:', req.body, 'session before:', req.session);
    const { username, password } = req.body;
    if (!username || username.length < 3 || !password) {
        console.log('POST /login - Invalid username or password');
        return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
    }
    req.session.user = { username, color: req.body.color || '#1E90FF', language: req.body.language || 'en' };
    console.log('POST /login - Setting session.user:', req.session.user);
    
    // Ensure session is saved before responding
    req.session.save(err => {
        if (err) {
            console.error('POST /login - Error saving session:', err);
            return res.status(500).json({ error: 'Failed to save session' });
        }
        console.log('POST /login - Session saved successfully, session:', req.session);
        res.json({ success: true });
    });
});

app.get('/user', (req, res) => {
    console.log('GET /user - Fetching user data, session:', req.session);
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

app.post('/change-username', (req, res) => {
    console.log('POST /change-username - Attempting to change username');
    const { newUsername } = req.body;
    if (!newUsername || newUsername.length < 3) {
        console.log('POST /change-username - Invalid new username');
        return res.status(400).json({ error: 'New username must be at least 3 characters long' });
    }
    if (req.session && req.session.user) {
        req.session.user.username = newUsername;
        req.session.save(err => {
            if (err) {
                console.error('POST /change-username - Error saving session:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log(`POST /change-username - Success: newUsername=${newUsername}`);
            res.json({ success: true });
        });
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
            if (err) {
                console.error('POST /change-color - Error saving session:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log(`POST /change-color - Success: color=${color}`);
            res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/update-language', (req, res) => {
    console.log('POST /update-language - Updating language');
    const { language } = req.body;
    if (req.session && req.session.user) {
        req.session.user.language = language;
        req.session.save(err => {
            if (err) {
                console.error('POST /update-language - Error saving session:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log(`POST /update-language - Success: language=${language}`);
            res.json({ success: true });
        });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.get('/logout', (req, res) => {
    console.log('GET /logout - Logging out, session:', req.session);
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('GET /logout - Error destroying session:', err);
                return res.status(500).send('Error logging out');
            }
            res.clearCookie('connect.sid');
            console.log('GET /logout - Session destroyed, redirecting to /');
            res.redirect('/');
        });
    } else {
        console.log('GET /logout - No session found, redirecting to /');
        res.redirect('/');
    }
});

const connectedUsers = new Map();

io.on('connection', socket => {
    console.log(`Socket connected: ${socket.id}, session:`, socket.request.session);
    const session = socket.request.session;
    if (!session || !session.user) {
        console.log('Socket connection - No session found, disconnecting');
        socket.disconnect(true);
        return;
    }
    const username = session.user.username;
    const color = session.user.color || '#1E90FF';
    connectedUsers.set(socket.id, { id: socket.id, username, color });

    io.emit('user count', connectedUsers.size);
    io.emit('user list', Array.from(connectedUsers.values()));

    socket.on('chat message', msg => {
        console.log(`Broadcasting main chat message: ${JSON.stringify(msg)}`);
        io.emit('chat message', { ...msg, senderId: socket.id });
    });

    socket.on('dm message', msg => {
        const recipientSocket = connectedUsers.get(msg.recipientId);
        console.log(`Sending DM from ${socket.id} to ${msg.recipientId}: ${JSON.stringify(msg)}`);
        socket.emit('dm message', { ...msg, senderId: socket.id });
        if (recipientSocket) {
            io.to(recipientSocket.id).emit('dm message', { ...msg, senderId: socket.id });
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
});

http.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
});
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const helmet = require('helmet');
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();
const sanitizeHtml = require('sanitize-html');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ulischat';
mongoose.set('strictQuery', false); // Suppress Mongoose strictQuery deprecation warning
mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    retryWrites: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const store = new MongoDBStore({
    uri: mongoUri,
    collection: 'sessions',
});
store.on('error', err => console.error('Session store error:', err));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'UlisChat_Secret_2025!@#xK9pLmQ2',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { maxAge: 2592000000, httpOnly: true, secure: process.env.NODE_ENV === 'production' }
});

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('.')); // Serve static files from the root directory
app.use(sessionMiddleware);
app.use(csrf({ cookie: true }));

const connectedUsers = new Map();

app.get('/', (req, res) => {
    if (!req.session || !req.session.user) {
        res.sendFile(path.join(__dirname, 'login.html'), { csrfToken: req.csrfToken() });
    } else {
        res.sendFile(path.join(__dirname, 'index.html'), { csrfToken: req.csrfToken() });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || username.length < 3 || !password) {
        return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
    }
    let user = req.session.registeredUsers && req.session.registeredUsers[username];
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    req.session.user = { username, color: user.color, language: user.language };
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Failed to save session' });
        res.json({ success: true });
    });
});

app.post('/register', async (req, res) => {
    const { username, password, confirmPassword } = req.body;
    if (!username || username.length < 3 || !password || !confirmPassword) {
        return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
    }
    if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }
    if (req.session.registeredUsers && req.session.registeredUsers[username]) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    if (!req.session.registeredUsers) req.session.registeredUsers = {};
    req.session.registeredUsers[username] = { password: hashedPassword, color: '#1E90FF', language: 'en' };
    req.session.user = { username, color: '#1E90FF', language: 'en' };
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Failed to save session' });
        res.json({ success: true });
    });
});

app.post('/change-username', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { newUsername } = req.body;
    if (newUsername.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    if (req.session.registeredUsers && req.session.registeredUsers[newUsername]) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    delete req.session.registeredUsers[req.session.user.username];
    req.session.registeredUsers[newUsername] = req.session.registeredUsers[req.session.user.username];
    delete req.session.registeredUsers[req.session.user.username];
    req.session.user.username = newUsername;
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Failed to update username' });
        io.emit('username change', { id: req.session.id, username: newUsername });
        res.json({ success: true });
    });
});

app.post('/change-color', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { newColor } = req.body;
    req.session.user.color = newColor;
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Failed to update color' });
        io.emit('color change', { id: req.session.id, color: newColor });
        res.json({ success: true });
    });
});

app.post('/change-language', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const { newLanguage } = req.body;
    req.session.user.language = newLanguage;
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Failed to update language' });
        res.json({ success: true });
    });
});

app.get('/history', (req, res) => {
    const history = req.session.messageHistory || [];
    res.json(history);
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

io.on('connection', socket => {
    console.log(`Socket connected: ${socket.id}`);
    const session = socket.request.session;
    const user = session?.user ? {
        id: socket.id,
        username: session.user.username,
        color: session.user.color
    } : { id: socket.id, username: 'Guest', color: '#1E90FF' };
    connectedUsers.set(socket.id, user);
    io.emit('user count', connectedUsers.size);
    io.emit('user list', Array.from(connectedUsers.values()));

    socket.on('chat message', msg => {
        const sanitizedText = sanitizeHtml(msg.text, { allowedTags: [], allowedAttributes: {} });
        const message = {
            id: msg.id || Date.now().toString(),
            username: user.username,
            text: sanitizedText,
            color: user.color,
            language: session.user?.language || 'en',
            senderId: socket.id,
            timestamp: new Date().toISOString(),
            image: msg.image,
            replyTo: msg.replyTo
        };
        if (!session.messageHistory) session.messageHistory = [];
        session.messageHistory.push(message);
        if (session.messageHistory.length > 100) session.messageHistory.shift();
        io.emit('chat message', message);
    });

    socket.on('dm message', msg => {
        const sanitizedText = sanitizeHtml(msg.text, { allowedTags: [], allowedAttributes: {} });
        const message = {
            id: msg.id || Date.now().toString(),
            username: user.username,
            text: sanitizedText,
            color: user.color,
            language: session.user?.language || 'en',
            senderId: socket.id,
            recipientId: msg.recipientId,
            timestamp: new Date().toISOString(),
            image: msg.image,
            replyTo: msg.replyTo
        };
        if (!session.messageHistory) session.messageHistory = [];
        session.messageHistory.push(message);
        if (session.messageHistory.length > 100) session.messageHistory.shift();
        io.to(msg.recipientId).emit('dm message', message);
        socket.emit('dm message', message);
    });

    socket.on('typing', (data) => io.emit('typing', { senderId: socket.id, ...data }));
    socket.on('stop typing', () => io.emit('stop typing', { senderId: socket.id }));
    socket.on('disconnect', () => {
        connectedUsers.delete(socket.id);
        io.emit('user count', connectedUsers.size);
        io.emit('user list', Array.from(connectedUsers.values()));
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on port ${port}`));
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose'); // Assuming MongoDB is used

// MongoDB Connection (adjust URI as needed)
mongoose.connect('mongodb://localhost:27017/ulischat', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

app.use(express.static(path.join(__dirname)));
app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
    console.log('GET / - Serving login page');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    console.log('POST /login - Login attempt', req.body);
    const { username, password } = req.body;
    if (!username || username.length < 3 || !password) {
        console.log('POST /login - Invalid username or password');
        return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
    }
    // Save session (assuming MongoDB or in-memory session)
    req.session.user = { username, color: req.body.color || '#1E90FF', language: req.body.language || 'en' };
    console.log(`POST /login - Success for username: ${username}`);
    res.json({ success: true });
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

app.post('/change-username', (req, res) => {
    console.log('POST /change-username - Attempting to change username');
    const { newUsername } = req.body;
    if (!newUsername || newUsername.length < 3) {
        console.log('POST /change-username - Invalid new username');
        return res.status(400).json({ error: 'New username must be at least 3 characters long' });
    }
    if (req.session && req.session.user) {
        req.session.user.username = newUsername;
    }
    console.log(`POST /change-username - Success: newUsername=${newUsername}`);
    res.json({ success: true });
});

app.post('/change-color', (req, res) => {
    console.log('POST /change-color - Changing color');
    const { color } = req.body;
    if (req.session && req.session.user) {
        req.session.user.color = color;
    }
    console.log(`POST /change-color - Success: color=${color}`);
    res.json({ success: true });
});

app.post('/update-language', (req, res) => {
    console.log('POST /update-language - Updating language');
    const { language } = req.body;
    if (req.session && req.session.user) {
        req.session.user.language = language;
    }
    console.log(`POST /update-language - Success: language=${language}`);
    res.json({ success: true });
});

app.get('/logout', (req, res) => {
    console.log('GET /logout - Logging out');
    req.session.destroy(err => {
        if (err) console.error('GET /logout - Error destroying session:', err);
        res.clearCookie('connect.sid'); // Adjust cookie name based on your session store
        console.log('GET /logout - Session destroyed');
        res.redirect('/');
    });
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

const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);

const store = new MongoDBStore({
    uri: 'mongodb://localhost:27017/ulischat',
    collection: 'sessions'
});

store.on('error', err => {
    console.error('Session store error:', err);
});

app.use(session({
    secret: 'your-secret-key', // Replace with a secure secret
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { maxAge: 2592000000 } // 30 days
}));

http.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port ${process.env.PORT || 3000}`);
});
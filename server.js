const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// In-memory storage
const users = new Map(); // username -> { passwordHash }
const messages = { General: [], DMs: {} }; // Channel/DM messages

// Middleware
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
    secret: 'UChatSecret2025',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Routes
app.get('/', (req, res) => {
    console.log('Redirecting to /login');
    res.redirect('/login');
});
app.get('/login', (req, res) => {
    console.log('Serving login page');
    res.sendFile(path.join(__dirname, 'login.html'));
});
app.get('/register', (req, res) => {
    console.log('Serving register page');
    res.sendFile(path.join(__dirname, 'register.html'));
});
app.get('/chat', (req, res) => {
    if (!req.session.user) {
        console.log('No session, redirecting to /login');
        return res.redirect('/login');
    }
    console.log('Serving chat page for:', req.session.user.username);
    res.sendFile(path.join(__dirname, 'chat.html'), (err) => {
        if (err) console.error('Error sending chat.html:', err);
    });
});

// Authentication
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (users.has(username)) return res.status(400).json({ error: 'Username taken' });
    const passwordHash = await bcrypt.hash(password, 10);
    users.set(username, { passwordHash });
    console.log('Registered:', username);
    res.json({ message: 'Registered' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.user = { username };
    req.session.save(err => {
        if (err) return res.status(500).json({ error: 'Session error' });
        res.json({ message: 'Logged in' });
    });
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

app.get('/users', (req, res) => {
    res.json(Array.from(users.keys()));
});

// Socket.IO
io.on('connection', (socket) => {
    socket.on('joinChannel', ({ channel, username }) => {
        socket.join(channel);
        const channelMessages = channel.startsWith('DM_') ? (messages.DMs[channel] || []) : (messages[channel] || []);
        socket.emit('loadMessages', channelMessages);
        console.log(`${username} joined ${channel}`);
    });

    socket.on('sendMessage', ({ channel, content, sender, type = 'text', data, replyTo }) => {
        const message = { sender, content, timestamp: new Date(), type, data, replyTo };
        if (channel.startsWith('DM_')) {
            if (!messages.DMs[channel]) messages.DMs[channel] = [];
            messages.DMs[channel].push(message);
        } else {
            if (!messages[channel]) messages[channel] = [];
            messages[channel].push(message);
        }
        io.to(channel).emit('newMessage', message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: 'https://uchat-997p.onrender.com',
        methods: ['GET', 'POST'],
        credentials: true,
    },
});
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const mongoURI = 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    color: { type: String, default: '#1E90FF' },
    language: { type: String, default: 'en' },
});
const User = mongoose.model('User', userSchema);

const store = new MongoDBStore({
    uri: mongoURI,
    collection: 'sessions',
});
store.on('error', err => console.error('Session store error:', err));

const sessionMiddleware = session({
    secret: 'UlisChatSecret2025',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, secure: false },
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname)));
app.use(express.json());

io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/chat');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/chat');
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: 'Invalid credentials' });
    }
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ success: true });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (await User.findOne({ username })) {
        return res.status(400).json({ error: 'Username taken' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ success: true });
});

app.get('/user', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const user = await User.findById(req.session.userId);
    res.json({ username: user.username, color: user.color, language: user.language, userId: user._id.toString() });
});

app.post('/change-color', async (req, res) => {
    const { color } = req.body;
    const user = await User.findById(req.session.userId);
    user.color = color;
    await user.save();
    res.json({ success: true });
});

app.post('/update-language', async (req, res) => {
    const { language } = req.body;
    const user = await User.findById(req.session.userId);
    user.language = language;
    await user.save();
    res.json({ success: true });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

const connectedUsers = new Map();
io.on('connection', async (socket) => {
    console.log('New Socket.IO connection:', socket.id);
    const session = socket.request.session;
    if (!session.userId) {
        console.log('No session, disconnecting:', socket.id);
        return socket.disconnect(true);
    }
    const user = await User.findById(session.userId);
    connectedUsers.set(socket.id, { id: socket.id, userId: user._id.toString(), username: user.username, color: user.color });
    io.emit('user list', Array.from(connectedUsers.values()));

    socket.on('chat message', (msg) => {
        console.log('Chat message received:', msg);
        msg.senderId = user._id.toString();
        io.emit('chat message', msg);
    });

    socket.on('dm message', (msg) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === msg.recipientId);
        if (recipient) io.to(recipient.id).emit('dm message', msg);
        socket.emit('dm message', msg);
    });

    socket.on('image message', (msg) => {
        msg.senderId = user._id.toString();
        if (msg.recipientId) {
            const recipient = Array.from(connectedUsers.values()).find(u => u.userId === msg.recipientId);
            if (recipient) io.to(recipient.id).emit('image message', msg);
            socket.emit('image message', msg);
        } else {
            io.emit('image message', msg);
        }
    });

    socket.on('color change', (data) => {
        connectedUsers.get(socket.id).color = data.color;
        io.emit('color change', data);
    });

    socket.on('typing', (data) => socket.broadcast.emit('typing', data));
    socket.on('stop typing', (data) => socket.broadcast.emit('stop typing', data));

    socket.on('call-user', (data) => {
        const sender = connectedUsers.get(socket.id);
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            io.to(recipient.id).emit('call-made', {
                offer: data.offer,
                from: sender.userId,
                fromUsername: sender.username,
            });
        }
    });

    socket.on('make-answer', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            io.to(recipient.id).emit('answer-made', {
                answer: data.answer,
                fromUsername: connectedUsers.get(socket.id).username,
            });
        }
    });

    socket.on('ice-candidate', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('ice-candidate', { candidate: data.candidate });
    });

    socket.on('call-rejected', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('call-rejected');
    });

    socket.on('hang-up', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('hang-up');
    });

    socket.on('disconnect', () => {
        console.log('Socket.IO disconnected:', socket.id);
        connectedUsers.delete(socket.id);
        io.emit('user list', Array.from(connectedUsers.values()));
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
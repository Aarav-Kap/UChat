const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const bcrypt = require('bcryptjs');
const path = require('path');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*' }
});

// MongoDB connection
mongoose.connect('mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/Cluster0?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Session store
const store = new MongoDBStore({
    uri: 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/Cluster0?retryWrites=true&w=majority',
    collection: 'sessions'
});
store.on('error', error => console.error('Session store error:', error));

// Express middleware
app.use(express.static(__dirname)); // Serve static files (style.css, app.js, notification.mp3) from root
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'UlisChatSecret2025',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
    }
}));
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    color: { type: String, default: '#ffffff' },
    language: { type: String, default: 'en' },
    muteNotifications: { type: Boolean, default: false },
    profilePicture: { type: String, default: '' },
    bio: { type: String, default: '' },
    joinedDate: { type: Date, default: Date.now }
});
const MessageSchema = new mongoose.Schema({
    channel: { type: String, required: true },
    sender: { type: String, required: true },
    content: { type: String },
    type: { type: String, enum: ['text', 'image', 'voice'], default: 'text' },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    timestamp: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// Routes
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.render(path.join(__dirname, 'register.html')));
app.get('/chat', (req, res) => {
    if (!req.session.user) {
        console.log('No session user, redirecting to /login'); // Debug log
        return res.redirect('/login');
    }
    console.log('Serving chat page for user:', req.session.user.username); // Debug log
    res.render(path.join(__dirname, 'chat.html'), { user: req.session.user });
});

// Authentication
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Username taken' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'User registered' });
    } catch (error) {
        console.error('Register error:', error); // Debug log
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('Login attempt for:', username); // Debug log
    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            console.log('Invalid credentials for:', username); // Debug log
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        req.session.user = user;
        req.session.save(err => {
            if (err) {
                console.error('Session save error:', err); // Debug log
                return res.status(500).json({ error: 'Session error' });
            }
            console.log('Session saved for user:', username); // Debug log
            res.json({ message: 'Logged in' });
        });
    } catch (error) {
        console.error('Login error:', error); // Debug log
        res.status(500).json({ error: 'Server error' });
    }
});
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logged out' });
});

// Socket.IO
io.on('connection', socket => {
    socket.on('joinChannel', async ({ channel, username }) => {
        socket.join(channel);
        const messages = await Message.find({ channel }).populate('replyTo').limit(50).sort({ timestamp: 1 });
        socket.emit('loadMessages', messages);
    });

    socket.on('sendMessage', async ({ channel, content, type, replyTo, sender }) => {
        const message = new Message({ channel, sender, content, type, replyTo });
        await message.save();
        const populatedMessage = await Message.findById(message._id).populate('replyTo');
        io.to(channel).emit('newMessage', populatedMessage);
    });

    socket.on('typing', ({ channel, username }) => {
        socket.to(channel).emit('typing', { username });
    });

    socket.on('stopTyping', ({ channel }) => {
        socket.to(channel).emit('stopTyping');
    });

    socket.on('webrtcSignal', ({ to, signal, from }) => {
        io.to(to).emit('webrtcSignal', { signal, from });
    });

    socket.on('callUser', ({ to, from }) => {
        io.to(to).emit('incomingCall', { from });
    });

    socket.on('acceptCall', ({ to }) => {
        io.to(to).emit('callAccepted');
    });

    socket.on('declineCall', ({ to }) => {
        io.to(to).emit('callDeclined');
    });
});

// Profile updates
app.post('/updateProfile', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    const { color, language, muteNotifications, bio, profilePicture } = req.body;
    try {
        await User.updateOne(
            { _id: req.session.user._id },
            { color, language, muteNotifications, bio, profilePicture }
        );
        req.session.user = await User.findById(req.session.user._id);
        res.json({ message: 'Profile updated' });
    } catch (error) {
        console.error('Profile update error:', error); // Debug log
        res.status(500).json({ error: 'Server error' });
    }
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 5 * 1024 * 1024 // 5MB for image uploads
});
const bcrypt = require('bcrypt');
const session = require('express-session');
const sharedsession = require('express-socket.io-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');

// Session middleware with MongoDB store
const sessionMiddleware = session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: 'mongodb+srv://admin:Aarav123%2E@cluster0.0g3yi.mongodb.net/ulis_chat?retryWrites=true&w=majority&appName=Cluster0',
        collectionName: 'sessions'
    }),
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Connect to MongoDB Atlas
(async () => {
    try {
        await mongoose.connect('mongodb+srv://admin:Aarav123%2E@cluster0.0g3yi.mongodb.net/ulis_chat?retryWrites=true&w=majority&appName=Cluster0', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1); // Exit the process if MongoDB connection fails
    }
})();

mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error after initial connect:', err);
});

// Define User schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

io.use(sharedsession(sessionMiddleware, {
    autoSave: true
}));

app.get('/', (req, res) => {
    if (!req.session.user) {
        res.sendFile(__dirname + '/login.html');
    } else {
        res.sendFile(__dirname + '/index.html');
    }
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Username and password are required');

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).send('Username already exists');

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        console.log('Registered user:', username);
        req.session.user = { username, color: '#000000', language: 'en' }; // Default language
        res.redirect('/');
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).send('Server error');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Username and password are required');

    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).send('Invalid username or password');
        }

        req.session.user = { username, color: req.session.user?.color || '#000000', language: req.session.user?.language || 'en' };
        res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('Server error');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/user', (req, res) => {
    if (req.session.user) {
        res.json({ username: req.session.user.username, color: req.session.user.color, language: req.session.user.language });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/change-username', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    const { newUsername } = req.body;
    if (!newUsername || newUsername.trim() === '') {
        return res.status(400).json({ success: false, message: 'Invalid username' });
    }

    try {
        const existingUser = await User.findOne({ username: newUsername });
        if (existingUser && newUsername !== req.session.user.username) {
            return res.status(400).json({ success: false, message: 'Username already taken' });
        }

        const oldUsername = req.session.user.username;
        const user = await User.findOne({ username: oldUsername });
        if (!user) return res.status(400).json({ success: false, message: 'User not found' });

        user.username = newUsername;
        await user.save();
        req.session.user.username = newUsername;
        res.json({ success: true });
    } catch (err) {
        console.error('Change username error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/change-color', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    const { color } = req.body;
    if (!color || !/^#[0-9A-F]{6}$/i.test(color)) {
        return res.status(400).json({ success: false, message: 'Invalid color' });
    }

    req.session.user.color = color;
    res.json({ success: true });
});

app.post('/update-language', (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    const { language } = req.body;
    if (!language || !['en', 'fr', 'es', 'pt', 'ru', 'hi'].includes(language)) {
        return res.status(400).json({ success: false, message: 'Invalid language' });
    }

    req.session.user.language = language;
    res.json({ success: true });
});

let userCount = 0;
let connectedUsers = {};
const MAX_USERS = 20; // Limit concurrent users to reduce server load

io.on('connection', (socket) => {
    const session = socket.handshake.session;
    if (!session || !session.user) {
        socket.disconnect();
        return;
    }

    if (userCount >= MAX_USERS) {
        socket.emit('chat message', { username: 'System', text: 'Server is full. Please try again later.' });
        socket.disconnect();
        return;
    }

    const username = session.user.username;
    const userColor = session.user.color || '#000000';
    const userLanguage = session.user.language || 'en';
    userCount++;
    console.log('User connected:', username, 'userCount:', userCount);
    connectedUsers[socket.id] = { username, id: socket.id, color: userColor, language: userLanguage };
    io.emit('user count', userCount);
    io.emit('user list', Object.values(connectedUsers));

    socket.on('chat message', (msg) => {
        if (!msg || !msg.username || !msg.text && !msg.image) {
            console.error('Invalid message received:', msg);
            return;
        }
        msg.language = connectedUsers[socket.id].language; // Add sender's language
        console.log('Broadcasting chat message from:', msg.username);
        io.emit('chat message', msg);
    });

    socket.on('dm message', (msg) => {
        if (!msg || !msg.username || !msg.recipientId || !msg.text && !msg.image) {
            console.error('Invalid DM received:', msg);
            return;
        }
        msg.language = connectedUsers[socket.id].language; // Add sender's language
        console.log('Sending DM from:', msg.username, 'to:', msg.recipientId);
        msg.senderId = socket.id;
        io.to(msg.recipientId).emit('dm message', { ...msg, isDM: true });
        socket.emit('dm message', { ...msg, isDM: true });
    });

    socket.on('typing', (username) => {
        if (username) socket.broadcast.emit('typing', username);
        else console.error('No username provided for typing event');
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing');
    });

    socket.on('name change', (data) => {
        if (data && data.oldUsername && data.newUsername && data.id) {
            if (connectedUsers[data.id]) {
                connectedUsers[data.id].username = data.newUsername;
                console.log('Broadcasting name change:', data);
                io.emit('name change', data);
                io.emit('user list', Object.values(connectedUsers));
            }
        } else console.error('Invalid name change data:', data);
    });

    socket.on('color change', (data) => {
        if (data && data.id && data.color) {
            if (connectedUsers[data.id]) {
                connectedUsers[data.id].color = data.color;
                io.emit('user list', Object.values(connectedUsers));
                io.emit('color change', data);
            }
        }
    });

    socket.on('disconnect', () => {
        userCount--;
        if (connectedUsers[socket.id]) {
            delete connectedUsers[socket.id];
            io.emit('user list', Object.values(connectedUsers));
        }
        console.log('User disconnected, userCount:', userCount);
        io.emit('user count', userCount);
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error.message);
    });
});

http.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Server running');
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
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
        collectionName: 'sessions',
        ttl: 30 * 24 * 60 * 60 // 30 days
    }),
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production' } // 30 days
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// Connect to MongoDB Atlas
mongoose.connect('mongodb+srv://admin:Aarav123%2E@cluster0.0g3yi.mongodb.net/ulis_chat?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error after initial connect:', err);
});
mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected, attempting to reconnect...');
});

// Define User schema
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// Define ChatHistory schema
const chatHistorySchema = new mongoose.Schema({
    username: String,
    recipientId: { type: String, default: null },
    messages: [{
        username: String,
        text: String,
        color: String,
        language: String,
        messageId: { type: String, required: true }, // Use client-provided ID as string
        replyTo: {
            username: String,
            text: String
        },
        isDM: Boolean,
        image: String,
        timestamp: { type: Date, default: Date.now }
    }]
});
const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);

io.use(sharedsession(sessionMiddleware, {
    autoSave: true
}));

// Serve static files with cache-control
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

app.get('/', (req, res) => {
    console.log('GET / - Session:', req.session);
    if (!req.session.user) {
        res.sendFile(__dirname + '/login.html');
    } else {
        res.sendFile(__dirname + '/index.html');
    }
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    console.log('POST /register - Request body:', req.body);
    if (!username || !password) return res.status(400).send('Username and password are required');

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).send('Username already exists');

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        req.session.user = { username, color: '#000000', language: 'en' };
        console.log('User registered:', username);
        res.redirect('/');
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).send('Server error');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('POST /login - Request body:', req.body);
    if (!username || !password) return res.status(400).send('Username and password are required');

    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            console.log('Login failed for:', username);
            return res.status(401).send('Invalid username or password');
        }

        req.session.user = { username, color: req.session.user?.color || '#000000', language: req.session.user?.language || 'en' };
        console.log('User logged in:', username);
        res.redirect('/');
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('Server error');
    }
});

app.get('/logout', (req, res) => {
    console.log('GET /logout - Session:', req.session);
    req.session.destroy(err => {
        if (err) console.error('Logout error:', err);
        res.redirect('/');
    });
});

app.get('/user', (req, res) => {
    console.log('GET /user - Session:', req.session);
    if (req.session.user) {
        res.json({ username: req.session.user.username, color: req.session.user.color, language: req.session.user.language });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/change-username', async (req, res) => {
    console.log('POST /change-username - Request body:', req.body);
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

        // Update ChatHistory
        await ChatHistory.updateMany({ username: oldUsername }, { username: newUsername });
        req.session.user.username = newUsername;
        console.log('Username changed from', oldUsername, 'to', newUsername);
        res.json({ success: true });
    } catch (err) {
        console.error('Change username error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/change-color', (req, res) => {
    console.log('POST /change-color - Request body:', req.body);
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    const { color } = req.body;
    if (!color || !/^#[0-9A-F]{6}$/i.test(color)) {
        return res.status(400).json({ success: false, message: 'Invalid color' });
    }

    req.session.user.color = color;
    console.log('Color changed for', req.session.user.username, 'to', color);
    res.json({ success: true });
});

app.post('/update-language', (req, res) => {
    console.log('POST /update-language - Request body:', req.body);
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Not logged in' });
    const { language } = req.body;
    if (!language || !['en', 'fr', 'es', 'pt', 'ru', 'hi'].includes(language)) {
        return res.status(400).json({ success: false, message: 'Invalid language' });
    }

    req.session.user.language = language;
    console.log('Language updated for', req.session.user.username, 'to', language);
    res.json({ success: true });
});

let userCount = 0;
let connectedUsers = {};
const MAX_USERS = 20;

io.on('connection', (socket) => {
    const session = socket.handshake.session;
    console.log('Socket connection attempt - Session:', session);
    if (!session || !session.user) {
        console.warn('No session or user found for socket:', socket.id);
        socket.emit('chat message', { username: 'System', text: 'Please log in to continue.', id: Date.now().toString() });
        socket.disconnect();
        return;
    }

    if (userCount >= MAX_USERS) {
        socket.emit('chat message', { username: 'System', text: 'Server is full. Please try again later.', id: Date.now().toString() });
        socket.disconnect();
        return;
    }

    const username = session.user.username;
    const userColor = session.user.color || '#000000';
    const userLanguage = session.user.language || 'en';
    userCount++;
    connectedUsers[socket.id] = { username, id: socket.id, color: userColor, language: userLanguage };
    console.log('User connected:', username, 'Socket ID:', socket.id, 'userCount:', userCount);
    io.emit('user count', userCount);
    io.emit('user list', Object.values(connectedUsers));

    // Load chat history on connection
    loadChatHistory(socket);

    socket.on('chat message', async (msg) => {
        if (!msg || !msg.username || (!msg.text && !msg.image)) {
            console.error('Invalid main chat message received:', msg);
            return;
        }
        msg.language = connectedUsers[socket.id]?.language || 'en';
        msg.isDM = false;
        msg.messageId = msg.id.toString(); // Ensure messageId is a string
        console.log('Broadcasting main chat message from:', msg.username, 'Message:', msg);
        io.emit('chat message', msg);
        await saveChatMessage(msg, socket);
    });

    socket.on('dm message', async (msg) => {
        if (!msg || !msg.username || !msg.recipientId || (!msg.text && !msg.image)) {
            console.error('Invalid DM received:', msg);
            return;
        }
        msg.language = connectedUsers[socket.id]?.language || 'en';
        msg.isDM = true;
        msg.senderId = socket.id;
        msg.messageId = msg.id.toString(); // Ensure messageId is a string
        const recipientSocket = Object.keys(connectedUsers).find(id => id === msg.recipientId);
        if (recipientSocket) {
            console.log('Sending DM from:', msg.username, 'to:', msg.recipientId, 'Message:', msg);
            io.to(msg.recipientId).emit('dm message', msg);
            socket.emit('dm message', msg); // Echo back to sender
            await saveChatMessage(msg, socket, msg.recipientId);
        } else {
            console.error('Recipient not found for DM:', msg.recipientId);
            socket.emit('chat message', { username: 'System', text: 'Recipient is offline.', id: Date.now().toString() });
        }
    });

    socket.on('typing', (username) => {
        if (username) {
            console.log('Typing event from:', username);
            socket.broadcast.emit('typing', username);
        } else {
            console.error('No username provided for typing event');
        }
    });

    socket.on('stop typing', () => {
        console.log('Stop typing event');
        socket.broadcast.emit('stop typing');
    });

    socket.on('name change', (data) => {
        if (data && data.oldUsername && data.newUsername && data.id) {
            if (connectedUsers[data.id]) {
                connectedUsers[data.id].username = data.newUsername;
                console.log('Name changed:', data);
                io.emit('name change', data);
                io.emit('user list', Object.values(connectedUsers));
            }
        } else {
            console.error('Invalid name change data:', data);
        }
    });

    socket.on('color change', (data) => {
        if (data && data.id && data.color) {
            if (connectedUsers[data.id]) {
                connectedUsers[data.id].color = data.color;
                console.log('Color changed:', data);
                io.emit('user list', Object.values(connectedUsers));
                io.emit('color change', data);
            }
        } else {
            console.error('Invalid color change data:', data);
        }
    });

    socket.on('disconnect', () => {
        if (connectedUsers[socket.id]) {
            const username = connectedUsers[socket.id].username;
            userCount--;
            delete connectedUsers[socket.id];
            console.log('User disconnected:', username, 'Socket ID:', socket.id, 'userCount:', userCount);
            io.emit('user list', Object.values(connectedUsers));
            io.emit('user count', userCount);
        }
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error.message);
    });
});

// Chat History Functions
async function loadChatHistory(socket) {
    const session = socket.handshake.session;
    if (!session || !session.user) return;
    const username = session.user.username;
    console.log('Loading chat history for:', username);
    try {
        const history = await ChatHistory.findOne({ username });
        if (history && history.messages.length > 0) {
            console.log('Found chat history for:', username, 'Messages:', history.messages.length);
            history.messages.forEach(msg => {
                if (msg.isDM) {
                    socket.emit('dm message', msg);
                } else {
                    socket.emit('chat message', msg);
                }
            });
        } else {
            console.log('No chat history found for:', username);
        }
    } catch (err) {
        console.error('Error loading chat history:', err);
    }
}

async function saveChatMessage(msg, socket, recipientId = null) {
    const session = socket.handshake.session;
    if (!session || !session.user) {
        console.error('No session found for saving message:', msg);
        return;
    }
    const username = session.user.username;
    try {
        let history = await ChatHistory.findOne({ username, recipientId });
        if (!history) {
            history = new ChatHistory({ username, recipientId, messages: [] });
        }
        msg.timestamp = new Date();
        // Ensure messageId is a string and use it directly
        history.messages.push({
            username: msg.username,
            text: msg.text,
            color: msg.color,
            language: msg.language,
            messageId: msg.messageId,
            replyTo: msg.replyTo,
            isDM: msg.isDM,
            image: msg.image,
            timestamp: msg.timestamp
        });
        await history.save();
        console.log('Saved message for:', username, 'Recipient:', recipientId, 'Message:', msg);

        // Save for recipient if DM
        if (recipientId) {
            let recipientHistory = await ChatHistory.findOne({ username: connectedUsers[recipientId]?.username, recipientId: socket.id });
            if (!recipientHistory) {
                recipientHistory = new ChatHistory({ username: connectedUsers[recipientId]?.username, recipientId: socket.id, messages: [] });
            }
            recipientHistory.messages.push({
                username: msg.username,
                text: msg.text,
                color: msg.color,
                language: msg.language,
                messageId: msg.messageId,
                replyTo: msg.replyTo,
                isDM: msg.isDM,
                image: msg.image,
                timestamp: msg.timestamp
            });
            await recipientHistory.save();
            console.log('Saved DM for recipient:', connectedUsers[recipientId]?.username);
        }
    } catch (err) {
        console.error('Error saving chat message:', err);
    }
}

http.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Server running on port', process.env.PORT || 3000);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Define User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    color: { type: String, default: '#1E90FF' },
    language: { type: String, default: 'en' },
});
const User = mongoose.model('User', userSchema);

// Session store in MongoDB
const store = new MongoDBStore({
    uri: mongoURI,
    collection: 'sessions',
    ttl: 30 * 24 * 60 * 60 // 30 days
});
store.on('error', err => console.error('Session store error:', err));
store.on('connected', () => console.log('Session store connected to MongoDB'));
store.on('createSession', (sessionId, session) => {
    console.log('Session created:', sessionId, 'Data:', session);
});

// Session middleware
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'UlisChatSecret2025',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { 
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        secure: process.env.NODE_ENV === 'production', // True on Render (HTTPS)
        sameSite: 'lax', // Allow redirects
        httpOnly: true,
        path: '/' // Ensure cookie is available on all routes
    },
});

app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse form-encoded bodies (optional)
app.use(sessionMiddleware);

// Apply session middleware to Socket.IO
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

// Routes
app.get('/', (req, res) => {
    console.log('GET / - Session ID:', req.sessionID, 'User ID:', req.session.userId, 'Cookie:', req.headers.cookie, 'Session Cookie:', req.session.cookie);
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    console.log('GET /register - Session ID:', req.sessionID, 'User ID:', req.session.userId, 'Cookie:', req.headers.cookie, 'Session Cookie:', req.session.cookie);
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/chat', (req, res) => {
    console.log('GET /chat - Session ID:', req.sessionID, 'User ID:', req.session.userId, 'Cookie:', req.headers.cookie, 'Session Cookie:', req.session.cookie);
    if (!req.session.userId) {
        console.log('No userId in session, redirecting to /');
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    console.log('POST /login - Username:', username, 'Session ID:', req.sessionID, 'Cookie:', req.headers.cookie, 'Session Cookie:', req.session.cookie);
    if (!username || username.length < 3 || !password || password.length < 3) {
        console.log('Validation failed: Username or password too short');
        return res.status(400).send(`
            <p id="error" style="color: red;">Username and password must be at least 3 characters long</p>
        `);
    }
    try {
        const user = await User.findOne({ username });
        if (!user) {
            console.log('User not found:', username);
            return res.status(400).send(`
                <p id="error" style="color: red;">Invalid username or password</p>
            `);
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log('Password mismatch for user:', username);
            return res.status(400).send(`
                <p id="error" style="color: red;">Invalid username or password</p>
            `);
        }
        req.session.userId = user._id.toString();
        req.session.save(err => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).send('<p id="error" style="color: red;">Session save failed</p>');
            }
            console.log('Session saved successfully for user:', username, 'User ID:', req.session.userId);
            res.redirect('/chat');
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('<p id="error" style="color: red;">Server error</p>');
    }
});

// Register endpoint
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || username.length < 3 || !password || password.length < 3) {
        return res.status(400).send(`
            <p id="error" style="color: red;">Username and password must be at least 3 characters long</p>
        `);
    }
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).send(`
                <p id="error" style="color: red;">Username already exists</p>
            `);
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, password: hashedPassword });
        await user.save();
        req.session.userId = user._id.toString();
        req.session.save(err => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).send('<p id="error" style="color: red;">Session save failed</p>');
            }
            console.log('Session saved successfully for user:', username, 'User ID:', req.session.userId);
            res.redirect('/chat');
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).send('<p id="error" style="color: red;">Server error</p>');
    }
});

// Get user data
app.get('/user', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }
        res.json({ username: user.username, color: user.color, language: user.language, userId: user._id.toString() });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change username
app.post('/change-username', async (req, res) => {
    const { newUsername } = req.body;
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    if (!newUsername || newUsername.length < 3) {
        return res.status(400).json({ error: 'New username must be at least 3 characters long' });
    }
    try {
        const existingUser = await User.findOne({ username: newUsername });
        if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        const user = await User.findById(req.session.userId);
        user.username = newUsername;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Change username error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Change color
app.post('/change-color', async (req, res) => {
    const { color } = req.body;
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        const user = await User.findById(req.session.userId);
        user.color = color;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Change color error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update language
app.post('/update-language', async (req, res) => {
    const { language } = req.body;
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    try {
        const user = await User.findById(req.session.userId);
        user.language = language;
        await user.save();
        res.json({ success: true });
    } catch (err) {
        console.error('Update language error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

const connectedUsers = new Map();

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (!session || !session.userId) {
        socket.disconnect(true);
        return;
    }
    const user = await User.findById(session.userId);
    if (!user) {
        socket.disconnect(true);
        return;
    }
    const { username, color } = user;

    const existingSocket = Array.from(connectedUsers.entries()).find(([_, u]) => u.userId === user._id.toString());
    if (existingSocket) {
        connectedUsers.delete(existingSocket[0]);
        console.log(`Removed old socket ${existingSocket[0]} for user ${username}`);
    }
    const socketUser = { id: socket.id, userId: user._id.toString(), username, color };
    connectedUsers.set(socket.id, socketUser);
    console.log(`User connected: ${username} (socket: ${socket.id}, userId: ${user._id})`);

    io.emit('user list', Array.from(connectedUsers.values()));

    socket.on('reconnect', async () => {
        const user = await User.findById(session.userId);
        if (user) {
            const existingSocket = Array.from(connectedUsers.entries()).find(([_, u]) => u.userId === user._id.toString());
            if (existingSocket) {
                connectedUsers.delete(existingSocket[0]);
                console.log(`Removed old socket ${existingSocket[0]} on reconnect for user ${user.username}`);
            }
            connectedUsers.set(socket.id, { id: socket.id, userId: user._id.toString(), username: user.username, color: user.color });
            console.log(`User reconnected: ${user.username} (socket: ${socket.id}, userId: ${user._id})`);
            io.emit('user list', Array.from(connectedUsers.values()));
        }
    });

    socket.on('chat message', msg => {
        io.emit('chat message', { ...msg, senderId: socket.id });
    });

    socket.on('dm message', msg => {
        const sender = Array.from(connectedUsers.values()).find(u => u.id === socket.id);
        if (!sender) {
            console.log('Sender not found in connectedUsers');
            return;
        }
        console.log(`DM from ${sender.username} (socket: ${socket.id}, userId: ${sender.userId}) to recipientId: ${msg.recipientId}`);

        socket.emit('dm message', { ...msg, senderId: sender.userId, recipientId: msg.recipientId });
        console.log(`Emitted DM to sender ${sender.username} (socket: ${socket.id})`);

        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === msg.recipientId);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket && typeof recipientSocket.emit === 'function') {
                recipientSocket.emit('dm message', { ...msg, senderId: sender.userId, recipientId: recipient.userId });
                console.log(`Emitted DM to recipient ${recipient.username} (socket: ${recipient.id}, userId: ${recipient.userId})`);
            } else {
                console.log(`Recipient socket ${recipient.id} not active or function`);
                socket.emit('dm message', { username: 'System', text: `Recipient is offline`, id: Date.now(), senderId: sender.userId });
            }
        } else {
            console.log(`Recipient with userId ${msg.recipientId} not found in connected users`);
            socket.emit('dm message', { username: 'System', text: `Recipient is offline`, id: Date.now(), senderId: sender.userId });
        }
    });

    socket.on('call-user', data => {
        const sender = Array.from(connectedUsers.values()).find(u => u.id === socket.id);
        if (!sender) {
            console.log('Sender not found in connectedUsers');
            return;
        }
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket) {
                recipientSocket.emit('call-made', {
                    offer: data.offer,
                    from: sender.userId,
                    fromUsername: sender.username
                });
                console.log(`Call initiated from ${sender.username} to ${recipient.username}`);
            }
        }
    });

    socket.on('make-answer', data => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket) {
                recipientSocket.emit('answer-made', {
                    answer: data.answer,
                    from: data.from
                });
                console.log(`Answer sent from ${data.from} to ${recipient.userId}`);
            }
        }
    });

    socket.on('ice-candidate', data => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket) {
                recipientSocket.emit('ice-candidate', {
                    candidate: data.candidate,
                    from: data.from
                });
                console.log(`ICE candidate sent from ${data.from} to ${recipient.userId}`);
            }
        }
    });

    socket.on('call-rejected', data => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket) {
                recipientSocket.emit('call-rejected', { from: data.from });
                console.log(`Call rejected by ${data.from} to ${recipient.userId}`);
            }
        }
    });

    socket.on('hang-up', data => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) {
            const recipientSocket = io.sockets.sockets.get(recipient.id);
            if (recipientSocket) {
                recipientSocket.emit('hang-up', { from: data.from });
                console.log(`Hang-up from ${data.from} to ${recipient.userId}`);
            }
        }
    });

    socket.on('typing', data => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('stop typing', data => {
        socket.broadcast.emit('stop typing', data);
    });

    socket.on('name change', data => {
        connectedUsers.set(socket.id, { ...connectedUsers.get(socket.id), username: data.newUsername });
        io.emit('name change', data);
        io.emit('user list', Array.from(connectedUsers.values()));
    });

    socket.on('color change', data => {
        connectedUsers.set(socket.id, { ...connectedUsers.get(socket.id), color: data.color });
        io.emit('color change', data);
        io.emit('user list', Array.from(connectedUsers.values()));
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`User disconnected: ${user.username} (socket: ${socket.id}, userId: ${user.userId})`);
        }
        connectedUsers.delete(socket.id);
        io.emit('user list', Array.from(connectedUsers.values()));
    });
});

const PORT = process.env.PORT || 10000; // Match Render's detected port
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
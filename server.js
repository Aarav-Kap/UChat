const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const memoryStore = require('express-session').MemoryStore;

// Enforce HTTPS in production
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && !req.secure && req.get('x-forwarded-proto') !== 'https') {
        console.log('Redirecting to HTTPS:', `https://${req.get('host')}${req.url}`);
        return res.redirect(`https://${req.get('host')}${req.url}`);
    }
    next();
});

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ulischat';
console.log(`MongoDB URI: ${mongoURI}`);
mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error('MongoDB connection error:', err.message);
        console.warn('MongoDB connection failed. Server will continue with limited functionality.');
    });

// Session Store
let sessionStore;
try {
    const mongoStore = new MongoDBStore({
        uri: mongoURI,
        collection: 'sessions',
    });
    mongoStore.on('error', err => {
        console.error('Session store error:', err.message);
    });
    mongoStore.on('connected', () => {
        console.log('MongoDB session store connected successfully');
        sessionStore = mongoStore;
    });
    mongoStore.on('error', err => {
        console.error('MongoDB session store failed:', err.message);
        if (!sessionStore) {
            console.warn('Falling back to MemoryStore for sessions (not recommended for production).');
            sessionStore = new memoryStore();
        }
    });
} catch (err) {
    console.error('Failed to initialize MongoDB session store:', err.message);
    console.warn('Falling back to MemoryStore for sessions (not recommended for production).');
    sessionStore = new memoryStore();
}

// Ensure sessionStore is set before middleware
const initializeSessionStore = new Promise(resolve => {
    if (sessionStore) {
        return resolve(sessionStore);
    }
    const interval = setInterval(() => {
        if (sessionStore) {
            clearInterval(interval);
            resolve(sessionStore);
        }
    }, 100);
    setTimeout(() => {
        if (!sessionStore) {
            console.warn('Session store not initialized after timeout. Using MemoryStore.');
            sessionStore = new memoryStore();
            clearInterval(interval);
            resolve(sessionStore);
        }
    }, 5000);
});

initializeSessionStore.then(store => {
    const sessionMiddleware = session({
        secret: process.env.SESSION_SECRET || 'UlisChat_Secret_2025!@#xK9pLmQ2',
        resave: false,
        saveUninitialized: false,
        store: store,
        cookie: { 
            maxAge: 2592000000, 
            secure: process.env.NODE_ENV === 'production', 
            httpOnly: true, 
            sameSite: 'lax' 
        },
    });

    app.use(sessionMiddleware);

    // Share session with Socket.IO
    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    // Middleware
    app.use(express.static(path.join(__dirname)));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());

    app.get('/', (req, res) => {
        console.log('GET / - Session:', req.session);
        if (!req.session?.user) {
            return res.sendFile(path.join(__dirname, 'login.html'));
        }
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.post('/login', (req, res) => {
        console.log('POST /login - Request body:', req.body);
        const { username, password } = req.body;
        if (!username || username.length < 3 || !password) {
            console.log('POST /login - Invalid username or password');
            return res.status(400).json({ error: 'Username and password must be at least 3 characters long' });
        }
        req.session.user = { username, color: '#1E90FF', language: 'en' };
        req.session.save(err => {
            if (err) {
                console.error('POST /login - Error saving session:', err);
                return res.status(500).json({ error: 'Failed to save session' });
            }
            console.log(`POST /login - Success for username: ${username}, Session ID: ${req.sessionID}`);
            res.redirect('/');
        });
    });

    const userHandler = (req, res) => {
        console.log('GET /user - Fetching user data', req.session);
        try {
            if (!req.session?.user) {
                console.log('GET /user - No session or user data found');
                return res.status(401).json({ error: 'Not logged in' });
            }
            const { username, color, language } = req.session.user;
            console.log(`GET /user - Success: username=${username}, color=${color}, language=${language}`);
            res.json({ username, color, language });
        } catch (error) {
            console.error('GET /user - Error:', error.message);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    app.get('/user', userHandler);

    app.post('/change-username', (req, res) => {
        console.log('POST /change-username - Attempting to change username');
        const { newUsername } = req.body;
        if (!newUsername || newUsername.length < 3) {
            console.log('POST /change-username - Invalid new username');
            return res.status(400).json({ error: 'New username must be at least 3 characters long' });
        }
        if (req.session?.user) {
            req.session.user.username = newUsername;
        }
        console.log(`POST /change-username - Success: newUsername=${newUsername}`);
        res.json({ success: true });
    });

    app.post('/change-color', (req, res) => {
        console.log('POST /change-color - Changing color');
        const { color } = req.body;
        if (req.session?.user) {
            req.session.user.color = color;
        }
        console.log(`POST /change-color - Success: color=${color}`);
        res.json({ success: true });
    });

    app.post('/update-language', (req, res) => {
        console.log('POST /update-language - Updating language');
        const { language } = req.body;
        if (req.session?.user) {
            req.session.user.language = language;
        }
        console.log(`POST /update-language - Success: language=${language}`);
        res.json({ success: true });
    });

    app.get('/logout', (req, res) => {
        console.log('GET /logout - Logging out, Session:', req.session);
        console.log('GET /logout - Headers:', req.headers);
        req.session.destroy(err => {
            if (err) {
                console.error('GET /logout - Error destroying session:', err);
                return res.status(500).json({ error: 'Failed to log out' });
            }
            res.clearCookie('connect.sid');
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

        socket.on('call offer', ({ recipientId, offer }) => {
            console.log(`Call offer from ${socket.id} to ${recipientId}`);
            const recipientSocket = connectedUsers.get(recipientId);
            if (recipientSocket) {
                recipientSocket.emit('call offer', { callerId: socket.id, offer });
            } else {
                console.warn(`Recipient ${recipientId} not found for call offer`);
                socket.emit('call error', 'Recipient is offline or unavailable');
            }
        });

        socket.on('call answer', ({ callerId, answer }) => {
            console.log(`Call answer from ${socket.id} to ${callerId}`);
            const callerSocket = connectedUsers.get(callerId);
            if (callerSocket) {
                callerSocket.emit('call answer', { answer });
            } else {
                console.warn(`Caller ${callerId} not found for call answer`);
            }
        });

        socket.on('ice candidate', ({ recipientId, candidate }) => {
            console.log(`ICE candidate from ${socket.id} to ${recipientId}`);
            const recipientSocket = connectedUsers.get(recipientId);
            if (recipientSocket) {
                recipientSocket.emit('ice candidate', { candidate });
            } else {
                console.warn(`Recipient ${recipientId} not found for ICE candidate`);
            }
        });

        socket.on('call end', recipientId => {
            console.log(`Call end from ${socket.id} to ${recipientId}`);
            const recipientSocket = connectedUsers.get(recipientId);
            if (recipientSocket) {
                recipientSocket.emit('call end');
            } else {
                console.warn(`Recipient ${recipientId} not found for call end`);
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
            io.emit('user list', Array.from(connectedUsers.values()).filter(u => u.username));
        });

        socket.on('color change', data => {
            console.log(`Color change for ${data.id}: ${data.color}`);
            connectedUsers.set(socket.id, { ...connectedUsers.get(socket.id), color: data.color });
            io.emit('color change', data);
            io.emit('user list', Array.from(connectedUsers.values()).filter(u => u.username));
        });

        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
            connectedUsers.delete(socket.id);
            io.emit('user count', connectedUsers.size);
            io.emit('user list', Array.from(connectedUsers.values()).filter(u => u.username));
        });

        const req = {
            session: socket.request.session,
            method: 'GET',
            url: '/user',
            credentials: 'include'
        };
        const res = {
            json: (data) => {
                if (data.username) {
                    const user = { id: socket.id, username: data.username, color: data.color || '#1E90FF' };
                    connectedUsers.set(socket.id, user);
                    io.emit('user count', connectedUsers.size);
                    io.emit('user list', Array.from(connectedUsers.values()).filter(u => u.username));
                } else {
                    console.warn(`No username found for socket ${socket.id}`);
                }
            },
            status: (code) => {
                return {
                    json: (data) => {
                        console.error(`User fetch failed with status ${code}:`, data.error);
                    }
                };
            }
        };
        userHandler(req, res);
    });

    http.listen(process.env.PORT || 3000, () => {
        console.log(`Server running on port ${process.env.PORT || 3000}`);
    });
});
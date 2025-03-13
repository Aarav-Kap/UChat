const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 20 * 1024 * 1024 // Matches 10MB limit + overhead
});
const bcrypt = require('bcrypt');
const session = require('express-session');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'your-secret-key', // Change this in production
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
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
    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }
    if (users[username]) {
        return res.status(400).send('Username already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = { username, password: hashedPassword };
    console.log('Registered user:', username);
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    const user = users[username];
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).send('Invalid username or password');
    }

    req.session.user = { username };
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/username', (req, res) => {
    if (req.session.user) {
        res.json({ username: req.session.user.username });
    } else {
        res.status(401).json({ error: 'Not logged in' });
    }
});

app.post('/change-username', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Not logged in' });
    }
    const { newUsername } = req.body;
    if (!newUsername || newUsername.trim() === '') {
        return res.status(400).json({ success: false, message: 'Invalid username' });
    }
    if (users[newUsername] && newUsername !== req.session.user.username) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    const oldUsername = req.session.user.username;
    delete users[oldUsername];
    users[newUsername] = { username: newUsername, password: users[oldUsername].password };
    req.session.user.username = newUsername;
    res.json({ success: true });
});

// In-memory user storage (temporary)
const users = {};

let userCount = 0;
let connectedUsers = {}; // Track logged-in users by socket.id

io.on('connection', (socket) => {
    if (!socket.request.session.user) {
        socket.disconnect();
        return;
    }

    const username = socket.request.session.user.username;
    userCount++;
    console.log('User connected:', username, 'userCount:', userCount);
    connectedUsers[socket.id] = { username, id: socket.id };
    io.emit('user count', userCount);
    io.emit('user list', Object.values(connectedUsers));

    socket.on('chat message', (msg) => {
        if (!msg || !msg.username || !msg.text && !msg.image) {
            console.error('Invalid message received:', msg);
            return;
        }
        console.log('Broadcasting chat message from:', msg.username);
        io.emit('chat message', msg);
    });

    socket.on('dm message', (msg) => {
        if (!msg || !msg.username || !msg.recipientId || !msg.text && !msg.image) {
            console.error('Invalid DM received:', msg);
            return;
        }
        console.log('Sending DM from:', msg.username, 'to:', msg.recipientId);
        io.to(msg.recipientId).emit('dm message', msg);
    });

    socket.on('typing', (username) => {
        if (username) {
            socket.broadcast.emit('typing', username);
        } else {
            console.error('No username provided for typing event');
        }
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
        } else {
            console.error('Invalid name change data:', data);
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
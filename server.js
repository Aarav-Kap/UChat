const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: '*', methods: ['GET', 'POST'], credentials: true } });
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

mongoose.connect('mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB error:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    color: { type: String, default: '#5865F2' },
    language: { type: String, default: 'en' },
    profilePicture: { type: String, default: '' },
    theme: { type: String, default: 'dark' },
});
const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
});
const Group = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
    type: { type: String, required: true },
    content: { type: String, required: true },
    username: { type: String, required: true },
    senderId: { type: String, required: true },
    channel: { type: String },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    recipientId: { type: String },
    replyTo: { type: String },
    profilePicture: { type: String },
    timestamp: { type: Date, default: Date.now },
    reactions: { type: Map, of: [String], default: {} },
    pinned: { type: Boolean, default: false },
});
const Message = mongoose.model('Message', messageSchema);

const store = new MongoDBStore({
    uri: 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    collection: 'sessions',
});
store.on('error', err => console.error('Session error:', err));

const sessionMiddleware = session({
    secret: 'UChatNewSecret2025',
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
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/chat', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/profile', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'profile.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    res.json({ success: true });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username taken' });
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
    res.json({ username: user.username, color: user.color, language: user.language, userId: user._id.toString(), profilePicture: user.profilePicture, theme: user.theme });
});

app.post('/update-color', async (req, res) => {
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

app.post('/update-theme', async (req, res) => {
    const { theme } = req.body;
    const user = await User.findById(req.session.userId);
    user.theme = theme;
    await user.save();
    res.json({ success: true });
});

app.post('/update-profile-picture', async (req, res) => {
    const { profilePicture } = req.body;
    const user = await User.findById(req.session.userId);
    user.profilePicture = profilePicture;
    await user.save();
    res.json({ success: true });
});

app.post('/create-group', async (req, res) => {
    const { name, memberIds } = req.body;
    const group = new Group({ name, members: [req.session.userId, ...memberIds] });
    await group.save();
    res.json({ success: true, groupId: group._id });
});

app.get('/messages', async (req, res) => {
    const { channel, groupId, recipientId } = req.query;
    const query = channel ? { channel } : groupId ? { groupId } : recipientId ? {
        $or: [{ senderId: req.session.userId, recipientId }, { senderId: recipientId, recipientId: req.session.userId }]
    } : {};
    const messages = await Message.find(query).sort({ timestamp: 1, pinned: -1 }).limit(200);
    res.json(messages);
});

app.post('/pin-message', async (req, res) => {
    const { messageId } = req.body;
    const message = await Message.findById(messageId);
    message.pinned = !message.pinned;
    await message.save();
    res.json({ success: true });
});

app.post('/react-message', async (req, res) => {
    const { messageId, reaction } = req.body;
    const message = await Message.findById(messageId);
    if (!message.reactions.has(reaction)) message.reactions.set(reaction, []);
    const userReactions = message.reactions.get(reaction);
    const userIndex = userReactions.indexOf(req.session.userId);
    if (userIndex === -1) userReactions.push(req.session.userId);
    else userReactions.splice(userIndex, 1);
    if (userReactions.length === 0) message.reactions.delete(reaction);
    await message.save();
    res.json({ success: true });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

const connectedUsers = new Map();
const channels = ['Math', 'Science', 'History', 'English', 'Study Lounge'];

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (!session.userId) return socket.disconnect(true);

    const user = await User.findById(session.userId);
    connectedUsers.set(socket.id, { id: socket.id, userId: user._id.toString(), username: user.username, profilePicture: user.profilePicture });
    io.emit('user-list', Array.from(connectedUsers.values()));
    io.emit('channels', channels);
    const groups = await Group.find({ members: user._id });
    socket.emit('groups', groups);

    socket.on('join-channel', (channel) => {
        socket.join(channel);
    });

    socket.on('join-group', (groupId) => {
        socket.join(groupId);
    });

    socket.on('join-dm', ({ roomId }) => {
        socket.join(roomId);
    });

    socket.on('send-message', async (msg) => {
        const message = new Message({
            type: msg.type,
            content: msg.content,
            username: msg.username,
            senderId: msg.senderId,
            channel: msg.channel,
            groupId: msg.groupId,
            recipientId: msg.recipientId,
            replyTo: msg.replyTo,
            profilePicture: msg.profilePicture,
        });
        await message.save();
        const target = msg.roomId || msg.groupId || msg.channel;
        io.to(target).emit('new-message', message);
    });

    socket.on('typing', (data) => {
        const target = data.roomId || data.groupId || data.channel;
        socket.to(target).emit('typing', data);
    });

    socket.on('stop-typing', (data) => {
        const target = data.roomId || data.groupId || data.channel;
        socket.to(target).emit('stop-typing', data);
    });

    socket.on('reaction', async (data) => {
        const message = await Message.findById(data.messageId);
        if (!message.reactions.has(data.reaction)) message.reactions.set(data.reaction, []);
        const userReactions = message.reactions.get(data.reaction);
        const userIndex = userReactions.indexOf(data.userId);
        if (userIndex === -1) userReactions.push(data.userId);
        else userReactions.splice(userIndex, 1);
        if (userReactions.length === 0) message.reactions.delete(data.reaction);
        await message.save();
        const target = message.recipientId ? [message.senderId, message.recipientId].sort().join('-') : message.groupId ? message.groupId : message.channel;
        io.to(target).emit('reaction-update', { messageId: data.messageId, reaction: data.reaction, reactions: message.reactions });
    });

    socket.on('pin-message', async (data) => {
        const message = await Message.findById(data.messageId);
        message.pinned = !message.pinned;
        await message.save();
        const target = message.recipientId ? [message.senderId, message.recipientId].sort().join('-') : message.groupId ? message.groupId : message.channel;
        io.to(target).emit('pin-update', { messageId: data.messageId, pinned: message.pinned });
    });

    socket.on('call-user', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('call-made', { offer: data.offer, from: data.from });
    });

    socket.on('make-answer', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('answer-made', { answer: data.answer, from: data.from });
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
        connectedUsers.delete(socket.id);
        io.emit('user-list', Array.from(connectedUsers.values()));
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
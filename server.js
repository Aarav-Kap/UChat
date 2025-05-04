const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: '*', methods: ['GET', 'POST'], credentials: true } });
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

mongoose.connect('mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/schoolchat?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB error:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: '' },
    color: { type: String, default: '#1E90FF' },
    language: { type: String, default: 'en' },
    profilePicture: { type: String, default: '' },
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
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    profilePicture: { type: String },
    timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

const store = new MongoDBStore({
    uri: 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/schoolchat?retryWrites=true&w=majority&appName=Cluster0',
    collection: 'sessions',
});
store.on('error', err => console.error('Session error:', err));

const sessionMiddleware = session({
    secret: 'SchoolChatSecret2025',
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
    if (req.session.userId) return res.redirect('/app');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/app', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'app.html'));
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
    res.json({ username: user.username, bio: user.bio, color: user.color, language: user.language, userId: user._id.toString(), profilePicture: user.profilePicture });
});

app.post('/update-profile', async (req, res) => {
    const { bio, profilePicture, color, language } = req.body;
    const user = await User.findById(req.session.userId);
    if (bio !== undefined) user.bio = bio;
    if (profilePicture) user.profilePicture = profilePicture;
    if (color) user.color = color;
    if (language) user.language = language;
    await user.save();
    res.json({ success: true });
});

app.post('/create-group', async (req, res) => {
    const { name, memberIds } = req.body;
    const group = new Group({ name, members: [req.session.userId, ...memberIds.map(id => mongoose.Types.ObjectId(id))] });
    await group.save();
    res.json({ success: true, groupId: group._id.toString() });
});

app.get('/messages', async (req, res) => {
    const { channel, groupId, recipientId } = req.query;
    const query = channel ? { channel } : groupId ? { groupId: mongoose.Types.ObjectId(groupId) } : recipientId ? {
        $or: [{ senderId: req.session.userId, recipientId: mongoose.Types.ObjectId(recipientId) }, { senderId: mongoose.Types.ObjectId(recipientId), recipientId: req.session.userId }]
    } : {};
    const messages = await Message.find(query).sort({ timestamp: 1 }).limit(200).populate('replyTo');
    res.json(messages);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

const connectedUsers = new Map();
const channels = ['Main Hall', 'Math', 'Science', 'English', 'History'];

io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (!session.userId) return socket.disconnect(true);

    const user = await User.findById(session.userId);
    connectedUsers.set(socket.id, { id: socket.id, userId: user._id.toString(), username: user.username, profilePicture: user.profilePicture });
    io.emit('user list', Array.from(connectedUsers.values()).map(u => ({ userId: u.userId, username: u.username, profilePicture: u.profilePicture })));
    io.emit('channels', channels);
    const groups = await Group.find({ members: user._id });
    socket.emit('groups', groups.map(g => ({ _id: g._id.toString(), name: g.name })));

    socket.on('join channel', (channel) => {
        socket.join(channel);
        socket.emit('channel joined', channel);
    });

    socket.on('join group', (groupId) => {
        socket.join(groupId);
        socket.emit('group joined', groupId);
    });

    socket.on('join dm', (recipientId) => {
        const room = [session.userId, recipientId].sort().join('-');
        socket.join(room);
        socket.emit('dm joined', recipientId);
    });

    socket.on('chat message', async (msg) => {
        const message = new Message({
            type: 'text',
            content: msg.text,
            username: msg.username,
            senderId: mongoose.Types.ObjectId(msg.senderId),
            channel: msg.channel,
            profilePicture: msg.profilePicture,
            replyTo: msg.replyTo ? mongoose.Types.ObjectId(msg.replyTo) : null,
        });
        await message.save();
        io.to(msg.channel).emit('chat message', message);
    });

    socket.on('group message', async (msg) => {
        const message = new Message({
            type: 'text',
            content: msg.text,
            username: msg.username,
            senderId: mongoose.Types.ObjectId(msg.senderId),
            groupId: mongoose.Types.ObjectId(msg.groupId),
            profilePicture: msg.profilePicture,
            replyTo: msg.replyTo ? mongoose.Types.ObjectId(msg.replyTo) : null,
        });
        await message.save();
        io.to(msg.groupId.toString()).emit('group message', message);
    });

    socket.on('dm message', async (msg) => {
        const message = new Message({
            type: 'text',
            content: msg.text,
            username: msg.username,
            senderId: mongoose.Types.ObjectId(msg.senderId),
            recipientId: mongoose.Types.ObjectId(msg.recipientId),
            profilePicture: msg.profilePicture,
            replyTo: msg.replyTo ? mongoose.Types.ObjectId(msg.replyTo) : null,
        });
        await message.save();
        const room = [msg.senderId, msg.recipientId].sort().join('-');
        io.to(room).emit('dm message', message);
    });

    socket.on('image message', async (msg) => {
        const message = new Message({
            type: 'image',
            content: msg.image,
            username: msg.username,
            senderId: mongoose.Types.ObjectId(msg.senderId),
            channel: msg.channel,
            groupId: msg.groupId ? mongoose.Types.ObjectId(msg.groupId) : null,
            recipientId: msg.recipientId ? mongoose.Types.ObjectId(msg.recipientId) : null,
            profilePicture: msg.profilePicture,
            replyTo: msg.replyTo ? mongoose.Types.ObjectId(msg.replyTo) : null,
        });
        await message.save();
        if (msg.recipientId) {
            const room = [msg.senderId, msg.recipientId].sort().join('-');
            io.to(room).emit('image message', message);
        } else if (msg.groupId) io.to(msg.groupId.toString()).emit('image message', message);
        else io.to(msg.channel).emit('image message', message);
    });

    socket.on('audio message', async (msg) => {
        const message = new Message({
            type: 'audio',
            content: msg.audio,
            username: msg.username,
            senderId: mongoose.Types.ObjectId(msg.senderId),
            channel: msg.channel,
            groupId: msg.groupId ? mongoose.Types.ObjectId(msg.groupId) : null,
            recipientId: msg.recipientId ? mongoose.Types.ObjectId(msg.recipientId) : null,
            profilePicture: msg.profilePicture,
            replyTo: msg.replyTo ? mongoose.Types.ObjectId(msg.replyTo) : null,
        });
        await message.save();
        if (msg.recipientId) {
            const room = [msg.senderId, msg.recipientId].sort().join('-');
            io.to(room).emit('audio message', message);
        } else if (msg.groupId) io.to(msg.groupId.toString()).emit('audio message', message);
        else io.to(msg.channel).emit('audio message', message);
    });

    socket.on('typing', (data) => {
        if (data.channel) socket.to(data.channel).emit('typing', data);
        else if (data.groupId) socket.to(data.groupId).emit('typing', data);
        else if (data.recipientId) {
            const room = [data.senderId, data.recipientId].sort().join('-');
            socket.to(room).emit('typing', data);
        }
    });

    socket.on('stop typing', (data) => {
        if (data.channel) socket.to(data.channel).emit('stop typing', data);
        else if (data.groupId) socket.to(data.groupId).emit('stop typing', data);
        else if (data.recipientId) {
            const room = [data.senderId, data.recipientId].sort().join('-');
            socket.to(room).emit('stop typing', data);
        }
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
        if (recipient) io.to(recipient.id).emit('ice-candidate', { candidate: data.candidate, to: data.to });
    });

    socket.on('call-rejected', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('call-rejected');
    });

    socket.on('hang-up', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('hang-up');
    });

    socket.on('group-call', (data) => {
        const groupId = data.groupId;
        const members = data.members.filter(id => id !== session.userId);
        members.forEach(memberId => {
            const recipient = Array.from(connectedUsers.values()).find(u => u.userId === memberId);
            if (recipient) io.to(recipient.id).emit('group-call-made', { offer: data.offer, from: session.userId, groupId });
        });
    });

    socket.on('group-answer', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('group-answer-made', { answer: data.answer, from: data.from, groupId: data.groupId });
    });

    socket.on('group-ice-candidate', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('group-ice-candidate', { candidate: data.candidate, to: data.to, groupId: data.groupId });
    });

    socket.on('group-call-rejected', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('group-call-rejected', { groupId: data.groupId });
    });

    socket.on('group-hang-up', (data) => {
        const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
        if (recipient) io.to(recipient.id).emit('group-hang-up', { groupId: data.groupId });
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.id);
        io.emit('user list', Array.from(connectedUsers.values()).map(u => ({ userId: u.userId, username: u.username, profilePicture: u.profilePicture })));
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
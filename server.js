// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const next = require('next');

mongoose.set('strictQuery', true); // Suppress Mongoose strictQuery warning

const app = express();
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://your-render-app.onrender.com', // Replace with your Render URL
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

nextApp.prepare().then(() => {
  mongoose.connect('mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/uchat?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB error:', err));

  const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: '' },
    avatar: { type: String, default: 'https://via.placeholder.com/50' },
    language: { type: String, default: 'en' },
  });
  const User = mongoose.model('User', userSchema);

  const messageSchema = new mongoose.Schema({
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    type: { type: String, enum: ['text', 'image', 'audio'], required: true },
    channel: { type: String },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    timestamp: { type: Date, default: Date.now },
  });
  const Message = mongoose.model('Message', messageSchema);

  const groupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isPrivate: { type: Boolean, default: false },
  });
  const Group = mongoose.model('Group', groupSchema);

  const blockedContentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
  });
  const BlockedContent = mongoose.model('BlockedContent', blockedContentSchema);

  const store = new MongoDBStore({
    uri: 'mongodb+srv://chatadmin:ChatPass123@cluster0.nlz2e.mongodb.net/uchat?retryWrites=true&w=majority&appName=Cluster0',
    collection: 'sessions',
  });
  store.on('error', err => console.error('Session error:', err));

  const sessionMiddleware = session({
    secret: 'UchatSecret2025',
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, secure: false },
  });
  app.use(sessionMiddleware);
  app.use(cors({ origin: 'https://your-render-app.onrender.com', credentials: true })); // Replace with your Render URL
  app.use(express.json());
  app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  });
  const upload = multer({ storage });

  app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (await User.findOne({ username })) return res.status(400).json({ error: 'Username taken' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();
    req.session.userId = user._id.toString();
    res.json({ success: true });
  });

  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.userId = user._id.toString();
    res.json({ success: true });
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get('/user', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const user = await User.findById(req.session.userId);
    res.json({ username: user.username, bio: user.bio, avatar: user.avatar, language: user.language, userId: user._id.toString() });
  });

  app.post('/update-profile', async (req, res) => {
    const { bio, avatar, language } = req.body;
    const user = await User.findById(req.session.userId);
    if (bio) user.bio = bio;
    if (avatar) user.avatar = avatar;
    if (language) user.language = language;
    await user.save();
    res.json({ success: true });
  });

  app.post('/create-group', async (req, res) => {
    const { name, isPrivate, memberIds } = req.body;
    const group = new Group({ name, isPrivate, members: [req.session.userId, ...memberIds.map(id => mongoose.Types.ObjectId(id))] });
    await group.save();
    res.json({ success: true, groupId: group._id.toString() });
  });

  app.post('/upload', upload.single('file'), (req, res) => {
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  const swearWords = ['badword1', 'badword2', 'slur1']; // Expand this list as needed
  const filterMessage = (content) => {
    const lowerContent = content.toLowerCase();
    const isBlocked = swearWords.some(word => lowerContent.includes(word));
    if (isBlocked) {
      const blocked = new BlockedContent({ content, senderId: req.session.userId });
      blocked.save();
      return null;
    }
    return content;
  };

  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  const connectedUsers = new Map();
  const channels = ['General', 'Random', 'Announcements'];

  io.on('connection', async (socket) => {
    const session = socket.request.session;
    if (!session.userId) return socket.disconnect(true);

    const user = await User.findById(session.userId);
    connectedUsers.set(socket.id, { id: socket.id, userId: user._id.toString(), username: user.username, avatar: user.avatar });
    io.emit('user list', Array.from(connectedUsers.values()).map(u => ({ userId: u.userId, username: u.username, avatar: u.avatar })));
    io.emit('channels', channels);
    const groups = await Group.find({ members: user._id });
    socket.emit('groups', groups.map(g => ({ _id: g._id.toString(), name: g.name, isPrivate: g.isPrivate })));

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
      const filteredContent = filterMessage(msg.content);
      if (!filteredContent) return;
      const message = new Message({ ...msg, content: filteredContent });
      await message.save();
      io.to(msg.channel).emit('chat message', message.toObject());
    });

    socket.on('dm message', async (msg) => {
      const filteredContent = filterMessage(msg.content);
      if (!filteredContent) return;
      const message = new Message({ ...msg, content: filteredContent });
      await message.save();
      const room = [msg.senderId, msg.recipientId].sort().join('-');
      io.to(room).emit('dm message', message.toObject());
    });

    socket.on('group message', async (msg) => {
      const filteredContent = filterMessage(msg.content);
      if (!filteredContent) return;
      const message = new Message({ ...msg, content: filteredContent });
      await message.save();
      io.to(msg.groupId).emit('group message', message.toObject());
    });

    socket.on('image message', async (msg) => {
      const filteredContent = filterMessage(msg.content || 'Image');
      if (!filteredContent) return;
      const message = new Message({ ...msg, content: filteredContent });
      await message.save();
      if (msg.recipientId) {
        const room = [msg.senderId, msg.recipientId].sort().join('-');
        io.to(room).emit('image message', message.toObject());
      } else if (msg.groupId) {
        io.to(msg.groupId).emit('image message', message.toObject());
      } else {
        io.to(msg.channel).emit('image message', message.toObject());
      }
    });

    socket.on('audio message', async (msg) => {
      const filteredContent = filterMessage(msg.content || 'Audio');
      if (!filteredContent) return;
      const message = new Message({ ...msg, content: filteredContent });
      await message.save();
      if (msg.recipientId) {
        const room = [msg.senderId, msg.recipientId].sort().join('-');
        io.to(room).emit('audio message', message.toObject());
      } else if (msg.groupId) {
        io.to(msg.groupId).emit('audio message', message.toObject());
      } else {
        io.to(msg.channel).emit('image message', message.toObject());
      }
    });

    socket.on('call-user', (data) => {
      const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
      if (recipient) io.to(recipient.id).emit('call-made', data);
    });

    socket.on('answer-made', (data) => {
      const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
      if (recipient) io.to(recipient.id).emit('answer-made', data);
    });

    socket.on('ice-candidate', (data) => {
      const recipient = Array.from(connectedUsers.values()).find(u => u.userId === data.to);
      if (recipient) io.to(recipient.id).emit('ice-candidate', data);
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.id);
      io.emit('user list', Array.from(connectedUsers.values()).map(u => ({ userId: u.userId, username: u.username, avatar: u.avatar })));
    });
  });

  app.all('*', (req, res) => handle(req, res));

  const PORT = process.env.PORT || 10000;
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
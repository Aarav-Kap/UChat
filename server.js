const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// In-memory storage
const messages = { General: [], DMs: {} }; // Channel/DM messages
const users = new Map(); // username -> { color }

app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
    console.log('Serving index page');
    res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('joinChannel', ({ channel, username, color }) => {
        socket.join(channel);
        users.set(username, { color });
        const channelMessages = channel.startsWith('DM_') ? (messages.DMs[channel] || []) : (messages[channel] || []);
        socket.emit('loadMessages', channelMessages);
        io.to(channel).emit('userJoin', { username, color });
        console.log(`${username} joined ${channel} with color ${color}`);
    });

    socket.on('sendMessage', ({ channel, content, sender, color, type = 'text', data }) => {
        const filteredContent = content.replace(/[badword|fword|curse]/gi, '[Filtered]');
        if (filteredContent === content) {
            const message = { sender, content: filteredContent, timestamp: new Date(), color, type, data };
            if (channel.startsWith('DM_')) {
                if (!messages.DMs[channel]) messages.DMs[channel] = [];
                messages.DMs[channel].push(message);
            } else {
                if (!messages[channel]) messages[channel] = [];
                messages[channel].push(message);
            }
            io.to(channel).emit('newMessage', message);
        }
    });

    socket.on('disconnect', (username) => {
        console.log(`${username} disconnected`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 20 * 1024 * 1024 // Matches 10MB limit + overhead
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let userCount = 0;

io.on('connection', (socket) => {
    userCount++;
    console.log('User connected, userCount:', userCount); // Debug
    io.emit('user count', userCount);

    socket.on('chat message', (msg) => {
        if (!msg || !msg.username || !msg.text && !msg.image) {
            console.error('Invalid message received:', msg);
            return;
        }
        console.log('Broadcasting chat message from:', msg.username); // Debug
        io.emit('chat message', msg);
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
        if (data && data.oldUsername && data.newUsername) {
            console.log('Broadcasting name change:', data); // Debug
            io.emit('name change', data);
        } else {
            console.error('Invalid name change data:', data);
        }
    });

    socket.on('disconnect', () => {
        userCount--;
        console.log('User disconnected, userCount:', userCount); // Debug
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
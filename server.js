const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 50 * 1024 * 1024 // Keep 50MB buffer for now, but 10MB limit will reduce strain
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let userCount = 0;

io.on('connection', (socket) => {
    userCount++;
    io.emit('user count', userCount);
    console.log('A user connected');

    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('typing', (username) => {
        socket.broadcast.emit('typing', username);
    });

    socket.on('stop typing', () => {
        socket.broadcast.emit('stop typing');
    });

    socket.on('name change', (data) => {
        io.emit('name change', data);
    });

    socket.on('disconnect', () => {
        userCount--;
        io.emit('user count', userCount);
        console.log('A user disconnected');
    });
});

http.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Server running');
});
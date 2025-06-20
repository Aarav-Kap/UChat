const socket = io();
let username = '';
let currentChannel = 'General';
let currentDM = null;
let mediaRecorder = null;
let audioChunks = [];

document.getElementById('currentChannel').textContent = '#General';

// Set username and join
function setUsername() {
    username = prompt('Enter your username:');
    if (username) {
        const color = document.getElementById('colorSelect').value;
        document.getElementById('username').textContent = username;
        socket.emit('joinChannel', { channel: currentChannel, username, color });
    } else {
        setUsername(); // Retry if empty
    }
}

setUsername();

// Update color
document.getElementById('colorSelect').addEventListener('change', (e) => {
    const color = e.target.value;
    users.set(username, { color });
    socket.emit('joinChannel', { channel: currentChannel, username, color });
});

// Load messages
socket.on('loadMessages', (messages) => {
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    messages.forEach(msg => displayMessage(msg));
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

// Display message
function displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = `message ${msg.sender === username ? 'own' : ''}`;
    div.style.backgroundColor = msg.color;
    let contentHtml = `<div class="message-header">
        <span>${msg.sender}</span>
        <span class="message-timestamp">${msg.timestamp.toLocaleTimeString()}</span>
    </div>`;
    if (msg.type === 'text') {
        contentHtml += `<p class="content">${msg.content}</p>`;
    } else if (msg.type === 'audio') {
        contentHtml += `<audio controls><source src="${msg.data}" type="audio/wav">Unsupported</audio>`;
    }
    div.innerHTML = contentHtml;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    const color = document.getElementById('colorSelect').value;
    if (content || audioChunks.length) {
        const channel = currentDM || currentChannel;
        if (audioChunks.length) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const reader = new FileReader();
            reader.onload = (e) => socket.emit('sendMessage', { channel, content: '', sender: username, color, type: 'audio', data: e.target.result });
            reader.readAsDataURL(audioBlob);
            audioChunks = [];
        } else {
            socket.emit('sendMessage', { channel, content, sender: username, color, type: 'text' });
        }
        input.value = '';
    }
}

// Voice notes
document.getElementById('voiceBtn').addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                sendMessage();
            };
            mediaRecorder.start();
            document.getElementById('voiceBtn').classList.add('bg-red-600', 'hover:bg-red-700');
            document.getElementById('voiceBtn').classList.remove('bg-green-600');
        }).catch(err => console.error('Mic error:', err));
    } else if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        document.getElementById('voiceBtn').classList.remove('bg-red-600', 'hover:bg-red-700');
        document.getElementById('voiceBtn').classList.add('bg-green-600');
    }
});

// Channel switching
document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentChannel = btn.dataset.channel;
        currentDM = null;
        document.getElementById('currentChannel').textContent = `#${currentChannel}`;
        const color = document.getElementById('colorSelect').value;
        socket.emit('joinChannel', { channel: currentChannel, username, color });
    });
});

// Load DMs (based on connected users)
function loadDMs() {
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';
    const connectedUsers = Array.from(users.keys()).filter(u => u !== username);
    connectedUsers.forEach(u => {
        const li = document.createElement('li');
        li.innerHTML = `<button class="channel-btn w-full text-left p-2 bg-gray-700 rounded hover:bg-gray-600"><i class="fas fa-user mr-2"></i>${u}</button>`;
        li.querySelector('button').addEventListener('click', () => {
            currentDM = u;
            currentChannel = null;
            const dmChannel = [username, u].sort().join('_');
            document.getElementById('currentChannel').textContent = `@${u}`;
            const color = document.getElementById('colorSelect').value;
            socket.emit('joinChannel', { channel: `DM_${dmChannel}`, username, color });
        });
        dmList.appendChild(li);
    });
}

// Live updates
socket.on('newMessage', (msg) => {
    if ((currentDM && msg.channel === `DM_${[username, currentDM].sort().join('_')}`) ||
        (!currentDM && msg.channel === currentChannel)) {
        displayMessage(msg);
    }
});

socket.on('userJoin', ({ username: newUser, color }) => {
    loadDMs();
});

// Leave chat
document.getElementById('leaveBtn').addEventListener('click', () => {
    username = '';
    document.getElementById('username').textContent = '';
    socket.emit('disconnect', username);
    setUsername();
});
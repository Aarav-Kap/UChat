const socket = io();
let user = { username: document.querySelector('script').textContent.match(/username: "([^"]+)"/)?.[1] || 'Guest' };
let currentChannel = 'General';
let currentDM = null;
let mediaRecorder = null;
let audioChunks = [];

document.getElementById('username').textContent = user.username;
document.getElementById('currentChannel').textContent = '#General';

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
    div.className = `message ${msg.sender === user.username ? 'own' : ''}`;
    let contentHtml = `<div class="message-header">
        <span>${msg.sender}</span>
        <span class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>
    </div>`;
    if (msg.type === 'text') {
        contentHtml += `<p>${msg.content}</p>`;
        if (msg.replyTo) contentHtml += `<p class="text-gray-400 text-sm">Replying to: ${msg.replyTo}</p>`;
    } else if (msg.type === 'image') {
        contentHtml += `<img src="${msg.data}" alt="Image" class="max-w-full mt-2">`;
    } else if (msg.type === 'audio') {
        contentHtml += `<audio controls class="mt-2"><source src="${msg.data}" type="audio/wav">Unsupported</audio>`;
    }
    div.innerHTML = contentHtml + '<button class="reply-btn">Reply</button>';
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
    const imageInput = document.getElementById('imageInput');
    if (content || imageInput.files[0] || audioChunks.length) {
        const channel = currentDM || currentChannel;
        const replyTo = input.value.match(/^@(\w+)\s/)?.[1];
        if (imageInput.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => socket.emit('sendMessage', { channel, content: '', sender: user.username, type: 'image', data: e.target.result, replyTo });
            reader.readAsDataURL(imageInput.files[0]);
            imageInput.value = '';
        } else if (audioChunks.length) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            const reader = new FileReader();
            reader.onload = (e) => socket.emit('sendMessage', { channel, content: '', sender: user.username, type: 'audio', data: e.target.result, replyTo });
            reader.readAsDataURL(audioBlob);
            audioChunks = [];
        } else {
            socket.emit('sendMessage', { channel, content, sender: user.username, type: 'text', replyTo });
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
        }).catch(err => console.error('Mic access denied:', err));
    } else if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        document.getElementById('voiceBtn').classList.remove('bg-red-600', 'hover:bg-red-700');
        document.getElementById('voiceBtn').classList.add('bg-green-600');
    }
});

// Image upload
document.getElementById('imageInput').addEventListener('change', () => sendMessage());

// Channel switching
document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentChannel = btn.dataset.channel;
        currentDM = null;
        document.getElementById('currentChannel').textContent = `#${currentChannel}`;
        socket.emit('joinChannel', { channel: currentChannel, username: user.username });
    });
});

// Load DMs
async function loadDMs() {
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';
    try {
        const response = await fetch('/users');
        const users = await response.json();
        if (Array.isArray(users)) {
            users.forEach(u => {
                if (u !== user.username) {
                    const li = document.createElement('li');
                    li.innerHTML = `<button class="channel-btn w-full text-left p-2 bg-gray-700 rounded hover:bg-gray-600"><i class="fas fa-user mr-2"></i>${u}</button>`;
                    li.querySelector('button').addEventListener('click', () => {
                        currentDM = u;
                        currentChannel = null;
                        const dmChannel = [user.username, u].sort().join('_');
                        document.getElementById('currentChannel').textContent = `@${u}`;
                        socket.emit('joinChannel', { channel: `DM_${dmChannel}`, username: user.username });
                    });
                    dmList.appendChild(li);
                }
            });
        } else {
            console.error('Invalid users response:', users);
        }
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

// Live updates
socket.on('newMessage', (msg) => {
    if ((currentDM && msg.channel === `DM_${[user.username, currentDM].sort().join('_')}`) ||
        (!currentDM && msg.channel === currentChannel)) {
        displayMessage(msg);
    }
});

// Reply handling
document.getElementById('messages').addEventListener('click', (e) => {
    if (e.target.classList.contains('reply-btn')) {
        const msg = e.target.closest('.message');
        const sender = msg.querySelector('.message-header span').textContent;
        const content = msg.querySelector('p').textContent;
        document.getElementById('messageInput').value = `@${sender} ${content}\n`;
    }
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
});

// Initialize
socket.emit('joinChannel', { channel: currentChannel, username: user.username });
loadDMs();
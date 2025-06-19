const socket = io();
let user = { username: document.querySelector('script').textContent.match(/username: "([^"]+)"/)?.[1] || 'undefined' };
let currentChannel = 'General';
let currentDM = null;

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
    div.innerHTML = `
        <div class="message-header">
            <span>${msg.sender}</span>
            <span class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <p>${msg.content}</p>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content) return;
    socket.emit('sendMessage', {
        channel: currentDM || currentChannel,
        content,
        sender: user.username
    });
    input.value = '';
}

// Channel switching
document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentChannel = btn.dataset.channel;
        currentDM = null;
        document.getElementById('currentChannel').textContent = `#${currentChannel}`;
        socket.emit('joinChannel', { channel: currentChannel, username: user.username });
    });
});

// Load DMs and handle live updates
async function loadDMs() {
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';
    const response = await fetch('/users');
    const users = await response.json();
    users.forEach(u => {
        if (u !== user.username) {
            const li = document.createElement('li');
            li.innerHTML = `<button class="w-full text-left p-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition duration-200"><i class="fas fa-user mr-2"></i>${u}</button>`;
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
}

// Live message updates
socket.on('newMessage', (msg) => {
    if ((currentDM && msg.channel === `DM_${[user.username, currentDM].sort().join('_')}`) || 
        (!currentDM && msg.channel === currentChannel)) {
        displayMessage(msg);
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
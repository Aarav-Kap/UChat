const socket = io();
const user = JSON.parse(document.querySelector('script').getAttribute('data-user') || '{}');
let currentChannel = 'Main';
let currentDM = null;
let peerConnection;
let mediaRecorder;
let audioStream;

// TURN servers (using openrelay for simplicity; consider Xirsys for production)
const turnServers = [
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
];

// Initialize WebRTC
function createPeerConnection() {
    peerConnection = new RTCPeerConnection({ iceServers: turnServers });
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtcSignal', { to: currentDM, signal: event.candidate, from: user.username });
        }
    };
    peerConnection.ontrack = (event) => {
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        document.body.appendChild(audio);
    };
}

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
    div.className = `message ${msg.sender === user.username ? 'ml-auto bg-blue-600' : 'bg-gray-700'}`;
    div.style.borderColor = msg.sender === user.username ? user.color : '#4B5563';
    let content = '';
    if (msg.replyTo) {
        content += `<div class="reply-preview">${msg.replyTo.sender}: ${msg.replyTo.content}</div>`;
    }
    if (msg.type === 'text') {
        content += `<p>${msg.content}</p>`;
    } else if (msg.type === 'image') {
        content += `<img src="${msg.content}" alt="Shared image">`;
    } else if (msg.type === 'voice') {
        content += `<audio controls src="${msg.content}"></audio>`;
    }
    content += `<small>${new Date(msg.timestamp).toLocaleTimeString()}</small>`;
    div.innerHTML = `<div class="flex items-center"><img src="${msg.senderProfilePicture || 'https://via.placeholder.com/40'}" class="w-8 h-8 rounded-full mr-2"><span>${msg.sender}</span></div>${content}`;
    div.dataset.id = msg._id;
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showReplyPrompt(msg._id);
    });
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    if (!user.muteNotifications) {
        new Audio('/notification.mp3').play();
    }
}

// Send message
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content) return;
    socket.emit('sendMessage', {
        channel: currentDM || currentChannel,
        content,
        type: 'text',
        replyTo: document.getElementById('replyPreview').dataset.replyTo || null,
        sender: user.username
    });
    input.value = '';
    document.getElementById('replyPreview').classList.add('hidden');
}

// Reply to message
function showReplyPrompt(messageId) {
    const message = document.querySelector(`.message[data-id="${messageId}"]`);
    const replyPreview = document.getElementById('replyPreview');
    replyPreview.innerHTML = `Replying to ${message.querySelector('span').textContent}: ${message.querySelector('p').textContent}`;
    replyPreview.dataset.replyTo = messageId;
    replyPreview.classList.remove('hidden');
}

// Typing indicator
document.getElementById('messageInput').addEventListener('input', () => {
    socket.emit('typing', { channel: currentDM || currentChannel, username: user.username });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stopTyping', { channel: currentDM || currentChannel }), 2000);
});
let typingTimeout;
socket.on('typing', ({ username }) => {
    document.getElementById('typingIndicator').textContent = `${username} is typing...`;
});
socket.on('stopTyping', () => {
    document.getElementById('typingIndicator').textContent = '';
});

// Channel switching
document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentChannel = btn.dataset.channel;
        currentDM = null;
        document.getElementById('currentChannel').textContent = currentChannel;
        document.getElementById('callBtn').disabled = true;
        socket.emit('joinChannel', { channel: currentChannel, username: user.username });
    });
});

// DM handling
async function loadDMs() {
    const users = await (await fetch('/users')).json();
    const dmList = document.getElementById('dmList');
    dmList.innerHTML = '';
    users.forEach(u => {
        if (u.username !== user.username) {
            const li = document.createElement('li');
            li.innerHTML = `<button class="w-full text-left p-2 bg-gray-700 rounded hover:bg-gray-600">${u.username}</button>`;
            li.querySelector('button').addEventListener('click', () => {
                currentDM = u.username;
                currentChannel = null;
                document.getElementById('currentChannel').textContent = `DM: ${u.username}`;
                document.getElementById('callBtn').disabled = false;
                socket.emit('joinChannel', { channel: `DM_${user.username}_${u.username}`, username: user.username });
            });
            dmList.appendChild(li);
        }
    });
}

// Emoji picker
const emojiPicker = document.querySelector('emoji-picker');
document.getElementById('emojiBtn').addEventListener('click', () => {
    emojiPicker.classList.toggle('hidden');
});
emojiPicker.addEventListener('emoji-click', (e) => {
    document.getElementById('messageInput').value += e.detail.unicode;
    emojiPicker.classList.add('hidden');
});

// Image upload
document.getElementById('imageBtn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            socket.emit('sendMessage', {
                channel: currentDM || currentChannel,
                content: reader.result,
                type: 'image',
                sender: user.username
            });
        };
        reader.readAsDataURL(file);
    };
    input.click();
});

// Voice note
document.getElementById('voiceBtn').addEventListener('click', async () => {
    if (!mediaRecorder) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        const chunks = [];
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = () => {
                socket.emit('sendMessage', {
                    channel: currentDM || currentChannel,
                    content: reader.result,
                    type: 'voice',
                    sender: user.username
                });
            };
            reader.readAsDataURL(blob);
        };
        mediaRecorder.start();
        document.getElementById('voiceBtn').classList.add('bg-red-600');
    } else {
        mediaRecorder.stop();
        mediaRecorder = null;
        document.getElementById('voiceBtn').classList.remove('bg-red-600');
    }
});

// Translation
async function translateMessage(text, targetLang) {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`);
    const data = await response.json();
    return data.responseData.translatedText;
}

// WebRTC calls
document.getElementById('callBtn').addEventListener('click', async () => {
    createPeerConnection();
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioStream.getTracks().forEach(track => peerConnection.addTrack(track, audioStream));
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('callUser', { to: currentDM, from: user.username });
    socket.emit('webrtcSignal', { to: currentDM, signal: offer, from: user.username });
});

socket.on('incomingCall', ({ from }) => {
    document.getElementById('callModal').classList.remove('hidden');
    document.getElementById('caller').textContent = `${from} is calling...`;
});

document.getElementById('acceptCallBtn').addEventListener('click', async () => {
    document.getElementById('callModal').classList.add('hidden');
    createPeerConnection();
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioStream.getTracks().forEach(track => peerConnection.addTrack(track, audioStream));
    socket.emit('acceptCall', { to: currentDM });
});

document.getElementById('declineCallBtn').addEventListener('click', () => {
    document.getElementById('callModal').classList.add('hidden');
    socket.emit('declineCall', { to: currentDM });
});

socket.on('webrtcSignal', async ({ signal, from }) => {
    if (!peerConnection) createPeerConnection();
    if (signal.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtcSignal', { to: from, signal: answer, from: user.username });
    } else if (signal.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    } else {
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal));
    }
});

// Profile management
document.getElementById('profileBtn').addEventListener('click', () => {
    document.getElementById('profileModal').classList.remove('hidden');
    document.getElementById('profilePicture').value = user.profilePicture;
    document.getElementById('bio').value = user.bio;
    document.getElementById('color').value = user.color;
    document.getElementById('language').value = user.language;
    document.getElementById('muteNotifications').checked = user.muteNotifications;
});

document.getElementById('closeProfileBtn').addEventListener('click', () => {
    document.getElementById('profileModal').classList.add('hidden');
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const profilePicture = document.getElementById('profilePicture').value;
    const bio = document.getElementById('bio').value;
    const color = document.getElementById('color').value;
    const language = document.getElementById('language').value;
    const muteNotifications = document.getElementById('muteNotifications').checked;
    await fetch('/updateProfile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePicture, bio, color, language, muteNotifications })
    });
    document.getElementById('profileModal').classList.add('hidden');
    location.reload();
});

// Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
});

// Initialize
socket.emit('joinChannel', { channel: currentChannel, username: user.username });
loadDMs();
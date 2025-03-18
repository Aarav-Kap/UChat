const socket = io();
let username, userColor, userLanguage, userId, activeTab = 'main', dmTabs = {};
let isMuted = false;
let localStream, remoteStream, peerConnection;
let replyingTo = null;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/user', { credentials: 'include' });
    if (!response.ok) return window.location.href = '/';
    const data = await response.json();
    username = data.username;
    userColor = data.color;
    userLanguage = data.language;
    userId = data.userId;
    document.getElementById('current-username').textContent = `Welcome, ${username}`;
    document.getElementById('language-select').value = userLanguage;
});

socket.on('user list', users => {
    const ul = document.getElementById('user-list');
    ul.innerHTML = users
        .filter(u => u.userId !== userId)
        .map(u => `<li style="color: ${u.color}"><span onclick="startDM('${u.userId}', '${u.username}')">${u.username}</span> <button onclick="callUser('${u.userId}')">Call</button></li>`)
        .join('');
    document.getElementById('user-count').textContent = users.length;
});

socket.on('chat message', msg => {
    handleMessage(msg, document.getElementById('chat-area').querySelector('.chat-content'), false);
    playNotification();
});

socket.on('dm message', msg => {
    const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
    if (!dmTabs[partnerId]) {
        const partnerUsername = msg.username === username ? getRecipientUsername(partnerId) : msg.username;
        createDMTab(partnerId, partnerUsername);
    }
    handleMessage(msg, dmTabs[partnerId].chat, true);
    playNotification();
});

socket.on('image message', msg => {
    const partnerId = msg.recipientId ? (msg.senderId === userId ? msg.recipientId : msg.senderId) : null;
    const chat = partnerId ? dmTabs[partnerId]?.chat : document.getElementById('chat-area').querySelector('.chat-content');
    if (chat) {
        handleImageMessage(msg, chat, !!partnerId);
        playNotification();
    }
});

socket.on('typing', data => {
    if (data.tab === activeTab) document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
});

socket.on('stop typing', data => {
    if (data.tab === activeTab) document.getElementById('typing-indicator').textContent = '';
});

socket.on('color change', data => {
    document.querySelectorAll('.message').forEach(msg => {
        if (msg.dataset.senderId === data.id) msg.style.setProperty('--username-color', data.color);
    });
});

socket.on('call-made', async data => {
    document.getElementById('call-status').textContent = `${data.fromUsername} is calling you...`;
    document.getElementById('call-modal').style.display = 'block';

    document.getElementById('accept-call').onclick = async () => {
        document.getElementById('call-modal').style.display = 'none';
        await setupPeerConnection(data.from);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('make-answer', { answer, to: data.from });
        document.getElementById('call-interface').style.display = 'block';
        document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
    };

    document.getElementById('decline-call').onclick = () => {
        document.getElementById('call-modal').style.display = 'none';
        socket.emit('call-rejected', { to: data.from });
    };
});

socket.on('answer-made', async data => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
});

socket.on('ice-candidate', async data => {
    if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('call-rejected', () => {
    alert('Call was declined.');
    endCall();
});

socket.on('hang-up', () => {
    endCall();
});

async function callUser(recipientId) {
    await setupPeerConnection(recipientId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-user', { offer, to: recipientId });
}

async function setupPeerConnection(recipientId) {
    peerConnection = new RTCPeerConnection(configuration);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    remoteStream = new MediaStream();
    document.getElementById('remote-audio').srcObject = remoteStream;
    peerConnection.ontrack = event => event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    peerConnection.onicecandidate = event => {
        if (event.candidate) socket.emit('ice-candidate', { candidate: event.candidate, to: recipientId });
    };
}

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
    peerConnection = null;
    localStream = null;
    remoteStream = null;
    document.getElementById('call-interface').style.display = 'none';
    document.getElementById('remote-audio').srcObject = null;
}

function hangUp() {
    socket.emit('hang-up', { to: Object.keys(dmTabs)[0] || '' });
    endCall();
}

function handleMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.senderId = msg.senderId;
    div.dataset.messageId = msg.messageId || Date.now();
    div.style.setProperty('--username-color', msg.color);
    
    let content = `<span class="username">${msg.username === username ? 'You' : msg.username}</span>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg ? repliedMsg.querySelector('.message-content span:not(.username)')?.textContent || repliedMsg.querySelector('img')?.alt : 'Message not found';
        const repliedUsername = repliedMsg ? repliedMsg.querySelector('.username').textContent : 'Unknown';
        content += `<div class="reply-ref">Replying to ${repliedUsername}: ${repliedText}</div>`;
    }
    content += '<div class="message-content">';
    
    if (msg.language !== userLanguage) {
        fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(msg.text)}&langpair=${msg.language}|${userLanguage}`)
            .then(res => res.json())
            .then(data => {
                div.querySelector('.message-content').innerHTML += `<span>${data.responseData.translatedText}</span><div class="meta">(${msg.language}: ${msg.text})</div>`;
            });
    } else {
        content += `<span>${msg.text}</span>`;
    }
    content += `<button class="reply-btn" onclick="startReply('${div.dataset.messageId}')">Reply</button></div>`;
    
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function handleImageMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.senderId = msg.senderId;
    div.dataset.messageId = msg.messageId || Date.now();
    div.style.setProperty('--username-color', msg.color);
    
    let content = `<span class="username">${msg.username === username ? 'You' : msg.username}</span>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg ? repliedMsg.querySelector('.message-content span:not(.username)')?.textContent || repliedMsg.querySelector('img')?.alt : 'Message not found';
        const repliedUsername = repliedMsg ? repliedMsg.querySelector('.username').textContent : 'Unknown';
        content += `<div class="reply-ref">Replying to ${repliedUsername}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><img src="${msg.image}" alt="Shared image" class="chat-image"><button class="reply-btn" onclick="startReply('${div.dataset.messageId}')">Reply</button></div>`;
    
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function startReply(messageId) {
    replyingTo = messageId;
    const repliedMsg = document.querySelector(`[data-message-id="${messageId}"]`);
    const repliedUsername = repliedMsg.querySelector('.username').textContent;
    const repliedText = repliedMsg.querySelector('.message-content span')?.textContent || repliedMsg.querySelector('img')?.alt || '';
    document.getElementById('reply-preview').textContent = `Replying to ${repliedUsername}: ${repliedText}`;
    document.getElementById('reply-container').style.display = 'block';
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-container').style.display = 'none';
}

function startDM(recipientId, recipientUsername) {
    if (!dmTabs[recipientId]) createDMTab(recipientId, recipientUsername);
    switchTab(`dm-${recipientId}`);
}

function createDMTab(recipientId, recipientUsername) {
    const tabs = document.getElementById('tabs');
    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab-button';
    tabBtn.setAttribute('data-tab', `dm-${recipientId}`);
    tabBtn.textContent = `DM: ${recipientUsername}`;
    tabBtn.onclick = () => switchTab(`dm-${recipientId}`);
    tabs.appendChild(tabBtn);

    const dmTab = document.createElement('div');
    dmTab.id = `dm-${recipientId}`;
    dmTab.className = 'chat-area';
    dmTab.innerHTML = `<div class="chat-content"></div>`;
    document.getElementById('dm-tabs').appendChild(dmTab);

    dmTabs[recipientId] = { chat: dmTab.querySelector('.chat-content'), button: tabBtn };
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.chat-area').forEach(area => area.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(tabId === 'main' ? 'chat-area' : tabId).classList.add('active');
    activeTab = tabId;
    const input = document.getElementById('message-input');
    input.dataset.recipient = tabId.startsWith('dm-') ? tabId.replace('dm-', '') : '';
    input.placeholder = tabId === 'main' ? 'Type a message...' : `DM to ${getRecipientUsername(input.dataset.recipient)}...`;
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const msg = { 
        username, 
        text, 
        color: userColor, 
        language: userLanguage, 
        senderId: userId, 
        messageId: Date.now().toString()
    };
    if (replyingTo) {
        msg.replyTo = replyingTo;
        replyingTo = null;
        document.getElementById('reply-container').style.display = 'none';
    }
    if (input.dataset.recipient) {
        msg.recipientId = input.dataset.recipient;
        socket.emit('dm message', msg);
    } else {
        socket.emit('chat message', msg);
    }
    input.value = '';
    socket.emit('stop typing', { tab: activeTab });
}

function sendImage() {
    const fileInput = document.getElementById('image-input');
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const msg = { 
            username, 
            image: reader.result, // Base64 encoded image
            color: userColor, 
            senderId: userId, 
            messageId: Date.now().toString()
        };
        if (replyingTo) {
            msg.replyTo = replyingTo;
            replyingTo = null;
            document.getElementById('reply-container').style.display = 'none';
        }
        if (document.getElementById('message-input').dataset.recipient) {
            msg.recipientId = document.getElementById('message-input').dataset.recipient;
            socket.emit('image message', msg);
        } else {
            socket.emit('image message', msg);
        }
        fileInput.value = ''; // Reset input
    };
    reader.readAsDataURL(file);
}

function handleTyping() {
    socket.emit('typing', { username, tab: activeTab });
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => socket.emit('stop typing', { tab: activeTab }), 1000);
}

function showColorPicker() {
    document.getElementById('color-picker-modal').style.display = 'block';
    document.getElementById('color-picker').value = userColor;
}

function hideColorPicker() {
    document.getElementById('color-picker-modal').style.display = 'none';
}

function changeColor() {
    const newColor = document.getElementById('color-picker').value;
    fetch('/change-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: newColor }),
        credentials: 'include'
    }).then(res => res.json()).then(data => {
        if (data.success) {
            userColor = newColor;
            socket.emit('color change', { id: socket.id, color: newColor });
            hideColorPicker();
        }
    });
}

function updateLanguage() {
    userLanguage = document.getElementById('language-select').value;
    fetch('/update-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: userLanguage }),
        credentials: 'include'
    });
}

function getRecipientUsername(id) {
    const user = Array.from(document.querySelectorAll('#user-list li')).find(li => li.onclick.toString().includes(id));
    return user ? user.textContent.split(' ')[0] : 'Unknown';
}

function toggleMute() {
    isMuted = !isMuted;
    document.querySelector('#sidebar button:nth-child(3)').textContent = `Toggle Mute (${isMuted ? 'Muted' : 'Unmuted'})`;
}

function playNotification() {
    if (!isMuted) document.getElementById('notification-sound').play();
}
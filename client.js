const socket = io('https://uchat-997p.onrender.com', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
});
let username, userColor, userLanguage, userId, profilePicture, activeTab = 'General', dmTabs = {};
let isMuted = false;
let localStream, remoteStream, peerConnection, mediaRecorder, audioChunks = [];
let replyingTo = null;
let currentCallRecipient = null;
let isCalling = false;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
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
    profilePicture = data.profilePicture;
    document.getElementById('current-username').textContent = `Hello, ${username}`;
    document.getElementById('language-select').value = userLanguage;

    const picker = document.querySelector('emoji-picker');
    picker.addEventListener('emoji-click', event => {
        const input = document.getElementById('message-input');
        input.value += event.detail.unicode;
        input.focus();
        toggleEmojiPicker();
    });

    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('open');
    });

    loadMessages(activeTab);
    socket.emit('join channel', activeTab);
});

socket.on('channels', channels => {
    const channelList = document.getElementById('channel-list');
    channelList.innerHTML = channels.map(channel => `
        <li>
            <button class="w-full text-left px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition duration-200 ${channel === activeTab ? 'bg-green-500' : ''}" data-channel="${channel}" onclick="switchChannel('${channel}')">
                # ${channel}
            </button>
        </li>
    `).join('');
    const tabs = document.getElementById('tabs');
    tabs.innerHTML = `<button class="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg mr-2 active-tab" data-tab="General" onclick="switchTab('General')"># General</button>`;
});

socket.on('user list', users => {
    const ul = document.getElementById('user-list');
    ul.innerHTML = users
        .filter(u => u.userId !== userId)
        .map(u => `
            <li class="flex items-center space-x-2">
                <img src="${u.profilePicture || 'https://via.placeholder.com/32'}" alt="${u.username}" class="w-8 h-8 rounded-full">
                <span class="flex-1 cursor-pointer" onclick="startDM('${u.userId}', '${u.username}')">${u.username}</span>
                <button onclick="callUser('${u.userId}')" class="bg-green-500 text-white p-2 rounded-lg hover:bg-green-600"><i class="fas fa-phone"></i></button>
            </li>
        `)
        .join('');
    document.getElementById('user-count').textContent = users.length;
});

socket.on('chat message', msg => {
    if (msg.channel === activeTab) {
        appendMessage(msg, document.getElementById('chat-area').querySelector('.chat-content'), false);
        playNotification();
    }
});

socket.on('dm message', msg => {
    const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
    if (!dmTabs[partnerId]) {
        const partnerUsername = msg.username === username ? getRecipientUsername(partnerId) : msg.username;
        createDMTab(partnerId, partnerUsername);
    }
    if (activeTab === `dm-${partnerId}`) {
        appendMessage(msg, dmTabs[partnerId].chat, true);
        playNotification();
    }
});

socket.on('image message', msg => {
    const partnerId = msg.recipientId ? (msg.senderId === userId ? msg.recipientId : msg.senderId) : null;
    const chat = partnerId ? dmTabs[partnerId]?.chat : document.getElementById('chat-area').querySelector('.chat-content');
    if (chat && (!msg.channel || msg.channel === activeTab)) {
        appendImageMessage(msg, chat, !!partnerId);
        playNotification();
    }
});

socket.on('audio message', msg => {
    const partnerId = msg.recipientId ? (msg.senderId === userId ? msg.recipientId : msg.senderId) : null;
    const chat = partnerId ? dmTabs[partnerId]?.chat : document.getElementById('chat-area').querySelector('.chat-content');
    if (chat && (!msg.channel || msg.channel === activeTab)) {
        appendAudioMessage(msg, chat, !!partnerId);
        playNotification();
    }
});

socket.on('typing', data => {
    if (data.channel === activeTab) document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
});

socket.on('stop typing', data => {
    if (data.channel === activeTab) document.getElementById('typing-indicator').textContent = '';
});

socket.on('call-made', async data => {
    if (isCalling) {
        socket.emit('call-rejected', { to: data.from });
        return;
    }
    currentCallRecipient = data.from;
    document.getElementById('call-status').textContent = `${data.fromUsername} is calling you...`;
    document.getElementById('call-modal').style.display = 'flex';

    document.getElementById('accept-call').onclick = async () => {
        document.getElementById('call-modal').style.display = 'none';
        isCalling = true;
        await setupPeerConnection(data.from);
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('make-answer', { answer, to: data.from });
            document.getElementById('call-interface').style.display = 'block';
            document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
        } catch (e) {
            console.error('Error accepting call:', e);
            endCall();
        }
    };

    document.getElementById('decline-call').onclick = () => {
        document.getElementById('call-modal').style.display = 'none';
        socket.emit('call-rejected', { to: data.from });
    };
});

socket.on('answer-made', async data => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        document.getElementById('call-interface').style.display = 'block';
        document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
    } catch (e) {
        console.error('Error setting answer:', e);
        endCall();
    }
});

socket.on('ice-candidate', async data => {
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Error adding ICE candidate:', e);
        }
    }
});

socket.on('call-rejected', () => {
    alert('Call was declined.');
    endCall();
});

socket.on('hang-up', () => {
    endCall();
});

async function callUser(recipientId) {
    if (isCalling) {
        alert('You are already in a call.');
        return;
    }
    currentCallRecipient = recipientId;
    isCalling = true;
    await setupPeerConnection(recipientId);
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call-user', { offer, to: recipientId });
    } catch (e) {
        console.error('Error creating offer:', e);
        endCall();
    }
}

async function setupPeerConnection(recipientId) {
    if (peerConnection) endCall();
    peerConnection = new RTCPeerConnection(configuration);
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        remoteStream = new MediaStream();
        document.getElementById('remote-audio').srcObject = remoteStream;

        peerConnection.ontrack = event => {
            event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
        };

        peerConnection.onicecandidate = event => {
            if (event.candidate) socket.emit('ice-candidate', { candidate: event.candidate, to: recipientId });
        };

        peerConnection.oniceconnectionstatechange = () => {
            if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') endCall();
        };
    } catch (e) {
        console.error('Error setting up peer connection:', e);
        endCall();
    }
}

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
    peerConnection = null;
    localStream = null;
    remoteStream = null;
    currentCallRecipient = null;
    isCalling = false;
    document.getElementById('call-interface').style.display = 'none';
    document.getElementById('remote-audio').srcObject = null;
}

function hangUp() {
    if (currentCallRecipient) socket.emit('hang-up', { to: currentCallRecipient });
    endCall();
}

async function loadMessages(channelOrRecipientId) {
    const chatArea = channelOrRecipientId.startsWith('dm-') ? dmTabs[channelOrRecipientId.replace('dm-', '')].chat : document.getElementById('chat-area').querySelector('.chat-content');
    chatArea.innerHTML = '';
    const params = channelOrRecipientId.startsWith('dm-') 
        ? `recipientId=${channelOrRecipientId.replace('dm-', '')}` 
        : `channel=${channelOrRecipientId}`;
    const response = await fetch(`/messages?${params}`, { credentials: 'include' });
    const messages = await response.json();
    messages.forEach(msg => {
        if (msg.type === 'text') appendMessage(msg, chatArea, !!msg.recipientId);
        else if (msg.type === 'image') appendImageMessage(msg, chatArea, !!msg.recipientId);
        else if (msg.type === 'audio') appendAudioMessage(msg, chatArea, !!msg.recipientId);
    });
    chatArea.scrollTop = chatArea.scrollHeight;
}

function appendMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.senderId = msg.senderId;
    div.dataset.messageId = msg._id || Date.now();
    div.style.setProperty('--username-color', msg.color);

    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg ? repliedMsg.querySelector('.message-content span:not(.username)')?.textContent || repliedMsg.querySelector('img')?.alt || 'Audio' : 'Message not found';
        const repliedUsername = repliedMsg ? repliedMsg.querySelector('.username').textContent : 'Unknown';
        content += `<div class="reply-ref">Replying to ${repliedUsername}: ${repliedText}</div>`;
    }
    content += '<div class="message-content">';
    
    if (msg.language !== userLanguage) {
        fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(msg.content)}&langpair=${msg.language}|${userLanguage}`)
            .then(res => res.json())
            .then(data => {
                div.querySelector('.message-content').innerHTML = `<span>${data.responseData.translatedText}</span><div class="meta">(${msg.language}: ${msg.content})</div>`;
                div.querySelector('.reply-btn').style.display = 'block';
            });
    } else {
        content += `<span>${msg.content}</span>`;
    }
    content += `<button class="reply-btn" onclick="startReply('${div.dataset.messageId}')">Reply</button></div>`;
    
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendImageMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.senderId = msg.senderId;
    div.dataset.messageId = msg._id || Date.now();
    div.style.setProperty('--username-color', msg.color);

    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg ? repliedMsg.querySelector('.message-content span:not(.username)')?.textContent || repliedMsg.querySelector('img')?.alt || 'Audio' : 'Message not found';
        const repliedUsername = repliedMsg ? repliedMsg.querySelector('.username').textContent : 'Unknown';
        content += `<div class="reply-ref">Replying to ${repliedUsername}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><img src="${msg.content}" alt="Shared image" class="chat-image" onclick="openFullImage('${msg.content}')"><button class="reply-btn" onclick="startReply('${div.dataset.messageId}')">Reply</button></div>`;
    
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendAudioMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.senderId = msg.senderId;
    div.dataset.messageId = msg._id || Date.now();
    div.style.setProperty('--username-color', msg.color);

    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg ? repliedMsg.querySelector('.message-content span:not(.username)')?.textContent || repliedMsg.querySelector('img')?.alt || 'Audio' : 'Message not found';
        const repliedUsername = repliedMsg ? repliedMsg.querySelector('.username').textContent : 'Unknown';
        content += `<div class="reply-ref">Replying to ${repliedUsername}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><audio controls src="${msg.content}"></audio><button class="reply-btn" onclick="startReply('${div.dataset.messageId}')">Reply</button></div>`;
    
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function startReply(messageId) {
    replyingTo = messageId;
    const repliedMsg = document.querySelector(`[data-message-id="${messageId}"]`);
    const repliedUsername = repliedMsg.querySelector('.username').textContent;
    const repliedText = repliedMsg.querySelector('.message-content span')?.textContent || repliedMsg.querySelector('img')?.alt || 'Audio';
    document.getElementById('reply-preview').textContent = `Replying to ${repliedUsername}: ${repliedText}`;
    document.getElementById('reply-container').style.display = 'flex';
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
    tabBtn.className = 'px-4 py-2 bg-gray-200 text-gray-800 rounded-lg mr-2';
    tabBtn.setAttribute('data-tab', `dm-${recipientId}`);
    tabBtn.textContent = `DM: ${recipientUsername}`;
    tabBtn.onclick = () => switchTab(`dm-${recipientId}`);
    tabs.appendChild(tabBtn);

    const dmTab = document.createElement('div');
    dmTab.id = `dm-${recipientId}`;
    dmTab.className = 'chat-area flex-1 bg-white rounded-lg p-4 overflow-y-auto hidden shadow-md';
    dmTab.innerHTML = `<div class="chat-content flex flex-col gap-4"></div>`;
    document.getElementById('dm-tabs').appendChild(dmTab);

    dmTabs[recipientId] = { chat: dmTab.querySelector('.chat-content'), button: tabBtn };
    loadMessages(`dm-${recipientId}`);
}

function switchTab(tabId) {
    document.querySelectorAll('#tabs button').forEach(btn => btn.classList.remove('active-tab'));
    document.querySelectorAll('.chat-area').forEach(area => area.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active-tab');
    document.getElementById(tabId === 'General' ? 'chat-area' : tabId).classList.add('active');
    activeTab = tabId;
    const input = document.getElementById('message-input');
    input.dataset.recipient = tabId.startsWith('dm-') ? tabId.replace('dm-', '') : '';
    input.placeholder = tabId.startsWith('dm-') ? `DM to ${getRecipientUsername(input.dataset.recipient)}...` : `Message #${activeTab}...`;
    if (!tabId.startsWith('dm-')) {
        document.querySelectorAll('#channel-list button').forEach(btn => btn.classList.remove('bg-green-500'));
        document.querySelector(`[data-channel="${tabId}"]`).classList.add('bg-green-500');
        loadMessages(tabId);
    }
}

function switchChannel(channel) {
    document.querySelectorAll('#channel-list button').forEach(btn => btn.classList.remove('bg-green-500'));
    document.querySelector(`[data-channel="${channel}"]`).classList.add('bg-green-500');
    activeTab = channel;
    document.querySelectorAll('.chat-area').forEach(area => area.classList.remove('active'));
    document.getElementById('chat-area').classList.add('active');
    document.getElementById('message-input').dataset.recipient = '';
    document.getElementById('message-input').placeholder = `Message #${channel}...`;
    socket.emit('join channel', channel);
    loadMessages(channel);
    document.querySelectorAll('#tabs button').forEach(btn => btn.classList.remove('active-tab'));
    const existingTab = document.querySelector(`[data-tab="${channel}"]`);
    if (existingTab) {
        existingTab.classList.add('active-tab');
    } else {
        const tabs = document.getElementById('tabs');
        const tabBtn = document.createElement('button');
        tabBtn.className = 'px-4 py-2 bg-gray-200 text-gray-800 rounded-lg mr-2 active-tab';
        tabBtn.setAttribute('data-tab', channel);
        tabBtn.textContent = `# ${channel}`;
        tabBtn.onclick = () => switchTab(channel);
        tabs.innerHTML = '';
        tabs.appendChild(tabBtn);
    }
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
        profilePicture,
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
        msg.channel = activeTab;
        socket.emit('chat message', msg);
    }
    input.value = '';
    socket.emit('stop typing', { channel: activeTab });
}

function sendImage() {
    const fileInput = document.getElementById('image-input');
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const msg = { 
            username, 
            image: reader.result,
            color: userColor, 
            senderId: userId, 
            profilePicture,
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
            msg.channel = activeTab;
            socket.emit('image message', msg);
        }
        fileInput.value = '';
    };
    reader.readAsDataURL(file);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
        mediaRecorder.onstop = sendAudioMessage;
        mediaRecorder.start();
        document.getElementById('record-btn').innerHTML = '<i class="fas fa-stop"></i>';
        document.getElementById('record-btn').onclick = stopRecording;
    } catch (e) {
        console.error('Error starting recording:', e);
        alert('Failed to access microphone. Please allow permissions.');
    }
}

function stopRecording() {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
    document.getElementById('record-btn').innerHTML = '<i class="fas fa-microphone"></i>';
    document.getElementById('record-btn').onclick = startRecording;
}

function sendAudioMessage() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { 
            username, 
            audio: reader.result,
            color: userColor, 
            senderId: userId, 
            profilePicture,
        };
        if (replyingTo) {
            msg.replyTo = replyingTo;
            replyingTo = null;
            document.getElementById('reply-container').style.display = 'none';
        }
        if (document.getElementById('message-input').dataset.recipient) {
            msg.recipientId = document.getElementById('message-input').dataset.recipient;
            socket.emit('audio message', msg);
        } else {
            msg.channel = activeTab;
            socket.emit('audio message', msg);
        }
    };
    reader.readAsDataURL(blob);
}

function handleTyping() {
    socket.emit('typing', { username, channel: activeTab });
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => socket.emit('stop typing', { channel: activeTab }), 1000);
}

function showColorPicker() {
    document.getElementById('color-picker-modal').style.display = 'flex';
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
    document.getElementById('mute-btn').textContent = `Toggle Mute (${isMuted ? 'Muted' : 'Unmuted'})`;
}

function playNotification() {
    if (!isMuted) document.getElementById('notification-sound').play();
}

function openFullImage(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%; max-height: 100vh;">`);
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emoji-picker-container');
    picker.classList.toggle('hidden');
}
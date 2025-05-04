const socket = io('http://localhost:10000', { withCredentials: true, transports: ['websocket', 'polling'] });
let username, userId, userColor, userLanguage, profilePicture, activeTab = 'Math', dmTabs = {}, groupTabs = {}, replyingTo = null;
let localStream, remoteStream, peerConnection, mediaRecorder, audioChunks = [], currentCallRecipient = null, isCalling = false, userTheme;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }] };

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/user', { credentials: 'include' });
    if (!response.ok) return window.location.href = '/';
    const data = await response.json();
    username = data.username;
    userId = data.userId;
    userColor = data.color;
    userLanguage = data.language;
    profilePicture = data.profilePicture;
    userTheme = data.theme;
    document.getElementById('language-select').value = userLanguage;
    document.getElementById('sidebar-profile-pic').src = profilePicture || 'https://via.placeholder.com/24';
    applyTheme(userTheme);
    socket.emit('join-channel', activeTab);
    loadInitialContent();
});

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }
}

async function toggleTheme() {
    userTheme = userTheme === 'dark' ? 'light' : 'dark';
    applyTheme(userTheme);
    await fetch('/update-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: userTheme }),
        credentials: 'include'
    });
}

function loadInitialContent() {
    fetchMessages(activeTab);
}

socket.on('channels', channels => {
    const channelList = document.getElementById('channel-list');
    channelList.innerHTML = channels.map(channel => `
        <li><button class="w-full p-2 rounded-lg ${activeTab === channel ? 'bg-gradient-to-r from-blue-500 to-purple-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-all transform hover:scale-105" onclick="switchTab('${channel}', 'channel')">#${channel}</button></li>
    `).join('');
});

socket.on('groups', groups => {
    const groupList = document.getElementById('group-list');
    groupList.innerHTML = groups.map(group => {
        groupTabs[group._id] = { title: group.name };
        return `<li><button class="w-full p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-all transform hover:scale-105" onclick="switchTab('${group._id}', 'group')">${group.name}</button></li>`;
    }).join('');
});

socket.on('user-list', users => {
    const dmList = document.getElementById('dm-list');
    dmList.innerHTML = users.filter(u => u.userId !== userId).map(u => `
        <li class="flex items-center space-x-2">
            <button class="flex-1 p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-left transition-all transform hover:scale-105" onclick="startDM('${u.userId}', '${u.username}')">${u.username}</button>
            <button onclick="callUser('${u.userId}')" class="bg-gradient-to-r from-blue-500 to-purple-500 p-2 rounded-lg hover:from-blue-600 hover:to-purple-600 transform hover:scale-105 transition-all"><i class="fas fa-phone"></i></button>
        </li>
    `).join('');
    const groupMembers = document.getElementById('group-members');
    groupMembers.innerHTML = users.filter(u => u.userId !== userId).map(u => `<option value="${u.userId}">${u.username}</option>`).join('');
});

socket.on('new-message', msg => {
    const target = msg.recipientId ? `dm-${[msg.senderId, msg.recipientId].sort().join('-')}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) {
        if (msg.type === 'text') appendMessage(msg, document.getElementById('messages'));
        else if (msg.type === 'image') appendImageMessage(msg, document.getElementById('messages'));
        else if (msg.type === 'audio') appendAudioMessage(msg, document.getElementById('messages'));
    }
    playNotification();
});

socket.on('typing', data => {
    const target = data.roomId || data.groupId || data.channel;
    if (activeTab === target) {
        document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
    }
});

socket.on('stop-typing', data => {
    const target = data.roomId || data.groupId || data.channel;
    if (activeTab === target) {
        document.getElementById('typing-indicator').textContent = '';
    }
});

socket.on('reaction-update', data => {
    const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageEl) {
        const reactionsEl = messageEl.querySelector('.reactions');
        reactionsEl.innerHTML = Object.entries(data.reactions).map(([reaction, users]) => `
            <span class="reaction" onclick="toggleReaction('${data.messageId}', '${reaction}')">${reaction} ${users.length}</span>
        `).join('');
    }
});

socket.on('pin-update', data => {
    fetchMessages(activeTab);
});

socket.on('call-made', async data => {
    if (isCalling) { socket.emit('call-rejected', { to: data.from }); return; }
    currentCallRecipient = data.from;
    document.getElementById('call-status').textContent = `Incoming call from ${data.from}...`;
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('accept-call').onclick = async () => { await acceptCall(data); };
    document.getElementById('decline-call').onclick = () => { 
        socket.emit('call-rejected', { to: data.from }); 
        document.getElementById('call-modal').classList.add('hidden'); 
    };
});

socket.on('answer-made', async data => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').classList.remove('hidden');
    document.getElementById('call-with').textContent = `In call with ${data.from}`;
});

socket.on('ice-candidate', async data => {
    if (peerConnection && data.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('call-rejected', () => { alert('Call declined.'); endCall(); });
socket.on('hang-up', () => endCall());

async function acceptCall(data) {
    document.getElementById('call-modal').classList.add('hidden');
    isCalling = true;
    await setupPeerConnection(data.from);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('make-answer', { answer, to: data.from, from: userId });
}

async function callUser(recipientId) {
    if (isCalling) { alert('Already in a call.'); return; }
    currentCallRecipient = recipientId;
    isCalling = true;
    await setupPeerConnection(recipientId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-user', { offer, to: recipientId, from: userId });
}

async function setupPeerConnection(recipientId) {
    peerConnection = new RTCPeerConnection(configuration);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    remoteStream = new MediaStream();
    document.getElementById('remote-audio').srcObject = remoteStream;
    peerConnection.ontrack = event => remoteStream.addTrack(event.track);
    peerConnection.onicecandidate = event => event.candidate && socket.emit('ice-candidate', { candidate: event.candidate, to: recipientId });
    peerConnection.oniceconnectionstatechange = () => { if (peerConnection.iceConnectionState === 'disconnected') endCall(); };
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
    document.getElementById('call-interface').classList.add('hidden');
    document.getElementById('remote-audio').srcObject = null;
}

function hangUp() {
    if (currentCallRecipient) socket.emit('hang-up', { to: currentCallRecipient });
    endCall();
}

async function fetchMessages(tab) {
    const messages = document.getElementById('messages');
    const pinned = document.getElementById('pinned-messages');
    messages.innerHTML = '';
    pinned.innerHTML = '';
    const params = tab.startsWith('dm-') ? `recipientId=${tab.replace('dm-', '')}` : tab.startsWith('group-') ? `groupId=${tab.replace('group-', '')}` : `channel=${tab}`;
    const response = await fetch(`/messages?${params}`, { credentials: 'include' });
    const data = await response.json();
    data.filter(m => m.pinned).forEach(msg => appendPinnedMessage(msg, pinned));
    data.filter(m => !m.pinned).forEach(msg => {
        if (msg.type === 'text') appendMessage(msg, messages);
        else if (msg.type === 'image') appendImageMessage(msg, messages);
        else if (msg.type === 'audio') appendAudioMessage(msg, messages);
    });
    messages.scrollTop = messages.scrollHeight;
}

function appendMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-8 h-8 rounded-full transform hover:scale-110 transition-all">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Media';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username')?.textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><span>${msg.content}</span></div>
            <div class="actions space-x-2 mt-2 flex">
                <button onclick="translateMessage('${msg._id}', '${msg.content}')">Translate</button>
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="togglePin('${msg._id}')">${msg.pinned ? 'Unpin' : 'Pin'}</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions || {}).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendPinnedMessage(msg, container) {
    const div = document.createElement('div');
    div.className = 'pinned-message';
    div.dataset.messageId = msg._id;
    div.innerHTML = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-8 h-8 rounded-full transform hover:scale-110 transition-all">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>
        <div class="message-content">
            <div class="message-body"><span>${msg.content}</span></div>
            <div class="actions space-x-2 mt-2 flex">
                <button onclick="togglePin('${msg._id}')">Unpin</button>
            </div>
        </div>
    `;
    container.appendChild(div);
}

function appendImageMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-8 h-8 rounded-full transform hover:scale-110 transition-all">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Media';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username')?.textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><img src="${msg.content}" alt="Image" class="chat-image" onclick="openImage('${msg.content}')"></div>
            <div class="actions space-x-2 mt-2 flex">
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="togglePin('${msg._id}')">${msg.pinned ? 'Unpin' : 'Pin'}</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions || {}).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAudioMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-8 h-8 rounded-full transform hover:scale-110 transition-all">
            <span class="username">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Media';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username')?.textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><audio controls src="${msg.content}"></audio></div>
            <div class="actions space-x-2 mt-2 flex">
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="togglePin('${msg._id}')">${msg.pinned ? 'Unpin' : 'Pin'}</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions || {}).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function translateMessage(messageId, text) {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${userLanguage}`);
    const data = await response.json();
    const translatedText = data.responseData.translatedText;
    const messageEl = document.querySelector(`[data-message-id="${messageId}"] .message-body span`);
    messageEl.textContent = translatedText + ` (Original: ${text})`;
}

function startReply(messageId) {
    replyingTo = messageId;
    const repliedMsg = document.querySelector(`[data-message-id="${messageId}"]`);
    document.getElementById('reply-preview').textContent = `Replying to ${repliedMsg.querySelector('.username').textContent}: ${repliedMsg.querySelector('.message-body span')?.textContent || 'Media'}`;
    document.getElementById('reply-container').classList.remove('hidden');
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-container').classList.add('hidden');
}

async function toggleReaction(messageId, reaction) {
    await fetch('/react-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, reaction }),
        credentials: 'include'
    });
    socket.emit('reaction', { messageId, reaction, userId });
}

async function togglePin(messageId) {
    await fetch('/pin-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
        credentials: 'include'
    });
    socket.emit('pin-message', { messageId, userId });
}

function startDM(recipientId, recipientUsername) {
    const roomId = [userId, recipientId].sort().join('-');
    if (!dmTabs[roomId]) {
        dmTabs[roomId] = { title: recipientUsername };
        socket.emit('join-dm', { roomId });
    }
    switchTab(roomId, 'dm');
}

function toggleGroupCreation() {
    document.getElementById('group-creation').classList.toggle('hidden');
}

async function createGroup() {
    const name = document.getElementById('group-name').value.trim();
    const memberIds = Array.from(document.getElementById('group-members').selectedOptions).map(opt => opt.value);
    if (!name || memberIds.length === 0) return alert('Please enter a group name and select members.');
    const response = await fetch('/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, memberIds }),
        credentials: 'include'
    });
    const data = await response.json();
    if (data.success) {
        socket.emit('join-group', data.groupId);
        document.getElementById('group-name').value = '';
        document.getElementById('group-members').selectedIndex = -1;
        toggleGroupCreation();
    }
}

function switchTab(tabId, type) {
    activeTab = type === 'channel' ? tabId : type === 'group' ? tabId : `dm-${tabId}`;
    document.getElementById('chat-title').textContent = type === 'channel' ? `#${tabId}` : type === 'group' ? (groupTabs[tabId]?.title || 'Group') : dmTabs[tabId]?.title || 'DM';
    fetchMessages(activeTab);
    if (type === 'channel') socket.emit('join-channel', tabId);
    else if (type === 'group') socket.emit('join-group', tabId);
    else if (type === 'dm') socket.emit('join-dm', { roomId: tabId });
}

function showSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
}

function hideSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function showColorPicker() {
    document.getElementById('color-picker-modal').classList.remove('hidden');
    document.getElementById('color-picker').value = userColor;
}

function hideColorPicker() {
    document.getElementById('color-picker-modal').classList.add('hidden');
}

async function changeColor() {
    const newColor = document.getElementById('color-picker').value;
    const response = await fetch('/update-color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color: newColor }),
        credentials: 'include'
    });
    const data = await response.json();
    if (data.success) {
        userColor = newColor;
        hideColorPicker();
    }
}

async function updateLanguage() {
    userLanguage = document.getElementById('language-select').value;
    await fetch('/update-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: userLanguage }),
        credentials: 'include'
    });
}

async function logout() {
    await fetch('/logout', { credentials: 'include' });
    window.location.href = '/';
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const msg = { type: 'text', content: text, username, senderId: userId, profilePicture };
    if (replyingTo) {
        msg.replyTo = replyingTo;
        cancelReply();
    }
    if (activeTab.startsWith('dm-')) {
        const roomId = activeTab.replace('dm-', '');
        msg.recipientId = roomId.split('-').find(id => id !== userId);
        msg.roomId = roomId;
    } else if (activeTab.startsWith('group-')) {
        msg.groupId = activeTab;
    } else {
        msg.channel = activeTab;
    }
    socket.emit('send-message', msg);
    input.value = '';
    socket.emit('stop-typing', { 
        channel: msg.channel,
        groupId: msg.groupId,
        roomId: msg.roomId,
        username 
    });
}

function sendImage() {
    const file = document.getElementById('image-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { type: 'image', content: reader.result, username, senderId: userId, profilePicture };
        if (replyingTo) {
            msg.replyTo = replyingTo;
            cancelReply();
        }
        if (activeTab.startsWith('dm-')) {
            const roomId = activeTab.replace('dm-', '');
            msg.recipientId = roomId.split('-').find(id => id !== userId);
            msg.roomId = roomId;
        } else if (activeTab.startsWith('group-')) {
            msg.groupId = activeTab;
        } else {
            msg.channel = activeTab;
        }
        socket.emit('send-message', msg);
        document.getElementById('image-input').value = '';
    };
    reader.readAsDataURL(file);
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = sendAudioMessage;
        mediaRecorder.start();
        document.getElementById('record-btn').innerHTML = '<i class="fas fa-stop"></i>';
        document.getElementById('record-btn').onclick = stopRecording;
    } catch (e) {
        console.error('Error starting recording:', e);
        alert('Failed to access microphone.');
    }
}

function stopRecording() {
    if (mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('record-btn').innerHTML = '<i class="fas fa-microphone"></i>';
    document.getElementById('record-btn').onclick = startRecording;
}

function sendAudioMessage() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { type: 'audio', content: reader.result, username, senderId: userId, profilePicture };
        if (replyingTo) {
            msg.replyTo = replyingTo;
            cancelReply();
        }
        if (activeTab.startsWith('dm-')) {
            const roomId = activeTab.replace('dm-', '');
            msg.recipientId = roomId.split('-').find(id => id !== userId);
            msg.roomId = roomId;
        } else if (activeTab.startsWith('group-')) {
            msg.groupId = activeTab;
        } else {
            msg.channel = activeTab;
        }
        socket.emit('send-message', msg);
    };
    reader.readAsDataURL(blob);
}

function handleTyping() {
    const data = { username, senderId: userId };
    if (activeTab.startsWith('dm-')) {
        const roomId = activeTab.replace('dm-', '');
        data.roomId = roomId;
        data.recipientId = roomId.split('-').find(id => id !== userId);
    } else if (activeTab.startsWith('group-')) {
        data.groupId = activeTab;
    } else {
        data.channel = activeTab;
    }
    socket.emit('typing', data);
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => socket.emit('stop-typing', data), 1000);
}

function playNotification() {
    document.getElementById('notification-sound').play();
}

function openImage(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%; max-height: 100vh;">`);
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emoji-picker-container');
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) {
        const emojiPicker = document.querySelector('emoji-picker');
        emojiPicker.addEventListener('emoji-click', event => {
            const input = document.getElementById('message-input');
            input.value += event.detail.unicode;
            picker.classList.add('hidden');
        }, { once: true });
    }
}
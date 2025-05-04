const socket = io('http://localhost:10000', { withCredentials: true, transports: ['websocket', 'polling'] });
let username, userColor, userLanguage, userId, profilePicture, userTheme, activeTab = 'General', dmTabs = {}, groupTabs = {}, isMuted = false, replyingTo = null, currentCallRecipient = null, isCalling = false;
let localStream, remoteStream, peerConnection, mediaRecorder, audioChunks = [];
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }] };

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/user', { credentials: 'include' });
    if (!response.ok) return window.location.href = '/';
    const data = await response.json();
    username = data.username; userColor = data.color; userLanguage = data.language; userId = data.userId; profilePicture = data.profilePicture; userTheme = data.theme;
    document.getElementById('language-select').value = userLanguage;
    document.body.classList.add(userTheme === 'dark' ? 'dark-mode' : 'light-mode');

    const picker = document.querySelector('emoji-picker');
    picker.addEventListener('emoji-click', event => {
        document.getElementById('message-input').value += event.detail.unicode;
        toggleEmojiPicker();
    });

    loadInitialContent();
    socket.emit('join channel', activeTab);
});

function loadInitialContent() {
    fetchMessages(activeTab);
}

socket.on('channels', channels => {
    const channelList = document.getElementById('channel-list');
    channelList.innerHTML = channels.map(channel => `
        <li><button class="bg-navy-900 text-white px-4 py-2 rounded-lg hover:bg-navy-800 ${channel === activeTab ? 'bg-teal-500' : ''}" onclick="switchTab('${channel}')"># ${channel}</button></li>
    `).join('');
});

socket.on('groups', groups => {
    const groupList = document.getElementById('group-list');
    groupList.innerHTML = groups.map(group => `
        <li><button class="bg-navy-900 text-white px-4 py-2 rounded-lg hover:bg-navy-800" onclick="switchTab('${group._id}', 'group')">${group.name}</button></li>
    `).join('');
});

socket.on('user list', users => {
    const dmList = document.getElementById('dm-list');
    dmList.innerHTML = users.filter(u => u.userId !== userId).map(u => `
        <li class="flex items-center space-x-2">
            <button class="bg-navy-900 text-white px-4 py-2 rounded-lg hover:bg-navy-800 flex-1 text-left" onclick="startDM('${u.userId}', '${u.username}')">${u.username}</button>
            <button onclick="callUser('${u.userId}')" class="bg-teal-500 text-white px-4 py-2 rounded-lg hover:bg-teal-600"><i class="fas fa-phone"></i></button>
        </li>
    `).join('');
    document.getElementById('group-members').innerHTML = users.filter(u => u.userId !== userId).map(u => `<option value="${u.userId}">${u.username}</option>`).join('');
});

socket.on('chat message', msg => {
    if (activeTab === msg.channel) appendMessage(msg, document.querySelector('.chat-content'), false);
    playNotification();
});

socket.on('group message', msg => {
    if (activeTab === msg.groupId.toString()) appendMessage(msg, document.querySelector('.chat-content'), false);
    playNotification();
});

socket.on('dm message', msg => {
    const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
    if (!dmTabs[partnerId]) startDM(partnerId, msg.username === username ? getUsernameFromId(partnerId) : msg.username);
    if (activeTab === `dm-${partnerId}`) appendMessage(msg, document.querySelector('.chat-content'), true);
    playNotification();
});

socket.on('image message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId === userId ? msg.recipientId : msg.senderId}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendImageMessage(msg, document.querySelector('.chat-content'), !!msg.recipientId);
    playNotification();
});

socket.on('audio message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId === userId ? msg.recipientId : msg.senderId}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendAudioMessage(msg, document.querySelector('.chat-content'), !!msg.recipientId);
    playNotification();
});

socket.on('typing', data => {
    if (activeTab === data.channel || activeTab === data.groupId || activeTab === `dm-${data.recipientId}`) document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
});

socket.on('stop typing', data => {
    if (activeTab === data.channel || activeTab === data.groupId || activeTab === `dm-${data.recipientId}`) document.getElementById('typing-indicator').textContent = '';
});

socket.on('reaction update', data => {
    const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
    if (messageEl) {
        const reactionsEl = messageEl.querySelector('.reactions');
        reactionsEl.innerHTML = Object.entries(data.reactions).map(([reaction, users]) => `
            <span class="reaction" onclick="toggleReaction('${data.messageId}', '${reaction}')">${reaction} ${users.length}</span>
        `).join('');
    }
});

socket.on('call-made', async data => {
    if (isCalling) { socket.emit('call-rejected', { to: data.from }); return; }
    currentCallRecipient = data.from;
    document.getElementById('call-status').textContent = `Incoming call from ${data.from}...`;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('accept-call').onclick = async () => { await acceptCall(data); };
    document.getElementById('decline-call').onclick = () => { socket.emit('call-rejected', { to: data.from }); document.getElementById('call-modal').style.display = 'none'; };
});

socket.on('answer-made', async data => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In call with ${data.from}`;
});

socket.on('ice-candidate', async data => {
    if (peerConnection && data.candidate) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('call-rejected', () => { alert('Call declined.'); endCall(); });
socket.on('hang-up', () => endCall());

async function acceptCall(data) {
    document.getElementById('call-modal').style.display = 'none';
    isCalling = true;
    await setupPeerConnection(data.from);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('make-answer', { answer, to: data.from });
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In call with ${data.from}`;
}

async function callUser(recipientId) {
    if (isCalling) { alert('Already in a call.'); return; }
    currentCallRecipient = recipientId; isCalling = true;
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
    peerConnection.ontrack = event => remoteStream.addTrack(event.track);
    peerConnection.onicecandidate = event => event.candidate && socket.emit('ice-candidate', { candidate: event.candidate, to: recipientId });
    peerConnection.oniceconnectionstatechange = () => { if (peerConnection.iceConnectionState === 'disconnected') endCall(); };
}

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
    peerConnection = null; localStream = null; remoteStream = null;
    currentCallRecipient = null; isCalling = false;
    document.getElementById('call-interface').style.display = 'none';
    document.getElementById('remote-audio').srcObject = null;
}

function hangUp() { if (currentCallRecipient) socket.emit('hang-up', { to: currentCallRecipient }); endCall(); }

async function fetchMessages(tab, date = null) {
    const chat = document.querySelector('.chat-content');
    chat.innerHTML = '';
    const params = tab.startsWith('dm-') ? `recipientId=${tab.replace('dm-', '')}` : tab.startsWith('group-') ? `groupId=${tab.replace('group-', '')}` : `channel=${tab}`;
    if (date) params += `&date=${date}`;
    const response = await fetch(`/messages?${params}`, { credentials: 'include' });
    const messages = await response.json();
    messages.forEach(msg => {
        if (msg.type === 'text') appendMessage(msg, chat, !!msg.recipientId);
        else if (msg.type === 'image') appendImageMessage(msg, chat, !!msg.recipientId);
        else if (msg.type === 'audio') appendAudioMessage(msg, chat, !!msg.recipientId);
    });
    chat.scrollTop = chat.scrollHeight;
}

function appendMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        <div class="message-content">
            <div class="flex items-center space-x-2">
                <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
                <span class="username">${msg.username === username ? 'You' : msg.username}</span>
            </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Media';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
            <div class="message-body">
                <span>${msg.content}</span>
            </div>
            <div class="actions">
                <button onclick="translateMessage('${msg._id}', '${msg.content}')">Translate</button>
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendImageMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        <div class="message-content">
            <div class="flex items-center space-x-2">
                <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
                <span class="username">${msg.username === username ? 'You' : msg.username}</span>
            </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Image';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
            <div class="message-body">
                <img src="${msg.content}" alt="Image" class="chat-image" onclick="openImage('${msg.content}')">
            </div>
            <div class="actions">
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendAudioMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="message-timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        <div class="message-content">
            <div class="flex items-center space-x-2">
                <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
                <span class="username">${msg.username === username ? 'You' : msg.username}</span>
            </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Audio';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
            <div class="message-body">
                <audio controls src="${msg.content}"></audio>
            </div>
            <div class="actions">
                <button onclick="startReply('${msg._id}')">Reply</button>
                <button onclick="toggleReaction('${msg._id}', '👍')">👍</button>
                <button onclick="toggleReaction('${msg._id}', '❤️')">❤️</button>
            </div>
            <div class="reactions">
                ${Object.entries(msg.reactions).map(([reaction, users]) => `<span class="reaction" onclick="toggleReaction('${msg._id}', '${reaction}')">${reaction} ${users.length}</span>`).join('')}
            </div>
        </div>
    `;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
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
    document.getElementById('reply-container').style.display = 'flex';
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-container').style.display = 'none';
}

async togleReaction(messageId, reaction) {
    await fetch('/react-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, reaction }),
        credentials: 'include'
    });
    socket.emit('reaction', { messageId, reaction, userId });
}

function startDM(recipientId, recipientUsername) {
    if (!dmTabs[recipientId]) {
        dmTabs[recipientId] = { title: recipientUsername };
        socket.emit('join dm', recipientId);
    }
    switchTab(recipientId, 'dm');
}

function toggleGroupCreation() {
    const groupCreation = document.getElementById('group-creation');
    groupCreation.classList.toggle('hidden');
}

function createGroup() {
    const name = document.getElementById('group-name').value.trim();
    const memberIds = Array.from(document.getElementById('group-members').selectedOptions).map(opt => opt.value);
    if (!name || memberIds.length === 0) return alert('Please enter a group name and select members.');
    fetch('/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, memberIds }),
        credentials: 'include'
    }).then(res => res.json()).then(data => {
        if (data.success) {
            socket.emit('join group', data.groupId);
            document.getElementById('group-name').value = '';
            document.getElementById('group-members').selectedIndex = -1;
            toggleGroupCreation();
        }
    });
}

function switchTab(tabId, type = 'channel') {
    activeTab = type === 'channel' ? tabId : type === 'group' ? `group-${tabId}` : `dm-${tabId}`;
    document.getElementById('chat-name').textContent = type === 'channel' ? `#${tabId}` : type === 'group' ? (groupTabs[tabId]?.title || 'Group') : dmTabs[tabId]?.title || 'DM';
    fetchMessages(activeTab);
    if (type === 'channel') socket.emit('join channel', tabId);
    else if (type === 'group') socket.emit('join group', tabId);
    else if (type === 'dm') socket.emit('join dm', tabId);
    showTab('chat');
}

function showTab(tab) {
    document.querySelectorAll('#channels-tab, #dms-tab, #groups-tab, #settings-tab, #chat-area').forEach(el => el.classList.add('hidden'));
    if (tab !== 'chat') document.getElementById(`${tab}-tab`).classList.remove('hidden');
    else document.getElementById('chat-area').classList.remove('hidden');
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const msg = { username, text, senderId: userId, profilePicture };
    if (replyingTo) { msg.replyTo = replyingTo; cancelReply(); }
    if (activeTab.startsWith('dm-')) {
        msg.recipientId = activeTab.replace('dm-', '');
        socket.emit('dm message', msg);
    } else if (activeTab.startsWith('group-')) {
        msg.groupId = activeTab.replace('group-', '');
        socket.emit('group message', msg);
    } else {
        msg.channel = activeTab;
        socket.emit('chat message', msg);
    }
    input.value = '';
    socket.emit('stop typing', { channel: activeTab });
}

function sendImage() {
    const file = document.getElementById('image-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { username, image: reader.result, senderId: userId, profilePicture };
        if (replyingTo) { msg.replyTo = replyingTo; cancelReply(); }
        if (activeTab.startsWith('dm-')) msg.recipientId = activeTab.replace('dm-', '');
        else if (activeTab.startsWith('group-')) msg.groupId = activeTab.replace('group-', '');
        else msg.channel = activeTab;
        socket.emit('image message', msg);
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
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
    document.getElementById('record-btn').innerHTML = '<i class="fas fa-microphone"></i>';
    document.getElementById('record-btn').onclick = startRecording;
}

function sendAudioMessage() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { username, audio: reader.result, senderId: userId, profilePicture };
        if (replyingTo) { msg.replyTo = replyingTo; cancelReply(); }
        if (activeTab.startsWith('dm-')) msg.recipientId = activeTab.replace('dm-', '');
        else if (activeTab.startsWith('group-')) msg.groupId = activeTab.replace('group-', '');
        else msg.channel = activeTab;
        socket.emit('audio message', msg);
    };
    reader.readAsDataURL(blob);
}

function handleTyping() {
    const data = { username, senderId: userId };
    if (activeTab.startsWith('dm-')) data.recipientId = activeTab.replace('dm-', '');
    else if (activeTab.startsWith('group-')) data.groupId = activeTab.replace('group-', '');
    else data.channel = activeTab;
    socket.emit('typing', data);
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => socket.emit('stop typing', data), 1000);
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
        if (data.success) { userColor = newColor; hideColorPicker(); }
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

function toggleTheme() {
    userTheme = userTheme === 'light' ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode');
    document.body.classList.toggle('light-mode');
    fetch('/update-theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: userTheme }),
        credentials: 'include'
    });
    document.getElementById('theme-toggle').textContent = `Switch to ${userTheme === 'light' ? 'Dark' : 'Light'} Mode`;
}

function toggleMute() {
    isMuted = !isMuted;
    document.getElementById('mute-btn').textContent = `Mute (${isMuted ? 'On' : 'Off'})`;
}

function playNotification() {
    if (!isMuted) document.getElementById('notification-sound').play();
}

function openImage(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%; max-height: 100vh;">`);
}

function toggleEmojiPicker() {
    document.getElementById('emoji-picker-container').classList.toggle('hidden');
}

function loadSnapshot() {
    const date = document.getElementById('snapshot-date').value;
    if (date) fetchMessages(activeTab, date);
}

function getUsernameFromId(id) {
    return Array.from(document.querySelectorAll('#dm-list button')).find(btn => btn.onclick.toString().includes(id))?.textContent || 'Unknown';
}
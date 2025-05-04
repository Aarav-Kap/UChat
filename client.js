const socket = io('https://uchat-997p.onrender.com', { withCredentials: true, transports: ['websocket', 'polling'] });
let username, userColor, userLanguage, userId, profilePicture, activeTab = 'General', dmTabs = {}, groupTabs = {}, isDarkMode = false, unreadCounts = {};
let localStream, remoteStream, peerConnection, mediaRecorder, audioChunks = [], replyingTo = null, currentCallRecipient = null, isCalling = false;
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }] };

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/user', { credentials: 'include' });
    if (!response.ok) return window.location.href = '/';
    const data = await response.json();
    username = data.username; userColor = data.color; userLanguage = data.language; userId = data.userId; profilePicture = data.profilePicture;
    document.getElementById('current-username').textContent = username;

    const picker = document.querySelector('emoji-picker');
    picker.addEventListener('emoji-click', event => {
        document.getElementById('message-input').value += event.detail.unicode;
        toggleEmojiPicker();
    });

    loadInitialContent();
});

function loadInitialContent() {
    socket.emit('join channel', activeTab);
    fetchMessages(activeTab);
    updateSidebar();
}

socket.on('channels', channels => {
    const channelList = document.getElementById('channel-list');
    channelList.innerHTML = channels.map(channel => `
        <li><button class="w-full text-left px-2 py-1 bg-gray-200 rounded hover:bg-blue-100 ${channel === activeTab ? 'bg-blue-200' : ''}" data-channel="${channel}" onclick="switchTab('${channel}')"># ${channel}</button></li>
    `).join('');
});

socket.on('groups', groups => {
    const groupList = document.getElementById('group-list');
    groupList.innerHTML = groups.map(group => `
        <li><button class="w-full text-left px-2 py-1 bg-gray-200 rounded hover:bg-blue-100" data-group="${group._id}" onclick="switchTab('${group._id}', 'group')">${group.name}</button></li>
    `).join('');
});

socket.on('user list', users => {
    const ul = document.getElementById('user-list');
    ul.innerHTML = users.filter(u => u.userId !== userId).map(u => `
        <li class="flex items-center space-x-2"><img src="${u.profilePicture || 'https://via.placeholder.com/32'}" alt="${u.username}" class="w-8 h-8 rounded-full"><span onclick="startDM('${u.userId}', '${u.username}')" class="cursor-pointer flex-1">${u.username}</span><button onclick="callUser('${u.userId}')" class="bg-blue-600 text-white p-1 rounded hover:bg-orange-500"><i class="fas fa-phone"></i></button></li>
    `).join('');
    document.getElementById('user-count').textContent = users.length;
    document.getElementById('group-members').innerHTML = users.filter(u => u.userId !== userId).map(u => `<option value="${u.userId}">${u.username}</option>`).join('');
});

socket.on('chat message', msg => {
    if (activeTab === msg.channel) appendMessage(msg, document.querySelector('.chat-content'), false);
    else unreadCounts[msg.channel] = (unreadCounts[msg.channel] || 0) + 1;
    updateUnreadBadges();
    playNotification();
});

socket.on('group message', msg => {
    if (activeTab === msg.groupId.toString()) appendMessage(msg, document.querySelector('.chat-content'), false);
    else unreadCounts[msg.groupId] = (unreadCounts[msg.groupId] || 0) + 1;
    updateUnreadBadges();
    playNotification();
});

socket.on('dm message', msg => {
    const partnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
    if (!dmTabs[partnerId]) startDM(partnerId, getUsernameFromId(partnerId));
    if (activeTab === `dm-${partnerId}`) appendMessage(msg, dmTabs[partnerId].chat, true);
    else unreadCounts[`dm-${partnerId}`] = (unreadCounts[`dm-${partnerId}`] || 0) + 1;
    updateUnreadBadges();
    playNotification();
});

socket.on('image message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId === userId ? msg.recipientId : msg.senderId}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendImageMessage(msg, document.querySelector('.chat-content'), !!msg.recipientId);
    else unreadCounts[target] = (unreadCounts[target] || 0) + 1;
    updateUnreadBadges();
    playNotification();
});

socket.on('audio message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId === userId ? msg.recipientId : msg.senderId}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendAudioMessage(msg, document.querySelector('.chat-content'), !!msg.recipientId);
    else unreadCounts[target] = (unreadCounts[target] || 0) + 1;
    updateUnreadBadges();
    playNotification();
});

socket.on('typing', data => {
    if (activeTab === data.channel || activeTab === data.groupId) document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
});

socket.on('stop typing', data => {
    if (activeTab === data.channel || activeTab === data.groupId) document.getElementById('typing-indicator').textContent = '';
});

socket.on('call-made', async data => {
    if (isCalling) { socket.emit('call-rejected', { to: data.from }); return; }
    currentCallRecipient = data.from;
    document.getElementById('call-status').textContent = `${data.fromUsername} is calling...`;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('accept-call').onclick = async () => { await acceptCall(data); };
    document.getElementById('decline-call').onclick = () => { socket.emit('call-rejected', { to: data.from }); document.getElementById('call-modal').style.display = 'none'; };
});

socket.on('answer-made', async data => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
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
    document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
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

async function fetchMessages(tab) {
    const chat = document.querySelector('.chat-content');
    chat.innerHTML = '';
    const params = tab.startsWith('dm-') ? `recipientId=${tab.replace('dm-', '')}` : tab.includes('group-') ? `groupId=${tab.replace('group-', '')}` : `channel=${tab}`;
    const response = await fetch(`/messages?${params}`, { credentials: 'include' });
    const messages = await response.json();
    messages.forEach(msg => {
        if (msg.type === 'text') appendMessage(msg, chat, !!msg.recipientId);
        else if (msg.type === 'image') appendImageMessage(msg, chat, !!msg.recipientId);
        else if (msg.type === 'audio') appendAudioMessage(msg, chat, !!msg.recipientId);
    });
    chat.scrollTop = chat.scrollHeight;
    if (unreadCounts[tab]) { unreadCounts[tab] = 0; updateUnreadBadges(); }
}

function appendMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    div.style.setProperty('--username-color', msg.color);
    let content = `<div class="flex items-center space-x-2"><img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full"><span class="username">${msg.username === username ? 'You' : msg.username}</span></div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-content span')?.textContent || 'Message';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><span>${msg.language !== userLanguage ? translate(msg.content, msg.language) : msg.content}</span><button class="reply-btn" onclick="startReply('${msg._id}')">Reply</button></div>`;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendImageMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    div.style.setProperty('--username-color', msg.color);
    let content = `<div class="flex items-center space-x-2"><img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full"><span class="username">${msg.username === username ? 'You' : msg.username}</span></div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-content span')?.textContent || 'Image';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><img src="${msg.content}" alt="Image" class="chat-image" onclick="openImage('${msg.content}')"><button class="reply-btn" onclick="startReply('${msg._id}')">Reply</button></div>`;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function appendAudioMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    div.style.setProperty('--username-color', msg.color);
    let content = `<div class="flex items-center space-x-2"><img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full"><span class="username">${msg.username === username ? 'You' : msg.username}</span></div>`;
    if (msg.replyTo) {
        const repliedMsg = chat.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-content span')?.textContent || 'Audio';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `<div class="message-content"><audio controls src="${msg.content}"></audio><button class="reply-btn" onclick="startReply('${msg._id}')">Reply</button></div>`;
    div.innerHTML = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function startReply(messageId) {
    replyingTo = messageId;
    const repliedMsg = document.querySelector(`[data-message-id="${messageId}"]`);
    document.getElementById('reply-preview').textContent = `Replying to ${repliedMsg.querySelector('.username').textContent}: ${repliedMsg.querySelector('.message-content span')?.textContent || 'Media'}`;
    document.getElementById('reply-container').classList.remove('hidden');
}

function cancelReply() { replyingTo = null; document.getElementById('reply-container').classList.add('hidden'); }

function startDM(recipientId, recipientUsername) {
    if (!dmTabs[recipientId]) {
        dmTabs[recipientId] = { chat: document.createElement('div'), title: recipientUsername };
        dmTabs[recipientId].chat.className = 'chat-content';
        const li = document.createElement('li');
        li.innerHTML = `<button class="w-full text-left px-2 py-1 bg-gray-200 rounded hover:bg-blue-100" data-dm="${recipientId}" onclick="switchTab('${recipientId}', 'dm')">${recipientUsername}</button>`;
        document.getElementById('dm-list').appendChild(li);
    }
    switchTab(recipientId, 'dm');
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
        }
    });
}

function switchTab(tabId, type = 'channel') {
    activeTab = type === 'channel' ? tabId : type === 'group' ? `group-${tabId}` : `dm-${tabId}`;
    document.querySelectorAll('#sidebar button').forEach(btn => btn.classList.remove('bg-blue-200'));
    document.querySelector(`[data-${type}="${tabId}"]`)?.classList.add('bg-blue-200');
    document.getElementById('chat-title').textContent = type === 'channel' ? `#${tabId}` : type === 'group' ? (groupTabs[tabId]?.title || 'Group') : dmTabs[tabId]?.title || 'DM';
    document.getElementById('chat-area').innerHTML = '<div class="chat-content"></div>';
    fetchMessages(activeTab);
    socket.emit(type === 'channel' ? 'join channel' : 'join group', type === 'channel' ? tabId : tabId);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const msg = { username, text, color: userColor, language: userLanguage, senderId: userId, profilePicture };
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
}

function sendImage() {
    const file = document.getElementById('image-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { username, image: reader.result, color: userColor, senderId: userId, profilePicture };
        if (replyingTo) { msg.replyTo = replyingTo; cancelReply(); }
        if (activeTab.startsWith('dm-')) msg.recipientId = activeTab.replace('dm-', '');
        else if (activeTab.startsWith('group-')) msg.groupId = activeTab.replace('group-', '');
        else msg.channel = activeTab;
        socket.emit(`${msg.recipientId ? 'dm' : msg.groupId ? 'group' : 'chat'} image message`, msg);
        document.getElementById('image-input').value = '';
    };
    reader.readAsDataURL(file);
}

async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = sendAudioMessage;
    mediaRecorder.start();
    document.getElementById('record-btn').innerHTML = '<i class="fas fa-stop"></i>';
    document.getElementById('record-btn').onclick = stopRecording;
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
        const msg = { username, audio: reader.result, color: userColor, senderId: userId, profilePicture };
        if (replyingTo) { msg.replyTo = replyingTo; cancelReply(); }
        if (activeTab.startsWith('dm-')) msg.recipientId = activeTab.replace('dm-', '');
        else if (activeTab.startsWith('group-')) msg.groupId = activeTab.replace('group-', '');
        else msg.channel = activeTab;
        socket.emit(`${msg.recipientId ? 'dm' : msg.groupId ? 'group' : 'chat'} audio message`, msg);
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

function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark', isDarkMode);
}

function updateSidebar() {
    const users = Array.from(document.querySelectorAll('#user-list li')).map(li => ({ id: li.querySelector('span').onclick.toString().match(/'([^']+)'/)[1], username: li.querySelector('span').textContent }));
    document.getElementById('dm-list').innerHTML = users.map(u => `
        <li><button class="w-full text-left px-2 py-1 bg-gray-200 rounded hover:bg-blue-100" data-dm="${u.id}" onclick="switchTab('${u.id}', 'dm')">${u.username}</button></li>
    `).join('');
}

function getUsernameFromId(id) {
    return Array.from(document.querySelectorAll('#user-list li')).find(li => li.querySelector('span').onclick.toString().includes(id))?.querySelector('span').textContent || 'Unknown';
}

function updateUnreadBadges() {
    document.getElementById('unread-count').classList.toggle('hidden', !unreadCounts[activeTab]);
    document.getElementById('unread-count').textContent = unreadCounts[activeTab] || '';
    document.querySelectorAll('#channel-list button, #group-list button, #dm-list button').forEach(btn => {
        const id = btn.getAttribute(`data-${btn.closest('ul').id.includes('channel') ? 'channel' : btn.closest('ul').id.includes('group') ? 'group' : 'dm'}`);
        const badge = document.createElement('span');
        badge.className = 'bg-orange-500 text-white px-1 py-0.5 rounded-full text-xs ml-2';
        badge.textContent = unreadCounts[id] || '';
        btn.querySelector('span.badge')?.remove();
        if (unreadCounts[id]) btn.appendChild(badge.cloneNode(true));
    });
}

function playNotification() { if (!isMuted) document.getElementById('notification-sound').play(); }

function openImage(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%; max-height: 100vh;">`);
}

function toggleEmojiPicker() {
    document.getElementById('emoji-picker-container').classList.toggle('hidden');
}

async function translate(text, fromLang) {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${userLanguage}`);
    const data = await response.json();
    return data.responseData.translatedText + (fromLang !== userLanguage ? ` (${fromLang}: ${text})` : '');
}
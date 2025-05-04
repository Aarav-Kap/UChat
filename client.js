const socket = io('http://localhost:10000', { withCredentials: true, transports: ['websocket', 'polling'] });
let username, userColor, userLanguage, userId, profilePicture, activeTab = 'Main Hall', dmTabs = {}, groupTabs = {}, replyingTo = null, currentCallRecipient = null, isCalling = false, groupCall = null;
let localStream, remoteStream, peerConnection, mediaRecorder, audioChunks = [];
const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }] };

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('/user', { credentials: 'include' });
    if (!response.ok) return window.location.href = '/';
    const data = await response.json();
    username = data.username; userColor = data.color; userLanguage = data.language; userId = data.userId; profilePicture = data.profilePicture;
    document.getElementById('chat-title').textContent = `#${activeTab}`;
    loadInitialContent();
    socket.emit('join channel', activeTab);
});

function loadInitialContent() {
    fetchMessages(activeTab);
    socket.emit('get user list');
}

socket.on('channels', channels => {
    const channelList = document.getElementById('channel-list');
    channelList.innerHTML = channels.map(channel => `
        <li><button class="w-full bg-blue-700 text-white p-2 rounded-md hover:bg-blue-600 ${channel === activeTab ? 'bg-red-600' : ''}" onclick="switchTab('${channel}')">#${channel}</button></li>
    `).join('');
});

socket.on('groups', groups => {
    const groupList = document.getElementById('group-list');
    groupList.innerHTML = groups.map(group => `
        <li><button class="w-full bg-blue-700 text-white p-2 rounded-md hover:bg-blue-600" onclick="switchTab('${group._id}', 'group')">${group.name}</button></li>
    `).join('');
});

socket.on('user list', users => {
    const dmList = document.getElementById('dm-list');
    dmList.innerHTML = users.filter(u => u.userId !== userId).map(u => `
        <li class="flex items-center space-x-2">
            <button class="flex-1 bg-blue-700 text-white p-2 rounded-md hover:bg-blue-600 text-left" onclick="startDM('${u.userId}', '${u.username}')">${u.username} ${users.some(online => online.userId === u.userId) ? '(Online)' : ''}</button>
            <button onclick="callUser('${u.userId}')" class="bg-red-600 text-white p-2 rounded-md hover:bg-red-500"><i class="fas fa-phone"></i></button>
        </li>
    `).join('');
    document.getElementById('group-members').innerHTML = users.filter(u => u.userId !== userId).map(u => `<option value="${u.userId}">${u.username}</option>`).join('');
});

socket.on('channel joined', (channel) => {
    console.log(`Joined channel: ${channel}`);
    fetchMessages(channel);
});

socket.on('group joined', (groupId) => {
    console.log(`Joined group: ${groupId}`);
    fetchMessages(`group-${groupId}`);
});

socket.on('dm joined', (recipientId) => {
    console.log(`Joined DM with: ${recipientId}`);
    fetchMessages(`dm-${recipientId}`);
});

socket.on('chat message', msg => {
    if (activeTab === msg.channel) appendMessage(msg, document.getElementById('messages'));
    playNotification();
});

socket.on('group message', msg => {
    if (activeTab === msg.groupId.toString()) appendMessage(msg, document.getElementById('messages'));
    playNotification();
});

socket.on('dm message', msg => {
    const partnerId = msg.senderId.toString() === userId ? msg.recipientId.toString() : msg.senderId.toString();
    if (!dmTabs[partnerId]) startDM(partnerId, msg.username === username ? getUsernameFromId(partnerId) : msg.username);
    if (activeTab === `dm-${partnerId}`) appendMessage(msg, document.getElementById('messages'));
    playNotification();
});

socket.on('image message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId.toString() === userId ? msg.recipientId.toString() : msg.senderId.toString()}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendImageMessage(msg, document.getElementById('messages'));
    playNotification();
});

socket.on('audio message', msg => {
    const target = msg.recipientId ? `dm-${msg.senderId.toString() === userId ? msg.recipientId.toString() : msg.senderId.toString()}` : msg.groupId ? msg.groupId.toString() : msg.channel;
    if (activeTab === target) appendAudioMessage(msg, document.getElementById('messages'));
    playNotification();
});

socket.on('typing', data => {
    if (activeTab === data.channel || (activeTab === `group-${data.groupId}`) || (data.recipientId && activeTab === `dm-${data.recipientId}`)) {
        document.getElementById('typing-indicator').textContent = `${data.username} is typing...`;
    }
});

socket.on('stop typing', data => {
    if (activeTab === data.channel || (activeTab === `group-${data.groupId}`) || (data.recipientId && activeTab === `dm-${data.recipientId}`)) {
        document.getElementById('typing-indicator').textContent = '';
    }
});

socket.on('call-made', async data => {
    if (isCalling || groupCall) { socket.emit('call-rejected', { to: data.from }); return; }
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

socket.on('group-call-made', async data => {
    if (isCalling || groupCall) { socket.emit('group-call-rejected', { to: data.from, groupId: data.groupId }); return; }
    groupCall = { groupId: data.groupId, peers: {} };
    document.getElementById('call-status').textContent = `Incoming group call from ${data.from}...`;
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('accept-call').onclick = async () => { await acceptGroupCall(data); };
    document.getElementById('decline-call').onclick = () => { socket.emit('group-call-rejected', { to: data.from, groupId: data.groupId }); document.getElementById('call-modal').style.display = 'none'; };
});

socket.on('group-answer-made', async data => {
    const peer = groupCall.peers[data.from];
    if (peer) await peer.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In group call for group ${groupCall.groupId}`;
});

socket.on('group-ice-candidate', async data => {
    const peer = groupCall.peers[data.from];
    if (peer && data.candidate) await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
});

socket.on('group-call-rejected', data => { alert('Group call declined by a member.'); endGroupCall(); });
socket.on('group-hang-up', data => endGroupCall());

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
    if (isCalling || groupCall) { alert('Already in a call.'); return; }
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

async function startGroupCall() {
    if (isCalling || groupCall) { alert('Already in a call.'); return; }
    const groupId = activeTab.replace('group-', '');
    const members = Array.from(document.querySelectorAll('#group-members option')).map(opt => opt.value);
    if (!members.length) return alert('No members to call.');
    groupCall = { groupId, peers: {} };
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    remoteStream = new MediaStream();
    document.getElementById('remote-audio').srcObject = remoteStream;
    for (const memberId of members) {
        const peer = new RTCPeerConnection(configuration);
        localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
        peer.ontrack = event => remoteStream.addTrack(event.track);
        peer.onicecandidate = event => event.candidate && socket.emit('group-ice-candidate', { candidate: event.candidate, to: memberId, groupId });
        peer.oniceconnectionstatechange = () => { if (peer.iceConnectionState === 'disconnected') endGroupCall(); };
        groupCall.peers[memberId] = peer;
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit('group-call', { offer, members, groupId });
    }
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In group call for group ${groupId}`;
}

async function acceptGroupCall(data) {
    document.getElementById('call-modal').style.display = 'none';
    groupCall = { groupId: data.groupId, peers: {} };
    const peer = new RTCPeerConnection(configuration);
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    remoteStream = new MediaStream();
    document.getElementById('remote-audio').srcObject = remoteStream;
    peer.ontrack = event => remoteStream.addTrack(event.track);
    peer.onicecandidate = event => event.candidate && socket.emit('group-ice-candidate', { candidate: event.candidate, to: data.from, groupId: data.groupId });
    peer.oniceconnectionstatechange = () => { if (peer.iceConnectionState === 'disconnected') endGroupCall(); };
    groupCall.peers[data.from] = peer;
    await peer.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('group-answer', { answer, to: data.from, groupId: data.groupId });
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In group call for group ${data.groupId}`;
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

function endGroupCall() {
    if (groupCall) {
        Object.values(groupCall.peers).forEach(peer => peer.close());
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        if (remoteStream) remoteStream.getTracks().forEach(track => track.stop());
        Object.keys(groupCall.peers).forEach(memberId => socket.emit('group-hang-up', { to: memberId, groupId: groupCall.groupId }));
        groupCall = null;
        localStream = null; remoteStream = null;
        document.getElementById('call-interface').style.display = 'none';
        document.getElementById('remote-audio').srcObject = null;
    }
}

function hangUp() {
    if (currentCallRecipient) socket.emit('hang-up', { to: currentCallRecipient });
    else if (groupCall) endGroupCall();
    endCall();
}

async function fetchMessages(tab) {
    const messages = document.getElementById('messages');
    messages.innerHTML = '';
    const params = tab.startsWith('dm-') ? `recipientId=${tab.replace('dm-', '')}` : tab.startsWith('group-') ? `groupId=${tab.replace('group-', '')}` : `channel=${tab}`;
    const response = await fetch(`/messages?${params}`, { credentials: 'include' });
    const data = await response.json();
    data.forEach(msg => {
        if (msg.type === 'text') appendMessage(msg, messages);
        else if (msg.type === 'image') appendImageMessage(msg, messages);
        else if (msg.type === 'audio') appendAudioMessage(msg, messages);
    });
    messages.scrollTop = messages.scrollHeight;
}

function appendMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId.toString() === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username" style="color: ${msg.color || userColor}">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Media';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><span>${msg.content}</span></div>
            <div class="actions">
                <button onclick="translateMessage('${msg._id}', '${msg.content}')">Translate</button>
                <button onclick="startReply('${msg._id}')">Reply</button>
            </div>
        </div>
    `;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendImageMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId.toString() === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username" style="color: ${msg.color || userColor}">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Image';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><img src="${msg.content}" alt="Image" class="chat-image" onclick="openImage('${msg.content}')"></div>
            <div class="actions">
                <button onclick="startReply('${msg._id}')">Reply</button>
            </div>
        </div>
    `;
    div.innerHTML = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function appendAudioMessage(msg, container) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId.toString() === userId ? 'sent' : 'received'}`;
    div.dataset.messageId = msg._id;
    let content = `
        <div class="flex items-center space-x-2">
            <img src="${msg.profilePicture || 'https://via.placeholder.com/24'}" alt="${msg.username}" class="w-6 h-6 rounded-full">
            <span class="username" style="color: ${msg.color || userColor}">${msg.username === username ? 'You' : msg.username}</span>
        </div>
    `;
    if (msg.replyTo) {
        const repliedMsg = document.querySelector(`[data-message-id="${msg.replyTo}"]`);
        const repliedText = repliedMsg?.querySelector('.message-body span')?.textContent || 'Audio';
        content += `<div class="reply-ref">Replying to ${repliedMsg?.querySelector('.username').textContent || 'Unknown'}: ${repliedText}</div>`;
    }
    content += `
        <div class="message-content">
            <div class="message-body"><audio controls src="${msg.content}"></audio></div>
            <div class="actions">
                <button onclick="startReply('${msg._id}')">Reply</button>
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
    document.getElementById('reply-container').style.display = 'flex';
    document.getElementById('message-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-container').style.display = 'none';
}

function startDM(recipientId, recipientUsername) {
    if (!dmTabs[recipientId]) {
        dmTabs[recipientId] = { title: recipientUsername };
        socket.emit('join dm', recipientId);
    }
    switchTab(recipientId, 'dm');
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
        socket.emit('join group', data.groupId);
        document.getElementById('group-name').value = '';
        document.getElementById('group-members').selectedIndex = -1;
        toggleGroupCreation();
    }
}

function switchTab(tabId, type = 'channel') {
    activeTab = type === 'channel' ? tabId : type === 'group' ? `group-${tabId}` : `dm-${tabId}`;
    document.getElementById('chat-title').textContent = type === 'channel' ? `#${tabId}` : type === 'group' ? (groupTabs[tabId]?.title || 'Group') : dmTabs[tabId]?.title || 'DM';
    document.getElementById('group-call-btn').style.display = type === 'group' ? 'block' : 'none';
    if (type === 'channel') socket.emit('join channel', tabId);
    else if (type === 'group') socket.emit('join group', tabId);
    else if (type === 'dm') socket.emit('join dm', tabId);
    fetchMessages(activeTab);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const msg = { username, text, senderId: userId, profilePicture, color: userColor };
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
    socket.emit('stop typing', { channel: activeTab, groupId: activeTab.startsWith('group-') ? activeTab.replace('group-', '') : null, recipientId: activeTab.startsWith('dm-') ? activeTab.replace('dm-', '') : null, senderId: userId });
}

function sendImage() {
    const file = document.getElementById('image-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const msg = { username, image: reader.result, senderId: userId, profilePicture, color: userColor };
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
        const msg = { username, audio: reader.result, senderId: userId, profilePicture, color: userColor };
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

function playNotification() {
    document.getElementById('notification-sound').play();
}

function openImage(src) {
    const win = window.open('');
    win.document.write(`<img src="${src}" style="max-width: 100%; max-height: 100vh;">`);
}

function toggleEmojiPicker() {
    document.getElementById('emoji-picker-container').classList.toggle('hidden');
}

function getUsernameFromId(id) {
    return Array.from(document.querySelectorAll('#dm-list button')).find(btn => btn.onclick.toString().includes(id))?.textContent.split(' ')[0] || 'Unknown';
}
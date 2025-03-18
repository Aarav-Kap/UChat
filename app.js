const socket = io({ query: { userId: '' } }); // Will set userId after fetching user data
let username = '', userColor = '#1E90FF', userLanguage = 'en', userId = '', activeTab = 'main', dmTabs = {}, replyTo = null;
let isMuted = false;
let localStream, remoteStream, peerConnection;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Session check on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/user', {
            method: 'GET',
            credentials: 'include'
        });
        if (response.ok) {
            initializeUser();
        } else {
            window.location.href = '/login.html';
        }
    } catch (err) {
        showError('Failed to connect to the server. Please check your internet connection and try again.');
        setTimeout(() => window.location.href = '/login.html', 3000);
    }
});

function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => errorDiv.style.display = 'none', 3000);
}

function initializeUser() {
    fetch('/user', { credentials: 'include' })
        .then(res => {
            if (!res.ok) throw new Error('Not logged in');
            return res.json();
        })
        .then(data => {
            username = data.username;
            userColor = data.color;
            userLanguage = data.language;
            userId = data.userId;
            socket.io.opts.query = { userId }; // Update socket query with userId
            socket.connect(); // Reconnect socket with updated query
            document.getElementById('current-username').textContent = `Welcome, ${username}`;
            document.getElementById('language-select').value = userLanguage;
            socket.emit('chat message', { username: 'System', text: `${username} has joined`, language: 'en', id: Date.now().toString() });
            loadHistory();
        })
        .catch(err => {
            showError('Failed to load user data. Redirecting to login...');
            setTimeout(() => window.location.href = '/login.html', 3000);
        });
}

socket.on('user list', users => {
    const ul = document.getElementById('user-list');
    ul.innerHTML = users
        .filter(u => u.username !== username)
        .map(u => `
            <li style="color: ${u.color}">
                <span onclick="startDM('${u.userId}', '${u.username}')">${u.username}</span>
                <button onclick="callUser('${u.userId}')">Call</button>
            </li>
        `)
        .join('');
    document.getElementById('user-count').textContent = users.length;
});

socket.on('chat message', msg => {
    handleMessage(msg, document.getElementById('chat-area').querySelector('.chat-content'), false);
    playNotification();
});

socket.on('dm message', msg => {
    const conversationPartnerId = msg.senderId === userId ? msg.recipientId : msg.senderId;
    let tab = dmTabs[conversationPartnerId];
    if (!tab) {
        const recipientUsername = msg.username === username ? getRecipientUsername(conversationPartnerId) : msg.username;
        createDMTab(conversationPartnerId, recipientUsername);
        tab = dmTabs[conversationPartnerId];
    }
    if (!document.querySelector(`.message[data-id="${msg.id}"]`)) {
        handleMessage({ ...msg, color: msg.username === username ? userColor : msg.color }, tab.chat, true);
        playNotification();
    }
});

socket.on('call-made', async data => {
    const callModal = document.getElementById('call-modal');
    const callStatus = document.getElementById('call-status');
    callStatus.textContent = `${data.fromUsername} is calling you...`;
    callModal.style.display = 'block';

    document.getElementById('accept-call').onclick = async () => {
        callModal.style.display = 'none';
        await setupPeerConnection(data.from);
        peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('make-answer', {
            answer,
            to: data.from,
            from: userId
        });
        document.getElementById('call-interface').style.display = 'block';
        document.getElementById('call-with').textContent = `In call with ${data.fromUsername}`;
    };

    document.getElementById('decline-call').onclick = () => {
        callModal.style.display = 'none';
        socket.emit('call-rejected', { to: data.from, from: userId });
    };
});

socket.on('answer-made', async data => {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    document.getElementById('call-interface').style.display = 'block';
    document.getElementById('call-with').textContent = `In call with ${data.fromUsername || 'User'}`;
});

socket.on('ice-candidate', async data => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

socket.on('call-rejected', data => {
    alert('Call was declined.');
    endCall();
});

socket.on('hang-up', data => {
    endCall();
});

socket.on('typing', data => {
    updateTypingIndicator(data.username, data.tab);
});

socket.on('stop typing', data => {
    updateTypingIndicator('', data.tab);
});

socket.on('name change', data => {
    if (data.oldUsername === username) username = data.newUsername;
    document.getElementById('current-username').textContent = `Welcome, ${username}`;
    showSystemMessage(`${data.oldUsername} changed to ${data.newUsername}`);
});

socket.on('color change', data => {
    if (data.id === socket.id) {
        userColor = data.color;
    }
    document.querySelectorAll('.message').forEach(msg => {
        if (msg.dataset.senderId === data.id) {
            msg.style.setProperty('--username-color', data.color);
        }
    });
});

async function callUser(recipientId) {
    await setupPeerConnection(recipientId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-user', {
        offer,
        to: recipientId,
        from: userId
    });
}

async function setupPeerConnection(recipientId) {
    peerConnection = new RTCPeerConnection(configuration);

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    remoteStream = new MediaStream();
    document.getElementById('remote-audio').srcObject = remoteStream;
    peerConnection.ontrack = event => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                to: recipientId,
                from: userId
            });
        }
    };
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    document.getElementById('call-interface').style.display = 'none';
    document.getElementById('remote-audio').srcObject = null;
}

function hangUp() {
    const recipientId = Object.keys(dmTabs)[0] || '';
    socket.emit('hang-up', { to: recipientId, from: userId });
    endCall();
}

function handleMessage(msg, chat, isDM) {
    const div = document.createElement('div');
    div.className = `message ${msg.username === username ? 'sent' : 'received'}`;
    div.dataset.id = msg.id;
    div.dataset.senderId = msg.senderId;
    div.style.setProperty('--username-color', msg.color);

    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'username';
    usernameSpan.textContent = msg.username === username ? 'You' : msg.username;
    div.appendChild(usernameSpan);

    let text = msg.text || '';
    if (msg.language && msg.language !== userLanguage && text && !msg.image && !msg.video) {
        fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${msg.language}|${userLanguage}`)
            .then(res => res.json())
            .then(data => {
                if (data.responseStatus === 200) {
                    text = data.responseData.translatedText;
                }
                updateMessageContent(div, text, msg.image, msg.video);
            })
            .catch(() => updateMessageContent(div, text, msg.image, msg.video));
    } else {
        updateMessageContent(div, text, msg.image, msg.video);
    }

    if (msg.replyTo) {
        const reply = document.createElement('div');
        reply.className = 'reply-context';
        reply.innerHTML = `<span class="reply-username">${msg.replyTo.username}</span><span class="reply-text">${msg.replyTo.text}</span>`;
        div.insertAdjacentElement('afterbegin', reply);
    }

    if (msg.language && msg.language !== userLanguage && text && !msg.image && !msg.video) {
        const orig = document.createElement('div');
        orig.className = 'meta';
        orig.textContent = `(${msg.language}: ${msg.text})`;
        div.appendChild(orig);
    }

    const replyBtn = document.createElement('span');
    replyBtn.textContent = 'Reply';
    replyBtn.className = 'meta';
    replyBtn.style.color = '#4ecdc4';
    replyBtn.onclick = () => setReply(msg);
    div.appendChild(replyBtn);

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    saveMessage(msg, isDM ? getRecipientId(chat) : null);
}

function updateMessageContent(div, text, image, video) {
    const contentSpan = document.createElement('span');
    if (image) {
        contentSpan.innerHTML = `<img src="${image}" alt="Image">`;
    } else if (video) {
        contentSpan.innerHTML = `<video controls src="${video}"></video>`;
    } else {
        contentSpan.textContent = text;
    }
    div.appendChild(contentSpan);
}

function getRecipientId(chat) {
    return Object.keys(dmTabs).find(id => dmTabs[id].chat === chat);
}

function getRecipientUsername(id) {
    const user = Array.from(document.querySelectorAll('#user-list li'))
        .find(li => li.onclick.toString().includes(id));
    return user ? user.textContent : 'Unknown';
}

function updateTypingIndicator(username, tab) {
    if (tab !== activeTab) return;
    const indicator = document.getElementById('typing-indicator');
    indicator.textContent = username ? `${username} is typing...` : '';
}

function showSystemMessage(text) {
    const chat = document.getElementById('chat-area').querySelector('.chat-content');
    const div = document.createElement('div');
    div.className = 'meta';
    div.style.color = '#7f8c8d';
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function startDM(recipientId, recipientUsername) {
    if (!dmTabs[recipientId]) {
        createDMTab(recipientId, recipientUsername);
    }
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
    dmTab.innerHTML = `<div id="chat-${recipientId}" class="chat-content"></div>`;
    document.getElementById('dm-tabs').appendChild(dmTab);

    dmTabs[recipientId] = {
        chat: document.getElementById(`chat-${recipientId}`),
        button: tabBtn
    };
    loadDMHistory(recipientId);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.chat-area').forEach(area => area.classList.remove('active'));

    const tabButton = document.querySelector(`.tab-button[data-tab="${tabId}"]`);
    if (tabButton) tabButton.classList.add('active');

    const chatArea = tabId === 'main' ? document.getElementById('chat-area') : document.getElementById(tabId);
    if (chatArea) {
        chatArea.classList.add('active');
        const chatContent = chatArea.querySelector('.chat-content');
        chatContent.scrollTop = chatContent.scrollHeight;
    }

    activeTab = tabId;
    const input = document.getElementById('message-input');
    const recipientId = tabId.startsWith('dm-') ? tabId.replace('dm-', '') : '';
    input.dataset.recipient = recipientId;
    input.placeholder = recipientId ? `DM to ${getRecipientUsername(recipientId)}...` : 'Type a message...';
    replyTo = null;
    updateTypingIndicator('', tabId);
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    const recipientId = input.dataset.recipient || '';
    const msg = {
        username,
        text,
        color: userColor,
        language: userLanguage,
        id: Date.now().toString(),
        senderId: userId
    };
    if (replyTo) {
        msg.replyTo = { username: replyTo.username, text: replyTo.text };
        replyTo = null;
    }
    if (recipientId) {
        msg.recipientId = recipientId;
        socket.emit('dm message', msg);
    } else {
        socket.emit('chat message', msg);
    }
    input.value = '';
    socket.emit('stop typing', { tab: activeTab });
}

function sendMedia() {
    const file = document.getElementById('media-input').files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const msg = {
            username,
            color: userColor,
            language: userLanguage,
            id: Date.now().toString(),
            senderId: userId
        };
        if (file.type.startsWith('image/')) {
            msg.image = e.target.result;
        } else if (file.type.startsWith('video/')) {
            msg.video = e.target.result;
        }
        const recipientId = document.getElementById('message-input').dataset.recipient || '';
        if (replyTo) {
            msg.replyTo = { username: replyTo.username, text: replyTo.text };
            replyTo = null;
        }
        if (recipientId) {
            msg.recipientId = recipientId;
            socket.emit('dm message', msg);
        } else {
            socket.emit('chat message', msg);
        }
        document.getElementById('media-input').value = '';
    };
    reader.readAsDataURL(file);
}

function handleTyping() {
    socket.emit('typing', { username, tab: activeTab });
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => socket.emit('stop typing', { tab: activeTab }), 1000);
}

function changeUsername() {
    const newName = prompt('New username:');
    if (newName && newName.trim()) {
        fetch('/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newUsername: newName.trim() }),
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                socket.emit('name change', { oldUsername: username, newUsername: newName.trim(), id: socket.id });
            } else {
                showError(data.error || 'Failed to change username');
            }
        })
        .catch(err => {
            if (!navigator.onLine) {
                showError('No internet connection. Please check your network and try again.');
            } else {
                showError('Error changing username');
            }
        });
    }
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
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                userColor = newColor;
                socket.emit('color change', { id: socket.id, color: newColor });
                hideColorPicker();
            } else {
                showError(data.error || 'Failed to change color');
            }
        })
        .catch(err => {
            if (!navigator.onLine) {
                showError('No internet connection. Please check your network and try again.');
            } else {
                showError('Error changing color');
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
    })
        .then(res => res.json())
        .then(data => {
            if (!data.success) showError(data.error || 'Failed to update language');
        })
        .catch(err => {
            if (!navigator.onLine) {
                showError('No internet connection. Please check your network and try again.');
            } else {
                showError('Error updating language');
            }
        });
}

function setReply(msg) {
    replyTo = msg;
    document.getElementById('message-input').placeholder = `Replying to ${msg.username}: ${msg.text.substring(0, 20)}...`;
    document.getElementById('message-input').focus();
}

function saveMessage(msg, recipientId) {
    const key = `history_${username}_${recipientId || 'main'}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    history.push(msg);
    localStorage.setItem(key, JSON.stringify(history));
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem(`history_${username}_main`) || '[]');
    history.forEach(msg => handleMessage(msg, document.getElementById('chat-area').querySelector('.chat-content'), false));
}

function loadDMHistory(recipientId) {
    const history = JSON.parse(localStorage.getItem(`history_${username}_${recipientId}`) || '[]');
    history.forEach(msg => handleMessage(msg, dmTabs[recipientId].chat, true));
}

function toggleMute() {
    isMuted = !isMuted;
    document.querySelector('#sidebar button:nth-child(5)').textContent = `Toggle Mute (${isMuted ? 'Muted' : 'Unmuted'})`;
}

function playNotification() {
    if (!isMuted) {
        const audio = document.getElementById('notification-sound');
        audio.play().catch(err => console.log('Audio play failed:', err));
    }
}
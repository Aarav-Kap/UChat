// MessageInput.js
import { useState, useRef } from 'react';

export default function MessageInput({ socket, user, activeTab }) {
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const sendMessage = () => {
    if (!message) return;
    const msg = { username: user.username, content: message, senderId: user.userId, type: 'text' };
    if (activeTab.startsWith('dm-')) msg.recipientId = activeTab.replace('dm-', '');
    else if (activeTab.startsWith('group-')) msg.groupId = activeTab.replace('group-', '');
    else msg.channel = activeTab;
    socket.emit('chat message', msg);
    setMessage('');
  };

  return (
    <div style={{ padding: '10px', background: '#40444b', display: 'flex', gap: '10px' }}>
      <input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
        style={{ flex: 1, padding: '10px', background: '#1e2124', border: 'none', borderRadius: '4px', color: '#fff' }}
      />
      <button onClick={sendMessage} style={{ padding: '10px', background: '#5865f2', color: '#fff', border: 'none', borderRadius: '4px' }}>
        Send
      </button>
    </div>
  );
}
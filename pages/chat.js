// chat.js
import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import UserList from './UserList';
import MessageInput from './MessageInput';

export default function Chat() {
  const [user, setUser] = useState(null);
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeTab, setActiveTab] = useState('General');
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const socketRef = useRef();

  useEffect(() => {
    const fetchUser = async () => {
      const res = await fetch('http://localhost:3001/user', { credentials: 'include' });
      const data = await res.json();
      setUser(data);
    };
    fetchUser();

    socketRef.current = io('http://localhost:3001', { withCredentials: true });

    socketRef.current.on('channels', (data) => setChannels(data));
    socketRef.current.on('groups', (data) => setGroups(data));
    socketRef.current.on('user list', (data) => setUsers(data));
    socketRef.current.on('chat message', (msg) => setMessages((prev) => [...prev, msg]));
    socketRef.current.on('group message', (msg) => setMessages((prev) => [...prev, msg]));
    socketRef.current.on('dm message', (msg) => setMessages((prev) => [...prev, msg]));
    socketRef.current.on('image message', (msg) => setMessages((prev) => [...prev, msg]));
    socketRef.current.on('audio message', (msg) => setMessages((prev) => [...prev, msg]));

    return () => socketRef.current.disconnect();
  }, []);

  const switchTab = (tab, type = 'channel') => {
    setActiveTab(type === 'channel' ? tab : type === 'group' ? `group-${tab}` : `dm-${tab}`);
    socketRef.current.emit(type === 'channel' ? 'join channel' : type === 'group' ? 'join group' : 'join dm', tab);
    setMessages([]);
  };

  if (!user) return <div style={{ color: '#fff', textAlign: 'center', padding: '20px' }}>Loading...</div>;

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#2f3136' }}>
      <div style={{ width: '72px', background: '#202225', padding: '10px 0', transition: 'width 0.3s ease' }}>
        <div style={{ color: '#fff', textAlign: 'center', marginBottom: '20px' }}>Uchat</div>
        <button onClick={() => switchTab('General')} style={{ width: '100%', padding: '10px', color: '#b9bbbe' }}>Channels</button>
        <button onClick={() => switchTab(groups[0]?._id, 'group')} style={{ width: '100%', padding: '10px', color: '#b9bbbe' }}>Groups</button>
        <button onClick={() => switchTab(users[0]?.userId, 'dm')} style={{ width: '100%', padding: '10px', color: '#b9bbbe' }}>DMs</button>
      </div>
      <div style={{ flex: 1, display: 'flex' }}>
        <div style={{ width: '240px', background: '#2f3136' }}>
          {channels.map((channel) => (
            <button key={channel} onClick={() => switchTab(channel)} style={{ width: '100%', padding: '5px 10px', color: '#b9bbbe' }}>
              #{channel}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, background: '#36393f', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px', color: '#fff' }}>{`#${activeTab}`}</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {messages.map((msg) => (
              <div key={msg._id} style={{ marginBottom: '10px', color: '#fff' }}>{msg.content}</div>
            ))}
          </div>
          <MessageInput socket={socketRef.current} user={user} activeTab={activeTab} />
        </div>
        <UserList users={users} />
      </div>
    </div>
  );
}

export async function getServerSideProps({ req, res }) {
  const cookie = req.headers.cookie;
  if (!cookie) return { redirect: { destination: '/', permanent: false } };
  return { props: {} };
}
// index.js
import { useState } from 'react';

export default function Home() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isLogin ? '/api/login' : '/api/register';
    const res = await fetch(`http://localhost:3001${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success) window.location.href = '/chat';
    else setError(data.error || 'Something went wrong');
  };

  return (
    <div style={{ background: '#2f3136', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ background: '#36393f', padding: '2rem', borderRadius: '8px', width: '350px' }}>
        <h2 style={{ color: '#fff', textAlign: 'center' }}>Uchat</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ color: '#b9bbbe' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', background: '#40444b', border: 'none', borderRadius: '4px', color: '#fff' }}
            />
          </div>
          <div>
            <label style={{ color: '#b9bbbe' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', background: '#40444b', border: 'none', borderRadius: '4px', color: '#fff' }}
            />
          </div>
          <button type="submit" style={{ padding: '0.75rem', background: '#5865f2', color: '#fff', border: 'none', borderRadius: '4px' }}>
            {isLogin ? 'Login' : 'Register'}
          </button>
          <button type="button" onClick={() => setIsLogin(!isLogin)} style={{ padding: '0.75rem', background: 'transparent', color: '#00aff4', border: 'none' }}>
            {isLogin ? 'Need an account? Register' : 'Back to Login'}
          </button>
          {error && <p style={{ color: '#ff5555', textAlign: 'center' }}>{error}</p>}
        </form>
      </div>
    </div>
  );
}

export async function getServerSideProps() {
  return { props: {} };
}
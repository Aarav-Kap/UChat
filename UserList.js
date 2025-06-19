// UserList.js
import React from 'react';

export default function UserList({ users }) {
  return (
    <div style={{ width: '240px', background: '#2f3136', padding: '10px', color: '#b9bbbe' }}>
      <h3>Online Users</h3>
      {users.map((user) => (
        <div key={user.userId} style={{ padding: '5px 0' }}>
          {user.username} <span style={{ color: '#43b581' }}>●</span>
        </div>
      ))}
    </div>
  );
}
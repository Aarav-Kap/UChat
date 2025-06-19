// api_logout.js
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const response = await fetch('http://localhost:3001/logout', { credentials: 'include' });
  const data = await response.json();
  res.status(response.status).json(data);
}
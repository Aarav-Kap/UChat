UChat
A simple, modern web-based chat app with a main channel and direct messages, styled like Discord/Instagram. Built with Express, Socket.IO, and Tailwind CSS. All files are in a single directory.
Features

User authentication (login/register)
One public channel ("General")
Direct messages (DMs)
Sleek, responsive UI (dark theme)
Real-time chat (no message persistence)

Prerequisites

Node.js (v16 or higher)
Render account (for deployment)

Setup Instructions
Local Testing

Navigate to Directory

Open Git Bash:cd ~/OneDrive/Desktop/United\ Project




Clear Old Files

Remove existing files to avoid conflicts:rm -f server.js package.json style.css app.js login.html register.html chat.html README.md




Create Files

Create new files:touch server.js package.json style.css app.js login.html register.html chat.html README.md


Copy content from each artifact into the corresponding file using a text editor (e.g., VS Code with code .).


Install Dependencies

Verify Node.js:node -v
npm -v

Install from https://nodejs.org/ (LTS) if needed.
Install:npm install




Run Server

Start:npm start


Access at http://localhost:3000.


Test App

Open http://localhost:3000 (should show login page).
Register a user (e.g., username: testuser, password: test123).
Log in (should redirect to /chat with dark UI).
Test:
Send messages in "#General".
Register another user in a new tab, start a DM.
Check mobile view (F12, device toolbar).


Messages clear on server restart.



Deployment on Render

Create Git Repository

Initialize:git init
touch .gitignore


Add to .gitignore:node_modules/
.env


Commit:git add .
git commit -m "Initial UChat commit"
git remote add origin <your-github-repo-url>
git branch -M main
git push -u origin main




Create Render Project

Log in to Render (https://render.com/), create a Web Service.
Connect GitHub repository.
Configure:
Name: e.g., uchat-simple
Runtime: Node
Build Command: npm install
Start Command: npm start
Environment Variables:
NODE_ENV=production
PORT=3000






Update Socket.IO URL

In app.js, update:const socket = io('https://uchat-simple.onrender.com');


Commit:git add app.js
git commit -m "Update Socket.IO URL"
git push




Deploy

Access at https://uchat-simple.onrender.com.



Debug Tips

Login Page Not Showing:
Browser console (F12):
Check for Redirecting from / to /login, Serving login page.
Failed to fetch: Server not running.


Terminal:
Look for Server running on port 3000.
No Serving login page: Route issue.


Fixes:
Ensure npm start is running.
Clear browser cache (F12, Application > Clear storage).




Blank or Wrong UI:
Verify CDN links (Tailwind, Font Awesome) load (Network tab).
Check style.css at http://localhost:3000/style.css.
Ensure chat.html includes <script src="/app.js"></script>.
Fix: Reload in incognito or clear cache.


Chat Not Working:
Console errors for Socket.IO (WS tab).
Ensure server logs show join/send messages.


General:
Test in Chrome incognito.
Share console/terminal logs if issues persist.



Notes

Messages are not saved (clear on server restart).
No database or complex features.
For help, check Express (https://expressjs.com/) or Socket.IO (https://socket.io/) docs.


UChat (Simplified)
A lightweight web-based chat app with username entry, color selection, DMs, and voice messages.
Features

Username input (no login)
Chat color customization
Main channel ("General") and DMs
Text and voice message support
Basic profanity filter
Dark-themed, responsive UI
No persistence

Prerequisites

Node.js (v16 or higher)
Git and GitHub account

Setup Instructions
Local Testing

Navigate

Open Git Bash:cd ~/OneDrive/Desktop/United\ Project




Clear Old Files

Remove existing files:rm -f server.js package.json style.css app.js index.html README.md




Create Files

Create new files:touch server.js package.json style.css app.js index.html README.md


Copy content from artifacts into each file using a text editor (e.g., code .).


Install Dependencies

Verify Node.js:node -v
npm -v


Install:npm install




Run Server

Start:npm start


Access at http://localhost:3000.


Test

Enter a username (e.g., User1).
Select a color, send text/voice messages.
Test DMs with another tab/user.



GitHub Push

Initialize Git

If not initialized:git init
touch .gitignore
echo "node_modules/" > .gitignore
git add .
git commit -m "Initial simplified commit"




Create Repository

On GitHub, create a new repo (e.g., UChat-Simplified).
Link:git remote add origin https://github.com/yourusername/UChat-Simplified.git
git push -u origin main




Push Changes

After updates:git add .
git commit -m "Describe changes"
git push





Debug Tips

No Messages: Check console for Socket.IO errors, ensure server runs.
No DMs: Verify multiple users are connected.
UI Issues: Ensure CDNs load, clear cache.
Share console/terminal logs for help.


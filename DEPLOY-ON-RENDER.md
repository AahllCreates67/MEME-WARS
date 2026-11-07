# Deploy MEME WARS on Render

This project serves both the website (`public/`) and Socket.IO multiplayer server from one Node.js service. Netlify is not required.

1. Upload the contents of this folder to a GitHub repository (do not upload `node_modules`).
2. In Render, choose **New > Blueprint** and connect that GitHub repository.
3. Render detects `render.yaml`; review and create the `meme-wars` web service.
4. Wait for the deploy to finish, then open the `onrender.com` URL.
5. Test `/api/info`, create a room, and join from a second device/browser.

The free Render service may spin down after inactivity, so the first visit after a quiet period can take longer. Check current Render plan limits before relying on it for continuous availability.

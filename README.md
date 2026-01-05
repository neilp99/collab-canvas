# CollabCanvas - Real-Time Collaborative Whiteboard

A real-time collaborative canvas application with integrated video/audio communication, built with Node.js, Socket.io, Fabric.js, and WebRTC.

## Features

- 🎨 **Canvas Drawing Tools**: Pen, eraser, colors, brush sizes
- 📝 **Sticky Notes**: Create, edit, and move sticky notes
- 👥 **Real-Time Collaboration**: Multiple users can draw simultaneously
- 🖱️ **Cursor Following**: See other users' cursors in real-time (Figma-style)
- 📹 **Video/Audio**: Integrated WebRTC for camera and microphone
- 🎙️ **Speaker Focus**: Dynamic layout for 5+ users, showing active speaker
- 🔗 **Shareable Rooms**: Join via unique 6-character room codes
- 📱 **Cross-Platform**: Works on desktop and mobile devices

## Deployment Options

### Option 1: Deploy Backend Separately (Recommended for Production)

**Why?** Vercel serverless functions have limitations with long-lived WebSocket connections. For best performance, deploy the backend on a platform that supports WebSockets.

#### Deploy Backend to Railway/Render/Heroku:

1. Push your code to GitHub
2. Sign up for [Railway](https://railway.app/) (recommended) or [Render](https://render.com/)
3. Connect your GitHub repository
4. Deploy the entire project (they'll auto-detect Node.js)
5. Note your backend URL (e.g., `https://your-app.railway.app`)

#### Deploy Frontend to Vercel:

1. Update `public/js/socket-manager.js` line 13:
   ```javascript
   // Change from:
   this.socket = io();
   // To:
   this.socket = io('https://your-backend-url.railway.app');
   ```

2. Deploy just the `public/` folder to Vercel:
   ```bash
   cd public
   vercel
   ```

### Option 2: Deploy Everything to Vercel (Simple, may have WebSocket limitations)

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Deploy:
   ```bash
   cd /Users/neil.pinto/.gemini/antigravity/scratch/collab-canvas
   vercel
   ```

3. Follow prompts and deploy

> **Note**: Vercel's serverless functions may disconnect WebSockets after 10 seconds on Hobby plan. For production, Option 1 is recommended.

### Option 3: Deploy to Render (All-in-One, Free Tier)

1. Push code to GitHub
2. Go to [Render](https://render.com/)
3. Create new **Web Service**
4. Connect repository
5. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
6. Deploy and get your URL

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start server:
   ```bash
   npm start
   ```

3. Open `http://localhost:3000`

## Test Mode (for same-device testing)

Enable mock video streams to test multiple windows on the same device:

```javascript
// In browser console
localStorage.setItem('useMockVideo', 'true');
// Then refresh
```

Each window will have a unique colored animated mock video instead of accessing your camera.

## Environment Variables (Optional)

Create `.env` file:
```
PORT=3000
NODE_ENV=production
```

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript, Fabric.js, WebRTC
- **Styling**: Custom CSS with glassmorphism
- **Real-time**: WebSockets (Socket.io)
- **P2P Video**: WebRTC with STUN servers

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari (macOS/iOS)

Requires WebRTC support for video/audio features.

## License

MIT

## Support

For issues or questions, please create an issue on GitHub.

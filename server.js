const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for rooms and their canvas states
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    let currentRoom = null;
    let currentUser = null;

    // Create a new room
    socket.on('create-room', (userData) => {
        const roomId = generateRoomId();
        const password = generateRoomPassword();
        currentRoom = roomId;
        currentUser = { id: socket.id, ...userData };

        socket.join(roomId);

        // Initialize room data
        rooms.set(roomId, {
            users: new Map([[socket.id, currentUser]]),
            canvasState: { objects: [], theme: 'dark', canvasColor: '#1a1a1a' },
            password: password,
            createdAt: Date.now()
        });

        socket.emit('room-created', { roomId, password, user: currentUser });
        console.log(`Room created: ${roomId} with password by ${socket.id}`);
    });

    // Join an existing room
    socket.on('join-room', ({ roomId, password, userData }) => {
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        // Validate password
        if (room.password !== password) {
            socket.emit('error', { message: 'Incorrect password' });
            return;
        }

        currentRoom = roomId;
        currentUser = { id: socket.id, ...userData };

        socket.join(roomId);
        room.users.set(socket.id, currentUser);

        // Send existing canvas state to new user
        socket.emit('room-joined', {
            roomId,
            user: currentUser,
            canvasState: room.canvasState,
            users: Array.from(room.users.values())
        });

        // Notify other users in the room
        socket.to(roomId).emit('user-joined', currentUser);

        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    // Canvas object added
    socket.on('canvas:object:added', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            room.canvasState.objects.push(data.object);
        }

        // Broadcast to other users in the room
        socket.to(currentRoom).emit('canvas:object:added', data);
    });

    // Canvas object modified
    socket.on('canvas:object:modified', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            const index = room.canvasState.objects.findIndex(obj => obj.id === data.object.id);
            if (index !== -1) {
                room.canvasState.objects[index] = data.object;
            }
        }

        socket.to(currentRoom).emit('canvas:object:modified', data);
    });

    // Canvas object removed
    socket.on('canvas:object:removed', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            room.canvasState.objects = room.canvasState.objects.filter(obj => obj.id !== data.objectId);
        }

        socket.to(currentRoom).emit('canvas:object:removed', data);
    });

    // Canvas cleared
    socket.on('canvas:clear', () => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            room.canvasState.objects = [];
        }

        socket.to(currentRoom).emit('canvas:clear');
    });

    // Cursor position update
    socket.on('cursor:position', (data) => {
        if (!currentRoom) return;

        socket.to(currentRoom).emit('cursor:position', {
            userId: socket.id,
            ...data
        });
    });

    // Theme change
    socket.on('theme-change', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            room.canvasState.theme = data.theme;
            if (data.color) {
                room.canvasState.canvasColor = data.color;
            }
        }

        socket.to(currentRoom).emit('theme-change', data);
    });

    // Camera enabled notification
    socket.on('camera-enabled', () => {
        if (!currentRoom) return;

        socket.to(currentRoom).emit('user-camera-enabled', {
            userId: socket.id
        });
    });

    // Camera disabled notification
    socket.on('camera-disabled', () => {
        if (!currentRoom) return;

        socket.to(currentRoom).emit('user-camera-disabled', {
            userId: socket.id
        });
    });

    // WebRTC signaling - offer
    socket.on('webrtc:offer', ({ targetUserId, offer }) => {
        io.to(targetUserId).emit('webrtc:offer', {
            fromUserId: socket.id,
            offer
        });
    });

    // WebRTC signaling - answer
    socket.on('webrtc:answer', ({ targetUserId, answer }) => {
        io.to(targetUserId).emit('webrtc:answer', {
            fromUserId: socket.id,
            answer
        });
    });

    // WebRTC signaling - ICE candidate
    socket.on('webrtc:ice-candidate', ({ targetUserId, candidate }) => {
        io.to(targetUserId).emit('webrtc:ice-candidate', {
            fromUserId: socket.id,
            candidate
        });
    });

    // Leave room
    socket.on('leave-room', () => {
        console.log(`User ${socket.id} leaving room ${currentRoom}`);

        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.users.delete(socket.id);

                // Notify other users
                socket.to(currentRoom).emit('user-left', { userId: socket.id });

                // Clean up empty rooms
                if (room.users.size === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} deleted (empty)`);
                }
            }

            socket.leave(currentRoom);
            currentRoom = null;
            currentUser = null;
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.users.delete(socket.id);

                // Notify other users
                socket.to(currentRoom).emit('user-left', { userId: socket.id });

                // Clean up empty rooms
                if (room.users.size === 0) {
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} deleted (empty)`);
                }
            }
        }
    });
});

// Generate a unique 6-character room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate a secure 6-character room password
function generateRoomPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 6; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

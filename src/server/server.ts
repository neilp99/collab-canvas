import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Serve static files from dist/client directory (built by Vite)
app.use(express.static(path.join(__dirname, '../../dist/client')));

// Types
interface User {
    id: string;
    name: string;
    color?: string;
    joinedAt?: number;
    userId?: string;
}

interface CanvasObject {
    id: string;
    [key: string]: any;
}

interface CanvasState {
    objects: CanvasObject[];
    theme: string;
    canvasColor: string;
}

interface Room {
    users: Map<string, User>;
    canvasState: CanvasState;
    password: string;
    createdAt: number;
    expiresAt: number;
    rejoinCounts: Map<string, number>;
    creatorId: string;
}

// In-memory storage for rooms and their canvas states
const rooms = new Map<string, Room>();

io.on('connection', (socket: Socket) => {
    console.log(`User connected: ${socket.id}`);

    let currentRoom: string | null = null;
    let currentUser: User | null = null;

    // Create a new room
    socket.on('create-room', (userData: Partial<User>) => {
        const roomId = generateRoomId();
        const password = generateRoomPassword();
        currentRoom = roomId;
        currentUser = { id: socket.id, ...userData } as User;

        socket.join(roomId);

        // Initialize room data with persistence
        rooms.set(roomId, {
            users: new Map([[socket.id, currentUser]]),
            canvasState: { objects: [], theme: 'dark', canvasColor: '#1a1a1a' },
            password: password,
            createdAt: Date.now(),
            expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
            rejoinCounts: new Map(),
            creatorId: socket.id
        });

        socket.emit('room-created', { roomId, password, user: currentUser });
        console.log(`Room created: ${roomId} with password by ${socket.id}`);
    });

    // Validate room before joining
    socket.on('validate-room', ({ roomId, password }: { roomId: string; password: string }) => {
        console.log(`Validating room ${roomId} for ${socket.id}`);
        const room = rooms.get(roomId);

        if (!room) {
            console.log(`Room ${roomId} not found`);
            socket.emit('room-validation-failed', {
                message: 'Room not found'
            });
            return;
        }

        if (Date.now() > room.expiresAt) {
            console.log(`Room ${roomId} has expired`);
            rooms.delete(roomId);
            socket.emit('room-validation-failed', {
                message: 'Room has expired (24 hour limit)'
            });
            return;
        }

        if (room.password !== password) {
            console.log(`Incorrect password for room ${roomId}`);
            socket.emit('room-validation-failed', {
                message: 'Incorrect password'
            });
            return;
        }

        console.log(`Room ${roomId} validation successful`);
        socket.emit('room-validation-success');
    });

    // Join an existing room
    socket.on('join-room', ({ roomId, password, userData }: { roomId: string; password: string; userData: Partial<User> }) => {
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: 'Room not found or expired' });
            return;
        }

        if (Date.now() > room.expiresAt) {
            console.log(`Room ${roomId} has expired`);
            rooms.delete(roomId);
            socket.emit('error', { message: 'Room has expired (24 hour limit)' });
            return;
        }

        if (room.password !== password) {
            socket.emit('error', { message: 'Incorrect password' });
            return;
        }

        const userIdToTrack = userData.userId || socket.id;
        const rejoinCount = room.rejoinCounts.get(userIdToTrack) || 0;

        if (rejoinCount >= 3) {
            console.log(`User ${userIdToTrack} exceeded rejoin limit for room ${roomId}`);
            socket.emit('error', {
                message: 'Maximum rejoin limit reached (3 attempts)'
            });
            return;
        }

        currentRoom = roomId;
        currentUser = { id: socket.id, ...userData } as User;

        socket.join(roomId);
        room.users.set(socket.id, currentUser);

        if (rejoinCount > 0 || room.rejoinCounts.has(userIdToTrack)) {
            room.rejoinCounts.set(userIdToTrack, rejoinCount + 1);
            console.log(`User ${userIdToTrack} rejoined room ${roomId} (attempt ${rejoinCount + 1}/3)`);
        } else {
            room.rejoinCounts.set(userIdToTrack, 0);
        }

        socket.emit('room-joined', {
            roomId,
            user: currentUser,
            canvasState: room.canvasState,
            users: Array.from(room.users.values()),
            rejoinCount: room.rejoinCounts.get(userIdToTrack)
        });

        socket.to(roomId).emit('user-joined', currentUser);
        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    // Canvas object added
    socket.on('canvas:object:added', (data: { object: CanvasObject }) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (room) {
            room.canvasState.objects.push(data.object);
        }

        socket.to(currentRoom).emit('canvas:object:added', data);
    });

    // Canvas object modified
    socket.on('canvas:object:modified', (data: { object: CanvasObject }) => {
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
    socket.on('canvas:object:removed', (data: { objectId: string }) => {
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
    socket.on('cursor:position', (data: { x: number; y: number }) => {
        if (!currentRoom) return;

        socket.to(currentRoom).emit('cursor:position', {
            userId: socket.id,
            ...data
        });
    });

    // Theme change
    socket.on('theme-change', (data: { theme: string; color?: string }) => {
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

    // Chat message
    socket.on('chat:message', (data: { text: string; user: User; timestamp: number }) => {
        if (!currentRoom) return;

        console.log(`[Chat] Message from ${socket.id} (${currentUser?.name}):`, data.text);
        socket.to(currentRoom).emit('chat:message', data);
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
    socket.on('webrtc:offer', ({ targetUserId, offer }: { targetUserId: string; offer: any }) => {
        io.to(targetUserId).emit('webrtc:offer', {
            fromUserId: socket.id,
            fromUserName: currentUser?.name || 'User',
            offer
        });
    });

    // WebRTC signaling - answer
    socket.on('webrtc:answer', ({ targetUserId, answer }: { targetUserId: string; answer: any }) => {
        io.to(targetUserId).emit('webrtc:answer', {
            fromUserId: socket.id,
            fromUserName: currentUser?.name || 'User',
            answer
        });
    });

    // WebRTC signaling - ICE candidate
    socket.on('webrtc:ice-candidate', ({ targetUserId, candidate }: { targetUserId: string; candidate: any }) => {
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
                socket.to(currentRoom).emit('user-left', { userId: socket.id });

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

    // User disconnects
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.users.delete(socket.id);
                socket.to(currentRoom).emit('user-left', { userId: socket.id });

                if (room.users.size === 0) {
                    console.log(`Room ${currentRoom} is now empty but will persist for rejoining (expires: ${new Date(room.expiresAt).toLocaleString()})`);
                } else {
                    console.log(`Room ${currentRoom} now has ${room.users.size} user(s)`);
                }
            }
        }
    });
});

// Generate a unique 6-character room ID
function generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Generate a secure 6-character room password
function generateRoomPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < 6; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Periodic cleanup of expired rooms
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;

    for (const [roomId, room] of rooms) {
        if (now > room.expiresAt) {
            console.log(`[Cleanup] Deleting expired room: ${roomId} (created ${new Date(room.createdAt).toLocaleString()})`);
            rooms.delete(roomId);
            expiredCount++;
        }
    }

    if (expiredCount > 0) {
        console.log(`[Cleanup] Removed ${expiredCount} expired room(s). Active rooms: ${rooms.size}`);
    }
}, 60 * 60 * 1000); // Run every hour

console.log('[Server] Room persistence enabled:');
console.log('- Room lifetime: 24 hours');
console.log('- Max rejoin attempts: 3 per user');
console.log('- Cleanup interval: Every hour');

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});

// Socket.io Manager - Handles real-time communication

class SocketManager {
    constructor() {
        this.socket = null;
        this.currentRoom = null;
        this.currentUser = null;
        this.callbacks = {};
    }

    // Connect to Socket.io server
    connect() {
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('Connected to server:', this.socket.id);
            this.trigger('connected');
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            this.trigger('disconnected');
        });

        this.socket.on('error', (data) => {
            console.error('Socket error:', data);
            this.trigger('error', data);
        });

        // Room events
        this.socket.on('room-created', (data) => {
            this.currentRoom = data.roomId;
            this.currentUser = data.user;
            this.trigger('room-created', data);
        });

        this.socket.on('room-joined', (data) => {
            this.currentRoom = data.roomId;
            this.currentUser = data.user;
            this.trigger('room-joined', data);
        });

        this.socket.on('user-joined', (user) => {
            this.trigger('user-joined', user);
        });

        this.socket.on('user-left', (data) => {
            this.trigger('user-left', data);
        });

        // Canvas events
        this.socket.on('canvas:object:added', (data) => {
            this.trigger('canvas:object:added', data);
        });

        this.socket.on('canvas:object:modified', (data) => {
            this.trigger('canvas:object:modified', data);
        });

        this.socket.on('canvas:object:removed', (data) => {
            this.trigger('canvas:object:removed', data);
        });

        this.socket.on('canvas:clear', () => {
            this.trigger('canvas:clear');
        });

        // Cursor events
        this.socket.on('cursor:position', (data) => {
            this.trigger('cursor:position', data);
        });

        // Theme change event
        this.socket.on('theme-change', (data) => {
            this.trigger('theme-change', data);
        });

        // User camera enabled event
        this.socket.on('user-camera-enabled', (data) => {
            this.trigger('user-camera-enabled', data);
        });

        // User camera disabled event
        this.socket.on('user-camera-disabled', (data) => {
            this.trigger('user-camera-disabled', data);
        });

        // WebRTC signaling events
        this.socket.on('webrtc:offer', (data) => {
            this.trigger('webrtc:offer', data);
        });

        this.socket.on('webrtc:answer', (data) => {
            this.trigger('webrtc:answer', data);
        });

        this.socket.on('webrtc:ice-candidate', (data) => {
            this.trigger('webrtc:ice-candidate', data);
        });
    }

    // Create a new room
    createRoom(username) {
        const userData = {
            name: username || 'User',
            color: getRandomColor()
        };

        this.socket.emit('create-room', userData);
    }

    // Join a room
    joinRoom(roomId, username, password) {
        const userData = {
            name: username || 'User',
            joinedAt: Date.now()
        };
        this.currentRoom = roomId;
        this.socket.emit('join-room', { roomId, password, userData });
    }

    // Leave current room
    leaveRoom() {
        if (this.currentRoom) {
            this.socket.emit('leave-room');
            this.currentRoom = null;
        }
    }

    // Send canvas object added event
    sendCanvasObjectAdded(object) {
        this.socket.emit('canvas:object:added', { object });
    }

    // Send canvas object modified event
    sendCanvasObjectModified(object) {
        this.socket.emit('canvas:object:modified', { object });
    }

    // Send canvas object removed event
    sendCanvasObjectRemoved(objectId) {
        this.socket.emit('canvas:object:removed', { objectId });
    }

    // Send canvas clear event
    sendCanvasClear() {
        this.socket.emit('canvas:clear');
    }

    // Send cursor position (throttled)
    sendCursorPosition = throttle((x, y) => {
        this.socket.emit('cursor:position', { x, y });
    }, 16); // ~60fps

    // Send theme change
    sendThemeChange(theme, color) {
        this.socket.emit('theme-change', { theme, color });
    }

    // Notify server that camera is enabled
    sendCameraEnabled() {
        this.socket.emit('camera-enabled');
    }

    // Notify server that camera is disabled
    sendCameraDisabled() {
        this.socket.emit('camera-disabled');
    }

    // WebRTC signaling methods
    sendWebRTCOffer(targetUserId, offer) {
        this.socket.emit('webrtc:offer', { targetUserId, offer });
    }

    sendWebRTCAnswer(targetUserId, answer) {
        this.socket.emit('webrtc:answer', { targetUserId, answer });
    }

    sendWebRTCIceCandidate(targetUserId, candidate) {
        this.socket.emit('webrtc:ice-candidate', { targetUserId, candidate });
    }

    // Event listener system
    on(event, callback) {
        if (!this.callbacks[event]) {
            this.callbacks[event] = [];
        }
        this.callbacks[event].push(callback);
    }

    trigger(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => callback(data));
        }
    }

    // Get current user info
    getCurrentUser() {
        return this.currentUser;
    }

    // Get current room ID
    getCurrentRoom() {
        return this.currentRoom;
    }
}

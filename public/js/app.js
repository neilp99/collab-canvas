// Main Application Controller

class App {
    constructor() {
        this.socketManager = null;
        this.canvasManager = null;
        this.videoManager = null;
        this.remoteCursors = new Map();
        this.connectedUsers = new Set(); // Track all connected users
        this.userNames = new Map(); // Store user names by userId
        this.roomPassword = null; // Store room password for copy link

        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    init() {
        console.log('Initializing CollabCanvas...');

        // Initialize Socket.io manager
        this.socketManager = new SocketManager();
        this.socketManager.connect();

        // Setup connection modal handlers
        this.setupConnectionModal();

        // Setup Socket.io event listeners
        this.setupSocketListeners();

        // Check for room ID in URL
        const params = getUrlParams();
        if (params.roomId) {
            document.getElementById('room-id-input').value = params.roomId;
            // Don't call showUserInfo() - let user enter password first
        }

        console.log('CollabCanvas initialized');

        // Show test mode instructions in console
        if (localStorage.getItem('useMockVideo') === 'true') {
            console.log('%c🎬 TEST MODE ENABLED', 'color: #4CAF50; font-weight: bold; font-size: 14px');
            console.log('Using mock video streams for testing');
        } else {
            console.log('%c💡 TIP: Enable Test Mode for same-device testing', 'color: #2196F3; font-weight: bold');
            console.log('Run: localStorage.setItem("useMockVideo", "true"); then refresh');
            console.log('This allows testing with multiple windows without camera conflicts');
        }
    }

    setupConnectionModal() {
        const modal = document.getElementById('connection-modal');
        const createBtn = document.getElementById('create-room-btn');
        const joinBtn = document.getElementById('join-room-btn');
        const enterBtn = document.getElementById('enter-room-btn');
        const roomIdInput = document.getElementById('room-id-input');
        const roomPasswordInput = document.getElementById('room-password-input');
        const usernameInput = document.getElementById('username-input');
        const togglePasswordBtn = document.getElementById('toggle-password-btn');

        // Create room button
        createBtn.addEventListener('click', () => {
            this.showUserInfo();
        });

        // Join room button - validate room first
        joinBtn.addEventListener('click', () => {
            const roomId = roomIdInput.value.trim().toUpperCase();
            const password = roomPasswordInput.value.trim().toUpperCase();

            if (roomId.length !== 6) {
                showToast('Please enter a valid 6-character room ID', 'error');
                return;
            }

            if (password.length !== 6) {
                showToast('Please enter the 6-character room password', 'error');
                return;
            }

            // Validate room with server before showing username entry
            this.pendingRoomId = roomId;
            this.pendingPassword = password;
            this.socketManager.validateRoom(roomId, password);
        });

        // Enter room button
        enterBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim() || 'User';
            const roomId = roomIdInput.value.trim().toUpperCase();
            const password = roomPasswordInput.value.trim().toUpperCase();

            if (roomId) {
                this.joinRoom(roomId, username, password);
            } else {
                this.createRoom(username);
            }
        });

        // Toggle password visibility
        togglePasswordBtn.addEventListener('click', () => {
            const passwordInput = document.getElementById('created-password');
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
        });

        // Allow Enter key to proceed
        usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                enterBtn.click();
            }
        });

        roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                joinBtn.click();
            }
        });

        roomPasswordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                joinBtn.click();
            }
        });
    }

    showUserInfo() {
        document.querySelector('.connection-options').style.display = 'none';
        document.querySelector('.user-info-section').style.display = 'flex';
        document.getElementById('username-input').focus();
    }

    createRoom(username) {
        this.socketManager.createRoom(username);
    }

    joinRoom(roomId, username, password) {
        this.socketManager.joinRoom(roomId, username, password);
    }

    leaveRoom() {
        if (confirm('Are you sure you want to leave this room?')) {
            // Stop video/audio
            if (this.videoManager) {
                this.videoManager.disableCamera();
            }

            // Clear chat messages
            if (this.chatManager) {
                this.chatManager.clearMessages();
                // Close chat panel if open
                if (this.chatManager.isPanelOpen) {
                    this.chatManager.toggleChatPanel();
                }
            }

            // Leave room via socket
            this.socketManager.leaveRoom();

            // Reset state
            this.canvasManager = null;
            this.videoManager = null;
            this.chatManager = null;
            this.connectedUsers.clear();
            this.remoteCursors.clear();
            this.roomPassword = null;

            // Clear UI
            document.getElementById('cursors-overlay').innerHTML = '';
            document.getElementById('video-grid').innerHTML = '';

            // Show connection modal
            document.getElementById('app').style.display = 'none';
            document.getElementById('connection-modal').style.display = 'flex';

            // Reset modal state
            document.querySelector('.connection-options').style.display = 'flex';
            document.querySelector('.user-info-section').style.display = 'none';
            document.querySelector('.room-password-section').style.display = 'none';
            document.getElementById('room-id-input').value = '';
            document.getElementById('room-password-input').value = '';
            document.getElementById('username-input').value = '';

            // Update URL
            window.history.pushState({}, '', window.location.pathname);

            showToast('Left the room', 'info');
        }
    }

    setupSocketListeners() {
        // Room created
        this.socketManager.on('room-created', (data) => {
            console.log('Room created:', data.roomId);
            this.roomPassword = data.password;
            updateUrl(data.roomId);
            this.startApplication(data.roomId);
            this.updateUsersCount();

            // Show password to creator
            const passwordSection = document.querySelector('.room-password-section');
            const createdPasswordInput = document.getElementById('created-password');
            createdPasswordInput.value = data.password;
            passwordSection.style.display = 'block';

            showToast(`Room created: ${data.roomId}`, 'success');
        });

        // Error
        this.socketManager.on('error', (data) => {
            console.error('Received error:', data);
            // Show user-friendly error message
            const errorMessage = data.message || 'An error occurred';
            showToast(errorMessage, 'error');
        });

        // Room validation success - show username entry
        this.socketManager.on('room-validation-success', () => {
            console.log('Room validation successful');
            this.showUserInfo();
        });

        // Room validation failed - show error on login screen
        this.socketManager.on('room-validation-failed', (data) => {
            console.log('Room validation failed:', data.message);
            showToast(data.message, 'error');
            // User stays on connection screen
        });

        // Room joined
        this.socketManager.on('room-joined', (data) => {
            console.log('Joined room:', data.roomId);
            updateUrl(data.roomId);

            // Track all existing users in the room and store their names
            if (data.users && Array.isArray(data.users)) {
                data.users.forEach(user => {
                    if (user.id !== this.socketManager.socket.id) {
                        this.connectedUsers.add(user.id);
                        this.userNames.set(user.id, user.name); // Store existing user names

                        // Notify video manager
                        if (this.videoManager) {
                            this.videoManager.setUserName(user.id, user.name);
                        }
                    }
                });
            }

            this.startApplication(data.roomId, data.canvasState);
            this.updateUsersCount();
            showToast(`Joined room: ${data.roomId}`, 'success');
        });

        // User joined
        this.socketManager.on('user-joined', (user) => {
            console.log('User joined:', user);
            this.connectedUsers.add(user.id);
            this.userNames.set(user.id, user.name); // Store username

            // Notify video manager if it exists
            if (this.videoManager) {
                this.videoManager.setUserName(user.id, user.name);
            }

            showToast(`${user.name} joined`, 'info');
            this.updateUsersCount();
        });

        // User left
        this.socketManager.on('user-left', (data) => {
            console.log('User left:', data.userId);
            this.connectedUsers.delete(data.userId);
            this.userNames.delete(data.userId); // Remove username
            this.remoteCursors.delete(data.userId);
            this.removeCursor(data.userId);
            this.updateUsersCount();
            showToast('A user left', 'info');
        });

        // Canvas events
        this.socketManager.on('canvas:object:added', (data) => {
            this.canvasManager.applyRemoteObjectAdded(data);
        });

        this.socketManager.on('canvas:object:modified', (data) => {
            this.canvasManager.applyRemoteObjectModified(data);
        });

        this.socketManager.on('canvas:object:removed', (data) => {
            this.canvasManager.applyRemoteObjectRemoved(data.objectId);
        });

        this.socketManager.on('canvas:clear', () => {
            this.canvasManager.applyRemoteClear();
        });

        // Cursor position
        this.socketManager.on('cursor:position', (data) => {
            this.updateRemoteCursor(data.userId, data.x, data.y);
        });

        // Theme change
        this.socketManager.on('theme-change', (data) => {
            this.canvasManager.applyRemoteThemeChange(data.theme, data.color);
        });

        // Error
        this.socketManager.on('error', (data) => {
            showToast(data.message || 'An error occurred', 'error');
        });
    }

    startApplication(roomId, canvasState = null) {
        // Hide modal
        document.getElementById('connection-modal').style.display = 'none';

        // Show app
        document.getElementById('app').style.display = 'flex';

        // Display room ID
        document.getElementById('current-room-id').textContent = roomId;

        // Initialize Canvas Manager
        this.canvasManager = new CanvasManager('main-canvas', this.socketManager);

        // Load existing canvas state if joining existing room
        if (canvasState) {
            this.canvasManager.loadCanvasState(canvasState);
        }

        // Initialize Video Manager
        const videoGrid = document.getElementById('video-grid');
        this.videoManager = new VideoManager(videoGrid, this.socketManager);

        // Initialize Chat Manager
        this.chatManager = new ChatManager(this.socketManager);

        // Setup UI event listeners
        this.setupUIListeners();

        console.log('Application started');
    }

    setupUIListeners() {
        // Tool buttons
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setTool(tool);

                // Update active state
                document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // If sticky note tool, create sticky on click
                if (tool === 'sticky') {
                    this.canvasManager.createStickyNote();
                }
            });
        });

        // Color input
        const colorInput = document.getElementById('color-input');
        colorInput.addEventListener('input', (e) => {
            this.canvasManager.setColor(e.target.value);
        });

        // Color presets
        document.querySelectorAll('.color-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                colorInput.value = color;
                this.canvasManager.setColor(color);
            });
        });

        // Brush size
        const brushSize = document.getElementById('brush-size');
        const brushSizeValue = document.getElementById('brush-size-value');
        brushSize.addEventListener('input', (e) => {
            const size = parseInt(e.target.value);
            brushSizeValue.textContent = size;
            this.canvasManager.setWidth(size);
        });

        // Clear canvas
        document.getElementById('clear-canvas-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear the canvas?')) {
                this.canvasManager.clear();
            }
        });

        // Copy room link
        document.getElementById('copy-link-btn').addEventListener('click', async () => {
            const roomId = this.socketManager.getCurrentRoom();
            const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

            let textToCopy = `🎨 Join my CollabCanvas room!\n\nRoom: ${url}`;
            if (this.roomPassword) {
                textToCopy += `\nPassword: ${this.roomPassword}`;
            }

            const success = await copyToClipboard(textToCopy);
            if (success) {
                showToast('Room link and password copied!', 'success');
            } else {
                showToast('Failed to copy link', 'error');
            }
        });

        // Leave room button
        document.getElementById('leave-room-btn').addEventListener('click', () => {
            this.leaveRoom();
        });

        // Toggle camera
        document.getElementById('toggle-camera-btn').addEventListener('click', async () => {
            const btn = document.getElementById('toggle-camera-btn');
            const enabled = await this.videoManager.toggleCamera();
            btn.classList.toggle('active', enabled);
        });

        // Toggle microphone
        document.getElementById('toggle-mic-btn').addEventListener('click', () => {
            const btn = document.getElementById('toggle-mic-btn');
            const enabled = this.videoManager.toggleMicrophone();
            btn.classList.toggle('active', enabled);
        });

        // Canvas color presets
        document.querySelectorAll('.canvas-color-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active class from all presets
                document.querySelectorAll('.canvas-color-preset').forEach(b => b.classList.remove('active'));
                // Add active class to clicked preset
                btn.classList.add('active');

                const color = btn.dataset.canvasColor;
                const canvasColorInput = document.getElementById('canvas-color-input');
                canvasColorInput.value = color;
                this.canvasManager.setCanvasColor(color);
            });
        });

        // Canvas color input
        document.getElementById('canvas-color-input').addEventListener('input', (e) => {
            const color = e.target.value;
            // Remove active class from all presets
            document.querySelectorAll('.canvas-color-preset').forEach(b => b.classList.remove('active'));
            this.canvasManager.setCanvasColor(color);
        });

        // Theme selector
        document.getElementById('theme-select').addEventListener('change', (e) => {
            const theme = e.target.value;
            this.canvasManager.setTheme(theme);
        });

        // Shape options in dropdown
        document.querySelectorAll('.shape-option').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setTool(tool);

                // Update active state on all tool buttons
                document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.shape-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Update shapes trigger icon to match selected shape
                const shapesIcon = btn.querySelector('svg').cloneNode(true);
                const trigger = document.querySelector('.shapes-trigger');
                const existingIcon = trigger.querySelector('svg:first-child');
                existingIcon.replaceWith(shapesIcon);
                trigger.classList.add('active');
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'p' || e.key === 'P') {
                document.querySelector('[data-tool="pen"]').click();
            } else if (e.key === 'e' || e.key === 'E') {
                document.querySelector('[data-tool="eraser"]').click();
            } else if (e.key === 's' || e.key === 'S') {
                document.querySelector('[data-tool="sticky"]').click();
            }
        });
    }

    setTool(tool) {
        this.canvasManager.setTool(tool);
    }

    updateRemoteCursor(userId, x, y) {
        const overlay = document.getElementById('cursors-overlay');
        let cursor = this.remoteCursors.get(userId);

        if (!cursor) {
            // Create new cursor
            cursor = document.createElement('div');
            cursor.className = 'remote-cursor';
            cursor.id = `cursor-${userId}`;

            const color = getRandomColor();
            cursor.style.backgroundColor = color;

            const label = document.createElement('div');
            label.className = 'cursor-label';
            label.textContent = this.userNames.get(userId) || 'User'; // Use stored username
            label.style.backgroundColor = color;

            cursor.appendChild(label);
            overlay.appendChild(cursor);
            this.remoteCursors.set(userId, cursor);
        }

        // Update cursor position
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
    }

    removeCursor(userId) {
        const cursor = this.remoteCursors.get(userId);
        if (cursor) {
            cursor.remove();
            this.remoteCursors.delete(userId);
        }
    }

    updateUsersCount() {
        // Count all connected users + self
        const count = this.connectedUsers.size + 1; // +1 for current user
        document.getElementById('users-count').textContent = count;
    }
}

// Initialize the application and make it globally accessible
window.app = new App();

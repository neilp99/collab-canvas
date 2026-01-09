// Chat Manager - Handles real-time text messaging

class ChatManager {
    constructor(socketManager) {
        this.socketManager = socketManager;
        this.chatPanel = null;
        this.messageList = null;
        this.messageInput = null;
        this.sendButton = null;
        this.toggleButton = null;
        this.isPanelOpen = false;
        this.messages = []; // Session-only message storage

        this.init();
        this.setupEventListeners();
    }

    init() {
        // Get DOM elements
        this.chatPanel = document.getElementById('chat-panel');
        this.messageList = document.getElementById('message-list');
        this.messageInput = document.getElementById('chat-input');
        this.sendButton = document.getElementById('send-message-btn');
        this.toggleButton = document.getElementById('toggle-chat-btn');

        if (!this.chatPanel || !this.messageList || !this.messageInput) {
            console.error('[ChatManager] Required DOM elements not found');
            return;
        }

        console.log('[ChatManager] Initialized');
    }

    setupEventListeners() {
        // Toggle chat panel
        if (this.toggleButton) {
            this.toggleButton.addEventListener('click', () => {
                this.toggleChatPanel();
            });
        }

        // Send message on button click
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => {
                this.sendMessage();
            });
        }

        // Send message on Enter key
        if (this.messageInput) {
            this.messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // Socket events
        this.socketManager.on('chat:message', (data) => {
            this.receiveMessage(data);
        });

        console.log('[ChatManager] Event listeners setup complete');
    }

    toggleChatPanel() {
        this.isPanelOpen = !this.isPanelOpen;

        if (this.isPanelOpen) {
            this.chatPanel.classList.add('open');
            this.toggleButton.classList.add('active');
            this.messageInput.focus();

            // Scroll to bottom when opening
            this.scrollToBottom();
        } else {
            this.chatPanel.classList.remove('open');
            this.toggleButton.classList.remove('active');
        }

        console.log('[ChatManager] Panel toggled:', this.isPanelOpen);
    }

    sendMessage() {
        const text = this.messageInput.value.trim();

        // Validate message
        if (!text) {
            this.showInputError('Message cannot be empty');
            return;
        }

        if (text.length > 500) {
            this.showInputError('Message too long (max 500 characters)');
            return;
        }

        // Sanitize message (basic XSS prevention)
        const sanitizedText = this.sanitizeMessage(text);
        if (!sanitizedText) {
            this.showInputError('Message contains invalid characters');
            return;
        }

        // Create message object
        const message = {
            id: this.generateMessageId(),
            text: sanitizedText,
            timestamp: Date.now(),
            userId: this.socketManager.socket.id,
            userName: this.getUserName()
        };

        // Send via socket
        try {
            this.socketManager.socket.emit('chat:message', message);

            // Add to local message list (will also be received via socket)
            // This provides immediate feedback
            console.log('[ChatManager] Message sent:', message.id);

            // Clear input
            this.messageInput.value = '';
            this.clearInputError();

        } catch (error) {
            console.error('[ChatManager] Error sending message:', error);
            showToast('Failed to send message', 'error');
        }
    }

    receiveMessage(data) {
        console.log('[ChatManager] Received message:', data);

        // Add to message storage
        this.messages.push(data);

        // Render message
        this.renderMessage(data);

        // Auto-scroll to bottom
        this.scrollToBottom();
    }

    renderMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'chat-message';
        messageElement.dataset.messageId = message.id;

        // Check if this is the current user's message
        const isOwnMessage = message.userId === this.socketManager.socket.id;
        if (isOwnMessage) {
            messageElement.classList.add('own-message');
        }

        // Create message content
        const userNameEl = document.createElement('div');
        userNameEl.className = 'message-user';
        userNameEl.textContent = isOwnMessage ? 'You' : message.userName;

        const textEl = document.createElement('div');
        textEl.className = 'message-text';
        textEl.textContent = message.text; // Already sanitized

        const timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        timeEl.textContent = this.formatTimestamp(message.timestamp);

        messageElement.appendChild(userNameEl);
        messageElement.appendChild(textEl);
        messageElement.appendChild(timeEl);

        this.messageList.appendChild(messageElement);
    }

    sanitizeMessage(text) {
        // Basic XSS prevention - strip HTML tags
        const div = document.createElement('div');
        div.textContent = text;
        const sanitized = div.innerHTML;

        // Check for script attempts
        if (/<script|javascript:|onerror|onload/i.test(text)) {
            console.warn('[ChatManager] XSS attempt blocked:', text);
            return null;
        }

        return sanitized;
    }

    showInputError(message) {
        // Add error class to input
        this.messageInput.classList.add('error');

        // Show error message (could be a tooltip or text below input)
        const errorEl = document.getElementById('chat-input-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }

        // Clear error after 3 seconds
        setTimeout(() => {
            this.clearInputError();
        }, 3000);
    }

    clearInputError() {
        this.messageInput.classList.remove('error');
        const errorEl = document.getElementById('chat-input-error');
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    }

    scrollToBottom() {
        if (this.messageList) {
            this.messageList.scrollTop = this.messageList.scrollHeight;
        }
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    getUserName() {
        // Get username from app
        const app = window.app;
        if (app && app.socketManager && app.socketManager.socket) {
            // Try to get from userNames map
            const userId = app.socketManager.socket.id;
            return app.userNames?.get(userId) || 'You';
        }
        return 'You';
    }

    clearMessages() {
        this.messages = [];
        this.messageList.innerHTML = '';
        console.log('[ChatManager] Messages cleared');
    }
}

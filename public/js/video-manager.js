// Video Manager - Handles WebRTC video/audio communication

class VideoManager {
    constructor(gridElement, socketManager) {
        this.gridElement = gridElement;
        this.socketManager = socketManager;
        this.localStream = null;
        this.peerConnections = new Map();
        this.remoteStreams = new Map();
        this.cameraEnabled = false;
        this.micEnabled = false;
        this.audioContext = null;
        this.audioAnalysers = new Map();
        this.activeSpeakers = new Map();

        // WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Set up WebRTC signaling handlers
        this.setupSignalingHandlers();

        // Start speaker detection loop
        this.startSpeakerDetection();
    }

    setupSignalingHandlers() {
        // Handle incoming WebRTC offer
        this.socketManager.on('webrtc:offer', async ({ fromUserId, offer }) => {
            console.log('Received offer from:', fromUserId);
            await this.handleOffer(fromUserId, offer);
        });

        // Handle incoming WebRTC answer
        this.socketManager.on('webrtc:answer', async ({ fromUserId, answer }) => {
            console.log('Received answer from:', fromUserId);
            await this.handleAnswer(fromUserId, answer);
        });

        // Handle incoming ICE candidate
        this.socketManager.on('webrtc:ice-candidate', async ({ fromUserId, candidate }) => {
            await this.handleIceCandidate(fromUserId, candidate);
        });

        // Handle user joined - DON'T initiate connection here
        // Wait for them to enable camera and broadcast
        this.socketManager.on('user-joined', async (user) => {
            // Do nothing - let users initiate when they enable cameras
        });

        // Handle user left - close connection
        this.socketManager.on('user-left', ({ userId }) => {
            this.closePeerConnection(userId);
        });

        // Handle user camera enabled
        this.socketManager.on('user-camera-enabled', async ({ userId }) => {
            console.log('[VideoManager] 📹 User camera enabled:', userId);
            console.log(`  - We have camera: ${!!this.localStream}`);
            console.log(`  - Already has connection: ${this.peerConnections.has(userId)}`);

            // Don't create connection here - the user who enabled camera will initiate
            // We'll respond via handleOffer when they send us an offer
            console.log('[VideoManager] ⏭️ Waiting for offer from user who enabled camera');
        });

        // Handle user camera disabled - remove their video
        this.socketManager.on('user-camera-disabled', ({ userId }) => {
            console.log('User camera disabled:', userId);
            this.closePeerConnection(userId);
        });
    }

    // Toggle camera on/off
    async toggleCamera() {
        if (!this.cameraEnabled) {
            await this.enableCamera();
        } else {
            this.disableCamera();
        }
        return this.cameraEnabled;
    }

    // Enable camera
    async enableCamera() {
        try {
            // Check if we should use mock video for testing (same device)
            const useMockVideo = localStorage.getItem('useMockVideo') === 'true';

            if (useMockVideo) {
                // Create mock video stream for testing
                this.localStream = this.createMockVideoStream();
            } else {
                // Use real camera
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: true
                });
            }

            this.cameraEnabled = true;
            this.micEnabled = true;

            // Add local video
            this.addLocalVideo();

            // Initialize audio context for speaker detection (only if real audio)
            if (!useMockVideo) {
                this.setupAudioAnalysis();
            }

            // Notify other users that camera is enabled
            this.socketManager.sendCameraEnabled();
            console.log('[VideoManager] Broadcasted camera-enabled event');

            // Handle peer connections for all existing users
            const app = window.app;
            if (app && app.connectedUsers) {
                console.log('[VideoManager] Connected users:', Array.from(app.connectedUsers));
                console.log('[VideoManager] My socket ID:', this.socketManager.socket.id);

                for (const userId of app.connectedUsers) {
                    const existingConnection = this.peerConnections.has(userId);

                    if (existingConnection) {
                        // Connection exists - add our new tracks to it
                        console.log(`[VideoManager] 🔄 Adding tracks to existing connection: ${userId}`);
                        const pc = this.peerConnections.get(userId);

                        // Add new tracks from our stream
                        this.localStream.getTracks().forEach(track => {
                            console.log(`  - Adding ${track.kind} track`);
                            pc.addTrack(track, this.localStream);
                        });

                        // Create new offer since we added tracks
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        this.socketManager.sendWebRTCOffer(userId, offer);
                        console.log(`  - Sent new offer to ${userId}`);
                    } else {
                        // No connection - create new one
                        console.log(`[VideoManager] ✅ Creating new peer connection to: ${userId}`);
                        await this.createPeerConnection(userId);
                    }
                }
            } else {
                console.warn('[VideoManager] No connected users found or app not initialized');
            }

            showToast(useMockVideo ? 'Camera enabled (Test Mode)' : 'Camera enabled', 'success');
            return true;
        } catch (error) {
            console.error('Error enabling camera:', error);
            showToast('Could not access camera/microphone', 'error');
            return false;
        }
    }

    // Create mock video stream for testing
    createMockVideoStream() {
        // Create a canvas to generate video frames
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');

        // Generate a unique color for this user
        const userId = this.socketManager.socket.id || 'local';
        const hue = Math.abs(userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 360;

        // Draw animated frame
        let frame = 0;
        const drawFrame = () => {
            // Gradient background
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, `hsl(${hue}, 70%, 50%)`);
            gradient.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 30%)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Animated circle
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(
                canvas.width / 2 + Math.cos(frame * 0.05) * 100,
                canvas.height / 2 + Math.sin(frame * 0.05) * 100,
                50,
                0,
                Math.PI * 2
            );
            ctx.fill();

            // Text
            ctx.fillStyle = 'white';
            ctx.font = 'bold 24px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Test User', canvas.width / 2, canvas.height / 2);
            ctx.font = '16px Inter, sans-serif';
            ctx.fillText('(Mock Video)', canvas.width / 2, canvas.height / 2 + 30);

            frame++;
        };

        // Animate at 30fps
        setInterval(drawFrame, 1000 / 30);
        drawFrame();

        // Create media stream from canvas
        const stream = canvas.captureStream(30);

        // Create a silent audio track for testing
        const audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.001; // Very quiet
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();

        const audioDestination = audioContext.createMediaStreamDestination();
        gainNode.connect(audioDestination);

        // Add audio track to stream
        stream.addTrack(audioDestination.stream.getAudioTracks()[0]);

        return stream;
    }

    // Disable camera
    disableCamera() {
        if (this.localStream) {
            // Stop all local tracks (camera and microphone)
            // This stops sending but keeps the peer connection alive
            this.localStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            this.localStream = null;
        }

        this.cameraEnabled = false;
        this.micEnabled = false;

        // Remove local video tile only
        this.removeLocalVideo();

        // Notify other users that camera is disabled
        this.socketManager.sendCameraDisabled();

        // Keep peer connections alive - just stop sending data
        // The remote side will stop receiving our video but keep sending theirs

        this.updateGridLayout();
        showToast('Camera disabled', 'info');
    }

    // Toggle microphone
    toggleMicrophone() {
        if (!this.localStream) return false;

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            this.micEnabled = audioTrack.enabled;
            showToast(this.micEnabled ? 'Microphone unmuted' : 'Microphone muted', 'info');
        }

        return this.micEnabled;
    }

    // Create peer connection
    async createPeerConnection(userId) {
        // Close any existing connection first
        if (this.peerConnections.has(userId)) {
            console.log('Closing existing peer connection to:', userId);
            this.closePeerConnection(userId);
        }

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(userId, pc);

        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socketManager.sendWebRTCIceCandidate(userId, event.candidate);
            }
        };

        // Handle remote stream
        pc.ontrack = (event) => {
            console.log('Received remote track from:', userId, 'kind:', event.track.kind);

            // Only add video tile if we receive a video track and don't already have one
            if (event.track.kind === 'video') {
                const existingTile = document.getElementById(`video-${userId}`);
                if (existingTile) {
                    console.log('Video tile already exists for user:', userId);
                    return;
                }

                const remoteStream = event.streams[0];
                this.remoteStreams.set(userId, remoteStream);
                this.addRemoteVideo(userId, remoteStream);
            } else if (event.track.kind === 'audio') {
                // Setup audio analysis for audio track
                const remoteStream = event.streams[0];
                this.setupRemoteAudioAnalysis(userId, remoteStream);
            }
        };

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.socketManager.sendWebRTCOffer(userId, offer);
    }

    // Handle incoming offer
    async handleOffer(userId, offer) {
        // Close any existing connection first  
        if (this.peerConnections.has(userId)) {
            console.log('[handleOffer] Closing existing peer connection to:', userId);
            this.closePeerConnection(userId);
        }

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(userId, pc);

        // Add local stream tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socketManager.sendWebRTCIceCandidate(userId, event.candidate);
            }
        };


        // Handle remote stream
        pc.ontrack = (event) => {
            console.log('Received remote track from:', userId, 'kind:', event.track.kind);

            // Only add video tile if we receive a video track and don't already have one
            if (event.track.kind === 'video') {
                const existingTile = document.getElementById(`video-${userId}`);
                if (existingTile) {
                    console.log('Video tile already exists for user:', userId);
                    return;
                }

                const remoteStream = event.streams[0];
                this.remoteStreams.set(userId, remoteStream);
                this.addRemoteVideo(userId, remoteStream);
            } else if (event.track.kind === 'audio') {
                // Setup audio analysis for audio track
                const remoteStream = event.streams[0];
                this.setupRemoteAudioAnalysis(userId, remoteStream);
            }
        };

        // Set remote description and create answer
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socketManager.sendWebRTCAnswer(userId, answer);
    }

    // Handle incoming answer
    async handleAnswer(userId, answer) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    }

    // Handle ICE candidate
    async handleIceCandidate(userId, candidate) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    // Close peer connection
    closePeerConnection(userId) {
        const pc = this.peerConnections.get(userId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(userId);
        }

        this.remoteStreams.delete(userId);
        this.audioAnalysers.delete(userId);
        this.removeRemoteVideo(userId);
    }

    // Add local video to grid
    addLocalVideo() {
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = 'video-local';

        const video = document.createElement('video');
        video.srcObject = this.localStream;
        video.autoplay = true;
        video.muted = true; // Mute local audio to avoid feedback
        video.playsInline = true;

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = 'You';

        tile.appendChild(video);
        tile.appendChild(label);
        this.gridElement.appendChild(tile);

        this.updateGridLayout();
    }

    // Remove local video
    removeLocalVideo() {
        const tile = document.getElementById('video-local');
        if (tile) {
            tile.remove();
        }
        this.updateGridLayout();
    }

    // Add remote video to grid
    addRemoteVideo(userId, stream) {
        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = `video-${userId}`;
        tile.dataset.userId = userId;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;

        const label = document.createElement('div');
        label.className = 'video-label';
        label.textContent = 'User'; // Will be updated with actual name

        tile.appendChild(video);
        tile.appendChild(label);
        this.gridElement.appendChild(tile);

        this.updateGridLayout();
    }

    // Remove remote video
    removeRemoteVideo(userId) {
        const tile = document.getElementById(`video-${userId}`);
        if (tile) {
            tile.remove();
        }
        this.updateGridLayout();
    }

    // Update video grid layout
    updateGridLayout() {
        const allTiles = Array.from(this.gridElement.children);
        const videoCount = allTiles.length;

        // Remove all grid classes
        this.gridElement.className = 'video-grid';

        // If 4 or fewer videos, show all
        if (videoCount <= 4) {
            // Show all tiles
            allTiles.forEach(tile => {
                tile.style.display = '';
            });

            // Add appropriate grid class
            if (videoCount === 0) {
                this.gridElement.classList.add('grid-0');
            } else if (videoCount === 1) {
                this.gridElement.classList.add('grid-1');
            } else if (videoCount === 2) {
                this.gridElement.classList.add('grid-2');
            } else if (videoCount === 3) {
                this.gridElement.classList.add('grid-3');
            } else {
                this.gridElement.classList.add('grid-4');
            }
        } else {
            // More than 4 videos: show first 3 + active speaker in 4th slot
            this.gridElement.classList.add('grid-4');

            // Always show first 3 tiles (local + first 2 remote users)
            const fixedTiles = allTiles.slice(0, 3);
            const remainingTiles = allTiles.slice(3);

            // Find most recent active speaker from remaining tiles
            let activeSpeakerTile = null;
            let latestSpeakerTime = 0;

            remainingTiles.forEach(tile => {
                const userId = tile.dataset.userId || 'local';
                const speakerTime = this.activeSpeakers.get(userId) || 0;

                if (speakerTime > latestSpeakerTime) {
                    latestSpeakerTime = speakerTime;
                    activeSpeakerTile = tile;
                }
            });

            // If no one is speaking, show the first remaining tile
            if (!activeSpeakerTile) {
                activeSpeakerTile = remainingTiles[0];
            }

            // Show fixed tiles + active speaker
            allTiles.forEach(tile => {
                if (fixedTiles.includes(tile) || tile === activeSpeakerTile) {
                    tile.style.display = '';
                } else {
                    tile.style.display = 'none';
                }
            });
        }
    }

    // Setup audio analysis for local stream
    setupAudioAnalysis() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            const mediaStream = new MediaStream([audioTrack]);
            const source = this.audioContext.createMediaStreamSource(mediaStream);
            const analyser = this.audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            this.audioAnalysers.set('local', analyser);
        }
    }

    // Setup audio analysis for remote stream
    setupRemoteAudioAnalysis(userId, stream) {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        const source = this.audioContext.createMediaStreamSource(stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        this.audioAnalysers.set(userId, analyser);
    }

    // Start speaker detection loop
    startSpeakerDetection() {
        setInterval(() => {
            this.detectSpeakers();
        }, 100); // Check every 100ms
    }

    // Detect active speakers
    detectSpeakers() {
        this.audioAnalysers.forEach((analyser, userId) => {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);

            // Calculate average volume
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

            // Threshold for speech detection
            const isSpeaking = average > 20;

            if (isSpeaking) {
                this.activeSpeakers.set(userId, Date.now());
                this.highlightSpeaker(userId);
            } else {
                this.unhighlightSpeaker(userId);
            }
        });

        // Update grid layout to show active speaker in 4th slot if >4 users
        this.updateGridLayout();
    }

    // Highlight speaking user
    highlightSpeaker(userId) {
        const tileId = userId === 'local' ? 'video-local' : `video-${userId}`;
        const tile = document.getElementById(tileId);
        if (tile && !tile.classList.contains('speaking')) {
            tile.classList.add('speaking');
        }
    }

    // Remove speaker highlight
    unhighlightSpeaker(userId) {
        const tileId = userId === 'local' ? 'video-local' : `video-${userId}`;
        const tile = document.getElementById(tileId);
        if (tile) {
            tile.classList.remove('speaking');
        }
    }
}

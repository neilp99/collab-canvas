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
            console.log('[VideoManager] 👤 User joined:', user.id);

            // If we have our camera enabled, send them an offer so they can see our video
            if (this.cameraEnabled && this.localStream) {
                console.log('[VideoManager] 📹 We have camera enabled, creating connection to new user:', user.id);
                await this.createPeerConnection(user.id);
            } else {
                console.log('[VideoManager] 📹 We don\'t have camera, waiting for them to initiate');
            }
        });

        // Handle user left - close connection
        this.socketManager.on('user-left', ({ userId }) => {
            this.closePeerConnection(userId);
        });

        // Handle user camera enabled
        this.socketManager.on('user-camera-enabled', async ({ userId }) => {
            console.log('[VideoManager] 📹 User camera enabled:', userId);
            console.log(`  - We have camera: ${!!this.localStream}`)
            console.log(`  - Already has connection: ${this.peerConnections.has(userId)}`);

            // If we already have a connection but no video tile, prepare for incoming video
            if (this.peerConnections.has(userId)) {
                const existingTile = document.getElementById(`video-${userId}`);
                if (!existingTile) {
                    console.log('[VideoManager] 📹 Connection exists but no tile - will create when tracks arrive');
                    // The ontrack handler will create the tile when video arrives
                }
            }

            console.log('[VideoManager] ⏭️ Waiting for video tracks from user');
        });

        // Handle user camera disabled - remove their video tile only
        this.socketManager.on('user-camera-disabled', ({ userId }) => {
            console.log('[VideoManager] 📹 User camera disabled:', userId);
            // Just remove their video tile, keep the connection alive
            // This allows us to continue sending our video to them
            this.removeRemoteVideo(userId);
            console.log('[VideoManager] ✅ Removed video tile, connection kept alive');
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
                        // Connection exists - replace old tracks with new ones
                        console.log(`[VideoManager] 🔄 Replacing tracks in existing connection: ${userId}`);
                        const pc = this.peerConnections.get(userId);

                        // Get existing senders
                        const senders = pc.getSenders();
                        const videoTrack = this.localStream.getVideoTracks()[0];
                        const audioTrack = this.localStream.getAudioTracks()[0];

                        let needsRenegotiation = false;

                        // Replace video track
                        const videoSender = senders.find(s => s.track?.kind === 'video');
                        if (videoSender) {
                            console.log('  - Replacing video track (no renegotiation needed)');
                            await videoSender.replaceTrack(videoTrack);
                            // replaceTrack() doesn't need renegotiation
                        } else {
                            console.log('  - Adding new video track');
                            pc.addTrack(videoTrack, this.localStream);
                            needsRenegotiation = true;
                        }

                        // Replace audio track
                        const audioSender = senders.find(s => s.track?.kind === 'audio');
                        if (audioSender) {
                            console.log('  - Replacing audio track (no renegotiation needed)');
                            await audioSender.replaceTrack(audioTrack);
                            // replaceTrack() doesn't need renegotiation
                        } else {
                            console.log('  - Adding new audio track');
                            pc.addTrack(audioTrack, this.localStream);
                            needsRenegotiation = true;
                        }

                        // Create and send new offer to signal track changes
                        // Always renegotiate when re-enabling camera to ensure remote gets tracks
                        console.log('  - Creating new offer for renegotiation');
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        this.socketManager.sendWebRTCOffer(userId, offer);
                        console.log(`  ✅ Renegotiation offer sent to ${userId}`);

                        console.log(`  ✅ Tracks replaced for ${userId}`);
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
    async disableCamera() {
        if (this.localStream) {
            // Stop all local tracks
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });

            // Remove tracks from all peer connections and renegotiate
            for (const [userId, pc] of this.peerConnections) {
                const senders = pc.getSenders();

                // Remove all senders (video and audio tracks)
                for (const sender of senders) {
                    if (sender.track) {
                        pc.removeTrack(sender);
                    }
                }

                // Create and send new offer to signal track removal
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    this.socketManager.sendWebRTCOffer(userId, offer);
                    console.log(`[disableCamera] Sent renegotiation offer to ${userId} (tracks removed)`);
                } catch (error) {
                    console.error(`[disableCamera] Error renegotiating with ${userId}:`, error);
                }
            }

            this.localStream = null;
        }

        this.cameraEnabled = false;
        this.micEnabled = false;

        // Remove local video tile
        this.removeLocalVideo();

        // Notify other users that camera is disabled
        this.socketManager.sendCameraDisabled();

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

            if (event.track.kind === 'video') {
                const remoteStream = event.streams[0];
                this.remoteStreams.set(userId, remoteStream);

                // Listen for track ended event to remove video tile
                event.track.onended = () => {
                    console.log('[createPeerConnection] Video track ended for:', userId);
                    this.removeRemoteVideo(userId);
                };

                const existingTile = document.getElementById(`video-${userId}`);
                if (existingTile) {
                    // Update existing video element with new stream
                    console.log('Updating existing video tile for user:', userId);
                    const videoElement = existingTile.querySelector('video');
                    if (videoElement) {
                        videoElement.srcObject = remoteStream;
                        // Retry logic for playing updated stream
                        const attemptPlay = (retries = 2) => {
                            videoElement.play()
                                .then(() => console.log(`[ontrack] ✅ Updated video playing for ${userId}`))
                                .catch(error => {
                                    console.error(`[ontrack] ❌ Error playing updated video for ${userId}:`, error);
                                    if (retries > 0) {
                                        setTimeout(() => attemptPlay(retries - 1), 200);
                                    }
                                });
                        };
                        attemptPlay();
                    }
                } else {
                    // Create new video tile
                    console.log('Creating new video tile for user:', userId);
                    this.addRemoteVideo(userId, remoteStream);
                }
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

            if (event.track.kind === 'video') {
                const remoteStream = event.streams[0];
                this.remoteStreams.set(userId, remoteStream);

                // Listen for track ended event to remove video tile
                event.track.onended = () => {
                    console.log('[handleOffer] Video track ended for:', userId);
                    this.removeRemoteVideo(userId);
                };

                const existingTile = document.getElementById(`video-${userId}`);
                if (existingTile) {
                    // Update existing video element with new stream
                    console.log('Updating existing video tile for user:', userId);
                    const videoElement = existingTile.querySelector('video');
                    if (videoElement) {
                        videoElement.srcObject = remoteStream;
                        // Retry logic for playing updated stream
                        const attemptPlay = (retries = 2) => {
                            videoElement.play()
                                .then(() => console.log(`[handleOffer] ✅ Updated video playing for ${userId}`))
                                .catch(error => {
                                    console.error(`[handleOffer] ❌ Error playing updated video for ${userId}:`, error);
                                    if (retries > 0) {
                                        setTimeout(() => attemptPlay(retries - 1), 200);
                                    }
                                });
                        };
                        attemptPlay();
                    }
                } else {
                    // Create new video tile
                    console.log('Creating new video tile for user:', userId);
                    this.addRemoteVideo(userId, remoteStream);
                }
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
        console.log('[addRemoteVideo] Creating video tile for:', userId);

        const tile = document.createElement('div');
        tile.className = 'video-tile';
        tile.id = `video-${userId}`;
        tile.dataset.userId = userId;

        const video = document.createElement('video');
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = false; // Don't mute remote video - we want to hear them
        video.playsInline = true;

        // Retry logic for play() with backoff
        const attemptPlay = (retries = 3, delay = 300) => {
            video.play()
                .then(() => {
                    console.log(`[addRemoteVideo] ✅ Video playing for ${userId}`);
                })
                .catch(error => {
                    console.error(`[addRemoteVideo] ❌ Error playing video for ${userId} (${retries} retries left):`, error);
                    if (retries > 0) {
                        // Try muted first, then retry
                        if (!video.muted) {
                            console.log(`[addRemoteVideo] Retrying with muted for ${userId}`);
                            video.muted = true;
                        }
                        setTimeout(() => attemptPlay(retries - 1, delay * 1.5), delay);
                    } else {
                        console.error(`[addRemoteVideo] ❌ Failed to play video for ${userId} after all retries`);
                    }
                });
        };

        // Wait for video metadata to load before playing
        video.onloadedmetadata = () => {
            console.log('[addRemoteVideo] Video metadata loaded for:', userId);
            attemptPlay();
        };

        // Also try playing immediately in case metadata is already loaded
        if (video.readyState >= 1) {
            console.log('[addRemoteVideo] Metadata already loaded, attempting play for:', userId);
            attemptPlay();
        }

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

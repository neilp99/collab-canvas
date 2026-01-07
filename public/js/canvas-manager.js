// Canvas Manager - Handles Fabric.js canvas and drawing tools

class CanvasManager {
    constructor(canvasElement, socketManager) {
        this.canvas = new fabric.Canvas(canvasElement, {
            isDrawingMode: true,
            freeDrawingBrush: {
                color: '#ff6b6b',
                width: 3
            }
        });

        this.socketManager = socketManager;
        this.currentTool = 'pen';
        this.currentColor = '#ff6b6b';
        this.currentWidth = 3;
        this.currentTheme = 'dark';
        this.currentCanvasColor = '#1a1a1a';
        this.isReceivingRemoteChanges = false;

        // Resize canvas to fill container
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Listen to canvas events
        this.setupCanvasEvents();
    }

    resizeCanvas() {
        const container = document.getElementById('canvas-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        this.canvas.setDimensions({
            width: width,
            height: height
        });
    }

    setupCanvasEvents() {
        // Object added
        this.canvas.on('object:added', (e) => {
            if (this.isReceivingRemoteChanges) return;

            const obj = e.target;
            if (!obj.id) {
                obj.id = generateId();
            }

            // Send to other users
            const serialized = this.serializeObject(obj);
            this.socketManager.sendCanvasObjectAdded(serialized);
        });

        // Object modified
        this.canvas.on('object:modified', (e) => {
            if (this.isReceivingRemoteChanges) return;

            const obj = e.target;
            const serialized = this.serializeObject(obj);
            this.socketManager.sendCanvasObjectModified(serialized);
        });

        // Object removed
        this.canvas.on('object:removed', (e) => {
            if (this.isReceivingRemoteChanges) return;

            const obj = e.target;
            if (obj.id) {
                this.socketManager.sendCanvasObjectRemoved(obj.id);
            }
        });

        // Path created (free drawing)
        this.canvas.on('path:created', (e) => {
            const path = e.path;
            path.id = generateId();
        });

        // Mouse move for cursor following
        this.canvas.on('mouse:move', (e) => {
            if (!e.pointer) return;
            this.socketManager.sendCursorPosition(e.pointer.x, e.pointer.y);
        });
    }

    // Set drawing tool
    setTool(tool) {
        this.currentTool = tool;

        if (tool === 'pen') {
            this.canvas.isDrawingMode = true;
            this.canvas.selection = false;
            this.canvas.freeDrawingBrush.color = this.currentColor;
            this.canvas.freeDrawingBrush.width = this.currentWidth;
        } else if (tool === 'eraser') {
            this.canvas.isDrawingMode = true;
            this.canvas.selection = false;
            // Set eraser color based on current theme
            const eraserColor = this.currentTheme === 'light' ? '#f5f5f5' : '#1a1a1a';
            this.canvas.freeDrawingBrush.color = eraserColor;
            this.canvas.freeDrawingBrush.width = this.currentWidth * 3;
        } else if (tool === 'sticky') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = true;
        }
    }

    // Set drawing color
    setColor(color) {
        this.currentColor = color;
        if (this.currentTool === 'pen') {
            this.canvas.freeDrawingBrush.color = color;
        }
    }

    // Set brush width
    setWidth(width) {
        this.currentWidth = width;
        if (this.currentTool === 'pen') {
            this.canvas.freeDrawingBrush.width = width;
        } else if (this.currentTool === 'eraser') {
            this.canvas.freeDrawingBrush.width = width * 3;
        }
    }

    // Set canvas theme
    setTheme(theme, color = null) {
        this.currentTheme = theme;
        if (color) {
            this.currentCanvasColor = color;
        }
        this.applyTheme();

        // Update eraser color if currently using eraser
        if (this.currentTool === 'eraser') {
            const eraserColor = this.isLightColor(this.currentCanvasColor) ? this.currentCanvasColor : (theme === 'light' ? '#f5f5f5' : '#1a1a1a');
            this.canvas.freeDrawingBrush.color = eraserColor;
        }

        // Send theme change to other users
        this.socketManager.sendThemeChange(theme, this.currentCanvasColor);
    }

    // Set canvas color
    setCanvasColor(color) {
        this.currentCanvasColor = color;
        this.applyTheme();

        // Update eraser color if currently using eraser
        if (this.currentTool === 'eraser') {
            const eraserColor = this.isLightColor(color) ? color : '#1a1a1a';
            this.canvas.freeDrawingBrush.color = eraserColor;
        }

        // Send theme change to other users
        this.socketManager.sendThemeChange(this.currentTheme, color);
    }

    // Check if a color is light
    isLightColor(color) {
        // Convert hex to RGB
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        // Calculate brightness
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128;
    }

    // Apply theme rendering
    applyTheme() {
        // Clear any existing patterns
        this.canvas.overlayImage = null;
        this.canvas.backgroundImage = null;

        // Set background color
        this.canvas.backgroundColor = this.currentCanvasColor || '#1a1a1a';

        switch (this.currentTheme) {
            case 'grid':
                this.drawGridPattern();
                break;

            case 'dotted':
                this.drawDottedPattern();
                break;
        }

        this.canvas.renderAll();
    }

    // Draw grid pattern  
    drawGridPattern() {
        const gridSize = 40;
        const canvas = this.canvas;

        // Create pattern using canvas context
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = canvas.width;
        patternCanvas.height = canvas.height;
        const ctx = patternCanvas.getContext('2d');

        // Determine grid color based on background
        const isLight = this.isLightColor(this.currentCanvasColor || '#1a1a1a');
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        // Draw vertical lines
        for (let x = 0; x <= canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        // Draw horizontal lines
        for (let y = 0; y <= canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        // Apply as overlay
        fabric.Image.fromURL(patternCanvas.toDataURL(), (img) => {
            img.set({
                selectable: false,
                evented: false
            });
            canvas.setOverlayImage(img, canvas.renderAll.bind(canvas));
        });
    }

    // Draw dotted pattern
    drawDottedPattern() {
        const dotSpacing = 25;
        const dotRadius = 1.5;
        const canvas = this.canvas;

        // Create pattern using canvas context
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = canvas.width;
        patternCanvas.height = canvas.height;
        const ctx = patternCanvas.getContext('2d');

        // Determine dot color based on background
        const isLight = this.isLightColor(this.currentCanvasColor || '#1a1a1a');
        const dotColor = isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';

        ctx.fillStyle = dotColor;

        // Draw dots
        for (let x = 0; x <= canvas.width; x += dotSpacing) {
            for (let y = 0; y <= canvas.height; y += dotSpacing) {
                ctx.beginPath();
                ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Apply as overlay
        fabric.Image.fromURL(patternCanvas.toDataURL(), (img) => {
            img.set({
                selectable: false,
                evented: false
            });
            canvas.setOverlayImage(img, canvas.renderAll.bind(canvas));
        });
    }

    // Apply remote theme change
    applyRemoteThemeChange(theme, color) {
        this.currentTheme = theme;
        if (color) {
            this.currentCanvasColor = color;
        }
        this.applyTheme();

        // Update eraser color if currently using eraser
        if (this.currentTool === 'eraser') {
            const eraserColor = this.isLightColor(this.currentCanvasColor) ? this.currentCanvasColor : '#1a1a1a';
            this.canvas.freeDrawingBrush.color = eraserColor;
        }

        // Update theme selector in UI
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = theme;
        }

        // Update canvas color in UI
        if (color) {
            const canvasColorInput = document.getElementById('canvas-color-input');
            if (canvasColorInput) {
                canvasColorInput.value = color;
            }
            // Update active color preset
            document.querySelectorAll('.canvas-color-preset').forEach(btn => {
                btn.classList.remove('active');
                if (btn.dataset.canvasColor === color) {
                    btn.classList.add('active');
                }
            });
        }
    }

    // Create sticky note
    createStickyNote(x, y) {
        const stickyId = generateId();

        // Create sticky note group
        const rect = new fabric.Rect({
            width: 200,
            height: 150,
            fill: this.currentColor,
            stroke: this.currentColor,
            strokeWidth: 2,
            rx: 8,
            ry: 8,
            shadow: '0 4px 12px rgba(0,0,0,0.3)'
        });

        const text = new fabric.IText('Double-click to edit', {
            fontSize: 16,
            fill: '#000',
            fontFamily: 'Inter, sans-serif',
            width: 180,
            top: 10,
            left: 10
        });

        const group = new fabric.Group([rect, text], {
            left: x || 100,
            top: y || 100,
            id: stickyId,
            selectable: true,
            hasControls: true,
            lockRotation: false
        });

        this.isReceivingRemoteChanges = true;
        this.canvas.add(group);
        this.isReceivingRemoteChanges = false;

        // Send to other users
        const serialized = this.serializeObject(group);
        this.socketManager.sendCanvasObjectAdded(serialized);

        this.canvas.setActiveObject(group);
        this.canvas.renderAll();
    }

    // Clear canvas
    clear() {
        this.isReceivingRemoteChanges = true;
        this.canvas.clear();
        this.applyTheme(); // Reapply current theme
        this.isReceivingRemoteChanges = false;
        this.socketManager.sendCanvasClear();
    }

    // Serialize object for transmission
    serializeObject(obj) {
        return {
            id: obj.id,
            type: obj.type,
            data: obj.toJSON(['id'])
        };
    }

    // Apply remote object added
    applyRemoteObjectAdded(data) {
        this.isReceivingRemoteChanges = true;

        fabric.util.enlivenObjects([data.object.data], (objects) => {
            objects.forEach(obj => {
                obj.id = data.object.id;
                this.canvas.add(obj);
            });
            this.canvas.renderAll();
            this.isReceivingRemoteChanges = false;
        });
    }

    // Apply remote object modified
    applyRemoteObjectModified(data) {
        this.isReceivingRemoteChanges = true;

        const obj = this.canvas.getObjects().find(o => o.id === data.object.id);
        if (obj) {
            obj.set(data.object.data);
            this.canvas.renderAll();
        }

        this.isReceivingRemoteChanges = false;
    }

    // Apply remote object removed
    applyRemoteObjectRemoved(objectId) {
        this.isReceivingRemoteChanges = true;

        const obj = this.canvas.getObjects().find(o => o.id === objectId);
        if (obj) {
            this.canvas.remove(obj);
            this.canvas.renderAll();
        }

        this.isReceivingRemoteChanges = false;
    }

    // Apply remote clear
    applyRemoteClear() {
        this.isReceivingRemoteChanges = true;
        this.canvas.clear();
        this.applyTheme(); // Reapply current theme
        this.isReceivingRemoteChanges = false;
    }

    // Load canvas state (for joining existing room)
    loadCanvasState(state) {
        this.isReceivingRemoteChanges = true;

        // Load theme and color if provided
        if (state.theme) {
            this.currentTheme = state.theme;
            if (state.canvasColor) {
                this.currentCanvasColor = state.canvasColor;
            }
            this.applyTheme();

            // Update theme selector in UI
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect) {
                themeSelect.value = state.theme;
            }

            // Update canvas color in UI
            if (state.canvasColor) {
                const canvasColorInput = document.getElementById('canvas-color-input');
                if (canvasColorInput) {
                    canvasColorInput.value = state.canvasColor;
                }
                // Update active color preset
                document.querySelectorAll('.canvas-color-preset').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.dataset.canvasColor === state.canvasColor) {
                        btn.classList.add('active');
                    }
                });
            }
        }

        // Load objects if any
        if (state.objects && state.objects.length > 0) {
            const objectsData = state.objects.map(obj => obj.data);
            fabric.util.enlivenObjects(objectsData, (objects) => {
                objects.forEach((obj, index) => {
                    obj.id = state.objects[index].id;
                    this.canvas.add(obj);
                });
                this.canvas.renderAll();
                this.isReceivingRemoteChanges = false;
            });
        } else {
            this.isReceivingRemoteChanges = false;
        }
    }
}

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

        // Pan and zoom state
        this.isPanning = false;
        this.lastPosX = 0;
        this.lastPosY = 0;

        // Resize canvas to fill container
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Setup pan and zoom controls
        this.setupPanZoom();

        // Listen to canvas events
        this.setupCanvasEvents();
    }

    resizeCanvas() {
        const container = document.getElementById('canvas-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Set display size (viewport)
        this.canvas.setDimensions({
            width: width,
            height: height
        });

        // Don't resize the actual canvas - keep it large for endless feel
        // This is set in constructor
    }

    setupPanZoom() {
        // Enable panning with Space key + drag
        this.canvas.on('mouse:down', (opt) => {
            const evt = opt.e;
            if (evt.spaceKey || evt.altKey) {
                this.isPanning = true;
                this.canvas.selection = false;
                this.lastPosX = evt.clientX;
                this.lastPosY = evt.clientY;
                this.canvas.defaultCursor = 'grabbing';
            }
        });

        this.canvas.on('mouse:move', (opt) => {
            if (this.isPanning) {
                const evt = opt.e;
                const vpt = this.canvas.viewportTransform;
                vpt[4] += evt.clientX - this.lastPosX;
                vpt[5] += evt.clientY - this.lastPosY;
                this.canvas.requestRenderAll();
                this.lastPosX = evt.clientX;
                this.lastPosY = evt.clientY;
            }
        });

        this.canvas.on('mouse:up', () => {
            this.isPanning = false;
            this.canvas.selection = true;
            this.canvas.defaultCursor = 'default';
        });

        // Enable zooming with mouse wheel
        this.canvas.on('mouse:wheel', (opt) => {
            const delta = opt.e.deltaY;
            let zoom = this.canvas.getZoom();
            zoom *= 0.999 ** delta;
            if (zoom > 20) zoom = 20; // Max zoom in
            if (zoom < 0.1) zoom = 0.1; // Max zoom out

            this.canvas.zoomToPoint(
                { x: opt.e.offsetX, y: opt.e.offsetY },
                zoom
            );

            opt.e.preventDefault();
            opt.e.stopPropagation();

            // Update zoom display
            this.updateZoomDisplay(zoom);
        });

        // Track space key
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                this.canvas.defaultCursor = 'grab';
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.canvas.defaultCursor = 'default';
            }
        });
    }

    updateZoomDisplay(zoom) {
        const percentage = Math.round(zoom * 100);
        // You can add a zoom indicator in the UI here
        console.log(`Zoom: ${percentage}%`);
    }

    // IMPORTANT: Independent Canvas Views Architecture
    // - Each user's viewport transform (pan/zoom) is LOCAL ONLY and NOT synced
    // - Canvas objects are synced in absolute canvas coordinates
    // - This allows each user to independently navigate while collaborating on same objects
    // - Cursor positions are sent in canvas coordinates, so they display correctly
    //   regardless of each user's viewport settings

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

        // Clear any active shape drawing listeners
        this.clearShapeDrawingListeners();

        if (tool === 'pen') {
            this.canvas.isDrawingMode = true;
            this.canvas.selection = false;
            this.canvas.freeDrawingBrush.color = this.currentColor;
            this.canvas.freeDrawingBrush.width = this.currentWidth;
        } else if (tool === 'eraser') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = true;
            this.enableEraserTool();
        } else if (tool === 'sticky') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = true;
        } else if (tool === 'rectangle') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.enableRectangleTool();
        } else if (tool === 'circle') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.enableCircleTool();
        } else if (tool === 'line') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.enableLineTool();
        } else if (tool === 'triangle') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = false;
            this.enableTriangleTool();
        } else if (tool === 'select') {
            this.canvas.isDrawingMode = false;
            this.canvas.selection = true;
        }
    }

    // Clear shape drawing listeners
    clearShapeDrawingListeners() {
        if (this.shapeMouseDown) {
            this.canvas.off('mouse:down', this.shapeMouseDown);
        }
        if (this.shapeMouseMove) {
            this.canvas.off('mouse:move', this.shapeMouseMove);
        }
        if (this.shapeMouseUp) {
            this.canvas.off('mouse:up', this.shapeMouseUp);
        }

        // Clear eraser listeners
        if (this.eraserMouseDown) {
            this.canvas.off('mouse:down', this.eraserMouseDown);
        }
        if (this.eraserMouseMove) {
            this.canvas.off('mouse:move', this.eraserMouseMove);
        }
        if (this.eraserMouseUp) {
            this.canvas.off('mouse:up', this.eraserMouseUp);
        }

        // Reset cursor
        this.canvas.defaultCursor = 'default';
        this.canvas.hoverCursor = 'move';
    }

    // Enable eraser tool (removes objects)
    enableEraserTool() {
        let isErasing = false;
        const eraserSize = this.currentWidth * 5; // Eraser area radius

        this.eraserMouseDown = (o) => {
            isErasing = true;
            this.eraseAtPosition(o.e);
        };

        this.eraserMouseMove = (o) => {
            if (!isErasing) return;
            this.eraseAtPosition(o.e);
        };

        this.eraserMouseUp = () => {
            isErasing = false;
        };

        this.canvas.on('mouse:down', this.eraserMouseDown);
        this.canvas.on('mouse:move', this.eraserMouseMove);
        this.canvas.on('mouse:up', this.eraserMouseUp);

        // Change cursor to indicate eraser mode
        this.canvas.defaultCursor = 'crosshair';
        this.canvas.hoverCursor = 'crosshair';
    }

    // Erase objects at mouse position
    eraseAtPosition(e) {
        const pointer = this.canvas.getPointer(e);
        const eraserSize = this.currentWidth * 5;

        // Get all objects on canvas
        const objects = this.canvas.getObjects();
        const objectsToRemove = [];

        objects.forEach(obj => {
            // Skip sticky notes (protected from eraser)
            if (obj.isSticky) {
                return;
            }

            // Skip background patterns and overlays
            if (obj === this.canvas.backgroundImage || obj === this.canvas.overlayImage) {
                return;
            }

            // Check if object intersects with eraser area
            if (this.objectIntersectsEraser(obj, pointer, eraserSize)) {
                objectsToRemove.push(obj);
            }
        });

        // Remove intersecting objects
        objectsToRemove.forEach(obj => {
            this.canvas.remove(obj);
            if (obj.id) {
                this.socketManager.sendCanvasObjectRemoved(obj.id);
            }
        });

        this.canvas.renderAll();
    }

    // Check if object intersects with eraser area
    objectIntersectsEraser(obj, pointer, eraserSize) {
        const objLeft = obj.left;
        const objTop = obj.top;
        const objWidth = obj.width * (obj.scaleX || 1);
        const objHeight = obj.height * (obj.scaleY || 1);

        // Simple circle-rectangle intersection check
        const circleX = pointer.x;
        const circleY = pointer.y;

        // Find closest point on rectangle to circle center
        const closestX = Math.max(objLeft, Math.min(circleX, objLeft + objWidth));
        const closestY = Math.max(objTop, Math.min(circleY, objTop + objHeight));

        // Calculate distance
        const distanceX = circleX - closestX;
        const distanceY = circleY - closestY;
        const distanceSquared = (distanceX * distanceX) + (distanceY * distanceY);

        return distanceSquared < (eraserSize * eraserSize);
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

            case 'none':
            default:
                // Just plain color, no pattern
                break;
        }

        this.canvas.renderAll();
    }

    // Draw grid pattern using tiling for endless canvas
    drawGridPattern() {
        const gridSize = 40;
        const canvas = this.canvas;

        // Create small tile pattern that will repeat
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = gridSize;
        patternCanvas.height = gridSize;
        const ctx = patternCanvas.getContext('2d');

        // Determine grid color based on background
        const isLight = this.isLightColor(this.currentCanvasColor || '#1a1a1a');
        const gridColor = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

        // Fill with background color first
        ctx.fillStyle = this.currentCanvasColor || '#1a1a1a';
        ctx.fillRect(0, 0, gridSize, gridSize);

        // Draw grid lines on the tile
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;

        // Right edge (vertical line)
        ctx.beginPath();
        ctx.moveTo(gridSize - 0.5, 0);
        ctx.lineTo(gridSize - 0.5, gridSize);
        ctx.stroke();

        // Bottom edge (horizontal line)
        ctx.beginPath();
        ctx.moveTo(0, gridSize - 0.5);
        ctx.lineTo(gridSize, gridSize - 0.5);
        ctx.stroke();

        // Create Fabric pattern and set as background
        const pattern = new fabric.Pattern({
            source: patternCanvas,
            repeat: 'repeat'
        });

        canvas.backgroundColor = pattern;
        canvas.renderAll();
    }

    // Draw dotted pattern using tiling for endless canvas
    drawDottedPattern() {
        const dotSpacing = 25;
        const dotRadius = 1.5;
        const canvas = this.canvas;

        // Create small tile pattern that will repeat
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = dotSpacing;
        patternCanvas.height = dotSpacing;
        const ctx = patternCanvas.getContext('2d');

        // Fill with background color first
        ctx.fillStyle = this.currentCanvasColor || '#1a1a1a';
        ctx.fillRect(0, 0, dotSpacing, dotSpacing);

        // Determine dot color based on background
        const isLight = this.isLightColor(this.currentCanvasColor || '#1a1a1a');
        const dotColor = isLight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.2)';

        // Draw single dot in center of tile
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(dotSpacing / 2, dotSpacing / 2, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        // Create Fabric pattern and set as background
        const pattern = new fabric.Pattern({
            source: patternCanvas,
            repeat: 'repeat'
        });

        canvas.backgroundColor = pattern;
        canvas.renderAll();
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
            isSticky: true, // Protect from eraser
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

    // Enable rectangle drawing tool
    enableRectangleTool() {
        let rect, isDown, origX, origY;

        this.shapeMouseDown = (o) => {
            isDown = true;
            const pointer = this.canvas.getPointer(o.e);
            origX = pointer.x;
            origY = pointer.y;

            rect = new fabric.Rect({
                left: origX,
                top: origY,
                width: 0,
                height: 0,
                fill: 'transparent',
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true,
                hasControls: true
            });

            rect.id = generateId();
            this.canvas.add(rect);
        };

        this.shapeMouseMove = (o) => {
            if (!isDown) return;
            const pointer = this.canvas.getPointer(o.e);

            if (pointer.x < origX) {
                rect.set({ left: pointer.x });
            }
            if (pointer.y < origY) {
                rect.set({ top: pointer.y });
            }

            rect.set({
                width: Math.abs(pointer.x - origX),
                height: Math.abs(pointer.y - origY)
            });

            this.canvas.renderAll();
        };

        this.shapeMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            rect.setCoords();

            // Only sync if shape has size
            if (rect.width > 2 && rect.height > 2) {
                const serialized = this.serializeObject(rect);
                this.socketManager.sendCanvasObjectAdded(serialized);
            } else {
                // Remove tiny shapes
                this.canvas.remove(rect);
            }
        };

        this.canvas.on('mouse:down', this.shapeMouseDown);
        this.canvas.on('mouse:move', this.shapeMouseMove);
        this.canvas.on('mouse:up', this.shapeMouseUp);
    }

    // Enable circle drawing tool
    enableCircleTool() {
        let circle, isDown, origX, origY;

        this.shapeMouseDown = (o) => {
            isDown = true;
            const pointer = this.canvas.getPointer(o.e);
            origX = pointer.x;
            origY = pointer.y;

            circle = new fabric.Circle({
                left: origX,
                top: origY,
                radius: 0,
                fill: 'transparent',
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true,
                hasControls: true
            });

            circle.id = generateId();
            this.canvas.add(circle);
        };

        this.shapeMouseMove = (o) => {
            if (!isDown) return;
            const pointer = this.canvas.getPointer(o.e);

            const radius = Math.sqrt(
                Math.pow(pointer.x - origX, 2) +
                Math.pow(pointer.y - origY, 2)
            ) / 2;

            circle.set({ radius: radius });
            circle.set({
                left: origX - radius,
                top: origY - radius
            });

            this.canvas.renderAll();
        };

        this.shapeMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            circle.setCoords();

            // Only sync if shape has size
            if (circle.radius > 2) {
                const serialized = this.serializeObject(circle);
                this.socketManager.sendCanvasObjectAdded(serialized);
            } else {
                // Remove tiny shapes
                this.canvas.remove(circle);
            }
        };

        this.canvas.on('mouse:down', this.shapeMouseDown);
        this.canvas.on('mouse:move', this.shapeMouseMove);
        this.canvas.on('mouse:up', this.shapeMouseUp);
    }

    // Enable line drawing tool
    enableLineTool() {
        let line, isDown, origX, origY;

        this.shapeMouseDown = (o) => {
            isDown = true;
            const pointer = this.canvas.getPointer(o.e);
            origX = pointer.x;
            origY = pointer.y;

            line = new fabric.Line([origX, origY, origX, origY], {
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true,
                hasControls: true
            });

            line.id = generateId();
            this.canvas.add(line);
        };

        this.shapeMouseMove = (o) => {
            if (!isDown) return;
            const pointer = this.canvas.getPointer(o.e);

            line.set({
                x2: pointer.x,
                y2: pointer.y
            });

            this.canvas.renderAll();
        };

        this.shapeMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            line.setCoords();

            // Only sync if line has length
            const length = Math.sqrt(
                Math.pow(line.x2 - line.x1, 2) +
                Math.pow(line.y2 - line.y1, 2)
            );

            if (length > 2) {
                const serialized = this.serializeObject(line);
                this.socketManager.sendCanvasObjectAdded(serialized);
            } else {
                // Remove tiny lines
                this.canvas.remove(line);
            }
        };

        this.canvas.on('mouse:down', this.shapeMouseDown);
        this.canvas.on('mouse:move', this.shapeMouseMove);
        this.canvas.on('mouse:up', this.shapeMouseUp);
    }

    // Enable triangle drawing tool
    enableTriangleTool() {
        let triangle, isDown, origX, origY;

        this.shapeMouseDown = (o) => {
            isDown = true;
            const pointer = this.canvas.getPointer(o.e);
            origX = pointer.x;
            origY = pointer.y;

            triangle = new fabric.Triangle({
                left: origX,
                top: origY,
                width: 0,
                height: 0,
                fill: 'transparent',
                stroke: this.currentColor,
                strokeWidth: this.currentWidth,
                selectable: true,
                hasControls: true
            });

            triangle.id = generateId();
            this.canvas.add(triangle);
        };

        this.shapeMouseMove = (o) => {
            if (!isDown) return;
            const pointer = this.canvas.getPointer(o.e);

            if (pointer.x < origX) {
                triangle.set({ left: pointer.x });
            }
            if (pointer.y < origY) {
                triangle.set({ top: pointer.y });
            }

            triangle.set({
                width: Math.abs(pointer.x - origX),
                height: Math.abs(pointer.y - origY)
            });

            this.canvas.renderAll();
        };

        this.shapeMouseUp = () => {
            if (!isDown) return;
            isDown = false;
            triangle.setCoords();

            // Only sync if shape has size
            if (triangle.width > 2 && triangle.height > 2) {
                const serialized = this.serializeObject(triangle);
                this.socketManager.sendCanvasObjectAdded(serialized);
            } else {
                // Remove tiny shapes
                this.canvas.remove(triangle);
            }
        };

        this.canvas.on('mouse:down', this.shapeMouseDown);
        this.canvas.on('mouse:move', this.shapeMouseMove);
        this.canvas.on('mouse:up', this.shapeMouseUp);
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

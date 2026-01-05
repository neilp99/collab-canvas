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
            this.canvas.freeDrawingBrush.color = '#1a1a1a'; // Match canvas background
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
        this.canvas.backgroundColor = '#1a1a1a';
        this.canvas.renderAll();
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
        this.canvas.backgroundColor = '#1a1a1a';
        this.canvas.renderAll();
        this.isReceivingRemoteChanges = false;
    }

    // Load canvas state (for joining existing room)
    loadCanvasState(state) {
        if (!state || !state.objects || state.objects.length === 0) return;

        this.isReceivingRemoteChanges = true;

        const objectsData = state.objects.map(obj => obj.data);
        fabric.util.enlivenObjects(objectsData, (objects) => {
            objects.forEach((obj, index) => {
                obj.id = state.objects[index].id;
                this.canvas.add(obj);
            });
            this.canvas.renderAll();
            this.isReceivingRemoteChanges = false;
        });
    }
}

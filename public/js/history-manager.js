// History Manager - Handles undo/redo functionality for canvas operations

class HistoryManager {
    constructor(canvasManager, socketManager) {
        this.canvasManager = canvasManager;
        this.socketManager = socketManager;
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistorySize = 100; // Limit history to prevent memory issues
        this.userId = null; // Will be set when user joins room

        // Listen for user ID from socket manager
        this.socketManager.on('room-joined', (data) => {
            this.userId = data.user.id;
        });

        // Listen for room creation
        this.socketManager.on('room-created', (data) => {
            this.userId = data.user.id;
        });
    }

    // Record a canvas action for undo/redo
    recordAction(type, objectData, isRemote = false) {
        // Don't record remote actions (other users' changes)
        if (isRemote) return;

        // Don't record if we don't have a user ID yet
        if (!this.userId) return;

        const action = {
            type: type, // 'ADD', 'MODIFY', 'REMOVE', 'CLEAR'
            objectData: objectData,
            timestamp: Date.now(),
            userId: this.userId
        };

        // Add to undo stack
        this.undoStack.push(action);

        // Limit stack size
        if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift(); // Remove oldest
        }

        // Clear redo stack when new action is performed
        this.redoStack = [];

        // Update UI button states
        this.updateUIState();
    }

    // Undo the last action
    undo() {
        if (!this.canUndo()) return;

        const action = this.undoStack.pop();

        // Apply the undo
        this.applyUndo(action);

        // Add to redo stack
        this.redoStack.push(action);

        // Update UI button states
        this.updateUIState();
    }

    // Redo the last undone action
    redo() {
        if (!this.canRedo()) return;

        const action = this.redoStack.pop();

        // Apply the redo
        this.applyRedo(action);

        // Add back to undo stack
        this.undoStack.push(action);

        // Update UI button states
        this.updateUIState();
    }

    // Apply undo for different action types
    applyUndo(action) {
        const canvas = this.canvasManager.canvas;
        this.canvasManager.isReceivingRemoteChanges = true;

        switch (action.type) {
            case 'ADD':
                // Remove the added object
                const addedObj = canvas.getObjects().find(obj => obj.id === action.objectData.id);
                if (addedObj) {
                    canvas.remove(addedObj);
                    // Send removal to other users
                    this.socketManager.sendCanvasObjectRemoved(action.objectData.id);
                }
                break;

            case 'MODIFY':
                // Restore previous state
                const modifiedObj = canvas.getObjects().find(obj => obj.id === action.objectData.id);
                if (modifiedObj && action.objectData.previousState) {
                    // Restore previous properties
                    modifiedObj.set(action.objectData.previousState);
                    modifiedObj.setCoords();
                    canvas.renderAll();
                    // Send modification to other users
                    const serialized = this.canvasManager.serializeObject(modifiedObj);
                    this.socketManager.sendCanvasObjectModified(serialized);
                }
                break;

            case 'REMOVE':
                // Re-add the removed object
                if (action.objectData.data) {
                    fabric.util.enlivenObjects([action.objectData.data], (objects) => {
                        const obj = objects[0];
                        obj.id = action.objectData.id;
                        canvas.add(obj);
                        canvas.renderAll();
                        // Send addition to other users
                        const serialized = this.canvasManager.serializeObject(obj);
                        this.socketManager.sendCanvasObjectAdded(serialized);
                        this.canvasManager.isReceivingRemoteChanges = false;
                    });
                    return; // Early return since enlivenObjects is async
                }
                break;

            case 'CLEAR':
                // Restore all cleared objects
                if (action.objectData.objects && action.objectData.objects.length > 0) {
                    const objectsData = action.objectData.objects.map(obj => obj.data);
                    fabric.util.enlivenObjects(objectsData, (objects) => {
                        objects.forEach((obj, index) => {
                            obj.id = action.objectData.objects[index].id;
                            canvas.add(obj);
                            // Send addition to other users
                            const serialized = this.canvasManager.serializeObject(obj);
                            this.socketManager.sendCanvasObjectAdded(serialized);
                        });
                        canvas.renderAll();
                        this.canvasManager.isReceivingRemoteChanges = false;
                    });
                    return; // Early return since enlivenObjects is async
                }
                break;
        }

        this.canvasManager.isReceivingRemoteChanges = false;
    }

    // Apply redo for different action types
    applyRedo(action) {
        const canvas = this.canvasManager.canvas;
        this.canvasManager.isReceivingRemoteChanges = true;

        switch (action.type) {
            case 'ADD':
                // Re-add the object
                if (action.objectData.data) {
                    fabric.util.enlivenObjects([action.objectData.data], (objects) => {
                        const obj = objects[0];
                        obj.id = action.objectData.id;
                        canvas.add(obj);
                        canvas.renderAll();
                        // Send addition to other users
                        const serialized = this.canvasManager.serializeObject(obj);
                        this.socketManager.sendCanvasObjectAdded(serialized);
                        this.canvasManager.isReceivingRemoteChanges = false;
                    });
                    return; // Early return since enlivenObjects is async
                }
                break;

            case 'MODIFY':
                // Restore new state
                const modifiedObj = canvas.getObjects().find(obj => obj.id === action.objectData.id);
                if (modifiedObj && action.objectData.newState) {
                    // Restore new properties
                    modifiedObj.set(action.objectData.newState);
                    modifiedObj.setCoords();
                    canvas.renderAll();
                    // Send modification to other users
                    const serialized = this.canvasManager.serializeObject(modifiedObj);
                    this.socketManager.sendCanvasObjectModified(serialized);
                }
                break;

            case 'REMOVE':
                // Remove the object again
                const removedObj = canvas.getObjects().find(obj => obj.id === action.objectData.id);
                if (removedObj) {
                    canvas.remove(removedObj);
                    // Send removal to other users
                    this.socketManager.sendCanvasObjectRemoved(action.objectData.id);
                }
                break;

            case 'CLEAR':
                // Clear canvas again
                const allObjects = canvas.getObjects().filter(obj => {
                    // Keep background/overlay objects
                    return obj !== canvas.backgroundImage && obj !== canvas.overlayImage;
                });

                allObjects.forEach(obj => {
                    canvas.remove(obj);
                    if (obj.id) {
                        this.socketManager.sendCanvasObjectRemoved(obj.id);
                    }
                });

                this.canvasManager.applyTheme(); // Reapply theme
                canvas.renderAll();
                break;
        }

        this.canvasManager.isReceivingRemoteChanges = false;
    }

    // Check if undo is available
    canUndo() {
        return this.undoStack.length > 0;
    }

    // Check if redo is available
    canRedo() {
        return this.redoStack.length > 0;
    }

    // Clear all history (called when leaving room)
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.userId = null;
        this.updateUIState();
    }

    // Update UI button states
    updateUIState() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) {
            undoBtn.disabled = !this.canUndo();
        }

        if (redoBtn) {
            redoBtn.disabled = !this.canRedo();
        }
    }
}

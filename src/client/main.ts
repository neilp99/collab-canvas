// Main entry point for Vite
// The existing JS files are written with global scope expectations
// We need to load them as scripts, not ES modules

// Function to load a script dynamically
function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

// Load all scripts in order
async function init() {
    try {
        await loadScript('/utils.js');
        await loadScript('/socket-manager.js');
        await loadScript('/canvas-manager.js');
        await loadScript('/video-manager.js');
        await loadScript('/chat-manager.js');
        await loadScript('/app.js');
        console.log('All scripts loaded successfully');
    } catch (error) {
        console.error('Error loading scripts:', error);
    }
}

init();


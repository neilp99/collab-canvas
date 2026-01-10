// Utility functions

// Generate a random UUID-like ID
export function generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Throttle function to limit execution frequency
export function throttle<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    let lastRan: number | null = null;

    return function (this: any, ...args: Parameters<T>) {
        if (!lastRan) {
            func.apply(this, args);
            lastRan = Date.now();
        } else {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (lastRan && (Date.now() - lastRan) >= wait) {
                    func.apply(this, args);
                    lastRan = Date.now();
                }
            }, wait - (Date.now() - lastRan));
        }
    };
}

// Debounce function to delay execution
export function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    return function (this: any, ...args: Parameters<T>) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Copy text to clipboard
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    }
}

// Parse URL parameters
export function getUrlParams(): { roomId: string | null } {
    const params = new URLSearchParams(window.location.search);
    return {
        roomId: params.get('room')
    };
}

// Update URL without reloading
export function updateUrl(roomId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.pushState({}, '', url.toString());
}

// Get random color from predefined palette
export function getRandomColor(): string {
    const colors = [
        '#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#a29bfe',
        '#fd79a8', '#fdcb6e', '#6c5ce7', '#00b894', '#e17055'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Show toast notification
export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div>
            ${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}
        </div>
        <div>${message}</div>
    `;

    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Format timestamp
export function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
}

// Detect if device is mobile/touch
export function isTouchDevice(): boolean {
    return ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0);
}

// Get user's browser info for debugging
export function getBrowserInfo(): { browser: string; platform: string; isMobile: boolean } {
    const ua = navigator.userAgent;
    let browser = 'Unknown';

    if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (ua.indexOf('Safari') > -1) browser = 'Safari';
    else if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (ua.indexOf('Edge') > -1) browser = 'Edge';

    return {
        browser,
        platform: navigator.platform,
        isMobile: /Mobile|Android|iPhone|iPad/i.test(ua)
    };
}

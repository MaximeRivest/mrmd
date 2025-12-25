/**
 * mrmd Platform Interfaces
 *
 * Abstract interfaces for cross-platform compatibility.
 * Implementations provided for: Browser, VSCode, Electron
 */

/**
 * File provider interface for reading/writing files.
 * @interface IFileProvider
 */
export class IFileProvider {
    /**
     * Read file contents.
     * @param {string} path - File path
     * @returns {Promise<{content: string, path: string, project_root?: string, environments?: Array}>}
     */
    async read(path) { throw new Error('Not implemented'); }

    /**
     * Write file contents.
     * @param {string} path - File path
     * @param {string} content - Content to write
     * @returns {Promise<void>}
     */
    async write(path, content) { throw new Error('Not implemented'); }

    /**
     * Search for files.
     * @param {Object} options - Search options
     * @param {string} options.query - Search query
     * @param {string} options.root - Root directory
     * @param {string[]} options.extensions - File extensions to match
     * @param {number} options.maxResults - Maximum results
     * @returns {Promise<{results: Array<{path: string, filename: string}>}>}
     */
    async search(options) { throw new Error('Not implemented'); }

    /**
     * Show file picker dialog.
     * @returns {Promise<{content: string, filename: string, handle?: any}|null>}
     */
    async showOpenDialog() { throw new Error('Not implemented'); }
}

/**
 * State store interface for persisting application state.
 * @interface IStateStore
 */
export class IStateStore {
    /**
     * Get a value from the store.
     * @param {string} key - Storage key
     * @param {any} defaultValue - Default if not found
     * @returns {any}
     */
    get(key, defaultValue = null) { throw new Error('Not implemented'); }

    /**
     * Set a value in the store.
     * @param {string} key - Storage key
     * @param {any} value - Value to store
     */
    set(key, value) { throw new Error('Not implemented'); }

    /**
     * Remove a value from the store.
     * @param {string} key - Storage key
     */
    remove(key) { throw new Error('Not implemented'); }
}

/**
 * UI provider interface for platform-specific UI operations.
 * @interface IUIProvider
 */
export class IUIProvider {
    /**
     * Show a confirmation dialog.
     * @param {string} message - Message to display
     * @returns {Promise<boolean>}
     */
    async confirm(message) { throw new Error('Not implemented'); }

    /**
     * Show a prompt dialog.
     * @param {string} message - Message to display
     * @param {string} defaultValue - Default value
     * @returns {Promise<string|null>}
     */
    async prompt(message, defaultValue = '') { throw new Error('Not implemented'); }

    /**
     * Show an alert/notification.
     * @param {string} message - Message to display
     * @param {'info'|'warning'|'error'} type - Message type
     */
    async alert(message, type = 'info') { throw new Error('Not implemented'); }

    /**
     * Update status indicator.
     * @param {string} text - Status text
     * @param {boolean} active - Whether status is active
     */
    setStatus(text, active = false) { throw new Error('Not implemented'); }
}

// ==================== Browser Implementations ====================

/**
 * Browser implementation of IFileProvider using fetch API.
 */
export class BrowserFileProvider extends IFileProvider {
    constructor(apiBase = '') {
        super();
        this.apiBase = apiBase;
    }

    async read(path) {
        const res = await fetch(`${this.apiBase}/api/file/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to read file');
        }
        return res.json();
    }

    async write(path, content) {
        const res = await fetch(`${this.apiBase}/api/file/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to write file');
        }
    }

    async search(options) {
        const res = await fetch(`${this.apiBase}/api/files/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: options.query || '',
                root: options.root || '/home',
                extensions: options.extensions || ['.md'],
                max_results: options.maxResults || 30
            })
        });
        return res.json();
    }

    async showOpenDialog() {
        try {
            // Use modern File System Access API if available
            if (window.showOpenFilePicker) {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Markdown files',
                        accept: { 'text/markdown': ['.md'] }
                    }]
                });
                const file = await handle.getFile();
                const content = await file.text();
                return { content, filename: file.name, handle };
            }
        } catch (err) {
            if (err.name === 'AbortError') return null;
        }

        // Fallback to legacy file input
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.md';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) { resolve(null); return; }
                const content = await file.text();
                resolve({ content, filename: file.name, handle: null });
            };
            input.click();
        });
    }
}

/**
 * Browser implementation of IStateStore using localStorage.
 */
export class BrowserStateStore extends IStateStore {
    constructor(prefix = 'mrmd_') {
        super();
        this.prefix = prefix;
    }

    get(key, defaultValue = null) {
        try {
            const value = localStorage.getItem(this.prefix + key);
            return value !== null ? JSON.parse(value) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    set(key, value) {
        localStorage.setItem(this.prefix + key, JSON.stringify(value));
    }

    remove(key) {
        localStorage.removeItem(this.prefix + key);
    }
}

/**
 * Browser implementation of IUIProvider using native dialogs.
 */
export class BrowserUIProvider extends IUIProvider {
    constructor(statusElement = null) {
        super();
        this.statusElement = statusElement;
    }

    async confirm(message) {
        return window.confirm(message);
    }

    async prompt(message, defaultValue = '') {
        return window.prompt(message, defaultValue);
    }

    async alert(message, type = 'info') {
        window.alert(message);
    }

    setStatus(text, active = false) {
        if (this.statusElement) {
            this.statusElement.textContent = text;
            this.statusElement.classList.toggle('active', active);
        }
    }
}

/**
 * Create default browser providers.
 */
export function createBrowserProviders(options = {}) {
    return {
        fileProvider: new BrowserFileProvider(options.apiBase || ''),
        stateStore: new BrowserStateStore(options.statePrefix || 'mrmd_'),
        uiProvider: new BrowserUIProvider(options.statusElement || null)
    };
}

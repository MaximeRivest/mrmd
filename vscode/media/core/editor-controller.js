/**
 * mrmd Editor Controller
 *
 * Manages editor views, file state, and document lifecycle.
 * Platform-independent - uses providers for file I/O and state.
 */

/**
 * EditorController manages the editor state and view switching.
 */
export class EditorController {
    /**
     * @param {Object} options
     * @param {IFileProvider} options.fileProvider - File provider implementation
     * @param {IStateStore} options.stateStore - State store implementation
     * @param {IUIProvider} options.uiProvider - UI provider implementation
     * @param {Function} options.onViewChange - Called when view changes
     * @param {Function} options.onFileChange - Called when file changes
     * @param {Function} options.onContentChange - Called when content changes
     */
    constructor(options = {}) {
        this.fileProvider = options.fileProvider;
        this.stateStore = options.stateStore;
        this.uiProvider = options.uiProvider;
        this.onViewChange = options.onViewChange || (() => {});
        this.onFileChange = options.onFileChange || (() => {});
        this.onContentChange = options.onContentChange || (() => {});

        // Document state
        this.content = '';
        this.currentFilePath = null;
        this.currentFilename = 'untitled.md';
        this.currentFileHandle = null;  // For File System Access API

        // View state
        this.currentView = 'overlay';
        this.views = ['text', 'overlay', 'preview', 'notebook'];

        // Sidecar data (outputs, sessions, etc.)
        this.sidecar = { outputs: {}, sessions: {}, version: 1 };

        // Recent files
        this.recentFiles = [];
        this.loadRecentFiles();
    }

    // ==================== View Management ====================

    /**
     * Get current view.
     */
    getView() {
        return this.currentView;
    }

    /**
     * Set current view.
     * @param {string} view - View name ('text', 'overlay', 'preview', 'notebook')
     */
    setView(view) {
        if (!this.views.includes(view)) return;
        this.currentView = view;
        this.onViewChange(view);
    }

    /**
     * Cycle to next view.
     */
    nextView() {
        const idx = this.views.indexOf(this.currentView);
        const nextIdx = (idx + 1) % this.views.length;
        this.setView(this.views[nextIdx]);
    }

    // ==================== Content Management ====================

    /**
     * Get current content.
     */
    getContent() {
        return this.content;
    }

    /**
     * Set content.
     * @param {string} content - New content
     */
    setContent(content) {
        this.content = content;
        this.onContentChange(content);
    }

    /**
     * Get sidecar data.
     */
    getSidecar() {
        return this.sidecar;
    }

    /**
     * Update sidecar output.
     * @param {string} blockId - Block identifier
     * @param {Object} output - Output data {text, styled}
     */
    setSidecarOutput(blockId, output) {
        this.sidecar.outputs[blockId] = output;
    }

    /**
     * Clear sidecar data.
     */
    clearSidecar() {
        this.sidecar = { outputs: {}, sessions: {}, version: 1 };
    }

    // ==================== File Operations ====================

    /**
     * Get current file info.
     */
    getFileInfo() {
        return {
            path: this.currentFilePath,
            filename: this.currentFilename,
            hasHandle: !!this.currentFileHandle
        };
    }

    /**
     * Create a new file.
     * @param {boolean} confirmClear - Whether to confirm clearing sessions
     */
    async newFile(confirmClear = true) {
        if (confirmClear && this.uiProvider) {
            const confirmed = await this.uiProvider.confirm('Create new file? Unsaved changes will be lost.');
            if (!confirmed) return false;
        }

        this.content = '';
        this.currentFilePath = null;
        this.currentFilename = 'untitled.md';
        this.currentFileHandle = null;
        this.clearSidecar();

        this.onFileChange({
            path: null,
            filename: 'untitled.md',
            content: ''
        });
        this.onContentChange('');

        return true;
    }

    /**
     * Open a file by path (using file provider).
     * @param {string} filePath - File path to open
     */
    async openFile(filePath) {
        if (this.uiProvider) {
            this.uiProvider.setStatus('loading...', true);
        }

        try {
            const data = await this.fileProvider.read(filePath);

            this.currentFilePath = data.path;
            this.currentFilename = data.path.split('/').pop();
            this.currentFileHandle = null;
            this.content = data.content;

            // Reset sidecar
            this.clearSidecar();

            // Try to load sidecar file
            try {
                const sidecarPath = this.currentFilePath.replace(/\.md$/, '.lrepl');
                const sidecarData = await this.fileProvider.read(sidecarPath);
                this.sidecar = JSON.parse(sidecarData.content);
            } catch (e) {
                // No sidecar file, use default
            }

            // Add to recent files
            this.addToRecentFiles(this.currentFilePath);

            this.onFileChange({
                path: this.currentFilePath,
                filename: this.currentFilename,
                content: this.content,
                projectRoot: data.project_root,
                environments: data.environments
            });
            this.onContentChange(this.content);

            if (this.uiProvider) {
                this.uiProvider.setStatus('ready', false);
            }

            return true;

        } catch (err) {
            console.error('Open failed:', err);
            if (this.uiProvider) {
                await this.uiProvider.alert('Failed to open file: ' + err.message, 'error');
                this.uiProvider.setStatus('ready', false);
            }
            return false;
        }
    }

    /**
     * Open file using system file picker.
     */
    async openWithPicker() {
        try {
            const result = await this.fileProvider.showOpenDialog();
            if (!result) return false;

            this.currentFilename = result.filename;
            this.currentFilePath = null;  // No server path
            this.currentFileHandle = result.handle;
            this.content = result.content;

            this.clearSidecar();

            this.onFileChange({
                path: null,
                filename: this.currentFilename,
                content: this.content,
                handle: result.handle
            });
            this.onContentChange(this.content);

            return true;

        } catch (err) {
            console.error('File picker error:', err);
            return false;
        }
    }

    /**
     * Save current file.
     */
    async saveFile() {
        if (this.uiProvider) {
            this.uiProvider.setStatus('saving...', true);
        }

        try {
            // If no path, prompt for one (Save As)
            if (!this.currentFilePath) {
                if (this.uiProvider) {
                    const path = await this.uiProvider.prompt('Enter file path to save:', '/home/' + this.currentFilename);
                    if (!path) {
                        this.uiProvider.setStatus('ready', false);
                        return false;
                    }
                    this.currentFilePath = path;
                    this.currentFilename = path.split('/').pop();
                    this.addToRecentFiles(this.currentFilePath);
                } else {
                    return false;
                }
            }

            // Save markdown
            await this.fileProvider.write(this.currentFilePath, this.content);

            // Save sidecar
            const sidecarPath = this.currentFilePath.replace(/\.md$/, '.lrepl');
            await this.fileProvider.write(sidecarPath, JSON.stringify(this.sidecar, null, 2));

            this.onFileChange({
                path: this.currentFilePath,
                filename: this.currentFilename,
                content: this.content
            });

            if (this.uiProvider) {
                this.uiProvider.setStatus('saved', false);
                setTimeout(() => this.uiProvider.setStatus('ready', false), 1000);
            }

            return true;

        } catch (err) {
            console.error('Save failed:', err);
            if (this.uiProvider) {
                this.uiProvider.setStatus('save failed', false);
                setTimeout(() => this.uiProvider.setStatus('ready', false), 2000);
            }
            return false;
        }
    }

    // ==================== Recent Files ====================

    /**
     * Load recent files from state store.
     */
    loadRecentFiles() {
        if (this.stateStore) {
            this.recentFiles = this.stateStore.get('recent_files', []);
        }
    }

    /**
     * Add a file to recent files.
     * @param {string} filePath - File path to add
     */
    addToRecentFiles(filePath) {
        // Remove if already exists
        this.recentFiles = this.recentFiles.filter(f => f.path !== filePath);

        // Add to front
        this.recentFiles.unshift({
            path: filePath,
            filename: filePath.split('/').pop(),
            timestamp: Date.now()
        });

        // Keep only last 10
        this.recentFiles = this.recentFiles.slice(0, 10);

        // Save to state store
        if (this.stateStore) {
            this.stateStore.set('recent_files', this.recentFiles);
        }
    }

    /**
     * Remove a file from recent files.
     * @param {string} filePath - File path to remove
     */
    removeFromRecentFiles(filePath) {
        this.recentFiles = this.recentFiles.filter(f => f.path !== filePath);
        if (this.stateStore) {
            this.stateStore.set('recent_files', this.recentFiles);
        }
    }

    /**
     * Clear recent files.
     */
    clearRecentFiles() {
        this.recentFiles = [];
        if (this.stateStore) {
            this.stateStore.set('recent_files', []);
        }
    }

    /**
     * Get recent files list.
     */
    getRecentFiles() {
        return this.recentFiles;
    }
}

/**
 * Create an editor controller with browser providers.
 */
export function createEditorController(options = {}) {
    return new EditorController(options);
}

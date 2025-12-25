/**
 * Collaboration Client - WebSocket client for file watching and presence
 *
 * Handles:
 * - WebSocket connection to /api/collab
 * - File watching (external changes via watchdog)
 * - Directory watching (file browser updates)
 * - Presence tracking (who's in the project)
 * - Auto-reconnect
 *
 * IMPORTANT: When using the EditorBridge in collaborative mode, prefer using
 * EditorBridge's built-in file watching methods instead of CollabClient:
 * - editorBridge.watchFile() / unwatchFile()
 * - editorBridge.watchDirectory() / unwatchDirectory()
 *
 * This avoids duplicate WebSocket connections. The EditorBridge's collaborative
 * provider handles file watching through the same connection used for Yjs sync.
 *
 * External file changes to the currently-edited document are automatically
 * synced via Yjs - no separate file_changed handling needed.
 *
 * Use CollabClient directly when:
 * - Not using EditorBridge (e.g., standalone file browser)
 * - Need presence tracking outside of document editing
 * - Legacy compatibility
 *
 * NOTE: Document sync and cursor sharing are handled by the editor's
 * Yjs collaboration system (see editor/src/collaboration/).
 * This client focuses on file system watching and presence.
 */

export class CollabClient {
    constructor(options = {}) {
        this.options = {
            userName: options.userName || 'Anonymous',
            userType: options.userType || 'human',
            projectRoot: options.projectRoot || null,
            onConnect: options.onConnect || (() => {}),
            onDisconnect: options.onDisconnect || (() => {}),
            onPresence: options.onPresence || (() => {}),
            onFileSaved: options.onFileSaved || (() => {}),
            onUserJoined: options.onUserJoined || (() => {}),
            onUserLeft: options.onUserLeft || (() => {}),
            onFileChanged: options.onFileChanged || null,  // External file change handler
            onDirectoryChanged: options.onDirectoryChanged || null,  // Directory content change handler
            ...options
        };

        this.ws = null;
        this.sessionId = null;
        this.color = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;

        // Heartbeat
        this._heartbeatInterval = null;

        // Watch callbacks
        this._watchFileCallbacks = {};
        this._watchDirCallbacks = {};
    }

    /**
     * Connect to collaboration server.
     */
    connect(projectRoot = null) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        const project = projectRoot || this.options.projectRoot;
        if (!project) {
            console.warn('[Collab] No project root specified');
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const params = new URLSearchParams({
            project: project,
            user: this.options.userName,
            type: this.options.userType
        });

        const url = `${protocol}//${host}/api/collab?${params}`;
        console.log('[Collab] Connecting to', url);

        this.ws = new WebSocket(url);
        this._bindWebSocketEvents();
    }

    /**
     * Disconnect from collaboration server.
     */
    disconnect() {
        this._stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.sessionId = null;
    }

    _bindWebSocketEvents() {
        this.ws.onopen = () => {
            console.log('[Collab] Connected');
            this.connected = true;
            this.reconnectAttempts = 0;
            this._startHeartbeat();
        };

        this.ws.onclose = (event) => {
            console.log('[Collab] Disconnected', event.code, event.reason);
            this.connected = false;
            this._stopHeartbeat();
            this.options.onDisconnect();

            // Auto-reconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = this.reconnectDelay * this.reconnectAttempts;
                console.log(`[Collab] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                setTimeout(() => this.connect(), delay);
            }
        };

        this.ws.onerror = (error) => {
            console.error('[Collab] WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this._handleMessage(data);
            } catch (e) {
                console.error('[Collab] Failed to parse message:', e);
            }
        };
    }

    _handleMessage(data) {
        const { type } = data;

        switch (type) {
            case 'connected':
                this.sessionId = data.session_id;
                this.color = data.color;
                console.log('[Collab] Session:', this.sessionId, 'Color:', this.color);
                this.options.onConnect({
                    sessionId: this.sessionId,
                    color: this.color
                });
                break;

            case 'presence':
                this.options.onPresence({
                    filePath: data.file_path,
                    project: data.project,
                    users: data.users
                });
                break;

            case 'file_saved':
                this.options.onFileSaved({
                    sessionId: data.session_id,
                    userName: data.user_name,
                    filePath: data.file_path,
                    versionId: data.version_id,
                    content: data.content,
                    timestamp: data.timestamp
                });
                break;

            case 'user_joined':
            case 'user_joined_file':
                this.options.onUserJoined({
                    user: data.user,
                    filePath: data.file_path
                });
                break;

            case 'user_left':
            case 'user_left_file':
                this.options.onUserLeft({
                    sessionId: data.session_id,
                    filePath: data.file_path
                });
                break;

            case 'heartbeat_ack':
                // Heartbeat acknowledged
                break;

            case 'file_changed':
                // External file change detected (via watchdog)
                if (this.options.onFileChanged) {
                    this.options.onFileChanged({
                        filePath: data.file_path,
                        eventType: data.event_type,  // 'modified', 'created', 'deleted'
                        mtime: data.mtime
                    });
                }
                break;

            case 'watch_file_ack':
                // Acknowledgment that file is being watched
                if (this._watchFileCallbacks[data.file_path]) {
                    this._watchFileCallbacks[data.file_path](data.mtime, data.error);
                    delete this._watchFileCallbacks[data.file_path];
                }
                break;

            case 'directory_changed':
                // Directory contents changed (file/folder created or deleted)
                if (this.options.onDirectoryChanged) {
                    this.options.onDirectoryChanged({
                        dirPath: data.dir_path,
                        eventType: data.event_type,  // 'created', 'deleted'
                        changedPath: data.changed_path,
                        isDir: data.is_dir
                    });
                }
                break;

            case 'watch_directory_ack':
                // Acknowledgment that directory is being watched
                if (this._watchDirCallbacks[data.dir_path]) {
                    this._watchDirCallbacks[data.dir_path](data.success, data.error);
                    delete this._watchDirCallbacks[data.dir_path];
                }
                break;

            // Ignore messages handled by Yjs collaboration
            case 'yjs_sync':
            case 'yjs_update':
            case 'simple_sync':
            case 'cursor':
            case 'operation':
                // These are handled by the editor's Yjs provider
                break;

            default:
                console.log('[Collab] Unknown message type:', type);
        }
    }

    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    _startHeartbeat() {
        this._heartbeatInterval = setInterval(() => {
            this._send({ type: 'heartbeat' });
        }, 25000);
    }

    _stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    // ==================== Public API ====================

    /**
     * Notify that file was saved.
     */
    notifyFileSaved(filePath, versionId, content = null) {
        this._send({
            type: 'file_saved',
            file_path: filePath,
            version_id: versionId,
            content: content
        });
    }

    /**
     * Request current presence.
     */
    getPresence(filePath = null) {
        this._send({
            type: 'get_presence',
            file_path: filePath
        });
    }

    /**
     * Check if connected.
     */
    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Get current session info.
     */
    getSession() {
        return {
            sessionId: this.sessionId,
            color: this.color,
            userName: this.options.userName,
            userType: this.options.userType
        };
    }

    // ==================== File Watching API ====================

    /**
     * Start watching a file for external changes (e.g., AI edits).
     * Uses server-side watchdog for efficient OS-native file watching.
     * @param {string} filePath - Absolute path to watch
     * @param {Function} callback - Optional callback(mtime, error) when watch is confirmed
     */
    watchFile(filePath, callback = null) {
        if (callback) {
            this._watchFileCallbacks[filePath] = callback;
        }
        this._send({
            type: 'watch_file',
            file_path: filePath
        });
    }

    /**
     * Stop watching a file for external changes.
     * @param {string} filePath - Absolute path to stop watching
     */
    unwatchFile(filePath) {
        delete this._watchFileCallbacks[filePath];
        this._send({
            type: 'unwatch_file',
            file_path: filePath
        });
    }

    // ==================== Directory Watching API ====================

    /**
     * Start watching a directory for content changes (files/folders created or deleted).
     * @param {string} dirPath - Absolute path to watch
     * @param {Function} callback - Optional callback(success, error) when watch is confirmed
     */
    watchDirectory(dirPath, callback = null) {
        if (callback) {
            this._watchDirCallbacks[dirPath] = callback;
        }
        this._send({
            type: 'watch_directory',
            dir_path: dirPath
        });
    }

    /**
     * Stop watching a directory for content changes.
     * @param {string} dirPath - Absolute path to stop watching
     */
    unwatchDirectory(dirPath) {
        delete this._watchDirCallbacks[dirPath];
        this._send({
            type: 'unwatch_directory',
            dir_path: dirPath
        });
    }
}

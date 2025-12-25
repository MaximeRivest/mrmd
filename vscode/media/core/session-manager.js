/**
 * mrmd Session Manager
 *
 * Manages execution sessions and environment configuration.
 * Platform-independent - uses callbacks for UI updates.
 */

/**
 * SessionManager handles session lifecycle and environment settings.
 */
export class SessionManager {
    /**
     * @param {Object} options
     * @param {string} options.apiBase - API base URL
     * @param {Function} options.onSessionsChange - Called when sessions change
     * @param {Function} options.onEnvironmentChange - Called when environment changes
     */
    constructor(options = {}) {
        this.apiBase = options.apiBase || '';
        this.onSessionsChange = options.onSessionsChange || (() => {});
        this.onEnvironmentChange = options.onEnvironmentChange || (() => {});

        this.sessions = [];
        this.currentSessionId = 'default';
        this.environment = {
            cwd: null,
            pythonPath: null
        };
    }

    /**
     * Get current session options for code execution.
     */
    getSessionOptions() {
        const opts = {};
        if (this.environment.cwd) {
            opts.cwd = this.environment.cwd;
        }
        if (this.environment.pythonPath) {
            opts.python_env = this.environment.pythonPath;
        }
        return opts;
    }

    /**
     * Set working directory.
     */
    setCwd(cwd) {
        this.environment.cwd = cwd?.trim() || null;
        this.onEnvironmentChange(this.environment);
    }

    /**
     * Set Python path.
     */
    setPythonPath(path) {
        this.environment.pythonPath = path || null;
        this.onEnvironmentChange(this.environment);
    }

    /**
     * Get Python start command from backend.
     */
    async getPythonCommand() {
        try {
            const res = await fetch(`${this.apiBase}/api/python/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    python_path: this.environment.pythonPath || null,
                    cwd: this.environment.cwd || null
                })
            });
            const data = await res.json();
            return data.command || 'python3';
        } catch {
            return 'python3';
        }
    }

    /**
     * List available Python interpreters.
     * @param {string} scanRoot - Root directory to scan
     * @returns {Promise<Array<{path: string, name: string, version: string, project: string}>>}
     */
    async listPythons(scanRoot = '/home') {
        try {
            const res = await fetch(`${this.apiBase}/api/pythons?root=${encodeURIComponent(scanRoot)}`);
            const data = await res.json();
            return data.pythons || [];
        } catch {
            return [];
        }
    }

    /**
     * Refresh the sessions list from server.
     */
    async refreshSessions() {
        try {
            const res = await fetch(`${this.apiBase}/api/sessions`);
            const data = await res.json();
            this.sessions = data.sessions || [];
            this.onSessionsChange(this.sessions);
            return this.sessions;
        } catch {
            return this.sessions;
        }
    }

    /**
     * Clear all sessions.
     */
    async clearAllSessions() {
        try {
            await fetch(`${this.apiBase}/api/sessions/clear`, { method: 'POST' });
            this.sessions = [];
            this.onSessionsChange(this.sessions);
        } catch (err) {
            console.error('Failed to clear sessions:', err);
        }
    }

    /**
     * Stop a specific session.
     * @param {string} sessionId - Session to stop
     */
    async stopSession(sessionId) {
        try {
            await fetch(`${this.apiBase}/api/session/${sessionId}/stop`, { method: 'POST' });
            await this.refreshSessions();
        } catch (err) {
            console.error('Failed to stop session:', err);
        }
    }

    /**
     * Restart a session (stop and will auto-start on next command).
     * @param {string} sessionId - Session to restart
     */
    async restartSession(sessionId) {
        await this.stopSession(sessionId);
    }

    /**
     * Apply environment settings (clears sessions to take effect).
     */
    async applyEnvironmentSettings() {
        await this.clearAllSessions();
    }

    /**
     * Get session count.
     */
    getSessionCount() {
        return this.sessions.length;
    }

    /**
     * Set current session ID.
     */
    setCurrentSession(sessionId) {
        this.currentSessionId = sessionId;
    }

    /**
     * Get current session ID.
     */
    getCurrentSession() {
        return this.currentSessionId;
    }

    /**
     * Start polling for session updates.
     * @param {number} interval - Poll interval in ms
     * @returns {number} Interval ID for stopping
     */
    startPolling(interval = 5000) {
        return setInterval(() => {
            this.refreshSessions();
        }, interval);
    }

    /**
     * Stop polling.
     * @param {number} intervalId - ID from startPolling
     */
    stopPolling(intervalId) {
        clearInterval(intervalId);
    }
}

/**
 * Create a session manager with default options.
 */
export function createSessionManager(options = {}) {
    return new SessionManager(options);
}

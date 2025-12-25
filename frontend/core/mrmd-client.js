/**
 * mrmd API Client
 *
 * Handles all communication with the mrmd server.
 */

export class MrmdClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl;
    }

    // ==================== Session API ====================

    async interact(keys, options = {}) {
        const { session = 'default', wait = 'auto', cwd, pythonEnv } = options;
        const res = await fetch(`${this.baseUrl}/api/interact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                keys,
                wait,
                session,
                cwd,
                python_env: pythonEnv
            })
        });
        return res.json();
    }

    async resetSession(sessionId = 'default') {
        const res = await fetch(`${this.baseUrl}/api/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sessionId })
        });
        return res.json();
    }

    async listSessions() {
        const res = await fetch(`${this.baseUrl}/api/sessions`);
        return res.json();
    }

    async closeSession(sessionId) {
        const res = await fetch(`${this.baseUrl}/api/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sessionId })
        });
        return res.json();
    }

    async clearAllSessions() {
        const res = await fetch(`${this.baseUrl}/api/sessions/clear`, {
            method: 'POST'
        });
        return res.json();
    }

    async configureSession(sessionId, config = {}) {
        const res = await fetch(`${this.baseUrl}/api/session/configure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session: sessionId,
                ...config
            })
        });
        return res.json();
    }

    // ==================== File API ====================

    async readFile(path) {
        const res = await fetch(`${this.baseUrl}/api/file/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    }

    async writeFile(path, content) {
        const res = await fetch(`${this.baseUrl}/api/file/write`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content })
        });
        return res.json();
    }

    async fileExists(path) {
        const res = await fetch(`${this.baseUrl}/api/file/exists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    }

    async searchFiles(query, options = {}) {
        const { root, extensions = ['.md'], maxResults = 50 } = options;
        const res = await fetch(`${this.baseUrl}/api/files/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                root,
                extensions,
                max_results: maxResults
            })
        });
        return res.json();
    }

    // ==================== Project API ====================

    async detectProject(path) {
        const res = await fetch(`${this.baseUrl}/api/project/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    }

    async listEnvironments(projectRoot) {
        const res = await fetch(`${this.baseUrl}/api/environments/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_root: projectRoot })
        });
        return res.json();
    }

    async findPythons(root = '/home') {
        const res = await fetch(`${this.baseUrl}/api/pythons?root=${encodeURIComponent(root)}`);
        return res.json();
    }

    async getPythonCommand(pythonPath, cwd) {
        const res = await fetch(`${this.baseUrl}/api/python/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                python_path: pythonPath,
                cwd
            })
        });
        return res.json();
    }

    // ==================== Completion API ====================

    async complete(prefix, sessionId = 'python') {
        const res = await fetch(`${this.baseUrl}/api/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prefix,
                session: sessionId
            })
        });
        return res.json();
    }
}

// Default client instance
export const client = new MrmdClient();

export default MrmdClient;

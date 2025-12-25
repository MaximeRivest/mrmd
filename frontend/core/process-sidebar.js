/**
 * Process Sidebar - System-wide process monitoring
 *
 * A sidebar panel that shows all running processes in mrmd:
 * - IPython sessions (with project association)
 * - Running/pending code chunks
 * - AI calls
 * - Terminal sessions
 *
 * Features:
 * - Real-time updates via polling
 * - Collapsible sections
 * - Actions: cancel, kill, navigate
 * - Project grouping
 * - Smart DOM diffing to prevent flickering
 */

import { getCurrentProject } from './session-state.js';
import { escapeHtml } from './utils.js';

/**
 * Compare two arrays of items by a key and return changes.
 * Used for smart DOM updates without full re-renders.
 */
function diffItems(oldItems, newItems, keyFn) {
    const oldMap = new Map(oldItems.map((item) => [keyFn(item), item]));
    const newMap = new Map(newItems.map((item) => [keyFn(item), item]));

    const added = [];
    const removed = [];
    const updated = [];
    const unchanged = [];

    // Find added and updated items
    for (const [key, newItem] of newMap) {
        const oldItem = oldMap.get(key);
        if (!oldItem) {
            added.push(newItem);
        } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
            updated.push(newItem);
        } else {
            unchanged.push(newItem);
        }
    }

    // Find removed items
    for (const [key] of oldMap) {
        if (!newMap.has(key)) {
            removed.push(key);
        }
    }

    return { added, removed, updated, unchanged };
}

/**
 * Create a process sidebar manager.
 *
 * @param {HTMLElement} container - Container for the process panel
 * @param {Object} options - Configuration options
 * @param {Function} options.onNavigate - Called when user clicks to navigate to a location
 * @param {Function} options.onSwitchTerminal - Called when user clicks a terminal
 * @param {Function} options.onSwitchSession - Called when user clicks an IPython session
 * @returns {Object} Process sidebar API
 */
export function createProcessSidebar(container, options = {}) {
    const state = {
        ipythonSessions: [],
        terminals: [],
        runningJobs: [],
        pendingJobs: [],
        pollInterval: null,
        collapsedSections: new Set(), // Track collapsed sections
        // Track previous data for diffing to prevent flickering
        prevIpythonSessions: [],
        prevTerminals: [],
        prevRunningJobs: [],
        prevPendingJobs: [],
    };

    // ==================== DOM Setup ====================

    function createStructure() {
        container.innerHTML = `
            <div class="process-sidebar">
                <div class="process-section" data-section="ipython">
                    <div class="process-section-header">
                        <span class="process-section-toggle">▾</span>
                        <span class="process-section-icon">λ</span>
                        <span class="process-section-title">IPython Sessions</span>
                        <span class="process-section-count">0</span>
                    </div>
                    <div class="process-section-content">
                        <div class="process-list" id="ipython-list"></div>
                    </div>
                </div>

                <div class="process-section" data-section="code">
                    <div class="process-section-header">
                        <span class="process-section-toggle">▾</span>
                        <span class="process-section-icon">▸</span>
                        <span class="process-section-title">Code Execution</span>
                        <span class="process-section-count">0</span>
                    </div>
                    <div class="process-section-content">
                        <div class="process-list" id="code-list"></div>
                    </div>
                </div>

                <div class="process-section" data-section="ai">
                    <div class="process-section-header">
                        <span class="process-section-toggle">▾</span>
                        <span class="process-section-icon">◇</span>
                        <span class="process-section-title">AI Calls</span>
                        <span class="process-section-count">0</span>
                    </div>
                    <div class="process-section-content">
                        <div class="process-list" id="ai-list"></div>
                    </div>
                </div>

                <div class="process-section" data-section="terminals">
                    <div class="process-section-header">
                        <span class="process-section-toggle">▾</span>
                        <span class="process-section-icon">▶</span>
                        <span class="process-section-title">Terminals</span>
                        <span class="process-section-count">0</span>
                    </div>
                    <div class="process-section-content">
                        <div class="process-list" id="terminal-list"></div>
                    </div>
                </div>
            </div>
        `;

        // Setup section collapse toggles
        container.querySelectorAll('.process-section-header').forEach((header) => {
            header.addEventListener('click', () => {
                const section = header.parentElement;
                const sectionName = section.dataset.section;
                const toggle = header.querySelector('.process-section-toggle');
                const content = section.querySelector('.process-section-content');

                if (state.collapsedSections.has(sectionName)) {
                    state.collapsedSections.delete(sectionName);
                    section.classList.remove('collapsed');
                    toggle.textContent = '▾';
                    content.style.display = '';
                } else {
                    state.collapsedSections.add(sectionName);
                    section.classList.add('collapsed');
                    toggle.textContent = '▸';
                    content.style.display = 'none';
                }
            });
        });
    }

    // ==================== Data Fetching ====================

    /**
     * Fetch all process data from the server.
     */
    async function fetchAllData() {
        try {
            const [sessionsRes, terminalsRes, jobsRes] = await Promise.all([
                fetch('/api/ipython/sessions'),
                fetch('/api/terminals'),
                fetch('/api/processes/status'),
            ]);

            const sessionsData = await sessionsRes.json();
            const terminalsData = await terminalsRes.json();
            const jobsData = await jobsRes.json();

            state.ipythonSessions = sessionsData.sessions || [];
            state.terminals = terminalsData.terminals || [];
            state.runningJobs = jobsData.running || [];
            state.pendingJobs = jobsData.pending || [];

            render();
        } catch (err) {
            console.error('[ProcessSidebar] Failed to fetch data:', err);
        }
    }

    // ==================== Rendering ====================

    function render() {
        renderIPythonSessions();
        renderCodeJobs();
        renderAIJobs();
        renderTerminals();

        // Save current state for next diff
        state.prevRunningJobs = [...state.runningJobs];
        state.prevPendingJobs = [...state.pendingJobs];
    }

    function renderIPythonSessions() {
        const list = container.querySelector('#ipython-list');
        const countEl = container.querySelector('[data-section="ipython"] .process-section-count');

        const sessions = state.ipythonSessions;
        const prevSessions = state.prevIpythonSessions;
        countEl.textContent = sessions.length;

        // Check if we need a full re-render (empty list or structural change)
        const needsFullRender =
            list.children.length === 0 ||
            list.querySelector('.process-empty') ||
            sessions.length === 0;

        if (sessions.length === 0) {
            if (!list.querySelector('.process-empty')) {
                list.innerHTML = '<div class="process-empty">No active sessions</div>';
            }
            state.prevIpythonSessions = [];
            return;
        }

        if (needsFullRender) {
            // Full render for initial state
            const byProject = groupByProject(sessions, 'cwd');

            list.innerHTML = '';
            for (const [projectPath, projectSessions] of Object.entries(byProject)) {
                const projectName = projectPath ? projectPath.split('/').pop() : 'No Project';

                const groupEl = document.createElement('div');
                groupEl.className = 'process-group';
                groupEl.dataset.project = projectPath;
                groupEl.innerHTML = `
                    <div class="process-group-header">
                        <span class="process-group-name" title="${escapeHtml(projectPath || 'No project')}">${escapeHtml(projectName)}</span>
                    </div>
                `;

                for (const session of projectSessions) {
                    const item = createIPythonItem(session);
                    groupEl.appendChild(item);
                }

                list.appendChild(groupEl);
            }
        } else {
            // Smart incremental update
            const diff = diffItems(prevSessions, sessions, (s) => s.id);

            // Remove deleted items
            for (const sessionId of diff.removed) {
                const item = list.querySelector(`[data-session-id="${sessionId}"]`);
                if (item) {
                    const group = item.closest('.process-group');
                    item.remove();
                    // Remove empty groups
                    if (group && group.querySelectorAll('.process-item').length === 0) {
                        group.remove();
                    }
                }
            }

            // Update changed items (only update text content, not structure)
            for (const session of diff.updated) {
                const item = list.querySelector(`[data-session-id="${session.id}"]`);
                if (item) {
                    updateIPythonItemContent(item, session);
                }
            }

            // Add new items
            for (const session of diff.added) {
                const projectPath = session.cwd || '';
                let groupEl = list.querySelector(`[data-project="${CSS.escape(projectPath)}"]`);

                if (!groupEl) {
                    const projectName = projectPath ? projectPath.split('/').pop() : 'No Project';
                    groupEl = document.createElement('div');
                    groupEl.className = 'process-group';
                    groupEl.dataset.project = projectPath;
                    groupEl.innerHTML = `
                        <div class="process-group-header">
                            <span class="process-group-name" title="${escapeHtml(projectPath || 'No project')}">${escapeHtml(projectName)}</span>
                        </div>
                    `;
                    list.appendChild(groupEl);
                }

                const item = createIPythonItem(session);
                groupEl.appendChild(item);
            }
        }

        state.prevIpythonSessions = [...sessions];
    }

    /**
     * Update just the text content of an IPython item without recreating it.
     */
    function updateIPythonItemContent(item, session) {
        const statusEl = item.querySelector('.process-status');
        const nameEl = item.querySelector('.process-name');
        const metaEl = item.querySelector('.process-meta');

        const statusIcon = session.alive ? '●' : '○';
        const statusClass = session.alive ? 'running' : 'idle';

        statusEl.textContent = statusIcon;
        statusEl.className = `process-status ${statusClass}`;

        nameEl.textContent = session.id;

        // Extract venv name
        let venvName = 'system';
        if (session.python_path && session.python_path.includes('.venv')) {
            const parts = session.python_path.split('/');
            const venvIdx = parts.findIndex((p) => p === '.venv' || p.endsWith('-venv') || p === 'venv');
            if (venvIdx > 0) {
                venvName = parts[venvIdx];
            }
        }

        const memMb = session.memory_bytes ? Math.round(session.memory_bytes / 1024 / 1024) : null;
        const memStr = memMb ? ` • ${memMb}MB` : '';
        metaEl.textContent = `${venvName}${memStr}`;
    }

    function createIPythonItem(session) {
        const item = document.createElement('div');
        item.className = 'process-item';
        item.dataset.sessionId = session.id;

        const statusIcon = session.alive ? '●' : '○';
        const statusClass = session.alive ? 'running' : 'idle';

        // Extract venv name from python_path (e.g., /path/.venv/bin/python -> .venv)
        let venvName = 'system';
        if (session.python_path && session.python_path.includes('.venv')) {
            const parts = session.python_path.split('/');
            const venvIdx = parts.findIndex((p) => p === '.venv' || p.endsWith('-venv') || p === 'venv');
            if (venvIdx > 0) {
                venvName = parts[venvIdx];
            }
        }

        // Format memory if available
        const memMb = session.memory_bytes ? Math.round(session.memory_bytes / 1024 / 1024) : null;
        const memStr = memMb ? ` • ${memMb}MB` : '';

        item.innerHTML = `
            <span class="process-status ${statusClass}">${statusIcon}</span>
            <div class="process-info">
                <div class="process-name">${escapeHtml(session.id)}</div>
                <div class="process-meta">${escapeHtml(venvName)}${memStr}</div>
            </div>
            <div class="process-actions">
                <button class="process-action" data-action="restart" title="Restart session">↻</button>
                <button class="process-action" data-action="kill" title="Kill session">✕</button>
            </div>
        `;

        // Actions
        item.querySelector('[data-action="restart"]').addEventListener('click', (e) => {
            e.stopPropagation();
            restartSession(session.id, session.cwd);
        });

        item.querySelector('[data-action="kill"]').addEventListener('click', (e) => {
            e.stopPropagation();
            killSession(session.id, session.cwd);
        });

        // Click to switch
        item.addEventListener('click', () => {
            options.onSwitchSession?.(session);
        });

        return item;
    }

    function renderCodeJobs() {
        const list = container.querySelector('#code-list');
        const countEl = container.querySelector('[data-section="code"] .process-section-count');

        const codeJobs = [...state.runningJobs, ...state.pendingJobs].filter((j) => j.type === 'code');
        const prevCodeJobs = [...state.prevRunningJobs, ...state.prevPendingJobs].filter((j) => j.type === 'code');
        countEl.textContent = codeJobs.length;

        // Check if we need a full re-render
        const needsFullRender =
            list.children.length === 0 ||
            list.querySelector('.process-empty') ||
            codeJobs.length === 0;

        if (codeJobs.length === 0) {
            if (!list.querySelector('.process-empty')) {
                list.innerHTML = '<div class="process-empty">No running code</div>';
            }
            return;
        }

        if (needsFullRender) {
            list.innerHTML = '';
            for (const job of codeJobs) {
                const item = createJobItem(job);
                list.appendChild(item);
            }
        } else {
            // Smart incremental update
            const diff = diffItems(prevCodeJobs, codeJobs, (j) => j.id);

            // Remove deleted items
            for (const jobId of diff.removed) {
                const item = list.querySelector(`[data-job-id="${jobId}"]`);
                if (item) {
                    item.remove();
                }
            }

            // Update changed items
            for (const job of diff.updated) {
                const item = list.querySelector(`[data-job-id="${job.id}"]`);
                if (item) {
                    updateJobItemContent(item, job, false);
                }
            }

            // Add new items
            for (const job of diff.added) {
                const item = createJobItem(job);
                list.appendChild(item);
            }
        }
    }

    function renderAIJobs() {
        const list = container.querySelector('#ai-list');
        const countEl = container.querySelector('[data-section="ai"] .process-section-count');

        const aiJobs = [...state.runningJobs, ...state.pendingJobs].filter((j) => j.type === 'ai');
        const prevAIJobs = [...state.prevRunningJobs, ...state.prevPendingJobs].filter((j) => j.type === 'ai');
        countEl.textContent = aiJobs.length;

        // Check if we need a full re-render
        const needsFullRender =
            list.children.length === 0 ||
            list.querySelector('.process-empty') ||
            aiJobs.length === 0;

        if (aiJobs.length === 0) {
            if (!list.querySelector('.process-empty')) {
                list.innerHTML = '<div class="process-empty">No AI calls</div>';
            }
            return;
        }

        if (needsFullRender) {
            list.innerHTML = '';
            for (const job of aiJobs) {
                const item = createJobItem(job, true);
                list.appendChild(item);
            }
        } else {
            // Smart incremental update
            const diff = diffItems(prevAIJobs, aiJobs, (j) => j.id);

            // Remove deleted items
            for (const jobId of diff.removed) {
                const item = list.querySelector(`[data-job-id="${jobId}"]`);
                if (item) {
                    item.remove();
                }
            }

            // Update changed items
            for (const job of diff.updated) {
                const item = list.querySelector(`[data-job-id="${job.id}"]`);
                if (item) {
                    updateJobItemContent(item, job, true);
                }
            }

            // Add new items
            for (const job of diff.added) {
                const item = createJobItem(job, true);
                list.appendChild(item);
            }
        }
    }

    /**
     * Update just the text content of a job item without recreating it.
     */
    function updateJobItemContent(item, job, isAI) {
        const statusEl = item.querySelector('.process-status');
        const nameEl = item.querySelector('.process-name');
        const metaEl = item.querySelector('.process-meta');

        const statusIcon = job.status === 'running' ? '●' : '○';
        const statusClass = job.status === 'running' ? 'running' : 'pending';

        statusEl.textContent = statusIcon;
        statusEl.className = `process-status ${statusClass}`;

        const name = isAI ? (job.program_name || 'AI Task') : (job.language || 'Code');
        const meta = job.progress || job.status;
        const fileName = job.file_path ? job.file_path.split('/').pop() : '';

        // Update juice dots for AI
        if (isAI && job.juice_level !== undefined) {
            let juiceEl = nameEl.querySelector('.process-juice');
            if (juiceEl) {
                const dots = juiceEl.querySelectorAll('.juice-dot');
                dots.forEach((dot, i) => {
                    dot.classList.toggle('active', i <= job.juice_level);
                });
            }
            // Update name text node only (before juice element)
            const textNode = nameEl.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.textContent = name;
            }
        } else {
            nameEl.textContent = name;
        }

        metaEl.textContent = `${meta}${fileName ? ` • ${fileName}` : ''}`;
    }

    function createJobItem(job, isAI = false) {
        const item = document.createElement('div');
        item.className = 'process-item';
        item.dataset.jobId = job.id;

        const statusIcon = job.status === 'running' ? '●' : '○';
        const statusClass = job.status === 'running' ? 'running' : 'pending';
        const name = isAI ? (job.program_name || 'AI Task') : (job.language || 'Code');
        const meta = job.progress || job.status;
        const fileName = job.file_path ? job.file_path.split('/').pop() : '';

        // Juice level indicator for AI
        const juiceHtml = isAI && job.juice_level !== undefined ? `
            <span class="process-juice" title="Juice level ${job.juice_level}">
                ${Array(5).fill(0).map((_, i) => `<span class="juice-dot ${i <= job.juice_level ? 'active' : ''}"></span>`).join('')}
            </span>
        ` : '';

        item.innerHTML = `
            <span class="process-status ${statusClass}">${statusIcon}</span>
            <div class="process-info">
                <div class="process-name">${escapeHtml(name)}${juiceHtml}</div>
                <div class="process-meta">${escapeHtml(meta)}${fileName ? ` • ${escapeHtml(fileName)}` : ''}</div>
            </div>
            <div class="process-actions">
                ${job.file_path ? `<button class="process-action" data-action="goto" title="Go to file">→</button>` : ''}
                <button class="process-action" data-action="cancel" title="Cancel">✕</button>
            </div>
        `;

        // Actions
        const gotoBtn = item.querySelector('[data-action="goto"]');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                options.onNavigate?.({
                    filePath: job.file_path,
                    blockIndex: job.block_index,
                });
            });
        }

        item.querySelector('[data-action="cancel"]').addEventListener('click', (e) => {
            e.stopPropagation();
            cancelJob(job.id);
        });

        return item;
    }

    function renderTerminals() {
        const list = container.querySelector('#terminal-list');
        const countEl = container.querySelector('[data-section="terminals"] .process-section-count');

        const terminals = state.terminals;
        const prevTerminals = state.prevTerminals;
        countEl.textContent = terminals.length;

        // Check if we need a full re-render
        const needsFullRender =
            list.children.length === 0 ||
            list.querySelector('.process-empty') ||
            terminals.length === 0;

        if (terminals.length === 0) {
            if (!list.querySelector('.process-empty')) {
                list.innerHTML = '<div class="process-empty">No terminals</div>';
            }
            state.prevTerminals = [];
            return;
        }

        if (needsFullRender) {
            // Full render for initial state
            const byProject = groupByProject(terminals, 'cwd');

            list.innerHTML = '';
            for (const [projectPath, projectTerminals] of Object.entries(byProject)) {
                const projectName = projectPath ? projectPath.split('/').pop() : 'No Project';

                const groupEl = document.createElement('div');
                groupEl.className = 'process-group';
                groupEl.dataset.project = projectPath;
                groupEl.innerHTML = `
                    <div class="process-group-header">
                        <span class="process-group-name" title="${escapeHtml(projectPath || 'No project')}">${escapeHtml(projectName)}</span>
                    </div>
                `;

                for (const terminal of projectTerminals) {
                    const item = createTerminalItem(terminal);
                    groupEl.appendChild(item);
                }

                list.appendChild(groupEl);
            }
        } else {
            // Smart incremental update
            const diff = diffItems(prevTerminals, terminals, (t) => t.session_id);

            // Remove deleted items
            for (const sessionId of diff.removed) {
                const item = list.querySelector(`[data-session-id="${sessionId}"]`);
                if (item) {
                    const group = item.closest('.process-group');
                    item.remove();
                    if (group && group.querySelectorAll('.process-item').length === 0) {
                        group.remove();
                    }
                }
            }

            // Update changed items
            for (const terminal of diff.updated) {
                const item = list.querySelector(`[data-session-id="${terminal.session_id}"]`);
                if (item) {
                    updateTerminalItemContent(item, terminal);
                }
            }

            // Add new items
            for (const terminal of diff.added) {
                const projectPath = terminal.cwd || '';
                let groupEl = list.querySelector(`[data-project="${CSS.escape(projectPath)}"]`);

                if (!groupEl) {
                    const projectName = projectPath ? projectPath.split('/').pop() : 'No Project';
                    groupEl = document.createElement('div');
                    groupEl.className = 'process-group';
                    groupEl.dataset.project = projectPath;
                    groupEl.innerHTML = `
                        <div class="process-group-header">
                            <span class="process-group-name" title="${escapeHtml(projectPath || 'No project')}">${escapeHtml(projectName)}</span>
                        </div>
                    `;
                    list.appendChild(groupEl);
                }

                const item = createTerminalItem(terminal);
                groupEl.appendChild(item);
            }
        }

        state.prevTerminals = [...terminals];
    }

    /**
     * Update just the text content of a terminal item without recreating it.
     */
    function updateTerminalItemContent(item, terminal) {
        const nameEl = item.querySelector('.process-name');
        const metaEl = item.querySelector('.process-meta');

        nameEl.textContent = terminal.name;
        metaEl.textContent = formatTimeAgo(new Date(terminal.last_activity));
    }

    function createTerminalItem(terminal) {
        const item = document.createElement('div');
        item.className = 'process-item';
        item.dataset.sessionId = terminal.session_id;

        const timeAgo = formatTimeAgo(new Date(terminal.last_activity));

        item.innerHTML = `
            <span class="process-status running">●</span>
            <div class="process-info">
                <div class="process-name">${escapeHtml(terminal.name)}</div>
                <div class="process-meta">${timeAgo}</div>
            </div>
            <div class="process-actions">
                <button class="process-action" data-action="kill" title="Kill terminal">✕</button>
            </div>
        `;

        // Actions
        item.querySelector('[data-action="kill"]').addEventListener('click', (e) => {
            e.stopPropagation();
            killTerminal(terminal.session_id);
        });

        // Click to switch
        item.addEventListener('click', () => {
            options.onSwitchTerminal?.(terminal);
        });

        return item;
    }

    // ==================== Actions ====================

    async function restartSession(sessionId, cwd) {
        try {
            await fetch('/api/ipython/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: sessionId,
                    project_path: cwd,
                }),
            });
            await fetchAllData();
        } catch (err) {
            console.error('[ProcessSidebar] Failed to restart session:', err);
        }
    }

    async function killSession(sessionId, cwd) {
        try {
            await fetch('/api/sessions/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    project_path: cwd,
                }),
            });
            await fetchAllData();
        } catch (err) {
            console.error('[ProcessSidebar] Failed to kill session:', err);
        }
    }

    async function cancelJob(jobId) {
        try {
            await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
            await fetchAllData();
        } catch (err) {
            console.error('[ProcessSidebar] Failed to cancel job:', err);
        }
    }

    async function killTerminal(sessionId) {
        try {
            await fetch('/api/pty/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId }),
            });
            await fetchAllData();
        } catch (err) {
            console.error('[ProcessSidebar] Failed to kill terminal:', err);
        }
    }

    // ==================== Polling ====================

    function startPolling(intervalMs = 3000) {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
        }

        // Initial fetch
        fetchAllData();

        // Poll periodically
        state.pollInterval = setInterval(fetchAllData, intervalMs);
    }

    function stopPolling() {
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
            state.pollInterval = null;
        }
    }

    // ==================== Helpers ====================

    function groupByProject(items, pathKey) {
        const groups = {};
        for (const item of items) {
            const path = item[pathKey] || '';
            if (!groups[path]) {
                groups[path] = [];
            }
            groups[path].push(item);
        }
        return groups;
    }

    // escapeHtml is imported at the module level from utils.js

    function formatTimeAgo(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        return `${days}d ago`;
    }

    // ==================== Initialization ====================

    function init() {
        createStructure();
        startPolling();
    }

    function destroy() {
        stopPolling();
        container.innerHTML = '';
    }

    // ==================== Return API ====================

    return {
        init,
        destroy,
        startPolling,
        stopPolling,
        refresh: fetchAllData,
    };
}

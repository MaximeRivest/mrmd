/**
 * Session & Project State Management for MRMD Web Editor
 *
 * Manages:
 * - Current session (IPython connection)
 * - Current project (folder with venv)
 * - Session mode: 'default' | 'project' | 'dedicated'
 * - Open files (tabs)
 * - Recent projects
 */

// State
let mrmdStatus = null;
let currentSession = 'default';  // DEPRECATED: Use currentSessionName instead
let currentVenv = null;          // null = use default ~/.mrmd/venv
let currentProject = null;       // { path, name, venv, type }
let sessionMode = 'default';     // 'default' | 'project' | 'dedicated'
let openFiles = new Map();       // path -> { content, modified, scrollTop }
let activeFilePath = null;
let recentProjects = [];
let isWelcomeMode = false;       // True when showing welcome notebook
let welcomeContent = null;       // Cached welcome content

// Multi-session state
let currentSessionName = 'main';              // Currently active session name
let projectSessions = [];                     // List of sessions for current project
let notebookSessionBindings = new Map();      // notebook path -> session name

// Recent venvs storage
const RECENT_VENVS_KEY = 'mrmd_recent_venvs';
const MAX_RECENT_VENVS = 10;

// Recent notebooks storage
const RECENT_NOTEBOOKS_KEY = 'mrmd_recent_notebooks';
const MAX_RECENT_NOTEBOOKS = 20;
let recentNotebooks = [];

// Last project storage (for restore on refresh)
const LAST_PROJECT_KEY = 'mrmd_last_project';

// Interface mode state (compact vs developer)
const INTERFACE_MODE_KEY = 'mrmd-interface-mode';
const TOOL_RAIL_SIDE_KEY = 'mrmd-tool-rail-side';
const TOOL_RAIL_OPEN_KEY = 'mrmd-tool-rail-open';
const STATUS_BAR_EXPANDED_KEY = 'mrmd-status-expanded';

let interfaceMode = localStorage.getItem(INTERFACE_MODE_KEY) || 'compact';
let toolRailSide = localStorage.getItem(TOOL_RAIL_SIDE_KEY) || 'right';
let toolRailOpen = localStorage.getItem(TOOL_RAIL_OPEN_KEY) !== 'false'; // Default true
let statusBarExpanded = localStorage.getItem(STATUS_BAR_EXPANDED_KEY) === 'true';

// Event emitter for state changes
const listeners = new Map();

export function emit(event, data) {
    const handlers = listeners.get(event) || [];
    handlers.forEach(fn => fn(data));
}

export function on(event, handler) {
    if (!listeners.has(event)) {
        listeners.set(event, []);
    }
    listeners.get(event).push(handler);
    return () => off(event, handler);
}

export function off(event, handler) {
    const handlers = listeners.get(event) || [];
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
}

// Getters
export function getMrmdStatus() { return mrmdStatus; }
export function getCurrentSession() { return currentSession; }
export function getCurrentVenv() { return currentVenv; }
export function getCurrentProject() { return currentProject; }
export function getSessionMode() { return sessionMode; }
export function getOpenFiles() { return openFiles; }
export function getActiveFilePath() { return activeFilePath; }
export function getRecentProjects() { return recentProjects; }
export function getIsWelcomeMode() { return isWelcomeMode; }
export function getWelcomeContent() { return welcomeContent; }
export function getCurrentSessionName() { return currentSessionName; }
export function getScratchPath() { return mrmdStatus?.default_project || null; }
export function setCurrentSessionName(name) {
    currentSessionName = name;
    emit('session-name-changed', { name });
}
export function getProjectSessions() { return projectSessions; }
export function getNotebookSessionBinding(notebookPath) {
    return notebookSessionBindings.get(notebookPath) || 'main';
}

// Interface mode getters
export function getInterfaceMode() { return interfaceMode; }
export function isCompactMode() { return interfaceMode === 'compact'; }
export function isDeveloperMode() { return interfaceMode === 'developer'; }
export function getToolRailSide() { return toolRailSide; }
export function getToolRailOpen() { return toolRailOpen; }
export function getStatusBarExpanded() { return statusBarExpanded; }

// Interface mode setters
export function setInterfaceMode(mode) {
    if (mode !== 'compact' && mode !== 'developer') return;
    interfaceMode = mode;
    localStorage.setItem(INTERFACE_MODE_KEY, mode);
    emit('interface-mode-changed', { mode });
}

export function setToolRailSide(side) {
    if (side !== 'left' && side !== 'right') return;
    toolRailSide = side;
    localStorage.setItem(TOOL_RAIL_SIDE_KEY, side);
    emit('tool-rail-side-changed', { side });
}

export function setToolRailOpen(open) {
    toolRailOpen = !!open;
    localStorage.setItem(TOOL_RAIL_OPEN_KEY, String(toolRailOpen));
    emit('tool-rail-open-changed', { open: toolRailOpen });
}

export function setStatusBarExpanded(expanded) {
    statusBarExpanded = !!expanded;
    localStorage.setItem(STATUS_BAR_EXPANDED_KEY, String(statusBarExpanded));
    emit('status-bar-expanded-changed', { expanded: statusBarExpanded });
}

/**
 * Get display name for current venv
 */
export function getVenvDisplayName() {
    if (!currentVenv) {
        if (mrmdStatus?.default_python) {
            return '~/.mrmd/venv';
        }
        return 'default';
    }

    // Extract meaningful path segment
    const parts = currentVenv.split('/');
    const venvIdx = parts.findIndex(p => ['.venv', 'venv', '.env', 'env'].includes(p));
    if (venvIdx > 0) {
        return parts.slice(venvIdx - 1).join('/');
    }
    return parts.slice(-2).join('/');
}

/**
 * Get display name for session mode
 */
export function getSessionModeDisplay() {
    switch (sessionMode) {
        case 'default': return 'default';
        case 'project': return currentProject?.name || 'project';
        case 'dedicated': return 'dedicated';
        default: return sessionMode;
    }
}

// API calls
const API_BASE = '';

async function fetchJson(url, options = {}) {
    const response = await fetch(API_BASE + url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    return response.json();
}

/**
 * Check MRMD initialization status
 */
export async function checkMrmdStatus() {
    try {
        mrmdStatus = await fetchJson('/api/mrmd/status');
        emit('mrmd-status', mrmdStatus);
        return mrmdStatus;
    } catch (err) {
        console.error('[SessionState] Status check failed:', err);
        return null;
    }
}

/**
 * Initialize MRMD environment
 * @param {string} scratchPath - Optional custom path for the Scratch project
 */
export async function initializeMrmd(scratchPath = null) {
    try {
        const body = scratchPath ? { scratch_path: scratchPath } : {};
        const result = await fetchJson('/api/mrmd/initialize', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (result.success) {
            mrmdStatus = await checkMrmdStatus();
        }
        emit('mrmd-initialized', result);
        return result;
    } catch (err) {
        console.error('[SessionState] Init error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Load recent projects list
 */
export async function loadRecentProjects() {
    try {
        const result = await fetchJson('/api/mrmd/recent-projects');
        recentProjects = result.projects || [];
        emit('recent-projects', recentProjects);
        return recentProjects;
    } catch (err) {
        console.error('[SessionState] Failed to load recent projects:', err);
        return [];
    }
}

/**
 * Detect project at a path
 */
export async function detectProject(path) {
    try {
        const result = await fetchJson('/api/project/detect', {
            method: 'POST',
            body: JSON.stringify({ path }),
        });
        return result;
    } catch (err) {
        console.error('[SessionState] Project detect error:', err);
        return null;
    }
}

/**
 * Open a project folder
 * @param {string} projectPath - Path to project
 * @param {boolean} skipWarning - Skip unsaved session warning
 * @param {object} options - Additional options
 * @param {boolean} options.skipActiveFileOpen - Skip opening active file (instant cache already displayed)
 * @param {string} options.cachedActiveFile - Path of cached active file
 * @param {number} options.cachedMtime - Mtime of cached content for freshness check
 * @param {string} options.openFileAfter - Path to file to open after project loads (overrides saved active)
 */
export async function openProject(projectPath, skipWarning = false, options = {}) {
    try {
        // Check for unsaved session state
        if (!skipWarning && hasUnsavedState) {
            const proceed = await showSessionWarning('opening a new project');
            if (!proceed) {
                return { success: false, message: 'Cancelled by user' };
            }
        }

        // Save current project's tabs before switching
        if (currentProject) {
            // Emit event so UI can save current scroll position
            emit('before-project-switch', { currentProject });
            saveProjectTabs(currentProject.path);
        }

        // Close all current tabs
        closeAllFiles();

        // Detect project info and find venv in parallel for faster startup
        const [detected, venvResult] = await Promise.all([
            detectProject(projectPath),
            fetchJson('/api/venvs/search', {
                method: 'POST',
                body: JSON.stringify({ root: projectPath, max_depth: 2 }),
            }).catch(err => {
                console.warn('[SessionState] Venv search failed:', err);
                return { venvs: [] };
            }),
        ]);

        if (!detected) {
            return { success: false, message: 'Failed to detect project' };
        }

        const venv = venvResult.venvs?.[0] || null;

        // Set current project
        currentProject = {
            path: detected.project_root,
            name: detected.project_root.split('/').pop(),
            type: detected.project_type,
            venv: venv,
            environments: detected.environments,
        };

        // Save current project path for restore on refresh
        localStorage.setItem(LAST_PROJECT_KEY, currentProject.path);

        // Emit project-changed event for collab and other listeners
        emit('project-changed', { project: currentProject });

        // Reset session state for new project BEFORE reconfiguring
        hasUnsavedState = false;
        currentSessionName = 'main';
        notebookSessionBindings.clear();

        // Switch to project venv if found
        if (venv) {
            currentVenv = venv.python_path;
            sessionMode = 'project';

            // Reconfigure IPython session with new Python and cwd
            // This restarts the kernel with the project's venv
            // Do this async so user can start writing immediately
            emit('kernel-initializing', { session: currentSessionName, venv: venv.python_path });
            fetchJson('/api/ipython/reconfigure', {
                method: 'POST',
                body: JSON.stringify({
                    session: currentSessionName,
                    python_path: venv.python_path,
                    cwd: currentProject.path,
                }),
            }).then(() => {
                emit('kernel-ready', { session: currentSessionName, venv: venv.python_path });
            }).catch(err => {
                console.error('[SessionState] Kernel reconfigure error:', err);
                emit('kernel-error', { session: currentSessionName, error: err.message });
            });
        }

        // Get saved tabs for this project (from localStorage - instant!)
        const savedTabs = getSavedProjectTabs(currentProject.path);

        // Emit project-opened immediately so UI can update and restore tabs
        // Pass through instant restore options so handler knows to skip/verify
        emit('project-opened', {
            ...currentProject,
            savedTabs,
            instantRestore: options.skipActiveFileOpen ? {
                cachedActiveFile: options.cachedActiveFile,
                cachedMtime: options.cachedMtime,
            } : null,
            openFileAfter: options.openFileAfter || null,  // Override active file
            skipFileOpen: options.skipFileOpen || false,   // Skip file opening (already opened)
        });
        emit('session-changed', { venv: currentVenv, mode: sessionMode, project: currentProject, sessionName: currentSessionName });

        // Do remaining work async - these don't need to block the UI
        Promise.all([
            fetchJson('/api/mrmd/recent-projects', {
                method: 'POST',
                body: JSON.stringify({
                    path: currentProject.path,
                    name: currentProject.name
                }),
            }),
            loadSavedSessions(),
            loadProjectSessions(),
        ]).catch(err => console.error('[SessionState] Background project setup error:', err));

        return { success: true, project: currentProject };
    } catch (err) {
        console.error('[SessionState] Open project error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Close current project
 * @param {boolean} skipWarning - Skip unsaved session warning
 */
export async function closeProject(skipWarning = false) {
    // Check for unsaved session state
    if (!skipWarning && hasUnsavedState) {
        const proceed = await showSessionWarning('closing the project');
        if (!proceed) {
            return false;
        }
    }

    // Save current project's tabs before closing
    if (currentProject) {
        saveProjectTabs(currentProject.path);
    }

    // Close all tabs
    closeAllFiles();

    currentProject = null;
    sessionMode = 'default';
    currentVenv = null;
    hasUnsavedState = false;
    savedSessions = [];
    currentSessionName = 'main';
    projectSessions = [];
    notebookSessionBindings.clear();

    // Clear saved last project
    localStorage.removeItem(LAST_PROJECT_KEY);

    emit('project-changed', { project: null });
    emit('project-closed');
    emit('session-changed', { venv: null, mode: 'default', project: null, sessionName: 'main' });
    return true;
}

/**
 * Show warning dialog for unsaved session
 * Returns true to proceed, false to cancel
 */
async function showSessionWarning(action) {
    return new Promise((resolve) => {
        // Inject modal styles if needed
        if (!document.getElementById('session-warning-styles')) {
            const style = document.createElement('style');
            style.id = 'session-warning-styles';
            style.textContent = `
                .session-warning-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    z-index: 2000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .session-warning-modal {
                    background: var(--bg, #1a1b26);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    width: 280px;
                }
                .session-warning-header {
                    padding: 12px 16px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text, #c0caf5);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                }
                .session-warning-body {
                    padding: 12px 16px;
                    font-size: 12px;
                    color: var(--muted, #565f89);
                }
                .session-warning-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }
                .session-warning-btn {
                    padding: 6px 12px;
                    font-size: 12px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    background: rgba(255, 255, 255, 0.06);
                    color: var(--text, #c0caf5);
                }
                .session-warning-btn:hover { background: rgba(255, 255, 255, 0.1); }
                .session-warning-btn.cancel { background: none; color: var(--muted, #565f89); }
                .session-warning-btn.save { background: rgba(122, 162, 247, 0.15); color: #7aa2f7; }
                .session-warning-btn.save:hover { background: rgba(122, 162, 247, 0.25); }
            `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.className = 'session-warning-overlay';
        overlay.innerHTML = `
            <div class="session-warning-modal">
                <div class="session-warning-header">Unsaved session</div>
                <div class="session-warning-body">
                    Save before ${action}?
                </div>
                <div class="session-warning-footer">
                    <button class="session-warning-btn cancel">Cancel</button>
                    <button class="session-warning-btn discard">Discard</button>
                    <button class="session-warning-btn save">Save</button>
                </div>
            </div>
        `;

        const cleanup = () => overlay.remove();

        // Cancel button
        overlay.querySelector('.cancel').addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        // Save button - save current session and continue
        overlay.querySelector('.save').addEventListener('click', async () => {
            const result = await saveSession(currentSessionName);
            if (result.success) {
                cleanup();
                resolve(true);
            }
        });

        // Discard button
        overlay.querySelector('.discard').addEventListener('click', () => {
            hasUnsavedState = false;
            cleanup();
            resolve(true);
        });

        // Click outside to cancel
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });

        // Escape to cancel
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', escHandler);
                resolve(false);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(overlay);
    });
}

/**
 * Create a new project
 * @param {string} name - Project name
 * @param {string} parentDir - Parent directory (optional)
 * @param {string} template - Template: "writer", "analyst", or "pythonista" (default: "analyst")
 */
export async function createProject(name, parentDir = null, template = 'analyst') {
    try {
        const result = await fetchJson('/api/project/create', {
            method: 'POST',
            body: JSON.stringify({ name, parent_dir: parentDir, template }),
        });

        if (result.success) {
            // Open the new project (this switches the venv)
            await openProject(result.project_path);
            await loadRecentProjects();

            // Emit event with notebook path for the UI to open
            if (result.main_notebook) {
                const notebookPath = result.project_path + '/' + result.main_notebook;
                emit('project-created', {
                    project: currentProject,
                    template: result.template,
                    mainNotebook: notebookPath,
                });
            }
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Create project error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Switch venv for current session
 * @param {string} pythonPath - Path to Python executable
 * @param {boolean} skipWarning - Skip unsaved session warning
 */
export async function switchVenv(pythonPath, skipWarning = false) {
    try {
        // Check for unsaved session state
        if (!skipWarning && hasUnsavedState) {
            const proceed = await showSessionWarning('switching environments');
            if (!proceed) {
                return { success: false, message: 'Cancelled by user' };
            }
        }

        currentVenv = pythonPath;

        // Reconfigure IPython session with new Python
        // This restarts the kernel with the new venv
        await fetchJson('/api/ipython/reconfigure', {
            method: 'POST',
            body: JSON.stringify({
                session: currentSessionName,
                python_path: pythonPath,
                cwd: currentProject?.path,
            }),
        });

        // If not in a project, we're in 'dedicated' mode with a custom venv
        if (!currentProject && pythonPath) {
            sessionMode = 'dedicated';
        }

        // Reset dirty state after venv switch (session is restarted)
        hasUnsavedState = false;

        emit('session-changed', { venv: currentVenv, mode: sessionMode, project: currentProject });
        return { success: true };
    } catch (err) {
        console.error('[SessionState] Switch venv error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Switch to default MRMD venv
 */
export async function useDefaultVenv() {
    currentVenv = null;
    sessionMode = currentProject ? 'project' : 'default';

    // Use MRMD default python
    const defaultPython = mrmdStatus?.default_python;
    if (defaultPython) {
        await fetchJson('/api/session/configure', {
            method: 'POST',
            body: JSON.stringify({
                session: currentSessionName,
                python_env: defaultPython,
            }),
        });
    }

    emit('session-changed', { venv: null, mode: sessionMode, project: currentProject });
    return { success: true };
}

/**
 * Search for venvs in a directory
 */
export async function searchVenvs(root, maxDepth = 3) {
    try {
        const result = await fetchJson('/api/venvs/search', {
            method: 'POST',
            body: JSON.stringify({ root, max_depth: maxDepth }),
        });
        return result.venvs || [];
    } catch (err) {
        console.error('[SessionState] Venv search error:', err);
        return [];
    }
}

// ==================== Recent Venvs ====================

/**
 * Get list of recently used venvs from localStorage
 */
export function getRecentVenvs() {
    try {
        const stored = localStorage.getItem(RECENT_VENVS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (err) {
        console.error('[SessionState] Error loading recent venvs:', err);
        return [];
    }
}

/**
 * Add a venv to the recent venvs list
 * @param {string} pythonPath - Path to Python executable
 * @param {string} venvName - Display name for the venv
 * @param {string} version - Python version string
 */
export function addRecentVenv(pythonPath, venvName, version = null) {
    try {
        const recent = getRecentVenvs().filter(v => v.python_path !== pythonPath);
        recent.unshift({
            python_path: pythonPath,
            name: venvName,
            version: version,
            used_at: Date.now(),
        });
        localStorage.setItem(RECENT_VENVS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_VENVS)));
        return recent.slice(0, MAX_RECENT_VENVS);
    } catch (err) {
        console.error('[SessionState] Error saving recent venv:', err);
        return getRecentVenvs();
    }
}

/**
 * Remove a venv from recent venvs list
 */
export function removeRecentVenv(pythonPath) {
    try {
        const recent = getRecentVenvs().filter(v => v.python_path !== pythonPath);
        localStorage.setItem(RECENT_VENVS_KEY, JSON.stringify(recent));
        return recent;
    } catch (err) {
        console.error('[SessionState] Error removing recent venv:', err);
        return getRecentVenvs();
    }
}

/**
 * Clear all recent venvs
 */
export function clearRecentVenvs() {
    try {
        localStorage.removeItem(RECENT_VENVS_KEY);
    } catch (err) {
        console.error('[SessionState] Error clearing recent venvs:', err);
    }
}

// ==================== Recent Notebooks (Server-side storage) ====================

/**
 * Get list of recently opened notebooks from server
 * @returns {Array<{path: string, name: string, projectPath: string, projectName: string, overview: string, timestamp: string}>}
 */
export function getRecentNotebooks() {
    // Return cached data synchronously
    return recentNotebooks;
}

/**
 * Fetch recent notebooks from server (async)
 * Call this on app init to populate the cache
 */
export async function fetchRecentNotebooks() {
    try {
        const response = await fetch('/api/mrmd/recent-notebooks');
        if (response.ok) {
            const data = await response.json();
            recentNotebooks = data.notebooks || [];
            emit('recent-notebooks', recentNotebooks);
        }
    } catch (err) {
        console.error('[SessionState] Error fetching recent notebooks:', err);
    }
    return recentNotebooks;
}

/**
 * Add a notebook to recent notebooks (persisted server-side)
 * @param {string} notebookPath - Full path to the notebook
 * @param {string} overview - First line preview text
 */
export async function addRecentNotebook(notebookPath, overview = '') {
    if (!notebookPath || !notebookPath.endsWith('.md')) return;

    try {
        // Get project info
        const project = getCurrentProject();

        const response = await fetch('/api/mrmd/recent-notebooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: notebookPath,
                overview: overview || '',
                projectPath: project?.path || '',
                projectName: project?.name || ''
            })
        });

        if (response.ok) {
            const data = await response.json();
            recentNotebooks = data.notebooks || [];
            emit('recent-notebooks', recentNotebooks);
        }
        return recentNotebooks;
    } catch (err) {
        console.error('[SessionState] Error adding recent notebook:', err);
        return getRecentNotebooks();
    }
}

/**
 * Update the overview text for a notebook
 * @param {string} notebookPath - Full path to the notebook
 * @param {string} overview - First line preview text
 */
export async function updateNotebookOverview(notebookPath, overview) {
    // Just re-add it - server will update and move to top
    const notebook = recentNotebooks.find(n => n.path === notebookPath);
    if (notebook) {
        await addRecentNotebook(notebookPath, overview);
    }
}

/**
 * Remove a notebook from recent notebooks
 * @param {string} notebookPath - Full path to the notebook
 */
export async function removeRecentNotebook(notebookPath) {
    try {
        const response = await fetch('/api/mrmd/recent-notebooks', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: notebookPath })
        });

        if (response.ok) {
            const data = await response.json();
            recentNotebooks = data.notebooks || [];
            emit('recent-notebooks', recentNotebooks);
        }
        return recentNotebooks;
    } catch (err) {
        console.error('[SessionState] Error removing recent notebook:', err);
        return getRecentNotebooks();
    }
}

/**
 * Clear all recent notebooks
 */
export async function clearRecentNotebooks() {
    try {
        // Server doesn't have a clear endpoint yet, just clear local cache
        recentNotebooks = [];
        emit('recent-notebooks', []);
    } catch (err) {
        console.error('[SessionState] Error clearing recent notebooks:', err);
    }
}

// ==================== Session Reconfiguration ====================

/**
 * Reconfigure the session with a new Python executable.
 * This closes the old subprocess and starts a new one - all state is lost.
 *
 * @param {string} pythonPath - Path to Python executable
 * @param {Object} options - Additional options
 * @param {string} options.cwd - Working directory
 * @param {boolean} options.skipWarning - Skip unsaved state warning
 * @returns {Promise<{success: boolean, error?: string, ...}>}
 */
export async function reconfigureSession(pythonPath, options = {}) {
    const { cwd, skipWarning = false } = options;

    try {
        // Check for unsaved session state
        if (!skipWarning && hasUnsavedState) {
            const proceed = await showSessionWarning('switching Python environments');
            if (!proceed) {
                return { success: false, cancelled: true, message: 'Cancelled by user' };
            }
        }

        // Call the reconfigure endpoint
        const result = await fetchJson('/api/ipython/reconfigure', {
            method: 'POST',
            body: JSON.stringify({
                session: currentSessionName,
                python_path: pythonPath,
                cwd: cwd || currentProject?.path,
            }),
        });

        if (result.success) {
            // Update local state
            currentVenv = pythonPath;

            // Update session mode
            if (!currentProject && pythonPath) {
                sessionMode = 'dedicated';
            } else if (currentProject) {
                sessionMode = 'project';
            }

            // Extract venv name for recent list
            const venvName = extractVenvName(pythonPath);
            addRecentVenv(pythonPath, venvName, result.python_version);

            // Session is restarted, so state is clean
            hasUnsavedState = false;

            emit('session-reconfigured', {
                python_path: pythonPath,
                python_version: result.python_version,
                cwd: result.cwd,
            });
            emit('session-changed', { venv: currentVenv, mode: sessionMode, project: currentProject });
            emit('session-dirty', { dirty: false });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Reconfigure error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Extract a readable venv name from a Python path
 * e.g., "/home/user/project/.venv/bin/python" -> ".venv"
 */
export function extractVenvName(pythonPath) {
    if (!pythonPath) return 'python';

    // Match patterns like .venv/bin/python, venv/bin/python, etc.
    const match = pythonPath.match(/([^/]+)\/bin\/python[0-9.]*$/);
    if (match) {
        return match[1];
    }

    // Fallback: just use "python"
    return 'python';
}

/**
 * Get session info from the server
 */
export async function getSessionInfo() {
    try {
        const result = await fetchJson('/api/ipython/session_info', {
            method: 'POST',
            body: JSON.stringify({ session: currentSessionName }),
        });
        return result;
    } catch (err) {
        console.error('[SessionState] Get session info error:', err);
        return null;
    }
}

/**
 * Get the current Python path being used by the session
 */
export function getCurrentPython() {
    return currentVenv;
}

// File tab management
let isRestoringTabs = false;  // Flag to prevent auto-save during restore

export function setRestoringTabs(value) {
    isRestoringTabs = value;
}

export function addOpenFile(path, content = '', modified = false, mtime = null, versionId = null) {
    openFiles.set(path, { content, modified, scrollTop: 0, mtime, versionId });
    emit('files-changed', { openFiles, activeFilePath });
    // Auto-save tabs state (skip during restore to avoid overwriting saved state)
    if (currentProject && !isRestoringTabs) saveProjectTabs();

    // Track recent notebooks (only .md files)
    if (path.endsWith('.md') && !isRestoringTabs) {
        // Extract first meaningful line as overview
        const lines = content.split('\n');
        let overview = '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Use header text (strip # prefix)
            if (trimmed.startsWith('#')) {
                overview = trimmed.replace(/^#+\s*/, '').slice(0, 80);
                break;
            }
            // Use first non-empty, non-header line
            overview = trimmed.slice(0, 80);
            break;
        }
        addRecentNotebook(path, overview);
    }
}

export function updateFileMtime(path, mtime) {
    const file = openFiles.get(path);
    if (file) {
        file.mtime = mtime;
    }
}

export function getFileMtime(path) {
    const file = openFiles.get(path);
    return file?.mtime || null;
}

export function updateFileVersionId(path, versionId) {
    const file = openFiles.get(path);
    if (file) {
        file.versionId = versionId;
    }
}

export function getFileVersionId(path) {
    const file = openFiles.get(path);
    return file?.versionId || null;
}

export function removeOpenFile(path) {
    openFiles.delete(path);
    if (activeFilePath === path) {
        // Switch to another file or null
        const paths = Array.from(openFiles.keys());
        activeFilePath = paths.length > 0 ? paths[paths.length - 1] : null;
    }
    emit('files-changed', { openFiles, activeFilePath });
    // Auto-save tabs state
    if (currentProject) saveProjectTabs();
}

export function renameOpenFile(oldPath, newPath) {
    const file = openFiles.get(oldPath);
    if (!file) return;

    // Remove old entry, add new one with same data
    openFiles.delete(oldPath);
    openFiles.set(newPath, file);

    // Update active file path if it was the renamed file
    if (activeFilePath === oldPath) {
        activeFilePath = newPath;
    }

    emit('files-changed', { openFiles, activeFilePath });
    emit('file-renamed', { oldPath, newPath });

    // Auto-save tabs state
    if (currentProject) saveProjectTabs();
}

export function setActiveFile(path) {
    activeFilePath = path;
    emit('files-changed', { openFiles, activeFilePath });
    // Auto-save tabs state (to remember active tab)
    if (currentProject) saveProjectTabs();
}

export function updateFileContent(path, content, modified = true) {
    const file = openFiles.get(path);
    if (file) {
        file.content = content;
        file.modified = modified;
        emit('file-modified', { path, modified });
    }
}

export function updateFileScrollTop(path, scrollTop) {
    const file = openFiles.get(path);
    if (file) {
        file.scrollTop = scrollTop;
    }
}

export function getFileScrollTop(path) {
    const file = openFiles.get(path);
    return file?.scrollTop || 0;
}

/**
 * Update undo/redo stacks for a file (per-file undo history)
 * @param {string} path - File path
 * @param {Array} undoStack - Undo stack array
 * @param {Array} redoStack - Redo stack array
 */
export function updateFileUndoStacks(path, undoStack, redoStack) {
    const file = openFiles.get(path);
    if (file) {
        file.undoStack = undoStack;
        file.redoStack = redoStack;
    }
}

/**
 * Get undo/redo stacks for a file
 * @param {string} path - File path
 * @returns {{undoStack: Array, redoStack: Array}} Undo and redo stacks (empty arrays if not found)
 */
export function getFileUndoStacks(path) {
    const file = openFiles.get(path);
    return {
        undoStack: file?.undoStack || [],
        redoStack: file?.redoStack || []
    };
}

export function markFileSaved(path) {
    const file = openFiles.get(path);
    if (file) {
        file.modified = false;
        emit('file-modified', { path, modified: false });
    }
}

/**
 * Close all open files/tabs
 */
export function closeAllFiles() {
    openFiles.clear();
    activeFilePath = null;
    emit('files-changed', { openFiles, activeFilePath });
}

/**
 * Save current tabs state for a project (to localStorage for instant access)
 */
export function saveProjectTabs(projectPath = null) {
    const path = projectPath || currentProject?.path;
    if (!path) return;

    // Save tabs with their scroll positions and mtimes for cache validation
    const tabsWithScroll = {};
    const mtimes = {};
    for (const [filePath, file] of openFiles.entries()) {
        tabsWithScroll[filePath] = { scrollTop: file.scrollTop || 0 };
        if (file.mtime) {
            mtimes[filePath] = file.mtime;
        }
    }

    // Cache active file content for instant restore on refresh
    const activeFile = activeFilePath ? openFiles.get(activeFilePath) : null;
    const activeContent = activeFile?.content || null;
    const activeMtime = activeFile?.mtime || null;

    const tabState = {
        tabs: Array.from(openFiles.keys()),
        active: activeFilePath,
        scrollPositions: tabsWithScroll,
        mtimes,                         // For cache freshness validation
        cachedContent: activeContent,   // For instant display on refresh
        cachedMtime: activeMtime,       // To verify cache is fresh
    };
    localStorage.setItem(`mrmd_tabs_${path}`, JSON.stringify(tabState));
}

/**
 * Get saved tabs for a project (from localStorage)
 */
export function getSavedProjectTabs(projectPath) {
    const stored = localStorage.getItem(`mrmd_tabs_${projectPath}`);
    if (!stored) return null;
    try {
        return JSON.parse(stored);
    } catch {
        return null;
    }
}

/**
 * Get the last opened project path (for restore on refresh)
 */
export function getLastProjectPath() {
    return localStorage.getItem(LAST_PROJECT_KEY);
}

// Welcome mode management
/**
 * Load and enter welcome mode
 */
export async function enterWelcomeMode() {
    try {
        const result = await fetchJson('/api/mrmd/welcome');
        welcomeContent = result;
        isWelcomeMode = true;
        emit('welcome-mode', { active: true, content: result });
        return result;
    } catch (err) {
        console.error('[SessionState] Welcome mode error:', err);
        return null;
    }
}

/**
 * Exit welcome mode (when user opens a file or project)
 */
export function exitWelcomeMode() {
    if (isWelcomeMode) {
        isWelcomeMode = false;
        emit('welcome-mode', { active: false });
    }
}

/**
 * Check if this is a first run (no files opened, config says show welcome)
 */
export function shouldShowWelcome() {
    // Show welcome if:
    // 1. No files are open
    // 2. No project is open
    // 3. Config says show_welcome (default true)
    if (openFiles.size > 0) return false;
    if (currentProject) return false;

    const config = mrmdStatus?.config || {};
    return config.show_welcome !== false;
}

/**
 * Set whether to show welcome on startup
 */
export async function setShowWelcome(show) {
    await fetchJson('/api/mrmd/config', {
        method: 'POST',
        body: JSON.stringify({ show_welcome: show }),
    });

    if (mrmdStatus?.config) {
        mrmdStatus.config.show_welcome = show;
    }
}

// ==================== Session Persistence ====================

let savedSessions = [];        // List of saved sessions for current project
let hasUnsavedState = false;   // Track if session has unsaved changes

export function getSavedSessions() { return savedSessions; }
export function getHasUnsavedState() { return hasUnsavedState; }

/**
 * Mark session as having unsaved state (called after code execution)
 */
export function markSessionDirty() {
    hasUnsavedState = true;
    emit('session-dirty', { dirty: true });
}

/**
 * Mark session as clean (called after save)
 */
export function markSessionClean() {
    hasUnsavedState = false;
    emit('session-dirty', { dirty: false });
}

/**
 * Load list of saved sessions for current project
 */
export async function loadSavedSessions() {
    if (!currentProject) {
        savedSessions = [];
        emit('sessions-changed', { sessions: savedSessions });
        return [];
    }

    try {
        const result = await fetchJson('/api/sessions/list', {
            method: 'POST',
            body: JSON.stringify({ project_path: currentProject.path }),
        });
        savedSessions = result.sessions || [];
        emit('sessions-changed', { sessions: savedSessions });
        return savedSessions;
    } catch (err) {
        console.error('[SessionState] Load sessions error:', err);
        return [];
    }
}

/**
 * Save current session state
 */
export async function saveSession(sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/save', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: sessionName,
                session_id: sessionName,  // Use session name as the IPython session ID
            }),
        });

        if (result.success) {
            markSessionClean();
            await loadSavedSessions();
            emit('session-saved', { name: sessionName, path: result.path });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Save session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Load a saved session
 */
export async function loadSavedSession(sessionPath) {
    try {
        const result = await fetchJson('/api/sessions/load', {
            method: 'POST',
            body: JSON.stringify({
                session_path: sessionPath,
                session_id: currentSessionName,
            }),
        });

        if (result.success) {
            emit('session-loaded', { path: sessionPath, variables: result.variables });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Load session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Delete a saved session
 */
export async function deleteSavedSession(sessionPath) {
    try {
        const result = await fetchJson('/api/sessions/delete', {
            method: 'POST',
            body: JSON.stringify({ session_path: sessionPath }),
        });

        if (result.success) {
            await loadSavedSessions();
            emit('session-deleted', { path: sessionPath });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Delete session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Delete only the saved state (.dill.gz) for a session, keeping metadata
 * @param {string} sessionName - Session name
 */
export async function deleteSessionSavedState(sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/delete-saved', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: sessionName,
            }),
        });

        if (result.success) {
            await loadProjectSessions();
            emit('session-saved-deleted', { name: sessionName });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Delete saved state error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Rename a saved session
 */
export async function renameSavedSession(sessionPath, newName) {
    try {
        const result = await fetchJson('/api/sessions/rename', {
            method: 'POST',
            body: JSON.stringify({ session_path: sessionPath, new_name: newName }),
        });

        if (result.success) {
            await loadSavedSessions();
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Rename session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Clear all variables from current session
 */
export async function clearSession() {
    try {
        const result = await fetchJson('/api/sessions/clear', {
            method: 'POST',
            body: JSON.stringify({ session_id: currentSessionName }),
        });

        if (result.success) {
            markSessionClean();
            emit('session-cleared', { cleared: result.cleared });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Clear session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Check if safe to switch session/venv (warns if unsaved state)
 * Returns true if safe to proceed, false if user cancelled
 */
export async function confirmSessionSwitch(action = 'switch') {
    if (!hasUnsavedState) return true;

    const message = `Your session has unsaved variables that will be lost.\n\n` +
        `Would you like to save your session before ${action}?`;

    // Show confirmation dialog
    const choice = confirm(message);

    if (!choice) {
        // User wants to proceed without saving
        return true;
    }

    // User wants to save - but we need a name
    if (currentProject) {
        const name = prompt('Save session as:', 'session-' + Date.now());
        if (name) {
            const result = await saveSession(name);
            return result.success;
        }
    }

    return true;
}

// ==================== Multi-Session Management ====================

/**
 * Load project sessions list from server
 * Returns { sessions, notebookBindings }
 */
export async function loadProjectSessions() {
    if (!currentProject) {
        projectSessions = [];
        notebookSessionBindings.clear();
        emit('project-sessions-changed', { sessions: projectSessions, bindings: {} });
        return { sessions: [], notebookBindings: {} };
    }

    try {
        const result = await fetchJson('/api/sessions/list', {
            method: 'POST',
            body: JSON.stringify({ project_path: currentProject.path }),
        });
        projectSessions = result.sessions || [];

        // Update local bindings cache from server
        const bindings = result.notebook_bindings || {};
        notebookSessionBindings.clear();
        for (const [notebook, session] of Object.entries(bindings)) {
            notebookSessionBindings.set(notebook, session);
        }

        emit('project-sessions-changed', { sessions: projectSessions, bindings });
        return { sessions: projectSessions, notebookBindings: bindings };
    } catch (err) {
        console.error('[SessionState] Load project sessions error:', err);
        return { sessions: [], notebookBindings: {} };
    }
}

/**
 * Count notebooks bound to a specific session
 */
export function countNotebooksForSession(sessionName) {
    let count = 0;
    for (const session of notebookSessionBindings.values()) {
        if (session === sessionName) count++;
    }
    // "main" is the default, so unbound notebooks count toward it
    if (sessionName === 'main') {
        // This is approximate - we'd need to know total open notebooks
        return count > 0 ? count : null;
    }
    return count > 0 ? count : null;
}

/**
 * Get all notebook bindings
 */
export function getNotebookBindings() {
    return Object.fromEntries(notebookSessionBindings);
}

/**
 * Create a new session for the current project
 * @param {string} name - Session name
 * @param {string} pythonPath - Optional Python path (uses current if not specified)
 */
export async function createProjectSession(name, pythonPath = null) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/create', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: name,
                python_path: pythonPath || currentVenv,
            }),
        });

        if (result.success) {
            await loadProjectSessions();
            emit('session-created', { name, session: result.session });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Create session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Switch to a different session (just updates tracking - sessions are separate processes)
 * @param {string} sessionName - Session name to switch to
 */
export async function switchToSession(sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    // Already on this session?
    if (sessionName === currentSessionName) {
        return { success: true };
    }

    const previousSession = currentSessionName;
    currentSessionName = sessionName;

    emit('session-switched', { from: previousSession, to: sessionName });

    return { success: true };
}

/**
 * Save current session state under current session name
 */
export async function saveCurrentSession() {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    return saveSession(currentSessionName);
}

/**
 * Delete a session
 * @param {string} sessionName - Session name to delete
 */
export async function deleteProjectSession(sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    if (sessionName === 'main') {
        return { success: false, message: 'Cannot delete main session' };
    }

    try {
        const result = await fetchJson('/api/sessions/delete', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: sessionName,
            }),
        });

        if (result.success) {
            // If we deleted the current session, switch to main
            if (currentSessionName === sessionName) {
                currentSessionName = 'main';
                emit('session-switched', { from: sessionName, to: 'main' });
            }
            await loadProjectSessions();
            emit('session-deleted', { name: sessionName });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Delete session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Rename a session
 * @param {string} oldName - Current session name
 * @param {string} newName - New session name
 */
export async function renameProjectSession(oldName, newName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    if (oldName === 'main') {
        return { success: false, message: 'Cannot rename main session' };
    }

    try {
        const result = await fetchJson('/api/sessions/rename', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                old_name: oldName,
                new_name: newName,
            }),
        });

        if (result.success) {
            if (currentSessionName === oldName) {
                currentSessionName = newName;
            }
            await loadProjectSessions();
            emit('session-renamed', { from: oldName, to: newName });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Rename session error:', err);
        return { success: false, message: err.message };
    }
}

// ==================== Notebook-Session Bindings ====================

/**
 * Get the session a notebook should use
 * @param {string} notebookPath - Path to the notebook
 */
export async function getNotebookSession(notebookPath) {
    if (!currentProject) {
        return 'main';
    }

    // Check local cache first
    if (notebookSessionBindings.has(notebookPath)) {
        return notebookSessionBindings.get(notebookPath);
    }

    try {
        const result = await fetchJson('/api/sessions/notebook', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                notebook_path: notebookPath,
            }),
        });

        const sessionName = result.session_name || 'main';
        notebookSessionBindings.set(notebookPath, sessionName);
        return sessionName;
    } catch (err) {
        console.error('[SessionState] Get notebook session error:', err);
        return 'main';
    }
}

/**
 * Bind a notebook to a specific session
 * @param {string} notebookPath - Path to the notebook
 * @param {string} sessionName - Session name to bind to
 */
export async function bindNotebookToSession(notebookPath, sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/bind', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                notebook_path: notebookPath,
                session_name: sessionName,
            }),
        });

        if (result.success) {
            notebookSessionBindings.set(notebookPath, sessionName);
            emit('notebook-binding-changed', { notebook: notebookPath, session: sessionName });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Bind notebook error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Kill a running session (IPython subprocess)
 * @param {string} sessionName - Session name to kill
 * @param {boolean} saveFirst - If true, save the session before killing
 */
export async function killSession(sessionName, saveFirst = false) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/kill', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: sessionName,
                save_first: saveFirst,
            }),
        });

        if (result.success) {
            await loadProjectSessions();
            emit('session-killed', { name: sessionName, saved: saveFirst });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Kill session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Restore/start a saved session (load pickled state into new subprocess)
 * @param {string} sessionName - Session name to restore
 */
export async function restoreSession(sessionName) {
    if (!currentProject) {
        return { success: false, message: 'No project open' };
    }

    try {
        const result = await fetchJson('/api/sessions/restore', {
            method: 'POST',
            body: JSON.stringify({
                project_path: currentProject.path,
                session_name: sessionName,
            }),
        });

        if (result.success) {
            await loadProjectSessions();
            emit('session-restored', { name: sessionName });
        }

        return result;
    } catch (err) {
        console.error('[SessionState] Restore session error:', err);
        return { success: false, message: err.message };
    }
}

/**
 * Called when opening a notebook - checks if it has a saved session and offers to restore
 * Returns the session info if there's a saved session to restore
 * @param {string} notebookPath - Path to the notebook
 */
export async function checkNotebookSavedSession(notebookPath) {
    if (!currentProject) {
        return null;
    }

    try {
        // Get the session this notebook is bound to
        const sessionName = await getNotebookSession(notebookPath);

        // Find the session info
        const sessionInfo = projectSessions.find(s => s.name === sessionName);
        if (!sessionInfo) {
            return null;
        }

        // If session has saved state and is not currently live, return info for prompt
        if (sessionInfo.state === 'saved' && sessionName !== currentSessionName) {
            return {
                sessionName,
                sessionInfo,
                notebookPath,
            };
        }

        return null;
    } catch (err) {
        console.error('[SessionState] Check notebook session error:', err);
        return null;
    }
}

// Initialization state
let _initialized = false;
let _initializePromise = null;

// Initialize on load (idempotent - safe to call multiple times)
export async function initialize() {
    // If already initialized, return cached result
    if (_initialized) {
        return { showWelcome: shouldShowWelcome() };
    }

    // If initialization is in progress, wait for it
    if (_initializePromise) {
        return _initializePromise;
    }

    // Start initialization
    _initializePromise = (async () => {
        // Run all initialization calls in parallel for faster startup
        const [statusResult, projectsResult, notebooksResult] = await Promise.all([
            checkMrmdStatus(),
            loadRecentProjects(),
            fetchRecentNotebooks(),
        ]);

        // Check if we should show welcome
        const showWelcome = shouldShowWelcome();

        // Mark as initialized
        _initialized = true;

        // Emit initial state
        emit('initialized', {
            mrmdStatus,
            sessionMode,
            currentVenv,
            currentProject,
            recentProjects,
            recentNotebooks,
            showWelcome,
        });

        return { showWelcome };
    })();

    return _initializePromise;
}

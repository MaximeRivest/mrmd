/**
 * Project Session Coordinator
 *
 * Single source of truth for project and kernel session state.
 * Manages the relationship between:
 *
 * 1. Active Project - the project whose kernel is running
 * 2. Active Session - the kernel session ID being used for code execution
 * 3. Viewed File's Project - which project the currently open file belongs to
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Opening a file does NOT auto-switch projects
 *    - Files from other projects can be viewed without kernel switch
 *    - Only code execution triggers a project mismatch check
 *
 * 2. Deterministic session IDs (matching server's project_pool.py)
 *    - Same project always gets same session ID: `project_{md5(path)[:8]}`
 *    - Enables pool reuse for instant switching
 *
 * 3. State machine for kernel status
 *    - idle → initializing → ready | error
 *    - Prevents race conditions, clear UI feedback
 *
 * 4. Auto-sync with IPythonClient
 *    - When session changes, IPythonClient is automatically updated
 *    - No manual sync needed throughout the codebase
 *
 * 5. Execution-time mismatch detection
 *    - Before code runs, check if file's project matches active project
 *    - If mismatch, prompt user: "Switch to X?" or "Run in current"
 *
 * ARCHITECTURE:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                      UI Layer                               │
 *   │  (index.ts, home-screen.js, file-browser.js)               │
 *   │  - Calls coordinator.openFile(), coordinator.openProject()  │
 *   │  - Listens to events for UI updates                         │
 *   └───────────────────────┬─────────────────────────────────────┘
 *                           │
 *                           ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │              ProjectSessionCoordinator                      │
 *   │  - Single source of truth                                   │
 *   │  - State machine for kernel status                          │
 *   │  - Auto-syncs IPythonClient                                 │
 *   │  - Emits events: project-changed, session-changed,          │
 *   │                  kernel-ready, mismatch-detected            │
 *   └───────────────────────┬─────────────────────────────────────┘
 *                           │
 *                           ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                   Server APIs                               │
 *   │  - /api/project/switch (pool)                               │
 *   │  - /api/ipython/reconfigure                                 │
 *   │  - /api/project/detect                                      │
 *   └─────────────────────────────────────────────────────────────┘
 */

// ============================================================================
// State
// ============================================================================

/**
 * Kernel status state machine
 * @typedef {'idle' | 'initializing' | 'ready' | 'error' | 'switching'} KernelStatus
 */

/**
 * @typedef {Object} ActiveProjectState
 * @property {string} path - Project root path
 * @property {string} name - Project display name
 * @property {string} sessionId - IPython session ID (deterministic hash)
 * @property {string|null} pythonPath - Path to Python executable
 * @property {string|null} venvPath - Path to venv directory
 */

/**
 * @typedef {Object} ViewedFileState
 * @property {string} path - File path
 * @property {string|null} projectPath - Project this file belongs to
 * @property {string|null} projectName - Project name
 * @property {boolean} isProjectMismatch - True if file's project != active project
 */

/** @type {KernelStatus} */
let kernelStatus = 'idle';

/** @type {string|null} */
let kernelStatusMessage = null;

/** @type {ActiveProjectState|null} */
let activeProject = null;

/** @type {ViewedFileState|null} */
let viewedFile = null;

/** @type {Function|null} - IPythonClient.setSession callback */
let ipythonClientSyncCallback = null;

/** @type {Function|null} - IPythonClient.setProjectPath callback */
let ipythonClientProjectCallback = null;

/** @type {Function|null} - IPythonClient.setFigureDir callback */
let ipythonClientFigureDirCallback = null;

// Event emitter
const listeners = new Map();

function emit(event, data) {
    const handlers = listeners.get(event) || [];
    handlers.forEach(fn => {
        try {
            fn(data);
        } catch (err) {
            console.error(`[Coordinator] Error in ${event} handler:`, err);
        }
    });
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

// ============================================================================
// Getters (read-only access to state)
// ============================================================================

export function getKernelStatus() {
    return { status: kernelStatus, message: kernelStatusMessage };
}

export function getActiveProject() {
    return activeProject ? { ...activeProject } : null;
}

export function getActiveSessionId() {
    return activeProject?.sessionId || 'main';
}

export function getViewedFile() {
    return viewedFile ? { ...viewedFile } : null;
}

export function hasProjectMismatch() {
    return viewedFile?.isProjectMismatch || false;
}

export function isKernelReady() {
    return kernelStatus === 'ready';
}

export function isKernelBusy() {
    return kernelStatus === 'initializing' || kernelStatus === 'switching';
}

// ============================================================================
// IPythonClient Auto-Sync
// ============================================================================

/**
 * Register IPythonClient for auto-sync.
 * When session/project changes, the client is automatically updated.
 *
 * @param {Object} client - IPythonClient instance
 */
export function registerIPythonClient(client) {
    ipythonClientSyncCallback = (sessionId) => {
        client.setSession(sessionId);
        console.log(`[Coordinator] IPythonClient synced to session: ${sessionId}`);
    };

    ipythonClientProjectCallback = (projectPath) => {
        client.setProjectPath(projectPath);
    };

    ipythonClientFigureDirCallback = (figureDir) => {
        client.setFigureDir(figureDir);
    };

    // Sync immediately with current state
    if (activeProject) {
        ipythonClientSyncCallback(activeProject.sessionId);
        ipythonClientProjectCallback(activeProject.path);
        ipythonClientFigureDirCallback(activeProject.path + '/.mrmd/assets');
    }

    console.log('[Coordinator] IPythonClient registered for auto-sync');
}

/**
 * Sync IPythonClient with current state.
 * Called internally whenever session changes.
 */
function syncIPythonClient() {
    if (!activeProject) return;

    if (ipythonClientSyncCallback) {
        ipythonClientSyncCallback(activeProject.sessionId);
    }
    if (ipythonClientProjectCallback) {
        ipythonClientProjectCallback(activeProject.path);
    }
    if (ipythonClientFigureDirCallback) {
        ipythonClientFigureDirCallback(activeProject.path + '/.mrmd/assets');
    }
}

// ============================================================================
// Deterministic Session ID (matches server's project_pool.py)
// ============================================================================

/**
 * Generate a deterministic session ID for a project path.
 * MUST match the server's _make_session_id() in project_pool.py
 *
 * Uses Web Crypto API for MD5-compatible hash.
 *
 * @param {string} projectPath - Full path to project
 * @returns {Promise<string>} Session ID like "project_a7ffa64c"
 */
export async function makeSessionId(projectPath) {
    // Use SubtleCrypto for proper hashing
    // Note: MD5 is not available in SubtleCrypto, so we use SHA-256 and truncate
    // For exact compatibility, use getServerSessionId() which calls the server
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(projectPath);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        // Take first 8 chars to match server's MD5 truncation
        // Note: This won't match server's MD5 exactly - use getServerSessionId for that
        return `project_${hashHex.slice(0, 8)}`;
    } catch (err) {
        // Fallback for environments without crypto.subtle
        console.warn('[Coordinator] crypto.subtle not available, using fallback hash');
        let hash = 0;
        for (let i = 0; i < projectPath.length; i++) {
            const char = projectPath.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        const hex = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
        return `project_${hex}`;
    }
}

/**
 * Synchronous version of makeSessionId using simple hash.
 * Use this only when async is not possible.
 * For exact server compatibility, prefer getServerSessionId().
 */
export function makeSessionIdSync(projectPath) {
    let hash = 0;
    for (let i = 0; i < projectPath.length; i++) {
        const char = projectPath.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
    return `project_${hex}`;
}

/**
 * For exact compatibility, we can also ask the server for the session ID.
 * This is more reliable than reimplementing MD5 in JS.
 *
 * @param {string} projectPath
 * @returns {Promise<string>}
 */
async function getServerSessionId(projectPath) {
    try {
        const response = await fetch('/api/project/session-id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath }),
        });
        if (response.ok) {
            const data = await response.json();
            return data.session_id;
        }
    } catch (err) {
        console.warn('[Coordinator] Failed to get server session ID:', err);
    }
    // Fallback to local generation
    return makeSessionId(projectPath);
}

// ============================================================================
// Project Detection
// ============================================================================

/**
 * Detect which project a file belongs to.
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<{path: string, name: string}|null>}
 */
export async function detectProjectForFile(filePath) {
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

    try {
        const response = await fetch('/api/project/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
        });

        if (response.ok) {
            const data = await response.json();
            if (data.is_project) {
                return {
                    path: data.project_path || data.project_root,
                    name: data.project_name,
                };
            }
        }
    } catch (err) {
        console.warn('[Coordinator] Project detection failed:', err);
    }

    return null;
}

// ============================================================================
// State Machine Transitions
// ============================================================================

/**
 * Transition kernel to initializing state.
 * @param {string} message - Status message to display
 */
function setKernelInitializing(message = 'Initializing...') {
    kernelStatus = 'initializing';
    kernelStatusMessage = message;
    emit('kernel-status-changed', { status: kernelStatus, message: kernelStatusMessage });
}

/**
 * Transition kernel to switching state.
 * @param {string} projectName - Project being switched to
 */
function setKernelSwitching(projectName) {
    kernelStatus = 'switching';
    kernelStatusMessage = `Switching to ${projectName}...`;
    emit('kernel-status-changed', { status: kernelStatus, message: kernelStatusMessage });
}

/**
 * Transition kernel to ready state.
 */
function setKernelReady() {
    kernelStatus = 'ready';
    kernelStatusMessage = null;
    emit('kernel-status-changed', { status: kernelStatus, message: null });
    emit('kernel-ready', {
        project: activeProject?.name,
        session: activeProject?.sessionId,
        python: activeProject?.pythonPath,
    });
}

/**
 * Transition kernel to error state.
 * @param {string} message - Error message
 */
function setKernelError(message) {
    kernelStatus = 'error';
    kernelStatusMessage = message;
    emit('kernel-status-changed', { status: kernelStatus, message });
    emit('kernel-error', { message });
}

// ============================================================================
// Core Operations
// ============================================================================

/**
 * Open/switch to a project.
 *
 * This:
 * 1. Sets the active project
 * 2. Uses pool if warm, or reconfigures kernel if cold
 * 3. Syncs IPythonClient
 * 4. Emits events
 *
 * @param {string} projectPath - Path to project
 * @param {Object} options
 * @param {boolean} options.skipWarning - Skip unsaved state warning
 * @param {string} options.pythonPath - Python executable path
 * @param {string[]} options.tabPaths - Tabs to restore
 * @returns {Promise<{success: boolean, warm: boolean, error?: string}>}
 */
export async function openProject(projectPath, options = {}) {
    const projectName = projectPath.split('/').pop();
    console.log(`[Coordinator] Opening project: ${projectName}`);

    // State machine: set to switching
    setKernelSwitching(projectName);

    try {
        // Get saved tabs for this project (for pool)
        const tabPaths = options.tabPaths || [];

        // Run pool check and venv search in parallel
        const [poolResult, venvResult] = await Promise.all([
            fetch('/api/project/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: projectPath, tab_paths: tabPaths }),
            }).then(r => r.json()).catch(() => ({ status: 'cold' })),

            fetch('/api/venvs/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ root: projectPath, max_depth: 2 }),
            }).then(r => r.json()).catch(() => ({ venvs: [] })),
        ]);

        const isWarm = poolResult.status === 'warm';
        const venv = options.pythonPath
            ? { python_path: options.pythonPath }
            : venvResult.venvs?.[0] || null;

        // Determine session ID
        // If warm, use the pool's session ID (already running)
        // If cold, get from server to ensure exact match with pool's hash
        let sessionId;
        if (isWarm && poolResult.session_id) {
            sessionId = poolResult.session_id;
            console.log(`[Coordinator] Using warm session: ${sessionId}`);
        } else {
            // Get deterministic session ID from server (exact MD5 hash match)
            sessionId = await getServerSessionId(projectPath);
            console.log(`[Coordinator] Using server session ID: ${sessionId}`);
        }

        // Update active project state
        activeProject = {
            path: projectPath,
            name: projectName,
            sessionId: sessionId,
            pythonPath: venv?.python_path || null,
            venvPath: venv?.path || null,
        };

        // Sync IPythonClient immediately
        syncIPythonClient();

        // If cold, reconfigure the kernel
        if (!isWarm && venv) {
            console.log(`[Coordinator] Cold start, reconfiguring kernel...`);

            const reconfigResult = await fetch('/api/ipython/reconfigure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: sessionId,
                    python_path: venv.python_path,
                    cwd: projectPath,
                }),
            }).then(r => r.json());

            if (!reconfigResult.success) {
                setKernelError(reconfigResult.error || 'Reconfigure failed');
                return { success: false, warm: false, error: reconfigResult.error };
            }

            // Warm this project for future switches
            fetch('/api/project/warm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: projectPath,
                    name: projectName,
                    python_path: venv.python_path,
                    tab_paths: tabPaths,
                }),
            }).catch(err => console.warn('[Coordinator] Warm failed:', err));
        }

        // State machine: set to ready
        setKernelReady();

        // Emit project changed event
        emit('project-changed', {
            project: activeProject,
            warm: isWarm,
            cachedFiles: isWarm ? poolResult.files : null,
        });

        // Update viewed file mismatch state if there's an open file
        if (viewedFile) {
            updateViewedFileMismatch();
        }

        // Save to localStorage for restore
        localStorage.setItem('mrmd_last_project', projectPath);

        return { success: true, warm: isWarm };

    } catch (err) {
        console.error('[Coordinator] openProject error:', err);
        setKernelError(err.message);
        return { success: false, warm: false, error: err.message };
    }
}

/**
 * Set the currently viewed file.
 * This does NOT switch projects - just tracks which file is being viewed.
 *
 * @param {string} filePath - Path to the file being viewed
 * @returns {Promise<ViewedFileState>}
 */
export async function setViewedFile(filePath) {
    // Detect which project this file belongs to
    const fileProject = await detectProjectForFile(filePath);

    viewedFile = {
        path: filePath,
        projectPath: fileProject?.path || null,
        projectName: fileProject?.name || null,
        isProjectMismatch: false, // Will be set by updateViewedFileMismatch
    };

    updateViewedFileMismatch();

    emit('viewed-file-changed', viewedFile);

    return viewedFile;
}

/**
 * Update the mismatch state for the viewed file.
 */
function updateViewedFileMismatch() {
    if (!viewedFile) return;

    const wasMismatch = viewedFile.isProjectMismatch;

    // Check if file's project differs from active project
    if (viewedFile.projectPath && activeProject) {
        viewedFile.isProjectMismatch = viewedFile.projectPath !== activeProject.path;
    } else {
        viewedFile.isProjectMismatch = false;
    }

    // Emit if mismatch state changed
    if (wasMismatch !== viewedFile.isProjectMismatch) {
        emit('mismatch-changed', {
            isMismatch: viewedFile.isProjectMismatch,
            viewedProject: viewedFile.projectName,
            activeProject: activeProject?.name,
        });
    }
}

/**
 * Check if code execution should proceed or if user should be prompted.
 *
 * Call this before executing code. Returns:
 * - { proceed: true } if execution can proceed in current session
 * - { proceed: false, reason: 'mismatch', ... } if there's a project mismatch
 *
 * @param {string} filePath - File where code is being executed
 * @returns {Promise<{proceed: boolean, reason?: string, viewedProject?: string, activeProject?: string}>}
 */
export async function checkExecutionContext(filePath) {
    // Ensure we have current file project info
    if (!viewedFile || viewedFile.path !== filePath) {
        await setViewedFile(filePath);
    }

    // If kernel is busy, don't allow execution
    if (isKernelBusy()) {
        return {
            proceed: false,
            reason: 'busy',
            message: 'Kernel is busy. Please wait...',
        };
    }

    // If there's a project mismatch, the caller should prompt user
    if (hasProjectMismatch()) {
        return {
            proceed: false,
            reason: 'mismatch',
            viewedProject: viewedFile.projectName,
            activeProject: activeProject?.name,
            message: `This file is from "${viewedFile.projectName}" but kernel is running in "${activeProject?.name}"`,
        };
    }

    // All good, proceed with execution
    return { proceed: true };
}

/**
 * Switch to the viewed file's project.
 * Use this when user confirms they want to switch after a mismatch prompt.
 *
 * @returns {Promise<{success: boolean}>}
 */
export async function switchToViewedProject() {
    if (!viewedFile?.projectPath) {
        return { success: false, error: 'No viewed file project' };
    }

    return openProject(viewedFile.projectPath);
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the coordinator with an existing project.
 * Called on app startup to restore state.
 *
 * @param {Object} initialProject - Initial project state
 */
export async function initialize(initialProject = null) {
    if (initialProject) {
        activeProject = {
            path: initialProject.path,
            name: initialProject.name || initialProject.path.split('/').pop(),
            sessionId: initialProject.sessionId || makeSessionId(initialProject.path),
            pythonPath: initialProject.pythonPath || null,
            venvPath: initialProject.venvPath || null,
        };
        syncIPythonClient();
        setKernelReady();
    } else {
        // No initial project - use 'main' session
        activeProject = null;
        kernelStatus = 'ready';
    }

    console.log('[Coordinator] Initialized:', activeProject?.name || '(no project)');
}

// ============================================================================
// Debug
// ============================================================================

export function getDebugState() {
    return {
        kernelStatus,
        kernelStatusMessage,
        activeProject,
        viewedFile,
        hasIPythonClientSync: !!ipythonClientSyncCallback,
    };
}

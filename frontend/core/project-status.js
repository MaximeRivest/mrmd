/**
 * Project Status Service for MRMD
 *
 * Manages:
 * - Environment status: 'ready', 'setting-up', 'none', 'error'
 * - Auto-setup of Python environments
 * - Cross-project file detection
 *
 * Design:
 * - Central source of truth for environment state
 * - Emits events for UI updates
 * - Handles environment auto-setup transparently
 */

import * as SessionState from './session-state.js';

// Environment status states
export const ENV_STATUS = {
    READY: 'ready',           // Kernel running, environment active
    SETTING_UP: 'setting-up', // Creating venv, installing deps
    NONE: 'none',             // No environment (plain directory)
    ERROR: 'error',           // Setup failed
};

// Current state
let currentStatus = ENV_STATUS.NONE;
let currentError = null;
let setupInProgress = false;
let pendingSetupPath = null;

// Track which project each open file belongs to
// Map<filePath, { projectPath, projectName }>
const fileProjectMap = new Map();

// Event listeners
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
export function getStatus() { return currentStatus; }
export function getError() { return currentError; }
export function isSettingUp() { return setupInProgress; }

/**
 * Get the project that a file belongs to
 * @param {string} filePath - Path to the file
 * @returns {{ projectPath: string, projectName: string } | null}
 */
export function getFileProject(filePath) {
    return fileProjectMap.get(filePath) || null;
}

/**
 * Register a file's project association
 * @param {string} filePath - Path to the file
 * @param {string} projectPath - Path to the project
 * @param {string} projectName - Name of the project
 */
export function setFileProject(filePath, projectPath, projectName) {
    fileProjectMap.set(filePath, { projectPath, projectName });
}

/**
 * Clear file-project association when file is closed
 */
export function clearFileProject(filePath) {
    fileProjectMap.delete(filePath);
}

/**
 * Set the current environment status
 */
export function setStatus(status, error = null) {
    const oldStatus = currentStatus;
    currentStatus = status;
    currentError = error;

    if (oldStatus !== status) {
        emit('status-changed', { status, error, oldStatus });
    }
}

/**
 * Check if a file's project matches the active kernel's project
 * @param {string} filePath - Path to the file
 * @returns {{ matches: boolean, fileProject: object | null, activeProject: object | null }}
 */
export function checkProjectMatch(filePath) {
    const activeProject = SessionState.getCurrentProject();
    const fileProject = getFileProject(filePath);

    // If no file project tracked, try to detect it
    if (!fileProject) {
        return { matches: true, fileProject: null, activeProject };
    }

    // If no active project, any file project is a mismatch
    if (!activeProject) {
        return { matches: false, fileProject, activeProject: null };
    }

    // Compare project paths
    const matches = fileProject.projectPath === activeProject.path;
    return { matches, fileProject, activeProject };
}

/**
 * Check if a directory needs environment setup
 * @param {string} dirPath - Path to the directory
 * @returns {Promise<{ needsSetup: boolean, hasVenv: boolean, hasDeps: boolean, depsFile: string | null }>}
 */
export async function checkEnvironmentNeeds(dirPath) {
    try {
        const response = await fetch('/api/project/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
        });

        if (!response.ok) {
            return { needsSetup: false, hasVenv: false, hasDeps: false, depsFile: null };
        }

        const data = await response.json();
        const environments = data.environments || [];
        const hasVenv = environments.length > 0;

        // Check for dependency files
        const projectRoot = data.project_root || dirPath;
        const depsResponse = await fetch('/api/file/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectRoot }),
        });

        let hasDeps = false;
        let depsFile = null;

        if (depsResponse.ok) {
            const files = await depsResponse.json();
            const entries = files.results || [];
            const names = entries.map(e => e.name);

            if (names.includes('pyproject.toml')) {
                hasDeps = true;
                depsFile = 'pyproject.toml';
            } else if (names.includes('requirements.txt')) {
                hasDeps = true;
                depsFile = 'requirements.txt';
            }
        }

        return {
            needsSetup: hasDeps && !hasVenv,
            hasVenv,
            hasDeps,
            depsFile,
        };
    } catch (err) {
        console.error('[ProjectStatus] Check environment needs failed:', err);
        return { needsSetup: false, hasVenv: false, hasDeps: false, depsFile: null };
    }
}

/**
 * Setup environment for a project directory
 * Creates venv and installs dependencies
 * @param {string} projectPath - Path to the project
 * @param {string} depsFile - Dependencies file ('pyproject.toml' or 'requirements.txt')
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function setupEnvironment(projectPath, depsFile = 'pyproject.toml') {
    if (setupInProgress) {
        console.warn('[ProjectStatus] Setup already in progress');
        return { success: false, error: 'Setup already in progress' };
    }

    setupInProgress = true;
    pendingSetupPath = projectPath;
    setStatus(ENV_STATUS.SETTING_UP);

    try {
        // Step 1: Create venv using uv
        console.log('[ProjectStatus] Creating venv in', projectPath);
        const venvResponse = await fetch('/api/project/setup-venv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath }),
        });

        if (!venvResponse.ok) {
            const error = await venvResponse.text();
            throw new Error(`Failed to create venv: ${error}`);
        }

        // Step 2: Install dependencies
        console.log('[ProjectStatus] Installing dependencies from', depsFile);
        const installResponse = await fetch('/api/project/install-deps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath, deps_file: depsFile }),
        });

        if (!installResponse.ok) {
            const error = await installResponse.text();
            throw new Error(`Failed to install dependencies: ${error}`);
        }

        // Success - update status and reconfigure kernel
        setStatus(ENV_STATUS.READY);

        // Emit event so session-state can reconfigure the kernel
        emit('environment-ready', { projectPath });

        return { success: true };
    } catch (err) {
        console.error('[ProjectStatus] Setup failed:', err);
        setStatus(ENV_STATUS.ERROR, err.message);
        return { success: false, error: err.message };
    } finally {
        setupInProgress = false;
        pendingSetupPath = null;
    }
}

/**
 * Handle file opened - detect project and check if setup is needed
 * @param {string} filePath - Path to the file
 */
export async function handleFileOpened(filePath) {
    try {
        // Detect project for this file
        const response = await fetch('/api/project/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath }),
        });

        if (!response.ok) return;

        const data = await response.json();
        const projectPath = data.project_root;
        const projectName = projectPath ? projectPath.split('/').pop() : null;

        if (projectPath) {
            // Track file-project association
            setFileProject(filePath, projectPath, projectName);

            // Check if file is from a different project than active
            const activeProject = SessionState.getCurrentProject();
            const isViewing = activeProject && activeProject.path !== projectPath;

            // Emit viewing mode change event (for header to show "(viewing)")
            emit('viewing-mode-changed', {
                viewing: isViewing,
                fileProject: isViewing ? { projectPath, projectName } : null,
                activeProject,
            });

            // Check if environment exists
            const environments = data.environments || [];
            const hasVenv = environments.length > 0;

            if (hasVenv) {
                // Environment exists
                if (activeProject && activeProject.path === projectPath) {
                    setStatus(ENV_STATUS.READY);
                }
            } else {
                // Check if we should auto-setup
                const needs = await checkEnvironmentNeeds(projectPath);
                if (needs.needsSetup) {
                    // Auto-setup environment
                    console.log('[ProjectStatus] Auto-setting up environment for', projectPath);
                    await setupEnvironment(projectPath, needs.depsFile);
                } else if (!needs.hasVenv && !needs.hasDeps) {
                    // Plain directory, no environment needed
                    setStatus(ENV_STATUS.NONE);
                }
            }
        } else {
            // No project detected - clear viewing mode
            emit('viewing-mode-changed', {
                viewing: false,
                fileProject: null,
                activeProject: SessionState.getCurrentProject(),
            });
        }
    } catch (err) {
        console.error('[ProjectStatus] Handle file opened error:', err);
    }
}

/**
 * Show prompt to switch projects
 * @param {object} fileProject - { projectPath, projectName }
 * @param {object} activeProject - { path, name }
 * @returns {Promise<boolean>} - true if user wants to switch, false otherwise
 */
export function showSwitchProjectPrompt(fileProject, activeProject) {
    return new Promise((resolve) => {
        // Inject modal styles if needed
        if (!document.getElementById('switch-project-styles')) {
            const style = document.createElement('style');
            style.id = 'switch-project-styles';
            style.textContent = `
                .switch-project-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    z-index: 2000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .switch-project-modal {
                    background: var(--bg, #1a1b26);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 8px;
                    width: 320px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                }
                .switch-project-header {
                    padding: 16px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text, #c0caf5);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                }
                .switch-project-body {
                    padding: 16px;
                    font-size: 13px;
                    color: var(--muted, #565f89);
                    line-height: 1.5;
                }
                .switch-project-body strong {
                    color: var(--text, #c0caf5);
                }
                .switch-project-footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                }
                .switch-project-btn {
                    padding: 8px 16px;
                    font-size: 13px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }
                .switch-project-btn.cancel {
                    background: transparent;
                    color: var(--muted, #565f89);
                }
                .switch-project-btn.cancel:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: var(--text, #c0caf5);
                }
                .switch-project-btn.switch {
                    background: var(--accent, #7aa2f7);
                    color: var(--bg, #1a1b26);
                }
                .switch-project-btn.switch:hover {
                    background: var(--accent-hover, #89b4fa);
                }
            `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement('div');
        overlay.className = 'switch-project-overlay';
        overlay.innerHTML = `
            <div class="switch-project-modal">
                <div class="switch-project-header">Switch project?</div>
                <div class="switch-project-body">
                    This file belongs to <strong>${fileProject.projectName}</strong>.
                    <br><br>
                    Switch to run code with that project's environment?
                </div>
                <div class="switch-project-footer">
                    <button class="switch-project-btn cancel">Cancel</button>
                    <button class="switch-project-btn switch">Switch</button>
                </div>
            </div>
        `;

        const cleanup = () => overlay.remove();

        overlay.querySelector('.cancel').addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        overlay.querySelector('.switch').addEventListener('click', () => {
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
 * Initialize the project status service
 * Sets up event listeners for project/session changes
 */
export function init() {
    // Listen for kernel events from SessionState
    SessionState.on('kernel-ready', () => {
        setStatus(ENV_STATUS.READY);
    });

    SessionState.on('kernel-initializing', () => {
        setStatus(ENV_STATUS.SETTING_UP);
    });

    SessionState.on('kernel-error', ({ error }) => {
        setStatus(ENV_STATUS.ERROR, error);
    });

    SessionState.on('project-closed', () => {
        setStatus(ENV_STATUS.NONE);
        fileProjectMap.clear();
    });

    // When files are closed, clean up tracking
    SessionState.on('files-changed', ({ openFiles }) => {
        // Remove entries for files that are no longer open
        for (const filePath of fileProjectMap.keys()) {
            if (!openFiles.has(filePath)) {
                fileProjectMap.delete(filePath);
            }
        }
    });

    console.log('[ProjectStatus] Initialized');
}

export default {
    ENV_STATUS,
    getStatus,
    getError,
    isSettingUp,
    getFileProject,
    setFileProject,
    clearFileProject,
    setStatus,
    checkProjectMatch,
    checkEnvironmentNeeds,
    setupEnvironment,
    handleFileOpened,
    showSwitchProjectPrompt,
    init,
    on,
    off,
    emit,
};

/**
 * Developer Status Bar for MRMD Developer Mode
 *
 * Wires up the session and venv badges in the developer mode status bar.
 * These elements exist in index.html but need JavaScript to:
 * 1. Update labels when project/session/venv changes
 * 2. Handle clicks to open session/venv pickers
 */

import * as SessionState from './session-state.js';
import * as SessionUI from './session-ui.js';

// Element references
let sessionBadge = null;
let sessionLabel = null;
let venvBadge = null;
let venvLabel = null;

// Cleanup functions for event listeners
let cleanupFns = [];

/**
 * Initialize the developer status bar
 * Call this after DOM is ready, regardless of current mode.
 * The elements are hidden via CSS in compact mode.
 */
export function initDeveloperStatus() {
    // Find elements
    sessionBadge = document.getElementById('session-badge');
    sessionLabel = document.getElementById('session-label');
    venvBadge = document.getElementById('venv-badge');
    venvLabel = document.getElementById('venv-label');

    if (!sessionBadge || !venvBadge) {
        // Elements don't exist (might be in Study app or custom HTML)
        console.log('[DeveloperStatus] Status bar elements not found, skipping initialization');
        return;
    }

    // Set up click handlers
    sessionBadge.style.cursor = 'pointer';
    venvBadge.style.cursor = 'pointer';

    sessionBadge.addEventListener('click', handleSessionClick);
    venvBadge.addEventListener('click', handleVenvClick);

    // Listen to state changes
    const unsub1 = SessionState.on('session-changed', updateLabels);
    const unsub2 = SessionState.on('project-opened', updateLabels);
    const unsub3 = SessionState.on('project-closed', updateLabels);
    const unsub4 = SessionState.on('session-name-changed', updateLabels);
    const unsub5 = SessionState.on('session-reconfigured', updateLabels);
    const unsub6 = SessionState.on('kernel-ready', updateLabels);

    cleanupFns = [unsub1, unsub2, unsub3, unsub4, unsub5, unsub6];

    // Initial update
    updateLabels();

    console.log('[DeveloperStatus] Initialized');
}

/**
 * Update the session and venv labels based on current state
 */
function updateLabels() {
    if (!sessionLabel || !venvLabel) return;

    // Session label: show current session name
    const sessionName = SessionState.getCurrentSessionName() || 'main';
    sessionLabel.textContent = sessionName;

    // Venv label: show current venv display name
    const venvDisplay = SessionState.getVenvDisplayName() || 'default';
    venvLabel.textContent = venvDisplay;

    // Update tooltips with more detail
    const project = SessionState.getCurrentProject();
    if (project) {
        sessionBadge.title = `Session: ${sessionName}\nProject: ${project.name}\nClick to manage sessions`;
        venvBadge.title = `Environment: ${venvDisplay}\nClick to change Python`;
    } else {
        sessionBadge.title = `Session: ${sessionName}\nClick to manage sessions`;
        venvBadge.title = `Environment: ${venvDisplay}\nClick to change Python`;
    }
}

/**
 * Handle click on session badge
 */
function handleSessionClick() {
    const project = SessionState.getCurrentProject();

    if (project) {
        // Project is open - show session picker for multi-session management
        SessionUI.showSessionPicker({
            onSelect: (sessionName) => {
                console.log('[DeveloperStatus] Switched to session:', sessionName);
                updateLabels();
            },
            onClose: () => {
                // Nothing special needed
            },
        });
    } else {
        // No project - show session menu with options
        SessionUI.showSessionMenu({
            onBrowseVenv: handleVenvClick,
            onBrowseProject: () => {
                // Emit event for project browser
                SessionState.emit('browse-project-requested', {});
            },
            onCreateProject: () => {
                SessionUI.showCreateProjectModal({
                    onCreated: (result) => {
                        console.log('[DeveloperStatus] Project created:', result);
                        updateLabels();
                    },
                });
            },
        });
    }
}

/**
 * Handle click on venv badge
 */
function handleVenvClick() {
    const project = SessionState.getCurrentProject();

    SessionUI.showVenvPicker({
        currentPython: SessionState.getCurrentPython(),
        projectRoot: project?.path,
        onSelect: (pythonPath) => {
            console.log('[DeveloperStatus] Switched to venv:', pythonPath);
            updateLabels();
        },
        onCancel: () => {
            // Nothing special needed
        },
    });
}

/**
 * Destroy the developer status bar listeners
 */
export function destroyDeveloperStatus() {
    // Remove click handlers
    if (sessionBadge) {
        sessionBadge.removeEventListener('click', handleSessionClick);
        sessionBadge.style.cursor = '';
    }
    if (venvBadge) {
        venvBadge.removeEventListener('click', handleVenvClick);
        venvBadge.style.cursor = '';
    }

    // Remove state listeners
    cleanupFns.forEach(fn => fn());
    cleanupFns = [];

    // Clear references
    sessionBadge = null;
    sessionLabel = null;
    venvBadge = null;
    venvLabel = null;

    console.log('[DeveloperStatus] Destroyed');
}

/**
 * Force update the labels (for external callers)
 */
export function refresh() {
    updateLabels();
}

export default {
    initDeveloperStatus,
    destroyDeveloperStatus,
    refresh,
};

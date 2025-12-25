/**
 * Mode Controller for MRMD
 *
 * Manages switching between Compact Mode and Developer Mode.
 * Listens to interface-mode-changed events and updates the UI accordingly.
 */

import * as SessionState from './session-state.js';

let container = null;
let initialized = false;

/**
 * Initialize the mode controller
 * @param {HTMLElement} containerEl - The main .container element
 */
export function initModeController(containerEl) {
    if (initialized) return;

    container = containerEl || document.querySelector('.container');
    if (!container) {
        console.error('[ModeController] Container element not found');
        return;
    }

    // Apply initial mode
    applyMode(SessionState.getInterfaceMode());

    // Listen for mode changes
    SessionState.on('interface-mode-changed', ({ mode }) => {
        applyMode(mode);
    });

    // Listen for tool rail side changes
    SessionState.on('tool-rail-side-changed', ({ side }) => {
        applyToolRailSide(side);
    });

    // Apply initial tool rail side
    applyToolRailSide(SessionState.getToolRailSide());

    initialized = true;
}

/**
 * Apply the interface mode to the container
 * @param {string} mode - 'compact' or 'developer'
 */
function applyMode(mode) {
    if (!container) return;

    // Remove existing mode classes
    container.classList.remove('compact-mode', 'developer-mode');

    // Add new mode class
    container.classList.add(`${mode}-mode`);

    // Update body class for global styling
    document.body.classList.remove('compact-mode', 'developer-mode');
    document.body.classList.add(`${mode}-mode`);

    console.log(`[ModeController] Switched to ${mode} mode`);
}

/**
 * Apply tool rail side positioning
 * @param {string} side - 'left' or 'right'
 */
function applyToolRailSide(side) {
    if (!container) return;

    container.classList.remove('tool-rail-left', 'tool-rail-right');
    container.classList.add(`tool-rail-${side}`);
}

/**
 * Toggle between compact and developer modes
 */
export function toggleMode() {
    const currentMode = SessionState.getInterfaceMode();
    const newMode = currentMode === 'compact' ? 'developer' : 'compact';
    SessionState.setInterfaceMode(newMode);
}

/**
 * Check if currently in compact mode
 */
export function isCompact() {
    return SessionState.isCompactMode();
}

/**
 * Check if currently in developer mode
 */
export function isDeveloper() {
    return SessionState.isDeveloperMode();
}

export default {
    initModeController,
    toggleMode,
    isCompact,
    isDeveloper
};

/**
 * Compact Header Component for MRMD
 *
 * Minimal floating UI: a small toggle button to open the tool rail,
 * and a floating exit button that appears on the opposite side when rail is open.
 * No top bar - just clean floating buttons.
 */

import * as SessionState from './session-state.js';

let containerEl = null;
let toggleBtn = null;
let exitBtn = null;
let onExitClick = null;
let onMenuClick = null;

/**
 * Create the compact header elements (floating buttons, no bar)
 * @param {Object} options
 * @param {Function} options.onExit - Callback when exit button clicked
 * @param {Function} options.onMenu - Callback when menu button clicked
 * @returns {HTMLElement}
 */
export function createCompactHeader(options = {}) {
    onExitClick = options.onExit || (() => {});
    onMenuClick = options.onMenu || (() => {});

    // Container for floating buttons (not a visible bar)
    containerEl = document.createElement('div');
    containerEl.className = 'compact-floating-ui';
    containerEl.innerHTML = `
        <button class="compact-toggle-btn" title="Toggle tool rail">&equiv;</button>
        <button class="compact-exit-btn" title="Exit to files">&times;</button>
    `;

    toggleBtn = containerEl.querySelector('.compact-toggle-btn');
    exitBtn = containerEl.querySelector('.compact-exit-btn');

    // Event listeners
    toggleBtn.addEventListener('click', handleMenuClick);
    exitBtn.addEventListener('click', handleExitClick);

    return containerEl;
}

/**
 * Handle exit button click
 */
function handleExitClick() {
    if (onExitClick) {
        onExitClick();
    }
}

/**
 * Handle menu button click
 */
function handleMenuClick() {
    const isOpen = toggleBtn?.classList.contains('active');
    const newState = !isOpen;

    // Toggle active state on button
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', newState);
    }
    if (containerEl) {
        containerEl.classList.toggle('rail-open', newState);
    }

    // Persist state
    SessionState.setToolRailOpen(newState);

    if (onMenuClick) {
        onMenuClick();
    }
}

/**
 * Set menu button active state (and show/hide exit button)
 * @param {boolean} active
 */
export function setMenuActive(active) {
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', active);
    }
    if (containerEl) {
        containerEl.classList.toggle('rail-open', active);
    }
}

/**
 * Set the document title manually (no-op in floating UI mode)
 * @param {string} title
 * @param {boolean} modified
 */
export function setTitle(title, modified = false) {
    // No title display in floating UI mode
}

/**
 * Get the container element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the compact header
 */
export function destroy() {
    if (toggleBtn) {
        toggleBtn.removeEventListener('click', handleMenuClick);
    }
    if (exitBtn) {
        exitBtn.removeEventListener('click', handleExitClick);
    }

    if (containerEl && containerEl.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    toggleBtn = null;
    exitBtn = null;
}

export default {
    createCompactHeader,
    setTitle,
    setMenuActive,
    getElement,
    destroy
};

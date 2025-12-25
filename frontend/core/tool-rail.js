/**
 * Tool Rail Component for MRMD Compact Mode
 *
 * Vertical icon-only toolbar for accessing tools and panels.
 */

import * as SessionState from './session-state.js';

let railEl = null;
let activePanel = null;
let onPanelToggle = null;
let onClose = null;

// Tool definitions
// Note: 'format' panel removed - replaced by selection-triggered floating toolbar
// Per Jony's vision: "The text offers itself to become bold. You accept. Done."
const TOOLS = [
    { id: 'toggle', icon: '\u2261', title: 'Close', type: 'toggle' }, // ≡ toggle button at top
    { id: 'divider-top', type: 'divider' },
    { id: 'toc', icon: '\u2630', title: 'Contents', panelWidth: 'narrow' }, // ☰ table of contents
    { id: 'code', icon: '\u25A3', title: 'Code Cells', panelWidth: 'narrow' }, // ▣ code icon
    { id: 'source', icon: '</>', title: 'Source View', type: 'toggle-state' }, // Toggle source/rendered view
    { id: 'whitespace', icon: '¶', title: 'Show Whitespace', type: 'toggle-state' }, // Toggle whitespace visibility
    { id: 'divider1', type: 'divider' },
    { id: 'ai', icon: '?', title: 'AI Commands', panelWidth: 'medium' },
    { id: 'variables', icon: '\u03BB', title: 'Variables', panelWidth: 'narrow' },
    { id: 'terminal', icon: '\u25B6', title: 'Terminal', panelWidth: 'wide' },
    { id: 'files', icon: '\u2261', title: 'Quick Files', panelWidth: 'narrow' },
    { id: 'divider2', type: 'divider' },
    { id: 'spacer', type: 'spacer' },
    { id: 'more', icon: '\u2026', title: 'More', panelWidth: 'narrow' }
];

// State toggles (buttons that toggle state without opening panels)
let stateToggles = {
    source: false,
    whitespace: false
};
let onStateToggle = null;

/**
 * Create the tool rail element
 * @param {Object} options
 * @param {Function} options.onPanelToggle - Called when a tool is clicked
 * @param {Function} options.onClose - Called when rail is closed
 * @param {Function} options.onStateToggle - Called when a state toggle changes (id, isActive)
 * @returns {HTMLElement}
 */
export function createToolRail(options = {}) {
    onPanelToggle = options.onPanelToggle || (() => {});
    onClose = options.onClose || (() => {});
    onStateToggle = options.onStateToggle || (() => {});

    railEl = document.createElement('div');
    railEl.className = 'tool-rail';

    // Create tool buttons
    TOOLS.forEach(tool => {
        if (tool.type === 'divider') {
            const divider = document.createElement('div');
            divider.className = 'tool-rail-divider';
            railEl.appendChild(divider);
        } else if (tool.type === 'spacer') {
            const spacer = document.createElement('div');
            spacer.className = 'tool-rail-spacer';
            railEl.appendChild(spacer);
        } else if (tool.type === 'toggle') {
            const btn = document.createElement('button');
            btn.className = 'tool-rail-btn tool-rail-toggle';
            btn.dataset.tool = tool.id;
            btn.title = tool.title;
            btn.textContent = tool.icon;
            btn.addEventListener('click', () => {
                hide();
                SessionState.setToolRailOpen(false);
                if (onClose) onClose();
            });
            railEl.appendChild(btn);
        } else if (tool.type === 'toggle-state') {
            // State toggle button (toggles a state without opening a panel)
            const btn = document.createElement('button');
            btn.className = 'tool-rail-btn tool-rail-state-toggle';
            btn.dataset.tool = tool.id;
            btn.title = tool.title;
            btn.textContent = tool.icon;
            btn.addEventListener('click', () => handleStateToggle(tool));
            railEl.appendChild(btn);
        } else {
            const btn = document.createElement('button');
            btn.className = 'tool-rail-btn';
            btn.dataset.tool = tool.id;
            btn.dataset.panelWidth = tool.panelWidth;
            btn.title = tool.title;
            btn.textContent = tool.icon;

            btn.addEventListener('click', () => handleToolClick(tool));
            railEl.appendChild(btn);
        }
    });

    return railEl;
}

/**
 * Handle state toggle button click
 */
function handleStateToggle(tool) {
    // Toggle the state
    stateToggles[tool.id] = !stateToggles[tool.id];
    const isActive = stateToggles[tool.id];

    // Update button visual state
    const btn = railEl.querySelector(`[data-tool="${tool.id}"]`);
    if (btn) {
        btn.classList.toggle('active', isActive);
    }

    // Notify callback
    if (onStateToggle) {
        onStateToggle(tool.id, isActive);
    }
}

/**
 * Handle tool button click
 */
function handleToolClick(tool) {
    const wasActive = activePanel === tool.id;

    // Deactivate all buttons
    railEl.querySelectorAll('.tool-rail-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (wasActive) {
        // Close panel if clicking active tool
        activePanel = null;
        if (onPanelToggle) {
            onPanelToggle(null);
        }
    } else {
        // Activate new tool
        activePanel = tool.id;
        const btn = railEl.querySelector(`[data-tool="${tool.id}"]`);
        if (btn) {
            btn.classList.add('active');
        }
        if (onPanelToggle) {
            onPanelToggle(tool);
        }
    }
}

/**
 * Set the active panel programmatically
 * @param {string|null} panelId
 */
export function setActivePanel(panelId) {
    // Deactivate all buttons
    railEl?.querySelectorAll('.tool-rail-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (panelId) {
        const btn = railEl?.querySelector(`[data-tool="${panelId}"]`);
        if (btn) {
            btn.classList.add('active');
        }
        activePanel = panelId;
    } else {
        activePanel = null;
    }
}

/**
 * Get the currently active panel
 */
export function getActivePanel() {
    return activePanel;
}

/**
 * Close all panels
 */
export function closeAllPanels() {
    setActivePanel(null);
    if (onPanelToggle) {
        onPanelToggle(null);
    }
}

/**
 * Toggle a specific panel
 * @param {string} panelId
 */
export function togglePanel(panelId) {
    const tool = TOOLS.find(t => t.id === panelId);
    if (tool) {
        handleToolClick(tool);
    }
}

/**
 * Get state toggle value
 * @param {string} toggleId
 * @returns {boolean}
 */
export function getStateToggle(toggleId) {
    return stateToggles[toggleId] || false;
}

/**
 * Set state toggle value programmatically
 * @param {string} toggleId
 * @param {boolean} value
 */
export function setStateToggle(toggleId, value) {
    stateToggles[toggleId] = value;

    // Update button visual state
    const btn = railEl?.querySelector(`[data-tool="${toggleId}"]`);
    if (btn) {
        btn.classList.toggle('active', value);
    }
}

/**
 * Show the tool rail
 */
export function show() {
    if (railEl) {
        railEl.classList.add('open');
    }
}

/**
 * Hide the tool rail
 */
export function hide() {
    if (railEl) {
        railEl.classList.remove('open');
    }
}

/**
 * Toggle tool rail visibility
 */
export function toggle() {
    if (railEl) {
        railEl.classList.toggle('open');
    }
}

/**
 * Check if tool rail is visible
 */
export function isVisible() {
    return railEl?.classList.contains('open') || false;
}

/**
 * Get the rail element
 */
export function getElement() {
    return railEl;
}

/**
 * Destroy the tool rail
 */
export function destroy() {
    if (railEl && railEl.parentNode) {
        railEl.parentNode.removeChild(railEl);
    }
    railEl = null;
    activePanel = null;
}

export default {
    createToolRail,
    setActivePanel,
    getActivePanel,
    closeAllPanels,
    togglePanel,
    getStateToggle,
    setStateToggle,
    show,
    hide,
    toggle,
    isVisible,
    getElement,
    destroy
};

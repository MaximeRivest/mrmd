/**
 * Tool Panel Component for MRMD Compact Mode
 *
 * Base component for slide-out panels from the tool rail.
 */

let panelEl = null;
let backdropEl = null;
let contentEl = null;
let currentPanelId = null;
let onClose = null;

// Panel content generators
const panelContent = new Map();

/**
 * Create the tool panel container
 * @param {Object} options
 * @param {Function} options.onClose - Called when panel is closed
 * @returns {HTMLElement}
 */
export function createToolPanel(options = {}) {
    onClose = options.onClose || (() => {});

    // Create backdrop
    backdropEl = document.createElement('div');
    backdropEl.className = 'tool-panel-backdrop';
    backdropEl.addEventListener('click', close);

    // Create panel
    panelEl = document.createElement('div');
    panelEl.className = 'tool-panel narrow';
    panelEl.innerHTML = `
        <div class="tool-panel-header">
            <span class="tool-panel-title">Panel</span>
            <button class="tool-panel-close">&times;</button>
        </div>
        <div class="tool-panel-content"></div>
    `;

    contentEl = panelEl.querySelector('.tool-panel-content');
    const closeBtn = panelEl.querySelector('.tool-panel-close');
    closeBtn.addEventListener('click', close);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeydown);

    // Return both elements (caller should append both)
    return { panel: panelEl, backdrop: backdropEl };
}

/**
 * Handle keydown events
 */
function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen()) {
        close();
    }
}

/**
 * Register a panel content generator
 * @param {string} panelId
 * @param {Function|HTMLElement} content - Function that returns HTML or HTMLElement
 * @param {Object} options
 * @param {string} options.title - Panel title
 * @param {string} options.width - 'narrow', 'medium', or 'wide'
 */
export function registerPanel(panelId, content, options = {}) {
    panelContent.set(panelId, {
        content,
        title: options.title || 'Panel',
        width: options.width || 'narrow'
    });
}

/**
 * Open a panel by ID
 * @param {string} panelId
 */
export function open(panelId) {
    if (!panelEl || !backdropEl) return;

    const panelInfo = panelContent.get(panelId);
    if (!panelInfo) {
        console.warn(`[ToolPanel] Unknown panel: ${panelId}`);
        return;
    }

    currentPanelId = panelId;

    // Update title
    const titleEl = panelEl.querySelector('.tool-panel-title');
    if (titleEl) {
        titleEl.textContent = panelInfo.title;
    }

    // Update width
    panelEl.classList.remove('narrow', 'medium', 'wide');
    panelEl.classList.add(panelInfo.width);

    // Update content
    if (contentEl) {
        contentEl.innerHTML = '';

        let content = panelInfo.content;
        if (typeof content === 'function') {
            content = content();
        }

        if (typeof content === 'string') {
            contentEl.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            contentEl.appendChild(content);
        }
    }

    // Show panel and backdrop
    backdropEl.classList.add('visible');
    panelEl.classList.add('open');
}

/**
 * Close the panel
 */
export function close() {
    if (panelEl) {
        panelEl.classList.remove('open');
    }
    if (backdropEl) {
        backdropEl.classList.remove('visible');
    }

    currentPanelId = null;

    if (onClose) {
        onClose();
    }
}

/**
 * Toggle a panel
 * @param {string} panelId
 */
export function toggle(panelId) {
    if (currentPanelId === panelId) {
        close();
    } else {
        open(panelId);
    }
}

/**
 * Check if panel is open
 */
export function isOpen() {
    return panelEl?.classList.contains('open') || false;
}

/**
 * Get the current panel ID
 */
export function getCurrentPanel() {
    return currentPanelId;
}

/**
 * Get the panel element
 */
export function getElement() {
    return panelEl;
}

/**
 * Get the backdrop element
 */
export function getBackdropElement() {
    return backdropEl;
}

/**
 * Get the content element (for dynamic updates)
 */
export function getContentElement() {
    return contentEl;
}

/**
 * Destroy the tool panel
 */
export function destroy() {
    document.removeEventListener('keydown', handleKeydown);

    if (panelEl && panelEl.parentNode) {
        panelEl.parentNode.removeChild(panelEl);
    }
    if (backdropEl && backdropEl.parentNode) {
        backdropEl.parentNode.removeChild(backdropEl);
    }

    panelEl = null;
    backdropEl = null;
    contentEl = null;
    currentPanelId = null;
    panelContent.clear();
}

export default {
    createToolPanel,
    registerPanel,
    open,
    close,
    toggle,
    isOpen,
    getCurrentPanel,
    getElement,
    getBackdropElement,
    getContentElement,
    destroy
};

/**
 * File Navigator Component for MRMD Compact Mode
 *
 * Full-screen file browser that replaces the document canvas
 * when the user clicks the [x] exit button.
 */

import * as SessionState from './session-state.js';

let navigatorEl = null;
let contentEl = null;
let currentPath = null;
let fileBrowserRef = null;      // The file browser API
let fileBrowserContainerRef = null;  // The container element
let originalParent = null;      // Original parent of file browser
let onClose = null;

/**
 * Create the file navigator view
 * @param {Object} options
 * @param {Function} options.onClose - Called when navigator is closed
 * @param {Object} options.fileBrowser - Instance of file browser component
 * @param {HTMLElement} options.fileBrowserContainer - The DOM container of the file browser
 * @returns {HTMLElement}
 */
export function createFileNavigator(options = {}) {
    onClose = options.onClose || (() => {});
    fileBrowserRef = options.fileBrowser || null;
    fileBrowserContainerRef = options.fileBrowserContainer || null;

    navigatorEl = document.createElement('div');
    navigatorEl.className = 'file-navigator-view';
    navigatorEl.innerHTML = `
        <div class="file-navigator-header">
            <button class="file-navigator-back" title="Back to document">&larr;</button>
            <div class="file-navigator-path">~/</div>
            <button class="compact-menu-btn" title="Toggle tool rail">&equiv;</button>
        </div>
        <div class="file-navigator-content">
            <div class="file-navigator-browser"></div>
        </div>
        <div class="file-navigator-actions">
            <button class="primary">+ New Notebook</button>
            <button>Open Project...</button>
        </div>
    `;

    const backBtn = navigatorEl.querySelector('.file-navigator-back');
    contentEl = navigatorEl.querySelector('.file-navigator-browser');
    const pathEl = navigatorEl.querySelector('.file-navigator-path');

    // Event listeners
    backBtn.addEventListener('click', close);

    // Keyboard shortcuts
    navigatorEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            close();
        }
    });

    // Action buttons
    const newBtn = navigatorEl.querySelector('.file-navigator-actions .primary');
    const openBtn = navigatorEl.querySelector('.file-navigator-actions button:not(.primary)');

    newBtn.addEventListener('click', () => {
        // Emit event for creating new notebook
        SessionState.emit('create-notebook-requested', {});
        close();
    });

    openBtn.addEventListener('click', () => {
        // Emit event for opening project
        SessionState.emit('open-project-requested', {});
    });

    // Listen for project changes to update path
    SessionState.on('project-changed', ({ project }) => {
        if (project) {
            currentPath = project.path;
            pathEl.textContent = shortenPath(project.path);
        } else {
            currentPath = null;
            pathEl.textContent = '~/';
        }
    });

    // Initialize with current project
    const project = SessionState.getCurrentProject();
    if (project) {
        currentPath = project.path;
        pathEl.textContent = shortenPath(project.path);
    }

    return navigatorEl;
}

/**
 * Shorten a path for display
 */
function shortenPath(path) {
    if (!path) return '~/';

    // Replace home directory with ~
    const home = '/home/' + (path.split('/')[2] || '');
    if (path.startsWith(home)) {
        return '~' + path.slice(home.length);
    }
    return path;
}

/**
 * Move the file browser into the navigator
 */
function moveFileBrowserToNavigator() {
    if (!fileBrowserContainerRef || !contentEl) return;

    // Remember original parent
    if (fileBrowserContainerRef.parentNode) {
        originalParent = fileBrowserContainerRef.parentNode;
    }

    // Move into navigator
    contentEl.appendChild(fileBrowserContainerRef);

    // Focus the filter input
    if (fileBrowserRef && fileBrowserRef.focus) {
        setTimeout(() => fileBrowserRef.focus(), 100);
    }
}

/**
 * Return the file browser to its original location
 */
function returnFileBrowserToSidebar() {
    if (!originalParent || !fileBrowserContainerRef) return;

    originalParent.appendChild(fileBrowserContainerRef);
    originalParent = null;
}

/**
 * Open the file navigator
 */
export function open() {
    if (!navigatorEl) return;

    navigatorEl.classList.add('open');

    // Move file browser into navigator
    moveFileBrowserToNavigator();
}

/**
 * Close the file navigator
 */
export function close() {
    if (!navigatorEl) return;

    navigatorEl.classList.remove('open');

    // Return file browser to sidebar
    returnFileBrowserToSidebar();

    if (onClose) {
        onClose();
    }
}

/**
 * Check if navigator is open
 */
export function isOpen() {
    return navigatorEl?.classList.contains('open') || false;
}

/**
 * Toggle the file navigator
 */
export function toggle() {
    if (isOpen()) {
        close();
    } else {
        open();
    }
}

/**
 * Set the file browser reference and container
 * @param {Object} browser - File browser API instance
 * @param {HTMLElement} container - The DOM container element
 */
export function setFileBrowser(browser, container) {
    fileBrowserRef = browser;
    fileBrowserContainerRef = container;
}

/**
 * Get the navigator element
 */
export function getElement() {
    return navigatorEl;
}

/**
 * Destroy the file navigator
 */
export function destroy() {
    // Return file browser before destroying
    returnFileBrowserToSidebar();

    if (navigatorEl && navigatorEl.parentNode) {
        navigatorEl.parentNode.removeChild(navigatorEl);
    }
    navigatorEl = null;
    contentEl = null;
    fileBrowserRef = null;
    fileBrowserContainerRef = null;
    originalParent = null;
}

export default {
    createFileNavigator,
    open,
    close,
    isOpen,
    toggle,
    setFileBrowser,
    getElement,
    destroy
};

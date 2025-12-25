/**
 * Terminal Overlay for MRMD Compact Mode
 *
 * Floating, draggable terminal window (Kindle dictionary style).
 * Shares terminals with the sidebar terminal tabs system.
 */

import * as SessionState from './session-state.js';

let overlayEl = null;
let contentEl = null;
let terminalTabsRef = null;  // Reference to terminal tabs manager
let terminalInitialized = false;  // Whether terminal has been created
let originalParent = null;   // Where the terminal was before overlay
let isMinimized = false;
let isExpanded = false;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let position = { x: null, y: null };
let size = { width: null, height: null };

/**
 * Create the terminal overlay
 * @param {Object} options
 * @param {Object} options.terminalTabs - Terminal tabs manager instance
 * @param {Function} options.createTerminal - Legacy: Function to create terminal instance
 * @returns {HTMLElement}
 */
export function createTerminalOverlay(options = {}) {
    terminalTabsRef = options.terminalTabs || null;

    overlayEl = document.createElement('div');
    overlayEl.className = 'terminal-overlay';
    overlayEl.innerHTML = `
        <div class="terminal-overlay-header">
            <div class="terminal-overlay-title">
                <span>\u25B6</span>
                <span>Terminal</span>
                <span class="terminal-shell-name">zsh</span>
            </div>
            <div class="terminal-overlay-controls">
                <button class="terminal-overlay-btn minimize" title="Minimize">\u2212</button>
                <button class="terminal-overlay-btn expand" title="Expand">\u25A1</button>
                <button class="terminal-overlay-btn close" title="Close">\u00D7</button>
            </div>
        </div>
        <div class="terminal-overlay-content"></div>
        <div class="terminal-overlay-resize"></div>
    `;

    contentEl = overlayEl.querySelector('.terminal-overlay-content');
    const header = overlayEl.querySelector('.terminal-overlay-header');
    const minimizeBtn = overlayEl.querySelector('.minimize');
    const expandBtn = overlayEl.querySelector('.expand');
    const closeBtn = overlayEl.querySelector('.close');
    const resizeHandle = overlayEl.querySelector('.terminal-overlay-resize');

    // Drag functionality
    header.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', stopDrag);

    // Control buttons
    minimizeBtn.addEventListener('click', minimize);
    expandBtn.addEventListener('click', toggleExpand);
    closeBtn.addEventListener('click', close);

    // Resize functionality
    let isResizing = false;
    let resizeStart = { x: 0, y: 0, width: 0, height: 0 };

    resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isResizing = true;
        resizeStart = {
            x: e.clientX,
            y: e.clientY,
            width: overlayEl.offsetWidth,
            height: overlayEl.offsetHeight
        };
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const newWidth = resizeStart.width + (e.clientX - resizeStart.x);
        const newHeight = resizeStart.height + (e.clientY - resizeStart.y);

        if (newWidth >= 300) {
            overlayEl.style.width = newWidth + 'px';
            size.width = newWidth;
        }
        if (newHeight >= 150) {
            overlayEl.style.height = newHeight + 'px';
            size.height = newHeight;
        }

        // Resize terminal via terminal tabs manager
        if (terminalTabsRef?.fit) {
            terminalTabsRef.fit();
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
    });

    return overlayEl;
}

/**
 * Set the terminal tabs manager reference
 */
export function setTerminalTabs(tabs) {
    terminalTabsRef = tabs;
}

/**
 * Move the active terminal into the overlay
 */
async function moveTerminalToOverlay() {
    if (!terminalTabsRef || !contentEl) return;

    // Initialize terminal tabs if not done yet
    if (!terminalInitialized) {
        try {
            await terminalTabsRef.init();
            terminalInitialized = true;
        } catch (e) {
            console.error('[TerminalOverlay] Failed to init terminal tabs:', e);
            return;
        }
    }

    const entry = terminalTabsRef.getActiveTerminal();
    if (!entry) {
        // No terminal exists yet, create one
        try {
            await terminalTabsRef.createTerminal({ name: 'main' });
        } catch (e) {
            console.error('[TerminalOverlay] Failed to create terminal:', e);
            return;
        }
        // Recurse to get the newly created terminal
        return moveTerminalToOverlay();
    }

    // Find the terminal container element
    const termContainer = document.querySelector(`.terminal-instance[data-session="${entry.meta.session_id}"]`);
    if (termContainer && termContainer.parentNode) {
        // Remember where it was
        originalParent = termContainer.parentNode;

        // Move it to the overlay
        contentEl.innerHTML = '';
        contentEl.appendChild(termContainer);

        // Update shell name in header
        const shellName = overlayEl.querySelector('.terminal-shell-name');
        if (shellName) {
            shellName.textContent = entry.meta.name || 'shell';
        }

        // Fit the terminal to new container
        setTimeout(() => {
            terminalTabsRef.fit();
            terminalTabsRef.focus();
        }, 100);
    }
}

/**
 * Move the terminal back to its original location
 */
function returnTerminalToSidebar() {
    if (!originalParent || !contentEl.firstChild) return;

    const termContainer = contentEl.firstChild;
    originalParent.appendChild(termContainer);
    contentEl.innerHTML = '';
    originalParent = null;

    // Fit the terminal in sidebar
    if (terminalTabsRef) {
        setTimeout(() => terminalTabsRef.fit(), 100);
    }
}

/**
 * Start dragging
 */
function startDrag(e) {
    if (e.target.closest('.terminal-overlay-controls')) return;

    isDragging = true;
    overlayEl.style.transition = 'none';

    const rect = overlayEl.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    // Remove centering transform for manual positioning
    overlayEl.style.transform = 'none';
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.top = rect.top + 'px';
}

/**
 * Handle drag
 */
function drag(e) {
    if (!isDragging) return;

    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;

    // Constrain to viewport
    const maxX = window.innerWidth - overlayEl.offsetWidth;
    const maxY = window.innerHeight - overlayEl.offsetHeight;

    position.x = Math.max(0, Math.min(x, maxX));
    position.y = Math.max(0, Math.min(y, maxY));

    overlayEl.style.left = position.x + 'px';
    overlayEl.style.top = position.y + 'px';
    overlayEl.style.bottom = 'auto';
}

/**
 * Stop dragging
 */
function stopDrag() {
    if (isDragging) {
        isDragging = false;
        overlayEl.style.transition = '';
    }
}

/**
 * Open the terminal overlay
 */
export function open() {
    if (!overlayEl) return;

    isMinimized = false;
    overlayEl.classList.add('open');
    overlayEl.classList.remove('minimized');

    // Move terminal into overlay
    moveTerminalToOverlay();

    SessionState.emit('terminal-overlay-opened', {});
}

/**
 * Close the terminal overlay
 */
export function close() {
    if (!overlayEl) return;

    overlayEl.classList.remove('open');
    isMinimized = false;

    // Return terminal to sidebar
    returnTerminalToSidebar();

    SessionState.emit('terminal-overlay-closed', {});
}

/**
 * Minimize to status bar
 */
export function minimize() {
    if (!overlayEl) return;

    isMinimized = true;
    overlayEl.classList.add('minimized');
    overlayEl.classList.remove('open');

    SessionState.emit('terminal-overlay-minimized', {});
}

/**
 * Restore from minimized
 */
export function restore() {
    if (!overlayEl) return;

    isMinimized = false;
    overlayEl.classList.remove('minimized');
    overlayEl.classList.add('open');

    if (terminalTabsRef?.focus) {
        setTimeout(() => terminalTabsRef.focus(), 100);
    }

    SessionState.emit('terminal-overlay-restored', {});
}

/**
 * Toggle expanded state
 */
export function toggleExpand() {
    if (!overlayEl) return;

    isExpanded = !isExpanded;

    if (isExpanded) {
        overlayEl.style.height = '80vh';
    } else {
        overlayEl.style.height = size.height ? size.height + 'px' : '40vh';
    }

    // Resize terminal via terminal tabs manager
    if (terminalTabsRef?.fit) {
        setTimeout(() => terminalTabsRef.fit(), 100);
    }
}

/**
 * Toggle overlay visibility
 */
export function toggle() {
    if (isMinimized) {
        restore();
    } else if (overlayEl?.classList.contains('open')) {
        close();
    } else {
        open();
    }
}

/**
 * Check if overlay is open
 */
export function isOpen() {
    return overlayEl?.classList.contains('open') && !isMinimized;
}

/**
 * Check if overlay is minimized
 */
export function isOverlayMinimized() {
    return isMinimized;
}

/**
 * Attach an existing terminal instance (legacy - use setTerminalTabs instead)
 */
export function attachTerminal(terminal) {
    // Legacy function - now uses terminalTabsRef
    console.warn('[TerminalOverlay] attachTerminal is deprecated, use setTerminalTabs');
    if (contentEl && terminal?.element) {
        contentEl.innerHTML = '';
        contentEl.appendChild(terminal.element);
    }
}

/**
 * Get the active terminal entry from terminal tabs
 */
export function getTerminal() {
    return terminalTabsRef?.getActiveTerminal() || null;
}

/**
 * Get the overlay element
 */
export function getElement() {
    return overlayEl;
}

/**
 * Get the content element
 */
export function getContentElement() {
    return contentEl;
}

/**
 * Destroy the overlay
 */
export function destroy() {
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', stopDrag);

    if (overlayEl && overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
    }

    overlayEl = null;
    contentEl = null;
    terminalTabsRef = null;
    terminalInitialized = false;
    originalParent = null;
}

export default {
    createTerminalOverlay,
    setTerminalTabs,
    open,
    close,
    minimize,
    restore,
    toggleExpand,
    toggle,
    isOpen,
    isOverlayMinimized,
    attachTerminal,
    getTerminal,
    getElement,
    getContentElement,
    destroy
};

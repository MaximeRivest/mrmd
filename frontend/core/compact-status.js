/**
 * Compact Status Bar for MRMD Compact Mode
 *
 * Minimal status bar showing only essential information.
 */

import * as SessionState from './session-state.js';
import * as TerminalOverlay from './terminal-overlay.js';

let statusEl = null;
let kernelDot = null;
let serverDot = null;
let fileIndicator = null;
let lineNumber = null;
let branchName = null;
let terminalIndicator = null;

/**
 * Create the compact status bar
 * @returns {HTMLElement}
 */
export function createCompactStatus() {
    statusEl = document.createElement('div');
    statusEl.className = 'compact-status-bar';
    statusEl.innerHTML = `
        <div class="status-dots">
            <span class="status-dot kernel-dot offline" title="Kernel status"></span>
            <span class="status-dot server-dot offline" title="Server status"></span>
        </div>
        <span class="status-file-indicator" title="Current file"></span>
        <span class="status-divider">|</span>
        <span class="status-line">Ln <code class="line-num">1</code></span>
        <span class="status-branch"></span>
        <button class="status-terminal-btn" title="Restore terminal" style="display: none;">\u25B6 shell</button>
        <span class="compact-status-spacer"></span>
        <button class="status-more-btn" title="More options">\u2026</button>
        <button class="status-ai-btn" title="Run AI">AI \u25B8</button>
    `;

    kernelDot = statusEl.querySelector('.kernel-dot');
    serverDot = statusEl.querySelector('.server-dot');
    fileIndicator = statusEl.querySelector('.status-file-indicator');
    lineNumber = statusEl.querySelector('.line-num');
    branchName = statusEl.querySelector('.status-branch');
    terminalIndicator = statusEl.querySelector('.status-terminal-btn');

    // Listen for file changes
    SessionState.on('files-changed', updateFileIndicator);

    // Initialize with current file
    updateFileIndicator();

    // Event listeners
    const moreBtn = statusEl.querySelector('.status-more-btn');
    const aiBtn = statusEl.querySelector('.status-ai-btn');

    // Terminal indicator - click to restore minimized terminal
    terminalIndicator.addEventListener('click', () => {
        TerminalOverlay.restore();
    });

    moreBtn.addEventListener('click', () => {
        SessionState.emit('status-more-clicked', {});
    });

    aiBtn.addEventListener('click', () => {
        SessionState.emit('ai-run-clicked', {});
    });

    // Double-tap to toggle expanded status bar
    let lastTap = 0;
    statusEl.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;

        const now = Date.now();
        if (now - lastTap < 300) {
            toggleExpanded();
        }
        lastTap = now;
    });

    // Listen for status updates
    SessionState.on('kernel-status', updateKernelStatus);
    SessionState.on('server-status', updateServerStatus);

    // Listen for terminal overlay events
    SessionState.on('terminal-overlay-minimized', showTerminalIndicator);
    SessionState.on('terminal-overlay-restored', hideTerminalIndicator);
    SessionState.on('terminal-overlay-closed', hideTerminalIndicator);
    SessionState.on('terminal-overlay-opened', hideTerminalIndicator);

    return statusEl;
}

/**
 * Show terminal indicator in status bar
 */
function showTerminalIndicator() {
    if (terminalIndicator) {
        terminalIndicator.style.display = 'inline-flex';
    }
}

/**
 * Hide terminal indicator in status bar
 */
function hideTerminalIndicator() {
    if (terminalIndicator) {
        terminalIndicator.style.display = 'none';
    }
}

/**
 * Update kernel status dot
 */
function updateKernelStatus({ status }) {
    if (!kernelDot) return;

    kernelDot.classList.remove('ready', 'busy', 'error', 'offline');

    switch (status) {
        case 'ready':
        case 'idle':
            kernelDot.classList.add('ready');
            kernelDot.title = 'Kernel ready';
            break;
        case 'busy':
        case 'running':
            kernelDot.classList.add('busy');
            kernelDot.title = 'Kernel busy';
            break;
        case 'error':
        case 'dead':
            kernelDot.classList.add('error');
            kernelDot.title = 'Kernel error';
            break;
        default:
            kernelDot.classList.add('offline');
            kernelDot.title = 'Kernel offline';
    }
}

/**
 * Update server status dot
 */
function updateServerStatus({ status }) {
    if (!serverDot) return;

    serverDot.classList.remove('ready', 'busy', 'error', 'offline');

    switch (status) {
        case 'connected':
        case 'ready':
            serverDot.classList.add('ready');
            serverDot.title = 'Server connected';
            break;
        case 'connecting':
            serverDot.classList.add('busy');
            serverDot.title = 'Connecting...';
            break;
        case 'error':
        case 'disconnected':
            serverDot.classList.add('error');
            serverDot.title = 'Server disconnected';
            break;
        default:
            serverDot.classList.add('offline');
            serverDot.title = 'Server offline';
    }
}

/**
 * Update file indicator with current file name
 */
function updateFileIndicator() {
    if (!fileIndicator) return;

    const activeFile = SessionState.getActiveFilePath();
    const project = SessionState.getCurrentProject();

    if (activeFile) {
        const filename = activeFile.split('/').pop();
        const isModified = SessionState.getOpenFiles()?.get(activeFile)?.modified;

        // Show project name and filename
        let display = filename;
        if (project) {
            display = `${project.name} / ${filename}`;
        }

        fileIndicator.textContent = display + (isModified ? ' ●' : '');
        fileIndicator.title = activeFile;
    } else {
        fileIndicator.textContent = '';
        fileIndicator.title = 'No file open';
    }
}

/**
 * Update line number
 */
export function setLineNumber(line) {
    if (lineNumber) {
        lineNumber.textContent = line;
    }
}

/**
 * Update branch name
 */
export function setBranch(branch) {
    if (branchName) {
        branchName.textContent = branch || '';
    }
}

/**
 * Set kernel status
 */
export function setKernelStatus(status) {
    updateKernelStatus({ status });
}

/**
 * Set server status
 */
export function setServerStatus(status) {
    updateServerStatus({ status });
}

/**
 * Toggle expanded status bar
 */
function toggleExpanded() {
    const container = document.querySelector('.container');
    if (container) {
        container.classList.toggle('status-expanded');
        SessionState.setStatusBarExpanded(container.classList.contains('status-expanded'));
    }
}

/**
 * Get the status bar element
 */
export function getElement() {
    return statusEl;
}

/**
 * Destroy the status bar
 */
export function destroy() {
    SessionState.off('kernel-status', updateKernelStatus);
    SessionState.off('server-status', updateServerStatus);
    SessionState.off('files-changed', updateFileIndicator);

    if (statusEl && statusEl.parentNode) {
        statusEl.parentNode.removeChild(statusEl);
    }

    statusEl = null;
    kernelDot = null;
    serverDot = null;
    fileIndicator = null;
    lineNumber = null;
    branchName = null;
}

export default {
    createCompactStatus,
    setLineNumber,
    setBranch,
    setKernelStatus,
    setServerStatus,
    getElement,
    destroy
};

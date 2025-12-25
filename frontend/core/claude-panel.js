/**
 * Claude Panel - Global Claude Code Terminal
 *
 * A persistent Claude terminal panel that works across all views
 * (home screen, compact mode, document view).
 *
 * Sessions persist across page refreshes - we reconnect to running
 * server-side PTY sessions on load.
 */

import * as SessionState from './session-state.js';
import { createClaudeTerminal } from './claude-terminal.js';

let containerEl = null;
let initialized = false;

// Multi-terminal state
const terminals = new Map(); // id -> { terminal, element, sessionId }
let activeTerminalId = null;
let terminalCounter = 0;
let isExpanded = false;
let isRestoring = false; // Prevent duplicate restoration

/**
 * Create the Claude panel element
 * @param {Object} options
 * @returns {HTMLElement}
 */
export function createClaudePanel(options = {}) {
    if (containerEl) return containerEl;

    containerEl = document.createElement('div');
    containerEl.className = 'claude-panel';
    containerEl.id = 'claude-panel';
    containerEl.innerHTML = `
        <div class="claude-panel-terminal">
            <div class="claude-panel-header">
                <div class="claude-panel-tabs" id="claude-panel-tabs">
                    <!-- Tabs render here -->
                </div>
                <div class="claude-panel-controls">
                    <button class="claude-panel-btn add" title="New conversation (Ctrl+T)">+</button>
                    <button class="claude-panel-btn minimize" title="Minimize (Ctrl+M)">−</button>
                    <button class="claude-panel-btn maximize" title="Maximize (Ctrl+Shift+M)">⤢</button>
                    <button class="claude-panel-btn close" title="Close tab (Ctrl+W)">×</button>
                </div>
            </div>
            <div class="claude-panel-body">
                <!-- Terminal instances render here -->
            </div>
        </div>
        <button class="claude-panel-trigger" id="claude-panel-trigger" title="Claude (Ctrl+K)">
            <span class="trigger-label">Assistant</span>
            <span class="trigger-badge" style="display:none"></span>
        </button>
    `;

    // Wire up event listeners
    setupEventListeners();

    // Listen for keyboard shortcuts globally
    document.addEventListener('keydown', handleKeydown);

    initialized = true;

    // Restore any existing sessions from server
    restoreExistingSessions();

    return containerEl;
}

/**
 * Set up DOM event listeners
 */
function setupEventListeners() {
    const trigger = containerEl.querySelector('.claude-panel-trigger');
    const addBtn = containerEl.querySelector('.claude-panel-btn.add');
    const minimizeBtn = containerEl.querySelector('.claude-panel-btn.minimize');
    const maximizeBtn = containerEl.querySelector('.claude-panel-btn.maximize');
    const closeBtn = containerEl.querySelector('.claude-panel-btn.close');
    const header = containerEl.querySelector('.claude-panel-header');

    trigger?.addEventListener('click', handleTriggerClick);
    addBtn?.addEventListener('click', addNewTerminal);
    minimizeBtn?.addEventListener('click', minimize);
    maximizeBtn?.addEventListener('click', toggleMaximize);
    closeBtn?.addEventListener('click', closeActiveTerminal);
    header?.addEventListener('dblclick', toggleMaximize);
}

/**
 * Handle trigger button click
 */
function handleTriggerClick() {
    if (terminals.size > 0) {
        // Has sessions, restore
        expand();
    } else {
        // No sessions, create new
        addNewTerminal();
    }
}

/**
 * Restore existing Claude sessions from the server.
 * Called on page load to reconnect to any running terminals.
 * If no sessions exist, pre-starts one for instant availability.
 */
async function restoreExistingSessions() {
    if (isRestoring) return;
    isRestoring = true;

    try {
        const response = await fetch('/api/terminals');
        if (!response.ok) {
            // Server not available yet, try pre-starting later
            setTimeout(preStartSession, 2000);
            return;
        }

        const data = await response.json();
        const claudeTerminals = (data.terminals || []).filter(t =>
            t.command === 'claude --dangerously-skip-permissions' ||
            t.name?.startsWith('claude')
        );

        if (claudeTerminals.length === 0) {
            // No existing sessions - pre-start one in background
            console.log('[ClaudePanel] No existing sessions, pre-starting one...');
            await preStartSession();
            return;
        }

        console.log(`[ClaudePanel] Restoring ${claudeTerminals.length} session(s)`);

        for (const meta of claudeTerminals) {
            await reconnectToSession(meta.session_id, meta.name);
        }

        updateTrigger();
    } catch (err) {
        console.error('[ClaudePanel] Failed to restore sessions:', err);
        // Try pre-starting anyway after a delay
        setTimeout(preStartSession, 2000);
    } finally {
        isRestoring = false;
    }
}

/**
 * Pre-start a Claude session in the background.
 * This makes opening the panel instant since Claude is already running.
 */
async function preStartSession() {
    // Don't pre-start if we already have sessions
    if (terminals.size > 0) return;

    const body = containerEl?.querySelector('.claude-panel-body');
    if (!body) return;

    console.log('[ClaudePanel] Pre-starting Claude session...');

    // Generate unique ID
    terminalCounter++;
    const id = `claude-${terminalCounter}`;

    // Create terminal container element (hidden)
    const termEl = document.createElement('div');
    termEl.className = 'claude-panel-instance';
    termEl.dataset.id = id;
    termEl.style.display = 'none'; // Hidden until user expands
    body.appendChild(termEl);

    // Wait for layout
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get current project for cwd
    const currentProject = SessionState.getCurrentProject();

    // Create terminal
    const terminal = createClaudeTerminal(termEl, {
        cwd: currentProject?.path,
        onReady: () => {
            console.log('[ClaudePanel] Pre-started session ready');
        },
        onExit: (reason) => {
            console.log(`[ClaudePanel] Pre-started terminal ${id} exited:`, reason);
        },
    });

    // Store terminal
    terminals.set(id, { terminal, element: termEl });
    activeTerminalId = id;

    // Update trigger to show badge
    updateTrigger();
    renderTabs();

    // Start terminal in background
    try {
        await terminal.start();
    } catch (err) {
        console.error('[ClaudePanel] Pre-start failed:', err);
        // Clean up on failure
        terminals.delete(id);
        termEl.remove();
        activeTerminalId = null;
        updateTrigger();
    }
}

/**
 * Reconnect to an existing server-side PTY session.
 */
async function reconnectToSession(sessionId, name) {
    const body = containerEl?.querySelector('.claude-panel-body');
    if (!body) return;

    // Generate local ID
    terminalCounter++;
    const id = `claude-${terminalCounter}`;

    // Create terminal container element
    const termEl = document.createElement('div');
    termEl.className = 'claude-panel-instance';
    termEl.dataset.id = id;
    body.appendChild(termEl);

    // Wait for layout
    await new Promise(resolve => setTimeout(resolve, 50));

    // Create terminal that reconnects to existing session
    const terminal = createClaudeTerminal(termEl, {
        sessionId: sessionId, // Pass existing session ID
        onReady: () => {
            terminal?.fit();
        },
        onExit: (reason) => {
            console.log(`[ClaudePanel] Terminal ${id} exited:`, reason);
        },
    });

    // Store terminal with session ID
    terminals.set(id, { terminal, element: termEl, sessionId });

    // Make first restored terminal active (don't expand - stay minimized)
    if (terminals.size === 1) {
        activeTerminalId = id;
    }

    // Update UI
    renderTabs();

    // Connect to existing session (don't start new one)
    await terminal.reconnect(sessionId);
}

/**
 * Add a new Claude terminal tab
 */
export async function addNewTerminal() {
    const body = containerEl?.querySelector('.claude-panel-body');
    if (!body) return;

    // Expand if not already
    if (!isExpanded) {
        expand();
    }

    // Generate unique ID
    terminalCounter++;
    const id = `claude-${terminalCounter}`;

    // Create terminal container element
    const termEl = document.createElement('div');
    termEl.className = 'claude-panel-instance';
    termEl.dataset.id = id;
    body.appendChild(termEl);

    // Wait for layout
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get current project for cwd
    const currentProject = SessionState.getCurrentProject();

    // Create terminal
    const terminal = createClaudeTerminal(termEl, {
        cwd: currentProject?.path,
        onReady: () => {
            terminal?.focus();
            terminal?.fit();
        },
        onExit: (reason) => {
            console.log(`[ClaudePanel] Terminal ${id} exited:`, reason);
        },
    });

    // Store terminal
    terminals.set(id, { terminal, element: termEl });

    // Switch to new terminal
    switchToTerminal(id);

    // Update UI
    renderTabs();
    updateTrigger();

    // Start terminal
    await terminal.start();
}

/**
 * Switch to a specific terminal
 */
function switchToTerminal(id) {
    terminals.forEach((entry, termId) => {
        // Show active, hide others
        entry.element.style.display = termId === id ? 'block' : 'none';
    });

    activeTerminalId = id;

    const entry = terminals.get(id);
    if (entry) {
        setTimeout(() => {
            entry.terminal.focus();
            entry.terminal.fit();
        }, 10);
    }

    renderTabs();
}

/**
 * Close a specific terminal
 */
async function closeTerminal(id) {
    const entry = terminals.get(id);
    if (!entry) return;

    await entry.terminal.destroy();
    entry.element.remove();
    terminals.delete(id);

    if (activeTerminalId === id) {
        const remaining = Array.from(terminals.keys());
        if (remaining.length > 0) {
            switchToTerminal(remaining[remaining.length - 1]);
        } else {
            minimize();
        }
    }

    renderTabs();
    updateTrigger();
}

/**
 * Close the active terminal
 */
async function closeActiveTerminal() {
    if (activeTerminalId) {
        await closeTerminal(activeTerminalId);
    }
}

/**
 * Expand the panel
 */
export function expand() {
    if (!containerEl) return;
    containerEl.classList.add('expanded');
    containerEl.classList.remove('minimized');
    isExpanded = true;

    // Make sure active terminal is visible (may have been pre-started hidden)
    const entry = terminals.get(activeTerminalId);
    if (entry) {
        entry.element.style.display = 'block';
    }

    // Refit and focus active terminal
    setTimeout(() => {
        entry?.terminal?.fit();
        entry?.terminal?.focus();
    }, 50);
}

/**
 * Minimize the panel
 */
export function minimize() {
    if (!containerEl) return;
    containerEl.classList.remove('expanded');
    containerEl.classList.remove('maximized');
    containerEl.classList.add('minimized');
    isExpanded = false;
    updateTrigger();
}

/**
 * Toggle maximize state
 */
function toggleMaximize() {
    if (!containerEl) return;
    containerEl.classList.toggle('maximized');

    setTimeout(() => {
        const entry = terminals.get(activeTerminalId);
        entry?.terminal?.fit();
    }, 50);
}

/**
 * Render tab bar
 */
function renderTabs() {
    const tabsContainer = containerEl?.querySelector('#claude-panel-tabs');
    if (!tabsContainer) return;

    if (terminals.size === 0) {
        tabsContainer.innerHTML = '';
        return;
    }

    tabsContainer.innerHTML = Array.from(terminals.keys()).map((id, index) => {
        const isActive = id === activeTerminalId;
        return `
            <div class="claude-panel-tab ${isActive ? 'active' : ''}" data-id="${id}">
                <span class="tab-name">~ ${index + 1}</span>
                <button class="tab-close" data-id="${id}" title="Close">×</button>
            </div>
        `;
    }).join('');

    // Add click handlers
    tabsContainer.querySelectorAll('.claude-panel-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchToTerminal(tab.dataset.id);
            }
        });
    });

    tabsContainer.querySelectorAll('.tab-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTerminal(btn.dataset.id);
        });
    });
}

/**
 * Update trigger button state
 */
function updateTrigger() {
    const trigger = containerEl?.querySelector('.claude-panel-trigger');
    const badge = containerEl?.querySelector('.trigger-badge');
    if (!trigger || !badge) return;

    if (terminals.size > 0) {
        trigger.classList.add('has-sessions');
        badge.style.display = '';
        badge.textContent = terminals.size;
    } else {
        trigger.classList.remove('has-sessions');
        badge.style.display = 'none';
    }
}

/**
 * Handle global keyboard shortcuts
 */
function handleKeydown(e) {
    const isMaximized = containerEl?.classList.contains('maximized');

    // Ctrl+K - open/restore/focus
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        // Don't override if in an input field (except terminal)
        if (document.activeElement?.tagName === 'INPUT' ||
            document.activeElement?.tagName === 'TEXTAREA') {
            return;
        }
        e.preventDefault();
        if (isExpanded) {
            const entry = terminals.get(activeTerminalId);
            entry?.terminal?.focus();
        } else if (terminals.size > 0) {
            expand();
        } else {
            addNewTerminal();
        }
    }

    // Ctrl+T - new tab (only when panel is visible)
    if ((e.metaKey || e.ctrlKey) && e.key === 't' && isExpanded) {
        e.preventDefault();
        addNewTerminal();
    }

    // Ctrl+W - close tab (only when panel is visible)
    if ((e.metaKey || e.ctrlKey) && e.key === 'w' && isExpanded) {
        e.preventDefault();
        closeActiveTerminal();
    }

    // Ctrl+M - minimize
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'm' && isExpanded) {
        e.preventDefault();
        minimize();
    }

    // Ctrl+Shift+M - maximize
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'M' && terminals.size > 0) {
        e.preventDefault();
        if (!isExpanded) expand();
        toggleMaximize();
    }

    // Escape - minimize
    if (e.key === 'Escape' && isExpanded && !isMaximized) {
        e.preventDefault();
        minimize();
    }
}

/**
 * Check if panel is expanded
 */
export function isVisible() {
    return isExpanded;
}

/**
 * Check if has active sessions
 */
export function hasSessions() {
    return terminals.size > 0;
}

/**
 * Get the container element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the panel
 */
export async function destroy() {
    document.removeEventListener('keydown', handleKeydown);

    // Destroy all terminals
    for (const [id, entry] of terminals) {
        await entry.terminal.destroy();
        entry.element.remove();
    }
    terminals.clear();
    activeTerminalId = null;
    isExpanded = false;

    if (containerEl?.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    initialized = false;
}

export default {
    createClaudePanel,
    addNewTerminal,
    expand,
    minimize,
    isVisible,
    hasSessions,
    getElement,
    destroy
};

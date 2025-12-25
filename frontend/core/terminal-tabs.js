/**
 * Multi-Terminal Tab Manager
 *
 * Manages multiple terminal sessions with a tab bar interface.
 * Features:
 * - Multiple named terminal tabs
 * - Persistent sessions that survive page navigations
 * - Reconnection to existing server-side terminals
 * - Tab creation, switching, renaming, and closing
 * - Sticky scroll (auto-scroll only when at bottom)
 * - Robust visibility handling for resize
 * - Coalesced resize events to prevent flickering
 */

import { getCurrentProject, getCurrentVenv } from './session-state.js';
import {
    TerminalSearch,
    TerminalCopy,
    TerminalHyperlinks,
    createSearchUI,
    injectSearchStyles,
} from './terminal-features.js';
import { escapeHtml } from './utils.js';

/**
 * Get terminal theme based on system color scheme preference.
 */
function getTerminalTheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (isDark) {
        return {
            background: '#1a1a1a',
            foreground: '#d4d4d4',
            cursor: '#aeafad',
            cursorAccent: '#000000',
            selectionBackground: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5',
        };
    } else {
        return {
            background: '#fafafa',
            foreground: '#2c2c2c',
            cursor: '#333333',
            cursorAccent: '#ffffff',
            selectionBackground: '#b5d5ff',
            black: '#000000',
            red: '#c41a16',
            green: '#007400',
            yellow: '#826b28',
            blue: '#0000ff',
            magenta: '#a90d91',
            cyan: '#3e8a89',
            white: '#c5c5c5',
            brightBlack: '#808080',
            brightRed: '#c41a16',
            brightGreen: '#007400',
            brightYellow: '#826b28',
            brightBlue: '#0000ff',
            brightMagenta: '#a90d91',
            brightCyan: '#3e8a89',
            brightWhite: '#ffffff',
        };
    }
}

/**
 * Create a terminal tab manager.
 *
 * @param {HTMLElement} container - Container for the terminal panel
 * @param {Object} options - Configuration options
 * @param {Function} options.onTerminalChange - Called when active terminal changes
 * @returns {Object} Terminal manager API
 */
export function createTerminalTabs(container, options = {}) {
    const state = {
        terminals: new Map(), // session_id -> {terminal, ws, fitAddon, meta, ...}
        activeSession: null,
        tabBar: null,
        contentArea: null,
        initialized: false,
    };

    // ==================== DOM Setup ====================

    function createStructure() {
        container.innerHTML = `
            <div class="terminal-tabs-bar">
                <div class="terminal-tabs-list"></div>
                <button class="terminal-tab-add" title="New terminal">+</button>
            </div>
            <div class="terminal-tabs-content"></div>
        `;

        state.tabBar = container.querySelector('.terminal-tabs-list');
        state.contentArea = container.querySelector('.terminal-tabs-content');

        // Add terminal button
        container.querySelector('.terminal-tab-add').addEventListener('click', () => {
            createTerminal();
        });
    }

    // ==================== Visibility & Resize Utilities ====================

    /**
     * Wait for container to be visible and have dimensions.
     * Uses requestAnimationFrame loop instead of arbitrary timeout.
     * @param {HTMLElement} element
     * @param {number} maxAttempts - Maximum frames to wait (default 60 = ~1 second)
     * @returns {Promise<boolean>} - true if visible, false if timed out
     */
    function waitForVisible(element, maxAttempts = 60) {
        return new Promise((resolve) => {
            let attempts = 0;
            const check = () => {
                attempts++;
                if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                    resolve(true);
                } else if (attempts >= maxAttempts) {
                    resolve(false);
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });
    }

    /**
     * Get proposed dimensions from fit addon, handling errors gracefully.
     * @param {Object} fitAddon
     * @returns {{cols: number, rows: number} | null}
     */
    function getProposedDimensions(fitAddon) {
        try {
            return fitAddon.proposeDimensions();
        } catch {
            return null;
        }
    }

    /**
     * Safely fit terminal and send resize to PTY.
     * Only sends resize if dimensions actually changed.
     * @param {Object} entry - Terminal entry from state.terminals
     * @param {boolean} force - Force resize even if dimensions match
     */
    function fitAndResize(entry, force = false) {
        if (!entry || !entry.terminal || !entry.fitAddon) return;

        const oldCols = entry.terminal.cols;
        const oldRows = entry.terminal.rows;

        // Check proposed dimensions before fitting
        const proposed = getProposedDimensions(entry.fitAddon);
        if (!proposed) return;

        // Only fit if dimensions would change or forced
        if (!force && proposed.cols === oldCols && proposed.rows === oldRows) {
            return;
        }

        try {
            entry.fitAddon.fit();
        } catch (e) {
            console.warn('[TerminalTabs] Fit failed:', e);
            return;
        }

        const newCols = entry.terminal.cols;
        const newRows = entry.terminal.rows;

        // Send resize to PTY only if dimensions actually changed
        if (force || newCols !== oldCols || newRows !== oldRows) {
            if (entry.ws?.readyState === WebSocket.OPEN) {
                entry.ws.send(JSON.stringify({
                    type: 'resize',
                    cols: newCols,
                    rows: newRows,
                }));
            }
        }
    }

    // ==================== Terminal Management ====================

    /**
     * Create a new terminal session.
     * @param {Object} options - Terminal options
     * @param {string} options.name - Display name
     * @param {string} options.sessionId - Custom session ID (optional)
     * @returns {Promise<string>} The session ID
     */
    async function createTerminal(opts = {}) {
        const project = getCurrentProject();
        const venv = getCurrentVenv();

        // Create terminal on server first
        const response = await fetch('/api/terminals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: opts.name,
                cwd: project?.path,
                venv: venv,
                file_path: opts.filePath,
            }),
        });
        const meta = await response.json();

        // Create xterm instance
        const terminalInstance = createXtermInstance(meta.session_id);
        state.terminals.set(meta.session_id, {
            ...terminalInstance,
            meta,
            isAtBottom: true, // Sticky scroll state
            userScrolledAway: false, // User explicitly scrolled up
            lastCols: 0,
            lastRows: 0,
        });

        // Create tab
        createTab(meta);

        // Connect to PTY
        await connectTerminal(meta.session_id);

        // Switch to new terminal
        switchTo(meta.session_id);

        return meta.session_id;
    }

    /**
     * Reconnect to existing server terminals on page load.
     */
    async function reconnectAll() {
        try {
            const response = await fetch('/api/terminals');
            const data = await response.json();

            for (const meta of data.terminals || []) {
                // Create xterm instance
                const terminalInstance = createXtermInstance(meta.session_id);
                state.terminals.set(meta.session_id, {
                    ...terminalInstance,
                    meta,
                    isAtBottom: true,
                    userScrolledAway: false,
                    lastCols: 0,
                    lastRows: 0,
                });

                // Create tab
                createTab(meta);

                // Connect to PTY (will replay buffer)
                await connectTerminal(meta.session_id);
            }

            // Switch to first terminal if any exist
            if (data.terminals?.length > 0) {
                switchTo(data.terminals[0].session_id);
            }
        } catch (err) {
            console.error('[TerminalTabs] Failed to reconnect:', err);
        }
    }

    function createXtermInstance(sessionId) {
        // Inject search styles on first terminal
        injectSearchStyles();

        // Create container
        const termContainer = document.createElement('div');
        termContainer.className = 'terminal-instance';
        termContainer.dataset.session = sessionId;
        state.contentArea.appendChild(termContainer);

        // Create terminal with optimized settings
        const terminal = new window.Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: '"SF Mono", "Fira Code", "Monaco", "Inconsolata", monospace',
            // Scroll settings
            scrollback: 10000,
            scrollOnUserInput: true,
            fastScrollModifier: 'alt',
            // Reduce flickering - no smooth scroll
            smoothScrollDuration: 0,
            // Enable proper line handling for Claude Code output
            convertEol: true,
            // Allow proposed API features (needed for some addons)
            allowProposedApi: true,
            theme: getTerminalTheme(),
        });

        // Add fit addon
        const fitAddon = new window.FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);

        // Add web links addon if available
        if (window.WebLinksAddon?.WebLinksAddon) {
            const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
            terminal.loadAddon(webLinksAddon);
        }

        // Open terminal
        terminal.open(termContainer);

        // Add WebGL addon for smoother rendering (must be after open())
        let webglAddon = null;
        if (window.WebglAddon?.WebglAddon) {
            try {
                webglAddon = new window.WebglAddon.WebglAddon();
                // Handle WebGL context loss gracefully
                webglAddon.onContextLoss(() => {
                    console.warn('[TerminalTabs] WebGL context lost, falling back to canvas');
                    webglAddon?.dispose();
                });
                terminal.loadAddon(webglAddon);
                console.log('[TerminalTabs] WebGL renderer enabled');
            } catch (e) {
                console.warn('[TerminalTabs] WebGL not available, using canvas renderer:', e.message);
            }
        }

        // Create scroll-to-bottom button
        const scrollButton = document.createElement('button');
        scrollButton.className = 'terminal-scroll-bottom';
        scrollButton.innerHTML = '↓';
        scrollButton.title = 'Scroll to bottom (following output)';
        scrollButton.style.display = 'none'; // Hidden by default
        termContainer.appendChild(scrollButton);

        // Create search UI
        const searchUI = createSearchUI(terminal, termContainer);

        // Create copy manager
        const copyManager = new TerminalCopy(terminal);

        // Create hyperlink manager
        const hyperlinkManager = new TerminalHyperlinks(terminal, termContainer);

        // Set up keyboard shortcuts
        terminal.attachCustomKeyEventHandler((e) => {
            // Ctrl+F: Open search
            if (e.ctrlKey && e.key === 'f' && e.type === 'keydown') {
                searchUI.show();
                return false; // Prevent default
            }

            // Ctrl+Shift+C: Copy with formatting
            if (e.ctrlKey && e.shiftKey && e.key === 'C' && e.type === 'keydown') {
                copyManager.copyToClipboard('html');
                return false;
            }

            // Ctrl+C: Normal copy when there's a selection
            if (e.ctrlKey && e.key === 'c' && e.type === 'keydown') {
                if (terminal.hasSelection()) {
                    copyManager.copyToClipboard('text');
                    return false;
                }
                // Let Ctrl+C pass through if no selection (for SIGINT)
            }

            // Escape: Close search if open
            if (e.key === 'Escape' && e.type === 'keydown') {
                if (termContainer.querySelector('.terminal-search-bar')?.style.display !== 'none') {
                    searchUI.hide();
                    return false;
                }
            }

            return true; // Let other keys pass through
        });

        return {
            terminal,
            fitAddon,
            container: termContainer,
            scrollButton,
            searchUI,
            copyManager,
            hyperlinkManager,
        };
    }

    /**
     * Update the visibility of the scroll-to-bottom button.
     */
    function updateScrollButtonVisibility(entry) {
        if (!entry || !entry.scrollButton) return;

        // Show button when user has scrolled away from bottom
        if (entry.userScrolledAway) {
            entry.scrollButton.style.display = 'flex';
        } else {
            entry.scrollButton.style.display = 'none';
        }
    }

    async function connectTerminal(sessionId) {
        const entry = state.terminals.get(sessionId);
        if (!entry) return;

        const { terminal, fitAddon, meta, container } = entry;

        // Reconnection state
        let reconnectAttempts = 0;
        const maxReconnectAttempts = 10;
        const baseReconnectDelay = 1000; // 1 second

        function buildWebSocketUrl() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const params = new URLSearchParams({ session_id: sessionId });
            if (meta.cwd) params.set('cwd', meta.cwd);
            if (meta.venv) params.set('venv', meta.venv);
            return `${protocol}//${window.location.host}/api/pty?${params.toString()}`;
        }

        function connect() {
            // Don't reconnect if terminal was closed
            if (!state.terminals.has(sessionId)) {
                return;
            }

            const ws = new WebSocket(buildWebSocketUrl());

            ws.onopen = async () => {
                console.log(`[TerminalTabs] Connected to ${sessionId}`);
                reconnectAttempts = 0; // Reset on successful connection
                entry.ws = ws;

                // Wait for visibility then fit and send size
                const visible = await waitForVisible(container);
                if (visible) {
                    fitAndResize(entry, true);
                }

                // Re-fit after a short delay to handle buffer replay
                // The server sends the buffer immediately after connection
                setTimeout(() => {
                    fitAndResize(entry, true);
                    terminal.refresh(0, terminal.rows - 1);
                }, 100);
            };

            ws.onmessage = (event) => {
                // Only auto-scroll if user hasn't manually scrolled away
                // Use the flag that's set by user interaction, not computed on each message
                const shouldAutoScroll = entry.isAtBottom && !entry.userScrolledAway;
                terminal.write(event.data, () => {
                    if (shouldAutoScroll) {
                        terminal.scrollToBottom();
                    }
                    // Update scroll-to-bottom button visibility
                    updateScrollButtonVisibility(entry);
                });
            };

            ws.onerror = (err) => {
                console.error(`[TerminalTabs] Error on ${sessionId}:`, err);
            };

            ws.onclose = (event) => {
                console.log(`[TerminalTabs] Disconnected from ${sessionId} (code: ${event.code})`);
                entry.ws = null;

                // Don't reconnect if terminal was intentionally closed or removed
                if (!state.terminals.has(sessionId)) {
                    return;
                }

                // Reconnect with exponential backoff
                if (reconnectAttempts < maxReconnectAttempts) {
                    reconnectAttempts++;
                    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
                    console.log(`[TerminalTabs] Reconnecting to ${sessionId} in ${delay}ms (attempt ${reconnectAttempts})`);

                    entry.reconnectTimeout = setTimeout(() => {
                        connect();
                    }, delay);
                } else {
                    console.error(`[TerminalTabs] Max reconnect attempts reached for ${sessionId}`);
                    // Show disconnected state in terminal
                    terminal.write('\r\n\x1b[31m[Disconnected - refresh page to reconnect]\x1b[0m\r\n');
                }
            };

            // Store WebSocket reference
            entry.ws = ws;
        }

        // Sticky scroll: track if user scrolled away from bottom
        // We use two flags:
        // - isAtBottom: computed position (can change as content is added)
        // - userScrolledAway: explicit user action to scroll up (sticky until they scroll back)
        let lastScrollDirection = 0; // -1 = up, 1 = down, 0 = none
        let lastViewportY = 0;

        terminal.onScroll(() => {
            const buffer = terminal.buffer.active;
            const viewportY = buffer.viewportY;
            const maxScroll = buffer.baseY;

            // Detect scroll direction
            const scrollDelta = viewportY - lastViewportY;
            if (scrollDelta < 0) {
                lastScrollDirection = -1; // scrolling up
            } else if (scrollDelta > 0) {
                lastScrollDirection = 1; // scrolling down
            }
            lastViewportY = viewportY;

            // Check if at bottom (with small tolerance for rounding)
            const atBottom = viewportY >= maxScroll - 1;
            entry.isAtBottom = atBottom;

            // If user scrolled UP and is not at bottom, mark as scrolled away
            // This flag stays true until user scrolls back to bottom or clicks the button
            if (lastScrollDirection === -1 && !atBottom) {
                entry.userScrolledAway = true;
            }

            // If user scrolled to bottom, clear the scrolled away flag
            if (atBottom && lastScrollDirection === 1) {
                entry.userScrolledAway = false;
            }

            // Update button visibility
            updateScrollButtonVisibility(entry);
        });

        // Scroll-to-bottom button click handler
        if (entry.scrollButton) {
            entry.scrollButton.addEventListener('click', () => {
                terminal.scrollToBottom();
                entry.isAtBottom = true;
                entry.userScrolledAway = false;
                updateScrollButtonVisibility(entry);
                terminal.focus();
            });
        }

        // Send input to PTY (works with any connected WebSocket)
        terminal.onData((data) => {
            if (entry.ws?.readyState === WebSocket.OPEN) {
                entry.ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Coalesced resize observer
        // Uses requestAnimationFrame for coalescing instead of setTimeout
        let resizeScheduled = false;
        let resizeFrame = null;

        const resizeObserver = new ResizeObserver(() => {
            // Only process resize for active terminal
            if (entry !== state.terminals.get(state.activeSession)) {
                return;
            }

            // Coalesce resize events using requestAnimationFrame
            if (!resizeScheduled) {
                resizeScheduled = true;

                // Cancel any pending frame
                if (resizeFrame) {
                    cancelAnimationFrame(resizeFrame);
                }

                // Schedule resize for next frame
                resizeFrame = requestAnimationFrame(() => {
                    resizeScheduled = false;
                    resizeFrame = null;

                    // Double-check we're still active and visible
                    if (entry !== state.terminals.get(state.activeSession)) {
                        return;
                    }
                    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
                        return;
                    }

                    fitAndResize(entry, false);
                });
            }
        });
        resizeObserver.observe(container);

        entry.resizeObserver = resizeObserver;
        entry.resizeFrame = null;
        entry.reconnectTimeout = null;

        // Initial connection
        connect();
    }

    // ==================== Tab UI ====================

    function createTab(meta) {
        const tab = document.createElement('div');
        tab.className = 'terminal-tab';
        tab.dataset.session = meta.session_id;
        tab.innerHTML = `
            <span class="terminal-tab-name">${escapeHtml(meta.name)}</span>
            <button class="terminal-tab-close" title="Close terminal">&times;</button>
        `;

        // Click to switch
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('terminal-tab-close')) {
                switchTo(meta.session_id);
            }
        });

        // Double-click to rename
        tab.querySelector('.terminal-tab-name').addEventListener('dblclick', () => {
            renameTerminal(meta.session_id);
        });

        // Close button
        tab.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTerminal(meta.session_id);
        });

        state.tabBar.appendChild(tab);
    }

    function updateTabName(sessionId, name) {
        const tab = state.tabBar.querySelector(`[data-session="${sessionId}"]`);
        if (tab) {
            tab.querySelector('.terminal-tab-name').textContent = name;
        }
    }

    function removeTab(sessionId) {
        const tab = state.tabBar.querySelector(`[data-session="${sessionId}"]`);
        if (tab) {
            tab.remove();
        }
    }

    function setActiveTab(sessionId) {
        // Remove active from all
        state.tabBar.querySelectorAll('.terminal-tab').forEach((t) => {
            t.classList.remove('active');
        });
        state.contentArea.querySelectorAll('.terminal-instance').forEach((c) => {
            c.classList.remove('active');
        });

        // Set active
        const tab = state.tabBar.querySelector(`[data-session="${sessionId}"]`);
        const content = state.contentArea.querySelector(`[data-session="${sessionId}"]`);

        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
    }

    // ==================== Public API ====================

    /**
     * Switch to a terminal by session ID.
     * Uses proper visibility detection instead of arbitrary timeout.
     */
    async function switchTo(sessionId) {
        const entry = state.terminals.get(sessionId);
        if (!entry) return;

        state.activeSession = sessionId;
        setActiveTab(sessionId);

        // Wait for container to be visible, then fit and focus
        const visible = await waitForVisible(entry.container);
        if (visible) {
            fitAndResize(entry, true);
            entry.terminal.focus();
            // Force a full refresh to ensure display is correct after tab switch
            entry.terminal.refresh(0, entry.terminal.rows - 1);
        } else {
            // Fallback: try anyway after a frame
            requestAnimationFrame(() => {
                fitAndResize(entry, true);
                entry.terminal.focus();
                entry.terminal.refresh(0, entry.terminal.rows - 1);
            });
        }

        // Callback
        options.onTerminalChange?.(sessionId, entry.meta);
    }

    /**
     * Rename a terminal.
     */
    async function renameTerminal(sessionId) {
        const entry = state.terminals.get(sessionId);
        if (!entry) return;

        const newName = prompt('Terminal name:', entry.meta.name);
        if (!newName || newName === entry.meta.name) return;

        try {
            await fetch('/api/terminals/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, name: newName }),
            });

            entry.meta.name = newName;
            updateTabName(sessionId, newName);
        } catch (err) {
            console.error('[TerminalTabs] Rename failed:', err);
        }
    }

    /**
     * Close a terminal.
     */
    async function closeTerminal(sessionId) {
        const entry = state.terminals.get(sessionId);
        if (!entry) return;

        // Kill on server
        try {
            await fetch('/api/pty/kill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId }),
            });
        } catch (err) {
            console.error('[TerminalTabs] Kill failed:', err);
        }

        // Cancel any pending resize frame
        if (entry.resizeFrame) {
            cancelAnimationFrame(entry.resizeFrame);
        }

        // Cancel any pending reconnect
        if (entry.reconnectTimeout) {
            clearTimeout(entry.reconnectTimeout);
        }

        // Cleanup features
        entry.searchUI?.dispose?.();
        entry.hyperlinkManager?.dispose?.();

        // Cleanup locally
        if (entry.ws) entry.ws.close();
        if (entry.resizeObserver) entry.resizeObserver.disconnect();
        entry.terminal.dispose();
        entry.container.remove();
        removeTab(sessionId);
        state.terminals.delete(sessionId);

        // Switch to another terminal if this was active
        if (state.activeSession === sessionId) {
            const remaining = Array.from(state.terminals.keys());
            if (remaining.length > 0) {
                switchTo(remaining[0]);
            } else {
                state.activeSession = null;
            }
        }
    }

    /**
     * Close all terminals associated with a file.
     */
    async function closeTerminalsForFile(filePath) {
        try {
            const response = await fetch('/api/terminals/kill-for-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath }),
            });
            const data = await response.json();

            // Cleanup local state for killed terminals
            for (const sessionId of data.killed || []) {
                const entry = state.terminals.get(sessionId);
                if (entry) {
                    if (entry.resizeFrame) cancelAnimationFrame(entry.resizeFrame);
                    if (entry.ws) entry.ws.close();
                    if (entry.resizeObserver) entry.resizeObserver.disconnect();
                    entry.terminal.dispose();
                    entry.container.remove();
                    removeTab(sessionId);
                    state.terminals.delete(sessionId);
                }
            }

            // Update active if needed
            if (data.killed?.includes(state.activeSession)) {
                const remaining = Array.from(state.terminals.keys());
                if (remaining.length > 0) {
                    switchTo(remaining[0]);
                } else {
                    state.activeSession = null;
                }
            }
        } catch (err) {
            console.error('[TerminalTabs] Kill for file failed:', err);
        }
    }

    /**
     * Get the currently active terminal.
     */
    function getActiveTerminal() {
        if (!state.activeSession) return null;
        return state.terminals.get(state.activeSession);
    }

    /**
     * Get all terminal session IDs.
     */
    function getSessionIds() {
        return Array.from(state.terminals.keys());
    }

    /**
     * Focus the active terminal.
     */
    function focus() {
        const entry = getActiveTerminal();
        if (entry) {
            entry.terminal.focus();
        }
    }

    /**
     * Fit the active terminal to its container.
     */
    function fit() {
        const entry = getActiveTerminal();
        if (entry) {
            fitAndResize(entry, false);
        }
    }

    /**
     * Scroll the active terminal to bottom.
     */
    function scrollToBottom() {
        const entry = getActiveTerminal();
        if (entry) {
            entry.terminal.scrollToBottom();
            entry.isAtBottom = true;
        }
    }

    /**
     * Initialize the terminal tabs (call on panel show).
     */
    async function init() {
        if (state.initialized) {
            // Already initialized - fit and focus active terminal
            const entry = getActiveTerminal();
            if (entry) {
                const visible = await waitForVisible(entry.container);
                if (visible) {
                    fitAndResize(entry, true);
                    entry.terminal.focus();
                }
            }
            return;
        }

        createStructure();
        await reconnectAll();

        // If no terminals exist, create one
        if (state.terminals.size === 0) {
            await createTerminal({ name: 'main' });
        }

        state.initialized = true;
    }

    // ==================== Helpers ====================

    // escapeHtml is imported at the module level from utils.js

    // ==================== Return API ====================

    /**
     * Open search in the active terminal.
     */
    function openSearch() {
        const entry = getActiveTerminal();
        if (entry?.searchUI) {
            entry.searchUI.show();
        }
    }

    /**
     * Copy selection from active terminal.
     * @param {'text'|'ansi'|'html'} format
     */
    async function copySelection(format = 'text') {
        const entry = getActiveTerminal();
        if (entry?.copyManager) {
            return entry.copyManager.copyToClipboard(format);
        }
        return false;
    }

    return {
        init,
        createTerminal,
        closeTerminal,
        closeTerminalsForFile,
        switchTo,
        renameTerminal,
        getActiveTerminal,
        getSessionIds,
        focus,
        fit,
        scrollToBottom,
        openSearch,
        copySelection,
    };
}

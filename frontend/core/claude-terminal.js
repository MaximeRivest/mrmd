/**
 * Claude Terminal for Home Screen
 *
 * A minimal xterm.js terminal that runs Claude Code.
 * Styled to blend seamlessly with the home screen aesthetic.
 */

/**
 * Calculate optimal font size for a terminal container.
 * xterm.js FitAddon adjusts cols/rows but not font size.
 * This calculates font size to achieve a target column count.
 *
 * @param {HTMLElement} container - Terminal container
 * @param {Object} options - Sizing options
 * @param {number} options.minCols - Minimum columns to display (default: 40)
 * @param {number} options.minFontSize - Minimum font size (default: 9)
 * @param {number} options.maxFontSize - Maximum font size (default: 14)
 * @param {number} options.charWidthRatio - Char width / font size ratio (default: 0.6)
 * @returns {number} Optimal font size
 */
function calculateFontSize(container, options = {}) {
    const {
        minCols = 40,
        minFontSize = 9,
        maxFontSize = 14,
        charWidthRatio = 0.6,
    } = options;

    const width = container.offsetWidth || container.clientWidth || 300;

    // Calculate font size that would give us minCols
    // width = cols * fontSize * charWidthRatio
    // fontSize = width / (cols * charWidthRatio)
    const computed = width / (minCols * charWidthRatio);

    // Clamp to min/max bounds
    return Math.max(minFontSize, Math.min(maxFontSize, Math.round(computed)));
}

/**
 * Get terminal theme matching home screen.
 */
function getTerminalTheme() {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (isDark) {
        return {
            background: '#1a1a1a',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            cursorAccent: '#1a1a1a',
            selectionBackground: 'rgba(255, 255, 255, 0.15)',
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
            cursor: '#2c2c2c',
            cursorAccent: '#fafafa',
            selectionBackground: 'rgba(0, 0, 0, 0.1)',
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
 * Create a Claude terminal instance.
 *
 * @param {HTMLElement} container - Container element for the terminal
 * @param {Object} options - Configuration options
 * @param {string} options.cwd - Working directory for Claude
 * @param {Function} options.onReady - Called when terminal is ready
 * @param {Function} options.onExit - Called when Claude exits
 * @returns {Object} Terminal API
 */
export function createClaudeTerminal(container, options = {}) {
    const state = {
        terminal: null,
        fitAddon: null,
        ws: null,
        sessionId: null,
        isConnected: false,
        isStarted: false,
    };

    // Create terminal element
    const terminalEl = document.createElement('div');
    terminalEl.className = 'claude-terminal';
    container.appendChild(terminalEl);

    // Calculate responsive font size based on container
    const initialFontSize = calculateFontSize(container, {
        minCols: 60,      // Claude Code needs decent width
        minFontSize: 9,
        maxFontSize: 14,
    });

    // Create xterm instance
    const terminal = new window.Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: initialFontSize,
        fontFamily: '"SF Mono", "Fira Code", "Monaco", "Inconsolata", monospace',
        lineHeight: 1.4,
        scrollback: 5000,
        scrollOnUserInput: true,
        smoothScrollDuration: 0,
        convertEol: true,
        allowProposedApi: true,
        theme: getTerminalTheme(),
        // Make it feel less like a traditional terminal
        windowsPty: {
            backend: 'conpty',
        },
    });
    state.terminal = terminal;

    // Add fit addon
    const fitAddon = new window.FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    state.fitAddon = fitAddon;

    // Add web links addon if available
    if (window.WebLinksAddon?.WebLinksAddon) {
        const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
        terminal.loadAddon(webLinksAddon);
    }

    // Open terminal
    terminal.open(terminalEl);

    // Initial fit after a short delay to ensure layout is complete
    setTimeout(() => {
        try {
            fitAddon.fit();
        } catch (e) {
            // Ignore fit errors during init
        }
    }, 50);

    // Try WebGL for smoother rendering
    if (window.WebglAddon?.WebglAddon) {
        try {
            const webglAddon = new window.WebglAddon.WebglAddon();
            webglAddon.onContextLoss(() => {
                webglAddon?.dispose();
            });
            terminal.loadAddon(webglAddon);
        } catch (e) {
            // Fall back to canvas renderer
        }
    }

    // Listen for color scheme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleColorSchemeChange = () => {
        terminal.options.theme = getTerminalTheme();
    };
    mediaQuery.addEventListener('change', handleColorSchemeChange);

    /**
     * Start Claude in the terminal (creates new session).
     */
    async function start() {
        if (state.isStarted) return;
        state.isStarted = true;

        try {
            // Create a terminal session that runs Claude
            const response = await fetch('/api/terminals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'claude',
                    cwd: options.cwd,
                    command: 'claude --dangerously-skip-permissions', // Auto-accept for embedded experience
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to create terminal session');
            }

            const meta = await response.json();
            state.sessionId = meta.session_id;

            // Connect to PTY
            await connect();

            options.onReady?.();
        } catch (err) {
            console.error('[ClaudeTerminal] Start failed:', err);
            terminal.write('\r\n\x1b[31mFailed to start Claude. Is the server running?\x1b[0m\r\n');
            state.isStarted = false;
        }
    }

    /**
     * Reconnect to an existing server-side session.
     */
    async function reconnect(sessionId) {
        if (state.isStarted) return;
        state.isStarted = true;
        state.sessionId = sessionId;

        try {
            // Just connect to existing PTY - don't create new session
            await connect();
            options.onReady?.();
        } catch (err) {
            console.error('[ClaudeTerminal] Reconnect failed:', err);
            terminal.write('\r\n\x1b[31mFailed to reconnect to session.\x1b[0m\r\n');
            state.isStarted = false;
        }
    }

    /**
     * Connect to the PTY WebSocket.
     */
    async function connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({ session_id: state.sessionId });
        if (options.cwd) params.set('cwd', options.cwd);

        const ws = new WebSocket(`${protocol}//${window.location.host}/api/pty?${params.toString()}`);
        state.ws = ws;

        ws.onopen = () => {
            state.isConnected = true;

            // Fit terminal after connection - wait for container to have dimensions
            waitForDimensions().then(() => {
                fit();
                sendResize();
            });
        };

        /**
         * Wait for container to have proper dimensions.
         */
        function waitForDimensions(maxAttempts = 30) {
            return new Promise((resolve) => {
                let attempts = 0;
                const check = () => {
                    attempts++;
                    if (terminalEl.offsetWidth > 50 && terminalEl.offsetHeight > 50) {
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

        ws.onmessage = (event) => {
            terminal.write(event.data);
        };

        ws.onerror = (err) => {
            console.error('[ClaudeTerminal] WebSocket error:', err);
        };

        ws.onclose = (event) => {
            state.isConnected = false;

            // Check if Claude exited normally
            if (event.code === 1000) {
                options.onExit?.('normal');
            } else {
                options.onExit?.('error');
            }
        };

        // Send input to PTY
        terminal.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Resize observer - watch both container and terminal element
        // Terminal element has resize:both CSS so user can drag to resize
        let resizeTimeout;
        const resizeObserver = new ResizeObserver(() => {
            if (terminalEl.offsetWidth > 50 && terminalEl.offsetHeight > 50) {
                // Debounce resize events for smooth dragging
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    // Recalculate font size on resize
                    updateFontSize();
                    fit();
                    sendResize();
                }, 30);
            }
        });
        resizeObserver.observe(container);
        resizeObserver.observe(terminalEl);

        state.resizeObserver = resizeObserver;
    }

    /**
     * Update font size based on current container dimensions.
     */
    function updateFontSize() {
        const newSize = calculateFontSize(container, {
            minCols: 60,
            minFontSize: 9,
            maxFontSize: 14,
        });
        if (terminal.options.fontSize !== newSize) {
            terminal.options.fontSize = newSize;
        }
    }

    /**
     * Fit terminal to container.
     */
    function fit() {
        try {
            state.fitAddon?.fit();
        } catch (e) {
            // Ignore fit errors
        }
    }

    /**
     * Send resize to PTY.
     */
    function sendResize() {
        if (state.ws?.readyState === WebSocket.OPEN) {
            state.ws.send(JSON.stringify({
                type: 'resize',
                cols: terminal.cols,
                rows: terminal.rows,
            }));
        }
    }

    /**
     * Focus the terminal.
     */
    function focus() {
        terminal.focus();
    }

    /**
     * Check if terminal is connected.
     */
    function isConnected() {
        return state.isConnected;
    }

    /**
     * Write text to terminal (for initial prompt display).
     */
    function write(text) {
        terminal.write(text);
    }

    /**
     * Destroy the terminal.
     */
    async function destroy() {
        mediaQuery.removeEventListener('change', handleColorSchemeChange);

        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
        }

        if (state.ws) {
            state.ws.close();
        }

        // Kill the server session
        if (state.sessionId) {
            try {
                await fetch('/api/pty/kill', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: state.sessionId }),
                });
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        terminal.dispose();
        terminalEl.remove();
    }

    return {
        start,
        reconnect,
        focus,
        fit,
        write,
        isConnected,
        destroy,
        get element() {
            return terminalEl;
        },
        get terminal() {
            return terminal;
        },
        get sessionId() {
            return state.sessionId;
        },
    };
}

export default { createClaudeTerminal };

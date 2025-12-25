# Terminal Rendering Architecture

## Vision

Build a terminal renderer worthy of literate programming - one that handles full TUI applications (vim, htop, claude-code) flawlessly, allows reading while streaming, and integrates seamlessly with the notebook/markdown paradigm.

---

## Current State Analysis

### Three Rendering Systems

| System | File | Purpose | Capability |
|--------|------|---------|------------|
| **xterm.js PTY** | `terminal-tabs.js` | Interactive shell in sidebar panel | Full terminal emulation |
| **Output Renderer** | `output-renderer.js` | Jupyter-style cell outputs | Images, HTML, text |
| **Custom Renderer** | `terminal-renderer.js` | Inline terminal preview | Basic colors only |

### Identified Issues

#### 1. Refocus Blank/Freeze
**Location**: `terminal-tabs.js:370-383`

```javascript
// Current code in switchTo():
setTimeout(() => {
    entry.fitAddon.fit();
    entry.terminal.focus();
    // Send resize to PTY...
}, 10);
```

**Problems**:
- 10ms timeout may not be enough for container to be visible
- `fit()` fails silently if container has zero dimensions
- Multiple resize events during tab switch
- Reader removal/re-add in PTY reconnect can fail silently

**Root Cause**: xterm.js needs the container to be fully rendered and visible before `fit()`. When the tab switches, CSS transitions may still be in progress.

#### 2. TUI Flickering (Claude Code, vim, etc.)
**Location**: `terminal-tabs.js:271-288` (ResizeObserver)

**Problems**:
- 50ms debounce fires resize multiple times during layout shifts
- Every resize triggers a full PTY resize + app redraw
- No coalescing of rapid visibility changes

**Root Cause**: ResizeObserver fires for every layout change, including during animations. TUI apps (especially Claude Code with its complex UI) redraw on every resize.

#### 3. Scroll While Streaming
**Location**: xterm.js configuration in `terminal-tabs.js:193-208`

**Current config**:
```javascript
scrollOnUserInput: true,  // Exists but not sufficient
smoothScrollDuration: 0,  // Disabled for performance
```

**Problem**: There's no "sticky scroll" - when user scrolls up to read history, new output doesn't force viewport back to bottom, but when at bottom, it should auto-scroll.

---

## Architecture Design

### Phase 1: Fix xterm.js Integration Issues

#### 1.1 Robust Visibility Handling

```javascript
// New approach: Wait for actual visibility, not just timeout
function switchTo(sessionId) {
    const entry = state.terminals.get(sessionId);
    if (!entry) return;

    state.activeSession = sessionId;
    setActiveTab(sessionId);

    // Use requestAnimationFrame + IntersectionObserver pattern
    const ensureVisible = () => {
        if (entry.container.offsetWidth > 0 && entry.container.offsetHeight > 0) {
            entry.fitAddon.fit();
            entry.terminal.focus();
            sendResize(entry);
        } else {
            requestAnimationFrame(ensureVisible);
        }
    };
    requestAnimationFrame(ensureVisible);
}
```

#### 1.2 Coalesced Resize Handling

```javascript
// New debounced resize with visibility check
let resizeFrame = null;
let pendingResize = false;

const resizeObserver = new ResizeObserver(() => {
    if (entry !== state.terminals.get(state.activeSession)) return;

    pendingResize = true;
    if (resizeFrame) return;

    resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (!pendingResize) return;
        pendingResize = false;

        // Only resize if dimensions actually changed
        const newCols = entry.fitAddon.proposeDimensions()?.cols;
        const newRows = entry.fitAddon.proposeDimensions()?.rows;

        if (newCols !== entry.terminal.cols || newRows !== entry.terminal.rows) {
            entry.fitAddon.fit();
            sendResize(entry);
        }
    });
});
```

#### 1.3 Sticky Scroll Behavior

```javascript
// Track if user has scrolled away from bottom
let isAtBottom = true;

terminal.onScroll(() => {
    const buffer = terminal.buffer.active;
    const viewportEnd = buffer.viewportY + terminal.rows;
    isAtBottom = viewportEnd >= buffer.length;
});

// Modify write handling to respect scroll position
// This requires patching or wrapping the terminal write
const originalWrite = terminal.write.bind(terminal);
terminal.write = (data, callback) => {
    const wasAtBottom = isAtBottom;
    originalWrite(data, () => {
        if (wasAtBottom) {
            terminal.scrollToBottom();
        }
        callback?.();
    });
};
```

### Phase 2: Enhanced ANSI Parser for Custom Renderer

For notebook inline output (not xterm.js), we need a proper parser:

```javascript
// frontend/core/ansi-parser.js

/**
 * VT100/xterm escape code parser.
 *
 * Supports:
 * - CSI sequences (cursor, colors, screen manipulation)
 * - OSC sequences (title, hyperlinks)
 * - SGR codes (styling)
 */
export class AnsiParser {
    constructor() {
        this.state = 'ground';
        this.params = [];
        this.intermediate = '';
    }

    /**
     * Parse input and yield tokens.
     * @param {string} input
     * @yields {{type: string, ...}}
     */
    *parse(input) {
        for (const char of input) {
            yield* this.processChar(char);
        }
    }

    *processChar(char) {
        const code = char.charCodeAt(0);

        switch (this.state) {
            case 'ground':
                if (code === 0x1b) { // ESC
                    this.state = 'escape';
                } else if (code === 0x0d) { // CR
                    yield { type: 'cr' };
                } else if (code === 0x0a) { // LF
                    yield { type: 'lf' };
                } else if (code === 0x08) { // BS
                    yield { type: 'bs' };
                } else if (code >= 0x20) {
                    yield { type: 'print', char };
                }
                break;

            case 'escape':
                if (char === '[') {
                    this.state = 'csi_entry';
                    this.params = [];
                    this.intermediate = '';
                } else if (char === ']') {
                    this.state = 'osc_string';
                    this.oscData = '';
                } else if (char === '(') {
                    this.state = 'designate_g0';
                } else {
                    // Two-character escape
                    yield { type: 'esc', char };
                    this.state = 'ground';
                }
                break;

            case 'csi_entry':
            case 'csi_param':
                if (code >= 0x30 && code <= 0x39) { // 0-9
                    this.state = 'csi_param';
                    const lastParam = this.params.length - 1;
                    if (lastParam < 0) {
                        this.params.push(code - 0x30);
                    } else {
                        this.params[lastParam] = this.params[lastParam] * 10 + (code - 0x30);
                    }
                } else if (char === ';') {
                    this.params.push(0);
                } else if (code >= 0x40 && code <= 0x7e) { // Final byte
                    yield {
                        type: 'csi',
                        cmd: char,
                        params: this.params,
                        intermediate: this.intermediate
                    };
                    this.state = 'ground';
                } else if (code >= 0x20 && code <= 0x2f) { // Intermediate
                    this.intermediate += char;
                }
                break;

            case 'osc_string':
                if (code === 0x07 || (code === 0x1b)) { // BEL or ESC
                    yield { type: 'osc', data: this.oscData };
                    this.state = code === 0x1b ? 'escape' : 'ground';
                } else {
                    this.oscData += char;
                }
                break;

            default:
                this.state = 'ground';
        }
    }
}

// CSI command handlers
export const CSI_HANDLERS = {
    'm': handleSGR,        // Select Graphic Rendition (colors/styles)
    'H': handleCUP,        // Cursor Position
    'A': handleCUU,        // Cursor Up
    'B': handleCUD,        // Cursor Down
    'C': handleCUF,        // Cursor Forward
    'D': handleCUB,        // Cursor Back
    'J': handleED,         // Erase in Display
    'K': handleEL,         // Erase in Line
    's': handleSCP,        // Save Cursor Position
    'u': handleRCP,        // Restore Cursor Position
    'h': handleDECSET,     // DEC Private Mode Set
    'l': handleDECRST,     // DEC Private Mode Reset
    'r': handleDECSTBM,    // Set Scrolling Region
};
```

### Phase 3: Terminal State Model

For rendering terminal output to HTML (notebooks, inline output):

```javascript
// frontend/core/terminal-state.js

/**
 * Terminal state machine for rendering.
 *
 * Unlike xterm.js which renders to canvas, this maintains
 * a character grid that can be converted to HTML.
 */
export class TerminalState {
    constructor(cols = 80, rows = 24) {
        this.cols = cols;
        this.rows = rows;

        // Primary screen buffer
        this.primary = this.createBuffer();

        // Alternate screen buffer (for vim, less, etc.)
        this.alternate = null;

        // Current buffer
        this.buffer = this.primary;

        // Cursor state
        this.cursor = { row: 0, col: 0, visible: true };
        this.savedCursor = null;

        // Current style
        this.style = {
            fg: null,        // null = default
            bg: null,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            blink: false,
            reverse: false,
            hidden: false,
            strikethrough: false,
        };

        // Terminal modes
        this.modes = {
            altScreen: false,
            cursorVisible: true,
            autoWrap: true,
            originMode: false,
        };

        // Scroll region
        this.scrollTop = 0;
        this.scrollBottom = rows - 1;

        // Scrollback buffer (for primary screen only)
        this.scrollback = [];
        this.maxScrollback = 10000;
    }

    createBuffer() {
        return Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => ({
                char: ' ',
                style: { ...this.defaultStyle() }
            }))
        );
    }

    defaultStyle() {
        return {
            fg: null,
            bg: null,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            blink: false,
            reverse: false,
            hidden: false,
            strikethrough: false,
        };
    }

    /**
     * Write text/escape sequences to terminal.
     */
    write(data) {
        const parser = new AnsiParser();
        for (const token of parser.parse(data)) {
            this.handleToken(token);
        }
    }

    handleToken(token) {
        switch (token.type) {
            case 'print':
                this.printChar(token.char);
                break;
            case 'cr':
                this.cursor.col = 0;
                break;
            case 'lf':
                this.lineFeed();
                break;
            case 'bs':
                if (this.cursor.col > 0) this.cursor.col--;
                break;
            case 'csi':
                this.handleCSI(token);
                break;
            case 'osc':
                this.handleOSC(token);
                break;
        }
    }

    printChar(char) {
        if (this.cursor.col >= this.cols) {
            if (this.modes.autoWrap) {
                this.cursor.col = 0;
                this.lineFeed();
            } else {
                this.cursor.col = this.cols - 1;
            }
        }

        this.buffer[this.cursor.row][this.cursor.col] = {
            char,
            style: { ...this.style }
        };
        this.cursor.col++;
    }

    lineFeed() {
        if (this.cursor.row === this.scrollBottom) {
            this.scrollUp();
        } else if (this.cursor.row < this.rows - 1) {
            this.cursor.row++;
        }
    }

    scrollUp() {
        // Save line to scrollback (primary buffer only)
        if (this.buffer === this.primary && this.scrollTop === 0) {
            this.scrollback.push([...this.buffer[0]]);
            if (this.scrollback.length > this.maxScrollback) {
                this.scrollback.shift();
            }
        }

        // Scroll the region
        for (let row = this.scrollTop; row < this.scrollBottom; row++) {
            this.buffer[row] = this.buffer[row + 1];
        }
        this.buffer[this.scrollBottom] = this.createEmptyLine();
    }

    createEmptyLine() {
        return Array.from({ length: this.cols }, () => ({
            char: ' ',
            style: { ...this.defaultStyle() }
        }));
    }

    handleCSI(token) {
        const handler = CSI_HANDLERS[token.cmd];
        if (handler) {
            handler(this, token.params, token.intermediate);
        }
    }

    /**
     * Switch to alternate screen buffer.
     */
    enterAltScreen() {
        if (this.modes.altScreen) return;
        this.modes.altScreen = true;
        this.alternate = this.createBuffer();
        this.buffer = this.alternate;
        this.savedCursorAlt = { ...this.cursor };
    }

    /**
     * Switch back to primary screen buffer.
     */
    exitAltScreen() {
        if (!this.modes.altScreen) return;
        this.modes.altScreen = false;
        this.buffer = this.primary;
        if (this.savedCursorAlt) {
            this.cursor = this.savedCursorAlt;
        }
        this.alternate = null;
    }

    /**
     * Render to HTML.
     */
    toHtml(options = {}) {
        const { includeScrollback = false, viewportStart = 0 } = options;

        let html = '<div class="terminal-output">';

        // Scrollback
        if (includeScrollback && this.scrollback.length > 0) {
            for (const line of this.scrollback) {
                html += this.lineToHtml(line);
            }
        }

        // Current buffer
        for (const line of this.buffer) {
            html += this.lineToHtml(line);
        }

        html += '</div>';
        return html;
    }

    lineToHtml(line) {
        let html = '<div class="terminal-line">';
        let currentSpan = null;
        let currentStyle = null;

        for (const cell of line) {
            const styleStr = this.styleToClass(cell.style);

            if (styleStr !== currentStyle) {
                if (currentSpan) html += '</span>';
                if (styleStr) {
                    html += `<span class="${styleStr}">`;
                    currentSpan = true;
                } else {
                    currentSpan = false;
                }
                currentStyle = styleStr;
            }

            html += this.escapeChar(cell.char);
        }

        if (currentSpan) html += '</span>';
        html += '</div>\n';
        return html;
    }

    styleToClass(style) {
        const classes = [];
        if (style.bold) classes.push('bold');
        if (style.dim) classes.push('dim');
        if (style.italic) classes.push('italic');
        if (style.underline) classes.push('underline');
        if (style.reverse) classes.push('reverse');
        if (style.strikethrough) classes.push('strikethrough');
        if (style.fg !== null) classes.push(`fg-${style.fg}`);
        if (style.bg !== null) classes.push(`bg-${style.bg}`);
        return classes.join(' ');
    }

    escapeChar(char) {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            default: return char;
        }
    }
}
```

### Phase 4: SGR (Colors/Styles) Handler

```javascript
// frontend/core/ansi-sgr.js

/**
 * Handle SGR (Select Graphic Rendition) codes.
 */
export function handleSGR(terminal, params) {
    if (params.length === 0) params = [0];

    let i = 0;
    while (i < params.length) {
        const code = params[i];

        switch (code) {
            // Reset
            case 0:
                Object.assign(terminal.style, terminal.defaultStyle());
                break;

            // Styles
            case 1: terminal.style.bold = true; break;
            case 2: terminal.style.dim = true; break;
            case 3: terminal.style.italic = true; break;
            case 4: terminal.style.underline = true; break;
            case 5: terminal.style.blink = true; break;
            case 7: terminal.style.reverse = true; break;
            case 8: terminal.style.hidden = true; break;
            case 9: terminal.style.strikethrough = true; break;

            // Reset styles
            case 21: terminal.style.bold = false; break;
            case 22: terminal.style.dim = false; terminal.style.bold = false; break;
            case 23: terminal.style.italic = false; break;
            case 24: terminal.style.underline = false; break;
            case 25: terminal.style.blink = false; break;
            case 27: terminal.style.reverse = false; break;
            case 28: terminal.style.hidden = false; break;
            case 29: terminal.style.strikethrough = false; break;

            // Standard foreground colors (30-37)
            case 30: case 31: case 32: case 33:
            case 34: case 35: case 36: case 37:
                terminal.style.fg = code - 30;
                break;

            // 256-color foreground (38;5;n)
            case 38:
                if (params[i + 1] === 5) {
                    terminal.style.fg = params[i + 2];
                    i += 2;
                } else if (params[i + 1] === 2) {
                    // 24-bit color: 38;2;r;g;b
                    terminal.style.fg = {
                        r: params[i + 2],
                        g: params[i + 3],
                        b: params[i + 4]
                    };
                    i += 4;
                }
                break;

            // Default foreground
            case 39:
                terminal.style.fg = null;
                break;

            // Standard background colors (40-47)
            case 40: case 41: case 42: case 43:
            case 44: case 45: case 46: case 47:
                terminal.style.bg = code - 40;
                break;

            // 256-color background (48;5;n)
            case 48:
                if (params[i + 1] === 5) {
                    terminal.style.bg = params[i + 2];
                    i += 2;
                } else if (params[i + 1] === 2) {
                    terminal.style.bg = {
                        r: params[i + 2],
                        g: params[i + 3],
                        b: params[i + 4]
                    };
                    i += 4;
                }
                break;

            // Default background
            case 49:
                terminal.style.bg = null;
                break;

            // Bright foreground colors (90-97)
            case 90: case 91: case 92: case 93:
            case 94: case 95: case 96: case 97:
                terminal.style.fg = code - 90 + 8;
                break;

            // Bright background colors (100-107)
            case 100: case 101: case 102: case 103:
            case 104: case 105: case 106: case 107:
                terminal.style.bg = code - 100 + 8;
                break;
        }

        i++;
    }
}
```

---

## Implementation Roadmap

### Milestone 1: Stability (Fix Current Issues) ✅ COMPLETED
**Target: Rock-solid xterm.js integration**

- [x] Fix refocus blank/freeze with proper visibility detection
- [x] Implement coalesced resize handling
- [x] Add sticky scroll behavior
- [x] Add visibility-aware fit() calls
- [x] Increase PTY output buffer (8KB -> 64KB)

**Files modified**:
- `frontend/core/terminal-tabs.js` - Complete rewrite with visibility handling
- `src/mrmd/server/pty_handler.py` - Buffer increased to 64KB

### Milestone 2: ANSI Parser ✅ COMPLETED
**Target: Full VT100/xterm escape code support**

- [x] Create `frontend/core/ansi-parser.js`
- [x] Implement CSI sequence parser (all cursor, screen, mode commands)
- [x] Implement OSC sequence parser (title, hyperlinks)
- [x] Implement SGR handler (256-color, 24-bit, all attributes)

**New files created**:
- `frontend/core/ansi-parser.js` - Complete VT100/xterm parser
- `frontend/core/ansi-sgr.js` - SGR handler with full color support

### Milestone 3: Terminal State Model ✅ COMPLETED
**Target: Proper terminal emulation for inline output**

- [x] Create `frontend/core/terminal-state.js`
- [x] Implement cursor movement (all directions, absolute/relative)
- [x] Implement screen manipulation (clear, erase, scroll)
- [x] Implement alternate screen buffer (for vim, htop, etc.)
- [x] Implement scrollback buffer (10k lines default)
- [x] HTML rendering with proper styling

**New files created**:
- `frontend/core/terminal-state.js` - Complete terminal state machine

### Milestone 4: Integration ✅ COMPLETED
**Target: Seamless notebook experience**

- [x] Replace `terminal-renderer.js` with new state model
- [x] Update CSS with comprehensive terminal styles
- [x] Progress bar support (carriage return handling)
- [x] Full color palette (standard, bright, 256-color)

**Files modified**:
- `frontend/core/terminal-renderer.js` - Integrated with new parser
- `frontend/core/utils.js` - Enhanced ANSI handling
- `frontend/styles/main.css` - Complete terminal CSS

### Milestone 5: Polish ✅ COMPLETED
**Target: Delightful UX**

- [x] Search in terminal history (Ctrl+F)
- [x] Copy with formatting (text, ANSI, HTML)
- [x] Hyperlink support (OSC 8)
- [x] Keyboard shortcuts (Ctrl+C copy, Ctrl+Shift+C formatted)

**New files created**:
- `frontend/core/terminal-features.js` - Search, Copy, Hyperlinks

---

## CSS for Terminal Rendering

```css
/* Terminal output rendering */
.terminal-output {
    font-family: 'SF Mono', 'Fira Code', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre;
    overflow-x: auto;
}

.terminal-line {
    min-height: 1.4em;
}

/* Standard colors (0-7) */
.fg-0 { color: #000000; }
.fg-1 { color: #cd3131; }
.fg-2 { color: #0dbc79; }
.fg-3 { color: #e5e510; }
.fg-4 { color: #2472c8; }
.fg-5 { color: #bc3fbc; }
.fg-6 { color: #11a8cd; }
.fg-7 { color: #e5e5e5; }

/* Bright colors (8-15) */
.fg-8 { color: #666666; }
.fg-9 { color: #f14c4c; }
.fg-10 { color: #23d18b; }
.fg-11 { color: #f5f543; }
.fg-12 { color: #3b8eea; }
.fg-13 { color: #d670d6; }
.fg-14 { color: #29b8db; }
.fg-15 { color: #ffffff; }

/* Background colors */
.bg-0 { background: #000000; }
.bg-1 { background: #cd3131; }
.bg-2 { background: #0dbc79; }
.bg-3 { background: #e5e510; }
.bg-4 { background: #2472c8; }
.bg-5 { background: #bc3fbc; }
.bg-6 { background: #11a8cd; }
.bg-7 { background: #e5e5e5; }

/* Styles */
.bold { font-weight: bold; }
.dim { opacity: 0.7; }
.italic { font-style: italic; }
.underline { text-decoration: underline; }
.strikethrough { text-decoration: line-through; }
.reverse { filter: invert(1); }

/* Cursor */
.terminal-cursor {
    background: #aeafad;
    animation: blink 1s step-end infinite;
}

@keyframes blink {
    50% { opacity: 0; }
}
```

---

## Testing Strategy

### Unit Tests
- ANSI parser: all CSI/OSC/SGR sequences
- Terminal state: cursor movement, screen operations
- Scrollback: buffer limits, scroll regions

### Integration Tests
- xterm.js resize behavior
- WebSocket reconnection
- Sticky scroll during streaming

### Visual Tests
- TUI rendering (vim, htop simulation)
- Color accuracy (256-color palette)
- Progress bar updates

### Performance Tests
- Large output handling (100k lines)
- Rapid output bursts
- Memory usage under load

---

## References

- [ECMA-48 (ANSI escape codes)](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/)
- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
- [VT100 User Guide](https://vt100.net/docs/vt100-ug/)
- [xterm.js Source](https://github.com/xtermjs/xterm.js)

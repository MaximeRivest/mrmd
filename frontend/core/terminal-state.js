/**
 * Terminal State Model
 *
 * A complete terminal emulator state machine that maintains a character grid
 * and handles all VT100/xterm escape sequences. Unlike xterm.js which renders
 * to canvas, this maintains state that can be converted to HTML.
 *
 * Features:
 * - Primary and alternate screen buffers
 * - Cursor movement and positioning
 * - Screen manipulation (clear, erase, scroll)
 * - Scroll regions
 * - Tab stops
 * - Scrollback buffer with configurable size
 * - Full SGR (colors/styles) support
 * - Origin mode
 * - Auto-wrap mode
 * - Saved cursor state
 *
 * Usage:
 *   const term = new TerminalState(80, 24);
 *   term.write('Hello, \x1b[32mWorld\x1b[0m!');
 *   const html = term.toHtml();
 */

import { AnsiParser, CSI, OSC, DECMODE } from './ansi-parser.js';
import {
    createDefaultStyle,
    cloneStyle,
    applySGR,
    styleToClasses,
    styleToInlineCSS,
    colorToCSS,
} from './ansi-sgr.js';

/**
 * Create an empty cell.
 * @param {Object} style - Style for the cell
 * @returns {Object} Cell object
 */
function createCell(style = null) {
    return {
        char: ' ',
        width: 1,
        style: style ? cloneStyle(style) : createDefaultStyle(),
    };
}

/**
 * Create an empty line.
 * @param {number} cols - Number of columns
 * @param {Object} style - Default style for cells
 * @returns {Object[]} Array of cells
 */
function createLine(cols, style = null) {
    const line = [];
    for (let i = 0; i < cols; i++) {
        line.push(createCell(style));
    }
    return line;
}

/**
 * Terminal state model.
 */
export class TerminalState {
    /**
     * Create a new terminal state.
     * @param {number} cols - Number of columns (default 80)
     * @param {number} rows - Number of rows (default 24)
     * @param {Object} options - Configuration options
     */
    constructor(cols = 80, rows = 24, options = {}) {
        this.cols = cols;
        this.rows = rows;

        // Scrollback configuration
        this.maxScrollback = options.maxScrollback ?? 10000;

        // Create buffers
        this.primaryBuffer = this._createBuffer();
        this.primaryScrollback = [];
        this.alternateBuffer = null;

        // Current buffer (points to primary or alternate)
        this.buffer = this.primaryBuffer;
        this.scrollback = this.primaryScrollback;

        // Cursor state
        this.cursor = {
            row: 0,
            col: 0,
            visible: true,
            style: 'block', // block, underline, bar
            blinking: true,
        };

        // Saved cursor (for DECSC/DECRC and alternate screen)
        this.savedCursor = null;
        this.savedCursorAlt = null;

        // Current text style
        this.style = createDefaultStyle();

        // Scroll region (top and bottom margins, 0-indexed)
        this.scrollTop = 0;
        this.scrollBottom = rows - 1;

        // Tab stops (default every 8 columns)
        this.tabStops = new Set();
        this._resetTabStops();

        // Terminal modes
        this.modes = {
            // DEC modes
            cursorKeys: false,      // DECCKM
            originMode: false,      // DECOM
            autoWrap: true,         // DECAWM
            cursorVisible: true,    // DECTCEM
            reverseVideo: false,    // DECSCNM

            // ANSI modes
            insertMode: false,      // IRM
            linefeedMode: false,    // LNM

            // Application modes
            altScreen: false,
            bracketedPaste: false,

            // Mouse modes
            mouseTracking: 0,       // 0 = off, 9/1000/1002/1003 = various modes
            mouseEncoding: 0,       // 0 = default, 1005/1006/1015 = various encodings

            // Focus reporting
            focusReporting: false,
        };

        // Character sets (G0-G3)
        this.charsets = {
            g0: 'B', // ASCII
            g1: '0', // DEC Special Graphics
            g2: 'B',
            g3: 'B',
            gl: 0,   // GL points to G0
            gr: 1,   // GR points to G1
        };

        // Parser instance
        this.parser = new AnsiParser();

        // Hyperlinks (OSC 8)
        this.activeHyperlink = null;

        // Window title
        this.title = '';
        this.iconName = '';

        // Dirty tracking for efficient rendering
        this.dirtyLines = new Set();
        this.allDirty = true;

        // Event callbacks
        this.onBell = null;
        this.onTitleChange = null;
        this.onResize = null;
    }

    /**
     * Create a buffer (2D array of cells).
     * @returns {Object[][]}
     */
    _createBuffer() {
        const buffer = [];
        for (let row = 0; row < this.rows; row++) {
            buffer.push(createLine(this.cols));
        }
        return buffer;
    }

    /**
     * Reset tab stops to default (every 8 columns).
     */
    _resetTabStops() {
        this.tabStops.clear();
        for (let i = 0; i < this.cols; i += 8) {
            this.tabStops.add(i);
        }
    }

    /**
     * Write data to the terminal.
     * @param {string} data - Data to write (may include escape sequences)
     */
    write(data) {
        for (const token of this.parser.parse(data)) {
            this._handleToken(token);
        }
    }

    /**
     * Handle a parsed token.
     * @param {Object} token
     */
    _handleToken(token) {
        switch (token.type) {
            case 'print':
                this._print(token.char);
                break;
            case 'cr':
                this._carriageReturn();
                break;
            case 'lf':
                this._lineFeed();
                break;
            case 'bs':
                this._backspace();
                break;
            case 'tab':
                this._tab();
                break;
            case 'bell':
                this.onBell?.();
                break;
            case 'csi':
                this._handleCSI(token);
                break;
            case 'osc':
                this._handleOSC(token);
                break;
            case 'esc':
                this._handleEscape(token);
                break;
            case 'shift_out':
                this.charsets.gl = 1;
                break;
            case 'shift_in':
                this.charsets.gl = 0;
                break;
            case 'ind':
                this._lineFeed();
                break;
            case 'nel':
                this._carriageReturn();
                this._lineFeed();
                break;
            case 'ri':
                this._reverseIndex();
                break;
            case 'hts':
                this.tabStops.add(this.cursor.col);
                break;
        }
    }

    /**
     * Print a character at the cursor position.
     * @param {string} char
     */
    _print(char) {
        // Handle auto-wrap
        if (this.cursor.col >= this.cols) {
            if (this.modes.autoWrap) {
                this._carriageReturn();
                this._lineFeed();
            } else {
                this.cursor.col = this.cols - 1;
            }
        }

        // Get the cell
        const row = this.buffer[this.cursor.row];
        if (!row) return;

        // Handle insert mode
        if (this.modes.insertMode) {
            // Shift characters right
            for (let i = this.cols - 1; i > this.cursor.col; i--) {
                row[i] = row[i - 1];
            }
            row[this.cursor.col] = createCell(this.style);
        }

        // Write character
        row[this.cursor.col] = {
            char,
            width: 1,
            style: cloneStyle(this.style),
            hyperlink: this.activeHyperlink,
        };

        this._markDirty(this.cursor.row);
        this.cursor.col++;
    }

    /**
     * Carriage return - move cursor to column 0.
     */
    _carriageReturn() {
        this.cursor.col = 0;
    }

    /**
     * Line feed - move cursor down, scroll if needed.
     */
    _lineFeed() {
        if (this.cursor.row === this.scrollBottom) {
            this._scrollUp(1);
        } else if (this.cursor.row < this.rows - 1) {
            this.cursor.row++;
        }

        // In linefeed mode, LF also does CR
        if (this.modes.linefeedMode) {
            this._carriageReturn();
        }
    }

    /**
     * Reverse index - move cursor up, scroll if needed.
     */
    _reverseIndex() {
        if (this.cursor.row === this.scrollTop) {
            this._scrollDown(1);
        } else if (this.cursor.row > 0) {
            this.cursor.row--;
        }
    }

    /**
     * Backspace - move cursor left.
     */
    _backspace() {
        if (this.cursor.col > 0) {
            this.cursor.col--;
        }
    }

    /**
     * Tab - move to next tab stop.
     */
    _tab() {
        let nextStop = this.cols - 1;
        for (const stop of this.tabStops) {
            if (stop > this.cursor.col) {
                nextStop = Math.min(nextStop, stop);
            }
        }
        this.cursor.col = Math.min(nextStop, this.cols - 1);
    }

    /**
     * Scroll the screen up by n lines.
     * @param {number} n - Number of lines to scroll
     */
    _scrollUp(n = 1) {
        for (let i = 0; i < n; i++) {
            // If scrolling the full screen, add to scrollback
            if (this.scrollTop === 0 && this.buffer === this.primaryBuffer) {
                const line = this.buffer.shift();
                this.scrollback.push(line);
                // Trim scrollback if too large
                if (this.scrollback.length > this.maxScrollback) {
                    this.scrollback.shift();
                }
                this.buffer.push(createLine(this.cols));
            } else {
                // Scroll within region
                for (let row = this.scrollTop; row < this.scrollBottom; row++) {
                    this.buffer[row] = this.buffer[row + 1];
                }
                this.buffer[this.scrollBottom] = createLine(this.cols);
            }
        }
        this.allDirty = true;
    }

    /**
     * Scroll the screen down by n lines.
     * @param {number} n - Number of lines to scroll
     */
    _scrollDown(n = 1) {
        for (let i = 0; i < n; i++) {
            for (let row = this.scrollBottom; row > this.scrollTop; row--) {
                this.buffer[row] = this.buffer[row - 1];
            }
            this.buffer[this.scrollTop] = createLine(this.cols);
        }
        this.allDirty = true;
    }

    /**
     * Handle CSI sequence.
     * @param {Object} token
     */
    _handleCSI(token) {
        const { params, intermediate, final: cmd } = token;
        const p = params.length > 0 ? params : [0];

        // Check for private mode indicator
        const isPrivate = intermediate.includes('?');
        const isGT = intermediate.includes('>');

        switch (cmd) {
            // Cursor movement
            case CSI.CUU: // Cursor Up
                this._moveCursor(-Math.max(1, p[0]), 0);
                break;
            case CSI.CUD: // Cursor Down
                this._moveCursor(Math.max(1, p[0]), 0);
                break;
            case CSI.CUF: // Cursor Forward
                this._moveCursor(0, Math.max(1, p[0]));
                break;
            case CSI.CUB: // Cursor Back
                this._moveCursor(0, -Math.max(1, p[0]));
                break;
            case CSI.CNL: // Cursor Next Line
                this._moveCursor(Math.max(1, p[0]), 0);
                this.cursor.col = 0;
                break;
            case CSI.CPL: // Cursor Previous Line
                this._moveCursor(-Math.max(1, p[0]), 0);
                this.cursor.col = 0;
                break;
            case CSI.CHA: // Cursor Horizontal Absolute
                this._setCursor(this.cursor.row, Math.max(1, p[0]) - 1);
                break;
            case CSI.CUP: // Cursor Position
            case CSI.HVP:
                this._setCursor(Math.max(1, p[0]) - 1, Math.max(1, p[1] || 1) - 1);
                break;
            case CSI.VPA: // Vertical Position Absolute
                this._setCursor(Math.max(1, p[0]) - 1, this.cursor.col);
                break;

            // Erase
            case CSI.ED: // Erase in Display
                this._eraseInDisplay(p[0] || 0);
                break;
            case CSI.EL: // Erase in Line
                this._eraseInLine(p[0] || 0);
                break;
            case CSI.ECH: // Erase Characters
                this._eraseCharacters(Math.max(1, p[0]));
                break;

            // Insert/Delete
            case CSI.IL: // Insert Lines
                this._insertLines(Math.max(1, p[0]));
                break;
            case CSI.DL: // Delete Lines
                this._deleteLines(Math.max(1, p[0]));
                break;
            case CSI.ICH: // Insert Characters
                this._insertCharacters(Math.max(1, p[0]));
                break;
            case CSI.DCH: // Delete Characters
                this._deleteCharacters(Math.max(1, p[0]));
                break;

            // Scroll
            case CSI.SU: // Scroll Up
                this._scrollUp(Math.max(1, p[0]));
                break;
            case CSI.SD: // Scroll Down
                this._scrollDown(Math.max(1, p[0]));
                break;

            // Tab
            case CSI.CHT: // Cursor Horizontal Tab
                for (let i = 0; i < Math.max(1, p[0]); i++) {
                    this._tab();
                }
                break;
            case CSI.CBT: // Cursor Backward Tab
                for (let i = 0; i < Math.max(1, p[0]); i++) {
                    this._backTab();
                }
                break;
            case CSI.TBC: // Tab Clear
                if (p[0] === 0) {
                    this.tabStops.delete(this.cursor.col);
                } else if (p[0] === 3) {
                    this.tabStops.clear();
                }
                break;

            // Styling
            case CSI.SGR: // Select Graphic Rendition
                applySGR(this.style, params);
                break;

            // Modes
            case CSI.SM: // Set Mode
                if (isPrivate) {
                    for (const mode of p) {
                        this._setPrivateMode(mode, true);
                    }
                } else {
                    for (const mode of p) {
                        this._setMode(mode, true);
                    }
                }
                break;
            case CSI.RM: // Reset Mode
                if (isPrivate) {
                    for (const mode of p) {
                        this._setPrivateMode(mode, false);
                    }
                } else {
                    for (const mode of p) {
                        this._setMode(mode, false);
                    }
                }
                break;

            // Scroll region
            case CSI.DECSTBM: // Set Top and Bottom Margins
                this._setScrollRegion(
                    (p[0] || 1) - 1,
                    (p[1] || this.rows) - 1
                );
                break;

            // Cursor save/restore
            case CSI.SCP: // Save Cursor Position (ANSI.SYS)
                this._saveCursor();
                break;
            case CSI.RCP: // Restore Cursor Position (ANSI.SYS)
                this._restoreCursor();
                break;

            // Device status
            case CSI.DSR: // Device Status Report
                // Would need to respond - not implemented for HTML rendering
                break;

            // Repeat
            case CSI.REP: // Repeat preceding character
                // Not commonly used
                break;
        }
    }

    /**
     * Handle simple escape sequence.
     * @param {Object} token
     */
    _handleEscape(token) {
        const { intermediate, final: char } = token;

        if (intermediate === '') {
            switch (char) {
                case '7': // DECSC - Save Cursor
                    this._saveCursor();
                    break;
                case '8': // DECRC - Restore Cursor
                    this._restoreCursor();
                    break;
                case 'D': // IND - Index
                    this._lineFeed();
                    break;
                case 'E': // NEL - Next Line
                    this._carriageReturn();
                    this._lineFeed();
                    break;
                case 'H': // HTS - Horizontal Tab Set
                    this.tabStops.add(this.cursor.col);
                    break;
                case 'M': // RI - Reverse Index
                    this._reverseIndex();
                    break;
                case 'c': // RIS - Reset
                    this.reset();
                    break;
            }
        } else if (intermediate === '(' || intermediate === ')' ||
                   intermediate === '*' || intermediate === '+') {
            // Character set designation
            const setIndex = '()*+'.indexOf(intermediate);
            const setNames = ['g0', 'g1', 'g2', 'g3'];
            if (setIndex >= 0) {
                this.charsets[setNames[setIndex]] = char;
            }
        } else if (intermediate === '#') {
            if (char === '8') {
                // DECALN - Fill screen with E's
                this._fillScreen('E');
            }
        }
    }

    /**
     * Handle OSC sequence.
     * @param {Object} token
     */
    _handleOSC(token) {
        const { ps, pt } = token;

        switch (ps) {
            case OSC.SET_TITLE:
            case OSC.SET_TITLE_AND_ICON:
                this.title = pt;
                this.iconName = pt;
                this.onTitleChange?.(pt);
                break;
            case OSC.SET_ICON:
                this.iconName = pt;
                break;
            case OSC.HYPERLINK:
                // Format: 8;params;uri
                if (pt === '') {
                    this.activeHyperlink = null;
                } else {
                    const parts = pt.split(';');
                    if (parts.length >= 2) {
                        this.activeHyperlink = {
                            params: parts[0],
                            uri: parts.slice(1).join(';'),
                        };
                    }
                }
                break;
        }
    }

    /**
     * Move cursor by delta.
     * @param {number} dRow - Row delta
     * @param {number} dCol - Column delta
     */
    _moveCursor(dRow, dCol) {
        this._setCursor(this.cursor.row + dRow, this.cursor.col + dCol);
    }

    /**
     * Set cursor position (clamps to valid range).
     * @param {number} row
     * @param {number} col
     */
    _setCursor(row, col) {
        // Apply origin mode offset
        let minRow = 0;
        let maxRow = this.rows - 1;

        if (this.modes.originMode) {
            minRow = this.scrollTop;
            maxRow = this.scrollBottom;
            row += this.scrollTop;
        }

        this.cursor.row = Math.max(minRow, Math.min(maxRow, row));
        this.cursor.col = Math.max(0, Math.min(this.cols - 1, col));
    }

    /**
     * Erase in display.
     * @param {number} mode - 0: below, 1: above, 2: all, 3: all + scrollback
     */
    _eraseInDisplay(mode) {
        switch (mode) {
            case 0: // Erase below
                this._eraseInLine(0);
                for (let row = this.cursor.row + 1; row < this.rows; row++) {
                    this.buffer[row] = createLine(this.cols);
                    this._markDirty(row);
                }
                break;
            case 1: // Erase above
                this._eraseInLine(1);
                for (let row = 0; row < this.cursor.row; row++) {
                    this.buffer[row] = createLine(this.cols);
                    this._markDirty(row);
                }
                break;
            case 2: // Erase all
                for (let row = 0; row < this.rows; row++) {
                    this.buffer[row] = createLine(this.cols);
                }
                this.allDirty = true;
                break;
            case 3: // Erase all + scrollback
                this.scrollback = [];
                for (let row = 0; row < this.rows; row++) {
                    this.buffer[row] = createLine(this.cols);
                }
                this.allDirty = true;
                break;
        }
    }

    /**
     * Erase in line.
     * @param {number} mode - 0: to end, 1: to start, 2: entire line
     */
    _eraseInLine(mode) {
        const row = this.buffer[this.cursor.row];
        if (!row) return;

        let start, end;
        switch (mode) {
            case 0: // Erase to end
                start = this.cursor.col;
                end = this.cols;
                break;
            case 1: // Erase to start
                start = 0;
                end = this.cursor.col + 1;
                break;
            case 2: // Erase entire line
                start = 0;
                end = this.cols;
                break;
            default:
                return;
        }

        for (let col = start; col < end; col++) {
            row[col] = createCell();
        }
        this._markDirty(this.cursor.row);
    }

    /**
     * Erase characters at cursor.
     * @param {number} n - Number of characters
     */
    _eraseCharacters(n) {
        const row = this.buffer[this.cursor.row];
        if (!row) return;

        for (let i = 0; i < n && this.cursor.col + i < this.cols; i++) {
            row[this.cursor.col + i] = createCell();
        }
        this._markDirty(this.cursor.row);
    }

    /**
     * Insert lines at cursor.
     * @param {number} n - Number of lines
     */
    _insertLines(n) {
        if (this.cursor.row < this.scrollTop || this.cursor.row > this.scrollBottom) {
            return;
        }

        for (let i = 0; i < n; i++) {
            // Shift lines down
            for (let row = this.scrollBottom; row > this.cursor.row; row--) {
                this.buffer[row] = this.buffer[row - 1];
            }
            this.buffer[this.cursor.row] = createLine(this.cols);
        }
        this.allDirty = true;
    }

    /**
     * Delete lines at cursor.
     * @param {number} n - Number of lines
     */
    _deleteLines(n) {
        if (this.cursor.row < this.scrollTop || this.cursor.row > this.scrollBottom) {
            return;
        }

        for (let i = 0; i < n; i++) {
            // Shift lines up
            for (let row = this.cursor.row; row < this.scrollBottom; row++) {
                this.buffer[row] = this.buffer[row + 1];
            }
            this.buffer[this.scrollBottom] = createLine(this.cols);
        }
        this.allDirty = true;
    }

    /**
     * Insert characters at cursor.
     * @param {number} n - Number of characters
     */
    _insertCharacters(n) {
        const row = this.buffer[this.cursor.row];
        if (!row) return;

        for (let i = 0; i < n; i++) {
            // Shift right
            for (let col = this.cols - 1; col > this.cursor.col; col--) {
                row[col] = row[col - 1];
            }
            row[this.cursor.col] = createCell();
        }
        this._markDirty(this.cursor.row);
    }

    /**
     * Delete characters at cursor.
     * @param {number} n - Number of characters
     */
    _deleteCharacters(n) {
        const row = this.buffer[this.cursor.row];
        if (!row) return;

        for (let i = 0; i < n; i++) {
            // Shift left
            for (let col = this.cursor.col; col < this.cols - 1; col++) {
                row[col] = row[col + 1];
            }
            row[this.cols - 1] = createCell();
        }
        this._markDirty(this.cursor.row);
    }

    /**
     * Back tab - move to previous tab stop.
     */
    _backTab() {
        let prevStop = 0;
        for (const stop of this.tabStops) {
            if (stop < this.cursor.col) {
                prevStop = Math.max(prevStop, stop);
            }
        }
        this.cursor.col = prevStop;
    }

    /**
     * Set scroll region.
     * @param {number} top - Top row (0-indexed)
     * @param {number} bottom - Bottom row (0-indexed)
     */
    _setScrollRegion(top, bottom) {
        top = Math.max(0, Math.min(this.rows - 1, top));
        bottom = Math.max(0, Math.min(this.rows - 1, bottom));

        if (top < bottom) {
            this.scrollTop = top;
            this.scrollBottom = bottom;
        }

        // Move cursor to home
        this._setCursor(0, 0);
    }

    /**
     * Set ANSI mode.
     * @param {number} mode
     * @param {boolean} value
     */
    _setMode(mode, value) {
        switch (mode) {
            case 4: // IRM - Insert/Replace Mode
                this.modes.insertMode = value;
                break;
            case 20: // LNM - Line Feed/New Line Mode
                this.modes.linefeedMode = value;
                break;
        }
    }

    /**
     * Set DEC private mode.
     * @param {number} mode
     * @param {boolean} value
     */
    _setPrivateMode(mode, value) {
        switch (mode) {
            case DECMODE.DECCKM:
                this.modes.cursorKeys = value;
                break;
            case DECMODE.DECOM:
                this.modes.originMode = value;
                if (value) {
                    this._setCursor(0, 0);
                }
                break;
            case DECMODE.DECAWM:
                this.modes.autoWrap = value;
                break;
            case DECMODE.DECTCEM:
                this.modes.cursorVisible = value;
                this.cursor.visible = value;
                break;
            case DECMODE.DECSCNM:
                this.modes.reverseVideo = value;
                this.allDirty = true;
                break;
            case DECMODE.ALT_SCREEN:
                if (value) {
                    this._enterAltScreen();
                } else {
                    this._exitAltScreen();
                }
                break;
            case DECMODE.ALT_SCREEN_SAVE_CURSOR:
                if (value) {
                    this._saveCursor();
                    this._enterAltScreen();
                    this._eraseInDisplay(2);
                } else {
                    this._exitAltScreen();
                    this._restoreCursor();
                }
                break;
            case DECMODE.BRACKETED_PASTE:
                this.modes.bracketedPaste = value;
                break;
            case DECMODE.FOCUS_EVENT:
                this.modes.focusReporting = value;
                break;
            // Mouse modes
            case DECMODE.X10_MOUSE:
            case DECMODE.VT200_MOUSE:
            case DECMODE.BTN_EVENT_MOUSE:
            case DECMODE.ANY_EVENT_MOUSE:
                this.modes.mouseTracking = value ? mode : 0;
                break;
            case DECMODE.SGR_MOUSE:
            case DECMODE.UTF8_MOUSE:
            case DECMODE.URXVT_MOUSE:
                this.modes.mouseEncoding = value ? mode : 0;
                break;
        }
    }

    /**
     * Save cursor state.
     */
    _saveCursor() {
        this.savedCursor = {
            row: this.cursor.row,
            col: this.cursor.col,
            style: cloneStyle(this.style),
            originMode: this.modes.originMode,
            autoWrap: this.modes.autoWrap,
        };
    }

    /**
     * Restore cursor state.
     */
    _restoreCursor() {
        if (this.savedCursor) {
            this.cursor.row = this.savedCursor.row;
            this.cursor.col = this.savedCursor.col;
            this.style = cloneStyle(this.savedCursor.style);
            this.modes.originMode = this.savedCursor.originMode;
            this.modes.autoWrap = this.savedCursor.autoWrap;
        }
    }

    /**
     * Enter alternate screen buffer.
     */
    _enterAltScreen() {
        if (this.modes.altScreen) return;

        this.modes.altScreen = true;
        this.savedCursorAlt = {
            row: this.cursor.row,
            col: this.cursor.col,
        };

        // Create alternate buffer
        this.alternateBuffer = this._createBuffer();
        this.buffer = this.alternateBuffer;
        this.scrollback = []; // No scrollback in alt screen

        this.allDirty = true;
    }

    /**
     * Exit alternate screen buffer.
     */
    _exitAltScreen() {
        if (!this.modes.altScreen) return;

        this.modes.altScreen = false;

        // Restore primary buffer
        this.buffer = this.primaryBuffer;
        this.scrollback = this.primaryScrollback;
        this.alternateBuffer = null;

        // Restore cursor
        if (this.savedCursorAlt) {
            this.cursor.row = this.savedCursorAlt.row;
            this.cursor.col = this.savedCursorAlt.col;
        }

        this.allDirty = true;
    }

    /**
     * Fill screen with a character.
     * @param {string} char
     */
    _fillScreen(char) {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                this.buffer[row][col] = {
                    char,
                    width: 1,
                    style: createDefaultStyle(),
                };
            }
        }
        this.allDirty = true;
    }

    /**
     * Mark a line as dirty.
     * @param {number} row
     */
    _markDirty(row) {
        this.dirtyLines.add(row);
    }

    /**
     * Clear dirty state.
     */
    clearDirty() {
        this.dirtyLines.clear();
        this.allDirty = false;
    }

    /**
     * Resize the terminal.
     * @param {number} newCols
     * @param {number} newRows
     */
    resize(newCols, newRows) {
        if (newCols === this.cols && newRows === this.rows) {
            return;
        }

        const oldCols = this.cols;
        const oldRows = this.rows;

        this.cols = newCols;
        this.rows = newRows;

        // Resize primary buffer
        this._resizeBuffer(this.primaryBuffer, oldCols, oldRows, newCols, newRows);

        // Resize alternate buffer if exists
        if (this.alternateBuffer) {
            this._resizeBuffer(this.alternateBuffer, oldCols, oldRows, newCols, newRows);
        }

        // Adjust scroll region
        this.scrollTop = Math.min(this.scrollTop, newRows - 1);
        this.scrollBottom = Math.min(this.scrollBottom, newRows - 1);

        // Adjust cursor
        this.cursor.row = Math.min(this.cursor.row, newRows - 1);
        this.cursor.col = Math.min(this.cursor.col, newCols - 1);

        // Reset tab stops
        this._resetTabStops();

        this.allDirty = true;
        this.onResize?.(newCols, newRows);
    }

    /**
     * Resize a buffer.
     * @param {Object[][]} buffer
     * @param {number} oldCols
     * @param {number} oldRows
     * @param {number} newCols
     * @param {number} newRows
     */
    _resizeBuffer(buffer, oldCols, oldRows, newCols, newRows) {
        // Add or remove rows
        while (buffer.length < newRows) {
            buffer.push(createLine(newCols));
        }
        while (buffer.length > newRows) {
            buffer.pop();
        }

        // Resize each row
        for (let row = 0; row < buffer.length; row++) {
            const line = buffer[row];
            while (line.length < newCols) {
                line.push(createCell());
            }
            while (line.length > newCols) {
                line.pop();
            }
        }
    }

    /**
     * Reset terminal to initial state.
     */
    reset() {
        this.primaryBuffer = this._createBuffer();
        this.primaryScrollback = [];
        this.alternateBuffer = null;
        this.buffer = this.primaryBuffer;
        this.scrollback = this.primaryScrollback;

        this.cursor = {
            row: 0,
            col: 0,
            visible: true,
            style: 'block',
            blinking: true,
        };
        this.savedCursor = null;
        this.savedCursorAlt = null;

        this.style = createDefaultStyle();

        this.scrollTop = 0;
        this.scrollBottom = this.rows - 1;

        this._resetTabStops();

        this.modes = {
            cursorKeys: false,
            originMode: false,
            autoWrap: true,
            cursorVisible: true,
            reverseVideo: false,
            insertMode: false,
            linefeedMode: false,
            altScreen: false,
            bracketedPaste: false,
            mouseTracking: 0,
            mouseEncoding: 0,
            focusReporting: false,
        };

        this.charsets = {
            g0: 'B',
            g1: '0',
            g2: 'B',
            g3: 'B',
            gl: 0,
            gr: 1,
        };

        this.activeHyperlink = null;
        this.title = '';
        this.iconName = '';

        this.parser.reset();
        this.allDirty = true;
    }

    /**
     * Get text content of the terminal (no formatting).
     * @param {Object} options
     * @returns {string}
     */
    getText(options = {}) {
        const { includeScrollback = false, trimTrailingWhitespace = true } = options;
        const lines = [];

        // Scrollback
        if (includeScrollback) {
            for (const line of this.scrollback) {
                lines.push(this._lineToText(line, trimTrailingWhitespace));
            }
        }

        // Current buffer
        for (const line of this.buffer) {
            lines.push(this._lineToText(line, trimTrailingWhitespace));
        }

        return lines.join('\n');
    }

    /**
     * Convert a line to text.
     * @param {Object[]} line
     * @param {boolean} trim
     * @returns {string}
     */
    _lineToText(line, trim = true) {
        let text = line.map(cell => cell.char).join('');
        if (trim) {
            text = text.trimEnd();
        }
        return text;
    }

    /**
     * Render terminal to HTML.
     * @param {Object} options
     * @returns {string}
     */
    toHtml(options = {}) {
        const {
            includeScrollback = false,
            useClasses = true,
            showCursor = true,
        } = options;

        let html = '<div class="terminal-output">';

        // Scrollback
        if (includeScrollback) {
            for (const line of this.scrollback) {
                html += this._lineToHtml(line, -1, -1, useClasses);
            }
        }

        // Current buffer
        for (let row = 0; row < this.rows; row++) {
            const cursorCol = (showCursor && this.cursor.visible && row === this.cursor.row)
                ? this.cursor.col : -1;
            html += this._lineToHtml(this.buffer[row], row, cursorCol, useClasses);
        }

        html += '</div>';
        return html;
    }

    /**
     * Convert a line to HTML.
     * @param {Object[]} line
     * @param {number} row
     * @param {number} cursorCol
     * @param {boolean} useClasses
     * @returns {string}
     */
    _lineToHtml(line, row, cursorCol, useClasses) {
        let html = '<div class="terminal-line">';

        let currentStyle = null;
        let spanOpen = false;

        for (let col = 0; col < line.length; col++) {
            const cell = line[col];
            const isCursor = col === cursorCol;

            // Check if style changed
            const styleChanged = !this._stylesEqual(cell.style, currentStyle);

            if (styleChanged || isCursor) {
                if (spanOpen) {
                    html += '</span>';
                    spanOpen = false;
                }

                // Build class/style string
                let attrs = '';
                if (useClasses) {
                    const classes = styleToClasses(cell.style);
                    if (isCursor) classes.push('terminal-cursor');
                    if (classes.length > 0) {
                        attrs = ` class="${classes.join(' ')}"`;
                    }
                } else {
                    const style = styleToInlineCSS(cell.style);
                    if (style || isCursor) {
                        let fullStyle = style;
                        if (isCursor) {
                            fullStyle += fullStyle ? '; ' : '';
                            fullStyle += 'background: #aeafad; color: #000';
                        }
                        attrs = ` style="${fullStyle}"`;
                    }
                }

                // Add hyperlink
                if (cell.hyperlink) {
                    html += `<a href="${this._escapeHtml(cell.hyperlink.uri)}"${attrs}>`;
                    spanOpen = true;
                } else if (attrs) {
                    html += `<span${attrs}>`;
                    spanOpen = true;
                }

                currentStyle = cell.style;
            }

            html += this._escapeHtml(cell.char);
        }

        if (spanOpen) {
            html += '</span>';
        }

        html += '</div>\n';
        return html;
    }

    /**
     * Check if two styles are equal.
     */
    _stylesEqual(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;

        return (
            a.fg === b.fg &&
            a.bg === b.bg &&
            a.bold === b.bold &&
            a.dim === b.dim &&
            a.italic === b.italic &&
            a.underline === b.underline &&
            a.blink === b.blink &&
            a.reverse === b.reverse &&
            a.hidden === b.hidden &&
            a.strikethrough === b.strikethrough
        );
    }

    /**
     * Escape HTML special characters.
     */
    _escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

export default TerminalState;

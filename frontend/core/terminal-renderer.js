/**
 * mrmd Terminal Renderer
 *
 * Functions for rendering terminal output to HTML.
 * Uses the TerminalState model for proper escape code handling.
 *
 * Two modes:
 * 1. Full terminal emulation: Use TerminalState for interactive content
 * 2. Simple rendering: Quick ANSI-to-HTML for static output
 */

import { TerminalState } from './terminal-state.js';
import { AnsiParser } from './ansi-parser.js';
import {
    createDefaultStyle,
    cloneStyle,
    applySGR,
    colorToCSS,
    styleToClasses,
    styleToInlineCSS,
    STANDARD_COLORS,
} from './ansi-sgr.js';

/**
 * Convert a terminal color index to CSS color value.
 * @param {string|number} c - Color name or index
 * @returns {string} CSS color
 */
export function colorCSS(c) {
    // Named colors (legacy support)
    const named = {
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
    };

    if (typeof c === 'string' && named[c]) {
        return named[c];
    }

    // Color index
    if (typeof c === 'number' && c >= 0 && c < 16) {
        const color = STANDARD_COLORS[c];
        return `rgb(${color.r}, ${color.g}, ${color.b})`;
    }

    return '#e0e0e0';
}

/**
 * Render terminal state to HTML string.
 * @param {Object} terminalState - Terminal state with lines, cursor, lines_with_style
 * @returns {string} HTML string
 */
export function renderTerminalToHtml(terminalState) {
    if (!terminalState?.lines) return '';

    // If we have a TerminalState instance, use its native rendering
    if (terminalState instanceof TerminalState) {
        return terminalState.toHtml();
    }

    // Legacy format: convert to HTML
    let html = '';
    const styled = terminalState.lines_with_style || [];

    terminalState.lines.forEach((line, row) => {
        const styledRow = styled[row];
        const cols = Math.max(
            line.length,
            row === terminalState.cursor?.row ? terminalState.cursor.col + 1 : 0
        );

        for (let col = 0; col < cols; col++) {
            const char = line[col] || ' ';
            let style = '';
            let cls = '';

            if (styledRow?.[col]) {
                const cell = styledRow[col];
                if (cell.fg && cell.fg !== 'default') {
                    style += `color:${colorCSS(cell.fg)};`;
                }
                if (cell.bg && cell.bg !== 'default') {
                    style += `background-color:${colorCSS(cell.bg)};`;
                }
                if (cell.bold) style += 'font-weight:bold;';
                if (cell.italic) style += 'font-style:italic;';
                if (cell.underline) style += 'text-decoration:underline;';
                if (cell.strikethrough) style += 'text-decoration:line-through;';
            }

            if (row === terminalState.cursor?.row && col === terminalState.cursor?.col) {
                cls = 'cursor';
            }

            const ch = char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += style || cls
                ? `<span class="${cls}" style="${style}">${ch}</span>`
                : ch;
        }
        html += '\n';
    });

    return html;
}

/**
 * Convert key event to terminal key sequence.
 * @param {KeyboardEvent} e - Keyboard event
 * @returns {string|null} Key sequence string or null if not handled
 */
export function keyEventToTerminalSequence(e) {
    // Modifier keys alone
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
        return null;
    }

    // Control sequences
    if (e.ctrlKey && e.key.length === 1) {
        const code = e.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
            // Ctrl+A-Z -> codes 1-26
            return String.fromCharCode(code - 96);
        }
        return `<ctrl+${e.key.toLowerCase()}>`;
    }

    // Special keys
    const specialKeys = {
        Enter: '\r',
        Tab: '\t',
        Backspace: '\x7f',
        Delete: '\x1b[3~',
        Escape: '\x1b',
        ArrowUp: '\x1b[A',
        ArrowDown: '\x1b[B',
        ArrowRight: '\x1b[C',
        ArrowLeft: '\x1b[D',
        Home: '\x1b[H',
        End: '\x1b[F',
        PageUp: '\x1b[5~',
        PageDown: '\x1b[6~',
        Insert: '\x1b[2~',
        F1: '\x1bOP',
        F2: '\x1bOQ',
        F3: '\x1bOR',
        F4: '\x1bOS',
        F5: '\x1b[15~',
        F6: '\x1b[17~',
        F7: '\x1b[18~',
        F8: '\x1b[19~',
        F9: '\x1b[20~',
        F10: '\x1b[21~',
        F11: '\x1b[23~',
        F12: '\x1b[24~',
    };

    if (specialKeys[e.key]) {
        return specialKeys[e.key];
    }

    // Regular characters
    if (e.key.length === 1) {
        return e.key;
    }

    return null;
}

/**
 * Simple ANSI to HTML converter.
 * For quick rendering of static output without full terminal emulation.
 *
 * @param {string} text - Text with ANSI escape codes
 * @param {Object} options - Options
 * @param {boolean} options.useClasses - Use CSS classes (default true)
 * @param {boolean} options.preserveWhitespace - Preserve whitespace (default true)
 * @returns {string} HTML string
 */
export function ansiToHtml(text, options = {}) {
    const { useClasses = true, preserveWhitespace = true } = options;

    if (!text) return '';

    const parser = new AnsiParser();
    let style = createDefaultStyle();
    let html = '';
    let inSpan = false;
    let currentClasses = '';

    for (const token of parser.parse(text)) {
        switch (token.type) {
            case 'print':
                // Check if we need to update the span
                const classes = useClasses ? styleToClasses(style).join(' ') : '';
                if (classes !== currentClasses) {
                    if (inSpan) {
                        html += '</span>';
                        inSpan = false;
                    }
                    if (classes) {
                        html += `<span class="${classes}">`;
                        inSpan = true;
                    }
                    currentClasses = classes;
                }
                html += escapeHtml(token.char);
                break;

            case 'csi':
                if (token.final === 'm') {
                    applySGR(style, token.params);
                }
                break;

            case 'lf':
                html += '\n';
                break;

            case 'cr':
                // Handle CR for progress bars: erase current line
                // Find the last newline and truncate
                const lastNewline = html.lastIndexOf('\n');
                if (lastNewline !== -1) {
                    // Close any open span
                    if (inSpan) {
                        html = html.substring(0, lastNewline + 1);
                        inSpan = false;
                        currentClasses = '';
                    } else {
                        html = html.substring(0, lastNewline + 1);
                    }
                } else {
                    // No newline - clear everything
                    if (inSpan) {
                        inSpan = false;
                        currentClasses = '';
                    }
                    html = '';
                }
                break;

            case 'tab':
                html += '        '.substring(0, 8 - (html.length % 8));
                break;

            case 'bs':
                // Backspace - remove last character if possible
                if (html.length > 0 && html[html.length - 1] !== '\n') {
                    // Check if we're in a span
                    if (html.endsWith('</span>')) {
                        // More complex handling needed
                    } else {
                        html = html.slice(0, -1);
                    }
                }
                break;
        }
    }

    if (inSpan) {
        html += '</span>';
    }

    // Wrap in pre if preserving whitespace
    if (preserveWhitespace) {
        return `<pre class="terminal-output">${html}</pre>`;
    }

    return html;
}

/**
 * Strip ANSI escape codes from text.
 * @param {string} text - Text with ANSI codes
 * @returns {string} Plain text
 */
export function stripAnsi(text) {
    if (!text) return '';

    const parser = new AnsiParser();
    let result = '';

    for (const token of parser.parse(text)) {
        switch (token.type) {
            case 'print':
                result += token.char;
                break;
            case 'lf':
                result += '\n';
                break;
            case 'cr':
                // Handle CR - find last newline
                const lastNewline = result.lastIndexOf('\n');
                if (lastNewline !== -1) {
                    result = result.substring(0, lastNewline + 1);
                } else {
                    result = '';
                }
                break;
            case 'tab':
                result += '\t';
                break;
        }
    }

    return result;
}

/**
 * Create a TerminalState instance for rendering.
 * @param {number} cols - Number of columns
 * @param {number} rows - Number of rows
 * @param {Object} options - Options passed to TerminalState
 * @returns {TerminalState}
 */
export function createTerminalState(cols = 80, rows = 24, options = {}) {
    return new TerminalState(cols, rows, options);
}

/**
 * Render terminal output with full emulation.
 * Handles all escape codes including cursor movement, screen clearing, etc.
 *
 * @param {string} text - Terminal output text
 * @param {Object} options - Options
 * @param {number} options.cols - Number of columns (default 80)
 * @param {number} options.rows - Number of rows (default 24)
 * @param {boolean} options.showCursor - Show cursor position (default false)
 * @returns {string} HTML string
 */
export function renderTerminalOutput(text, options = {}) {
    const { cols = 80, rows = 24, showCursor = false } = options;

    const term = new TerminalState(cols, rows);
    term.write(text);

    return term.toHtml({ showCursor });
}

/**
 * Process terminal output for display.
 * Handles carriage returns for progress bar simulation.
 *
 * @param {string} text - Raw terminal output
 * @returns {string} Processed text (last state after CR handling)
 */
export function processTerminalOutput(text) {
    if (!text) return '';

    const lines = [];
    let currentLine = '';

    for (const char of text) {
        if (char === '\r') {
            // Carriage return - reset to beginning of line
            currentLine = '';
        } else if (char === '\n') {
            // Line feed - save current line and start new
            lines.push(currentLine);
            currentLine = '';
        } else {
            currentLine += char;
        }
    }

    // Don't forget the last line
    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.join('\n');
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    switch (str) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return str;
    }
}

// Export the TerminalState class for direct use
export { TerminalState };

// Default export for convenience
export default {
    colorCSS,
    renderTerminalToHtml,
    keyEventToTerminalSequence,
    ansiToHtml,
    stripAnsi,
    createTerminalState,
    renderTerminalOutput,
    processTerminalOutput,
    TerminalState,
};

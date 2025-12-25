/**
 * mrmd Terminal Renderer
 *
 * Pure functions for rendering terminal state to HTML.
 */

/**
 * Convert a terminal color name to CSS color value.
 */
export function colorCSS(c) {
    const basic = {
        red: '#ff5f56',
        green: '#5af78e',
        yellow: '#f3f99d',
        blue: '#57c7ff',
        magenta: '#ff6ac1',
        cyan: '#9aedfe',
        white: '#f1f1f0'
    };
    return basic[c] || '#e0e0e0';
}

/**
 * Render terminal state to HTML string.
 * @param {Object} terminalState - Terminal state with lines, cursor, lines_with_style
 * @returns {string} HTML string
 */
export function renderTerminalToHtml(terminalState) {
    if (!terminalState?.lines) return '';

    let html = '';
    const styled = terminalState.lines_with_style || [];

    terminalState.lines.forEach((line, row) => {
        const styledRow = styled[row];
        const cols = Math.max(line.length, (row === terminalState.cursor?.row ? terminalState.cursor.col + 1 : 0));

        for (let col = 0; col < cols; col++) {
            const char = line[col] || ' ';
            let style = '', cls = '';

            if (styledRow?.[col]) {
                const cell = styledRow[col];
                if (cell.fg && cell.fg !== 'default') style += `color:${colorCSS(cell.fg)};`;
                if (cell.bold) style += 'font-weight:bold;';
            }

            if (row === terminalState.cursor?.row && col === terminalState.cursor?.col) {
                cls = 'cursor';
            }

            const ch = char.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += (style || cls) ? `<span class="${cls}" style="${style}">${ch}</span>` : ch;
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
    if (e.ctrlKey && e.key.length === 1) return `<ctrl+${e.key.toLowerCase()}>`;
    if (e.key === 'Enter') return '<enter>';
    if (e.key === 'Tab') return '<tab>';
    if (e.key === 'Backspace') return '<backspace>';
    if (e.key === 'ArrowUp') return '<up>';
    if (e.key === 'ArrowDown') return '<down>';
    if (e.key === 'ArrowLeft') return '<left>';
    if (e.key === 'ArrowRight') return '<right>';
    if (e.key.length === 1) return e.key;
    return null;
}

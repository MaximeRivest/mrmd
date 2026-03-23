/**
 * Terminal Buffer for the mrmd monitor subsystem.
 *
 * Processes streaming terminal output with proper cursor movement and ANSI handling.
 * Enables progress bars (tqdm, rich) to display correctly during execution.
 *
 * This is a simplified version of mrmd-editor's terminal.js for Node.js usage.
 * Output is processed to plain text for document storage.
 *
 * @module mrmd/monitor/terminal
 */

/**
 * Terminal buffer that processes cursor movement and ANSI codes
 */
export class TerminalBuffer {
  constructor() {
    /** @type {string[][]} Lines of characters */
    this._lines = [[]];
    /** @type {number} Current row */
    this._row = 0;
    /** @type {number} Current column */
    this._col = 0;
    /** @type {{row: number, col: number}|null} Saved cursor position */
    this._savedCursor = null;
  }

  /**
   * Process terminal output and write to buffer
   * @param {string} text - Raw terminal output with escape sequences
   */
  write(text) {
    let i = 0;

    while (i < text.length) {
      // Check for escape sequence
      if (text[i] === '\x1b' && text[i + 1] === '[') {
        i = this._parseEscapeSequence(text, i);
        continue;
      }

      // Handle special characters
      const char = text[i];

      if (char === '\r') {
        // Carriage return - back to start of line
        this._col = 0;
      } else if (char === '\n') {
        // Newline - next line, column 0
        this._row++;
        this._col = 0;
        this._ensureRow(this._row);
      } else if (char === '\b') {
        // Backspace
        this._col = Math.max(0, this._col - 1);
      } else if (char === '\t') {
        // Tab - move to next 8-column boundary
        this._col = Math.floor(this._col / 8) * 8 + 8;
      } else if (char.charCodeAt(0) >= 32) {
        // Printable character
        this._writeChar(char);
      }
      // Ignore other control characters

      i++;
    }
  }

  /**
   * Parse an escape sequence starting at position i
   * @param {string} text
   * @param {number} i
   * @returns {number} Next index
   */
  _parseEscapeSequence(text, i) {
    // Skip \x1b[
    let j = i + 2;

    // Check for DEC private mode prefix '?'
    const isPrivateMode = text[j] === '?';
    if (isPrivateMode) j++;

    // Collect parameter bytes (digits and semicolons)
    let params = '';
    while (j < text.length && /[0-9;]/.test(text[j])) {
      params += text[j];
      j++;
    }

    // Get command byte
    const cmd = text[j] || '';
    j++;

    // Ignore DEC private modes and SGR (colors/styles) - we output plain text
    if (isPrivateMode || cmd === 'm') {
      return j;
    }

    // Parse parameter numbers
    const nums = params ? params.split(';').map(n => parseInt(n) || 0) : [];
    const n = nums[0] || 1;

    switch (cmd) {
      case 'A': // Cursor Up
        this._row = Math.max(0, this._row - n);
        break;

      case 'B': // Cursor Down
        this._row += n;
        this._ensureRow(this._row);
        break;

      case 'C': // Cursor Forward (Right)
        this._col += n;
        break;

      case 'D': // Cursor Back (Left)
        this._col = Math.max(0, this._col - n);
        break;

      case 'E': // Cursor Next Line
        this._row += n;
        this._col = 0;
        this._ensureRow(this._row);
        break;

      case 'F': // Cursor Previous Line
        this._row = Math.max(0, this._row - n);
        this._col = 0;
        break;

      case 'G': // Cursor Horizontal Absolute
        this._col = Math.max(0, n - 1);
        break;

      case 'H': // Cursor Position (row;col)
      case 'f':
        this._row = Math.max(0, (nums[0] || 1) - 1);
        this._col = Math.max(0, (nums[1] || 1) - 1);
        this._ensureRow(this._row);
        break;

      case 'J': // Erase in Display
        if (n === 0 || params === '') {
          this._clearToEndOfScreen();
        } else if (n === 1) {
          this._clearFromStartOfScreen();
        } else if (n === 2 || n === 3) {
          this._clearScreen();
        }
        break;

      case 'K': // Erase in Line
        if (n === 0 || params === '') {
          this._clearToEndOfLine();
        } else if (n === 1) {
          this._clearFromStartOfLine();
        } else if (n === 2) {
          this._clearLine();
        }
        break;

      case 's': // Save Cursor Position
        this._savedCursor = { row: this._row, col: this._col };
        break;

      case 'u': // Restore Cursor Position
        if (this._savedCursor) {
          this._row = this._savedCursor.row;
          this._col = this._savedCursor.col;
        }
        break;
    }

    return j;
  }

  /**
   * Write a character at current cursor position
   * @param {string} char
   */
  _writeChar(char) {
    this._ensureRow(this._row);
    const line = this._lines[this._row];

    // Extend line if needed
    while (line.length <= this._col) {
      line.push(' ');
    }

    // Write character
    line[this._col] = char;
    this._col++;
  }

  /** @param {number} row */
  _ensureRow(row) {
    while (this._lines.length <= row) {
      this._lines.push([]);
    }
  }

  _clearToEndOfLine() {
    if (this._lines[this._row]) {
      this._lines[this._row] = this._lines[this._row].slice(0, this._col);
    }
  }

  _clearFromStartOfLine() {
    if (this._lines[this._row]) {
      const line = this._lines[this._row];
      for (let i = 0; i <= this._col && i < line.length; i++) {
        line[i] = ' ';
      }
    }
  }

  _clearLine() {
    this._lines[this._row] = [];
  }

  _clearToEndOfScreen() {
    this._clearToEndOfLine();
    for (let r = this._row + 1; r < this._lines.length; r++) {
      this._lines[r] = [];
    }
  }

  _clearFromStartOfScreen() {
    for (let r = 0; r < this._row; r++) {
      this._lines[r] = [];
    }
    this._clearFromStartOfLine();
  }

  _clearScreen() {
    this._lines = [[]];
    this._row = 0;
    this._col = 0;
  }

  /**
   * Convert buffer to plain text (for document storage)
   * @returns {string}
   */
  toString() {
    const output = [];

    for (const line of this._lines) {
      let lineText = line.join('');
      // Trim trailing spaces
      output.push(lineText.trimEnd());
    }

    // Trim trailing empty lines
    while (output.length > 0 && output[output.length - 1] === '') {
      output.pop();
    }

    return output.join('\n');
  }

  /**
   * Clear the buffer and reset cursor
   */
  clear() {
    this._lines = [[]];
    this._row = 0;
    this._col = 0;
    this._savedCursor = null;
  }

  /**
   * Get current line count
   * @returns {number}
   */
  get lineCount() {
    return this._lines.length;
  }
}

/**
 * Process terminal output through a buffer
 *
 * Convenience function for one-shot processing.
 *
 * @param {string} text - Raw terminal output
 * @returns {string} - Processed plain text
 */
export function processTerminalOutput(text) {
  const buffer = new TerminalBuffer();
  buffer.write(text);
  return buffer.toString();
}

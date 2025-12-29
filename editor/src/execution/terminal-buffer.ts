/**
 * Terminal Buffer with ANSI Support
 *
 * Provides proper terminal emulation for:
 * - Cursor movement (up/down/left/right)
 * - Line clearing
 * - Carriage return handling
 * - ANSI SGR (color/style) preservation
 *
 * Used to process streaming output from tools like Rich, tqdm, etc.
 */

/** Style state for a character cell */
interface CellStyle {
  fg: string | null;      // Foreground color name (e.g., 'red', 'bright-green')
  bg: string | null;      // Background color name
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
}

/** A single character cell in the terminal buffer */
interface Cell {
  char: string;
  style: CellStyle;
}

/** Create default style */
function createDefaultStyle(): CellStyle {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
  };
}

/** Clone a style */
function cloneStyle(style: CellStyle): CellStyle {
  return { ...style };
}

/** Check if two styles are equal */
function stylesEqual(a: CellStyle, b: CellStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse
  );
}

/** Check if style has any active attributes */
function hasStyle(style: CellStyle): boolean {
  return (
    style.fg !== null ||
    style.bg !== null ||
    style.bold ||
    style.dim ||
    style.italic ||
    style.underline ||
    style.strikethrough ||
    style.inverse
  );
}

/** ANSI color code to name mapping */
const FG_COLORS: Record<number, string> = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow',
  34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
  90: 'bright-black', 91: 'bright-red', 92: 'bright-green', 93: 'bright-yellow',
  94: 'bright-blue', 95: 'bright-magenta', 96: 'bright-cyan', 97: 'bright-white',
};

const BG_COLORS: Record<number, string> = {
  40: 'black', 41: 'red', 42: 'green', 43: 'yellow',
  44: 'blue', 45: 'magenta', 46: 'cyan', 47: 'white',
  100: 'bright-black', 101: 'bright-red', 102: 'bright-green', 103: 'bright-yellow',
  104: 'bright-blue', 105: 'bright-magenta', 106: 'bright-cyan', 107: 'bright-white',
};

/**
 * Terminal buffer that properly handles cursor movement and ANSI codes
 */
export class TerminalBuffer {
  private lines: Cell[][] = [[]];
  private row = 0;
  private col = 0;
  private currentStyle: CellStyle = createDefaultStyle();
  private savedCursor: { row: number; col: number } | null = null;

  // Debug logging (disabled by default)
  public debug = false;
  private debugId = Math.random().toString(36).slice(2, 6);

  /**
   * Process terminal output and write to buffer
   */
  write(text: string): void {
    if (this.debug) {
      console.log(`[TB:${this.debugId}] write() called with ${text.length} chars`);
      console.log(`[TB:${this.debugId}] Current position: row=${this.row}, col=${this.col}, lines=${this.lines.length}`);
    }

    let i = 0;
    let escapeCount = 0;
    let charCount = 0;

    while (i < text.length) {
      // Check for escape sequence
      if (text[i] === '\x1b' && text[i + 1] === '[') {
        const prevRow = this.row;
        const prevCol = this.col;
        const result = this.parseEscapeSequence(text, i);
        escapeCount++;

        if (this.debug && (this.row !== prevRow || this.col !== prevCol)) {
          console.log(`[TB:${this.debugId}] Cursor moved: (${prevRow},${prevCol}) -> (${this.row},${this.col})`);
        }

        i = result.nextIndex;
        continue;
      }

      // Handle special characters
      const char = text[i];
      if (char === '\r') {
        if (this.debug) console.log(`[TB:${this.debugId}] \\r at row=${this.row}, col ${this.col} -> 0`);
        this.col = 0;
      } else if (char === '\n') {
        if (this.debug) console.log(`[TB:${this.debugId}] \\n at row=${this.row} -> ${this.row + 1}`);
        this.row++;
        this.col = 0;
        this.ensureRow(this.row);
      } else if (char === '\b') {
        // Backspace
        this.col = Math.max(0, this.col - 1);
      } else if (char === '\t') {
        // Tab - move to next 8-column boundary
        const nextTab = Math.floor(this.col / 8) * 8 + 8;
        this.col = nextTab;
      } else if (char.charCodeAt(0) >= 32 || char === '\x1b') {
        // Printable character (or escape that wasn't a sequence)
        this.writeChar(char);
        charCount++;
      }
      // Ignore other control characters

      i++;
    }

    if (this.debug) {
      console.log(`[TB:${this.debugId}] write() done: ${charCount} chars written, ${escapeCount} escapes processed`);
      console.log(`[TB:${this.debugId}] Final position: row=${this.row}, col=${this.col}, lines=${this.lines.length}`);
    }
  }

  /**
   * Parse an escape sequence starting at position i
   */
  private parseEscapeSequence(text: string, i: number): { nextIndex: number } {
    // Skip \x1b[
    let j = i + 2;

    // Check for DEC private mode prefix '?'
    // These are sequences like ESC[?25h (show cursor), ESC[?25l (hide cursor),
    // ESC[?1049h (alternate screen buffer), etc.
    const isPrivateMode = text[j] === '?';
    if (isPrivateMode) {
      j++; // Skip the '?'
    }

    // Collect parameter bytes (digits and semicolons)
    let params = '';
    while (j < text.length && /[0-9;]/.test(text[j])) {
      params += text[j];
      j++;
    }

    // Get command byte
    const cmd = text[j] || '';
    j++;

    // DEC private modes don't affect text content, so we ignore them
    // Common private modes:
    // ?25h/l - Show/hide cursor
    // ?1049h/l - Alternate screen buffer
    // ?7h/l - Auto-wrap mode
    // ?1h/l - Application cursor keys
    // ?12h/l - Start/stop blinking cursor
    if (isPrivateMode) {
      if (this.debug) {
        console.log(`[TB:${this.debugId}] DEC private mode: ESC[?${params}${cmd} (ignored)`);
      }
      return { nextIndex: j };
    }

    // Parse parameter numbers
    const nums = params ? params.split(';').map(n => parseInt(n) || 0) : [];
    const n = nums[0] || 1;

    if (this.debug && cmd !== 'm') {
      // Log non-SGR commands (cursor movement, clearing, etc.)
      console.log(`[TB:${this.debugId}] ESC[${params}${cmd} (n=${n}, nums=[${nums.join(',')}])`);
    }

    switch (cmd) {
      case 'm': // SGR - Select Graphic Rendition (colors/styles)
        this.applySgr(nums.length > 0 ? nums : [0]);
        break;

      case 'A': // Cursor Up
        if (this.debug) console.log(`[TB:${this.debugId}] Cursor UP ${n}: row ${this.row} -> ${Math.max(0, this.row - n)}`);
        this.row = Math.max(0, this.row - n);
        break;

      case 'B': // Cursor Down
        this.row += n;
        this.ensureRow(this.row);
        break;

      case 'C': // Cursor Forward (Right)
        this.col += n;
        break;

      case 'D': // Cursor Back (Left)
        this.col = Math.max(0, this.col - n);
        break;

      case 'E': // Cursor Next Line
        this.row += n;
        this.col = 0;
        this.ensureRow(this.row);
        break;

      case 'F': // Cursor Previous Line
        this.row = Math.max(0, this.row - n);
        this.col = 0;
        break;

      case 'G': // Cursor Horizontal Absolute
        this.col = Math.max(0, n - 1);
        break;

      case 'H': // Cursor Position (row;col)
      case 'f':
        this.row = Math.max(0, (nums[0] || 1) - 1);
        this.col = Math.max(0, (nums[1] || 1) - 1);
        this.ensureRow(this.row);
        break;

      case 'J': // Erase in Display
        if (n === 0 || params === '') {
          // Clear from cursor to end of screen
          this.clearToEndOfScreen();
        } else if (n === 1) {
          // Clear from start of screen to cursor
          this.clearFromStartOfScreen();
        } else if (n === 2 || n === 3) {
          // Clear entire screen
          this.clearScreen();
        }
        break;

      case 'K': // Erase in Line
        if (n === 0 || params === '') {
          // Clear from cursor to end of line
          this.clearToEndOfLine();
        } else if (n === 1) {
          // Clear from start of line to cursor
          this.clearFromStartOfLine();
        } else if (n === 2) {
          // Clear entire line
          this.clearLine();
        }
        break;

      case 's': // Save Cursor Position
        this.savedCursor = { row: this.row, col: this.col };
        break;

      case 'u': // Restore Cursor Position
        if (this.savedCursor) {
          this.row = this.savedCursor.row;
          this.col = this.savedCursor.col;
        }
        break;

      // Ignore other sequences (like OSC, etc.)
    }

    return { nextIndex: j };
  }

  /**
   * Apply SGR (Select Graphic Rendition) codes
   */
  private applySgr(codes: number[]): void {
    let i = 0;
    while (i < codes.length) {
      const code = codes[i];

      switch (code) {
        case 0: // Reset
          this.currentStyle = createDefaultStyle();
          break;
        case 1:
          this.currentStyle.bold = true;
          break;
        case 2:
          this.currentStyle.dim = true;
          break;
        case 3:
          this.currentStyle.italic = true;
          break;
        case 4:
          this.currentStyle.underline = true;
          break;
        case 7:
          this.currentStyle.inverse = true;
          break;
        case 9:
          this.currentStyle.strikethrough = true;
          break;
        case 22:
          this.currentStyle.bold = false;
          this.currentStyle.dim = false;
          break;
        case 23:
          this.currentStyle.italic = false;
          break;
        case 24:
          this.currentStyle.underline = false;
          break;
        case 27:
          this.currentStyle.inverse = false;
          break;
        case 29:
          this.currentStyle.strikethrough = false;
          break;
        case 39:
          this.currentStyle.fg = null;
          break;
        case 49:
          this.currentStyle.bg = null;
          break;
        default:
          // Foreground colors
          if (FG_COLORS[code]) {
            this.currentStyle.fg = FG_COLORS[code];
          }
          // Background colors
          else if (BG_COLORS[code]) {
            this.currentStyle.bg = BG_COLORS[code];
          }
          // 256-color: 38;5;n or 48;5;n
          else if (code === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
            this.currentStyle.fg = `256-${codes[i + 2]}`;
            i += 2;
          } else if (code === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
            this.currentStyle.bg = `256-${codes[i + 2]}`;
            i += 2;
          }
          // 24-bit RGB: 38;2;r;g;b or 48;2;r;g;b
          else if (code === 38 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
            this.currentStyle.fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
            i += 4;
          } else if (code === 48 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
            this.currentStyle.bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
            i += 4;
          }
      }
      i++;
    }
  }

  /**
   * Write a character at current cursor position
   */
  private writeChar(char: string): void {
    this.ensureRow(this.row);
    const line = this.lines[this.row];

    // Extend line if needed
    while (line.length <= this.col) {
      line.push({ char: ' ', style: createDefaultStyle() });
    }

    // Write character with current style
    line[this.col] = {
      char,
      style: cloneStyle(this.currentStyle),
    };

    this.col++;
  }

  /**
   * Ensure row exists in buffer
   */
  private ensureRow(row: number): void {
    while (this.lines.length <= row) {
      this.lines.push([]);
    }
  }

  /**
   * Clear from cursor to end of line
   */
  private clearToEndOfLine(): void {
    if (this.lines[this.row]) {
      this.lines[this.row] = this.lines[this.row].slice(0, this.col);
    }
  }

  /**
   * Clear from start of line to cursor
   */
  private clearFromStartOfLine(): void {
    if (this.lines[this.row]) {
      const line = this.lines[this.row];
      for (let i = 0; i <= this.col && i < line.length; i++) {
        line[i] = { char: ' ', style: createDefaultStyle() };
      }
    }
  }

  /**
   * Clear entire line
   */
  private clearLine(): void {
    this.lines[this.row] = [];
  }

  /**
   * Clear from cursor to end of screen
   */
  private clearToEndOfScreen(): void {
    this.clearToEndOfLine();
    for (let r = this.row + 1; r < this.lines.length; r++) {
      this.lines[r] = [];
    }
  }

  /**
   * Clear from start of screen to cursor
   */
  private clearFromStartOfScreen(): void {
    for (let r = 0; r < this.row; r++) {
      this.lines[r] = [];
    }
    this.clearFromStartOfLine();
  }

  /**
   * Clear entire screen
   */
  private clearScreen(): void {
    this.lines = [[]];
    this.row = 0;
    this.col = 0;
  }

  /**
   * Convert buffer to string with ANSI escape codes
   */
  toString(): string {
    const output: string[] = [];
    let currentStyle = createDefaultStyle();

    for (let r = 0; r < this.lines.length; r++) {
      const line = this.lines[r];
      let lineOutput = '';

      for (let c = 0; c < line.length; c++) {
        const cell = line[c];

        // Check if style changed
        if (!stylesEqual(currentStyle, cell.style)) {
          // Emit style change
          lineOutput += this.styleToAnsi(cell.style, currentStyle);
          currentStyle = cloneStyle(cell.style);
        }

        lineOutput += cell.char;
      }

      // Reset at end of line if there's active styling
      if (hasStyle(currentStyle)) {
        lineOutput += '\x1b[0m';
        currentStyle = createDefaultStyle();
      }

      output.push(lineOutput);
    }

    // Trim trailing empty lines
    while (output.length > 0 && output[output.length - 1] === '') {
      output.pop();
    }

    return output.join('\n');
  }

  /**
   * Generate ANSI escape codes for a style change
   */
  private styleToAnsi(newStyle: CellStyle, oldStyle: CellStyle): string {
    const codes: number[] = [];

    // Check if we need a reset
    const needsReset = (
      (oldStyle.bold && !newStyle.bold) ||
      (oldStyle.dim && !newStyle.dim) ||
      (oldStyle.italic && !newStyle.italic) ||
      (oldStyle.underline && !newStyle.underline) ||
      (oldStyle.strikethrough && !newStyle.strikethrough) ||
      (oldStyle.inverse && !newStyle.inverse) ||
      (oldStyle.fg !== null && newStyle.fg === null) ||
      (oldStyle.bg !== null && newStyle.bg === null)
    );

    if (needsReset) {
      codes.push(0);
      // After reset, need to re-apply all active styles
      if (newStyle.bold) codes.push(1);
      if (newStyle.dim) codes.push(2);
      if (newStyle.italic) codes.push(3);
      if (newStyle.underline) codes.push(4);
      if (newStyle.inverse) codes.push(7);
      if (newStyle.strikethrough) codes.push(9);
      if (newStyle.fg) codes.push(...this.colorToCode(newStyle.fg, false));
      if (newStyle.bg) codes.push(...this.colorToCode(newStyle.bg, true));
    } else {
      // Just emit the changes
      if (newStyle.bold && !oldStyle.bold) codes.push(1);
      if (newStyle.dim && !oldStyle.dim) codes.push(2);
      if (newStyle.italic && !oldStyle.italic) codes.push(3);
      if (newStyle.underline && !oldStyle.underline) codes.push(4);
      if (newStyle.inverse && !oldStyle.inverse) codes.push(7);
      if (newStyle.strikethrough && !oldStyle.strikethrough) codes.push(9);
      if (newStyle.fg !== oldStyle.fg && newStyle.fg) {
        codes.push(...this.colorToCode(newStyle.fg, false));
      }
      if (newStyle.bg !== oldStyle.bg && newStyle.bg) {
        codes.push(...this.colorToCode(newStyle.bg, true));
      }
    }

    if (codes.length === 0) return '';
    return `\x1b[${codes.join(';')}m`;
  }

  /**
   * Convert color name to ANSI code(s)
   */
  private colorToCode(color: string, isBg: boolean): number[] {
    const offset = isBg ? 10 : 0;

    // Standard colors
    const standardColors: Record<string, number> = {
      'black': 30, 'red': 31, 'green': 32, 'yellow': 33,
      'blue': 34, 'magenta': 35, 'cyan': 36, 'white': 37,
      'bright-black': 90, 'bright-red': 91, 'bright-green': 92, 'bright-yellow': 93,
      'bright-blue': 94, 'bright-magenta': 95, 'bright-cyan': 96, 'bright-white': 97,
    };

    if (standardColors[color]) {
      return [standardColors[color] + offset];
    }

    // 256-color
    if (color.startsWith('256-')) {
      const n = parseInt(color.slice(4));
      return isBg ? [48, 5, n] : [38, 5, n];
    }

    // RGB
    if (color.startsWith('rgb(')) {
      const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if (match) {
        const [, r, g, b] = match.map(Number);
        return isBg ? [48, 2, r, g, b] : [38, 2, r, g, b];
      }
    }

    return [];
  }
}

/**
 * Process terminal output with full cursor movement support
 *
 * @param text - Raw terminal output with ANSI escape sequences
 * @returns Processed output with cursor movements resolved but colors preserved
 */
export function processTerminalBuffer(text: string): string {
  const buffer = new TerminalBuffer();
  buffer.write(text);
  return buffer.toString();
}

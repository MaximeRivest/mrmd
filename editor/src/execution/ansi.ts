/**
 * ANSI Escape Code Parser and HTML Converter
 *
 * Converts terminal ANSI escape sequences to styled HTML spans.
 * Preserves semantic information (colors indicate meaning: red=error, green=success)
 * while enabling rich rendering in the editor.
 *
 * Supported codes:
 * - SGR (Select Graphic Rendition): colors, bold, italic, underline
 * - Cursor movement: \r (carriage return) for progress bars
 *
 * Not supported (stripped):
 * - Cursor positioning (CSI n A/B/C/D)
 * - Screen clearing (CSI 2J, CSI K)
 * - Other escape sequences
 */

/** ANSI color codes mapped to CSS custom properties */
const ANSI_COLORS: Record<number, string> = {
  30: 'black',
  31: 'red',
  32: 'green',
  33: 'yellow',
  34: 'blue',
  35: 'magenta',
  36: 'cyan',
  37: 'white',
  // Bright colors
  90: 'bright-black',
  91: 'bright-red',
  92: 'bright-green',
  93: 'bright-yellow',
  94: 'bright-blue',
  95: 'bright-magenta',
  96: 'bright-cyan',
  97: 'bright-white',
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: 'black',
  41: 'red',
  42: 'green',
  43: 'yellow',
  44: 'blue',
  45: 'magenta',
  46: 'cyan',
  47: 'white',
  // Bright backgrounds
  100: 'bright-black',
  101: 'bright-red',
  102: 'bright-green',
  103: 'bright-yellow',
  104: 'bright-blue',
  105: 'bright-magenta',
  106: 'bright-cyan',
  107: 'bright-white',
};

/** Current text style state */
interface StyleState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  dim: boolean;
  inverse: boolean;
  foreground: string | null;
  background: string | null;
}

/** Create initial style state */
function createStyleState(): StyleState {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    dim: false,
    inverse: false,
    foreground: null,
    background: null,
  };
}

/** Apply SGR (Select Graphic Rendition) codes to style state */
function applySgrCodes(codes: number[], state: StyleState): void {
  let i = 0;
  while (i < codes.length) {
    const code = codes[i];

    switch (code) {
      case 0: // Reset
        Object.assign(state, createStyleState());
        break;
      case 1: // Bold
        state.bold = true;
        break;
      case 2: // Dim
        state.dim = true;
        break;
      case 3: // Italic
        state.italic = true;
        break;
      case 4: // Underline
        state.underline = true;
        break;
      case 7: // Inverse
        state.inverse = true;
        break;
      case 9: // Strikethrough
        state.strikethrough = true;
        break;
      case 22: // Normal intensity (not bold, not dim)
        state.bold = false;
        state.dim = false;
        break;
      case 23: // Not italic
        state.italic = false;
        break;
      case 24: // Not underline
        state.underline = false;
        break;
      case 27: // Not inverse
        state.inverse = false;
        break;
      case 29: // Not strikethrough
        state.strikethrough = false;
        break;
      case 39: // Default foreground
        state.foreground = null;
        break;
      case 49: // Default background
        state.background = null;
        break;
      default:
        // Foreground colors (30-37, 90-97)
        if (ANSI_COLORS[code]) {
          state.foreground = ANSI_COLORS[code];
        }
        // Background colors (40-47, 100-107)
        else if (ANSI_BG_COLORS[code]) {
          state.background = ANSI_BG_COLORS[code];
        }
        // 256-color mode: 38;5;n or 48;5;n
        else if (code === 38 && codes[i + 1] === 5) {
          const colorIndex = codes[i + 2];
          if (colorIndex !== undefined) {
            state.foreground = `ansi-256-${colorIndex}`;
            i += 2;
          }
        } else if (code === 48 && codes[i + 1] === 5) {
          const colorIndex = codes[i + 2];
          if (colorIndex !== undefined) {
            state.background = `ansi-256-${colorIndex}`;
            i += 2;
          }
        }
        // 24-bit RGB: 38;2;r;g;b or 48;2;r;g;b
        else if (code === 38 && codes[i + 1] === 2) {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if (r !== undefined && g !== undefined && b !== undefined) {
            state.foreground = `rgb(${r},${g},${b})`;
            i += 4;
          }
        } else if (code === 48 && codes[i + 1] === 2) {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if (r !== undefined && g !== undefined && b !== undefined) {
            state.background = `rgb(${r},${g},${b})`;
            i += 4;
          }
        }
    }
    i++;
  }
}

/** Convert style state to CSS classes and inline styles */
function styleToAttributes(state: StyleState): { classes: string[]; style: string } {
  const classes: string[] = [];
  const styles: string[] = [];

  if (state.bold) classes.push('ansi-bold');
  if (state.dim) classes.push('ansi-dim');
  if (state.italic) classes.push('ansi-italic');
  if (state.underline) classes.push('ansi-underline');
  if (state.strikethrough) classes.push('ansi-strikethrough');
  if (state.inverse) classes.push('ansi-inverse');

  if (state.foreground) {
    if (state.foreground.startsWith('rgb(') || state.foreground.startsWith('ansi-256-')) {
      // Inline style for RGB or 256-color
      if (state.foreground.startsWith('rgb(')) {
        styles.push(`color:${state.foreground}`);
      } else {
        classes.push(`ansi-fg-${state.foreground}`);
      }
    } else {
      classes.push(`ansi-fg-${state.foreground}`);
    }
  }

  if (state.background) {
    if (state.background.startsWith('rgb(') || state.background.startsWith('ansi-256-')) {
      if (state.background.startsWith('rgb(')) {
        styles.push(`background-color:${state.background}`);
      } else {
        classes.push(`ansi-bg-${state.background}`);
      }
    } else {
      classes.push(`ansi-bg-${state.background}`);
    }
  }

  return {
    classes,
    style: styles.join(';'),
  };
}

/** Check if style state has any active styling */
function hasActiveStyle(state: StyleState): boolean {
  return (
    state.bold ||
    state.italic ||
    state.underline ||
    state.strikethrough ||
    state.dim ||
    state.inverse ||
    state.foreground !== null ||
    state.background !== null
  );
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Process terminal output handling carriage returns
 * Simulates terminal behavior where \r returns to start of line
 */
export function processTerminalOutput(text: string): string {
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\r') {
      // Carriage return - go to start of current line
      if (text[i + 1] === '\n') {
        // \r\n is Windows line ending - treat as newline
        lines.push(currentLine);
        currentLine = '';
        i++; // Skip the \n
      } else {
        // Pure \r - reset to start of line (for progress bars)
        currentLine = '';
      }
    } else if (char === '\n') {
      // Newline - save current line and start new one
      lines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }

  // Include the last line (even if no trailing newline)
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join('\n');
}

/**
 * Strip ANSI escape sequences from text
 * Returns plain text without any escape codes
 */
export function stripAnsi(text: string): string {
  // Match all escape sequences:
  // - CSI sequences: \x1b[ ... <letter>
  // - OSC sequences: \x1b] ... \x07 or \x1b\\
  // - Single-char escapes: \x1b followed by single char
  return text.replace(
    /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\)|.)/g,
    ''
  );
}

/**
 * Check if text contains ANSI escape sequences
 */
export function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text);
}

/**
 * Convert ANSI escape sequences to HTML with styled spans
 *
 * @param text - Text with ANSI escape sequences (already processed for cursor movement)
 * @returns HTML string with styled spans
 */
export function ansiToHtml(text: string): string {
  // Note: cursor movement should be handled before this by processTerminalBuffer
  // This function only handles SGR codes (colors/styles)

  // Pattern to match ANSI SGR sequences: \x1b[<codes>m
  const ansiPattern = /\x1b\[([0-9;]*)m/g;

  // Pattern to match other escape sequences (to strip them)
  // These should already be resolved by terminal buffer, but strip any remaining
  // IMPORTANT: Don't match \x1b[ followed by SGR codes (m) - those are handled by ansiPattern
  // The [^\[] at the end matches ESC + any char EXCEPT '[' to avoid stripping CSI sequences
  const otherEscapes = /\x1b(?:\[[0-9;]*[A-HJKSTfn]|\][^\x07]*(?:\x07|\x1b\\)|[^\[])/g;

  // Strip non-SGR escape sequences (cursor movement etc.)
  const cleaned = text.replace(otherEscapes, '');

  const state = createStyleState();
  const output: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let spanOpen = false;

  // Reset regex state
  ansiPattern.lastIndex = 0;

  while ((match = ansiPattern.exec(cleaned)) !== null) {
    // Add text before this escape sequence
    const textBefore = cleaned.slice(lastIndex, match.index);
    if (textBefore) {
      output.push(escapeHtml(textBefore));
    }

    // Parse and apply SGR codes
    const codesStr = match[1];
    const codes = codesStr ? codesStr.split(';').map(Number) : [0];

    // Close previous span if open
    if (spanOpen) {
      output.push('</span>');
      spanOpen = false;
    }

    // Apply codes to state
    applySgrCodes(codes, state);

    // Open new span if there's active styling
    if (hasActiveStyle(state)) {
      const { classes, style } = styleToAttributes(state);
      const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
      const styleAttr = style ? ` style="${style}"` : '';
      output.push(`<span${classAttr}${styleAttr}>`);
      spanOpen = true;
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remaining = cleaned.slice(lastIndex);
  if (remaining) {
    output.push(escapeHtml(remaining));
  }

  // Close final span if open
  if (spanOpen) {
    output.push('</span>');
  }

  return output.join('');
}

/**
 * CSS styles for ANSI colors
 * Include these styles in the editor theme
 */
export const ansiStyles = `
/* ANSI text styles */
.ansi-bold { font-weight: bold; }
.ansi-dim { opacity: 0.7; }
.ansi-italic { font-style: italic; }
.ansi-underline { text-decoration: underline; }
.ansi-strikethrough { text-decoration: line-through; }
.ansi-inverse { filter: invert(1); }

/* ANSI foreground colors - using CSS custom properties for theming */
.ansi-fg-black { color: var(--ansi-black, #000); }
.ansi-fg-red { color: var(--ansi-red, #c91b00); }
.ansi-fg-green { color: var(--ansi-green, #00c200); }
.ansi-fg-yellow { color: var(--ansi-yellow, #c7c400); }
.ansi-fg-blue { color: var(--ansi-blue, #0225c7); }
.ansi-fg-magenta { color: var(--ansi-magenta, #c930c7); }
.ansi-fg-cyan { color: var(--ansi-cyan, #00c5c7); }
.ansi-fg-white { color: var(--ansi-white, #c7c7c7); }

/* Bright foreground colors */
.ansi-fg-bright-black { color: var(--ansi-bright-black, #676767); }
.ansi-fg-bright-red { color: var(--ansi-bright-red, #ff6d67); }
.ansi-fg-bright-green { color: var(--ansi-bright-green, #5ff967); }
.ansi-fg-bright-yellow { color: var(--ansi-bright-yellow, #fefb67); }
.ansi-fg-bright-blue { color: var(--ansi-bright-blue, #6871ff); }
.ansi-fg-bright-magenta { color: var(--ansi-bright-magenta, #ff76ff); }
.ansi-fg-bright-cyan { color: var(--ansi-bright-cyan, #5ffdff); }
.ansi-fg-bright-white { color: var(--ansi-bright-white, #fff); }

/* ANSI background colors */
.ansi-bg-black { background-color: var(--ansi-black, #000); }
.ansi-bg-red { background-color: var(--ansi-red, #c91b00); }
.ansi-bg-green { background-color: var(--ansi-green, #00c200); }
.ansi-bg-yellow { background-color: var(--ansi-yellow, #c7c400); }
.ansi-bg-blue { background-color: var(--ansi-blue, #0225c7); }
.ansi-bg-magenta { background-color: var(--ansi-magenta, #c930c7); }
.ansi-bg-cyan { background-color: var(--ansi-cyan, #00c5c7); }
.ansi-bg-white { background-color: var(--ansi-white, #c7c7c7); }

/* Bright background colors */
.ansi-bg-bright-black { background-color: var(--ansi-bright-black, #676767); }
.ansi-bg-bright-red { background-color: var(--ansi-bright-red, #ff6d67); }
.ansi-bg-bright-green { background-color: var(--ansi-bright-green, #5ff967); }
.ansi-bg-bright-yellow { background-color: var(--ansi-bright-yellow, #fefb67); }
.ansi-bg-bright-blue { background-color: var(--ansi-bright-blue, #6871ff); }
.ansi-bg-bright-magenta { background-color: var(--ansi-bright-magenta, #ff76ff); }
.ansi-bg-bright-cyan { background-color: var(--ansi-bright-cyan, #5ffdff); }
.ansi-bg-bright-white { background-color: var(--ansi-bright-white, #fff); }

/* Dark theme ANSI colors */
.dark-theme, [data-theme="dark"] {
  --ansi-black: #1d1f21;
  --ansi-red: #cc6666;
  --ansi-green: #b5bd68;
  --ansi-yellow: #f0c674;
  --ansi-blue: #81a2be;
  --ansi-magenta: #b294bb;
  --ansi-cyan: #8abeb7;
  --ansi-white: #c5c8c6;

  --ansi-bright-black: #969896;
  --ansi-bright-red: #de935f;
  --ansi-bright-green: #a3be8c;
  --ansi-bright-yellow: #ebcb8b;
  --ansi-bright-blue: #88c0d0;
  --ansi-bright-magenta: #b48ead;
  --ansi-bright-cyan: #96b5b4;
  --ansi-bright-white: #eceff4;
}
`;

/**
 * SGR (Select Graphic Rendition) Handler
 *
 * Handles ANSI escape codes for text styling: colors, bold, underline, etc.
 * Supports:
 * - Standard colors (30-37, 40-47)
 * - Bright colors (90-97, 100-107)
 * - 256-color palette (38;5;n, 48;5;n)
 * - 24-bit true color (38;2;r;g;b, 48;2;r;g;b)
 * - Text attributes (bold, italic, underline, etc.)
 *
 * Usage:
 *   const style = createDefaultStyle();
 *   applySGR(style, params); // params from CSI m sequence
 */

/**
 * Create a default text style.
 * @returns {Object} Default style object
 */
export function createDefaultStyle() {
    return {
        // Colors - null means default terminal color
        fg: null,
        bg: null,

        // Attributes
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        underlineStyle: 'single', // single, double, curly, dotted, dashed
        blink: false,
        rapidBlink: false,
        reverse: false,
        hidden: false,
        strikethrough: false,
        overline: false,

        // Underline color (null = same as fg)
        underlineColor: null,
    };
}

/**
 * Clone a style object.
 * @param {Object} style - Style to clone
 * @returns {Object} Cloned style
 */
export function cloneStyle(style) {
    const clone = { ...style };
    // Deep clone color objects if they're RGB
    if (style.fg && typeof style.fg === 'object') {
        clone.fg = { ...style.fg };
    }
    if (style.bg && typeof style.bg === 'object') {
        clone.bg = { ...style.bg };
    }
    if (style.underlineColor && typeof style.underlineColor === 'object') {
        clone.underlineColor = { ...style.underlineColor };
    }
    return clone;
}

/**
 * Check if two styles are equal.
 * @param {Object} a - First style
 * @param {Object} b - Second style
 * @returns {boolean} True if equal
 */
export function stylesEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;

    // Compare colors
    if (!colorsEqual(a.fg, b.fg)) return false;
    if (!colorsEqual(a.bg, b.bg)) return false;
    if (!colorsEqual(a.underlineColor, b.underlineColor)) return false;

    // Compare attributes
    return (
        a.bold === b.bold &&
        a.dim === b.dim &&
        a.italic === b.italic &&
        a.underline === b.underline &&
        a.underlineStyle === b.underlineStyle &&
        a.blink === b.blink &&
        a.rapidBlink === b.rapidBlink &&
        a.reverse === b.reverse &&
        a.hidden === b.hidden &&
        a.strikethrough === b.strikethrough &&
        a.overline === b.overline
    );
}

/**
 * Compare two colors for equality.
 * @param {number|Object|null} a
 * @param {number|Object|null} b
 * @returns {boolean}
 */
function colorsEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a === 'number' && typeof b === 'number') return a === b;
    if (typeof a === 'object' && typeof b === 'object') {
        return a.r === b.r && a.g === b.g && a.b === b.b;
    }
    return false;
}

/**
 * Apply SGR parameters to a style object.
 * Modifies the style in place.
 *
 * @param {Object} style - Style object to modify
 * @param {number[]} params - SGR parameters from CSI sequence
 */
export function applySGR(style, params) {
    // Empty params means reset
    if (params.length === 0) {
        resetStyle(style);
        return;
    }

    let i = 0;
    while (i < params.length) {
        const code = params[i];

        switch (code) {
            // Reset
            case 0:
                resetStyle(style);
                break;

            // Attributes ON
            case 1:
                style.bold = true;
                break;
            case 2:
                style.dim = true;
                break;
            case 3:
                style.italic = true;
                break;
            case 4:
                style.underline = true;
                // Check for underline style subparameter
                if (params[i + 1] !== undefined && params[i + 1] >= 0 && params[i + 1] <= 5) {
                    i++;
                    style.underlineStyle = getUnderlineStyle(params[i]);
                } else {
                    style.underlineStyle = 'single';
                }
                break;
            case 5:
                style.blink = true;
                break;
            case 6:
                style.rapidBlink = true;
                break;
            case 7:
                style.reverse = true;
                break;
            case 8:
                style.hidden = true;
                break;
            case 9:
                style.strikethrough = true;
                break;

            // Fonts 10-19 (not commonly supported, ignore)
            case 10: case 11: case 12: case 13: case 14:
            case 15: case 16: case 17: case 18: case 19:
                break;

            // Fraktur (rarely supported)
            case 20:
                break;

            // Double underline / bold off
            case 21:
                style.underline = true;
                style.underlineStyle = 'double';
                break;

            // Attributes OFF
            case 22:
                style.bold = false;
                style.dim = false;
                break;
            case 23:
                style.italic = false;
                break;
            case 24:
                style.underline = false;
                break;
            case 25:
                style.blink = false;
                style.rapidBlink = false;
                break;
            case 26:
                // Proportional spacing - not supported
                break;
            case 27:
                style.reverse = false;
                break;
            case 28:
                style.hidden = false;
                break;
            case 29:
                style.strikethrough = false;
                break;

            // Standard foreground colors (30-37)
            case 30: case 31: case 32: case 33:
            case 34: case 35: case 36: case 37:
                style.fg = code - 30;
                break;

            // Extended foreground color
            case 38:
                i = parseExtendedColor(params, i, (color) => {
                    style.fg = color;
                });
                break;

            // Default foreground
            case 39:
                style.fg = null;
                break;

            // Standard background colors (40-47)
            case 40: case 41: case 42: case 43:
            case 44: case 45: case 46: case 47:
                style.bg = code - 40;
                break;

            // Extended background color
            case 48:
                i = parseExtendedColor(params, i, (color) => {
                    style.bg = color;
                });
                break;

            // Default background
            case 49:
                style.bg = null;
                break;

            // Disable proportional spacing
            case 50:
                break;

            // Framed
            case 51:
                break;

            // Encircled
            case 52:
                break;

            // Overline
            case 53:
                style.overline = true;
                break;

            // Not framed or encircled
            case 54:
                break;

            // Overline off
            case 55:
                style.overline = false;
                break;

            // 56-57 reserved

            // Underline color
            case 58:
                i = parseExtendedColor(params, i, (color) => {
                    style.underlineColor = color;
                });
                break;

            // Default underline color
            case 59:
                style.underlineColor = null;
                break;

            // 60-65: ideogram attributes (rarely supported)

            // Bright foreground colors (90-97)
            case 90: case 91: case 92: case 93:
            case 94: case 95: case 96: case 97:
                style.fg = code - 90 + 8;
                break;

            // Bright background colors (100-107)
            case 100: case 101: case 102: case 103:
            case 104: case 105: case 106: case 107:
                style.bg = code - 100 + 8;
                break;

            default:
                // Unknown code - ignore
                break;
        }

        i++;
    }
}

/**
 * Reset style to defaults.
 * @param {Object} style
 */
function resetStyle(style) {
    style.fg = null;
    style.bg = null;
    style.bold = false;
    style.dim = false;
    style.italic = false;
    style.underline = false;
    style.underlineStyle = 'single';
    style.blink = false;
    style.rapidBlink = false;
    style.reverse = false;
    style.hidden = false;
    style.strikethrough = false;
    style.overline = false;
    style.underlineColor = null;
}

/**
 * Parse extended color (256-color or RGB).
 * @param {number[]} params - Full parameter array
 * @param {number} i - Current index (pointing to 38/48/58)
 * @param {Function} setter - Function to call with parsed color
 * @returns {number} New index after parsing
 */
function parseExtendedColor(params, i, setter) {
    const mode = params[i + 1];

    if (mode === 5) {
        // 256-color: 38;5;n
        const colorIndex = params[i + 2];
        if (colorIndex !== undefined) {
            setter(colorIndex);
            return i + 2;
        }
    } else if (mode === 2) {
        // True color: 38;2;r;g;b
        const r = params[i + 2];
        const g = params[i + 3];
        const b = params[i + 4];
        if (r !== undefined && g !== undefined && b !== undefined) {
            setter({ r, g, b });
            return i + 4;
        }
    }

    return i;
}

/**
 * Get underline style name from code.
 * @param {number} code - Underline style code (0-5)
 * @returns {string}
 */
function getUnderlineStyle(code) {
    switch (code) {
        case 0: return 'none';
        case 1: return 'single';
        case 2: return 'double';
        case 3: return 'curly';
        case 4: return 'dotted';
        case 5: return 'dashed';
        default: return 'single';
    }
}

/**
 * Standard 16-color palette (colors 0-15).
 * These are the "stock" xterm colors.
 */
export const STANDARD_COLORS = [
    // Normal colors (0-7)
    { r: 0, g: 0, b: 0 },       // 0: Black
    { r: 205, g: 49, b: 49 },   // 1: Red
    { r: 13, g: 188, b: 121 },  // 2: Green
    { r: 229, g: 229, b: 16 },  // 3: Yellow
    { r: 36, g: 114, b: 200 },  // 4: Blue
    { r: 188, g: 63, b: 188 },  // 5: Magenta
    { r: 17, g: 168, b: 205 },  // 6: Cyan
    { r: 229, g: 229, b: 229 }, // 7: White

    // Bright colors (8-15)
    { r: 102, g: 102, b: 102 }, // 8: Bright Black (Gray)
    { r: 241, g: 76, b: 76 },   // 9: Bright Red
    { r: 35, g: 209, b: 139 },  // 10: Bright Green
    { r: 245, g: 245, b: 67 },  // 11: Bright Yellow
    { r: 59, g: 142, b: 234 },  // 12: Bright Blue
    { r: 214, g: 112, b: 214 }, // 13: Bright Magenta
    { r: 41, g: 184, b: 219 },  // 14: Bright Cyan
    { r: 255, g: 255, b: 255 }, // 15: Bright White
];

/**
 * Generate the 256-color palette.
 * Colors 0-15: Standard colors
 * Colors 16-231: 6x6x6 color cube
 * Colors 232-255: Grayscale ramp
 *
 * @returns {Array<{r: number, g: number, b: number}>}
 */
export function generate256ColorPalette() {
    const palette = [];

    // 0-15: Standard colors
    for (const color of STANDARD_COLORS) {
        palette.push({ ...color });
    }

    // 16-231: 6x6x6 color cube
    const cubeValues = [0, 95, 135, 175, 215, 255];
    for (let r = 0; r < 6; r++) {
        for (let g = 0; g < 6; g++) {
            for (let b = 0; b < 6; b++) {
                palette.push({
                    r: cubeValues[r],
                    g: cubeValues[g],
                    b: cubeValues[b],
                });
            }
        }
    }

    // 232-255: Grayscale ramp
    for (let i = 0; i < 24; i++) {
        const gray = 8 + i * 10;
        palette.push({ r: gray, g: gray, b: gray });
    }

    return palette;
}

// Pre-generate the palette
const COLOR_PALETTE_256 = generate256ColorPalette();

/**
 * Resolve a color value to RGB.
 * @param {number|Object|null} color - Color index (0-255), RGB object, or null
 * @param {boolean} isForeground - True for foreground, false for background
 * @returns {{r: number, g: number, b: number}|null}
 */
export function resolveColor(color, isForeground = true) {
    if (color === null) {
        return null;
    }

    if (typeof color === 'object') {
        // Already RGB
        return color;
    }

    if (typeof color === 'number' && color >= 0 && color < 256) {
        return COLOR_PALETTE_256[color];
    }

    return null;
}

/**
 * Convert color to CSS string.
 * @param {number|Object|null} color
 * @param {string} defaultColor - Default color if null
 * @returns {string}
 */
export function colorToCSS(color, defaultColor = 'inherit') {
    if (color === null) {
        return defaultColor;
    }

    const rgb = resolveColor(color);
    if (!rgb) {
        return defaultColor;
    }

    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/**
 * Convert style to CSS classes.
 * @param {Object} style
 * @returns {string[]}
 */
export function styleToClasses(style) {
    const classes = [];

    // Foreground color
    if (style.fg !== null) {
        if (typeof style.fg === 'number' && style.fg < 16) {
            classes.push(`fg-${style.fg}`);
        } else {
            classes.push('fg-custom');
        }
    }

    // Background color
    if (style.bg !== null) {
        if (typeof style.bg === 'number' && style.bg < 16) {
            classes.push(`bg-${style.bg}`);
        } else {
            classes.push('bg-custom');
        }
    }

    // Attributes
    if (style.bold) classes.push('bold');
    if (style.dim) classes.push('dim');
    if (style.italic) classes.push('italic');
    if (style.underline) {
        classes.push('underline');
        if (style.underlineStyle !== 'single') {
            classes.push(`underline-${style.underlineStyle}`);
        }
    }
    if (style.blink || style.rapidBlink) classes.push('blink');
    if (style.reverse) classes.push('reverse');
    if (style.hidden) classes.push('hidden');
    if (style.strikethrough) classes.push('strikethrough');
    if (style.overline) classes.push('overline');

    return classes;
}

/**
 * Convert style to inline CSS.
 * @param {Object} style
 * @param {Object} options
 * @param {string} options.defaultFg - Default foreground color
 * @param {string} options.defaultBg - Default background color
 * @returns {string}
 */
export function styleToInlineCSS(style, options = {}) {
    const parts = [];

    // Colors
    if (style.fg !== null) {
        parts.push(`color: ${colorToCSS(style.fg)}`);
    }
    if (style.bg !== null) {
        parts.push(`background-color: ${colorToCSS(style.bg)}`);
    }

    // Attributes
    if (style.bold) {
        parts.push('font-weight: bold');
    }
    if (style.dim) {
        parts.push('opacity: 0.7');
    }
    if (style.italic) {
        parts.push('font-style: italic');
    }
    if (style.underline) {
        let decoration = 'underline';
        if (style.underlineStyle === 'double') {
            decoration = 'underline double';
        } else if (style.underlineStyle === 'curly') {
            decoration = 'underline wavy';
        } else if (style.underlineStyle === 'dotted') {
            decoration = 'underline dotted';
        } else if (style.underlineStyle === 'dashed') {
            decoration = 'underline dashed';
        }
        parts.push(`text-decoration: ${decoration}`);
    }
    if (style.strikethrough) {
        const existing = parts.find(p => p.startsWith('text-decoration:'));
        if (existing) {
            const idx = parts.indexOf(existing);
            parts[idx] = existing.replace('text-decoration:', 'text-decoration: line-through ');
        } else {
            parts.push('text-decoration: line-through');
        }
    }
    if (style.overline) {
        const existing = parts.find(p => p.startsWith('text-decoration:'));
        if (existing) {
            const idx = parts.indexOf(existing);
            parts[idx] = existing.replace('text-decoration:', 'text-decoration: overline ');
        } else {
            parts.push('text-decoration: overline');
        }
    }
    if (style.hidden) {
        parts.push('visibility: hidden');
    }
    if (style.reverse) {
        // Reverse needs to be handled by swapping fg/bg
        // This is a simplified version
        parts.push('filter: invert(1)');
    }

    return parts.join('; ');
}

export default {
    createDefaultStyle,
    cloneStyle,
    stylesEqual,
    applySGR,
    resolveColor,
    colorToCSS,
    styleToClasses,
    styleToInlineCSS,
    STANDARD_COLORS,
    generate256ColorPalette,
};

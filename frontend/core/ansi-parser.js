/**
 * ANSI/VT100/xterm Escape Code Parser
 *
 * A comprehensive parser for terminal escape sequences.
 * Follows the ECMA-48 and XTerm control sequence specifications.
 *
 * Supported sequence types:
 * - CSI (Control Sequence Introducer): ESC [ ... - cursor, colors, screen ops
 * - OSC (Operating System Command): ESC ] ... - title, hyperlinks, colors
 * - SGR (Select Graphic Rendition): ESC [ ... m - text styling
 * - DCS (Device Control String): ESC P ... - rarely used
 * - Simple escape sequences: ESC char
 *
 * Usage:
 *   const parser = new AnsiParser();
 *   for (const token of parser.parse(text)) {
 *       switch (token.type) {
 *           case 'print': // printable character
 *           case 'csi':   // control sequence
 *           case 'osc':   // operating system command
 *           case 'esc':   // simple escape sequence
 *           // ... handle token
 *       }
 *   }
 */

// Parser states
const STATE = {
    GROUND: 0,
    ESCAPE: 1,
    ESCAPE_INTERMEDIATE: 2,
    CSI_ENTRY: 3,
    CSI_PARAM: 4,
    CSI_INTERMEDIATE: 5,
    CSI_IGNORE: 6,
    OSC_STRING: 7,
    DCS_ENTRY: 8,
    DCS_PARAM: 9,
    DCS_INTERMEDIATE: 10,
    DCS_PASSTHROUGH: 11,
    DCS_IGNORE: 12,
    SOS_PM_APC_STRING: 13,
};

// Character code constants
const C0 = {
    NUL: 0x00,
    SOH: 0x01,
    STX: 0x02,
    ETX: 0x03,
    EOT: 0x04,
    ENQ: 0x05,
    ACK: 0x06,
    BEL: 0x07,
    BS: 0x08,
    HT: 0x09,
    LF: 0x0A,
    VT: 0x0B,
    FF: 0x0C,
    CR: 0x0D,
    SO: 0x0E,
    SI: 0x0F,
    DLE: 0x10,
    DC1: 0x11,
    DC2: 0x12,
    DC3: 0x13,
    DC4: 0x14,
    NAK: 0x15,
    SYN: 0x16,
    ETB: 0x17,
    CAN: 0x18,
    EM: 0x19,
    SUB: 0x1A,
    ESC: 0x1B,
    FS: 0x1C,
    GS: 0x1D,
    RS: 0x1E,
    US: 0x1F,
    SP: 0x20,
    DEL: 0x7F,
};

// C1 control codes (8-bit, also accessible via ESC + char)
const C1 = {
    PAD: 0x80,
    HOP: 0x81,
    BPH: 0x82,
    NBH: 0x83,
    IND: 0x84,
    NEL: 0x85,
    SSA: 0x86,
    ESA: 0x87,
    HTS: 0x88,
    HTJ: 0x89,
    VTS: 0x8A,
    PLD: 0x8B,
    PLU: 0x8C,
    RI: 0x8D,
    SS2: 0x8E,
    SS3: 0x8F,
    DCS: 0x90,
    PU1: 0x91,
    PU2: 0x92,
    STS: 0x93,
    CCH: 0x94,
    MW: 0x95,
    SPA: 0x96,
    EPA: 0x97,
    SOS: 0x98,
    SGCI: 0x99,
    SCI: 0x9A,
    CSI: 0x9B,
    ST: 0x9C,
    OSC: 0x9D,
    PM: 0x9E,
    APC: 0x9F,
};

/**
 * ANSI escape code parser.
 * Implements a state machine following the VT500-series parser model.
 */
export class AnsiParser {
    constructor() {
        this.reset();
    }

    /**
     * Reset parser state.
     */
    reset() {
        this.state = STATE.GROUND;
        this.params = [];
        this.currentParam = 0;
        this.hasCurrentParam = false;
        this.intermediate = '';
        this.oscData = '';
        this.dcsData = '';
        this.collectBuffer = '';
    }

    /**
     * Parse input string and yield tokens.
     * @param {string} input - Input string to parse
     * @yields {Object} Token objects
     */
    *parse(input) {
        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            const code = input.charCodeAt(i);

            yield* this.processChar(char, code);
        }
    }

    /**
     * Process a single character.
     * @param {string} char - The character
     * @param {number} code - The character code
     * @yields {Object} Token objects
     */
    *processChar(char, code) {
        // Handle C0 control codes in any state (except during string collection)
        if (code < 0x20 && this.state !== STATE.OSC_STRING &&
            this.state !== STATE.DCS_PASSTHROUGH &&
            this.state !== STATE.SOS_PM_APC_STRING) {

            yield* this.handleC0(char, code);
            return;
        }

        // Handle DEL - always ignored
        if (code === C0.DEL) {
            return;
        }

        // State-specific processing
        switch (this.state) {
            case STATE.GROUND:
                yield* this.handleGround(char, code);
                break;

            case STATE.ESCAPE:
                yield* this.handleEscape(char, code);
                break;

            case STATE.ESCAPE_INTERMEDIATE:
                yield* this.handleEscapeIntermediate(char, code);
                break;

            case STATE.CSI_ENTRY:
                yield* this.handleCsiEntry(char, code);
                break;

            case STATE.CSI_PARAM:
                yield* this.handleCsiParam(char, code);
                break;

            case STATE.CSI_INTERMEDIATE:
                yield* this.handleCsiIntermediate(char, code);
                break;

            case STATE.CSI_IGNORE:
                yield* this.handleCsiIgnore(char, code);
                break;

            case STATE.OSC_STRING:
                yield* this.handleOscString(char, code);
                break;

            case STATE.DCS_ENTRY:
                yield* this.handleDcsEntry(char, code);
                break;

            case STATE.DCS_PARAM:
                yield* this.handleDcsParam(char, code);
                break;

            case STATE.DCS_INTERMEDIATE:
                yield* this.handleDcsIntermediate(char, code);
                break;

            case STATE.DCS_PASSTHROUGH:
                yield* this.handleDcsPassthrough(char, code);
                break;

            case STATE.DCS_IGNORE:
                // Ignore until ST
                break;

            case STATE.SOS_PM_APC_STRING:
                yield* this.handleSosPmApcString(char, code);
                break;
        }
    }

    /**
     * Handle C0 control codes.
     */
    *handleC0(char, code) {
        switch (code) {
            case C0.NUL:
                // Ignore
                break;
            case C0.BEL:
                yield { type: 'bell' };
                break;
            case C0.BS:
                yield { type: 'bs' };
                break;
            case C0.HT:
                yield { type: 'tab' };
                break;
            case C0.LF:
            case C0.VT:
            case C0.FF:
                yield { type: 'lf' };
                break;
            case C0.CR:
                yield { type: 'cr' };
                break;
            case C0.SO:
                yield { type: 'shift_out' };
                break;
            case C0.SI:
                yield { type: 'shift_in' };
                break;
            case C0.ESC:
                this.enterEscape();
                break;
            case C0.CAN:
            case C0.SUB:
                // Cancel current sequence
                this.state = STATE.GROUND;
                break;
            default:
                // Other C0 codes are ignored
                break;
        }
    }

    /**
     * Handle printable characters in ground state.
     */
    *handleGround(char, code) {
        if (code >= 0x20 && code < 0x7F) {
            yield { type: 'print', char };
        } else if (code >= 0x80 && code < 0xA0) {
            // C1 control codes (8-bit mode)
            yield* this.handleC1(code);
        } else if (code >= 0xA0) {
            // UTF-8 printable
            yield { type: 'print', char };
        }
    }

    /**
     * Handle C1 control codes (8-bit).
     */
    *handleC1(code) {
        switch (code) {
            case C1.IND:
                yield { type: 'ind' }; // Index (line feed)
                break;
            case C1.NEL:
                yield { type: 'nel' }; // Next line
                break;
            case C1.HTS:
                yield { type: 'hts' }; // Horizontal tab set
                break;
            case C1.RI:
                yield { type: 'ri' }; // Reverse index
                break;
            case C1.SS2:
                yield { type: 'ss2' }; // Single shift 2
                break;
            case C1.SS3:
                yield { type: 'ss3' }; // Single shift 3
                break;
            case C1.DCS:
                this.enterDcs();
                break;
            case C1.CSI:
                this.enterCsi();
                break;
            case C1.ST:
                this.state = STATE.GROUND;
                break;
            case C1.OSC:
                this.enterOsc();
                break;
            case C1.PM:
            case C1.APC:
            case C1.SOS:
                this.state = STATE.SOS_PM_APC_STRING;
                break;
        }
    }

    /**
     * Enter escape state.
     */
    enterEscape() {
        this.state = STATE.ESCAPE;
        this.intermediate = '';
    }

    /**
     * Enter CSI state.
     */
    enterCsi() {
        this.state = STATE.CSI_ENTRY;
        this.params = [];
        this.currentParam = 0;
        this.hasCurrentParam = false;
        this.intermediate = '';
    }

    /**
     * Enter OSC state.
     */
    enterOsc() {
        this.state = STATE.OSC_STRING;
        this.oscData = '';
    }

    /**
     * Enter DCS state.
     */
    enterDcs() {
        this.state = STATE.DCS_ENTRY;
        this.params = [];
        this.currentParam = 0;
        this.hasCurrentParam = false;
        this.intermediate = '';
        this.dcsData = '';
    }

    /**
     * Handle escape state.
     */
    *handleEscape(char, code) {
        if (code >= 0x20 && code <= 0x2F) {
            // Intermediate character
            this.intermediate += char;
            this.state = STATE.ESCAPE_INTERMEDIATE;
        } else if (code >= 0x30 && code <= 0x7E) {
            // Final character
            yield* this.executeEscape(char);
            this.state = STATE.GROUND;
        } else if (char === '[') {
            this.enterCsi();
        } else if (char === ']') {
            this.enterOsc();
        } else if (char === 'P') {
            this.enterDcs();
        } else if (char === 'X' || char === '^' || char === '_') {
            // SOS, PM, APC
            this.state = STATE.SOS_PM_APC_STRING;
        } else if (char === '\\') {
            // ST (String Terminator) - return to ground
            this.state = STATE.GROUND;
        } else {
            // Unknown - return to ground
            this.state = STATE.GROUND;
        }
    }

    /**
     * Handle escape intermediate state.
     */
    *handleEscapeIntermediate(char, code) {
        if (code >= 0x20 && code <= 0x2F) {
            this.intermediate += char;
        } else if (code >= 0x30 && code <= 0x7E) {
            yield* this.executeEscape(char);
            this.state = STATE.GROUND;
        } else {
            this.state = STATE.GROUND;
        }
    }

    /**
     * Execute a simple escape sequence.
     */
    *executeEscape(finalChar) {
        yield {
            type: 'esc',
            intermediate: this.intermediate,
            final: finalChar,
        };
    }

    /**
     * Handle CSI entry state.
     */
    *handleCsiEntry(char, code) {
        if (code >= 0x30 && code <= 0x39) {
            // Digit
            this.currentParam = code - 0x30;
            this.hasCurrentParam = true;
            this.state = STATE.CSI_PARAM;
        } else if (char === ';') {
            // Parameter separator
            this.params.push(0);
            this.state = STATE.CSI_PARAM;
        } else if (code >= 0x3C && code <= 0x3F) {
            // Private marker: < = > ?
            this.intermediate += char;
        } else if (code >= 0x20 && code <= 0x2F) {
            // Intermediate
            this.intermediate += char;
            this.state = STATE.CSI_INTERMEDIATE;
        } else if (code >= 0x40 && code <= 0x7E) {
            // Final - execute with empty params
            yield* this.executeCsi(char);
            this.state = STATE.GROUND;
        } else if (char === ':') {
            // Sub-parameter separator (for SGR)
            this.hasCurrentParam = true;
            this.state = STATE.CSI_PARAM;
        }
    }

    /**
     * Handle CSI parameter state.
     */
    *handleCsiParam(char, code) {
        if (code >= 0x30 && code <= 0x39) {
            // Digit
            this.currentParam = this.currentParam * 10 + (code - 0x30);
            this.hasCurrentParam = true;
        } else if (char === ';') {
            // Parameter separator
            this.params.push(this.hasCurrentParam ? this.currentParam : 0);
            this.currentParam = 0;
            this.hasCurrentParam = false;
        } else if (char === ':') {
            // Sub-parameter separator (for SGR extended colors)
            this.params.push(this.hasCurrentParam ? this.currentParam : 0);
            this.currentParam = 0;
            this.hasCurrentParam = false;
        } else if (code >= 0x20 && code <= 0x2F) {
            // Intermediate
            if (this.hasCurrentParam) {
                this.params.push(this.currentParam);
            }
            this.intermediate += char;
            this.state = STATE.CSI_INTERMEDIATE;
        } else if (code >= 0x40 && code <= 0x7E) {
            // Final
            if (this.hasCurrentParam) {
                this.params.push(this.currentParam);
            }
            yield* this.executeCsi(char);
            this.state = STATE.GROUND;
        } else if (code >= 0x3C && code <= 0x3F) {
            // Private marker in wrong position - ignore sequence
            this.state = STATE.CSI_IGNORE;
        }
    }

    /**
     * Handle CSI intermediate state.
     */
    *handleCsiIntermediate(char, code) {
        if (code >= 0x20 && code <= 0x2F) {
            this.intermediate += char;
        } else if (code >= 0x40 && code <= 0x7E) {
            yield* this.executeCsi(char);
            this.state = STATE.GROUND;
        } else {
            this.state = STATE.CSI_IGNORE;
        }
    }

    /**
     * Handle CSI ignore state.
     */
    *handleCsiIgnore(char, code) {
        if (code >= 0x40 && code <= 0x7E) {
            // Final character ends the sequence
            this.state = STATE.GROUND;
        }
    }

    /**
     * Execute a CSI sequence.
     */
    *executeCsi(finalChar) {
        yield {
            type: 'csi',
            params: this.params.slice(),
            intermediate: this.intermediate,
            final: finalChar,
        };
    }

    /**
     * Handle OSC string collection.
     */
    *handleOscString(char, code) {
        if (code === C0.BEL) {
            // BEL terminates OSC
            yield* this.executeOsc();
            this.state = STATE.GROUND;
        } else if (code === C0.ESC) {
            // Check for ST (ESC \)
            this.collectBuffer = char;
        } else if (this.collectBuffer === '\x1b' && char === '\\') {
            // ST found
            yield* this.executeOsc();
            this.state = STATE.GROUND;
            this.collectBuffer = '';
        } else if (code === C1.ST) {
            // 8-bit ST
            yield* this.executeOsc();
            this.state = STATE.GROUND;
        } else {
            if (this.collectBuffer) {
                this.oscData += this.collectBuffer;
                this.collectBuffer = '';
            }
            this.oscData += char;
        }
    }

    /**
     * Execute an OSC sequence.
     */
    *executeOsc() {
        // Parse OSC: Ps ; Pt
        const semicolon = this.oscData.indexOf(';');
        let ps = 0;
        let pt = this.oscData;

        if (semicolon !== -1) {
            ps = parseInt(this.oscData.substring(0, semicolon), 10) || 0;
            pt = this.oscData.substring(semicolon + 1);
        }

        yield {
            type: 'osc',
            ps,
            pt,
            raw: this.oscData,
        };
    }

    /**
     * Handle DCS entry state.
     */
    *handleDcsEntry(char, code) {
        if (code >= 0x30 && code <= 0x39) {
            this.currentParam = code - 0x30;
            this.hasCurrentParam = true;
            this.state = STATE.DCS_PARAM;
        } else if (char === ';') {
            this.params.push(0);
            this.state = STATE.DCS_PARAM;
        } else if (code >= 0x3C && code <= 0x3F) {
            this.intermediate += char;
        } else if (code >= 0x20 && code <= 0x2F) {
            this.intermediate += char;
            this.state = STATE.DCS_INTERMEDIATE;
        } else if (code >= 0x40 && code <= 0x7E) {
            this.dcsData = '';
            this.state = STATE.DCS_PASSTHROUGH;
        }
    }

    /**
     * Handle DCS parameter state.
     */
    *handleDcsParam(char, code) {
        if (code >= 0x30 && code <= 0x39) {
            this.currentParam = this.currentParam * 10 + (code - 0x30);
            this.hasCurrentParam = true;
        } else if (char === ';') {
            this.params.push(this.hasCurrentParam ? this.currentParam : 0);
            this.currentParam = 0;
            this.hasCurrentParam = false;
        } else if (code >= 0x20 && code <= 0x2F) {
            if (this.hasCurrentParam) {
                this.params.push(this.currentParam);
            }
            this.intermediate += char;
            this.state = STATE.DCS_INTERMEDIATE;
        } else if (code >= 0x40 && code <= 0x7E) {
            if (this.hasCurrentParam) {
                this.params.push(this.currentParam);
            }
            this.dcsData = '';
            this.state = STATE.DCS_PASSTHROUGH;
        } else {
            this.state = STATE.DCS_IGNORE;
        }
    }

    /**
     * Handle DCS intermediate state.
     */
    *handleDcsIntermediate(char, code) {
        if (code >= 0x20 && code <= 0x2F) {
            this.intermediate += char;
        } else if (code >= 0x40 && code <= 0x7E) {
            this.dcsData = '';
            this.state = STATE.DCS_PASSTHROUGH;
        } else {
            this.state = STATE.DCS_IGNORE;
        }
    }

    /**
     * Handle DCS passthrough state.
     */
    *handleDcsPassthrough(char, code) {
        if (code === C0.ESC) {
            this.collectBuffer = char;
        } else if (this.collectBuffer === '\x1b' && char === '\\') {
            // ST found
            yield {
                type: 'dcs',
                params: this.params.slice(),
                intermediate: this.intermediate,
                data: this.dcsData,
            };
            this.state = STATE.GROUND;
            this.collectBuffer = '';
        } else if (code === C1.ST) {
            yield {
                type: 'dcs',
                params: this.params.slice(),
                intermediate: this.intermediate,
                data: this.dcsData,
            };
            this.state = STATE.GROUND;
        } else {
            if (this.collectBuffer) {
                this.dcsData += this.collectBuffer;
                this.collectBuffer = '';
            }
            if (code >= 0x20 || code === C0.HT || code === C0.LF || code === C0.CR) {
                this.dcsData += char;
            }
        }
    }

    /**
     * Handle SOS/PM/APC string collection.
     */
    *handleSosPmApcString(char, code) {
        if (code === C0.ESC) {
            this.collectBuffer = char;
        } else if (this.collectBuffer === '\x1b' && char === '\\') {
            // ST found - just discard the content
            this.state = STATE.GROUND;
            this.collectBuffer = '';
        } else if (code === C1.ST) {
            this.state = STATE.GROUND;
        } else {
            this.collectBuffer = '';
        }
    }
}

/**
 * CSI command identifiers for common sequences.
 */
export const CSI = {
    // Cursor movement
    CUU: 'A',  // Cursor Up
    CUD: 'B',  // Cursor Down
    CUF: 'C',  // Cursor Forward
    CUB: 'D',  // Cursor Back
    CNL: 'E',  // Cursor Next Line
    CPL: 'F',  // Cursor Previous Line
    CHA: 'G',  // Cursor Horizontal Absolute
    CUP: 'H',  // Cursor Position
    CHT: 'I',  // Cursor Horizontal Tab
    ED: 'J',   // Erase in Display
    EL: 'K',   // Erase in Line
    IL: 'L',   // Insert Lines
    DL: 'M',   // Delete Lines
    DCH: 'P',  // Delete Characters
    SU: 'S',   // Scroll Up
    SD: 'T',   // Scroll Down
    ECH: 'X',  // Erase Characters
    CBT: 'Z',  // Cursor Backward Tab
    HPA: '`',  // Horizontal Position Absolute
    HPR: 'a',  // Horizontal Position Relative
    REP: 'b',  // Repeat
    VPA: 'd',  // Vertical Position Absolute
    VPR: 'e',  // Vertical Position Relative
    HVP: 'f',  // Horizontal and Vertical Position
    TBC: 'g',  // Tab Clear
    SM: 'h',   // Set Mode
    RM: 'l',   // Reset Mode
    SGR: 'm',  // Select Graphic Rendition
    DSR: 'n',  // Device Status Report
    DECSTBM: 'r', // Set Top and Bottom Margins
    SCP: 's',  // Save Cursor Position
    RCP: 'u',  // Restore Cursor Position
    ICH: '@',  // Insert Characters
};

/**
 * OSC command identifiers.
 */
export const OSC = {
    SET_TITLE: 0,
    SET_ICON: 1,
    SET_TITLE_AND_ICON: 2,
    SET_X_PROPERTY: 3,
    SET_COLOR: 4,
    HYPERLINK: 8,
    SET_FOREGROUND: 10,
    SET_BACKGROUND: 11,
    SET_CURSOR_COLOR: 12,
    SET_SELECTION: 52,
    RESET_COLOR: 104,
    RESET_FOREGROUND: 110,
    RESET_BACKGROUND: 111,
    RESET_CURSOR_COLOR: 112,
};

/**
 * Private mode identifiers (DEC modes).
 */
export const DECMODE = {
    DECCKM: 1,      // Cursor Keys Mode
    DECANM: 2,      // ANSI/VT52 Mode
    DECCOLM: 3,     // Column Mode (80/132)
    DECSCLM: 4,     // Scrolling Mode
    DECSCNM: 5,     // Screen Mode (Reverse Video)
    DECOM: 6,       // Origin Mode
    DECAWM: 7,      // Auto-Wrap Mode
    DECARM: 8,      // Auto-Repeat Mode
    X10_MOUSE: 9,   // X10 Mouse Reporting
    DECTCEM: 25,    // Text Cursor Enable Mode
    DECNKM: 66,     // Numeric Keypad Mode
    DECBKM: 67,     // Backarrow Key Mode
    VT200_MOUSE: 1000,  // VT200 Mouse Reporting
    VT200_HIGHLIGHT_MOUSE: 1001,
    BTN_EVENT_MOUSE: 1002,
    ANY_EVENT_MOUSE: 1003,
    FOCUS_EVENT: 1004,
    UTF8_MOUSE: 1005,
    SGR_MOUSE: 1006,
    URXVT_MOUSE: 1015,
    SGR_PIXEL_MOUSE: 1016,
    ALT_SCREEN: 1047,
    ALT_SCREEN_SAVE_CURSOR: 1049,
    BRACKETED_PASTE: 2004,
};

export default AnsiParser;

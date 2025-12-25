/**
 * mrmd Execution Engine
 *
 * Handles code block execution and REPL interaction.
 * Platform-independent - uses callbacks for UI updates.
 */

import { parseMarkdown } from './markdown-renderer.js';

// ==================== Language Configuration ====================

export const LANG_COMMANDS = {
    python: 'python3',
    julia: 'julia',
    r: 'R --vanilla -q',
    ruby: 'irb --simple-prompt',
    node: 'node',
    js: 'node',
    sh: 'bash',
    bash: 'bash'
};

// ==================== Universal REPL Output Cleaner ====================

export const REPL_PATTERNS = {
    // Universal prompt patterns - most REPLs end prompts with these
    promptEndings: /^.*[>$#:»→%]\s*$/,

    // Common prompt formats
    knownPrompts: [
        /^>>>\s*/,              // Python
        /^In \[\d+\]:\s*/,      // IPython
        /^julia>\s*/,           // Julia
        /^irb[^>]*>\s*/,        // Ruby IRB
        /^gore>\s*/,            // Go
        /^\[\d+\]\s*[>:]\s*/,   // Numbered prompts
        /^[a-z]+>\s*/,          // Simple word> prompts
        /^\$\s*/,               // Shell
        /^%\s*/,                // Some shells
    ],

    // Continuation prompts
    continuationPrompts: /^(\.\.\.|\.\.\.:|   |\t|>\s*$|\+\s*$|\?\s*$)/,

    // Error/exception indicators (KEEP these)
    errorIndicators: [
        /error/i,
        /exception/i,
        /traceback/i,
        /^panic:/i,
        /failed/i,
        /fatal/i,
        /^ERROR:/,
        /^\w+Error:/,
        /^\w+Exception:/,
        /at\s+.*:\d+/,          // Stack trace line
        /File ".*", line \d+/,  // Python traceback
    ],

    // Interrupt/junk patterns (REMOVE these)
    junkPatterns: [
        /^KeyboardInterrupt$/,
        /^InterruptException$/,
        /^\^C/,
        /^Interrupted$/,
        /^SIGINT/,
    ],

    // Return value prefixes (KEEP these)
    returnPrefixes: [
        /^Out\[\d+\]:\s*/,      // IPython
        /^=>\s/,                // Ruby, some REPLs
        /^\[\d+\]\s+/,          // R style [1] value
    ],
};

/**
 * Escape special regex characters.
 */
export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect the prompt pattern from output lines.
 */
export function detectPromptPattern(lines) {
    const candidates = {};

    for (const line of lines) {
        // Check known prompts first
        for (const pattern of REPL_PATTERNS.knownPrompts) {
            const match = line.match(pattern);
            if (match) {
                const key = pattern.source;
                candidates[key] = (candidates[key] || 0) + 1;
            }
        }

        // Also check for lines ending with prompt chars
        if (line.match(REPL_PATTERNS.promptEndings)) {
            const promptMatch = line.match(/^([^a-zA-Z0-9]*[>$#:»→%])\s*(.*)$/);
            if (promptMatch && promptMatch[1]) {
                const key = `^${escapeRegex(promptMatch[1])}\\s*`;
                candidates[key] = (candidates[key] || 0) + 1;
            }
        }
    }

    // Return the most common pattern
    let bestPattern = null;
    let bestCount = 0;
    for (const [pattern, count] of Object.entries(candidates)) {
        if (count > bestCount) {
            bestCount = count;
            bestPattern = pattern;
        }
    }

    return bestPattern ? new RegExp(bestPattern) : null;
}

/**
 * Check if a line is likely an error/exception.
 */
export function isErrorLine(line) {
    return REPL_PATTERNS.errorIndicators.some(p => p.test(line));
}

/**
 * Check if a line is junk to be removed.
 */
export function isJunkLine(line) {
    return REPL_PATTERNS.junkPatterns.some(p => p.test(line));
}

/**
 * Clean REPL output - remove prompts, keep errors and return values.
 */
export function cleanReplOutput(output, lang = '') {
    if (!output || !output.trim()) return '';

    const lines = output.split('\n');
    const detectedPrompt = detectPromptPattern(lines);
    const cleaned = [];
    let inError = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip junk lines
        if (isJunkLine(line)) continue;

        // Track if we're in an error block
        if (isErrorLine(line)) inError = true;

        // Keep error lines
        if (inError) {
            cleaned.push(line);
            // End error block at empty line or new prompt
            if (!line.trim() || (detectedPrompt && detectedPrompt.test(line))) {
                inError = false;
            }
            continue;
        }

        // Remove detected prompt prefix
        if (detectedPrompt) {
            line = line.replace(detectedPrompt, '');
        }

        // Remove continuation prompts from start
        line = line.replace(/^(\.\.\.|\.\.\.:|   |\t)/, '');

        // Check for return value prefixes - keep these but clean prefix
        for (const prefix of REPL_PATTERNS.returnPrefixes) {
            if (prefix.test(line)) {
                cleaned.push(line);
                break;
            }
        }

        // Skip empty lines at start
        if (cleaned.length === 0 && !line.trim()) continue;

        // Skip prompt-only lines
        if (REPL_PATTERNS.promptEndings.test(line) && !line.replace(/[>$#:»→%\s]/g, '').trim()) {
            continue;
        }

        // Keep the line if it has content
        if (line.trim()) {
            cleaned.push(line);
        }
    }

    // Trim trailing empty/prompt lines
    while (cleaned.length > 0) {
        const last = cleaned[cleaned.length - 1];
        if (!last.trim() || REPL_PATTERNS.promptEndings.test(last)) {
            cleaned.pop();
        } else {
            break;
        }
    }

    return cleaned.join('\n').trim();
}

// ==================== Execution Engine Class ====================

/**
 * ExecutionEngine handles code block execution and REPL sessions.
 */
export class ExecutionEngine {
    /**
     * @param {Object} options
     * @param {string} options.apiBase - API base URL
     * @param {Function} options.onStatusChange - Called when status changes (text, active)
     * @param {Function} options.onTerminalUpdate - Called when terminal state updates
     * @param {Function} options.getPythonCommand - Returns Python start command
     * @param {Function} options.getSessionOptions - Returns session options {cwd, python_env}
     */
    constructor(options = {}) {
        this.apiBase = options.apiBase || '';
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onTerminalUpdate = options.onTerminalUpdate || (() => {});
        this.getPythonCommand = options.getPythonCommand || (() => Promise.resolve('python3'));
        this.getSessionOptions = options.getSessionOptions || (() => ({}));

        this.terminalState = null;
        this.baselineSnapshot = '';
    }

    /**
     * Execute a code block.
     * @param {Object} block - Parsed block from parseMarkdown
     * @param {number} blockIdx - Block index
     * @param {string} editorContent - Current editor content
     * @returns {Promise<{output: string, styled: string, newContent: string}|null>}
     */
    async executeCodeBlock(block, blockIdx, editorContent) {
        this.onStatusChange('running...', true);

        const sessionOpts = this.getSessionOptions();
        const sessionId = block.session || block.lang;

        try {
            // First interaction - include session options for new sessions
            let res = await fetch(`${this.apiBase}/api/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keys: '', wait: 0.1, session: sessionId,
                    ...sessionOpts
                })
            });
            let data = await res.json();

            let startCmd = LANG_COMMANDS[block.lang];

            // For Python, get IPython start command from backend
            if (block.lang === 'python') {
                startCmd = await this.getPythonCommand();
            }

            const lastLine = (data.lines || []).filter(l => l.trim()).pop() || '';
            const needsStart = lastLine.includes('$') || !lastLine.match(/^(>>>|In \[|julia>|>)/);

            if (needsStart && startCmd) {
                res = await fetch(`${this.apiBase}/api/interact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys: startCmd + '<enter>', wait: 'auto', session: sessionId })
                });
                data = await res.json();
            }

            this.terminalState = data;
            const baseline = this.getFullSnapshot();
            const code = block.content.trim();
            const codeLines = code.split('\n');

            for (let i = 0; i < codeLines.length; i++) {
                res = await fetch(`${this.apiBase}/api/interact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        keys: codeLines[i] + '<enter>',
                        wait: i === codeLines.length - 1 ? 'auto' : 0.1,
                        session: sessionId
                    })
                });
            }

            data = await res.json();
            this.terminalState = data;
            this.onTerminalUpdate(this.terminalState);

            // Extract output
            const { text: plainOutput, styled: styledOutput } = this.extractStyledOutput(baseline);

            // Clean output
            const cleanedOutput = cleanReplOutput(plainOutput, block.lang);

            this.onStatusChange('ready', false);

            if (cleanedOutput) {
                // Generate new editor content with output block
                const newContent = this.injectOutput(editorContent, block, blockIdx, cleanedOutput);
                return {
                    output: cleanedOutput,
                    styled: styledOutput,
                    newContent,
                    outputBlockId: `output-after-${blockIdx}`
                };
            }

            return null;

        } catch (err) {
            console.error('Execution error:', err);
            this.onStatusChange('error', false);
            return null;
        }
    }

    /**
     * Inject output into editor content after a code block.
     */
    injectOutput(editorContent, block, blockIdx, output) {
        const lines = editorContent.split('\n');
        const insertLine = block.endLine + 1;

        // Check if next block is already an output block
        const blocks = parseMarkdown(editorContent);
        const nextBlock = blocks[blockIdx + 1];

        if (nextBlock && nextBlock.type === 'output') {
            // Replace existing output block
            return [
                ...lines.slice(0, nextBlock.startLine + 1),
                output,
                ...lines.slice(nextBlock.endLine)
            ].join('\n');
        } else {
            // Insert new output block
            return [
                ...lines.slice(0, insertLine),
                '',
                '```output',
                output,
                '```',
                ...lines.slice(insertLine)
            ].join('\n');
        }
    }

    /**
     * Get full terminal snapshot as text.
     */
    getFullSnapshot() {
        if (!this.terminalState?.lines) return '';
        let lastNonEmpty = 0;
        this.terminalState.lines.forEach((line, i) => {
            if (line.trim()) lastNonEmpty = i;
        });
        return this.terminalState.lines.slice(0, lastNonEmpty + 2).join('\n');
    }

    /**
     * Extract styled output from terminal state.
     */
    extractStyledOutput(baseline) {
        if (!this.terminalState?.lines) return { text: '', styled: '' };

        const baseLines = baseline.split('\n');
        const currLines = this.terminalState.lines;
        let start = 0;
        while (start < baseLines.length && start < currLines.length && baseLines[start] === currLines[start]) {
            start++;
        }

        // Get plain text
        let textLines = currLines.slice(start);
        while (textLines.length > 0) {
            const last = textLines[textLines.length - 1];
            if (last.match(/^(>>>|In \[\d+\]:|julia>|\$)\s*$/) || !last.trim()) {
                textLines.pop();
            } else {
                break;
            }
        }
        const plainText = textLines.join('\n').trim();

        // Get styled version with ANSI codes
        const styled = this.getStyledLines(start, start + textLines.length);

        return { text: plainText, styled };
    }

    /**
     * Get styled lines with ANSI codes.
     */
    getStyledLines(startRow, endRow) {
        if (!this.terminalState?.lines_with_style) return '';

        const lines = [];
        const styled = this.terminalState.lines_with_style;

        for (let row = startRow; row < endRow && row < styled.length; row++) {
            const styledRow = styled[row];
            if (!styledRow) {
                lines.push(this.terminalState.lines[row] || '');
                continue;
            }

            let line = '';
            let lastFg = null;
            let lastBold = false;

            for (let col = 0; col < styledRow.length; col++) {
                const cell = styledRow[col];
                const char = this.terminalState.lines[row]?.[col] || ' ';

                // Add ANSI codes for style changes
                if (cell?.fg !== lastFg || cell?.bold !== lastBold) {
                    if (lastFg || lastBold) line += '\x1b[0m';
                    if (cell?.bold) line += '\x1b[1m';
                    if (cell?.fg && cell.fg !== 'default') {
                        const colors = { red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37 };
                        if (colors[cell.fg]) line += `\x1b[${colors[cell.fg]}m`;
                    }
                    lastFg = cell?.fg;
                    lastBold = cell?.bold;
                }
                line += char;
            }

            if (lastFg || lastBold) line += '\x1b[0m';
            lines.push(line);
        }

        return lines.join('\n');
    }

    /**
     * Send a key to the terminal.
     * @param {string} keys - Key sequence
     * @param {string} sessionId - Session ID
     * @param {number} wait - Wait time
     * @returns {Promise<Object>} Terminal state
     */
    async sendKeys(keys, sessionId, wait = 0.05) {
        const res = await fetch(`${this.apiBase}/api/interact`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys, wait, session: sessionId })
        });
        this.terminalState = await res.json();
        this.onTerminalUpdate(this.terminalState);
        return this.terminalState;
    }

    /**
     * Clear all sessions.
     */
    async clearAllSessions() {
        await fetch(`${this.apiBase}/api/sessions/clear`, { method: 'POST' });
    }

    /**
     * Get list of active sessions.
     */
    async getSessions() {
        const res = await fetch(`${this.apiBase}/api/sessions`);
        const data = await res.json();
        return data.sessions || [];
    }
}

/**
 * Create a default execution engine with browser defaults.
 */
export function createExecutionEngine(options = {}) {
    return new ExecutionEngine(options);
}

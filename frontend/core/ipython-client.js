/**
 * IPython Client for mrmd
 *
 * Platform-agnostic client for IPython completion, inspection, and execution.
 * Can be used in web browsers, VSCode webviews, Tauri, or Electron apps.
 *
 * Usage:
 *   const client = new IPythonClient({ apiBase: 'http://localhost:8765' });
 *   const completions = await client.complete('import nu', 9);
 */

/**
 * @typedef {Object} CompletionResult
 * @property {string[]} matches - List of completion strings
 * @property {number} cursor_start - Start position of text being completed
 * @property {number} cursor_end - End position of text being completed
 * @property {Object} metadata - Additional metadata about completions
 */

/**
 * @typedef {Object} InspectionResult
 * @property {boolean} found - Whether object was found
 * @property {string} name - Object name
 * @property {string} signature - Function signature if applicable
 * @property {string} docstring - Documentation string
 * @property {string} type - Object type
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - Whether execution succeeded
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 * @property {string} result - Return value representation
 * @property {string} error - Error message if failed
 * @property {string} traceback - Full traceback if error
 * @property {Object[]} display_data - Rich display outputs (plots, HTML, etc.)
 */

/**
 * IPython API client.
 *
 * IMPORTANT: This client maintains state (projectPath, figureDir) that MUST be set
 * when a project is opened. The server-side IPython worker subprocess is started
 * without these values, and they are passed with each request. If figureDir is not
 * set, matplotlib figures won't be saved.
 *
 * The figureDir setting is particularly tricky:
 * - Worker processes may already be running when a project is opened
 * - The server dynamically updates the worker's figure_dir via RPC when it changes
 * - Every code path that opens a project MUST call setFigureDir()
 *   (e.g., recent projects panel, file browser, welcome screen)
 */
export class IPythonClient {
    /**
     * @param {Object} options
     * @param {string} options.apiBase - Base URL for API calls
     * @param {string} options.sessionId - Session identifier (default: 'main')
     * @param {string} options.projectPath - Project path for auto-restore of saved sessions
     * @param {string} options.figureDir - Directory to save matplotlib figures (e.g., projectPath + '/.mrmd/assets')
     * @param {Function} options.fetch - Custom fetch function (for non-browser environments)
     */
    constructor(options = {}) {
        this.apiBase = options.apiBase || '';
        this.sessionId = options.sessionId || 'main';
        this.projectPath = options.projectPath || null;
        this.figureDir = options.figureDir || null;
        this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    }

    /**
     * Set the session ID.
     * @param {string} sessionId
     */
    setSession(sessionId) {
        this.sessionId = sessionId;
    }

    /**
     * Set the project path (for auto-restore of saved sessions).
     * @param {string} projectPath
     */
    setProjectPath(projectPath) {
        this.projectPath = projectPath;
    }

    /**
     * Set the figure directory (for matplotlib plots).
     *
     * CRITICAL: This must be called whenever a project is opened. Without it,
     * matplotlib plt.show() will not save figures. The figure_dir is passed
     * to the server on each execute request, which then updates the running
     * worker process via RPC if needed.
     *
     * @param {string} figureDir - Absolute path, typically projectPath + '/.mrmd/assets'
     */
    setFigureDir(figureDir) {
        this.figureDir = figureDir;
    }

    /**
     * Make an API request.
     * @private
     */
    async _request(endpoint, body = {}) {
        try {
            const requestBody = { session: this.sessionId, ...body };
            if (this.figureDir) {
                requestBody.figure_dir = this.figureDir;
            }
            if (this.projectPath) {
                requestBody.project_path = this.projectPath;
            }
            const res = await this._fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }
            return await res.json();
        } catch (err) {
            console.error(`IPython API error (${endpoint}):`, err);
            return null;
        }
    }

    /**
     * Get completions for code at cursor position.
     * @param {string} code - The code to complete
     * @param {number} cursorPos - Cursor position in the code
     * @returns {Promise<CompletionResult|null>}
     */
    async complete(code, cursorPos) {
        return this._request('/api/ipython/complete', { code, cursor_pos: cursorPos });
    }

    /**
     * Get documentation/inspection for object at cursor.
     * @param {string} code - The code containing the object
     * @param {number} cursorPos - Cursor position in the code
     * @param {number} detailLevel - Detail level (0 or 1)
     * @returns {Promise<InspectionResult|null>}
     */
    async inspect(code, cursorPos, detailLevel = 0) {
        return this._request('/api/ipython/inspect', {
            code,
            cursor_pos: cursorPos,
            detail_level: detailLevel
        });
    }

    /**
     * Execute code.
     * @param {string} code - Code to execute
     * @param {boolean} storeHistory - Whether to store in history
     * @returns {Promise<ExecutionResult|null>}
     */
    async execute(code, storeHistory = true) {
        return this._request('/api/ipython/execute', {
            code,
            store_history: storeHistory
        });
    }

    /**
     * Check if code is complete (for multi-line input).
     * @param {string} code - Code to check
     * @returns {Promise<{status: 'complete'|'incomplete'|'invalid'|'unknown', indent: string}|null>}
     */
    async isComplete(code) {
        return this._request('/api/ipython/is_complete', { code });
    }

    /**
     * Reset the IPython session.
     * @returns {Promise<{success: boolean}|null>}
     */
    async reset() {
        return this._request('/api/ipython/reset', {});
    }

    /**
     * Restart the server process.
     * The page will need to be reloaded after the server restarts.
     * @returns {Promise<{status: string, message: string}|null>}
     */
    async restartServer() {
        return this._request('/api/server/restart', {});
    }

    /**
     * Execute code with streaming output via SSE.
     * @param {string} code - Code to execute
     * @param {Function} onChunk - Callback for each chunk: (accumulated: string, done: boolean) => void
     * @param {boolean} storeHistory - Whether to store in history
     * @returns {Promise<ExecutionResult|null>} Final result
     */
    async executeStreaming(code, onChunk, storeHistory = true) {
        return new Promise((resolve, reject) => {
            let finalResult = null;

            const body = {
                code,
                session: this.sessionId,
                store_history: storeHistory,
            };
            // Include project_path for auto-restore of saved sessions
            if (this.projectPath) {
                body.project_path = this.projectPath;
            }
            // Include figure_dir for matplotlib plots
            if (this.figureDir) {
                body.figure_dir = this.figureDir;
            }

            this._fetch(`${this.apiBase}/api/ipython/execute/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Streaming execution failed: ${response.statusText}`);
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error('No response body');
                }

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Parse SSE events from buffer
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    let eventType = '';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.slice(7);
                        } else if (line.startsWith('data: ')) {
                            eventData = line.slice(6);

                            if (eventType && eventData) {
                                try {
                                    const parsed = JSON.parse(eventData);

                                    if (eventType === 'chunk') {
                                        // Server provides accumulated output
                                        const accumulated = parsed.accumulated || parsed.content || '';
                                        onChunk(accumulated, false);
                                    } else if (eventType === 'result') {
                                        finalResult = parsed;
                                    } else if (eventType === 'done') {
                                        onChunk(finalResult?.formatted_output || '', true);
                                        resolve(finalResult);
                                    }
                                } catch (e) {
                                    console.error('SSE parse error:', e);
                                }

                                eventType = '';
                                eventData = '';
                            }
                        }
                    }
                }

                // If we exit without 'done' event, resolve with what we have
                if (finalResult) {
                    resolve(finalResult);
                } else {
                    resolve(null);
                }
            }).catch(error => {
                console.error('Streaming execution error:', error);
                reject(error);
            });
        });
    }

    /**
     * List all active sessions.
     * @returns {Promise<{sessions: string[]}|null>}
     */
    async listSessions() {
        try {
            const res = await this._fetch(`${this.apiBase}/api/ipython/sessions`);
            return await res.json();
        } catch (err) {
            console.error('IPython sessions error:', err);
            return null;
        }
    }

    /**
     * Get variables in the current session's namespace.
     * Like RStudio's Environment pane.
     * @returns {Promise<{session_id: string, variables: Array<{name: string, type: string, value: string, size?: string}>}|null>}
     */
    async getVariables() {
        return this._request('/api/ipython/variables', {});
    }

    /**
     * Inspect an object by path for drill-down.
     * @param {string} path - Object path like "df", "obj.attr", "mylist[0]"
     * @returns {Promise<Object|null>}
     */
    async inspectObject(path) {
        return this._request('/api/ipython/inspect_object', { path });
    }

    /**
     * Get hover information for a variable/object.
     * Returns value preview, type info, and docstring for hover tooltips.
     * @param {string} name - Variable or expression to inspect
     * @returns {Promise<{found: boolean, name: string, type: string, value: string, docstring?: string, signature?: string}|null>}
     */
    async hoverInspect(name) {
        return this._request('/api/ipython/hover', { name });
    }
}

/**
 * Completion UI controller.
 * Manages autocomplete dropdown, ghost completion, and keyboard navigation.
 * Platform-agnostic - just needs DOM elements and callbacks.
 *
 * IPython-style behavior:
 * - Tab triggers completion
 * - If unique match or common prefix, complete immediately
 * - If multiple matches with no common prefix, show dropdown
 * - Tab again accepts selection
 */
export class CompletionController {
    /**
     * @param {Object} options
     * @param {IPythonClient} options.client - IPython client instance
     * @param {HTMLElement} options.dropdownEl - Autocomplete dropdown element
     * @param {HTMLElement} options.ghostEl - Ghost completion element (optional)
     * @param {HTMLElement} options.helpEl - Help popover element (optional)
     * @param {Function} options.getCaretCoords - Function to get caret pixel coordinates
     * @param {Function} options.escapeHtml - HTML escape function
     */
    constructor(options) {
        this.client = options.client;
        this.dropdownEl = options.dropdownEl;
        this.ghostEl = options.ghostEl;
        this.helpEl = options.helpEl;
        this.getCaretCoords = options.getCaretCoords;
        this.escapeHtml = options.escapeHtml || (s => s.replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[c]));

        // State
        this.items = [];
        this.selectedIndex = 0;
        this.active = false;
        this.startPos = 0;
        this.editor = null;

        // Trigger characters (empty by default - IPython style is Tab-only)
        this.triggerChars = [];
    }

    /**
     * Find longest common prefix among strings.
     * @param {string[]} strings
     * @returns {string}
     */
    _commonPrefix(strings) {
        if (!strings || strings.length === 0) return '';
        if (strings.length === 1) return strings[0];

        let prefix = strings[0];
        for (let i = 1; i < strings.length; i++) {
            while (strings[i].indexOf(prefix) !== 0) {
                prefix = prefix.substring(0, prefix.length - 1);
                if (prefix === '') return '';
            }
        }
        return prefix;
    }

    /**
     * Show completions dropdown.
     * @param {HTMLTextAreaElement|HTMLInputElement} editor - The editor element
     * @param {string[]} items - Completion items
     * @param {number} startPos - Start position for replacement
     */
    show(editor, items, startPos) {
        if (!items || items.length === 0) {
            this.hide();
            return;
        }

        this.editor = editor;
        this.items = items;
        this.selectedIndex = 0;
        this.active = true;
        this.startPos = startPos;

        this._positionDropdown();
        this._render();
        this.dropdownEl.classList.add('active');
        // Note: Ghost completion disabled for IPython-style behavior
        // Uncomment to enable: this._updateGhost();
    }

    /**
     * Hide completions dropdown.
     */
    hide() {
        this.dropdownEl.classList.remove('active');
        this.active = false;
        this.items = [];
        this._hideGhost();
    }

    /**
     * Navigate selection up/down.
     * @param {number} delta - Direction (+1 or -1)
     */
    navigate(delta) {
        if (!this.active || this.items.length === 0) return;
        this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
        this._render();
        // Note: Ghost completion disabled for IPython-style behavior
    }

    /**
     * Apply the selected completion.
     * @returns {boolean} Whether a completion was applied
     */
    apply() {
        if (!this.active || this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
            return false;
        }

        const item = this.items[this.selectedIndex];
        const text = typeof item === 'string' ? item : item.text;

        // Replace text from startPos to cursor
        const before = this.editor.value.substring(0, this.startPos);
        const after = this.editor.value.substring(this.editor.selectionStart);

        this.editor.value = before + text + after;
        this.editor.selectionStart = this.editor.selectionEnd = this.startPos + text.length;

        this.hide();
        return true;
    }

    /**
     * Filter completions based on typed text.
     * @param {string} typed - Text typed since completion started
     */
    filter(typed) {
        if (!this.active) return;

        const filtered = this.items.filter(item => {
            const text = typeof item === 'string' ? item : item.text;
            return text.toLowerCase().startsWith(typed.toLowerCase());
        });

        if (filtered.length === 0) {
            this.hide();
        } else {
            this.items = filtered;
            this.selectedIndex = 0;
            this._render();
            this._updateGhost();
        }
    }

    /**
     * Trigger completion request (IPython-style).
     * - If single match: complete immediately
     * - If common prefix longer than typed: complete to prefix
     * - Otherwise: show dropdown
     *
     * @param {HTMLTextAreaElement} editor - Editor element
     * @param {string} code - Code in the block
     * @param {number} cursorPos - Cursor position in code
     * @param {number} blockStartOffset - Character offset to block start in editor
     * @returns {Promise<{completed: boolean, showedDropdown: boolean}>}
     */
    async trigger(editor, code, cursorPos, blockStartOffset) {
        const result = await this.client.complete(code, cursorPos);
        if (!result || !result.matches || result.matches.length === 0) {
            this.hide();
            return { completed: false, showedDropdown: false };
        }

        const startPos = blockStartOffset + result.cursor_start;
        const typed = editor.value.substring(startPos, editor.selectionStart);
        const matches = result.matches;

        // Single match - complete immediately
        if (matches.length === 1) {
            this._applyText(editor, startPos, matches[0]);
            return { completed: true, showedDropdown: false };
        }

        // Multiple matches - check for common prefix
        const prefix = this._commonPrefix(matches);

        // If common prefix is longer than what's typed, complete to prefix
        if (prefix.length > typed.length) {
            this._applyText(editor, startPos, prefix);
            return { completed: true, showedDropdown: false };
        }

        // No further completion possible - show dropdown
        this.show(editor, matches, startPos);
        return { completed: false, showedDropdown: true };
    }

    /**
     * Apply text completion without showing dropdown.
     * @private
     */
    _applyText(editor, startPos, text) {
        const before = editor.value.substring(0, startPos);
        const after = editor.value.substring(editor.selectionStart);
        editor.value = before + text + after;
        editor.selectionStart = editor.selectionEnd = startPos + text.length;
    }

    /**
     * Check if character should trigger immediate completion.
     * @param {string} char - The character typed
     * @returns {boolean}
     */
    shouldTrigger(char) {
        return this.triggerChars.includes(char);
    }

    // Private methods

    _positionDropdown() {
        if (!this.editor || !this.getCaretCoords) return;

        const rect = this.editor.getBoundingClientRect();
        const coords = this.getCaretCoords(this.editor);

        this.dropdownEl.style.left = `${rect.left + coords.left}px`;
        this.dropdownEl.style.top = `${rect.top + coords.top + 20}px`;
    }

    _render() {
        const maxItems = 20;
        this.dropdownEl.innerHTML = this.items.slice(0, maxItems).map((item, i) => {
            const text = typeof item === 'string' ? item : item.text;
            const type = typeof item === 'object' ? item.type : '';
            const selected = i === this.selectedIndex ? ' selected' : '';
            return `
                <div class="autocomplete-item${selected}" data-index="${i}">
                    ${this.escapeHtml(text)}
                    ${type ? `<span class="type">${this.escapeHtml(type)}</span>` : ''}
                </div>
            `;
        }).join('');

        // Add click handlers
        this.dropdownEl.querySelectorAll('.autocomplete-item').forEach(el => {
            el.addEventListener('click', () => {
                this.selectedIndex = parseInt(el.dataset.index);
                this.apply();
            });
        });

        // Scroll selected into view
        const selected = this.dropdownEl.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    _updateGhost() {
        if (!this.ghostEl || !this.editor || this.items.length === 0) {
            this._hideGhost();
            return;
        }

        const item = this.items[this.selectedIndex];
        const text = typeof item === 'string' ? item : item.text;
        const typed = this.editor.value.substring(this.startPos, this.editor.selectionStart);
        const remaining = text.substring(typed.length);

        if (!remaining) {
            this._hideGhost();
            return;
        }

        const rect = this.editor.getBoundingClientRect();
        const coords = this.getCaretCoords(this.editor);

        this.ghostEl.textContent = remaining;
        this.ghostEl.style.left = `${rect.left + coords.left}px`;
        this.ghostEl.style.top = `${rect.top + coords.top}px`;
        this.ghostEl.classList.add('active');
    }

    _hideGhost() {
        if (this.ghostEl) {
            this.ghostEl.classList.remove('active');
        }
    }
}

/**
 * Help/Documentation popover controller.
 */
export class HelpController {
    /**
     * @param {Object} options
     * @param {IPythonClient} options.client - IPython client instance
     * @param {HTMLElement} options.popoverEl - Help popover element
     * @param {HTMLElement} options.signatureEl - Signature display element
     * @param {HTMLElement} options.docstringEl - Docstring display element
     * @param {Function} options.getCaretCoords - Function to get caret pixel coordinates
     */
    constructor(options) {
        this.client = options.client;
        this.popoverEl = options.popoverEl;
        this.signatureEl = options.signatureEl;
        this.docstringEl = options.docstringEl;
        this.getCaretCoords = options.getCaretCoords;
        this.editor = null;
    }

    /**
     * Show help for code at cursor.
     * @param {HTMLTextAreaElement} editor - Editor element
     * @param {string} code - Code in the block
     * @param {number} cursorPos - Cursor position in code
     */
    async show(editor, code, cursorPos) {
        this.editor = editor;
        const result = await this.client.inspect(code, cursorPos);

        if (result && result.found) {
            this._display(result.signature, result.docstring);
        } else {
            this.hide();
        }
    }

    /**
     * Hide the help popover.
     */
    hide() {
        this.popoverEl.classList.remove('active');
    }

    _display(signature, docstring) {
        if (!signature && !docstring) {
            this.hide();
            return;
        }

        if (this.signatureEl) {
            this.signatureEl.textContent = signature || '';
        }
        if (this.docstringEl) {
            this.docstringEl.textContent = docstring || '';
        }

        this._position();
        this.popoverEl.classList.add('active');
    }

    _position() {
        if (!this.editor || !this.getCaretCoords) return;

        const rect = this.editor.getBoundingClientRect();
        const coords = this.getCaretCoords(this.editor);

        // Position above cursor
        const popoverHeight = this.popoverEl.offsetHeight || 150;
        this.popoverEl.style.left = `${rect.left + coords.left}px`;
        this.popoverEl.style.top = `${rect.top + coords.top - popoverHeight - 10}px`;
    }
}

/**
 * Code block context detector.
 * Finds code blocks in markdown and extracts context for completion.
 */
export class CodeBlockDetector {
    /**
     * @param {Object} options
     * @param {string[]} options.languages - Languages to detect (default: ['python'])
     */
    constructor(options = {}) {
        this.languages = options.languages || ['python'];
    }

    /**
     * Get code block context at cursor position.
     * @param {string} text - Full document text
     * @param {number} cursorPos - Cursor position in document
     * @returns {{lang: string, code: string, cursorPos: number, blockStart: number, blockEnd: number, blockStartOffset: number}|null}
     */
    getContext(text, cursorPos) {
        const lines = text.split('\n');

        // Find cursor line
        let charCount = 0;
        let cursorLine = 0;
        for (let i = 0; i < lines.length; i++) {
            if (charCount + lines[i].length >= cursorPos) {
                cursorLine = i;
                break;
            }
            charCount += lines[i].length + 1;
        }

        // Search backwards for opening fence
        let blockStart = -1;
        let lang = null;
        for (let i = cursorLine; i >= 0; i--) {
            const match = lines[i].match(/^```(\w+)/);
            if (match) {
                blockStart = i;
                lang = match[1];
                break;
            }
            if (lines[i] === '```') {
                return null; // Outside code block
            }
        }

        if (blockStart === -1 || !lang) return null;
        if (!this.languages.includes(lang)) return null;

        // Search forwards for closing fence
        let blockEnd = -1;
        for (let i = cursorLine + 1; i < lines.length; i++) {
            if (lines[i].startsWith('```')) {
                blockEnd = i;
                break;
            }
        }
        if (blockEnd === -1) blockEnd = lines.length;

        // Check cursor is inside block
        if (cursorLine <= blockStart || cursorLine >= blockEnd) return null;

        // Calculate offset to start of code (after opening fence)
        let blockStartOffset = 0;
        for (let i = 0; i <= blockStart; i++) {
            blockStartOffset += lines[i].length + 1;
        }

        // Extract code up to cursor
        const codeLines = lines.slice(blockStart + 1, cursorLine + 1);
        const lastLineOffset = cursorPos - charCount;
        codeLines[codeLines.length - 1] = codeLines[codeLines.length - 1].substring(0, lastLineOffset);
        const code = codeLines.join('\n');

        return {
            lang,
            code,
            cursorPos: code.length,
            blockStart,
            blockEnd,
            blockStartOffset
        };
    }
}

/**
 * Utility: Get caret pixel coordinates in a textarea.
 * @param {HTMLTextAreaElement} textarea
 * @param {Object} options
 * @param {number} options.lineHeight - Line height in pixels (default: 24)
 * @param {number} options.charWidth - Character width in pixels (default: 8.4)
 * @param {number} options.paddingLeft - Left padding in pixels (default: 8)
 * @returns {{top: number, left: number}}
 */
export function getCaretCoordinates(textarea, options = {}) {
    const lineHeight = options.lineHeight || 24;
    const charWidth = options.charWidth || 8.4;
    const paddingLeft = options.paddingLeft || 8;

    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const currentLine = lines.length - 1;
    const currentCol = lines[lines.length - 1].length;

    return {
        top: currentLine * lineHeight - textarea.scrollTop,
        left: currentCol * charWidth - textarea.scrollLeft + paddingLeft
    };
}

/**
 * Factory function to create a complete IPython integration.
 * @param {Object} options
 * @param {string} options.apiBase - API base URL
 * @param {HTMLElement} options.dropdownEl - Autocomplete dropdown element
 * @param {HTMLElement} options.ghostEl - Ghost completion element (optional)
 * @param {HTMLElement} options.helpEl - Help popover element (optional)
 * @param {HTMLElement} options.signatureEl - Signature element (optional)
 * @param {HTMLElement} options.docstringEl - Docstring element (optional)
 * @param {Function} options.escapeHtml - HTML escape function
 * @param {Object} options.caretOptions - Options for caret coordinate calculation
 * @returns {{client: IPythonClient, completion: CompletionController, help: HelpController, detector: CodeBlockDetector}}
 */
export function createIPythonIntegration(options) {
    const client = new IPythonClient({ apiBase: options.apiBase });

    const getCoords = (editor) => getCaretCoordinates(editor, options.caretOptions);

    const completion = new CompletionController({
        client,
        dropdownEl: options.dropdownEl,
        ghostEl: options.ghostEl,
        getCaretCoords: getCoords,
        escapeHtml: options.escapeHtml
    });

    const help = new HelpController({
        client,
        popoverEl: options.helpEl,
        signatureEl: options.signatureEl,
        docstringEl: options.docstringEl,
        getCaretCoords: getCoords
    });

    const detector = new CodeBlockDetector({ languages: ['python'] });

    return { client, completion, help, detector };
}

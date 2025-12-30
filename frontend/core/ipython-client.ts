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

// ============================================================================
// Types
// ============================================================================

export interface IPythonClientOptions {
    apiBase?: string;
    sessionId?: string;
    projectPath?: string | null;
    figureDir?: string | null;
    fetch?: typeof globalThis.fetch;
}

export interface CompletionResult {
    matches: string[];
    cursor_start: number;
    cursor_end: number;
    metadata: Record<string, unknown>;
}

export interface InspectionResult {
    found: boolean;
    name: string;
    signature?: string;
    docstring?: string;
    type?: string;
}

export interface ExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    result?: string;
    error?: string;
    traceback?: string;
    display_data?: DisplayData[];
    saved_assets?: SavedAsset[];
    execution_count?: number;
    formatted_output?: string;
}

export interface DisplayData {
    [mimeType: string]: string;
}

export interface SavedAsset {
    path: string;
    mime_type: string;
    asset_type: string;
}

export interface IsCompleteResult {
    status: 'complete' | 'incomplete' | 'invalid' | 'unknown';
    indent: string;
}

export interface VariableInfo {
    name: string;
    type: string;
    value: string;
    size?: string;
}

export interface VariablesResponse {
    session_id: string;
    variables: VariableInfo[];
}

export interface HoverResult {
    found: boolean;
    name: string;
    type: string;
    value: string;
    docstring?: string;
    signature?: string;
}

// ============================================================================
// IPythonClient
// ============================================================================

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
    // PUBLIC properties - required by editor/src/execution/ipython.ts interface
    public apiBase: string;
    public sessionId: string;
    public projectPath: string | null;
    public figureDir: string | null;
    private _fetch: typeof globalThis.fetch;

    constructor(options: IPythonClientOptions = {}) {
        this.apiBase = options.apiBase || '';
        this.sessionId = options.sessionId || 'main';
        this.projectPath = options.projectPath || null;
        this.figureDir = options.figureDir || null;
        this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    }

    /**
     * Set the session ID.
     */
    setSession(sessionId: string): void {
        this.sessionId = sessionId;
    }

    /**
     * Set the project path (for auto-restore of saved sessions).
     */
    setProjectPath(projectPath: string): void {
        this.projectPath = projectPath;
    }

    /**
     * Set the figure directory (for matplotlib plots).
     *
     * CRITICAL: This must be called whenever a project is opened. Without it,
     * matplotlib plt.show() will not save figures. The figure_dir is passed
     * to the server on each execute request, which then updates the running
     * worker process via RPC if needed.
     */
    setFigureDir(figureDir: string): void {
        this.figureDir = figureDir;
    }

    /**
     * Make an API request.
     */
    private async _request<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T | null> {
        try {
            const requestBody: Record<string, unknown> = { session: this.sessionId, ...body };
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
     */
    async complete(code: string, cursorPos: number): Promise<CompletionResult | null> {
        return this._request<CompletionResult>('/api/ipython/complete', { code, cursor_pos: cursorPos });
    }

    /**
     * Get documentation/inspection for object at cursor.
     */
    async inspect(code: string, cursorPos: number, detailLevel: number = 0): Promise<InspectionResult | null> {
        return this._request<InspectionResult>('/api/ipython/inspect', {
            code,
            cursor_pos: cursorPos,
            detail_level: detailLevel
        });
    }

    /**
     * Execute code.
     */
    async execute(code: string, storeHistory: boolean = true, execId: string | null = null): Promise<ExecutionResult | null> {
        const body: Record<string, unknown> = {
            code,
            store_history: storeHistory
        };
        if (execId) {
            body.exec_id = execId;
        }
        return this._request<ExecutionResult>('/api/ipython/execute', body);
    }

    /**
     * Check if code is complete (for multi-line input).
     */
    async isComplete(code: string): Promise<IsCompleteResult | null> {
        return this._request<IsCompleteResult>('/api/ipython/is_complete', { code });
    }

    /**
     * Reset the IPython session.
     */
    async reset(): Promise<{ success: boolean } | null> {
        return this._request<{ success: boolean }>('/api/ipython/reset', {});
    }

    /**
     * Restart the server process.
     * The page will need to be reloaded after the server restarts.
     */
    async restartServer(): Promise<{ status: string; message: string } | null> {
        return this._request<{ status: string; message: string }>('/api/server/restart', {});
    }

    /**
     * Execute code with streaming output via SSE.
     */
    async executeStreaming(
        code: string,
        onChunk: (accumulated: string, done: boolean) => void,
        storeHistory: boolean = true,
        execId: string | null = null
    ): Promise<ExecutionResult | null> {
        return new Promise((resolve, reject) => {
            let finalResult: ExecutionResult | null = null;

            const body: Record<string, unknown> = {
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
            // Include exec_id for asset naming
            if (execId) {
                body.exec_id = execId;
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
     */
    async listSessions(): Promise<{ sessions: string[] } | null> {
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
     */
    async getVariables(): Promise<VariablesResponse | null> {
        return this._request<VariablesResponse>('/api/ipython/variables', {});
    }

    /**
     * Inspect an object by path for drill-down.
     */
    async inspectObject(path: string): Promise<Record<string, unknown> | null> {
        return this._request<Record<string, unknown>>('/api/ipython/inspect_object', { path });
    }

    /**
     * Get hover information for a variable/object.
     * Returns value preview, type info, and docstring for hover tooltips.
     */
    async hoverInspect(name: string): Promise<HoverResult | null> {
        return this._request<HoverResult>('/api/ipython/hover', { name });
    }

    /**
     * Clean up assets for a given execution ID.
     * This is used when re-running a cell to clean up previous execution's assets.
     */
    async cleanupAssets(execId: string): Promise<{ deleted: string[]; count: number } | null> {
        if (!this.figureDir) {
            return { deleted: [], count: 0 };
        }
        return this._request<{ deleted: string[]; count: number }>('/api/assets/cleanup', {
            exec_id: execId,
            assets_dir: this.figureDir,
        });
    }
}

// ============================================================================
// CompletionController
// ============================================================================

export interface CompletionControllerOptions {
    client: IPythonClient;
    dropdownEl: HTMLElement;
    ghostEl?: HTMLElement;
    helpEl?: HTMLElement;
    getCaretCoords: (editor: HTMLTextAreaElement | HTMLInputElement) => { top: number; left: number };
    escapeHtml?: (html: string) => string;
}

export interface CompletionItem {
    text: string;
    type?: string;
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
    private client: IPythonClient;
    private dropdownEl: HTMLElement;
    private ghostEl?: HTMLElement;
    private getCaretCoords: (editor: HTMLTextAreaElement | HTMLInputElement) => { top: number; left: number };
    private escapeHtml: (html: string) => string;

    // State
    public items: (string | CompletionItem)[] = [];
    public selectedIndex: number = 0;
    public active: boolean = false;
    public startPos: number = 0;
    public editor: HTMLTextAreaElement | HTMLInputElement | null = null;

    // Trigger characters (empty by default - IPython style is Tab-only)
    public triggerChars: string[] = [];

    constructor(options: CompletionControllerOptions) {
        this.client = options.client;
        this.dropdownEl = options.dropdownEl;
        this.ghostEl = options.ghostEl;
        this.getCaretCoords = options.getCaretCoords;
        this.escapeHtml = options.escapeHtml || ((s: string) => s.replace(/[&<>"']/g, (c: string) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        } as Record<string, string>)[c] || c));
    }

    /**
     * Find longest common prefix among strings.
     */
    private _commonPrefix(strings: string[]): string {
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
     */
    show(editor: HTMLTextAreaElement | HTMLInputElement, items: (string | CompletionItem)[], startPos: number): void {
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
    }

    /**
     * Hide completions dropdown.
     */
    hide(): void {
        this.dropdownEl.classList.remove('active');
        this.active = false;
        this.items = [];
        this._hideGhost();
    }

    /**
     * Navigate selection up/down.
     */
    navigate(delta: number): void {
        if (!this.active || this.items.length === 0) return;
        this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
        this._render();
    }

    /**
     * Apply the selected completion.
     */
    apply(): boolean {
        if (!this.active || this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
            return false;
        }

        const item = this.items[this.selectedIndex];
        const text = typeof item === 'string' ? item : item.text;

        if (!this.editor) return false;

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
     */
    filter(typed: string): void {
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
     */
    async trigger(
        editor: HTMLTextAreaElement,
        code: string,
        cursorPos: number,
        blockStartOffset: number
    ): Promise<{ completed: boolean; showedDropdown: boolean }> {
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
     */
    private _applyText(editor: HTMLTextAreaElement | HTMLInputElement, startPos: number, text: string): void {
        const before = editor.value.substring(0, startPos);
        const after = editor.value.substring(editor.selectionStart);
        editor.value = before + text + after;
        editor.selectionStart = editor.selectionEnd = startPos + text.length;
    }

    /**
     * Check if character should trigger immediate completion.
     */
    shouldTrigger(char: string): boolean {
        return this.triggerChars.includes(char);
    }

    // Private methods

    private _positionDropdown(): void {
        if (!this.editor || !this.getCaretCoords) return;

        const rect = this.editor.getBoundingClientRect();
        const coords = this.getCaretCoords(this.editor);

        this.dropdownEl.style.left = `${rect.left + coords.left}px`;
        this.dropdownEl.style.top = `${rect.top + coords.top + 20}px`;
    }

    private _render(): void {
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
                const htmlEl = el as HTMLElement;
                this.selectedIndex = parseInt(htmlEl.dataset.index || '0', 10);
                this.apply();
            });
        });

        // Scroll selected into view
        const selected = this.dropdownEl.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    private _updateGhost(): void {
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

    private _hideGhost(): void {
        if (this.ghostEl) {
            this.ghostEl.classList.remove('active');
        }
    }
}

// ============================================================================
// HelpController
// ============================================================================

export interface HelpControllerOptions {
    client: IPythonClient;
    popoverEl: HTMLElement;
    signatureEl?: HTMLElement;
    docstringEl?: HTMLElement;
    getCaretCoords: (editor: HTMLTextAreaElement | HTMLInputElement) => { top: number; left: number };
}

/**
 * Help/Documentation popover controller.
 */
export class HelpController {
    private client: IPythonClient;
    private popoverEl: HTMLElement;
    private signatureEl?: HTMLElement;
    private docstringEl?: HTMLElement;
    private getCaretCoords: (editor: HTMLTextAreaElement | HTMLInputElement) => { top: number; left: number };
    private editor: HTMLTextAreaElement | null = null;

    constructor(options: HelpControllerOptions) {
        this.client = options.client;
        this.popoverEl = options.popoverEl;
        this.signatureEl = options.signatureEl;
        this.docstringEl = options.docstringEl;
        this.getCaretCoords = options.getCaretCoords;
    }

    /**
     * Show help for code at cursor.
     */
    async show(editor: HTMLTextAreaElement, code: string, cursorPos: number): Promise<void> {
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
    hide(): void {
        this.popoverEl.classList.remove('active');
    }

    private _display(signature?: string, docstring?: string): void {
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

    private _position(): void {
        if (!this.editor || !this.getCaretCoords) return;

        const rect = this.editor.getBoundingClientRect();
        const coords = this.getCaretCoords(this.editor);

        // Position above cursor
        const popoverHeight = this.popoverEl.offsetHeight || 150;
        this.popoverEl.style.left = `${rect.left + coords.left}px`;
        this.popoverEl.style.top = `${rect.top + coords.top - popoverHeight - 10}px`;
    }
}

// ============================================================================
// CodeBlockDetector
// ============================================================================

export interface CodeBlockDetectorOptions {
    languages?: string[];
}

export interface CodeBlockContext {
    lang: string;
    code: string;
    cursorPos: number;
    blockStart: number;
    blockEnd: number;
    blockStartOffset: number;
}

/**
 * Code block context detector.
 * Finds code blocks in markdown and extracts context for completion.
 */
export class CodeBlockDetector {
    public languages: string[];

    constructor(options: CodeBlockDetectorOptions = {}) {
        this.languages = options.languages || ['python'];
    }

    /**
     * Get code block context at cursor position.
     */
    getContext(text: string, cursorPos: number): CodeBlockContext | null {
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
        let lang: string | null = null;
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

// ============================================================================
// Utilities
// ============================================================================

export interface CaretCoordinatesOptions {
    lineHeight?: number;
    charWidth?: number;
    paddingLeft?: number;
}

/**
 * Utility: Get caret pixel coordinates in a textarea.
 */
export function getCaretCoordinates(
    textarea: HTMLTextAreaElement,
    options: CaretCoordinatesOptions = {}
): { top: number; left: number } {
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

// ============================================================================
// Factory
// ============================================================================

export interface IPythonIntegrationOptions {
    apiBase: string;
    dropdownEl: HTMLElement;
    ghostEl?: HTMLElement;
    helpEl?: HTMLElement;
    signatureEl?: HTMLElement;
    docstringEl?: HTMLElement;
    escapeHtml?: (html: string) => string;
    caretOptions?: CaretCoordinatesOptions;
}

export interface IPythonIntegration {
    client: IPythonClient;
    completion: CompletionController;
    help: HelpController;
    detector: CodeBlockDetector;
}

/**
 * Factory function to create a complete IPython integration.
 */
export function createIPythonIntegration(options: IPythonIntegrationOptions): IPythonIntegration {
    const client = new IPythonClient({ apiBase: options.apiBase });

    const getCoords = (editor: HTMLTextAreaElement | HTMLInputElement) =>
        getCaretCoordinates(editor as HTMLTextAreaElement, options.caretOptions);

    const completion = new CompletionController({
        client,
        dropdownEl: options.dropdownEl,
        ghostEl: options.ghostEl,
        getCaretCoords: getCoords,
        escapeHtml: options.escapeHtml
    });

    const help = new HelpController({
        client,
        popoverEl: options.helpEl || document.createElement('div'),
        signatureEl: options.signatureEl,
        docstringEl: options.docstringEl,
        getCaretCoords: getCoords
    });

    const detector = new CodeBlockDetector({ languages: ['python'] });

    return { client, completion, help, detector };
}

/**
 * mrmd Application Controller
 *
 * Main entry point that ties together all components.
 * Platform-agnostic - uses dependency injection for providers.
 *
 * Usage (Web):
 *   const app = createApp({ apiBase: '', statusElement: document.getElementById('mode') });
 *   app.init(document.getElementById('editor'));
 *
 * Usage (VSCode):
 *   const app = createApp({ fileProvider: vscodeFileProvider, ... });
 *   app.init(editorElement);
 */

import { ExecutionEngine, LANG_COMMANDS, cleanReplOutput } from './execution-engine.js';
import { SessionManager } from './session-manager.js';
import { EditorController } from './editor-controller.js';
import { BrowserFileProvider, BrowserStateStore, BrowserUIProvider } from './interfaces.js';
import { parseMarkdown, mdToHtml, renderBlockBackgrounds } from './markdown-renderer.js';
import { highlightMarkdown } from './preview-renderer.js';
import { highlightMarkdownOverlay } from './overlay-renderer.js';
import { renderTerminalToHtml, keyEventToTerminalSequence } from './terminal-renderer.js';
import { ansiToHtml, highlightCode, escapeHtml } from './utils.js';

/**
 * Main Application class that coordinates all components.
 */
export class MrmdApp {
    /**
     * @param {Object} options
     * @param {string} options.apiBase - API base URL
     * @param {IFileProvider} options.fileProvider - File provider
     * @param {IStateStore} options.stateStore - State store
     * @param {IUIProvider} options.uiProvider - UI provider
     */
    constructor(options = {}) {
        this.apiBase = options.apiBase || '';

        // Create providers (use injected or defaults)
        this.fileProvider = options.fileProvider || new BrowserFileProvider(this.apiBase);
        this.stateStore = options.stateStore || new BrowserStateStore('mrmd_');
        this.uiProvider = options.uiProvider || new BrowserUIProvider(options.statusElement);

        // Core state
        this.elements = {};
        this.currentView = 'overlay';
        this.views = ['text', 'overlay', 'preview', 'notebook'];

        // REPL mode state
        this.replMode = false;
        this.replBlockStart = 0;
        this.replBlockEnd = 0;
        this.replClosingPos = 0;
        this.currentSessionId = 'default';
        this.terminalState = null;
        this.baselineSnapshot = '';

        // Sidecar data
        this.sidecar = { outputs: {}, sessions: {}, version: 1 };

        // Create sub-controllers
        this._createControllers();

        // Callbacks for UI updates
        this.onViewChange = options.onViewChange || (() => {});
        this.onFileChange = options.onFileChange || (() => {});
        this.onContentChange = options.onContentChange || (() => {});
        this.onSessionsChange = options.onSessionsChange || (() => {});
    }

    _createControllers() {
        // Session Manager
        this.sessionManager = new SessionManager({
            apiBase: this.apiBase,
            onSessionsChange: (sessions) => {
                this.onSessionsChange(sessions);
            },
            onEnvironmentChange: (env) => {
                // Environment changed, might need to refresh
            }
        });

        // Editor Controller
        this.editorController = new EditorController({
            fileProvider: this.fileProvider,
            stateStore: this.stateStore,
            uiProvider: this.uiProvider,
            onViewChange: (view) => {
                this.currentView = view;
                this.onViewChange(view);
                this._renderCurrentView();
            },
            onFileChange: (info) => {
                this.onFileChange(info);
                if (info.projectRoot) {
                    this.sessionManager.setCwd(info.projectRoot);
                }
            },
            onContentChange: (content) => {
                this.onContentChange(content);
            }
        });

        // Execution Engine
        this.executionEngine = new ExecutionEngine({
            apiBase: this.apiBase,
            onStatusChange: (text, active) => {
                this.uiProvider.setStatus(text, active);
            },
            onTerminalUpdate: (state) => {
                this.terminalState = state;
                this._renderTerminal();
            },
            getPythonCommand: () => this.sessionManager.getPythonCommand(),
            getSessionOptions: () => this.sessionManager.getSessionOptions()
        });
    }

    /**
     * Initialize the application with DOM elements.
     * @param {Object} elements - DOM element references
     */
    init(elements) {
        this.elements = {
            editor: elements.editor,
            preview: elements.preview,
            notebook: elements.notebook,
            overlayContainer: elements.overlayContainer,
            overlayBlocks: elements.overlayBlocks,
            overlayPreview: elements.overlayPreview,
            overlayEditor: elements.overlayEditor,
            overlayInteractive: elements.overlayInteractive,
            terminalOverlay: elements.terminalOverlay,
            terminalContent: elements.terminalContent,
            sessionLabel: elements.sessionLabel,
            modeEl: elements.modeEl,
            filenameEl: elements.filenameEl,
            sessionCount: elements.sessionCount,
            sessionList: elements.sessionList,
            ...elements
        };

        // Set up event listeners
        this._setupEventListeners();

        // Initialize view
        this.setView('overlay');

        // Start session polling
        this.sessionManager.startPolling(5000);

        // Load recent files
        this.editorController.loadRecentFiles();

        return this;
    }

    // ==================== View Management ====================

    /**
     * Set the current view.
     * @param {string} view - View name
     */
    setView(view) {
        if (!this.views.includes(view)) return;

        this.currentView = view;
        this.editorController.setView(view);

        // Update UI visibility
        const { editor, preview, notebook, overlayContainer } = this.elements;

        if (editor) editor.style.display = view === 'text' ? '' : 'none';
        if (overlayContainer) overlayContainer.style.display = view === 'overlay' ? 'flex' : 'none';
        if (preview) preview.style.display = view === 'preview' ? '' : 'none';
        if (notebook) notebook.style.display = view === 'notebook' ? '' : 'none';

        this._renderCurrentView();
        this.onViewChange(view);
    }

    /**
     * Cycle to next view.
     */
    nextView() {
        const idx = this.views.indexOf(this.currentView);
        const nextIdx = (idx + 1) % this.views.length;
        this.setView(this.views[nextIdx]);
    }

    _renderCurrentView() {
        switch (this.currentView) {
            case 'text':
                this.elements.editor?.focus();
                break;
            case 'overlay':
                this._syncToOverlay();
                this._renderOverlay();
                this.elements.overlayEditor?.focus();
                break;
            case 'preview':
                this._renderPreview();
                break;
            case 'notebook':
                this._renderNotebook();
                break;
        }
    }

    // ==================== Content Management ====================

    /**
     * Get current content.
     */
    getContent() {
        return this.elements.editor?.value || '';
    }

    /**
     * Set content.
     */
    setContent(content) {
        if (this.elements.editor) {
            this.elements.editor.value = content;
        }
        this.editorController.setContent(content);
        this._renderCurrentView();
    }

    _syncToOverlay() {
        if (this.elements.overlayEditor && this.elements.editor) {
            this.elements.overlayEditor.value = this.elements.editor.value;
        }
    }

    _syncFromOverlay() {
        if (this.elements.overlayEditor && this.elements.editor) {
            this.elements.editor.value = this.elements.overlayEditor.value;
        }
    }

    // ==================== Rendering ====================

    _renderOverlay() {
        if (!this.elements.overlayEditor || !this.elements.overlayPreview) return;

        const text = this.elements.overlayEditor.value;
        const cursorPos = this.elements.overlayEditor.selectionStart;

        const result = highlightMarkdownOverlay(text, cursorPos);
        this.elements.overlayPreview.innerHTML = typeof result === 'string' ? result : result.preview;

        if (this.elements.overlayBlocks) {
            this.elements.overlayBlocks.innerHTML = renderBlockBackgrounds(text);
        }
    }

    _renderPreview() {
        if (!this.elements.preview || !this.elements.editor) return;
        const text = this.elements.editor.value;
        this.elements.preview.innerHTML = highlightMarkdown(text, this.sidecar);
    }

    _renderNotebook() {
        if (!this.elements.notebook || !this.elements.editor) return;

        const blocks = parseMarkdown(this.elements.editor.value);
        let html = '';

        blocks.forEach((block, idx) => {
            if (block.type === 'text') {
                html += `<div class="nb-cell nb-markdown">${mdToHtml(block.content)}</div>`;
            } else if (block.type === 'repl') {
                const styledContent = this.sidecar.outputs[`repl-${idx}`]?.styled || block.content;
                html += `
                    <div class="nb-cell nb-code nb-repl" data-idx="${idx}">
                        <div class="nb-code-header">
                            <span>repl${block.session !== 'default' ? ':' + block.session : ''}</span>
                            <button class="run-btn" data-action="run" data-idx="${idx}">enter</button>
                        </div>
                        <div class="nb-code-content">${ansiToHtml(styledContent) || '<span style="color:#666">(empty)</span>'}</div>
                    </div>`;
            } else if (block.type === 'code') {
                html += `
                    <div class="nb-cell nb-code" data-idx="${idx}">
                        <div class="nb-code-header">
                            <span>${block.lang}${block.session !== block.lang ? ':' + block.session : ''}</span>
                            <button class="run-btn" data-action="run" data-idx="${idx}">run</button>
                        </div>
                        <div class="nb-code-content" contenteditable="true" data-idx="${idx}">${highlightCode(block.content, block.lang)}</div>
                    </div>`;

                const output = this.sidecar.outputs[`code-${idx}`];
                if (output) {
                    html += `<div class="nb-cell nb-output">${ansiToHtml(output.styled || output.text)}</div>`;
                }
            } else if (block.type === 'output') {
                const styledOutput = this.sidecar.outputs[`output-${idx}`]?.styled || block.content;
                html += `<div class="nb-cell nb-output">${ansiToHtml(styledOutput)}</div>`;
            }
        });

        this.elements.notebook.innerHTML = html;

        // Add click handlers for run buttons
        this.elements.notebook.querySelectorAll('[data-action="run"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                this.runBlock(idx);
            });
        });
    }

    _renderTerminal() {
        if (!this.elements.terminalContent) return;
        this.elements.terminalContent.innerHTML = renderTerminalToHtml(this.terminalState);
    }

    // ==================== Execution ====================

    /**
     * Run a code block by index.
     */
    async runBlock(idx) {
        const content = this.getContent();
        const blocks = parseMarkdown(content);
        if (idx >= blocks.length) return;

        const block = blocks[idx];

        if (block.type === 'repl') {
            // Enter REPL mode
            await this._enterReplMode(block, idx);
        } else if (block.type === 'code') {
            // Execute code block
            const result = await this.executionEngine.executeCodeBlock(block, idx, content);

            if (result) {
                this.setContent(result.newContent);
                this.sidecar.outputs[result.outputBlockId] = {
                    text: result.output,
                    styled: result.styled
                };
            }

            this._renderCurrentView();
        }
    }

    /**
     * Run block at cursor position.
     */
    async runBlockAtCursor() {
        const editor = this.currentView === 'overlay' ? this.elements.overlayEditor : this.elements.editor;
        if (!editor) return;

        const pos = editor.selectionStart;
        const content = editor.value;
        const blocks = parseMarkdown(content);

        // Find block containing cursor
        let charPos = 0;
        const lines = content.split('\n');

        for (let i = 0; i < blocks.length; i++) {
            let blockStart = 0;
            for (let j = 0; j < blocks[i].startLine; j++) {
                blockStart += lines[j].length + 1;
            }
            let blockEnd = blockStart;
            for (let j = blocks[i].startLine; j <= blocks[i].endLine; j++) {
                blockEnd += lines[j].length + 1;
            }

            if (pos >= blockStart && pos <= blockEnd) {
                if (this.currentView === 'overlay') {
                    this._syncFromOverlay();
                }
                await this.runBlock(i);
                if (this.currentView === 'overlay') {
                    this._syncToOverlay();
                    this._renderOverlay();
                }
                return;
            }
        }
    }

    // ==================== REPL Mode ====================

    async _enterReplMode(block, blockIdx) {
        // Find REPL block boundaries
        const content = this.getContent();
        const lines = content.split('\n');

        let charPos = 0;
        for (let i = 0; i < block.startLine + 1; i++) {
            charPos += lines[i].length + 1;
        }

        const replBlock = this._findReplBlock(charPos, content);
        if (!replBlock) return;

        this.replMode = true;
        this.replBlockStart = replBlock.contentStart;
        this.replBlockEnd = replBlock.contentEnd;
        this.replClosingPos = replBlock.closingPos;
        this.currentSessionId = replBlock.sessionId;

        this.uiProvider.setStatus('repl', true);
        if (this.elements.sessionLabel) {
            this.elements.sessionLabel.textContent = this.currentSessionId;
        }

        // Initialize terminal
        const sessionOpts = this.sessionManager.getSessionOptions();
        try {
            const res = await fetch(`${this.apiBase}/api/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keys: '', wait: 0.1, session: this.currentSessionId, ...sessionOpts })
            });
            this.terminalState = await res.json();
            this.baselineSnapshot = this._getFullSnapshot();
            this._renderTerminal();
        } catch (err) {
            console.error('REPL init error:', err);
        }

        if (this.elements.terminalOverlay) {
            this.elements.terminalOverlay.classList.add('active');
        }
        this.elements.terminalContent?.focus();
    }

    exitReplMode() {
        if (!this.replMode) return;

        const plainSnapshot = this._getDiffSnapshot();
        const content = this.getContent();

        // Update content with REPL output
        const newContent = content.substring(0, this.replBlockStart) +
            plainSnapshot + '\n' +
            content.substring(this.replClosingPos);

        this.setContent(newContent);

        this.replMode = false;
        if (this.elements.terminalOverlay) {
            this.elements.terminalOverlay.classList.remove('active');
        }
        this.uiProvider.setStatus('ready', false);

        this._renderCurrentView();
    }

    _findReplBlock(pos, text) {
        for (let i = pos; i >= 0; i--) {
            if (text.substring(i, i + 7) === '```repl') {
                let endOfLine = text.indexOf('\n', i);
                const fenceLine = text.substring(i, endOfLine);
                const match = fenceLine.match(/^```repl(?::(\S+))?/);
                const sessionId = match?.[1] || 'default';

                let contentStart = endOfLine + 1;
                let closingPos = contentStart;

                while (true) {
                    closingPos = text.indexOf('```', closingPos);
                    if (closingPos === -1) break;
                    const afterFence = text[closingPos + 3];
                    if (!afterFence || afterFence === '\n' || afterFence === '\r' || afterFence === ' ') {
                        break;
                    }
                    closingPos += 3;
                }

                if (closingPos === -1) closingPos = text.length;

                let contentEnd = closingPos;
                if (closingPos > 0 && text[closingPos - 1] === '\n') {
                    contentEnd = closingPos - 1;
                }

                if (pos >= contentStart && pos <= closingPos) {
                    return { contentStart, contentEnd, closingPos, blockEnd: closingPos + 3, sessionId };
                }
            }
        }
        return null;
    }

    _getFullSnapshot() {
        if (!this.terminalState?.lines) return '';
        let lastNonEmpty = 0;
        this.terminalState.lines.forEach((line, i) => {
            if (line.trim()) lastNonEmpty = i;
        });
        return this.terminalState.lines.slice(0, lastNonEmpty + 2).join('\n');
    }

    _getDiffSnapshot() {
        const current = this._getFullSnapshot();
        if (!this.baselineSnapshot) return current;

        const baseLines = this.baselineSnapshot.split('\n');
        const currLines = current.split('\n');

        let matchEnd = 0;
        for (let i = 0; i < baseLines.length && i < currLines.length; i++) {
            if (baseLines[i] === currLines[i]) matchEnd = i + 1;
            else break;
        }

        const newLines = currLines.slice(Math.max(0, matchEnd - 1));
        let start = 0;
        while (start < newLines.length - 1 && !newLines[start].trim()) start++;

        return newLines.slice(start).join('\n');
    }

    async sendKey(e) {
        if (!this.replMode) return;

        const keys = keyEventToTerminalSequence(e);
        if (!keys) return;

        try {
            const res = await fetch(`${this.apiBase}/api/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keys,
                    wait: e.key === 'Enter' ? 'auto' : 0.05,
                    session: this.currentSessionId
                })
            });
            this.terminalState = await res.json();
            this._renderTerminal();
        } catch (err) {
            console.error('Send key error:', err);
        }
    }

    // ==================== File Operations ====================

    async newFile() {
        const result = await this.editorController.newFile();
        if (result) {
            this.sidecar = { outputs: {}, sessions: {}, version: 1 };
            this._renderCurrentView();
        }
        return result;
    }

    async openFile(filePath) {
        const result = await this.editorController.openFile(filePath);
        if (result) {
            this.setContent(this.editorController.getContent());
            this.sidecar = this.editorController.getSidecar();
            this._renderCurrentView();
        }
        return result;
    }

    async saveFile() {
        // Sync from overlay if needed
        if (this.currentView === 'overlay') {
            this._syncFromOverlay();
        }

        // Update editor controller content
        this.editorController.setContent(this.getContent());

        // Copy sidecar to editor controller
        for (const [key, value] of Object.entries(this.sidecar.outputs)) {
            this.editorController.setSidecarOutput(key, value);
        }

        return await this.editorController.saveFile();
    }

    // ==================== Session Operations ====================

    async refreshSessions() {
        return await this.sessionManager.refreshSessions();
    }

    async clearAllSessions() {
        await this.sessionManager.clearAllSessions();
        this.sidecar.outputs = {};
        this.sidecar.sessions = {};
        this._renderCurrentView();
    }

    // ==================== Event Listeners ====================

    _setupEventListeners() {
        // Overlay editor sync
        if (this.elements.overlayEditor) {
            this.elements.overlayEditor.addEventListener('input', () => {
                this._syncFromOverlay();
                this._renderOverlay();
            });

            this.elements.overlayEditor.addEventListener('scroll', () => {
                if (this.elements.overlayPreview) {
                    this.elements.overlayPreview.scrollTop = this.elements.overlayEditor.scrollTop;
                    this.elements.overlayPreview.scrollLeft = this.elements.overlayEditor.scrollLeft;
                }
                if (this.elements.overlayBlocks) {
                    this.elements.overlayBlocks.scrollTop = this.elements.overlayEditor.scrollTop;
                    this.elements.overlayBlocks.scrollLeft = this.elements.overlayEditor.scrollLeft;
                }
            });

            this.elements.overlayEditor.addEventListener('click', () => this._renderOverlay());
            this.elements.overlayEditor.addEventListener('keyup', (e) => {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    this._renderOverlay();
                }
            });
        }

        // Terminal input
        if (this.elements.terminalContent) {
            this.elements.terminalContent.addEventListener('keydown', async (e) => {
                if (!this.replMode) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.exitReplMode();
                    return;
                }
                e.preventDefault();
                await this.sendKey(e);
            });
        }

        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Escape exits REPL
            if (e.key === 'Escape' && this.replMode) {
                e.preventDefault();
                this.exitReplMode();
            }

            // Ctrl+M cycles views
            if (e.ctrlKey && e.key === 'm') {
                e.preventDefault();
                this.nextView();
            }

            // Ctrl+S saves
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.saveFile();
            }

            // Ctrl+Enter runs block
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.runBlockAtCursor();
            }
        });

        // Selection change for overlay
        document.addEventListener('selectionchange', () => {
            if (document.activeElement === this.elements.overlayEditor && this.currentView === 'overlay') {
                this._renderOverlay();
            }
        });
    }

    // ==================== Cleanup ====================

    destroy() {
        this.sessionManager.stopPolling();
    }
}

/**
 * Create a new MrmdApp instance with browser defaults.
 */
export function createApp(options = {}) {
    return new MrmdApp(options);
}

/**
 * Atelier Study - Writer Mode Application
 *
 * This is the entry point for Writer Mode (atelier.study).
 * It uses @mrmd/editor directly - minimal chrome, focused writing.
 *
 * Design principles:
 * - Quiet: No distracting chrome
 * - Focused: Document is everything
 * - Progressive: Power reveals on demand
 */

import type { Services } from '../shared/types';
import { appState } from '../shared/AppState';
import { createImageUrlResolver } from '../shared/imageUrl';

// @mrmd/editor - direct import, no bridge
// @ts-ignore - Browser module
import {
    createEditor,
    IPythonExecutor,
    createMinimalIPythonClient,
    type MrmdEditor,
    type CursorInfo,
    type CompletionResult,
    type InspectionResult,
    type HoverResult,
} from '/editor-dist/index.browser.js';

// UI Module imports (minimal for study mode)
// @ts-ignore
import { IPythonClient } from '/core/ipython-client.js';
// @ts-ignore
import * as SessionState from '/core/session-state.js';
// @ts-ignore
import { AiClient } from '/core/ai-client.js';
// @ts-ignore
import { createAiPalette } from '/core/ai-palette.js';
// @ts-ignore
import { initSelectionToolbar } from '/core/selection-toolbar.js';

// ============================================================================
// Module State
// ============================================================================

let services: Services;
let editor: MrmdEditor;
let ipython: IPythonClient;
let aiClient: AiClient;

// DOM Elements
let container: HTMLElement;

// Application state
let documentBasePath = '';
let silentUpdate = false;

// Autosave
const AUTOSAVE_DELAY = 2000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Mount Function
// ============================================================================

export async function mount(svc: Services): Promise<void> {
    console.log('[Study] Mounting Writer Mode...');
    services = svc;

    // Get DOM references
    container = document.getElementById('editor-container')!;

    if (!container) {
        renderStudyUI();
        container = document.getElementById('editor-container')!;
    }

    // Hide developer chrome
    hideDevChrome();

    // Initialize clients
    initClients();

    // Initialize editor
    initEditor();

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Load initial state
    await loadInitialState();

    console.log('[Study] Writer Mode ready');
}

// ============================================================================
// UI
// ============================================================================

function renderStudyUI(): void {
    const appFrame = document.querySelector('.app-frame');
    if (appFrame) return;

    document.body.innerHTML = `
        <div class="study-container">
            <div class="study-header">
                <span class="study-file-name" id="study-file-name"></span>
                <span class="study-status" id="study-status"></span>
            </div>
            <div class="study-editor" id="editor-container"></div>
        </div>
        <style>
            .study-container {
                display: flex;
                flex-direction: column;
                height: 100vh;
                background: var(--bg, #1a1b26);
            }
            .study-header {
                display: flex;
                justify-content: space-between;
                padding: 12px 24px;
                font-size: 12px;
                color: var(--muted, #565f89);
                opacity: 0;
                transition: opacity 0.2s;
            }
            .study-container:hover .study-header {
                opacity: 1;
            }
            .study-editor {
                flex: 1;
                max-width: 800px;
                margin: 0 auto;
                width: 100%;
                padding: 40px 24px;
                overflow-y: auto;
            }
        </style>
    `;
}

function hideDevChrome(): void {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) (sidebar as HTMLElement).style.display = 'none';

    const resizer = document.getElementById('sidebar-resizer');
    if (resizer) resizer.style.display = 'none';

    const fileTabs = document.getElementById('file-tabs-container');
    if (fileTabs) fileTabs.style.display = 'none';

    const statusBar = document.querySelector('.status-bar');
    if (statusBar) {
        const hideItems = statusBar.querySelectorAll(
            '.restart-btn, .view-mode-group, .ai-run-group, .theme-picker-wrapper, .session-badge, .venv-badge'
        );
        hideItems.forEach(item => (item as HTMLElement).style.display = 'none');
    }

    document.body.classList.add('study-mode');
}

// ============================================================================
// Initialization
// ============================================================================

function initClients(): void {
    ipython = new IPythonClient({ apiBase: '' });
    aiClient = new AiClient();
}

function initEditor(): void {
    // Create IPython executor
    const ipythonClient = createMinimalIPythonClient('');
    const executor = new IPythonExecutor({ client: ipythonClient });

    // Image URL resolver
    const resolveImageUrl = createImageUrlResolver(() => documentBasePath);

    // Create editor directly from @mrmd/editor
    editor = createEditor({
        parent: container,
        doc: '',
        executor,
        theme: 'zen',
        resolveImageUrl,

        onChange: (doc: string) => {
            if (!silentUpdate) {
                const currentPath = appState.currentFilePath;
                if (currentPath) {
                    appState.updateFileContent(currentPath, doc, true);
                    scheduleAutosave();
                    updateFileIndicator();
                }
            }
        },

        onCursorChange: (_info: CursorInfo) => {
            // Minimal cursor tracking for study mode
        },

        onComplete: async (code: string, cursorPos: number, lang: string): Promise<CompletionResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.complete(code, cursorPos);
        },

        onInspect: async (code: string, cursorPos: number, lang: string): Promise<InspectionResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.inspect(code, cursorPos);
        },

        onHover: async (word: string, lang: string): Promise<HoverResult | null> => {
            if (lang !== 'python') return null;
            return await ipython.hoverInspect(word);
        },
    });

    setContent('', true);

    // Initialize selection toolbar for AI actions
    initSelectionToolbar(container, {
        getContent: () => editor.getDoc(),
        getSelectionInfo: () => getSelectionInfo(),
        replaceTextRange: (text: string, start: number, end: number) => {
            editor.view.dispatch({
                changes: { from: start, to: end, insert: text }
            });
            return true;
        },
        insertTextAtCursor: (text: string) => {
            const pos = editor.getCursor();
            editor.view.dispatch({
                changes: { from: pos, insert: text }
            });
            return true;
        },
    });

    // AI palette (subtle in study mode)
    const aiPalette = createAiPalette({
        aiClient: aiClient,
        onAction: handleAiAction,
        onError: (err: Error) => console.error('[AI] Error:', err),
        getContext: () => ({
            text: editor.getDoc(),
            cursor: getSelectionInfo().cursor,
            documentContext: editor.getDoc(),
        }),
    });

    aiPalette.attachToEditor({
        container: container,
        getCursorScreenPosition: () => {
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                return { x: rect.left, y: rect.top };
            }
            return null;
        },
    });

    editor.focus();
}

// ============================================================================
// Editor Helpers
// ============================================================================

function setContent(markdown: string, silent = false): void {
    if (silent) {
        silentUpdate = true;
        try {
            editor.setDoc(markdown);
        } finally {
            silentUpdate = false;
        }
    } else {
        editor.setDoc(markdown);
    }
}

function getContent(): string {
    return editor.getDoc();
}

function getSelectionInfo(): { cursor: number; hasSelection: boolean; selectedText: string } {
    const state = editor.view.state;
    const selection = state.selection.main;
    return {
        cursor: selection.head,
        hasSelection: !selection.empty,
        selectedText: state.sliceDoc(selection.from, selection.to),
    };
}

// ============================================================================
// File Operations
// ============================================================================

async function openFile(path: string): Promise<void> {
    console.log('[Study] Opening file:', path);

    try {
        const file = await services.documents.openFile(path);

        appState.openFile(path, file.content, {
            mtime: file.mtime ?? null,
            modified: false,
        });

        setContent(file.content, true);

        const filename = path.split('/').pop() || path;
        document.title = filename.replace(/\.md$/, '');
        updateFileIndicator();

        if (path.endsWith('.md')) {
            const session = await SessionState.getNotebookSession(path);
            ipython.setSession(session);
        }
    } catch (err) {
        console.error('[Study] Failed to open file:', err);
    }
}

async function saveFile(): Promise<void> {
    const currentPath = appState.currentFilePath;
    if (!currentPath) return;

    try {
        await services.documents.saveFile(currentPath, getContent());
        appState.markFileSaved(currentPath);
        updateFileIndicator();
    } catch (err) {
        console.error('[Study] Save failed:', err);
    }
}

function scheduleAutosave(): void {
    const currentPath = appState.currentFilePath;
    if (!currentPath || !appState.isModified) return;

    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }

    autosaveTimer = setTimeout(async () => {
        if (appState.currentFilePath && appState.isModified) {
            await saveFile();
        }
    }, AUTOSAVE_DELAY);
}

// ============================================================================
// UI Updates
// ============================================================================

function updateFileIndicator(): void {
    const fileNameEl = document.getElementById('study-file-name');
    const statusEl = document.getElementById('study-status');
    const currentPath = appState.currentFilePath;

    if (fileNameEl && currentPath) {
        const filename = currentPath.split('/').pop()?.replace(/\.md$/, '') || '';
        fileNameEl.textContent = filename;
    }

    if (statusEl) {
        statusEl.textContent = appState.isModified ? 'Editing' : '';
    }

    const indicator = document.querySelector('.current-file-indicator');
    if (indicator && currentPath) {
        indicator.classList.add('visible');
        const fileName = currentPath.split('/').pop() || currentPath;
        const nameEl = indicator.querySelector('.file-name');
        if (nameEl) nameEl.textContent = fileName + (appState.isModified ? ' *' : '');
    }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

function setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile();
        }

        if (e.key === 'Escape') {
            editor.focus();
        }
    });
}

// ============================================================================
// AI Actions
// ============================================================================

function handleAiAction(actionId: string, _result: unknown): void {
    console.log('[Study] AI action:', actionId);
}

// ============================================================================
// Initial State
// ============================================================================

async function loadInitialState(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const filePath = params.get('file');

    if (filePath) {
        await openFile(filePath);
    }
}

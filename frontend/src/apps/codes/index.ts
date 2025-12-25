/**
 * Atelier Codes - Developer Mode Application
 *
 * This is the main entry point for Developer Mode (atelier.codes).
 * It uses @mrmd/editor directly - no shims, no adapters.
 *
 * Architecture:
 * - @mrmd/editor provides the editing surface with built-in execution
 * - Services handle API calls (DocumentService, CollaborationService)
 * - AppState manages centralized application state
 * - UI modules (from /core/*.js) provide the chrome
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

// UI Module imports (legacy JS modules)
// @ts-ignore
import { IPythonClient } from '/core/ipython-client.js';
// @ts-ignore
import { detectLanguage } from '/core/utils.js';
// @ts-ignore
import * as SessionState from '/core/session-state.js';
// @ts-ignore
import { createFileTabs } from '/core/file-tabs.js';
// @ts-ignore
import { createRecentProjectsPanel } from '/core/recent-projects.js';
// @ts-ignore
import { createFileBrowser } from '/core/file-browser.js';
// @ts-ignore
import { AiClient } from '/core/ai-client.js';
// @ts-ignore
import { createAiPalette } from '/core/ai-palette.js';
// @ts-ignore
import { HistoryPanel } from '/core/history-panel.js';
// @ts-ignore
import { createTerminalTabs } from '/core/terminal-tabs.js';
// @ts-ignore
import { createNotificationManager } from '/core/notifications.js';
// @ts-ignore
import { createProcessSidebar } from '/core/process-sidebar.js';
// @ts-ignore
import { toggleMode } from '/core/compact-mode.js';
// @ts-ignore
import { initSelectionToolbar } from '/core/selection-toolbar.js';

// ============================================================================
// Types
// ============================================================================

interface FileTabs {
    addTab(path: string, filename: string, modified?: boolean): void;
    removeTab(path: string): void;
    setActiveTab(path: string): void;
    updateTabModified(path: string, modified: boolean): void;
    renameTab(oldPath: string, newPath: string, newFilename: string): void;
}

interface FileBrowserAPI {
    refresh(): void;
    setRoot?(path: string): void;
    focus(): void;
}

interface TerminalTabsAPI {
    closeTerminalsForFile(path: string): void;
}

interface NotificationManager {
    addLocalNotification(title: string, message: string, type?: string): void;
}

interface AiPaletteAPI {
    attachToEditor(config: unknown): void;
    setCurrentFile(path: string | null): void;
}

// ============================================================================
// Module State
// ============================================================================

let services: Services;
let editor: MrmdEditor;
let ipython: IPythonClient;
let aiClient: AiClient;
let fileTabs: FileTabs;
let fileBrowser: FileBrowserAPI;
let terminalTabs: TerminalTabsAPI;
let notificationManager: NotificationManager | null = null;
let aiPalette: AiPaletteAPI;
let historyPanel: HistoryPanel | null = null;

// DOM Elements
let container: HTMLElement;
let rawTextarea: HTMLTextAreaElement;
let cursorPosEl: HTMLElement;
let execStatusEl: HTMLElement;

// Application state
let browserRoot = '/home';
let documentBasePath = '';
let silentUpdate = false;

// Autosave
const AUTOSAVE_DELAY = 2000;
const AUTOSAVE_MAX_INTERVAL = 30000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveTime = Date.now();

// File watching
let fileCheckInterval: ReturnType<typeof setInterval> | null = null;
let noCollab = false;

// ============================================================================
// Mount Function - Entry Point
// ============================================================================

export async function mount(svc: Services): Promise<void> {
    console.log('[Codes] Mounting Developer Mode...');
    services = svc;

    // Check for noCollab mode
    noCollab = new URLSearchParams(window.location.search).has('noCollab');

    // Initialize DOM references
    initDOMReferences();

    // Initialize clients
    initClients();

    // Initialize editor (direct @mrmd/editor usage)
    initEditor();

    // Initialize UI modules
    await initUIModules();

    // Initialize collaboration
    await initCollaboration();

    // Set up event handlers
    setupEventHandlers();

    // Set up keyboard shortcuts
    setupKeyboardShortcuts();

    // Start file watching
    initFileWatching();

    // Load initial state
    await loadInitialState();

    console.log('[Codes] Developer Mode ready');
}

// ============================================================================
// Initialization Functions
// ============================================================================

function initDOMReferences(): void {
    container = document.getElementById('editor-container')!;
    rawTextarea = document.getElementById('raw-markdown') as HTMLTextAreaElement;
    cursorPosEl = document.getElementById('cursor-pos')!;
    execStatusEl = document.getElementById('exec-status')!;

    if (!container) {
        throw new Error('[Codes] Missing #editor-container element');
    }
}

function initClients(): void {
    // IPython client for code completion/inspection
    ipython = new IPythonClient({ apiBase: '' });

    // AI client
    aiClient = new AiClient();

    // Check AI availability
    aiClient.isAvailable().then((available: boolean) => {
        if (available) {
            console.log('[AI] Server available');
        } else {
            console.log('[AI] Server not available - AI features disabled');
        }
    });
}

function initEditor(): void {
    // Create IPython executor for code execution
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
                rawTextarea.value = doc;
                const currentPath = appState.currentFilePath;
                if (currentPath) {
                    appState.updateFileContent(currentPath, doc, true);
                    scheduleAutosave();
                    updateFileIndicator();
                }
            }
        },

        onCursorChange: (info: CursorInfo) => {
            cursorPosEl.textContent = String(info.pos);
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

    // Initialize with empty content
    setContent('', true);
    rawTextarea.value = '';

    // Initialize selection toolbar
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

    // Sync raw textarea to editor
    rawTextarea.addEventListener('input', () => {
        setContent(rawTextarea.value, true);
        const currentPath = appState.currentFilePath;
        if (currentPath) {
            appState.markFileModified(currentPath);
            scheduleAutosave();
            updateFileIndicator();
        }
    });

    // Focus editor
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

function setDocumentBasePath(path: string): void {
    documentBasePath = path;
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
// UI Module Initialization
// ============================================================================

async function initUIModules(): Promise<void> {
    // File Tabs
    const fileTabsContainer = document.getElementById('file-tabs-container');
    if (fileTabsContainer) {
        fileTabs = createFileTabs({
            onTabSelect: handleTabSelect,
            onBeforeClose: handleBeforeTabClose,
            onTabClose: handleTabClose,
        });
    }

    // Notification Manager
    const notificationBadge = document.getElementById('notification-badge');
    if (notificationBadge) {
        notificationManager = createNotificationManager({
            badgeEl: notificationBadge,
        });
    }

    // File Browser
    const fileBrowserContainer = document.getElementById('fileBrowserContainer');
    if (fileBrowserContainer) {
        fileBrowser = createFileBrowser(fileBrowserContainer, {
            initialPath: browserRoot,
            mode: 'browse',
            showFilter: true,
            showProjectButton: true,
            onSelect: (path: string) => openFile(path),
            onNavigate: (path: string) => {
                browserRoot = path;
                localStorage.setItem('mrmd_browser_root', browserRoot);
            },
        });
    }

    // Terminal Tabs
    const terminalContainer = document.getElementById('sidebar-terminal');
    if (terminalContainer) {
        terminalTabs = createTerminalTabs({
            container: terminalContainer,
        });
    }

    // AI Palette
    aiPalette = createAiPalette({
        aiClient: aiClient,
        onRunningChange: (count: number) => {
            updateRunningBadge(count);
        },
        onAction: handleAiAction,
        onError: (err: Error, actionId: string) => {
            console.error('[AI] Error:', actionId, err);
        },
        getContext: getAiContext,
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

    // History Panel
    const historyContainer = document.getElementById('history-panel');
    if (historyContainer) {
        historyPanel = new HistoryPanel(historyContainer, {
            onRestore: async (versionId: string) => {
                console.log('[History] Restoring version:', versionId);
            },
        });
    }

    // Process Sidebar
    const processContainer = document.getElementById('processes-panel');
    if (processContainer) {
        createProcessSidebar({
            container: processContainer,
        });
    }

    // Recent Projects Panel
    const projectsPanel = document.getElementById('projects-panel');
    if (projectsPanel) {
        createRecentProjectsPanel({
            container: projectsPanel,
            onProjectSelect: (path: string) => openProject(path),
        });
    }

    // Sidebar tabs
    initSidebarTabs();

    // Sidebar resizer
    initSidebarResizer();

    // Theme picker
    initThemePicker();

    // Mode toggle (compact mode)
    initModeToggle();
}

async function initCollaboration(): Promise<void> {
    if (noCollab) {
        console.log('[Collab] Disabled via ?noCollab');
        return;
    }

    const collab = services.collaboration;

    collab.onConnected((info) => {
        console.log('[Collab] Connected:', info.session_id);
        stopPollingFallback();
    });

    collab.onDisconnected(() => {
        console.log('[Collab] Disconnected');
        startPollingFallback();
    });

    collab.onFileChanged((payload) => {
        console.log('[Collab] File changed:', payload.file_path);
        handleExternalFileChange(payload.file_path);
    });

    collab.onFileSaved((payload) => {
        console.log('[Collab] File saved by:', payload.user_name);
    });

    const project = appState.project;
    if (project) {
        try {
            await collab.connect({
                projectRoot: project.path,
                userName: 'user',
                userType: 'human',
            });
        } catch (err) {
            console.warn('[Collab] Connection failed:', err);
            startPollingFallback();
        }
    }
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers(): void {
    SessionState.on('file-modified', (path: string) => {
        fileTabs?.updateTabModified(path, true);
    });

    SessionState.on('file-saved', (path: string) => {
        fileTabs?.updateTabModified(path, false);
    });

    SessionState.on('project-opened', handleProjectOpened);
    SessionState.on('project-created', handleProjectCreated);

    window.addEventListener('focus', () => {
        if (!services.collaboration.isConnected) {
            setTimeout(checkFileChanges, 100);
        }
    });

    window.addEventListener('beforeunload', () => {
        const currentPath = appState.currentFilePath;
        if (currentPath) {
            appState.updateFileScrollTop(currentPath, container.scrollTop);
        }
    });
}

function setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveFile();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            e.preventDefault();
            focusFileBrowser();
        }

        if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
            e.preventDefault();
            toggleMode();
        }
    });
}

// ============================================================================
// File Operations
// ============================================================================

async function openFile(path: string, options: { background?: boolean } = {}): Promise<void> {
    console.log('[Codes] Opening file:', path, options);

    try {
        const file = await services.documents.openFile(path);

        appState.openFile(path, file.content, {
            mtime: file.mtime ?? null,
            modified: false,
        });

        const filename = path.split('/').pop() || path;
        fileTabs?.addTab(path, filename, false);

        if (!options.background) {
            appState.setCurrentFile(path);
            fileTabs?.setActiveTab(path);

            setContent(file.content, true);
            rawTextarea.value = file.content;

            document.title = `${filename} - MRMD`;
            updateFileIndicator();

            if (path.endsWith('.md')) {
                const session = await SessionState.getNotebookSession(path);
                ipython.setSession(session);
                SessionState.setCurrentSessionName(session);
            }
        }
    } catch (err) {
        console.error('[Codes] Failed to open file:', err);
        showNotification('Error', `Failed to open file: ${err}`, 'error');
    }
}

async function saveFile(): Promise<void> {
    const currentPath = appState.currentFilePath;
    if (!currentPath) return;

    const content = getContent();
    execStatusEl.textContent = 'saving...';

    try {
        await services.documents.saveFile(currentPath, content);
        appState.markFileSaved(currentPath);
        updateFileIndicator();
        execStatusEl.textContent = 'saved';

        if (services.collaboration.isConnected) {
            services.collaboration.notifyFileSaved(currentPath);
        }

        setTimeout(() => {
            if (execStatusEl.textContent === 'saved') {
                execStatusEl.textContent = 'ready';
            }
        }, 1000);
    } catch (err) {
        console.error('[Codes] Save failed:', err);
        execStatusEl.textContent = 'save failed';
        showNotification('Error', `Save failed: ${err}`, 'error');
    }
}

function scheduleAutosave(): void {
    const currentPath = appState.currentFilePath;
    if (!currentPath || !appState.isModified) return;

    if (autosaveTimer) {
        clearTimeout(autosaveTimer);
    }

    if (Date.now() - lastSaveTime > AUTOSAVE_MAX_INTERVAL) {
        doAutosave();
        return;
    }

    autosaveTimer = setTimeout(doAutosave, AUTOSAVE_DELAY);
}

async function doAutosave(): Promise<void> {
    const currentPath = appState.currentFilePath;
    if (!currentPath || !appState.isModified) return;

    console.log('[Autosave] Saving', currentPath);
    execStatusEl.textContent = 'autosaving...';

    try {
        const content = getContent();
        await services.documents.saveFile(currentPath, content, { message: 'autosave' });
        appState.markFileSaved(currentPath);
        lastSaveTime = Date.now();
        updateFileIndicator();
        execStatusEl.textContent = 'autosaved';

        setTimeout(() => {
            if (execStatusEl.textContent === 'autosaved') {
                execStatusEl.textContent = 'ready';
            }
        }, 1000);
    } catch (err) {
        console.error('[Autosave] Failed:', err);
        execStatusEl.textContent = 'autosave failed';
    }
}

// ============================================================================
// Tab Handlers
// ============================================================================

async function handleTabSelect(path: string): Promise<void> {
    const currentPath = appState.currentFilePath;
    if (currentPath) {
        appState.updateFileScrollTop(currentPath, container.scrollTop);
    }

    const file = appState.openFiles.get(path);
    if (file) {
        setContent(file.content, true);
        rawTextarea.value = file.content;

        appState.setCurrentFile(path);
        updateFileIndicator();

        const filename = path.split('/').pop() || path;
        document.title = `${filename} - MRMD`;

        requestAnimationFrame(() => {
            container.scrollTop = file.scrollTop;
        });

        if (path.endsWith('.md')) {
            const session = await SessionState.getNotebookSession(path);
            ipython.setSession(session);
            SessionState.setCurrentSessionName(session);
        }
    }
}

async function handleBeforeTabClose(path: string): Promise<void> {
    const file = appState.openFiles.get(path);
    if (file?.modified) {
        try {
            await services.documents.saveFile(path, file.content);
        } catch (err) {
            console.error('[Tabs] Error saving before close:', err);
        }
    }
}

async function handleTabClose(path: string): Promise<void> {
    terminalTabs?.closeTerminalsForFile(path);

    const newActivePath = appState.closeFile(path);

    if (newActivePath) {
        await handleTabSelect(newActivePath);
    } else {
        setContent('', true);
        rawTextarea.value = '';
        document.title = 'MRMD';
        updateFileIndicator();
    }
}

// ============================================================================
// Project Handlers
// ============================================================================

async function openProject(path: string): Promise<void> {
    console.log('[Codes] Opening project:', path);
    SessionState.openProject(path);
}

async function handleProjectOpened(project: { path: string; name: string }): Promise<void> {
    console.log('[Codes] Project opened:', project.name);

    appState.setProject({
        path: project.path,
        name: project.name,
        type: null,
        environments: [],
    });

    browserRoot = project.path;
    localStorage.setItem('mrmd_browser_root', browserRoot);
    fileBrowser?.setRoot?.(project.path);

    ipython.setSession('main');
    ipython.setProjectPath(project.path);
    ipython.setFigureDir(project.path + '/.mrmd/assets');
    setDocumentBasePath(project.path);

    if (!noCollab && !services.collaboration.isConnected) {
        try {
            await services.collaboration.connect({
                projectRoot: project.path,
                userName: 'user',
                userType: 'human',
            });
        } catch (err) {
            console.warn('[Collab] Connection failed:', err);
        }
    }
}

function handleProjectCreated({ mainNotebook }: { mainNotebook?: string }): void {
    if (mainNotebook) {
        openFile(mainNotebook);
    }
}

// ============================================================================
// UI Updates
// ============================================================================

function updateFileIndicator(): void {
    const indicator = document.querySelector('.current-file-indicator');
    if (!indicator) return;

    const currentPath = appState.currentFilePath;
    if (currentPath) {
        indicator.classList.add('visible');
        const fileName = currentPath.split('/').pop() || currentPath;
        const modified = appState.isModified;
        const nameEl = indicator.querySelector('.file-name');
        const saveBtn = indicator.querySelector('.save-btn');

        if (nameEl) nameEl.textContent = fileName + (modified ? ' *' : '');
        if (saveBtn) saveBtn.classList.toggle('modified', modified);
    } else {
        indicator.classList.remove('visible');
    }

    aiPalette?.setCurrentFile(currentPath);
}

function updateRunningBadge(aiCount: number): void {
    const badge = document.getElementById('running-badge');
    if (!badge) return;

    const countEl = badge.querySelector('.badge-count');
    if (countEl) countEl.textContent = String(aiCount);
    badge.classList.toggle('has-running', aiCount > 0);
}

function showNotification(title: string, message: string, type = 'info'): void {
    if (notificationManager) {
        notificationManager.addLocalNotification(title, message, type);
    } else {
        console.log(`[Notification] ${type}: ${title} - ${message}`);
    }
}

// ============================================================================
// File Watching
// ============================================================================

function initFileWatching(): void {
    if (noCollab) {
        startPollingFallback();
    } else {
        setTimeout(() => {
            if (!services.collaboration.isConnected) {
                startPollingFallback();
            }
        }, 3000);
    }
}

function startPollingFallback(): void {
    if (fileCheckInterval) return;
    console.log('[FileWatch] Starting polling fallback');
    fileCheckInterval = setInterval(checkFileChanges, 2000);
}

function stopPollingFallback(): void {
    if (fileCheckInterval) {
        console.log('[FileWatch] Stopping polling fallback');
        clearInterval(fileCheckInterval);
        fileCheckInterval = null;
    }
}

async function checkFileChanges(): Promise<void> {
    const openFiles = appState.openFiles;
    if (openFiles.size === 0) return;

    const paths = Array.from(openFiles.keys());

    try {
        const result = await services.documents.getMtimes(paths);

        for (const [path, newMtime] of Object.entries(result.mtimes)) {
            if (newMtime === null) continue;

            const file = openFiles.get(path);
            if (!file?.mtime) continue;

            if (Math.abs(newMtime - file.mtime) > 0.01) {
                console.log('[FileWatch] File changed:', path);
                await handleExternalFileChange(path);
            }
        }
    } catch (err) {
        // Silent
    }
}

async function handleExternalFileChange(path: string): Promise<void> {
    try {
        const fileData = await services.documents.readFile(path);
        const newContent = fileData.content;

        const file = appState.openFiles.get(path);
        if (file) {
            if (path === appState.currentFilePath) {
                const oldContent = getContent();
                if (newContent !== oldContent) {
                    const oldCursor = editor.getCursor();
                    const scrollTop = container.scrollTop;
                    const newCursor = adjustCursorPosition(oldContent, newContent, oldCursor);

                    setContent(newContent, false);
                    rawTextarea.value = newContent;
                    editor.setCursor(newCursor);

                    requestAnimationFrame(() => {
                        container.scrollTop = scrollTop;
                    });
                }
            }

            appState.openFile(path, newContent, { mtime: fileData.mtime ?? null });
        }
    } catch (err) {
        console.error('[FileWatch] Error handling file change:', err);
    }
}

function adjustCursorPosition(oldContent: string, newContent: string, oldCursor: number): number {
    if (oldCursor >= oldContent.length) return newContent.length;
    if (oldCursor === 0) return 0;

    let commonPrefix = 0;
    const minLen = Math.min(oldContent.length, newContent.length);
    while (commonPrefix < minLen && oldContent[commonPrefix] === newContent[commonPrefix]) {
        commonPrefix++;
    }

    if (oldCursor <= commonPrefix) return oldCursor;

    let commonSuffix = 0;
    while (commonSuffix < minLen - commonPrefix &&
           oldContent[oldContent.length - 1 - commonSuffix] === newContent[newContent.length - 1 - commonSuffix]) {
        commonSuffix++;
    }

    const oldChangeEnd = oldContent.length - commonSuffix;
    if (oldCursor > oldChangeEnd) {
        return oldCursor + (newContent.length - oldContent.length);
    }

    return Math.min(newContent.length - commonSuffix, newContent.length);
}

// ============================================================================
// AI Palette
// ============================================================================

function getAiContext(): unknown {
    const selInfo = getSelectionInfo();
    const markdown = getContent();
    return {
        text: markdown,
        cursor: selInfo.cursor,
        documentContext: markdown,
    };
}

function handleAiAction(actionId: string, result: unknown, ctx: unknown): void {
    console.log('[AI] Action complete:', actionId);
}

// ============================================================================
// UI Initialization
// ============================================================================

function initSidebarTabs(): void {
    const tabs = document.querySelectorAll('.sidebar-tab');
    const panels = document.querySelectorAll('.sidebar-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = (tab as HTMLElement).dataset.panel;
            if (!panelId) return;

            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const panel = document.getElementById(`${panelId}-panel`);
            panel?.classList.add('active');

            appState.setActivePanel(panelId as any);
        });
    });
}

function initSidebarResizer(): void {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    if (!resizer || !sidebar) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = window.innerWidth - e.clientX;
        sidebar.style.width = `${Math.max(200, Math.min(600, newWidth))}px`;
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
    });
}

function initThemePicker(): void {
    const btn = document.getElementById('theme-picker-btn');
    const dropdown = document.getElementById('theme-picker-dropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', () => {
        dropdown.classList.toggle('visible');
    });

    dropdown.querySelectorAll('.theme-option').forEach(option => {
        option.addEventListener('click', () => {
            const theme = (option as HTMLElement).dataset.theme;
            if (theme) {
                appState.setTheme(theme as any);
                dropdown.classList.remove('visible');
            }
        });
    });

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
            dropdown.classList.remove('visible');
        }
    });
}

function initModeToggle(): void {
    const modeBtn = document.getElementById('mode-toggle-btn');
    const zenBtn = document.getElementById('zen-toggle');

    modeBtn?.addEventListener('click', () => {
        toggleMode();
    });

    zenBtn?.addEventListener('click', () => {
        appState.setZenMode(!appState.ui.zenMode);
        document.body.classList.toggle('zen-mode', appState.ui.zenMode);
    });
}

function focusFileBrowser(): void {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));

    const filesTab = document.querySelector('.sidebar-tab[data-panel="files"]');
    const filesPanel = document.getElementById('files-panel');

    filesTab?.classList.add('active');
    filesPanel?.classList.add('active');

    fileBrowser?.focus();
}

// ============================================================================
// Initial State
// ============================================================================

async function loadInitialState(): Promise<void> {
    browserRoot = localStorage.getItem('mrmd_browser_root') || '/home';

    const params = new URLSearchParams(window.location.search);
    const filePath = params.get('file');

    if (filePath) {
        await openFile(filePath);
    }

    SessionState.initialize();
}

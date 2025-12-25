/**
 * Atelier - Unified Application Entry Point
 *
 * Single app with two interface modes:
 * - Compact (Study): Minimal chrome, writer-focused, tool rail for power features
 * - Developer (Codes): Full IDE with sidebar, file tabs, terminal
 *
 * Architecture:
 * - @mrmd/editor provides the editing surface with built-in execution
 * - Services handle API calls (DocumentService, CollaborationService)
 * - AppState manages centralized application state
 * - UI modules (from /core/*.js) provide the chrome
 * - InterfaceManager handles compact/developer mode switching
 */

import type { Services } from '../shared/types';
import { appState } from '../shared/AppState';
import { createImageUrlResolver } from '../shared/imageUrl';

// @mrmd/editor - direct import, no bridge
// @ts-ignore - Browser module
import {
    createEditor,
    IPythonExecutor,
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
import { toggleMode, HomeScreen } from '/core/compact-mode.js';
// @ts-ignore
import { initSelectionToolbar } from '/core/selection-toolbar.js';
// @ts-ignore
import * as VariablesPanel from '/core/variables-panel.js';

// Interface mode management
import { InterfaceManager, createInterfaceManager } from './InterfaceManager';
// @ts-ignore
import { initEditorKeybindings } from '/core/editor-keybindings.js';

// AI Action Handler - bridges AI Palette → Editor Streaming Layer
import {
    createAIActionHandler,
    type AIActionHandler,
    type AIActionContext,
} from '../../services/ai-action-handler';

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
let ipythonExecutor: IPythonExecutor;  // Executor for code blocks - needs session sync
let aiClient: AiClient;
let fileTabs: FileTabs;
let fileBrowser: FileBrowserAPI;
let terminalTabs: TerminalTabsAPI;
let notificationManager: NotificationManager | null = null;
let aiPalette: AiPaletteAPI;
let historyPanel: HistoryPanel | null = null;
let interfaceManager: InterfaceManager | null = null;
let aiActionHandler: AIActionHandler | null = null;

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

// Race condition protection for file loading
let currentFileLoadId = 0;

// ============================================================================
// Types - Mount Options
// ============================================================================

export interface MountOptions {
    /** Default interface mode: 'compact' for Study, 'developer' for Codes */
    defaultMode?: 'compact' | 'developer';
}

// ============================================================================
// Mount Function - Entry Point
// ============================================================================

export async function mount(svc: Services, options: MountOptions = {}): Promise<void> {
    const defaultMode = options.defaultMode ?? 'developer';
    const modeName = defaultMode === 'compact' ? 'Study' : 'Codes';
    console.log(`[Atelier] Mounting in ${modeName} mode (${defaultMode})...`);
    services = svc;

    // Set the default interface mode before initializing UI
    SessionState.setInterfaceMode(defaultMode);

    // Check for noCollab mode
    noCollab = new URLSearchParams(window.location.search).has('noCollab');

    // Initialize DOM references
    initDOMReferences();

    // Initialize clients
    initClients();

    // Initialize editor (direct @mrmd/editor usage)
    initEditor();

    // Initialize UI modules (sidebar, tabs, file browser, etc.)
    await initUIModules();

    // Initialize interface mode manager
    // This handles compact/developer mode switching and creates the compact UI
    await initInterfaceMode();

    // Initialize collaboration
    await initCollaboration();

    // Set up event handlers
    setupEventHandlers();

    // Set up keyboard shortcuts
    setupKeyboardShortcuts();

    // Initialize variables panel
    initVariablesPanel();

    // Start file watching
    initFileWatching();

    // Load initial state
    await loadInitialState();

    console.log(`[Atelier] ${modeName} mode ready`);
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
    // Create IPython executor using the SAME client as completion/variables
    // This ensures session state is always in sync
    ipythonExecutor = new IPythonExecutor({ client: ipython });

    // Image URL resolver
    const resolveImageUrl = createImageUrlResolver(() => documentBasePath);

    // Create editor directly from @mrmd/editor
    editor = createEditor({
        parent: container,
        doc: '',
        executor: ipythonExecutor,
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

    // Initialize AI Action Handler - bridges AI palette to editor streaming layer
    // AI-human interaction is inherently collaborative - locks ensure clean edits
    aiActionHandler = createAIActionHandler({
        getView: () => editor?.view ?? null,
        getLockManager: () => editor?.lockManager ?? null,
        getUser: () => ({
            userId: 'local-user',
            userName: 'You',
            userColor: '#3b82f6',
        }),
        onSuccess: (actionId, content) => {
            console.log(`[AI] Successfully applied '${actionId}': ${content.length} chars`);
        },
        onError: (actionId, error) => {
            console.error(`[AI] Failed to apply '${actionId}':`, error);
            notificationManager?.addLocalNotification(
                'AI Action Failed',
                error.message,
                'error'
            );
        },
    });
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
            onOpenProject: (path: string) => {
                SessionState.openProject(path);
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
        onActionStart: handleAiActionStart,
        onChunk: handleAiChunk,
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
    const projectsPanelContainer = document.getElementById('projects-panel');
    if (projectsPanelContainer) {
        const projectsPanelEl = createRecentProjectsPanel({
            onProjectOpen: (path: string) => openProject(path),
        });
        projectsPanelContainer.appendChild(projectsPanelEl);
    }

    // Sidebar tabs
    initSidebarTabs();

    // Sidebar resizer
    initSidebarResizer();

    // Theme picker
    initThemePicker();

    // Mode toggle (compact mode) - button handler only
    // Actual mode management is handled by InterfaceManager
    initModeToggle();
}

// ============================================================================
// Interface Mode Management
// ============================================================================

/**
 * Initialize the interface mode manager.
 *
 * The Codes app supports two interface modes:
 * - Compact: Document-first with floating toolbar (like Study mode)
 * - Developer: Full IDE with sidebar, tabs, terminal
 *
 * The InterfaceManager owns this lifecycle and coordinates all mode-related UI.
 */
async function initInterfaceMode(): Promise<void> {
    const mainContainer = document.querySelector('.container') as HTMLElement;
    const editorPane = document.querySelector('.editor-pane') as HTMLElement;

    if (!mainContainer || !editorPane) {
        console.error('[Codes] Cannot initialize interface mode: missing container elements');
        return;
    }

    interfaceManager = await createInterfaceManager({
        container: mainContainer,
        editorPane: editorPane,
        editor: editor,
        getEditor: () => editor,
        fileBrowser: fileBrowser,
    });

    // Log initial mode for debugging
    console.log(`[Codes] Interface mode: ${interfaceManager.getMode()}`);
}

// ============================================================================
// Collaboration
// ============================================================================

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

    // Kernel status indicators
    SessionState.on('kernel-initializing', ({ message }: { message?: string }) => {
        execStatusEl.textContent = message || 'initializing...';
        execStatusEl.classList.add('kernel-switching');
    });

    SessionState.on('kernel-ready', () => {
        execStatusEl.textContent = 'ready';
        execStatusEl.classList.remove('kernel-switching');
    });

    SessionState.on('kernel-error', ({ error }: { error: string }) => {
        execStatusEl.textContent = 'kernel error';
        execStatusEl.classList.remove('kernel-switching');
        showNotification('Kernel Error', error, 'error');
    });

    // Home screen event handlers (with error recovery)
    // Track pending file switch to prevent duplicate handling
    let pendingFileSwitch: string | null = null;

    SessionState.on('file-switch-requested', async ({ path }: { path: string }) => {
        console.log('[Codes] File switch requested:', path);

        // Prevent duplicate requests for same file
        if (pendingFileSwitch === path) {
            console.log('[Codes] Ignoring duplicate file switch request:', path);
            return;
        }
        pendingFileSwitch = path;

        HomeScreen.hide();
        try {
            await openFile(path);
            editor?.focus();
        } catch (err) {
            console.error('[Codes] Failed to open file:', err);
            showNotification('Error', `Failed to open file: ${err}`, 'error');
            HomeScreen.show(); // Re-show home on failure
        } finally {
            // Clear pending after a short delay to allow rapid different-file clicks
            setTimeout(() => {
                if (pendingFileSwitch === path) {
                    pendingFileSwitch = null;
                }
            }, 100);
        }
    });

    SessionState.on('new-notebook-requested', async ({ projectPath, initialContent }: { projectPath?: string; initialContent?: string }) => {
        console.log('[Codes] New notebook requested:', projectPath);
        HomeScreen.hide();
        try {
            await createNewNotebook(projectPath, initialContent);
        } catch (err) {
            console.error('[Codes] Failed to create notebook:', err);
            showNotification('Error', `Failed to create notebook: ${err}`, 'error');
            HomeScreen.show();
        }
    });

    SessionState.on('project-open-requested', async ({ path }: { path: string }) => {
        console.log('[Codes] Project open requested:', path);
        HomeScreen.hide();
        try {
            await openProject(path);
        } catch (err) {
            console.error('[Codes] Failed to open project:', err);
            showNotification('Error', `Failed to open project: ${err}`, 'error');
            HomeScreen.show();
        }
    });

    SessionState.on('quick-capture-requested', async () => {
        console.log('[Codes] Quick capture requested');
        HomeScreen.hide();
        try {
            await createNewNotebook();
        } catch (err) {
            console.error('[Codes] Failed to create notebook:', err);
            showNotification('Error', `Failed to create notebook: ${err}`, 'error');
            HomeScreen.show();
        }
    });

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
    // Initialize editor keybindings (code execution: Ctrl+Enter, Shift+Enter, etc.)
    // Use a getter function so keybindings always have the current editor reference
    initEditorKeybindings({ getEditor: () => editor, statusEl: execStatusEl });
}

function initVariablesPanel(): void {
    const variablesPanelContainer = document.getElementById('variables-panel');
    if (!variablesPanelContainer) {
        console.warn('[Codes] Variables panel container not found');
        return;
    }

    // Clear existing content and mount the new panel
    variablesPanelContainer.innerHTML = '';
    const panelEl = VariablesPanel.createVariablesPanel({
        ipython,
    });
    variablesPanelContainer.appendChild(panelEl);

    // Also refresh when kernel becomes ready
    SessionState.on('kernel-ready', () => {
        console.log('[Codes] Kernel ready - refreshing variables panel');
        VariablesPanel.refresh();
    });

    // Backup: Also listen for execution complete directly
    // This ensures variables refresh even if the panel's listener isn't working
    document.addEventListener('mrmd:execution-complete', (event: Event) => {
        console.log('[Codes] Execution complete event - refreshing variables panel');
        VariablesPanel.refresh();
    });
}

// ============================================================================
// File Operations
// ============================================================================

async function openFile(path: string, options: { background?: boolean } = {}): Promise<void> {
    // Increment load ID to track this specific load request
    const loadId = ++currentFileLoadId;
    console.log('[Codes] Opening file:', path, options, `(loadId: ${loadId})`);

    try {
        const file = await services.documents.openFile(path);

        // Check if a newer load was started while we were fetching
        if (loadId !== currentFileLoadId && !options.background) {
            console.log('[Codes] Skipping stale file load:', path, `(loadId: ${loadId}, current: ${currentFileLoadId})`);
            return;
        }

        appState.openFile(path, file.content, {
            mtime: file.mtime ?? null,
            modified: false,
        });

        const filename = path.split('/').pop() || path;
        fileTabs?.addTab(path, filename, false);

        if (!options.background) {
            // Double-check we're still the current load before updating editor
            if (loadId !== currentFileLoadId) {
                console.log('[Codes] Skipping stale editor update:', path);
                return;
            }

            appState.setCurrentFile(path);
            fileTabs?.setActiveTab(path);

            setContent(file.content, true);
            rawTextarea.value = file.content;

            document.title = `${filename} - MRMD`;
            updateFileIndicator();

            if (path.endsWith('.md')) {
                const session = await SessionState.getNotebookSession(path);
                // Final check before updating session
                if (loadId === currentFileLoadId) {
                    ipython.setSession(session);
                    SessionState.setCurrentSessionName(session);
                }
            }
        }
    } catch (err) {
        // Only show error if this is still the current load
        if (loadId === currentFileLoadId) {
            console.error('[Codes] Failed to open file:', err);
            showNotification('Error', `Failed to open file: ${err}`, 'error');
        }
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

async function createNewNotebook(projectPath?: string, initialContent?: string): Promise<void> {
    const currentProject = appState.project;
    const scratchPath = SessionState.getScratchPath();
    const basePath = projectPath || currentProject?.path || scratchPath || browserRoot;

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `Untitled-${timestamp}.md`;
    const filePath = `${basePath}/${filename}`;

    // Create initial content
    const content = initialContent || '# Untitled\n\n';

    console.log('[Codes] Creating new notebook:', filePath);

    try {
        // Create the file
        await services.documents.saveFile(filePath, content);

        // Open it
        await openFile(filePath);

        // Add to recent notebooks
        SessionState.addRecentNotebook(filePath, 'Untitled');

        // Focus editor at end of content
        editor?.focus();
    } catch (err) {
        console.error('[Codes] Failed to create notebook:', err);
        showNotification('Error', `Failed to create notebook: ${err}`, 'error');
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

interface ProjectOpenedEvent {
    path: string;
    name: string;
    savedTabs?: {
        tabs: string[];
        active: string | null;
        scrollPositions?: Record<string, { scrollTop: number }>;
    } | null;
    openFileAfter?: string | null;
    skipFileOpen?: boolean;
}

async function handleProjectOpened(project: ProjectOpenedEvent): Promise<void> {
    console.log('[Codes] Project opened:', project.name);

    appState.setProject({
        path: project.path,
        name: project.name,
        type: null,
        environments: [],
    });

    browserRoot = project.path;
    localStorage.setItem('mrmd_browser_root', browserRoot);
    fileBrowser?.setRoot(project.path);

    // Configure IPython client for this project
    // Since executor uses the same client, everything stays in sync
    ipython.setSession('main');
    ipython.setProjectPath(project.path);
    ipython.setFigureDir(project.path + '/.mrmd/assets');

    setDocumentBasePath(project.path);

    // Connect collaboration
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

    // Skip file opening if requested (file was already opened before project switch)
    if (project.skipFileOpen) {
        console.log('[Codes] Skipping file open (already opened)');
        return;
    }

    // Determine which file to open (priority: openFileAfter > savedTabs.active)
    const savedTabs = project.savedTabs;
    const fileToOpen = project.openFileAfter || savedTabs?.active;

    // FIRST: Open the requested file immediately for fast UX
    if (fileToOpen) {
        console.log('[Codes] Opening file after project switch:', fileToOpen);
        try {
            await openFile(fileToOpen);
        } catch (err) {
            console.warn('[Codes] Failed to open file:', fileToOpen, err);
        }
    }

    // THEN: Restore other saved tabs in background (skip the one we already opened)
    if (savedTabs?.tabs && savedTabs.tabs.length > 0) {
        const otherTabs = savedTabs.tabs.filter(t => t !== fileToOpen);
        if (otherTabs.length > 0) {
            console.log('[Codes] Restoring other tabs in background:', otherTabs);

            // Mark that we're restoring to prevent auto-save during restore
            SessionState.setRestoringTabs(true);

            try {
                for (const tabPath of otherTabs) {
                    try {
                        await openFile(tabPath, { background: true });
                    } catch (err) {
                        // File may no longer exist - skip it
                        console.warn('[Codes] Failed to restore tab:', tabPath, err);
                    }
                }
            } finally {
                SessionState.setRestoringTabs(false);
            }
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

    // Extract local context: ~500 chars around cursor for better AI understanding
    const contextRadius = 500;
    const start = Math.max(0, selInfo.cursor - contextRadius);
    const end = Math.min(markdown.length, selInfo.cursor + contextRadius);
    const localContext = markdown.slice(start, end);

    return {
        text: markdown,
        cursor: selInfo.cursor,
        documentContext: markdown,
        localContext: localContext,
        // Also provide selection info
        selection: selInfo.selectedText,
        hasSelection: selInfo.hasSelection,
        selectionStart: selInfo.hasSelection ? editor.view.state.selection.main.from : undefined,
        selectionEnd: selInfo.hasSelection ? editor.view.state.selection.main.to : undefined,
    };
}

function handleAiActionStart(actionId: string, ctx: unknown): void {
    console.log('[AI] Action start:', actionId);

    if (!aiActionHandler) {
        console.error('[AI] Action handler not initialized');
        return;
    }

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Start the streaming overlay immediately
    aiActionHandler.handleActionStart(actionId, context).catch((err) => {
        console.error('[AI] Failed to start action:', err);
    });
}

function handleAiChunk(actionId: string, chunk: string, ctx: unknown): void {
    if (!aiActionHandler) return;

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Stream the chunk to the overlay
    aiActionHandler.handleChunk(actionId, chunk, context).catch((err) => {
        console.error('[AI] Failed to stream chunk:', err);
    });
}

function handleAiAction(actionId: string, result: unknown, ctx: unknown): void {
    console.log('[AI] Action complete:', actionId, result);

    if (!aiActionHandler) {
        console.error('[AI] Action handler not initialized');
        return;
    }

    // Cast context to the expected type
    const context = ctx as AIActionContext;

    // Handle the action - this uses the streaming overlay and commits as single undo step
    aiActionHandler.handleAction(actionId, result, context).then((success) => {
        if (success) {
            // Trigger autosave after successful AI edit
            const currentPath = appState.currentFilePath;
            if (currentPath) {
                appState.markFileModified(currentPath);
                scheduleAutosave();
                updateFileIndicator();
            }
        }
    }).catch((err) => {
        console.error('[AI] Unexpected error in action handler:', err);
    });
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

    // Initialize SessionState first to load recent projects/notebooks
    await SessionState.initialize();

    if (filePath) {
        await openFile(filePath);
    } else {
        // No file specified - show home screen
        HomeScreen.show();
    }
}

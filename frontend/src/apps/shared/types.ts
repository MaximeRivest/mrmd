/**
 * Shared types for Atelier applications (Study & Codes)
 */

import type { IDocumentService, IExecutionService, ICollaborationService } from '../../services/interfaces';

// ============================================================================
// Service Container
// ============================================================================

export interface Services {
    documents: IDocumentService;
    execution: IExecutionService;
    collaboration: ICollaborationService;
}

// ============================================================================
// Application State
// ============================================================================

export interface FileState {
    path: string;
    content: string;
    modified: boolean;
    mtime: number | null;
    scrollTop: number;
    undoStack: unknown[];
    redoStack: unknown[];
}

export interface SessionState {
    id: string;
    pythonPath: string | null;
    pythonVersion: string | null;
    cwd: string | null;
    isRunning: boolean;
}

export interface ProjectState {
    path: string;
    name: string;
    type: string | null;
    environments: EnvironmentInfo[];
}

export interface EnvironmentInfo {
    name: string;
    path: string;
    type: string;
    version?: string;
}

export interface UIState {
    sidebarVisible: boolean;
    activePanel: 'projects' | 'files' | 'variables' | 'processes' | 'history' | 'terminal' | 'markdown';
    theme: 'default' | 'github' | 'docs';
}

export interface AppStateSnapshot {
    currentFilePath: string | null;
    currentFileModified: boolean;
    openFiles: Map<string, FileState>;
    session: SessionState;
    project: ProjectState | null;
    ui: UIState;
}

// ============================================================================
// Editor Types
// ============================================================================

export interface CodeBlockContext {
    index: number;
    code: string;
    lang: string;
    start: number;
    end: number;
    codeStart: number;
    codeEnd: number;
    charOffset: number;
}

export interface SelectionInfo {
    cursor: number;
    line: number;
    col: number;
    hasSelection: boolean;
    selectionStart: number;
    selectionEnd: number;
    selectedText: string;
    currentLine: string;
    lineStart: number;
    lineEnd: number;
    inCodeBlock: boolean;
    codeBlock: CodeBlockContext | null;
    codeOffset: number | null;
}

// ============================================================================
// UI Module Types
// ============================================================================

export interface FileTabsAPI {
    addTab(path: string, filename: string, modified?: boolean): void;
    removeTab(path: string): void;
    setActiveTab(path: string): void;
    updateTabModified(path: string, modified: boolean): void;
    renameTab(oldPath: string, newPath: string, newFilename: string): void;
}

export interface TerminalTabsAPI {
    createTerminal(id: string, options?: { cwd?: string; title?: string }): void;
    closeTerminal(id: string): void;
    closeTerminalsForFile(filePath: string): void;
    setActiveTerminal(id: string): void;
    getActiveTerminal(): string | null;
}

export interface NotificationManagerAPI {
    addLocalNotification(title: string, message: string, type?: 'info' | 'success' | 'error' | 'ai'): void;
    addRemoteNotification(id: string, title: string, message: string): void;
    markRead(id: string): void;
    clear(): void;
}

export interface FileBrowserAPI {
    refresh(): void;
    setRoot(path: string): void;
    focus(): void;
}

export interface AiPaletteAPI {
    attachToEditor(config: { container: HTMLElement; getCursorScreenPosition: () => { x: number; y: number } | null }): void;
    setCurrentFile(path: string | null): void;
    show(x: number, y: number): void;
    hide(): void;
}

export interface HistoryPanelAPI {
    setFilePath(path: string, projectRoot: string): void;
    refresh(): void;
}

// ============================================================================
// Event Types
// ============================================================================

export type AppEventType =
    | 'file:opened'
    | 'file:closed'
    | 'file:saved'
    | 'file:modified'
    | 'file:renamed'
    | 'session:changed'
    | 'session:started'
    | 'session:stopped'
    | 'execution:started'
    | 'execution:completed'
    | 'collab:connected'
    | 'collab:disconnected'
    | 'collab:user-joined'
    | 'collab:user-left';

export interface AppEvent {
    type: AppEventType;
    payload: unknown;
}

export type AppEventHandler = (event: AppEvent) => void;

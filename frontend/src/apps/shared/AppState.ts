/**
 * Application State Manager
 *
 * Centralized state management for Atelier applications.
 * Replaces the scattered state variables in the legacy app.ts.
 */

import type {
    FileState,
    SessionState,
    ProjectState,
    UIState,
    AppStateSnapshot,
    EnvironmentInfo,
} from './types';

type Unsubscribe = () => void;
type StateListener = (state: AppStateSnapshot) => void;
type FileListener = (file: FileState | null, path: string | null) => void;
type SessionListener = (session: SessionState) => void;

export class AppState {
    // Current file
    private _currentFilePath: string | null = null;

    // Open files (for tabs)
    private _openFiles: Map<string, FileState> = new Map();

    // Session state
    private _session: SessionState = {
        id: 'main',
        pythonPath: null,
        pythonVersion: null,
        cwd: null,
        isRunning: false,
    };

    // Project state
    private _project: ProjectState | null = null;

    // UI state
    private _ui: UIState = {
        sidebarVisible: true,
        activePanel: 'variables',
        theme: 'default',
        zenMode: false,
    };

    // Listeners
    private _listeners: Set<StateListener> = new Set();
    private _fileListeners: Set<FileListener> = new Set();
    private _sessionListeners: Set<SessionListener> = new Set();

    // ========================================================================
    // Getters
    // ========================================================================

    get currentFilePath(): string | null {
        return this._currentFilePath;
    }

    get currentFile(): FileState | null {
        return this._currentFilePath ? this._openFiles.get(this._currentFilePath) ?? null : null;
    }

    get isModified(): boolean {
        return this.currentFile?.modified ?? false;
    }

    get openFiles(): Map<string, FileState> {
        return new Map(this._openFiles);
    }

    get openFilePaths(): string[] {
        return Array.from(this._openFiles.keys());
    }

    get session(): SessionState {
        return { ...this._session };
    }

    get project(): ProjectState | null {
        return this._project ? { ...this._project } : null;
    }

    get ui(): UIState {
        return { ...this._ui };
    }

    getSnapshot(): AppStateSnapshot {
        return {
            currentFilePath: this._currentFilePath,
            currentFileModified: this.isModified,
            openFiles: new Map(this._openFiles),
            session: { ...this._session },
            project: this._project ? { ...this._project } : null,
            ui: { ...this._ui },
        };
    }

    // ========================================================================
    // File Operations
    // ========================================================================

    openFile(path: string, content: string, options?: Partial<FileState>): FileState {
        const file: FileState = {
            path,
            content,
            modified: false,
            mtime: null,
            scrollTop: 0,
            undoStack: [],
            redoStack: [],
            ...options,
        };

        this._openFiles.set(path, file);
        this._currentFilePath = path;
        this._notifyFileChange(file, path);
        return file;
    }

    closeFile(path: string): string | null {
        if (!this._openFiles.has(path)) return null;

        this._openFiles.delete(path);

        // If this was the current file, switch to another
        if (this._currentFilePath === path) {
            const remaining = Array.from(this._openFiles.keys());
            this._currentFilePath = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            this._notifyFileChange(this.currentFile, this._currentFilePath);
        }

        return this._currentFilePath;
    }

    setCurrentFile(path: string): FileState | null {
        if (!this._openFiles.has(path)) return null;

        this._currentFilePath = path;
        const file = this._openFiles.get(path)!;
        this._notifyFileChange(file, path);
        return file;
    }

    updateFileContent(path: string, content: string, modified = true): void {
        const file = this._openFiles.get(path);
        if (file) {
            file.content = content;
            file.modified = modified;
            this._notifyFileChange(file, path);
        }
    }

    markFileSaved(path: string, mtime?: number): void {
        const file = this._openFiles.get(path);
        if (file) {
            file.modified = false;
            if (mtime !== undefined) {
                file.mtime = mtime;
            }
            this._notifyFileChange(file, path);
        }
    }

    markFileModified(path: string): void {
        const file = this._openFiles.get(path);
        if (file && !file.modified) {
            file.modified = true;
            this._notifyFileChange(file, path);
        }
    }

    updateFileScrollTop(path: string, scrollTop: number): void {
        const file = this._openFiles.get(path);
        if (file) {
            file.scrollTop = scrollTop;
        }
    }

    updateFileUndoStacks(path: string, undoStack: unknown[], redoStack: unknown[]): void {
        const file = this._openFiles.get(path);
        if (file) {
            file.undoStack = undoStack;
            file.redoStack = redoStack;
        }
    }

    getFileUndoStacks(path: string): { undoStack: unknown[]; redoStack: unknown[] } {
        const file = this._openFiles.get(path);
        return {
            undoStack: file?.undoStack ?? [],
            redoStack: file?.redoStack ?? [],
        };
    }

    renameFile(oldPath: string, newPath: string): void {
        const file = this._openFiles.get(oldPath);
        if (file) {
            file.path = newPath;
            this._openFiles.delete(oldPath);
            this._openFiles.set(newPath, file);

            if (this._currentFilePath === oldPath) {
                this._currentFilePath = newPath;
            }

            this._notifyFileChange(file, newPath);
        }
    }

    // ========================================================================
    // Session Operations
    // ========================================================================

    setSession(session: Partial<SessionState>): void {
        this._session = { ...this._session, ...session };
        this._notifySessionChange();
    }

    setSessionId(id: string): void {
        this._session.id = id;
        this._notifySessionChange();
    }

    setSessionRunning(isRunning: boolean): void {
        this._session.isRunning = isRunning;
        this._notifySessionChange();
    }

    // ========================================================================
    // Project Operations
    // ========================================================================

    setProject(project: ProjectState | null): void {
        this._project = project;
        this._notify();
    }

    updateProjectEnvironments(environments: EnvironmentInfo[]): void {
        if (this._project) {
            this._project.environments = environments;
            this._notify();
        }
    }

    // ========================================================================
    // UI Operations
    // ========================================================================

    setUIState(ui: Partial<UIState>): void {
        this._ui = { ...this._ui, ...ui };
        this._notify();
    }

    setSidebarVisible(visible: boolean): void {
        this._ui.sidebarVisible = visible;
        this._notify();
    }

    setActivePanel(panel: UIState['activePanel']): void {
        this._ui.activePanel = panel;
        this._notify();
    }

    setTheme(theme: UIState['theme']): void {
        this._ui.theme = theme;
        this._notify();
    }

    setZenMode(zenMode: boolean): void {
        this._ui.zenMode = zenMode;
        this._notify();
    }

    // ========================================================================
    // Subscriptions
    // ========================================================================

    subscribe(listener: StateListener): Unsubscribe {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    onFileChange(listener: FileListener): Unsubscribe {
        this._fileListeners.add(listener);
        return () => this._fileListeners.delete(listener);
    }

    onSessionChange(listener: SessionListener): Unsubscribe {
        this._sessionListeners.add(listener);
        return () => this._sessionListeners.delete(listener);
    }

    // ========================================================================
    // Private
    // ========================================================================

    private _notify(): void {
        const snapshot = this.getSnapshot();
        this._listeners.forEach(listener => listener(snapshot));
    }

    private _notifyFileChange(file: FileState | null, path: string | null): void {
        this._fileListeners.forEach(listener => listener(file, path));
        this._notify();
    }

    private _notifySessionChange(): void {
        this._sessionListeners.forEach(listener => listener(this._session));
        this._notify();
    }
}

// Singleton instance for the application
export const appState = new AppState();

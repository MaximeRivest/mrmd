export type Unsubscribe = () => void;

export interface EnvironmentInfo {
    name: string;
    path: string;
    type: string;
    version?: string;
}

export interface FileWriteOptions {
    author?: string;
    message?: string;
    track_version?: boolean;
}

export interface FileReadResponse {
    content: string;
    path: string;
    project_root: string | null;
    environments: EnvironmentInfo[];
    mtime: number;
    version_id: string | number | null;
}

export interface FileWriteResponse {
    status: string;
    path: string;
    bytes_written: number;
    mtime: number;
    version_id: string | number | null;
    project_root: string | null;
}

export interface FileExistsResponse {
    exists: boolean;
    is_file: boolean;
    is_dir: boolean;
    path: string;
}

export interface FileEntry {
    name: string;
    path: string;
    is_dir: boolean;
    is_file: boolean;
    size?: number | null;
    ext?: string | null;
    collapsed?: boolean;
}

export interface FileListResponse {
    path: string;
    entries: FileEntry[];
    parent: string | null;
}

export interface FileDeleteResponse {
    status: string;
    path: string;
    deleted: boolean;
    was_directory: boolean;
}

export interface FileRenameResponse {
    status: string;
    old_path: string;
    new_path: string;
}

export interface FileMkdirResponse {
    status: string;
    path: string;
}

export interface FileCopyResponse {
    status: string;
    src_path: string;
    dest_path: string;
}

export interface FileUploadItem {
    name: string;
    path: string;
    size: number;
}

export interface FileUploadResponse {
    status: string;
    files: FileUploadItem[];
}

export interface FileMtimesResponse {
    mtimes: Record<string, number | null>;
}

export interface FileSearchProjectInfo {
    is_project: boolean;
    type: string | null;
    markers: string[];
}

export interface FileSearchResult {
    path: string;
    relpath: string;
    filename: string;
    is_dir: boolean;
    score: number;
    indices: number[];
    project?: FileSearchProjectInfo;
}

export interface FileSearchResponse {
    results: FileSearchResult[];
    root: string;
    query: string;
    mode: 'files' | 'folders' | 'all';
}

export interface FileSearchOptions {
    query?: string;
    root?: string;
    mode?: 'files' | 'folders' | 'all';
    extensions?: string[];
    maxResults?: number;
    includeHidden?: boolean;
}

export interface FileGrepOptions {
    query: string;
    root?: string;
    maxResults?: number;
    extensions?: string[];
    caseSensitive?: boolean;
}

export interface ProjectDetectResponse {
    project_root: string | null;
    project_type: string;
    environments: EnvironmentInfo[];
    file_path: string;
}

export interface IFile {
    path: string;
    content: string;
    modified: boolean;
    lastSaved: number; // timestamp
    projectRoot?: string | null;
    environments?: EnvironmentInfo[];
    mtime?: number;
    versionId?: string | number | null;
}

export interface IDocumentService {
    currentFile: IFile | null;

    // File operations
    openFile(path: string): Promise<IFile>;
    readFile(path: string): Promise<FileReadResponse>;
    saveFile(path: string, content: string, options?: FileWriteOptions): Promise<void>;
    writeFile(path: string, content: string, options?: FileWriteOptions): Promise<FileWriteResponse>;
    createFile(path: string, content?: string): Promise<IFile>;
    closeFile(path: string): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    deleteFile(path: string, options?: { recursive?: boolean }): Promise<void>;
    listDirectory(path: string, options?: { showHidden?: boolean }): Promise<FileListResponse>;
    fileExists(path: string): Promise<FileExistsResponse>;
    createDirectory(path: string): Promise<FileMkdirResponse>;
    copyPath(srcPath: string, destPath: string): Promise<FileCopyResponse>;
    uploadFiles(destDir: string, files: File[]): Promise<FileUploadResponse>;
    getMtimes(paths: string[]): Promise<FileMtimesResponse>;
    searchFiles(options: FileSearchOptions): Promise<FileSearchResponse>;
    grepStream(options: FileGrepOptions): Promise<Response>;
    detectProject(path: string): Promise<ProjectDetectResponse>;
    listEnvironments(projectRoot?: string): Promise<{ environments: EnvironmentInfo[]; project_root: string }>;

    // Content operations
    markModified(path: string, modified: boolean): void;
    updateContent(path: string, content: string): void;

    // History/State
    getRecentFiles(): Promise<string[]>;

    // Events
    onFileChanged(callback: (file: IFile) => void): Unsubscribe;
    onFileOpened(callback: (file: IFile) => void): Unsubscribe;
    onFileClosed(callback: (path: string) => void): Unsubscribe;
}

export interface ExecutionDisplayData {
    asset?: string;
    data?: Record<string, string>;
    metadata?: Record<string, unknown>;
}

export interface ExecutionErrorInfo {
    ename?: string;
    evalue?: string;
    traceback?: string[];
    type?: string;
    message?: string;
    raw?: string;
}

export interface IExecutionResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    result?: string;
    error?: ExecutionErrorInfo | null;
    execution_count?: number;
    display_data?: ExecutionDisplayData[];
    saved_assets?: string[];
    formatted_output?: string;
    python_path?: string;
}

export interface CompletionResult {
    session_id?: string;
    matches: string[];
    cursor_start: number;
    cursor_end: number;
    metadata: Record<string, unknown>;
}

export interface InspectionResult {
    session_id?: string;
    found: boolean;
    name?: string;
    signature?: string;
    docstring?: string;
    type_name?: string;
}

export interface IsCompleteResult {
    session_id?: string;
    status: string;
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

export type InspectObjectResult = Record<string, unknown>;
export type HoverResult = Record<string, unknown>;

export interface SessionInfo {
    session_id: string;
    exists: boolean;
    alive?: boolean;
    python_path?: string;
    python_executable?: string;
    python_version?: string;
    cwd?: string;
    pid?: number;
}

export interface SessionSummary {
    id: string;
    alive: boolean;
    pid?: number;
    memory_bytes?: number;
}

export interface SessionListResponse {
    sessions: SessionSummary[];
}

export interface ReconfigureResult {
    success: boolean;
    session_id?: string;
    python_path?: string;
    python_executable?: string;
    python_version?: string;
    cwd?: string;
    pid?: number;
    error?: string;
}

export interface FormatCodeResult {
    formatted?: string;
    error?: string;
}

export interface IExecutionService {
    isRunning: boolean;

    // Execution
    runCode(code: string, lang: string): Promise<IExecutionResult>;
    runBlock(blockId: string | undefined, code: string, lang: string): Promise<IExecutionResult>;
    cancelExecution(): Promise<void>;

    // Kernel management
    restartKernel(): Promise<void>;
    interruptKernel(): Promise<void>;
    resetKernel(): Promise<void>;

    // Session configuration
    setProjectPath(path: string): void;
    setSessionId(sessionId: string): void;

    // Introspection and tooling
    getVariables(): Promise<VariablesResponse | null>;
    complete(code: string, cursorPos: number): Promise<CompletionResult | null>;
    inspect(code: string, cursorPos: number, detailLevel?: number): Promise<InspectionResult | null>;
    inspectObject(path: string): Promise<InspectObjectResult | null>;
    hover(name: string): Promise<HoverResult | null>;
    isComplete(code: string): Promise<IsCompleteResult | null>;
    getSessionInfo(): Promise<SessionInfo | null>;
    listSessions(): Promise<SessionListResponse | null>;
    reconfigureSession(options: { pythonPath?: string; cwd?: string }): Promise<ReconfigureResult | null>;
    formatCode(code: string, language?: string): Promise<FormatCodeResult | null>;

    // Events
    onExecutionStart(callback: (blockId?: string) => void): Unsubscribe;
    onExecutionComplete(callback: (result: IExecutionResult, blockId?: string) => void): Unsubscribe;
    onStatusChange(callback: (status: 'idle' | 'busy' | 'starting') => void): Unsubscribe;
}

export interface CollabConnectOptions {
    projectRoot: string;
    userName?: string;
    userType?: 'human' | 'ai';
}

export interface CollabSessionInfo {
    session_id: string;
    color: string;
    user_name?: string;
    user_type?: string;
}

export interface CollabCursorSelection {
    mdStart: number;
    mdEnd: number;
}

export interface CollabPresenceUser {
    session_id: string;
    user_name: string;
    user_type: string;
    color: string;
    current_file?: string | null;
    cursor?: {
        md_offset: number;
        selection_start?: number | null;
        selection_end?: number | null;
    } | null;
}

export interface CollabPresencePayload {
    file_path?: string;
    project?: string;
    users: CollabPresenceUser[];
}

export interface CollabUserJoinedPayload {
    user: CollabPresenceUser;
    file_path?: string;
}

export interface CollabUserLeftPayload {
    session_id: string;
    file_path?: string;
}

export interface CollabCursorPayload {
    session_id: string;
    user_name: string;
    color: string;
    md_offset: number;
    selection?: CollabCursorSelection | null;
}

export interface CollabFileSavedPayload {
    session_id: string;
    user_name: string;
    file_path: string;
    version_id?: string | number | null;
    content?: string | null;
    timestamp?: number;
}

export interface CollabFileChangedPayload {
    file_path: string;
    event_type: string;
    mtime?: number | null;
}

export interface CollabDirectoryChangedPayload {
    dir_path: string;
    event_type: string;
    changed_path: string;
    is_dir: boolean;
}

export interface CollabWatchFileAck {
    file_path: string;
    mtime?: number | null;
    error?: string;
}

export interface CollabWatchDirectoryAck {
    dir_path: string;
    success: boolean;
    error?: string;
}

export interface CollabSimpleSyncPayload {
    subtype: string;
    payload: Record<string, unknown>;
    session_id: string;
}

export interface CollabYjsSyncPayload {
    subtype: string;
    payload: Record<string, unknown>;
    session_id?: string;
}

export interface CollabYjsUpdatePayload {
    update: string;
    session_id: string;
}

export interface ICollaborationService {
    isConnected: boolean;

    // Connection
    connect(options: CollabConnectOptions): Promise<void>;
    disconnect(): Promise<void>;
    getSessionInfo(): CollabSessionInfo | null;

    // Presence and file context
    joinFile(filePath: string): void;
    leaveFile(): void;
    updateCursor(mdOffset: number, selection?: CollabCursorSelection | null): void;
    notifyFileSaved(filePath: string, versionId?: string | number | null, content?: string | null): void;
    getPresence(filePath?: string): void;

    // File watching
    watchFile(filePath: string): void;
    unwatchFile(filePath: string): void;
    watchDirectory(dirPath: string): void;
    unwatchDirectory(dirPath: string): void;

    // Sync primitives
    sendSimpleSync(subtype: string, payload: Record<string, unknown>, targetSession?: string): void;
    sendYjsSync(subtype: string, payload: Record<string, unknown>): void;

    // Events
    onConnected(callback: (info: CollabSessionInfo) => void): Unsubscribe;
    onDisconnected(callback: (event: CloseEvent) => void): Unsubscribe;
    onPresence(callback: (payload: CollabPresencePayload) => void): Unsubscribe;
    onUserJoined(callback: (payload: CollabUserJoinedPayload) => void): Unsubscribe;
    onUserLeft(callback: (payload: CollabUserLeftPayload) => void): Unsubscribe;
    onCursor(callback: (payload: CollabCursorPayload) => void): Unsubscribe;
    onFileSaved(callback: (payload: CollabFileSavedPayload) => void): Unsubscribe;
    onFileChanged(callback: (payload: CollabFileChangedPayload) => void): Unsubscribe;
    onDirectoryChanged(callback: (payload: CollabDirectoryChangedPayload) => void): Unsubscribe;
    onWatchFileAck(callback: (payload: CollabWatchFileAck) => void): Unsubscribe;
    onWatchDirectoryAck(callback: (payload: CollabWatchDirectoryAck) => void): Unsubscribe;
    onSimpleSync(callback: (payload: CollabSimpleSyncPayload) => void): Unsubscribe;
    onYjsSync(callback: (payload: CollabYjsSyncPayload) => void): Unsubscribe;
    onYjsUpdate(callback: (payload: CollabYjsUpdatePayload) => void): Unsubscribe;
}

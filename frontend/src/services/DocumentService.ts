import {
    IDocumentService,
    IFile,
    EnvironmentInfo,
    FileReadResponse,
    FileWriteResponse,
    FileWriteOptions,
    FileRenameResponse,
    FileDeleteResponse,
    FileListResponse,
    FileExistsResponse,
    FileMkdirResponse,
    FileCopyResponse,
    FileUploadResponse,
    FileMtimesResponse,
    FileSearchOptions,
    FileSearchResponse,
    FileGrepOptions,
    ProjectDetectResponse
} from './interfaces';

type Unsubscribe = () => void;

export class DocumentService implements IDocumentService {
    private _currentFile: IFile | null = null;
    private _files: Map<string, IFile> = new Map();
    
    // Event listeners
    private _listeners: {
        fileChanged: Set<(file: IFile) => void>;
        fileOpened: Set<(file: IFile) => void>;
        fileClosed: Set<(path: string) => void>;
    } = {
        fileChanged: new Set(),
        fileOpened: new Set(),
        fileClosed: new Set()
    };

    get currentFile(): IFile | null {
        return this._currentFile;
    }

    private async _postJson<T>(endpoint: string, body: unknown = {}): Promise<T> {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = (data as { error?: string }).error || response.statusText;
            throw new Error(message);
        }

        return data as T;
    }

    async readFile(path: string): Promise<FileReadResponse> {
        return this._postJson<FileReadResponse>('/api/file/read', { path });
    }

    async writeFile(path: string, content: string, options: FileWriteOptions = {}): Promise<FileWriteResponse> {
        return this._postJson<FileWriteResponse>('/api/file/write', {
            path,
            content,
            ...options
        });
    }

    async listDirectory(path: string, options: { showHidden?: boolean } = {}): Promise<FileListResponse> {
        return this._postJson<FileListResponse>('/api/file/list', {
            path,
            show_hidden: options.showHidden ?? false
        });
    }

    async fileExists(path: string): Promise<FileExistsResponse> {
        return this._postJson<FileExistsResponse>('/api/file/exists', { path });
    }

    async createDirectory(path: string): Promise<FileMkdirResponse> {
        return this._postJson<FileMkdirResponse>('/api/file/mkdir', { path });
    }

    async copyPath(srcPath: string, destPath: string): Promise<FileCopyResponse> {
        return this._postJson<FileCopyResponse>('/api/file/copy', {
            src_path: srcPath,
            dest_path: destPath
        });
    }

    async uploadFiles(destDir: string, files: File[]): Promise<FileUploadResponse> {
        const formData = new FormData();
        formData.append('dest_dir', destDir);
        for (const file of files) {
            formData.append('files', file, file.name);
        }

        const response = await fetch('/api/file/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = (data as { error?: string }).error || response.statusText;
            throw new Error(message);
        }

        return data as FileUploadResponse;
    }

    async getMtimes(paths: string[]): Promise<FileMtimesResponse> {
        return this._postJson<FileMtimesResponse>('/api/file/mtimes', { paths });
    }

    async searchFiles(options: FileSearchOptions): Promise<FileSearchResponse> {
        return this._postJson<FileSearchResponse>('/api/files/search', {
            query: options.query ?? '',
            root: options.root,
            mode: options.mode,
            extensions: options.extensions,
            max_results: options.maxResults,
            include_hidden: options.includeHidden
        });
    }

    async grepStream(options: FileGrepOptions): Promise<Response> {
        return fetch('/api/files/grep/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: options.query,
                root: options.root,
                max_results: options.maxResults,
                extensions: options.extensions,
                case_sensitive: options.caseSensitive
            })
        });
    }

    async detectProject(path: string): Promise<ProjectDetectResponse> {
        return this._postJson<ProjectDetectResponse>('/api/project/detect', { path });
    }

    async listEnvironments(projectRoot?: string): Promise<{ environments: EnvironmentInfo[]; project_root: string }> {
        return this._postJson<{ environments: EnvironmentInfo[]; project_root: string }>('/api/environments/list', {
            project_root: projectRoot
        });
    }

    async openFile(path: string): Promise<IFile> {
        // Check if already open
        if (this._files.has(path)) {
            const file = this._files.get(path)!;
            this._currentFile = file;
            this._emit('fileOpened', file);
            return file;
        }

        try {
            const data = await this.readFile(path);

            const file: IFile = {
                path: data.path || path,
                content: data.content || '',
                modified: false,
                lastSaved: Date.now(),
                projectRoot: data.project_root ?? null,
                environments: data.environments || [],
                mtime: data.mtime,
                versionId: data.version_id ?? null
            };

            this._files.set(path, file);
            if (file.path !== path) {
                this._files.set(file.path, file);
            }
            this._currentFile = file;
            this._emit('fileOpened', file);

            return file;
        } catch (err) {
            console.error('[DocumentService] Error opening file:', err);
            throw err;
        }
    }

    async saveFile(path: string, content: string, options: FileWriteOptions = {}): Promise<void> {
        try {
            const data = await this.writeFile(path, content, {
                author: 'user:editor',
                ...options
            });

            const file = this._files.get(path) || this._files.get(data.path);
            if (file) {
                file.path = data.path;
                file.content = content;
                file.modified = false;
                file.lastSaved = Date.now();
                file.mtime = data.mtime;
                file.versionId = data.version_id ?? file.versionId;
                file.projectRoot = data.project_root ?? file.projectRoot;
                this._files.set(file.path, file);
                this._emit('fileChanged', file);
            }
        } catch (err) {
            console.error('[DocumentService] Error saving file:', err);
            throw err;
        }
    }

    async createFile(path: string, content: string = ''): Promise<IFile> {
        // Just save it to create it
        await this.saveFile(path, content);
        return this.openFile(path);
    }

    async closeFile(path: string): Promise<void> {
        if (this._files.has(path)) {
            this._files.delete(path);
            if (this._currentFile?.path === path) {
                this._currentFile = null;
            }
            this._emit('fileClosed', path);
        }
    }

    async renameFile(oldPath: string, newPath: string): Promise<void> {
        try {
            await this._postJson<FileRenameResponse>('/api/file/rename', {
                old_path: oldPath,
                new_path: newPath
            });

            // Update local state if file is open
            if (this._files.has(oldPath)) {
                const file = this._files.get(oldPath)!;
                file.path = newPath;
                this._files.delete(oldPath);
                this._files.set(newPath, file);
                
                if (this._currentFile?.path === oldPath) {
                    this._currentFile = file;
                }
                
                // Notify listeners (treated as close old + open new or just change? 
                // For simplicity, let's just emit change for now, but UI might need more)
                this._emit('fileChanged', file); 
            }
        } catch (err) {
            console.error('[DocumentService] Error renaming file:', err);
            throw err;
        }
    }

    async deleteFile(path: string, options: { recursive?: boolean } = {}): Promise<void> {
        try {
            await this._postJson<FileDeleteResponse>('/api/file/delete', {
                path,
                recursive: options.recursive ?? false
            });

            await this.closeFile(path);
        } catch (err) {
            console.error('[DocumentService] Error deleting file:', err);
            throw err;
        }
    }

    markModified(path: string, modified: boolean): void {
        const file = this._files.get(path);
        if (file && file.modified !== modified) {
            file.modified = modified;
            this._emit('fileChanged', file);
        }
    }

    updateContent(path: string, content: string): void {
        const file = this._files.get(path);
        if (file) {
            file.content = content;
            this._emit('fileChanged', file);
        }
    }

    async getRecentFiles(): Promise<string[]> {
        // TODO: Implement persistent storage (localStorage or backend)
        return Array.from(new Set(this._files.keys()));
    }

    // Events
    onFileChanged(callback: (file: IFile) => void): Unsubscribe {
        this._listeners.fileChanged.add(callback);
        return () => this._listeners.fileChanged.delete(callback);
    }

    onFileOpened(callback: (file: IFile) => void): Unsubscribe {
        this._listeners.fileOpened.add(callback);
        return () => this._listeners.fileOpened.delete(callback);
    }

    onFileClosed(callback: (path: string) => void): Unsubscribe {
        this._listeners.fileClosed.add(callback);
        return () => this._listeners.fileClosed.delete(callback);
    }

    private _emit<K extends keyof typeof this._listeners>(event: K, ...args: any[]) {
        // @ts-ignore
        this._listeners[event].forEach(cb => cb(...args));
    }
}

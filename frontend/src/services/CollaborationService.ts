import {
    ICollaborationService,
    CollabConnectOptions,
    CollabSessionInfo,
    CollabCursorSelection,
    CollabPresencePayload,
    CollabUserJoinedPayload,
    CollabUserLeftPayload,
    CollabCursorPayload,
    CollabFileSavedPayload,
    CollabFileChangedPayload,
    CollabDirectoryChangedPayload,
    CollabWatchFileAck,
    CollabWatchDirectoryAck,
    CollabSimpleSyncPayload,
    CollabYjsSyncPayload,
    CollabYjsUpdatePayload,
    Unsubscribe
} from './interfaces';

type Listener<T> = (payload: T) => void;

export class CollaborationService implements ICollaborationService {
    private ws: WebSocket | null = null;
    private connected = false;
    private sessionInfo: CollabSessionInfo | null = null;
    private connectOptions: CollabConnectOptions | null = null;
    private heartbeatTimer: number | null = null;

    private listeners = {
        connected: new Set<Listener<CollabSessionInfo>>(),
        disconnected: new Set<Listener<CloseEvent>>(),
        presence: new Set<Listener<CollabPresencePayload>>(),
        userJoined: new Set<Listener<CollabUserJoinedPayload>>(),
        userLeft: new Set<Listener<CollabUserLeftPayload>>(),
        cursor: new Set<Listener<CollabCursorPayload>>(),
        fileSaved: new Set<Listener<CollabFileSavedPayload>>(),
        fileChanged: new Set<Listener<CollabFileChangedPayload>>(),
        directoryChanged: new Set<Listener<CollabDirectoryChangedPayload>>(),
        watchFileAck: new Set<Listener<CollabWatchFileAck>>(),
        watchDirectoryAck: new Set<Listener<CollabWatchDirectoryAck>>(),
        simpleSync: new Set<Listener<CollabSimpleSyncPayload>>(),
        yjsSync: new Set<Listener<CollabYjsSyncPayload>>(),
        yjsUpdate: new Set<Listener<CollabYjsUpdatePayload>>()
    };

    get isConnected(): boolean {
        return this.connected;
    }

    async connect(options: CollabConnectOptions): Promise<void> {
        if (this.ws && this.connected) {
            return;
        }

        this.connectOptions = options;
        const url = this.buildUrl(options);

        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(url);
            this.ws = ws;

            ws.onopen = () => {
                this.connected = true;
                this.startHeartbeat();
                resolve();
            };

            ws.onerror = () => {
                if (!this.connected) {
                    reject(new Error('Collaboration connection failed'));
                }
            };

            ws.onclose = (event) => {
                this.connected = false;
                this.stopHeartbeat();
                this.sessionInfo = null;
                this.ws = null;
                this.emit('disconnected', event);
            };

            ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        });
    }

    async disconnect(): Promise<void> {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.sessionInfo = null;
    }

    getSessionInfo(): CollabSessionInfo | null {
        return this.sessionInfo;
    }

    joinFile(filePath: string): void {
        this.send({ type: 'join_file', file_path: filePath });
    }

    leaveFile(): void {
        this.send({ type: 'leave_file' });
    }

    updateCursor(mdOffset: number, selection?: CollabCursorSelection | null): void {
        this.send({
            type: 'cursor',
            md_offset: mdOffset,
            selection: selection ? { mdStart: selection.mdStart, mdEnd: selection.mdEnd } : null
        });
    }

    notifyFileSaved(filePath: string, versionId?: string | number | null, content?: string | null): void {
        this.send({
            type: 'file_saved',
            file_path: filePath,
            version_id: versionId ?? null,
            content: content ?? null
        });
    }

    getPresence(filePath?: string): void {
        this.send({
            type: 'get_presence',
            file_path: filePath
        });
    }

    saveFile(filePath: string): void {
        this.send({ type: 'save_file', file_path: filePath });
    }

    watchFile(filePath: string): void {
        this.send({ type: 'watch_file', file_path: filePath });
    }

    unwatchFile(filePath: string): void {
        this.send({ type: 'unwatch_file', file_path: filePath });
    }

    watchDirectory(dirPath: string): void {
        this.send({ type: 'watch_directory', dir_path: dirPath });
    }

    unwatchDirectory(dirPath: string): void {
        this.send({ type: 'unwatch_directory', dir_path: dirPath });
    }

    sendSimpleSync(subtype: string, payload: Record<string, unknown>, targetSession?: string): void {
        this.send({
            type: 'simple_sync',
            subtype,
            payload,
            target_session: targetSession
        });
    }

    sendYjsSync(subtype: string, payload: Record<string, unknown>): void {
        this.send({
            type: 'yjs_sync',
            subtype,
            payload
        });
    }

    onConnected(callback: (info: CollabSessionInfo) => void): Unsubscribe {
        this.listeners.connected.add(callback);
        return () => this.listeners.connected.delete(callback);
    }

    onDisconnected(callback: (event: CloseEvent) => void): Unsubscribe {
        this.listeners.disconnected.add(callback);
        return () => this.listeners.disconnected.delete(callback);
    }

    onPresence(callback: (payload: CollabPresencePayload) => void): Unsubscribe {
        this.listeners.presence.add(callback);
        return () => this.listeners.presence.delete(callback);
    }

    onUserJoined(callback: (payload: CollabUserJoinedPayload) => void): Unsubscribe {
        this.listeners.userJoined.add(callback);
        return () => this.listeners.userJoined.delete(callback);
    }

    onUserLeft(callback: (payload: CollabUserLeftPayload) => void): Unsubscribe {
        this.listeners.userLeft.add(callback);
        return () => this.listeners.userLeft.delete(callback);
    }

    onCursor(callback: (payload: CollabCursorPayload) => void): Unsubscribe {
        this.listeners.cursor.add(callback);
        return () => this.listeners.cursor.delete(callback);
    }

    onFileSaved(callback: (payload: CollabFileSavedPayload) => void): Unsubscribe {
        this.listeners.fileSaved.add(callback);
        return () => this.listeners.fileSaved.delete(callback);
    }

    onFileChanged(callback: (payload: CollabFileChangedPayload) => void): Unsubscribe {
        this.listeners.fileChanged.add(callback);
        return () => this.listeners.fileChanged.delete(callback);
    }

    onDirectoryChanged(callback: (payload: CollabDirectoryChangedPayload) => void): Unsubscribe {
        this.listeners.directoryChanged.add(callback);
        return () => this.listeners.directoryChanged.delete(callback);
    }

    onWatchFileAck(callback: (payload: CollabWatchFileAck) => void): Unsubscribe {
        this.listeners.watchFileAck.add(callback);
        return () => this.listeners.watchFileAck.delete(callback);
    }

    onWatchDirectoryAck(callback: (payload: CollabWatchDirectoryAck) => void): Unsubscribe {
        this.listeners.watchDirectoryAck.add(callback);
        return () => this.listeners.watchDirectoryAck.delete(callback);
    }

    onSimpleSync(callback: (payload: CollabSimpleSyncPayload) => void): Unsubscribe {
        this.listeners.simpleSync.add(callback);
        return () => this.listeners.simpleSync.delete(callback);
    }

    onYjsSync(callback: (payload: CollabYjsSyncPayload) => void): Unsubscribe {
        this.listeners.yjsSync.add(callback);
        return () => this.listeners.yjsSync.delete(callback);
    }

    onYjsUpdate(callback: (payload: CollabYjsUpdatePayload) => void): Unsubscribe {
        this.listeners.yjsUpdate.add(callback);
        return () => this.listeners.yjsUpdate.delete(callback);
    }

    private buildUrl(options: CollabConnectOptions): string {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({
            project: options.projectRoot,
            user: options.userName || 'Anonymous',
            type: options.userType || 'human'
        });

        return `${protocol}//${window.location.host}/api/collab?${params.toString()}`;
    }

    private send(payload: Record<string, unknown>): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    private handleMessage(raw: string): void {
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch {
            return;
        }

        switch (data.type) {
            case 'connected':
                this.sessionInfo = {
                    session_id: data.session_id,
                    color: data.color,
                    user_name: this.connectOptions?.userName,
                    user_type: this.connectOptions?.userType
                };
                this.emit('connected', this.sessionInfo);
                break;
            case 'presence':
                this.emit('presence', data as CollabPresencePayload);
                break;
            case 'user_joined':
            case 'user_joined_file':
                this.emit('userJoined', data as CollabUserJoinedPayload);
                break;
            case 'user_left':
            case 'user_left_file':
                this.emit('userLeft', data as CollabUserLeftPayload);
                break;
            case 'cursor':
                this.emit('cursor', data as CollabCursorPayload);
                break;
            case 'file_saved':
                this.emit('fileSaved', data as CollabFileSavedPayload);
                break;
            case 'file_changed':
                this.emit('fileChanged', data as CollabFileChangedPayload);
                break;
            case 'directory_changed':
                this.emit('directoryChanged', data as CollabDirectoryChangedPayload);
                break;
            case 'watch_file_ack':
                this.emit('watchFileAck', data as CollabWatchFileAck);
                break;
            case 'watch_directory_ack':
                this.emit('watchDirectoryAck', data as CollabWatchDirectoryAck);
                break;
            case 'simple_sync':
                this.emit('simpleSync', data as CollabSimpleSyncPayload);
                break;
            case 'yjs_sync':
                this.emit('yjsSync', data as CollabYjsSyncPayload);
                break;
            case 'yjs_update':
                this.emit('yjsUpdate', data as CollabYjsUpdatePayload);
                break;
            default:
                break;
        }
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = window.setInterval(() => {
            this.send({ type: 'heartbeat' });
        }, 25000);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private emit(event: keyof typeof this.listeners, payload: unknown): void {
        this.listeners[event].forEach((listener) => {
            (listener as Listener<unknown>)(payload);
        });
    }
}

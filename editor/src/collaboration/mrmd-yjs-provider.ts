/**
 * MRMD Yjs Provider
 *
 * Yjs provider that works with the mrmd collab handler's JSON protocol.
 * Uses base64-encoded binary updates over the existing WebSocket connection.
 *
 * Protocol:
 * - Client sends: { type: 'yjs_sync', subtype: 'sync_step1', payload: { state_vector: '<base64>' } }
 * - Server responds: { type: 'yjs_sync', subtype: 'sync_step2', payload: { update: '<base64>' } }
 * - Real-time updates: { type: 'yjs_sync', subtype: 'update', payload: { update: '<base64>' } }
 * - Awareness: { type: 'yjs_sync', subtype: 'awareness', payload: { ... } }
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import type { YjsProvider } from './yjs-sync';

/**
 * File change event from server
 */
export interface FileChangeEvent {
  filePath: string;
  eventType: 'modified' | 'created' | 'deleted';
  mtime?: number;
}

/**
 * Directory change event from server
 */
export interface DirectoryChangeEvent {
  dirPath: string;
  eventType: 'created' | 'deleted';
  changedPath: string;
  isDir: boolean;
}

/**
 * Configuration for the MRMD Yjs provider
 */
export interface MrmdYjsProviderConfig {
  /** WebSocket URL for collab (e.g., ws://localhost:8000/api/collab) */
  url: string;
  /** File path (used as room ID) */
  filePath: string;
  /** Project root path (for file watching context) */
  projectRoot?: string;
  /** User info */
  userId: string;
  userName: string;
  userColor?: string;
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Max reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Called when sync is complete */
  onSync?: () => void;
  /** Called on status change */
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when an external file change is detected */
  onFileChange?: (event: FileChangeEvent) => void;
  /** Called when directory contents change */
  onDirectoryChange?: (event: DirectoryChangeEvent) => void;
  /**
   * Called when sync validation fails (server has content but client is empty).
   * Return content to initialize the document, or undefined to retry sync.
   */
  onSyncMismatch?: (serverContentLength: number) => string | undefined;
}

/**
 * Yjs provider for mrmd's collab handler
 */
export class MrmdYjsProvider implements YjsProvider {
  private config: MrmdYjsProviderConfig;
  private ws: WebSocket | null = null;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private synced = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private _isConnected = false;
  private sessionId: string | null = null;
  private userColor: string | null = null;

  // File watching state
  private watchedFiles = new Set<string>();
  private watchedDirectories = new Set<string>();
  private watchFileCallbacks = new Map<string, (mtime?: number, error?: string) => void>();
  private watchDirCallbacks = new Map<string, (success: boolean, error?: string) => void>();

  private syncedPromise: Promise<void>;
  private resolveSynced!: () => void;

  get isConnected(): boolean {
    return this._isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  constructor(config: MrmdYjsProviderConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      ...config,
    };

    this.syncedPromise = new Promise((resolve) => {
      this.resolveSynced = resolve;
    });
  }

  connect(ydoc: Y.Doc, awareness: Awareness): void {
    this.ydoc = ydoc;
    this.awareness = awareness;

    // Listen for local changes
    ydoc.on('update', this.handleDocUpdate);
    awareness.on('update', this.handleAwarenessUpdate);

    // Connect WebSocket
    this.connectWebSocket();
  }

  disconnect(): void {
    this.destroyed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ydoc) {
      this.ydoc.off('update', this.handleDocUpdate);
    }
    if (this.awareness) {
      this.awareness.off('update', this.handleAwarenessUpdate);
    }

    // Leave file before closing
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'leave_file' });
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._isConnected = false;
    this.config.onStatus?.('disconnected');
    console.log('[MrmdYjsProvider] Disconnected');
  }

  isSynced(): boolean {
    return this.synced;
  }

  whenSynced(): Promise<void> {
    return this.syncedPromise;
  }

  private connectWebSocket(): void {
    if (this.destroyed) return;

    const url = this.buildUrl();
    console.log('[MrmdYjsProvider] Connecting to', url);
    this.config.onStatus?.('connecting');

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[MrmdYjsProvider] Connected');
        this.reconnectAttempts = 0;
        // Don't set _isConnected yet - wait for 'connected' message
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (e) {
          console.error('[MrmdYjsProvider] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[MrmdYjsProvider] Connection closed:', event.code, event.reason);
        this.ws = null;
        this._isConnected = false;
        this.config.onStatus?.('disconnected');

        if (!this.destroyed && this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[MrmdYjsProvider] WebSocket error:', error);
        this.config.onError?.(new Error('WebSocket connection error'));
      };
    } catch (error) {
      console.error('[MrmdYjsProvider] Failed to create WebSocket:', error);
      this.config.onError?.(error as Error);
      this.scheduleReconnect();
    }
  }

  private buildUrl(): string {
    const url = new URL(this.config.url);
    url.searchParams.set('user', this.config.userName);
    url.searchParams.set('type', 'human');
    if (this.config.projectRoot) {
      url.searchParams.set('project', this.config.projectRoot);
    }
    return url.toString();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimeout) return;

    const maxAttempts = this.config.maxReconnectAttempts || 0;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      console.log('[MrmdYjsProvider] Max reconnect attempts reached');
      this.config.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay! * Math.min(this.reconnectAttempts, 5);

    console.log(
      `[MrmdYjsProvider] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectWebSocket();
    }, delay);
  }

  private send(message: object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    const type = data.type as string;

    switch (type) {
      case 'connected':
        // Server acknowledged connection
        this.sessionId = data.session_id as string;
        this.userColor = data.color as string;
        this._isConnected = true;
        this.config.onStatus?.('connected');
        console.log('[MrmdYjsProvider] Session:', this.sessionId, 'Color:', this.userColor);

        // Join the file
        this.send({
          type: 'join_file',
          file_path: this.config.filePath,
        });

        // Re-watch any files/directories after reconnect
        this.reestablishWatches();
        break;

      case 'presence':
        // Received file presence info - now request Yjs sync
        this.requestSync();
        break;

      case 'yjs_sync':
        this.handleYjsSync(data);
        break;

      case 'yjs_update':
        // Real-time update from another client
        this.handleYjsUpdate(data);
        break;

      case 'user_joined_file':
        // Re-broadcast our awareness state so new user sees our cursor
        if (this.awareness) {
          const localClientId = this.awareness.clientID;
          const awarenessUpdate = encodeAwarenessUpdate(this.awareness, [localClientId]);
          const awarenessB64 = this.toBase64(awarenessUpdate);
          this.send({
            type: 'yjs_sync',
            subtype: 'awareness',
            payload: {
              awareness: awarenessB64,
            },
          });
          console.log('[MrmdYjsProvider] Re-broadcast awareness for new user');
        }
        break;

      case 'user_left_file':
      case 'cursor':
        // Handle presence updates (optional)
        break;

      // File watching responses
      case 'file_changed':
        this.config.onFileChange?.({
          filePath: data.file_path as string,
          eventType: data.event_type as 'modified' | 'created' | 'deleted',
          mtime: data.mtime as number | undefined,
        });
        break;

      case 'watch_file_ack': {
        const filePath = data.file_path as string;
        const callback = this.watchFileCallbacks.get(filePath);
        if (callback) {
          callback(data.mtime as number | undefined, data.error as string | undefined);
          this.watchFileCallbacks.delete(filePath);
        }
        break;
      }

      case 'directory_changed':
        this.config.onDirectoryChange?.({
          dirPath: data.dir_path as string,
          eventType: data.event_type as 'created' | 'deleted',
          changedPath: data.changed_path as string,
          isDir: data.is_dir as boolean,
        });
        break;

      case 'watch_directory_ack': {
        const dirPath = data.dir_path as string;
        const callback = this.watchDirCallbacks.get(dirPath);
        if (callback) {
          callback(data.success as boolean, data.error as string | undefined);
          this.watchDirCallbacks.delete(dirPath);
        }
        break;
      }

      default:
        // Ignore other message types
        break;
    }
  }

  private requestSync(): void {
    if (!this.ydoc) return;

    // Send sync_step1 with our state vector
    const stateVector = Y.encodeStateVector(this.ydoc);
    const stateVectorB64 = this.toBase64(stateVector);

    this.send({
      type: 'yjs_sync',
      subtype: 'sync_step1',
      payload: {
        state_vector: stateVectorB64,
      },
    });

    console.log('[MrmdYjsProvider] Requested sync');
  }

  private handleYjsSync(data: Record<string, unknown>): void {
    const subtype = data.subtype as string;
    const payload = data.payload as Record<string, unknown> || {};

    switch (subtype) {
      case 'sync_step1': {
        // Server is requesting our updates
        if (!this.ydoc) return;

        const stateVectorB64 = payload.state_vector as string;
        if (stateVectorB64) {
          const stateVector = this.fromBase64(stateVectorB64);
          const diff = Y.encodeStateAsUpdate(this.ydoc, stateVector);

          this.send({
            type: 'yjs_sync',
            subtype: 'sync_step2',
            payload: {
              update: this.toBase64(diff),
            },
          });
        }
        break;
      }

      case 'sync_step2': {
        // Server sent us updates
        if (!this.ydoc) return;

        const updateB64 = payload.update as string;
        const serverContentLength = payload.content_length as number | undefined;

        if (updateB64) {
          const update = this.fromBase64(updateB64);
          console.log('[MrmdYjsProvider] Received sync_step2, update size:', update.length, 'bytes, server content:', serverContentLength);

          Y.applyUpdate(this.ydoc, update, this);

          const localContent = this.ydoc.getText('content').toString();
          console.log('[MrmdYjsProvider] After apply:', localContent.length, 'chars');

          // VALIDATION: Check if sync result matches server's content length
          if (serverContentLength !== undefined && serverContentLength > 0 && localContent.length === 0) {
            console.warn('[MrmdYjsProvider] SYNC MISMATCH: Server has', serverContentLength, 'chars but local is empty');

            // Ask the app layer what to do
            if (this.config.onSyncMismatch) {
              const fallbackContent = this.config.onSyncMismatch(serverContentLength);
              if (fallbackContent !== undefined) {
                // Initialize with fallback content
                console.log('[MrmdYjsProvider] Using fallback content:', fallbackContent.length, 'chars');
                this.ydoc.transact(() => {
                  this.ydoc!.getText('content').insert(0, fallbackContent);
                }, 'sync-fallback');
              }
            }
          }

          if (!this.synced) {
            this.synced = true;
            this.resolveSynced();
            this.config.onSync?.();
            console.log('[MrmdYjsProvider] Initial sync complete, content:', this.ydoc.getText('content').length, 'chars');
          }
        }
        break;
      }

      case 'awareness': {
        // Awareness update from another client
        if (!this.awareness) return;

        const awarenessData = payload.awareness as string;
        if (awarenessData) {
          const update = this.fromBase64(awarenessData);
          applyAwarenessUpdate(this.awareness, update, this);
        }
        break;
      }
    }
  }

  private handleYjsUpdate(data: Record<string, unknown>): void {
    if (!this.ydoc) return;

    const updateB64 = data.update as string;
    const senderId = data.session_id as string;

    // Don't apply our own updates
    if (senderId === this.sessionId) {
      console.log('[MrmdYjsProvider] Ignoring own update');
      return;
    }

    if (updateB64) {
      const update = this.fromBase64(updateB64);
      console.log('[MrmdYjsProvider] Received remote update from', senderId, 'size:', update.length);
      const textBefore = this.ydoc.getText('content').length;
      Y.applyUpdate(this.ydoc, update, this);
      const textAfter = this.ydoc.getText('content').length;
      console.log('[MrmdYjsProvider] Text length:', textBefore, '->', textAfter);
    }
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Don't send updates that came from the server
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Don't send updates before initial sync
    if (!this.synced) return;

    console.log('[MrmdYjsProvider] Sending local update, size:', update.length, 'origin:', origin);
    const updateB64 = this.toBase64(update);

    this.send({
      type: 'yjs_sync',
      subtype: 'update',
      payload: {
        update: updateB64,
      },
    });
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.awareness) return;

    const changedClients = [...added, ...updated, ...removed];
    if (changedClients.length === 0) return;

    const awarenessUpdate = encodeAwarenessUpdate(this.awareness, changedClients);
    const awarenessB64 = this.toBase64(awarenessUpdate);

    this.send({
      type: 'yjs_sync',
      subtype: 'awareness',
      payload: {
        awareness: awarenessB64,
      },
    });
  };

  // ============================================
  // File Watching API
  // ============================================

  /**
   * Watch a file for external changes (e.g., AI edits).
   * Note: For files being edited via Yjs, external changes automatically
   * update the Yjs document. This is mainly for other files in the project.
   */
  watchFile(filePath: string, callback?: (mtime?: number, error?: string) => void): void {
    this.watchedFiles.add(filePath);
    if (callback) {
      this.watchFileCallbacks.set(filePath, callback);
    }
    this.send({
      type: 'watch_file',
      file_path: filePath,
    });
  }

  /**
   * Stop watching a file.
   */
  unwatchFile(filePath: string): void {
    this.watchedFiles.delete(filePath);
    this.watchFileCallbacks.delete(filePath);
    this.send({
      type: 'unwatch_file',
      file_path: filePath,
    });
  }

  /**
   * Watch a directory for content changes (files/folders created or deleted).
   * Useful for file browser updates.
   */
  watchDirectory(dirPath: string, callback?: (success: boolean, error?: string) => void): void {
    this.watchedDirectories.add(dirPath);
    if (callback) {
      this.watchDirCallbacks.set(dirPath, callback);
    }
    this.send({
      type: 'watch_directory',
      dir_path: dirPath,
    });
  }

  /**
   * Stop watching a directory.
   */
  unwatchDirectory(dirPath: string): void {
    this.watchedDirectories.delete(dirPath);
    this.watchDirCallbacks.delete(dirPath);
    this.send({
      type: 'unwatch_directory',
      dir_path: dirPath,
    });
  }

  /**
   * Re-establish file/directory watches after reconnection.
   */
  private reestablishWatches(): void {
    for (const filePath of this.watchedFiles) {
      this.send({
        type: 'watch_file',
        file_path: filePath,
      });
    }
    for (const dirPath of this.watchedDirectories) {
      this.send({
        type: 'watch_directory',
        dir_path: dirPath,
      });
    }
  }

  /**
   * Get the session ID assigned by the server.
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the color assigned by the server.
   */
  getColor(): string | null {
    return this.userColor;
  }

  // Base64 encoding/decoding utilities
  private toBase64(data: Uint8Array): string {
    // Use browser's btoa for efficiency
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  }

  private fromBase64(str: string): Uint8Array {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

/**
 * Create an MRMD Yjs provider
 */
export function createMrmdYjsProvider(config: MrmdYjsProviderConfig): MrmdYjsProvider {
  return new MrmdYjsProvider(config);
}

/**
 * CollabServiceYjsAdapter
 *
 * Implements the YjsProvider interface using a CollaborationService-like object
 * as the WebSocket transport. This avoids creating a second WebSocket connection.
 *
 * IMPORTANT: This module lives in the editor package so it uses the SAME Yjs instance
 * as YjsDocManager. This prevents the dual-bundle issue where different Yjs instances
 * cause instanceof checks to fail.
 *
 * Key benefits:
 * - Single Yjs instance (no dual-bundle conflicts)
 * - Single WebSocket connection (no duplicate sessions)
 * - Integrates with existing file watching and presence
 * - Uses CollaborationService's reconnection logic
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';

/**
 * Minimal interface for what we need from CollaborationService.
 * The frontend's CollaborationService should satisfy this interface.
 */
export interface CollabServiceInterface {
    readonly isConnected: boolean;

    getSessionInfo(): { session_id: string; color: string; user_name?: string } | null;

    // File context
    joinFile(filePath: string): void;
    leaveFile(): void;

    // Yjs sync
    sendYjsSync(subtype: string, payload: Record<string, unknown>): void;

    // Event subscriptions (return unsubscribe function)
    onYjsSync(callback: (payload: YjsSyncPayload) => void): () => void;
    onYjsUpdate(callback: (payload: YjsUpdatePayload) => void): () => void;
    onPresence(callback: (payload: { file_path?: string }) => void): () => void;
}

/**
 * Yjs sync protocol payload
 */
export interface YjsSyncPayload {
    subtype: string;
    payload: Record<string, unknown>;
    session_id?: string;
}

/**
 * Yjs update payload (real-time updates from other clients)
 */
export interface YjsUpdatePayload {
    update: string;
    session_id: string;
}

/**
 * Interface matching what YjsDocManager expects from a provider
 */
export interface YjsProviderInterface {
    connect(ydoc: Y.Doc, awareness: Awareness): void;
    disconnect(): void;
    readonly isConnected: boolean;
    isSynced(): boolean;
    whenSynced(): Promise<void>;
}

/**
 * Adapter that uses CollaborationService for Yjs transport.
 * Lives in editor package to use the same Yjs instance as YjsDocManager.
 */
export class CollabServiceYjsAdapter implements YjsProviderInterface {
    private collab: CollabServiceInterface;
    private filePath: string;
    private ydoc: Y.Doc | null = null;
    private awareness: Awareness | null = null;
    private synced = false;
    private destroyed = false;

    // Promise for initial sync
    private syncedPromise: Promise<void>;
    private resolveSynced!: () => void;
    private rejectSynced!: (error: Error) => void;

    // Unsubscribe functions for event listeners
    private unsubYjsSync: (() => void) | null = null;
    private unsubYjsUpdate: (() => void) | null = null;
    private unsubPresence: (() => void) | null = null;

    // Timeout for sync
    private syncTimeout: ReturnType<typeof setTimeout> | null = null;
    private static SYNC_TIMEOUT_MS = 10000; // 10 seconds

    /**
     * Called when sync validation fails (server has content but client is empty).
     * Return content to initialize the document, or undefined to do nothing.
     */
    onSyncMismatch?: (serverContentLength: number) => string | undefined;

    constructor(collab: CollabServiceInterface, filePath: string) {
        this.collab = collab;
        this.filePath = filePath;

        this.syncedPromise = new Promise((resolve, reject) => {
            this.resolveSynced = resolve;
            this.rejectSynced = reject;
        });
    }

    get isConnected(): boolean {
        return this.collab.isConnected && !this.destroyed;
    }

    isSynced(): boolean {
        return this.synced;
    }

    whenSynced(): Promise<void> {
        return this.syncedPromise;
    }

    connect(ydoc: Y.Doc, awareness: Awareness): void {
        if (this.destroyed) {
            throw new Error('Adapter has been destroyed');
        }

        this.ydoc = ydoc;
        this.awareness = awareness;

        console.log('[CollabServiceYjsAdapter] Connecting for file:', this.filePath);

        // Listen for Yjs messages via CollaborationService
        this.unsubYjsSync = this.collab.onYjsSync(this.handleYjsSync);
        this.unsubYjsUpdate = this.collab.onYjsUpdate(this.handleYjsUpdate);

        // Listen for presence to trigger initial sync
        this.unsubPresence = this.collab.onPresence(this.handlePresence);

        // Listen for local doc changes
        ydoc.on('update', this.handleDocUpdate);
        awareness.on('update', this.handleAwarenessUpdate);

        // Join the file (this triggers presence response which starts sync)
        this.collab.joinFile(this.filePath);

        // Set sync timeout
        this.syncTimeout = setTimeout(() => {
            if (!this.synced && !this.destroyed) {
                console.error('[CollabServiceYjsAdapter] Sync timeout for:', this.filePath);
                this.rejectSynced(new Error('Sync timeout'));
            }
        }, CollabServiceYjsAdapter.SYNC_TIMEOUT_MS);
    }

    disconnect(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        console.log('[CollabServiceYjsAdapter] Disconnecting from file:', this.filePath);

        // Clear timeout
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
            this.syncTimeout = null;
        }

        // Remove event listeners
        this.unsubYjsSync?.();
        this.unsubYjsUpdate?.();
        this.unsubPresence?.();

        // Remove doc listeners
        if (this.ydoc) {
            this.ydoc.off('update', this.handleDocUpdate);
        }
        if (this.awareness) {
            this.awareness.off('update', this.handleAwarenessUpdate);
        }

        // Leave the file
        this.collab.leaveFile();

        this.ydoc = null;
        this.awareness = null;
    }

    /**
     * Handle presence response - triggers initial sync
     */
    private handlePresence = (payload: { file_path?: string }): void => {
        // Only respond to presence for our file
        if (payload.file_path !== this.filePath) return;
        if (this.synced || this.destroyed) return;

        console.log('[CollabServiceYjsAdapter] Received presence, requesting sync');
        this.requestSync();
    };

    /**
     * Request initial sync from server
     */
    private requestSync(): void {
        if (!this.ydoc || this.destroyed) return;

        // Send sync_step1 with our state vector
        const stateVector = Y.encodeStateVector(this.ydoc);
        const stateVectorB64 = this.toBase64(stateVector);

        this.collab.sendYjsSync('sync_step1', {
            state_vector: stateVectorB64,
        });

        console.log('[CollabServiceYjsAdapter] Requested sync (state vector sent)');
    }

    /**
     * Handle Yjs sync protocol messages
     */
    private handleYjsSync = (payload: YjsSyncPayload): void => {
        if (!this.ydoc || this.destroyed) return;

        const { subtype, payload: data } = payload;

        switch (subtype) {
            case 'sync_step1': {
                // Server is requesting our updates
                const stateVectorB64 = data.state_vector as string;
                if (stateVectorB64) {
                    const stateVector = this.fromBase64(stateVectorB64);
                    const diff = Y.encodeStateAsUpdate(this.ydoc, stateVector);

                    this.collab.sendYjsSync('sync_step2', {
                        update: this.toBase64(diff),
                    });
                    console.log('[CollabServiceYjsAdapter] Sent sync_step2 (our updates)');
                }
                break;
            }

            case 'sync_step2': {
                // Server sent us updates
                const updateB64 = data.update as string;
                const serverContentLength = data.content_length as number | undefined;

                if (updateB64) {
                    const update = this.fromBase64(updateB64);
                    console.log('[CollabServiceYjsAdapter] Received sync_step2, applying', update.length, 'bytes, server content:', serverContentLength);

                    // Apply with 'remote' origin so we can distinguish from local changes
                    Y.applyUpdate(this.ydoc, update, 'remote');

                    const textContent = this.ydoc.getText('content').toString();
                    console.log('[CollabServiceYjsAdapter] After sync, content length:', textContent.length);

                    // VALIDATION: Check for sync mismatch
                    if (serverContentLength !== undefined && serverContentLength > 0 && textContent.length === 0) {
                        console.warn('[CollabServiceYjsAdapter] SYNC MISMATCH: Server has', serverContentLength, 'chars but local is empty');
                        // Notify via callback if configured
                        if (this.onSyncMismatch) {
                            const fallback = this.onSyncMismatch(serverContentLength);
                            if (fallback !== undefined) {
                                console.log('[CollabServiceYjsAdapter] Using fallback content:', fallback.length, 'chars');
                                this.ydoc.transact(() => {
                                    this.ydoc!.getText('content').insert(0, fallback);
                                }, 'sync-fallback');
                            }
                        }
                    }

                    if (!this.synced) {
                        this.synced = true;
                        if (this.syncTimeout) {
                            clearTimeout(this.syncTimeout);
                            this.syncTimeout = null;
                        }
                        this.resolveSynced();
                        console.log('[CollabServiceYjsAdapter] Initial sync complete, content:', this.ydoc.getText('content').length, 'chars');
                    }
                }
                break;
            }

            case 'awareness': {
                // Awareness update from another client
                if (this.awareness && data.awareness) {
                    const update = this.fromBase64(data.awareness as string);
                    applyAwarenessUpdate(this.awareness, update, 'remote');
                }
                break;
            }
        }
    };

    /**
     * Handle real-time Yjs updates from other clients
     */
    private handleYjsUpdate = (payload: YjsUpdatePayload): void => {
        if (!this.ydoc || this.destroyed) return;

        // Don't apply our own updates
        const mySessionId = this.collab.getSessionInfo()?.session_id;
        if (payload.session_id === mySessionId) {
            return;
        }

        if (payload.update) {
            const update = this.fromBase64(payload.update);
            const contentBefore = this.ydoc.getText('content').toString().length;

            console.log('[CollabServiceYjsAdapter] Received remote update from', payload.session_id, 'size:', update.length, 'content before:', contentBefore);

            // Apply with 'remote' origin
            Y.applyUpdate(this.ydoc, update, 'remote');

            const contentAfter = this.ydoc.getText('content').toString().length;
            console.log('[CollabServiceYjsAdapter] After applying update, content:', contentAfter, 'chars (delta:', contentAfter - contentBefore, ')');
        }
    };

    /**
     * Handle local document updates - send to server
     */
    private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
        // Don't send remote updates back to server
        if (origin === 'remote' || this.destroyed) return;

        // Don't send updates before initial sync
        if (!this.synced) return;

        console.log('[CollabServiceYjsAdapter] Sending local update, size:', update.length, 'origin:', origin);

        this.collab.sendYjsSync('update', {
            update: this.toBase64(update),
        });
    };

    /**
     * Handle local awareness updates - send to server
     */
    private handleAwarenessUpdate = (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown
    ): void => {
        if (origin === 'remote' || this.destroyed || !this.awareness) return;

        const changedClients = [...added, ...updated, ...removed];
        if (changedClients.length === 0) return;

        const awarenessUpdate = encodeAwarenessUpdate(this.awareness, changedClients);

        this.collab.sendYjsSync('awareness', {
            awareness: this.toBase64(awarenessUpdate),
        });
    };

    // Base64 utilities
    private toBase64(data: Uint8Array): string {
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
 * Create a Yjs adapter using CollaborationService
 */
export function createCollabServiceYjsAdapter(
    collab: CollabServiceInterface,
    filePath: string
): CollabServiceYjsAdapter {
    return new CollabServiceYjsAdapter(collab, filePath);
}

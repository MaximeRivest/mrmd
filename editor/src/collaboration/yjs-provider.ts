/**
 * Yjs WebSocket Provider
 *
 * Custom WebSocket provider for Yjs that can work with:
 * - pycrdt-websocket (Python backend)
 * - y-websocket (Node.js)
 * - Custom WebSocket protocols
 *
 * Uses the y-protocols for encoding/decoding sync messages.
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import type { YjsProvider } from './yjs-sync';

/**
 * Message types for Yjs WebSocket protocol
 */
const MessageType = {
  SYNC: 0,
  AWARENESS: 1,
  AUTH: 2,
  QUERY_AWARENESS: 3,
} as const;

/**
 * Configuration for the WebSocket provider
 */
export interface YjsWebSocketConfig {
  /** WebSocket URL (e.g., ws://localhost:8000/yjs/{room}) */
  url: string;
  /** Room/document ID */
  roomId: string;
  /** Authentication token (optional) */
  token?: string;
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
}

/**
 * WebSocket provider for Yjs
 */
export class YjsWebSocketProvider implements YjsProvider {
  private config: YjsWebSocketConfig;
  private ws: WebSocket | null = null;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private synced = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private _isConnected = false;

  private syncedPromise: Promise<void>;
  private resolveSynced!: () => void;

  /**
   * Check if WebSocket is currently connected
   */
  get isConnected(): boolean {
    return this._isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  constructor(config: YjsWebSocketConfig) {
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

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.config.onStatus?.('disconnected');
    console.log('[YjsProvider] Disconnected');
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
    console.log('[YjsProvider] Connecting to', url);
    this.config.onStatus?.('connecting');

    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[YjsProvider] Connected');
        this.reconnectAttempts = 0;
        this._isConnected = true;
        this.config.onStatus?.('connected');

        // Send sync step 1
        this.sendSyncStep1();

        // Query awareness
        this.sendAwarenessQuery();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(new Uint8Array(event.data as ArrayBuffer));
      };

      this.ws.onclose = (event) => {
        console.log('[YjsProvider] Connection closed:', event.code, event.reason);
        this.ws = null;
        this._isConnected = false;
        this.config.onStatus?.('disconnected');

        if (!this.destroyed && this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[YjsProvider] WebSocket error:', error);
        this.config.onError?.(new Error('WebSocket connection error'));
      };
    } catch (error) {
      console.error('[YjsProvider] Failed to create WebSocket:', error);
      this.config.onError?.(error as Error);
      this.scheduleReconnect();
    }
  }

  private buildUrl(): string {
    let url = this.config.url;

    // Replace {room} placeholder with actual room ID
    url = url.replace('{room}', encodeURIComponent(this.config.roomId));

    // Add token as query parameter if provided
    if (this.config.token) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}token=${encodeURIComponent(this.config.token)}`;
    }

    return url;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimeout) return;

    const maxAttempts = this.config.maxReconnectAttempts || 0;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      console.log('[YjsProvider] Max reconnect attempts reached');
      this.config.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay! * Math.min(this.reconnectAttempts, 5);

    console.log(
      `[YjsProvider] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connectWebSocket();
    }, delay);
  }

  private sendSyncStep1(): void {
    if (!this.ws || !this.ydoc) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.SYNC);
    syncProtocol.writeSyncStep1(encoder, this.ydoc);

    this.ws.send(encoding.toUint8Array(encoder));
    console.log('[YjsProvider] Sent sync step 1');
  }

  private sendAwarenessQuery(): void {
    if (!this.ws) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.QUERY_AWARENESS);

    this.ws.send(encoding.toUint8Array(encoder));
  }

  private handleMessage = (data: Uint8Array): void => {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MessageType.SYNC:
        this.handleSyncMessage(decoder);
        break;
      case MessageType.AWARENESS:
        this.handleAwarenessMessage(decoder);
        break;
      default:
        console.log('[YjsProvider] Unknown message type:', messageType);
    }
  };

  private handleSyncMessage(decoder: decoding.Decoder): void {
    if (!this.ydoc || !this.ws) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.SYNC);

    const syncMessageType = syncProtocol.readSyncMessage(
      decoder,
      encoder,
      this.ydoc,
      this
    );

    // If we wrote a response, send it
    if (encoding.length(encoder) > 1) {
      this.ws.send(encoding.toUint8Array(encoder));
    }

    // Check if sync is complete
    if (
      syncMessageType === syncProtocol.messageYjsSyncStep2 &&
      !this.synced
    ) {
      this.synced = true;
      this.resolveSynced();
      this.config.onSync?.();
      console.log('[YjsProvider] Initial sync complete');
    }
  }

  private handleAwarenessMessage(decoder: decoding.Decoder): void {
    if (!this.awareness) return;

    const update = decoding.readVarUint8Array(decoder);
    applyAwarenessUpdate(this.awareness, update, this);
  }

  private handleDocUpdate = (
    update: Uint8Array,
    origin: unknown
  ): void => {
    // Don't send updates that came from the WebSocket (would cause infinite loop)
    if (origin === this || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.SYNC);
    syncProtocol.writeUpdate(encoder, update);

    this.ws.send(encoding.toUint8Array(encoder));
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

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, changedClients)
    );

    this.ws.send(encoding.toUint8Array(encoder));
  };
}

/**
 * Create a Yjs WebSocket provider
 */
export function createYjsWebSocketProvider(
  config: YjsWebSocketConfig
): YjsWebSocketProvider {
  return new YjsWebSocketProvider(config);
}

/**
 * Provider that wraps existing CollabClientAdapter for Yjs sync
 * This allows using your existing WebSocket infrastructure
 */
export class CollabAdapterYjsProvider implements YjsProvider {
  private adapter: import('./types').CollabClientAdapter;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private synced = false;
  private _isConnected = false;
  private syncedPromise: Promise<void>;
  private resolveSynced!: () => void;

  constructor(adapter: import('./types').CollabClientAdapter) {
    this.adapter = adapter;
    this.syncedPromise = new Promise((resolve) => {
      this.resolveSynced = resolve;
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  connect(ydoc: Y.Doc, awareness: Awareness): void {
    this.ydoc = ydoc;
    this.awareness = awareness;
    this._isConnected = true;

    // For now, mark as synced immediately since we're using existing adapter
    // Real implementation would need protocol support in your backend
    this.synced = true;
    this.resolveSynced();

    console.log('[CollabAdapterYjsProvider] Connected (local-only mode)');
    console.log(
      '[CollabAdapterYjsProvider] Note: Full Yjs sync requires pycrdt-websocket backend'
    );
  }

  disconnect(): void {
    this.ydoc = null;
    this.awareness = null;
    this._isConnected = false;
  }

  isSynced(): boolean {
    return this.synced;
  }

  whenSynced(): Promise<void> {
    return this.syncedPromise;
  }
}

/**
 * Yjs Awareness Adapter
 *
 * Bridges the abstract AwarenessProvider interface to Yjs's awareness protocol.
 * This enables real multi-user collaboration via y-websocket or other Yjs providers.
 *
 * Key behaviors:
 * - Maps Yjs clientID (number) to userId (string) for consistent identification
 * - Handles serialization of complex state (locks, streams)
 * - Provides clean event interface matching our AwarenessProvider contract
 * - Gracefully handles offline/reconnect scenarios
 */

import type { Awareness } from 'y-protocols/awareness';
import type { AwarenessProvider, AwarenessState, AwarenessOutputBlock } from './streaming/awareness-sync';
import type { Lock } from './locks/types';
import type { StreamingOverlay } from './streaming/overlay';

// ============================================
// Types
// ============================================

export interface YjsAwarenessConfig {
  /**
   * The Yjs awareness instance (from WebSocketProvider or other)
   */
  awareness: Awareness;

  /**
   * Local user information
   */
  userId: string;
  userName: string;
  userColor: string;

  /**
   * Initial role (default: 'collaborator')
   */
  role?: 'presenter' | 'viewer' | 'collaborator';

  /**
   * Called when awareness state changes (for debugging)
   */
  onDebug?: (event: string, data: any) => void;
}

/**
 * Internal representation of awareness state as stored in Yjs
 * This is what gets serialized/deserialized
 */
interface YjsAwarenessStateInternal {
  user: {
    id: string;
    name: string;
    color: string;
  };
  cursor?: {
    from: number;
    to: number;
  };
  selection?: {
    from: number;
    to: number;
  };
  scroll?: {
    top: number;
    height: number;
  };
  role: 'presenter' | 'viewer' | 'collaborator';
  following?: string;
  locks: SerializedLock[];
  streams: SerializedStream[];
  outputs?: AwarenessOutputBlock[];  // Execution outputs - already primitive types
}

/**
 * Serialized lock (all primitive types for JSON safety)
 * Note: LockState includes 'unlocked' but we only serialize active locks
 */
interface SerializedLock {
  id: string;
  blockId: string;
  state: 'unlocked' | 'soft' | 'hard';
  owner: {
    userId: string;
    userName: string;
    userColor: string;
    type: 'human' | 'ai' | 'execution';
    operation?: string;
  };
  acquiredAt: number;
  lastActivityAt: number;
  hardLockedAt?: number;
  anchorPos: number;
}

/**
 * Serialized streaming overlay (all primitive types for JSON safety)
 */
interface SerializedStream {
  id: string;
  type: 'ai' | 'execution' | 'external';
  anchorPos: number;
  anchorType: 'after' | 'replace';
  replaceFrom?: number;
  replaceTo?: number;
  content: string;
  status: 'streaming' | 'complete' | 'error';
  owner: {
    userId: string;
    userName: string;
    userColor: string;
  };
  operation?: string;
  startedAt: number;
  lastChunkAt: number;
  error?: string;
}

// ============================================
// Serialization Helpers
// ============================================

function serializeLock(lock: Lock): SerializedLock {
  return {
    id: lock.id,
    blockId: lock.blockId,
    state: lock.state,
    owner: {
      userId: lock.owner.userId,
      userName: lock.owner.userName,
      userColor: lock.owner.userColor,
      type: lock.owner.type,
      operation: lock.owner.operation,
    },
    acquiredAt: lock.acquiredAt,
    lastActivityAt: lock.lastActivityAt,
    hardLockedAt: lock.hardLockedAt,
    anchorPos: lock.anchorPos,
  };
}

function deserializeLock(data: SerializedLock): Lock {
  return {
    id: data.id,
    blockId: data.blockId,
    state: data.state,
    owner: {
      userId: data.owner.userId,
      userName: data.owner.userName,
      userColor: data.owner.userColor,
      type: data.owner.type,
      operation: data.owner.operation,
    },
    acquiredAt: data.acquiredAt,
    lastActivityAt: data.lastActivityAt,
    hardLockedAt: data.hardLockedAt,
    anchorPos: data.anchorPos,
  };
}

function serializeStream(stream: StreamingOverlay): SerializedStream {
  return {
    id: stream.id,
    type: stream.type,
    anchorPos: stream.anchorPos,
    anchorType: stream.anchorType,
    replaceFrom: stream.replaceFrom,
    replaceTo: stream.replaceTo,
    content: stream.content,
    status: stream.status,
    owner: {
      userId: stream.owner.userId,
      userName: stream.owner.userName,
      userColor: stream.owner.userColor,
    },
    operation: stream.operation,
    startedAt: stream.startedAt,
    lastChunkAt: stream.lastChunkAt,
    error: stream.error,
  };
}

function deserializeStream(data: SerializedStream): StreamingOverlay {
  return {
    id: data.id,
    type: data.type,
    anchorPos: data.anchorPos,
    anchorType: data.anchorType,
    replaceFrom: data.replaceFrom,
    replaceTo: data.replaceTo,
    content: data.content,
    status: data.status,
    owner: {
      userId: data.owner.userId,
      userName: data.owner.userName,
      userColor: data.owner.userColor,
    },
    operation: data.operation,
    startedAt: data.startedAt,
    lastChunkAt: data.lastChunkAt,
    error: data.error,
  };
}

function toAwarenessState(internal: YjsAwarenessStateInternal): AwarenessState {
  return {
    user: internal.user,
    cursor: internal.cursor,
    selection: internal.selection,
    scroll: internal.scroll,
    role: internal.role,
    following: internal.following,
    locks: (internal.locks || []).map(deserializeLock),
    streams: (internal.streams || []).map(deserializeStream),
    outputs: internal.outputs,  // Already primitive types, no conversion needed
  };
}

function fromAwarenessState(state: Partial<AwarenessState>): Partial<YjsAwarenessStateInternal> {
  const result: Partial<YjsAwarenessStateInternal> = {};

  if (state.user !== undefined) result.user = state.user;
  if (state.cursor !== undefined) result.cursor = state.cursor;
  if (state.selection !== undefined) result.selection = state.selection;
  if (state.scroll !== undefined) result.scroll = state.scroll;
  if (state.role !== undefined) result.role = state.role;
  if (state.following !== undefined) result.following = state.following;
  if (state.locks !== undefined) result.locks = state.locks.map(serializeLock);
  if (state.streams !== undefined) result.streams = state.streams.map(serializeStream);
  if (state.outputs !== undefined) result.outputs = state.outputs;  // Already primitive types

  return result;
}

// ============================================
// Yjs Awareness Adapter
// ============================================

export class YjsAwarenessAdapter implements AwarenessProvider {
  private awareness: Awareness;
  private localUserId: string;
  private localClientId: number;
  private handlers = new Map<'change', Set<() => void>>();
  private destroyed = false;
  private onDebug?: (event: string, data: any) => void;

  // Throttle state updates to reduce network overhead
  private pendingUpdate: Partial<AwarenessState> | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly UPDATE_THROTTLE_MS = 30;

  constructor(config: YjsAwarenessConfig) {
    this.awareness = config.awareness;
    this.localUserId = config.userId;
    this.localClientId = config.awareness.clientID;
    this.onDebug = config.onDebug;

    this.debug('init', {
      clientId: this.localClientId,
      userId: config.userId,
    });

    // Initialize local state
    const initialState: YjsAwarenessStateInternal = {
      user: {
        id: config.userId,
        name: config.userName,
        color: config.userColor,
      },
      role: config.role || 'collaborator',
      locks: [],
      streams: [],
    };

    this.awareness.setLocalState(initialState);

    // Subscribe to Yjs awareness changes
    this.awareness.on('change', this.handleAwarenessChange);
  }

  private debug(event: string, data?: any): void {
    this.onDebug?.(event, data);
  }

  /**
   * Handle Yjs awareness change events
   */
  private handleAwarenessChange = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: string | null
  ): void => {
    if (this.destroyed) return;

    this.debug('awareness-change', {
      added: changes.added,
      updated: changes.updated,
      removed: changes.removed,
      origin,
    });

    // Notify all handlers
    const handlers = this.handlers.get('change');
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler();
        } catch (err) {
          console.error('[YjsAwareness] Handler error:', err);
        }
      }
    }
  };

  // ============================================
  // AwarenessProvider Interface
  // ============================================

  getLocalState(): AwarenessState | null {
    const raw = this.awareness.getLocalState() as YjsAwarenessStateInternal | null;
    if (!raw) return null;
    return toAwarenessState(raw);
  }

  setLocalState(state: Partial<AwarenessState>): void {
    if (this.destroyed) return;

    const current = this.awareness.getLocalState() as YjsAwarenessStateInternal | null;
    const update = fromAwarenessState(state);
    const merged = { ...current, ...update };

    this.debug('set-state', { keys: Object.keys(state) });
    this.awareness.setLocalState(merged);
  }

  setLocalStateField<K extends keyof AwarenessState>(
    key: K,
    value: AwarenessState[K]
  ): void {
    if (this.destroyed) return;

    // Throttle frequent updates (like cursor movements)
    if (key === 'cursor' || key === 'selection' || key === 'scroll') {
      this.throttledUpdate({ [key]: value } as Partial<AwarenessState>);
      return;
    }

    // For other fields, update immediately
    const partial = { [key]: value } as Partial<AwarenessState>;
    this.setLocalState(partial);
  }

  /**
   * Throttled update for high-frequency changes
   */
  private throttledUpdate(update: Partial<AwarenessState>): void {
    this.pendingUpdate = { ...this.pendingUpdate, ...update };

    if (this.updateTimer) return;

    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      if (this.pendingUpdate) {
        this.setLocalState(this.pendingUpdate);
        this.pendingUpdate = null;
      }
    }, this.UPDATE_THROTTLE_MS);
  }

  getStates(): Map<string, AwarenessState> {
    const yjsStates = this.awareness.getStates();
    const result = new Map<string, AwarenessState>();

    for (const [clientId, rawState] of yjsStates) {
      // Skip null/invalid states
      if (!rawState || typeof rawState !== 'object') continue;

      const state = rawState as YjsAwarenessStateInternal;

      // Must have valid user info
      if (!state.user || !state.user.id) continue;

      try {
        const awarenessState = toAwarenessState(state);

        // Key by userId for consistent interface
        // If same user has multiple tabs, we use a compound key
        // to preserve all their states
        const key = clientId === this.localClientId
          ? state.user.id  // Local user uses just userId
          : `${state.user.id}:${clientId}`;  // Remote users include clientId for uniqueness

        result.set(key, awarenessState);
      } catch (err) {
        console.warn('[YjsAwareness] Failed to parse state for client', clientId, err);
      }
    }

    return result;
  }

  /**
   * Get states grouped by userId (for UI that wants to show per-user, not per-tab)
   */
  getStatesByUser(): Map<string, AwarenessState[]> {
    const yjsStates = this.awareness.getStates();
    const byUser = new Map<string, AwarenessState[]>();

    for (const [clientId, rawState] of yjsStates) {
      if (!rawState || typeof rawState !== 'object') continue;

      const state = rawState as YjsAwarenessStateInternal;
      if (!state.user || !state.user.id) continue;

      try {
        const awarenessState = toAwarenessState(state);
        const userId = state.user.id;

        let userStates = byUser.get(userId);
        if (!userStates) {
          userStates = [];
          byUser.set(userId, userStates);
        }
        userStates.push(awarenessState);
      } catch (err) {
        // Skip malformed states
      }
    }

    return byUser;
  }

  /**
   * Check if a given userId is the local user
   */
  isLocalUser(userId: string): boolean {
    return userId === this.localUserId || userId.startsWith(`${this.localUserId}:`);
  }

  /**
   * Get all remote users (excluding local)
   */
  getRemoteStates(): Map<string, AwarenessState> {
    const all = this.getStates();
    const remote = new Map<string, AwarenessState>();

    for (const [key, state] of all) {
      if (!this.isLocalUser(state.user.id)) {
        remote.set(key, state);
      }
    }

    return remote;
  }

  /**
   * Get the local clientId (useful for debugging)
   */
  getLocalClientId(): number {
    return this.localClientId;
  }

  /**
   * Get count of connected users
   */
  getUserCount(): number {
    const byUser = this.getStatesByUser();
    return byUser.size;
  }

  /**
   * Get list of connected user IDs
   */
  getConnectedUserIds(): string[] {
    const byUser = this.getStatesByUser();
    return Array.from(byUser.keys());
  }

  on(event: 'change', handler: () => void): void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);
  }

  off(event: 'change', handler: () => void): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.debug('destroy', { clientId: this.localClientId });

    // Clear pending updates
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    // Unsubscribe from Yjs
    this.awareness.off('change', this.handleAwarenessChange);

    // Clear local state (notifies others we're gone)
    this.awareness.setLocalState(null);

    // Clear handlers
    this.handlers.clear();
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a Yjs awareness adapter
 *
 * @example
 * ```typescript
 * import { WebsocketProvider } from 'y-websocket';
 * import * as Y from 'yjs';
 *
 * const ydoc = new Y.Doc();
 * const provider = new WebsocketProvider('wss://...', 'room-name', ydoc);
 *
 * const awarenessAdapter = createYjsAwarenessAdapter({
 *   awareness: provider.awareness,
 *   userId: 'user-123',
 *   userName: 'Alice',
 *   userColor: '#3b82f6',
 * });
 *
 * // Use with AwarenessSyncManager
 * const syncManager = createAwarenessSync({
 *   view: editorView,
 *   lockManager,
 *   provider: awarenessAdapter,
 *   userId: 'user-123',
 *   userName: 'Alice',
 *   userColor: '#3b82f6',
 * });
 * ```
 */
export function createYjsAwarenessAdapter(config: YjsAwarenessConfig): YjsAwarenessAdapter {
  return new YjsAwarenessAdapter(config);
}

// ============================================
// Integration Helper
// ============================================

/**
 * Higher-level helper that creates awareness adapter + sync manager together
 */
export interface CreateCollabAwarenessConfig {
  awareness: Awareness;
  view: import('@codemirror/view').EditorView;
  lockManager: import('./locks/lock-manager').LockManager;
  userId: string;
  userName: string;
  userColor: string;
  role?: 'presenter' | 'viewer' | 'collaborator';
  onDebug?: (event: string, data: any) => void;
}

export interface CollabAwareness {
  adapter: YjsAwarenessAdapter;
  syncManager: import('./streaming/awareness-sync').AwarenessSyncManager;
  destroy: () => void;
}

export async function createCollabAwareness(
  config: CreateCollabAwarenessConfig
): Promise<CollabAwareness> {
  // Dynamic import to avoid circular dependencies
  const { createAwarenessSync } = await import('./streaming/awareness-sync');

  const adapter = createYjsAwarenessAdapter({
    awareness: config.awareness,
    userId: config.userId,
    userName: config.userName,
    userColor: config.userColor,
    role: config.role,
    onDebug: config.onDebug,
  });

  const syncManager = createAwarenessSync({
    view: config.view,
    lockManager: config.lockManager,
    provider: adapter,
    userId: config.userId,
    userName: config.userName,
    userColor: config.userColor,
    role: config.role,
  });

  return {
    adapter,
    syncManager,
    destroy: () => {
      syncManager.destroy();
      adapter.destroy();
    },
  };
}

/**
 * Awareness Sync for Locks and Streams
 *
 * Broadcasts local lock and stream state to other users via awareness,
 * and applies remote state to the local editor.
 *
 * This enables:
 * - Seeing other users' cursor positions and lock states
 * - Seeing other users' streaming content in real-time
 * - Coordinated editing without conflicts
 */

import { EditorView } from '@codemirror/view';
import { Lock } from '../locks/types';
import { LockManager } from '../locks/lock-manager';
import { updateLocks } from '../locks/lock-extension';
import { StreamingOverlay, applyRemoteStreams, getStreams } from './overlay';

// ============================================
// Types
// ============================================

/**
 * Output block state for awareness sync
 */
export interface AwarenessOutputBlock {
  /** Block ID (matches code block index or unique ID) */
  blockId: string;
  /** Output content (text, may contain ANSI) */
  content: string;
  /** Execution status */
  status: 'running' | 'streaming' | 'completed' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** Last update timestamp */
  lastUpdate: number;
}

export interface AwarenessState {
  // User identity
  user: {
    id: string;
    name: string;
    color: string;
    /** User type: 'human' for regular users, 'ai' for Claude Code or AI assistants */
    type?: 'human' | 'ai';
  };

  // Cursor position (undefined = not set)
  cursor?: {
    from: number;
    to: number;
  };

  // Selection (undefined = no selection, same as cursor)
  selection?: {
    from: number;
    to: number;
  };

  // Scroll position (for follow mode)
  scroll?: {
    top: number;
    height: number;
  };

  // Role in collaboration
  role: 'presenter' | 'viewer' | 'collaborator';

  // Who this user is following (undefined = not following anyone)
  following?: string;

  // Active locks held by this user
  locks: Lock[];

  // Active streams from this user
  streams: StreamingOverlay[];

  // Execution outputs from this user (synced so others can see)
  outputs?: AwarenessOutputBlock[];
}

/**
 * Value that can be used to clear an optional field
 */
export type ClearableField<T> = T | null;

/**
 * Partial awareness state that supports clearing optional fields with null
 */
export type AwarenessStateUpdate = {
  [K in keyof AwarenessState]?: AwarenessState[K] extends undefined
    ? AwarenessState[K] | null
    : AwarenessState[K];
};

export interface AwarenessProvider {
  // Get local state
  getLocalState(): AwarenessState | null;

  // Set local state
  setLocalState(state: Partial<AwarenessState>): void;

  // Set a specific field
  setLocalStateField<K extends keyof AwarenessState>(
    key: K,
    value: AwarenessState[K]
  ): void;

  // Get all remote states
  getStates(): Map<string, AwarenessState>;

  // Subscribe to changes
  on(event: 'change', handler: () => void): void;
  off(event: 'change', handler: () => void): void;

  // Destroy
  destroy(): void;
}

// ============================================
// Awareness Sync Manager
// ============================================

export interface AwarenessSyncConfig {
  view: EditorView;
  lockManager: LockManager;
  provider: AwarenessProvider;
  userId: string;
  userName: string;
  userColor: string;
  /** User type: 'human' for regular users, 'ai' for Claude Code or AI assistants */
  userType?: 'human' | 'ai';
  role?: 'presenter' | 'viewer' | 'collaborator';
}

export class AwarenessSyncManager {
  private view: EditorView;
  private lockManager: LockManager;
  private provider: AwarenessProvider;
  private userId: string;
  private destroyed = false;

  private broadcastThrottle: ReturnType<typeof setTimeout> | null = null;
  private readonly BROADCAST_INTERVAL = 50; // ms

  constructor(config: AwarenessSyncConfig) {
    this.view = config.view;
    this.lockManager = config.lockManager;
    this.provider = config.provider;
    this.userId = config.userId;

    // Initialize local state
    this.provider.setLocalState({
      user: {
        id: config.userId,
        name: config.userName,
        color: config.userColor,
        type: config.userType || 'human',
      },
      role: config.role || 'collaborator',
      locks: [],
      streams: [],
    });

    // Subscribe to remote changes
    this.provider.on('change', this.handleRemoteChange);

    // Subscribe to lock manager changes
    this.lockManager.config.onStateChange = (locks) => {
      this.broadcastLocalState();
    };
  }

  /**
   * Broadcast local cursor position
   */
  broadcastCursor(from: number, to: number): void {
    this.provider.setLocalStateField('cursor', { from, to });
    if (from !== to) {
      this.provider.setLocalStateField('selection', { from, to });
    } else {
      // Clear selection by setting to null (converted to undefined in storage)
      this.clearField('selection');
    }
  }

  /**
   * Clear an optional field from awareness state
   */
  private clearField(field: 'cursor' | 'selection' | 'scroll' | 'following'): void {
    const current = this.provider.getLocalState();
    if (current && current[field] !== undefined) {
      // Create partial update that explicitly removes the field
      const update: Partial<AwarenessState> = { ...current };
      delete update[field];
      // Re-set the entire state without the field
      this.provider.setLocalState(update);
    }
  }

  /**
   * Broadcast scroll position
   */
  broadcastScroll(top: number, height: number): void {
    this.provider.setLocalStateField('scroll', { top, height });
  }

  /**
   * Set role (presenter/viewer/collaborator)
   */
  setRole(role: 'presenter' | 'viewer' | 'collaborator'): void {
    this.provider.setLocalStateField('role', role);
  }

  /**
   * Follow another user (for viewer mode)
   */
  follow(userId: string | null): void {
    if (userId) {
      this.provider.setLocalStateField('following', userId);
    } else {
      this.clearField('following');
    }
  }

  /**
   * Get remote user states
   */
  getRemoteUsers(): Map<string, AwarenessState> {
    const states = this.provider.getStates();
    const remote = new Map<string, AwarenessState>();
    for (const [id, state] of states) {
      if (id !== this.userId) {
        remote.set(id, state);
      }
    }
    return remote;
  }

  /**
   * Get the user being followed (if in viewer mode)
   */
  getFollowedUser(): AwarenessState | null {
    const local = this.provider.getLocalState();
    if (!local?.following) return null;
    return this.provider.getStates().get(local.following) || null;
  }

  // ============================================
  // Output Sync (execution results visible to all users)
  // ============================================

  /**
   * Broadcast output state for a code block.
   * Call this when execution starts, streams, or completes.
   */
  broadcastOutput(output: AwarenessOutputBlock): void {
    const local = this.provider.getLocalState();
    if (!local) return;

    const currentOutputs = local.outputs || [];
    const existingIndex = currentOutputs.findIndex(o => o.blockId === output.blockId);

    let newOutputs: AwarenessOutputBlock[];
    if (existingIndex >= 0) {
      // Update existing
      newOutputs = [...currentOutputs];
      newOutputs[existingIndex] = output;
    } else {
      // Add new
      newOutputs = [...currentOutputs, output];
    }

    this.provider.setLocalStateField('outputs', newOutputs);
  }

  /**
   * Clear output for a block
   */
  clearOutput(blockId: string): void {
    const local = this.provider.getLocalState();
    if (!local) return;

    const currentOutputs = local.outputs || [];
    const newOutputs = currentOutputs.filter(o => o.blockId !== blockId);
    this.provider.setLocalStateField('outputs', newOutputs);
  }

  /**
   * Clear all outputs
   */
  clearAllOutputs(): void {
    this.provider.setLocalStateField('outputs', []);
  }

  /**
   * Get all remote outputs (from other users)
   */
  getRemoteOutputs(): Map<string, AwarenessOutputBlock[]> {
    const states = this.provider.getStates();
    const result = new Map<string, AwarenessOutputBlock[]>();

    for (const [id, state] of states) {
      if (id === this.userId) continue;
      if (state.outputs && state.outputs.length > 0) {
        result.set(id, state.outputs);
      }
    }

    return result;
  }

  /**
   * Subscribe to remote output changes
   */
  private outputChangeHandlers = new Set<(outputs: Map<string, AwarenessOutputBlock[]>) => void>();

  onOutputChange(handler: (outputs: Map<string, AwarenessOutputBlock[]>) => void): () => void {
    this.outputChangeHandlers.add(handler);
    return () => this.outputChangeHandlers.delete(handler);
  }

  private notifyOutputChange(): void {
    const remoteOutputs = this.getRemoteOutputs();
    for (const handler of this.outputChangeHandlers) {
      try {
        handler(remoteOutputs);
      } catch (err) {
        console.error('[AwarenessSync] Output change handler error:', err);
      }
    }
  }

  /**
   * Destroy the sync manager
   */
  destroy(): void {
    this.destroyed = true;
    this.provider.off('change', this.handleRemoteChange);
    this.outputChangeHandlers.clear();
    if (this.broadcastThrottle) {
      clearTimeout(this.broadcastThrottle);
    }
  }

  // ============================================
  // Private Methods
  // ============================================

  private broadcastLocalState = (): void => {
    if (this.destroyed) return;

    // Throttle broadcasts
    if (this.broadcastThrottle) return;
    this.broadcastThrottle = setTimeout(() => {
      this.broadcastThrottle = null;
      this.doBroadcast();
    }, this.BROADCAST_INTERVAL);
  };

  private doBroadcast(): void {
    if (this.destroyed) return;

    // Get local locks
    const locks = this.lockManager.getLocalLocks();

    // Get local streams
    const streams = Array.from(getStreams(this.view.state).values())
      .filter(s => s.owner.userId === this.userId);

    // Broadcast
    this.provider.setLocalStateField('locks', locks);
    this.provider.setLocalStateField('streams', streams);
  }

  private handleRemoteChange = (): void => {
    if (this.destroyed) return;

    const states = this.provider.getStates();

    // Collect all remote locks
    const remoteLocks: Lock[] = [];
    for (const [id, state] of states) {
      if (id === this.userId) continue;
      if (state.locks) {
        remoteLocks.push(...state.locks);
      }
    }

    // Apply remote locks to lock manager
    this.lockManager.applyRemoteLocks(remoteLocks);

    // Collect all remote streams
    const remoteStreams: StreamingOverlay[] = [];
    for (const [id, state] of states) {
      if (id === this.userId) continue;
      if (state.streams) {
        remoteStreams.push(...state.streams);
      }
    }

    // Defer view updates to avoid "update during update" errors
    // This happens when awareness changes trigger during EditorView construction
    requestAnimationFrame(() => {
      if (this.destroyed) return;

      // Update editor state with all locks
      updateLocks(this.view, this.lockManager.getLocks());

      // Apply remote streams to editor
      applyRemoteStreams(this.view, remoteStreams);

      // Handle follow mode
      this.handleFollowMode();

      // Notify output change handlers
      this.notifyOutputChange();
    });
  };

  private handleFollowMode(): void {
    const local = this.provider.getLocalState();
    if (local?.role !== 'viewer' || !local.following) return;

    const followed = this.provider.getStates().get(local.following);
    if (!followed) return;

    // Sync scroll position
    if (followed.scroll) {
      // Only scroll if significantly different to avoid jitter
      const currentScroll = this.view.scrollDOM.scrollTop;
      if (Math.abs(currentScroll - followed.scroll.top) > 50) {
        this.view.scrollDOM.scrollTop = followed.scroll.top;
      }
    }
  }
}

/**
 * Create an awareness sync manager
 */
export function createAwarenessSync(config: AwarenessSyncConfig): AwarenessSyncManager {
  return new AwarenessSyncManager(config);
}

// ============================================
// Mock Awareness Provider (for testing)
// ============================================

export class MockAwarenessProvider implements AwarenessProvider {
  private localState: AwarenessState | null = null;
  private remoteStates = new Map<string, AwarenessState>();
  private handlers = new Set<() => void>();

  getLocalState(): AwarenessState | null {
    return this.localState;
  }

  setLocalState(state: Partial<AwarenessState>): void {
    this.localState = { ...this.localState, ...state } as AwarenessState;
    this.notify();
  }

  setLocalStateField<K extends keyof AwarenessState>(
    key: K,
    value: AwarenessState[K]
  ): void {
    if (!this.localState) return;
    this.localState = { ...this.localState, [key]: value };
    this.notify();
  }

  getStates(): Map<string, AwarenessState> {
    const all = new Map(this.remoteStates);
    if (this.localState) {
      all.set(this.localState.user.id, this.localState);
    }
    return all;
  }

  on(event: 'change', handler: () => void): void {
    this.handlers.add(handler);
  }

  off(event: 'change', handler: () => void): void {
    this.handlers.delete(handler);
  }

  destroy(): void {
    this.handlers.clear();
  }

  // Test helpers
  addRemoteUser(state: AwarenessState): void {
    this.remoteStates.set(state.user.id, state);
    this.notify();
  }

  removeRemoteUser(userId: string): void {
    this.remoteStates.delete(userId);
    this.notify();
  }

  private notify(): void {
    for (const handler of this.handlers) {
      handler();
    }
  }
}

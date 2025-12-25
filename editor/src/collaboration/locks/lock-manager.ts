/**
 * Lock Manager
 *
 * Manages lock state, transitions, and timeouts.
 * Emits events for UI updates and awareness sync.
 */

import {
  Lock,
  LockStore,
  LockOwner,
  LockOwnerType,
  LockState,
  LockTransition,
  LockEvent,
  LockRequest,
  LockResult,
  LockTimeoutConfig,
  DEFAULT_TIMEOUT_CONFIG,
  createLockStore,
  shouldTimeout,
  getTimeoutRemaining,
} from './types';

export interface LockManagerConfig {
  userId: string;
  userName: string;
  userColor: string;
  timeouts?: Partial<LockTimeoutConfig>;
  onEvent?: (event: LockEvent) => void;
  onStateChange?: (locks: Map<string, Lock>) => void;
}

export class LockManager {
  private store: LockStore;
  readonly config: LockManagerConfig;
  private timeoutConfig: LockTimeoutConfig;
  private timeoutCheckInterval: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(config: LockManagerConfig) {
    this.config = config;
    this.store = createLockStore();
    this.timeoutConfig = {
      ...DEFAULT_TIMEOUT_CONFIG,
      ...config.timeouts,
    };

    // Start timeout checker
    this.startTimeoutChecker();
  }

  /**
   * Get current user info
   */
  get currentUser(): { userId: string; userName: string; userColor: string } {
    return {
      userId: this.config.userId,
      userName: this.config.userName,
      userColor: this.config.userColor,
    };
  }

  /**
   * Get all current locks
   */
  getLocks(): Map<string, Lock> {
    return new Map(this.store.locks);
  }

  /**
   * Get lock for a specific block
   */
  getLock(blockId: string): Lock | null {
    return this.store.locks.get(blockId) || null;
  }

  /**
   * Get all locks held by a user
   */
  getUserLocks(userId: string): Lock[] {
    const blockIds = this.store.byUser.get(userId);
    if (!blockIds) return [];
    return Array.from(blockIds)
      .map(id => this.store.locks.get(id))
      .filter((l): l is Lock => l !== undefined);
  }

  /**
   * Check if current user can edit a block
   */
  canEdit(blockId: string): boolean {
    const lock = this.store.locks.get(blockId);
    if (!lock) return true; // Unlocked
    if (lock.owner.userId === this.config.userId) return true; // Own lock
    if (lock.state === 'soft') return true; // Soft lock allows editing (with warning)
    return false; // Hard locked by someone else
  }

  /**
   * Check if a block is locked by someone else (hard lock)
   */
  isLockedByOther(blockId: string): boolean {
    const lock = this.store.locks.get(blockId);
    if (!lock) return false;
    return lock.state === 'hard' && lock.owner.userId !== this.config.userId;
  }

  /**
   * Process a lock transition
   */
  transition(t: LockTransition): void {
    switch (t.type) {
      case 'CURSOR_ENTER':
        this.handleCursorEnter(t.userId, t.blockId, t.anchorPos);
        break;
      case 'CURSOR_LEAVE':
        this.handleCursorLeave(t.userId, t.blockId);
        break;
      case 'KEYSTROKE':
        this.handleKeystroke(t.userId, t.blockId, t.anchorPos);
        break;
      case 'AI_START':
        this.handleOperationStart(t.userId, t.blockId, 'ai', t.operation);
        break;
      case 'AI_CHUNK':
        this.handleActivityPing(t.blockId);
        break;
      case 'AI_COMPLETE':
      case 'AI_CANCEL':
        this.handleOperationEnd(t.blockId);
        break;
      case 'EXEC_START':
        this.handleOperationStart(t.userId, t.blockId, 'execution', t.operation);
        break;
      case 'EXEC_CHUNK':
        this.handleActivityPing(t.blockId);
        break;
      case 'EXEC_COMPLETE':
      case 'EXEC_CANCEL':
        this.handleOperationEnd(t.blockId);
        break;
      case 'TIMEOUT':
        this.handleTimeout(t.blockId);
        break;
      case 'DISCONNECT':
        this.handleDisconnect(t.userId);
        break;
      case 'FORCE_RELEASE':
        this.releaseLock(t.blockId);
        break;
    }
  }

  /**
   * Acquire a lock (explicit request)
   */
  acquireLock(request: LockRequest): LockResult {
    const existing = this.store.locks.get(request.blockId);

    // If locked by someone else (hard), deny unless force
    if (existing && existing.owner.userId !== request.userId) {
      if (existing.state === 'hard' && !request.force) {
        this.emit({
          type: 'lock-denied',
          blockId: request.blockId,
          requestor: request.userId,
          holder: existing.owner,
        });
        return {
          success: false,
          reason: 'already-locked',
          currentHolder: existing.owner,
        };
      }
      // Soft lock or force: take over
      this.releaseLock(request.blockId);
    }

    // Create new lock
    const now = Date.now();
    const lock: Lock = {
      id: `lock-${request.blockId}-${now}`,
      blockId: request.blockId,
      state: request.type === 'human' ? 'soft' : 'hard',
      owner: {
        userId: request.userId,
        userName: request.userName,
        userColor: request.userColor,
        type: request.type,
        operation: request.operation,
      },
      acquiredAt: now,
      lastActivityAt: now,
      hardLockedAt: request.type !== 'human' ? now : undefined,
      anchorPos: request.anchorPos ?? 0,
    };

    this.store.locks.set(request.blockId, lock);
    this.addToUserLocks(request.userId, request.blockId);

    this.emit({ type: 'lock-acquired', lock });
    this.notifyStateChange();

    return { success: true, lock };
  }

  /**
   * Release a lock
   */
  releaseLock(blockId: string): void {
    const lock = this.store.locks.get(blockId);
    if (!lock) return;

    this.store.locks.delete(blockId);
    this.removeFromUserLocks(lock.owner.userId, blockId);

    this.emit({
      type: 'lock-released',
      blockId,
      previousOwner: lock.owner,
    });
    this.notifyStateChange();
  }

  /**
   * Release all locks held by a user
   */
  releaseUserLocks(userId: string): void {
    const blockIds = this.store.byUser.get(userId);
    if (!blockIds) return;

    for (const blockId of Array.from(blockIds)) {
      this.releaseLock(blockId);
    }
  }

  /**
   * Apply remote lock state (from awareness sync)
   */
  applyRemoteLocks(remoteLocks: Lock[]): void {
    // Remove locks not in remote state (except our own)
    for (const [blockId, lock] of this.store.locks) {
      if (lock.owner.userId === this.config.userId) continue;
      if (!remoteLocks.find(rl => rl.blockId === blockId)) {
        this.store.locks.delete(blockId);
        this.removeFromUserLocks(lock.owner.userId, blockId);
      }
    }

    // Add/update remote locks
    for (const remoteLock of remoteLocks) {
      if (remoteLock.owner.userId === this.config.userId) continue;
      this.store.locks.set(remoteLock.blockId, remoteLock);
      this.addToUserLocks(remoteLock.owner.userId, remoteLock.blockId);
    }

    this.notifyStateChange();
  }

  /**
   * Get locks to broadcast to others
   */
  getLocalLocks(): Lock[] {
    return this.getUserLocks(this.config.userId);
  }

  /**
   * Destroy the manager
   */
  destroy(): void {
    this.destroyed = true;
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
    }
    this.releaseUserLocks(this.config.userId);
  }

  // ============================================
  // Private: Transition Handlers
  // ============================================

  private handleCursorEnter(userId: string, blockId: string, anchorPos: number): void {
    if (userId !== this.config.userId) return; // Only handle local cursor

    const existing = this.store.locks.get(blockId);
    if (existing) {
      if (existing.owner.userId === userId) {
        // Already own it, update activity
        existing.lastActivityAt = Date.now();
        this.notifyStateChange();
      }
      // Someone else has it - don't acquire
      return;
    }

    // Acquire soft lock
    this.acquireLock({
      blockId,
      userId,
      userName: this.config.userName,
      userColor: this.config.userColor,
      type: 'human',
      anchorPos,
    });
  }

  private handleCursorLeave(userId: string, blockId: string): void {
    if (userId !== this.config.userId) return;

    const lock = this.store.locks.get(blockId);
    if (!lock || lock.owner.userId !== userId) return;

    // Only release if configured to release on cursor leave
    if (lock.owner.type === 'human' && this.timeoutConfig.human.releaseOnCursorLeave) {
      this.releaseLock(blockId);
    }
  }

  private handleKeystroke(userId: string, blockId: string, anchorPos?: number): void {
    if (userId !== this.config.userId) return;

    const existing = this.store.locks.get(blockId);

    if (!existing) {
      // No lock, acquire and upgrade to hard immediately
      const result = this.acquireLock({
        blockId,
        userId,
        userName: this.config.userName,
        userColor: this.config.userColor,
        type: 'human',
        anchorPos,
      });
      if (result.success && result.lock) {
        this.upgradeLock(result.lock);
      }
      return;
    }

    if (existing.owner.userId !== userId) {
      // Someone else has it - emit denied event
      if (existing.state === 'hard') {
        this.emit({
          type: 'lock-denied',
          blockId,
          requestor: userId,
          holder: existing.owner,
        });
      }
      return;
    }

    // We own it - upgrade if soft, update activity
    if (existing.state === 'soft') {
      this.upgradeLock(existing);
    }
    existing.lastActivityAt = Date.now();
    this.notifyStateChange();
  }

  private handleOperationStart(
    userId: string,
    blockId: string,
    type: 'ai' | 'execution',
    operation: string
  ): void {
    // Release any existing lock on this block
    const existing = this.store.locks.get(blockId);
    if (existing && existing.owner.userId !== userId) {
      if (existing.state === 'hard') {
        this.emit({
          type: 'lock-denied',
          blockId,
          requestor: userId,
          holder: existing.owner,
        });
        return;
      }
      this.releaseLock(blockId);
    }

    // Acquire hard lock for operation
    this.acquireLock({
      blockId,
      userId,
      userName: this.config.userName,
      userColor: this.config.userColor,
      type,
      operation,
    });
  }

  private handleActivityPing(blockId: string): void {
    const lock = this.store.locks.get(blockId);
    if (!lock) return;

    lock.lastActivityAt = Date.now();
    this.emit({ type: 'lock-activity', lock });
    this.notifyStateChange();
  }

  private handleOperationEnd(blockId: string): void {
    this.releaseLock(blockId);
  }

  private handleTimeout(blockId: string): void {
    this.releaseLock(blockId);
  }

  private handleDisconnect(userId: string): void {
    this.releaseUserLocks(userId);
  }

  // ============================================
  // Private: Lock Operations
  // ============================================

  private upgradeLock(lock: Lock): void {
    const from = lock.state;
    lock.state = 'hard';
    lock.hardLockedAt = Date.now();
    this.emit({ type: 'lock-upgraded', lock, from });
    this.notifyStateChange();
  }

  private addToUserLocks(userId: string, blockId: string): void {
    let set = this.store.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.store.byUser.set(userId, set);
    }
    set.add(blockId);
  }

  private removeFromUserLocks(userId: string, blockId: string): void {
    const set = this.store.byUser.get(userId);
    if (set) {
      set.delete(blockId);
      if (set.size === 0) {
        this.store.byUser.delete(userId);
      }
    }
  }

  // ============================================
  // Private: Timeout Checker
  // ============================================

  private startTimeoutChecker(): void {
    this.timeoutCheckInterval = setInterval(() => {
      if (this.destroyed) return;
      this.checkTimeouts();
    }, 1000); // Check every second
  }

  private checkTimeouts(): void {
    const now = Date.now();

    for (const [blockId, lock] of this.store.locks) {
      // Only check our own locks for timeout
      if (lock.owner.userId !== this.config.userId) continue;

      if (shouldTimeout(lock, this.timeoutConfig, now)) {
        this.transition({ type: 'TIMEOUT', blockId });
      } else {
        // Emit warning if close to timeout
        const remaining = getTimeoutRemaining(lock, this.timeoutConfig, now);
        if (remaining < 5000 && remaining > 0) {
          this.emit({
            type: 'lock-timeout-warning',
            lock,
            remainingMs: remaining,
          });
        }
      }
    }
  }

  // ============================================
  // Private: Event Emission
  // ============================================

  private emit(event: LockEvent): void {
    this.config.onEvent?.(event);
  }

  private notifyStateChange(): void {
    this.config.onStateChange?.(this.getLocks());
  }
}

/**
 * Create a lock manager instance
 */
export function createLockManager(config: LockManagerConfig): LockManager {
  return new LockManager(config);
}

/**
 * Lock Types and State Machine
 *
 * Defines the lock states, transitions, and timeout configurations.
 */

export type LockState = 'unlocked' | 'soft' | 'hard';

export type LockOwnerType = 'human' | 'ai' | 'execution';

export interface LockOwner {
  userId: string;
  userName: string;
  userColor: string;
  type: LockOwnerType;
  operation?: string; // "AI: refactoring" or "Running: python"
}

export interface Lock {
  id: string;
  blockId: string;
  state: LockState;
  owner: LockOwner;
  acquiredAt: number;
  lastActivityAt: number; // For timeout calculation
  hardLockedAt?: number;  // When it became hard lock
  /** Character position anchor for mapping through edits */
  anchorPos: number;
}

export interface LockTimeoutConfig {
  human: {
    softToUnlock: number;     // Time in soft lock before releasing (cursor idle)
    hardToUnlock: number;     // Time in hard lock with no activity
    releaseOnCursorLeave: boolean;
  };
  ai: {
    hardTimeout: number;      // Max time for AI operation
    inactivityTimeout: number; // Time since last stream chunk
  };
  execution: {
    hardTimeout: number;      // Max time for code execution
    inactivityTimeout: number; // Time since last output chunk
  };
}

export const DEFAULT_TIMEOUT_CONFIG: LockTimeoutConfig = {
  human: {
    softToUnlock: 10_000,      // 10s in soft lock → release
    hardToUnlock: 10_000,      // 10s no typing → release
    releaseOnCursorLeave: true,
  },
  ai: {
    hardTimeout: 300_000,      // 5 min absolute max
    inactivityTimeout: 30_000, // 30s since last stream chunk
  },
  execution: {
    hardTimeout: 600_000,      // 10 min absolute max
    inactivityTimeout: 60_000, // 60s since last output chunk
  },
};

/**
 * Lock state transitions
 */
export type LockTransition =
  | { type: 'CURSOR_ENTER'; userId: string; blockId: string; anchorPos: number }
  | { type: 'CURSOR_LEAVE'; userId: string; blockId: string }
  | { type: 'KEYSTROKE'; userId: string; blockId: string; anchorPos?: number }
  | { type: 'AI_START'; userId: string; blockId: string; operation: string }
  | { type: 'AI_CHUNK'; userId: string; blockId: string }
  | { type: 'AI_COMPLETE'; userId: string; blockId: string }
  | { type: 'AI_CANCEL'; userId: string; blockId: string }
  | { type: 'EXEC_START'; userId: string; blockId: string; operation: string }
  | { type: 'EXEC_CHUNK'; userId: string; blockId: string }
  | { type: 'EXEC_COMPLETE'; userId: string; blockId: string }
  | { type: 'EXEC_CANCEL'; userId: string; blockId: string }
  | { type: 'TIMEOUT'; blockId: string }
  | { type: 'DISCONNECT'; userId: string }
  | { type: 'FORCE_RELEASE'; blockId: string }; // Admin/escape hatch

/**
 * Events emitted by the lock manager
 */
export type LockEvent =
  | { type: 'lock-acquired'; lock: Lock }
  | { type: 'lock-upgraded'; lock: Lock; from: LockState }
  | { type: 'lock-released'; blockId: string; previousOwner: LockOwner }
  | { type: 'lock-denied'; blockId: string; requestor: string; holder: LockOwner }
  | { type: 'lock-timeout-warning'; lock: Lock; remainingMs: number }
  | { type: 'lock-activity'; lock: Lock }; // Activity ping (for streaming)

/**
 * Request to acquire a lock
 */
export interface LockRequest {
  blockId: string;
  userId: string;
  userName: string;
  userColor: string;
  type: LockOwnerType;
  operation?: string;
  force?: boolean; // Override existing lock (escape hatch)
  /** Character position for the block (for position mapping) */
  anchorPos?: number;
}

/**
 * Result of a lock acquisition attempt
 */
export interface LockResult {
  success: boolean;
  lock?: Lock;
  reason?: 'already-locked' | 'block-not-found';
  currentHolder?: LockOwner;
}

/**
 * State for tracking all locks
 */
export interface LockStore {
  locks: Map<string, Lock>; // blockId → Lock
  byUser: Map<string, Set<string>>; // userId → Set<blockId>
}

/**
 * Create empty lock store
 */
export function createLockStore(): LockStore {
  return {
    locks: new Map(),
    byUser: new Map(),
  };
}

/**
 * Check if a lock should timeout based on config
 */
export function shouldTimeout(
  lock: Lock,
  config: LockTimeoutConfig,
  now: number = Date.now()
): boolean {
  const elapsed = now - lock.lastActivityAt;
  const totalElapsed = now - lock.acquiredAt;

  switch (lock.owner.type) {
    case 'human':
      if (lock.state === 'soft') {
        return elapsed >= config.human.softToUnlock;
      } else {
        return elapsed >= config.human.hardToUnlock;
      }

    case 'ai':
      // Timeout if: no activity for inactivityTimeout OR total time > hardTimeout
      return elapsed >= config.ai.inactivityTimeout ||
             totalElapsed >= config.ai.hardTimeout;

    case 'execution':
      return elapsed >= config.execution.inactivityTimeout ||
             totalElapsed >= config.execution.hardTimeout;

    default:
      return false;
  }
}

/**
 * Get remaining time before timeout
 */
export function getTimeoutRemaining(
  lock: Lock,
  config: LockTimeoutConfig,
  now: number = Date.now()
): number {
  const elapsed = now - lock.lastActivityAt;
  const totalElapsed = now - lock.acquiredAt;

  switch (lock.owner.type) {
    case 'human':
      if (lock.state === 'soft') {
        return Math.max(0, config.human.softToUnlock - elapsed);
      } else {
        return Math.max(0, config.human.hardToUnlock - elapsed);
      }

    case 'ai': {
      const inactivityRemaining = config.ai.inactivityTimeout - elapsed;
      const hardRemaining = config.ai.hardTimeout - totalElapsed;
      return Math.max(0, Math.min(inactivityRemaining, hardRemaining));
    }

    case 'execution': {
      const inactivityRemaining = config.execution.inactivityTimeout - elapsed;
      const hardRemaining = config.execution.hardTimeout - totalElapsed;
      return Math.max(0, Math.min(inactivityRemaining, hardRemaining));
    }

    default:
      return Infinity;
  }
}

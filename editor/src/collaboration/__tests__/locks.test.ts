/**
 * Lock System Tests
 *
 * Tests for the collaborative locking system including:
 * - Lock acquisition and release
 * - Soft to hard lock upgrade
 * - Timeout behavior
 * - Conflict detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LockManager,
  createLockManager,
  DEFAULT_TIMEOUT_CONFIG,
  shouldTimeout,
  getTimeoutRemaining,
  createLockStore,
} from '../locks';
import type { Lock, LockEvent } from '../locks/types';

describe('LockManager', () => {
  let manager: LockManager;
  let events: LockEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    manager = createLockManager({
      userId: 'alice',
      userName: 'Alice',
      userColor: '#3b82f6',
      timeouts: DEFAULT_TIMEOUT_CONFIG,
      onEvent: (event) => events.push(event),
    });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe('acquireLock', () => {
    it('should acquire a soft lock for human', () => {
      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(result.success).toBe(true);
      expect(result.lock?.state).toBe('soft');
      expect(result.lock?.owner.userId).toBe('alice');
    });

    it('should acquire a hard lock for AI', () => {
      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'ai',
        operation: 'Refactoring',
        anchorPos: 0,
      });

      expect(result.success).toBe(true);
      expect(result.lock?.state).toBe('hard');
      expect(result.lock?.owner.type).toBe('ai');
    });

    it('should deny lock if another user holds hard lock', () => {
      // Simulate Bob having a hard lock (via applyRemoteLocks)
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'hard',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      // Alice tries to acquire
      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('already-locked');
      expect(result.currentHolder?.userId).toBe('bob');
    });

    it('should allow taking over a soft lock', () => {
      // Simulate Bob having a soft lock
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'soft',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      // Alice can take it (soft locks allow takeover)
      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(result.success).toBe(true);
      expect(result.lock?.owner.userId).toBe('alice');
    });

    it('should allow same user to re-acquire their own lock', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(result.success).toBe(true);
    });

    it('should force acquire with force flag', () => {
      // Bob has hard lock
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'hard',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      // Alice force acquires
      const result = manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
        force: true,
      });

      expect(result.success).toBe(true);
      expect(result.lock?.owner.userId).toBe('alice');
    });
  });

  describe('transitions', () => {
    it('should upgrade soft to hard lock on keystroke', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(manager.getLock('paragraph-L1')?.state).toBe('soft');

      manager.transition({
        type: 'KEYSTROKE',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      expect(manager.getLock('paragraph-L1')?.state).toBe('hard');
    });

    it('should release lock on cursor leave', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      manager.transition({
        type: 'CURSOR_LEAVE',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      expect(manager.getLock('paragraph-L1')).toBeNull();
    });

    it('should release all locks on disconnect', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      manager.acquireLock({
        blockId: 'paragraph-L5',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 100,
      });

      manager.transition({
        type: 'DISCONNECT',
        userId: 'alice',
      });

      expect(manager.getLocks().size).toBe(0);
    });
  });

  describe('AI and execution locks', () => {
    it('should create hard lock for AI operations via transition', () => {
      manager.transition({
        type: 'AI_START',
        userId: 'alice',
        blockId: 'paragraph-L1',
        operation: 'Refactoring code',
      });

      const lock = manager.getLock('paragraph-L1');
      expect(lock?.state).toBe('hard');
      expect(lock?.owner.type).toBe('ai');
      expect(lock?.owner.operation).toBe('Refactoring code');
    });

    it('should update activity on AI chunk', () => {
      manager.transition({
        type: 'AI_START',
        userId: 'alice',
        blockId: 'paragraph-L1',
        operation: 'Generating',
      });

      const initialActivity = manager.getLock('paragraph-L1')!.lastActivityAt;

      // Advance time
      vi.advanceTimersByTime(100);
      vi.setSystemTime(Date.now() + 100);

      manager.transition({
        type: 'AI_CHUNK',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      const newActivity = manager.getLock('paragraph-L1')!.lastActivityAt;
      expect(newActivity).toBeGreaterThan(initialActivity);
    });

    it('should release lock on AI complete', () => {
      manager.transition({
        type: 'AI_START',
        userId: 'alice',
        blockId: 'paragraph-L1',
        operation: 'Generating',
      });

      manager.transition({
        type: 'AI_COMPLETE',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      expect(manager.getLock('paragraph-L1')).toBeNull();
    });
  });

  describe('events', () => {
    it('should emit lock-acquired on acquire', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'lock-acquired',
        })
      );
    });

    it('should emit lock-upgraded on soft to hard', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      events.length = 0;

      manager.transition({
        type: 'KEYSTROKE',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'lock-upgraded',
          from: 'soft',
        })
      );
    });

    it('should emit lock-released on release', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      events.length = 0;

      manager.transition({
        type: 'CURSOR_LEAVE',
        userId: 'alice',
        blockId: 'paragraph-L1',
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'lock-released',
          blockId: 'paragraph-L1',
        })
      );
    });

    it('should emit lock-denied when blocked', () => {
      // Bob has hard lock
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'hard',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      events.length = 0;

      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'lock-denied',
          blockId: 'paragraph-L1',
        })
      );
    });
  });

  describe('canEdit', () => {
    it('should allow edit on unlocked block', () => {
      expect(manager.canEdit('paragraph-L1')).toBe(true);
    });

    it('should allow edit on own lock', () => {
      manager.acquireLock({
        blockId: 'paragraph-L1',
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: 0,
      });

      expect(manager.canEdit('paragraph-L1')).toBe(true);
    });

    it('should deny edit on hard lock by other user', () => {
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'hard',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      expect(manager.canEdit('paragraph-L1')).toBe(false);
    });

    it('should allow edit on soft lock by other user (with takeover)', () => {
      const bobLock: Lock = {
        id: 'lock-bob-1',
        blockId: 'paragraph-L1',
        state: 'soft',
        owner: {
          userId: 'bob',
          userName: 'Bob',
          userColor: '#ef4444',
          type: 'human',
        },
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
        anchorPos: 0,
      };
      manager.applyRemoteLocks([bobLock]);

      expect(manager.canEdit('paragraph-L1')).toBe(true);
    });
  });
});

describe('Timeout Functions', () => {
  const config = DEFAULT_TIMEOUT_CONFIG;
  const now = Date.now();

  describe('shouldTimeout', () => {
    it('should timeout human soft lock after softToUnlock', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'paragraph-L1',
        state: 'soft',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'human',
        },
        acquiredAt: now - 15000,
        lastActivityAt: now - 15000, // 15 seconds ago
        anchorPos: 0,
      };

      expect(shouldTimeout(lock, config, now)).toBe(true);
    });

    it('should not timeout active human lock', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'paragraph-L1',
        state: 'hard',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'human',
        },
        acquiredAt: now - 5000,
        lastActivityAt: now - 1000, // 1 second ago
        anchorPos: 0,
      };

      expect(shouldTimeout(lock, config, now)).toBe(false);
    });

    it('should timeout AI lock on inactivity', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'code-L5',
        state: 'hard',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'ai',
          operation: 'Refactoring',
        },
        acquiredAt: now - 60000,
        lastActivityAt: now - 35000, // 35 seconds since last chunk
        anchorPos: 0,
      };

      expect(shouldTimeout(lock, config, now)).toBe(true);
    });

    it('should timeout AI lock after hard timeout regardless of activity', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'code-L5',
        state: 'hard',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'ai',
          operation: 'Refactoring',
        },
        acquiredAt: now - 400000, // 6.6 minutes (past 5 min hard timeout)
        lastActivityAt: now - 1000, // Recent activity
        anchorPos: 0,
      };

      expect(shouldTimeout(lock, config, now)).toBe(true);
    });
  });

  describe('getTimeoutRemaining', () => {
    it('should return remaining time for human lock', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'paragraph-L1',
        state: 'soft',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'human',
        },
        acquiredAt: now - 5000,
        lastActivityAt: now - 5000, // 5 seconds ago
        anchorPos: 0,
      };

      const remaining = getTimeoutRemaining(lock, config, now);
      expect(remaining).toBe(5000); // 10s - 5s = 5s remaining
    });

    it('should return 0 for expired lock', () => {
      const lock: Lock = {
        id: 'lock-1',
        blockId: 'paragraph-L1',
        state: 'soft',
        owner: {
          userId: 'alice',
          userName: 'Alice',
          userColor: '#3b82f6',
          type: 'human',
        },
        acquiredAt: now - 20000,
        lastActivityAt: now - 20000,
        anchorPos: 0,
      };

      const remaining = getTimeoutRemaining(lock, config, now);
      expect(remaining).toBe(0);
    });
  });
});

describe('LockStore', () => {
  it('should create empty store', () => {
    const store = createLockStore();
    expect(store.locks.size).toBe(0);
    expect(store.byUser.size).toBe(0);
  });
});

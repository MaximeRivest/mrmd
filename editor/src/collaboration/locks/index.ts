/**
 * Locks Module
 *
 * Block-level locking for collaborative editing.
 */

// Types - values
export {
  DEFAULT_TIMEOUT_CONFIG,
  createLockStore,
  shouldTimeout,
  getTimeoutRemaining,
} from './types';

// Types - type exports
export type {
  LockState,
  LockOwnerType,
  LockOwner,
  Lock,
  LockTimeoutConfig,
  LockTransition,
  LockEvent,
  LockRequest,
  LockResult,
  LockStore,
} from './types';

// Lock Manager
export { LockManager, createLockManager } from './lock-manager';
export type { LockManagerConfig } from './lock-manager';

// CM6 Extension
export {
  lockExtension,
  updateLocks,
  getLocks,
  getBlocks,
  lockField,
  lockManagerFacet,
  updateLocksEffect,
  updateBlocksEffect,
  editDeniedEffect,
  clearEditDeniedEffect,
} from './lock-extension';
export type { LockExtensionConfig } from './lock-extension';

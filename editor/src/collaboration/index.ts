// Types
export type {
  CollabUpdate,
  SerializedUpdate,
  RemoteCursor,
  Presence,
  RemoteUser,
  CollabEvents,
  CollabClientAdapter,
  CollabConfig,
} from './types';

export {
  serializeChanges,
  deserializeChanges,
} from './types';

// Adapter for legacy collab-client.js
export { CollabClientJSAdapter } from './adapter';
export type { LegacyCollabClient } from './adapter';

// Mock adapter for testing (uses BroadcastChannel)
export { MockCollabAdapter } from './mock-adapter';

// CM6 collaboration extension (simple peer-to-peer, for reference)
export {
  createCollabExtension,
  isRemoteTransaction,
  remoteTransaction,
} from './collab-extension';

// Presence / remote cursors
export {
  createPresenceExtension,
  getRemoteCursors,
} from './presence';

// ============================================
// Yjs-based collaboration (recommended)
// ============================================

// Yjs document sync
export {
  YjsDocManager,
  createYjsSync,
  YJS_ORIGINS,
} from './yjs-sync';
export type {
  YjsSyncConfig,
  YjsProvider,
  YjsOrigin,
} from './yjs-sync';

// Yjs WebSocket provider (for y-websocket / pycrdt-websocket binary protocol)
export {
  YjsWebSocketProvider,
  createYjsWebSocketProvider,
  CollabAdapterYjsProvider,
} from './yjs-provider';
export type {
  YjsWebSocketConfig,
} from './yjs-provider';

// MRMD Yjs provider (for mrmd collab handler JSON protocol)
export {
  MrmdYjsProvider,
  createMrmdYjsProvider,
} from './mrmd-yjs-provider';
export type {
  MrmdYjsProviderConfig,
  FileChangeEvent,
  DirectoryChangeEvent,
} from './mrmd-yjs-provider';

// Output sync (separate from Yjs - for execution output)
export {
  OutputSyncManager,
  createOutputSyncManager,
} from './output-sync';
export type {
  OutputBlock,
  RichOutput,
  OutputSyncEvents,
  OutputSyncConfig,
} from './output-sync';

// External change handler (AI edits, etc.)
export {
  ExternalChangeHandler,
  createExternalChangeHandler,
} from './external-changes';
export type {
  ExternalChangeConfig,
  ExternalChangeInfo,
  ConflictInfo,
  DiffRegion,
} from './external-changes';

// ============================================
// Block Detection
// ============================================
export {
  parseBlocks,
  getBlockAtPos,
  getBlockAtLine,
  blocksOverlap,
  getBlocksInRange,
} from './blocks';
export type {
  BlockType,
  Block,
  BlockMap,
} from './blocks';

// ============================================
// Locks (block-level collaborative locking)
// ============================================
export {
  // Types - values
  DEFAULT_TIMEOUT_CONFIG,
  createLockStore,
  shouldTimeout,
  getTimeoutRemaining,
  // Lock Manager
  LockManager,
  createLockManager,
  // CM6 Extension
  lockExtension,
  updateLocks,
  getLocks,
  getBlocks,
  lockField,
  lockManagerFacet,
  editDeniedEffect,
} from './locks';
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
  LockManagerConfig,
  LockExtensionConfig,
} from './locks';

// ============================================
// Streaming (ephemeral overlays for AI/execution)
// ============================================
export {
  // Overlay
  streamingOverlayExtension,
  startStream,
  streamChunk,
  completeStream,
  errorStream,
  cancelStream,
  applyRemoteStreams,
  getStreams,
  getStream,
  streamingField,
  // Commit
  commitStream,
  commitAsOutputBlock,
  abortStream,
  runStreamingOperation,
  // Awareness Sync
  createAwarenessSync,
  MockAwarenessProvider,
} from './streaming';
export type {
  StreamType,
  StreamingOverlay,
  StreamingState,
  CommitOptions,
  CommitResult,
  AwarenessState,
  AwarenessOutputBlock,
  AwarenessProvider,
  AwarenessSyncConfig,
  AwarenessSyncManager,
} from './streaming';

// ============================================
// Yjs Awareness Adapter
// ============================================
export {
  YjsAwarenessAdapter,
  createYjsAwarenessAdapter,
  createCollabAwareness,
} from './yjs-awareness';
export type {
  YjsAwarenessConfig,
  CreateCollabAwarenessConfig,
  CollabAwareness,
} from './yjs-awareness';

// ============================================
// Unified Collaborative Editor (recommended entry point)
// ============================================
export {
  createCollaborativeEditor,
} from './collaborative-editor';
export type {
  CollaborativeEditorConfig,
  CollaborativeEditor,
} from './collaborative-editor';

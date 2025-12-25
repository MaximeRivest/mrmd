/**
 * Streaming Module
 *
 * Ephemeral streaming overlay for AI/code output,
 * plus commit logic and awareness sync.
 */

// Overlay - values
export {
  streamingField,
  streamingOverlayExtension,
  startStream,
  streamChunk,
  completeStream,
  errorStream,
  cancelStream,
  applyRemoteStreams,
  getStreams,
  getStream,
  // Effects (for advanced use)
  startStreamEffect,
  streamChunkEffect,
  completeStreamEffect,
  errorStreamEffect,
  cancelStreamEffect,
  applyRemoteStreamsEffect,
} from './overlay';

// Overlay - types
export type {
  StreamType,
  StreamingOverlay,
  StreamingState,
} from './overlay';

// Commit - values
export {
  commitStream,
  commitAsOutputBlock,
  abortStream,
  runStreamingOperation,
} from './commit';

// Commit - types
export type {
  CommitOptions,
  CommitResult,
} from './commit';

// Awareness Sync - values
export {
  AwarenessSyncManager,
  createAwarenessSync,
  MockAwarenessProvider,
} from './awareness-sync';

// Awareness Sync - types
export type {
  AwarenessState,
  AwarenessOutputBlock,
  AwarenessProvider,
  AwarenessSyncConfig,
} from './awareness-sync';

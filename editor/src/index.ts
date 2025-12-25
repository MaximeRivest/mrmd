// Core
export { createEditor, MrmdEditor } from './core/editor';
export type {
  EditorConfig,
  CollabConfig,
  // Code block types
  CodeBlockInfo,
  // Code intelligence types
  CursorInfo,
  CompletionResult,
  CompletionItem,
  InspectionResult,
  HoverResult,
} from './core/config';

// Execution
export type {
  Executor,
  ExecutionResult,
  ExecutionError,
  DisplayData,
  SavedAsset,
  StreamCallback,
} from './execution/executor';
export { MockExecutor } from './execution/executor';
export { ExecutionTracker } from './execution/tracker';

// IPython integration
export type { IPythonClient, IPythonExecutorConfig } from './execution/ipython';
export { IPythonExecutor, createMinimalIPythonClient } from './execution/ipython';

// Themes
export {
  zenTheme,
  zenEditorTheme,
  zenHighlightStyle,
  zenThemeStyles,
  injectZenStyles,
} from './themes/zen';

// Widgets (for advanced customization)
export { ImageWidget } from './widgets/image';
export { MathWidget } from './widgets/math';
export { RunButtonWidget } from './widgets/run-button';
export {
  RenderedHTMLWidget,
  HtmlCellPlaceholder,
  InlineHTMLWidget,
  clearAllScripts,
  INLINE_HTML_TAGS,
} from './widgets/html';

// Cells (code cell options parsing)
export { parseCellOptions, parseRenderedOptions, serializeCellOptions } from './cells';
export type { CellOptions, HtmlCellMeta } from './cells';

// Markdown
export { markdownDecorations } from './markdown/decorations';
export type { TrackerRef } from './markdown/decorations';

// Collaboration
export {
  // Unified entry point (recommended)
  createCollaborativeEditor,
  // Legacy / low-level
  CollabClientJSAdapter,
  MockCollabAdapter,
  createCollabExtension,
  createPresenceExtension,
  getRemoteCursors,
  isRemoteTransaction,
  remoteTransaction,
  serializeChanges,
  deserializeChanges,
  // Yjs-based collaboration
  YjsDocManager,
  createYjsSync,
  YjsWebSocketProvider,
  createYjsWebSocketProvider,
  CollabAdapterYjsProvider,
  YjsAwarenessAdapter,
  createYjsAwarenessAdapter,
  // Locks
  LockManager,
  createLockManager,
  lockExtension,
  // Streaming
  streamingOverlayExtension,
  startStream,
  streamChunk,
  completeStream,
  commitStream,
  createAwarenessSync,
} from './collaboration';
export type {
  // Unified entry point
  CollaborativeEditorConfig,
  CollaborativeEditor,
  // Legacy / low-level
  CollabClientAdapter,
  CollabConfig as CollabExtensionConfig,
  CollabEvents,
  CollabUpdate,
  SerializedUpdate,
  RemoteCursor,
  RemoteUser,
  Presence,
  LegacyCollabClient,
  // Yjs types
  YjsSyncConfig,
  YjsProvider,
  YjsWebSocketConfig,
  YjsAwarenessConfig,
  AwarenessState,
  AwarenessProvider,
  AwarenessSyncManager,
  // Lock types
  Lock,
  LockState,
  LockManagerConfig,
} from './collaboration';

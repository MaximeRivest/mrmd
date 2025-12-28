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

// Code block utilities (AST-based)
export {
  getCodeBlocksFromAST,
  getCodeBlockByIndex,
  getCodeBlockAtPosition,
  // Detection utilities (support 3+ backticks)
  isOutputBlock,
  isHtmlRenderedBlock,
  extractLanguage,
} from './core/code-blocks';

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
export type { FileStateCallbacks, DocumentUpdateCallbacks } from './execution/tracker';

// Execution Queue
export { ExecutionQueue, createExecutionQueue } from './execution/queue';
export type {
  QueuedExecution,
  ExecutionStatus,
  ExecutionAwarenessState,
  QueueEvents,
} from './execution/queue';

// ANSI Processing
export {
  ansiToHtml,
  stripAnsi,
  hasAnsi,
  processTerminalOutput,
  ansiStyles,
} from './execution/ansi';

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
export { OutputWidget, createOutputWidget, outputWidgetStyles } from './widgets/output';
export type { OutputWidgetConfig } from './widgets/output';
export { CellStatusWidget, getCellState, cellStatusStyles } from './widgets/cell-status';
export type { CellState } from './widgets/cell-status';

// Cells (code cell options parsing)
export { parseCellOptions, parseRenderedOptions, serializeCellOptions } from './cells';
export type { CellOptions, HtmlCellMeta } from './cells';

// Markdown
export { markdownDecorations } from './markdown/decorations';
export type { TrackerRef, QueueRef, FilePathRef } from './markdown/decorations';

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

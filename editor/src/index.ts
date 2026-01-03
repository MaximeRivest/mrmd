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

// Table utilities (with Tufte Markdown extensions)
export {
  parseTable,
  parseTableRow,
  parseAlignments,
  parseDelimiterRow,
  splitTableRow,
  isTableLine,
  isTableDelimiter,
  isColspanMarker,
  isRowspanMarker,
  getTableAtPosition,
  getAllTables,
  isNumericContent,
  normalizeTable,
  getEffectiveAlignment,
} from './core/tables';
export type {
  ColumnAlignment,
  ColumnWidth,
  TableCell,
  TableRow,
  ParsedTable,
  TableBlockInfo,
} from './core/tables';

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
export type { FileStateCallbacks, DocumentUpdateCallbacks, BeforeExecuteCallback, BeforeExecuteResult } from './execution/tracker';

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

// Terminal buffer (full cursor movement support)
export { TerminalBuffer, processTerminalBuffer } from './execution/terminal-buffer';

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
export { TableWidget, createTableWidget, generateTableId } from './widgets/table';
export type { TableWidgetConfig } from './widgets/table';

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
  // CollabService adapter (uses editor's Yjs instance)
  CollabServiceYjsAdapter,
  createCollabServiceYjsAdapter,
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
  // CollabService adapter types
  CollabServiceInterface,
  YjsSyncPayload,
  YjsUpdatePayload,
  YjsProviderInterface,
  // Lock types
  Lock,
  LockState,
  LockManagerConfig,
} from './collaboration';

/**
 * Unified Collaborative Editor Factory
 *
 * This wires together all collaboration pieces:
 * - Yjs document (CRDT)
 * - WebSocket provider (transport)
 * - Awareness (cursors, presence)
 * - Lock manager (block-level locks)
 * - Streaming overlays (AI/execution output)
 *
 * Usage:
 *   const collab = await createCollaborativeEditor({
 *     parent: document.getElementById('editor'),
 *     collab: {
 *       url: 'ws://localhost:1234',
 *       roomId: 'my-document',
 *       userId: 'alice',
 *       userName: 'Alice',
 *     }
 *   });
 *
 *   // Everything just works:
 *   // ✓ Document syncs
 *   // ✓ Remote cursors visible
 *   // ✓ Locks sync between users
 *   // ✓ Streaming overlays visible to all
 */

import { Extension } from '@codemirror/state';
import { createEditor, MrmdEditor } from '../core/editor';
import { createYjsSync, YjsDocManager, YjsProvider } from './yjs-sync';
import { createYjsWebSocketProvider, YjsWebSocketProvider } from './yjs-provider';
import { createMrmdYjsProvider, MrmdYjsProvider } from './mrmd-yjs-provider';
import { createYjsAwarenessAdapter, YjsAwarenessAdapter } from './yjs-awareness';
import { LockManager } from './locks/lock-manager';
import {
  AwarenessSyncManager,
  AwarenessOutputBlock,
  createAwarenessSync,
} from './streaming/awareness-sync';
import { OutputSyncManager, createOutputSyncManager } from './output-sync';
import type { Executor } from '../execution/executor';

// ============================================================================
// Types
// ============================================================================

export interface CollaborativeEditorConfig {
  /** DOM element to mount the editor */
  parent: HTMLElement;

  /** Initial document content (used only if Yjs doc is empty) */
  doc?: string;

  /** Code execution backend */
  executor?: Executor;

  /** Theme: 'zen', 'light', 'dark', or custom Extension */
  theme?: 'zen' | 'light' | 'dark' | Extension;

  /** Collaboration settings */
  collab: {
    /** WebSocket URL (e.g., 'ws://localhost:8000/api/collab') */
    url: string;

    /**
     * Room/document ID - typically the file path
     * For mrmd protocol, this is the absolute file path
     */
    roomId: string;

    /** Current user's ID */
    userId: string;

    /** Current user's display name */
    userName?: string;

    /** Current user's cursor color (hex) */
    userColor?: string;

    /**
     * Protocol to use:
     * - 'mrmd': JSON protocol with mrmd collab handler (default)
     * - 'yjs': Binary y-protocols with y-websocket/pycrdt-websocket
     */
    protocol?: 'mrmd' | 'yjs';
  };

  /** Additional CM6 extensions */
  extensions?: Extension[];

  /** Called when document changes */
  onChange?: (doc: string) => void;

  /** Called on Cmd/Ctrl+S */
  onSave?: (doc: string) => void;

  /** Line numbers (default: false for zen) */
  lineNumbers?: boolean;

  /** Resolve image URLs before rendering */
  resolveImageUrl?: (url: string) => string;
}

export interface CollaborativeEditor {
  /** The underlying MrmdEditor instance */
  editor: MrmdEditor;

  /** Yjs document manager */
  yjsDoc: YjsDocManager;

  /** WebSocket provider (MrmdYjsProvider or YjsWebSocketProvider) */
  provider: YjsProvider;

  /** Awareness adapter (bridges Yjs awareness to locks/streaming) */
  awarenessAdapter: YjsAwarenessAdapter;

  /** Lock manager (already connected to awareness) */
  lockManager: LockManager;

  /** Streaming sync manager (already connected to awareness) */
  streamingSync: AwarenessSyncManager;

  /** Output sync manager (for execution results) */
  outputSync: OutputSyncManager;

  /** Get current document content */
  getDoc(): string;

  /** Set document content (as Yjs transaction) */
  setDoc(content: string): void;

  /** Focus the editor */
  focus(): void;

  /** Clean up all resources */
  destroy(): void;

  /** Connection status */
  readonly isConnected: boolean;

  /** Wait for initial sync to complete */
  whenSynced(): Promise<void>;

  /**
   * Broadcast execution output so other users can see it.
   * Call this when code block execution produces output.
   */
  broadcastOutput(blockId: string, content: string, status: AwarenessOutputBlock['status'], error?: string): void;
}

// ============================================================================
// Default colors for users
// ============================================================================

const DEFAULT_COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#22d3d8', // teal
  '#60a5fa', // blue
  '#a78bfa', // purple
  '#f472b6', // pink
];

function getDefaultColor(userId: string): string {
  // Deterministic color based on userId
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash;
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length];
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createCollaborativeEditor(
  config: CollaborativeEditorConfig
): Promise<CollaborativeEditor> {
  const {
    parent,
    doc: initialDoc,
    executor,
    theme = 'zen',
    collab,
    extensions = [],
    onChange,
    onSave,
    lineNumbers,
    resolveImageUrl,
  } = config;

  const userId = collab.userId;
  const userName = collab.userName ?? userId;
  const userColor = collab.userColor ?? getDefaultColor(userId);

  // -------------------------------------------------------------------------
  // 1. Create Yjs Document Manager
  // -------------------------------------------------------------------------
  const yjsDoc = createYjsSync({
    userId,
    userName,
    userColor,
    filePath: collab.roomId,
  });

  // -------------------------------------------------------------------------
  // 2. Create and Connect WebSocket Provider
  // -------------------------------------------------------------------------
  const protocol = collab.protocol ?? 'mrmd';
  let provider: YjsProvider;

  if (protocol === 'mrmd') {
    // Use mrmd's JSON protocol (default)
    provider = createMrmdYjsProvider({
      url: collab.url,
      filePath: collab.roomId,
      userId,
      userName,
      userColor,
      autoReconnect: true,
      maxReconnectAttempts: 10,
      // Handle sync mismatch: server has content but we got empty
      // This can happen if pycrdt/Yjs binary encoding differs
      onSyncMismatch: (serverContentLength: number) => {
        console.warn('[CollaborativeEditor] Sync mismatch detected, server has', serverContentLength, 'chars');
        // Return initial doc as fallback if available
        if (initialDoc && initialDoc.length > 0) {
          console.log('[CollaborativeEditor] Using initial doc as fallback');
          return initialDoc;
        }
        // No fallback available - the document will be empty
        console.warn('[CollaborativeEditor] No fallback content available');
        return undefined;
      },
    });
  } else {
    // Use binary y-protocols (for y-websocket/pycrdt-websocket)
    provider = createYjsWebSocketProvider({
      url: collab.url,
      roomId: collab.roomId,
      autoReconnect: true,
      maxReconnectAttempts: 10,
    });
  }

  yjsDoc.connectProvider(provider);

  // -------------------------------------------------------------------------
  // 3. Wait for Initial Sync
  // -------------------------------------------------------------------------
  await provider.whenSynced();

  // -------------------------------------------------------------------------
  // 4. Initialize Content (if Yjs doc is empty)
  // -------------------------------------------------------------------------
  if (initialDoc && yjsDoc.ytext.length === 0) {
    yjsDoc.ydoc.transact(() => {
      yjsDoc.ytext.insert(0, initialDoc);
    }, 'init');
  }

  // -------------------------------------------------------------------------
  // 5. Create Awareness Adapter
  //    This bridges Yjs awareness to lock/streaming systems
  // -------------------------------------------------------------------------
  const awarenessAdapter = createYjsAwarenessAdapter({
    awareness: yjsDoc.awareness,
    userId,
    userName,
    userColor,
  });

  // -------------------------------------------------------------------------
  // 6. Create Editor with Yjs Extensions
  //    The editor will create its own LockManager internally
  //
  //    IMPORTANT: We pass the current Y.Text content as the initial doc.
  //    The yCollab extension will then bind to Y.Text for future updates.
  //    This ensures the editor starts with the synced content rather than
  //    relying on yCollab to sync after creation (which has timing issues).
  // -------------------------------------------------------------------------
  const initialContent = yjsDoc.ytext.toString();
  console.log('[CollaborativeEditor] Initial content from Y.Text:', initialContent.length, 'chars');

  const editor = createEditor({
    parent,
    doc: initialContent,  // Start with synced content
    executor,
    theme,
    lineNumbers,
    onChange,
    onSave,
    resolveImageUrl,
    extensions: [
      ...yjsDoc.getExtensions(),  // Yjs collab + awareness cursors
      ...extensions,
    ],
    // Enable collab features (locks, streaming) by providing user info
    // Note: We don't pass an adapter here since we're using Yjs
    collab: {
      userId,
      userName,
      userColor,
      filePath: collab.roomId,
    },
  });

  // -------------------------------------------------------------------------
  // 7. Get the Lock Manager created by the editor
  // -------------------------------------------------------------------------
  const lockManager = editor.lockManager;
  if (!lockManager) {
    throw new Error(
      'LockManager not created. Ensure collab config is provided to createEditor.'
    );
  }

  // -------------------------------------------------------------------------
  // 8. Create Awareness Sync Manager
  //    This wires lock manager + streaming to the Yjs awareness
  // -------------------------------------------------------------------------
  const streamingSync = createAwarenessSync({
    view: editor.view,
    lockManager,
    provider: awarenessAdapter,
    userId,
    userName,
    userColor,
  });

  // -------------------------------------------------------------------------
  // 9. Create Output Sync Manager
  //    Handles execution output broadcasting via awareness
  // -------------------------------------------------------------------------
  const outputSync = createOutputSyncManager({
    filePath: collab.roomId,
  });

  // Wire output sync to awareness: when remote outputs change, apply them
  const unsubscribeOutputChange = streamingSync.onOutputChange((remoteOutputs) => {
    for (const [userId, outputs] of remoteOutputs) {
      for (const output of outputs) {
        // Apply remote output to local output manager
        outputSync.applyRemoteUpdate(output.blockId, {
          content: output.content,
          status: output.status === 'running' ? 'running' :
                  output.status === 'streaming' ? 'streaming' :
                  output.status === 'error' ? 'error' : 'completed',
          lastUpdate: output.lastUpdate,
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // 10. Build the Unified API
  // -------------------------------------------------------------------------
  const collaborativeEditor: CollaborativeEditor = {
    editor,
    yjsDoc,
    provider,
    awarenessAdapter,
    lockManager,
    streamingSync,
    outputSync,

    getDoc() {
      return editor.getDoc();
    },

    setDoc(content: string) {
      yjsDoc.ydoc.transact(() => {
        yjsDoc.ytext.delete(0, yjsDoc.ytext.length);
        yjsDoc.ytext.insert(0, content);
      }, 'setDoc');
    },

    focus() {
      editor.focus();
    },

    destroy() {
      // Clean up in reverse order
      unsubscribeOutputChange();
      outputSync.destroy();
      streamingSync.destroy();
      awarenessAdapter.destroy();
      provider.disconnect();
      editor.destroy();
    },

    get isConnected() {
      return provider.isConnected;
    },

    whenSynced() {
      return provider.whenSynced();
    },

    broadcastOutput(blockId: string, content: string, status: AwarenessOutputBlock['status'], error?: string) {
      // Update local output manager
      if (status === 'running') {
        outputSync.startExecution(blockId);
      } else if (status === 'streaming') {
        // For streaming, we just append - the caller should call multiple times
        outputSync.setContent(blockId, content);
      } else if (status === 'error') {
        outputSync.completeExecution(blockId, error);
      } else {
        outputSync.setContent(blockId, content);
        outputSync.completeExecution(blockId);
      }

      // Broadcast via awareness so other users see it
      streamingSync.broadcastOutput({
        blockId,
        content,
        status,
        error,
        lastUpdate: Date.now(),
      });
    },
  };

  return collaborativeEditor;
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export type { YjsDocManager } from './yjs-sync';
export type { YjsWebSocketProvider } from './yjs-provider';
export type { YjsAwarenessAdapter } from './yjs-awareness';

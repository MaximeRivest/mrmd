import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import {
  StateField,
  ChangeSet,
  Annotation,
  AnnotationType,
} from '@codemirror/state';
import type { Extension } from '@codemirror/state';

import type {
  CollabClientAdapter,
  SerializedUpdate,
  CollabConfig,
} from './types';

/**
 * Annotation to mark transactions as remote (from other users)
 */
export const remoteTransaction = Annotation.define<boolean>();

/**
 * State field to track collaboration state
 */
interface CollabState {
  adapter: CollabClientAdapter;
  filePath: string;
  clientId: string;
}

const collabStateField = StateField.define<CollabState | null>({
  create: () => null,
  update: (value) => value,
});

/**
 * Simple change serialization for peer-to-peer sync
 * Format: array of [from, to, insertedText] tuples
 */
function serializeChanges(changes: ChangeSet): Array<[number, number, string]> {
  const result: Array<[number, number, string]> = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push([fromA, toA, inserted.toString()]);
  });
  return result;
}

/**
 * Create collaboration extensions for CodeMirror 6
 *
 * This is a simplified peer-to-peer sync that directly broadcasts changes.
 * NOT suitable for production - use Yjs or a proper OT server for that.
 */
export function createCollabExtension(config: CollabConfig): Extension {
  const { adapter, filePath, userId } = config;

  // Plugin that handles sending/receiving document changes
  const syncPlugin = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private boundHandleUpdate: (update: SerializedUpdate) => void;

      constructor(view: EditorView) {
        this.view = view;
        this.boundHandleUpdate = this.handleRemoteUpdate.bind(this);

        // Listen for remote updates
        adapter.on('update', this.boundHandleUpdate);
        console.log('[Collab] Sync plugin initialized for', userId);
      }

      update(update: ViewUpdate) {
        // Send local changes to other peers
        if (update.docChanged) {
          const isRemote = update.transactions.some(tr => tr.annotation(remoteTransaction));
          if (!isRemote) {
            this.broadcastChanges(update);
          }
        }
      }

      private broadcastChanges(update: ViewUpdate) {
        // Collect all changes from all transactions
        for (const tr of update.transactions) {
          if (tr.docChanged && !tr.annotation(remoteTransaction)) {
            const serialized: SerializedUpdate = {
              clientId: userId,
              changes: serializeChanges(tr.changes) as unknown as readonly number[],
              version: 0, // Not used in simple sync
            };

            console.log('[Collab] Broadcasting changes:', serialized.changes);
            adapter.sendUpdate(serialized);
          }
        }
      }

      private handleRemoteUpdate(update: SerializedUpdate) {
        // Don't apply our own updates
        if (update.clientId === userId) {
          console.log('[Collab] Ignoring own update');
          return;
        }

        console.log('[Collab] Received remote update from', update.clientId, update.changes);

        try {
          // Deserialize and apply changes
          const changes = update.changes as unknown as Array<[number, number, string]>;

          // Build CM6 changes spec
          const cmChanges: Array<{ from: number; to: number; insert: string }> = [];
          for (const [from, to, insert] of changes) {
            // Clamp positions to document bounds
            const docLen = this.view.state.doc.length;
            const clampedFrom = Math.min(Math.max(0, from), docLen);
            const clampedTo = Math.min(Math.max(0, to), docLen);
            cmChanges.push({ from: clampedFrom, to: clampedTo, insert });
          }

          if (cmChanges.length > 0) {
            this.view.dispatch({
              changes: cmChanges,
              annotations: remoteTransaction.of(true),
            });
            console.log('[Collab] Applied remote changes');
          }
        } catch (err) {
          console.error('[Collab] Failed to apply remote update:', err);
        }
      }

      destroy() {
        adapter.off('update', this.boundHandleUpdate);
        console.log('[Collab] Sync plugin destroyed');
      }
    }
  );

  // Plugin that handles cursor synchronization
  const cursorPlugin = ViewPlugin.fromClass(
    class {
      private throttleTimeout: ReturnType<typeof setTimeout> | null = null;
      private lastOffset: number = -1;

      constructor(private view: EditorView) {}

      update(update: ViewUpdate) {
        if (update.selectionSet) {
          this.scheduleCursorUpdate();
        }
      }

      private scheduleCursorUpdate() {
        const throttleMs = config.cursorThrottleMs ?? 50;

        if (this.throttleTimeout) return;

        this.throttleTimeout = setTimeout(() => {
          this.throttleTimeout = null;
          this.sendCursor();
        }, throttleMs);
      }

      private sendCursor() {
        const sel = this.view.state.selection.main;
        const offset = sel.head;

        // Don't send if hasn't changed
        if (offset === this.lastOffset && sel.empty) return;
        this.lastOffset = offset;

        adapter.sendCursor(
          offset,
          sel.empty ? undefined : { anchor: sel.anchor, head: sel.head }
        );
      }

      destroy() {
        if (this.throttleTimeout) {
          clearTimeout(this.throttleTimeout);
        }
      }
    }
  );

  return [
    // Our sync plugins
    syncPlugin,
    cursorPlugin,

    // Store collab state
    collabStateField.init(() => ({
      adapter,
      filePath,
      clientId: userId,
    })),
  ];
}

/**
 * Check if a transaction came from a remote source
 */
export function isRemoteTransaction(tr: { annotation: <T>(type: AnnotationType<T>) => T | undefined }): boolean {
  return tr.annotation(remoteTransaction) === true;
}

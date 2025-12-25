/**
 * Stream Commit
 *
 * Commits streaming content to the document as a single undo step.
 * This is called when a stream completes successfully.
 *
 * Key behaviors:
 * - The entire commit is ONE undo step (user can Ctrl+Z to revert)
 * - Content is inserted/replaced at the anchor position
 * - The streaming overlay is removed after commit
 * - Lock is released after commit
 * - History entry is recorded (for line-level tracking)
 */

import { EditorView } from '@codemirror/view';
import { ChangeSpec, TransactionSpec } from '@codemirror/state';
import {
  StreamingOverlay,
  getStream,
  cancelStream,
} from './overlay';
import { LockManager } from '../locks/lock-manager';
import { Block, getBlockAtPos } from '../blocks';

export interface CommitOptions {
  /**
   * The stream ID to commit
   */
  streamId: string;

  /**
   * The EditorView
   */
  view: EditorView;

  /**
   * Lock manager to release the lock after commit
   */
  lockManager?: LockManager;

  /**
   * Whether to record in history (default: true)
   */
  recordHistory?: boolean;

  /**
   * Custom transaction annotation
   */
  annotation?: { type: string; value: any };

  /**
   * Callback after successful commit
   */
  onCommit?: (content: string) => void;

  /**
   * Callback on error
   */
  onError?: (error: Error) => void;
}

export interface CommitResult {
  success: boolean;
  content?: string;
  error?: string;
  changeFrom?: number;
  changeTo?: number;
}

/**
 * Commit a completed stream to the document
 */
export function commitStream(options: CommitOptions): CommitResult {
  const { streamId, view, lockManager, onCommit, onError } = options;
  const state = view.state;

  // Get the stream
  const stream = getStream(state, streamId);
  if (!stream) {
    const error = new Error(`Stream ${streamId} not found`);
    onError?.(error);
    return { success: false, error: error.message };
  }

  if (stream.status === 'error') {
    const error = new Error(`Stream ${streamId} has error: ${stream.error}`);
    onError?.(error);
    return { success: false, error: stream.error };
  }

  const content = stream.content;

  try {
    // Build the change
    let changes: ChangeSpec;
    let changeFrom: number;
    let changeTo: number;

    if (stream.anchorType === 'replace' && stream.replaceFrom !== undefined && stream.replaceTo !== undefined) {
      // Replace mode: replace the target range
      changeFrom = stream.replaceFrom;
      changeTo = stream.replaceTo;
      changes = {
        from: changeFrom,
        to: changeTo,
        insert: content,
      };
    } else {
      // Insert mode: insert after anchor position
      changeFrom = stream.anchorPos;
      changeTo = stream.anchorPos;
      changes = {
        from: changeFrom,
        insert: content,
      };
    }

    // Create transaction spec
    const transactionSpec: TransactionSpec = {
      changes,
      // Note: Custom annotations would need to be defined as AnnotationType
      // For now, we omit custom annotations
    };

    // Dispatch the change (this is a single undo step)
    view.dispatch(transactionSpec);

    // Remove the streaming overlay
    cancelStream(view, streamId);

    // Release the lock if we have a lock manager
    if (lockManager) {
      // Find the block at the change position
      const block = getBlockAtPos(view.state, changeFrom);
      if (block) {
        lockManager.transition({
          type: stream.type === 'ai' ? 'AI_COMPLETE' : 'EXEC_COMPLETE',
          userId: stream.owner.userId,
          blockId: block.id,
        });
      }
    }

    // Callback
    onCommit?.(content);

    return {
      success: true,
      content,
      changeFrom,
      changeTo: changeFrom + content.length,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    onError?.(error);
    return { success: false, error: error.message };
  }
}

/**
 * Commit a stream and insert as an output block (for code execution)
 */
export function commitAsOutputBlock(options: CommitOptions & {
  codeBlockEnd: number;
  language?: string;
}): CommitResult {
  const { streamId, view, codeBlockEnd, language = 'output', lockManager, onCommit, onError } = options;
  const state = view.state;

  // Get the stream
  const stream = getStream(state, streamId);
  if (!stream) {
    const error = new Error(`Stream ${streamId} not found`);
    onError?.(error);
    return { success: false, error: error.message };
  }

  if (stream.status === 'error') {
    // Still commit the error as output
    const errorContent = `\n\`\`\`${language}\nError: ${stream.error}\n\`\`\``;
    return commitStreamContent(view, codeBlockEnd, errorContent, streamId, lockManager, stream, onCommit);
  }

  // Format content as output block
  const outputContent = `\n\`\`\`${language}\n${stream.content}\`\`\``;
  return commitStreamContent(view, codeBlockEnd, outputContent, streamId, lockManager, stream, onCommit);
}

/**
 * Helper to commit content directly
 */
function commitStreamContent(
  view: EditorView,
  insertPos: number,
  content: string,
  streamId: string,
  lockManager: LockManager | undefined,
  stream: StreamingOverlay,
  onCommit?: (content: string) => void
): CommitResult {
  try {
    // Dispatch the insert
    view.dispatch({
      changes: { from: insertPos, insert: content },
    });

    // Remove the streaming overlay
    cancelStream(view, streamId);

    // Release the lock
    if (lockManager) {
      const block = getBlockAtPos(view.state, insertPos);
      if (block) {
        lockManager.transition({
          type: stream.type === 'ai' ? 'AI_COMPLETE' : 'EXEC_COMPLETE',
          userId: stream.owner.userId,
          blockId: block.id,
        });
      }
    }

    onCommit?.(content);

    return {
      success: true,
      content,
      changeFrom: insertPos,
      changeTo: insertPos + content.length,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Cancel a stream without committing (e.g., user cancelled, error)
 */
export function abortStream(options: {
  streamId: string;
  view: EditorView;
  lockManager?: LockManager;
  reason?: string;
}): void {
  const { streamId, view, lockManager, reason } = options;
  const stream = getStream(view.state, streamId);

  // Remove the overlay
  cancelStream(view, streamId);

  // Release the lock
  if (lockManager && stream) {
    const block = getBlockAtPos(view.state, stream.anchorPos);
    if (block) {
      lockManager.transition({
        type: stream.type === 'ai' ? 'AI_CANCEL' : 'EXEC_CANCEL',
        userId: stream.owner.userId,
        blockId: block.id,
      });
    }
  }

  if (reason) {
    console.log(`Stream ${streamId} aborted: ${reason}`);
  }
}

/**
 * High-level function to run a streaming operation
 *
 * This handles:
 * - Acquiring the lock
 * - Creating the streaming overlay
 * - Streaming chunks
 * - Committing on complete
 * - Error handling
 */
export async function runStreamingOperation<T>(options: {
  view: EditorView;
  lockManager: LockManager;
  type: 'ai' | 'execution';
  anchorPos: number;
  anchorType?: 'after' | 'replace';
  replaceFrom?: number;
  replaceTo?: number;
  operation?: string;
  run: (handlers: {
    onChunk: (chunk: string) => void;
    onReplace: (content: string) => void;
  }) => Promise<T>;
  commitAs?: 'inline' | 'output-block';
  codeBlockEnd?: number;
}): Promise<{ success: boolean; result?: T; error?: string }> {
  const {
    view,
    lockManager,
    type,
    anchorPos,
    anchorType = 'after',
    replaceFrom,
    replaceTo,
    operation,
    run,
    commitAs = 'inline',
    codeBlockEnd,
  } = options;

  const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = lockManager.currentUser;

  // 1. Acquire lock
  const block = getBlockAtPos(view.state, anchorPos);
  if (block) {
    const lockResult = lockManager.acquireLock({
      blockId: block.id,
      userId: user.userId,
      userName: user.userName,
      userColor: user.userColor,
      type,
      operation,
    });

    if (!lockResult.success) {
      return {
        success: false,
        error: `Block is locked by ${lockResult.currentHolder?.userName}`,
      };
    }
  }

  // 2. Start streaming overlay
  const { startStream, streamChunk } = await import('./overlay');
  startStream(view, {
    id: streamId,
    type,
    anchorPos,
    anchorType,
    replaceFrom,
    replaceTo,
    owner: {
      userId: user.userId,
      userName: user.userName,
      userColor: user.userColor,
    },
    operation,
  });

  // 3. Ping activity on each chunk (resets timeout)
  const pingActivity = () => {
    if (block) {
      lockManager.transition({
        type: type === 'ai' ? 'AI_CHUNK' : 'EXEC_CHUNK',
        userId: user.userId,
        blockId: block.id,
      });
    }
  };

  try {
    // 4. Run the operation
    const result = await run({
      onChunk: (chunk) => {
        streamChunk(view, streamId, chunk);
        pingActivity();
      },
      onReplace: (content) => {
        streamChunk(view, streamId, content, true);
        pingActivity();
      },
    });

    // 5. Commit
    const { completeStream } = await import('./overlay');
    completeStream(view, streamId);

    let commitResult: CommitResult;
    if (commitAs === 'output-block' && codeBlockEnd !== undefined) {
      commitResult = commitAsOutputBlock({
        streamId,
        view,
        codeBlockEnd,
        lockManager,
      });
    } else {
      commitResult = commitStream({
        streamId,
        view,
        lockManager,
      });
    }

    if (!commitResult.success) {
      return { success: false, error: commitResult.error };
    }

    return { success: true, result };
  } catch (err) {
    // 6. Handle error
    const { errorStream } = await import('./overlay');
    const errorMessage = err instanceof Error ? err.message : String(err);
    errorStream(view, streamId, errorMessage);

    // Still remove overlay and release lock after a delay
    setTimeout(() => {
      abortStream({ streamId, view, lockManager, reason: errorMessage });
    }, 3000);

    return { success: false, error: errorMessage };
  }
}

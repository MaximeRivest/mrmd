import type { EditorView } from '@codemirror/view';
import type { Executor, StreamCallback } from './executor';
import { clearCellScripts } from '../widgets/html/script-manager';
import { serializeCellOptions } from '../cells/options';
import type { CellOptions } from '../cells/types';
import { ExecutionQueue, type QueuedExecution } from './queue';
import { TerminalBuffer } from './terminal-buffer';
import { createImageMarkdown } from '../widgets/image-output';

/**
 * Callbacks for file-aware execution (optional)
 * When provided, allows execution to continue updating even when tab is switched
 */
export interface FileStateCallbacks {
  /** Get the current file path */
  getCurrentFilePath: () => string | null;
  /** Get content for a specific file from AppState */
  getFileContent: (path: string) => string | null;
  /** Update content for a specific file in AppState */
  updateFileContent: (path: string, content: string) => void;
}

/**
 * Callbacks for CRDT-aware document updates (optional)
 * When provided, updates go through Yjs CRDT for collaboration
 */
export interface DocumentUpdateCallbacks {
  /** Apply a change to the document via CRDT */
  applyChange: (newContent: string, origin: string) => void;
  /** Get the current document content */
  getContent: () => string;
}

/**
 * Tracks running executions and manages streaming output
 *
 * Integrates with:
 * - ExecutionQueue for queuing and ordering
 * - Yjs CRDT for collaborative output visibility
 * - File callbacks for background file updates
 */
export class ExecutionTracker {
  private running = new Map<string, { controller: AbortController; filePath: string | null }>();
  private view: EditorView;
  private executor: Executor;
  private fileCallbacks: FileStateCallbacks | null = null;
  private documentCallbacks: DocumentUpdateCallbacks | null = null;
  private queue: ExecutionQueue | null = null;
  private writeThrottleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = new Map<string, string>();
  private writeThrottleMs = 100; // Throttle writes to avoid performance issues

  // Persistent terminal buffers for proper cursor movement handling across chunks
  // Each execution gets its own buffer that accumulates output correctly
  private terminalBuffers = new Map<string, TerminalBuffer>();
  private lastAccumulatedLengths = new Map<string, number>();

  constructor(view: EditorView, executor: Executor) {
    this.view = view;
    this.executor = executor;
  }

  /**
   * Set callbacks for file-aware execution
   * When set, execution can update background files via AppState
   */
  setFileCallbacks(callbacks: FileStateCallbacks): void {
    this.fileCallbacks = callbacks;
  }

  /**
   * Set callbacks for CRDT-aware document updates
   * When set, updates go through Yjs for collaboration visibility
   */
  setDocumentCallbacks(callbacks: DocumentUpdateCallbacks): void {
    this.documentCallbacks = callbacks;
  }

  /**
   * Set the execution queue for ordered execution
   */
  setQueue(queue: ExecutionQueue): void {
    this.queue = queue;

    // Listen for queue events to process executions
    queue.on('started', (exec) => {
      this.processQueuedExecution(exec);
    });
  }

  /**
   * Get the execution queue
   */
  getQueue(): ExecutionQueue | null {
    return this.queue;
  }

  /**
   * Update the editor view reference
   */
  setView(view: EditorView): void {
    this.view = view;
  }

  /**
   * Run a code block and stream output
   * If a queue is set, the execution is queued; otherwise runs immediately
   */
  async runBlock(
    code: string,
    language: string,
    codeBlockEnd: number,
    options?: CellOptions
  ): Promise<string> {
    // Capture the file path at execution start
    const filePath = this.fileCallbacks?.getCurrentFilePath() ?? null;

    // HTML is handled specially - it's "executed" by rendering (not queued)
    if (language === 'html') {
      const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return this.runHtmlBlock(code, codeBlockEnd, execId, options);
    }

    // If queue is available, use it for ordered execution
    if (this.queue) {
      const execId = this.queue.enqueue({
        code,
        language,
        filePath: filePath ?? '',
        codeBlockEnd,
      });

      // Insert output block immediately with queued status
      this.insertOutputBlock(codeBlockEnd, execId, this.queue.getStatusString(execId));

      return execId;
    }

    // No queue - run immediately (legacy behavior)
    return this.runBlockImmediate(code, language, codeBlockEnd, filePath, options);
  }

  /**
   * Process a queued execution that's ready to run
   * Called by queue when execution reaches front of queue
   */
  private async processQueuedExecution(exec: QueuedExecution): Promise<void> {
    const { id: execId, code, language, filePath, codeBlockEnd } = exec;

    // Update output block to show running status (with queue position if available)
    const statusString = this.queue?.getStatusString(execId) || '[status:running]';
    this.updateOutputStatus(execId, statusString);

    // Create abort controller
    const controller = new AbortController();
    exec.controller = controller;
    this.running.set(execId, { controller, filePath: filePath || null });

    // Emit event for execution start
    document.dispatchEvent(new CustomEvent('mrmd:execution-start', {
      detail: { execId, language, filePath },
    }));

    let success = true;
    let errorMsg: string | undefined;
    let executionResult: import('./executor').ExecutionResult | null = null;

    try {
      // Stream execution with persistent terminal buffer for proper cursor handling
      let chunkCount = 0;
      executionResult = await this.executor.executeStreaming(code, language, (chunk, accumulated, done) => {
        if (controller.signal.aborted) return;
        chunkCount++;

        // Get or create persistent buffer for this execution
        let buffer = this.terminalBuffers.get(execId);
        if (!buffer) {
          buffer = new TerminalBuffer();
          buffer.debug = false; // Disable verbose logging
          this.terminalBuffers.set(execId, buffer);
          this.lastAccumulatedLengths.set(execId, 0);
        }

        // IMPORTANT: On 'done', the server sends 'formatted_output' which is RAW stdout
        // containing ALL intermediate frames without cursor processing. We must IGNORE it
        // and use our buffer's current state instead.
        if (done) {
          // Don't process the done chunk - our buffer already has the correct final state
          // Just do a final write with current buffer content
          const displayContent = buffer.toString();
          this.replaceOutputContent(execId, displayContent);
          return;
        }

        // The server's 'accumulated' field is actually per-line output, not true accumulated.
        // We detect this by checking if accumulated.length < lastLen (went backwards).
        // When this happens, treat 'accumulated' as the new chunk content directly.
        const lastLen = this.lastAccumulatedLengths.get(execId) || 0;

        let newContent: string;
        if (accumulated.length < lastLen) {
          // Server sent a new "frame" - accumulated went backwards
          // This means 'accumulated' is actually just this chunk's content
          newContent = accumulated;
        } else {
          // Normal case - calculate delta
          newContent = accumulated.slice(lastLen);
        }

        this.lastAccumulatedLengths.set(execId, accumulated.length);

        // Write new content to the persistent buffer
        if (newContent) {
          buffer.write(newContent);
        }

        // Get current display state and update output
        const displayContent = buffer.toString();
        this.replaceOutputContent(execId, displayContent);
      });
    } catch (error) {
      success = false;
      if (!controller.signal.aborted) {
        errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.appendToOutput(execId, `\nError: ${errorMsg}\n`);
      }
    } finally {
      // Flush any pending writes
      this.flushPendingWrites(execId);

      // Ensure closing fence is on its own line
      this.ensureOutputNewline(execId);
      requestAnimationFrame(() => this.ensureOutputNewline(execId));

      // Clear status from output block
      this.clearOutputStatus(execId);

      // Create output blocks for saved assets (images, HTML, etc.)
      if (executionResult?.savedAssets) {
        let imageIndex = 0;
        let htmlIndex = 0;
        for (const asset of executionResult.savedAssets) {
          if (asset.assetType === 'image' || asset.mimeType.startsWith('image/')) {
            imageIndex++;
            const altText = `Figure ${imageIndex}`;
            // Use a slight delay to ensure the output block is fully written
            requestAnimationFrame(() => {
              this.insertImageOutputBlock(codeBlockEnd, execId, asset.path, altText);
            });
          } else if (asset.assetType === 'html' || asset.mimeType === 'text/html') {
            htmlIndex++;
            // Create an html-rendered block with an iframe for HTML output
            requestAnimationFrame(() => {
              this.insertHtmlOutputBlock(codeBlockEnd, execId, asset.path);
            });
          }
        }
      }

      // Clean up terminal buffer
      this.terminalBuffers.delete(execId);
      this.lastAccumulatedLengths.delete(execId);

      this.running.delete(execId);

      // Notify queue of completion
      if (this.queue) {
        this.queue.markComplete(execId, success, errorMsg);
      }

      // Emit event for completion
      document.dispatchEvent(new CustomEvent('mrmd:execution-complete', {
        detail: { execId, language, success },
      }));
    }
  }

  /**
   * Run a code block immediately (no queue)
   * Used when queue is not configured or for specific immediate execution needs
   */
  private async runBlockImmediate(
    code: string,
    language: string,
    codeBlockEnd: number,
    filePath: string | null,
    options?: CellOptions
  ): Promise<string> {
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const controller = new AbortController();
    this.running.set(execId, { controller, filePath });

    document.dispatchEvent(new CustomEvent('mrmd:execution-start', {
      detail: { execId, language, filePath },
    }));

    this.insertOutputBlock(codeBlockEnd, execId);
    let executionResult: import('./executor').ExecutionResult | null = null;

    try {
      // Stream execution with persistent terminal buffer for proper cursor handling
      executionResult = await this.executor.executeStreaming(code, language, (chunk, accumulated, done) => {
        if (controller.signal.aborted) return;

        // Get or create persistent buffer for this execution
        let buffer = this.terminalBuffers.get(execId);
        if (!buffer) {
          buffer = new TerminalBuffer();
          this.terminalBuffers.set(execId, buffer);
          this.lastAccumulatedLengths.set(execId, 0);
        }

        // Calculate the actual new content (delta from what we've already processed)
        const lastLen = this.lastAccumulatedLengths.get(execId) || 0;
        const newContent = accumulated.slice(lastLen);
        this.lastAccumulatedLengths.set(execId, accumulated.length);

        // Write new content to the persistent buffer
        if (newContent) {
          buffer.write(newContent);
        }

        // Get current display state (with cursor movements resolved, colors preserved)
        const displayContent = buffer.toString();
        this.replaceOutputContent(execId, displayContent);
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.appendToOutput(execId, `\nError: ${errorMsg}\n`);
      }
    } finally {
      this.ensureOutputNewline(execId);
      requestAnimationFrame(() => this.ensureOutputNewline(execId));

      // Create output blocks for saved assets (images, HTML, etc.)
      if (executionResult?.savedAssets) {
        let imageIndex = 0;
        for (const asset of executionResult.savedAssets) {
          if (asset.assetType === 'image' || asset.mimeType.startsWith('image/')) {
            imageIndex++;
            const altText = `Figure ${imageIndex}`;
            requestAnimationFrame(() => {
              this.insertImageOutputBlock(codeBlockEnd, execId, asset.path, altText);
            });
          } else if (asset.assetType === 'html' || asset.mimeType === 'text/html') {
            // Create an html-rendered block with an iframe for HTML output
            requestAnimationFrame(() => {
              this.insertHtmlOutputBlock(codeBlockEnd, execId, asset.path);
            });
          }
        }
      }

      // Clean up terminal buffer
      this.terminalBuffers.delete(execId);
      this.lastAccumulatedLengths.delete(execId);

      this.running.delete(execId);

      document.dispatchEvent(new CustomEvent('mrmd:execution-complete', {
        detail: { execId, language },
      }));
    }

    return execId;
  }

  /**
   * Run an HTML block by creating a rendered output block
   * HTML "execution" means inserting the content into a special
   * html-rendered block that gets replaced with a live DOM widget
   */
  private runHtmlBlock(
    html: string,
    codeBlockEnd: number,
    execId: string,
    options?: CellOptions
  ): string {
    // Clear any previous scripts for this cell to allow fresh execution
    clearCellScripts(execId);

    const optStr = options ? serializeCellOptions(options) : '';
    const state = this.view.state;

    // Check for existing html-rendered block after this code block
    const afterText = state.doc.sliceString(
      codeBlockEnd,
      Math.min(codeBlockEnd + 100, state.doc.length)
    );

    const existingMatch = afterText.match(/^\n```html-rendered(?::[^\s{]*)?(?:\s*\{[^}]*\})?\n/);

    if (existingMatch) {
      // Replace existing html-rendered block
      const outputStart = codeBlockEnd + 1;
      const restOfDoc = state.doc.sliceString(outputStart, state.doc.length);
      const blockMatch = restOfDoc.match(
        /^```html-rendered(?::[^\s{]*)?(?:\s*\{[^}]*\})?\n([\s\S]*?)```/
      );

      if (blockMatch) {
        this.view.dispatch({
          changes: {
            from: outputStart,
            to: outputStart + blockMatch[0].length,
            insert: `\`\`\`html-rendered:${execId}${optStr}\n${html}\n\`\`\``,
          },
        });
        return execId;
      }
    }

    // Insert new html-rendered block
    this.view.dispatch({
      changes: {
        from: codeBlockEnd,
        insert: `\n\`\`\`html-rendered:${execId}${optStr}\n${html}\n\`\`\``,
      },
    });

    return execId;
  }

  /**
   * Cancel a running execution
   */
  cancel(execId: string): void {
    const execution = this.running.get(execId);
    if (execution) {
      execution.controller.abort();
      this.running.delete(execId);
      // Clean up terminal buffer
      this.terminalBuffers.delete(execId);
      this.lastAccumulatedLengths.delete(execId);
    }
  }

  /**
   * Cancel all running executions
   */
  cancelAll(): void {
    for (const { controller } of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
    // Clean up all terminal buffers
    this.terminalBuffers.clear();
    this.lastAccumulatedLengths.clear();
  }

  /**
   * Check if any execution is running
   */
  isRunning(): boolean {
    return this.running.size > 0;
  }

  /**
   * Get the number of running executions
   */
  getRunningCount(): number {
    return this.running.size;
  }

  /**
   * Insert or replace output block after code block
   * @param status Optional status string for LLM readability (e.g., "[status:queued] [2/3]")
   */
  private insertOutputBlock(codeBlockEnd: number, execId: string, status?: string): void {
    const state = this.view.state;
    const afterText = state.doc.sliceString(
      codeBlockEnd,
      Math.min(codeBlockEnd + 500, state.doc.length)
    );

    const statusLine = status ? `${status}\n` : '';

    // Check if there's already an output block (supports 3+ backticks)
    const existingOutput = afterText.match(/^\n(`{3,})output(?::[^\n]*)?\n/);

    if (existingOutput) {
      // Replace existing output block AND clean up associated image-output blocks
      const outputStart = codeBlockEnd + 1;
      const restOfDoc = state.doc.sliceString(outputStart, state.doc.length);
      const backticks = existingOutput[1]; // Captured backtick sequence
      const outputRegex = new RegExp(`^(\`{${backticks.length},})output(?::[^\\n]*)?\\n([\\s\\S]*?)\\1`);
      const outputMatch = restOfDoc.match(outputRegex);

      if (outputMatch) {
        // Find the end of the output block
        let deleteEnd = outputStart + outputMatch[0].length;

        // Check for and remove any trailing image-output blocks
        const afterOutput = state.doc.sliceString(deleteEnd, deleteEnd + 500);
        const imageOutputPattern = /^(\n```image-output:[^\n]*\n[\s\S]*?```)+/;
        const imageOutputMatch = afterOutput.match(imageOutputPattern);

        if (imageOutputMatch) {
          deleteEnd += imageOutputMatch[0].length;
        }

        this.dispatchChange({
          from: outputStart,
          to: deleteEnd,
          insert: `\`\`\`output:${execId}\n${statusLine}\`\`\``,
        });
        return;
      }
    }

    // Insert new output block (always use 3 backticks)
    this.dispatchChange({
      from: codeBlockEnd,
      insert: `\n\`\`\`output:${execId}\n${statusLine}\`\`\``,
    });
  }

  /**
   * Insert an image-output block after the output block
   * Used for matplotlib figures and other image outputs
   * @param afterPos Position to insert after (typically end of output block)
   * @param execId Execution ID for linking
   * @param imagePath Path to the image file
   * @param alt Alt text for the image
   */
  insertImageOutputBlock(afterPos: number, execId: string, imagePath: string, alt: string = 'output'): void {
    // Convert absolute path to asset API URL for browser access
    const assetUrl = `/api/file/asset${imagePath}`;
    const imageMarkdown = createImageMarkdown(assetUrl, alt);
    const state = this.view.state;

    // Find the position after the output block (after its closing ```)
    // We need to insert after any existing output block for this execId
    const doc = state.doc.toString();
    const outputMarker = `\`\`\`output:${execId}`;
    const outputPos = doc.indexOf(outputMarker);

    let insertPos = afterPos;

    if (outputPos !== -1) {
      // Find the closing ``` of the output block
      const afterOutput = doc.slice(outputPos);
      const closeMatch = afterOutput.match(/```[\s\S]*?```/);
      if (closeMatch) {
        insertPos = outputPos + closeMatch[0].length;
      }
    }

    // Check if there's already an image-output block for this execId
    const existingImageOutput = doc.indexOf(`\`\`\`image-output:${execId}`);
    if (existingImageOutput !== -1) {
      // Replace existing image-output block
      const restOfDoc = doc.slice(existingImageOutput);
      const blockMatch = restOfDoc.match(/^```image-output:[^\n]*\n[\s\S]*?```/);
      if (blockMatch) {
        this.dispatchChange({
          from: existingImageOutput,
          to: existingImageOutput + blockMatch[0].length,
          insert: `\`\`\`image-output:${execId}\n${imageMarkdown}\n\`\`\``,
        });
        return;
      }
    }

    // Insert new image-output block
    this.dispatchChange({
      from: insertPos,
      insert: `\n\`\`\`image-output:${execId}\n${imageMarkdown}\n\`\`\``,
    });
  }

  /**
   * Insert an html-rendered block with an iframe for HTML output
   * Used for display(HTML(...)), Plotly, etc.
   * @param afterPos Position to insert after (typically end of output block)
   * @param execId Execution ID for linking
   * @param htmlPath Path to the HTML file
   */
  insertHtmlOutputBlock(afterPos: number, execId: string, htmlPath: string): void {
    const state = this.view.state;

    // Find the position after the output block (after its closing ```)
    const doc = state.doc.toString();
    const outputMarker = `\`\`\`output:${execId}`;
    const outputPos = doc.indexOf(outputMarker);

    let insertPos = afterPos;

    if (outputPos !== -1) {
      // Find the closing ``` of the output block
      const afterOutput = doc.slice(outputPos);
      const closeMatch = afterOutput.match(/```[\s\S]*?```/);
      if (closeMatch) {
        insertPos = outputPos + closeMatch[0].length;
      }
    }

    // Also skip past any image-output blocks
    const imageOutputMarker = `\`\`\`image-output:${execId}`;
    const imageOutputPos = doc.indexOf(imageOutputMarker);
    if (imageOutputPos !== -1 && imageOutputPos >= insertPos) {
      const afterImage = doc.slice(imageOutputPos);
      const closeMatch = afterImage.match(/```image-output:[^\n]*\n[\s\S]*?```/);
      if (closeMatch) {
        insertPos = imageOutputPos + closeMatch[0].length;
      }
    }

    // Create HTML content with an iframe pointing to the HTML file via the asset API
    // The server serves files at /api/file/asset/{absolute-path}
    const assetUrl = `/api/file/asset${htmlPath}`;
    const iframeHtml = `<iframe src="${assetUrl}" style="width:100%;height:600px;border:none;background:white;border-radius:4px;"></iframe>`;

    // Check if there's already an html-rendered block for this execId
    const existingHtmlBlock = doc.indexOf(`\`\`\`html-rendered:${execId}`);
    if (existingHtmlBlock !== -1) {
      // Replace existing html-rendered block
      const restOfDoc = doc.slice(existingHtmlBlock);
      const blockMatch = restOfDoc.match(/^```html-rendered:[^\n]*\n[\s\S]*?```/);
      if (blockMatch) {
        this.dispatchChange({
          from: existingHtmlBlock,
          to: existingHtmlBlock + blockMatch[0].length,
          insert: `\`\`\`html-rendered:${execId}\n${iframeHtml}\n\`\`\``,
        });
        return;
      }
    }

    // Insert new html-rendered block
    this.dispatchChange({
      from: insertPos,
      insert: `\n\`\`\`html-rendered:${execId}\n${iframeHtml}\n\`\`\``,
    });
  }

  /**
   * Update the status line in an output block
   */
  private updateOutputStatus(execId: string, status: string): void {
    const ctx = this.getUpdateContext(execId);
    if (!ctx) return;

    const doc = ctx.content;
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);
    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);

    // Check if there's an existing status line
    const statusMatch = afterOutput.match(/^\[status:[^\]]+\][^\n]*\n/);

    if (statusMatch) {
      // Replace existing status
      this.applyDocumentChange(
        doc.slice(0, outputStart) + status + '\n' + doc.slice(outputStart + statusMatch[0].length),
        'execution'
      );
    } else {
      // Insert new status at start of output
      this.applyDocumentChange(
        doc.slice(0, outputStart) + status + '\n' + doc.slice(outputStart),
        'execution'
      );
    }
  }

  /**
   * Clear the status line from an output block
   */
  private clearOutputStatus(execId: string): void {
    const ctx = this.getUpdateContext(execId);
    if (!ctx) return;

    const doc = ctx.content;
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);
    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);

    // Remove status line if present
    const statusMatch = afterOutput.match(/^\[status:[^\]]+\][^\n]*\n/);
    if (statusMatch) {
      this.applyDocumentChange(
        doc.slice(0, outputStart) + doc.slice(outputStart + statusMatch[0].length),
        'execution'
      );
    }
  }

  /**
   * Dispatch a change to the editor
   * Uses CRDT when available, otherwise direct dispatch
   */
  private dispatchChange(change: { from: number; to?: number; insert: string }): void {
    if (this.documentCallbacks) {
      // Build new content and apply via CRDT
      const doc = this.view.state.doc.toString();
      const to = change.to ?? change.from;
      const newContent = doc.slice(0, change.from) + change.insert + doc.slice(to);
      this.documentCallbacks.applyChange(newContent, 'execution');
    } else {
      // Direct dispatch
      this.view.dispatch({ changes: change });
    }
  }

  /**
   * Apply a document change, respecting CRDT and file callbacks
   */
  private applyDocumentChange(newContent: string, origin: string): void {
    if (this.documentCallbacks) {
      this.documentCallbacks.applyChange(newContent, origin);
    } else {
      // Fall back to full document replacement
      this.view.dispatch({
        changes: {
          from: 0,
          to: this.view.state.doc.length,
          insert: newContent,
        },
      });
    }
  }


  /**
   * Get the content to update and whether to update view or AppState
   * Returns null if file/content not found
   */
  private getUpdateContext(execId: string): {
    content: string;
    isCurrentFile: boolean;
    filePath: string | null;
  } | null {
    const execution = this.running.get(execId);
    const executionFilePath = execution?.filePath ?? null;

    // Check if we have file callbacks and if this file is in background
    if (this.fileCallbacks && executionFilePath) {
      const currentFilePath = this.fileCallbacks.getCurrentFilePath();

      if (currentFilePath !== executionFilePath) {
        // File is in background - get content from AppState
        const fileContent = this.fileCallbacks.getFileContent(executionFilePath);
        if (fileContent !== null) {
          return {
            content: fileContent,
            isCurrentFile: false,
            filePath: executionFilePath,
          };
        }
      }
    }

    // File is current or no callbacks - use view content
    return {
      content: this.view.state.doc.toString(),
      isCurrentFile: true,
      filePath: executionFilePath,
    };
  }

  /**
   * Replace entire output block content
   * Uses throttling to avoid performance issues during rapid streaming
   */
  private replaceOutputContent(execId: string, content: string): void {
    // Store the pending write
    this.pendingWrites.set(execId, content);

    // Check if we already have a throttle timer for this execId
    if (this.writeThrottleTimers.has(execId)) {
      return; // Will be handled by existing timer
    }

    // Set up throttled write
    const timer = setTimeout(() => {
      this.writeThrottleTimers.delete(execId);
      const pendingContent = this.pendingWrites.get(execId);
      if (pendingContent !== undefined) {
        this.pendingWrites.delete(execId);
        this.doReplaceOutputContent(execId, pendingContent);
      }
    }, this.writeThrottleMs);

    this.writeThrottleTimers.set(execId, timer);

    // Also do an immediate write for the first chunk
    if (!this.pendingWrites.has(execId + '_initial')) {
      this.pendingWrites.set(execId + '_initial', 'done');
      this.doReplaceOutputContent(execId, content);
    }
  }

  /**
   * Actually replace output content (after throttling)
   */
  private doReplaceOutputContent(execId: string, content: string): void {
    const ctx = this.getUpdateContext(execId);
    if (!ctx) return;

    const doc = ctx.content;
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);

    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const existingContent = closingMatch[1];

    // Preserve any status line at the start
    const statusMatch = existingContent.match(/^(\[status:[^\]]+\][^\n]*\n)/);
    const statusLine = statusMatch ? statusMatch[1] : '';

    // Ensure content ends with newline so closing fence is on its own line
    const finalContent = content && !content.endsWith('\n') ? content + '\n' : content;
    const fullContent = statusLine + finalContent;

    // Build new document content
    const newDocContent =
      doc.slice(0, outputStart) +
      fullContent +
      doc.slice(outputStart + existingContent.length);

    // Apply via CRDT if available
    if (this.documentCallbacks) {
      this.documentCallbacks.applyChange(newDocContent, 'execution');
    } else if (ctx.isCurrentFile) {
      // Update view directly
      const replaceFrom = outputStart;
      const replaceTo = outputStart + existingContent.length;
      this.view.dispatch({
        changes: { from: replaceFrom, to: replaceTo, insert: fullContent },
      });
    } else if (ctx.filePath && this.fileCallbacks) {
      // Update AppState for background file
      this.fileCallbacks.updateFileContent(ctx.filePath, newDocContent);
    }
  }

  /**
   * Flush any pending writes immediately (call before completion)
   */
  flushPendingWrites(execId: string): void {
    const timer = this.writeThrottleTimers.get(execId);
    if (timer) {
      clearTimeout(timer);
      this.writeThrottleTimers.delete(execId);
    }

    const pendingContent = this.pendingWrites.get(execId);
    if (pendingContent !== undefined) {
      this.pendingWrites.delete(execId);
      this.doReplaceOutputContent(execId, pendingContent);
    }
  }

  /**
   * Append text to an output block (used for errors)
   */
  private appendToOutput(execId: string, text: string): void {
    if (!text) return;

    const ctx = this.getUpdateContext(execId);
    if (!ctx) return;

    const doc = ctx.content;
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);

    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const insertPos = outputStart + closingMatch[1].length;

    if (ctx.isCurrentFile) {
      // Update view directly
      this.view.dispatch({
        changes: { from: insertPos, insert: text },
      });
    } else if (ctx.filePath && this.fileCallbacks) {
      // Update AppState for background file
      const newContent = doc.slice(0, insertPos) + text + doc.slice(insertPos);
      this.fileCallbacks.updateFileContent(ctx.filePath, newContent);
    }
  }

  /**
   * Ensure output block ends with newline before closing fence
   */
  ensureOutputNewline(execId: string): void {
    const ctx = this.getUpdateContext(execId);
    if (!ctx) return;

    const doc = ctx.content;

    // Find the output block - try both with and without the execId
    const markers = [
      `\`\`\`output:${execId}\n`,
      `\`\`\`output:${execId}`,
    ];

    let markerPos = -1;
    let marker = '';
    for (const m of markers) {
      markerPos = doc.indexOf(m);
      if (markerPos !== -1) {
        marker = m;
        break;
      }
    }

    if (markerPos === -1) return;

    // Find content after the marker (after the newline following marker)
    let outputStart = markerPos + marker.length;
    // Skip newline if marker doesn't include it
    if (!marker.endsWith('\n') && doc[outputStart] === '\n') {
      outputStart++;
    }

    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const content = closingMatch[1];

    // Check if content doesn't end with newline (and has content)
    if (content.length > 0 && !content.endsWith('\n')) {
      const insertPos = outputStart + content.length;

      if (ctx.isCurrentFile) {
        this.view.dispatch({
          changes: { from: insertPos, insert: '\n' },
        });
      } else if (ctx.filePath && this.fileCallbacks) {
        const newContent = doc.slice(0, insertPos) + '\n' + doc.slice(insertPos);
        this.fileCallbacks.updateFileContent(ctx.filePath, newContent);
      }
    }
  }

  /**
   * Get set of file paths that have running executions
   */
  getRunningFiles(): Set<string> {
    const files = new Set<string>();
    for (const { filePath } of this.running.values()) {
      if (filePath) files.add(filePath);
    }
    return files;
  }
}

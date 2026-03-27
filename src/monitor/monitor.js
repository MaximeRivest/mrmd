/**
 * Runtime Monitor
 *
 * Main monitor class that connects to the mrmd sync subsystem as a Yjs peer
 * and handles execution requests.
 *
 * @module mrmd/monitor/monitor
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import { CoordinationProtocol, EXECUTION_STATUS } from './coordination.js';
import { DocumentWriter } from './document.js';
import { ExecutionHandler } from './execution.js';
import { TerminalBuffer } from './terminal.js';
import { createTableJobsBridge } from './tables/index.js';

/**
 * @typedef {Object} MonitorOptions
 * @property {string} [name='mrmd-monitor'] - Monitor name for Awareness
 * @property {string} [color='#10b981'] - Monitor color for Awareness
 * @property {Function} [log] - Logger function
 * @property {number} [outputFlushMs=100] - Throttle interval for Yjs output writes
 * @property {boolean} [enableTableJobs=true] - Whether to run the linked-table bridge
 * @property {string} [projectRoot] - Project root used for linked-table asset paths
 * @property {string} [cwd] - Working directory for linked-table subprocesses
 * @property {object} [fs] - Optional filesystem adapter for linked-table jobs
 * @property {Function} [exec] - Optional materialization executor override for linked-table jobs
 */

/**
 * Runtime Monitor
 *
 * Connects to mrmd-sync as a Yjs peer and handles execution requests.
 */
export class RuntimeMonitor {
  /**
   * @param {string} syncUrl - WebSocket URL for mrmd-sync
   * @param {string} docPath - Document path/room name
   * @param {MonitorOptions} [options]
   */
  constructor(syncUrl, docPath, options = {}) {
    /** @type {string} */
    this.syncUrl = syncUrl;

    /** @type {string} */
    this.docPath = docPath;

    /** @type {MonitorOptions} */
    this.options = {
      name: 'mrmd-monitor',
      color: '#10b981',
      log: console.log,
      outputFlushMs: 100,
      enableTableJobs: true,
      ...options,
    };

    /** @type {Y.Doc} */
    this.ydoc = new Y.Doc();

    /** @type {WebsocketProvider|null} */
    this.provider = null;

    /** @type {CoordinationProtocol|null} */
    this.coordination = null;

    /** @type {DocumentWriter|null} */
    this.writer = null;

    /** @type {ExecutionHandler} */
    this.executor = new ExecutionHandler();

    /** @type {import('./tables/index.js').TableJobsBridge|null} */
    this.tableJobsBridge = null;

    /** @type {boolean} */
    this._connected = false;

    /** @type {boolean} */
    this._synced = false;

    /** @type {Function|null} */
    this._unsubscribe = null;

    /** @type {Set<string>} */
    this._processingExecutions = new Set();
  }

  /**
   * Log helper
   * @param {string} level
   * @param {string} message
   * @param {Object} [data]
   */
  _log(level, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      component: 'monitor',
      message,
      ...data,
    };
    this.options.log(JSON.stringify(entry));
  }

  /**
   * Connect to mrmd-sync
   *
   * @returns {Promise<void>} Resolves when connected and synced
   */
  connect() {
    return new Promise((resolve, reject) => {
      this._log('info', 'Connecting to sync server', { url: this.syncUrl, doc: this.docPath });

      this.provider = new WebsocketProvider(this.syncUrl, this.docPath, this.ydoc, {
        connect: true,
        // In the daemon there is no same-document multi-tab browser context, so
        // BroadcastChannel sync is unnecessary and only adds more moving pieces.
        disableBc: true,
        // Node.js doesn't have a global WebSocket — provide the ws polyfill.
        WebSocketPolyfill: WebSocket,
      });

      // Set up awareness
      this.provider.awareness.setLocalStateField('user', {
        name: this.options.name,
        color: this.options.color,
        type: 'monitor',
      });

      // Track connection status
      this.provider.on('status', ({ status }) => {
        const wasConnected = this._connected;
        this._connected = status === 'connected';

        if (this._connected && !wasConnected) {
          this._log('info', 'Connected to sync server');
        } else if (!this._connected && wasConnected) {
          this._log('warn', 'Disconnected from sync server');
        }
      });

      // Wait for sync
      // Note: y-websocket 2.x uses 'sync' event with boolean parameter
      this.provider.on('sync', (isSynced) => {
        if (isSynced && !this._synced) {
          this._synced = true;
          this._log('info', 'Document synced');

          // Initialize coordination and writer
          this.coordination = new CoordinationProtocol(this.ydoc, this.ydoc.clientID);
          this.writer = new DocumentWriter(this.ydoc);

          // Start linked-table bridge before watchers begin consuming jobs
          this._startTableJobsBridge();

          // Start watching for execution requests
          this._startWatching();

          resolve();
        }
      });

      // Handle connection errors
      this.provider.on('connection-error', (err) => {
        this._log('error', 'Connection error', { error: err.message });
        reject(err);
      });
    });
  }

  /**
   * Start the linked-table `tableJobs` bridge.
   */
  _startTableJobsBridge() {
    if (this.tableJobsBridge || this.options.enableTableJobs === false) {
      return;
    }

    this._log('info', 'Starting linked-table bridge', {
      projectRoot: this.options.projectRoot || null,
    });

    this.tableJobsBridge = createTableJobsBridge({
      ydoc: this.ydoc,
      clientId: this.ydoc.clientID,
      textName: 'content',
      projectRoot: this.options.projectRoot,
      documentPath: this.docPath,
      cwd: this.options.cwd,
      fs: this.options.fs,
      exec: this.options.exec,
      logger: {
        debug: (message, data = {}) => this._log('debug', String(message), data),
        info: (message, data = {}) => this._log('info', String(message), data),
        warn: (message, data = {}) => this._log('warn', String(message), data),
        error: (message, data = {}) => this._log('error', String(message), data),
      },
    });
  }

  /**
   * Start watching for execution requests
   */
  _startWatching() {
    this._log('info', 'Starting execution watcher');

    this._unsubscribe = this.coordination.observe((execId, exec, action) => {
      if (!exec) return;

      this._log('debug', `Execution event: ${execId} status=${exec.status} action=${action} claimedBy=${exec.claimedBy} myId=${this.ydoc.clientID}`);

      // Handle cancellations
      if (exec.status === EXECUTION_STATUS.CANCELLED && exec.claimedBy === this.ydoc.clientID) {
        this._handleCancellation(execId, exec);
        return;
      }

      // Handle new requests
      if (exec.status === EXECUTION_STATUS.REQUESTED) {
        this._handleRequest(execId, exec);
      }

      // Handle ready (output block created)
      if (exec.status === EXECUTION_STATUS.READY && exec.claimedBy === this.ydoc.clientID) {
        this._handleReady(execId, exec);
      }

      // Handle stdin responses
      if (exec.stdinResponse && exec.claimedBy === this.ydoc.clientID) {
        this._handleStdinResponse(execId, exec);
      }
    });

    // Also check for any existing requests we might have missed
    this._checkExistingRequests();
  }

  /**
   * Check for existing requests on startup
   */
  _checkExistingRequests() {
    const requested = this.coordination.getExecutionsByStatus(EXECUTION_STATUS.REQUESTED);
    for (const exec of requested) {
      this._handleRequest(exec.id, exec);
    }

    // Also check for any we claimed but didn't start (e.g., after restart)
    const ready = this.coordination.getExecutionsByStatus(EXECUTION_STATUS.READY);
    for (const exec of ready) {
      if (exec.claimedBy === this.ydoc.clientID) {
        this._handleReady(exec.id, exec);
      }
    }
  }

  /**
   * Handle cancellation
   *
   * @param {string} execId
   * @param {Object} exec
   */
  _handleCancellation(execId, exec) {
    if (!this._processingExecutions.has(execId)) return;

    this._log('info', 'Execution cancelled by user', { execId });
    this.executor.cancel(execId);
    this._processingExecutions.delete(execId);
  }

  /**
   * Handle execution request
   *
   * @param {string} execId
   * @param {Object} exec
   */
  _handleRequest(execId, exec) {
    // Don't claim if already processing
    if (this._processingExecutions.has(execId)) return;

    this._log('info', 'New execution request', { execId, language: exec.language });

    // Try to claim it
    const claimed = this.coordination.claimExecution(execId);
    if (claimed) {
      this._log('info', 'Claimed execution', { execId });
      this._processingExecutions.add(execId);

      // If no browser creates the output block within 1s, we create it
      // ourselves and transition to READY. This supports headless execution
      // via doc.execute where there is no browser.
      setTimeout(() => {
        const current = this.coordination.executions.get(execId);
        if (current && current.status === EXECUTION_STATUS.CLAIMED) {
          this._log('info', 'No browser created output block — creating headlessly', { execId });
          this._createOutputBlockAndReady(execId, exec);
        }
      }, 1000);
    } else {
      this._log('debug', 'Could not claim execution (already claimed)', { execId });
    }
  }

  /**
   * Create an output block in the Yjs document and transition to READY.
   * Used for headless execution when no browser is present.
   *
   * Matches the Electron editor's behavior:
   *   - If an output block already exists after the code cell, replace it
   *   - Otherwise, insert a new output block after the code cell
   *   - Never create duplicate output blocks
   */
  _createOutputBlockAndReady(execId, exec) {
    try {
      const ytext = this.ydoc.getText('content');
      const text = ytext.toString();

      // Find the code block that matches this execution's code
      const codeCell = this._findCodeCell(text, exec.code, exec.language);

      if (!codeCell) {
        this._log('warn', 'Could not find code cell in document to insert output block', { execId });
        // Insert at end of document as fallback
        this._insertOutputBlock(execId, text.length);
      } else {
        // Check for an existing output block immediately after this code cell
        const existingOutput = this._findOutputBlockAfterCell(text, codeCell.end);

        if (existingOutput) {
          // Replace the existing output block with a fresh one for this execId
          this._log('debug', 'Replacing existing output block', { execId, oldStart: existingOutput.start, oldEnd: existingOutput.end });
          this._replaceOutputBlock(execId, existingOutput.start, existingOutput.end);
        } else {
          // Insert a new output block after the code cell's closing fence
          this._insertOutputBlock(execId, codeCell.end);
        }
      }

      // Transition to READY
      this.coordination.setOutputBlockReady(execId);
    } catch (err) {
      this._log('error', 'Failed to create output block headlessly', {
        execId, error: err.message,
      });
      this.coordination.setError(execId, {
        type: 'MonitorError',
        message: `Failed to create output block: ${err.message}`,
      });
      this._processingExecutions.delete(execId);
    }
  }

  /**
   * Parse all fenced code blocks in the document using a line-by-line
   * state machine. This is the only correct approach — regexes can't
   * handle sequential fenced blocks because ``` is ambiguous without state.
   *
   * Matches the approach used by mrmd-editor/src/cells.js.
   *
   * @param {string} text - Full document text
   * @returns {Array<{ language: string, code: string, start: number, end: number, codeStart: number, codeEnd: number }>}
   */
  _parseCodeBlocks(text) {
    const blocks = [];
    const lines = text.split('\n');

    let inBlock = false;
    let blockStart = 0;
    let blockLang = '';
    let codeStart = 0;
    let charOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = charOffset;

      if (!inBlock) {
        // Opening fence: ```language or ```language context
        const match = line.match(/^(`{3,})([\w:.-]*)(?:\s+\S+)?[\t ]*$/);
        if (match) {
          inBlock = true;
          blockStart = lineStart;
          blockLang = (match[2] || '').toLowerCase();
          codeStart = lineStart + line.length + 1; // after the newline
        }
      } else {
        // Closing fence
        if (line.match(/^`{3,}\s*$/)) {
          const codeEnd = lineStart;
          const blockEnd = lineStart + line.length;

          blocks.push({
            language: blockLang,
            code: text.slice(codeStart, codeEnd),
            start: blockStart,
            end: blockEnd,
            codeStart,
            codeEnd,
          });

          inBlock = false;
        }
      }

      charOffset += line.length + 1; // +1 for the newline
    }

    return blocks;
  }

  /**
   * Find a code cell in the document by matching its code content.
   * Uses the state-machine parser, not regex.
   *
   * @param {string} text - Full document text
   * @param {string} code - Code to find
   * @param {string} language - Language identifier
   * @returns {{ start: number, end: number }|null}
   */
  _findCodeCell(text, code, language) {
    const blocks = this._parseCodeBlocks(text);
    const trimmedCode = code.trim();

    for (const block of blocks) {
      // Skip output/stdin blocks
      if (block.language.startsWith('output') || block.language.startsWith('stdin')) continue;

      if (block.code.trim() === trimmedCode) {
        // end: include the trailing newline after closing fence if present
        const endPos = text[block.end] === '\n' ? block.end + 1 : block.end;
        return { start: block.start, end: endPos };
      }
    }

    return null;
  }

  /**
   * Find an output block immediately following a code cell.
   * Scans the parsed blocks to find the next block after cellEnd
   * that is an output block.
   *
   * @param {string} text - Full document text
   * @param {number} cellEnd - Position after the code cell ends
   * @returns {{ start: number, end: number }|null}
   */
  _findOutputBlockAfterCell(text, cellEnd) {
    const blocks = this._parseCodeBlocks(text);

    for (const block of blocks) {
      // Skip blocks before our cell
      if (block.start < cellEnd) continue;

      // Check if there's only whitespace between cellEnd and this block
      const gap = text.slice(cellEnd, block.start);
      if (gap.trim().length > 0) {
        // Non-whitespace content between cell and this block — it's not
        // a paired output block, it's a separate content section
        return null;
      }

      // Is it an output block?
      if (block.language.startsWith('output')) {
        // Include trailing newline in the end position
        const endPos = text[block.end] === '\n' ? block.end + 1 : block.end;
        return { start: block.start, end: endPos };
      }

      // It's some other block right after our cell — no output block exists
      return null;
    }

    return null;
  }

  /**
   * Insert a new output block at a position in the Y.Text.
   */
  _insertOutputBlock(execId, position) {
    const ytext = this.ydoc.getText('content');
    this.ydoc.transact(() => {
      const block = `\n\`\`\`output:${execId}\n\`\`\`\n`;
      ytext.insert(position, block);
    });
  }

  /**
   * Remove an output block entirely (used when execution produces no output).
   */
  _removeOutputBlock(execId) {
    const ytext = this.ydoc.getText('content');
    const text = ytext.toString();
    const blocks = this._parseCodeBlocks(text);

    for (const block of blocks) {
      if (block.language === `output:${execId}` || block.language.startsWith(`output:${execId}`)) {
        // Remove the block including any leading newline
        const removeStart = block.start > 0 && text[block.start - 1] === '\n'
          ? block.start - 1
          : block.start;
        const removeEnd = text[block.end] === '\n' ? block.end + 1 : block.end;

        this.ydoc.transact(() => {
          ytext.delete(removeStart, removeEnd - removeStart);
        });
        this._log('debug', 'Removed empty output block', { execId });
        return;
      }
    }
  }

  /**
   * Replace an existing output block with a fresh empty one.
   */
  _replaceOutputBlock(execId, start, end) {
    const ytext = this.ydoc.getText('content');
    this.ydoc.transact(() => {
      const text = ytext.toString();
      const hadTrailingNewline = end > start && text[end - 1] === '\n';
      const newBlock = hadTrailingNewline
        ? `\`\`\`output:${execId}\n\`\`\`\n`
        : `\`\`\`output:${execId}\n\`\`\``;
      const length = end - start;
      if (length > 0) {
        ytext.delete(start, length);
      }
      ytext.insert(start, newBlock);
    });
  }

  /**
   * Handle execution ready (output block created)
   *
   * @param {string} execId
   * @param {Object} exec
   */
  async _handleReady(execId, exec) {
    // Don't start twice
    if (this.executor.isActive(execId)) return;

    // Wait for output block to be synced to our ydoc
    // The browser created the output block, but Yjs sync may not have propagated it yet
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max
    while (!this.writer.hasOutputBlock(execId) && attempts < maxAttempts) {
      // Re-fetch execution to ensure it hasn't been cancelled while we're waiting
      const currentExec = this.coordination.executions.get(execId);
      if (currentExec && currentExec.status === EXECUTION_STATUS.CANCELLED) {
        this._log('info', 'Execution cancelled while waiting for output block sync', { execId });
        this._processingExecutions.delete(execId);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!this.writer.hasOutputBlock(execId)) {
      this._log('error', 'Output block not synced after timeout', { execId, attempts });
      this.coordination.setError(execId, {
        type: 'SyncError',
        message: 'Output block not synced to monitor. Try again.',
      });
      this._processingExecutions.delete(execId);
      return;
    }

    if (attempts > 0) {
      this._log('debug', 'Waited for output block sync', { execId, attempts, ms: attempts * 100 });
    }

    this._log('info', 'Starting execution', { execId, language: exec.language });

    // Mark as running
    this.coordination.setRunning(execId);

    try {
      // Use TerminalBuffer to process output (handles \r, ANSI, progress bars)
      const buffer = new TerminalBuffer();

      // Throttle Yjs writes to avoid CRDT churn on high-frequency output
      const outputFlushMs = Number.isFinite(this.options.outputFlushMs)
        ? Math.max(0, this.options.outputFlushMs)
        : 100;
      let latestOutput = '';
      let flushTimer = null;

      const flushOutputNow = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        this.writer.replaceOutput(execId, latestOutput);
      };

      const scheduleFlush = () => {
        if (outputFlushMs === 0) {
          flushOutputNow();
          return;
        }
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          this.writer.replaceOutput(execId, latestOutput);
        }, outputFlushMs);
      };

      await this.executor.execute(exec.runtimeUrl, exec.code, {
        execId,
        callbacks: {
          onStdout: (chunk, accumulated) => {
            // Process through terminal buffer for proper cursor/ANSI handling
            buffer.write(chunk);
            latestOutput = buffer.toString();
            scheduleFlush();
          },

          onStderr: (chunk, accumulated) => {
            // Process stderr through buffer too
            buffer.write(chunk);
            latestOutput = buffer.toString();
            scheduleFlush();
          },

          onStdinRequest: (request) => {
            // Ensure prompt/output is visible immediately before asking for input
            flushOutputNow();
            this._log('info', 'Stdin request received from runtime', {
              execId,
              prompt: request.prompt,
              password: request.password
            });
            this.coordination.requestStdin(execId, {
              prompt: request.prompt,
              password: request.password,
            });
            this._log('info', 'Stdin request stored in Y.Map', { execId });
          },

          onDisplay: (display) => {
            this._log('debug', 'Display data', { execId, mimeType: display.mimeType });
            this.coordination.addDisplayData(execId, display);
          },

          onResult: (result) => {
            flushOutputNow();
            this._log('info', 'Execution completed', { execId, success: result.success });

            // Clean up empty output blocks — if no output was produced,
            // remove the block entirely so the document stays clean.
            if (!latestOutput.trim()) {
              this._removeOutputBlock(execId);
            }

            this.coordination.setCompleted(execId, {
              result: result.result,
              displayData: result.displayData,
            });
          },

          onError: (error) => {
            flushOutputNow();
            this._log('error', 'Execution error', { execId, error: error.message });

            // Write the error message into the output block so it's visible
            const errorText = error.message || error.type || 'Unknown error';
            if (!latestOutput.trim()) {
              // Only error output — put it in the block
              this.writer.replaceOutput(execId, errorText + '\n');
            }

            this.coordination.setError(execId, error);
          },
        },
      });

      if (flushTimer) {
        clearTimeout(flushTimer);
      }

    } catch (err) {
      this._log('error', 'Execution failed', { execId, error: err.message });
      this.coordination.setError(execId, {
        type: 'MonitorError',
        message: err.message,
      });

    } finally {
      this._processingExecutions.delete(execId);
    }
  }

  /**
   * Handle stdin response from browser
   *
   * @param {string} execId
   * @param {Object} exec
   */
  async _handleStdinResponse(execId, exec) {
    if (!exec.stdinResponse) return;

    this._log('info', 'Stdin response received, sending to runtime', {
      execId,
      text: exec.stdinResponse.text
    });

    try {
      const result = await this.executor.sendInput(
        exec.runtimeUrl,
        execId,
        exec.stdinResponse.text
      );

      this._log('info', 'Stdin sent to runtime', { execId, result });

      // Clear the request
      this.coordination.clearStdinRequest(execId);

    } catch (err) {
      this._log('error', 'Failed to send stdin', { execId, error: err.message });
    }
  }

  /**
   * Disconnect from sync server
   */
  disconnect() {
    this._log('info', 'Disconnecting');

    // Cancel active executions
    this.executor.cancelAll();

    // Stop watching
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // Clean up coordination
    if (this.coordination) {
      this.coordination.destroy();
      this.coordination = null;
    }

    if (this.tableJobsBridge) {
      this.tableJobsBridge.destroy();
      this.tableJobsBridge = null;
    }

    // Disconnect and fully destroy provider so reconnect timers don't keep
    // the daemon process alive when monitors are managed in-process.
    if (this.provider) {
      const provider = this.provider;

      // y-websocket's disconnect path schedules a reconnect timeout from the
      // socket close handler even when shouldConnect=false. Neutralize the live
      // socket first so destroy() can run without creating new timers.
      try {
        provider.shouldConnect = false;
      } catch {}
      try {
        if (provider.ws) {
          provider.ws.onclose = null;
          provider.ws.onerror = null;
          provider.ws.onmessage = null;
          provider.ws.onopen = null;
          try { provider.ws.close(); } catch {}
          provider.ws = null;
          provider.wsconnected = false;
          provider.wsconnecting = false;
        }
      } catch {}

      try {
        provider.destroy?.();
      } catch {}
      this.provider = null;
    }

    this._connected = false;
    this._synced = false;
  }

  /**
   * Check if connected
   *
   * @returns {boolean}
   */
  get isConnected() {
    return this._connected && this._synced;
  }

  /**
   * Get active execution count
   *
   * @returns {number}
   */
  get activeExecutions() {
    return this.executor.activeCount;
  }
}

/**
 * Create and connect a monitor
 *
 * @param {string} syncUrl - WebSocket URL for mrmd-sync
 * @param {string} docPath - Document path/room name
 * @param {MonitorOptions} [options]
 * @returns {Promise<RuntimeMonitor>}
 */
export async function createMonitor(syncUrl, docPath, options = {}) {
  const monitor = new RuntimeMonitor(syncUrl, docPath, options);
  await monitor.connect();
  return monitor;
}

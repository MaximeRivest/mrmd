/**
 * Execution Handler
 *
 * Handles MRP runtime connections and execution streaming.
 *
 * @module mrmd/monitor/execution
 */

/**
 * @typedef {Object} ExecutionCallbacks
 * @property {function(string, string): void} [onStdout] - (chunk, accumulated)
 * @property {function(string, string): void} [onStderr] - (chunk, accumulated)
 * @property {function(Object): void} [onStdinRequest] - stdin request from runtime
 * @property {function(Object): void} [onDisplay] - display data (images, HTML, etc.)
 * @property {function(Object): void} [onResult] - final result
 * @property {function(Object): void} [onError] - execution error
 * @property {function(): void} [onStart] - execution started
 * @property {function(): void} [onDone] - stream complete
 */

/**
 * MRP execution handler
 */
export class ExecutionHandler {
  constructor() {
    /** @type {Map<string, AbortController>} */
    this._activeExecutions = new Map();
  }

  /**
   * Execute code on MRP runtime with streaming
   *
   * @param {string} runtimeUrl - MRP runtime base URL
   * @param {string} code - Code to execute
   * @param {Object} options
   * @param {string} [options.execId] - Execution ID for tracking
   * @param {ExecutionCallbacks} [options.callbacks] - Event callbacks
   * @returns {Promise<Object>} Final result
   */
  async execute(runtimeUrl, code, options = {}) {
    const {
      execId,
      callbacks = {},
    } = options;

    // Set up abort controller
    const abortController = new AbortController();
    if (execId) {
      this._activeExecutions.set(execId, abortController);
    }

    try {
      const response = await fetch(`${runtimeUrl}/execute/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          storeHistory: true,
          execId, // Pass execId so runtimes use the same ID for stdin coordination
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`MRP request failed: ${response.status} ${error}`);
      }

      callbacks.onStart?.();

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let currentEvent = null;
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              finalResult = this._handleEvent(currentEvent, data, callbacks) || finalResult;
            } catch (err) {
              console.warn('[ExecutionHandler] Failed to parse SSE data:', err.message);
            }
          }
        }
      }

      callbacks.onDone?.();
      return finalResult || { success: true };

    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, error: { type: 'Aborted', message: 'Execution cancelled' } };
      }
      callbacks.onError?.({ type: 'ConnectionError', message: err.message });
      throw err;

    } finally {
      if (execId) {
        this._activeExecutions.delete(execId);
      }
    }
  }

  /**
   * Handle SSE event
   *
   * @param {string} event
   * @param {Object} data
   * @param {ExecutionCallbacks} callbacks
   * @returns {Object|null} Result if this is the result event
   */
  _handleEvent(event, data, callbacks) {
    switch (event) {
      case 'start':
        // Execution started on server
        break;

      case 'stdout':
        callbacks.onStdout?.(data.content, data.accumulated);
        break;

      case 'stderr':
        callbacks.onStderr?.(data.content, data.accumulated);
        break;

      case 'stdin_request':
        callbacks.onStdinRequest?.(data);
        break;

      case 'display':
        callbacks.onDisplay?.(data);
        break;

      case 'asset':
        // Asset saved on server - treat similar to display
        callbacks.onDisplay?.({
          mimeType: data.mimeType,
          assetId: data.path,
          url: data.url,
        });
        break;

      case 'result':
        callbacks.onResult?.(data);
        return data;

      case 'error':
        callbacks.onError?.(data);
        return { success: false, error: data };

      case 'done':
        // Stream complete
        break;

      default:
        console.log('[ExecutionHandler] Unknown event:', event, data);
    }

    return null;
  }

  /**
   * Send input to a waiting execution
   *
   * @param {string} runtimeUrl - MRP runtime base URL
   * @param {string} execId - Execution ID
   * @param {string} text - Input text
   * @returns {Promise<{accepted: boolean}>}
   */
  async sendInput(runtimeUrl, execId, text) {
    const response = await fetch(`${runtimeUrl}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exec_id: execId,
        text,
      }),
    });

    return response.json();
  }

  /**
   * Interrupt a running execution
   *
   * @param {string} runtimeUrl - MRP runtime base URL
   * @returns {Promise<{interrupted: boolean}>}
   */
  async interrupt(runtimeUrl) {
    const response = await fetch(`${runtimeUrl}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    return response.json();
  }

  /**
   * Cancel execution by execId (local abort)
   *
   * @param {string} execId
   */
  cancel(execId) {
    const controller = this._activeExecutions.get(execId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Cancel all active executions
   */
  cancelAll() {
    for (const controller of this._activeExecutions.values()) {
      controller.abort();
    }
    this._activeExecutions.clear();
  }

  /**
   * Check if execution is active
   *
   * @param {string} execId
   * @returns {boolean}
   */
  isActive(execId) {
    return this._activeExecutions.has(execId);
  }

  /**
   * Get active execution count
   *
   * @returns {number}
   */
  get activeCount() {
    return this._activeExecutions.size;
  }
}

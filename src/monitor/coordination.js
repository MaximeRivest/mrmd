/**
 * Coordination Protocol
 *
 * Defines the Y.Map schema and protocol for browser/monitor coordination.
 *
 * @module mrmd/monitor/coordination
 */

import * as Y from 'yjs';

/**
 * Execution status values
 */
export const EXECUTION_STATUS = {
  /** Browser has requested execution */
  REQUESTED: 'requested',
  /** Monitor has claimed the execution */
  CLAIMED: 'claimed',
  /** Browser has created output block, ready to start */
  READY: 'ready',
  /** Monitor is streaming output from runtime */
  RUNNING: 'running',
  /** Execution completed successfully */
  COMPLETED: 'completed',
  /** Execution failed with error */
  ERROR: 'error',
  /** Execution was cancelled */
  CANCELLED: 'cancelled',
};

/**
 * @typedef {Object} ExecutionRequest
 * @property {string} id - Unique execution ID
 * @property {string} [cellId] - Cell ID this execution is for
 * @property {string} code - Code to execute
 * @property {string} language - Language identifier
 * @property {string} runtimeUrl - MRP runtime URL
 * @property {string} status - Current status
 * @property {number} requestedBy - Client ID that requested
 * @property {number} requestedAt - Timestamp
 * @property {number} [claimedBy] - Client ID that claimed
 * @property {number} [claimedAt] - Timestamp
 * @property {boolean} outputBlockReady - Whether output block exists in Y.Text
 * @property {Object} [outputPosition] - Yjs RelativePosition JSON
 * @property {number} [startedAt] - Timestamp
 * @property {number} [completedAt] - Timestamp
 * @property {Object} [stdinRequest] - Pending stdin request
 * @property {Object} [stdinResponse] - Response to stdin request
 * @property {*} [result] - Execution result
 * @property {Object} [error] - Execution error
 * @property {Array} [displayData] - Rich outputs
 */

/**
 * Coordination protocol for browser/monitor communication via Y.Map
 */
export class CoordinationProtocol {
  /**
   * @param {Y.Doc} ydoc - Yjs document
   * @param {number} clientId - This client's ID
   */
  constructor(ydoc, clientId) {
    /** @type {Y.Doc} */
    this.ydoc = ydoc;

    /** @type {number} */
    this.clientId = clientId;

    /** @type {Y.Map} */
    this.executions = ydoc.getMap('executions');

    /** @type {Set<Function>} */
    this._observers = new Set();
  }

  /**
   * Generate unique execution ID
   * @returns {string}
   */
  static generateExecId() {
    return `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Request execution (called by browser)
   *
   * @param {Object} options
   * @param {string} options.code
   * @param {string} options.language
   * @param {string} options.runtimeUrl
   * @param {string} [options.cellId]
   * @returns {string} execId
   */
  requestExecution({ code, language, runtimeUrl, cellId }) {
    const execId = CoordinationProtocol.generateExecId();

    this.executions.set(execId, {
      id: execId,
      cellId,
      code,
      language,
      runtimeUrl,
      status: EXECUTION_STATUS.REQUESTED,
      requestedBy: this.clientId,
      requestedAt: Date.now(),
      claimedBy: null,
      claimedAt: null,
      outputBlockReady: false,
      outputPosition: null,
      startedAt: null,
      completedAt: null,
      stdinRequest: null,
      stdinResponse: null,
      result: null,
      error: null,
      displayData: [],
    });

    return execId;
  }

  /**
   * Claim execution (called by monitor)
   *
   * @param {string} execId
   * @returns {boolean} true if claimed successfully
   */
  claimExecution(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return false;

    // Only claim if status is REQUESTED and not already claimed
    if (exec.status !== EXECUTION_STATUS.REQUESTED) return false;
    if (exec.claimedBy !== null) return false;

    // Claim it
    this.executions.set(execId, {
      ...exec,
      status: EXECUTION_STATUS.CLAIMED,
      claimedBy: this.clientId,
      claimedAt: Date.now(),
    });

    return true;
  }

  /**
   * Mark output block as ready (called by browser)
   *
   * @param {string} execId
   * @param {Object} outputPosition - Yjs RelativePosition as JSON
   */
  setOutputBlockReady(execId, outputPosition) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      status: EXECUTION_STATUS.READY,
      outputBlockReady: true,
      outputPosition,
    });
  }

  /**
   * Mark execution as running (called by monitor)
   *
   * @param {string} execId
   */
  setRunning(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      status: EXECUTION_STATUS.RUNNING,
      startedAt: Date.now(),
    });
  }

  /**
   * Mark execution as completed (called by monitor)
   *
   * @param {string} execId
   * @param {Object} options
   * @param {*} [options.result]
   * @param {Array} [options.displayData]
   */
  setCompleted(execId, { result, displayData } = {}) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      status: EXECUTION_STATUS.COMPLETED,
      completedAt: Date.now(),
      result: result ?? null,
      displayData: displayData ?? exec.displayData,
    });
  }

  /**
   * Mark execution as error (called by monitor)
   *
   * @param {string} execId
   * @param {Object} error
   */
  setError(execId, error) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      status: EXECUTION_STATUS.ERROR,
      completedAt: Date.now(),
      error,
    });
  }

  /**
   * Request stdin input (called by monitor)
   *
   * @param {string} execId
   * @param {Object} request
   * @param {string} request.prompt
   * @param {boolean} [request.password]
   */
  requestStdin(execId, { prompt, password = false }) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      stdinRequest: {
        prompt,
        password,
        requestedAt: Date.now(),
      },
      stdinResponse: null,
    });
  }

  /**
   * Respond to stdin request (called by browser)
   *
   * @param {string} execId
   * @param {string} text
   */
  respondStdin(execId, text) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      stdinResponse: {
        text,
        respondedAt: Date.now(),
      },
    });
  }

  /**
   * Clear stdin request after processing (called by monitor)
   *
   * @param {string} execId
   */
  clearStdinRequest(execId) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      stdinRequest: null,
      stdinResponse: null,
    });
  }

  /**
   * Add display data (called by monitor)
   *
   * @param {string} execId
   * @param {Object} display
   * @param {string} display.mimeType
   * @param {string} [display.data]
   * @param {string} [display.assetId]
   */
  addDisplayData(execId, display) {
    const exec = this.executions.get(execId);
    if (!exec) return;

    this.executions.set(execId, {
      ...exec,
      displayData: [...(exec.displayData || []), display],
    });
  }

  /**
   * Get execution by ID
   *
   * @param {string} execId
   * @returns {ExecutionRequest|undefined}
   */
  getExecution(execId) {
    return this.executions.get(execId);
  }

  /**
   * Get all executions with a specific status
   *
   * @param {string} status
   * @returns {ExecutionRequest[]}
   */
  getExecutionsByStatus(status) {
    const results = [];
    this.executions.forEach((exec, id) => {
      if (exec.status === status) {
        results.push(exec);
      }
    });
    return results;
  }

  /**
   * Observe execution changes
   *
   * @param {Function} callback - Called with (execId, execution, changeType)
   * @returns {Function} Unsubscribe function
   */
  observe(callback) {
    const observer = (event) => {
      event.changes.keys.forEach((change, key) => {
        const exec = this.executions.get(key);
        callback(key, exec, change.action);
      });
    };

    this.executions.observe(observer);
    this._observers.add(observer);

    return () => {
      this.executions.unobserve(observer);
      this._observers.delete(observer);
    };
  }

  /**
   * Clean up observers
   */
  destroy() {
    for (const observer of this._observers) {
      this.executions.unobserve(observer);
    }
    this._observers.clear();
  }
}

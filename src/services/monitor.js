/**
 * MonitorService
 *
 * Manages in-process monitor instances — one per document.
 * Each monitor is a headless Yjs peer that coordinates code execution,
 * ensuring long-running cells complete even if the editor disconnects.
 */

import { EventEmitter } from 'events';
import { RuntimeMonitor } from '../monitor/monitor.js';

const ACTIVE_STATUSES = new Set(['requested', 'claimed', 'ready', 'running']);
const TERMINAL_STATUSES = new Set(['completed', 'error', 'cancelled']);

export class MonitorService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { monitor: RuntimeMonitor, syncPort: number, startedAt: string, options: object }>} */
    this._monitors = new Map();

    /**
     * Per-monitor execution status cache for change detection.
     * Keyed by documentPath → Map<execId, lastKnownStatus>.
     * @type {Map<string, Map<string, string>>}
     */
    this._execStatusCache = new Map();
  }

  /**
   * Start a monitor for a document, or return the existing one.
   *
   * @param {string} documentPath - Document path (also used as Yjs room name)
   * @param {number} syncPort - Port of the sync server to connect to
   * @param {object} [options]
   * @param {string} [options.projectRoot] - Project root for linked-table assets
   * @param {string} [options.cwd] - Working directory for linked-table subprocesses
   * @returns {Promise<MonitorInfo>}
   */
  async ensure(documentPath, syncPort, options = {}) {
    const existing = this._monitors.get(documentPath);
    if (existing?.monitor?.isConnected) {
      return this._info(documentPath, existing);
    }

    // Clean up stale/disconnected entry
    if (existing) {
      try { existing.monitor.disconnect(); } catch {}
      this._monitors.delete(documentPath);
    }

    const syncUrl = `ws://127.0.0.1:${syncPort}`;

    const monitor = new RuntimeMonitor(syncUrl, documentPath, {
      name: 'mrmd-daemon',
      projectRoot: options.projectRoot,
      cwd: options.cwd,
      log: (entry) => {
        try {
          const parsed = JSON.parse(entry);
          console.log(`[monitor:${documentPath}] [${parsed.level}] ${parsed.message}`);
        } catch {
          console.log(`[monitor:${documentPath}]`, entry);
        }
      },
    });

    await monitor.connect();

    const entry = {
      monitor,
      syncPort,
      startedAt: new Date().toISOString(),
      options,
    };

    this._monitors.set(documentPath, entry);

    // Subscribe to execution status changes for broadcasting to heads
    this._subscribeToExecutionChanges(documentPath, monitor);

    const info = this._info(documentPath, entry);
    console.log(`[monitor] Started for ${documentPath} (sync port ${syncPort})`);
    this.emit('monitor:started', info);

    return info;
  }

  /**
   * Stop a document's monitor.
   * Cancels active executions and disconnects from sync.
   *
   * @param {string} documentPath
   */
  async stop(documentPath) {
    const entry = this._monitors.get(documentPath);
    if (!entry) return;

    this._monitors.delete(documentPath);
    this._execStatusCache.delete(documentPath);
    console.log(`[monitor] Stopping for ${documentPath}`);

    try {
      entry.monitor.disconnect();
    } catch (err) {
      console.error(`[monitor] Error stopping ${documentPath}:`, err.message);
    }

    this.emit('monitor:stopped', { documentPath, syncPort: entry.syncPort });
  }

  /**
   * List running monitors. Prunes disconnected entries.
   * @returns {MonitorInfo[]}
   */
  list() {
    const result = [];
    const stale = [];

    for (const [documentPath, entry] of this._monitors) {
      if (!entry.monitor.isConnected) {
        stale.push(documentPath);
        continue;
      }
      result.push(this._info(documentPath, entry));
    }

    // Clean up disconnected monitors
    for (const path of stale) {
      this._monitors.delete(path);
    }

    return result;
  }

  /**
   * Get a running monitor's info by document path.
   * @param {string} documentPath
   * @returns {MonitorInfo|null}
   */
  get(documentPath) {
    const entry = this._monitors.get(documentPath);
    if (!entry || !entry.monitor.isConnected) return null;
    return this._info(documentPath, entry);
  }

  /**
   * Request code execution in a monitored document.
   *
   * Writes a REQUESTED entry into the Yjs executions map.
   * The monitor claims it and routes it to the runtime.
   *
   * @param {string} documentPath
   * @param {object} opts
   * @param {string} opts.code
   * @param {string} opts.language
   * @param {string} [opts.cellId]
   * @param {string} [opts.runtimeUrl] - Auto-resolved from RuntimeService if omitted
   * @returns {Promise<{ execId: string }>}
   */
  async execute(documentPath, opts) {
    const entry = this._monitors.get(documentPath);
    if (!entry || !entry.monitor.isConnected) {
      throw new Error(`No active monitor for ${documentPath}`);
    }
    if (!entry.monitor.coordination) {
      throw new Error(`Monitor for ${documentPath} is not yet synchronized`);
    }

    const runtimeUrl = opts.runtimeUrl || null;

    const execId = entry.monitor.coordination.requestExecution({
      code: opts.code,
      language: opts.language,
      runtimeUrl,
      cellId: opts.cellId,
    });

    return { execId };
  }

  /**
   * Get one execution by ID for a document.
   * @param {string} documentPath
   * @param {string} execId
   * @returns {any|null}
   */
  getExecution(documentPath, execId) {
    const entry = this._monitors.get(documentPath);
    const coord = entry?.monitor?.coordination;
    if (!coord) return null;
    return coord.executions.get(execId) || null;
  }

  /**
   * List executions for a document.
   * @param {string} documentPath
   * @returns {Array<any>}
   */
  listExecutions(documentPath) {
    const entry = this._monitors.get(documentPath);
    const coord = entry?.monitor?.coordination;
    if (!coord) return [];
    const result = [];
    coord.executions.forEach((exec) => result.push(exec));
    return result;
  }

  /**
   * Interrupt/cancel executions for a document.
   *
   * Sets execution status to CANCELLED in the Yjs coordination map
   * and aborts the monitor's local SSE stream processing. The daemon
   * is responsible for asking the runtime to interrupt itself first.
   *
   * @param {string} documentPath
   * @param {string} [execId] - Cancel a specific execution, or all if omitted
   * @returns {Promise<{ ok: true, cancelled: string[] }>}
   */
  async interrupt(documentPath, execId) {
    const entry = this._monitors.get(documentPath);
    if (!entry || !entry.monitor.isConnected) {
      throw new Error(`No active monitor for ${documentPath}`);
    }

    const coord = entry.monitor.coordination;
    if (!coord) throw new Error(`Monitor for ${documentPath} is not yet synchronized`);

    const cancelled = [];

    const cancelOne = (id) => {
      const exec = coord.executions.get(id);
      if (!exec) return;
      const active = ['requested', 'claimed', 'ready', 'running'];
      if (!active.includes(exec.status)) return;

      console.log(`[monitor] Stopping ${id} (status=${exec.status})`);

      // Cancel via coordination so every head sees the stop immediately.
      coord.executions.set(id, {
        ...exec,
        status: 'cancelled',
        completedAt: Date.now(),
      });

      // Abort the monitor's local SSE fetch.
      entry.monitor.executor.cancel(id);

      cancelled.push(id);
    };

    if (execId) {
      cancelOne(execId);
    } else {
      const ids = [];
      coord.executions.forEach((_, id) => ids.push(id));
      ids.forEach(cancelOne);
    }

    console.log(`[monitor] Stopped ${cancelled.length} execution(s) for ${documentPath}`);
    return { ok: true, cancelled };
  }

  // ── Cross-document execution visibility ──────────────────

  /**
   * List executions across all monitored documents.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.active] - Only non-terminal statuses (requested/claimed/ready/running)
   * @param {string} [opts.documentPath] - Filter to one document
   * @param {string} [opts.language] - Filter by language
   * @param {number} [opts.limit] - Max results
   * @returns {Array<object>}
   */
  listAllExecutions(opts = {}) {
    const results = [];

    for (const [documentPath, entry] of this._monitors) {
      if (opts.documentPath && documentPath !== opts.documentPath) continue;

      const coord = entry.monitor?.coordination;
      if (!coord) continue;

      coord.executions.forEach((exec) => {
        if (opts.active && !ACTIVE_STATUSES.has(exec.status)) return;
        if (opts.language && exec.language !== opts.language) return;

        results.push({
          execId: exec.id,
          documentPath,
          language: exec.language,
          status: exec.status,
          code: exec.code,
          cellId: exec.cellId || null,
          runtimeUrl: exec.runtimeUrl || null,
          requestedAt: exec.requestedAt,
          startedAt: exec.startedAt,
          completedAt: exec.completedAt,
          error: exec.error || null,
        });
      });
    }

    // Sort: active first (by requestedAt), then terminal (by completedAt desc)
    results.sort((a, b) => {
      const aActive = ACTIVE_STATUSES.has(a.status);
      const bActive = ACTIVE_STATUSES.has(b.status);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      if (aActive) return (a.requestedAt || 0) - (b.requestedAt || 0); // oldest first (queue order)
      return (b.completedAt || 0) - (a.completedAt || 0); // newest first
    });

    if (opts.limit && results.length > opts.limit) {
      results.length = opts.limit;
    }

    return results;
  }

  /**
   * Subscribe to a monitor's coordination protocol for execution
   * status changes. Only emits 'execution:changed' when the status
   * field actually transitions, not on every Y.Map write.
   *
   * @param {string} documentPath
   * @param {RuntimeMonitor} monitor
   * @private
   */
  _subscribeToExecutionChanges(documentPath, monitor) {
    if (!monitor.coordination) return;

    const statusCache = new Map();
    this._execStatusCache.set(documentPath, statusCache);

    monitor.coordination.observe((execId, exec, action) => {
      if (action === 'delete') {
        const prev = statusCache.get(execId);
        statusCache.delete(execId);
        this.emit('execution:changed', {
          execId,
          documentPath,
          status: 'removed',
          previousStatus: prev || null,
          language: null,
          code: null,
        });
        return;
      }

      if (!exec) return;

      const prev = statusCache.get(execId);
      const curr = exec.status;

      if (curr === prev) return; // No status change — skip

      statusCache.set(execId, curr);

      this.emit('execution:changed', {
        execId,
        documentPath,
        status: curr,
        previousStatus: prev || null,
        language: exec.language,
        code: exec.code,
        cellId: exec.cellId || null,
        runtimeUrl: exec.runtimeUrl || null,
        requestedAt: exec.requestedAt,
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        error: exec.error || null,
      });
    });
  }

  /**
   * Stop all monitors.
   */
  async shutdown() {
    const paths = [...this._monitors.keys()];
    await Promise.all(paths.map(p => this.stop(p).catch(() => {})));
  }

  /**
   * @returns {MonitorInfo}
   */
  _info(documentPath, entry) {
    return {
      documentPath,
      syncPort: entry.syncPort,
      connected: entry.monitor.isConnected,
      activeExecutions: entry.monitor.activeExecutions,
      startedAt: entry.startedAt,
    };
  }
}

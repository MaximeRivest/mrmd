/**
 * MonitorService
 *
 * Manages in-process monitor instances — one per document.
 * Each monitor is a headless Yjs peer that coordinates code execution,
 * ensuring long-running cells complete even if the editor disconnects.
 */

import { EventEmitter } from 'events';
import { RuntimeMonitor } from '../monitor/monitor.js';

export class MonitorService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { monitor: RuntimeMonitor, syncPort: number, startedAt: string, options: object }>} */
    this._monitors = new Map();
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
          if (parsed.level !== 'debug') {
            console.log(`[monitor:${documentPath}] ${parsed.message}`);
          }
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

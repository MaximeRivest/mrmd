/**
 * SyncService
 *
 * Manages in-process sync servers — one per project.
 * Provides Yjs CRDT sync for real-time collaboration and
 * bidirectional file persistence (editor ↔ filesystem).
 */

import { EventEmitter } from 'events';
import { createServer } from '../sync/index.js';
import { findFreePort } from '../utils/network.js';

export class SyncService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { server: object, port: number, startedAt: string }>} */
    this._servers = new Map();
  }

  /**
   * Start a sync server for a project, or return the existing one.
   *
   * @param {string} projectRoot - Absolute path to project directory
   * @param {object} [options]
   * @param {string} [options.logLevel='warn']
   * @param {number} [options.debounceMs]
   * @param {number} [options.maxConnections]
   * @returns {Promise<SyncInfo>}
   */
  async ensure(projectRoot, options = {}) {
    const existing = this._servers.get(projectRoot);
    if (existing) {
      return this._info(projectRoot, existing);
    }

    const port = await findFreePort();

    const server = createServer({
      dir: projectRoot,
      port,
      logLevel: options.logLevel || 'warn',
      persistYjsState: true,
      debounceMs: options.debounceMs,
      maxConnections: options.maxConnections,
      handleProcessSignals: false,
    });

    // Wait for the HTTP server to actually be listening
    await new Promise((resolve, reject) => {
      if (server.server.listening) {
        resolve();
        return;
      }
      server.server.once('listening', resolve);
      server.server.once('error', (err) => {
        reject(new Error(`Sync server failed to start on port ${port}: ${err.message}`));
      });
    });

    const entry = {
      server,
      port,
      startedAt: new Date().toISOString(),
    };

    this._servers.set(projectRoot, entry);

    const info = this._info(projectRoot, entry);
    console.log(`[sync] Started for ${projectRoot} on port ${port}`);
    this.emit('sync:started', info);

    return info;
  }

  /**
   * Stop a project's sync server.
   * Flushes pending writes before closing.
   *
   * @param {string} projectRoot
   */
  async stop(projectRoot) {
    const entry = this._servers.get(projectRoot);
    if (!entry) return;

    this._servers.delete(projectRoot);
    console.log(`[sync] Stopping for ${projectRoot}`);

    try {
      await entry.server.close();
    } catch (err) {
      console.error(`[sync] Error stopping ${projectRoot}:`, err.message);
    }

    this.emit('sync:stopped', { projectRoot, port: entry.port });
  }

  /**
   * List running sync servers.
   * @returns {SyncInfo[]}
   */
  list() {
    const result = [];
    for (const [projectRoot, entry] of this._servers) {
      result.push(this._info(projectRoot, entry));
    }
    return result;
  }

  /**
   * Get a running sync server's info by project root.
   * @param {string} projectRoot
   * @returns {SyncInfo|null}
   */
  get(projectRoot) {
    const entry = this._servers.get(projectRoot);
    return entry ? this._info(projectRoot, entry) : null;
  }

  /**
   * Stop all sync servers. Flushes all pending writes.
   */
  async shutdown() {
    const roots = [...this._servers.keys()];
    await Promise.all(roots.map(r => this.stop(r).catch(() => {})));
  }

  /**
   * @returns {SyncInfo}
   */
  _info(projectRoot, entry) {
    const stats = entry.server.getStats?.() || {};
    return {
      projectRoot,
      port: entry.port,
      wsUrl: `ws://127.0.0.1:${entry.port}`,
      documents: stats.docs?.length || 0,
      connections: stats.connections?.active || 0,
      startedAt: entry.startedAt,
    };
  }
}

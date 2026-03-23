/**
 * Daemon
 *
 * Long-running background process that owns all runtimes and services.
 * Heads connect via Unix socket (or named pipe on Windows).
 * Communication is newline-delimited JSON messages.
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { RuntimeService } from './services/runtime.js';
import { SyncService } from './services/sync.js';
import { MonitorService } from './services/monitor.js';
import { getSocketPath, getPidPath, getDataDir } from './utils/platform.js';

export class Daemon extends EventEmitter {
  constructor() {
    super();
    this.runtimes = new RuntimeService();
    this.sync = new SyncService();
    this.monitors = new MonitorService();
    this.server = null;
    this.clients = new Set();
    this.socketPath = getSocketPath();
    this.startedAt = null;
    this._cleanupHandlers = null;

    // Forward service events to all connected heads so every UI
    // ("head") stays in sync without polling.
    for (const event of ['sync:started', 'sync:stopped']) {
      this.sync.on(event, (data) => this._broadcast(event, data));
    }
    for (const event of ['monitor:started', 'monitor:stopped']) {
      this.monitors.on(event, (data) => this._broadcast(event, data));
    }
  }

  /**
   * Start the daemon. Listens on Unix socket.
   * @param {object} [opts]
   * @param {string} [opts.socket] - Override socket path
   */
  async start(opts = {}) {
    if (this.server) throw new Error('Daemon already running');

    this.socketPath = opts.socket || this.socketPath;
    this.startedAt = new Date().toISOString();

    // Check for a live daemon before removing a stale socket
    if (fs.existsSync(this.socketPath)) {
      const alive = await new Promise((resolve) => {
        const probe = net.createConnection(this.socketPath);
        probe.once('connect', () => { probe.destroy(); resolve(true); });
        probe.once('error', () => resolve(false));
      });
      if (alive) throw new Error(`Another daemon is already listening on ${this.socketPath}`);
      try { fs.unlinkSync(this.socketPath); } catch {}
    }

    // Ensure data directory exists
    const dataDir = getDataDir();
    fs.mkdirSync(dataDir, { recursive: true });

    // Write PID file
    const pidPath = getPidPath();
    fs.writeFileSync(pidPath, JSON.stringify({
      pid: process.pid,
      socket: this.socketPath,
      startedAt: this.startedAt,
    }));

    // Start socket server
    this.server = net.createServer((socket) => this._handleConnection(socket));

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    // Register signal handlers once; stop() removes them to avoid leaks.
    const onExit = () => {
      try { fs.unlinkSync(this.socketPath); } catch {}
      try { fs.unlinkSync(pidPath); } catch {}
    };
    const onSignal = () => { this.stop().then(() => process.exit(0)); };
    process.on('exit', onExit);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    this._cleanupHandlers = { onExit, onSignal };

    console.log(`[daemon] Listening on ${this.socketPath} (pid ${process.pid})`);
  }

  /**
   * Stop the daemon gracefully.
   *
   * Teardown order is the reverse of the dependency graph:
   *   monitors → sync → runtimes
   * Monitors depend on sync servers, so they disconnect first.
   * Sync servers flush pending writes before closing.
   * Runtimes (language processes) are killed last.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.keepRuntimes=false]
   */
  async stop(opts = {}) {
    console.log('[daemon] Stopping...');

    await this.monitors.shutdown();
    await this.sync.shutdown();
    if (!opts.keepRuntimes) {
      await this.runtimes.shutdown();
    }

    // Disconnect all clients
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    // Close server
    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
      this.server = null;
    }

    // Remove signal handlers to avoid leaks
    if (this._cleanupHandlers) {
      process.off('exit', this._cleanupHandlers.onExit);
      process.off('SIGINT', this._cleanupHandlers.onSignal);
      process.off('SIGTERM', this._cleanupHandlers.onSignal);
      this._cleanupHandlers = null;
    }

    // Clean up files
    try { fs.unlinkSync(this.socketPath); } catch {}
    try { fs.unlinkSync(getPidPath()); } catch {}

    console.log('[daemon] Stopped');
  }

  /**
   * Get daemon status.
   */
  status() {
    return {
      pid: process.pid,
      socket: this.socketPath,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - new Date(this.startedAt).getTime() : 0,
      runtimes: this.runtimes.list().length,
      sync: this.sync.list().length,
      monitors: this.monitors.list().length,
      heads: this.clients.size,
    };
  }

  // ── Connection handling ─────────────────────────────────────
  // Benign errors (ECONNRESET, EPIPE) are silenced since they're
  // normal when a head disconnects abruptly.

  _handleConnection(socket) {
    this.clients.add(socket);
    console.log(`[daemon] Head connected (${this.clients.size} total)`);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) this._handleMessage(socket, line);
      }
    });

    socket.on('close', () => {
      this.clients.delete(socket);
      console.log(`[daemon] Head disconnected (${this.clients.size} remaining)`);
    });

    socket.on('error', (err) => {
      const benign = err.code === 'ECONNRESET'
        || err.code === 'EPIPE'
        || err.message === 'This socket has been ended by the other party';
      if (!benign) {
        console.error('[daemon] Socket error:', err.message);
      }
      this.clients.delete(socket);
    });
  }

  async _handleMessage(socket, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this._send(socket, { id: null, error: 'Invalid JSON' });
      return;
    }

    const { id, method, params } = msg;

    try {
      const result = await this._dispatch(method, params || {});
      this._send(socket, { id, result });
    } catch (err) {
      console.error(`[daemon] RPC error (${method}):`, err);
      this._send(socket, { id, error: err.message });
    }
  }

  _require(params, ...keys) {
    for (const key of keys) {
      if (params[key] === undefined) {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }
  }

  // Dispatch uses a switch for explicitness — each case validates its own
  // required params so callers get clear errors instead of deep stack traces.
  async _dispatch(method, params) {
    switch (method) {
      // Daemon
      case 'daemon.status':
        return this.status();

      // Runtimes
      case 'runtime.start':
        return await this.runtimes.start(params);
      case 'runtime.stop':
        this._require(params, 'name');
        return await this.runtimes.stop(params.name);
      case 'runtime.restart':
        this._require(params, 'name');
        return await this.runtimes.restart(params.name);
      case 'runtime.list':
        return this.runtimes.list(params.language);
      case 'runtime.attach':
        this._require(params, 'name', 'documentPath');
        return this.runtimes.attach(params.name, params.documentPath);
      case 'runtime.detach':
        this._require(params, 'name', 'documentPath');
        this.runtimes.detach(params.name, params.documentPath);
        return { ok: true };

      // Sync
      case 'sync.ensure':
        this._require(params, 'projectRoot');
        return await this.sync.ensure(params.projectRoot, params);
      case 'sync.stop':
        this._require(params, 'projectRoot');
        await this.sync.stop(params.projectRoot);
        return { ok: true };
      case 'sync.list':
        return this.sync.list();
      case 'sync.get':
        this._require(params, 'projectRoot');
        return this.sync.get(params.projectRoot);

      // Monitors
      case 'monitor.ensure':
        this._require(params, 'documentPath', 'syncPort');
        return await this.monitors.ensure(params.documentPath, params.syncPort, params);
      case 'monitor.stop':
        this._require(params, 'documentPath');
        await this.monitors.stop(params.documentPath);
        return { ok: true };
      case 'monitor.list':
        return this.monitors.list();
      case 'monitor.get':
        this._require(params, 'documentPath');
        return this.monitors.get(params.documentPath);

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  _send(socket, msg) {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // socket closed
    }
  }

  /**
   * Broadcast an event to all connected heads.
   */
  _broadcast(event, data) {
    const msg = JSON.stringify({ event, data }) + '\n';
    for (const client of this.clients) {
      try { client.write(msg); } catch {}
    }
  }
}

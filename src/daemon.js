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
import { getSocketPath, getPidPath, getDataDir } from './utils/platform.js';

export class Daemon extends EventEmitter {
  constructor() {
    super();
    this.runtimes = new RuntimeService();
    this.server = null;
    this.clients = new Set();
    this.socketPath = getSocketPath();
    this.startedAt = null;
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

    // Clean up stale socket
    if (fs.existsSync(this.socketPath)) {
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

    // Ensure socket is cleaned up on exit
    const cleanup = () => {
      try { fs.unlinkSync(this.socketPath); } catch {}
      try { fs.unlinkSync(pidPath); } catch {}
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { this.stop().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { this.stop().then(() => process.exit(0)); });

    console.log(`[daemon] Listening on ${this.socketPath} (pid ${process.pid})`);
  }

  /**
   * Stop the daemon gracefully.
   * @param {object} [opts]
   * @param {boolean} [opts.keepRuntimes=false]
   */
  async stop(opts = {}) {
    console.log('[daemon] Stopping...');

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
      heads: this.clients.size,
    };
  }

  // ── Connection handling ─────────────────────────────────────

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
      if (err.code !== 'ECONNRESET') {
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
      this._send(socket, { id, error: err.message });
    }
  }

  async _dispatch(method, params) {
    switch (method) {
      // Daemon
      case 'daemon.status':
        return this.status();

      // Runtimes
      case 'runtime.start':
        return await this.runtimes.start(params);
      case 'runtime.stop':
        return await this.runtimes.stop(params.name);
      case 'runtime.restart':
        return await this.runtimes.restart(params.name);
      case 'runtime.list':
        return this.runtimes.list(params.language);
      case 'runtime.attach':
        return this.runtimes.attach(params.name, params.documentPath);
      case 'runtime.detach':
        this.runtimes.detach(params.name, params.documentPath);
        return { ok: true };

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

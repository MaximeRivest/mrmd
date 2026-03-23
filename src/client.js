/**
 * Client
 *
 * Connects to the daemon over Unix socket.
 * Provides the same API as the daemon's services.
 */

import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { getSocketPath, getPidPath, isProcessAlive } from './utils/platform.js';

/**
 * Connect to the daemon. Auto-starts it if not running.
 * @returns {Promise<DaemonClient>}
 */
export async function connect() {
  const socketPath = getSocketPath();

  // Check if daemon is running
  if (!_isDaemonRunning()) {
    await _startDaemon();
    // Wait for socket to appear
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (fs.existsSync(socketPath)) break;
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const client = new DaemonClient(socketPath);
  await client._connect();
  return client;
}

function _isDaemonRunning() {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
    return data.pid && isProcessAlive(data.pid);
  } catch {
    return false;
  }
}

async function _startDaemon() {
  const binPath = new URL('../bin/mrmd.js', import.meta.url).pathname;
  const proc = spawn(process.execPath, [binPath, 'daemon', 'start', '--foreground'], {
    stdio: 'ignore',
    detached: true,
  });
  proc.unref();

  // Give it a moment to start
  await new Promise(r => setTimeout(r, 500));
}

class DaemonClient extends EventEmitter {
  constructor(socketPath) {
    super();
    this.socketPath = socketPath;
    this.socket = null;
    this._nextId = 1;
    this._pending = new Map();
    this._buffer = '';

    // Proxied service APIs
    this.runtimes = {
      start: (config) => this._call('runtime.start', config),
      stop: (name) => this._call('runtime.stop', { name }),
      restart: (name) => this._call('runtime.restart', { name }),
      list: (language) => this._call('runtime.list', { language }),
      attach: (name, documentPath) => this._call('runtime.attach', { name, documentPath }),
      detach: (name, documentPath) => this._call('runtime.detach', { name, documentPath }),
    };

    this.sync = {
      ensure: (projectRoot, options) => this._call('sync.ensure', { projectRoot, ...options }),
      stop: (projectRoot) => this._call('sync.stop', { projectRoot }),
      list: () => this._call('sync.list'),
      get: (projectRoot) => this._call('sync.get', { projectRoot }),
    };

    this.monitors = {
      ensure: (documentPath, syncPort, options) => this._call('monitor.ensure', { documentPath, syncPort, ...options }),
      stop: (documentPath) => this._call('monitor.stop', { documentPath }),
      list: () => this._call('monitor.list'),
      get: (documentPath) => this._call('monitor.get', { documentPath }),
    };
  }

  async _connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on('connect', () => resolve());
      this.socket.once('error', reject);

      this.socket.on('data', (data) => {
        this._buffer += data.toString();
        let newline;
        while ((newline = this._buffer.indexOf('\n')) !== -1) {
          const line = this._buffer.slice(0, newline).trim();
          this._buffer = this._buffer.slice(newline + 1);
          if (line) this._handleMessage(line);
        }
      });

      this.socket.on('close', () => {
        // Reject all pending calls
        for (const [, { reject }] of this._pending) {
          reject(new Error('Daemon disconnected'));
        }
        this._pending.clear();
        this.emit('disconnected');
      });
    });
  }

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Event broadcast from daemon
    if (msg.event) {
      this.emit(msg.event, msg.data);
      return;
    }

    // RPC response
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }

  /**
   * Call a daemon method.
   * @param {string} method
   * @param {object} params
   * @returns {Promise<any>}
   */
  _call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ id, method, params }) + '\n';
      this.socket.write(msg);
    });
  }

  /**
   * Get daemon status.
   */
  status() {
    return this._call('daemon.status');
  }

  /**
   * Disconnect from the daemon (daemon keeps running).
   */
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

/**
 * Client
 *
 * Connects to the daemon over Unix socket.
 * Provides the same API as the daemon's services.
 *
 * Features:
 * - Auto-starts daemon if not running
 * - Auto-reconnects on disconnection (with exponential backoff)
 * - RPC calls wait for reconnection if currently disconnected
 * - Lifecycle events: 'disconnected', 'reconnecting', 'reconnected'
 */

import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { getSocketPath, getPidPath, isProcessAlive } from './utils/platform.js';

/**
 * Connect to the daemon. Auto-starts it if not running.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.autoReconnect=true]  Re-connect automatically on disconnect
 * @param {number}  [opts.callTimeout=30000]   Max ms an RPC call waits for (re)connection
 * @param {number}  [opts.maxReconnectDelay=10000] Backoff ceiling for reconnect retries
 * @returns {Promise<DaemonClient>}
 */
export async function connect(opts = {}) {
  const socketPath = getSocketPath();

  // Ensure daemon is running, start if needed (unless caller said not to)
  if (opts.autoStart === false) {
    // Don't start — just try to connect to whatever's there
  } else if (!_isDaemonRunning()) {
    await _startDaemon();
  }

  const client = new DaemonClient(socketPath, opts);

  // Retry the initial connection — the daemon may still be booting
  const deadline = Date.now() + (opts.connectTimeout || 10_000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      await client._connect();
      return client;
    } catch (err) {
      lastError = err;
      await _sleep(200);

      // Daemon may have died between our start and connect attempt
      if (opts.autoStart !== false && !_isDaemonRunning()) {
        await _startDaemon();
      }
    }
  }

  throw lastError || new Error('Failed to connect to daemon');
}

// ── Helpers ───────────────────────────────────────────────────

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
  await _sleep(500);
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── DaemonClient ──────────────────────────────────────────────

class DaemonClient extends EventEmitter {
  /**
   * @param {string} socketPath
   * @param {object} [opts]
   * @param {boolean} [opts.autoReconnect=true]
   * @param {number}  [opts.callTimeout=30000]
   * @param {number}  [opts.maxReconnectDelay=10000]
   */
  constructor(socketPath, opts = {}) {
    super();
    this.socketPath = socketPath;
    this.socket = null;
    this._nextId = 1;
    this._pending = new Map();
    this._buffer = '';

    // Connection state
    this._connected = false;
    this._destroyed = false;
    this._reconnecting = false;
    this._reconnectPromise = null;

    // Options
    this._autoReconnect = opts.autoReconnect !== false;
    this._callTimeout = opts.callTimeout ?? 30_000;
    this._maxReconnectDelay = opts.maxReconnectDelay ?? 10_000;

    // Service proxies — calling client.runtimes.start({ ... }) sends
    // { method: 'runtime.start', params: { ... } } to the daemon.
    // No hand-written wrappers: any method name you call on the proxy
    // maps to `namespace.method(params)` automatically.
    this.runtimes = this._proxy('runtime');
    this.sync = this._proxy('sync');
    this.monitors = this._proxy('monitor');
    this.executions = this._proxy('executions');
    this.preferences = this._proxy('prefs');
  }

  /** Whether the client is currently connected to the daemon. */
  get connected() {
    return this._connected;
  }

  /**
   * Create a proxy that maps `proxy.method(params)` to
   * `this._call('namespace.method', params)`.
   *
   * @param {string} namespace - RPC namespace (e.g. 'runtime', 'sync', 'monitor')
   * @returns {Proxy} Proxy object where any method call becomes an RPC call
   * @private
   */
  _proxy(namespace) {
    return new Proxy({}, {
      get: (_, method) => (params = {}) =>
        this._call(`${namespace}.${method}`, params),
    });
  }

  /**
   * Open a document for editing and execution.
   *
   * Ensures sync server and monitor are running. Returns connection
   * info so the head can join the Yjs room.
   *
   * If projectRoot is omitted, the daemon walks up from documentPath
   * looking for mrmd.md. Falls back to the document's parent directory.
   *
   * @param {string} documentPath - Absolute path to the .md file
   * @param {string} [projectRoot] - Project root directory (auto-detected if omitted)
   * @returns {Promise<{ syncPort: number, wsUrl: string, documentPath: string, projectRoot: string }>}
   *
   * @example
   * // Auto-detect project root from mrmd.md
   * const { wsUrl } = await client.open('/project/docs/analysis.md');
   *
   * @example
   * // Explicit project root
   * const { wsUrl, projectRoot } = await client.open('/project/docs/analysis.md', '/project');
   */
  open(documentPath, projectRoot) {
    return this._call('doc.open', { documentPath, projectRoot });
  }

  /**
   * Run code in a document. One call does everything: ensures sync,
   * monitor, and runtime are running, then executes.
   *
   * @param {string} documentPath - Absolute path to the .md file
   * @param {string} code - Code to execute
   * @param {string} language - Language identifier (bash, python, r, …)
   * @param {object} [opts]
   * @param {string} [opts.cwd] - Working directory for the runtime
   * @param {string} [opts.cellId] - Cell identifier for output placement
   * @returns {Promise<{ execId: string }>}
   *
   * @example
   * const { execId } = await client.run('/project/doc.md', 'ls -alh', 'bash');
   *
   * @example
   * const { execId } = await client.run('/project/doc.md', 'print("hi")', 'python', {
   *   cwd: '/project',
   * });
   */
  run(documentPath, code, language, opts = {}) {
    return this._call('doc.run', { documentPath, code, language, ...opts });
  }

  /**
   * Stop a running execution. Sends SIGINT to the runtime and
   * cancels the stream.
   *
   * @param {string} documentPath - Document with the execution
   * @param {string} [execId] - Stop a specific execution, or all if omitted
   * @returns {Promise<{ ok: boolean, cancelled: string[] }>}
   *
   * @example
   * await client.stop('/project/doc.md', execId);
   */
  stop(documentPath, execId) {
    return this._call('doc.stop', { documentPath, execId });
  }

  /**
   * Lower-level execution request. Prefer `run()` unless you need
   * fine-grained control over runtimes and monitors.
   */
  execute(documentPath, opts) {
    return this._call('doc.execute', { documentPath, ...opts });
  }

  /** @deprecated Use stop() */
  interrupt(documentPath, execId) {
    return this.stop(documentPath, execId);
  }

  // ── Connection lifecycle ───────────────────────────────────

  /**
   * Open the socket connection. Resolves on 'connect', rejects on
   * initial error. Sets up data/close/error handlers.
   * @returns {Promise<void>}
   * @private
   */
  async _connect() {
    if (this._connected) return;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      this.socket = socket;
      this._buffer = '';

      const onConnect = () => {
        socket.off('error', onInitialError);
        this._connected = true;
        resolve();
      };

      const onInitialError = (err) => {
        socket.off('connect', onConnect);
        this.socket = null;
        reject(err);
      };

      socket.once('connect', onConnect);
      socket.once('error', onInitialError);

      socket.on('data', (data) => {
        this._buffer += data.toString();
        let newline;
        while ((newline = this._buffer.indexOf('\n')) !== -1) {
          const line = this._buffer.slice(0, newline).trim();
          this._buffer = this._buffer.slice(newline + 1);
          if (line) this._handleMessage(line);
        }
      });

      socket.on('close', () => {
        const wasConnected = this._connected;
        this._connected = false;
        this.socket = null;

        // Reject all pending RPC calls — callers will get
        // "Daemon disconnected" and can rely on auto-retry via _call().
        for (const [, pending] of this._pending) {
          pending.reject(new Error('Daemon disconnected'));
        }
        this._pending.clear();

        if (wasConnected) {
          this.emit('disconnected');
          if (this._autoReconnect && !this._destroyed) {
            this._reconnect();
          }
        }
      });

      // Errors on established connections → close fires next
      socket.on('error', (err) => {
        if (this._connected) {
          const benign = err.code === 'ECONNRESET'
            || err.code === 'EPIPE'
            || err.message === 'This socket has been ended by the other party';
          if (!benign) {
            console.error('[mrmd-client] Socket error:', err.message);
          }
          // 'close' event will fire and trigger reconnect
        }
      });
    });
  }

  /**
   * Background reconnection loop. Runs until connected or destroyed.
   * Uses exponential backoff with a ceiling.
   * @private
   */
  _reconnect() {
    if (this._reconnecting || this._destroyed) return;
    this._reconnecting = true;
    this.emit('reconnecting');

    this._reconnectPromise = (async () => {
      let delay = 250;

      while (!this._destroyed) {
        await _sleep(delay);

        try {
          // Start daemon if it's not running
          if (!_isDaemonRunning()) {
            await _startDaemon();
            await _sleep(800);
          }

          await this._connect();

          // Success
          this._reconnecting = false;
          this._reconnectPromise = null;
          this.emit('reconnected');
          return;
        } catch {
          delay = Math.min(delay * 1.5, this._maxReconnectDelay);
        }
      }

      this._reconnecting = false;
      this._reconnectPromise = null;
    })();
  }

  // ── RPC ─────────────────────────────────────────────────────

  /**
   * Call a daemon method.
   *
   * If disconnected, waits for reconnection (up to `callTimeout`)
   * before sending. This makes callers resilient to transient
   * daemon restarts without explicit retry logic.
   *
   * @param {string} method
   * @param {object} params
   * @returns {Promise<any>}
   */
  _call(method, params = {}) {
    if (this._destroyed) {
      return Promise.reject(new Error('Client has been destroyed'));
    }

    if (this._connected) {
      return this._sendRpc(method, params);
    }

    // Not connected — wait for reconnection, then send
    return this._waitForConnection().then(() => this._sendRpc(method, params));
  }

  /**
   * Wait for the client to (re)connect. Kicks off reconnection if
   * it isn't already running. Rejects after callTimeout.
   * @returns {Promise<void>}
   * @private
   */
  _waitForConnection() {
    if (this._connected) return Promise.resolve();

    // Ensure reconnect loop is running
    if (!this._reconnecting) {
      this._reconnect();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('reconnected', onReconnect);
        reject(new Error(
          'Timed out waiting for daemon connection. '
          + 'Is the daemon process able to start?'
        ));
      }, this._callTimeout);

      const onReconnect = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.once('reconnected', onReconnect);
    });
  }

  /**
   * Send a JSON-RPC message over the connected socket.
   * @param {string} method
   * @param {object} params
   * @returns {Promise<any>}
   * @private
   */
  _sendRpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = JSON.stringify({ id, method, params }) + '\n';
      try {
        this.socket.write(msg);
      } catch (err) {
        this._pending.delete(id);
        reject(err);
      }
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
   * Get daemon status.
   */
  status() {
    return this._call('daemon.status');
  }

  /**
   * Disconnect from the daemon (daemon keeps running).
   * Disables auto-reconnect — this is a clean shutdown.
   */
  disconnect() {
    this._destroyed = true;
    this._autoReconnect = false;

    // Reject anything still waiting for reconnection
    this.emit('disconnected');

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this._connected = false;
  }
}

/**
 * Daemon
 *
 * Long-running background process that owns all runtimes and services.
 * Heads connect via Unix socket (or named pipe on Windows).
 * Communication is newline-delimited JSON messages.
 *
 * All participants (humans, AI agents, CLI tools) read and write through
 * the shared Yjs document. The daemon owns the monitor — the only process
 * that talks to runtimes. Heads never call runtimes directly.
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { RuntimeService } from './services/runtime.js';
import { SyncService } from './services/sync.js';
import { MonitorService } from './services/monitor.js';
import { PreferencesService } from './services/preferences.js';
import { getSocketPath, getPidPath, getDataDir } from './utils/platform.js';
import { findProjectRoot } from './utils/project.js';

export class Daemon extends EventEmitter {
  constructor() {
    super();
    this.runtimes = new RuntimeService();
    this.sync = new SyncService();
    this.monitors = new MonitorService();
    this.preferences = new PreferencesService();
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
    for (const event of ['monitor:started', 'monitor:stopped', 'execution:changed']) {
      this.monitors.on(event, (data) => this._broadcast(event, data));
    }
    this.preferences.on('prefs:changed', (data) => {
      this._broadcast('prefs:changed', data);
      this._cancelAffectedExecutions(data);
    });
  }

  /**
   * When preferences change, cancel active/queued executions for
   * notebooks that were using the old config. The runtime stays alive
   * (other notebooks may still need it). Next time the user runs a cell,
   * resolve() returns the new config and a new runtime starts on demand.
   *
   * @param {object} changeInfo - The prefs:changed event data
   * @param {string} changeInfo.level - 'project' | 'notebook' | 'defaults'
   * @param {string} changeInfo.projectRoot
   * @param {string} changeInfo.documentPath - Set for notebook-level changes
   * @param {string} changeInfo.language
   * @private
   */
  _cancelAffectedExecutions(changeInfo) {
    const { level, projectRoot, documentPath, language } = changeInfo;

    // Determine which documents are affected
    const affectedDocs = [];

    if (level === 'notebook' && documentPath) {
      // Notebook-level change: only that document
      affectedDocs.push(documentPath);
    } else if ((level === 'project' || level === 'defaults') && projectRoot) {
      // Project-level or global change: all monitored documents in the project
      for (const [docPath] of this.monitors._monitors) {
        if (docPath.startsWith(projectRoot + '/') || docPath.startsWith(projectRoot + path.sep)) {
          affectedDocs.push(docPath);
        }
      }
    }

    if (affectedDocs.length === 0) return;

    // Cancel active/queued executions for the affected language
    let totalCancelled = 0;
    for (const docPath of affectedDocs) {
      const executions = this.monitors.listExecutions(docPath);
      const active = executions.filter(e =>
        ['requested', 'claimed', 'ready', 'running'].includes(e.status)
        && e.language === language
      );

      if (active.length === 0) continue;

      // Signal runtimes first
      const runtimeUrls = [...new Set(active.map(e => e.runtimeUrl).filter(Boolean))];
      for (const url of runtimeUrls) {
        this.runtimes.interrupt(url).catch(() => {});
      }

      // Cancel via monitor coordination
      this.monitors.interrupt(docPath).catch(() => {});
      totalCancelled += active.length;
    }

    if (totalCancelled > 0) {
      console.log(`[daemon] Preference change: cancelled ${totalCancelled} execution(s) for ${language} in ${affectedDocs.length} document(s)`);
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
   * @returns {{ pid: number, socket: string, startedAt: string, uptime: number, runtimes: number, sync: number, monitors: number, heads: number }}
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

  /**
   * Handle a new client connection. Sets up newline-delimited JSON
   * message parsing and tracks the socket in this.clients.
   * @param {net.Socket} socket
   * @private
   */
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

  /**
   * Parse and dispatch a single JSON-RPC message from a client.
   * Sends back `{ id, result }` on success or `{ id, error }` on failure.
   * @param {net.Socket} socket
   * @param {string} raw - Raw JSON string
   * @private
   */
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

  /**
   * Validate that required parameters are present. Throws with a
   * clear message naming the missing key.
   * @param {object} params
   * @param {...string} keys - Required parameter names
   * @throws {Error} If any key is undefined in params
   * @private
   */
  _require(params, ...keys) {
    for (const key of keys) {
      if (params[key] === undefined) {
        throw new Error(`Missing required parameter: ${key}`);
      }
    }
  }

  /**
   * Route an RPC method to the appropriate service.
   *
   * Low-level methods (runtime.*, sync.*, monitor.*) map directly to
   * service calls. High-level methods (doc.*) compose multiple services
   * so heads don't have to manage the sync→monitor→runtime pipeline.
   *
   * Each case validates its own required params so callers get clear
   * errors instead of deep stack traces.
   *
   * @param {string} method - Dotted method name (e.g. 'doc.open', 'runtime.start')
   * @param {object} params - Method parameters
   * @returns {Promise<any>} Method result
   * @throws {Error} Unknown method or missing parameters
   * @private
   */
  async _dispatch(method, params) {
    switch (method) {
      // Daemon
      case 'daemon.status':
        return this.status();

      // Runtimes
      case 'runtime.start': {
        // Auto-resolve via preferences when environment/interpreter not provided.
        // This makes `mrmd runtime start --language python --cwd /project` Just Work
        // by discovering the project's venv automatically.
        let config = params;
        if (params.language && params.cwd && !params.environment && !params.interpreter) {
          // Use cwd as a synthetic document path for resolution
          const docPath = params.documentPath || params.cwd;
          const resolved = this.preferences.resolve(docPath, params.language);
          config = {
            ...resolved,
            ...params, // explicit params override resolved (e.g. name, env vars)
            environment: resolved.environment,
            interpreter: resolved.interpreter,
          };
        }
        return await this.runtimes.start(config);
      }
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

      // ── Executions (cross-document visibility) ──────────────
      // Aggregates execution state from all monitors.
      // Heads use these for sidebar queue views and notifications.

      case 'executions.list':
        return this.monitors.listAllExecutions(params);

      case 'executions.get': {
        this._require(params, 'documentPath', 'execId');
        const exec = this.monitors.getExecution(params.documentPath, params.execId);
        if (!exec) return null;
        return {
          execId: exec.id,
          documentPath: params.documentPath,
          language: exec.language,
          status: exec.status,
          code: exec.code,
          cellId: exec.cellId || null,
          runtimeUrl: exec.runtimeUrl || null,
          requestedAt: exec.requestedAt,
          startedAt: exec.startedAt,
          completedAt: exec.completedAt,
          error: exec.error || null,
        };
      }

      case 'executions.cancel': {
        this._require(params, 'documentPath');

        // Signal the runtime first (same as doc.stop)
        if (params.execId) {
          const exec = this.monitors.getExecution(params.documentPath, params.execId);
          if (exec?.runtimeUrl) {
            await this.runtimes.interrupt(exec.runtimeUrl).catch(() => {});
          }
        } else {
          // Cancel all — interrupt all runtimes for active executions
          const active = this.monitors.listExecutions(params.documentPath)
            .filter(e => ['requested', 'claimed', 'ready', 'running'].includes(e.status));
          const urls = [...new Set(active.map(e => e.runtimeUrl).filter(Boolean))];
          await Promise.all(urls.map(url => this.runtimes.interrupt(url).catch(() => {})));
        }

        return await this.monitors.interrupt(params.documentPath, params.execId);
      }

      // ── High-level document operations ──────────────────────
      // These compose sync + monitor so heads don't have to.
      // Heads should prefer these over calling sync/monitor individually.

      // doc.open — Ensure sync server + monitor are running for a document.
      //   params: { documentPath: string, projectRoot?: string }
      //   returns: { syncPort: number, wsUrl: string, documentPath: string, projectRoot: string }
      //   If projectRoot is omitted, walks up from documentPath looking for project markers.
      //   Falls back to the document's parent directory.
      case 'doc.open': {
        this._require(params, 'documentPath');
        const projectRoot = params.projectRoot
          || findProjectRoot(params.documentPath)
          || path.dirname(params.documentPath);
        const syncInfo = await this.sync.ensure(projectRoot, params);
        const monitorInfo = await this.monitors.ensure(
          params.documentPath, syncInfo.port, { projectRoot }
        );
        return {
          syncPort: syncInfo.port,
          wsUrl: syncInfo.wsUrl,
          documentPath: monitorInfo.documentPath,
          projectRoot,
        };
      }

      // doc.run — Run code in a document. One call does everything:
      //   ensures sync server, monitor, and runtime, then executes.
      //   params: { documentPath: string, code: string, language: string,
      //             cwd?: string, projectRoot?: string, cellId?: string }
      //   returns: { execId: string }
      case 'doc.run': {
        this._require(params, 'documentPath', 'code', 'language');

        // 1. Ensure sync + monitor (idempotent)
        const projectRoot = params.projectRoot
          || findProjectRoot(params.documentPath)
          || path.dirname(params.documentPath);
        const syncInfo = await this.sync.ensure(projectRoot, params);
        await this.monitors.ensure(
          params.documentPath, syncInfo.port, { projectRoot }
        );

        // 2. Resolve preferences → start runtime with full config
        const resolved = this.preferences.resolve(params.documentPath, params.language);
        const rt = await this.runtimes.start({
          ...resolved,
          cwd: resolved.cwd || params.cwd || projectRoot,
        });

        // 3. Execute
        return await this.monitors.execute(params.documentPath, {
          code: params.code,
          language: params.language,
          cellId: params.cellId,
          runtimeUrl: rt.url,
        });
      }

      // doc.stop — Stop a running execution. The daemon asks the runtime
      //   to interrupt itself via MRP /interrupt, then cancels the monitor's
      //   stream so every head sees the stopped state.
      //   params: { documentPath: string, execId?: string }
      //   returns: { ok: true, cancelled: string[] }
      case 'doc.stop':
      case 'doc.interrupt': {
        this._require(params, 'documentPath');

        const execs = params.execId
          ? [this.monitors.getExecution(params.documentPath, params.execId)].filter(Boolean)
          : this.monitors.listExecutions(params.documentPath)
              .filter((exec) => ['requested', 'claimed', 'ready', 'running'].includes(exec.status));

        const runtimeUrls = [...new Set(execs.map((exec) => exec?.runtimeUrl).filter(Boolean))];
        await Promise.all(runtimeUrls.map((url) => this.runtimes.interrupt(url).catch(() => {})));

        return await this.monitors.interrupt(
          params.documentPath, params.execId
        );
      }

      // doc.complete — Get completions from the running runtime.
      //   Does NOT start a runtime — returns empty if none is running.
      //   params: { documentPath: string, code: string, cursor: number, language: string }
      //   returns: MRP /complete response or { matches: [] }
      case 'doc.complete': {
        this._require(params, 'documentPath', 'code', 'language');
        const cursor = params.cursor ?? params.code.length;
        const url = this._findRuntimeUrl(params.documentPath, params.language);
        if (!url) return { matches: [], cursorStart: cursor, cursorEnd: cursor, source: 'none' };
        return await this._mrpCall(url, 'complete', { code: params.code, cursor });
      }

      // doc.hover — Get hover tooltip from the running runtime.
      //   params: { documentPath: string, code: string, cursor: number, language: string }
      //   returns: MRP /hover response or { found: false }
      case 'doc.hover': {
        this._require(params, 'documentPath', 'code', 'language');
        const cursor = params.cursor ?? params.code.length;
        const url = this._findRuntimeUrl(params.documentPath, params.language);
        if (!url) return { found: false };
        return await this._mrpCall(url, 'hover', { code: params.code, cursor });
      }

      // doc.inspect — Get detailed symbol info from the running runtime.
      //   params: { documentPath: string, code: string, cursor: number, language: string, detail?: number }
      //   returns: MRP /inspect response or { found: false }
      case 'doc.inspect': {
        this._require(params, 'documentPath', 'code', 'language');
        const cursor = params.cursor ?? params.code.length;
        const url = this._findRuntimeUrl(params.documentPath, params.language);
        if (!url) return { found: false };
        return await this._mrpCall(url, 'inspect', { code: params.code, cursor, detail: params.detail ?? 1 });
      }

      // doc.execute — Lower-level: request execution (requires runtime already running).
      //   Prefer doc.run unless you need fine-grained control.
      case 'doc.execute': {
        this._require(params, 'documentPath', 'code', 'language');
        const runtimes = this.runtimes.list(params.language);
        const activeRt = runtimes.find(r => r.alive);
        if (!activeRt) {
          throw new Error(`No running ${params.language} runtime. Start one first.`);
        }
        return await this.monitors.execute(params.documentPath, {
          code: params.code,
          language: params.language,
          cellId: params.cellId,
          runtimeUrl: activeRt.url,
        });
      }

      // ── Preferences ──────────────────────────────────────

      case 'prefs.resolve': {
        this._require(params, 'documentPath', 'language');
        return this.preferences.resolve(params.documentPath, params.language);
      }

      case 'prefs.get':
        return this.preferences.get(params);

      case 'prefs.setProject': {
        this._require(params, 'projectRoot', 'language');
        const { projectRoot, language, ...patch } = params;
        this.preferences.setProjectOverride(projectRoot, language, patch);
        return { ok: true };
      }

      case 'prefs.setNotebook': {
        this._require(params, 'documentPath', 'language');
        const { documentPath, language, ...patch } = params;
        this.preferences.setNotebookOverride(documentPath, language, patch);
        return { ok: true };
      }

      case 'prefs.clearNotebook': {
        this._require(params, 'documentPath', 'language');
        this.preferences.clearNotebookOverride(params.documentPath, params.language);
        return { ok: true };
      }

      case 'prefs.setDefault': {
        this._require(params, 'language');
        const { language, ...patch } = params;
        this.preferences.setDefault(language, patch);
        return { ok: true };
      }

      // ── Environment management ──────────────────────────────

      case 'env.ensureBridge': {
        const { getDescriptor } = await import('./descriptors/index.js');
        const language = params.language || 'python';
        const desc = getDescriptor(language);
        if (!desc?.ensureBridge) {
          throw new Error(`No bridge installation support for ${language}`);
        }
        return await desc.ensureBridge({
          environment: params.environment,
          interpreter: params.interpreter,
        });
      }

      case 'env.provision': {
        const { getDescriptor } = await import('./descriptors/index.js');
        const language = params.language || 'python';
        const desc = getDescriptor(language);
        if (!desc?.provision) {
          throw new Error(`No provisioning support for ${language}`);
        }
        this._require(params, 'projectRoot');
        return await desc.provision(params.projectRoot, params);
      }

      // ── Environment discovery ─────────────────────────────
      // Stateless — delegates to utility functions.
      // Heads can also call these directly without the daemon,
      // but the RPC path keeps the interface uniform.

      case 'env.discover': {
        const { findUv, findInterpreters, findEnvironments, resolveEnvironment, resolveInterpreter } = await import('./utils/python.js');
        const language = params.language || 'python';

        if (language !== 'python') {
          // For now, only python has discovery
          return { interpreters: [], environments: [], resolved: null };
        }

        const uv = findUv();
        const interpreters = uv ? findInterpreters(uv) : [];
        const environments = findEnvironments({
          cwd: params.cwd || process.cwd(),
          projectRoot: params.projectRoot,
        });
        const resolved = resolveEnvironment({
          cwd: params.cwd || process.cwd(),
          projectRoot: params.projectRoot,
          environment: params.environment,
          interpreter: params.interpreter,
        });
        const resolvedInterpreter = resolveInterpreter({
          interpreter: params.interpreter,
          environment: resolved?.environment,
        });

        // Also include the full preferences-resolved config (with scope, cwd, name, target)
        const docPath = params.documentPath || params.cwd || process.cwd();
        const prefsResolved = this.preferences.resolve(docPath, language);

        return { interpreters, environments, resolved: prefsResolved, resolvedInterpreter };
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Send a JSON message to a single client, newline-terminated.
   * Silently ignores write errors (socket already closed).
   * @param {net.Socket} socket
   * @param {object} msg - Message to serialize
   * @private
   */
  _send(socket, msg) {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // socket closed
    }
  }

  /**
   * Broadcast an event to all connected heads. Used to forward
   * service events (sync:started, monitor:stopped, etc.) so every
   * UI stays in sync without polling.
   * @param {string} event - Event name
   * @param {any} data - Event payload
   * @private
   */
  _broadcast(event, data) {
    const msg = JSON.stringify({ event, data }) + '\n';
    for (const client of this.clients) {
      try { client.write(msg); } catch {}
    }
  }

  // ── MRP proxy helpers ──────────────────────────────────────

  /**
   * Find the MRP base URL for a running runtime that serves a
   * given document + language. Returns null if no runtime is running
   * (does NOT start one — completion/hover should be silent when
   * the user hasn't run code yet).
   *
   * @param {string} documentPath
   * @param {string} language
   * @returns {string|null} MRP base URL, e.g. "http://127.0.0.1:37657/mrp/v1"
   * @private
   */
  _findRuntimeUrl(documentPath, language) {
    // Resolve preferences to get the deterministic runtime name
    const resolved = this.preferences.resolve(documentPath, language);
    const runtimes = this.runtimes.list(language);

    // Exact match on resolved name
    const named = runtimes.find(r => r.name === resolved.name && r.alive);
    if (named) return named.url;

    // Fallback: any alive runtime for this language
    const any = runtimes.find(r => r.alive);
    return any?.url || null;
  }

  /**
   * Call an MRP endpoint on a running runtime.
   *
   * @param {string} baseUrl - MRP base URL (e.g. "http://127.0.0.1:37657/mrp/v1")
   * @param {string} endpoint - Endpoint name (e.g. "complete", "hover")
   * @param {object} body - Request body
   * @returns {Promise<object>} Response JSON
   * @private
   */
  async _mrpCall(baseUrl, endpoint, body) {
    const res = await fetch(`${baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return await res.json();
  }
}

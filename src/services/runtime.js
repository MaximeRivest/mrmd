/**
 * RuntimeService
 *
 * Manages runtime processes. Each runtime is one process, one PID,
 * one port, one MRP namespace.
 */

import { spawn } from 'child_process';
import { findFreePort, waitForPort } from '../utils/network.js';
import { findSiblingBinary, isProcessAlive, killProcessTree } from '../utils/platform.js';

export class RuntimeService {
  constructor() {
    /** @type {Map<string, RuntimeInfo>} */
    this.runtimes = new Map();

    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.processes = new Map();

    /** @type {Map<string, string[]>} name -> document paths */
    this.consumers = new Map();
  }

  /**
   * Start a runtime. Reuses existing if alive with same name.
   *
   * @param {object} config
   * @param {string} config.name
   * @param {string} config.language
   * @param {string} config.cwd
   * @param {string} [config.interpreter]
   * @param {string} [config.environment]
   * @param {object} [config.env]
   * @returns {Promise<RuntimeInfo>}
   */
  async start(config) {
    const { name, language, cwd } = config;
    if (!name || !language || !cwd) {
      throw new Error('name, language, and cwd are required');
    }

    // Reuse existing
    const existing = this.runtimes.get(name);
    if (existing?.alive) {
      if (!existing.pid || isProcessAlive(existing.pid)) {
        return existing;
      }
      // Dead — clean up
      this.runtimes.delete(name);
      this.processes.delete(name);
    }

    const descriptor = this._getDescriptor(language);
    const port = await findFreePort();
    const binary = descriptor.findBinary(config);

    if (!binary) {
      throw new Error(`No binary found for ${language}. Is mrmd-${language} installed?`);
    }

    const args = descriptor.buildArgs(port, config);
    const env = { ...process.env, ...(config.env || {}) };

    console.log(`[runtime] Starting "${name}" (${language}) on port ${port}: ${binary} ${args.join(' ')}`);

    const proc = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      env,
    });

    if (proc.pid && process.platform !== 'win32') {
      proc.unref();
    }

    // Log output
    proc.stdout?.on('data', (d) => console.log(`[runtime:${name}]`, d.toString().trim()));
    proc.stderr?.on('data', (d) => console.error(`[runtime:${name}]`, d.toString().trim()));

    // Wait for port or early exit
    const earlyExit = new Promise((_, reject) => {
      proc.once('exit', (code, signal) => {
        reject(new Error(`Runtime exited before ready (code=${code}, signal=${signal})`));
      });
    });

    const spawnError = new Promise((_, reject) => {
      proc.on('error', (err) => {
        reject(new Error(`Spawn error: ${err.message}`));
      });
    });

    const timeout = descriptor.startupTimeout || 10000;

    await Promise.race([
      waitForPort(port, { timeout }),
      earlyExit,
      spawnError,
    ]);

    const info = {
      name,
      language,
      pid: proc.pid,
      port,
      url: `http://127.0.0.1:${port}/mrp/v1`,
      cwd,
      interpreter: binary,
      environment: config.environment || null,
      env: config.env || null,
      alive: true,
      startedAt: new Date().toISOString(),
      consumers: [],
    };

    this.runtimes.set(name, info);
    this.processes.set(name, proc);

    // Handle exit
    proc.on('exit', (code, signal) => {
      console.log(`[runtime:${name}] Exited (code=${code}, signal=${signal})`);
      const rt = this.runtimes.get(name);
      if (rt) rt.alive = false;
      this.runtimes.delete(name);
      this.processes.delete(name);
    });

    console.log(`[runtime] "${name}" ready on port ${port} (pid ${proc.pid})`);
    return info;
  }

  /**
   * Stop a runtime.
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async stop(name) {
    const info = this.runtimes.get(name);
    if (!info) return false;

    console.log(`[runtime] Stopping "${name}" (pid=${info.pid})`);

    if (info.pid) {
      await killProcessTree(info.pid);
    }

    this.runtimes.delete(name);
    this.processes.delete(name);
    this.consumers.delete(name);
    return true;
  }

  /**
   * Restart a runtime.
   * @param {string} name
   * @returns {Promise<RuntimeInfo>}
   */
  async restart(name) {
    const info = this.runtimes.get(name);
    if (!info) throw new Error(`Runtime "${name}" not found`);

    const config = {
      name,
      language: info.language,
      cwd: info.cwd,
      interpreter: info.interpreter,
      environment: info.environment,
      env: info.env,
    };

    await this.stop(name);
    await new Promise(r => setTimeout(r, 300));
    return this.start(config);
  }

  /**
   * List running runtimes.
   * @param {string} [language]
   * @returns {RuntimeInfo[]}
   */
  list(language) {
    const result = [];
    for (const [name, info] of this.runtimes) {
      if (info.pid && !isProcessAlive(info.pid)) {
        info.alive = false;
        this.runtimes.delete(name);
        this.processes.delete(name);
        continue;
      }
      if (!language || info.language === language) {
        info.consumers = this.consumers.get(name) || [];
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Register a document as a consumer of a runtime.
   */
  attach(name, documentPath) {
    const info = this.runtimes.get(name);
    if (!info) return null;

    let docs = this.consumers.get(name);
    if (!docs) {
      docs = [];
      this.consumers.set(name, docs);
    }
    if (!docs.includes(documentPath)) {
      docs.push(documentPath);
    }
    info.consumers = docs;
    return info;
  }

  /**
   * Unregister a document from a runtime.
   */
  detach(name, documentPath) {
    const docs = this.consumers.get(name);
    if (!docs) return;
    const idx = docs.indexOf(documentPath);
    if (idx !== -1) docs.splice(idx, 1);
    const info = this.runtimes.get(name);
    if (info) info.consumers = docs;
  }

  /**
   * Stop all runtimes.
   */
  async shutdown() {
    const names = [...this.runtimes.keys()];
    await Promise.all(names.map(n => this.stop(n).catch(() => {})));
  }

  // ── Language descriptors ────────────────────────────────────

  _getDescriptor(language) {
    const lang = language.toLowerCase();
    const descriptors = {
      bash: {
        startupTimeout: 10000,
        findBinary() {
          return findSiblingBinary('bash');
        },
        buildArgs(port, config) {
          return ['--port', String(port), '--cwd', config.cwd];
        },
      },
      // More languages added here as we go:
      // python, r, julia, node, ...
    };

    const desc = descriptors[lang];
    if (!desc) throw new Error(`Unsupported language: ${language}`);
    return desc;
  }
}

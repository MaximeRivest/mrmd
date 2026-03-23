#!/usr/bin/env node
/**
 * Interactive REPL for exploring the mrmd daemon and services.
 *
 * Usage:
 *   node explore.mjs            — start a REPL with everything loaded
 *   node explore.mjs --daemon   — also start a daemon in-process
 *
 * Inside the REPL you get:
 *   daemon    — the Daemon instance (if --daemon)
 *   client    — a connected DaemonClient (auto-connects)
 *   call(m,p) — shorthand for client.call(method, params)
 *   services  — { RuntimeService, SyncService, MonitorService }
 *   reload()  — re-import modules (for quick iteration)
 *
 * Examples:
 *   > await call('daemon.status')
 *   > await call('runtime.list')
 *   > daemon.runtimes.list()
 *   > services.RuntimeService  // inspect the class
 */

import repl from 'repl';
import { Daemon } from './src/daemon.js';
import { connect } from './src/client.js';
import { RuntimeService } from './src/services/runtime.js';
import { SyncService } from './src/services/sync.js';
import { MonitorService } from './src/services/monitor.js';

const startDaemon = process.argv.includes('--daemon');

console.log('');
console.log('  ┌──────────────────────────────────────────┐');
console.log('  │  mrmd interactive explorer                │');
console.log('  │                                           │');
console.log('  │  Variables:                               │');
console.log('  │    daemon, client, services               │');
console.log('  │    call(method, params) → client.call()   │');
console.log('  │                                           │');
console.log('  │  Try:                                     │');
console.log('  │    await call("daemon.status")             │');
console.log('  │    await call("runtime.list")              │');
console.log('  │    daemon.runtimes                        │');
console.log('  │                                           │');
console.log('  │  .help for REPL commands                  │');
console.log('  └──────────────────────────────────────────┘');
console.log('');

const ctx = {};

// Optionally start a daemon in-process (great for debugging)
if (startDaemon) {
  ctx.daemon = new Daemon();
  await ctx.daemon.start();
  console.log('  ✔ Daemon started in-process\n');
}

// Try to connect to the daemon
try {
  ctx.client = await connect();
  console.log('  ✔ Connected to daemon\n');
} catch (e) {
  console.log(`  ⚠ Could not connect to daemon: ${e.message}`);
  console.log('    Run with --daemon to start one in-process,');
  console.log('    or start one separately: node bin/mrmd.js daemon start\n');
  ctx.client = null;
}

// Convenience shorthand
ctx.call = async (method, params = {}) => {
  if (!ctx.client) throw new Error('No client connected');
  return ctx.client.call(method, params);
};

ctx.services = { RuntimeService, SyncService, MonitorService };

// Start the REPL
const r = repl.start({
  prompt: 'mrmd> ',
  useGlobal: true,
  preview: true,
});

// Enable top-level await
r.setupHistory('.mrmd_repl_history', () => {});

// Inject everything into the REPL context
Object.assign(r.context, ctx);

// Clean shutdown
r.on('exit', async () => {
  if (ctx.client) {
    try { ctx.client.disconnect(); } catch {}
  }
  if (startDaemon && ctx.daemon) {
    await ctx.daemon.stop();
  }
  process.exit(0);
});

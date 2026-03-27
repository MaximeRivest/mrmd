#!/usr/bin/env node

import { Daemon } from '../src/daemon.js';
import { connect } from '../src/client.js';

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function output(data, json) {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── daemon commands ───────────────────────────────────────────

async function daemonStart(flags) {
  if (flags.foreground) {
    // Run in foreground (used by connect() auto-start)
    const daemon = new Daemon();
    await daemon.start({ socket: flags.socket });
    console.log(`[daemon] Running in foreground (pid ${process.pid})`);
  } else {
    // Check if already running
    try {
      const client = await connect();
      const status = await client.status();
      client.disconnect();
      console.log(`Daemon already running (pid ${status.pid})`);
      return;
    } catch {
      // Not running — start it
    }

    // Spawn detached daemon process
    const { spawn } = await import('child_process');
    const proc = spawn(process.execPath, [new URL(import.meta.url).pathname, 'daemon', 'start', '--foreground'], {
      stdio: 'ignore',
      detached: true,
    });
    proc.unref();

    // Wait for it to be ready
    await new Promise(r => setTimeout(r, 800));

    try {
      const client = await connect();
      const status = await client.status();
      client.disconnect();
      console.log(`Daemon started (pid ${status.pid})`);
    } catch {
      console.error('Failed to start daemon');
      process.exit(1);
    }
  }
}

async function daemonStop(flags) {
  const { getPidPath, isProcessAlive } = await import('../src/utils/platform.js');
  const fs = await import('fs');
  const pidPath = getPidPath();

  // Strategy 1: Connect and ask the daemon to shut down gracefully.
  // This triggers the proper teardown: monitors → sync → runtimes.
  let sentSignal = false;
  try {
    const client = await connect({ connectTimeout: 3000, callTimeout: 3000, autoStart: false, autoReconnect: false });
    try {
      // Verify it's alive, then get its PID
      const status = await client.status();
      client.disconnect();

      // Send SIGTERM — the daemon's signal handler calls this.stop()
      // which does the graceful teardown.
      if (status.pid && isProcessAlive(status.pid)) {
        process.kill(status.pid, 'SIGTERM');
        sentSignal = true;

        // Wait for it to actually die
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && isProcessAlive(status.pid)) {
          await new Promise(r => setTimeout(r, 200));
        }

        if (isProcessAlive(status.pid)) {
          // Force kill
          try { process.kill(status.pid, 'SIGKILL'); } catch {}
          console.log(`Daemon force-killed (pid ${status.pid})`);
        } else {
          console.log(`Daemon stopped (pid ${status.pid})`);
        }
        return;
      }
    } catch {
      client.disconnect();
    }
  } catch {
    // connect() failed — daemon might be alive but socket is stale
  }

  // Strategy 2: Kill by PID file (fallback if connect fails).
  try {
    const data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
    if (data.pid && isProcessAlive(data.pid)) {
      process.kill(data.pid, 'SIGTERM');
      sentSignal = true;

      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && isProcessAlive(data.pid)) {
        await new Promise(r => setTimeout(r, 200));
      }

      if (isProcessAlive(data.pid)) {
        try { process.kill(data.pid, 'SIGKILL'); } catch {}
        console.log(`Daemon force-killed (pid ${data.pid})`);
      } else {
        console.log(`Daemon stopped (pid ${data.pid})`);
      }
      return;
    }
  } catch {}

  if (!sentSignal) {
    console.log('Daemon is not running');
  }
}

async function daemonStatus(flags) {
  try {
    const client = await connect({ autoStart: false, connectTimeout: 2000, autoReconnect: false });
    const status = await client.status();
    client.disconnect();

    if (flags.json) {
      output(status, true);
    } else {
      const uptime = Math.round(status.uptime / 1000);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      const s = uptime % 60;
      const uptimeStr = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
      console.log(`DAEMON  running (pid ${status.pid}, uptime ${uptimeStr}, ${status.heads} heads)`);
      console.log(`RUNTIMES  ${status.runtimes} running`);
    }
  } catch {
    if (flags.json) {
      output({ running: false }, true);
    } else {
      console.log('DAEMON  not running');
    }
  }
}

// ── runtime commands ──────────────────────────────────────────

async function runtimeStart(flags) {
  const language = flags.language || flags.lang;
  const cwd = flags.cwd || process.cwd();
  const name = flags.name || `rt:${language}:${Date.now()}`;

  if (!language) {
    console.error('Missing --language');
    process.exit(1);
  }

  const client = await connect();
  try {
    const rt = await client.runtimes.start({ name, language, cwd });
    output(rt, flags.json);
  } finally {
    client.disconnect();
  }
}

async function runtimeStop(flags) {
  const name = args[2];
  if (!name) {
    console.error('Usage: mrmd runtime stop <name>');
    process.exit(1);
  }

  const client = await connect();
  try {
    const ok = await client.runtimes.stop({ name });
    if (flags.json) {
      output({ stopped: ok }, true);
    } else {
      console.log(ok ? `Stopped ${name}` : `Runtime ${name} not found`);
    }
  } finally {
    client.disconnect();
  }
}

async function runtimeList(flags) {
  const client = await connect();
  try {
    const list = await client.runtimes.list({ language: flags.language || flags.lang });
    if (flags.json) {
      output(list, true);
    } else if (list.length === 0) {
      console.log('No runtimes running');
    } else {
      for (const rt of list) {
        const consumers = rt.consumers?.length
          ? `\n           └─ ${rt.consumers.join('\n           └─ ')}`
          : '';
        console.log(`  ${rt.language.padEnd(8)} ${rt.name}  port ${rt.port}  ● alive${consumers}`);
      }
    }
  } finally {
    client.disconnect();
  }
}

// ── sync commands ─────────────────────────────────────────────

async function syncEnsure(flags) {
  const projectRoot = args[2];
  if (!projectRoot) {
    console.error('Usage: mrmd sync ensure <project-root>');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const root = resolvePath(process.cwd(), projectRoot);

  const client = await connect();
  try {
    const info = await client.sync.ensure({ projectRoot: root });
    output(info, flags.json);
  } finally {
    client.disconnect();
  }
}

async function syncStop(flags) {
  const projectRoot = args[2];
  if (!projectRoot) {
    console.error('Usage: mrmd sync stop <project-root>');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const root = resolvePath(process.cwd(), projectRoot);

  const client = await connect();
  try {
    await client.sync.stop({ projectRoot: root });
    if (flags.json) {
      output({ stopped: true }, true);
    } else {
      console.log(`Stopped sync for ${root}`);
    }
  } finally {
    client.disconnect();
  }
}

async function syncList(flags) {
  const client = await connect();
  try {
    const list = await client.sync.list();
    if (flags.json) {
      output(list, true);
    } else if (list.length === 0) {
      console.log('No sync servers running');
    } else {
      for (const s of list) {
        console.log(`  ${s.projectRoot}`);
        console.log(`    port ${s.port}  ${s.documents} docs  ${s.connections} connections`);
      }
    }
  } finally {
    client.disconnect();
  }
}

// ── monitor commands ──────────────────────────────────────────

async function monitorEnsure(flags) {
  const documentPath = args[2];
  const syncPortStr = flags['sync-port'] || flags.syncPort;
  if (!documentPath || !syncPortStr) {
    console.error('Usage: mrmd monitor ensure <document-path> --sync-port <port>');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const docPath = resolvePath(process.cwd(), documentPath);
  const syncPort = parseInt(syncPortStr, 10);

  const client = await connect();
  try {
    const info = await client.monitors.ensure({
      documentPath: docPath,
      syncPort,
      projectRoot: flags['project-root'] || flags.projectRoot,
      cwd: flags.cwd,
    });
    output(info, flags.json);
  } finally {
    client.disconnect();
  }
}

async function monitorStop(flags) {
  const documentPath = args[2];
  if (!documentPath) {
    console.error('Usage: mrmd monitor stop <document-path>');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const docPath = resolvePath(process.cwd(), documentPath);

  const client = await connect();
  try {
    await client.monitors.stop({ documentPath: docPath });
    if (flags.json) {
      output({ stopped: true }, true);
    } else {
      console.log(`Stopped monitor for ${docPath}`);
    }
  } finally {
    client.disconnect();
  }
}

async function monitorList(flags) {
  const client = await connect();
  try {
    const list = await client.monitors.list();
    if (flags.json) {
      output(list, true);
    } else if (list.length === 0) {
      console.log('No monitors running');
    } else {
      for (const m of list) {
        const status = m.connected ? '● active' : '○ disconnected';
        const execs = m.activeExecutions > 0 ? `  ${m.activeExecutions} executing` : '';
        console.log(`  ${m.documentPath}     ${status}${execs}`);
      }
    }
  } finally {
    client.disconnect();
  }
}

// ── prefs commands ────────────────────────────────────────────

async function prefsResolve(flags) {
  const documentPath = args[2];
  const language = args[3] || flags.language || flags.lang || 'python';

  if (!documentPath) {
    console.error('Usage: mrmd prefs resolve <document> [language]');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const docPath = resolvePath(process.cwd(), documentPath);

  const client = await connect();
  try {
    const config = await client.preferences.resolve({ documentPath: docPath, language });
    if (flags.json) {
      output(config, true);
    } else {
      console.log(`RESOLVED CONFIG for ${language} in ${docPath}`);
      console.log(`  runtime     ${config.name}`);
      console.log(`  scope       ${config.scope}`);
      console.log(`  target      ${config.target}`);
      console.log(`  environment ${config.environment || '(none)'}`);
      console.log(`  interpreter ${config.interpreter || '(none)'}`);
      console.log(`  cwd         ${config.cwd}`);
      console.log(`  project     ${config.projectRoot}`);
      console.log(`  via         ${config.via}`);
      console.log(`  bridge      ${config.hasBridge ? '✓' : '✗'}`);
      if (config.env && Object.keys(config.env).length > 0) {
        console.log(`  env         ${JSON.stringify(config.env)}`);
      }
    }
  } finally {
    client.disconnect();
  }
}

async function prefsSetProject(flags) {
  const projectRoot = args[2];
  const language = args[3];

  if (!projectRoot || !language) {
    console.error('Usage: mrmd prefs set-project <project> <language> [--environment PATH] [--scope SCOPE] [--target ID]');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const root = resolvePath(process.cwd(), projectRoot);

  const patch = { projectRoot: root, language };
  if (flags.environment) patch.environment = resolvePath(process.cwd(), flags.environment);
  if (flags.interpreter) patch.interpreter = resolvePath(process.cwd(), flags.interpreter);
  if (flags.scope) patch.scope = flags.scope;
  if (flags.target) patch.target = flags.target;
  if (flags.cwd) patch.cwd = flags.cwd;

  const client = await connect();
  try {
    await client.preferences.setProject(patch);
    if (flags.json) {
      output({ ok: true }, true);
    } else {
      console.log(`Set ${language} preferences for ${root}`);
    }
  } finally {
    client.disconnect();
  }
}

async function prefsShow(flags) {
  const client = await connect();
  try {
    const { resolve: resolvePath } = await import('path');
    const projectRoot = flags.project ? resolvePath(process.cwd(), flags.project) : undefined;
    const prefs = await client.preferences.get({ projectRoot });
    output(prefs, true); // always JSON — raw prefs are structured data
  } finally {
    client.disconnect();
  }
}

// ── env commands ──────────────────────────────────────────────

async function envDiscover(flags) {
  const { findUv, findInterpreters, findEnvironments, resolveEnvironment, resolveInterpreter } = await import('../src/utils/python.js');
  const { resolve: resolvePath } = await import('path');

  const language = flags.language || flags.lang || 'python';
  const cwd = flags.cwd || flags.project || process.cwd();
  const projectRoot = flags['project-root'] || flags.project;

  if (language !== 'python') {
    console.log(`Discovery for ${language} is not yet supported.`);
    return;
  }

  // Find uv
  const uv = findUv();

  // Interpreters
  const interpreters = uv ? findInterpreters(uv) : [];

  // Environments
  const environments = findEnvironments({
    cwd: resolvePath(cwd),
    projectRoot: projectRoot ? resolvePath(projectRoot) : undefined,
  });

  // Resolve (what would be auto-selected)
  const resolved = resolveEnvironment({
    cwd: resolvePath(cwd),
    projectRoot: projectRoot ? resolvePath(projectRoot) : undefined,
  });
  const resolvedInterp = resolveInterpreter({
    environment: resolved?.environment,
  });

  if (flags.json) {
    output({ interpreters, environments, resolved, resolvedInterpreter: resolvedInterp }, true);
    return;
  }

  // ── Pretty print ─────────────────────────────────────────

  // Resolved (what mrmd would auto-use)
  if (resolved) {
    console.log('RESOLVED (auto-selected)');
    const bridge = resolved.hasBridge ? 'mrmd-python ✓' : 'mrmd-python ✗';
    const ver = resolved.pythonVersion || '?';
    console.log(`  ${resolved.environment}`);
    console.log(`    python ${ver}  ${bridge}  via ${resolved.via}`);
    if (resolvedInterp) {
      console.log(`    interpreter: ${resolvedInterp.path}`);
    }
    console.log('');
  } else {
    console.log('RESOLVED');
    console.log('  (none — no environment auto-detected for this directory)');
    if (resolvedInterp) {
      console.log(`  bare interpreter: ${resolvedInterp.path} (${resolvedInterp.version || '?'}, ${resolvedInterp.source})`);
    }
    console.log('');
  }

  // Interpreters
  if (interpreters.length > 0) {
    console.log(`INTERPRETERS (${interpreters.length})`);
    for (const i of interpreters) {
      const ver = (i.version || '?').padEnd(12);
      const src = i.source.padEnd(10);
      console.log(`  ${ver} ${src} ${i.path}`);
    }
  } else {
    console.log('INTERPRETERS');
    if (!uv) {
      console.log('  (uv not found — install uv for comprehensive Python discovery)');
    } else {
      console.log('  (none found)');
    }
  }
  console.log('');

  // Environments
  if (environments.length > 0) {
    console.log(`ENVIRONMENTS (${environments.length})`);
    for (const e of environments) {
      const type = e.type.padEnd(6);
      const ver = (e.pythonVersion || '?').padEnd(10);
      const bridge = e.hasBridge ? 'mrmd-python ✓' : 'mrmd-python ✗';
      const src = e.source.padEnd(16);
      const marker = (resolved && e.path === resolved.environment) ? ' ← selected' : '';
      console.log(`  ${type} ${ver} ${bridge.padEnd(15)} ${src} ${e.path}${marker}`);
    }
  } else {
    console.log('ENVIRONMENTS');
    console.log('  (none found)');
    console.log('  Create one with: uv venv');
  }
}

// ── executions commands ───────────────────────────────────────

async function executionsList(flags) {
  const client = await connect();
  try {
    const list = await client.executions.list({
      active: flags.active || false,
      documentPath: flags.document || flags.doc,
      language: flags.language || flags.lang,
      limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
    });
    if (flags.json) {
      output(list, true);
    } else if (list.length === 0) {
      console.log('No executions');
    } else {
      for (const exec of list) {
        const status = _execStatusIcon(exec.status);
        const lang = (exec.language || '?').padEnd(8);
        const doc = require('path').basename(exec.documentPath || '');
        const duration = _execDuration(exec);
        const code = (exec.code || '').split('\n')[0].slice(0, 50);
        console.log(`  ${status} ${lang} ${doc.padEnd(20)} ${duration.padEnd(8)} ${code}`);
      }
    }
  } finally {
    client.disconnect();
  }
}

async function executionsCancel(flags) {
  const documentPath = args[2];
  const execId = args[3];

  if (!documentPath) {
    console.error('Usage: mrmd executions cancel <document> [execId]');
    process.exit(1);
  }

  const { resolve: resolvePath } = await import('path');
  const docPath = resolvePath(process.cwd(), documentPath);

  const client = await connect();
  try {
    const result = await client.executions.cancel({
      documentPath: docPath,
      execId: execId || undefined,
    });
    if (flags.json) {
      output(result, true);
    } else {
      console.log(`Cancelled ${result.cancelled.length} execution(s)`);
    }
  } finally {
    client.disconnect();
  }
}

function _execStatusIcon(status) {
  switch (status) {
    case 'requested': return '◯ queued  ';
    case 'claimed':   return '◯ claimed ';
    case 'ready':     return '◐ ready   ';
    case 'running':   return '● running ';
    case 'completed': return '✓ done    ';
    case 'error':     return '✗ error   ';
    case 'cancelled': return '⊘ cancel  ';
    default:          return `? ${status}`.padEnd(10);
  }
}

function _execDuration(exec) {
  const start = exec.startedAt;
  if (!start) return '';
  const end = exec.completedAt || Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ── status ────────────────────────────────────────────────────

async function statusCommand(flags) {
  await daemonStatus(flags);

  try {
    const client = await connect();
    const runtimes = await client.runtimes.list();
    const syncServers = await client.sync.list();
    const monitors = await client.monitors.list();
    client.disconnect();

    if (runtimes.length > 0) {
      console.log('');
      console.log('RUNTIMES');
      for (const rt of runtimes) {
        const consumers = rt.consumers?.length
          ? rt.consumers.map(c => `\n           └─ ${c}`).join('')
          : '';
        console.log(`  ${rt.language.padEnd(8)} ${rt.name}  port ${rt.port}  ● alive${consumers}`);
      }
    }

    if (syncServers.length > 0) {
      console.log('');
      console.log('SYNC');
      for (const s of syncServers) {
        console.log(`  ${s.projectRoot}  port ${s.port}  ${s.documents} docs`);
      }
    }

    if (monitors.length > 0) {
      console.log('');
      console.log('MONITORS');
      for (const m of monitors) {
        const status = m.connected ? '● active' : '○ disconnected';
        const execs = m.activeExecutions > 0 ? `  ${m.activeExecutions} executing` : '';
        console.log(`  ${m.documentPath}     ${status}${execs}`);
      }
    }
  } catch {
    // daemon not running, already printed
  }
}

// ── help ──────────────────────────────────────────────────────

function printHelp() {
  console.log(`mrmd — daemon, CLI, and service layer

DAEMON
  mrmd daemon start            Start daemon in background
  mrmd daemon stop             Stop daemon and all runtimes
  mrmd daemon status           Show daemon info

RUNTIME
  mrmd runtime start           Start a runtime
    --language <lang>            bash, python, r, julia, ...
    --cwd <path>                 working directory (default: .)
    --name <name>                runtime name (auto-generated if omitted)
    --json                       JSON output
  mrmd runtime stop <name>     Stop a runtime
  mrmd runtime list            List running runtimes

SYNC
  mrmd sync ensure <project>   Start sync server for a project (or return existing)
  mrmd sync stop <project>     Stop a project's sync server
  mrmd sync list               List running sync servers

MONITOR
  mrmd monitor ensure <doc>    Start monitor for a document
    --sync-port <port>           sync server port (required)
    --project-root <path>        project root for linked-table assets
  mrmd monitor stop <doc>      Stop a document's monitor
  mrmd monitor list            List running monitors

PREFERENCES
  mrmd prefs resolve <doc> [lang]  Resolve effective config for a document
  mrmd prefs set-project <project> <lang>  Set project-level override
    --environment <path>           Python environment
    --interpreter <path>           Python interpreter
    --scope <scope>                notebook, project, or global
    --target <id>                  Compute target (default: local)
  mrmd prefs show                  Show raw preferences
    --project <path>               Filter to a project

EXECUTIONS
  mrmd executions list         List executions across all documents
    --active                     only running/queued
    --document <path>            filter to one document
    --language <lang>            filter by language
    --json                       JSON output
  mrmd executions cancel <doc> [execId]  Cancel executions

ENV
  mrmd env discover            Scan for Python interpreters and environments
    --language <lang>            language to scan (default: python)
    --project <path>             project directory to scan
    --json                       JSON output

STATUS
  mrmd status                  Overview of daemon, runtimes, sync, monitors

OPTIONS
  --json                       Machine-readable JSON output
  --help                       Show this help
`);
}

// ── main ──────────────────────────────────────────────────────

const flags = parseFlags(args);

if (!command || command === '--help' || command === 'help') {
  printHelp();
} else if (command === 'daemon' && subcommand === 'start') {
  daemonStart(flags);
} else if (command === 'daemon' && subcommand === 'stop') {
  daemonStop(flags);
} else if (command === 'daemon' && (subcommand === 'status' || !subcommand)) {
  daemonStatus(flags);
} else if (command === 'runtime' && subcommand === 'start') {
  runtimeStart(flags);
} else if (command === 'runtime' && subcommand === 'stop') {
  runtimeStop(flags);
} else if (command === 'runtime' && subcommand === 'list') {
  runtimeList(flags);
} else if (command === 'sync' && subcommand === 'ensure') {
  syncEnsure(flags);
} else if (command === 'sync' && subcommand === 'stop') {
  syncStop(flags);
} else if (command === 'sync' && (subcommand === 'list' || !subcommand)) {
  syncList(flags);
} else if (command === 'monitor' && subcommand === 'ensure') {
  monitorEnsure(flags);
} else if (command === 'monitor' && subcommand === 'stop') {
  monitorStop(flags);
} else if (command === 'monitor' && (subcommand === 'list' || !subcommand)) {
  monitorList(flags);
} else if (command === 'prefs' && subcommand === 'resolve') {
  prefsResolve(flags);
} else if (command === 'prefs' && subcommand === 'set-project') {
  prefsSetProject(flags);
} else if (command === 'prefs' && (subcommand === 'show' || !subcommand)) {
  prefsShow(flags);
} else if (command === 'executions' && (subcommand === 'list' || !subcommand)) {
  executionsList(flags);
} else if (command === 'executions' && subcommand === 'cancel') {
  executionsCancel(flags);
} else if (command === 'env' && (subcommand === 'discover' || subcommand === 'list' || !subcommand)) {
  envDiscover(flags);
} else if (command === 'status') {
  statusCommand(flags);
} else if (command === '--version' || command === 'version') {
  const { readFileSync } = await import('fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
} else {
  console.error(`Unknown command: ${command} ${subcommand || ''}`);
  printHelp();
  process.exit(1);
}

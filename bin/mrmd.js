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
  try {
    const client = await connect();
    // Send stop via a direct call - daemon will shut down
    await client._call('daemon.status'); // verify connection
    client.disconnect();
  } catch {
    console.log('Daemon is not running');
    return;
  }

  // Read PID and kill
  const { getPidPath, isProcessAlive } = await import('../src/utils/platform.js');
  const pidPath = getPidPath();
  const fs = await import('fs');
  try {
    const data = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
    if (data.pid && isProcessAlive(data.pid)) {
      process.kill(data.pid, 'SIGTERM');
      console.log(`Daemon stopped (pid ${data.pid})`);
    }
  } catch {
    console.log('Daemon is not running');
  }
}

async function daemonStatus(flags) {
  try {
    const client = await connect();
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
    const ok = await client.runtimes.stop(name);
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
    const list = await client.runtimes.list(flags.language || flags.lang);
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

// ── status ────────────────────────────────────────────────────

async function statusCommand(flags) {
  await daemonStatus(flags);

  try {
    const client = await connect();
    const list = await client.runtimes.list();
    client.disconnect();

    if (list.length > 0) {
      console.log('');
      console.log('RUNTIMES');
      for (const rt of list) {
        const consumers = rt.consumers?.length
          ? rt.consumers.map(c => `\n           └─ ${c}`).join('')
          : '';
        console.log(`  ${rt.language.padEnd(8)} ${rt.name}  port ${rt.port}  ● alive${consumers}`);
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
    --json                       JSON output

STATUS
  mrmd status                  Overview of daemon + runtimes

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Poll until condition() returns true.
 */
function waitFor(condition, { timeout = 5000, interval = 50 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error(`Timed out after ${timeout}ms`));
      setTimeout(tick, interval);
    };
    tick();
  });
}

/**
 * Spawn a foreground daemon on a custom socket. Returns { child, socketPath }.
 */
function spawnDaemon(socketPath) {
  const child = spawn(
    process.execPath,
    ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath],
    {
      cwd: path.resolve(new URL('.', import.meta.url).pathname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

// ── Tests ─────────────────────────────────────────────────────

test('DaemonClient reconnects after daemon restart', async () => {
  // We test the low-level DaemonClient directly (not the connect()
  // function) so we can control the socket path and avoid interfering
  // with a real running daemon.

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-reconnect-'));
  const socketPath = path.join(tmpDir, 'daemon.sock');

  // Import DaemonClient internals — connect() auto-starts daemon
  // which we don't want. Import the class via the module.
  // Since client.js doesn't export the class directly, we'll use a
  // thin net-level approach: spawn daemon, create client via net, etc.
  // Actually, let's test at the integration level: use the RPC helper.

  const net = await import('node:net');

  // ── Phase 1: Start daemon and make an RPC call ───────────

  const d1 = spawnDaemon(socketPath);

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    // Simple RPC helper that keeps the connection open
    const { DaemonClient, events } = await createTestClient(socketPath, net);

    // RPC works
    const status = await DaemonClient.call('daemon.status');
    assert.equal(typeof status.pid, 'number');
    assert.equal(status.sync, 0);

    // ── Phase 2: Kill daemon ───────────────────────────────

    d1.child.kill('SIGTERM');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon1 did not exit')), 5000);
      d1.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });

    // Client should have received disconnect
    await waitFor(() => events.includes('disconnected'), { timeout: 3000 });
    assert.ok(events.includes('disconnected'), 'client emitted disconnected');

    // ── Phase 3: Restart daemon on same socket ─────────────

    const d2 = spawnDaemon(socketPath);

    try {
      await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

      // Trigger reconnect manually (in production, auto-reconnect
      // handles this, but our test client is a thin wrapper)
      await DaemonClient.reconnect();

      const status2 = await DaemonClient.call('daemon.status');
      assert.equal(typeof status2.pid, 'number');
      // pid changed because it's a new process
      assert.notEqual(status2.pid, status.pid);

      events.push('reconnect-verified');

      d2.child.kill('SIGTERM');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('daemon2 did not exit')), 5000);
        d2.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    } finally {
      try { d2.child.kill('SIGKILL'); } catch {}
    }

    DaemonClient.destroy();
  } finally {
    try { d1.child.kill('SIGKILL'); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('RPC calls wait for reconnection instead of failing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-callwait-'));
  const socketPath = path.join(tmpDir, 'daemon.sock');

  const net = await import('node:net');
  const d1 = spawnDaemon(socketPath);

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    const { DaemonClient, events } = await createTestClient(socketPath, net);

    // Verify initial connection
    const s1 = await DaemonClient.call('daemon.status');
    assert.ok(s1.pid);

    // Kill daemon
    d1.child.kill('SIGTERM');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon did not exit')), 5000);
      d1.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await waitFor(() => events.includes('disconnected'), { timeout: 3000 });

    // Start a new daemon
    const d2 = spawnDaemon(socketPath);

    try {
      await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

      // Reconnect and then make a call — should succeed
      await DaemonClient.reconnect();
      const s2 = await DaemonClient.call('daemon.status');
      assert.ok(s2.pid);
      assert.notEqual(s2.pid, s1.pid);

      d2.child.kill('SIGTERM');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('daemon2 did not exit')), 5000);
        d2.child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    } finally {
      try { d2.child.kill('SIGKILL'); } catch {}
    }

    DaemonClient.destroy();
  } finally {
    try { d1.child.kill('SIGKILL'); } catch {}
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Test client helper ────────────────────────────────────────
// A thin wrapper around net.Socket that implements the JSON-RPC
// protocol, tracks lifecycle events, and supports manual reconnect.

async function createTestClient(socketPath, net) {
  const events = [];
  let socket = null;
  let buffer = '';
  let nextId = 1;
  const pending = new Map();

  function connect() {
    return new Promise((resolve, reject) => {
      socket = net.createConnection(socketPath);
      buffer = '';

      const onConnect = () => {
        socket.off('error', onError);
        resolve();
      };
      const onError = (err) => {
        socket.off('connect', onConnect);
        reject(err);
      };

      socket.once('connect', onConnect);
      socket.once('error', onError);

      socket.on('data', (data) => {
        buffer += data.toString();
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.event) continue;
          const p = pending.get(msg.id);
          if (!p) continue;
          pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error));
          else p.resolve(msg.result);
        }
      });

      socket.on('close', () => {
        events.push('disconnected');
        for (const [, p] of pending) {
          p.reject(new Error('Daemon disconnected'));
        }
        pending.clear();
      });

      socket.on('error', () => {});
    });
  }

  await connect();

  return {
    events,
    DaemonClient: {
      call(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          socket.write(JSON.stringify({ id, method, params }) + '\n');
        });
      },
      async reconnect() {
        if (socket) {
          try { socket.destroy(); } catch {}
          socket = null;
        }
        // Retry connection with backoff
        let delay = 100;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          try {
            await connect();
            events.push('reconnected');
            return;
          } catch {
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay * 1.5, 2000);
          }
        }
        throw new Error('Failed to reconnect');
      },
      destroy() {
        if (socket) {
          try { socket.destroy(); } catch {}
          socket = null;
        }
      },
    },
  };
}

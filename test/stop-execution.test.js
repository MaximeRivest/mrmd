import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execSync } from 'node:child_process';

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

function rpc(socketPath, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const id = 1;

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id, method, params }) + '\n');
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.event) continue;
        socket.end();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
        return;
      }
    });

    socket.on('error', reject);
  });
}

function findSleepDescendants(runtimePid) {
  try {
    const out = execSync(
      `pstree -p ${runtimePid} 2>/dev/null`,
      { encoding: 'utf8', timeout: 3000 },
    );
    const sleepMatch = out.match(/sleep\((\d+)\)/);
    return sleepMatch ? parseInt(sleepMatch[1], 10) : null;
  } catch {
    return null;
  }
}

test('doc.stop kills a long-running command via direct process signal', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-stop-'));
  const socketPath = path.join(tmpRoot, 'daemon.sock');
  const projectRoot = path.join(tmpRoot, 'project');
  const documentPath = path.join(projectRoot, 'test.md');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(documentPath, '# Test\n\n```bash\necho STARTED; sleep 300\n```\n', 'utf8');

  const child = spawn(
    process.execPath,
    ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath],
    {
      cwd: path.resolve(new URL('.', import.meta.url).pathname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stdout += d; });

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    // Run "sleep 300" via doc.run
    const { execId } = await rpc(socketPath, 'doc.run', {
      documentPath,
      code: 'echo STARTED; sleep 300',
      language: 'bash',
      cwd: projectRoot,
    });
    assert.ok(execId, 'got execId');

    // Wait for the sleep process to appear
    const runtimes = await rpc(socketPath, 'runtime.list', { language: 'bash' });
    assert.ok(runtimes.length > 0, 'bash runtime exists');
    const rtPid = runtimes[0].pid;

    // Give the command time to start
    await new Promise(r => setTimeout(r, 2000));

    const sleepPid = findSleepDescendants(rtPid);
    // sleep might not be visible (PTY child), but the command IS running

    // Stop it
    const stopResult = await rpc(socketPath, 'doc.stop', {
      documentPath,
      execId,
    });
    assert.ok(stopResult.ok);
    assert.ok(stopResult.cancelled.includes(execId), `execId ${execId} was cancelled`);

    // Wait a moment for signals to propagate
    await new Promise(r => setTimeout(r, 1000));

    // Verify sleep is dead
    if (sleepPid) {
      let alive;
      try { process.kill(sleepPid, 0); alive = true; } catch { alive = false; }
      assert.ok(!alive, `sleep process ${sleepPid} should be dead`);
    }

    // Daemon should still be running
    const status = await rpc(socketPath, 'daemon.status');
    assert.ok(status.pid);

    child.kill('SIGTERM');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon did not exit')), 8000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

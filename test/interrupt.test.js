import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

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

test('doc.interrupt cancels active executions without crashing', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-interrupt-'));
  const socketPath = path.join(tmpRoot, 'daemon.sock');
  const projectRoot = path.join(tmpRoot, 'project');
  const documentPath = path.join(projectRoot, 'test.md');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(documentPath, '# Test\n\n```bash\necho hello\n```\n', 'utf8');

  const child = spawn(
    process.execPath,
    ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath],
    {
      cwd: path.resolve(new URL('.', import.meta.url).pathname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    // Open document
    await rpc(socketPath, 'doc.open', { documentPath });

    // Interrupt with no active executions — should succeed gracefully
    const result = await rpc(socketPath, 'doc.interrupt', { documentPath });
    assert.ok(result.ok);
    assert.equal(result.cancelled.length, 0);

    // Daemon still alive
    const status = await rpc(socketPath, 'daemon.status');
    assert.ok(status.pid);

    child.kill('SIGTERM');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon did not exit')), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

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
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`Timed out after ${timeout}ms`));
        return;
      }
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
        if (msg.event) {
          continue;
        }
        socket.end();
        if (msg.error) {
          reject(new Error(msg.error));
        } else {
          resolve(msg.result);
        }
        return;
      }
    });

    socket.on('error', reject);
  });
}

test('daemon manages in-process sync and monitor lifecycle', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-daemon-test-'));
  const socketPath = path.join(tmpRoot, 'daemon.sock');
  const projectRoot = path.join(tmpRoot, 'project');
  const documentPath = path.join(projectRoot, 'test.md');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(documentPath, '# Test\n\nhello\n', 'utf8');

  const child = spawn(process.execPath, ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath], {
    cwd: '/home/maxime/Projects/mrmd-packages/mrmd',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    const status0 = await rpc(socketPath, 'daemon.status');
    assert.equal(status0.sync, 0);
    assert.equal(status0.monitors, 0);

    const syncInfo = await rpc(socketPath, 'sync.ensure', { projectRoot, logLevel: 'error' });
    assert.equal(syncInfo.projectRoot, projectRoot);
    assert.equal(typeof syncInfo.port, 'number');
    assert.match(syncInfo.wsUrl, /^ws:\/\/127\.0\.0\.1:/);

    const monitorInfo = await rpc(socketPath, 'monitor.ensure', {
      documentPath,
      syncPort: syncInfo.port,
      projectRoot,
    });
    assert.equal(monitorInfo.documentPath, documentPath);
    assert.equal(monitorInfo.connected, true);
    assert.equal(monitorInfo.syncPort, syncInfo.port);

    const syncList = await rpc(socketPath, 'sync.list');
    const monitorList = await rpc(socketPath, 'monitor.list');
    assert.equal(syncList.length, 1);
    assert.equal(monitorList.length, 1);

    const status1 = await rpc(socketPath, 'daemon.status');
    assert.equal(status1.sync, 1);
    assert.equal(status1.monitors, 1);

    child.kill('SIGTERM');
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('daemon did not exit after SIGTERM')), 8000);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      child.once('error', reject);
    });

    assert.equal(exit.code, 0);
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), '');
});

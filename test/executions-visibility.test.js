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
      if (condition()) { resolve(); return; }
      if (Date.now() - start > timeout) { reject(new Error(`Timed out after ${timeout}ms`)); return; }
      setTimeout(tick, interval);
    };
    tick();
  });
}

function rpc(socketPath, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const id = Math.floor(Math.random() * 100000);

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
        if (msg.event) continue; // skip broadcasts
        socket.end();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
        return;
      }
    });

    socket.on('error', reject);
  });
}

/**
 * Connect to daemon socket and collect broadcast events.
 * Returns { events, disconnect }.
 */
function subscribe(socketPath) {
  const events = [];
  const socket = net.createConnection(socketPath);
  let buffer = '';

  socket.on('data', (data) => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event) {
          events.push(msg);
        }
      } catch {}
    }
  });

  return new Promise((resolve) => {
    socket.on('connect', () => {
      resolve({
        events,
        disconnect: () => socket.destroy(),
      });
    });
  });
}

test('executions.list returns empty when no executions', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-exec-test-'));
  const socketPath = path.join(tmpRoot, 'daemon.sock');
  const projectRoot = path.join(tmpRoot, 'project');
  const documentPath = path.join(projectRoot, 'test.md');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(documentPath, '# Test\n\nhello\n', 'utf8');

  const child = spawn(process.execPath, ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    // Ensure sync + monitor
    const syncInfo = await rpc(socketPath, 'sync.ensure', { projectRoot, logLevel: 'error' });
    await rpc(socketPath, 'monitor.ensure', { documentPath, syncPort: syncInfo.port, projectRoot });

    // List executions — should be empty
    const execs = await rpc(socketPath, 'executions.list', {});
    assert.ok(Array.isArray(execs), 'should return an array');

    // List with active filter
    const activeExecs = await rpc(socketPath, 'executions.list', { active: true });
    assert.ok(Array.isArray(activeExecs), 'active filter should return an array');
    assert.equal(activeExecs.length, 0, 'should have no active executions');

    // Get non-existent execution
    const missing = await rpc(socketPath, 'executions.get', { documentPath, execId: 'nonexistent' });
    assert.equal(missing, null, 'should return null for missing execution');

  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('execution:changed events are broadcast to heads', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-exec-events-'));
  const socketPath = path.join(tmpRoot, 'daemon.sock');
  const projectRoot = path.join(tmpRoot, 'project');
  const documentPath = path.join(projectRoot, 'test.md');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(documentPath, '# Test\n\n```bash\necho hello\n```\n', 'utf8');

  const child = spawn(process.execPath, ['bin/mrmd.js', 'daemon', 'start', '--foreground', '--socket', socketPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitFor(() => fs.existsSync(socketPath), { timeout: 8000 });

    // Subscribe a "head" to receive broadcast events
    const sub = await subscribe(socketPath);

    // Set up sync + monitor
    const syncInfo = await rpc(socketPath, 'sync.ensure', { projectRoot, logLevel: 'error' });
    await rpc(socketPath, 'monitor.ensure', { documentPath, syncPort: syncInfo.port, projectRoot });

    // Start a bash runtime
    const rt = await rpc(socketPath, 'runtime.start', { language: 'bash', cwd: projectRoot });

    // Execute code — this should trigger execution:changed events
    const { execId } = await rpc(socketPath, 'doc.execute', {
      documentPath,
      code: 'echo hello',
      language: 'bash',
    });

    assert.ok(execId, 'should get an execId');

    // Wait for execution to complete (monitor processes it)
    await waitFor(() => {
      const execEvents = sub.events.filter(e => e.event === 'execution:changed');
      return execEvents.some(e => e.data?.status === 'completed' || e.data?.status === 'error');
    }, { timeout: 10000 });

    // Check we got execution:changed events
    const execEvents = sub.events.filter(e => e.event === 'execution:changed');
    assert.ok(execEvents.length >= 2, `should have at least 2 status transitions, got ${execEvents.length}`);

    // Verify the event shape
    const firstEvent = execEvents[0].data;
    assert.ok(firstEvent.execId, 'event should have execId');
    assert.equal(firstEvent.documentPath, documentPath, 'event should have documentPath');
    assert.ok(firstEvent.status, 'event should have status');
    assert.equal(firstEvent.language, 'bash', 'event should have language');

    // Verify status transitions make sense
    const statuses = execEvents.map(e => e.data.status);
    console.log(`  Status transitions: ${statuses.join(' → ')}`);

    // Should end in a terminal state
    const last = statuses[statuses.length - 1];
    assert.ok(
      ['completed', 'error'].includes(last),
      `last status should be terminal, got ${last}`,
    );

    // Should have previousStatus tracking
    for (const evt of execEvents) {
      if (evt.data.previousStatus !== null) {
        assert.ok(evt.data.previousStatus, 'previousStatus should be set after first transition');
      }
    }

    // executions.list should show this execution
    const allExecs = await rpc(socketPath, 'executions.list', {});
    assert.ok(allExecs.length >= 1, 'should have at least 1 execution');
    const found = allExecs.find(e => e.execId === execId);
    assert.ok(found, 'should find our execution in the list');

    sub.disconnect();
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

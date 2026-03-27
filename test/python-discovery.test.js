import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findUv,
  findInterpreters,
  findEnvironments,
  resolveEnvironment,
  resolveInterpreter,
  isVenv,
  isCondaEnv,
  readPyvenvCfg,
  venvBinDir,
  envPython,
  envMrmdPython,
} from '../src/utils/python.js';

// ── Path helpers ──────────────────────────────────────────

test('venvBinDir returns bin on unix', () => {
  // This test runs on Linux
  if (process.platform === 'win32') return;
  assert.equal(venvBinDir(), 'bin');
});

test('envPython constructs correct path', () => {
  if (process.platform === 'win32') return;
  assert.equal(envPython('/project/.venv'), '/project/.venv/bin/python');
});

test('envMrmdPython constructs correct path', () => {
  if (process.platform === 'win32') return;
  assert.equal(envMrmdPython('/project/.venv'), '/project/.venv/bin/mrmd-python');
});

// ── Venv detection ────────────────────────────────────────

test('isVenv returns true for a real venv', () => {
  // Find a real venv on this machine to test
  const envs = findEnvironments({ cwd: process.cwd() });
  const venv = envs.find(e => e.type === 'venv');
  if (!venv) {
    console.log('  (skipped: no venvs found on this machine)');
    return;
  }
  assert.equal(isVenv(venv.path), true);
});

test('isVenv returns false for a plain directory', () => {
  assert.equal(isVenv('/tmp'), false);
});

test('isCondaEnv returns false for a venv', () => {
  const envs = findEnvironments({ cwd: process.cwd() });
  const venv = envs.find(e => e.type === 'venv');
  if (!venv) return;
  assert.equal(isCondaEnv(venv.path), false);
});

// ── pyvenv.cfg parsing ────────────────────────────────────

test('readPyvenvCfg parses version from a real venv', () => {
  const envs = findEnvironments({ cwd: process.cwd() });
  const venv = envs.find(e => e.type === 'venv');
  if (!venv) {
    console.log('  (skipped: no venvs found)');
    return;
  }
  const cfg = readPyvenvCfg(venv.path);
  assert.ok(cfg, 'pyvenv.cfg should be parseable');
  assert.ok(cfg.version, 'should have a version');
  assert.match(cfg.version, /^\d+\.\d+/, 'version should start with X.Y');
});

test('readPyvenvCfg returns null for non-venv', () => {
  assert.equal(readPyvenvCfg('/tmp'), null);
});

// ── findUv ────────────────────────────────────────────────

test('findUv finds uv on this machine', () => {
  const uv = findUv();
  // uv is installed on this machine per the earlier check
  assert.ok(uv, 'uv should be found');
  assert.ok(uv.endsWith('uv') || uv.endsWith('uv.exe'), `unexpected uv path: ${uv}`);
});

// ── findInterpreters ──────────────────────────────────────

test('findInterpreters returns installed Pythons', () => {
  const uv = findUv();
  if (!uv) {
    console.log('  (skipped: uv not found)');
    return;
  }

  const interpreters = findInterpreters(uv);
  assert.ok(interpreters.length > 0, 'should find at least one Python');

  for (const interp of interpreters) {
    assert.ok(interp.path, 'should have a path');
    assert.ok(interp.version, 'should have a version');
    assert.match(interp.version, /^\d+\.\d+/, 'version should be X.Y+');
    assert.ok(interp.source, 'should have a source');
    assert.ok(interp.implementation, 'should have an implementation');
  }

  console.log(`  Found ${interpreters.length} interpreters:`);
  for (const i of interpreters) {
    console.log(`    ${i.version.padEnd(12)} ${i.source.padEnd(10)} ${i.path}`);
  }
});

test('findInterpreters deduplicates symlinks', () => {
  const uv = findUv();
  if (!uv) return;

  const interpreters = findInterpreters(uv);
  const paths = interpreters.map(i => i.path);
  // There should be no duplicate resolved paths
  // (there might be duplicate display paths if uv reports them,
  // but our dedup is on realpath)
  const resolved = interpreters.map(i => {
    try { return require('fs').realpathSync(i.path); } catch { return i.path; }
  });
  const unique = new Set(resolved);
  assert.equal(resolved.length, unique.size, 'should have no duplicate resolved paths');
});

// ── findEnvironments ──────────────────────────────────────

test('findEnvironments returns valid structure', () => {
  const envs = findEnvironments({ cwd: process.cwd() });

  console.log(`  Found ${envs.length} environments:`);
  for (const e of envs) {
    const bridge = e.hasBridge ? 'mrmd-python ✓' : 'mrmd-python ✗';
    const ver = e.pythonVersion || '?';
    console.log(`    ${e.type.padEnd(6)} ${e.source.padEnd(20)} ${ver.padEnd(10)} ${bridge}  ${e.path}`);
  }

  for (const env of envs) {
    assert.ok(env.path, 'should have a path');
    assert.ok(['venv', 'conda'].includes(env.type), `unexpected type: ${env.type}`);
    assert.ok(env.source, 'should have a source');
    assert.equal(typeof env.hasBridge, 'boolean', 'hasBridge should be boolean');
  }
});

test('findEnvironments finds .venv at project root via walk-up', () => {
  // mrmd-packages/ has both .git and .venv — search from there should find it
  const parentProject = path.resolve(process.cwd(), '..');
  const parentVenv = path.join(parentProject, '.venv');

  if (!isVenv(parentVenv)) {
    console.log('  (skipped: no .venv in parent project)');
    return;
  }

  // Search from the parent (which has both .git and .venv) — should find .venv
  const envs = findEnvironments({ cwd: parentProject });
  const found = envs.some(e => {
    try { return fs.realpathSync(e.path) === fs.realpathSync(parentVenv); } catch { return false; }
  });
  assert.ok(found, `should find .venv at ${parentVenv} when cwd is its own project`);
});

test('findEnvironments respects project boundary on walk-up', () => {
  // mrmd/ has its own .git — walk-up from mrmd/ should NOT cross into parent's .venv
  const parentProject = path.resolve(process.cwd(), '..');
  const parentVenv = path.join(parentProject, '.venv');

  if (!isVenv(parentVenv)) {
    console.log('  (skipped: no .venv in parent project)');
    return;
  }

  // Search from mrmd/ (which has its own .git) — should NOT find parent's .venv via walk-up
  // (it would only find it if explicitly told about the parent as projectRoot)
  const envs = findEnvironments({ cwd: process.cwd() });
  const found = envs.some(e => {
    try { return fs.realpathSync(e.path) === fs.realpathSync(parentVenv); } catch { return false; }
  });
  assert.ok(!found, 'should not walk past own .git boundary into parent project');
});

test('findEnvironments deduplicates', () => {
  const envs = findEnvironments({ cwd: process.cwd() });
  const paths = new Set(envs.map(e => e.path));
  assert.equal(envs.length, paths.size, 'should have no duplicate paths');
});

test('findEnvironments with projectRoot scans project', () => {
  const envs = findEnvironments({
    cwd: process.cwd(),
    projectRoot: process.cwd(),
  });
  // Just verify it doesn't crash — project scan is additive
  assert.ok(Array.isArray(envs));
});

// ── Performance ───────────────────────────────────────────

test('findEnvironments completes in under 5 seconds', () => {
  const start = performance.now();
  const envs = findEnvironments({ cwd: process.cwd() });
  const elapsed = performance.now() - start;
  console.log(`  findEnvironments: ${Math.round(elapsed)}ms (${envs.length} results)`);
  assert.ok(elapsed < 5000, `took ${elapsed}ms, expected < 5000ms`);
});

test('findInterpreters completes in under 5 seconds', () => {
  const uv = findUv();
  if (!uv) return;

  const start = performance.now();
  const interpreters = findInterpreters(uv);
  const elapsed = performance.now() - start;
  console.log(`  findInterpreters: ${Math.round(elapsed)}ms (${interpreters.length} results)`);
  assert.ok(elapsed < 5000, `took ${elapsed}ms, expected < 5000ms`);
});

// ── resolveEnvironment ────────────────────────────────────

test('resolveEnvironment returns null when no env in project', () => {
  // mrmd/ has no .venv — should return null
  const result = resolveEnvironment({ cwd: process.cwd() });
  // This project (mrmd/) has no .venv, so null unless VIRTUAL_ENV is set
  if (!process.env.VIRTUAL_ENV) {
    assert.equal(result, null, 'should return null when no env found');
  }
});

test('resolveEnvironment finds .venv at project root', () => {
  const parentProject = path.resolve(process.cwd(), '..');
  const parentVenv = path.join(parentProject, '.venv');
  if (!isVenv(parentVenv)) {
    console.log('  (skipped: no .venv in parent project)');
    return;
  }

  const result = resolveEnvironment({ cwd: parentProject });
  assert.ok(result, 'should resolve an environment');
  assert.equal(result.via, 'project-venv');
  assert.equal(result.type, 'venv');
  assert.ok(result.interpreter, 'should have interpreter');
  assert.ok(result.environment, 'should have environment');
  assert.equal(typeof result.hasBridge, 'boolean');
});

test('resolveEnvironment respects explicit config.environment', () => {
  const parentVenv = path.join(path.resolve(process.cwd(), '..'), '.venv');
  if (!isVenv(parentVenv)) {
    console.log('  (skipped: no .venv in parent project)');
    return;
  }

  const result = resolveEnvironment({ cwd: '/tmp', environment: parentVenv });
  assert.ok(result, 'should resolve from explicit path');
  assert.equal(result.via, 'config');
  assert.equal(result.environment, parentVenv);
});

test('resolveEnvironment returns correct structure', () => {
  const parentProject = path.resolve(process.cwd(), '..');
  const result = resolveEnvironment({ cwd: parentProject });
  if (!result) {
    console.log('  (skipped: no env found)');
    return;
  }

  assert.ok(result.interpreter, 'should have interpreter');
  assert.ok(result.environment, 'should have environment');
  assert.ok(['venv', 'conda'].includes(result.type), 'type should be venv or conda');
  assert.equal(typeof result.hasBridge, 'boolean');
  assert.ok(result.pythonVersion, 'should have pythonVersion');
  assert.ok(result.via, 'should have via');
});

test('resolveEnvironment is fast (<1ms per call)', () => {
  const parentProject = path.resolve(process.cwd(), '..');
  const runs = 100;
  const start = performance.now();
  for (let i = 0; i < runs; i++) {
    resolveEnvironment({ cwd: parentProject });
  }
  const elapsed = performance.now() - start;
  const perCall = elapsed / runs;
  console.log(`  resolveEnvironment: ${perCall.toFixed(3)}ms/call`);
  assert.ok(perCall < 1, `${perCall.toFixed(3)}ms/call exceeds 1ms budget`);
});

// ── resolveInterpreter ────────────────────────────────────

test('resolveInterpreter finds a Python', () => {
  const result = resolveInterpreter();
  assert.ok(result, 'should find at least one Python');
  assert.ok(result.path, 'should have a path');
  assert.ok(result.source, 'should have a source');
  console.log(`  Found: ${result.path} (${result.version || '?'}, ${result.source})`);
});

test('resolveInterpreter respects explicit config.interpreter', () => {
  const result = resolveInterpreter({ interpreter: '/usr/bin/python3' });
  if (!result) {
    // /usr/bin/python3 might not exist on all machines
    console.log('  (skipped: /usr/bin/python3 not found)');
    return;
  }
  assert.equal(result.path, '/usr/bin/python3');
  assert.equal(result.source, 'config');
});

test('resolveInterpreter returns null for nonexistent explicit path', () => {
  const result = resolveInterpreter({ interpreter: '/nonexistent/python3' });
  assert.equal(result, null);
});

test('resolveInterpreter from environment gets version from pyvenv.cfg', () => {
  const parentVenv = path.join(path.resolve(process.cwd(), '..'), '.venv');
  if (!isVenv(parentVenv)) {
    console.log('  (skipped: no .venv in parent project)');
    return;
  }

  const result = resolveInterpreter({ environment: parentVenv });
  assert.ok(result, 'should find python in env');
  assert.equal(result.source, 'environment');
  assert.ok(result.version, 'should have version from pyvenv.cfg');
  assert.match(result.version, /^\d+\.\d+/, 'version should be X.Y+');
});

test('resolveInterpreter is fast (<1ms per call)', () => {
  const runs = 100;
  const start = performance.now();
  for (let i = 0; i < runs; i++) {
    resolveInterpreter();
  }
  const elapsed = performance.now() - start;
  const perCall = elapsed / runs;
  console.log(`  resolveInterpreter: ${perCall.toFixed(3)}ms/call`);
  assert.ok(perCall < 1, `${perCall.toFixed(3)}ms/call exceeds 1ms budget`);
});

// ── Performance ───────────────────────────────────────────

test('full scan (interpreters + environments) under 5 seconds', () => {
  const uv = findUv();
  const start = performance.now();
  const interpreters = uv ? findInterpreters(uv) : [];
  const envs = findEnvironments({ cwd: process.cwd() });
  const elapsed = performance.now() - start;
  console.log(`  Full scan: ${Math.round(elapsed)}ms (${interpreters.length} interpreters, ${envs.length} environments)`);
  assert.ok(elapsed < 5000, `took ${elapsed}ms, expected < 5000ms`);
});

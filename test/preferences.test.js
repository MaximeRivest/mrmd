import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PreferencesService } from '../src/services/preferences.js';

function makeTmpProject() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mrmd-prefs-test-'));
  const projectRoot = path.join(tmpRoot, 'project');
  const docPath = path.join(projectRoot, 'docs', 'analysis.md');
  fs.mkdirSync(path.join(projectRoot, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.writeFileSync(docPath, '# Test\n', 'utf8');
  return { tmpRoot, projectRoot, docPath };
}

function makePrefs(tmpRoot) {
  const configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  // Override CONFIG_DIR by setting the _configPath directly
  const prefs = new PreferencesService();
  prefs._configPath = path.join(configDir, 'preferences.json');
  return prefs;
}

// ── resolve ───────────────────────────────────────────────

test('resolve returns a valid config with defaults', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const config = prefs.resolve(docPath, 'python');

  assert.equal(config.language, 'python');
  assert.equal(config.scope, 'notebook');
  assert.equal(config.projectRoot, projectRoot);
  assert.equal(config.documentPath, docPath);
  assert.equal(config.target, 'local');
  assert.ok(config.name, 'should have a runtime name');
  assert.ok(config.name.startsWith('rt:notebook:'), `name should be notebook-scoped: ${config.name}`);
  assert.ok(config.cwd, 'should have a cwd');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('resolve uses project root as cwd', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const config = prefs.resolve(docPath, 'python');
  assert.equal(config.cwd, projectRoot);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── setProjectOverride ────────────────────────────────────

test('setProjectOverride stores and persists', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const venvPath = path.join(projectRoot, '.venv-gpu');

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: venvPath,
    scope: 'project',
  });

  // Verify it's in the raw prefs
  const raw = prefs.get();
  assert.equal(raw.projects[projectRoot].python.environment, venvPath);
  assert.equal(raw.projects[projectRoot].python.scope, 'project');

  // Verify it persists to disk
  const ondisk = JSON.parse(fs.readFileSync(prefs._configPath, 'utf8'));
  assert.equal(ondisk.projects[projectRoot].python.environment, venvPath);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('setProjectOverride affects resolve', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);
  const venvPath = path.join(projectRoot, '.venv-gpu');

  // Before: auto-discovery
  const before = prefs.resolve(docPath, 'python');

  // Set override
  prefs.setProjectOverride(projectRoot, 'python', {
    environment: venvPath,
    scope: 'project',
  });

  // After: uses the override
  const after = prefs.resolve(docPath, 'python');
  assert.equal(after.environment, venvPath);
  assert.equal(after.scope, 'project');
  assert.ok(after.name.startsWith('rt:project:'), 'runtime name should be project-scoped');

  // Different scope means different runtime name
  assert.notEqual(before.name, after.name);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('setProjectOverride emits prefs:changed', () => {
  const { tmpRoot, projectRoot } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const events = [];
  prefs.on('prefs:changed', (e) => events.push(e));

  prefs.setProjectOverride(projectRoot, 'python', { environment: '/some/venv' });

  assert.equal(events.length, 1);
  assert.equal(events[0].level, 'project');
  assert.equal(events[0].projectRoot, projectRoot);
  assert.equal(events[0].language, 'python');
  assert.equal(events[0].patch.environment, '/some/venv');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── setNotebookOverride ───────────────────────────────────

test('notebook override takes precedence over project', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/project/.venv-project',
  });

  prefs.setNotebookOverride(docPath, 'python', {
    environment: '/project/.venv-notebook',
  });

  const config = prefs.resolve(docPath, 'python');
  assert.equal(config.environment, '/project/.venv-notebook');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('clearNotebookOverride falls back to project', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/project/.venv-project',
  });

  prefs.setNotebookOverride(docPath, 'python', {
    environment: '/project/.venv-notebook',
  });

  // Clear notebook override
  prefs.clearNotebookOverride(docPath, 'python');

  const config = prefs.resolve(docPath, 'python');
  assert.equal(config.environment, '/project/.venv-project');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Runtime naming ────────────────────────────────────────

test('same scope + same env = same runtime name', () => {
  const { tmpRoot, projectRoot } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const doc1 = path.join(projectRoot, 'docs', 'a.md');
  const doc2 = path.join(projectRoot, 'docs', 'b.md');
  fs.writeFileSync(doc1, '# A\n', 'utf8');
  fs.writeFileSync(doc2, '# B\n', 'utf8');

  prefs.setProjectOverride(projectRoot, 'python', {
    scope: 'project',
    environment: '/project/.venv',
  });

  const config1 = prefs.resolve(doc1, 'python');
  const config2 = prefs.resolve(doc2, 'python');

  // Project scope: same project + same env → same runtime
  assert.equal(config1.name, config2.name);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('notebook scope = different runtime per document', () => {
  const { tmpRoot, projectRoot } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  const doc1 = path.join(projectRoot, 'docs', 'a.md');
  const doc2 = path.join(projectRoot, 'docs', 'b.md');
  fs.writeFileSync(doc1, '# A\n', 'utf8');
  fs.writeFileSync(doc2, '# B\n', 'utf8');

  prefs.setProjectOverride(projectRoot, 'python', {
    scope: 'notebook',
    environment: '/project/.venv',
  });

  const config1 = prefs.resolve(doc1, 'python');
  const config2 = prefs.resolve(doc2, 'python');

  // Notebook scope: same project + same env but different doc → different runtime
  assert.notEqual(config1.name, config2.name);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('different environment = different runtime name', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/venv-a',
  });
  const config1 = prefs.resolve(docPath, 'python');

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/venv-b',
  });
  const config2 = prefs.resolve(docPath, 'python');

  assert.notEqual(config1.name, config2.name);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('target is included in runtime name', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/project/.venv',
    target: 'local',
  });
  const config1 = prefs.resolve(docPath, 'python');

  prefs.setProjectOverride(projectRoot, 'python', {
    environment: '/project/.venv',
    target: 'gpu-server',
  });
  const config2 = prefs.resolve(docPath, 'python');

  // Same env but different target → different runtime
  assert.notEqual(config1.name, config2.name);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── get() with project filter ─────────────────────────────

test('get with projectRoot filters notebooks', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setNotebookOverride(docPath, 'python', { environment: '/a' });
  prefs.setNotebookOverride('/other/project/doc.md', 'python', { environment: '/b' });

  const filtered = prefs.get({ projectRoot });
  assert.ok(filtered.notebooks[docPath], 'should include project notebook');
  assert.ok(!filtered.notebooks['/other/project/doc.md'], 'should exclude other project');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ── cwd modes ─────────────────────────────────────────────

test('cwd mode: document uses document directory', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', { cwd: 'document' });

  const config = prefs.resolve(docPath, 'python');
  assert.equal(config.cwd, path.dirname(docPath));

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('cwd mode: absolute path', () => {
  const { tmpRoot, projectRoot, docPath } = makeTmpProject();
  const prefs = makePrefs(tmpRoot);

  prefs.setProjectOverride(projectRoot, 'python', { cwd: '/custom/path' });

  const config = prefs.resolve(docPath, 'python');
  assert.equal(config.cwd, '/custom/path');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

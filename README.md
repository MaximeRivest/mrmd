# mrmd-core

Headless service layer for mrmd — runtime lifecycle, project discovery, file operations.

```
mrmd-cli        ─┐
mrmd-electron    │
mrmd-server      ├── all depend on ── mrmd-core
mrmd-vscode      │
...             ─┘
```

This is a fresh implementation. The existing `mrmd-electron/src/services/` code is reference material for behavior and edge cases, but mrmd-core is not an extraction — it's a clean rewrite with a simpler, language-agnostic API.

## Install

```bash
npm install mrmd-core
```

---

## Overview

| Export | What it does |
|--------|-------------|
| `RuntimeService` | Start, stop, restart, list runtimes; track which documents use which runtimes |
| `Preferences` | Runtime configuration: scope, profiles, cwd, compute targets — per project and per notebook |
| `ProjectService` | Discover projects, scan files, build nav trees |
| `FileService` | Create, read, write, move, delete files with automatic link refactoring |
| `AssetService` | Manage `_assets/` directory, hash-based dedup, orphan detection |
| `RecentService` | Track recently opened files and projects across all heads |
| `EnvironmentService` | Discover, provision, and install interpreters, environments, and languages |
| `PackageService` | Install, list, and check packages within runtime environments |
| `DocumentModel` | Parse a markdown file into structured cells, outputs, and frontmatter |
| `Runner` | Execute a notebook headlessly — all cells or a subset |
| `Exporter` | Convert notebooks to HTML, PDF, Python script, UV script |
| `SettingsService` | User settings (API keys, editor prefs) shared across all heads |
| `HealthService` | Diagnose the setup — what's installed, what's broken, what's missing |

All pure Node.js. No Electron. No browser APIs. No Express.

---

## Configuration

Runtime configuration is **app-owned state** stored in `<CONFIG_DIR>/preferences.json`. Not in markdown documents.

| OS | `CONFIG_DIR` |
|----|-------------|
| Linux | `~/.config/mrmd` (or `$XDG_CONFIG_HOME/mrmd`) |
| macOS | `~/Library/Application Support/mrmd` |
| Windows | `%APPDATA%\mrmd` |

What it manages:

- **Scope** per language — notebook-level or project-level runtimes
- **Profiles** — which interpreter/environment to use
- **CWD mode** — project root, document directory, or custom
- **Compute targets** — local machine, remote servers
- **Per-project overrides**
- **Per-notebook overrides**

`Preferences` owns this file. `RuntimeService` consumes the resolved config.

---

## init()

First-time setup. Creates config directories and default files. Safe to call repeatedly — skips what exists.

```js
import { init } from 'mrmd-core';

await init();
// Creates:
//   <CONFIG_DIR>/
//   <CONFIG_DIR>/preferences.json
//   <CONFIG_DIR>/settings.json
//   <DATA_DIR>/runtimes/          (runtime registry)
```

Heads should call this on first launch. `mrmd-cli` calls it via `mrmd init`.

---

## RuntimeService

Manages runtime processes. A runtime is one process, one PID, one port, one namespace — one REPL, as defined by the [MRP protocol](../spec/mrp-protocol.md).

```js
import { RuntimeService } from 'mrmd-core';

const runtimes = new RuntimeService();
```

### Starting a runtime

#### `runtimes.start(config) → Promise<RuntimeInfo>`

```js
const rt = await runtimes.start({
  name: 'my-runtime',
  language: 'python',
  cwd: '/path/to/project',
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique identifier (auto-generated in normal use — see [naming](#runtime-naming)) |
| `language` | yes | `python`, `r`, `julia`, `bash`, `node`, `ruby`, `pty`, ... |
| `cwd` | yes | Working directory |
| `interpreter` | no | Path to executable. Auto-discovered if omitted. |
| `environment` | no | Package isolation root. Meaning varies by language. Auto-discovered if omitted. |
| `env` | no | Extra environment variables passed to the process. |

Reuses an existing runtime if one with the same name is already alive.

**`interpreter` and `environment` across languages:**

| Language | `interpreter` | `environment` | Zero-config behavior |
|----------|--------------|---------------|----------------------|
| Python | `python` binary | venv directory | finds or creates `.venv`, installs `mrmd-python` |
| R | `Rscript` binary | renv library path | installs required R packages |
| Julia | `julia` binary | project dir (has `Project.toml`) | runs `Pkg.instantiate()` |
| Node | `node` binary | dir with `package.json` | — |
| Ruby | `ruby` binary | dir with `Gemfile` | `bundle install` |
| Bash | _(auto)_ | _(n/a)_ | — |
| PTY | _(auto)_ | _(n/a)_ | — |

- If you set `environment`, the `interpreter` is derived from it when possible (e.g. Python venv contains the binary).
- If you set `interpreter` only, no package isolation — runs against system packages.
- If you set neither, mrmd auto-discovers and auto-provisions.

**Examples:**

```js
// Zero-config — discovers or creates .venv
await runtimes.start({ name: 'rt', language: 'python', cwd: '/project' });

// Explicit environment
await runtimes.start({ name: 'rt', language: 'python', cwd: '/project', environment: '/project/.venv' });

// Explicit interpreter, no isolation
await runtimes.start({ name: 'rt', language: 'python', cwd: '/project', interpreter: '/usr/bin/python3.12' });

// R — discovers Rscript on PATH
await runtimes.start({ name: 'rt', language: 'r', cwd: '/project' });

// Julia — discovers julia on PATH
await runtimes.start({ name: 'rt', language: 'julia', cwd: '/project' });

// GPU pinning
await runtimes.start({ name: 'rt', language: 'python', cwd: '/project', env: { CUDA_VISIBLE_DEVICES: '0' } });
```

### RuntimeInfo

Returned by `start`, `restart`, `list`, `attach`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique runtime name |
| `language` | string | Language key |
| `pid` | number | OS process ID |
| `port` | number | MRP server port |
| `url` | string | MRP base URL (`http://127.0.0.1:{port}/mrp/v1`) |
| `cwd` | string | Working directory |
| `interpreter` | string \| null | Resolved executable path |
| `environment` | string \| null | Resolved isolation root |
| `env` | object \| null | Extra environment variables |
| `alive` | boolean | Whether the process is running |
| `startedAt` | string | ISO timestamp |
| `consumers` | string[] | Document paths currently using this runtime |

### Lifecycle

#### `runtimes.stop(name) → Promise<boolean>`

Kill and release all resources (GPU memory, file handles, everything).

#### `runtimes.restart(name) → Promise<RuntimeInfo>`

Stop then start with the same config.

#### `runtimes.list(language?) → RuntimeInfo[]`

List running runtimes. Optional language filter.

#### `runtimes.shutdown()`

Stop all runtimes. Call on process exit.

### Document binding

Runtimes track which documents are using them.

#### `runtimes.attach(name, documentPath) → RuntimeInfo | null`

Register a document as a consumer of a runtime. Returns null if the runtime is dead.

#### `runtimes.detach(name, documentPath) → void`

Unregister a document. When the last consumer detaches, the runtime can optionally auto-stop (configurable).

#### `runtimes.consumers(name?) → Map<string, string[]>`

Which documents are using which runtimes.

```js
runtimes.consumers();
// → Map {
//   'rt:notebook:a1b2:d4e5:python:g7h8' => ['/project/analysis.md'],
//   'rt:project:a1b2:python:x9y0'       => ['/project/intro.md', '/project/methods.md'],
// }
```

### Discovery

#### `runtimes.isAvailable(language) → { available, error? }`

Check if a language runtime can be started on this machine.

#### `runtimes.supportedLanguages() → string[]`

All registered language keys.

### Runtime naming

In normal use, names are auto-generated by `Preferences` based on **scope**:

| Scope | Pattern | Behavior |
|-------|---------|----------|
| `notebook` (default) | `rt:notebook:{projectId}:{docHash}:{lang}:{profileHash}` | Each document gets its own runtime |
| `project` | `rt:project:{projectId}:{lang}:{profileHash}` | All project documents share one runtime |
| `global` | `rt:global:{lang}:{profileHash}` | One runtime per language+profile globally |

Two documents that resolve to the same name share the same process. For scripting/testing, use any name you want.

---

## Preferences

Manages runtime configuration. The full resolution chain: **global defaults → project overrides → notebook overrides**.

```js
import { Preferences } from 'mrmd-core';

const prefs = new Preferences({ projectService });
```

### Resolution

#### `prefs.resolve(documentPath, language, options?) → Promise<ResolvedConfig>`

The main entry point. Given a document and language, resolve the full runtime config.

```js
const config = await prefs.resolve('/project/docs/analysis.md', 'python');
// → {
//   runtimeName: 'rt:notebook:a1b2:d4e5:python:g7h8',
//   language: 'python',
//   scope: 'notebook',
//   cwd: '/project',
//   interpreter: null,       (auto-discover)
//   environment: '/project/.venv',
//   env: {},
//   profile: { kind: 'venv', path: '/project/.venv', label: '.venv' },
//   projectRoot: '/project',
//   documentPath: '/project/docs/analysis.md',
// }
```

This is what you pass to `runtimes.start()`:

```js
const config = await prefs.resolve('/project/docs/analysis.md', 'python');
const rt = await runtimes.start(config);
```

#### `prefs.resolveAll(documentPath) → Promise<Map<string, ResolvedConfig>>`

Resolve configs for all languages that have code blocks in a document (or all configured languages).

```js
const all = await prefs.resolveAll('/project/docs/analysis.md');
// → Map { 'python' => ResolvedConfig, 'r' => ResolvedConfig }
```

### Reading and writing

#### `prefs.get(projectRoot?) → Preferences`

Get the full preferences object, optionally scoped to a project.

#### `prefs.setProjectOverride(projectRoot, language, patch) → void`

```js
prefs.setProjectOverride('/project', 'python', {
  scope: 'project',
  environment: '/project/.venv-gpu',
});
```

#### `prefs.setNotebookOverride(documentPath, language, patch) → void`

Pin a specific config for one document + language.

#### `prefs.clearNotebookOverride(documentPath, language) → void`

Remove notebook-level overrides, fall back to project/global defaults.

---

## Typical flow

```js
import { RuntimeService, Preferences, ProjectService } from 'mrmd-core';

const projects = new ProjectService();
const prefs = new Preferences({ projectService: projects });
const runtimes = new RuntimeService();

// User opens analysis.md and runs a Python cell:

// 1. Resolve runtime config for this document + language
const config = await prefs.resolve('/project/docs/analysis.md', 'python');

// 2. Start or reuse the runtime
const rt = await runtimes.start(config);

// 3. Register this document as a consumer
runtimes.attach(rt.name, '/project/docs/analysis.md');

// 4. Execute code via MRP
const result = await fetch(`${rt.url}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'import pandas as pd\ndf = pd.read_csv("data.csv")\ndf.head()' }),
}).then(r => r.json());

// 5. Later, user closes the document
runtimes.detach(rt.name, '/project/docs/analysis.md');
```

---

## ProjectService

Discovers and caches project information. Project root is found by walking up from a file path to the nearest `.git` directory, with a heuristic fallback through parent directories that contain markdown files.

```js
import { ProjectService } from 'mrmd-core';

const projects = new ProjectService();
```

#### `projects.getProject(filePath) → Promise<ProjectInfo | null>`

Find project root, scan files, build nav tree.

```js
const project = await projects.getProject('/project/docs/intro.md');
// → { root, config, files, navTree }
```

#### `projects.createProject(targetPath) → Promise<ProjectInfo>`

Initialize a new project directory.

#### `projects.invalidate(projectRoot)`

Clear cached info (e.g. after file changes).

#### `projects.scanFiles(root) → Promise<FileEntry[]>`

#### `projects.getRawTree(root, options?) → Promise<TreeNode[]>`

Full file/directory tree for sidebar navigation.

#### `projects.browseDirectory(dirPath, options?) → Promise<Entry[]>`

---

## FileService

File operations with automatic wiki-link and asset-path refactoring.

```js
import { FileService } from 'mrmd-core';

const files = new FileService();
```

#### `files.read(path) → Promise<string>`
#### `files.write(path, content) → Promise<void>`
#### `files.create(path, content?) → Promise<void>`
#### `files.createInProject(projectRoot, relativePath, content?) → Promise<string>`
#### `files.move(projectRoot, from, to) → Promise<void>`

Moves file and updates all internal links across the project.

#### `files.delete(path) → Promise<void>`
#### `files.reorder(projectRoot, source, target, position) → Promise<void>`

---

## AssetService

Manage project assets (`_assets/` directory).

```js
import { AssetService } from 'mrmd-core';

const assets = new AssetService();
```

#### `assets.save(projectRoot, file, filename) → Promise<string>`

Save with hash-based deduplication. Returns asset path.

#### `assets.list(projectRoot) → Promise<AssetEntry[]>`
#### `assets.delete(projectRoot, assetPath) → Promise<void>`
#### `assets.findOrphans(projectRoot) → Promise<string[]>`

---

## EnvironmentService

Discovers what's available on this machine — interpreters, package environments, language runtimes. This is what powers "choose your Python" or "pick a venv" in any head.

```js
import { EnvironmentService } from 'mrmd-core';

const env = new EnvironmentService();
```

#### `env.discover(language?) → Promise<Discovery>`

Scan the system for available interpreters and environments. Optional language filter.

```js
const all = await env.discover();
// → {
//   python: {
//     interpreters: [
//       { path: '/usr/bin/python3.11', version: '3.11.4', source: 'system' },
//       { path: '/usr/bin/python3.12', version: '3.12.1', source: 'system' },
//       { path: '/home/user/.local/bin/python3', version: '3.12.1', source: 'uv' },
//     ],
//     environments: [
//       { path: '/project/.venv', interpreter: '/project/.venv/bin/python', version: '3.12.1', hasMrmdRuntime: true },
//       { path: '/other/.venv', interpreter: '/other/.venv/bin/python', version: '3.11.4', hasMrmdRuntime: false },
//     ],
//   },
//   r: {
//     interpreters: [
//       { path: '/usr/bin/Rscript', version: '4.3.2', source: 'system' },
//     ],
//     environments: [],
//   },
//   julia: {
//     interpreters: [
//       { path: '/usr/local/bin/julia', version: '1.10.0', source: 'system' },
//     ],
//     environments: [
//       { path: '/project', hasProjectToml: true },
//     ],
//   },
//   bash: {
//     interpreters: [
//       { path: '/bin/bash', version: '5.2.15', source: 'system' },
//     ],
//     environments: [],
//   },
// }

const pythonOnly = await env.discover('python');
```

#### `env.discoverForProject(projectRoot, language?) → Promise<Discovery>`

Same as `discover()` but also scans the project directory for local environments (`.venv`, `renv`, `Project.toml`, `node_modules`, etc.).

```js
const d = await env.discoverForProject('/path/to/project', 'python');
// → finds /path/to/project/.venv, conda envs, etc.
```

#### `env.provision(language, projectRoot, options?) → Promise<EnvironmentInfo>`

Create a new environment for a language in a project. For Python this creates a venv and installs `mrmd-python`. For Julia this instantiates the project. Idempotent — skips if already set up.

```js
const venv = await env.provision('python', '/path/to/project');
// → { path: '/path/to/project/.venv', interpreter: '...', version: '3.12.1', hasMrmdRuntime: true }

const julia = await env.provision('julia', '/path/to/project');
// → { path: '/path/to/project', hasProjectToml: true }
```

#### `env.installRuntime(language, environmentPath) → Promise<void>`

Install the mrmd runtime bridge (`mrmd-python`, R packages, etc.) into an existing environment.

```js
await env.installRuntime('python', '/path/to/project/.venv');
```

#### `env.checkRuntime(language, environmentPath) → Promise<{ installed, version? }>`

Check if the mrmd runtime bridge is installed in an environment.

```js
await env.checkRuntime('python', '/path/to/project/.venv');
// → { installed: true, version: '0.3.8' }
```

### Language installation

For beginners who don't have a language installed yet. Heads can surface this as a guided setup flow — "R is not installed. Install it?" — instead of a dead end.

#### `env.installable() → InstallableLanguage[]`

List languages that can be automatically installed on this platform.

```js
await env.installable();
// → [
//   { language: 'python', method: 'uv', description: 'Python via uv (recommended)' },
//   { language: 'python', method: 'system', description: 'Python via system package manager' },
//   { language: 'r', method: 'system', description: 'R via apt/brew/winget' },
//   { language: 'julia', method: 'juliaup', description: 'Julia via juliaup' },
//   { language: 'node', method: 'system', description: 'Node.js via system package manager' },
//   { language: 'ruby', method: 'system', description: 'Ruby via system package manager' },
// ]
```

#### `env.install(language, options?) → Promise<InstallResult>`

Install a language on this machine. Uses the best available method per platform.

```js
await env.install('python');
// → { success: true, interpreter: '/home/user/.local/bin/python3', version: '3.12.1', method: 'uv' }

await env.install('r');
// → { success: true, interpreter: '/usr/bin/Rscript', version: '4.4.1', method: 'apt' }

await env.install('julia');
// → { success: true, interpreter: '/home/user/.juliaup/bin/julia', version: '1.11.0', method: 'juliaup' }
```

Options:

| Option | Description |
|--------|-------------|
| `method` | Override install method (e.g. `'uv'`, `'brew'`, `'apt'`, `'winget'`, `'juliaup'`) |
| `version` | Request specific version (e.g. `'3.12'`, `'4.4'`) |
| `onProgress` | Callback for progress updates: `(message: string) => void` |

**Install strategies per platform:**

| Language | Linux | macOS | Windows |
|----------|-------|-------|---------|
| Python | uv (preferred), apt/dnf | uv (preferred), brew | uv (preferred), winget, python.org |
| R | apt/dnf | brew, CRAN .pkg | winget, CRAN .exe |
| Julia | juliaup | juliaup | juliaup |
| Node | apt/dnf, nvm | brew, nvm | winget, nvm-windows |
| Ruby | apt/dnf | brew, system | winget, RubyInstaller |

The service handles platform detection, picks the best method, and reports progress. Heads wrap this in their own UX (progress bar, confirmation dialog, terminal output, etc.).

---

## RecentService

Track recently opened files and projects. Shared across all heads — open a file in Electron, see it in the CLI's recent list.

Stored in `<CONFIG_DIR>/recent.json`.

```js
import { RecentService } from 'mrmd-core';

const recent = new RecentService();
```

#### `recent.addFile(filePath) → void`

Record a file open. Moves it to the top if already present.

#### `recent.addProject(projectRoot) → void`

Record a project open.

#### `recent.files(limit?) → string[]`

Most recent files, newest first. Default limit: 50.

#### `recent.projects(limit?) → string[]`

Most recent project roots, newest first. Default limit: 20.

#### `recent.clear() → void`

---

## PackageService

Manages packages within runtime environments. The "I imported pandas but it's not installed" problem — detect it, offer to fix it, fix it.

```js
import { PackageService } from 'mrmd-core';

const packages = new PackageService();
```

#### `packages.list(language, environmentPath) → Promise<Package[]>`

List installed packages in an environment.

```js
await packages.list('python', '/project/.venv');
// → [
//   { name: 'pandas', version: '2.1.4' },
//   { name: 'numpy', version: '1.26.2' },
//   ...
// ]
```

#### `packages.install(language, environmentPath, packageNames) → Promise<InstallResult>`

Install packages into an environment.

```js
await packages.install('python', '/project/.venv', ['pandas', 'matplotlib']);
// → { installed: ['pandas==2.1.4', 'matplotlib==3.8.2'], failed: [] }

await packages.install('r', null, ['ggplot2', 'dplyr']);
// → { installed: ['ggplot2', 'dplyr'], failed: [] }
```

#### `packages.check(language, environmentPath, packageNames) → Promise<CheckResult>`

Check which packages are installed and which are missing.

```js
await packages.check('python', '/project/.venv', ['pandas', 'scipy', 'torch']);
// → { installed: ['pandas'], missing: ['scipy', 'torch'] }
```

#### `packages.detectMissing(language, environmentPath, code) → Promise<string[]>`

Analyze code for imports and report which packages aren't installed. Enables "auto-install missing packages" flows.

```js
await packages.detectMissing('python', '/project/.venv', 'import pandas as pd\nimport scipy.stats');
// → ['scipy']
```

---

## DocumentModel

Parse a markdown file into structured cells, outputs, and frontmatter. This is the shared understanding of what a notebook looks like — every head and the runner depend on it.

```js
import { DocumentModel } from 'mrmd-core';
```

#### `DocumentModel.parse(content) → Document`

```js
const doc = DocumentModel.parse(fs.readFileSync('analysis.md', 'utf8'));
// → {
//   frontmatter: { title: 'Analysis', ... },
//   cells: [
//     { type: 'markdown', content: '# Analysis\n\nSome text...', startLine: 4, endLine: 8 },
//     { type: 'code', language: 'python', content: 'import pandas as pd\ndf = pd.read_csv("data.csv")', startLine: 9, endLine: 12 },
//     { type: 'output', content: '   col1  col2\n0     1     2', startLine: 13, endLine: 16 },
//     { type: 'code', language: 'python', content: 'df.describe()', startLine: 17, endLine: 19 },
//     ...
//   ],
// }
```

#### `DocumentModel.serialize(document) → string`

Convert a Document back to markdown. Round-trips cleanly.

#### `DocumentModel.languages(document) → string[]`

Which languages appear in code cells.

```js
DocumentModel.languages(doc);
// → ['python', 'r']
```

#### `DocumentModel.codeCells(document, language?) → CodeCell[]`

Extract just the code cells, optionally filtered by language.

---

## Runner

Execute a notebook headlessly. For CLI (`mrmd run analysis.md`), CI pipelines, batch processing, testing.

```js
import { Runner } from 'mrmd-core';

const runner = new Runner({ runtimes, preferences, projects });
```

#### `runner.run(filePath, options?) → Promise<RunResult>`

Run all code cells in a notebook in order.

```js
const result = await runner.run('/project/analysis.md');
// → {
//   file: '/project/analysis.md',
//   cells: [
//     { index: 0, language: 'python', status: 'ok', duration: 234, output: '...' },
//     { index: 1, language: 'python', status: 'ok', duration: 1200, output: '...' },
//     { index: 2, language: 'python', status: 'error', duration: 50, error: { type: 'NameError', ... } },
//   ],
//   status: 'error',      // 'ok' if all cells pass
//   duration: 1484,
// }
```

Options:

| Option | Description |
|--------|-------------|
| `languages` | Only run cells in these languages |
| `cells` | Only run specific cell indices |
| `stopOnError` | Stop at first error (default: true) |
| `updateFile` | Write outputs back to the file (default: false) |
| `onCell` | Callback per cell: `(cell, result) => void` |
| `timeout` | Per-cell timeout in ms |

```js
// Run and update the file with fresh outputs
await runner.run('/project/analysis.md', { updateFile: true });

// Run only Python cells, don't stop on error
await runner.run('/project/analysis.md', { languages: ['python'], stopOnError: false });

// CI mode — just check if everything passes
const result = await runner.run('/project/analysis.md');
process.exit(result.status === 'ok' ? 0 : 1);
```

---

## Exporter

Convert notebooks to other formats.

```js
import { Exporter } from 'mrmd-core';

const exporter = new Exporter();
```

#### `exporter.toHtml(filePath, options?) → Promise<string>`

Render notebook to standalone HTML with syntax highlighting and output rendering.

#### `exporter.toPdf(filePath, options?) → Promise<Buffer>`

Render to PDF (requires a headless browser or weasyprint — configurable).

#### `exporter.toScript(filePath, language) → Promise<string>`

Extract code cells into a plain script.

```js
await exporter.toScript('/project/analysis.md', 'python');
// → "import pandas as pd\ndf = pd.read_csv('data.csv')\n\ndf.describe()\n..."
```

#### `exporter.toUvScript(filePath) → Promise<string>`

Export to a [UV inline script](https://docs.astral.sh/uv/guides/scripts/) with dependency metadata.

```js
await exporter.toUvScript('/project/analysis.md');
// → "#!/usr/bin/env -S uv run\n# /// script\n# requires-python = \">=3.12\"\n# dependencies = [\n#   \"pandas>=2.1\",\n# ]\n# ///\n\nimport pandas as pd\n..."
```

---

## ComputeTargets

Manage where runtimes run — local machine, remote servers, cloud (markco.dev). Makes `RuntimeService` network-transparent.

```js
import { ComputeTargets } from 'mrmd-core';

const targets = new ComputeTargets({ settings });
```

### Targets

A compute target is any machine that can run runtimes. The local machine is always a target.

#### `targets.list() → Target[]`

```js
targets.list();
// → [
//   { id: 'local', type: 'local', label: 'This Computer', status: 'online' },
//   { id: 'gpu-server', type: 'ssh', label: 'Lab GPU Server', host: 'gpu.lab.uni.edu', status: 'online' },
//   { id: 'markco:abc123', type: 'cloud', label: 'markco.dev', status: 'online' },
// ]
```

#### `targets.add(config) → Target`

```js
// SSH target
targets.add({
  type: 'ssh',
  label: 'Lab GPU Server',
  host: 'gpu.lab.uni.edu',
  user: 'maxime',
  // auth via SSH agent/keys — no passwords stored
});

// Cloud target (markco.dev)
targets.add({
  type: 'cloud',
  label: 'markco.dev',
  provider: 'markco',
  apiKey: 'mk_...',   // or reference settings: 'settings:apiKeys.markco'
});

// Direct HTTP target (already running mrmd-server somewhere)
targets.add({
  type: 'http',
  label: 'My VPS',
  url: 'https://my-server.com:8080',
  token: 'abc123',
});
```

#### `targets.remove(id) → void`
#### `targets.ping(id) → Promise<{ online, latency, runtimes }>`

Check if a target is reachable and what's running on it.

```js
await targets.ping('gpu-server');
// → { online: true, latency: 45, runtimes: ['python:default'] }
```

### Remote runtimes

`RuntimeService` accepts a `target` field. When set, it delegates to the remote machine instead of spawning locally.

```js
// Start a runtime on the GPU server
const rt = await runtimes.start({
  name: 'gpu-analysis',
  language: 'python',
  cwd: '/data/project',       // path on the remote machine
  target: 'gpu-server',
  env: { CUDA_VISIBLE_DEVICES: '0,1' },
});
// → { name, pid, port, url: 'http://localhost:54321/mrp/v1', target: 'gpu-server', tunnel: true, ... }
//   (url is a local tunnel endpoint — transparent to the caller)
```

The returned `url` is always a local endpoint. If the target is remote, mrmd-core sets up a tunnel (SSH port forward, WebSocket relay, etc.) so the caller doesn't need to know the difference.

```js
// List all runtimes across all targets
runtimes.list();
// → [
//   { name: 'local-py', language: 'python', target: 'local', ... },
//   { name: 'gpu-analysis', language: 'python', target: 'gpu-server', ... },
//   { name: 'cloud-r', language: 'r', target: 'markco:abc123', ... },
// ]

// Stop a remote runtime
await runtimes.stop('gpu-analysis');
```

### How it works

| Target type | Start | Tunnel | Stop |
|-------------|-------|--------|------|
| `local` | Spawn process directly | N/A | Kill process |
| `ssh` | SSH exec: `mrmd-cli runtime start ...` on remote | SSH port forward (`-L`) | SSH exec: `mrmd-cli runtime stop ...` |
| `http` | POST to remote `mrmd-server` API | WebSocket relay or direct | POST to remote API |
| `cloud` | markco.dev API (provisions container) | Via markco relay | markco.dev API |

**SSH targets require `mrmd-cli` installed on the remote machine.** This is why `mrmd-cli` matters — it's the headless interface that remote targets use. A remote machine doesn't need Electron or a browser, just `mrmd-cli`.

### Preferences integration

`Preferences.resolve()` already has a `targetId` field. When scope is resolved, it determines both which runtime name to use and where to run it.

```js
// Configure a project to run Python on the GPU server
prefs.setProjectOverride('/project', 'python', {
  target: 'gpu-server',
  environment: '/data/envs/ml-venv',
});

// Now resolve + start automatically goes remote
const config = await prefs.resolve('/project/analysis.md', 'python');
// → { ..., target: 'gpu-server', ... }
const rt = await runtimes.start(config);
// → tunneled connection to GPU server
```

---

## SettingsService

User settings shared across all heads. Stored in `<CONFIG_DIR>/settings.json`.

```js
import { SettingsService } from 'mrmd-core';

const settings = new SettingsService();
```

#### `settings.get(key, fallback?) → any`

```js
settings.get('apiKeys.openai');
// → 'sk-...'

settings.get('editor.fontSize', 14);
// → 14
```

#### `settings.set(key, value) → void`

```js
settings.set('apiKeys.anthropic', 'sk-ant-...');
```

#### `settings.all() → object`

Full settings object.

#### `settings.reset(key?) → void`

Reset to defaults. If key given, reset just that key.

---

## HealthService

Diagnose the setup. "Is everything working? What's missing? What's broken?" One call for heads to surface setup issues, or for `mrmd doctor` in the CLI.

```js
import { HealthService } from 'mrmd-core';

const health = new HealthService({ env, runtimes, settings });
```

#### `health.check() → Promise<HealthReport>`

```js
await health.check();
// → {
//   status: 'warn',     // 'ok', 'warn', 'error'
//   checks: [
//     { name: 'config-dir',    status: 'ok',    message: '~/.config/mrmd exists' },
//     { name: 'python',        status: 'ok',    message: 'Python 3.12.1 via uv' },
//     { name: 'r',             status: 'warn',  message: 'R not installed', fix: 'Run: mrmd install r' },
//     { name: 'julia',         status: 'warn',  message: 'Julia not installed', fix: 'Run: mrmd install julia' },
//     { name: 'uv',            status: 'ok',    message: 'uv 0.5.1' },
//     { name: 'mrmd-python',   status: 'ok',    message: '0.3.8 in /project/.venv' },
//     { name: 'api-keys',      status: 'warn',  message: 'No API keys configured', fix: 'Run: mrmd settings set apiKeys.anthropic <key>' },
//     { name: 'runtimes',      status: 'ok',    message: '2 runtimes running' },
//   ],
// }
```

Every check includes a `fix` hint when actionable — heads can display it as-is (CLI) or wire it to a button (Electron/vscode).

---

## Dependencies

```
mrmd-core
  ├── mrmd-project    (pure logic: FSML, links, scaffolding)
  └── (node builtins: fs, path, os, child_process, net, crypto)
```

## What stays in the heads

| Concern | Where |
|---------|-------|
| Runtime lifecycle, preferences, project/file/asset ops | **mrmd-core** |
| Electron IPC, windows, menus, tray | mrmd-electron |
| HTTP API, auth, WebSocket proxy | mrmd-server |
| CLI parsing, terminal formatting | mrmd-cli |
| CodeMirror editor, widgets, themes | mrmd-editor |

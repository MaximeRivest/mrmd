# mrmd-core

Headless service layer for mrmd — daemon, runtime lifecycle, project discovery, file operations.

```
                      ┌── mrmd-cli
                      ├── mrmd-electron
  mrmd daemon ◄───────┼── mrmd-vscode
  (mrmd-core)         ├── mrmd-server
                      └── ...
```

Every head connects to the daemon via `connect()`. The daemon owns all runtimes, state, and connections. There is no in-process alternative — if the daemon isn't running, heads can't execute code.

This is a fresh implementation. The existing `mrmd-electron/src/services/` code is reference material for behavior and edge cases, but mrmd-core is not an extraction — it's a clean rewrite.

## Install

```bash
npm install mrmd-core
```

---

## Overview

mrmd-core runs as a **daemon** — a long-lived background process that owns all runtimes, state, and connections. Every head (Electron, VS Code, CLI, browser) connects to the daemon. `connect()` is the single entry point.

The first head to need mrmd auto-starts the daemon. On first start, the user is asked whether they want to allow the daemon to run in the background and whether they want it to start automatically on login. On first close, the user is asked if they want to keep it running. If yes, the daemon stays alive — keeping runtimes loaded, tunnels open, GPU memory allocated — until the user explicitly stops it or reboots. Users are reassured they can always change these preferences later in the tray app or via `mrmd daemon`.

| Export | What it does |
|--------|-------------|
| `connect()` | Connect to the daemon (auto-starts if needed). Single entry point for all heads. |
| `SyncService` | Manage mrmd-sync servers — per-project Yjs sync for collaboration + file persistence |
| `MonitorService` | Manage mrmd-monitor processes — headless execution that survives editor disconnects |
| `AIService` | AI completions, corrections, commands — in-process, uses `@mariozechner/pi-ai` for model routing |
| `VoiceService` | Manage mrmd-voice — audio capture, transcription, text routing |
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
| `ComputeTargets` | Manage where runtimes run — local, remote servers, cloud |

All pure Node.js. No Electron. No browser APIs. No Express.

Everything goes through the daemon. `connect()` returns a client with all services attached.

---

## Configuration

Runtime configuration is stored in `<CONFIG_DIR>/preferences.json`. Preferences that make sense to sync across machines (compute targets, API key references, profiles) can be fetched from the registry (markco.dev).

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

## Daemon

The daemon keeps mrmd alive. Without it, there is nothing beyond file editing — no code execution, no runtimes, no remote compute. The daemon owns runtimes, maintains compute target connections, and emits events. Heads connect to it; they don't manage runtimes themselves.

There is exactly one daemon per machine. It works best always-on and started on login, but users who are resource-constrained or prefer no background processes can start and stop it manually.

### First run

The daemon handles its own initialization. On first start it creates config directories, default preferences, and the runtime registry. No separate `init()` step — `connect()` triggers everything.

```js
import { connect } from 'mrmd-core';

const client = await connect();
// First time:
//   1. Creates <CONFIG_DIR>/, preferences.json, settings.json
//   2. Creates <DATA_DIR>/runtimes/
//   3. Starts the daemon process
//   4. Connects
//
// Subsequent times:
//   1. Connects to existing daemon
```

On first launch from an interactive head (Electron, VS Code), the user sees a brief setup prompt:

- "Allow mrmd to run in the background?" → controls whether the daemon persists after the last head disconnects
- "Start automatically on login?" → controls whether to install as a system service

These preferences are saved and can be changed later via the tray app or `mrmd daemon` CLI.

`mrmd-cli` also calls init implicitly — most commands (`mrmd run`, `mrmd runtimes list`, etc.) go through `connect()` and auto-start the daemon. Only `mrmd --help` and `mrmd --version` skip it.

### Starting the daemon

Normally, `connect()` handles this automatically. For manual control:

```bash
mrmd daemon start          # start in background
mrmd daemon stop           # graceful shutdown
mrmd daemon status         # show what's running
mrmd daemon logs           # tail daemon logs
mrmd daemon install        # install as system service (auto-start on login)
mrmd daemon uninstall      # remove system service
```

Programmatically (used by `mrmd-cli` internally):

```js
import { Daemon } from 'mrmd-core';

const daemon = new Daemon();
await daemon.start({
  socket: '/tmp/mrmd-daemon.sock',  // Unix socket (default)
  // or port: 19876                 // TCP for cross-machine
});
```

### What the daemon holds

Internally, the daemon instantiates and owns all stateful services:

```js
// Inside the daemon (simplified):
this.runtimes    = new RuntimeService();
this.preferences = new Preferences({ projectService });
this.targets     = new ComputeTargets({ settings });
this.settings    = new SettingsService();
this.recent      = new RecentService();
this.env         = new EnvironmentService();
this.packages    = new PackageService();
this.projects    = new ProjectService();
```

Heads get proxied access to these over the socket. The proxy implements the same interface — a head calling `client.runtimes.start()` sends a message to the daemon, which calls `this.runtimes.start()` and returns the result.

### Connecting from a head

```js
import { connect } from 'mrmd-core';

// Connect to running daemon, or start one if none is running
const client = await connect();

// All services are available on the client
const rt = await client.runtimes.start({
  name: 'my-runtime',
  language: 'python',
  cwd: '/project',
});

// Subscribe to events
client.on('runtime:crashed', (rt) => {
  showNotification(`Runtime ${rt.name} crashed`);
});

// Disconnect when the head exits (daemon stays running)
client.disconnect();
```

### Event bus

The daemon emits events that any connected head can subscribe to. This powers notifications, status indicators, and live updates across all open editors.

```js
client.on('runtime:started',  (rt) => { /* runtime came up */ });
client.on('runtime:stopped',  (rt) => { /* runtime went down */ });
client.on('runtime:crashed',  (rt) => { /* unexpected exit */ });
client.on('runtime:output',   (rt, data) => { /* stdout/stderr from execution */ });
client.on('execution:done',   (rt, result) => { /* cell finished */ });
client.on('target:online',    (target) => { /* remote machine came online */ });
client.on('target:offline',   (target) => { /* remote machine went offline */ });
client.on('package:missing',  (rt, pkg) => { /* import failed, package not installed */ });
client.on('health:warning',   (check) => { /* something needs attention */ });
```

Heads turn these into their own UX:
- **Electron tray app** → native OS notifications, badge count, tray menu
- **VS Code** → status bar updates, notification popups
- **CLI** → log lines, `mrmd watch` live output

### Daemon status

```js
client.status();
// → {
//   pid: 12345,
//   uptime: 86400,
//   runtimes: 3,
//   registryConnected: true,
//   tunnels: 1,
//   heads: ['mrmd-electron', 'mrmd-vscode'],
// }
```

### Process management

| Platform | How the daemon runs |
|----------|-------------------|
| Linux | systemd user service (`mrmd daemon install` sets it up) |
| macOS | launchd agent (`~/Library/LaunchAgents/dev.mrmd.daemon.plist`) |
| Windows | Startup task or Windows service |

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        mrmd daemon                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ Runtimes     │  │ Sync         │  │ Event Bus          │ │
│  │  python, r,  │  │  per-project │  │  runtime:started   │ │
│  │  julia, ...  │  │  Yjs + file  │  │  sync:saved        │ │
│  ├──────────────┤  ├──────────────┤  │  monitor:crashed   │ │
│  │ Monitors     │  │ AI (in-proc) │  │  target:online     │ │
│  │  per-document│  │  pi-ai SDK   │  │  voice:transcript  │ │
│  ├──────────────┤  ├──────────────┤  │  ...               │ │
│  │ Preferences  │  │ Voice        │  │                    │ │
│  │ Settings     │  │  shared      │  │                    │ │
│  │ Recent       │  ├──────────────┤  │  → broadcast to    │ │
│  │ Environment  │  │ Compute      │  │    all heads       │ │
│  │ Packages     │  │  targets     │  │                    │ │
│  │ Projects     │  │  tunnels     │  │                    │ │
│  │ Health       │  │  registry    │  │                    │ │
│  └──────────────┘  └──────────────┘  └────────────────────┘ │
│                                                              │
│  Socket: /tmp/mrmd-daemon.sock                               │
└───────────┬──────────────┬──────────────┬────────────────────┘
            │              │              │
     ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
     │  Electron   │ │ VS Code  │ │   CLI       │
     │  (tray)     │ │ (panel)  │ │ Neovim, ... │
     └─────────────┘ └──────────┘ └─────────────┘
```

---

## Typical flow

```js
import { connect } from 'mrmd-core';

// 1. Connect to daemon (auto-starts if needed)
const client = await connect();

// User opens analysis.md and runs a Python cell:

// 2. Resolve runtime config for this document + language
const config = await client.preferences.resolve('/project/docs/analysis.md', 'python');

// 3. Start or reuse the runtime (daemon manages the process)
const rt = await client.runtimes.start(config);

// 4. Register this document as a consumer
client.runtimes.attach(rt.name, '/project/docs/analysis.md');

// 5. Execute code via MRP
const result = await fetch(`${rt.url}/execute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'import pandas as pd\ndf = pd.read_csv("data.csv")\ndf.head()' }),
}).then(r => r.json());

// 6. User closes the document — runtime stays alive in the daemon
client.runtimes.detach(rt.name, '/project/docs/analysis.md');
```

---

## RuntimeService

Manages runtime processes. A runtime is one process, one PID, one port, one namespace — one REPL, as defined by the [MRP protocol](../spec/mrp-protocol.md).

Access via `client.runtimes`.

### Starting a runtime

#### `runtimes.start(config) → Promise<RuntimeInfo>`

```js
const rt = await client.runtimes.start({
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
await client.runtimes.start({ name: 'rt', language: 'python', cwd: '/project' });

// Explicit environment
await client.runtimes.start({ name: 'rt', language: 'python', cwd: '/project', environment: '/project/.venv' });

// Explicit interpreter, no isolation
await client.runtimes.start({ name: 'rt', language: 'python', cwd: '/project', interpreter: '/usr/bin/python3.12' });

// R — discovers Rscript on PATH
await client.runtimes.start({ name: 'rt', language: 'r', cwd: '/project' });

// Julia — discovers julia on PATH
await client.runtimes.start({ name: 'rt', language: 'julia', cwd: '/project' });

// GPU pinning
await client.runtimes.start({ name: 'rt', language: 'python', cwd: '/project', env: { CUDA_VISIBLE_DEVICES: '0' } });
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

Stop all runtimes. Called on `mrmd daemon stop`.

### Document binding

Runtimes track which documents are using them.

#### `runtimes.attach(name, documentPath) → RuntimeInfo | null`

Register a document as a consumer of a runtime. Returns null if the runtime is dead.

#### `runtimes.detach(name, documentPath) → void`

Unregister a document. When the last consumer detaches, the runtime can optionally auto-stop (configurable).

#### `runtimes.consumers(name?) → Map<string, string[]>`

Which documents are using which runtimes.

```js
client.runtimes.consumers();
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

## SyncService

Manages `mrmd-sync` servers — one per project. Provides Yjs CRDT sync for real-time collaboration and bidirectional file persistence (browser ↔ filesystem).

```js
const sync = mrmd.sync;
```

#### `sync.ensure(projectRoot) → Promise<SyncInfo>`

Start a sync server for a project, or return the existing one. Reference-counted — multiple documents in the same project share one server.

```js
const s = await sync.ensure('/path/to/project');
// → { projectRoot, port, wsUrl: 'ws://127.0.0.1:43210', pid, consumers: 2 }
```

#### `sync.stop(projectRoot) → Promise<void>`

Force-stop a project's sync server.

#### `sync.list() → SyncInfo[]`

List running sync servers.

#### Events

```js
mrmd.on('sync:started',  (info) => { /* new sync server for a project */ });
mrmd.on('sync:stopped',  (info) => { /* sync server stopped */ });
mrmd.on('sync:crashed',  (info) => { /* sync server died unexpectedly */ });
mrmd.on('sync:saved',    (info) => { /* file persisted to disk */ });
```

---

## MonitorService

Manages `mrmd-monitor` processes — one per open document. The monitor is a headless Yjs peer that coordinates code execution. It ensures long-running cells complete even if the browser/editor disconnects.

```js
const monitors = mrmd.monitors;
```

#### `monitors.ensure(documentPath, syncPort) → Promise<MonitorInfo>`

Start a monitor for a document, or return the existing one.

```js
const m = await monitors.ensure('/project/analysis.md', 43210);
// → { documentPath, pid, syncPort }
```

#### `monitors.stop(documentPath) → Promise<void>`

#### `monitors.list() → MonitorInfo[]`

#### Events

```js
mrmd.on('monitor:started',  (info) => { /* monitor started for a document */ });
mrmd.on('monitor:stopped',  (info) => { /* monitor stopped */ });
mrmd.on('monitor:crashed',  (info) => { /* monitor died — executions may be lost */ });
```

---

## AIService

AI completions, corrections, and commands. Runs in-process in the daemon — no separate Python server. Uses `@mariozechner/pi-ai` for multi-provider model routing (Anthropic, OpenAI, local models, etc.).

```js
const ai = mrmd.ai;
```

#### `ai.complete(request) → Promise<string>`

Complete text at cursor position.

```js
await ai.complete({
  kind: 'sentence',                    // 'sentence', 'paragraph', 'code-line', 'code-section'
  before: 'The quick brown fox ',       // text before cursor
  after: '',                            // text after cursor
  language: null,                       // code language (for code completions)
});
// → 'jumps over the lazy dog.'
```

#### `ai.fix(request) → Promise<string>`

Fix grammar, spelling, or transcription errors.

```js
await ai.fix({
  kind: 'grammar',                     // 'grammar', 'transcription'
  text: 'He dont like the wether today',
});
// → 'He doesn\'t like the weather today'
```

#### `ai.correctAndFinish(request) → Promise<string>`

Correct errors and complete the current line or section.

```js
await ai.correctAndFinish({
  kind: 'line',                        // 'line', 'section'
  before: 'We analize the resu',
  after: '',
});
// → 'We analyze the results of the experiment.'
```

#### `ai.command(request) → Promise<string>`

Execute a free-form AI command on selected text.

```js
await ai.command({
  instruction: 'Make this more concise',
  text: 'In order to be able to achieve the goal of...',
});
// → 'To achieve...'
```

#### `ai.models() → ModelInfo[]`

List available models from configured providers.

```js
ai.models();
// → [
//   { id: 'claude-sonnet-4-20250514', provider: 'anthropic', available: true },
//   { id: 'gpt-4o', provider: 'openai', available: true },
//   ...
// ]
```

---

## VoiceService

Manages `mrmd-voice` — audio capture, transcription, and text routing. Shared singleton, started on demand.

```js
const voice = mrmd.voice;
```

#### `voice.ensure() → Promise<VoiceInfo>`

Start the voice service if not running.

```js
const v = await voice.ensure();
// → { port, url, pid }
```

#### `voice.stop() → Promise<void>`

#### `voice.status() → VoiceInfo | null`

#### Events

```js
mrmd.on('voice:started',      (info) => { });
mrmd.on('voice:stopped',      (info) => { });
mrmd.on('voice:transcription', (text, target) => { /* transcribed text ready to route */ });
```

---

## Preferences

Manages runtime configuration. The full resolution chain: **global defaults → project overrides → notebook overrides**.

Access via `client.preferences`.

### Resolution

#### `prefs.resolve(documentPath, language, options?) → Promise<ResolvedConfig>`

The main entry point. Given a document and language, resolve the full runtime config.

```js
const config = await client.preferences.resolve('/project/docs/analysis.md', 'python');
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
const config = await client.preferences.resolve('/project/docs/analysis.md', 'python');
const rt = await client.runtimes.start(config);
```

#### `prefs.resolveAll(documentPath) → Promise<Map<string, ResolvedConfig>>`

Resolve configs for all languages that have code blocks in a document (or all configured languages).

```js
const all = await client.preferences.resolveAll('/project/docs/analysis.md');
// → Map { 'python' => ResolvedConfig, 'r' => ResolvedConfig }
```

### Reading and writing

#### `prefs.get(projectRoot?) → Preferences`

Get the full preferences object, optionally scoped to a project.

#### `prefs.setProjectOverride(projectRoot, language, patch) → void`

```js
client.preferences.setProjectOverride('/project', 'python', {
  scope: 'project',
  environment: '/project/.venv-gpu',
});
```

#### `prefs.setNotebookOverride(documentPath, language, patch) → void`

Pin a specific config for one document + language.

#### `prefs.clearNotebookOverride(documentPath, language) → void`

Remove notebook-level overrides, fall back to project/global defaults.

---

## ProjectService

Discovers and caches project information. Project root is found by walking up from a file path to the nearest `.git` directory, with a heuristic fallback through parent directories that contain markdown files.

Access via `client.projects`.

#### `projects.getProject(filePath) → Promise<ProjectInfo | null>`

Find project root, scan files, build nav tree.

```js
const project = await client.projects.getProject('/project/docs/intro.md');
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

Access via `client.files`.

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

Access via `client.assets`.

#### `assets.save(projectRoot, file, filename) → Promise<string>`

Save with hash-based deduplication. Returns asset path.

#### `assets.list(projectRoot) → Promise<AssetEntry[]>`
#### `assets.delete(projectRoot, assetPath) → Promise<void>`
#### `assets.findOrphans(projectRoot) → Promise<string[]>`

---

## EnvironmentService

Discovers what's available on this machine — interpreters, package environments, language runtimes. This is what powers "choose your Python" or "pick a venv" in any head.

Access via `client.env`.

#### `env.discover(language?) → Promise<Discovery>`

Scan the system for available interpreters and environments. Optional language filter.

```js
const all = await client.env.discover();
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

const pythonOnly = await client.env.discover('python');
```

#### `env.discoverForProject(projectRoot, language?) → Promise<Discovery>`

Same as `discover()` but also scans the project directory for local environments (`.venv`, `renv`, `Project.toml`, `node_modules`, etc.).

```js
const d = await client.env.discoverForProject('/path/to/project', 'python');
// → finds /path/to/project/.venv, conda envs, etc.
```

#### `env.provision(language, projectRoot, options?) → Promise<EnvironmentInfo>`

Create a new environment for a language in a project. For Python this creates a venv and installs `mrmd-python`. For Julia this instantiates the project. Idempotent — skips if already set up.

```js
const venv = await client.env.provision('python', '/path/to/project');
// → { path: '/path/to/project/.venv', interpreter: '...', version: '3.12.1', hasMrmdRuntime: true }

const julia = await client.env.provision('julia', '/path/to/project');
// → { path: '/path/to/project', hasProjectToml: true }
```

#### `env.installRuntime(language, environmentPath) → Promise<void>`

Install the mrmd runtime bridge (`mrmd-python`, R packages, etc.) into an existing environment.

```js
await client.env.installRuntime('python', '/path/to/project/.venv');
```

#### `env.checkRuntime(language, environmentPath) → Promise<{ installed, version? }>`

Check if the mrmd runtime bridge is installed in an environment.

```js
await client.env.checkRuntime('python', '/path/to/project/.venv');
// → { installed: true, version: '0.3.8' }
```

### Language installation

For beginners who don't have a language installed yet. Heads can surface this as a guided setup flow — "R is not installed. Install it?" — instead of a dead end.

#### `env.installable() → InstallableLanguage[]`

List languages that can be automatically installed on this platform.

```js
await client.env.installable();
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
await client.env.install('python');
// → { success: true, interpreter: '/home/user/.local/bin/python3', version: '3.12.1', method: 'uv' }

await client.env.install('r');
// → { success: true, interpreter: '/usr/bin/Rscript', version: '4.4.1', method: 'apt' }

await client.env.install('julia');
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

Access via `client.recent`. Stored in `<CONFIG_DIR>/recent.json`.

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

Access via `client.packages`.

#### `packages.list(language, environmentPath) → Promise<Package[]>`

List installed packages in an environment.

```js
await client.packages.list('python', '/project/.venv');
// → [
//   { name: 'pandas', version: '2.1.4' },
//   { name: 'numpy', version: '1.26.2' },
//   ...
// ]
```

#### `packages.install(language, environmentPath, packageNames) → Promise<InstallResult>`

Install packages into an environment.

```js
await client.packages.install('python', '/project/.venv', ['pandas', 'matplotlib']);
// → { installed: ['pandas==2.1.4', 'matplotlib==3.8.2'], failed: [] }

await client.packages.install('r', null, ['ggplot2', 'dplyr']);
// → { installed: ['ggplot2', 'dplyr'], failed: [] }
```

#### `packages.check(language, environmentPath, packageNames) → Promise<CheckResult>`

Check which packages are installed and which are missing.

```js
await client.packages.check('python', '/project/.venv', ['pandas', 'scipy', 'torch']);
// → { installed: ['pandas'], missing: ['scipy', 'torch'] }
```

#### `packages.detectMissing(language, environmentPath, code) → Promise<string[]>`

Analyze code for imports and report which packages aren't installed. Enables "auto-install missing packages" flows.

```js
await client.packages.detectMissing('python', '/project/.venv', 'import pandas as pd\nimport scipy.stats');
// → ['scipy']
```

---

## DocumentModel

Parse a markdown file into structured cells, outputs, and frontmatter. This is the shared understanding of what a notebook looks like — every head and the runner depend on it.

Pure parsing, no state — can be used directly without the daemon.

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

Access via `client.runner`. The runner uses RuntimeService through the daemon — `mrmd run` connects to the daemon like any other head, executes, and disconnects.

#### `runner.run(filePath, options?) → Promise<RunResult>`

Run all code cells in a notebook in order.

```js
const client = await connect();
const result = await client.runner.run('/project/analysis.md');
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
await client.runner.run('/project/analysis.md', { updateFile: true });

// Run only Python cells, don't stop on error
await client.runner.run('/project/analysis.md', { languages: ['python'], stopOnError: false });

// CI mode — just check if everything passes
const result = await client.runner.run('/project/analysis.md');
process.exit(result.status === 'ok' ? 0 : 1);
```

---

## Exporter

Convert notebooks to other formats. Pure transformation — can be used directly without the daemon.

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

Access via `client.targets`. The daemon holds the tunnels and heartbeat. On a remote server, the daemon *is* the compute target — `mrmd daemon` on your laptop and `mrmd daemon` on a GPU server are the same process, just configured differently.

### Targets

A compute target is any machine running an mrmd daemon. The local machine is always a target.

#### `targets.list() → Target[]`

```js
client.targets.list();
// → [
//   { id: 'local', type: 'local', label: 'This Computer', status: 'online' },
//   { id: 'gpu-server', type: 'ssh', label: 'Lab GPU Server', host: 'gpu.lab.uni.edu', status: 'online' },
//   { id: 'markco:abc123', type: 'cloud', label: 'markco.dev', status: 'online' },
// ]
```

#### `targets.add(config) → Target`

```js
// SSH target
client.targets.add({
  type: 'ssh',
  label: 'Lab GPU Server',
  host: 'gpu.lab.uni.edu',
  user: 'maxime',
  // auth via SSH agent/keys — no passwords stored
});

// Cloud target (markco.dev)
client.targets.add({
  type: 'cloud',
  label: 'markco.dev',
  provider: 'markco',
  apiKey: 'mk_...',   // or reference settings: 'settings:apiKeys.markco'
});

// Direct HTTP target (already running mrmd daemon somewhere)
client.targets.add({
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
await client.targets.ping('gpu-server');
// → { online: true, latency: 45, runtimes: ['python:default'] }
```

### Remote runtimes

`RuntimeService` accepts a `target` field. When set, the local daemon delegates to the remote daemon instead of spawning locally.

```js
// Start a runtime on the GPU server
const rt = await client.runtimes.start({
  name: 'gpu-analysis',
  language: 'python',
  cwd: '/data/project',       // path on the remote machine
  target: 'gpu-server',
  env: { CUDA_VISIBLE_DEVICES: '0,1' },
});
// → { name, pid, port, url: 'http://localhost:54321/mrp/v1', target: 'gpu-server', tunnel: true, ... }
//   (url is a local tunnel endpoint — transparent to the caller)
```

The returned `url` is always a local endpoint. If the target is remote, the daemon sets up a tunnel (SSH port forward, WebSocket relay, etc.) so the caller doesn't need to know the difference.

```js
// List all runtimes across all targets
client.runtimes.list();
// → [
//   { name: 'local-py', language: 'python', target: 'local', ... },
//   { name: 'gpu-analysis', language: 'python', target: 'gpu-server', ... },
//   { name: 'cloud-r', language: 'r', target: 'markco:abc123', ... },
// ]

// Stop a remote runtime
await client.runtimes.stop('gpu-analysis');
```

### How it works

| Target type | Start | Tunnel | Stop |
|-------------|-------|--------|------|
| `local` | Daemon spawns process directly | N/A | Daemon kills process |
| `ssh` | Local daemon → SSH → remote daemon: `start runtime` | SSH port forward (`-L`) | Local daemon → SSH → remote daemon: `stop runtime` |
| `http` | Local daemon → POST to remote daemon API | WebSocket relay or direct | Local daemon → POST to remote daemon API |
| `cloud` | markco.dev API (provisions container running daemon) | Via markco relay | markco.dev API |

**SSH/HTTP targets require `mrmd daemon` running on the remote machine.** The same daemon that runs locally also runs on servers.

### Registry (markco.dev)

A small always-on cloud service that acts as:
- **Directory** — knows all your daemons across all machines
- **Tunnel broker** — relays connections when direct access isn't possible (NAT, firewalls)
- **Metadata store** — what's installed, what's running, versions, capabilities

Any head on any device can query the registry to see all available compute. No manual IP/port configuration.

#### `targets.login(provider, credentials) → Promise<void>`

Authenticate with the registry.

```js
await client.targets.login('markco', { apiKey: 'mk_...' });
// or
await client.targets.login('markco', { email: 'maxime@example.com', password: '...' });
```

#### `targets.register(options?) → Promise<Target>`

Register this daemon as a compute target. Run this on any server you want to use remotely.

```js
// On the GPU server:
await client.targets.register({
  label: 'Lab GPU Server',
  capabilities: await client.env.discover(),
});
// → registers with markco.dev, starts heartbeat, opens tunnel listener
```

#### `targets.sync() → Promise<Target[]>`

Pull the latest state from the registry. All your daemons, what's running, what's installed.

```js
await client.targets.sync();
// → [
//   { id: 'local', type: 'local', label: 'MacBook', status: 'online',
//     languages: ['python', 'r'], runtimes: [] },
//   { id: 'gpu-server', type: 'registered', label: 'Lab GPU Server', status: 'online',
//     languages: ['python', 'r', 'julia'], runtimes: ['python:analysis'],
//     gpu: '2x A100', mem: '256GB' },
//   { id: 'cloud-1', type: 'cloud', label: 'markco container', status: 'stopped',
//     languages: ['python', 'r'] },
// ]
```

This is what a VS Code side panel or Electron runtimes panel calls to populate the "where do you want to run this?" picker.

### Server setup via `mrmd-cli`

On a fresh server, one command to go from zero to registered compute target:

```bash
# Install mrmd-cli
npm install -g mrmd-cli

# Set up everything — installs languages, starts daemon, registers with markco.dev
mrmd setup
# → Detected: Ubuntu 22.04, 2x A100 GPU, 256GB RAM
# → Installing Python via uv... done (3.12.1)
# → Installing R via apt... done (4.4.1)
# → Installing Julia via juliaup... done (1.11.0)
# → Creating default environment... done (.venv)
# → Installing mrmd-python... done
# →
# → Register this machine with markco.dev?
# → Paste your API key (from https://markco.dev/settings/keys): mk_...
# →
# → ✓ Daemon started (pid 12345)
# → ✓ Registered as "gpu-server" (id: abc123)
# → ✓ Tunnel active — this machine is now reachable from any mrmd client
# → ✓ Heartbeat started — status syncs every 30s
# →
# → Done. Open mrmd on any device and this server will appear in your compute targets.

# Or step by step:
mrmd init                           # create config dirs
mrmd install python                 # install Python
mrmd install r                      # install R
mrmd env provision python .         # create .venv, install mrmd-python
mrmd daemon start                   # start the daemon
mrmd daemon install                 # auto-start on boot
mrmd login                          # authenticate with markco.dev
mrmd register --label "GPU Server"  # register this daemon
```

The daemon:
- Owns all runtimes on this machine
- Maintains a heartbeat with markco.dev
- Accepts tunneled connections from remote heads
- Reports installed languages, running runtimes, system resources
- Starts/stops runtimes on demand from remote clients

```bash
# Check status
mrmd daemon status
# → Daemon: running (pid 12345)
# → Machine: gpu-server (registered with markco.dev)
# → Languages: python 3.12.1, r 4.4.1, julia 1.11.0
# → Runtimes: 1 running (python:analysis on port 41765)
# → Tunnel: active (via markco.dev relay)
# → Heads: 2 connected (mrmd-electron, mrmd-vscode)
# → Uptime: 3d 14h
```

### The full picture

```
┌──────────────────────────────────────────────────────────────┐
│                         markco.dev                           │
│                                                              │
│  Registry: knows all your daemons, what's on them            │
│  Tunnel: relays connections through NAT/firewalls            │
│  Auth: one account, all your compute                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  maxime's daemons:                                     │  │
│  │  ├─ MacBook (local) ............ online, python, r     │  │
│  │  ├─ Lab GPU Server (ssh/tunnel)  online, python, julia │  │
│  │  └─ Cloud Container ........... stopped, python        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────┬────────────────────┘
               │                          │
       ┌───────┴───────┐          ┌───────┴───────┐
       │   MacBook      │          │  GPU Server    │
       │                │          │                │
       │  mrmd daemon   │          │  mrmd daemon   │
       │  ├─ runtimes   │          │  ├─ runtimes   │
       │  ├─ targets    │          │  ├─ targets    │
       │  └─ events     │          │  └─ events     │
       │                │          │                │
       │  heads:        │  tunnel  │  python 3.12   │
       │  ├ Electron    ├─────────►│  julia 1.11    │
       │  ├ VS Code     │          │  2x A100       │
       │  └ CLI         │          │                │
       └────────────────┘          └────────────────┘
```

Any head on the MacBook:
1. Calls `connect()` → connects to local daemon
2. Calls `client.targets.sync()` → daemon gets list from markco.dev
3. User picks "Lab GPU Server"
4. Calls `client.runtimes.start({ ..., target: 'gpu-server' })`
5. Local daemon opens tunnel via markco.dev → reaches remote daemon
6. Remote daemon starts runtime, returns MRP URL tunneled back
7. Code executes on GPU server, output streams back through daemon to head
8. User doesn't think about IPs, ports, SSH keys, NAT

### Preferences integration

`Preferences.resolve()` includes a `target` field. When scope is resolved, it determines both which runtime name to use and where to run it.

```js
// Configure a project to run Python on the GPU server
client.preferences.setProjectOverride('/project', 'python', {
  target: 'gpu-server',
  environment: '/data/envs/ml-venv',
});

// Now resolve + start automatically goes remote
const config = await client.preferences.resolve('/project/analysis.md', 'python');
// → { ..., target: 'gpu-server', ... }
const rt = await client.runtimes.start(config);
// → tunneled connection to GPU server
```

---

## SettingsService

User settings shared across all heads. Stored in `<CONFIG_DIR>/settings.json`.

Access via `client.settings`.

#### `settings.get(key, fallback?) → any`

```js
client.settings.get('apiKeys.openai');
// → 'sk-...'

client.settings.get('editor.fontSize', 14);
// → 14
```

#### `settings.set(key, value) → void`

```js
client.settings.set('apiKeys.anthropic', 'sk-ant-...');
```

#### `settings.all() → object`

Full settings object.

#### `settings.reset(key?) → void`

Reset to defaults. If key given, reset just that key.

---

## HealthService

Diagnose the setup. "Is everything working? What's missing? What's broken?" One call for heads to surface setup issues, or for `mrmd doctor` in the CLI.

Access via `client.health`.

#### `health.check() → Promise<HealthReport>`

```js
await client.health.check();
// → {
//   status: 'warn',     // 'ok', 'warn', 'error'
//   checks: [
//     { name: 'daemon',        status: 'ok',    message: 'Daemon running (pid 12345, uptime 3d)' },
//     { name: 'config-dir',    status: 'ok',    message: '~/.config/mrmd exists' },
//     { name: 'python',        status: 'ok',    message: 'Python 3.12.1 via uv' },
//     { name: 'r',             status: 'warn',  message: 'R not installed', fix: 'Run: mrmd install r' },
//     { name: 'julia',         status: 'warn',  message: 'Julia not installed', fix: 'Run: mrmd install julia' },
//     { name: 'uv',            status: 'ok',    message: 'uv 0.5.1' },
//     { name: 'mrmd-python',   status: 'ok',    message: '0.3.8 in /project/.venv' },
//     { name: 'api-keys',      status: 'warn',  message: 'No API keys configured', fix: 'Run: mrmd settings set apiKeys.anthropic <key>' },
//     { name: 'runtimes',      status: 'ok',    message: '2 runtimes running' },
//     { name: 'registry',      status: 'ok',    message: 'Connected to markco.dev, 2 targets synced' },
//   ],
// }
```

Every check includes a `fix` hint when actionable — heads can display it as-is (CLI) or wire it to a button (Electron/VS Code).

---

## Dependencies

```
mrmd-core
  ├── mrmd-project        (pure logic: FSML, links, scaffolding)
  ├── @mariozechner/pi-ai (LLM model routing — Anthropic, OpenAI, local, etc.)
  └── (node builtins: fs, path, os, child_process, net, crypto)
```

## What stays in the heads

| Concern | Where |
|---------|-------|
| Daemon, runtimes, preferences, compute targets, event bus, settings, environment/package management, project/file/asset ops, recent files, runner | **mrmd-core** |
| System tray icon, native notifications, desktop menus, auto-start daemon | mrmd-electron |
| HTTP API, auth, WebSocket proxy for browser clients | mrmd-server |
| CLI parsing, terminal formatting, `mrmd daemon start/stop/status/install`, server setup | mrmd-cli |
| VS Code sidebar, status bar, notification popups | mrmd-vscode |
| CodeMirror editor, widgets, themes | mrmd-editor |

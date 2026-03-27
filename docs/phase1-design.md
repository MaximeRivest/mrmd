# Phase 1 Design: Environment, Language Descriptors, Health

> "Premature abstraction is the root of all evil."
> — Not quite Knuth, but he'd approve.

## Design philosophy

Two lenses:

**Knuth**: Start from the concrete. Understand exactly what each runtime
binary needs, how it starts, what it checks. Build the smallest correct
thing first. No abstraction until you've seen the pattern three times.

**Wickham**: Human-centered, progressive disclosure, composable. The
zero-argument call does the right thing. Errors tell you what to do.
Side effects are noisy. Every function returns something useful.

Applied to mrmd Phase 1, this means:

1. **Language descriptors first.** They're the atomic unit. Everything
   else (environment discovery, health checks, package management)
   is built on top of "can I find and start this runtime?"

2. **No EnvironmentService yet.** That's a premature abstraction over
   patterns we haven't seen repeat. Instead: teach each language
   descriptor how to find its binary, check its environment, and
   provision what's missing. Extract the service *after* the
   descriptors exist and we see what's actually shared.

3. **Health is just descriptors + probes.** `mrmd doctor` walks each
   descriptor and asks "can you run?" The descriptor returns a
   structured answer. No separate HealthService class needed yet.

4. **Package detection is per-language.** Python's missing-import
   detection is totally different from R's. Don't unify prematurely.

---

## Part 1: Language descriptors

### What a descriptor does

A language descriptor is a plain object that knows how to:

1. **Find** the runtime binary on this machine
2. **Build** the spawn arguments (port, cwd, flags)
3. **Check** if prerequisites are met (interpreter exists, runtime
   package installed, environment usable)
4. **Provision** a working environment from nothing (create venv,
   install runtime bridge)
5. **Detect** missing packages from code (optional, language-specific)

This is already sketched in `RuntimeService._getDescriptor()` — it
returns `{ findBinary, buildArgs }`. We extend that shape.

### The descriptor interface

```js
{
  // Required
  name: 'python',
  findBinary(config) → string | null,
  buildArgs(port, config) → string[],

  // For discovery and health
  check(config) → Promise<CheckResult>,

  // For first-time setup
  provision(projectRoot, opts) → Promise<ProvisionResult>,

  // Optional, language-specific
  detectMissingPackages(envPath, code) → Promise<string[]>,
  installPackages(envPath, packages) → Promise<InstallResult>,
  listPackages(envPath) → Promise<Package[]>,

  // Tuning
  startupTimeout: 15000,
}
```

#### CheckResult

```js
{
  ok: boolean,
  interpreter: { path, version } | null,
  environment: { path, hasBridge } | null,
  problems: [
    { message: 'Python not found', fix: 'mrmd install python' },
    { message: 'mrmd-python not installed in .venv', fix: 'mrmd env provision python .' },
  ],
}
```

Every problem carries its own fix hint. `mrmd doctor` just collects
these across all descriptors and prints them.

#### ProvisionResult

```js
{
  interpreter: '/project/.venv/bin/python',
  environment: '/project/.venv',
  bridgeVersion: '0.4.2',
  actions: [
    'Created .venv with python3.12',
    'Installed mrmd-python 0.4.2',
  ],
}
```

`actions` is the noisy side-effect log. Every mutation is reported.
CLI prints them as they happen. GUIs can show a progress list.

### Why descriptors, not a class hierarchy

A Python descriptor and a Bash descriptor share almost nothing:

| Concern | Bash | Python | R | Julia |
|---------|------|--------|---|-------|
| Binary | prebuilt Go binary in sibling dir | `mrmd-python` CLI in a venv | `Rscript` running `inst/bin/mrmd-r` | `julia` running `bin/mrmd-julia` |
| Environment | none | venv | renv library / global | Project.toml |
| Bridge install | bundled | `uv pip install mrmd-python` | `install.packages("mrmdr")` | `Pkg.instantiate()` |
| Package detection | n/a | parse imports | parse `library()` calls | parse `using` statements |
| Startup | instant | ~2s (IPython init) | ~1s | ~5-15s (compilation) |

A base class would be 90% `throw new Error('not implemented')`. Plain
objects with a shared shape are more honest.

---

## Part 2: The five descriptors

### bash

Already works. Just moves from inline to its own file.

```
Binary:    ../mrmd-bash/bin/mrmd-bash-{platform}-{arch}
Args:      --port PORT --cwd CWD
Env:       none
Provision: nothing to do (binary is bundled)
Check:     does the binary exist?
```

### python

The most complex. This is the one that matters most.

```
Binary:    {venv}/bin/mrmd-python  (or `uvx mrmd-python` as fallback)
Args:      --port PORT --cwd CWD --managed --foreground --venv VENV
Env:       venv directory
Provision:
  1. Find a python interpreter (system, uv, pyenv)
  2. Find or create a venv in the project
  3. Install mrmd-python into the venv
Check:
  - Is python on PATH?
  - Is there a .venv in the project?
  - Is mrmd-python installed in it?
```

**Finding python** (in order):

1. `config.interpreter` if explicitly set → use it
2. `config.environment` if set → `{env}/bin/python`
3. Walk up from `cwd` looking for `.venv/bin/python`
4. `python3` on PATH
5. `python` on PATH
6. `uv` available → can provision

**Finding/creating the venv**:

1. `config.environment` if explicitly set → use it
2. Walk up from `cwd` looking for `.venv/`, `venv/`
3. Walk up looking for `pyproject.toml` or `requirements.txt`
   (venv should be next to these)
4. If nothing found and `provision` is called → create `.venv`
   in `projectRoot` using `uv venv` (preferred) or `python -m venv`

**Starting the runtime**:

The descriptor runs `mrmd-python` from within the venv. The venv's
`bin/mrmd-python` entry point is installed by `pip install mrmd-python`.
We pass `--managed --foreground` so it doesn't daemonize itself (the
mrmd daemon owns the process lifecycle).

```js
findBinary(config) {
  const venv = this._findVenv(config);
  if (!venv) return null;

  // mrmd-python installs a console_script entry point
  const bin = path.join(venv, 'bin', 'mrmd-python');
  return fs.existsSync(bin) ? bin : null;
}

buildArgs(port, config) {
  const args = ['--port', String(port), '--cwd', config.cwd,
                '--managed', '--foreground'];
  const venv = this._findVenv(config);
  if (venv) args.push('--venv', venv);
  return args;
}
```

### r

```
Binary:    Rscript (on PATH)
Script:    ../mrmd-r/inst/bin/mrmd-r
Args:      --port PORT --cwd CWD
Provision:
  1. Check Rscript is on PATH
  2. Check mrmdr package is installed (R -e "library(mrmdr)")
  3. If not → install from local source or remotes
Check:
  - Is Rscript on PATH?
  - Is mrmdr installed?
```

Simpler than Python because R doesn't have venvs by default (renv
exists but is optional and orthogonal to the runtime bridge).

### julia

```
Binary:    julia (on PATH)
Script:    ../mrmd-julia/bin/mrmd-julia
Args:      --port PORT --cwd CWD
Provision:
  1. Check julia is on PATH
  2. The julia project (Manifest.toml) ships with mrmd-julia
  3. Pkg.instantiate() on first run
Check:
  - Is julia on PATH?
  - Is the mrmd-julia project intact?
```

Julia's slow first-run compilation is a known issue. The descriptor's
`startupTimeout` should be generous (30s+). Not our problem to solve —
just don't let the port-wait timeout too early.

### node (mrmd-js)

mrmd-js is a browser runtime (runs in the Electron webview), not a
Node.js server process. It doesn't need a language descriptor in the
daemon — execution is handled entirely in the editor's renderer
process.

Skip for now. If we add a Node.js *server* runtime later, it gets
a descriptor then.

---

## Part 3: Discovery

Discovery answers: "What's available on this machine?"

It is **not a service**. It's a function that calls each descriptor's
`check()` and collects the results.

```js
// src/services/discovery.js

import { getDescriptors } from './descriptors/index.js';

/**
 * Discover what's available on this machine.
 *
 * @param {object} [opts]
 * @param {string} [opts.language] - Check only this language
 * @param {string} [opts.projectRoot] - Also check project-local environments
 * @returns {Promise<Map<string, CheckResult>>}
 */
export async function discover(opts = {}) {
  const descriptors = getDescriptors();
  const results = new Map();

  for (const [name, desc] of descriptors) {
    if (opts.language && name !== opts.language) continue;
    results.set(name, await desc.check({
      cwd: opts.projectRoot || process.cwd(),
    }));
  }

  return results;
}
```

One function. No class. Returns a Map. The caller (CLI, GUI, health
check) decides how to present it.

### CLI: `mrmd env discover`

```
$ mrmd env discover
PYTHON
  interpreter  /usr/bin/python3.12  (3.12.1, system)
  environment  /project/.venv      (mrmd-python 0.4.2 ✓)

BASH
  binary       /home/user/Projects/mrmd-packages/mrmd-bash/bin/mrmd-bash  ✓

R
  interpreter  /usr/bin/Rscript  (4.3.2, system)
  bridge       ✗ mrmdr not installed
               → mrmd env provision r .

JULIA
  ✗ julia not found
  → mrmd install julia
```

### CLI: `mrmd env discover --project /path/to/project`

Same but also scans the project for `.venv`, `renv`, `Project.toml`.

---

## Part 4: Provisioning

Provisioning answers: "Make this language work in this project."

Each descriptor's `provision(projectRoot, opts)` does whatever is
needed. The function is **idempotent** — calling it twice is safe.

```
$ mrmd env provision python /project
Creating .venv with python3.12...
Installing mrmd-python 0.4.2...
✓ Python ready in /project/.venv
```

```
$ mrmd env provision r /project
Checking mrmdr R package...
Installing mrmdr from local source...
✓ R ready
```

```
$ mrmd env provision julia /project
Running Pkg.instantiate()...
✓ Julia ready
```

Bash has no provision step. Its `provision()` returns immediately.

### What provision does NOT do

- Install the language itself (`python`, `r`, `julia`). That's
  `mrmd install <lang>` — a separate, heavier operation.
- Create project structure. That's `mrmd project create`.
- Configure preferences. That's `mrmd prefs`.

Provision is narrow: "Given this language exists on the machine,
make it ready to run mrmd notebooks in this project."

---

## Part 5: Health (mrmd doctor)

`mrmd doctor` is discovery + daemon status + connectivity checks.

No HealthService class. It's a function that composes discovery
with a few extra probes:

```js
// src/health.js

import { discover } from './services/discovery.js';
import { getConfigDir, getDataDir } from './utils/platform.js';

/**
 * Run health checks.
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] - Also check project environments
 * @returns {Promise<HealthReport>}
 */
export async function checkHealth(opts = {}) {
  const checks = [];

  // 1. Config and data directories
  checks.push(checkDir('config', getConfigDir()));
  checks.push(checkDir('data', getDataDir()));

  // 2. Daemon
  checks.push(await checkDaemon());

  // 3. Languages (delegates to descriptors)
  const langs = await discover(opts);
  for (const [name, result] of langs) {
    checks.push({
      name,
      status: result.ok ? 'ok' : result.interpreter ? 'warn' : 'error',
      message: formatCheckResult(name, result),
      problems: result.problems,
    });
  }

  // 4. Overall status
  const status = checks.some(c => c.status === 'error') ? 'error'
    : checks.some(c => c.status === 'warn') ? 'warn'
    : 'ok';

  return { status, checks };
}
```

### CLI: `mrmd doctor`

```
$ mrmd doctor
✓ Config directory    ~/.config/mrmd
✓ Data directory      ~/.mrmd
✓ Daemon              running (pid 12345, uptime 2h)
✓ Python              3.12.1  mrmd-python 0.4.2 in /project/.venv
✓ Bash                mrmd-bash binary found
⚠ R                   Rscript found (4.3.2) but mrmdr not installed
                       → mrmd env provision r .
⚠ Julia               not installed
                       → mrmd install julia
```

Every line is one check. Every warning or error has a fix command.
Copy-paste-run. Wickham's principle: errors tell you what to do.

---

## Part 6: Package management

Package management is **per-descriptor, not a shared service**.

Only Python gets it in Phase 1. R and Julia can be added later when
the pattern is clear.

The descriptor exposes three optional methods:

```js
// Only on the python descriptor:
detectMissingPackages(envPath, code) → Promise<string[]>
installPackages(envPath, packages) → Promise<{ installed, failed }>
listPackages(envPath) → Promise<{ name, version }[]>
```

**detectMissingPackages** for Python:

1. Parse `import foo` and `from foo import bar` with a regex
2. Map module names to package names (the common case: `import cv2`
   → package `opencv-python` — use a known-mapping table for the
   top ~100, fall through to module-name == package-name for the rest)
3. Check which are installed: `uv pip list` or `pip list` in the venv
4. Return the missing ones

This is deliberately simple. Not AST parsing. Not dependency resolution.
A regex + a lookup table handles 95% of cases. The remaining 5% the
user installs manually.

**installPackages** for Python:

```bash
uv pip install --python {venv}/bin/python pandas matplotlib
# fallback if uv not available:
{venv}/bin/pip install pandas matplotlib
```

**listPackages** for Python:

```bash
uv pip list --python {venv}/bin/python --format json
# fallback:
{venv}/bin/pip list --format json
```

### CLI

```
$ mrmd packages list python /project/.venv
pandas     2.1.4
numpy      1.26.2
mrmd-python 0.4.2

$ mrmd packages install python /project/.venv scipy torch
Installing scipy, torch...
✓ scipy 1.11.4
✓ torch 2.1.2

$ mrmd packages check python /project/.venv pandas scipy torch
✓ pandas     installed (2.1.4)
✗ scipy      missing
✗ torch      missing
```

---

## Part 7: `mrmd install <lang>`

This is the "I don't have Python at all" path. Heavier than
provisioning — it installs the language interpreter itself.

Implemented as standalone functions, not methods on descriptors,
because installing a language is a system-level operation that
happens once and doesn't need the descriptor's runtime knowledge.

```js
// src/install.js

const strategies = {
  python: {
    linux:  ['uv', 'apt', 'dnf'],
    darwin: ['uv', 'brew'],
    win32:  ['uv', 'winget'],
  },
  r: {
    linux:  ['apt', 'dnf'],
    darwin: ['brew'],
    win32:  ['winget'],
  },
  julia: {
    linux:  ['juliaup'],
    darwin: ['juliaup'],
    win32:  ['juliaup'],
  },
};
```

Each strategy is a function: `(opts) → Promise<{ interpreter, version }>`.

The `uv` strategy for Python:
```bash
uv python install 3.12    # if uv is available
```

The `apt` strategy for Python:
```bash
sudo apt-get install -y python3.12 python3.12-venv
```

The `juliaup` strategy:
```bash
curl -fsSL https://install.julialang.org | sh    # if juliaup not found
juliaup add release
```

### CLI

```
$ mrmd install python
Installing Python via uv...
✓ Python 3.12.1 installed (/home/user/.local/bin/python3)

$ mrmd install julia
Installing Julia via juliaup...
✓ Julia 1.11.0 installed (/home/user/.juliaup/bin/julia)
```

### When to defer

`mrmd install` is a convenience. If it fails or the user prefers
their own method, that's fine. The descriptor's `check()` just needs
to find the interpreter on PATH. How it got there doesn't matter.

---

## Part 8: File layout

```
src/
  services/
    runtime.js              ← existing, remove inline descriptors
    sync.js                 ← existing
    monitor.js              ← existing
  descriptors/
    index.js                ← getDescriptors() → Map
    bash.js                 ← bash descriptor
    python.js               ← python descriptor
    r.js                    ← r descriptor
    julia.js                ← julia descriptor
  discovery.js              ← discover() function
  health.js                 ← checkHealth() function
  install.js                ← installLanguage() function
```

`RuntimeService._getDescriptor(language)` becomes:

```js
import { getDescriptor } from '../descriptors/index.js';

_getDescriptor(language) {
  const desc = getDescriptor(language);
  if (!desc) throw new Error(`Unsupported language: ${language}`);
  return desc;
}
```

---

## Part 9: Daemon integration

These features need daemon RPC methods so the CLI and GUIs can use
them. New `_dispatch` cases:

```
env.discover       → discover(params)
env.provision      → descriptor.provision(params.projectRoot, params)
env.check          → descriptor.check(params)
env.install        → installLanguage(params.language, params)
health.check       → checkHealth(params)
packages.list      → descriptor.listPackages(params.envPath)
packages.install   → descriptor.installPackages(params.envPath, params.packages)
packages.check     → descriptor.detectMissingPackages(...)
```

The daemon doesn't own any new stateful services. It dispatches to
pure functions and descriptor methods. This keeps the daemon thin.

---

## Part 10: CLI additions

New commands added to `bin/mrmd.js`:

```
mrmd env discover [--language LANG] [--project PATH]
mrmd env provision <lang> [project]
mrmd env check <lang> [project]
mrmd install <lang> [--method METHOD]
mrmd doctor [--project PATH]
mrmd packages list <lang> <env>
mrmd packages install <lang> <env> <pkg...>
mrmd packages check <lang> <env> <pkg...>
```

---

## Part 11: Implementation order

Build in dependency order. Each step is independently testable and
useful.

### Step 1: Extract bash descriptor

Move the inline bash descriptor to `src/descriptors/bash.js`.
Add `check()`. Wire `RuntimeService` to use
`getDescriptor()`. Run existing tests — nothing should break.

### Step 2: Python descriptor — findBinary + buildArgs

The minimum to make `mrmd runtime start --language python` work.
Just binary location and spawn args. No provisioning yet.
Requires an already-set-up venv with mrmd-python installed.

Test: start a Python runtime, execute code, get output.

### Step 3: Python descriptor — check()

Scan for interpreters and venvs. Returns structured `CheckResult`.
Wire into `mrmd env discover` and `mrmd env check`.

Test: run on a machine with/without Python, with/without venv.

### Step 4: Python descriptor — provision()

Create venv, install mrmd-python. Wire into `mrmd env provision`.

Test: provision in a fresh directory, verify runtime starts.

### Step 5: R descriptor

findBinary + buildArgs + check. Wire into RuntimeService.
Provision (install mrmdr package).

### Step 6: Julia descriptor

findBinary + buildArgs + check. Wire into RuntimeService.
Provision (Pkg.instantiate).

### Step 7: Health

`checkHealth()` function + `mrmd doctor` CLI command.
Composes all descriptors + daemon status.

### Step 8: Python package management

detectMissingPackages, installPackages, listPackages.
Wire into `mrmd packages` CLI commands.

### Step 9: `mrmd install`

Language installation strategies. Lowest priority — most users
already have Python/R installed.

---

## What we're NOT building

- **EnvironmentService class** — premature. Discovery is a function,
  provisioning is a descriptor method. If we need a stateful service
  later (caching, watching for env changes), we extract it then.

- **PackageService class** — premature. Package ops are descriptor
  methods. Python's needs differ from R's. Unify when we see the
  shared pattern.

- **HealthService class** — premature. Health is a function that
  composes descriptor checks. No state to manage.

- **Preferences / scope resolution** — that's Phase 2. For now,
  you start a runtime by telling it the language and cwd.

- **Node.js runtime descriptor** — mrmd-js is browser-only.

- **Abstract base class or interface validation** — we have 4
  descriptors. We can see the shape. TypeScript or runtime checks
  can come later if it becomes a problem.

The goal is: after Phase 1, `mrmd runtime start --language python`
Just Works™ on a machine with Python installed, and `mrmd doctor`
tells you exactly what to fix if it doesn't.

# CLI Reference

The `mrmd` command. Manages the daemon, runtimes, environments, projects — everything mrmd does, from the terminal.

This is the primary interface for:
- Any GUI head (VS Code, Neovim, Electron) to control mrmd
- Server setup and remote compute
- CI/CD and scripting
- Humans who like terminals

## Install

```bash
npm install -g mrmd
```

Installs the `mrmd` command globally.

---

## Phased implementation

### Phase 0 — Daemon + runtimes (minimum for any GUI to work)

This is all a VS Code extension or Neovim plugin needs. The editor spawns `mrmd` subcommands and parses JSON output. No SDK, no library integration — just a CLI.

```bash
# Start the daemon (or confirm it's running)
mrmd daemon start

# Start a runtime
mrmd runtime start --language python --cwd /path/to/project
# → { "name": "rt:...", "port": 41765, "url": "http://127.0.0.1:41765/mrp/v1", "pid": 12345 }

# List running runtimes
mrmd runtime list
# → [{ "name": "rt:...", "language": "python", "port": 41765, "alive": true, ... }]

# Stop a runtime
mrmd runtime stop rt:notebook:a1b2:d4e5:python:g7h8

# Stop the daemon (kills everything)
mrmd daemon stop
```

**That's it.** A VS Code extension can ship with just these commands:

```
1. On activate:       spawn `mrmd daemon start`
2. User runs cell:    spawn `mrmd runtime start --language python --cwd <project> --json`
                      parse the JSON, get the MRP url
                      POST code to <url>/execute (direct HTTP — no CLI needed for execution)
3. User sees output:  extension renders the MRP response
4. On deactivate:     do nothing (daemon stays alive)
```

The extension doesn't import mrmd. It doesn't need Node.js APIs. It just shells out to `mrmd` and speaks HTTP to the MRP endpoint. This works for VS Code, Neovim, Emacs, Sublime, anything.

#### Commands

```
mrmd daemon start              Start daemon in background (no-op if already running)
mrmd daemon stop               Stop daemon and all runtimes
mrmd daemon stop --keep        Stop daemon, leave runtimes alive
mrmd daemon status             Show daemon info (pid, uptime, connected heads, runtimes)
mrmd daemon logs               Tail daemon logs
mrmd daemon install            Install as system service (auto-start on login)
mrmd daemon uninstall          Remove system service

mrmd runtime start             Start a runtime
  --language <lang>              python, r, julia, bash, ...
  --cwd <path>                   working directory
  --name <name>                  explicit name (auto-generated if omitted)
  --interpreter <path>           explicit executable
  --environment <path>           explicit isolation root (venv, etc.)
  --env KEY=VALUE                extra env vars (repeatable)
  --target <id>                  run on a remote compute target
mrmd runtime stop <name>       Stop a runtime
mrmd runtime restart <name>    Restart a runtime
mrmd runtime list              List running runtimes
  --language <lang>              filter by language
  --json                         JSON output
mrmd runtime attach <name> <document>    Register a document as consumer
mrmd runtime detach <name> <document>    Unregister a document
mrmd runtime consumers         Show which documents use which runtimes

mrmd status                    Quick overview: daemon, runtimes, sync, ai, targets

mrmd sync list                 List running sync servers
mrmd sync stop <project>       Stop a project's sync server

mrmd monitor list              List running monitors
mrmd monitor stop <document>   Stop a document's monitor

mrmd ai status                 AI status (models, provider keys)
mrmd ai models                 List available models

mrmd voice status              Voice service status
mrmd voice start               Start voice service
mrmd voice stop                Stop voice service
```

#### JSON output

Every command supports `--json` for machine-readable output. This is how GUIs consume the CLI.

```bash
mrmd runtime list --json
# → [{"name":"rt:...","language":"python","port":41765,"alive":true,"consumers":["/project/analysis.md"]}]

mrmd daemon status --json
# → {"pid":12345,"uptime":86400,"runtimes":3,"heads":["mrmd-vscode"]}
```

Without `--json`, output is human-friendly:

```bash
mrmd status
# DAEMON  running (pid 12345, uptime 1d 2h, 2 heads connected)
# 
# RUNTIMES
#   python  rt:notebook:a1b2:d4e5:python:g7h8  port 41765  ● alive
#           └─ /project/analysis.md
#   r       rt:project:a1b2:r:x9y0              port 41766  ● alive
#           ├─ /project/intro.md
#           └─ /project/methods.md
#
# SYNC
#   /project           port 43210  2 documents
#   /other-project     port 43211  1 document
#
# MONITORS
#   /project/analysis.md     ● active
#   /project/intro.md        ● active
#
# SERVICES
#   ai     ● ready   anthropic, openai (2 models)
#   voice  ○ stopped
#
# TARGETS
#   local        This Computer    ● online
#   gpu-server   Lab GPU Server   ● online
```

---

### Phase 1 — Environment + health (first-time setup)

What a user needs the first time they install mrmd, or when something's broken.

```bash
# Initialize mrmd on this machine
mrmd init
# → ✓ Config directory created
# → ✓ Default preferences written
# → ✓ Daemon started

# What languages are available?
mrmd env discover
# → PYTHON
# →   /usr/bin/python3.12  (system, 3.12.1)
# →   /home/user/.venv/bin/python  (venv, 3.12.1, mrmd-python: 0.3.8)
# → R
# →   /usr/bin/Rscript  (system, 4.4.1)
# → JULIA
# →   (not installed)

# What can be installed?
mrmd env installable
# → python  via uv (recommended)
# → r       via apt
# → julia   via juliaup

# Install a language
mrmd install julia
# → Installing Julia via juliaup... done (1.11.0)

# Set up a project environment
mrmd env provision python /path/to/project
# → Creating .venv... done
# → Installing mrmd-python... done (0.3.8)

# Check if everything works
mrmd doctor
# → ✓ Config directory     ~/.config/mrmd
# → ✓ Daemon               running (pid 12345)
# → ✓ Python               3.12.1 via uv
# → ✓ mrmd-python          0.3.8 in /project/.venv
# → ✓ R                    4.4.1
# → ⚠ Julia                not installed  →  mrmd install julia
# → ⚠ API keys             none configured  →  mrmd settings set apiKeys.anthropic <key>
```

#### Commands

```
mrmd init                      First-time setup (config dirs, default prefs, start daemon)
mrmd doctor                    Diagnose everything, suggest fixes

mrmd env discover              Scan for interpreters and environments
  --language <lang>              filter
  --project <path>               also scan project directory
mrmd env provision <lang> <project>   Create environment + install mrmd runtime
mrmd env check <lang> <path>   Check if mrmd runtime is installed in environment

mrmd install <lang>            Install a language on this machine
  --method <method>              override install method (uv, apt, brew, etc.)
  --version <ver>                request specific version

mrmd packages list <lang> <env>          List installed packages
mrmd packages install <lang> <env> <pkg...>   Install packages
mrmd packages check <lang> <env> <pkg...>     Check which are installed/missing
```

---

### Phase 2 — Preferences + project (multi-runtime, scope control)

For users who have multiple projects, want shared runtimes, or need per-notebook configuration.

```bash
# Resolve what runtime a document would use
mrmd resolve /project/analysis.md python
# → {
# →   "runtimeName": "rt:notebook:a1b2:d4e5:python:g7h8",
# →   "scope": "notebook",
# →   "cwd": "/project",
# →   "environment": "/project/.venv",
# →   ...
# → }

# Change scope — share one Python runtime across all project docs
mrmd prefs set-project /project python scope=project

# Pin a specific doc to a different venv
mrmd prefs set-notebook /project/gpu-work.md python environment=/project/.venv-gpu

# Clear notebook override
mrmd prefs clear-notebook /project/gpu-work.md python

# Show current prefs
mrmd prefs show
mrmd prefs show --project /project
mrmd prefs show --notebook /project/analysis.md

# Recent files and projects
mrmd recent files
mrmd recent projects

# Project info
mrmd project info /path/to/project
mrmd project files /path/to/project
mrmd project tree /path/to/project
mrmd project create /path/to/new-project
```

#### Commands

```
mrmd resolve <doc> <lang>      Resolve effective runtime config for a document

mrmd prefs show                Show global preferences
  --project <path>               show project overrides
  --notebook <path>              show notebook overrides
mrmd prefs set-project <root> <lang> <key=value...>
mrmd prefs set-notebook <doc> <lang> <key=value...>
mrmd prefs clear-notebook <doc> <lang>

mrmd recent files              List recent files
mrmd recent projects           List recent projects

mrmd project info <path>       Show project root, config
mrmd project files <path>      List documents
mrmd project tree <path>       Show file tree
mrmd project create <path>     Initialize new project
```

---

### Phase 3 — Run + export (headless execution, CI)

For scripting, automation, and publishing.

```bash
# Run all cells in a notebook
mrmd run analysis.md
# → [1/5] python  import pandas as pd         ✓  234ms
# → [2/5] python  df = pd.read_csv(...)       ✓  1.2s
# → [3/5] python  df.describe()               ✓  45ms
# → [4/5] r       library(ggplot2)            ✓  890ms
# → [5/5] r       ggplot(df, aes(...))        ✓  340ms
# → 
# → ✓ 5/5 cells passed (2.7s)

# Run and update outputs in the file
mrmd run analysis.md --update

# Run only Python cells
mrmd run analysis.md --language python

# CI mode — exit code reflects pass/fail
mrmd run analysis.md --ci

# Export
mrmd export html analysis.md > analysis.html
mrmd export pdf analysis.md -o analysis.pdf
mrmd export script analysis.md python > analysis.py
mrmd export uv-script analysis.md > analysis.py
```

#### Commands

```
mrmd run <file>                Execute notebook cells
  --language <lang>              only run cells in this language
  --cells <indices>              only run specific cells (e.g. 0,2,4)
  --update                       write outputs back to file
  --ci                           exit 1 on any error
  --stop-on-error                stop at first error (default)
  --no-stop-on-error             run all cells even if some fail
  --timeout <ms>                 per-cell timeout

mrmd export html <file>        Export to HTML
mrmd export pdf <file>         Export to PDF
  -o <output>                    output file
mrmd export script <file> <lang>   Extract code cells to script
mrmd export uv-script <file>   Export as UV inline script
```

---

### Phase 4 — Remote compute + server setup

For running runtimes on other machines.

```bash
# On your server:
mrmd setup
# → Detected: Ubuntu 22.04, 2x A100, 256GB RAM
# → Installing Python... done
# → Installing R... done
# → Registering with markco.dev... 
# → Paste API key: mk_...
# → ✓ Registered as "gpu-server"
# → ✓ Daemon started with tunnel

# Or step by step:
mrmd init
mrmd install python
mrmd install r
mrmd login
mrmd register --label "GPU Server"
mrmd daemon start

# On your laptop:
mrmd targets list
# → local        This Computer    ● online   python, r
# → gpu-server   Lab GPU Server   ● online   python, r, julia

mrmd targets ping gpu-server
# → ● online  latency: 45ms  runtimes: 1 running

# Start a runtime on the server
mrmd runtime start --language python --cwd /data/project --target gpu-server
# → started on gpu-server, tunneled to localhost:54321

# Or configure a project to always use the server
mrmd prefs set-project /project python target=gpu-server
```

#### Commands

```
mrmd setup                     Full server setup (interactive)
mrmd login                     Authenticate with markco.dev
mrmd register                  Register this machine as a compute target
  --label <name>                 human-readable name
mrmd unregister                Remove this machine from registry

mrmd targets list              List all compute targets
mrmd targets add               Add a target manually (SSH, HTTP)
mrmd targets remove <id>       Remove a target
mrmd targets ping <id>         Check reachability
mrmd targets sync              Pull latest state from registry

mrmd daemon start              (already in phase 0, but now with tunnel support)
  --tunnel                       enable registry tunnel (default if registered)
```

---

### Phase 5 — Settings + quality of life

```bash
mrmd settings get apiKeys.anthropic
mrmd settings set apiKeys.anthropic sk-ant-...
mrmd settings list
mrmd settings reset

mrmd version
mrmd help
mrmd help runtime
mrmd help daemon
```

---

## Summary

| Phase | What | Who needs it |
|-------|------|-------------|
| **0** | daemon + runtime start/stop/list | Every GUI (VS Code, Neovim, Electron) |
| **1** | env discover/install + doctor | First-time users, setup |
| **2** | preferences + project | Multi-runtime, scope control |
| **3** | run + export | CI, scripting, publishing |
| **4** | remote compute + server setup | Remote/cloud users |
| **5** | settings + polish | Everyone eventually |

Phase 0 is ~5 commands. That's enough for a VS Code or Neovim extension to ship.

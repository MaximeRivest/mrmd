---
title: "Learn mrmd"
session:
  bash:
    auto_start: true
---

# Learn mrmd

This notebook is a hands-on guide to mrmd — the daemon that manages runtimes,
sync servers, and file monitors for executable markdown notebooks.

Run each code block in order. By the end you'll understand how all the pieces
fit together.

---

## 0. Installation

mrmd lives in the `mrmd-packages/mrmd` directory. Install the CLI globally
with `npm link`:

```bash
cd ~/Projects/mrmd-packages/mrmd
npm install
npm link
```

Verify the install — you should see the daemon CLI help, not the older
`mrmd-agent` help:

```bash
mrmd --help
```

You should see `mrmd — daemon, CLI, and service layer` at the top.
If you see `mrmd — control a live MRMD Electron notebook from the terminal`
instead, the old `mrmd-agent` package is still claiming the `mrmd` binary.
Fix it:

```bash
cd ~/Projects/mrmd-packages/mrmd-agent
npm unlink
cd ~/Projects/mrmd-packages/mrmd
npm link
```

The old agent CLI is still available as `mrmd-agent` — it controls live
Electron notebooks. The new `mrmd` CLI manages the standalone daemon.

---

## 1. Is the daemon running?

The daemon is the central process. Everything else connects to it.

```bash
mrmd daemon status
```

If it says "not running", start it:

```bash
mrmd daemon start
```

Check again — you should see a PID and uptime:

```bash
mrmd daemon status
```

The daemon listens on a Unix socket. Clients ("heads") connect to it
via newline-delimited JSON over that socket. The CLI, the editor, and
the programmatic `connect()` API are all heads.

---

## 2. The full picture: `mrmd status`

This single command shows everything the daemon is managing:

```bash
mrmd status
```

You'll see sections for DAEMON, RUNTIMES, SYNC, and MONITORS.
Right now most counters should be zero — we haven't started anything yet.

---

## 3. Sync servers

A **sync server** keeps a Yjs document in sync with a file on disk.
Every project gets one sync server. It watches for file changes and
merges them into the collaborative document, and vice versa.

Start a sync server for this project:

```bash
mrmd sync ensure "$(pwd)"
```

The output shows the WebSocket URL and port. Any editor or monitor
can connect to this URL to collaborate on documents in this project.

List running sync servers:

```bash
mrmd sync list
```

---

## 4. Monitors

A **monitor** watches a single document for execution requests.
When you run a code block in the editor, the monitor claims the
request, sends the code to a runtime, and streams the output back
into the document.

The monitor connects to the sync server, so you need the port from
the previous step.

To start a monitor for this very file (assuming sync is on port 4321 —
replace with your actual port):

```bash
# Replace 4321 with your sync port from step 3
mrmd monitor ensure "$(realpath docs/learn-mrmd.md)" --sync-port 4321
```

List monitors:

```bash
mrmd monitor list
```

You should see this file listed as `● active`.

---

## 5. Runtimes

A **runtime** is a language process (bash, python, r, julia) that
executes code blocks. Runtimes speak the MRP protocol — they receive
code via HTTP and stream output back via SSE.

Start a bash runtime:

```bash
mrmd runtime start --language bash
```

The output shows the runtime name and port. The monitor uses this
port to send code for execution.

List running runtimes:

```bash
mrmd runtime list
```

---

## 6. How execution works

Here's the full flow when you run a code block:

1. **Editor** writes an execution request into the Yjs document
   (status: `REQUESTED`, with `code`, `language`, `runtimeUrl`)
2. **Monitor** observes the request, claims it (`CLAIMED` → `READY` → `RUNNING`)
3. **Monitor** sends the code to the runtime's MRP endpoint via HTTP
4. **Runtime** executes the code and streams output back via SSE
5. **Monitor** writes the output into an `output:<execId>` block in the document
6. **Sync server** persists the updated document to disk
7. **Editor** sees the output appear in real time via Yjs sync

All of this happens over the daemon's Unix socket, WebSocket (Yjs),
and HTTP (MRP) — no direct process coupling.

---

## 7. The daemon's architecture

```
┌──────────────────────────────────────────────────┐
│                    Daemon                        │
│                                                  │
│  ┌─────────────┐  ┌───────────┐  ┌───────────┐  │
│  │ RuntimeSvc  │  │  SyncSvc  │  │ MonitorSvc│  │
│  │             │  │           │  │           │  │
│  │ bash ●      │  │ project/  │  │ doc.md ●  │  │
│  │ python ●    │  │  ws://…   │  │ doc2.md ● │  │
│  └─────────────┘  └───────────┘  └───────────┘  │
│                                                  │
│  Unix socket: ~/.local/share/mrmd/daemon.sock    │
└──────────────────────────────────────────────────┘
        ▲               ▲               ▲
        │               │               │
   ┌────┴───┐    ┌──────┴─────┐   ┌─────┴─────┐
   │  CLI   │    │   Editor   │   │  connect() │
   │ (head) │    │   (head)   │   │   (head)   │
   └────────┘    └────────────┘   └───────────┘
```

The daemon owns three services:

- **RuntimeService** — spawns and tracks language processes
- **SyncService** — one Yjs WebSocket server per project
- **MonitorService** — one headless Yjs peer per document, bridges
  execution requests to runtimes

Heads are thin clients. They connect, make RPC calls, and disconnect.
The daemon keeps running.

---

## 8. Programmatic usage

You don't have to use the CLI. The `mrmd` package exports a `connect()`
function that returns a client with the same API:

```bash
node -e "
  import { connect } from '../src/index.js';

  const client = await connect();
  const status = await client.status();
  console.log('Daemon pid:', status.pid);
  console.log('Runtimes:', status.runtimes);
  console.log('Sync servers:', status.sync);
  console.log('Monitors:', status.monitors);
  client.disconnect();
"
```

The client auto-starts the daemon if it isn't running.
Events like `sync:started` and `monitor:stopped` are broadcast
to all connected heads in real time.

---

## 9. Graceful shutdown

The daemon tears down in dependency-reverse order:

1. **Monitors** disconnect from sync servers
2. **Sync servers** flush pending writes, close WebSockets
3. **Runtimes** kill language processes

```bash
mrmd daemon stop
```

Verify everything is cleaned up:

```bash
mrmd status
```

---

## 10. Lifecycle summary

```bash
# Start everything
mrmd daemon start
mrmd sync ensure /path/to/project
mrmd monitor ensure /path/to/doc.md --sync-port PORT
mrmd runtime start --language bash

# Check state
mrmd status

# Tear down
mrmd daemon stop    # stops all of the above in the right order
```

The `ensure` pattern is idempotent — calling it twice returns the
existing server/monitor instead of creating a duplicate. This makes
it safe for editors to call on every file open without worrying about
cleanup.

---

## Next steps

- Try editing this file in the mrmd editor while the sync server is running —
  you'll see changes appear in real time
- Start a python runtime and add python code blocks to this notebook
- Look at `mrmd.md` project config for setting up virtual environments
  and per-language session options
- Read the [CLI reference](cli.md) for the full command list

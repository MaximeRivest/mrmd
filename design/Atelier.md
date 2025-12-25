# Atelier: North Star

> "A workshop so quiet that the user's own thoughts are the loudest thing in the room."

---

## What Is This Document?

This is the guide for everyone who touches this codebase. Not just what we're building, but *how we think* about building it. When you're unsure whether to add a feature, how to name something, or which of two approaches is "right" - this document should help you decide.

Read it once fully. Return to it when making significant decisions.

---

## Part 1: The Product

### What We're Building

Atelier is a dual-mode environment for thinking and building. It's where you and Claude work together.

For **writers**, it's a calm, focused space for prose - like iA Writer or Ulysses, but your paragraphs can contain live Python.

For **developers**, it's a notebook IDE - like Jupyter or VS Code, but the file is just markdown that you could open anywhere.

The magic: these aren't two products. They're two views of the same thing. A writer can toggle into developer mode when curiosity strikes. A developer can toggle into writer mode when they need to think.

### The User Journey

This is the experience we're designing for:

1. **A writer arrives at atelier.study**
   They see a clean, centered page. No sidebar. No terminal. Just their words and a blinking cursor. They write.

2. **Claude helps**
   They highlight a paragraph and ask Claude to improve it. Claude's response streams in, visible but not yet committed. They accept it with a keystroke.

3. **Curiosity strikes**
   They want to analyze something. They write a code block. They don't know Python well, so Claude writes it for them. They press Ctrl+Enter. Output appears below.

4. **They didn't notice becoming a programmer**
   Over weeks, they've written dozens of code blocks. They toggle to developer mode to see the terminal. They realize they've built something. The ceiling disappeared.

This journey is the product. Everything we build serves it.

### The Two Front Doors

The domain determines the first impression:

| Domain | Mode | First Experience |
|--------|------|------------------|
| `atelier.study` | Writer | Clean, typographic, no chrome. The document is everything. |
| `atelier.codes` | Developer | Terminal visible, file tree, full IDE feel. Power is evident. |

Same account. Same files. Same backend. The domain is just a default - users can switch anytime.

**Why two domains instead of a toggle?**

Marketing. Writers don't want to land on an IDE. Developers don't want to land on a "writing app." The domain self-selects the audience and sets expectations. Once they're in, they discover the other mode exists.

---

## Part 2: The Philosophy

### "Quiet"

The quote at the top isn't decoration. It's the core design principle.

Most software is loud. Notifications. Badges. Animations. Toolbars competing for attention. Features announcing themselves.

Atelier should be quiet. When you open it, you should hear your own thoughts. The UI should recede. The document should be the only thing that matters.

**What "quiet" means in practice:**

- No feature should draw attention to itself
- Animations should be subtle and purposeful (never decorative)
- Empty states should be calming, not anxious ("No files yet" not "Get started NOW!")
- Errors should be humble, not alarming
- The default state is minimal; power reveals itself on demand

**The Steve Jobs test:**

> "When someone opens this app, what are they feeling?"

If they're continuing work: get out of their way.
If they're starting something new: inspire them (quietly).
If they're lost: help them (gently).

### Markdown is Truth

The `.md` file is the absolute source of truth. This is non-negotiable.

**What this means:**

- No proprietary database for document content
- No hidden state that doesn't serialize to the file
- The file should be readable in any text editor
- The file should be diffable in git
- Opening the same file in VS Code, Obsidian, or cat should show the same content

**Why this matters:**

Users trust us with their thinking. That thinking should never be locked in. If Atelier disappears tomorrow, their files still work everywhere.

This also means we can't do certain things. We can't store "block IDs" or "cell metadata" in ways that break plain markdown. When we need metadata (like execution outputs), we use conventions that degrade gracefully (HTML comments, code block annotations).

### Markdown that Runs

Code cells are first-class citizens. The document is alive.

**The execution model:**

- Stateful (like Jupyter): Variables persist between cells
- Persistent (unlike Jupyter): The document captures the narrative, not just the code
- Top-to-bottom (like a script): The document has a logical flow

**The output model:**

- Outputs appear below their code blocks
- Outputs are ephemeral until explicitly saved
- Outputs can be cleared without affecting the document
- Rich outputs (plots, HTML) render inline

### Collaboration as a Whiteboard

We're building a whiteboard, not Google Docs.

**The difference:**

Google Docs: Everyone types everywhere. CRDTs merge the chaos. Conflicts are "resolved" by algorithms that can't understand intent.

Whiteboard: One person holds the marker. Others watch and wait. When they want to contribute, they take the marker. No conflicts because no simultaneous edits to the same spot.

**Our implementation:**

- **CRDT (Yjs)** handles the mechanics: sync, offline, reconnect
- **Locks** handle the coordination: one writer per block

```
CURSOR ENTERS BLOCK        FIRST KEYSTROKE
        ↓                        ↓
   [SOFT LOCK]              [HARD LOCK]
   "Alice is here"          "Alice is editing"
   Others can see           Others cannot type here
```

**Why not just CRDTs?**

> "CRDTs merge text but can't merge intent. If Alice refactors a function while Bob adds a feature to it, the merge is valid text but broken code."

Locks force coordination. That's the point. We're not trying to eliminate human communication - we're trying to make it natural.

---

## Part 3: Design Principles

### For UI/UX

**1. Progressive disclosure**
Don't show everything at once. Start minimal. Reveal power as users need it.

- Writer mode: document only
- Toggle: terminal appears
- Toggle: file tree appears
- Toggle: variable explorer appears

Each toggle is a conscious choice by the user. They're never overwhelmed.

**2. Generous whitespace**
Space is not wasted. Space is calm. Space helps users focus.

- Document max-width: 800px, centered
- Generous margins around everything
- Don't pack UI elements together

**3. Typography matters**
The document is primarily text. Text must be beautiful.

- Carefully chosen font stack (see DESIGN_SYSTEM.md)
- Proper line height (1.6-1.7 for prose)
- Proper font sizes (not too small, not too large)
- Headings that create clear hierarchy

**4. Dark mode is default**
Most coding happens in dark mode. Most writing happens in dark mode (late nights). Default to dark. Support light.

**5. No emojis in UI**
Emojis are casual. We're building a professional tool. Icons should be subtle, monochrome, purposeful.

### For Code

**1. Delete more than you add**
The best code is no code. Before adding a feature, ask: can we solve this by removing something?

The codebase was 90,000+ lines. We've deleted 48,000+. It's still too big.

**2. No backward compatibility shims**
If something is deprecated, delete it. Don't leave commented code "for reference." Don't add adapters to make old patterns work. Rip off the bandaid.

**3. Clear module boundaries**
Each layer (engine, editor, application) should have a clear interface. Don't reach across layers. Don't import from siblings.

```
Good: Application → Service Layer → Editor → Engine
Bad:  Application → Editor internals
Bad:  Editor → Application state
```

**4. TypeScript for new code**
The frontend has legacy JavaScript. New code should be TypeScript. Types are documentation that the compiler checks.

**5. Name things for humans**
```
Good: createEditorBridge
Bad:  mkEdBr

Good: DocumentService
Bad:  DocSvc

Good: handleFileOpen
Bad:  hfo
```

Names should be readable in a code review without context.

### For Features

**1. Would a writer use this?**
Before adding a developer feature, ask: would a writer ever see this? If yes, it must be quiet and unobtrusive. If no, it must be hidden by default.

**2. Does this serve the journey?**
Every feature should connect to the user journey (writer → curiosity → code → programmer). If a feature doesn't serve that journey, question whether it belongs.

**3. Simple > Clever**
If there are two solutions - one clever and one simple - choose simple. Clever code is hard to debug, hard to modify, hard to delete.

**4. When in doubt, leave it out**
It's easier to add a feature later than to remove it. If you're unsure whether something belongs, don't add it. Wait until the need is clear.

---

## Part 4: The Architecture

### The Open-Core Model

| | **mrmd** (Engine) | **Atelier** (Product) |
|---|---|---|
| **Nature** | Open Source (MIT) | Commercial SaaS |
| **Domain** | `mrmd.dev` | `atelier.study` / `atelier.codes` |
| **Audience** | Self-hosters, contributors | Writers, developers, teams |
| **Value** | "Markdown that runs" | "Claude's home" - managed, synced, AI-integrated |
| **Code** | `src/mrmd/` + `editor/` | `frontend/` |

*"mrmd is the engine. Atelier is the car. Most people buy the car. Some people want to build their own."*

**The Flywheel:**
1. Self-hosters use `mrmd` and contribute improvements
2. Contributors improve the engine
3. Better engine makes better Atelier
4. SaaS revenue funds development
5. Repeat

### The Trinity

Three layers, each with clear responsibility:

```
┌─────────────────────────────────────────────────────────────┐
│              ATELIER (SaaS Shell) - frontend/                │
│                                                              │
│  The application layer. Sessions, projects, AI assistant,   │
│  mode switching. This is where Study and Codes diverge.     │
│                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │    apps/study/       │  │    apps/codes/       │         │
│  │    Writer Mode       │  │    Developer Mode    │         │
│  └──────────┬───────────┘  └──────────┬───────────┘         │
│             └──────────────┬──────────┘                     │
│                            ▼                                │
│             ┌──────────────────────────┐                    │
│             │     Service Layer        │                    │
│             │  Document │ Execution    │                    │
│             │  Collaboration │ AI      │                    │
│             └──────────────────────────┘                    │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              @mrmd/editor (CM6 Package) - editor/            │
│                                                              │
│  The editing surface. Pure, high-performance, reusable.     │
│  Could be embedded in other apps. No application logic.     │
│                                                              │
│  - CodeMirror 6 core                                        │
│  - Yjs CRDT collaboration                                   │
│  - Block-level locks                                        │
│  - Streaming overlay (AI output before commit)              │
│  - Widgets (images, math, code output)                      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              mrmd (Python Engine) - src/mrmd/                │
│                                                              │
│  The backend brain. Execution, files, state. Could be       │
│  self-hosted. No UI opinions.                               │
│                                                              │
│  - Code execution (IPython)                                 │
│  - File system operations & watching                        │
│  - Yjs CRDT document management (pycrdt)                    │
│  - Version history                                          │
│  - AI tool routing                                          │
└─────────────────────────────────────────────────────────────┘
```

### Current State vs Target State

**What's Done:**
- `@mrmd/editor`: CM6 package with widgets, execution, Yjs, locks
- Python backend: Execution, files, Yjs management, history
- Legacy cleanup: ~48,000 lines removed

**What Needs Redesign:**

| Component | Current | Target |
|-----------|---------|--------|
| `frontend/web/index.html` | 5,000+ line monolith with inline JS | Clean entry point that boots a TypeScript app |
| `EditorBridge` | Adapter with backward-compat shims | Clean service layer (Document, Execution, Collaboration) |
| Application structure | Single mode | Two apps (Study, Codes) with shared services |

**Target Service Layer:**

```
┌─────────────────┬─────────────────┬─────────────────────────┐
│ DocumentService │ ExecutionService│ CollaborationService    │
│ - open/save     │ - run block     │ - connect/disconnect    │
│ - content ops   │ - queue/cancel  │ - presence/locks        │
│ - undo/redo     │ - output stream │ - file watching         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

No shims. No backward compatibility. Clean interfaces designed for what Study/Codes actually need.

---

## Part 5: Directory Map

```
mrmd/
├── editor/                 # @mrmd/editor - CM6 package
│   └── src/
│       ├── core/           # MrmdEditor class
│       ├── collaboration/  # Yjs, locks, streaming, awareness
│       ├── execution/      # IPython executor
│       └── widgets/        # Image, math, HTML, run buttons
│
├── frontend/               # Atelier application
│   ├── src/                # Target structure (planned)
│   │   ├── apps/study/     # Writer mode entry point
│   │   ├── apps/codes/     # Developer mode entry point
│   │   └── services/       # Document, Execution, Collaboration
│   ├── core/               # Current JS modules (legacy)
│   └── web/                # HTML entry points
│
├── src/mrmd/               # Python engine
│   └── server/
│       ├── handlers.py     # HTTP API (70+ endpoints)
│       ├── collab_handler.py   # WebSocket + Yjs sync
│       └── yjs_manager.py  # CRDT document manager
│
├── ai-server/              # AI integration (DSPy programs)
├── design/                 # Brand, vision, specs
├── electron-app/           # Desktop wrapper (future)
└── docs/                   # Technical documentation
```

---

## Part 6: Next Steps

These are the commits that move us from current state to target state:

### Commit 2: Single Entry Module
Extract the 5,000 lines of inline JS from `index.html` into a proper TypeScript module. Keep behavior identical. This breaks the monolith without changing the product.

### Commit 3: Two Front Doors
Add the Study/Codes split. A bootloader detects the domain and loads the right app. Both apps share the service layer.

### Commit 4: Service Layer
Replace EditorBridge with clean services. Design interfaces for what the apps actually need, not for backward compatibility.

---

## Part 7: Making Decisions

When you're unsure about something, ask these questions:

### For features:
1. Does this serve the user journey (writer → programmer)?
2. Would a writer ever see this? If yes, is it quiet enough?
3. Is this the simplest solution?
4. Can we solve this by removing something instead?

### For UI:
1. Is this quiet? Does it recede?
2. Would Steve Jobs approve of how it feels?
3. Is there enough whitespace?
4. Does it work in dark mode?

### For code:
1. Can I delete something instead of adding something?
2. Is this the right layer for this logic?
3. Would a new contributor understand this in 5 minutes?
4. Am I adding backward-compat shims? (Don't.)

### For architecture:
1. Does this respect the Trinity (Engine, Editor, Application)?
2. Am I reaching across layers?
3. Is this interface clean or convenient?

---

## Part 8: Key Documents

| Doc | What it contains |
|-----|------------------|
| `design/brand-and-naming.md` | Product naming, marketing split, domain strategy |
| `design/mrmd-saas-vision.md` | SaaS product vision, user personas |
| `editor/src/collaboration/README.md` | Collaboration architecture (locks, streaming, Yjs) |
| `DESIGN_SYSTEM.md` | Colors, typography, spacing, components |
| `COMPACT_MODE_DESIGN.md` | Writer mode UI specification |
| `TODO_for_release.md` | Known issues, release blockers |

---

## Running Locally

```bash
git clone https://github.com/maximerivestio/mrmd
cd mrmd

# Install Python dependencies
uv sync

# Build editor package
cd editor && pnpm install && pnpm build && cd ..

# Install frontend dependencies
cd frontend && pnpm install && cd ..

# Run
uv run mrmd serve
# Open http://localhost:51789
```

---

*This is the north star. When in doubt, check here first.*

*Last updated: December 2024*

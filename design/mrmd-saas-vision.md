# MRMD SaaS Vision

> Giving Claude Code a home.

---

## The Core Idea

**mrmd.dev/username** - Your Claude's workspace. A Linux VPS where:
- Claude lives permanently
- Your notebooks and projects are stored
- AI tools are always available
- The ceiling disappears as you grow

---

## The Philosophy

*"It's Claude's computer, but your notebooks."*

- **Claude's home** - Claude has tools, a shell, Python environments
- **Your notebooks** - Your writing, your ideas, your vision
- **Shared space** - Like a studio apartment with a brilliant roommate who never sleeps

### The User Journey

1. **Writer arrives** - They write. Claude helps. No code. No terminal. Just words.
2. **Curiosity grows** - They want to analyze something. They write a little Python - or Claude does.
3. **It just works** - No setup. No install. Claude's home is already configured.
4. **The ceiling disappears** - They didn't notice becoming a programmer.

---

## Home Screen Design

### Principles (via Steve Jobs)

*"When someone opens this app, what are they feeling?"*

1. **Continuing something** - get out of their way
2. **Starting something new** - inspire them
3. **Lost** - help them

*"Make it so quiet that the user's own thoughts are the loudest thing in the room."*

### The Design

```
mrmd.dev/maximerivest


        screensimplifierplan.md              The Great Screen Simplifier
        ses1.md                              Untitled
        notes.md                             Meeting notes from Tuesday




        Scratch              mrmd              simplescreen
        5 notebooks          9 notebooks       8 notebooks




                                                          Assistant
```

- **Notebooks first** - your writing, front and center
- **Projects second** - context, shown small at bottom
- **Actions hidden** - keyboard shortcuts, right-click, or ask Claude

### For New Users

```
mrmd.dev/newuser





        Welcome.

        This is your space. Start writing.

        _





                                                          Scratch

```

One project. One blank page. One blinking cursor.

---

## Navigation & UI

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ mrmd                              screensimplifierplan.md P│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  # The Great Screen Simplifier                              │
│                                                             │
│  What if home screens were just... quiet?                   │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Scratch                                           Assistant │
└─────────────────────────────────────────────────────────────┘
```

- **Header:** Logo (click = home) | Current notebook | P quick picker hint
- **Footer:** Current project (click = project's notebooks) | Assistant button

### Quick Picker (P)

The universal navigator:
- Fuzzy search all notebooks across all projects
- Shows: `notebook.md  project name  first line preview`
- Recent at top, then alphabetical
- Type `/projects` to switch project context

### Project View

Click project name in footer:

```
        Scratch

        screensimplifierplan.md    The Great Screen Simplifier
        ses1.md                    Untitled
        notes.md                   Meeting notes from Tuesday

        + New notebook

                                                        esc
```

---

## Creating Things

### Notebooks

Just start typing. Or N.

- File named from first heading
- Or stays "Untitled" until you name it
- No modal, no dialog

### Projects

Projects mean: venv, git repo, potential dependencies. Two paths:

1. **Clone from GitHub** - paste a repo URL anywhere (Claude chat, notebook, home). Claude handles the rest.

2. **New blank project** - N or ask Claude. Creates folder, venv, git init.

**Key insight:** Projects are discovered, not declared.

Write in Scratch. When it becomes something, Claude suggests: *"This is growing. Want to make it a project?"*

---

## Claude Integration

### Two Modes

1. **Assistant panel** (floating button  chat slides up)
   - Conversations, questions, longer tasks
   - "Clone this repo and set it up"
   - "What was I working on yesterday?"
   - "Help me debug this error"

2. **Inline in notebook**
   - Select text  "Ask Claude"
   - Type `/claude` or `@claude` in a paragraph
   - Code cells: "Run with Claude" explains output

### Context Awareness

Claude always knows:
- Current project path
- Current notebook
- Recent notebooks in this project
- The venv/Python environment

---

## Switching Context

### Within a project
- P  type notebook name  enter
- Click project name in footer  click notebook
- Wiki-style links: `[[other-notebook]]`

### Across projects
- P  type any notebook (shows project name)
- Home screen  click notebook or project
- Ask Claude: "Open my notes in the mrmd project"

### What happens on switch

**Same project:**
- Notebook changes
- Claude context stays (same venv, same git repo)
- Terminal stays (if open)

**Different project:**
- Notebook changes
- Claude context switches (different venv)
- Terminal closes or switches
- Status bar updates to new environment

---

## Claude's Home Improvements (Pricing)

Not "Server Configuration". **Claude's Home.**

```
        Claude's Home


        Currently

        2 vCPU  4 GB RAM  50 GB storage
        Ubuntu 22.04  us-east-1
        Running since Dec 12


        Upgrade

          Starter         2 vCPU  4 GB  50 GB              $20/mo
          Workshop        4 vCPU  16 GB  100 GB            $50/mo
          Studio          8 vCPU  32 GB  200 GB           $100/mo
          Lab             8 vCPU  64 GB  A10 GPU          $250/mo
          Datacenter      96 vCPU  1 TB  8 H200       Let's talk


        Changes apply on next restart.
        Claude will migrate your projects automatically.
```

### The Tiers Tell a Story

| Tier | Who | What they're doing |
|------|-----|-------------------|
| **Starter** | Writers, note-takers | Markdown, light Claude chat |
| **Workshop** | Power users, analysts | Python, data processing, multiple projects |
| **Studio** | Developers, researchers | Heavy compute, large codebases |
| **Lab** | ML/AI work | GPU for training, inference, CUDA |
| **Datacenter** | Serious ML | Multi-GPU training, large models |

### The Vibe

| Tier | Claude has... |
|------|---------------|
| Starter | a desk |
| Workshop | an office |
| Studio | a floor |
| Lab | a building |
| Datacenter | a campus |

### Add-ons

```
        Add-ons

          Extra storage         +100 GB          $10/mo
          Backup snapshots      Daily, 30 days   $5/mo
          Custom domain         your.domain.com  $5/mo
          GitHub sync           Connected        Free


        Location

          us-east-1       eu-west-1       ap-southeast-1

        Moving takes ~10 minutes. Claude packs everything.
```

---

## Fluid Compute (The Dream)

### The Problem

Claude's "brain" is:
- Conversation context (ephemeral)
- Project files (git, syncable)
- venv/dependencies (reproducible via uv.lock)
- Running processes (stateful, hard to move)

### Three Architectures

**1. Fixed Home (Current/Simple)**
```
User  [Workshop instance]  all projects
```
Simple. Predictable. Wasteful - paying for GPU when writing markdown.

**2. Project-Level Homes (Next step)**
```
User  [Starter]  writing projects
      [Lab]  ML project
      [Workshop]  data analysis
```
Each project on appropriate hardware. Switch projects = switch instance.

**3. Fluid Compute (The dream)**
```
User  [Edge/minimal]  routing layer

       [Compute pool]  spins up what you need, when you need it
```

### The Dream Architecture

```

   Your browser             Compute pool

   - Editor                  - Python kernel
   - File browser    <-->    - GPU tasks
   - Claude chat             - Heavy compute


    Always on                 Scales to zero
    Cheap/free                Pay per second
```

### What the User Sees

```
        Training model...

         Upgraded to Lab (H200) for this cell
           Estimated time: 4 minutes
           Cost: ~$0.80

         62%


         Output streams here in real-time
```

No "move Claude" button. No waiting. Just... more power when needed.

### The Tech (via Woz)

- **CRIU** - Checkpoint/Restore in Userspace (pause/resume processes)
- **Firecracker** - AWS's microVM, boots in <125ms
- **Container migration** - Kubernetes-style orchestration

*"It's like hibernating a laptop, but for individual processes, and you can wake up on different hardware."*

### Implementation Path

1. **Now:** Fixed tiers (Starter/Workshop/Studio/Lab)
2. **Next:** Project-level placement
3. **Later:** Fluid compute (automatic dispatch based on workload)

---

## Key Quotes

> "The best infrastructure is invisible infrastructure. They shouldn't know where Claude lives. They should just know Claude is fast enough." - Bezos

> "Make it so quiet that the user's own thoughts are the loudest thing in the room." - Jobs

> "The ceiling disappears without them noticing."

> "Dashboards are for managers who don't do real work."

> "The notebook is the conversation. The conversation is the notebook."

> "Claude packs everything." - the voice of the product

---

*Document version: 1.0*
*Created: 2024-12-15*
*Authors: Claude + Maxime*

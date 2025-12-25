# MRMD Compact Mode: Complete UX/UI Design Specification

> **Vision**: Transform MRMD from a developer-focused IDE into a document-first literate programming environment inspired by ReMarkable notebooks, Kindle readers, and Typora—where the writing surface is sacred and all tools are contextual overlays.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Current vs Target State](#current-vs-target-state)
3. [Layout Architecture](#layout-architecture)
4. [Component Specifications](#component-specifications)
   - [Exit Button [×]](#1-exit-button--file-navigation)
   - [Tool Rail [≡]](#2-tool-rail--icon-only-sidebar)
   - [Tool Panels](#3-tool-panels-slide-out)
   - [Formatting Panel](#4-formatting-panel-for-non-programmers)
   - [AI Commands Panel](#5-ai-commands-panel)
   - [Terminal Overlay](#6-terminal-overlay-kindle-dictionary-style)
   - [Pagination System](#7-pagination-system)
   - [Status Bar](#8-status-bar-compact--toggleable)
5. [Mobile Adaptations](#9-mobile-specific-adaptations)
6. [Mode Switching](#10-mode-switching)
7. [Implementation Roadmap](#implementation-priority)

---

## Design Philosophy

### Core Principles

1. **Document-First, Not IDE-First**
   - The document IS the interface
   - Everything else (terminal, files, AI) are **reference tools** that overlay or slide in
   - Like consulting a dictionary while reading a book—the writing/thinking experience is sacred

2. **Progressive Disclosure**
   - **Compact Mode (Default)**: Clean, focused, notebook-like for everyone
   - **Developer Mode**: Full IDE capabilities when needed
   - Users graduate from one to the other naturally

3. **Spatial Consistency**
   - One side = Navigation (× to exit doc, file browser)
   - Other side = Tools (formatting, AI, utilities)
   - User chooses which side for each (handedness preference)

4. **Notebook Gravity**
   - The document always wants to be full-screen
   - Everything else is temporary and dismissible

5. **Markdown as Truth**
   - The file is always valid markdown
   - UI is just a lens over the source

6. **AI as Collaborator**
   - Claude should feel like a co-author sitting beside you
   - Not a separate app to context-switch into

---

## Current vs Target State

| Aspect | Current (Developer Mode) | Target (Compact Mode) |
|--------|-------------------------|----------------------|
| **Layout** | Fixed split with sidebar tabs | Full-canvas document + sliding panels |
| **Navigation** | Tab bar + sidebar tabs | [×] exit to files, [≡] tool rail |
| **Status** | Full status bar (always visible) | Minimal footer (toggleable) |
| **Files** | Sidebar tab | Exit-button leads to file navigator |
| **Terminal** | Sidebar tab | Kindle-style floating overlay |
| **AI** | Double-tap `jj` palette | Same + promoted to tool rail |
| **Formatting** | Hidden (power users only) | Visible toolbar for non-coders |
| **Variables** | Sidebar tab | Slide-out panel |
| **History** | Sidebar tab | Hidden in [...] menu |
| **Processes** | Sidebar tab | Hidden in [...] menu |

---

## Layout Architecture

### Desktop/Tablet Layout (≥768px)

```
┌─────────────────────────────────────────────────────────────────┐
│ [×]                              doc-title.md                [≡] │  ← Minimal header
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│                                                                 │
│                        Document Canvas                          │
│                      (max-width: 800px)                         │
│                        (centered)                               │
│                                                                 │
│                   [∞ Scroll] or [📄 Page 3/12]                  │
│                                                                 │
│                                                                 │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ○ Kernel │ ○ Server │ Ln 42 │ main │              [···] [AI▸]  │  ← Compact status
└─────────────────────────────────────────────────────────────────┘
```

### Mobile Layout (<768px)

```
┌─────────────────────────┐
│ [×]    doc.md      [≡]  │  ← Minimal header
├─────────────────────────┤
│                         │
│                         │
│    Document Canvas      │
│    (full width)         │
│    (padded edges)       │
│                         │
│                         │
├─────────────────────────┤
│ [📁] [✎] [▶] [🤖] [···]│  ← Bottom nav (iOS/Android style)
└─────────────────────────┘
```

### Key Layout Properties

```css
/* Compact mode document canvas */
.compact-mode .document-canvas {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
  min-height: 100vh;
}

/* Header - minimal */
.compact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  height: 44px;
}

/* Mobile bottom nav */
@media (max-width: 767px) {
  .compact-bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 56px;
    display: flex;
    justify-content: space-around;
    align-items: center;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
}
```

---

## Component Specifications

### 1. Exit Button [×] — File Navigation

**Position**: Top-left (configurable to opposite side of tool rail)

**Visual Design**:
```
┌─────┐
│  ×  │   44×44px touch target
└─────┘   24px icon, 1px stroke
          color: var(--muted)
          hover: var(--text)
```

**Behavior**:
| Action | Result |
|--------|--------|
| Single tap | Exit document → File/Project navigator view |
| Long press (500ms) | Show recent files quick-switch popup |

**File Navigator View** (replaces document canvas):

```
┌─────────────────────────────────────────────────────────────────┐
│ [←]  ~/Projects/mrmd                                       [≡]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔍 Filter files...                                             │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│  📁 .mrmd/                                                      │
│  📄 README.md                                     2 days ago    │
│  📄 python_plot_display.md  ●                     just now      │  ← ● = modified
│  📄 TODO_for_release.md                           1 hour ago    │
│  📁 examples/                                                   │
│  📁 frontend/                                                   │
│                                                                 │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│  + New Notebook                    ⚙ Open Project...            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**[←] Back Behavior**:
- If browsing files: Returns to document
- If in subdirectory: Goes to parent directory
- Keyboard: `Escape` key

**File Item States**:
```css
.file-item          { opacity: 0.8; }
.file-item:hover    { opacity: 1; background: var(--code-bg); }
.file-item.current  { font-weight: 600; color: var(--accent); }
.file-item.modified { /* show ● indicator */ }
```

---

### 2. Tool Rail [≡] — Icon-Only Sidebar

**Position**: Top-right (configurable)

**States**:
- **Hidden** (default): Only [≡] hamburger button visible
- **Expanded**: 48px-wide vertical icon rail

**Expanded Layout**:

```
┌──────────────────────────────────────────────────────┬────┐
│                                                      │ ×  │  ← Close rail
│                                                      ├────┤
│                                                      │ A  │  ← Text formatting
│                                                      │ 🎨 │  ← Colors/highlight
│                                                      │ B  │  ← Bold/italic/etc
│                Document Canvas                       │ ═  │  ← Block elements
│                                                      ├────┤
│                                                      │ 🤖 │  ← AI Commands
│                                                      │ λ  │  ← Variables
│                                                      │ ▶  │  ← Terminal
│                                                      │ 📁 │  ← Quick files
│                                                      ├────┤
│                                                      │ ···│  ← More menu
└──────────────────────────────────────────────────────┴────┘
```

**Icon Specifications**:

| Icon | ID | Label | Panel Width | Description |
|------|----|-------|-------------|-------------|
| **☰** | `toc` | Contents | 280px | Table of Contents (document outline) |
| **B** | `format` | Formatting | 280px | Bold, italic, headings, lists |
| **▣** | `code` | Code Cells | 280px | Run all, clear outputs, kernel |
| **</>** | `source` | Source | (toggle) | Toggle source/rendered view |
| **¶** | `whitespace` | Whitespace | (toggle) | Show/hide whitespace chars |
| --- | --- | divider | --- | --- |
| **?** | `ai` | AI | 320px | All AI spells and Ask Claude |
| **λ** | `variables` | Variables | 280px | Python environment inspector |
| **▶** | `terminal` | Terminal | 480px (overlay) | Floating terminal |
| **≡** | `files` | Files | 280px | Quick file picker |
| --- | --- | divider | --- | --- |
| **···** | `more` | More | 200px (menu) | History, Processes, Settings |

**Icon Button CSS**:
```css
.tool-rail-btn {
  width: 48px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  transition: color 0.15s, background 0.15s;
}

.tool-rail-btn:hover {
  color: var(--text);
  background: var(--code-bg);
}

.tool-rail-btn.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
```

---

### 3. Tool Panels (Slide-Out)

**Trigger**: Tap any tool rail icon

**Animation**: Slide in from right edge, 200ms ease-out

**Panel Structure**:

```
┌────────────────────────────────────┬─────────────────────────┐
│                                    │ 🤖 AI Commands       [×]│  ← Header with close
│                                    ├─────────────────────────┤
│                                    │                         │
│       Document                     │    Panel Content        │
│       (stays interactive)          │    (scrollable)         │
│                                    │                         │
│                                    │                         │
│                                    │                         │
│                                    │                         │
│                                    │                         │
└────────────────────────────────────┴─────────────────────────┘
```

**Panel Widths**:
- **Narrow** (280px): Variables, Files, Formatting
- **Medium** (320px): AI Commands
- **Wide/Overlay** (480px+): Terminal

**Panel CSS**:
```css
.tool-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
  transform: translateX(100%);
  transition: transform 0.2s ease-out;
  z-index: 100;
}

.tool-panel.open {
  transform: translateX(0);
}

.tool-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

.tool-panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
```

**Dismissal**:
- Click [×] in panel header
- Click outside panel (on document)
- Press `Escape` key
- Open a different panel (replaces current)

---

### 4. Formatting Panel (For Non-Programmers)

**Purpose**: Make markdown accessible like Google Docs/Word/Typora

**Panel Layout**:

```
┌─────────────────────────────┐
│ A  Formatting            [×]│
├─────────────────────────────┤
│                             │
│  FONT                       │
│  ┌─────────────┐ ┌────────┐ │
│  │ System     ▾│ │ 14px  ▾│ │
│  └─────────────┘ └────────┘ │
│                             │
│  STYLE                      │
│  ┌───┬───┬───┬───┬───┐      │
│  │ B │ I │ S │ ~ │ ` │      │
│  └───┴───┴───┴───┴───┘      │
│  bold italic under strike   │
│                             │
│  HEADINGS                   │
│  ┌────┬────┬────┬────┐      │
│  │ H1 │ H2 │ H3 │ ¶  │      │
│  └────┴────┴────┴────┘      │
│                             │
│  LISTS                      │
│  ┌───┬───┬───┬───┐          │
│  │ • │ 1.│ ☐ │ > │          │
│  └───┴───┴───┴───┘          │
│  bullet num todo quote      │
│                             │
│  INSERT                     │
│  ┌───┬───┬───┬───┬───┐      │
│  │ — │ 📷│ 🔗│ 📊│```│      │
│  └───┴───┴───┴───┴───┘      │
│  hr img link table code     │
│                             │
└─────────────────────────────┘
```

**Button Actions** (all insert/wrap markdown):

| Button | Action | Markdown Inserted |
|--------|--------|-------------------|
| **B** | Bold selection | `**text**` |
| **I** | Italic selection | `*text*` |
| **S** | Strikethrough | `~~text~~` |
| **`** | Inline code | `` `text` `` |
| **H1** | Heading 1 | `# ` at line start |
| **H2** | Heading 2 | `## ` at line start |
| **H3** | Heading 3 | `### ` at line start |
| **¶** | Normal paragraph | Remove heading prefix |
| **•** | Bullet list | `- ` at line start |
| **1.** | Numbered list | `1. ` at line start |
| **☐** | Todo item | `- [ ] ` at line start |
| **>** | Blockquote | `> ` at line start |
| **—** | Horizontal rule | `\n---\n` |
| **📷** | Insert image | `![alt](url)` dialog |
| **🔗** | Insert link | `[text](url)` dialog |
| **📊** | Insert table | Table template |
| **```** | Code block | ` ```\n\n``` ` |

**Selection Behavior**:
- With selection: Wrap selected text
- Without selection: Insert at cursor with placeholder

---

### 5. AI Commands Panel

**Purpose**: Discoverable UI for the existing `jj` spell system

**Panel Layout**:

```
┌─────────────────────────────────┐
│ 🤖 AI Commands               [×]│
├─────────────────────────────────┤
│                                 │
│  CONTEXT                        │
│  ┌─────────────────────────────┐│
│  │ ◉ Line  ○ Selection  ○ Doc ││
│  └─────────────────────────────┘│
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                 │
│  ┌─────────────────────────────┐│
│  │ ✨ Ask Claude...            ││  ← Opens chat input
│  └─────────────────────────────┘│
│                                 │
│  QUICK ACTIONS                  │
│  ┌─────┬───────────────────────┐│
│  │  j  │ Finish line           ││
│  ├─────┼───────────────────────┤│
│  │  k  │ Finish section        ││
│  ├─────┼───────────────────────┤│
│  │  f  │ Fix + finish          ││
│  └─────┴───────────────────────┘│
│                                 │
│  FOR TEXT                       │
│  ┌─────┬───────────────────────┐│
│  │  g  │ Grammar fix           ││
│  ├─────┼───────────────────────┤│
│  │  t  │ Clean transcription   ││
│  ├─────┼───────────────────────┤│
│  │  m  │ Reformat markdown     ││
│  └─────┴───────────────────────┘│
│                                 │
│  FOR CODE                       │
│  ┌─────┬───────────────────────┐│
│  │  d  │ Add documentation     ││
│  ├─────┼───────────────────────┤│
│  │  c  │ Complete function     ││
│  ├─────┼───────────────────────┤│
│  │  h  │ Add type hints        ││
│  ├─────┼───────────────────────┤│
│  │  v  │ Better variable names ││
│  ├─────┼───────────────────────┤│
│  │  e  │ Explain with comments ││
│  └─────┴───────────────────────┘│
│                                 │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                 │
│  QUALITY LEVEL                  │
│  ○ Quick      — Kimi K2         │
│  ● Balanced   — Sonnet 4.5      │
│  ○ Deep       — Gemini 3        │
│  ○ Maximum    — Opus 4.5        │
│  ○ Ultimate   — Multi-model     │
│                                 │
│  Keyboard: jj to open, then key │
│                                 │
└─────────────────────────────────┘
```

**Interaction**:
- Click any action row to execute immediately
- Keyboard shortcut shown on left still works globally
- Quality level persists in localStorage

**"Ask Claude" Expanded**:
```
┌─────────────────────────────────┐
│ ✨ Ask Claude                [×]│
├─────────────────────────────────┤
│                                 │
│  Context: Line 42-45            │
│  ┌─────────────────────────────┐│
│  │ def calculate_total(items): ││
│  │     return sum(i.price for..││
│  └─────────────────────────────┘│
│                                 │
│  ┌─────────────────────────────┐│
│  │ How can I optimize this     ││
│  │ for large datasets?         ││
│  │                        [Ask]││
│  └─────────────────────────────┘│
│                                 │
└─────────────────────────────────┘
```

---

### 6. Terminal Overlay (Kindle Dictionary Style)

**Design Philosophy**: The terminal should feel like pulling up a reference book while reading—always available, never permanent.

**Trigger**:
- Tool rail [▶] button
- Keyboard shortcut (e.g., `` Ctrl+` ``)
- Click "Terminal" in [...] menu

**Overlay Layout**:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              (Document visible, slightly dimmed)                │
│                                                                 │
│    ┌─────────────────────────────────────────────────────┐      │
│    │ ▶ Terminal ─ zsh                    [−] [□] [×]     │      │
│    ├─────────────────────────────────────────────────────┤      │
│    │                                                     │      │
│    │ ~/Projects/mrmd$ python script.py                   │      │
│    │ Processing data...                                  │      │
│    │ ✓ Done: 142 items processed                         │      │
│    │ ~/Projects/mrmd$ █                                  │      │
│    │                                                     │      │
│    │                                                     │      │
│    └─────────────────────────────────────────────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Window Controls**:

| Button | Action |
|--------|--------|
| **[−]** | Minimize to status bar (shows indicator ▶) |
| **[□]** | Toggle between default size (50% height) and expanded (80% height) |
| **[×]** | Close overlay (terminal session persists in background) |

**Interaction**:
- **Drag**: Title bar to reposition
- **Resize**: Bottom-right corner handle
- **Escape**: Close overlay (when not in vi/less/etc.)

**Default Position & Size**:
```css
.terminal-overlay {
  position: fixed;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  width: min(800px, 90vw);
  height: 40vh;
  min-height: 200px;
  max-height: 80vh;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
  z-index: 200;
}
```

**Minimized State** (in status bar):
```
│ ○ ○ │ Ln 42 │ main │ [▶ zsh] │              [···] [AI▸]  │
                        ↑
                        Click to restore terminal
```

---

### 7. Pagination System

**Purpose**: Support both infinite scroll (default) and paginated view for document-oriented work, scientific publishing, and print/PDF export.

### Page Break Syntax

**Supported Markers** (in markdown):

```markdown
<!-- Option 1: HTML comment (recommended) -->
<!-- pagebreak -->

<!-- Option 2: Thematic break with class -->
<div class="page-break"></div>

<!-- Option 3: LaTeX style -->
\newpage

<!-- Option 4: Triple horizontal rule -->
---
---
---
```

**Parser Recognition**:
```javascript
const PAGE_BREAK_PATTERNS = [
  /<!--\s*pagebreak\s*-->/i,
  /<div\s+class="page-break"\s*><\/div>/i,
  /\\newpage/,
  /^---\n---\n---$/m
];
```

### View Toggle

**Location**: Status bar or document header

```
┌─────────────────────────────────────────────────────────────────┐
│ [×]                    doc.md           [∞ Scroll │ 📄 Pages] [≡]│
└─────────────────────────────────────────────────────────────────┘
                                          ↑
                                          Toggle control
```

**Scroll Mode** (default):
- Continuous document
- Standard scrolling behavior
- Page breaks render as horizontal rules

**Page Mode**:
- Fixed aspect ratio pages (like PDF)
- Page navigation controls
- Content flows across pages automatically
- Manual breaks force new page

### Page Mode UI

```
┌─────────────────────────────────────────────────────────────────┐
│ [×]                      doc.md                            [≡]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                                                           │  │
│  │                    Page content                           │  │
│  │                                                           │  │
│  │                    (A4/Letter ratio)                      │  │
│  │                    (max-width: 700px)                     │  │
│  │                                                           │  │
│  │                                                           │  │
│  │                                                           │  │
│  │                                               ─── 3 ───   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│                    [◀]  Page 3 of 12  [▶]                       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ○ ○ │ Ln 42 │ main │                              [TOC] [AI▸]  │
└─────────────────────────────────────────────────────────────────┘
```

**Navigation**:
| Input | Action |
|-------|--------|
| Click [◀] / [▶] | Previous / Next page |
| Arrow keys (←/→) | Previous / Next page |
| Click page number | Open TOC / page picker |
| Swipe left/right | Previous / Next page (touch) |
| Home / End | First / Last page |
| Number + Enter | Go to specific page |

### Table of Contents (TOC)

**Purpose**: ReMarkable/Kindle-inspired document outline for quick navigation. The TOC is a reference tool that overlays the document—never competing with content.

**Trigger**:
- Tool rail: ☰ (Contents) button
- Keyboard: `Cmd+Shift+O` / `Ctrl+Shift+O` (like VS Code outline)
- Page mode: Click page number

**Panel Layout**:

```
┌─────────────────────────────────┐
│ CONTENTS                     [×]│
├─────────────────────────────────┤
│                                 │
│  Introduction                   │  ← H1: bold, full color
│  Background                     │  ← H2: medium weight
│    Related Work                 │  ← H3: indented, muted
│    Motivation                   │
│  Methods                        │
│    Data Collection              │
│    Analysis                     │
│  Results                        │
│  Discussion                     │
│  Conclusion                     │
│                                 │
└─────────────────────────────────┘
```

**Visual Hierarchy** (following DESIGN_SYSTEM):
- H1: `font-semibold`, full text color, `text-base`
- H2: `font-medium`, secondary color
- H3-H6: `text-xs`, muted color, indented

**Interaction**:
| Action | Result |
|--------|--------|
| Click heading | Scroll to line, close panel, focus editor |
| Arrow Up/Down | Navigate between headings |
| Enter | Activate focused heading |
| Escape | Close panel |

**Generation**: Auto-extracted from markdown headings (`#`, `##`, `###`, etc.) and Setext headings (underlined with `===` or `---`).

**Mobile**: Slides up from bottom as a sheet (max 70% height) with drag handle.

---

### 8. Status Bar (Compact & Toggleable)

### Full Status Bar (Developer Mode)

Current implementation—all information visible:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◇ 0 │ € 0 │ λ main │ .venv │ mrmd/.venv/bin/python │ Cursor: 266 │ Line: 20 │ ○ Kernel │ ○ Server │ ready │ [AI▸] │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Compact Status Bar (Compact Mode)

Minimal, clean, expandable:

```
┌─────────────────────────────────────────────────────────────────┐
│ ○ ○ │ Ln 42 │ main │                              [···] [AI▸]  │
└─────────────────────────────────────────────────────────────────┘
  ↑ ↑    ↑       ↑                                    ↑     ↑
  │ │    │       └─ Git branch                        │     └─ AI juice level indicator
  │ │    └─ Current line number                       └─ More menu
  │ └─ Server status (●=connected, ○=disconnected, ◌=connecting)
  └─ Kernel status (●=ready, ◐=busy, ○=disconnected)
```

**Status Dot Colors**:
```css
.status-dot.ready      { color: #10b981; } /* green */
.status-dot.busy       { color: #f59e0b; } /* amber */
.status-dot.error      { color: #ef4444; } /* red */
.status-dot.offline    { color: #6b7280; } /* gray */
```

### [...] More Menu

```
┌─────────────────────────┐
│  ⏱ Version History      │
│  ⚙ Processes (2)        │  ← Badge if running
│  ────────────────────── │
│  ☐ Show full status bar │  ← Toggle
│  ☐ Show line numbers    │  ← Toggle
│  ────────────────────── │
│  ⚙ Settings...          │
└─────────────────────────┘
```

### Toggle Behavior

- **Double-tap** status bar: Expand/collapse between compact and full
- **Single-tap** on element: Context action (e.g., tap Ln to go to line)

### Toggleable Elements

| Element | Compact | Full |
|---------|---------|------|
| Kernel status | Dot only | Dot + "Kernel" label |
| Server status | Dot only | Dot + "Server" label |
| Line number | "Ln 42" | "Cursor: 266 \| Line: 42" |
| Git branch | Branch name | Branch + status |
| Python env | Hidden | Full venv path |
| Queued jobs | Hidden | "◇ 2" count |
| Errors | Hidden | "€ 1" count |

---

## 9. Mobile-Specific Adaptations

### Bottom Navigation Bar

**Replaces**: Tool rail [≡] on mobile viewports

```
┌─────────────────────────────────────────────────────────────────┐
│    📁         ✎          ▶          🤖         ···              │
│   Files    Format      Run        AI        More               │
└─────────────────────────────────────────────────────────────────┘
```

**Specifications**:
```css
.mobile-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: var(--bg);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom); /* iPhone notch */
  z-index: 100;
}

.mobile-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 16px;
  color: var(--muted);
  font-size: 10px;
}

.mobile-nav-item.active {
  color: var(--accent);
}
```

### Touch Gestures

| Gesture | Action |
|---------|--------|
| Swipe left from right edge | Open tool panel |
| Swipe right from left edge | Open file navigator |
| Swipe down from top | Show header (if auto-hidden) |
| Two-finger swipe L/R | Page navigation (page mode) |
| Long press on code block | Context menu: Run, Copy, Edit |
| Long press on text | AI context menu |
| Pinch | Zoom document (optional) |
| Double-tap | Toggle header/footer visibility |

### Mobile Panel Behavior

**Sheet-style panels** (slide up from bottom):

```
┌─────────────────────────┐
│                         │
│    Document             │
│    (dimmed)             │
│                         │
├─────────────────────────┤ ← Drag handle
│  ═══════                │
│                         │
│  🤖 AI Commands         │
│                         │
│  [Content...]           │
│                         │
│                         │
└─────────────────────────┘
```

**Sheet Heights**:
- **Peek**: 40% screen height (default)
- **Half**: 60% screen height (drag up)
- **Full**: 90% screen height (drag to top)
- **Dismiss**: Drag down below 20%

```css
.mobile-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
  transform: translateY(100%);
  transition: transform 0.3s ease-out;
  z-index: 150;
}

.mobile-sheet.open {
  transform: translateY(40%); /* peek state */
}

.mobile-sheet.half {
  transform: translateY(10%);
}

.mobile-sheet.full {
  transform: translateY(0);
  border-radius: 0;
}
```

### Responsive Breakpoints

```css
/* Mobile: Bottom nav, sheet panels */
@media (max-width: 767px) {
  .tool-rail { display: none; }
  .mobile-bottom-nav { display: flex; }
  .tool-panel { /* Convert to sheet */ }
}

/* Tablet: Side panels, no bottom nav */
@media (min-width: 768px) and (max-width: 1023px) {
  .tool-rail { display: flex; }
  .mobile-bottom-nav { display: none; }
  .tool-panel { max-width: 50vw; }
}

/* Desktop: Full experience */
@media (min-width: 1024px) {
  .tool-panel { max-width: 400px; }
}
```

---

## 10. Mode Switching

### User Preferences

**Stored in localStorage**:

```javascript
const MRMD_PREFERENCES = {
  // Mode
  mode: 'compact' | 'developer',

  // Layout
  toolRailSide: 'left' | 'right',      // Handedness preference
  exitButtonSide: 'left' | 'right',    // Opposite of toolRailSide

  // Status bar
  statusBarExpanded: false,            // Full vs compact
  statusBarVisible: true,              // Show/hide entirely

  // Document
  defaultView: 'scroll' | 'pages',     // Pagination preference
  showLineNumbers: false,              // In rich editor

  // AI
  juiceLevel: 1,                       // 0-4, default Balanced

  // Theme (existing)
  theme: 'system' | 'light' | 'dark'
};
```

### Mode Toggle Location

**Settings Panel** (via [...] → Settings):

```
┌─────────────────────────────────┐
│ ⚙ Settings                   [×]│
├─────────────────────────────────┤
│                                 │
│  INTERFACE MODE                 │
│  ┌─────────────────────────────┐│
│  │ ◉ Compact Mode              ││
│  │   Clean, focused writing    ││
│  │                             ││
│  │ ○ Developer Mode            ││
│  │   Full IDE with panels      ││
│  └─────────────────────────────┘│
│                                 │
│  LAYOUT                         │
│  Tool rail position             │
│  ○ Left    ◉ Right              │
│                                 │
│  STATUS BAR                     │
│  ☑ Show status bar              │
│  ☐ Expanded by default          │
│                                 │
│  DOCUMENT                       │
│  Default view                   │
│  ◉ Scroll    ○ Pages            │
│                                 │
└─────────────────────────────────┘
```

### Mode Differences Summary

| Feature | Compact Mode | Developer Mode |
|---------|--------------|----------------|
| **Default for** | Everyone | Power users |
| **Layout** | Full canvas + overlays | Split panels available |
| **Sidebar** | Icon rail (hidden by default) | Tab-based sidebar (visible) |
| **Status bar** | Minimal dots | Full information |
| **Terminal** | Floating overlay | Dedicated panel option |
| **Files** | Exit [×] → navigator | Sidebar tab |
| **Variables** | Slide-out panel | Sidebar tab |
| **History** | Hidden in [...] menu | Sidebar tab |
| **Processes** | Hidden in [...] menu | Sidebar tab |
| **Formatting** | Dedicated panel | Hidden (keyboard only) |

### Keyboard Shortcuts

**Mode-independent** (work in both):
- `jj` — AI spell palette
- `Ctrl+S` — Save
- `Ctrl+M` — Cycle view modes
- `Shift+Enter` — Run code block
- `Ctrl+Enter` — Run block (no advance)
- `Escape` — Close panel/overlay, cancel

**Compact Mode specific**:
- `Ctrl+\` — Toggle tool rail
- `Ctrl+E` — Toggle file navigator
- `` Ctrl+` `` — Toggle terminal overlay

---


## Appendix: Design Inspirations

| Product | Inspiration |
|---------|-------------|
| **ReMarkable** | Document-first, minimal chrome, tool panels |
| **Kindle** | Dictionary overlay, reading-focused |
| **Typora** | WYSIWYG markdown, clean interface |
| **Notion** | Block-based editing, slash commands |
| **iA Writer** | Focus mode, distraction-free |
| **Obsidian** | File navigator, graph view |
| **VS Code** | Command palette, activity bar |
| **Google Docs** | Formatting toolbar, collaboration |

---

*Document version: 1.0*
*Last updated: 2024-12-14*
*Author: Claude + Maxime*

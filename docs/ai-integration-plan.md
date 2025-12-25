# MRMD AI Integration Plan

## Overview

Standalone AI server using dspy-cli to serve DSPy programs, integrated with the MRMD editor via hover palette, command palette, and keyboard shortcuts.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MRMD Editor                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ AI Palette   │  │ Cmd Palette  │  │ Terminal Panel (tabs)  │ │
│  │ (hover/wheel)│  │ (Ctrl+Shift+P│  │ - Shell                │ │
│  └──────┬───────┘  └──────┬───────┘  │ - Claude Code          │ │
│         │                 │          │ - Aider                │ │
│         └────────┬────────┘          │ - etc.                 │ │
│                  │                   └────────────────────────┘ │
└──────────────────┼──────────────────────────────────────────────┘
                   │ HTTP
                   ▼
┌──────────────────────────────────────┐
│         AI Server (:8766)            │
│         (dspy-cli serve)             │
│                                      │
│  Programs:                           │
│  ├── /FinishSentence                 │
│  ├── /FinishParagraph                │
│  ├── /FinishCodeLine                 │
│  ├── /FinishCodeSection              │
│  ├── /FixGrammar                     │
│  ├── /FixTranscription               │
│  ├── /CorrectAndFinishLine           │
│  └── /CorrectAndFinishSection        │
│                                      │
│  Config: LiteLLM (user's API keys)   │
└──────────────────────────────────────┘
```

---

## 1. AI Server (dspy-cli)

### Directory Structure

```
ai-server/
├── src/mrmd_ai/
│   ├── modules/
│   │   ├── __init__.py
│   │   ├── finish.py          # FinishSentence, FinishParagraph, etc.
│   │   ├── fix.py             # FixGrammar, FixTranscription
│   │   └── correct.py         # CorrectAndFinishLine, CorrectAndFinishSection
│   └── signatures/
│       ├── __init__.py
│       ├── finish_sigs.py     # Input/output schemas for finish programs
│       ├── fix_sigs.py
│       └── correct_sigs.py
├── dspy.config.yaml           # Model registry, API key references
├── pyproject.toml
└── README.md
```

### DSPy Programs

#### Finish Programs
| Program | Input | Output | Description |
|---------|-------|--------|-------------|
| `FinishSentence` | text, cursor_pos, context | completion | Complete current sentence |
| `FinishParagraph` | text, cursor_pos, context | completion | Complete current paragraph |
| `FinishCodeLine` | code, cursor_pos, language, context | completion | Complete current code line |
| `FinishCodeSection` | code, cursor_pos, language, context | completion | Complete code block/function |

#### Fix Programs
| Program | Input | Output | Description |
|---------|-------|--------|-------------|
| `FixGrammar` | text, selection?, context | fixed_text, changes | Grammarly-style fixes |
| `FixTranscription` | text, context | fixed_text | Fix speech-to-text errors |

#### Correct & Finish Programs
| Program | Input | Output | Description |
|---------|-------|--------|-------------|
| `CorrectAndFinishLine` | text, cursor_pos, context | corrected_completion | Fix + complete line |
| `CorrectAndFinishSection` | text, cursor_pos, context | corrected_completion | Fix + complete section |

### Context Schema

```python
class EditorContext:
    notebook_cells: list[Cell]      # All cells in notebook
    current_cell_index: int         # Which cell cursor is in
    cursor_position: Position       # Line, column
    selection: Range | None         # Selected text range
    cell_type: str                  # "code" | "markdown"
    language: str                   # "python", "javascript", etc.

class ProjectContext:
    files: list[FileSummary]        # Optional: relevant project files
    project_type: str               # "python", "nodejs", etc.
    dependencies: list[str]         # Package names
```

### API Key Configuration

Users provide their own keys via environment or config:

```yaml
# dspy.config.yaml
models:
  default:
    provider: anthropic
    model: claude-sonnet-4-20250514

  fast:
    provider: openai
    model: gpt-4o-mini

# Keys from environment:
# ANTHROPIC_API_KEY
# OPENAI_API_KEY
```

---

## 2. Frontend: AI Palette

### Hover Palette (Primary UX)

A small radial/wheel menu appears near cursor on hover or after brief pause:

```
         [Fix]
           │
[Finish] ──●── [Correct+Finish]
           │
       [Transcribe]
```

**Behavior:**
- Appears ~500ms after cursor stops moving (or on dedicated hover zone)
- Subtle, semi-transparent until hovered
- Click or press key (F, X, C, T) to trigger
- Context-aware: shows relevant options based on cell type

### Command Palette Integration

Accessible via `Ctrl+Shift+P`:

```
> AI: Finish Sentence          (Alt+.)
> AI: Finish Paragraph         (Alt+Shift+.)
> AI: Finish Code Line         (Alt+Enter)
> AI: Finish Code Section      (Alt+Shift+Enter)
> AI: Fix Grammar              (Alt+G)
> AI: Fix Transcription        (Alt+T)
> AI: Correct & Finish Line    (Alt+C)
> AI: Correct & Finish Section (Alt+Shift+C)
```

### Keyboard Shortcuts

| Action | Shortcut | Context |
|--------|----------|---------|
| Finish sentence/line | `Alt+.` | Auto-detect |
| Finish paragraph/section | `Alt+Shift+.` | Auto-detect |
| Fix grammar | `Alt+G` | Text cells |
| Fix transcription | `Alt+T` | Any |
| Correct & finish | `Alt+C` | Any |
| Open AI palette | `Alt+A` | Any |

### Inline UI Elements

For selected text or current line:
```
┌─────────────────────────────────────┐
│ The quick brown fox jumps over the  │ [✨ Finish] [🔧 Fix]
│ lazy d|                             │
└─────────────────────────────────────┘
```

---

## 3. Terminal Panel: Coding CLIs

### Tab-based Terminal Interface

```
┌─────────────────────────────────────────────────────────────┐
│ [Shell] [Claude Code] [Aider] [+]                           │
├─────────────────────────────────────────────────────────────┤
│ $ claude                                                     │
│ Claude Code v1.x.x                                          │
│ > help me refactor the auth module                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Supported CLIs (BYOK)

| CLI | Command | API Key Env |
|-----|---------|-------------|
| Claude Code | `claude` | `ANTHROPIC_API_KEY` |
| Aider | `aider` | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| GitHub Copilot CLI | `gh copilot` | GitHub auth |
| Cursor (if available) | `cursor` | Cursor subscription |

### Implementation

- Use existing PTY infrastructure (see `pty_handler.py`)
- Each CLI runs in its own PTY session
- Tab management in frontend
- CWD set to current project root

---

## 4. Programs Management Panel

### Sidebar/Panel for Managing AI Programs

```
┌─────────────────────────────┐
│ AI Programs           [+ New]│
├─────────────────────────────┤
│ ▼ Finish                    │
│   ├── FinishSentence    ✓   │
│   ├── FinishParagraph   ✓   │
│   ├── FinishCodeLine    ✓   │
│   └── FinishCodeSection ✓   │
│ ▼ Fix                       │
│   ├── FixGrammar        ✓   │
│   └── FixTranscription  ✓   │
│ ▼ Correct                   │
│   ├── CorrectLine       ✓   │
│   └── CorrectSection    ✓   │
├─────────────────────────────┤
│ [⚙ Settings] [📊 Usage]     │
└─────────────────────────────┘
```

### Features

- Enable/disable programs
- Configure shortcuts per program
- View usage stats
- Create new programs (opens dspy-cli scaffold wizard)
- Edit program prompts/parameters

---

## 5. Implementation Phases

### Phase 1: AI Server Setup
- [ ] Initialize dspy-cli project in `ai-server/`
- [ ] Create basic finish programs (sentence, paragraph)
- [ ] Create basic fix programs (grammar)
- [ ] Test standalone with `dspy-cli serve`
- [ ] Document API key setup

### Phase 2: MRMD Integration
- [ ] Add AI server spawning to MRMD server startup
- [ ] Create AI client in frontend (`ai-client.ts`)
- [ ] Proxy `/api/ai/*` through MRMD server (optional)

### Phase 3: AI Palette UI
- [ ] Implement hover palette component
- [ ] Add command palette AI entries
- [ ] Implement keyboard shortcuts
- [ ] Add inline action buttons

### Phase 4: Context Passing
- [ ] Implement notebook context extraction
- [ ] Add project context builder
- [ ] File context selection UI

### Phase 5: Terminal Panel Tabs
- [ ] Extend terminal panel with tabs
- [ ] Add CLI launcher (Claude Code, Aider, etc.)
- [ ] PTY session per tab

### Phase 6: Programs Panel
- [ ] Create programs management sidebar
- [ ] Integrate with dspy-cli for program creation
- [ ] Settings and usage tracking

---

## 6. API Key Management

Users bring their own API keys. Options:

1. **Environment variables** (recommended for CLI users)
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   export OPENAI_API_KEY=sk-...
   ```

2. **Settings UI** (for GUI users)
   - Stored in `~/.mrmd/config.yaml` (encrypted or plaintext with warning)
   - Or system keychain integration

3. **Per-project** `.env` file
   - Loaded when project opens
   - Git-ignored by default

---

## 7. File Structure (Final)

```
mrmd/
├── ai-server/                      # dspy-cli project (separate process)
│   ├── src/mrmd_ai/
│   │   ├── modules/
│   │   └── signatures/
│   ├── dspy.config.yaml
│   └── pyproject.toml
├── src/mrmd/
│   ├── server/
│   │   ├── app.py                  # Main server (spawns AI server too?)
│   │   ├── handlers.py
│   │   └── pty_handler.py          # For terminal tabs
│   └── ai/
│       └── client.py               # Optional: Python client for AI server
├── frontend/
│   ├── core/
│   │   ├── ai-client.ts            # HTTP client for AI server
│   │   ├── ai-palette.ts           # Hover wheel component
│   │   ├── command-palette.ts      # Command palette (add AI commands)
│   │   └── terminal-tabs.ts        # Terminal panel with tabs
│   └── styles/
│       └── ai-palette.css
└── docs/
    └── ai-integration-plan.md      # This file
```

# MRMD Project Management Implementation Plan

## Overview

This document outlines the implementation of project management, virtual environment handling, and session management for the MRMD web/electron frontend.

## Core Concepts

### 1. Default MRMD Environment
- A global `~/.mrmd/` directory containing:
  - `venv/` - Default Python venv managed by uv
  - `config.json` - User preferences
  - `recent_projects.json` - Recent projects list
  - `sessions/` - Pickled session states (future)

### 2. Session Modes
- **Default Session**: Uses `~/.mrmd/venv`, shared across all "loose" notebooks
- **Project Session**: Uses project's `.venv`, shared across project notebooks
- **Dedicated Session**: Individual notebook gets its own IPython kernel (same venv)

### 3. Project Definition
A project is a folder containing any of:
- `pyproject.toml` (Python/uv project)
- `.venv/` directory
- `uv.lock` file
- `.git/` directory

---

## Phase 1: MRMD Home Directory & Default Environment

### 1.1 Server-side Setup Detection
**File: `src/mrmd/server/environment.py` (new)**

```python
MRMD_HOME = Path.home() / ".mrmd"
DEFAULT_VENV = MRMD_HOME / "venv"

def ensure_mrmd_home():
    """Create ~/.mrmd structure if not exists."""

def ensure_default_venv():
    """Create default venv using uv if not exists."""

def get_default_python() -> str:
    """Return path to default venv's python."""

def is_mrmd_initialized() -> bool:
    """Check if MRMD home is set up."""
```

### 1.2 New API Endpoints
**File: `src/mrmd/server/http.py`**

```
POST /api/mrmd/status
  -> {initialized, mrmd_home, default_venv, default_python}

POST /api/mrmd/initialize
  -> Creates ~/.mrmd and default venv

POST /api/mrmd/config
  -> Get/set user config
```

### 1.3 Frontend: First-Run Experience
- Detect if `~/.mrmd` exists via `/api/mrmd/status`
- If not initialized:
  - Show welcome page (read-only intro notebook)
  - Prompt to initialize MRMD
  - Run `/api/mrmd/initialize`
- Store "has seen intro" in config

---

## Phase 2: Project Management UI

### 2.1 Project State
**File: `frontend/web/rich-editor-test.html` (or extract to module)**

```javascript
// Project state
let currentProject = null;  // {root, name, venv, type}
let projectFiles = [];      // Open files in project
let activeFileIndex = 0;    // Current tab

// Session state
let sessionMode = 'default';  // 'default' | 'project' | 'dedicated'
let sessionId = null;
let sessionVenv = null;
```

### 2.2 Project Browser
Reuse folder browser with fuzzy filter for:
- **Open Project**: Browse to folder, detect if it's a project
- **Create Project**:
  - Name input
  - Creates `~/Projects/{name}/`
  - Runs `uv init`
  - Creates `.venv` via `uv venv`
  - Creates template `README.md`

### 2.3 Recent Projects
- Store in `~/.mrmd/recent_projects.json`
- Show in sidebar or welcome screen
- API: `POST /api/mrmd/recent-projects` (get/add/remove)

### 2.4 UI Components Needed
1. **Project indicator** in header (shows current project or "No Project")
2. **File tabs** when project is open (multiple .md files)
3. **Session indicator** showing:
   - Session mode (default/project/dedicated)
   - Venv path (truncated)
   - Click to change

---

## Phase 3: Session & Venv Switching

### 3.1 Session Indicator Component
```html
<div class="session-indicator">
  <span class="session-mode">project</span>
  <span class="session-venv" title="/full/path">.venv</span>
  <button class="session-change">Change</button>
</div>
```

### 3.2 Venv Picker Modal
When user clicks "Change":
1. Show modal with options:
   - "Default (~/.mrmd/venv)"
   - "Project (.venv)" - if in project
   - "Browse for venv..."
2. Browse uses folder browser filtered for venv markers:
   - Look for `bin/python` or `Scripts/python.exe`
   - Show venv name and Python version

### 3.3 Session Configuration API
Already exists: `POST /api/session/configure`
```json
{
  "session": "session_id",
  "cwd": "/path/to/project",
  "python_env": "/path/to/venv/bin/python"
}
```

### 3.4 Frontend Session Management
```javascript
async function switchSession(mode, venvPath = null) {
  // 1. Warn if current session has state (future: offer to save)
  // 2. Configure new session via API
  // 3. Update UI indicators
  // 4. Re-execute initialization cell if needed
}
```

---

## Phase 4: Multi-File Tabs (Project Mode)

### 4.1 Tab Bar Component
```html
<div class="file-tabs">
  <div class="file-tab active" data-path="/path/to/file.md">
    <span class="tab-name">file.md</span>
    <span class="tab-modified">●</span>
    <button class="tab-close">×</button>
  </div>
  <!-- more tabs -->
</div>
```

### 4.2 Tab State Management
```javascript
const openFiles = new Map();  // path -> {content, modified, editor state}

function openFileInTab(path) {
  if (openFiles.has(path)) {
    switchToTab(path);
  } else {
    loadFile(path);
    addTab(path);
  }
}

function closeTab(path) {
  if (openFiles.get(path)?.modified) {
    // Confirm discard or save
  }
  openFiles.delete(path);
  removeTabUI(path);
}
```

---

## Phase 5: Welcome/Intro Experience

### 5.1 Welcome Notebook Content
Create `src/mrmd/server/static/welcome.md`:
```markdown
# Welcome to MRMD

MRMD is a literate programming environment...

## Quick Start

```python
# This is a code cell - press Shift+Enter to run
print("Hello, MRMD!")
```

## Features
- Live code execution
- Multiple language support
- Session management
...
```

### 5.2 Welcome Mode
- Load welcome.md as read-only
- Execute cells normally (uses default session)
- Changes don't persist (warn on navigation)
- "Create New Notebook" or "Open Project" to exit

---

## Phase 6: Future - Session Persistence

### 6.1 Session Pickling
```python
def save_session(session_id: str, path: Path):
    """Pickle IPython session state to disk."""

def load_session(path: Path) -> IPythonSession:
    """Restore IPython session from pickle."""
```

### 6.2 Session Manager UI
- List saved sessions for project
- Show: name, size, # attached notebooks, last modified
- Actions: load, delete, rename

---

## Implementation Order

### Sprint 1: Foundation (MVP)
1. [ ] Create `environment.py` with MRMD home setup
2. [ ] Add `/api/mrmd/status` and `/api/mrmd/initialize` endpoints
3. [ ] Frontend: Check initialization on load
4. [ ] Frontend: Basic "not initialized" message with init button
5. [ ] Session indicator in status bar (shows current venv)

### Sprint 2: Project Support
1. [ ] "Open Project" in file browser
2. [ ] Project detection (use existing `/api/project/detect`)
3. [ ] Project indicator in header
4. [ ] Session auto-switches to project venv when project opened
5. [ ] Recent projects storage and display

### Sprint 3: Session Switching
1. [ ] Session indicator click -> change modal
2. [ ] Venv browser (reuse folder browser)
3. [ ] "Default" / "Project" / "Custom" venv options
4. [ ] Session reconfiguration on switch

### Sprint 4: Multi-File & Polish
1. [ ] Tab bar for open files
2. [ ] Tab management (open, close, switch)
3. [ ] Modified indicator per tab
4. [ ] Create Project wizard
5. [ ] Welcome notebook experience

### Sprint 5: Future
1. [ ] Session persistence (pickle)
2. [ ] Session manager panel
3. [ ] mrmd.dev restrictions (Projects-only for non-devs)

---

## API Summary

### New Endpoints
```
GET  /api/mrmd/status           - Check if MRMD initialized
POST /api/mrmd/initialize       - Set up ~/.mrmd
GET  /api/mrmd/config           - Get user config
POST /api/mrmd/config           - Update user config
GET  /api/mrmd/recent-projects  - List recent projects
POST /api/mrmd/recent-projects  - Add to recent projects

POST /api/project/create        - Create new project
POST /api/project/open          - Open project (returns info)
```

### Existing Endpoints (already implemented)
```
POST /api/project/detect        - Detect project from path
POST /api/environments/list     - List venvs in project
POST /api/session/configure     - Configure session venv/cwd
POST /api/ipython/execute       - Execute code
POST /api/ipython/variables     - Get session variables
```

---

## File Structure

```
~/.mrmd/
├── venv/                    # Default Python venv
│   ├── bin/python
│   └── ...
├── config.json              # User preferences
├── recent_projects.json     # Recent projects list
└── sessions/                # Future: saved sessions
    └── {project_hash}/
        └── {session_name}.pkl

~/Projects/                  # Default project location
└── my-project/
    ├── pyproject.toml
    ├── uv.lock
    ├── .venv/
    ├── README.md
    └── notebooks/
        └── analysis.md
```

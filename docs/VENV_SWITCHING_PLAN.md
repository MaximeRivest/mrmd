# Venv Switching Architecture Plan

## Overview

Enable users to switch the Python virtual environment used by their IPython session. Switching venvs terminates the current session subprocess and starts a new one with the selected Python executable.

---

## 1. Data Flow

```
User clicks venv badge
       │
       ▼
┌─────────────────────┐
│  Venv Picker Modal  │  ← Shows: current venv, project venv, recent venvs, browse option
└─────────────────────┘
       │
       ▼ (user selects new venv)
┌─────────────────────┐
│  Confirmation Modal │  ← "This will close your session. Save first?"
└─────────────────────┘
       │
       ▼ (user confirms)
┌─────────────────────┐
│ POST /api/ipython/  │
│ reconfigure         │  ← { session: "default", python_path: "/new/.venv/bin/python" }
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Server: close old   │
│ subprocess, start   │
│ new with new Python │
└─────────────────────┘
       │
       ▼
┌─────────────────────┐
│ Frontend: update    │
│ venv badge, refresh │
│ variables panel     │
└─────────────────────┘
```

---

## 2. Backend Changes

### 2.1 New Endpoint: `/api/ipython/reconfigure`

**File:** `src/mrmd/server/http.py`

```python
async def handle_ipython_reconfigure(request: web.Request) -> web.Response:
    """
    Reconfigure a session with a new Python executable and/or cwd.

    This closes the existing session subprocess and starts a new one.
    All session state (variables, history) is lost.

    Request:
        {
            "session": "default",
            "python_path": "/path/to/.venv/bin/python",  # optional
            "cwd": "/path/to/project"  # optional
        }

    Response:
        {
            "success": true,
            "session_id": "default",
            "python_path": "/path/to/.venv/bin/python",
            "python_version": "3.11.5",
            "cwd": "/path/to/project"
        }
    """
```

**Implementation notes:**
- Call `manager.reconfigure(session_id, python_path, cwd)` (already exists in `ipython_subprocess.py`)
- Validate that `python_path` exists and is executable
- Return the new session info after reconfiguration

### 2.2 New Endpoint: `/api/venv/search`

**File:** `src/mrmd/server/http.py`

```python
async def handle_venv_search(request: web.Request) -> web.Response:
    """
    Search for Python venvs in a directory tree.

    Request:
        {
            "root": "/home/user/Projects",
            "max_depth": 3
        }

    Response:
        {
            "venvs": [
                {
                    "name": ".venv",
                    "path": "/home/user/Projects/myproject/.venv",
                    "python_path": "/home/user/Projects/myproject/.venv/bin/python",
                    "version": "Python 3.11.5",
                    "type": "uv"  # or "venv"
                },
                ...
            ]
        }
    """
```

**Implementation notes:**
- Use `environment.list_venvs_in_tree()` (already exists)
- Cache results briefly (venv discovery is slow)

### 2.3 Route Registration

Add to `setup_http_routes()`:
```python
app.router.add_post("/api/ipython/reconfigure", handle_ipython_reconfigure)
app.router.add_post("/api/venv/search", handle_venv_search)
```

---

## 3. Frontend Changes

### 3.1 Venv Picker Modal

**File:** `frontend/core/session-ui.js`

Replace/enhance `showVenvBrowser()` with a proper modal:

```javascript
export async function showVenvPicker(options = {}) {
    const {
        currentPython,      // Current python_path for highlighting
        projectRoot,        // Project root for searching
        onSelect,           // Callback(pythonPath) when selected
        onCancel            // Callback when cancelled
    } = options;

    // Modal structure:
    // ┌─────────────────────────────────┐
    // │ Select Python Environment       │
    // ├─────────────────────────────────┤
    // │ [filter input]                  │
    // │                                 │
    // │ CURRENT                         │
    // │   ● .venv (3.11.5)    ✓        │
    // │     ~/Projects/myproj/.venv     │
    // │                                 │
    // │ PROJECT                         │
    // │   ○ .venv (3.12.0)             │
    // │     ~/Projects/other/.venv      │
    // │                                 │
    // │ SYSTEM                          │
    // │   ○ python3 (3.11.5)           │
    // │     /usr/bin/python3            │
    // │                                 │
    // ├─────────────────────────────────┤
    // │ [Browse...]          [Cancel]   │
    // └─────────────────────────────────┘
}
```

**Sections:**
1. **CURRENT** - The currently active venv (if any)
2. **PROJECT** - Venvs found in current project (if project open)
3. **RECENT** - Recently used venvs (stored in localStorage)
4. **FOUND** - Results from searching `projectRoot`

**Features:**
- Inline fuzzy filter (like file browser)
- Show Python version next to each venv
- "Browse..." button opens folder browser filtered for venvs
- Keyboard navigation (arrow keys, Enter to select)

### 3.2 Confirmation Modal

**File:** `frontend/core/session-ui.js`

```javascript
export function showVenvSwitchConfirmation(options = {}) {
    const {
        fromVenv,           // Current venv name
        toVenv,             // New venv name
        hasUnsavedState,    // Whether session has variables
        onConfirm,          // Callback to proceed
        onSaveFirst,        // Callback to save session first
        onCancel            // Callback to cancel
    } = options;

    // Modal structure:
    // ┌─────────────────────────────────┐
    // │ Switch Environment?             │
    // ├─────────────────────────────────┤
    // │ Switching from .venv to venv    │
    // │ will close your current session.│
    // │                                 │
    // │ You have 12 variables that will │
    // │ be lost.                        │
    // ├─────────────────────────────────┤
    // │ [Save First] [Switch] [Cancel]  │
    // └─────────────────────────────────┘
}
```

**Logic:**
- If `hasUnsavedState` is false, skip confirmation
- "Save First" triggers session pickle save, then switches
- "Switch" proceeds immediately (loses state)

### 3.3 Venv Badge Click Handler

**File:** `frontend/web/rich-editor-test.html`

Update the venv badge click handler:

```javascript
venvBadge.addEventListener('click', async () => {
    const project = SessionState.getCurrentProject();
    const sessionInfo = await getSessionInfo();

    showVenvPicker({
        currentPython: sessionInfo?.python_executable,
        projectRoot: project?.path || browserRoot,

        onSelect: async (pythonPath) => {
            // Check if session has state
            const hasState = SessionState.getHasUnsavedState();

            if (hasState) {
                showVenvSwitchConfirmation({
                    fromVenv: extractVenvName(sessionInfo?.python_executable),
                    toVenv: extractVenvName(pythonPath),
                    hasUnsavedState: true,

                    onConfirm: () => switchVenv(pythonPath),
                    onSaveFirst: async () => {
                        await SessionState.saveSession();
                        await switchVenv(pythonPath);
                    },
                    onCancel: () => {}
                });
            } else {
                await switchVenv(pythonPath);
            }
        }
    });
});

async function switchVenv(pythonPath) {
    const result = await fetch('/api/ipython/reconfigure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session: 'default',
            python_path: pythonPath
        })
    }).then(r => r.json());

    if (result.success) {
        await updateStatusBadges();
        await refreshVariables();
        // Show brief success notification
    } else {
        // Show error
    }
}
```

### 3.4 Recent Venvs Storage

**File:** `frontend/core/session-state.js`

```javascript
const RECENT_VENVS_KEY = 'mrmd_recent_venvs';
const MAX_RECENT_VENVS = 10;

export function getRecentVenvs() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_VENVS_KEY) || '[]');
    } catch {
        return [];
    }
}

export function addRecentVenv(pythonPath, venvName) {
    const recent = getRecentVenvs().filter(v => v.python_path !== pythonPath);
    recent.unshift({ python_path: pythonPath, name: venvName, used_at: Date.now() });
    localStorage.setItem(RECENT_VENVS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_VENVS)));
}
```

---

## 4. Session State Integration

### 4.1 Track Session Python in SessionState

**File:** `frontend/core/session-state.js`

Add tracking of the current session's Python:

```javascript
let currentSessionPython = null;

export async function refreshSessionInfo() {
    const resp = await fetch('/api/ipython/session_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: 'default' })
    });
    const info = await resp.json();
    if (info.exists) {
        currentSessionPython = info.python_executable;
    }
    return info;
}

export function getCurrentPython() {
    return currentSessionPython;
}
```

### 4.2 Project-Venv Association

When a project is opened, automatically switch to its venv:

```javascript
export async function openProject(path) {
    // ... existing project open logic ...

    // Auto-detect and switch to project's venv
    const venvPython = await detectProjectVenv(path);
    if (venvPython && venvPython !== currentSessionPython) {
        // Ask user if they want to switch
        // Or auto-switch with notification
    }
}

async function detectProjectVenv(projectPath) {
    const resp = await fetch('/api/venv/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: projectPath, max_depth: 1 })
    });
    const data = await resp.json();
    return data.venvs?.[0]?.python_path;
}
```

---

## 5. CSS Styles

**File:** `frontend/web/rich-editor-test.html` (or extract to CSS file)

Add styles for venv picker (match existing minimal style):

```css
/* Venv picker modal */
.venv-picker-section {
    padding: 6px 10px 2px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    opacity: 0.6;
}

.venv-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    margin: 2px 4px;
    cursor: pointer;
    border-radius: 4px;
}

.venv-item:hover {
    background: rgba(255, 255, 255, 0.04);
}

.venv-item.current {
    background: rgba(255, 255, 255, 0.06);
}

.venv-item-radio {
    width: 12px;
    height: 12px;
    border: 1px solid var(--muted);
    border-radius: 50%;
    margin-right: 10px;
}

.venv-item.current .venv-item-radio {
    border-color: var(--accent);
    background: var(--accent);
}

.venv-item-info {
    flex: 1;
    min-width: 0;
}

.venv-item-name {
    font-size: 12px;
    color: var(--text);
}

.venv-item-path {
    font-size: 10px;
    color: var(--muted);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.venv-item-version {
    font-size: 10px;
    color: var(--muted);
    margin-left: 8px;
}
```

---

## 6. Error Handling

### 6.1 Invalid Python Path

If user browses to an invalid Python:
- Validate before attempting reconfigure
- Show error: "Not a valid Python executable"

### 6.2 Python Missing Dependencies

If new Python doesn't have IPython:
- Server returns error from subprocess startup
- Show error: "IPython not installed in this environment"
- Offer to install: `uv pip install ipython`

### 6.3 Subprocess Crash

If worker subprocess crashes during switch:
- Catch error in reconfigure
- Return meaningful error to frontend
- Allow retry

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `src/mrmd/server/http.py` | Add `handle_ipython_reconfigure`, `handle_venv_search`, routes |
| `frontend/core/session-ui.js` | Rewrite `showVenvBrowser` as `showVenvPicker`, add `showVenvSwitchConfirmation` |
| `frontend/core/session-state.js` | Add `refreshSessionInfo`, `getCurrentPython`, `getRecentVenvs`, `addRecentVenv` |
| `frontend/web/rich-editor-test.html` | Update venv badge click handler, add CSS |

---

## 8. Testing Checklist

- [ ] Click venv badge opens picker modal
- [ ] Current venv is highlighted in picker
- [ ] Filter input filters venv list
- [ ] Selecting venv with no session state switches immediately
- [ ] Selecting venv with session state shows confirmation
- [ ] "Save First" saves session then switches
- [ ] "Switch" switches without saving
- [ ] Venv badge updates after switch
- [ ] Variables panel clears after switch
- [ ] Recent venvs appear in picker
- [ ] Browse button opens folder browser
- [ ] Invalid Python path shows error
- [ ] Opening project auto-detects its venv

---

## 9. Future Enhancements (Out of Scope)

- Per-notebook venv override (notebook uses different venv than project)
- Venv creation from picker ("Create new venv...")
- Package installation UI (`%pip install` alternative)
- Venv health check (show if broken/missing packages)

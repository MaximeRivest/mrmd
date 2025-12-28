# File Integrity & UX Architecture Plan

## Executive Summary

This plan addresses four interconnected issues to achieve ideal UX for file handling:

1. **Dual state stores** causing UI inconsistencies
2. **Lost undo history** when switching tabs
3. **Dropped execution output** when switching tabs during code execution
4. **No user feedback** about execution state during tab operations

---

## Phase 1: Unified State Management

### Problem
Two parallel state stores exist:
- `AppState._openFiles` (TypeScript, src/apps/shared/AppState.ts)
- `SessionState.openFiles` (JavaScript, frontend/core/session-state.js)

Legacy components (file-tabs.js, compact-mode.js, compact-status.js) read from SessionState.
New codes app writes to AppState. They can diverge.

### Solution
Synchronize AppState → SessionState on every file operation.

### Implementation

**1.1 Create sync helper in codes/index.ts:**
```typescript
function syncToSessionState(action: 'open' | 'close' | 'update', path: string, content?: string, modified?: boolean) {
    switch (action) {
        case 'open':
            SessionState.addOpenFile(path, content ?? '', modified ?? false);
            break;
        case 'close':
            SessionState.removeOpenFile(path);
            break;
        case 'update':
            SessionState.updateFileContent(path, content ?? '', modified ?? false);
            break;
    }
}
```

**1.2 Call sync after every AppState operation:**
- After `appState.openFile()` → `syncToSessionState('open', ...)`
- After `appState.closeFile()` → `syncToSessionState('close', ...)`
- After `appState.updateFileContent()` → `syncToSessionState('update', ...)`

### Files to Modify
- `frontend/src/apps/codes/index.ts`

### Verification
- Open file → visible in both file-tabs UI and internal state
- Modified indicator consistent across compact-status and editor
- Close file → removed from both states

---

## Phase 2: Per-File Editor State (Undo History)

### Problem
CodeMirror's undo/redo history lives in EditorState. When switching tabs, we call `setDoc()` which creates a new document, losing history.

### Solution
Store the full EditorState per file. On tab switch, save/restore entire state instead of just content.

### Implementation

**2.1 Extend FileState interface:**
```typescript
interface FileState {
    path: string;
    content: string;
    modified: boolean;
    mtime: number | null;
    scrollTop: number;
    editorState: EditorState | null;  // NEW: Full CodeMirror state
}
```

**2.2 Add AppState methods:**
```typescript
updateFileEditorState(path: string, state: EditorState): void {
    const file = this._openFiles.get(path);
    if (file) {
        file.editorState = state;
        file.content = state.doc.toString();
    }
}

getFileEditorState(path: string): EditorState | null {
    return this._openFiles.get(path)?.editorState ?? null;
}
```

**2.3 Modify handleTabSelect:**
```typescript
async function handleTabSelect(path: string): Promise<void> {
    const currentPath = appState.currentFilePath;

    // Save FULL editor state (not just content)
    if (currentPath && currentPath !== path) {
        appState.updateFileEditorState(currentPath, editor.view.state);
        appState.updateFileScrollTop(currentPath, container.scrollTop);
    }

    const file = appState.openFiles.get(path);
    if (file) {
        // Restore full state if available
        if (file.editorState) {
            editor.view.setState(file.editorState);
        } else {
            // First time opening - create fresh state
            setContent(file.content, true);
        }
        // ... rest of tab select logic
    }
}
```

**2.4 Modify setContent for fresh files:**
```typescript
function setContent(markdown: string, silent = false): void {
    silentUpdate = silent;
    try {
        // Replace entire state to get fresh history
        const newState = EditorState.create({
            doc: markdown,
            extensions: editor.view.state.facet(EditorState.facet), // preserve extensions
        });
        editor.view.setState(newState);
    } finally {
        silentUpdate = false;
    }
}
```

### Files to Modify
- `frontend/src/apps/shared/AppState.ts`
- `frontend/src/apps/shared/types.ts`
- `frontend/src/apps/codes/index.ts`

### Verification
- Edit file A, make changes, undo works
- Switch to file B, make changes
- Switch back to file A, undo still works for file A's changes
- Redo also works per-file

---

## Phase 3: Per-File Execution Context

### Problem
ExecutionTracker directly updates EditorView. When user switches tabs:
1. EditorView shows different file
2. ExecId marker not found in new content
3. Output updates silently dropped
4. User returns to partial/stale output

### Solution
ExecutionTracker updates AppState content, not just EditorView. If file is displayed, also sync to view.

### Implementation

**3.1 Extend ExecutionTracker constructor:**
```typescript
class ExecutionTracker {
    private view: EditorView;
    private executor: Executor;
    private appState: AppStateType;           // NEW
    private getFilePath: () => string | null; // NEW

    constructor(
        view: EditorView,
        executor: Executor,
        appState: AppStateType,
        getFilePath: () => string | null
    ) {
        this.view = view;
        this.executor = executor;
        this.appState = appState;
        this.getFilePath = getFilePath;
    }
}
```

**3.2 Track file path per execution:**
```typescript
private running = new Map<string, {
    controller: AbortController;
    filePath: string;  // NEW: Which file this execution belongs to
}>();

async runBlock(code: string, language: string, codeBlockEnd: number, options?: CellOptions): Promise<string> {
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const filePath = this.getFilePath();  // Capture at execution start

    const controller = new AbortController();
    this.running.set(execId, { controller, filePath });
    // ...
}
```

**3.3 New method to update content (AppState or View):**
```typescript
private updateOutput(execId: string, newContent: string, replace = false): void {
    const execution = this.running.get(execId);
    if (!execution) return;

    const { filePath } = execution;
    const currentPath = this.getFilePath();

    // Get the content to update (from AppState if not current, from view if current)
    let content: string;
    let updateView = false;

    if (filePath === currentPath) {
        // File is displayed - update view directly
        content = this.view.state.doc.toString();
        updateView = true;
    } else {
        // File is in background - update AppState
        const file = this.appState.openFiles.get(filePath);
        if (!file) return;
        content = file.content;
    }

    // Find and update output block in content string
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = content.indexOf(marker);
    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = content.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);
    if (!closingMatch) return;

    const existingContent = closingMatch[1];
    const finalContent = replace ? newContent : existingContent + newContent;
    const newFullContent =
        content.slice(0, outputStart) +
        finalContent +
        content.slice(outputStart + existingContent.length);

    if (updateView) {
        // Dispatch to view
        this.view.dispatch({
            changes: {
                from: outputStart,
                to: outputStart + existingContent.length,
                insert: finalContent,
            },
        });
    } else {
        // Update AppState (view will load this content on tab switch)
        this.appState.updateFileContent(filePath, newFullContent, true);
    }
}
```

**3.4 Replace direct view updates:**
```typescript
// Before:
private replaceOutputContent(execId: string, content: string): void {
    // ... directly updates this.view
}

// After:
private replaceOutputContent(execId: string, content: string): void {
    this.updateOutput(execId, content, true);
}

private appendToOutput(execId: string, text: string): void {
    this.updateOutput(execId, text, false);
}
```

**3.5 Update ExecutionTracker instantiation in codes/index.ts:**
```typescript
const tracker = new ExecutionTracker(
    editor.view,
    ipythonExecutor,
    appState,
    () => appState.currentFilePath
);
```

### Files to Modify
- `editor/src/execution/tracker.ts`
- `frontend/src/apps/codes/index.ts`
- Possibly create new interface for AppState access

### Verification
- Run code on file A
- Switch to file B while running
- Switch back to file A
- Output is complete and correct

---

## Phase 4: Execution UX Indicators

### Problem
No visual feedback about execution state when switching tabs.

### Solution
1. Show running indicator on file tabs
2. Optional: toast notification when execution completes in background

### Implementation

**4.1 Track running executions per file:**
```typescript
// In ExecutionTracker
getRunningFiles(): Set<string> {
    const files = new Set<string>();
    for (const { filePath } of this.running.values()) {
        if (filePath) files.add(filePath);
    }
    return files;
}
```

**4.2 Update file tabs UI:**
```typescript
// In file-tabs.js or wherever tabs are rendered
function renderTab(path, fileState, isActive) {
    const isRunning = executionTracker.getRunningFiles().has(path);

    const tab = document.createElement('div');
    tab.className = `tab ${isActive ? 'active' : ''} ${isRunning ? 'running' : ''}`;

    if (isRunning) {
        const spinner = document.createElement('span');
        spinner.className = 'tab-spinner';
        tab.appendChild(spinner);
    }
    // ...
}
```

**4.3 CSS for running indicator:**
```css
.tab.running::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-color);
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
```

**4.4 Optional: Background completion notification:**
```typescript
// In ExecutionTracker, when execution completes for non-current file
if (filePath !== currentPath) {
    showNotification('Execution Complete', `Code finished running in ${filename}`, 'info');
}
```

### Files to Modify
- `editor/src/execution/tracker.ts`
- `frontend/core/file-tabs.js` or equivalent
- `frontend/styles/main.css`

### Verification
- Run code, see spinner on tab
- Switch tabs, spinner still visible on original tab
- Execution completes, spinner disappears
- Optional: notification appears

---

## Implementation Order

```
Phase 1 (Foundation)     ──────────────────────────────►
         │
         │ Enables consistent UI across components
         ▼
Phase 2 (Undo History)   ──────────────────────────────►
         │
         │ Improves core editing experience
         ▼
Phase 3 (Execution)      ──────────────────────────────►
         │
         │ Most complex, depends on Phase 1 for AppState access
         ▼
Phase 4 (UX Polish)      ──────────────────────────────►

         Final polish, depends on Phase 3 for execution tracking
```

---

## Testing Checklist

### Phase 1
- [ ] Open file shows in all UI components
- [ ] Close file removes from all UI components
- [ ] Modified indicator consistent everywhere

### Phase 2
- [ ] Undo works after tab switch
- [ ] Redo works after tab switch
- [ ] Multiple files maintain separate histories
- [ ] Cursor position preserved on tab switch

### Phase 3
- [ ] Execution completes when tab switched away
- [ ] Output visible when returning to file
- [ ] Multiple concurrent executions on different files work
- [ ] Execution on current file still works normally

### Phase 4
- [ ] Running indicator visible on tab
- [ ] Indicator disappears when complete
- [ ] (Optional) Notification on background completion

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| EditorState serialization issues | Keep in memory only, accept loss on refresh |
| Performance with large files | Lazy sync, debounce AppState updates |
| Race conditions in execution | Use execution ID as source of truth |
| Breaking existing functionality | Incremental rollout, extensive testing |

---

## Estimated Effort

| Phase | Complexity | Time |
|-------|------------|------|
| Phase 1 | Low | 1-2 hours |
| Phase 2 | Medium | 2-3 hours |
| Phase 3 | High | 3-4 hours |
| Phase 4 | Low | 1 hour |
| **Total** | | **7-10 hours** |

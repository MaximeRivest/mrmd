# Stabilization Plan

> Prioritized roadmap to debug and solidify the new service architecture.

After the big refactor (deleting ~6000 lines, introducing clean service layer), we need to systematically verify and harden each component.

---

## Phase 1: Core Editor Loop

**Priority: CRITICAL - blocks everything else**

| Component | What to Test | Status |
|-----------|-------------|--------|
| Editor Mount | `createEditor()` renders without errors | [ ] |
| Content Set/Get | `setDoc()` / `getDoc()` work with silent flag | [ ] |
| Code Execution | Ctrl+Enter runs Python, output appears | [ ] |
| Cursor/Selection | Cursor position updates, selection works | [ ] |

**Test procedure:**
1. Open http://localhost:51789
2. Check console for errors on load
3. Type markdown text
4. Add a Python code block: ` ```python\nprint("hello")\n``` `
5. Press Ctrl+Enter to execute
6. Verify output appears below block

**Key files:**
- `frontend/src/apps/codes/index.ts` - `initEditor()`
- `editor/src/core/editor.ts` - `createEditor()`
- `editor/src/execution/ipython.ts` - `IPythonExecutor`

---

## Phase 2: File Operations

**Priority: HIGH - data integrity**

| Component | What to Test | Status |
|-----------|-------------|--------|
| Open File | `DocumentService.openFile()` loads content | [ ] |
| Save File | `DocumentService.saveFile()` persists | [ ] |
| Autosave | 2-second debounce triggers save | [ ] |
| Modified State | `*` indicator appears on change, clears on save | [ ] |

**Test procedure:**
1. Open a file via file browser or `?file=/path/to/file.md`
2. Edit content
3. Check `*` appears in title/tab
4. Wait 2 seconds for autosave
5. Check status bar shows "autosaved"
6. Refresh page - content should persist
7. Manual save with Ctrl+S

**Key files:**
- `frontend/src/apps/codes/index.ts` - `openFile()`, `saveFile()`, `scheduleAutosave()`
- `frontend/src/services/DocumentService.ts`

---

## Phase 3: Multi-File State

**Priority: HIGH - workflow**

| Component | What to Test | Status |
|-----------|-------------|--------|
| File Tabs | Add/remove/switch tabs | [ ] |
| Tab State | Scroll position, content preserved per tab | [ ] |
| AppState Sync | `appState.openFiles` matches UI | [ ] |
| Close Tab | Auto-save before close, switch to next | [ ] |

**Test procedure:**
1. Open 3 different files
2. Edit each file differently
3. Switch between tabs - content should be correct
4. Scroll down in one file, switch away, switch back - scroll preserved
5. Close a tab - should auto-save and switch to another

**Key files:**
- `frontend/src/apps/codes/index.ts` - `handleTabSelect()`, `handleTabClose()`
- `frontend/src/apps/shared/AppState.ts`
- `frontend/core/file-tabs.js`

---

## Phase 4: Collaboration & External Changes

**Priority: MEDIUM - multi-user/external edits**

| Component | What to Test | Status |
|-----------|-------------|--------|
| WebSocket Connect | `CollaborationService` connects on project open | [ ] |
| File Watch | External edit detected, content merged | [ ] |
| Polling Fallback | Works when WebSocket fails (use `?noCollab`) | [ ] |
| Cursor Preservation | Cursor stays in place after external merge | [ ] |

**Test procedure:**
1. Open a project
2. Check console for "[Collab] Connected"
3. Edit the open file in another editor (VS Code, vim)
4. App should detect change and update content
5. Cursor should stay approximately in place

**Key files:**
- `frontend/src/apps/codes/index.ts` - `initCollaboration()`, `handleExternalFileChange()`
- `frontend/src/services/CollaborationService.ts`

---

## Phase 5: UI Modules Integration

**Priority: MEDIUM - user experience**

| Component | What to Test | Status |
|-----------|-------------|--------|
| File Browser | Navigate, select file opens it | [ ] |
| Session State | Project opens, IPython session switches | [ ] |
| Notifications | Errors show as toasts | [ ] |
| AI Palette | Selection shows AI menu | [ ] |
| History Panel | Versions load | [ ] |
| Terminal Tabs | Terminal opens and works | [ ] |
| Sidebar Resize | Drag resizer works | [ ] |

**Test procedure:**
1. Click through sidebar tabs (Files, Variables, Processes, etc.)
2. Navigate file browser, open a file
3. Open a project from Projects panel
4. Select text, check AI palette appears
5. Open History panel, check versions load

**Key files:**
- `frontend/core/file-browser.js`
- `frontend/core/ai-palette.js`
- `frontend/core/history-panel.js`
- `frontend/core/terminal-tabs.js`

---

## Phase 6: Study Mode

**Priority: LOW - secondary entry point**

| Component | What to Test | Status |
|-----------|-------------|--------|
| Chrome Hidden | Sidebar, tabs hidden on `?mode=study` | [ ] |
| Minimal UI | Only editor + quiet header | [ ] |
| Same Core | Edit/save/execute still work | [ ] |

**Test procedure:**
1. Open http://localhost:51789?mode=study
2. Verify sidebar is hidden
3. Verify file tabs are hidden
4. Edit content, save, execute - should all work
5. Header should fade in on hover

**Key files:**
- `frontend/src/apps/study/index.ts`

---

## Debugging Checklist

When debugging issues:

1. **Check console first** - Most errors will appear there
2. **Verify boot sequence:**
   ```
   [Boot] Starting Atelier in Codes mode...
   [Boot] Services initialized
   [Codes] Mounting Developer Mode...
   [Codes] Developer Mode ready
   ```
3. **Check network tab** - API calls should return 200
4. **Use `?noCollab`** - Isolates collaboration issues
5. **Check AppState** - `window.appState` if exposed for debugging

---

## Success Criteria

Each phase is complete when:

- [ ] All checkboxes in the phase are checked
- [ ] No console errors during normal use
- [ ] No data loss scenarios identified
- [ ] Performance is acceptable (no lag on typing)

---

## Notes

- The 43 JS modules in `core/` are legacy UI components - they work, but could be migrated to TypeScript later
- The services layer (`DocumentService`, `ExecutionService`, `CollaborationService`) is the new clean API
- `AppState` replaces scattered module-level variables from the old `app.ts`

/* Atelier boot - clean service architecture */

var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// src/apps/shared/AppState.ts
var AppState, appState;
var init_AppState = __esm({
  "src/apps/shared/AppState.ts"() {
    "use strict";
    AppState = class {
      constructor() {
        // Current file
        __publicField(this, "_currentFilePath", null);
        // Open files (for tabs)
        __publicField(this, "_openFiles", /* @__PURE__ */ new Map());
        // Per-file EditorState (for undo history preservation)
        // Stored separately because EditorState is not serializable
        // Type is 'unknown' to avoid coupling to CodeMirror types
        __publicField(this, "_editorStates", /* @__PURE__ */ new Map());
        // Session state
        __publicField(this, "_session", {
          id: "main",
          pythonPath: null,
          pythonVersion: null,
          cwd: null,
          isRunning: false
        });
        // Project state
        __publicField(this, "_project", null);
        // UI state
        __publicField(this, "_ui", {
          sidebarVisible: true,
          activePanel: "variables",
          theme: "default"
        });
        // Listeners
        __publicField(this, "_listeners", /* @__PURE__ */ new Set());
        __publicField(this, "_fileListeners", /* @__PURE__ */ new Set());
        __publicField(this, "_sessionListeners", /* @__PURE__ */ new Set());
      }
      // ========================================================================
      // Getters
      // ========================================================================
      get currentFilePath() {
        return this._currentFilePath;
      }
      get currentFile() {
        return this._currentFilePath ? this._openFiles.get(this._currentFilePath) ?? null : null;
      }
      get isModified() {
        return this.currentFile?.modified ?? false;
      }
      get openFiles() {
        return new Map(this._openFiles);
      }
      get openFilePaths() {
        return Array.from(this._openFiles.keys());
      }
      get session() {
        return { ...this._session };
      }
      get project() {
        return this._project ? { ...this._project } : null;
      }
      get ui() {
        return { ...this._ui };
      }
      getSnapshot() {
        return {
          currentFilePath: this._currentFilePath,
          currentFileModified: this.isModified,
          openFiles: new Map(this._openFiles),
          session: { ...this._session },
          project: this._project ? { ...this._project } : null,
          ui: { ...this._ui }
        };
      }
      // ========================================================================
      // File Operations
      // ========================================================================
      openFile(path, content, options) {
        const file = {
          path,
          content,
          modified: false,
          mtime: null,
          scrollTop: 0,
          undoStack: [],
          redoStack: [],
          // Track last saved content for conflict detection
          lastSavedContent: content,
          pendingExternalChange: null,
          ...options
        };
        this._openFiles.set(path, file);
        this._notifyFileChange(file, path);
        return file;
      }
      closeFile(path) {
        if (!this._openFiles.has(path))
          return null;
        this._openFiles.delete(path);
        this._editorStates.delete(path);
        if (this._currentFilePath === path) {
          const remaining = Array.from(this._openFiles.keys());
          this._currentFilePath = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          this._notifyFileChange(this.currentFile, this._currentFilePath);
        }
        return this._currentFilePath;
      }
      setCurrentFile(path) {
        if (!this._openFiles.has(path))
          return null;
        this._currentFilePath = path;
        const file = this._openFiles.get(path);
        this._notifyFileChange(file, path);
        return file;
      }
      updateFileContent(path, content, modified = true) {
        const file = this._openFiles.get(path);
        if (file) {
          file.content = content;
          file.modified = modified;
          this._notifyFileChange(file, path);
        }
      }
      markFileSaved(path, mtime) {
        const file = this._openFiles.get(path);
        if (file) {
          file.modified = false;
          file.lastSavedContent = file.content;
          file.pendingExternalChange = null;
          if (mtime !== void 0) {
            file.mtime = mtime;
          }
          this._notifyFileChange(file, path);
        }
      }
      markFileModified(path) {
        const file = this._openFiles.get(path);
        if (file && !file.modified) {
          file.modified = true;
          this._notifyFileChange(file, path);
        }
      }
      updateFileMtime(path, mtime) {
        const file = this._openFiles.get(path);
        if (file) {
          file.mtime = mtime;
        }
      }
      updateFileScrollTop(path, scrollTop) {
        const file = this._openFiles.get(path);
        if (file) {
          file.scrollTop = scrollTop;
        }
      }
      updateFileUndoStacks(path, undoStack, redoStack) {
        const file = this._openFiles.get(path);
        if (file) {
          file.undoStack = undoStack;
          file.redoStack = redoStack;
        }
      }
      getFileUndoStacks(path) {
        const file = this._openFiles.get(path);
        return {
          undoStack: file?.undoStack ?? [],
          redoStack: file?.redoStack ?? []
        };
      }
      renameFile(oldPath, newPath) {
        const file = this._openFiles.get(oldPath);
        if (file) {
          file.path = newPath;
          this._openFiles.delete(oldPath);
          this._openFiles.set(newPath, file);
          const editorState = this._editorStates.get(oldPath);
          if (editorState) {
            this._editorStates.delete(oldPath);
            this._editorStates.set(newPath, editorState);
          }
          if (this._currentFilePath === oldPath) {
            this._currentFilePath = newPath;
          }
          this._notifyFileChange(file, newPath);
        }
      }
      // ========================================================================
      // External Change Tracking
      // ========================================================================
      /**
       * Record a pending external change for a file.
       * This is used when an external change is detected but may need conflict resolution.
       */
      setPendingExternalChange(path, change) {
        const file = this._openFiles.get(path);
        if (file) {
          file.pendingExternalChange = change;
          this._notifyFileChange(file, path);
        }
      }
      /**
       * Get pending external change for a file (if any)
       */
      getPendingExternalChange(path) {
        const file = this._openFiles.get(path);
        return file?.pendingExternalChange ?? null;
      }
      /**
       * Check if a file has local changes that would conflict with external changes.
       * Compares current content with lastSavedContent.
       */
      hasLocalChanges(path) {
        const file = this._openFiles.get(path);
        if (!file)
          return false;
        if (file.modified)
          return true;
        if (file.lastSavedContent !== void 0 && file.content !== file.lastSavedContent) {
          return true;
        }
        return false;
      }
      /**
       * Apply an external change to a file's stored content.
       * Called after the editor has been updated.
       */
      applyExternalChange(path, newContent, newMtime) {
        const file = this._openFiles.get(path);
        if (file) {
          file.content = newContent;
          file.lastSavedContent = newContent;
          file.mtime = newMtime;
          file.modified = false;
          file.pendingExternalChange = null;
          this._notifyFileChange(file, path);
        }
      }
      // ========================================================================
      // Editor State Operations (for undo history preservation)
      // ========================================================================
      /**
       * Save the full EditorState for a file (preserves undo history, selection, etc.)
       * Called when switching away from a file.
       */
      saveEditorState(path, editorState) {
        this._editorStates.set(path, editorState);
        const file = this._openFiles.get(path);
        if (file && editorState && typeof editorState === "object" && "doc" in editorState) {
          const doc = editorState.doc;
          if (doc && typeof doc.toString === "function") {
            file.content = doc.toString();
          }
        }
      }
      /**
       * Get the saved EditorState for a file.
       * Returns null if no state was saved (first time opening file).
       */
      getEditorState(path) {
        return this._editorStates.get(path) ?? null;
      }
      /**
       * Clear the saved EditorState for a file (called when file is closed).
       */
      clearEditorState(path) {
        this._editorStates.delete(path);
      }
      // ========================================================================
      // Session Operations
      // ========================================================================
      setSession(session) {
        this._session = { ...this._session, ...session };
        this._notifySessionChange();
      }
      setSessionId(id) {
        this._session.id = id;
        this._notifySessionChange();
      }
      setSessionRunning(isRunning) {
        this._session.isRunning = isRunning;
        this._notifySessionChange();
      }
      // ========================================================================
      // Project Operations
      // ========================================================================
      setProject(project) {
        this._project = project;
        this._notify();
      }
      updateProjectEnvironments(environments) {
        if (this._project) {
          this._project.environments = environments;
          this._notify();
        }
      }
      // ========================================================================
      // UI Operations
      // ========================================================================
      setUIState(ui) {
        this._ui = { ...this._ui, ...ui };
        this._notify();
      }
      setSidebarVisible(visible) {
        this._ui.sidebarVisible = visible;
        this._notify();
      }
      setActivePanel(panel) {
        this._ui.activePanel = panel;
        this._notify();
      }
      setTheme(theme) {
        this._ui.theme = theme;
        this._notify();
      }
      // ========================================================================
      // Subscriptions
      // ========================================================================
      subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
      }
      onFileChange(listener) {
        this._fileListeners.add(listener);
        return () => this._fileListeners.delete(listener);
      }
      onSessionChange(listener) {
        this._sessionListeners.add(listener);
        return () => this._sessionListeners.delete(listener);
      }
      // ========================================================================
      // Private
      // ========================================================================
      _notify() {
        const snapshot = this.getSnapshot();
        this._listeners.forEach((listener) => listener(snapshot));
      }
      _notifyFileChange(file, path) {
        this._fileListeners.forEach((listener) => listener(file, path));
        this._notify();
      }
      _notifySessionChange() {
        this._sessionListeners.forEach((listener) => listener(this._session));
        this._notify();
      }
    };
    appState = new AppState();
  }
});

// src/apps/shared/imageUrl.ts
function createImageUrlResolver(getBasePath) {
  return (url) => {
    if (!url || url.startsWith("data:") || url.startsWith("/api/") || url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    if (url.startsWith("/")) {
      return `/api/file/asset${url}`;
    }
    const basePath = getBasePath();
    if (basePath) {
      return `/api/file/relative?path=${encodeURIComponent(url)}&base=${encodeURIComponent(basePath)}`;
    }
    console.warn("[imageUrl] No base path for relative URL:", url);
    return `/api/file/asset/${url}`;
  };
}
var init_imageUrl = __esm({
  "src/apps/shared/imageUrl.ts"() {
    "use strict";
  }
});

// src/apps/codes/InterfaceManager.ts
import * as SessionState from "/core/session-state.js";
import { initCompactMode, destroyCompactMode } from "/core/compact-mode.js";
async function createInterfaceManager(options) {
  const manager = new InterfaceManager(options);
  await manager.initialize();
  return manager;
}
var InterfaceManager;
var init_InterfaceManager = __esm({
  "src/apps/codes/InterfaceManager.ts"() {
    "use strict";
    InterfaceManager = class {
      constructor(options) {
        __publicField(this, "options");
        __publicField(this, "initialized", false);
        __publicField(this, "currentMode");
        __publicField(this, "listeners", /* @__PURE__ */ new Set());
        __publicField(this, "cleanupFns", []);
        this.options = options;
        this.currentMode = SessionState.getInterfaceMode();
      }
      // ========================================================================
      // Public API
      // ========================================================================
      /**
       * Initialize the interface manager.
       * Creates all UI elements for both modes and applies the current mode.
       *
       * Note: CSS class application is handled by mode-controller.js (called by
       * compact-mode.js). InterfaceManager focuses on lifecycle coordination.
       */
      async initialize() {
        if (this.initialized) {
          console.warn("[InterfaceManager] Already initialized");
          return;
        }
        console.log(`[InterfaceManager] Initializing with mode: ${this.currentMode}`);
        this.initCompactUI();
        const unsubscribe = SessionState.on("interface-mode-changed", (event) => {
          this.handleModeChange(event.mode);
        });
        this.cleanupFns.push(unsubscribe);
        this.initialized = true;
        console.log("[InterfaceManager] Initialized");
      }
      /**
       * Get the current interface mode.
       */
      getMode() {
        return this.currentMode;
      }
      /**
       * Check if currently in compact mode.
       */
      isCompact() {
        return this.currentMode === "compact";
      }
      /**
       * Check if currently in developer mode.
       */
      isDeveloper() {
        return this.currentMode === "developer";
      }
      /**
       * Set the interface mode.
       * This triggers a mode transition with proper lifecycle.
       */
      setMode(mode) {
        if (mode === this.currentMode) {
          return;
        }
        SessionState.setInterfaceMode(mode);
      }
      /**
       * Toggle between compact and developer modes.
       */
      toggle() {
        this.setMode(this.currentMode === "compact" ? "developer" : "compact");
      }
      /**
       * Get the full interface mode state.
       */
      getState() {
        return {
          mode: this.currentMode,
          toolRailSide: SessionState.getToolRailSide(),
          toolRailOpen: SessionState.getToolRailOpen(),
          statusBarExpanded: SessionState.getStatusBarExpanded()
        };
      }
      /**
       * Subscribe to mode changes.
       * @returns Unsubscribe function
       */
      onModeChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
      /**
       * Destroy the interface manager and clean up resources.
       */
      destroy() {
        this.cleanupFns.forEach((fn) => fn());
        this.cleanupFns = [];
        destroyCompactMode();
        this.listeners.clear();
        this.initialized = false;
        console.log("[InterfaceManager] Destroyed");
      }
      // ========================================================================
      // Private Methods
      // ========================================================================
      /**
       * Initialize the compact mode UI elements.
       */
      initCompactUI() {
        const { container: container2, editorPane, editor: editor2, getEditor, fileBrowser: fileBrowser2, createTerminal } = this.options;
        initCompactMode({
          container: container2,
          editorPane,
          editor: editor2,
          getEditor: getEditor || (() => editor2),
          fileBrowser: fileBrowser2,
          createTerminal
        });
      }
      /**
       * Handle a mode change event.
       * Note: CSS classes are applied by mode-controller.js, not here.
       */
      handleModeChange(newMode) {
        if (newMode === this.currentMode) {
          return;
        }
        const previousMode = this.currentMode;
        console.log(`[InterfaceManager] Mode change: ${previousMode} \u2192 ${newMode}`);
        this.onModeExit(previousMode);
        this.currentMode = newMode;
        this.onModeEnter(newMode);
        const event = { previousMode, newMode };
        this.listeners.forEach((listener) => listener(event));
      }
      /**
       * Lifecycle hook: called when exiting a mode.
       */
      onModeExit(mode) {
        if (mode === "compact") {
        } else {
        }
      }
      /**
       * Lifecycle hook: called when entering a mode.
       */
      onModeEnter(mode) {
        if (mode === "compact") {
        } else {
        }
      }
    };
  }
});

// src/services/synonym-picker.ts
function showSynonymPicker(options) {
  const { view, synonyms, original, replaceFrom, replaceTo, position, onSelect, onDismiss } = options;
  if (!synonyms || synonyms.length === 0) {
    onDismiss?.();
    return () => {
    };
  }
  const picker = document.createElement("div");
  picker.className = "synonym-picker";
  picker.setAttribute("role", "listbox");
  picker.setAttribute("aria-label", `Synonyms for "${original}"`);
  Object.assign(picker.style, {
    position: "fixed",
    zIndex: "10000",
    backgroundColor: "var(--surface, #1e1e1e)",
    border: "1px solid var(--border, #333)",
    borderRadius: "8px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    padding: "4px",
    maxHeight: "300px",
    overflowY: "auto",
    minWidth: "150px",
    maxWidth: "300px"
  });
  const header = document.createElement("div");
  header.className = "synonym-picker-header";
  header.textContent = `Synonyms for "${original}"`;
  Object.assign(header.style, {
    padding: "8px 12px",
    fontSize: "0.8em",
    color: "var(--text-muted, #888)",
    borderBottom: "1px solid var(--border, #333)",
    marginBottom: "4px"
  });
  picker.appendChild(header);
  let selectedIndex = 0;
  const items = [];
  synonyms.forEach((synonym, index) => {
    const item = document.createElement("div");
    item.className = "synonym-picker-item";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", index === 0 ? "true" : "false");
    item.textContent = synonym;
    Object.assign(item.style, {
      padding: "8px 12px",
      cursor: "pointer",
      borderRadius: "4px",
      transition: "background-color 0.1s"
    });
    if (index === 0) {
      item.style.backgroundColor = "var(--hover, #2a2a2a)";
    }
    item.addEventListener("mouseenter", () => {
      updateSelection(index);
    });
    item.addEventListener("click", () => {
      selectSynonym(synonym);
    });
    picker.appendChild(item);
    items.push(item);
  });
  function updateSelection(index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.style.backgroundColor = "var(--hover, #2a2a2a)";
        item.setAttribute("aria-selected", "true");
      } else {
        item.style.backgroundColor = "";
        item.setAttribute("aria-selected", "false");
      }
    });
    selectedIndex = index;
  }
  function selectSynonym(synonym) {
    view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: synonym },
      selection: { anchor: replaceFrom + synonym.length }
    });
    onSelect?.(synonym);
    dismiss();
  }
  function dismiss() {
    picker.remove();
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("mousedown", handleClickOutside);
    onDismiss?.();
  }
  function handleKeydown(e) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        updateSelection((selectedIndex + 1) % items.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        updateSelection((selectedIndex - 1 + items.length) % items.length);
        break;
      case "Enter":
        e.preventDefault();
        selectSynonym(synonyms[selectedIndex]);
        break;
      case "Escape":
        e.preventDefault();
        dismiss();
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          updateSelection((selectedIndex - 1 + items.length) % items.length);
        } else {
          updateSelection((selectedIndex + 1) % items.length);
        }
        break;
    }
  }
  function handleClickOutside(e) {
    if (!picker.contains(e.target)) {
      dismiss();
    }
  }
  let x = position?.x ?? 100;
  let y = position?.y ?? 100;
  if (!position) {
    const coords = view.coordsAtPos(replaceFrom);
    if (coords) {
      x = coords.left;
      y = coords.bottom + 4;
    }
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  picker.style.left = `${Math.min(x, viewportWidth - 320)}px`;
  picker.style.top = `${Math.min(y, viewportHeight - 320)}px`;
  document.body.appendChild(picker);
  const rect = picker.getBoundingClientRect();
  if (rect.right > viewportWidth) {
    picker.style.left = `${viewportWidth - rect.width - 10}px`;
  }
  if (rect.bottom > viewportHeight) {
    picker.style.top = `${y - rect.height - 8}px`;
  }
  document.addEventListener("keydown", handleKeydown);
  setTimeout(() => {
    document.addEventListener("mousedown", handleClickOutside);
  }, 100);
  return dismiss;
}
function extractSynonyms(result) {
  if (!result || typeof result !== "object") {
    return [];
  }
  const r = result;
  if (Array.isArray(r.synonyms)) {
    return r.synonyms.filter((s) => typeof s === "string");
  }
  if (Array.isArray(r.alternatives)) {
    return r.alternatives.filter((s) => typeof s === "string");
  }
  return [];
}
var init_synonym_picker = __esm({
  "src/services/synonym-picker.ts"() {
    "use strict";
  }
});

// src/services/explain-panel.ts
function showExplainPanel(options) {
  const { view, explanation, code, position, onDismiss } = options;
  const panel = document.createElement("div");
  panel.className = "explain-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Code Explanation");
  Object.assign(panel.style, {
    position: "fixed",
    zIndex: "10000",
    backgroundColor: "var(--surface, #1e1e1e)",
    border: "1px solid var(--border, #333)",
    borderRadius: "12px",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
    padding: "0",
    maxHeight: "70vh",
    maxWidth: "600px",
    minWidth: "300px",
    width: "500px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  });
  const header = document.createElement("div");
  header.className = "explain-panel-header";
  Object.assign(header.style, {
    padding: "12px 16px",
    borderBottom: "1px solid var(--border, #333)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "var(--surface-elevated, #252525)"
  });
  const title = document.createElement("span");
  title.textContent = "Code Explanation";
  Object.assign(title.style, {
    fontWeight: "600",
    fontSize: "0.95em",
    color: "var(--text, #fff)"
  });
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "\xD7";
  closeBtn.setAttribute("aria-label", "Close");
  Object.assign(closeBtn.style, {
    background: "none",
    border: "none",
    fontSize: "1.4em",
    cursor: "pointer",
    color: "var(--text-muted, #888)",
    padding: "0 4px",
    lineHeight: "1"
  });
  closeBtn.addEventListener("click", dismiss);
  closeBtn.addEventListener("mouseenter", () => {
    closeBtn.style.color = "var(--text, #fff)";
  });
  closeBtn.addEventListener("mouseleave", () => {
    closeBtn.style.color = "var(--text-muted, #888)";
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);
  const content = document.createElement("div");
  content.className = "explain-panel-content";
  Object.assign(content.style, {
    padding: "16px",
    overflowY: "auto",
    flex: "1",
    fontSize: "0.9em",
    lineHeight: "1.6",
    color: "var(--text, #fff)"
  });
  if (code) {
    const codeSection = document.createElement("div");
    codeSection.className = "explain-panel-code";
    Object.assign(codeSection.style, {
      marginBottom: "16px",
      padding: "12px",
      backgroundColor: "var(--code-bg, #0d0d0d)",
      borderRadius: "8px",
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "0.85em",
      overflow: "auto",
      maxHeight: "150px",
      whiteSpace: "pre-wrap",
      color: "var(--text-muted, #aaa)"
    });
    codeSection.textContent = code;
    content.appendChild(codeSection);
  }
  const explanationEl = document.createElement("div");
  explanationEl.className = "explain-panel-explanation";
  const rendered = renderSimpleMarkdown(explanation);
  explanationEl.innerHTML = rendered;
  content.appendChild(explanationEl);
  panel.appendChild(content);
  function dismiss() {
    panel.remove();
    document.removeEventListener("keydown", handleKeydown);
    onDismiss?.();
  }
  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  }
  let x = position?.x ?? 100;
  let y = position?.y ?? 100;
  if (!position) {
    x = (window.innerWidth - 500) / 2;
    y = Math.max(100, (window.innerHeight - 400) / 2);
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  panel.style.left = `${Math.max(20, Math.min(x, viewportWidth - 520))}px`;
  panel.style.top = `${Math.max(20, Math.min(y, viewportHeight - 400))}px`;
  document.body.appendChild(panel);
  document.addEventListener("keydown", handleKeydown);
  closeBtn.focus();
  return dismiss;
}
function renderSimpleMarkdown(text) {
  if (!text)
    return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre style="background: var(--code-bg, #0d0d0d); padding: 12px; border-radius: 6px; overflow: auto; margin: 12px 0;"><code>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code style="background: var(--code-bg, #0d0d0d); padding: 2px 6px; border-radius: 4px;">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(/^###### (.+)$/gm, '<h6 style="margin: 16px 0 8px 0; font-size: 0.9em;">$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5 style="margin: 16px 0 8px 0; font-size: 0.95em;">$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4 style="margin: 16px 0 8px 0; font-size: 1em;">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 style="margin: 16px 0 8px 0; font-size: 1.1em;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="margin: 16px 0 8px 0; font-size: 1.2em;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="margin: 16px 0 8px 0; font-size: 1.3em;">$1</h1>');
  html = html.replace(/^[\-\*] (.+)$/gm, '<li style="margin-left: 20px;">$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left: 20px;">$1</li>');
  html = html.replace(/\n\n+/g, '</p><p style="margin: 12px 0;">');
  html = html.replace(/\n/g, "<br>");
  html = `<p style="margin: 12px 0;">${html}</p>`;
  return html;
}
function extractExplanation(result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const r = result;
  if (typeof r.explanation === "string") {
    return r.explanation;
  }
  if (typeof r.text === "string") {
    return r.text;
  }
  if (typeof r.content === "string") {
    return r.content;
  }
  return null;
}
var init_explain_panel = __esm({
  "src/services/explain-panel.ts"() {
    "use strict";
  }
});

// src/services/ai-action-handler.ts
function extractResultText(actionId, result) {
  if (!result || typeof result !== "object") {
    return null;
  }
  const r = result;
  if (actionId === "finishLine" || actionId === "finishSection") {
    return typeof r.completion === "string" ? r.completion : null;
  }
  if (actionId === "fixGrammar" || actionId === "fixTranscription") {
    return typeof r.fixed_text === "string" ? r.fixed_text : null;
  }
  if (actionId === "fixCode") {
    return typeof r.fixed_code === "string" ? r.fixed_code : null;
  }
  if (actionId === "documentCode") {
    return typeof r.documented_code === "string" ? r.documented_code : null;
  }
  if (actionId === "simplifyCode") {
    return typeof r.simplified_code === "string" ? r.simplified_code : null;
  }
  if (actionId === "formatCode") {
    return typeof r.formatted_code === "string" ? r.formatted_code : null;
  }
  if (actionId === "reformatMarkdown") {
    return typeof r.reformatted_text === "string" ? r.reformatted_text : null;
  }
  if (actionId === "correctAndFinish") {
    if (typeof r.corrected_completion === "string") {
      return r.corrected_completion;
    }
    const corrected = typeof r.corrected_text === "string" ? r.corrected_text : "";
    const completion = typeof r.completion === "string" ? r.completion : "";
    return corrected + completion || null;
  }
  if (actionId === "synonyms") {
    return null;
  }
  if (actionId === "explainCode") {
    return null;
  }
  if (actionId === "askClaude") {
    return null;
  }
  if (typeof r.completion === "string")
    return r.completion;
  if (typeof r.text === "string")
    return r.text;
  if (typeof r.result === "string")
    return r.result;
  if (typeof r.content === "string")
    return r.content;
  return null;
}
function isReplaceAction(actionId) {
  const replaceActions = /* @__PURE__ */ new Set([
    "fixGrammar",
    "fixTranscription",
    "fixCode",
    "documentCode",
    "simplifyCode",
    "formatCode",
    "reformatMarkdown",
    "correctAndFinish"
  ]);
  return replaceActions.has(actionId);
}
function isSpecialAction(actionId) {
  const specialActions = /* @__PURE__ */ new Set([
    "synonyms",
    // Needs picker UI
    "explainCode",
    // Display in panel
    "askClaude"
    // Claude handles edits
  ]);
  return specialActions.has(actionId);
}
function getOperationLabel(actionId) {
  const labels = {
    finishLine: "Completing line",
    finishSection: "Completing section",
    fixGrammar: "Fixing grammar",
    fixTranscription: "Fixing transcription",
    fixCode: "Fixing code",
    documentCode: "Documenting code",
    simplifyCode: "Simplifying code",
    formatCode: "Formatting code",
    reformatMarkdown: "Reformatting markdown",
    correctAndFinish: "Correcting & completing"
  };
  return labels[actionId] ?? "AI processing";
}
function createAIActionHandler(config) {
  const { getView, getLockManager, getUser, onSuccess, onError } = config;
  const defaultUser = {
    userId: "local-user",
    userName: "You",
    userColor: "#3b82f6"
  };
  const activeStreams = /* @__PURE__ */ new Map();
  let streamingFns = null;
  async function getStreamingFunctions() {
    if (streamingFns)
      return streamingFns;
    const streaming = await import("/editor-dist/index.browser.js");
    streamingFns = streaming;
    return streamingFns;
  }
  function getAnchorInfo(ctx, actionId, view) {
    const shouldReplace = ctx.isReplace ?? isReplaceAction(actionId);
    let anchorPos;
    let anchorType;
    let replaceFrom;
    let replaceTo;
    if (shouldReplace && ctx.selectionStart !== void 0 && ctx.selectionEnd !== void 0) {
      anchorPos = ctx.selectionStart;
      anchorType = "replace";
      replaceFrom = ctx.selectionStart;
      replaceTo = ctx.selectionEnd;
    } else if (ctx.cursor !== void 0) {
      anchorPos = ctx.cursor;
      anchorType = "after";
    } else if (ctx.selectionEnd !== void 0) {
      anchorPos = ctx.selectionEnd;
      anchorType = "after";
    } else {
      anchorPos = view.state.selection.main.head;
      anchorType = "after";
    }
    return { anchorPos, anchorType, replaceFrom, replaceTo };
  }
  async function handleActionStart(actionId, ctx) {
    if (isSpecialAction(actionId)) {
      return;
    }
    const view = getView();
    if (!view) {
      console.warn("[AI] No editor view available for action start");
      return;
    }
    const requestId = ctx.requestId ?? 0;
    const user = getUser?.() ?? defaultUser;
    try {
      const { startStream } = await getStreamingFunctions();
      const streamId = `ai-${actionId}-${requestId}`;
      const anchor = getAnchorInfo(ctx, actionId, view);
      startStream(view, {
        id: streamId,
        type: "ai",
        anchorPos: anchor.anchorPos,
        anchorType: anchor.anchorType,
        replaceFrom: anchor.replaceFrom,
        replaceTo: anchor.replaceTo,
        owner: {
          userId: user.userId,
          userName: user.userName,
          userColor: user.userColor
        },
        operation: getOperationLabel(actionId)
      });
      activeStreams.set(requestId, {
        streamId,
        actionId,
        ctx,
        hasContent: false
      });
      console.log(`[AI] Started stream '${streamId}' for '${actionId}'`);
    } catch (err) {
      console.error(`[AI] Failed to start stream for '${actionId}':`, err);
    }
  }
  async function handleChunk(actionId, chunk, ctx) {
    const requestId = ctx.requestId ?? 0;
    const stream = activeStreams.get(requestId);
    if (!stream) {
      console.warn(`[AI] No active stream for requestId ${requestId}`);
      return;
    }
    const view = getView();
    if (!view)
      return;
    try {
      const { streamChunk } = await getStreamingFunctions();
      streamChunk(view, stream.streamId, chunk);
      stream.hasContent = true;
      console.log(`[AI] Streamed ${chunk.length} chars to '${stream.streamId}'`);
    } catch (err) {
      console.error(`[AI] Failed to stream chunk:`, err);
    }
  }
  async function handleAction(actionId, result, ctx) {
    const view = getView();
    if (!view) {
      console.warn("[AI] No editor view available");
      onError?.(actionId, new Error("No editor available"));
      return false;
    }
    const requestId = ctx.requestId ?? 0;
    if (actionId === "synonyms") {
      const stream2 = activeStreams.get(requestId);
      if (stream2) {
        try {
          const { cancelStream } = await getStreamingFunctions();
          cancelStream(view, stream2.streamId);
          activeStreams.delete(requestId);
        } catch (e) {
        }
      }
      const synonyms = extractSynonyms(result);
      if (synonyms.length === 0) {
        console.warn("[AI] No synonyms in result", result);
        onError?.(actionId, new Error("No synonyms found"));
        return false;
      }
      const replaceFrom = ctx.selectionStart ?? ctx.cursor ?? view.state.selection.main.from;
      const replaceTo = ctx.selectionEnd ?? ctx.cursor ?? view.state.selection.main.to;
      showSynonymPicker({
        view,
        synonyms,
        original: ctx.selection ?? "",
        replaceFrom,
        replaceTo,
        position: ctx.palettePosition,
        onSelect: (synonym) => {
          console.log(`[AI] Selected synonym: "${synonym}"`);
          onSuccess?.(actionId, synonym);
        },
        onDismiss: () => {
          console.log("[AI] Synonym picker dismissed");
        }
      });
      return true;
    }
    if (actionId === "explainCode") {
      const stream2 = activeStreams.get(requestId);
      if (stream2) {
        try {
          const { cancelStream } = await getStreamingFunctions();
          cancelStream(view, stream2.streamId);
          activeStreams.delete(requestId);
        } catch (e) {
        }
      }
      const explanation = extractExplanation(result);
      if (!explanation) {
        console.warn("[AI] No explanation in result", result);
        onError?.(actionId, new Error("No explanation found"));
        return false;
      }
      showExplainPanel({
        view,
        explanation,
        code: ctx.selection,
        position: ctx.palettePosition,
        onDismiss: () => {
          console.log("[AI] Explanation panel dismissed");
        }
      });
      onSuccess?.(actionId, explanation);
      return true;
    }
    if (isSpecialAction(actionId)) {
      console.log(`[AI] Special action '${actionId}' - no text insertion`);
      return true;
    }
    const text = extractResultText(actionId, result);
    if (!text) {
      console.warn(`[AI] No insertable text for action '${actionId}'`, result);
      const streamToCancel = activeStreams.get(requestId);
      if (streamToCancel) {
        try {
          const { cancelStream } = await getStreamingFunctions();
          cancelStream(view, streamToCancel.streamId);
          activeStreams.delete(requestId);
        } catch (e) {
        }
      }
      onError?.(actionId, new Error("No text in AI response"));
      return false;
    }
    const stream = activeStreams.get(requestId);
    const user = getUser?.() ?? defaultUser;
    try {
      const { startStream, streamChunk, completeStream, commitStream } = await getStreamingFunctions();
      let streamId;
      if (stream) {
        streamId = stream.streamId;
        if (!stream.hasContent) {
          streamChunk(view, streamId, text);
        }
        completeStream(view, streamId);
      } else {
        streamId = `ai-${actionId}-${Date.now()}`;
        const anchor = getAnchorInfo(ctx, actionId, view);
        startStream(view, {
          id: streamId,
          type: "ai",
          anchorPos: anchor.anchorPos,
          anchorType: anchor.anchorType,
          replaceFrom: anchor.replaceFrom,
          replaceTo: anchor.replaceTo,
          owner: {
            userId: user.userId,
            userName: user.userName,
            userColor: user.userColor
          },
          operation: getOperationLabel(actionId)
        });
        streamChunk(view, streamId, text);
        completeStream(view, streamId);
      }
      const commitResult = commitStream({
        streamId,
        view,
        onCommit: (content) => {
          console.log(`[AI] Committed ${content.length} chars for '${actionId}'`);
          onSuccess?.(actionId, content);
        },
        onError: (err) => {
          console.error(`[AI] Commit failed for '${actionId}':`, err);
          onError?.(actionId, err);
        }
      });
      activeStreams.delete(requestId);
      return commitResult.success;
    } catch (err) {
      console.error(`[AI] Failed to apply action '${actionId}':`, err);
      activeStreams.delete(requestId);
      onError?.(actionId, err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }
  async function cancelAction(requestId) {
    const stream = activeStreams.get(requestId);
    if (!stream)
      return;
    const view = getView();
    if (!view)
      return;
    try {
      const { cancelStream } = await getStreamingFunctions();
      cancelStream(view, stream.streamId);
      activeStreams.delete(requestId);
      console.log(`[AI] Cancelled stream '${stream.streamId}'`);
    } catch (err) {
      console.error(`[AI] Failed to cancel stream:`, err);
    }
  }
  return {
    handleActionStart,
    handleChunk,
    handleAction,
    cancelAction,
    extractResultText,
    isReplaceAction,
    isSpecialAction
  };
}
var init_ai_action_handler = __esm({
  "src/services/ai-action-handler.ts"() {
    "use strict";
    init_synonym_picker();
    init_explain_panel();
  }
});

// src/apps/codes/index.ts
var codes_exports = {};
__export(codes_exports, {
  mount: () => mount
});
import {
  createEditor,
  IPythonExecutor,
  createYjsSync,
  createCollabServiceYjsAdapter
} from "/editor-dist/index.browser.js";
import { IPythonClient } from "/core/ipython-client.js";
import * as SessionState2 from "/core/session-state.js";
import { createFileTabs } from "/core/file-tabs.js";
import { createRecentProjectsPanel } from "/core/recent-projects.js";
import { createFileBrowser } from "/core/file-browser.js";
import { AiClient } from "/core/ai-client.js";
import { createAiPalette } from "/core/ai-palette.js";
import { HistoryPanel } from "/core/history-panel.js";
import { createTerminalTabs } from "/core/terminal-tabs.js";
import { createNotificationManager } from "/core/notifications.js";
import { createProcessSidebar } from "/core/process-sidebar.js";
import { toggleMode, HomeScreen } from "/core/compact-mode.js";
import { initSelectionToolbar } from "/core/selection-toolbar.js";
import * as VariablesPanel from "/core/variables-panel.js";
import * as QuickPicker from "/core/quick-picker.js";
import * as ProjectStatus from "/core/project-status.js";
import { initEditorKeybindings } from "/core/editor-keybindings.js";
import { KeybindingManager } from "/core/keybinding-manager.js";
async function mount(svc, options = {}) {
  const defaultMode = options.defaultMode ?? "developer";
  const modeName = defaultMode === "compact" ? "Study" : "Codes";
  console.log(`[Atelier] Mounting in ${modeName} mode (${defaultMode})...`);
  services = svc;
  SessionState2.setInterfaceMode(defaultMode);
  SessionState2.setAppState(appState);
  noCollab = new URLSearchParams(window.location.search).has("noCollab");
  if (noCollab) {
    useCollaboration = false;
  }
  initDOMReferences();
  initClients();
  initEditor();
  await initUIModules();
  await initInterfaceMode();
  await initCollaboration();
  setupEventHandlers();
  setupKeyboardShortcuts();
  initVariablesPanel();
  initFileWatching();
  await loadInitialState();
  console.log(`[Atelier] ${modeName} mode ready`);
}
function initDOMReferences() {
  container = document.getElementById("editor-container");
  rawTextarea = document.getElementById("raw-markdown");
  cursorPosEl = document.getElementById("cursor-pos");
  execStatusEl = document.getElementById("exec-status");
  if (!container) {
    throw new Error("[Codes] Missing #editor-container element");
  }
}
function initClients() {
  ipython = new IPythonClient({ apiBase: "" });
  aiClient = new AiClient();
  aiClient.isAvailable().then((available) => {
    if (available) {
      console.log("[AI] Server available");
    } else {
      console.log("[AI] Server not available - AI features disabled");
    }
  });
}
function initEditor() {
  ipythonExecutor = new IPythonExecutor({ client: ipython });
  const resolveImageUrl = createImageUrlResolver(() => documentBasePath);
  editor = createEditor({
    parent: container,
    doc: "",
    executor: ipythonExecutor,
    theme: "zen",
    resolveImageUrl,
    onChange: (doc) => {
      if (!silentUpdate) {
        const editorFilePath = editor?.getFilePath();
        if (editorFilePath && appState.openFiles.has(editorFilePath)) {
          rawTextarea.value = doc;
          appState.updateFileContent(editorFilePath, doc, true);
          if (appState.currentFilePath === editorFilePath) {
            scheduleAutosave();
            updateFileIndicator();
          }
        }
      }
    },
    onCursorChange: (info) => {
      cursorPosEl.textContent = String(info.pos);
    },
    onComplete: async (code, cursorPos, lang) => {
      if (lang !== "python")
        return null;
      return await ipython.complete(code, cursorPos);
    },
    onInspect: async (code, cursorPos, lang) => {
      if (lang !== "python")
        return null;
      return await ipython.inspect(code, cursorPos);
    },
    onHover: async (word, lang) => {
      if (lang !== "python")
        return null;
      return await ipython.hoverInspect(word);
    }
  });
  setContent("", true);
  rawTextarea.value = "";
  if (editor.tracker) {
    editor.tracker.setFileCallbacks({
      getCurrentFilePath: () => appState.currentFilePath,
      getFileContent: (path) => appState.openFiles.get(path)?.content ?? null,
      updateFileContent: (path, content) => {
        appState.updateFileContent(path, content, true);
      }
    });
    editor.tracker.setDocumentCallbacks({
      applyChange: (newContent, origin) => {
        editor.applyExternalChange(newContent, origin);
      },
      getContent: () => editor.getDoc()
    });
    editor.tracker.setBeforeExecuteCallback(async ({ filePath }) => {
      const mismatchInfo = SessionState2.getProjectMismatchInfo();
      if (!mismatchInfo.isMismatch) {
        return { proceed: true };
      }
      const userChoice = await showProjectMismatchDialog(
        mismatchInfo.viewedProject || "Unknown",
        mismatchInfo.activeProject || "Unknown"
      );
      if (userChoice === "switch") {
        console.log(`[Codes] User chose to switch to ${mismatchInfo.viewedProject}`);
        const result = await SessionState2.switchToViewedProject();
        if (result.success) {
          return { proceed: true };
        } else {
          showNotification("Error", "Failed to switch project", "error");
          return { proceed: false, message: "Project switch failed" };
        }
      } else if (userChoice === "continue") {
        console.log(`[Codes] User chose to continue with ${mismatchInfo.activeProject}`);
        return { proceed: true };
      } else {
        return { proceed: false, message: "Cancelled by user" };
      }
    });
  }
  initSelectionToolbar(container, {
    getContent: () => editor.getDoc(),
    getSelectionInfo: () => getSelectionInfo(),
    replaceTextRange: (text, start, end) => {
      editor.view.dispatch({
        changes: { from: start, to: end, insert: text }
      });
      return true;
    },
    insertTextAtCursor: (text) => {
      const pos = editor.getCursor();
      editor.view.dispatch({
        changes: { from: pos, insert: text }
      });
      return true;
    }
  });
  rawTextarea.addEventListener("input", () => {
    setContent(rawTextarea.value, true);
    const currentPath = appState.currentFilePath;
    if (currentPath) {
      appState.markFileModified(currentPath);
      scheduleAutosave();
      updateFileIndicator();
    }
  });
  editor.focus();
  aiActionHandler = createAIActionHandler({
    getView: () => editor?.view ?? null,
    getLockManager: () => editor?.lockManager ?? null,
    getUser: () => ({
      userId: "local-user",
      userName: "You",
      userColor: "#3b82f6"
    }),
    onSuccess: (actionId, content) => {
      console.log(`[AI] Successfully applied '${actionId}': ${content.length} chars`);
    },
    onError: (actionId, error) => {
      console.error(`[AI] Failed to apply '${actionId}':`, error);
      notificationManager?.addLocalNotification(
        "AI Action Failed",
        error.message,
        "error"
      );
    }
  });
}
function cleanupYjsCollab() {
  if (currentYjsAdapter) {
    currentYjsAdapter.disconnect();
    currentYjsAdapter = null;
  }
  if (currentYjsDoc) {
    currentYjsDoc.destroy();
    currentYjsDoc = null;
  }
  currentYjsFilePath = null;
  if (editor) {
    editor.clearCollabExtensions();
  }
}
async function setupYjsForFile(filePath) {
  cleanupYjsCollab();
  console.log("[Yjs] Setting up collaboration for:", filePath);
  const sessionInfo = services.collaboration.getSessionInfo();
  const userId = sessionInfo?.session_id || "local-user";
  const userName = "User";
  const userColor = sessionInfo?.color || "#3b82f6";
  currentYjsDoc = createYjsSync({
    userId,
    userName,
    userColor,
    filePath
  });
  currentYjsAdapter = createCollabServiceYjsAdapter(services.collaboration, filePath);
  currentYjsDoc.connectProvider(currentYjsAdapter);
  console.log("[Yjs] Waiting for initial sync...");
  await currentYjsAdapter.whenSynced();
  currentYjsFilePath = filePath;
  const content = currentYjsDoc.getContent();
  console.log("[Yjs] Sync complete, content length:", content.length);
  editor.setDoc(content);
  editor.setCollabExtensions(currentYjsDoc.getExtensions());
  currentYjsDoc.observe((event, transaction) => {
    const origin = transaction.origin;
    const isLocal = origin !== "remote" && origin !== "external";
    const newContent = currentYjsDoc.getContent();
    if (!silentUpdate && appState.currentFilePath === filePath) {
      rawTextarea.value = newContent;
      appState.updateFileContent(filePath, newContent, true);
      updateFileIndicator();
      if (isLocal) {
        console.log("[Yjs] Local change detected, scheduling autosave");
        scheduleAutosave();
      } else {
        console.log("[Yjs] Remote change detected, NOT scheduling autosave");
      }
    }
  });
  return content;
}
function setContent(markdown, silent = false) {
  if (silent) {
    silentUpdate = true;
    try {
      editor.setDoc(markdown);
    } finally {
      silentUpdate = false;
    }
  } else {
    editor.setDoc(markdown);
  }
}
function getContent() {
  return editor.getDoc();
}
function setDocumentBasePath(path) {
  documentBasePath = path;
}
function getSelectionInfo() {
  const state = editor.view.state;
  const selection = state.selection.main;
  return {
    cursor: selection.head,
    hasSelection: !selection.empty,
    selectedText: state.sliceDoc(selection.from, selection.to)
  };
}
async function initUIModules() {
  const fileTabsContainer = document.getElementById("file-tabs-container");
  if (fileTabsContainer) {
    fileTabs = createFileTabs({
      onTabSelect: handleTabSelect,
      onBeforeClose: handleBeforeTabClose,
      onTabClose: handleTabClose
    });
    fileTabsContainer.appendChild(fileTabs.element);
  }
  const notificationBadge = document.getElementById("notification-badge");
  if (notificationBadge) {
    notificationManager = createNotificationManager({
      badgeEl: notificationBadge
    });
  }
  const fileBrowserContainer = document.getElementById("fileBrowserContainer");
  if (fileBrowserContainer) {
    fileBrowser = createFileBrowser(fileBrowserContainer, {
      initialPath: browserRoot,
      mode: "browse",
      showFilter: true,
      showProjectButton: true,
      onSelect: (path) => openFile(path),
      onNavigate: (path) => {
        browserRoot = path;
        localStorage.setItem("mrmd_browser_root", browserRoot);
      },
      onOpenProject: (path) => {
        SessionState2.openProject(path);
      }
    });
  }
  const terminalContainer = document.getElementById("sidebar-terminal");
  if (terminalContainer) {
    terminalTabs = createTerminalTabs({
      container: terminalContainer
    });
  }
  aiPalette = createAiPalette({
    aiClient,
    onRunningChange: (count) => {
      updateRunningBadge(count);
    },
    onActionStart: handleAiActionStart,
    onChunk: handleAiChunk,
    onAction: handleAiAction,
    onError: (err, actionId) => {
      console.error("[AI] Error:", actionId, err);
    },
    getContext: getAiContext
  });
  aiPalette.attachToEditor({
    container,
    getCursorScreenPosition: () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      }
      return null;
    }
  });
  const historyContainer = document.getElementById("history-panel");
  if (historyContainer) {
    historyPanel = new HistoryPanel(historyContainer, {
      onRestore: async (versionId) => {
        console.log("[History] Restoring version:", versionId);
      }
    });
  }
  const processContainer = document.getElementById("processes-panel");
  if (processContainer) {
    createProcessSidebar({
      container: processContainer
    });
  }
  const projectsPanelContainer = document.getElementById("projects-panel");
  if (projectsPanelContainer) {
    const projectsPanelEl = createRecentProjectsPanel({
      onProjectOpen: (path) => openProject2(path)
    });
    projectsPanelContainer.appendChild(projectsPanelEl);
  }
  initSidebarTabs();
  initSidebarResizer();
  initThemePicker();
  initModeToggle();
  initFileIndicatorClick();
}
function initFileIndicatorClick() {
  const indicator = document.querySelector(".current-file-indicator");
  const nameEl = indicator?.querySelector(".file-name");
  if (nameEl) {
    nameEl.style.cursor = "pointer";
    nameEl.title = "Click to rename or move file";
    nameEl.addEventListener("click", () => {
      const currentPath = appState.currentFilePath;
      if (currentPath) {
        openSavePickerForFile(currentPath, { copyMode: false, closeAfter: false });
      }
    });
  }
}
async function initInterfaceMode() {
  const mainContainer = document.querySelector(".container");
  const editorPane = document.querySelector(".editor-pane");
  if (!mainContainer || !editorPane) {
    console.error("[Codes] Cannot initialize interface mode: missing container elements");
    return;
  }
  interfaceManager = await createInterfaceManager({
    container: mainContainer,
    editorPane,
    editor,
    getEditor: () => editor,
    fileBrowser
  });
  console.log(`[Codes] Interface mode: ${interfaceManager.getMode()}`);
}
async function initCollaboration() {
  if (noCollab) {
    console.log("[Collab] Disabled via ?noCollab");
    return;
  }
  const collab = services.collaboration;
  collab.onConnected(async (info) => {
    console.log("[Collab] Connected:", info.session_id);
    stopPollingFallback();
    const openPaths = Array.from(appState.openFiles.keys());
    console.log("[Collab] Watching", openPaths.length, "open files:", openPaths);
    for (const path of openPaths) {
      console.log("[Collab] Sending watch request for:", path);
      collab.watchFile(path);
    }
    const currentPath = appState.currentFilePath;
    if (currentPath && currentPath.endsWith(".md") && useCollaboration) {
      if (!currentYjsDoc || currentYjsFilePath !== currentPath) {
        console.log("[Collab] Upgrading current file to collaborative mode:", currentPath);
        try {
          const currentContent = getContent();
          const syncedContent = await setupYjsForFile(currentPath);
          if (syncedContent.length > 0 && syncedContent !== currentContent) {
            console.log("[Collab] Yjs has different content, syncing editor");
            setContent(syncedContent, true);
            rawTextarea.value = syncedContent;
            appState.updateFileContent(currentPath, syncedContent, false);
          } else if (syncedContent.length === 0 && currentContent.length > 0) {
            console.log("[Collab] Yjs empty, pushing editor content to Yjs");
            if (currentYjsDoc) {
              currentYjsDoc.applyExternalChange(currentContent, "init");
            }
          }
          console.log("[Collab] Successfully upgraded to collaborative mode");
        } catch (err) {
          console.error("[Collab] Failed to upgrade to collaborative mode:", err);
        }
      }
    }
    catchUpMissedChanges();
  });
  collab.onDisconnected(() => {
    console.log("[Collab] Disconnected");
    startPollingFallback();
  });
  collab.onFileChanged(async (payload) => {
    const { file_path, event_type, mtime, content } = payload;
    const source = detectExternalChangeSource(file_path);
    console.log("[Collab] File changed via WebSocket:", file_path, {
      event_type,
      mtime,
      source,
      hasContent: content !== null && content !== void 0
    });
    await handleExternalFileChange(file_path, source, content);
  });
  collab.onFileSaved((payload) => {
    console.log("[Collab] File saved by:", payload.user_name);
  });
  collab.onWatchFileAck((payload) => {
    console.log("[Collab] Watch file acknowledged:", payload.file_path, {
      mtime: payload.mtime,
      error: payload.error
    });
  });
  collab.onPresence((payload) => {
    for (const user of payload.users) {
      if (user.user_type === "ai") {
        trackAIUserJoin(user.session_id, user.user_name, payload.file_path);
      }
    }
  });
  collab.onUserJoined((payload) => {
    const user = payload.user;
    if (user.user_type === "ai") {
      trackAIUserJoin(user.session_id, user.user_name, payload.file_path);
      if (claudePresenceIndicator) {
        claudePresenceIndicator.show(payload.file_path || "", 0);
      }
      console.log(`[Collab] AI user ${user.user_name} joined file ${payload.file_path}`);
    }
  });
  collab.onUserLeft((payload) => {
    trackAIUserLeave(payload.session_id);
  });
  const project = appState.project;
  if (project) {
    try {
      await collab.connect({
        projectRoot: project.path,
        userName: "user",
        userType: "human"
      });
    } catch (err) {
      console.warn("[Collab] Connection failed:", err);
      startPollingFallback();
    }
  }
}
function setupEventHandlers() {
  console.log("[Codes] setupEventHandlers starting");
  SessionState2.on("file-modified", (path) => {
    fileTabs?.updateTabModified(path, true);
  });
  SessionState2.on("file-saved", (path) => {
    fileTabs?.updateTabModified(path, false);
  });
  let resumeAutosave = null;
  SessionState2.on("autosave-pause", () => {
    resumeAutosave = pauseAutosave();
  });
  SessionState2.on("autosave-resume", () => {
    if (resumeAutosave) {
      resumeAutosave();
      resumeAutosave = null;
    }
  });
  SessionState2.on("save-now", async () => {
    await saveCurrentFileNow();
  });
  SessionState2.on("command-executed", ({ command }) => {
    if (command === "save") {
      saveFile();
    }
  });
  SessionState2.on("project-opened", handleProjectOpened);
  SessionState2.on("project-created", handleProjectCreated);
  SessionState2.on("kernel-initializing", ({ message }) => {
    execStatusEl.textContent = message || "initializing...";
    execStatusEl.classList.add("kernel-switching");
  });
  SessionState2.on("kernel-ready", ({ session, venv }) => {
    execStatusEl.textContent = "ready";
    execStatusEl.classList.remove("kernel-switching");
    if (session && ipython) {
      console.log(`[Codes] Kernel ready - syncing IPython client to session: ${session}`);
      ipython.setSession(session);
    }
  });
  SessionState2.on("kernel-error", ({ error }) => {
    execStatusEl.textContent = "kernel error";
    execStatusEl.classList.remove("kernel-switching");
    showNotification("Kernel Error", error, "error");
  });
  let pendingFileSwitch = null;
  SessionState2.on("file-switch-requested", async ({ path }) => {
    console.log("[Codes] File switch requested:", path);
    if (pendingFileSwitch === path) {
      console.log("[Codes] Ignoring duplicate file switch request:", path);
      return;
    }
    pendingFileSwitch = path;
    HomeScreen.hide();
    try {
      await openFile(path);
      editor?.focus();
      ProjectStatus.handleFileOpened(path);
    } catch (err) {
      console.error("[Codes] Failed to open file:", err);
      showNotification("Error", `Failed to open file: ${err}`, "error");
      HomeScreen.show();
    } finally {
      setTimeout(() => {
        if (pendingFileSwitch === path) {
          pendingFileSwitch = null;
        }
      }, 100);
    }
  });
  SessionState2.on("new-notebook-requested", async ({ projectPath, initialContent }) => {
    console.log("[Codes] New notebook requested:", projectPath);
    HomeScreen.hide();
    try {
      await createNewNotebook(projectPath, initialContent);
    } catch (err) {
      console.error("[Codes] Failed to create notebook:", err);
      showNotification("Error", `Failed to create notebook: ${err}`, "error");
      HomeScreen.show();
    }
  });
  SessionState2.on("project-open-requested", async ({ path }) => {
    console.log("[Codes] Project open requested:", path);
    HomeScreen.hide();
    try {
      await openProject2(path);
    } catch (err) {
      console.error("[Codes] Failed to open project:", err);
      showNotification("Error", `Failed to open project: ${err}`, "error");
      HomeScreen.show();
    }
  });
  SessionState2.on("quick-capture-requested", async () => {
    console.log("[Codes] Quick capture requested");
    HomeScreen.hide();
    try {
      await createNewNotebook();
    } catch (err) {
      console.error("[Codes] Failed to create notebook:", err);
      showNotification("Error", `Failed to create notebook: ${err}`, "error");
      HomeScreen.show();
    }
  });
  console.log("[Codes] Registering untitled-file-exit-requested listener");
  SessionState2.on("untitled-file-exit-requested", ({ path, showHomeAfter }) => {
    console.log("[Codes] Untitled file exit requested:", path);
    openSavePickerForFile(path, {
      copyMode: false,
      closeAfter: true
    });
  });
  console.log("[Codes] Registered untitled-file-exit-requested listener");
  window.addEventListener("focus", () => {
    if (!services.collaboration.isConnected) {
      setTimeout(checkFileChanges, 100);
    }
  });
  window.addEventListener("beforeunload", () => {
    const currentPath = appState.currentFilePath;
    if (currentPath) {
      appState.updateFileScrollTop(currentPath, container.scrollTop);
    }
  });
}
function setupKeyboardShortcuts() {
  initEditorKeybindings({ getEditor: () => editor, statusEl: execStatusEl });
  KeybindingManager.handle("file:save", () => {
    const currentPath = appState.currentFilePath;
    if (currentPath && SessionState2.isUntitledFile(currentPath)) {
      openSavePickerForFile(currentPath, { copyMode: false, closeAfter: false });
    } else {
      saveFile();
    }
  });
  KeybindingManager.handle("file:save-as", () => {
    const currentPath = appState.currentFilePath;
    if (currentPath) {
      openSavePickerForFile(currentPath, { copyMode: true, closeAfter: false });
    }
  });
}
function initVariablesPanel() {
  const variablesPanelContainer = document.getElementById("variables-panel");
  if (!variablesPanelContainer) {
    console.warn("[Codes] Variables panel container not found");
    return;
  }
  variablesPanelContainer.innerHTML = "";
  const panelEl = VariablesPanel.createVariablesPanel({
    ipython
  });
  variablesPanelContainer.appendChild(panelEl);
  SessionState2.on("kernel-ready", () => {
    console.log("[Codes] Kernel ready - refreshing variables panel");
    VariablesPanel.refresh();
  });
  document.addEventListener("mrmd:execution-complete", (event) => {
    console.log("[Codes] Execution complete event - refreshing variables panel");
    VariablesPanel.refresh();
    updateTabRunningStates();
  });
  document.addEventListener("mrmd:execution-start", () => {
    updateTabRunningStates();
  });
}
function updateTabRunningStates() {
  if (!fileTabs || !editor.tracker)
    return;
  const runningFiles = editor.tracker.getRunningFiles();
  fileTabs.updateAllRunningStates(runningFiles);
}
async function openFile(path, options = {}) {
  const loadId = ++currentFileLoadId;
  console.log("[Codes] Opening file:", path, options.cachedContent ? "(from cache)" : "", `(loadId: ${loadId})`);
  try {
    const filename = path.split("/").pop() || path;
    const isMarkdown = path.endsWith(".md");
    const shouldUseCollab = useCollaboration && isMarkdown && services.collaboration.isConnected;
    if (isMarkdown && !options.background) {
      const currentProject = SessionState2.getCurrentProject();
      const fileDirPath = path.substring(0, path.lastIndexOf("/"));
      const detectedProject = await detectProjectForPath(fileDirPath);
      if (detectedProject && detectedProject.path !== currentProject?.path) {
        console.log(`[Codes] File is from different project: ${detectedProject.name} (current: ${currentProject?.name || "none"})`);
        SessionState2.setViewedFileProject(path, detectedProject.path, detectedProject.name);
      } else {
        SessionState2.setViewedFileProject(path, currentProject?.path || null, currentProject?.name || null);
      }
    }
    let diskContent = null;
    let diskMtime;
    if (options.cachedContent !== void 0) {
      diskContent = options.cachedContent;
      diskMtime = options.cachedMtime;
      console.log("[Codes] Using cached content for:", path, "length:", diskContent.length);
    } else {
      try {
        const diskFile = await services.documents.openFile(path);
        diskContent = diskFile.content;
        diskMtime = diskFile.mtime;
        console.log("[Codes] Read disk content for:", path, "length:", diskContent.length);
      } catch (err) {
        console.warn("[Codes] Failed to read disk content:", err);
      }
    }
    if (loadId !== currentFileLoadId && !options.background) {
      console.log("[Codes] Skipping stale file load:", path, `(loadId: ${loadId}, current: ${currentFileLoadId})`);
      return;
    }
    if (shouldUseCollab && !options.background) {
      appState.setCurrentFile(path);
      SessionState2.setActiveFile(path);
      fileTabs?.addTab(path, filename, false);
      fileTabs?.setActiveTab(path);
      document.title = `${filename} - MRMD`;
      editor.setFilePath(path);
      try {
        const syncedContent = await setupYjsForFile(path);
        let contentToUse = syncedContent;
        if (syncedContent.length === 0 && diskContent && diskContent.length > 0) {
          console.error("[Codes] SAFETY: Yjs sync returned empty for non-empty file!");
          console.error("[Codes] SAFETY: Using disk content instead:", diskContent.length, "chars");
          contentToUse = diskContent;
          if (currentYjsDoc) {
            console.log("[Codes] SAFETY: Restoring disk content to Yjs");
            currentYjsDoc.applyExternalChange(diskContent, "safety-restore");
          }
        }
        appState.openFile(path, contentToUse, {
          mtime: diskMtime ?? null,
          // Keep disk mtime for reference
          modified: false
        });
        setContent(contentToUse, true);
        rawTextarea.value = contentToUse;
        externalChangeManager?.registerFile(path, contentToUse);
        services.collaboration.watchFile(path);
        updateFileIndicator();
        const session = await SessionState2.getNotebookSession(path);
        if (loadId === currentFileLoadId) {
          ipython.setSession(session);
          SessionState2.setCurrentSessionName(session);
        }
        console.log("[Codes] Collaborative file opened:", path, "content length:", contentToUse.length);
        return;
      } catch (error) {
        console.error("[Codes] Yjs sync failed, falling back to file-based:", error);
      }
    }
    const file = diskContent !== null ? { content: diskContent, mtime: diskMtime } : null;
    if (file) {
      appState.openFile(path, file.content, {
        mtime: file.mtime ?? null,
        modified: false
      });
      externalChangeManager?.registerFile(path, file.content);
    }
    if (services.collaboration.isConnected) {
      services.collaboration.watchFile(path);
    }
    fileTabs?.addTab(path, filename, false);
    if (!options.background && file) {
      if (loadId !== currentFileLoadId) {
        console.log("[Codes] Skipping stale editor update:", path);
        return;
      }
      appState.setCurrentFile(path);
      SessionState2.setActiveFile(path);
      fileTabs?.setActiveTab(path);
      editor.setFilePath(path);
      setContent(file.content, true);
      rawTextarea.value = file.content;
      document.title = `${filename} - MRMD`;
      updateFileIndicator();
      if (isMarkdown) {
        const session = await SessionState2.getNotebookSession(path);
        if (loadId === currentFileLoadId) {
          ipython.setSession(session);
          SessionState2.setCurrentSessionName(session);
        }
      }
    }
  } catch (err) {
    if (loadId === currentFileLoadId) {
      console.error("[Codes] Failed to open file:", err);
      showNotification("Error", `Failed to open file: ${err}`, "error");
    }
  }
}
async function saveFile() {
  const currentPath = appState.currentFilePath;
  if (!currentPath)
    return;
  execStatusEl.textContent = "saving...";
  try {
    if (currentYjsDoc && currentPath.endsWith(".md")) {
      const content = currentYjsDoc.getContent();
      const existingFile = appState.openFiles.get(currentPath);
      if (content.length === 0 && existingFile?.content && existingFile.content.length > 0) {
        console.error("[Save] BLOCKED: Refusing to save empty content to non-empty file:", currentPath);
        execStatusEl.textContent = "save blocked (empty)";
        return;
      }
      console.log("[Yjs] Saving via server:", currentPath, "length:", content.length);
      services.collaboration.saveFile(currentPath);
      appState.markFileSaved(currentPath);
      externalChangeManager?.markAsSaved(currentPath, content);
    } else {
      const file = appState.openFiles.get(currentPath);
      const content = file?.content ?? getContent();
      if (content.length === 0 && file?.content && file.content.length > 0) {
        console.error("[Save] BLOCKED: Refusing to save empty content to non-empty file:", currentPath);
        execStatusEl.textContent = "save blocked (empty)";
        return;
      }
      await services.documents.saveFile(currentPath, content);
      appState.markFileSaved(currentPath);
      externalChangeManager?.markAsSaved(currentPath, content);
      if (services.collaboration.isConnected) {
        services.collaboration.notifyFileSaved(currentPath);
      }
    }
    updateFileIndicator();
    execStatusEl.textContent = "saved";
    setTimeout(() => {
      if (execStatusEl.textContent === "saved") {
        execStatusEl.textContent = "ready";
      }
    }, 1e3);
  } catch (err) {
    console.error("[Codes] Save failed:", err);
    execStatusEl.textContent = "save failed";
    showNotification("Error", `Save failed: ${err}`, "error");
  }
}
function scheduleAutosave() {
  if (autosavePaused)
    return;
  const fileToSave = appState.currentFilePath;
  if (!fileToSave || !appState.isModified)
    return;
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  if (Date.now() - lastSaveTime > AUTOSAVE_MAX_INTERVAL) {
    doAutosaveForFile(fileToSave);
    return;
  }
  autosaveTimer = setTimeout(() => doAutosaveForFile(fileToSave), AUTOSAVE_DELAY);
}
function pauseAutosave() {
  autosavePaused = true;
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  console.log("[Autosave] Paused");
  return () => {
    autosavePaused = false;
    console.log("[Autosave] Resumed");
    scheduleAutosave();
  };
}
async function saveCurrentFileNow() {
  const filePath = appState.currentFilePath;
  if (!filePath)
    return;
  const file = appState.openFiles.get(filePath);
  if (!file)
    return;
  try {
    await services.documents.saveFile(filePath, file.content, { message: "execution" });
    appState.markFileSaved(filePath);
    externalChangeManager?.markAsSaved(filePath, file.content);
    lastSaveTime = Date.now();
    updateFileIndicator();
  } catch (err) {
    console.error("[Save] Failed:", err);
  }
}
async function doAutosaveForFile(filePath) {
  const file = appState.openFiles.get(filePath);
  if (!file?.modified)
    return;
  console.log("[Autosave] Saving", filePath);
  const isCurrentFile = appState.currentFilePath === filePath;
  if (isCurrentFile) {
    execStatusEl.textContent = "autosaving...";
  }
  try {
    if (currentYjsDoc && currentYjsFilePath === filePath && filePath.endsWith(".md")) {
      const content = currentYjsDoc.getContent();
      if (content.length === 0 && file.content && file.content.length > 0) {
        console.error("[Autosave] BLOCKED: Refusing to save empty content:", filePath);
        return;
      }
      console.log("[Autosave] Saving via Yjs server:", filePath, "length:", content.length);
      services.collaboration.saveFile(filePath);
      appState.markFileSaved(filePath);
      externalChangeManager?.markAsSaved(filePath, content);
    } else {
      const content = file.content;
      if (content.length === 0) {
        console.error("[Autosave] BLOCKED: Refusing to save empty content:", filePath);
        return;
      }
      await services.documents.saveFile(filePath, content, { message: "autosave" });
      appState.markFileSaved(filePath);
      externalChangeManager?.markAsSaved(filePath, content);
    }
    lastSaveTime = Date.now();
    if (appState.currentFilePath === filePath) {
      updateFileIndicator();
      execStatusEl.textContent = "autosaved";
      setTimeout(() => {
        if (execStatusEl.textContent === "autosaved") {
          execStatusEl.textContent = "ready";
        }
      }, 1e3);
    }
  } catch (err) {
    console.error("[Autosave] Failed for", filePath, ":", err);
    if (appState.currentFilePath === filePath) {
      execStatusEl.textContent = "autosave failed";
    }
  }
}
function openSavePickerForFile(filePath, options) {
  const { copyMode, closeAfter } = options;
  const resumeAutosave = pauseAutosave();
  QuickPicker.openSaveTo({
    filePath,
    copyMode,
    closeAfter,
    onComplete: async (newPath, wasCopy, shouldClose) => {
      resumeAutosave();
      await handleSavePickerComplete(filePath, newPath, wasCopy, shouldClose);
    },
    onCancel: (reason) => {
      resumeAutosave();
      if (reason === "discard" && closeAfter) {
        handleDiscardUntitled(filePath);
      }
    }
  });
}
async function handleSavePickerComplete(oldPath, newPath, wasCopy, shouldClose) {
  const isUntitled = SessionState2.isUntitledFile(oldPath);
  if (wasCopy) {
    showNotification("File copied", `Copied to ${newPath.split("/").pop()}`, "success");
    return;
  }
  console.log("[Codes] Moving file:", oldPath, "->", newPath);
  if (currentYjsFilePath === oldPath) {
    cleanupYjsCollab();
  }
  const file = appState.openFiles.get(oldPath);
  const scrollTop = file?.scrollTop || 0;
  if (file) {
    appState.openFiles.delete(oldPath);
    appState.openFiles.set(newPath, {
      ...file,
      modified: false
      // File was just saved
    });
    if (appState.currentFilePath === oldPath) {
      appState.setCurrentFile(newPath);
    }
  }
  SessionState2.removeOpenFile(oldPath);
  SessionState2.addOpenFile(newPath, file?.content || "", false);
  SessionState2.setActiveFile(newPath);
  fileTabs?.renameTab(oldPath, newPath, newPath.split("/").pop() || "");
  if (isUntitled) {
    await SessionState2.removeRecentNotebook(oldPath);
  }
  await SessionState2.addRecentNotebook(newPath, newPath.split("/").pop()?.replace(".md", "") || "");
  if (shouldClose) {
    await handleTabClose(oldPath);
    HomeScreen.show();
    return;
  }
  const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/"));
  const newDir = newPath.substring(0, newPath.lastIndexOf("/"));
  if (oldDir !== newDir) {
    const newProject = await detectProjectForPath(newDir);
    const currentProject = SessionState2.getCurrentProject();
    if (newProject && (!currentProject || newProject.path !== currentProject.path)) {
      console.log("[Codes] File moved to different project, switching:", newProject.path);
      SessionState2.openProject(newProject.path);
    }
  }
  if (newPath.endsWith(".md") && useCollaboration && services.collaboration.isConnected) {
    await setupYjsForFile(newPath);
  }
  editor.setFilePath(newPath);
  const filename = newPath.split("/").pop() || newPath;
  document.title = `${filename} - MRMD`;
  if (scrollTop) {
    requestAnimationFrame(() => {
      container.scrollTop = scrollTop;
    });
  }
  updateFileIndicator();
  showNotification("File saved", `Saved as ${newPath.split("/").pop()}`, "success");
}
async function detectProjectForPath(dirPath) {
  try {
    const response = await fetch("/api/project/detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath })
    });
    if (response.ok) {
      const data = await response.json();
      if (data.project_root) {
        const projectName = data.project_root.split("/").pop() || "Unknown";
        return { path: data.project_root, name: projectName };
      }
    }
  } catch (err) {
    console.error("[Codes] Project detection failed:", err);
  }
  return null;
}
async function handleDiscardUntitled(filePath) {
  services.documents.deleteFile(filePath).catch((err) => {
    console.warn("[Codes] Failed to delete untitled file:", err);
  });
  await SessionState2.removeRecentNotebook(filePath);
  await handleTabClose(filePath);
  HomeScreen.show();
}
async function createNewNotebook(projectPath, initialContent) {
  const currentProject = appState.project;
  const scratchPath = SessionState2.getScratchPath();
  const basePath = projectPath || currentProject?.path || scratchPath || browserRoot;
  const timestamp = Date.now();
  const filename = `Untitled-${timestamp}.md`;
  const filePath = `${basePath}/${filename}`;
  const content = initialContent || "# Untitled\n\n";
  console.log("[Codes] Creating new notebook:", filePath);
  try {
    await services.documents.saveFile(filePath, content);
    await openFile(filePath);
    SessionState2.addRecentNotebook(filePath, "Untitled");
    editor?.focus();
  } catch (err) {
    console.error("[Codes] Failed to create notebook:", err);
    showNotification("Error", `Failed to create notebook: ${err}`, "error");
  }
}
async function handleTabSelect(path) {
  const currentPath = appState.currentFilePath;
  const isMarkdown = path.endsWith(".md");
  const shouldUseCollab = useCollaboration && isMarkdown && services.collaboration.isConnected;
  if (currentPath && currentPath !== path) {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (!currentYjsDoc) {
      appState.saveEditorState(currentPath, editor.view.state);
    }
    appState.updateFileScrollTop(currentPath, container.scrollTop);
  }
  if (shouldUseCollab) {
    const filename = path.split("/").pop() || path;
    document.title = `${filename} - MRMD`;
    appState.setCurrentFile(path);
    SessionState2.setActiveFile(path);
    editor.setFilePath(path);
    try {
      const syncedContent = await setupYjsForFile(path);
      appState.openFile(path, syncedContent, { mtime: null, modified: false });
      setContent(syncedContent, true);
      rawTextarea.value = syncedContent;
      updateFileIndicator();
      services.collaboration.watchFile(path);
      const session = await SessionState2.getNotebookSession(path);
      ipython.setSession(session);
      SessionState2.setCurrentSessionName(session);
      return;
    } catch (error) {
      console.error("[Codes] Yjs sync failed on tab switch:", error);
    }
  }
  const file = appState.openFiles.get(path);
  if (file) {
    if (currentYjsDoc) {
      console.log("[Yjs] Cleaning up Yjs for non-.md file switch");
      cleanupYjsCollab();
    }
    const savedState = appState.getEditorState(path);
    if (savedState && editor?.view) {
      editor.view.setState(savedState);
      rawTextarea.value = file.content;
    } else {
      setContent(file.content, true);
      rawTextarea.value = file.content;
    }
    appState.setCurrentFile(path);
    SessionState2.setActiveFile(path);
    editor.setFilePath(path);
    updateFileIndicator();
    const filename = path.split("/").pop() || path;
    document.title = `${filename} - MRMD`;
    requestAnimationFrame(() => {
      container.scrollTop = file.scrollTop;
    });
    if (isMarkdown) {
      const session = await SessionState2.getNotebookSession(path);
      ipython.setSession(session);
      SessionState2.setCurrentSessionName(session);
    }
  }
}
async function handleBeforeTabClose(path) {
  const file = appState.openFiles.get(path);
  if (SessionState2.isUntitledFile(path)) {
    return new Promise((resolve) => {
      openSavePickerForFile(path, {
        copyMode: false,
        closeAfter: true
      });
      resolve(false);
    });
  }
  if (file?.modified) {
    try {
      await services.documents.saveFile(path, file.content);
      externalChangeManager?.markAsSaved(path, file.content);
    } catch (err) {
      console.error("[Tabs] Error saving before close:", err);
    }
  }
  return true;
}
async function handleTabClose(path) {
  terminalTabs?.closeTerminalsForFile(path);
  externalChangeManager?.unregisterFile(path);
  if (services.collaboration.isConnected) {
    services.collaboration.unwatchFile(path);
  }
  if (currentYjsFilePath === path) {
    console.log("[Yjs] Cleaning up Yjs for closed file:", path);
    cleanupYjsCollab();
  }
  const newActivePath = appState.closeFile(path);
  if (newActivePath) {
    await handleTabSelect(newActivePath);
  } else {
    setContent("", true);
    rawTextarea.value = "";
    document.title = "MRMD";
    updateFileIndicator();
  }
}
async function openProject2(path) {
  console.log("[Codes] Opening project:", path);
  SessionState2.openProject(path);
}
async function handleProjectOpened(project) {
  console.log("[Codes] Project opened:", project.name);
  appState.setProject({
    path: project.path,
    name: project.name,
    type: null,
    environments: []
  });
  browserRoot = project.path;
  localStorage.setItem("mrmd_browser_root", browserRoot);
  fileBrowser?.setRoot(project.path);
  ipython.setProjectPath(project.path);
  ipython.setFigureDir(project.path + "/.mrmd/assets");
  setDocumentBasePath(project.path);
  if (!noCollab && !services.collaboration.isConnected) {
    try {
      await services.collaboration.connect({
        projectRoot: project.path,
        userName: "user",
        userType: "human"
      });
    } catch (err) {
      console.warn("[Collab] Connection failed:", err);
    }
  }
  if (project.skipFileOpen) {
    console.log("[Codes] Skipping file open (already opened)");
    return;
  }
  const cachedFiles = project.cachedFiles || {};
  const hasCachedFiles = Object.keys(cachedFiles).length > 0;
  if (hasCachedFiles) {
    console.log("[Codes] Using cached files from project pool:", Object.keys(cachedFiles).length);
  }
  const savedTabs = project.savedTabs;
  const fileToOpen = project.openFileAfter || savedTabs?.active;
  if (fileToOpen) {
    console.log("[Codes] Opening file after project switch:", fileToOpen, hasCachedFiles ? "(from cache)" : "");
    try {
      const cached = cachedFiles[fileToOpen];
      await openFile(fileToOpen, {
        cachedContent: cached?.content,
        cachedMtime: cached?.mtime
      });
    } catch (err) {
      console.warn("[Codes] Failed to open file:", fileToOpen, err);
    }
  }
  if (savedTabs?.tabs && savedTabs.tabs.length > 0) {
    const otherTabs = savedTabs.tabs.filter((t) => t !== fileToOpen);
    if (otherTabs.length > 0) {
      console.log("[Codes] Restoring other tabs in background:", otherTabs.length, hasCachedFiles ? "(from cache)" : "");
      SessionState2.setRestoringTabs(true);
      try {
        for (const tabPath of otherTabs) {
          try {
            const cached = cachedFiles[tabPath];
            await openFile(tabPath, {
              background: true,
              cachedContent: cached?.content,
              cachedMtime: cached?.mtime
            });
          } catch (err) {
            console.warn("[Codes] Failed to restore tab:", tabPath, err);
          }
        }
      } finally {
        SessionState2.setRestoringTabs(false);
      }
    }
  }
}
function handleProjectCreated({ mainNotebook }) {
  if (mainNotebook) {
    openFile(mainNotebook);
  }
}
function updateFileIndicator() {
  const indicator = document.querySelector(".current-file-indicator");
  if (!indicator)
    return;
  const currentPath = appState.currentFilePath;
  if (currentPath) {
    indicator.classList.add("visible");
    const fileName = currentPath.split("/").pop() || currentPath;
    const modified = appState.isModified;
    const nameEl = indicator.querySelector(".file-name");
    const saveBtn = indicator.querySelector(".save-btn");
    if (nameEl)
      nameEl.textContent = fileName + (modified ? " *" : "");
    if (saveBtn)
      saveBtn.classList.toggle("modified", modified);
  } else {
    indicator.classList.remove("visible");
  }
  aiPalette?.setCurrentFile(currentPath);
}
function updateRunningBadge(aiCount) {
  const badge = document.getElementById("running-badge");
  if (!badge)
    return;
  const countEl = badge.querySelector(".badge-count");
  if (countEl)
    countEl.textContent = String(aiCount);
  badge.classList.toggle("has-running", aiCount > 0);
}
function showNotification(title, message, type = "info") {
  if (notificationManager) {
    notificationManager.addLocalNotification(title, message, type);
  } else {
    console.log(`[Notification] ${type}: ${title} - ${message}`);
  }
}
async function showProjectMismatchDialog(viewedProject, activeProject) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "project-mismatch-dialog-overlay";
    overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
    const dialog = document.createElement("div");
    dialog.className = "project-mismatch-dialog";
    dialog.style.cssText = `
            background: var(--bg-primary, #1e1e1e);
            border: 1px solid var(--border-color, #333);
            border-radius: 8px;
            padding: 20px;
            max-width: 400px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;
    dialog.innerHTML = `
            <h3 style="margin: 0 0 12px 0; color: var(--text-primary, #fff);">
                Project Mismatch
            </h3>
            <p style="margin: 0 0 16px 0; color: var(--text-secondary, #aaa); line-height: 1.5;">
                This file is from <strong style="color: var(--accent-color, #4fc3f7);">${viewedProject}</strong>
                but the kernel is running in <strong style="color: var(--accent-color, #4fc3f7);">${activeProject}</strong>.
            </p>
            <p style="margin: 0 0 20px 0; color: var(--text-secondary, #aaa); font-size: 0.9em;">
                Would you like to switch to ${viewedProject}'s environment?
            </p>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button class="mismatch-btn cancel" style="
                    padding: 8px 16px;
                    border: 1px solid var(--border-color, #444);
                    background: transparent;
                    color: var(--text-secondary, #aaa);
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancel</button>
                <button class="mismatch-btn continue" style="
                    padding: 8px 16px;
                    border: 1px solid var(--border-color, #444);
                    background: transparent;
                    color: var(--text-primary, #fff);
                    border-radius: 4px;
                    cursor: pointer;
                ">Run in ${activeProject}</button>
                <button class="mismatch-btn switch" style="
                    padding: 8px 16px;
                    border: none;
                    background: var(--accent-color, #4fc3f7);
                    color: #000;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                ">Switch to ${viewedProject}</button>
            </div>
        `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const cleanup = () => {
      document.body.removeChild(overlay);
    };
    dialog.querySelector(".mismatch-btn.cancel")?.addEventListener("click", () => {
      cleanup();
      resolve("cancel");
    });
    dialog.querySelector(".mismatch-btn.continue")?.addEventListener("click", () => {
      cleanup();
      resolve("continue");
    });
    dialog.querySelector(".mismatch-btn.switch")?.addEventListener("click", () => {
      cleanup();
      resolve("switch");
    });
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", handleKeyDown);
        resolve("cancel");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    dialog.querySelector(".mismatch-btn.switch")?.focus();
  });
}
function initFileWatching() {
  externalChangeManager = new ExternalChangeHandlerManager();
  claudePresenceIndicator = new ClaudePresenceIndicator();
  conflictResolutionUI = new ConflictResolutionUI();
  externalChangeManager.setConflictStrategy("prompt");
  externalChangeManager.onPauseAutosave = () => pauseAutosave();
  externalChangeManager.onExternalChange = (info) => {
    const filename = info.filePath.split("/").pop() || info.filePath;
    const sourceLabel = info.source === "claude-code" ? "Claude" : info.source === "git" ? "Git" : "External edit";
    const conflictLabel = info.hadConflict ? " (resolved)" : "";
    if (info.source === "claude-code" && claudePresenceIndicator) {
      claudePresenceIndicator.show(info.filePath, info.linesChanged);
    }
    showNotification(
      `${sourceLabel} updated ${filename}`,
      `${info.linesChanged} line${info.linesChanged !== 1 ? "s" : ""} changed${conflictLabel}`,
      info.hadConflict ? "ai" : "info"
    );
  };
  externalChangeManager.onConflict = async (conflictInfo) => {
    console.log("[ExternalChangeManager] Conflict detected:", {
      filePath: conflictInfo.filePath,
      source: conflictInfo.source,
      linesChanged: conflictInfo.linesChanged,
      diffRegions: conflictInfo.diffRegions.length
    });
    appState.setPendingExternalChange(conflictInfo.filePath, {
      source: conflictInfo.source,
      detectedAt: Date.now(),
      newContent: conflictInfo.externalContent,
      hasConflict: true,
      linesChanged: conflictInfo.linesChanged
    });
    const filename = conflictInfo.filePath.split("/").pop() || conflictInfo.filePath;
    const sourceLabel = conflictInfo.source === "claude-code" ? "Claude" : "External";
    showNotification(
      `${sourceLabel} updated ${filename}`,
      `${conflictInfo.linesChanged} lines changed (your local changes will be kept in undo history)`,
      "ai"
    );
    return "accept";
  };
  console.log("[FileWatch] ExternalChangeHandlerManager initialized");
  if (noCollab) {
    startPollingFallback();
  } else {
    setTimeout(() => {
      if (!services.collaboration.isConnected) {
        console.log("[FileWatch] WebSocket not connected after 3s, starting polling fallback");
        startPollingFallback();
      }
    }, 3e3);
  }
}
function startPollingFallback() {
  if (fileCheckInterval)
    return;
  console.log("[FileWatch] Starting polling fallback");
  fileCheckInterval = setInterval(checkFileChanges, 2e3);
}
function stopPollingFallback() {
  if (fileCheckInterval) {
    console.log("[FileWatch] Stopping polling fallback");
    clearInterval(fileCheckInterval);
    fileCheckInterval = null;
  }
}
function detectExternalChangeSource(filePath) {
  if (activeAIUsers.size > 0) {
    for (const [, user] of activeAIUsers) {
      if (user.currentFile === filePath) {
        return "claude-code";
      }
    }
    const now = Date.now();
    for (const [, user] of activeAIUsers) {
      if (now - user.joinedAt < 3e4) {
        return "claude-code";
      }
    }
  }
  if (filePath.includes(".git/") || filePath.includes(".git\\")) {
    return "git";
  }
  const projectRoot = appState.project?.path;
  if (projectRoot) {
  }
  return "external";
}
function trackAIUserJoin(sessionId, userName, currentFile) {
  activeAIUsers.set(sessionId, {
    userName,
    joinedAt: Date.now(),
    currentFile
  });
  console.log(`[ClaudePresence] AI user joined: ${userName} (${sessionId})`);
  if (claudePresenceIndicator && currentFile) {
    claudePresenceIndicator.show(currentFile, 0);
  }
}
function trackAIUserLeave(sessionId) {
  const user = activeAIUsers.get(sessionId);
  if (user) {
    console.log(`[ClaudePresence] AI user left: ${user.userName} (${sessionId})`);
    activeAIUsers.delete(sessionId);
  }
}
async function catchUpMissedChanges() {
  const openFiles = appState.openFiles;
  if (openFiles.size === 0)
    return;
  console.log("[FileWatch] Catching up on missed changes...");
  const paths = Array.from(openFiles.keys());
  try {
    const result = await services.documents.getMtimes(paths);
    let changesFound = 0;
    for (const [path, newMtime] of Object.entries(result.mtimes)) {
      if (newMtime === null)
        continue;
      const file = openFiles.get(path);
      if (!file?.mtime)
        continue;
      if (Math.abs(newMtime - file.mtime) > 0.01) {
        console.log("[FileWatch] Catch-up: File changed while disconnected:", path);
        const source = detectExternalChangeSource(path);
        await handleExternalFileChange(path, source);
        changesFound++;
      }
    }
    if (changesFound > 0) {
      console.log(`[FileWatch] Catch-up complete: ${changesFound} file(s) updated`);
    } else {
      console.log("[FileWatch] Catch-up complete: No missed changes");
    }
  } catch (err) {
    console.warn("[FileWatch] Catch-up check failed:", err);
  }
}
async function checkFileChanges() {
  const openFiles = appState.openFiles;
  if (openFiles.size === 0)
    return;
  const paths = Array.from(openFiles.keys());
  try {
    const result = await services.documents.getMtimes(paths);
    for (const [path, newMtime] of Object.entries(result.mtimes)) {
      if (newMtime === null)
        continue;
      const file = openFiles.get(path);
      if (!file?.mtime)
        continue;
      if (Math.abs(newMtime - file.mtime) > 0.01) {
        const source = detectExternalChangeSource(path);
        console.log("[FileWatch] Polling detected change:", path, { source });
        await handleExternalFileChange(path, source);
      }
    }
  } catch (err) {
  }
}
async function handleExternalFileChange(path, source = "unknown", capturedContent) {
  const file = appState.openFiles.get(path);
  if (!file) {
    console.log("[FileWatch] Ignoring change for unopened file:", path);
    return;
  }
  if (externalChangeManager) {
    await externalChangeManager.handleFileChanged(
      path,
      source,
      // loadFile callback - if capturedContent is provided from WebSocket, use it
      // This prevents race conditions where autosave could overwrite external changes
      async () => {
        if (capturedContent !== void 0 && capturedContent !== null) {
          console.log("[FileWatch] Using captured content from WebSocket, length:", capturedContent.length);
          return capturedContent;
        }
        console.log("[FileWatch] Reading content from disk (no captured content)");
        const fileData = await services.documents.readFile(path);
        return fileData.content;
      },
      // applyChange callback - returns true if change was applied
      (newContent) => {
        return applyExternalChangeToFile(path, newContent, source);
      },
      // getCurrentContent callback
      () => {
        return path === appState.currentFilePath ? getContent() : file.content;
      }
    );
  } else {
    console.log("[FileWatch] Manager not initialized, applying directly");
    try {
      const content = capturedContent ?? (await services.documents.readFile(path)).content;
      applyExternalChangeToFile(path, content, source);
    } catch (err) {
      console.error("[FileWatch] Error handling file change:", err);
      showNotification("File sync error", `Failed to sync ${path}: ${err}`, "error");
    }
  }
}
function applyExternalChangeToFile(path, newContent, source) {
  const file = appState.openFiles.get(path);
  if (!file)
    return false;
  const isCurrentFile = path === appState.currentFilePath;
  const currentContent = isCurrentFile ? getContent() : file.content;
  if (newContent === currentContent) {
    console.log("[FileWatch] Content unchanged:", path);
    return false;
  }
  if (isCurrentFile) {
    const scrollTop = container.scrollTop;
    const changed = editor.applyExternalChange(newContent, source);
    if (changed) {
      rawTextarea.value = newContent;
      requestAnimationFrame(() => {
        container.scrollTop = scrollTop;
      });
    }
  }
  appState.applyExternalChange(path, newContent, null);
  return true;
}
function getAiContext() {
  const selInfo = getSelectionInfo();
  const markdown = getContent();
  const contextRadius = 500;
  const start = Math.max(0, selInfo.cursor - contextRadius);
  const end = Math.min(markdown.length, selInfo.cursor + contextRadius);
  const localContext = markdown.slice(start, end);
  return {
    text: markdown,
    cursor: selInfo.cursor,
    documentContext: markdown,
    localContext,
    // Also provide selection info
    selection: selInfo.selectedText,
    hasSelection: selInfo.hasSelection,
    selectionStart: selInfo.hasSelection ? editor.view.state.selection.main.from : void 0,
    selectionEnd: selInfo.hasSelection ? editor.view.state.selection.main.to : void 0
  };
}
function handleAiActionStart(actionId, ctx) {
  console.log("[AI] Action start:", actionId);
  if (!aiActionHandler) {
    console.error("[AI] Action handler not initialized");
    return;
  }
  const context = ctx;
  aiActionHandler.handleActionStart(actionId, context).catch((err) => {
    console.error("[AI] Failed to start action:", err);
  });
}
function handleAiChunk(actionId, chunk, ctx) {
  if (!aiActionHandler)
    return;
  const context = ctx;
  aiActionHandler.handleChunk(actionId, chunk, context).catch((err) => {
    console.error("[AI] Failed to stream chunk:", err);
  });
}
function handleAiAction(actionId, result, ctx) {
  console.log("[AI] Action complete:", actionId, result);
  if (!aiActionHandler) {
    console.error("[AI] Action handler not initialized");
    return;
  }
  const context = ctx;
  aiActionHandler.handleAction(actionId, result, context).then((success) => {
    if (success) {
      const currentPath = appState.currentFilePath;
      if (currentPath) {
        appState.markFileModified(currentPath);
        scheduleAutosave();
        updateFileIndicator();
      }
    }
  }).catch((err) => {
    console.error("[AI] Unexpected error in action handler:", err);
  });
}
function initSidebarTabs() {
  const tabs = document.querySelectorAll(".sidebar-tab");
  const panels = document.querySelectorAll(".sidebar-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const panelId = tab.dataset.panel;
      if (!panelId)
        return;
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = document.getElementById(`${panelId}-panel`);
      panel?.classList.add("active");
      appState.setActivePanel(panelId);
    });
  });
}
function initSidebarResizer() {
  const resizer = document.getElementById("sidebar-resizer");
  const sidebar = document.querySelector(".sidebar");
  if (!resizer || !sidebar)
    return;
  let isResizing = false;
  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isResizing)
      return;
    const newWidth = window.innerWidth - e.clientX;
    sidebar.style.width = `${Math.max(200, Math.min(600, newWidth))}px`;
  });
  document.addEventListener("mouseup", () => {
    isResizing = false;
    document.body.style.cursor = "";
  });
}
function initThemePicker() {
  const btn = document.getElementById("theme-picker-btn");
  const dropdown = document.getElementById("theme-picker-dropdown");
  if (!btn || !dropdown)
    return;
  btn.addEventListener("click", () => {
    dropdown.classList.toggle("visible");
  });
  dropdown.querySelectorAll(".theme-option").forEach((option) => {
    option.addEventListener("click", () => {
      const theme = option.dataset.theme;
      if (theme) {
        appState.setTheme(theme);
        dropdown.classList.remove("visible");
      }
    });
  });
  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove("visible");
    }
  });
}
function initModeToggle() {
  const modeBtn = document.getElementById("mode-toggle-btn");
  modeBtn?.addEventListener("click", () => {
    toggleMode();
  });
}
async function loadInitialState() {
  browserRoot = localStorage.getItem("mrmd_browser_root") || "/home";
  const params = new URLSearchParams(window.location.search);
  const urlFile = params.get("file");
  if (urlFile) {
    await openFile(urlFile);
    SessionState2.initialize();
    return;
  }
  const lastProject = localStorage.getItem("mrmd_last_project");
  if (lastProject) {
    const savedTabsJson = localStorage.getItem(`mrmd_tabs_${lastProject}`);
    if (savedTabsJson) {
      try {
        const savedTabs = JSON.parse(savedTabsJson);
        const activeFile = savedTabs.active;
        if (activeFile) {
          console.log("[Restore] Instant restore:", activeFile);
          await openFile(activeFile);
          const scrollTop = savedTabs.scrollPositions?.[activeFile]?.scrollTop || 0;
          if (scrollTop > 0) {
            requestAnimationFrame(() => {
              const editorEl = document.getElementById("editor-container");
              if (editorEl)
                editorEl.scrollTop = scrollTop;
            });
          }
          await SessionState2.openProject(lastProject, true, {
            skipFileOpen: true,
            cachedActiveFile: activeFile
          });
          const otherTabs = (savedTabs.tabs || []).filter((t) => t !== activeFile);
          if (otherTabs.length > 0) {
            console.log("[Restore] Restoring other tabs in background:", otherTabs.length);
            SessionState2.setRestoringTabs(true);
            Promise.all(
              otherTabs.map(
                (tabPath) => openFile(tabPath, { background: true }).catch(() => {
                })
              )
            ).finally(() => {
              SessionState2.setRestoringTabs(false);
            });
          }
          SessionState2.initialize();
          return;
        }
      } catch (err) {
        console.warn("[Restore] Failed to parse saved tabs:", err);
      }
    }
  }
  await SessionState2.initialize();
  HomeScreen.show();
}
var services, editor, currentYjsDoc, currentYjsAdapter, currentYjsFilePath, useCollaboration, ipython, ipythonExecutor, aiClient, fileTabs, fileBrowser, terminalTabs, notificationManager, aiPalette, historyPanel, interfaceManager, aiActionHandler, container, rawTextarea, cursorPosEl, execStatusEl, browserRoot, documentBasePath, silentUpdate, AUTOSAVE_DELAY, AUTOSAVE_MAX_INTERVAL, autosaveTimer, lastSaveTime, autosavePaused, fileCheckInterval, noCollab, currentFileLoadId, externalChangeManager, ExternalChangeHandlerManager, ClaudePresenceIndicator, claudePresenceIndicator, ConflictResolutionUI, conflictResolutionUI, activeAIUsers;
var init_codes = __esm({
  "src/apps/codes/index.ts"() {
    "use strict";
    init_AppState();
    init_imageUrl();
    init_InterfaceManager();
    init_ai_action_handler();
    currentYjsDoc = null;
    currentYjsAdapter = null;
    currentYjsFilePath = null;
    useCollaboration = true;
    notificationManager = null;
    historyPanel = null;
    interfaceManager = null;
    aiActionHandler = null;
    browserRoot = "/home";
    documentBasePath = "";
    silentUpdate = false;
    AUTOSAVE_DELAY = 2e3;
    AUTOSAVE_MAX_INTERVAL = 3e4;
    autosaveTimer = null;
    lastSaveTime = Date.now();
    autosavePaused = false;
    fileCheckInterval = null;
    noCollab = false;
    currentFileLoadId = 0;
    externalChangeManager = null;
    ExternalChangeHandlerManager = class {
      constructor() {
        __publicField(this, "handlers", /* @__PURE__ */ new Map());
        __publicField(this, "conflictStrategy", "external-wins");
        __publicField(this, "debounceMs", 100);
        /**
         * Callback for conflict resolution (Step 6 will implement the UI)
         * Returns: 'accept' (use external), 'reject' (keep local), 'merge' (attempt merge)
         */
        __publicField(this, "onConflict", null);
        /**
         * Callback when external change is applied
         */
        __publicField(this, "onExternalChange", null);
        /**
         * Callback to pause autosave during external change processing
         * Returns a function to resume autosave
         */
        __publicField(this, "onPauseAutosave", null);
      }
      /**
       * Set the conflict resolution strategy
       */
      setConflictStrategy(strategy) {
        this.conflictStrategy = strategy;
      }
      /**
       * Register a file for external change handling
       * Called when a file is opened
       */
      registerFile(filePath, initialContent) {
        this.unregisterFile(filePath);
        const handler = {
          filePath,
          lastKnownContent: initialContent,
          lastKnownMtime: Date.now(),
          pendingCheck: null,
          pendingResumeAutosave: null,
          destroyed: false,
          capturedExternalContent: null,
          capturedSource: null
        };
        this.handlers.set(filePath, handler);
        console.log("[ExternalChangeManager] Registered file:", filePath);
      }
      /**
       * Unregister a file (called when file is closed)
       */
      unregisterFile(filePath) {
        const handler = this.handlers.get(filePath);
        if (handler) {
          handler.destroyed = true;
          if (handler.pendingCheck) {
            clearTimeout(handler.pendingCheck);
          }
          if (handler.pendingResumeAutosave) {
            handler.pendingResumeAutosave();
            handler.pendingResumeAutosave = null;
          }
          this.handlers.delete(filePath);
          console.log("[ExternalChangeManager] Unregistered file:", filePath);
        }
      }
      /**
       * Mark a file as saved (updates lastKnownContent)
       * Called after save operations
       */
      markAsSaved(filePath, content) {
        const handler = this.handlers.get(filePath);
        if (handler) {
          handler.lastKnownContent = content;
          handler.lastKnownMtime = Date.now();
        }
      }
      /**
       * Check if a file has local changes relative to last known state
       */
      hasLocalChanges(filePath, currentContent) {
        const handler = this.handlers.get(filePath);
        if (!handler)
          return false;
        return currentContent !== handler.lastKnownContent;
      }
      /**
       * Handle an external file change event (debounced)
       *
       * IMPORTANT: We capture the file content IMMEDIATELY when the event arrives,
       * not after the debounce delay. This prevents a race condition where autosave
       * could overwrite external changes before we can detect them.
       */
      async handleFileChanged(filePath, source, loadFile, applyChange, getCurrentContent) {
        const handler = this.handlers.get(filePath);
        if (!handler || handler.destroyed) {
          console.log("[ExternalChangeManager] No handler for file:", filePath);
          return;
        }
        if (!handler.pendingResumeAutosave) {
          handler.pendingResumeAutosave = this.onPauseAutosave?.() ?? null;
        }
        try {
          const capturedContent = await loadFile();
          handler.capturedExternalContent = capturedContent;
          handler.capturedSource = source;
          console.log("[ExternalChangeManager] Captured external content immediately, length:", capturedContent.length);
        } catch (err) {
          console.error("[ExternalChangeManager] Failed to capture content:", err);
          handler.pendingResumeAutosave?.();
          handler.pendingResumeAutosave = null;
          return;
        }
        if (handler.pendingCheck) {
          clearTimeout(handler.pendingCheck);
        }
        handler.pendingCheck = setTimeout(async () => {
          handler.pendingCheck = null;
          const resumeAutosave = handler.pendingResumeAutosave;
          handler.pendingResumeAutosave = null;
          const capturedContent = handler.capturedExternalContent;
          const capturedSource = handler.capturedSource || source;
          handler.capturedExternalContent = null;
          handler.capturedSource = null;
          if (!capturedContent) {
            console.log("[ExternalChangeManager] No captured content, skipping");
            resumeAutosave?.();
            return;
          }
          try {
            await this.checkAndApplyChanges(
              handler,
              capturedSource,
              capturedContent,
              // Pass the captured content directly
              applyChange,
              getCurrentContent
            );
          } finally {
            resumeAutosave?.();
          }
        }, this.debounceMs);
      }
      /**
       * Actually check and apply changes (after debounce)
       *
       * @param capturedContent - Content captured immediately when WebSocket event arrived
       *                          This is NOT re-read from disk to avoid race conditions
       */
      async checkAndApplyChanges(handler, source, capturedContent, applyChange, getCurrentContent) {
        if (handler.destroyed)
          return;
        try {
          const newContent = capturedContent;
          const currentContent = getCurrentContent();
          if (newContent === handler.lastKnownContent) {
            console.log("[ExternalChangeManager] No external change (disk matches last known state)");
            return;
          }
          if (newContent === currentContent) {
            console.log("[ExternalChangeManager] Editor already has this content, updating lastKnown");
            handler.lastKnownContent = newContent;
            handler.lastKnownMtime = Date.now();
            return;
          }
          const hasLocalChanges = currentContent !== handler.lastKnownContent;
          const linesChanged = this.countLinesChanged(handler.lastKnownContent, newContent);
          console.log("[ExternalChangeManager] External change detected:", {
            filePath: handler.filePath,
            source,
            hasLocalChanges,
            linesChanged
          });
          let shouldApply = true;
          let canAutoMerge = false;
          let mergedContent = null;
          if (hasLocalChanges) {
            const baseContent = handler.lastKnownContent;
            const localChangedLines = this.getChangedLineRanges(baseContent, currentContent);
            const externalChangedLines = this.getChangedLineRanges(baseContent, newContent);
            const hasOverlap = this.rangesOverlap(localChangedLines, externalChangedLines);
            console.log("[ExternalChangeManager] Checking merge possibility:", {
              localRanges: localChangedLines,
              externalRanges: externalChangedLines,
              hasOverlap
            });
            if (!hasOverlap && localChangedLines.length > 0 && externalChangedLines.length > 0) {
              mergedContent = this.attemptThreeWayMerge(baseContent, currentContent, newContent);
              if (mergedContent !== null) {
                canAutoMerge = true;
                console.log("[ExternalChangeManager] Auto-merging non-overlapping changes");
              }
            }
            if (!canAutoMerge) {
              const conflictInfo = {
                filePath: handler.filePath,
                localContent: currentContent,
                externalContent: newContent,
                source,
                linesChanged,
                diffRegions: this.computeDiff(currentContent, newContent)
              };
              if (this.conflictStrategy === "prompt" && this.onConflict) {
                const decision = await this.onConflict(conflictInfo);
                shouldApply = decision === "accept" || decision === "merge";
                if (decision === "reject") {
                  console.log("[ExternalChangeManager] User rejected external changes");
                }
              } else if (this.conflictStrategy === "local-wins") {
                shouldApply = false;
                console.log("[ExternalChangeManager] Local wins, ignoring external change");
              }
            }
          }
          if (shouldApply || canAutoMerge) {
            const contentToApply = canAutoMerge && mergedContent !== null ? mergedContent : newContent;
            const changed = applyChange(contentToApply);
            if (changed) {
              handler.lastKnownContent = newContent;
              handler.lastKnownMtime = Date.now();
              this.onExternalChange?.({
                filePath: handler.filePath,
                source,
                linesChanged,
                hadConflict: hasLocalChanges && !canAutoMerge
              });
              if (canAutoMerge) {
                console.log("[ExternalChangeManager] Successfully auto-merged changes");
              }
            }
          }
        } catch (error) {
          console.error("[ExternalChangeManager] Failed to handle file change:", error);
        }
      }
      /**
       * Compute diff regions between two content strings
       */
      computeDiff(local, external) {
        const localLines = local.split("\n");
        const externalLines = external.split("\n");
        const regions = [];
        let i = 0;
        let j = 0;
        while (i < localLines.length || j < externalLines.length) {
          while (i < localLines.length && j < externalLines.length && localLines[i] === externalLines[j]) {
            i++;
            j++;
          }
          if (i >= localLines.length && j >= externalLines.length) {
            break;
          }
          const startLine = i;
          const diffLocalLines = [];
          const diffExternalLines = [];
          while (i < localLines.length && j < externalLines.length && localLines[i] !== externalLines[j]) {
            diffLocalLines.push(localLines[i]);
            diffExternalLines.push(externalLines[j]);
            i++;
            j++;
          }
          while (i < localLines.length && (j >= externalLines.length || localLines[i] !== externalLines[j])) {
            diffLocalLines.push(localLines[i]);
            i++;
          }
          while (j < externalLines.length && (i >= localLines.length || localLines[i] !== externalLines[j])) {
            diffExternalLines.push(externalLines[j]);
            j++;
          }
          if (diffLocalLines.length > 0 || diffExternalLines.length > 0) {
            regions.push({
              startLine,
              endLine: Math.max(startLine + diffLocalLines.length, startLine + diffExternalLines.length),
              localLines: diffLocalLines,
              externalLines: diffExternalLines
            });
          }
        }
        return regions;
      }
      /**
       * Count approximate number of lines changed
       */
      countLinesChanged(oldContent, newContent) {
        const oldLines = oldContent.split("\n");
        const newLines = newContent.split("\n");
        let changed = 0;
        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          if (oldLines[i] !== newLines[i]) {
            changed++;
          }
        }
        return changed;
      }
      /**
       * Get line ranges that changed between base and modified content.
       * Returns array of [start, end] tuples (0-indexed, inclusive).
       */
      getChangedLineRanges(base, modified) {
        const baseLines = base.split("\n");
        const modLines = modified.split("\n");
        const ranges = [];
        let i = 0;
        while (i < baseLines.length || i < modLines.length) {
          while (i < baseLines.length && i < modLines.length && baseLines[i] === modLines[i]) {
            i++;
          }
          if (i >= baseLines.length && i >= modLines.length)
            break;
          const start = i;
          while (i < baseLines.length || i < modLines.length) {
            if (i < baseLines.length && i < modLines.length && baseLines[i] === modLines[i]) {
              break;
            }
            i++;
          }
          ranges.push([start, i - 1]);
        }
        return ranges;
      }
      /**
       * Check if any two ranges overlap.
       */
      rangesOverlap(ranges1, ranges2) {
        for (const [s1, e1] of ranges1) {
          for (const [s2, e2] of ranges2) {
            if (s1 <= e2 && s2 <= e1) {
              return true;
            }
          }
        }
        return false;
      }
      /**
       * Attempt a simple 3-way merge.
       * Works when local and external changes don't overlap.
       *
       * Strategy: Start with external content, then apply local changes
       * that aren't overwritten by external changes.
       */
      attemptThreeWayMerge(base, local, external) {
        try {
          const baseLines = base.split("\n");
          const localLines = local.split("\n");
          const externalLines = external.split("\n");
          const localChanges = this.getLineChanges(baseLines, localLines);
          const externalChanges = this.getLineChanges(baseLines, externalLines);
          const result = [...externalLines];
          for (const [lineNum, localLine] of localChanges) {
            const externalChangedThis = externalChanges.some(([ln]) => ln === lineNum);
            if (!externalChangedThis) {
              if (result.length > lineNum) {
                result[lineNum] = localLine;
              }
            }
          }
          if (localLines.length > baseLines.length) {
            const appendStart = baseLines.length;
            const localAppended = localLines.slice(appendStart);
            if (externalLines.length <= baseLines.length) {
              result.push(...localAppended);
            } else if (externalLines.length === baseLines.length + (externalLines.length - baseLines.length)) {
              result.push(...localAppended);
            }
          }
          return result.join("\n");
        } catch {
          return null;
        }
      }
      /**
       * Get map of line number -> new content for changed lines
       */
      getLineChanges(base, modified) {
        const changes = [];
        const minLen = Math.min(base.length, modified.length);
        for (let i = 0; i < minLen; i++) {
          if (base[i] !== modified[i]) {
            changes.push([i, modified[i]]);
          }
        }
        return changes;
      }
      /**
       * Get handler for a file (for debugging/testing)
       */
      getHandler(filePath) {
        return this.handlers.get(filePath);
      }
      /**
       * Get all registered file paths
       */
      getRegisteredFiles() {
        return Array.from(this.handlers.keys());
      }
      /**
       * Destroy all handlers
       */
      destroy() {
        for (const handler of this.handlers.values()) {
          handler.destroyed = true;
          if (handler.pendingCheck) {
            clearTimeout(handler.pendingCheck);
          }
        }
        this.handlers.clear();
      }
    };
    ClaudePresenceIndicator = class {
      constructor() {
        __publicField(this, "state", {
          activeFiles: /* @__PURE__ */ new Map(),
          indicatorEl: null,
          dismissTimeout: null,
          isVisible: false
        });
        /** How long to show the indicator after last activity (ms) */
        __publicField(this, "DISMISS_DELAY", 5e3);
        /** Color for Claude's presence (purple/violet to distinguish from humans) */
        __publicField(this, "CLAUDE_COLOR", "#8b5cf6");
        this.createIndicatorElement();
      }
      /**
       * Create the indicator DOM element
       */
      createIndicatorElement() {
        if (document.getElementById("claude-presence-indicator")) {
          this.state.indicatorEl = document.getElementById("claude-presence-indicator");
          return;
        }
        const indicator = document.createElement("div");
        indicator.id = "claude-presence-indicator";
        indicator.className = "claude-presence-indicator";
        indicator.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: ${this.CLAUDE_COLOR};
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
            z-index: 1000;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            pointer-events: none;
        `;
        const icon = document.createElement("span");
        icon.textContent = "\u{1F916}";
        icon.style.fontSize = "16px";
        indicator.appendChild(icon);
        const text = document.createElement("span");
        text.className = "claude-presence-text";
        text.textContent = "Claude is editing...";
        indicator.appendChild(text);
        const dot = document.createElement("span");
        dot.className = "claude-presence-dot";
        dot.style.cssText = `
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            animation: claude-presence-pulse 1.5s ease-in-out infinite;
        `;
        indicator.appendChild(dot);
        if (!document.getElementById("claude-presence-styles")) {
          const style = document.createElement("style");
          style.id = "claude-presence-styles";
          style.textContent = `
                @keyframes claude-presence-pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(0.8); }
                }
                .claude-presence-indicator.visible {
                    opacity: 1 !important;
                    transform: translateY(0) !important;
                }
            `;
          document.head.appendChild(style);
        }
        document.body.appendChild(indicator);
        this.state.indicatorEl = indicator;
      }
      /**
       * Show the Claude presence indicator
       */
      show(filePath, linesChanged = 0) {
        const now = Date.now();
        const existing = this.state.activeFiles.get(filePath);
        if (existing) {
          existing.lastActivity = now;
          existing.linesChanged += linesChanged;
        } else {
          this.state.activeFiles.set(filePath, {
            startedAt: now,
            lastActivity: now,
            linesChanged
          });
        }
        this.updateIndicatorText();
        if (!this.state.isVisible && this.state.indicatorEl) {
          this.state.indicatorEl.classList.add("visible");
          this.state.isVisible = true;
        }
        this.scheduleDismiss();
      }
      /**
       * Update the indicator text based on active files
       */
      updateIndicatorText() {
        if (!this.state.indicatorEl)
          return;
        const textEl = this.state.indicatorEl.querySelector(".claude-presence-text");
        if (!textEl)
          return;
        const fileCount = this.state.activeFiles.size;
        if (fileCount === 0) {
          textEl.textContent = "Claude is editing...";
        } else if (fileCount === 1) {
          const [filePath] = this.state.activeFiles.keys();
          const fileName = filePath.split("/").pop() || filePath;
          textEl.textContent = `Claude is editing ${fileName}`;
        } else {
          textEl.textContent = `Claude is editing ${fileCount} files`;
        }
      }
      /**
       * Schedule auto-dismissal of the indicator
       */
      scheduleDismiss() {
        if (this.state.dismissTimeout) {
          clearTimeout(this.state.dismissTimeout);
        }
        this.state.dismissTimeout = setTimeout(() => {
          this.hide();
        }, this.DISMISS_DELAY);
      }
      /**
       * Hide the Claude presence indicator
       */
      hide() {
        if (this.state.indicatorEl) {
          this.state.indicatorEl.classList.remove("visible");
        }
        this.state.isVisible = false;
        this.state.activeFiles.clear();
        if (this.state.dismissTimeout) {
          clearTimeout(this.state.dismissTimeout);
          this.state.dismissTimeout = null;
        }
      }
      /**
       * Check if Claude is currently active on any file
       */
      isActive() {
        return this.state.activeFiles.size > 0;
      }
      /**
       * Check if Claude is active on a specific file
       */
      isActiveOnFile(filePath) {
        return this.state.activeFiles.has(filePath);
      }
      /**
       * Destroy the indicator
       */
      destroy() {
        this.hide();
        if (this.state.indicatorEl) {
          this.state.indicatorEl.remove();
          this.state.indicatorEl = null;
        }
      }
    };
    claudePresenceIndicator = null;
    ConflictResolutionUI = class {
      constructor() {
        __publicField(this, "modalEl", null);
        __publicField(this, "resolvePromise", null);
        __publicField(this, "currentConflict", null);
        /** Colors matching the design system */
        __publicField(this, "COLORS", {
          primary: "#3b82f6",
          // Blue for primary actions
          danger: "#ef4444",
          // Red for destructive/reject
          success: "#22c55e",
          // Green for additions
          warning: "#f59e0b",
          // Amber for warnings
          muted: "#6b7280",
          // Gray for secondary text
          background: "#1f2937",
          // Dark background
          surface: "#374151",
          // Slightly lighter surface
          border: "#4b5563",
          // Border color
          text: "#f9fafb",
          // Light text
          textMuted: "#9ca3af",
          // Muted text
          diffAdd: "rgba(34, 197, 94, 0.2)",
          // Green background for additions
          diffRemove: "rgba(239, 68, 68, 0.2)",
          // Red background for removals
          claude: "#8b5cf6"
          // Claude's purple
        });
        this.injectStyles();
      }
      /**
       * Inject CSS styles for the conflict resolution modal
       */
      injectStyles() {
        if (document.getElementById("conflict-resolution-styles"))
          return;
        const style = document.createElement("style");
        style.id = "conflict-resolution-styles";
        style.textContent = `
            .conflict-modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            .conflict-modal-overlay.visible {
                opacity: 1;
            }
            .conflict-modal {
                background: ${this.COLORS.background};
                border: 1px solid ${this.COLORS.border};
                border-radius: 12px;
                width: 90%;
                max-width: 600px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                transform: scale(0.95) translateY(10px);
                transition: transform 0.2s ease;
            }
            .conflict-modal-overlay.visible .conflict-modal {
                transform: scale(1) translateY(0);
            }
            .conflict-modal-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                border-bottom: 1px solid ${this.COLORS.border};
            }
            .conflict-modal-icon {
                font-size: 24px;
            }
            .conflict-modal-title {
                flex: 1;
            }
            .conflict-modal-title h2 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: ${this.COLORS.text};
            }
            .conflict-modal-title p {
                margin: 4px 0 0;
                font-size: 13px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-modal-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
            }
            .conflict-summary {
                display: flex;
                gap: 16px;
                margin-bottom: 16px;
            }
            .conflict-stat {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-stat-value {
                color: ${this.COLORS.text};
                font-weight: 500;
            }
            .conflict-diff-toggle {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: ${this.COLORS.surface};
                border: 1px solid ${this.COLORS.border};
                border-radius: 6px;
                color: ${this.COLORS.text};
                font-size: 13px;
                cursor: pointer;
                margin-bottom: 12px;
                transition: background 0.15s ease;
            }
            .conflict-diff-toggle:hover {
                background: ${this.COLORS.border};
            }
            .conflict-diff-toggle .arrow {
                transition: transform 0.2s ease;
            }
            .conflict-diff-toggle.expanded .arrow {
                transform: rotate(90deg);
            }
            .conflict-diff-container {
                display: none;
                border: 1px solid ${this.COLORS.border};
                border-radius: 6px;
                overflow: hidden;
                margin-bottom: 16px;
            }
            .conflict-diff-container.visible {
                display: block;
            }
            .conflict-diff-header {
                display: flex;
                background: ${this.COLORS.surface};
                border-bottom: 1px solid ${this.COLORS.border};
                font-size: 12px;
                font-weight: 500;
            }
            .conflict-diff-header > div {
                flex: 1;
                padding: 8px 12px;
                color: ${this.COLORS.textMuted};
            }
            .conflict-diff-header > div:first-child {
                border-right: 1px solid ${this.COLORS.border};
            }
            .conflict-diff-content {
                display: flex;
                font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
                font-size: 12px;
                line-height: 1.5;
                max-height: 300px;
                overflow-y: auto;
            }
            .conflict-diff-side {
                flex: 1;
                padding: 8px 0;
                overflow-x: auto;
            }
            .conflict-diff-side:first-child {
                border-right: 1px solid ${this.COLORS.border};
            }
            .conflict-diff-line {
                display: flex;
                padding: 0 12px;
                min-height: 20px;
            }
            .conflict-diff-line.removed {
                background: ${this.COLORS.diffRemove};
            }
            .conflict-diff-line.added {
                background: ${this.COLORS.diffAdd};
            }
            .conflict-diff-line-number {
                width: 32px;
                color: ${this.COLORS.muted};
                text-align: right;
                padding-right: 12px;
                user-select: none;
                flex-shrink: 0;
            }
            .conflict-diff-line-content {
                flex: 1;
                white-space: pre;
                color: ${this.COLORS.text};
            }
            .conflict-modal-footer {
                display: flex;
                gap: 12px;
                padding: 16px 20px;
                border-top: 1px solid ${this.COLORS.border};
                justify-content: flex-end;
            }
            .conflict-btn {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.15s ease;
                border: 1px solid transparent;
            }
            .conflict-btn-secondary {
                background: ${this.COLORS.surface};
                border-color: ${this.COLORS.border};
                color: ${this.COLORS.text};
            }
            .conflict-btn-secondary:hover {
                background: ${this.COLORS.border};
            }
            .conflict-btn-danger {
                background: transparent;
                border-color: ${this.COLORS.danger};
                color: ${this.COLORS.danger};
            }
            .conflict-btn-danger:hover {
                background: ${this.COLORS.danger};
                color: white;
            }
            .conflict-btn-primary {
                background: ${this.COLORS.primary};
                color: white;
            }
            .conflict-btn-primary:hover {
                background: #2563eb;
            }
            .conflict-btn-claude {
                background: ${this.COLORS.claude};
                color: white;
            }
            .conflict-btn-claude:hover {
                background: #7c3aed;
            }
        `;
        document.head.appendChild(style);
      }
      /**
       * Show the conflict resolution modal
       * Returns a promise that resolves with the user's decision
       */
      show(conflictInfo) {
        return new Promise((resolve) => {
          this.resolvePromise = resolve;
          this.currentConflict = conflictInfo;
          this.createModal(conflictInfo);
        });
      }
      /**
       * Create and display the modal
       */
      createModal(info) {
        this.destroy();
        const filename = info.filePath.split("/").pop() || info.filePath;
        const sourceLabel = this.getSourceLabel(info.source);
        const sourceIcon = this.getSourceIcon(info.source);
        const overlay = document.createElement("div");
        overlay.className = "conflict-modal-overlay";
        overlay.onclick = (e) => {
          if (e.target === overlay) {
            this.handleDecision("reject");
          }
        };
        const modal = document.createElement("div");
        modal.className = "conflict-modal";
        modal.innerHTML = `
            <div class="conflict-modal-header">
                <span class="conflict-modal-icon">${sourceIcon}</span>
                <div class="conflict-modal-title">
                    <h2>Changes from ${sourceLabel}</h2>
                    <p>${filename} was modified while you had unsaved changes</p>
                </div>
            </div>
            <div class="conflict-modal-body">
                <div class="conflict-summary">
                    <div class="conflict-stat">
                        <span>Lines changed:</span>
                        <span class="conflict-stat-value">${info.linesChanged}</span>
                    </div>
                    <div class="conflict-stat">
                        <span>Regions:</span>
                        <span class="conflict-stat-value">${info.diffRegions.length}</span>
                    </div>
                </div>
                <button class="conflict-diff-toggle" id="conflict-diff-toggle">
                    <span class="arrow">\u25B6</span>
                    <span>View differences</span>
                </button>
                <div class="conflict-diff-container" id="conflict-diff-container">
                    ${this.renderDiff(info)}
                </div>
                <p style="font-size: 13px; color: ${this.COLORS.textMuted}; margin: 0;">
                    Choose how to handle this conflict:
                </p>
            </div>
            <div class="conflict-modal-footer">
                <span style="font-size: 11px; color: ${this.COLORS.muted}; margin-right: auto;">
                    <kbd style="padding: 2px 6px; background: ${this.COLORS.surface}; border-radius: 3px; font-family: inherit;">Esc</kbd> Keep \xB7
                    <kbd style="padding: 2px 6px; background: ${this.COLORS.surface}; border-radius: 3px; font-family: inherit;">Enter</kbd> Accept
                </span>
                <button class="conflict-btn conflict-btn-secondary" id="conflict-btn-reject">
                    Keep my changes
                </button>
                <button class="conflict-btn ${info.source === "claude-code" ? "conflict-btn-claude" : "conflict-btn-primary"}" id="conflict-btn-accept">
                    ${info.source === "claude-code" ? "Accept Claude's changes" : "Accept external changes"}
                </button>
            </div>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.modalEl = overlay;
        const diffToggle = modal.querySelector("#conflict-diff-toggle");
        const diffContainer = modal.querySelector("#conflict-diff-container");
        diffToggle?.addEventListener("click", () => {
          diffToggle.classList.toggle("expanded");
          diffContainer.classList.toggle("visible");
        });
        const acceptBtn = modal.querySelector("#conflict-btn-accept");
        const rejectBtn = modal.querySelector("#conflict-btn-reject");
        acceptBtn?.addEventListener("click", () => this.handleDecision("accept"));
        rejectBtn?.addEventListener("click", () => this.handleDecision("reject"));
        const handleKeydown = (e) => {
          if (e.key === "Escape") {
            this.handleDecision("reject");
          } else if (e.key === "Enter" && !e.shiftKey) {
            this.handleDecision("accept");
          }
        };
        document.addEventListener("keydown", handleKeydown);
        overlay._keydownHandler = handleKeydown;
        requestAnimationFrame(() => {
          overlay.classList.add("visible");
        });
      }
      /**
       * Render the diff view
       */
      renderDiff(info) {
        if (info.diffRegions.length === 0) {
          return `
                <div class="conflict-diff-content" style="padding: 16px; color: ${this.COLORS.textMuted};">
                    No visible differences (possibly whitespace only)
                </div>
            `;
        }
        let localHtml = "";
        let externalHtml = "";
        for (const region of info.diffRegions) {
          const maxLines = Math.max(region.localLines.length, region.externalLines.length);
          for (let i = 0; i < maxLines; i++) {
            const lineNum = region.startLine + i + 1;
            const localLine = region.localLines[i];
            const externalLine = region.externalLines[i];
            if (localLine !== void 0) {
              localHtml += `
                        <div class="conflict-diff-line removed">
                            <span class="conflict-diff-line-number">${lineNum}</span>
                            <span class="conflict-diff-line-content">${this.escapeHtml(localLine)}</span>
                        </div>
                    `;
            } else {
              localHtml += `
                        <div class="conflict-diff-line">
                            <span class="conflict-diff-line-number"></span>
                            <span class="conflict-diff-line-content"></span>
                        </div>
                    `;
            }
            if (externalLine !== void 0) {
              externalHtml += `
                        <div class="conflict-diff-line added">
                            <span class="conflict-diff-line-number">${lineNum}</span>
                            <span class="conflict-diff-line-content">${this.escapeHtml(externalLine)}</span>
                        </div>
                    `;
            } else {
              externalHtml += `
                        <div class="conflict-diff-line">
                            <span class="conflict-diff-line-number"></span>
                            <span class="conflict-diff-line-content"></span>
                        </div>
                    `;
            }
          }
        }
        return `
            <div class="conflict-diff-header">
                <div>Your changes (will be lost)</div>
                <div>Incoming changes</div>
            </div>
            <div class="conflict-diff-content">
                <div class="conflict-diff-side">${localHtml}</div>
                <div class="conflict-diff-side">${externalHtml}</div>
            </div>
        `;
      }
      /**
       * Handle user decision
       */
      handleDecision(decision) {
        if (this.resolvePromise) {
          this.resolvePromise(decision);
          this.resolvePromise = null;
        }
        this.destroy();
      }
      /**
       * Get a human-readable label for the source
       */
      getSourceLabel(source) {
        switch (source) {
          case "claude-code":
            return "Claude";
          case "git":
            return "Git";
          case "external":
            return "External Editor";
          default:
            return "Unknown Source";
        }
      }
      /**
       * Get an icon for the source
       */
      getSourceIcon(source) {
        switch (source) {
          case "claude-code":
            return "\u{1F916}";
          case "git":
            return "\u{1F4E6}";
          case "external":
            return "\u{1F4DD}";
          default:
            return "\u2753";
        }
      }
      /**
       * Escape HTML special characters
       */
      escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }
      /**
       * Destroy the modal
       */
      destroy() {
        if (this.modalEl) {
          const handler = this.modalEl._keydownHandler;
          if (handler) {
            document.removeEventListener("keydown", handler);
          }
          this.modalEl.remove();
          this.modalEl = null;
        }
        this.currentConflict = null;
      }
    };
    conflictResolutionUI = null;
    activeAIUsers = /* @__PURE__ */ new Map();
  }
});

// src/services/DocumentService.ts
var DocumentService = class {
  constructor() {
    __publicField(this, "_currentFile", null);
    __publicField(this, "_files", /* @__PURE__ */ new Map());
    // Event listeners
    __publicField(this, "_listeners", {
      fileChanged: /* @__PURE__ */ new Set(),
      fileOpened: /* @__PURE__ */ new Set(),
      fileClosed: /* @__PURE__ */ new Set()
    });
  }
  get currentFile() {
    return this._currentFile;
  }
  async _postJson(endpoint, body = {}) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || response.statusText;
      throw new Error(message);
    }
    return data;
  }
  async readFile(path) {
    return this._postJson("/api/file/read", { path });
  }
  async writeFile(path, content, options = {}) {
    return this._postJson("/api/file/write", {
      path,
      content,
      ...options
    });
  }
  async listDirectory(path, options = {}) {
    return this._postJson("/api/file/list", {
      path,
      show_hidden: options.showHidden ?? false
    });
  }
  async fileExists(path) {
    return this._postJson("/api/file/exists", { path });
  }
  async createDirectory(path) {
    return this._postJson("/api/file/mkdir", { path });
  }
  async copyPath(srcPath, destPath) {
    return this._postJson("/api/file/copy", {
      src_path: srcPath,
      dest_path: destPath
    });
  }
  async uploadFiles(destDir, files) {
    const formData = new FormData();
    formData.append("dest_dir", destDir);
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    const response = await fetch("/api/file/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || response.statusText;
      throw new Error(message);
    }
    return data;
  }
  async getMtimes(paths) {
    return this._postJson("/api/file/mtimes", { paths });
  }
  async searchFiles(options) {
    return this._postJson("/api/files/search", {
      query: options.query ?? "",
      root: options.root,
      mode: options.mode,
      extensions: options.extensions,
      max_results: options.maxResults,
      include_hidden: options.includeHidden
    });
  }
  async grepStream(options) {
    return fetch("/api/files/grep/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: options.query,
        root: options.root,
        max_results: options.maxResults,
        extensions: options.extensions,
        case_sensitive: options.caseSensitive
      })
    });
  }
  async detectProject(path) {
    return this._postJson("/api/project/detect", { path });
  }
  async listEnvironments(projectRoot) {
    return this._postJson("/api/environments/list", {
      project_root: projectRoot
    });
  }
  async openFile(path) {
    if (this._files.has(path)) {
      const file = this._files.get(path);
      this._currentFile = file;
      this._emit("fileOpened", file);
      return file;
    }
    try {
      const data = await this.readFile(path);
      const file = {
        path: data.path || path,
        content: data.content || "",
        modified: false,
        lastSaved: Date.now(),
        projectRoot: data.project_root ?? null,
        environments: data.environments || [],
        mtime: data.mtime,
        versionId: data.version_id ?? null
      };
      this._files.set(path, file);
      if (file.path !== path) {
        this._files.set(file.path, file);
      }
      this._currentFile = file;
      this._emit("fileOpened", file);
      return file;
    } catch (err) {
      console.error("[DocumentService] Error opening file:", err);
      throw err;
    }
  }
  async saveFile(path, content, options = {}) {
    try {
      const data = await this.writeFile(path, content, {
        author: "user:editor",
        ...options
      });
      const file = this._files.get(path) || this._files.get(data.path);
      if (file) {
        file.path = data.path;
        file.content = content;
        file.modified = false;
        file.lastSaved = Date.now();
        file.mtime = data.mtime;
        file.versionId = data.version_id ?? file.versionId;
        file.projectRoot = data.project_root ?? file.projectRoot;
        this._files.set(file.path, file);
        this._emit("fileChanged", file);
      }
    } catch (err) {
      console.error("[DocumentService] Error saving file:", err);
      throw err;
    }
  }
  async createFile(path, content = "") {
    await this.saveFile(path, content);
    return this.openFile(path);
  }
  async closeFile(path) {
    if (this._files.has(path)) {
      this._files.delete(path);
      if (this._currentFile?.path === path) {
        this._currentFile = null;
      }
      this._emit("fileClosed", path);
    }
  }
  async renameFile(oldPath, newPath) {
    try {
      await this._postJson("/api/file/rename", {
        old_path: oldPath,
        new_path: newPath
      });
      if (this._files.has(oldPath)) {
        const file = this._files.get(oldPath);
        file.path = newPath;
        this._files.delete(oldPath);
        this._files.set(newPath, file);
        if (this._currentFile?.path === oldPath) {
          this._currentFile = file;
        }
        this._emit("fileChanged", file);
      }
    } catch (err) {
      console.error("[DocumentService] Error renaming file:", err);
      throw err;
    }
  }
  async deleteFile(path, options = {}) {
    try {
      await this._postJson("/api/file/delete", {
        path,
        recursive: options.recursive ?? false
      });
      await this.closeFile(path);
    } catch (err) {
      console.error("[DocumentService] Error deleting file:", err);
      throw err;
    }
  }
  async copyFile(srcPath, destPath) {
    try {
      await this._postJson("/api/file/copy", {
        src_path: srcPath,
        dest_path: destPath
      });
    } catch (err) {
      console.error("[DocumentService] Error copying file:", err);
      throw err;
    }
  }
  async moveFile(srcPath, destPath) {
    await this.renameFile(srcPath, destPath);
  }
  markModified(path, modified) {
    const file = this._files.get(path);
    if (file && file.modified !== modified) {
      file.modified = modified;
      this._emit("fileChanged", file);
    }
  }
  updateContent(path, content) {
    const file = this._files.get(path);
    if (file) {
      file.content = content;
      this._emit("fileChanged", file);
    }
  }
  async getRecentFiles() {
    return Array.from(new Set(this._files.keys()));
  }
  // Events
  onFileChanged(callback) {
    this._listeners.fileChanged.add(callback);
    return () => this._listeners.fileChanged.delete(callback);
  }
  onFileOpened(callback) {
    this._listeners.fileOpened.add(callback);
    return () => this._listeners.fileOpened.delete(callback);
  }
  onFileClosed(callback) {
    this._listeners.fileClosed.add(callback);
    return () => this._listeners.fileClosed.delete(callback);
  }
  _emit(event, ...args) {
    this._listeners[event].forEach((cb) => cb(...args));
  }
};

// src/services/CollaborationService.ts
var CollaborationService = class {
  constructor() {
    __publicField(this, "ws", null);
    __publicField(this, "connected", false);
    __publicField(this, "sessionInfo", null);
    __publicField(this, "connectOptions", null);
    __publicField(this, "heartbeatTimer", null);
    __publicField(this, "listeners", {
      connected: /* @__PURE__ */ new Set(),
      disconnected: /* @__PURE__ */ new Set(),
      presence: /* @__PURE__ */ new Set(),
      userJoined: /* @__PURE__ */ new Set(),
      userLeft: /* @__PURE__ */ new Set(),
      cursor: /* @__PURE__ */ new Set(),
      fileSaved: /* @__PURE__ */ new Set(),
      fileChanged: /* @__PURE__ */ new Set(),
      directoryChanged: /* @__PURE__ */ new Set(),
      watchFileAck: /* @__PURE__ */ new Set(),
      watchDirectoryAck: /* @__PURE__ */ new Set(),
      simpleSync: /* @__PURE__ */ new Set(),
      yjsSync: /* @__PURE__ */ new Set(),
      yjsUpdate: /* @__PURE__ */ new Set()
    });
  }
  get isConnected() {
    return this.connected;
  }
  async connect(options) {
    if (this.ws && this.connected) {
      return;
    }
    this.connectOptions = options;
    const url = this.buildUrl(options);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.startHeartbeat();
        resolve();
      };
      ws.onerror = () => {
        if (!this.connected) {
          reject(new Error("Collaboration connection failed"));
        }
      };
      ws.onclose = (event) => {
        this.connected = false;
        this.stopHeartbeat();
        this.sessionInfo = null;
        this.ws = null;
        this.emit("disconnected", event);
      };
      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }
  async disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.sessionInfo = null;
  }
  getSessionInfo() {
    return this.sessionInfo;
  }
  joinFile(filePath) {
    this.send({ type: "join_file", file_path: filePath });
  }
  leaveFile() {
    this.send({ type: "leave_file" });
  }
  updateCursor(mdOffset, selection) {
    this.send({
      type: "cursor",
      md_offset: mdOffset,
      selection: selection ? { mdStart: selection.mdStart, mdEnd: selection.mdEnd } : null
    });
  }
  notifyFileSaved(filePath, versionId, content) {
    this.send({
      type: "file_saved",
      file_path: filePath,
      version_id: versionId ?? null,
      content: content ?? null
    });
  }
  getPresence(filePath) {
    this.send({
      type: "get_presence",
      file_path: filePath
    });
  }
  saveFile(filePath) {
    this.send({ type: "save_file", file_path: filePath });
  }
  watchFile(filePath) {
    this.send({ type: "watch_file", file_path: filePath });
  }
  unwatchFile(filePath) {
    this.send({ type: "unwatch_file", file_path: filePath });
  }
  watchDirectory(dirPath) {
    this.send({ type: "watch_directory", dir_path: dirPath });
  }
  unwatchDirectory(dirPath) {
    this.send({ type: "unwatch_directory", dir_path: dirPath });
  }
  sendSimpleSync(subtype, payload, targetSession) {
    this.send({
      type: "simple_sync",
      subtype,
      payload,
      target_session: targetSession
    });
  }
  sendYjsSync(subtype, payload) {
    this.send({
      type: "yjs_sync",
      subtype,
      payload
    });
  }
  onConnected(callback) {
    this.listeners.connected.add(callback);
    return () => this.listeners.connected.delete(callback);
  }
  onDisconnected(callback) {
    this.listeners.disconnected.add(callback);
    return () => this.listeners.disconnected.delete(callback);
  }
  onPresence(callback) {
    this.listeners.presence.add(callback);
    return () => this.listeners.presence.delete(callback);
  }
  onUserJoined(callback) {
    this.listeners.userJoined.add(callback);
    return () => this.listeners.userJoined.delete(callback);
  }
  onUserLeft(callback) {
    this.listeners.userLeft.add(callback);
    return () => this.listeners.userLeft.delete(callback);
  }
  onCursor(callback) {
    this.listeners.cursor.add(callback);
    return () => this.listeners.cursor.delete(callback);
  }
  onFileSaved(callback) {
    this.listeners.fileSaved.add(callback);
    return () => this.listeners.fileSaved.delete(callback);
  }
  onFileChanged(callback) {
    this.listeners.fileChanged.add(callback);
    return () => this.listeners.fileChanged.delete(callback);
  }
  onDirectoryChanged(callback) {
    this.listeners.directoryChanged.add(callback);
    return () => this.listeners.directoryChanged.delete(callback);
  }
  onWatchFileAck(callback) {
    this.listeners.watchFileAck.add(callback);
    return () => this.listeners.watchFileAck.delete(callback);
  }
  onWatchDirectoryAck(callback) {
    this.listeners.watchDirectoryAck.add(callback);
    return () => this.listeners.watchDirectoryAck.delete(callback);
  }
  onSimpleSync(callback) {
    this.listeners.simpleSync.add(callback);
    return () => this.listeners.simpleSync.delete(callback);
  }
  onYjsSync(callback) {
    this.listeners.yjsSync.add(callback);
    return () => this.listeners.yjsSync.delete(callback);
  }
  onYjsUpdate(callback) {
    this.listeners.yjsUpdate.add(callback);
    return () => this.listeners.yjsUpdate.delete(callback);
  }
  buildUrl(options) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      project: options.projectRoot,
      user: options.userName || "Anonymous",
      type: options.userType || "human"
    });
    return `${protocol}//${window.location.host}/api/collab?${params.toString()}`;
  }
  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
  handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    switch (data.type) {
      case "connected":
        this.sessionInfo = {
          session_id: data.session_id,
          color: data.color,
          user_name: this.connectOptions?.userName,
          user_type: this.connectOptions?.userType
        };
        this.emit("connected", this.sessionInfo);
        break;
      case "presence":
        this.emit("presence", data);
        break;
      case "user_joined":
      case "user_joined_file":
        this.emit("userJoined", data);
        break;
      case "user_left":
      case "user_left_file":
        this.emit("userLeft", data);
        break;
      case "cursor":
        this.emit("cursor", data);
        break;
      case "file_saved":
        this.emit("fileSaved", data);
        break;
      case "file_changed":
        this.emit("fileChanged", data);
        break;
      case "directory_changed":
        this.emit("directoryChanged", data);
        break;
      case "watch_file_ack":
        this.emit("watchFileAck", data);
        break;
      case "watch_directory_ack":
        this.emit("watchDirectoryAck", data);
        break;
      case "simple_sync":
        this.emit("simpleSync", data);
        break;
      case "yjs_sync":
        this.emit("yjsSync", data);
        break;
      case "yjs_update":
        this.emit("yjsUpdate", data);
        break;
      default:
        break;
    }
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: "heartbeat" });
    }, 25e3);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  emit(event, payload) {
    this.listeners[event].forEach((listener) => {
      listener(payload);
    });
  }
};

// src/boot.ts
function detectMode() {
  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get("mode");
  if (modeParam === "study" || modeParam === "codes") {
    return modeParam;
  }
  const hostname = window.location.hostname;
  if (hostname === "atelier.study" || hostname.includes("study")) {
    return "study";
  }
  if (hostname === "atelier.codes" || hostname.includes("codes")) {
    return "codes";
  }
  return "study";
}
function createServices() {
  return {
    documents: new DocumentService(),
    collaboration: new CollaborationService()
  };
}
async function boot() {
  const mode = detectMode();
  const defaultInterface = mode === "study" ? "compact" : "developer";
  console.log(`[Boot] Starting Atelier (${mode} \u2192 ${defaultInterface} mode)...`);
  const services2 = createServices();
  console.log("[Boot] Services initialized");
  try {
    const app = await Promise.resolve().then(() => (init_codes(), codes_exports));
    await app.mount(services2, { defaultMode: defaultInterface });
    console.log(`[Boot] ${mode === "study" ? "Study" : "Codes"} mode ready`);
  } catch (err) {
    console.error("[Boot] Failed to load app:", err);
    showBootError(err);
  }
}
function showBootError(err) {
  const message = err instanceof Error ? err.message : String(err);
  document.body.innerHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background: #1a1b26;
            color: #f7768e;
            font-family: system-ui, -apple-system, sans-serif;
            padding: 20px;
            text-align: center;
        ">
            <h1 style="font-size: 24px; margin-bottom: 16px;">Failed to start Atelier</h1>
            <pre style="
                background: rgba(255, 255, 255, 0.05);
                padding: 16px 24px;
                border-radius: 8px;
                font-size: 14px;
                max-width: 600px;
                overflow-x: auto;
            ">${message}</pre>
            <button onclick="location.reload()" style="
                margin-top: 24px;
                padding: 12px 24px;
                background: rgba(122, 162, 247, 0.15);
                border: 1px solid rgba(122, 162, 247, 0.3);
                border-radius: 6px;
                color: #7aa2f7;
                cursor: pointer;
                font-size: 14px;
            ">Reload</button>
        </div>
    `;
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
//# sourceMappingURL=boot.js.map

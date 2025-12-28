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
  IPythonExecutor
} from "/editor-dist/index.browser.js";
import { IPythonClient as IPythonClient2 } from "/core/ipython-client.js";
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
import { initEditorKeybindings } from "/core/editor-keybindings.js";
async function mount(svc, options = {}) {
  const defaultMode = options.defaultMode ?? "developer";
  const modeName = defaultMode === "compact" ? "Study" : "Codes";
  console.log(`[Atelier] Mounting in ${modeName} mode (${defaultMode})...`);
  services = svc;
  SessionState2.setInterfaceMode(defaultMode);
  SessionState2.setAppState(appState);
  noCollab = new URLSearchParams(window.location.search).has("noCollab");
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
  ipython = new IPythonClient2({ apiBase: "" });
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
        rawTextarea.value = doc;
        const currentPath = appState.currentFilePath;
        if (currentPath) {
          appState.updateFileContent(currentPath, doc, true);
          scheduleAutosave();
          updateFileIndicator();
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
  collab.onConnected((info) => {
    console.log("[Collab] Connected:", info.session_id);
    stopPollingFallback();
    for (const path of appState.openFiles.keys()) {
      collab.watchFile(path);
    }
  });
  collab.onDisconnected(() => {
    console.log("[Collab] Disconnected");
    startPollingFallback();
  });
  collab.onFileChanged((payload) => {
    console.log("[Collab] File changed:", payload.file_path);
    handleExternalFileChange(payload.file_path);
  });
  collab.onFileSaved((payload) => {
    console.log("[Collab] File saved by:", payload.user_name);
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
  SessionState2.on("project-opened", handleProjectOpened);
  SessionState2.on("project-created", handleProjectCreated);
  SessionState2.on("kernel-initializing", ({ message }) => {
    execStatusEl.textContent = message || "initializing...";
    execStatusEl.classList.add("kernel-switching");
  });
  SessionState2.on("kernel-ready", () => {
    execStatusEl.textContent = "ready";
    execStatusEl.classList.remove("kernel-switching");
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
    let file;
    if (options.cachedContent !== void 0) {
      file = { content: options.cachedContent, mtime: options.cachedMtime };
      console.log("[Codes] Using cached content for:", path);
    } else {
      file = await services.documents.openFile(path);
    }
    if (loadId !== currentFileLoadId && !options.background) {
      console.log("[Codes] Skipping stale file load:", path, `(loadId: ${loadId}, current: ${currentFileLoadId})`);
      return;
    }
    appState.openFile(path, file.content, {
      mtime: file.mtime ?? null,
      modified: false
    });
    if (services.collaboration.isConnected) {
      services.collaboration.watchFile(path);
    }
    const filename = path.split("/").pop() || path;
    fileTabs?.addTab(path, filename, false);
    if (!options.background) {
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
      if (path.endsWith(".md")) {
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
    await services.documents.saveFile(filePath, file.content, { message: "autosave" });
    appState.markFileSaved(filePath);
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
  if (currentPath && currentPath !== path) {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    appState.saveEditorState(currentPath, editor.view.state);
    appState.updateFileScrollTop(currentPath, container.scrollTop);
  }
  const file = appState.openFiles.get(path);
  if (file) {
    const savedState = appState.getEditorState(path);
    if (savedState) {
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
    if (path.endsWith(".md")) {
      const session = await SessionState2.getNotebookSession(path);
      ipython.setSession(session);
      SessionState2.setCurrentSessionName(session);
    }
  }
}
async function handleBeforeTabClose(path) {
  const file = appState.openFiles.get(path);
  if (file?.modified) {
    try {
      await services.documents.saveFile(path, file.content);
    } catch (err) {
      console.error("[Tabs] Error saving before close:", err);
    }
  }
}
async function handleTabClose(path) {
  terminalTabs?.closeTerminalsForFile(path);
  if (services.collaboration.isConnected) {
    services.collaboration.unwatchFile(path);
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
  ipython.setSession("main");
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
function initFileWatching() {
  if (noCollab) {
    startPollingFallback();
  } else {
    setTimeout(() => {
      if (!services.collaboration.isConnected) {
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
        console.log("[FileWatch] File changed:", path);
        await handleExternalFileChange(path);
      }
    }
  } catch (err) {
  }
}
async function handleExternalFileChange(path) {
  try {
    const file = appState.openFiles.get(path);
    if (!file)
      return;
    if (file.modified) {
      console.log("[FileWatch] Skipping update - file has unsaved local changes:", path);
      return;
    }
    const fileData = await services.documents.readFile(path);
    const newContent = fileData.content;
    if (path === appState.currentFilePath) {
      const oldContent = getContent();
      if (newContent !== oldContent) {
        const scrollTop = container.scrollTop;
        const changed = editor.applyExternalChange(newContent, "external");
        if (changed) {
          rawTextarea.value = newContent;
          requestAnimationFrame(() => {
            container.scrollTop = scrollTop;
          });
        }
      }
    }
    appState.openFile(path, newContent, { mtime: fileData.mtime ?? null });
  } catch (err) {
    console.error("[FileWatch] Error handling file change:", err);
  }
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
var services, editor, ipython, ipythonExecutor, aiClient, fileTabs, fileBrowser, terminalTabs, notificationManager, aiPalette, historyPanel, interfaceManager, aiActionHandler, container, rawTextarea, cursorPosEl, execStatusEl, browserRoot, documentBasePath, silentUpdate, AUTOSAVE_DELAY, AUTOSAVE_MAX_INTERVAL, autosaveTimer, lastSaveTime, autosavePaused, fileCheckInterval, noCollab, currentFileLoadId;
var init_codes = __esm({
  "src/apps/codes/index.ts"() {
    "use strict";
    init_AppState();
    init_imageUrl();
    init_InterfaceManager();
    init_ai_action_handler();
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

// src/services/IPythonClient.ts
var IPythonClient = class {
  constructor(options = {}) {
    __publicField(this, "apiBase");
    __publicField(this, "sessionId");
    __publicField(this, "projectPath");
    __publicField(this, "figureDir");
    __publicField(this, "_fetch");
    this.apiBase = options.apiBase || "";
    this.sessionId = options.sessionId || "main";
    this.projectPath = options.projectPath || null;
    this.figureDir = options.figureDir || null;
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
  }
  setSession(sessionId) {
    this.sessionId = sessionId;
  }
  setProjectPath(projectPath) {
    this.projectPath = projectPath;
  }
  setFigureDir(figureDir) {
    this.figureDir = figureDir;
  }
  async _request(endpoint, body = {}) {
    try {
      const requestBody = { session: this.sessionId, ...body };
      if (this.figureDir) {
        requestBody.figure_dir = this.figureDir;
      }
      if (this.projectPath) {
        requestBody.project_path = this.projectPath;
      }
      const res = await this._fetch(`${this.apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`IPython API error (${endpoint}):`, err);
      return null;
    }
  }
  async _get(endpoint) {
    try {
      const res = await this._fetch(`${this.apiBase}${endpoint}`, {
        method: "GET"
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`IPython API error (${endpoint}):`, err);
      return null;
    }
  }
  async complete(code, cursorPos) {
    return this._request("/api/ipython/complete", { code, cursor_pos: cursorPos });
  }
  async inspect(code, cursorPos, detailLevel = 0) {
    return this._request("/api/ipython/inspect", {
      code,
      cursor_pos: cursorPos,
      detail_level: detailLevel
    });
  }
  async execute(code, storeHistory = true) {
    return this._request("/api/ipython/execute", {
      code,
      store_history: storeHistory
    });
  }
  async executeStreaming(code, onChunk, storeHistory = true) {
    return new Promise((resolve, reject) => {
      let finalResult = null;
      const body = {
        code,
        session: this.sessionId,
        store_history: storeHistory
      };
      if (this.projectPath) {
        body.project_path = this.projectPath;
      }
      if (this.figureDir) {
        body.figure_dir = this.figureDir;
      }
      this._fetch(`${this.apiBase}/api/ipython/execute/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Streaming execution failed: ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error("No response body");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done)
            break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventType = "";
          let eventData = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6);
              if (eventType && eventData) {
                try {
                  const parsed = JSON.parse(eventData);
                  if (eventType === "chunk") {
                    const accumulated = parsed.accumulated || parsed.content || "";
                    onChunk(accumulated, false);
                  } else if (eventType === "result") {
                    finalResult = parsed;
                  } else if (eventType === "done") {
                    onChunk(finalResult?.formatted_output || "", true);
                    resolve(finalResult);
                  }
                } catch (e) {
                  console.error("SSE parse error:", e);
                }
                eventType = "";
                eventData = "";
              }
            }
          }
        }
        if (finalResult) {
          resolve(finalResult);
        } else {
          resolve(null);
        }
      }).catch((error) => {
        console.error("Streaming execution error:", error);
        reject(error);
      });
    });
  }
  async getVariables() {
    return this._request("/api/ipython/variables", {});
  }
  async hoverInspect(name) {
    return this._request("/api/ipython/hover", { name });
  }
  async isComplete(code) {
    return this._request("/api/ipython/is_complete", { code });
  }
  async inspectObject(path) {
    return this._request("/api/ipython/inspect_object", { path });
  }
  async reset() {
    return this._request("/api/ipython/reset", {});
  }
  async interrupt() {
    return this._request("/api/ipython/interrupt", {});
  }
  async sessionInfo() {
    return this._request("/api/ipython/session_info", {});
  }
  async reconfigure(options = {}) {
    return this._request("/api/ipython/reconfigure", {
      python_path: options.pythonPath,
      cwd: options.cwd
    });
  }
  async listSessions() {
    return this._get("/api/ipython/sessions");
  }
  async formatCode(code, language = "python") {
    return this._request("/api/ipython/format", { code, language });
  }
  async restartServer() {
    return this._request("/api/server/restart", {});
  }
};

// src/services/ExecutionService.ts
var ExecutionService = class {
  constructor() {
    __publicField(this, "client");
    __publicField(this, "_isRunning", false);
    __publicField(this, "_listeners", {
      executionStart: /* @__PURE__ */ new Set(),
      executionComplete: /* @__PURE__ */ new Set(),
      statusChange: /* @__PURE__ */ new Set()
    });
    this.client = new IPythonClient();
  }
  get isRunning() {
    return this._isRunning;
  }
  setProjectPath(path) {
    this.client.setProjectPath(path);
    this.client.setFigureDir(path + "/.mrmd/assets");
  }
  setSessionId(sessionId) {
    this.client.setSession(sessionId);
  }
  async runCode(code, lang) {
    return this.runBlock(void 0, code, lang);
  }
  async runBlock(blockId, code, lang) {
    if (this._isRunning) {
      console.warn("Execution already in progress, queueing not yet implemented in Service");
    }
    this._isRunning = true;
    this._emit("statusChange", "busy");
    this._emit("executionStart", blockId);
    try {
      if (lang !== "python") {
        const result2 = {
          success: false,
          stdout: "",
          stderr: `Language '${lang}' not supported yet in ExecutionService`,
          result: "",
          display_data: []
        };
        this._finish(result2, blockId);
        return result2;
      }
      const result = await this.client.executeStreaming(code, (accumulated, done) => {
      });
      if (!result) {
        throw new Error("Execution returned null");
      }
      this._finish(result, blockId);
      return result;
    } catch (err) {
      const errorResult = {
        success: false,
        stdout: "",
        stderr: err.message || "Unknown execution error",
        result: "",
        error: {
          ename: "Error",
          evalue: err.message,
          traceback: []
        },
        display_data: []
      };
      this._finish(errorResult, blockId);
      return errorResult;
    }
  }
  _finish(result, blockId) {
    this._isRunning = false;
    this._emit("statusChange", "idle");
    this._emit("executionComplete", result, blockId);
  }
  async cancelExecution() {
    await this.interruptKernel();
  }
  async restartKernel() {
    this._emit("statusChange", "starting");
    await this.client.restartServer();
    this._emit("statusChange", "idle");
  }
  async interruptKernel() {
    await this.client.interrupt();
  }
  async resetKernel() {
    await this.client.reset();
  }
  async getVariables() {
    return this.client.getVariables();
  }
  async complete(code, cursorPos) {
    return this.client.complete(code, cursorPos);
  }
  async inspect(code, cursorPos, detailLevel = 0) {
    return this.client.inspect(code, cursorPos, detailLevel);
  }
  async inspectObject(path) {
    return this.client.inspectObject(path);
  }
  async hover(name) {
    return this.client.hoverInspect(name);
  }
  async isComplete(code) {
    return this.client.isComplete(code);
  }
  async getSessionInfo() {
    return this.client.sessionInfo();
  }
  async listSessions() {
    return this.client.listSessions();
  }
  async reconfigureSession(options) {
    return this.client.reconfigure(options);
  }
  async formatCode(code, language = "python") {
    return this.client.formatCode(code, language);
  }
  // Events
  onExecutionStart(callback) {
    this._listeners.executionStart.add(callback);
    return () => this._listeners.executionStart.delete(callback);
  }
  onExecutionComplete(callback) {
    this._listeners.executionComplete.add(callback);
    return () => this._listeners.executionComplete.delete(callback);
  }
  onStatusChange(callback) {
    this._listeners.statusChange.add(callback);
    return () => this._listeners.statusChange.delete(callback);
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
  return "codes";
}
function createServices() {
  return {
    documents: new DocumentService(),
    execution: new ExecutionService(),
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

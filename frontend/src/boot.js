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
          theme: "default",
          zenMode: false
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
        this._currentFilePath = path;
        this._notifyFileChange(file, path);
        return file;
      }
      closeFile(path) {
        if (!this._openFiles.has(path))
          return null;
        this._openFiles.delete(path);
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
          if (this._currentFilePath === oldPath) {
            this._currentFilePath = newPath;
          }
          this._notifyFileChange(file, newPath);
        }
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
      setZenMode(zenMode) {
        this._ui.zenMode = zenMode;
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
      return `/api/file/relative/${url}?base=${encodeURIComponent(basePath)}`;
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

// src/apps/study/index.ts
var study_exports = {};
__export(study_exports, {
  mount: () => mount
});
import {
  createEditor,
  IPythonExecutor,
  createMinimalIPythonClient
} from "/editor-dist/index.browser.js";
import { IPythonClient as IPythonClient2 } from "/core/ipython-client.js";
import * as SessionState from "/core/session-state.js";
import { AiClient } from "/core/ai-client.js";
import { createAiPalette } from "/core/ai-palette.js";
import { initSelectionToolbar } from "/core/selection-toolbar.js";
async function mount(svc) {
  console.log("[Study] Mounting Writer Mode...");
  services = svc;
  container = document.getElementById("editor-container");
  if (!container) {
    renderStudyUI();
    container = document.getElementById("editor-container");
  }
  hideDevChrome();
  initClients();
  initEditor();
  setupKeyboardShortcuts();
  await loadInitialState();
  console.log("[Study] Writer Mode ready");
}
function renderStudyUI() {
  const appFrame = document.querySelector(".app-frame");
  if (appFrame)
    return;
  document.body.innerHTML = `
        <div class="study-container">
            <div class="study-header">
                <span class="study-file-name" id="study-file-name"></span>
                <span class="study-status" id="study-status"></span>
            </div>
            <div class="study-editor" id="editor-container"></div>
        </div>
        <style>
            .study-container {
                display: flex;
                flex-direction: column;
                height: 100vh;
                background: var(--bg, #1a1b26);
            }
            .study-header {
                display: flex;
                justify-content: space-between;
                padding: 12px 24px;
                font-size: 12px;
                color: var(--muted, #565f89);
                opacity: 0;
                transition: opacity 0.2s;
            }
            .study-container:hover .study-header {
                opacity: 1;
            }
            .study-editor {
                flex: 1;
                max-width: 800px;
                margin: 0 auto;
                width: 100%;
                padding: 40px 24px;
                overflow-y: auto;
            }
        </style>
    `;
}
function hideDevChrome() {
  const sidebar = document.querySelector(".sidebar");
  if (sidebar)
    sidebar.style.display = "none";
  const resizer = document.getElementById("sidebar-resizer");
  if (resizer)
    resizer.style.display = "none";
  const fileTabs2 = document.getElementById("file-tabs-container");
  if (fileTabs2)
    fileTabs2.style.display = "none";
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) {
    const hideItems = statusBar.querySelectorAll(
      ".restart-btn, .view-mode-group, .ai-run-group, .theme-picker-wrapper, .session-badge, .venv-badge"
    );
    hideItems.forEach((item) => item.style.display = "none");
  }
  document.body.classList.add("study-mode");
}
function initClients() {
  ipython = new IPythonClient2({ apiBase: "" });
  aiClient = new AiClient();
}
function initEditor() {
  const ipythonClient = createMinimalIPythonClient("");
  const executor = new IPythonExecutor({ client: ipythonClient });
  const resolveImageUrl = createImageUrlResolver(() => documentBasePath);
  editor = createEditor({
    parent: container,
    doc: "",
    executor,
    theme: "zen",
    resolveImageUrl,
    onChange: (doc) => {
      if (!silentUpdate) {
        const currentPath = appState.currentFilePath;
        if (currentPath) {
          appState.updateFileContent(currentPath, doc, true);
          scheduleAutosave();
          updateFileIndicator();
        }
      }
    },
    onCursorChange: (_info) => {
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
  const aiPalette2 = createAiPalette({
    aiClient,
    onAction: handleAiAction,
    onError: (err) => console.error("[AI] Error:", err),
    getContext: () => ({
      text: editor.getDoc(),
      cursor: getSelectionInfo().cursor,
      documentContext: editor.getDoc()
    })
  });
  aiPalette2.attachToEditor({
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
  editor.focus();
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
function getSelectionInfo() {
  const state = editor.view.state;
  const selection = state.selection.main;
  return {
    cursor: selection.head,
    hasSelection: !selection.empty,
    selectedText: state.sliceDoc(selection.from, selection.to)
  };
}
async function openFile(path) {
  console.log("[Study] Opening file:", path);
  try {
    const file = await services.documents.openFile(path);
    appState.openFile(path, file.content, {
      mtime: file.mtime ?? null,
      modified: false
    });
    setContent(file.content, true);
    const filename = path.split("/").pop() || path;
    document.title = filename.replace(/\.md$/, "");
    updateFileIndicator();
    if (path.endsWith(".md")) {
      const session = await SessionState.getNotebookSession(path);
      ipython.setSession(session);
    }
  } catch (err) {
    console.error("[Study] Failed to open file:", err);
  }
}
async function saveFile() {
  const currentPath = appState.currentFilePath;
  if (!currentPath)
    return;
  try {
    await services.documents.saveFile(currentPath, getContent());
    appState.markFileSaved(currentPath);
    updateFileIndicator();
  } catch (err) {
    console.error("[Study] Save failed:", err);
  }
}
function scheduleAutosave() {
  const currentPath = appState.currentFilePath;
  if (!currentPath || !appState.isModified)
    return;
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }
  autosaveTimer = setTimeout(async () => {
    if (appState.currentFilePath && appState.isModified) {
      await saveFile();
    }
  }, AUTOSAVE_DELAY);
}
function updateFileIndicator() {
  const fileNameEl = document.getElementById("study-file-name");
  const statusEl = document.getElementById("study-status");
  const currentPath = appState.currentFilePath;
  if (fileNameEl && currentPath) {
    const filename = currentPath.split("/").pop()?.replace(/\.md$/, "") || "";
    fileNameEl.textContent = filename;
  }
  if (statusEl) {
    statusEl.textContent = appState.isModified ? "Editing" : "";
  }
  const indicator = document.querySelector(".current-file-indicator");
  if (indicator && currentPath) {
    indicator.classList.add("visible");
    const fileName = currentPath.split("/").pop() || currentPath;
    const nameEl = indicator.querySelector(".file-name");
    if (nameEl)
      nameEl.textContent = fileName + (appState.isModified ? " *" : "");
  }
}
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveFile();
    }
    if (e.key === "Escape") {
      editor.focus();
    }
  });
}
function handleAiAction(actionId, _result) {
  console.log("[Study] AI action:", actionId);
}
async function loadInitialState() {
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get("file");
  if (filePath) {
    await openFile(filePath);
  }
}
var services, editor, ipython, aiClient, container, documentBasePath, silentUpdate, AUTOSAVE_DELAY, autosaveTimer;
var init_study = __esm({
  "src/apps/study/index.ts"() {
    "use strict";
    init_AppState();
    init_imageUrl();
    documentBasePath = "";
    silentUpdate = false;
    AUTOSAVE_DELAY = 2e3;
    autosaveTimer = null;
  }
});

// src/apps/codes/index.ts
var codes_exports = {};
__export(codes_exports, {
  mount: () => mount2
});
import {
  createEditor as createEditor2,
  IPythonExecutor as IPythonExecutor2,
  createMinimalIPythonClient as createMinimalIPythonClient2
} from "/editor-dist/index.browser.js";
import { IPythonClient as IPythonClient3 } from "/core/ipython-client.js";
import * as SessionState2 from "/core/session-state.js";
import { createFileTabs } from "/core/file-tabs.js";
import { createRecentProjectsPanel } from "/core/recent-projects.js";
import { createFileBrowser } from "/core/file-browser.js";
import { AiClient as AiClient2 } from "/core/ai-client.js";
import { createAiPalette as createAiPalette2 } from "/core/ai-palette.js";
import { HistoryPanel } from "/core/history-panel.js";
import { createTerminalTabs } from "/core/terminal-tabs.js";
import { createNotificationManager } from "/core/notifications.js";
import { createProcessSidebar } from "/core/process-sidebar.js";
import { toggleMode } from "/core/compact-mode.js";
import { initSelectionToolbar as initSelectionToolbar2 } from "/core/selection-toolbar.js";
async function mount2(svc) {
  console.log("[Codes] Mounting Developer Mode...");
  services2 = svc;
  noCollab = new URLSearchParams(window.location.search).has("noCollab");
  initDOMReferences();
  initClients2();
  initEditor2();
  await initUIModules();
  await initCollaboration();
  setupEventHandlers();
  setupKeyboardShortcuts2();
  initFileWatching();
  await loadInitialState2();
  console.log("[Codes] Developer Mode ready");
}
function initDOMReferences() {
  container2 = document.getElementById("editor-container");
  rawTextarea = document.getElementById("raw-markdown");
  cursorPosEl = document.getElementById("cursor-pos");
  execStatusEl = document.getElementById("exec-status");
  if (!container2) {
    throw new Error("[Codes] Missing #editor-container element");
  }
}
function initClients2() {
  ipython2 = new IPythonClient3({ apiBase: "" });
  aiClient2 = new AiClient2();
  aiClient2.isAvailable().then((available) => {
    if (available) {
      console.log("[AI] Server available");
    } else {
      console.log("[AI] Server not available - AI features disabled");
    }
  });
}
function initEditor2() {
  const ipythonClient = createMinimalIPythonClient2("");
  const executor = new IPythonExecutor2({ client: ipythonClient });
  const resolveImageUrl = createImageUrlResolver(() => documentBasePath2);
  editor2 = createEditor2({
    parent: container2,
    doc: "",
    executor,
    theme: "zen",
    resolveImageUrl,
    onChange: (doc) => {
      if (!silentUpdate2) {
        rawTextarea.value = doc;
        const currentPath = appState.currentFilePath;
        if (currentPath) {
          appState.updateFileContent(currentPath, doc, true);
          scheduleAutosave2();
          updateFileIndicator2();
        }
      }
    },
    onCursorChange: (info) => {
      cursorPosEl.textContent = String(info.pos);
    },
    onComplete: async (code, cursorPos, lang) => {
      if (lang !== "python")
        return null;
      return await ipython2.complete(code, cursorPos);
    },
    onInspect: async (code, cursorPos, lang) => {
      if (lang !== "python")
        return null;
      return await ipython2.inspect(code, cursorPos);
    },
    onHover: async (word, lang) => {
      if (lang !== "python")
        return null;
      return await ipython2.hoverInspect(word);
    }
  });
  setContent2("", true);
  rawTextarea.value = "";
  initSelectionToolbar2(container2, {
    getContent: () => editor2.getDoc(),
    getSelectionInfo: () => getSelectionInfo2(),
    replaceTextRange: (text, start, end) => {
      editor2.view.dispatch({
        changes: { from: start, to: end, insert: text }
      });
      return true;
    },
    insertTextAtCursor: (text) => {
      const pos = editor2.getCursor();
      editor2.view.dispatch({
        changes: { from: pos, insert: text }
      });
      return true;
    }
  });
  rawTextarea.addEventListener("input", () => {
    setContent2(rawTextarea.value, true);
    const currentPath = appState.currentFilePath;
    if (currentPath) {
      appState.markFileModified(currentPath);
      scheduleAutosave2();
      updateFileIndicator2();
    }
  });
  editor2.focus();
}
function setContent2(markdown, silent = false) {
  if (silent) {
    silentUpdate2 = true;
    try {
      editor2.setDoc(markdown);
    } finally {
      silentUpdate2 = false;
    }
  } else {
    editor2.setDoc(markdown);
  }
}
function getContent2() {
  return editor2.getDoc();
}
function setDocumentBasePath(path) {
  documentBasePath2 = path;
}
function getSelectionInfo2() {
  const state = editor2.view.state;
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
      onSelect: (path) => openFile2(path),
      onNavigate: (path) => {
        browserRoot = path;
        localStorage.setItem("mrmd_browser_root", browserRoot);
      }
    });
  }
  const terminalContainer = document.getElementById("sidebar-terminal");
  if (terminalContainer) {
    terminalTabs = createTerminalTabs({
      container: terminalContainer
    });
  }
  aiPalette = createAiPalette2({
    aiClient: aiClient2,
    onRunningChange: (count) => {
      updateRunningBadge(count);
    },
    onAction: handleAiAction2,
    onError: (err, actionId) => {
      console.error("[AI] Error:", actionId, err);
    },
    getContext: getAiContext
  });
  aiPalette.attachToEditor({
    container: container2,
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
  const projectsPanel = document.getElementById("projects-panel");
  if (projectsPanel) {
    createRecentProjectsPanel({
      container: projectsPanel,
      onProjectSelect: (path) => openProject2(path)
    });
  }
  initSidebarTabs();
  initSidebarResizer();
  initThemePicker();
  initModeToggle();
}
async function initCollaboration() {
  if (noCollab) {
    console.log("[Collab] Disabled via ?noCollab");
    return;
  }
  const collab = services2.collaboration;
  collab.onConnected((info) => {
    console.log("[Collab] Connected:", info.session_id);
    stopPollingFallback();
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
  SessionState2.on("project-opened", handleProjectOpened);
  SessionState2.on("project-created", handleProjectCreated);
  window.addEventListener("focus", () => {
    if (!services2.collaboration.isConnected) {
      setTimeout(checkFileChanges, 100);
    }
  });
  window.addEventListener("beforeunload", () => {
    const currentPath = appState.currentFilePath;
    if (currentPath) {
      appState.updateFileScrollTop(currentPath, container2.scrollTop);
    }
  });
}
function setupKeyboardShortcuts2() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveFile2();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      focusFileBrowser();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
      e.preventDefault();
      toggleMode();
    }
  });
}
async function openFile2(path, options = {}) {
  console.log("[Codes] Opening file:", path, options);
  try {
    const file = await services2.documents.openFile(path);
    appState.openFile(path, file.content, {
      mtime: file.mtime ?? null,
      modified: false
    });
    const filename = path.split("/").pop() || path;
    fileTabs?.addTab(path, filename, false);
    if (!options.background) {
      appState.setCurrentFile(path);
      fileTabs?.setActiveTab(path);
      setContent2(file.content, true);
      rawTextarea.value = file.content;
      document.title = `${filename} - MRMD`;
      updateFileIndicator2();
      if (path.endsWith(".md")) {
        const session = await SessionState2.getNotebookSession(path);
        ipython2.setSession(session);
        SessionState2.setCurrentSessionName(session);
      }
    }
  } catch (err) {
    console.error("[Codes] Failed to open file:", err);
    showNotification("Error", `Failed to open file: ${err}`, "error");
  }
}
async function saveFile2() {
  const currentPath = appState.currentFilePath;
  if (!currentPath)
    return;
  const content = getContent2();
  execStatusEl.textContent = "saving...";
  try {
    await services2.documents.saveFile(currentPath, content);
    appState.markFileSaved(currentPath);
    updateFileIndicator2();
    execStatusEl.textContent = "saved";
    if (services2.collaboration.isConnected) {
      services2.collaboration.notifyFileSaved(currentPath);
    }
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
function scheduleAutosave2() {
  const currentPath = appState.currentFilePath;
  if (!currentPath || !appState.isModified)
    return;
  if (autosaveTimer2) {
    clearTimeout(autosaveTimer2);
  }
  if (Date.now() - lastSaveTime > AUTOSAVE_MAX_INTERVAL) {
    doAutosave();
    return;
  }
  autosaveTimer2 = setTimeout(doAutosave, AUTOSAVE_DELAY2);
}
async function doAutosave() {
  const currentPath = appState.currentFilePath;
  if (!currentPath || !appState.isModified)
    return;
  console.log("[Autosave] Saving", currentPath);
  execStatusEl.textContent = "autosaving...";
  try {
    const content = getContent2();
    await services2.documents.saveFile(currentPath, content, { message: "autosave" });
    appState.markFileSaved(currentPath);
    lastSaveTime = Date.now();
    updateFileIndicator2();
    execStatusEl.textContent = "autosaved";
    setTimeout(() => {
      if (execStatusEl.textContent === "autosaved") {
        execStatusEl.textContent = "ready";
      }
    }, 1e3);
  } catch (err) {
    console.error("[Autosave] Failed:", err);
    execStatusEl.textContent = "autosave failed";
  }
}
async function handleTabSelect(path) {
  const currentPath = appState.currentFilePath;
  if (currentPath) {
    appState.updateFileScrollTop(currentPath, container2.scrollTop);
  }
  const file = appState.openFiles.get(path);
  if (file) {
    setContent2(file.content, true);
    rawTextarea.value = file.content;
    appState.setCurrentFile(path);
    updateFileIndicator2();
    const filename = path.split("/").pop() || path;
    document.title = `${filename} - MRMD`;
    requestAnimationFrame(() => {
      container2.scrollTop = file.scrollTop;
    });
    if (path.endsWith(".md")) {
      const session = await SessionState2.getNotebookSession(path);
      ipython2.setSession(session);
      SessionState2.setCurrentSessionName(session);
    }
  }
}
async function handleBeforeTabClose(path) {
  const file = appState.openFiles.get(path);
  if (file?.modified) {
    try {
      await services2.documents.saveFile(path, file.content);
    } catch (err) {
      console.error("[Tabs] Error saving before close:", err);
    }
  }
}
async function handleTabClose(path) {
  terminalTabs?.closeTerminalsForFile(path);
  const newActivePath = appState.closeFile(path);
  if (newActivePath) {
    await handleTabSelect(newActivePath);
  } else {
    setContent2("", true);
    rawTextarea.value = "";
    document.title = "MRMD";
    updateFileIndicator2();
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
  fileBrowser?.setRoot?.(project.path);
  ipython2.setSession("main");
  ipython2.setProjectPath(project.path);
  ipython2.setFigureDir(project.path + "/.mrmd/assets");
  setDocumentBasePath(project.path);
  if (!noCollab && !services2.collaboration.isConnected) {
    try {
      await services2.collaboration.connect({
        projectRoot: project.path,
        userName: "user",
        userType: "human"
      });
    } catch (err) {
      console.warn("[Collab] Connection failed:", err);
    }
  }
}
function handleProjectCreated({ mainNotebook }) {
  if (mainNotebook) {
    openFile2(mainNotebook);
  }
}
function updateFileIndicator2() {
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
      if (!services2.collaboration.isConnected) {
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
    const result = await services2.documents.getMtimes(paths);
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
    const fileData = await services2.documents.readFile(path);
    const newContent = fileData.content;
    const file = appState.openFiles.get(path);
    if (file) {
      if (path === appState.currentFilePath) {
        const oldContent = getContent2();
        if (newContent !== oldContent) {
          const oldCursor = editor2.getCursor();
          const scrollTop = container2.scrollTop;
          const newCursor = adjustCursorPosition(oldContent, newContent, oldCursor);
          setContent2(newContent, false);
          rawTextarea.value = newContent;
          editor2.setCursor(newCursor);
          requestAnimationFrame(() => {
            container2.scrollTop = scrollTop;
          });
        }
      }
      appState.openFile(path, newContent, { mtime: fileData.mtime ?? null });
    }
  } catch (err) {
    console.error("[FileWatch] Error handling file change:", err);
  }
}
function adjustCursorPosition(oldContent, newContent, oldCursor) {
  if (oldCursor >= oldContent.length)
    return newContent.length;
  if (oldCursor === 0)
    return 0;
  let commonPrefix = 0;
  const minLen = Math.min(oldContent.length, newContent.length);
  while (commonPrefix < minLen && oldContent[commonPrefix] === newContent[commonPrefix]) {
    commonPrefix++;
  }
  if (oldCursor <= commonPrefix)
    return oldCursor;
  let commonSuffix = 0;
  while (commonSuffix < minLen - commonPrefix && oldContent[oldContent.length - 1 - commonSuffix] === newContent[newContent.length - 1 - commonSuffix]) {
    commonSuffix++;
  }
  const oldChangeEnd = oldContent.length - commonSuffix;
  if (oldCursor > oldChangeEnd) {
    return oldCursor + (newContent.length - oldContent.length);
  }
  return Math.min(newContent.length - commonSuffix, newContent.length);
}
function getAiContext() {
  const selInfo = getSelectionInfo2();
  const markdown = getContent2();
  return {
    text: markdown,
    cursor: selInfo.cursor,
    documentContext: markdown
  };
}
function handleAiAction2(actionId, result, ctx) {
  console.log("[AI] Action complete:", actionId);
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
  const zenBtn = document.getElementById("zen-toggle");
  modeBtn?.addEventListener("click", () => {
    toggleMode();
  });
  zenBtn?.addEventListener("click", () => {
    appState.setZenMode(!appState.ui.zenMode);
    document.body.classList.toggle("zen-mode", appState.ui.zenMode);
  });
}
function focusFileBrowser() {
  document.querySelectorAll(".sidebar-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.remove("active"));
  const filesTab = document.querySelector('.sidebar-tab[data-panel="files"]');
  const filesPanel = document.getElementById("files-panel");
  filesTab?.classList.add("active");
  filesPanel?.classList.add("active");
  fileBrowser?.focus();
}
async function loadInitialState2() {
  browserRoot = localStorage.getItem("mrmd_browser_root") || "/home";
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get("file");
  if (filePath) {
    await openFile2(filePath);
  }
  SessionState2.initialize();
}
var services2, editor2, ipython2, aiClient2, fileTabs, fileBrowser, terminalTabs, notificationManager, aiPalette, historyPanel, container2, rawTextarea, cursorPosEl, execStatusEl, browserRoot, documentBasePath2, silentUpdate2, AUTOSAVE_DELAY2, AUTOSAVE_MAX_INTERVAL, autosaveTimer2, lastSaveTime, fileCheckInterval, noCollab;
var init_codes = __esm({
  "src/apps/codes/index.ts"() {
    "use strict";
    init_AppState();
    init_imageUrl();
    notificationManager = null;
    historyPanel = null;
    browserRoot = "/home";
    documentBasePath2 = "";
    silentUpdate2 = false;
    AUTOSAVE_DELAY2 = 2e3;
    AUTOSAVE_MAX_INTERVAL = 3e4;
    autosaveTimer2 = null;
    lastSaveTime = Date.now();
    fileCheckInterval = null;
    noCollab = false;
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
  console.log(`[Boot] Starting Atelier in ${mode === "study" ? "Study" : "Codes"} mode...`);
  const services3 = createServices();
  console.log("[Boot] Services initialized");
  try {
    if (mode === "study") {
      const app = await Promise.resolve().then(() => (init_study(), study_exports));
      await app.mount(services3);
    } else {
      const app = await Promise.resolve().then(() => (init_codes(), codes_exports));
      await app.mount(services3);
    }
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

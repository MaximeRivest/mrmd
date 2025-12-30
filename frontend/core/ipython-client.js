var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class IPythonClient {
  constructor(options = {}) {
    // PUBLIC properties - required by editor/src/execution/ipython.ts interface
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
  /**
   * Set the session ID.
   */
  setSession(sessionId) {
    this.sessionId = sessionId;
  }
  /**
   * Set the project path (for auto-restore of saved sessions).
   */
  setProjectPath(projectPath) {
    this.projectPath = projectPath;
  }
  /**
   * Set the figure directory (for matplotlib plots).
   *
   * CRITICAL: This must be called whenever a project is opened. Without it,
   * matplotlib plt.show() will not save figures. The figure_dir is passed
   * to the server on each execute request, which then updates the running
   * worker process via RPC if needed.
   */
  setFigureDir(figureDir) {
    this.figureDir = figureDir;
  }
  /**
   * Make an API request.
   */
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
  /**
   * Get completions for code at cursor position.
   */
  async complete(code, cursorPos) {
    return this._request("/api/ipython/complete", { code, cursor_pos: cursorPos });
  }
  /**
   * Get documentation/inspection for object at cursor.
   */
  async inspect(code, cursorPos, detailLevel = 0) {
    return this._request("/api/ipython/inspect", {
      code,
      cursor_pos: cursorPos,
      detail_level: detailLevel
    });
  }
  /**
   * Execute code.
   */
  async execute(code, storeHistory = true, execId = null) {
    const body = {
      code,
      store_history: storeHistory
    };
    if (execId) {
      body.exec_id = execId;
    }
    return this._request("/api/ipython/execute", body);
  }
  /**
   * Check if code is complete (for multi-line input).
   */
  async isComplete(code) {
    return this._request("/api/ipython/is_complete", { code });
  }
  /**
   * Reset the IPython session.
   */
  async reset() {
    return this._request("/api/ipython/reset", {});
  }
  /**
   * Restart the server process.
   * The page will need to be reloaded after the server restarts.
   */
  async restartServer() {
    return this._request("/api/server/restart", {});
  }
  /**
   * Execute code with streaming output via SSE.
   */
  async executeStreaming(code, onChunk, storeHistory = true, execId = null) {
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
      if (execId) {
        body.exec_id = execId;
      }
      this._fetch(`${this.apiBase}/api/ipython/execute/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Streaming execution failed: ${response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }
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
  /**
   * List all active sessions.
   */
  async listSessions() {
    try {
      const res = await this._fetch(`${this.apiBase}/api/ipython/sessions`);
      return await res.json();
    } catch (err) {
      console.error("IPython sessions error:", err);
      return null;
    }
  }
  /**
   * Get variables in the current session's namespace.
   * Like RStudio's Environment pane.
   */
  async getVariables() {
    return this._request("/api/ipython/variables", {});
  }
  /**
   * Inspect an object by path for drill-down.
   */
  async inspectObject(path) {
    return this._request("/api/ipython/inspect_object", { path });
  }
  /**
   * Get hover information for a variable/object.
   * Returns value preview, type info, and docstring for hover tooltips.
   */
  async hoverInspect(name) {
    return this._request("/api/ipython/hover", { name });
  }
  /**
   * Clean up assets for a given execution ID.
   * This is used when re-running a cell to clean up previous execution's assets.
   */
  async cleanupAssets(execId) {
    if (!this.figureDir) {
      return { deleted: [], count: 0 };
    }
    return this._request("/api/assets/cleanup", {
      exec_id: execId,
      assets_dir: this.figureDir
    });
  }
}
class CompletionController {
  constructor(options) {
    __publicField(this, "client");
    __publicField(this, "dropdownEl");
    __publicField(this, "ghostEl");
    __publicField(this, "getCaretCoords");
    __publicField(this, "escapeHtml");
    // State
    __publicField(this, "items", []);
    __publicField(this, "selectedIndex", 0);
    __publicField(this, "active", false);
    __publicField(this, "startPos", 0);
    __publicField(this, "editor", null);
    // Trigger characters (empty by default - IPython style is Tab-only)
    __publicField(this, "triggerChars", []);
    this.client = options.client;
    this.dropdownEl = options.dropdownEl;
    this.ghostEl = options.ghostEl;
    this.getCaretCoords = options.getCaretCoords;
    this.escapeHtml = options.escapeHtml || ((s) => s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c] || c));
  }
  /**
   * Find longest common prefix among strings.
   */
  _commonPrefix(strings) {
    if (!strings || strings.length === 0)
      return "";
    if (strings.length === 1)
      return strings[0];
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (strings[i].indexOf(prefix) !== 0) {
        prefix = prefix.substring(0, prefix.length - 1);
        if (prefix === "")
          return "";
      }
    }
    return prefix;
  }
  /**
   * Show completions dropdown.
   */
  show(editor, items, startPos) {
    if (!items || items.length === 0) {
      this.hide();
      return;
    }
    this.editor = editor;
    this.items = items;
    this.selectedIndex = 0;
    this.active = true;
    this.startPos = startPos;
    this._positionDropdown();
    this._render();
    this.dropdownEl.classList.add("active");
  }
  /**
   * Hide completions dropdown.
   */
  hide() {
    this.dropdownEl.classList.remove("active");
    this.active = false;
    this.items = [];
    this._hideGhost();
  }
  /**
   * Navigate selection up/down.
   */
  navigate(delta) {
    if (!this.active || this.items.length === 0)
      return;
    this.selectedIndex = (this.selectedIndex + delta + this.items.length) % this.items.length;
    this._render();
  }
  /**
   * Apply the selected completion.
   */
  apply() {
    if (!this.active || this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
      return false;
    }
    const item = this.items[this.selectedIndex];
    const text = typeof item === "string" ? item : item.text;
    if (!this.editor)
      return false;
    const before = this.editor.value.substring(0, this.startPos);
    const after = this.editor.value.substring(this.editor.selectionStart);
    this.editor.value = before + text + after;
    this.editor.selectionStart = this.editor.selectionEnd = this.startPos + text.length;
    this.hide();
    return true;
  }
  /**
   * Filter completions based on typed text.
   */
  filter(typed) {
    if (!this.active)
      return;
    const filtered = this.items.filter((item) => {
      const text = typeof item === "string" ? item : item.text;
      return text.toLowerCase().startsWith(typed.toLowerCase());
    });
    if (filtered.length === 0) {
      this.hide();
    } else {
      this.items = filtered;
      this.selectedIndex = 0;
      this._render();
      this._updateGhost();
    }
  }
  /**
   * Trigger completion request (IPython-style).
   * - If single match: complete immediately
   * - If common prefix longer than typed: complete to prefix
   * - Otherwise: show dropdown
   */
  async trigger(editor, code, cursorPos, blockStartOffset) {
    const result = await this.client.complete(code, cursorPos);
    if (!result || !result.matches || result.matches.length === 0) {
      this.hide();
      return { completed: false, showedDropdown: false };
    }
    const startPos = blockStartOffset + result.cursor_start;
    const typed = editor.value.substring(startPos, editor.selectionStart);
    const matches = result.matches;
    if (matches.length === 1) {
      this._applyText(editor, startPos, matches[0]);
      return { completed: true, showedDropdown: false };
    }
    const prefix = this._commonPrefix(matches);
    if (prefix.length > typed.length) {
      this._applyText(editor, startPos, prefix);
      return { completed: true, showedDropdown: false };
    }
    this.show(editor, matches, startPos);
    return { completed: false, showedDropdown: true };
  }
  /**
   * Apply text completion without showing dropdown.
   */
  _applyText(editor, startPos, text) {
    const before = editor.value.substring(0, startPos);
    const after = editor.value.substring(editor.selectionStart);
    editor.value = before + text + after;
    editor.selectionStart = editor.selectionEnd = startPos + text.length;
  }
  /**
   * Check if character should trigger immediate completion.
   */
  shouldTrigger(char) {
    return this.triggerChars.includes(char);
  }
  // Private methods
  _positionDropdown() {
    if (!this.editor || !this.getCaretCoords)
      return;
    const rect = this.editor.getBoundingClientRect();
    const coords = this.getCaretCoords(this.editor);
    this.dropdownEl.style.left = `${rect.left + coords.left}px`;
    this.dropdownEl.style.top = `${rect.top + coords.top + 20}px`;
  }
  _render() {
    const maxItems = 20;
    this.dropdownEl.innerHTML = this.items.slice(0, maxItems).map((item, i) => {
      const text = typeof item === "string" ? item : item.text;
      const type = typeof item === "object" ? item.type : "";
      const selected2 = i === this.selectedIndex ? " selected" : "";
      return `
                <div class="autocomplete-item${selected2}" data-index="${i}">
                    ${this.escapeHtml(text)}
                    ${type ? `<span class="type">${this.escapeHtml(type)}</span>` : ""}
                </div>
            `;
    }).join("");
    this.dropdownEl.querySelectorAll(".autocomplete-item").forEach((el) => {
      el.addEventListener("click", () => {
        const htmlEl = el;
        this.selectedIndex = parseInt(htmlEl.dataset.index || "0", 10);
        this.apply();
      });
    });
    const selected = this.dropdownEl.querySelector(".selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }
  _updateGhost() {
    if (!this.ghostEl || !this.editor || this.items.length === 0) {
      this._hideGhost();
      return;
    }
    const item = this.items[this.selectedIndex];
    const text = typeof item === "string" ? item : item.text;
    const typed = this.editor.value.substring(this.startPos, this.editor.selectionStart);
    const remaining = text.substring(typed.length);
    if (!remaining) {
      this._hideGhost();
      return;
    }
    const rect = this.editor.getBoundingClientRect();
    const coords = this.getCaretCoords(this.editor);
    this.ghostEl.textContent = remaining;
    this.ghostEl.style.left = `${rect.left + coords.left}px`;
    this.ghostEl.style.top = `${rect.top + coords.top}px`;
    this.ghostEl.classList.add("active");
  }
  _hideGhost() {
    if (this.ghostEl) {
      this.ghostEl.classList.remove("active");
    }
  }
}
class HelpController {
  constructor(options) {
    __publicField(this, "client");
    __publicField(this, "popoverEl");
    __publicField(this, "signatureEl");
    __publicField(this, "docstringEl");
    __publicField(this, "getCaretCoords");
    __publicField(this, "editor", null);
    this.client = options.client;
    this.popoverEl = options.popoverEl;
    this.signatureEl = options.signatureEl;
    this.docstringEl = options.docstringEl;
    this.getCaretCoords = options.getCaretCoords;
  }
  /**
   * Show help for code at cursor.
   */
  async show(editor, code, cursorPos) {
    this.editor = editor;
    const result = await this.client.inspect(code, cursorPos);
    if (result && result.found) {
      this._display(result.signature, result.docstring);
    } else {
      this.hide();
    }
  }
  /**
   * Hide the help popover.
   */
  hide() {
    this.popoverEl.classList.remove("active");
  }
  _display(signature, docstring) {
    if (!signature && !docstring) {
      this.hide();
      return;
    }
    if (this.signatureEl) {
      this.signatureEl.textContent = signature || "";
    }
    if (this.docstringEl) {
      this.docstringEl.textContent = docstring || "";
    }
    this._position();
    this.popoverEl.classList.add("active");
  }
  _position() {
    if (!this.editor || !this.getCaretCoords)
      return;
    const rect = this.editor.getBoundingClientRect();
    const coords = this.getCaretCoords(this.editor);
    const popoverHeight = this.popoverEl.offsetHeight || 150;
    this.popoverEl.style.left = `${rect.left + coords.left}px`;
    this.popoverEl.style.top = `${rect.top + coords.top - popoverHeight - 10}px`;
  }
}
class CodeBlockDetector {
  constructor(options = {}) {
    __publicField(this, "languages");
    this.languages = options.languages || ["python"];
  }
  /**
   * Get code block context at cursor position.
   */
  getContext(text, cursorPos) {
    const lines = text.split("\n");
    let charCount = 0;
    let cursorLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= cursorPos) {
        cursorLine = i;
        break;
      }
      charCount += lines[i].length + 1;
    }
    let blockStart = -1;
    let lang = null;
    for (let i = cursorLine; i >= 0; i--) {
      const match = lines[i].match(/^```(\w+)/);
      if (match) {
        blockStart = i;
        lang = match[1];
        break;
      }
      if (lines[i] === "```") {
        return null;
      }
    }
    if (blockStart === -1 || !lang)
      return null;
    if (!this.languages.includes(lang))
      return null;
    let blockEnd = -1;
    for (let i = cursorLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith("```")) {
        blockEnd = i;
        break;
      }
    }
    if (blockEnd === -1)
      blockEnd = lines.length;
    if (cursorLine <= blockStart || cursorLine >= blockEnd)
      return null;
    let blockStartOffset = 0;
    for (let i = 0; i <= blockStart; i++) {
      blockStartOffset += lines[i].length + 1;
    }
    const codeLines = lines.slice(blockStart + 1, cursorLine + 1);
    const lastLineOffset = cursorPos - charCount;
    codeLines[codeLines.length - 1] = codeLines[codeLines.length - 1].substring(0, lastLineOffset);
    const code = codeLines.join("\n");
    return {
      lang,
      code,
      cursorPos: code.length,
      blockStart,
      blockEnd,
      blockStartOffset
    };
  }
}
function getCaretCoordinates(textarea, options = {}) {
  const lineHeight = options.lineHeight || 24;
  const charWidth = options.charWidth || 8.4;
  const paddingLeft = options.paddingLeft || 8;
  const text = textarea.value.substring(0, textarea.selectionStart);
  const lines = text.split("\n");
  const currentLine = lines.length - 1;
  const currentCol = lines[lines.length - 1].length;
  return {
    top: currentLine * lineHeight - textarea.scrollTop,
    left: currentCol * charWidth - textarea.scrollLeft + paddingLeft
  };
}
function createIPythonIntegration(options) {
  const client = new IPythonClient({ apiBase: options.apiBase });
  const getCoords = (editor) => getCaretCoordinates(editor, options.caretOptions);
  const completion = new CompletionController({
    client,
    dropdownEl: options.dropdownEl,
    ghostEl: options.ghostEl,
    getCaretCoords: getCoords,
    escapeHtml: options.escapeHtml
  });
  const help = new HelpController({
    client,
    popoverEl: options.helpEl || document.createElement("div"),
    signatureEl: options.signatureEl,
    docstringEl: options.docstringEl,
    getCaretCoords: getCoords
  });
  const detector = new CodeBlockDetector({ languages: ["python"] });
  return { client, completion, help, detector };
}
export {
  CodeBlockDetector,
  CompletionController,
  HelpController,
  IPythonClient,
  createIPythonIntegration,
  getCaretCoordinates
};
//# sourceMappingURL=ipython-client.js.map

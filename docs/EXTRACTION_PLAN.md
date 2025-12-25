# Commit 2: Single Entry Module Extraction

> Synthesized from Gemini's SOA vision + Codex's tactical precision + architectural analysis

## Goal

Extract the ~5,000 lines of inline JavaScript from `index.html` into `frontend/core/app.ts` while **preserving exact behavior**. This creates a clean foundation for subsequent refactoring.

**Principle**: Move first, restructure later. No behavior changes in this commit.

---

## Phase 1: Mechanical Extraction (This Commit)

### 1.1 File Changes

| File | Action |
|------|--------|
| `frontend/web/index.html` | Remove inline `<script>` (lines 153-5127), replace with single import |
| `frontend/core/app.ts` | **NEW** - Contains all extracted code |
| `frontend/core/globals.d.ts` | **NEW** - Type declarations for window globals |
| `frontend/build.cjs` | Add app.ts build config |
| `frontend/tsconfig.json` | Expand include, add allowJs |

### 1.2 index.html Transformation

**Before** (line 153):
```html
<script type="module">
    import { createEditorBridge } from '/core/editor-bridge.js';
    // ... 4,974 lines ...
</script>
```

**After**:
```html
<script type="module" src="/core/app.js"></script>
```

Keep all external library tags (lines 10, 14, 17-20) unchanged.

### 1.3 Build Configuration

Add to `frontend/build.cjs` after `bridgeConfig`:

```javascript
// Config for main app entry (TypeScript)
const appConfig = {
    entryPoints: ['core/app.ts'],
    bundle: true,  // Must bundle - has imports
    outfile: 'core/app.js',
    format: 'esm',
    minify: false,
    sourcemap: true,
    target: ['es2020'],
    external: [
        '/core/editor-bridge.js',  // Already built separately
        '/core/ipython-client.js',
        '/core/utils.js',
        '/core/session-state.js',
        '/core/session-ui.js',
        '/core/file-tabs.js',
        '/core/recent-projects.js',
        '/core/file-browser.js',
        '/core/ai-client.js',
        '/core/ai-palette.js',
        '/core/history-panel.js',
        '/core/collab-client.js',
        '/core/terminal-tabs.js',
        '/core/notifications.js',
        '/core/process-sidebar.js',
        '/core/compact-mode.js',
        '/core/selection-toolbar.js',
    ],
};
```

### 1.4 TypeScript Configuration

Update `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "outDir": "./dist",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true
  },
  "include": [
    "core/editor-bridge.ts",
    "core/app.ts",
    "core/globals.d.ts"
  ],
  "exclude": ["node_modules", "dist"]
}
```

### 1.5 Global Type Declarations

Create `frontend/core/globals.d.ts`:

```typescript
export {};

declare global {
  interface Window {
    // Electron API (used in desktop app)
    electronAPI?: {
      openProjectWindow?: (path: string) => Promise<void>;
    };
    // KaTeX (loaded via CDN)
    katex: {
      render: (tex: string, element: HTMLElement, options?: object) => void;
      renderToString: (tex: string, options?: object) => string;
    };
    // Highlight.js (loaded via CDN)
    hljs: {
      highlightElement: (element: HTMLElement) => void;
      highlight: (code: string, options: { language: string }) => { value: string };
    };
    // xterm.js (loaded via CDN)
    Terminal: new (options?: object) => any;
    FitAddon: { FitAddon: new () => any };
    WebLinksAddon: { WebLinksAddon: new () => any };
  }
}
```

---

## Phase 2: app.ts Structure

The extracted code should be organized with clear section markers (for future splitting):

```typescript
// ============================================================
// IMPORTS
// ============================================================
import { createEditorBridge } from '/core/editor-bridge.js';
import { IPythonClient } from '/core/ipython-client.js';
// ... all 17 imports ...

// ============================================================
// GLOBAL STATE
// ============================================================
const API_BASE = '';
let currentFilePath: string | null = null;
let isModified = false;
// ... all module-level state ...

// ============================================================
// SECTION: Output Formatting
// ============================================================
function formatOutputHtml(...) { ... }

// ============================================================
// SECTION: JavaScript Execution
// ============================================================
function executeJavaScript(...) { ... }

// ============================================================
// SECTION: Block Execution
// ============================================================
function executeBlock(...) { ... }
function executeReplCommand(...) { ... }

// ... continue with all sections ...

// ============================================================
// SECTION: Application Bootstrap
// ============================================================
// All initialization code that runs on load
```

### Section Inventory (29 sections, in order)

| Section | Purpose | Approx Lines |
|---------|---------|--------------|
| Imports | Module dependencies | 20 |
| Global State | Module-level variables | 40 |
| Output Formatting | HTML formatting for execution results | 40 |
| JavaScript Execution | Browser-side JS execution | 160 |
| Block Execution | Python/JS code block dispatcher | 110 |
| REPL Execution | Interactive REPL commands | 45 |
| Editor Initialization | CodeMirror 6 bridge setup | 85 |
| Table of Contents | TOC generation/insertion | 140 |
| Heading Minimap | Code outline navigator | 265 |
| AI Boundary Alignment | Output text alignment | 70 |
| Synonym Picker | AI word replacement UI | 350 |
| AI Palette | AI completion actions | 300 |
| File Tabs | Multi-file tab management | 210 |
| Projects Panel | Recent projects sidebar | 55 |
| Variables Panel | Environment variable display | 90 |
| Kernel/Server Restart | IPython/server restart | 75 |
| Mode Toggle | Compact/developer mode | 10 |
| Theme Picker | Theme selection UI | 50 |
| AI Run | Document-as-prompt execution | 135 |
| Zen Mode | Full-screen editor mode | 25 |
| Sidebar Resize | Draggable sidebar width | 40 |
| Sidebar Tabs | Panel switching | 30 |
| Terminal Tabs | Multi-terminal interface | 15 |
| Process Sidebar | Process management UI | 45 |
| Notifications | Toast notification system | 70 |
| File Browser | File picker component | 170 |
| History Panel | Execution history display | 50 |
| Compact Mode | Compact UI initialization | 285 |
| Collaboration & File Ops | WebSocket + file open/save | 410 |
| Notebook Naming | AI filename suggestions | 235 |
| Autosave | Auto-save mechanism | 315 |
| Session Management | Status badges, venv switching | 150 |
| Cache Restore | Instant restore + lazy init | 135 |
| File Change Detection | Polling + external merge | 225 |
| Image Modal | Image viewer popup | 45 |

---

## Phase 3: Verification Checklist

After extraction, verify:

1. **Build succeeds**:
   ```bash
   cd frontend && node build.cjs
   # Should emit core/app.js
   ```

2. **TypeScript valid**:
   ```bash
   cd frontend && pnpm typecheck
   # Should pass (with allowJs)
   ```

3. **App loads**:
   - Open http://localhost:51789
   - Editor initializes
   - Can open/save files
   - Code execution works
   - Collaboration connects

4. **No console errors** on page load

---

## Future Phases (NOT this commit)

### Phase 4: Module Splitting (Commit 3)
Split `app.ts` into logical modules:
```
core/
├── app.ts              # Bootstrap only (~200 lines)
├── execution.ts        # Block execution
├── file-operations.ts  # Open/save/autosave
├── collaboration.ts    # Collab + file watching
├── ui/
│   ├── minimap.ts
│   ├── toc.ts
│   ├── synonym-picker.ts
│   └── theme.ts
```

### Phase 5: Service Layer (Commit 4)
Extract services per Gemini's vision:
```
services/
├── DocumentService.ts
├── ExecutionService.ts
├── CollaborationService.ts
└── interfaces.ts
```

### Phase 6: Study/Codes Split (Commit 5)
Two entry points sharing services:
```
apps/
├── study/
│   └── main.ts         # Writer mode
└── codes/
    └── main.ts         # Developer mode
```

---

## Key Decisions

1. **Why bundle: true?** - app.ts has imports, esbuild needs to resolve them
2. **Why external modules?** - Existing JS modules loaded at runtime, not bundled
3. **Why allowJs?** - Existing core/*.js files aren't TypeScript yet
4. **Why no restructuring?** - Behavior preservation first, refactor second
5. **Why section markers?** - Enable future mechanical splitting

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Import path resolution | Use absolute paths (`/core/...`) matching server routes |
| Timing-dependent init | Keep exact initialization order |
| Global state access | Keep as module-level variables (same scope) |
| DOM element availability | Keep DOMContentLoaded pattern if present |

---

*This plan preserves the "delete more than you add" philosophy - we're reorganizing, not rewriting.*

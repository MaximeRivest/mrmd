# Codes App - Developer Mode

The Codes app is the full-featured IDE mode for Atelier, accessed via `atelier.codes`.

## Interface Mode Architecture

The Codes app supports two interface modes that users can switch between at runtime:

| Mode | Description | UI Elements |
|------|-------------|-------------|
| **Compact** | Document-first, minimal chrome | Floating toolbar, slide-out panels |
| **Developer** | Full IDE experience | Sidebar with tabs, terminal, file browser |

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         codes/index.ts                               │
│                                                                      │
│  mount()                                                             │
│    ├── initEditor()                                                  │
│    ├── initUIModules()      ← Creates sidebar, tabs, file browser   │
│    └── initInterfaceMode()  ← Creates InterfaceManager              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       InterfaceManager                               │
│                       ================                               │
│                                                                      │
│  Responsibilities:                                                   │
│  • Owns the interface mode lifecycle                                 │
│  • Creates compact UI via initCompactMode()                          │
│  • Handles mode transitions (onModeExit, onModeEnter)                │
│  • Notifies listeners of mode changes                                │
│                                                                      │
│  Public API:                                                         │
│  • getMode(): 'compact' | 'developer'                                │
│  • setMode(mode)                                                     │
│  • toggle()                                                          │
│  • onModeChange(listener)                                            │
│  • getState(): { mode, toolRailSide, toolRailOpen, ... }             │
│                                                                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ calls
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    compact-mode.js (core/)                           │
│                    ===================                               │
│                                                                      │
│  Creates compact mode UI elements:                                   │
│  • Tool rail (floating icon toolbar)                                 │
│  • Tool panels (slide-out panels)                                    │
│  • Compact header                                                    │
│  • Compact status bar                                                │
│  • Terminal overlay                                                  │
│  • Mobile navigation                                                 │
│                                                                      │
│  Also initializes mode-controller.js for CSS class application       │
│                                                                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ calls
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    mode-controller.js (core/)                        │
│                    ======================                            │
│                                                                      │
│  Responsibilities:                                                   │
│  • Applies CSS mode classes (compact-mode, developer-mode)           │
│  • Applies tool rail side classes (tool-rail-left, tool-rail-right)  │
│  • Listens for SessionState changes                                  │
│                                                                      │
│  Note: This is purely presentational - no business logic             │
│                                                                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ reads/writes
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    session-state.js (core/)                          │
│                    ====================                              │
│                                                                      │
│  Persists to localStorage:                                           │
│  • interfaceMode: 'compact' | 'developer' (default: 'compact')       │
│  • toolRailSide: 'left' | 'right' (default: 'right')                 │
│  • toolRailOpen: boolean                                             │
│  • statusBarExpanded: boolean                                        │
│                                                                      │
│  Emits events:                                                       │
│  • 'interface-mode-changed'                                          │
│  • 'tool-rail-side-changed'                                          │
│  • 'tool-rail-open-changed'                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### CSS Mode Classes

The UI visibility is controlled by CSS classes on the `.container` element:

```css
/* Compact mode: hide developer UI, show compact UI */
.compact-mode .sidebar { display: none; }
.compact-mode .tool-rail { display: flex; }

/* Developer mode: show developer UI, hide compact UI */
.developer-mode .sidebar { display: flex; }
.developer-mode .tool-rail { display: none; }
```

### Separation of Concerns

| Component | Responsibility |
|-----------|---------------|
| **InterfaceManager** | Lifecycle ownership, initialization, transitions |
| **compact-mode.js** | UI element creation for compact mode |
| **mode-controller.js** | CSS class application |
| **session-state.js** | Persistence and event broadcasting |
| **main.css** | Visual styling and visibility rules |

### Usage Example

```typescript
// In codes/index.ts
const interfaceManager = await createInterfaceManager({
    container: document.querySelector('.container'),
    editorPane: document.querySelector('.editor-pane'),
    editor: editor,
    fileBrowser: fileBrowser,
});

// Check current mode
if (interfaceManager.isCompact()) {
    console.log('In compact mode');
}

// Switch modes
interfaceManager.setMode('developer');

// Or toggle
interfaceManager.toggle();

// Listen for changes
interfaceManager.onModeChange(({ previousMode, newMode }) => {
    console.log(`Mode changed: ${previousMode} → ${newMode}`);
});
```

### Design Decisions

1. **InterfaceManager as Single Owner**: The codes app has a single `InterfaceManager` instance that owns all interface mode concerns. This makes the code easier to reason about.

2. **CSS-Based Visibility**: UI visibility is controlled via CSS classes, not JavaScript. This allows for smooth transitions and reduces DOM manipulation.

3. **Event-Driven Updates**: Mode changes flow through SessionState events. Components subscribe to changes rather than being directly called.

4. **Lifecycle Hooks**: InterfaceManager provides `onModeExit` and `onModeEnter` hooks for cleanup and initialization when switching modes.

### Future Improvements

1. **Migrate mode-controller to TypeScript**: Currently a legacy JS module.
2. **Consolidate CSS class application**: InterfaceManager could own this instead of mode-controller.
3. **Add animation support**: Smooth transitions between modes.

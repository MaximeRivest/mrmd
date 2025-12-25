/**
 * mrmd Core Module Exports
 *
 * Re-exports all core modules for convenient importing.
 */

// Utilities
export { escapeHtml, ansiToHtml, stripAnsi, highlightCode, detectLanguage, debounce, throttle } from './utils.js';

// Markdown parsing and rendering
export { renderTerminalToHtml, keyEventToTerminalSequence, colorCSS } from './terminal-renderer.js';

// Platform interfaces and implementations
export { IFileProvider, IStateStore, IUIProvider, BrowserFileProvider, BrowserStateStore, BrowserUIProvider, createBrowserProviders } from './interfaces.js';

// Application logic
export { SessionManager, createSessionManager } from './session-manager.js';

// API client
export { MrmdClient, client } from './mrmd-client.js';

// IPython integration
export {
    IPythonClient,
    CompletionController,
    HelpController,
    CodeBlockDetector,
    getCaretCoordinates,
    createIPythonIntegration
} from './ipython-client.js';

// Compact Mode Components
export { initCompactMode, toggleMode, destroyCompactMode, showHomeScreen, hideHomeScreen, isHomeScreenVisible } from './compact-mode.js';
export { initModeController } from './mode-controller.js';
export { createCompactHeader } from './compact-header.js';
export { createFileNavigator } from './file-navigator.js';
export { createToolRail } from './tool-rail.js';
export { createToolPanel, registerPanel } from './tool-panel.js';
export { createAIPanel } from './ai-panel.js';
export { createTerminalOverlay } from './terminal-overlay.js';
export { createMobileNav } from './mobile-nav.js';
export { createCompactStatus } from './compact-status.js';
export { createHomeScreen } from './home-screen.js';
export { createQuickPicker, open as openQuickPicker, close as closeQuickPicker } from './quick-picker.js';
export { createClaudePanel } from './claude-panel.js';

// ============================================
// @mrmd/editor - CodeMirror 6 based editor
// ============================================
//
// The editor is loaded via browser bundle. Import directly:
//
//   import { createEditor, createCollaborativeEditor } from '/editor-dist/index.browser.js';
//
// Available exports from the browser bundle:
// - Core: createEditor, MrmdEditor
// - Execution: IPythonExecutor, createMinimalIPythonClient, ExecutionTracker
// - Collaboration: createCollaborativeEditor, YjsDocManager, createYjsSync,
//                  LockManager, createLockManager, lockExtension
// - Streaming: startStream, streamChunk, completeStream, commitStream
// - Themes: zenTheme, zenEditorTheme, injectZenStyles
// - Widgets: ImageWidget, MathWidget, RunButtonWidget, RenderedHTMLWidget
//
// See editor/src/index.ts for the complete list.

// Collaboration client (WebSocket for file watching & presence)
export { CollabClient } from './collab-client.js';

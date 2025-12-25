/**
 * mrmd Core Module Exports
 *
 * Re-exports all core modules for convenient importing.
 */

// Utilities
export { escapeHtml, ansiToHtml, highlightCode, debounce, throttle } from './utils.js';

// Markdown parsing and rendering
export { parseMarkdown, mdToHtml, renderBlockBackgrounds } from './markdown-renderer.js';
export { highlightMarkdown, highlightMarkdownLine, highlightInline } from './preview-renderer.js';
export { highlightMarkdownOverlay, highlightMarkdownLineOverlay, highlightInlineContent, renderOverlaySpecial, renderStyledTable, parseMarkdownTable } from './overlay-renderer.js';
export { renderTerminalToHtml, keyEventToTerminalSequence, colorCSS } from './terminal-renderer.js';

// Platform interfaces and implementations
export { IFileProvider, IStateStore, IUIProvider, BrowserFileProvider, BrowserStateStore, BrowserUIProvider, createBrowserProviders } from './interfaces.js';

// Application logic
export { ExecutionEngine, createExecutionEngine, LANG_COMMANDS, REPL_PATTERNS, cleanReplOutput, detectPromptPattern } from './execution-engine.js';
export { SessionManager, createSessionManager } from './session-manager.js';
export { EditorController, createEditorController } from './editor-controller.js';

// API client
export { MrmdClient, client } from './mrmd-client.js';

// Overlay editor component
export { OverlayEditor } from './overlay-editor.js';

// Main application controller
export { MrmdApp, createApp } from './app.js';

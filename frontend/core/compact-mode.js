/**
 * Compact Mode Orchestrator for MRMD
 *
 * Main entry point that initializes and coordinates all compact mode components.
 */

import * as SessionState from './session-state.js';
import { initModeController, toggleMode } from './mode-controller.js';
import * as CompactHeader from './compact-header.js';
import * as FileNavigator from './file-navigator.js';
import * as ToolRail from './tool-rail.js';
import * as ToolPanel from './tool-panel.js';
// FormattingPanel removed - replaced by selection-triggered floating toolbar (selection-toolbar.js)
import * as AIPanel from './ai-panel.js';
import * as TerminalOverlay from './terminal-overlay.js';
import * as MobileNav from './mobile-nav.js';
import * as CompactStatus from './compact-status.js';
import * as HomeScreen from './home-screen.js';
import * as QuickPicker from './quick-picker.js';
import * as ClaudePanel from './claude-panel.js';
import * as PortalScreen from './portal-screen.js';
import * as ProjectExplorer from './project-explorer.js';
import * as TOCPanel from './toc-panel.js';
import * as InlineTOC from './inline-toc.js';

let initialized = false;
let editorRef = null;

/**
 * Initialize compact mode
 * @param {Object} options
 * @param {HTMLElement} options.container - Main container element
 * @param {HTMLElement} options.editorPane - Editor pane element
 * @param {Object} options.editor - Rich editor instance
 * @param {Function} options.createTerminal - Terminal factory function
 * @param {Object} options.fileBrowser - File browser instance
 */
export function initCompactMode(options = {}) {
    if (initialized) {
        console.warn('[CompactMode] Already initialized');
        return;
    }

    const {
        container,
        editorPane,
        editor,
        createTerminal,
        fileBrowser
    } = options;

    if (!container) {
        console.error('[CompactMode] Container element required');
        return null;
    }

    editorRef = editor;

    // Initialize mode controller
    initModeController(container);

    // Initialize inline TOC (Jony's vision - document becomes the TOC)
    InlineTOC.init({ editor, container });

    // Create quick picker
    const quickPickerEl = QuickPicker.createQuickPicker({
        onSelect: (path) => {
            // File selected from picker
            SessionState.emit('file-switch-requested', { path });
            editor?.focus();
        },
        onOpenProject: (path) => {
            // Project selected from picker
            SessionState.emit('project-open-requested', { path });
        },
        onCommand: (command) => {
            // Command executed from picker
            SessionState.emit('command-executed', { command });
        },
        getCollabClient: () => window.collabClient
    });

    // Create portal screen (level above home - shows all Claude's Homes)
    const portalScreenEl = PortalScreen.createPortalScreen({
        onHomeSelect: (home) => {
            // Home selected, show home screen
            HomeScreen.show();
        }
    });

    // Create home screen
    const homeScreenEl = HomeScreen.createHomeScreen({
        onProjectOpen: (path) => {
            // Project opened, home screen will auto-hide
            editor?.focus();
        },
        onOpenPicker: (opts) => {
            // Open the quick picker
            QuickPicker.open(opts);
        },
        onOpenPortal: () => {
            // Open portal screen
            PortalScreen.show();
        }
    });

    // Create compact header
    const headerEl = CompactHeader.createCompactHeader({
        onExit: () => {
            // Show home screen instead of file navigator
            HomeScreen.show();
        },
        onMenu: () => {
            ToolRail.toggle();
        }
    });

    // Create file navigator
    const navigatorEl = FileNavigator.createFileNavigator({
        onClose: () => {
            editor?.focus();
        },
        fileBrowser
    });

    // Create tool panel (backdrop + panel)
    const { panel: panelEl, backdrop: backdropEl } = ToolPanel.createToolPanel({
        onClose: () => {
            ToolRail.setActivePanel(null);
        }
    });

    // Register panel contents
    // Note: 'format' panel removed - replaced by selection-triggered floating toolbar

    ToolPanel.registerPanel('code', () => createCodeCellsPanel(editor), {
        title: 'Code Cells',
        width: 'narrow'
    });

    ToolPanel.registerPanel('ai', () => AIPanel.createAIPanel({
        onSpellTrigger: (spell, opts) => {
            SessionState.emit('ai-spell-triggered', { spell, ...opts });
        }
    }), {
        title: 'AI Commands',
        width: 'medium'
    });

    ToolPanel.registerPanel('variables', () => {
        // Reuse existing variables panel content
        const existingPanel = document.getElementById('variables-panel');
        if (existingPanel) {
            const content = existingPanel.querySelector('.env-pane');
            if (content) {
                const clone = content.cloneNode(true);
                clone.style.display = 'block';
                return clone;
            }
        }
        const empty = document.createElement('div');
        empty.className = 'env-pane-empty';
        empty.textContent = 'Run code to see variables';
        return empty;
    }, {
        title: 'Variables',
        width: 'narrow'
    });

    ToolPanel.registerPanel('files', () => {
        // Quick file picker - show open files
        const wrapper = document.createElement('div');
        wrapper.className = 'quick-files-panel';

        const openFiles = SessionState.getOpenFiles();
        const activeFile = SessionState.getActiveFilePath();

        if (openFiles.size > 0) {
            const list = document.createElement('div');
            list.className = 'quick-files-list';

            openFiles.forEach((fileData, path) => {
                const item = document.createElement('button');
                const isActive = path === activeFile;
                item.className = 'quick-file-item' + (isActive ? ' active' : '');
                item.innerHTML = `
                    <span class="quick-file-name">${path.split('/').pop()}</span>
                    ${fileData.modified ? '<span class="quick-file-modified">&bull;</span>' : ''}
                `;
                item.addEventListener('click', () => {
                    // Set active file and close panel
                    SessionState.setActiveFile(path);
                    SessionState.emit('file-switch-requested', { path });
                    ToolPanel.close();
                });
                list.appendChild(item);
            });
            wrapper.appendChild(list);
        } else {
            const hint = document.createElement('div');
            hint.className = 'quick-files-hint';
            hint.textContent = 'No open files';
            wrapper.appendChild(hint);

            // Add button to open file navigator
            const openBtn = document.createElement('button');
            openBtn.className = 'quick-files-open-btn';
            openBtn.textContent = 'Browse Files...';
            openBtn.addEventListener('click', () => {
                ToolPanel.close();
                FileNavigator.open();
            });
            wrapper.appendChild(openBtn);
        }
        return wrapper;
    }, {
        title: 'Open Files',
        width: 'narrow'
    });

    ToolPanel.registerPanel('more', createMoreMenu, {
        title: 'More',
        width: 'narrow'
    });

    // Register TOC panel - uses ToolPanel system like other panels
    ToolPanel.registerPanel('toc', () => TOCPanel.createTOCPanel({
        editor,
        onNavigate: () => {
            ToolPanel.close();
        }
    }), {
        title: 'Contents',
        width: 'narrow'
    });

    // Create tool rail
    const railEl = ToolRail.createToolRail({
        onPanelToggle: (tool) => {
            if (tool) {
                if (tool.id === 'terminal') {
                    TerminalOverlay.toggle();
                } else if (tool.id === 'toc') {
                    // Use inline TOC instead of panel (Jony's vision)
                    InlineTOC.toggle();
                    // Don't highlight the button since it's not a persistent panel
                    ToolRail.setActivePanel(null);
                } else {
                    ToolPanel.open(tool.id);
                }
            } else {
                ToolPanel.close();
            }
        },
        onStateToggle: (toggleId, isActive) => {
            // Handle state toggle changes
            if (toggleId === 'source') {
                // Toggle source/rendered view mode
                if (editorRef) {
                    editorRef.setViewMode(isActive ? 'source' : 'rendered');
                }
            } else if (toggleId === 'whitespace') {
                // Toggle whitespace visibility
                if (editorRef) {
                    editorRef.setShowWhitespace(isActive);
                }
            }
        },
        onClose: () => {
            // Update the floating UI state when rail closes
            CompactHeader.setMenuActive(false);
            ToolPanel.close();
        }
    });

    // Create terminal overlay
    const terminalEl = TerminalOverlay.createTerminalOverlay({
        createTerminal
    });

    // Create mobile navigation
    const mobileNavEl = MobileNav.createMobileNav({
        onItemClick: (item) => {
            if (!item) return;

            switch (item.id) {
                case 'files':
                    FileNavigator.toggle();
                    break;
                case 'ai':
                case 'code':
                    ToolPanel.toggle(item.id);
                    break;
                case 'run':
                    SessionState.emit('run-requested', {});
                    break;
                case 'more':
                    ToolPanel.toggle('more');
                    break;
            }
        }
    });

    // Create compact status bar
    const statusEl = CompactStatus.createCompactStatus();

    // Create global Claude panel
    const claudePanelEl = ClaudePanel.createClaudePanel();

    // Append elements to DOM
    // Floating UI goes directly in container (not in editorPane)
    container.appendChild(headerEl);
    container.appendChild(portalScreenEl);
    container.appendChild(homeScreenEl);
    container.appendChild(navigatorEl);
    container.appendChild(railEl);
    container.appendChild(backdropEl);
    container.appendChild(panelEl);
    container.appendChild(terminalEl);
    container.appendChild(mobileNavEl);
    container.appendChild(quickPickerEl);
    container.appendChild(claudePanelEl);

    // Insert compact status bar before the existing status bar
    const existingStatus = container.querySelector('.status-bar');
    if (existingStatus && existingStatus.parentNode) {
        existingStatus.parentNode.insertBefore(statusEl, existingStatus);
    } else if (editorPane) {
        editorPane.appendChild(statusEl);
    }

    // Apply initial tool rail side
    container.classList.add(`tool-rail-${SessionState.getToolRailSide()}`);

    // Open rail by default if user preference is set (default true)
    if (SessionState.getToolRailOpen()) {
        ToolRail.show();
        CompactHeader.setMenuActive(true);
    }

    // Register global keyboard shortcut for Ctrl+B / Cmd+B (browse project)
    document.addEventListener('keydown', handleGlobalKeydown, true);

    initialized = true;

    console.log('[CompactMode] Initialized');
}

/**
 * Handle global keyboard shortcuts for compact mode
 */
function handleGlobalKeydown(e) {
    // Only handle when in compact mode
    if (SessionState.getInterfaceMode() !== 'compact') return;

    // Check if focus is in the editor (for formatting shortcuts)
    // .cm-editor is the CodeMirror 6 editor; include other editable nodes for safety.
    const isInEditor = document.activeElement?.closest('.cm-editor, .code-block-editor, [contenteditable]');

    // Cmd+B / Ctrl+B - Bold in editor, or browse project if not in editor
    if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !e.shiftKey) {
        if (isInEditor) {
            // Let the editor handle Ctrl+B for bold formatting
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const currentProject = SessionState.getCurrentProject();
        if (currentProject) {
            // Toggle project explorer
            if (ProjectExplorer.isShown()) {
                ProjectExplorer.close();
            } else {
                ProjectExplorer.open(currentProject.path, currentProject.name);
            }
        } else {
            // No project - show home screen to pick one
            HomeScreen.show();
        }
        return;
    }

    // Cmd+P / Ctrl+P - Open project explorer (notebook browser)
    if ((e.metaKey || e.ctrlKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        const currentProject = SessionState.getCurrentProject();
        if (currentProject) {
            // Toggle project explorer
            if (ProjectExplorer.isShown()) {
                ProjectExplorer.close();
            } else {
                ProjectExplorer.open(currentProject.path, currentProject.name);
            }
        } else {
            // No project - show home screen to pick one
            HomeScreen.show();
        }
        return;
    }

    // Cmd+Shift+O / Ctrl+Shift+O - Toggle Structure Mode (Inline TOC)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        e.stopPropagation();
        InlineTOC.toggle();
        return;
    }
}

/**
 * Create the Code Cells panel content
 * @param {Object} editor - The rich editor instance
 */
function createCodeCellsPanel(editor) {
    const panel = document.createElement('div');
    panel.className = 'code-cells-panel';

    panel.innerHTML = `
        <div class="code-cells-section">
            <div class="code-cells-section-title">Actions</div>
            <button class="code-cells-btn" data-action="run-all">
                <span class="code-cells-btn-icon">▶</span>
                <span>Run All Cells</span>
            </button>
            <button class="code-cells-btn" data-action="run-above">
                <span class="code-cells-btn-icon">▲</span>
                <span>Run All Above</span>
            </button>
            <button class="code-cells-btn" data-action="run-below">
                <span class="code-cells-btn-icon">▼</span>
                <span>Run All Below</span>
            </button>
        </div>
        <div class="code-cells-section">
            <div class="code-cells-section-title">Outputs</div>
            <button class="code-cells-btn code-cells-btn-danger" data-action="clear-all-outputs">
                <span class="code-cells-btn-icon">✕</span>
                <span>Clear All Outputs</span>
            </button>
            <button class="code-cells-btn" data-action="collapse-all-outputs">
                <span class="code-cells-btn-icon">⊟</span>
                <span>Collapse All Outputs</span>
            </button>
            <button class="code-cells-btn" data-action="expand-all-outputs">
                <span class="code-cells-btn-icon">⊞</span>
                <span>Expand All Outputs</span>
            </button>
        </div>
        <div class="code-cells-section">
            <div class="code-cells-section-title">Kernel</div>
            <button class="code-cells-btn code-cells-btn-warning" data-action="restart-kernel">
                <span class="code-cells-btn-icon">↻</span>
                <span>Restart Kernel</span>
            </button>
            <button class="code-cells-btn code-cells-btn-danger" data-action="interrupt-kernel">
                <span class="code-cells-btn-icon">■</span>
                <span>Interrupt Execution</span>
            </button>
        </div>
    `;

    // Wire up action buttons
    panel.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            handleCodeCellAction(btn.dataset.action, editor);
            ToolPanel.close();
        });
    });

    return panel;
}

/**
 * Handle code cell panel actions
 */
function handleCodeCellAction(action, editor) {
    switch (action) {
        case 'run-all':
            SessionState.emit('run-all-cells');
            break;
        case 'run-above':
            SessionState.emit('run-cells-above');
            break;
        case 'run-below':
            SessionState.emit('run-cells-below');
            break;
        case 'clear-all-outputs':
            SessionState.emit('clear-all-outputs');
            break;
        case 'collapse-all-outputs':
            SessionState.emit('collapse-all-outputs');
            break;
        case 'expand-all-outputs':
            SessionState.emit('expand-all-outputs');
            break;
        case 'restart-kernel':
            SessionState.emit('restart-kernel');
            break;
        case 'interrupt-kernel':
            SessionState.emit('interrupt-kernel');
            break;
        default:
            console.warn('[CodeCellsPanel] Unknown action:', action);
    }
}

/**
 * Create the "More" menu content
 */
function createMoreMenu() {
    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.innerHTML = `
        <button class="more-menu-item" data-action="history">
            <span>&#x23F1;</span> Version History
        </button>
        <button class="more-menu-item" data-action="processes">
            <span>&#x2699;</span> Processes
        </button>
        <div class="more-menu-divider"></div>
        <label class="more-menu-toggle">
            <input type="checkbox" data-toggle="full-status"> Show full status bar
        </label>
        <label class="more-menu-toggle">
            <input type="checkbox" data-toggle="line-numbers"> Show line numbers
        </label>
        <div class="more-menu-divider"></div>
        <button class="more-menu-item" data-action="settings">
            <span>&#x2699;</span> Settings...
        </button>
        <div class="more-menu-divider"></div>
        <button class="more-menu-item" data-action="developer-mode">
            <span>&#x2194;</span> Switch to Developer Mode
        </button>
    `;

    // Wire up action buttons
    menu.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            handleMoreMenuAction(btn.dataset.action);
        });
    });

    // Wire up toggles
    menu.querySelectorAll('[data-toggle]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            handleToggle(checkbox.dataset.toggle, checkbox.checked);
        });
    });

    return menu;
}

/**
 * Handle "More" menu actions
 */
function handleMoreMenuAction(action) {
    switch (action) {
        case 'history':
            // Switch to developer mode and show history tab
            const historyTab = document.querySelector('.sidebar-tab[data-panel="history"]');
            if (historyTab) {
                SessionState.setInterfaceMode('developer');
                setTimeout(() => historyTab.click(), 100);
            }
            ToolPanel.close();
            break;

        case 'processes':
            // Switch to developer mode and show processes tab
            const processTab = document.querySelector('.sidebar-tab[data-panel="processes"]');
            if (processTab) {
                SessionState.setInterfaceMode('developer');
                setTimeout(() => processTab.click(), 100);
            }
            ToolPanel.close();
            break;

        case 'settings':
            SessionState.emit('settings-requested', {});
            ToolPanel.close();
            break;

        case 'developer-mode':
            toggleMode();
            ToolPanel.close();
            break;
    }
}

/**
 * Handle toggle switches
 */
function handleToggle(toggle, checked) {
    switch (toggle) {
        case 'full-status':
            SessionState.setStatusBarExpanded(checked);
            break;
        case 'line-numbers':
            // TODO: Implement line numbers toggle
            console.log('[CompactMode] Line numbers:', checked);
            break;
    }
}

/**
 * Check if compact mode is initialized
 */
export function isInitialized() {
    return initialized;
}

/**
 * Destroy compact mode
 */
export function destroyCompactMode() {
    document.removeEventListener('keydown', handleGlobalKeydown, true);

    PortalScreen.destroy?.();
    HomeScreen.destroy?.();
    CompactHeader.destroy?.();
    FileNavigator.destroy?.();
    ToolRail.destroy?.();
    ToolPanel.destroy?.();
    TerminalOverlay.destroy?.();
    MobileNav.destroy?.();
    CompactStatus.destroy?.();
    QuickPicker.destroy?.();
    ClaudePanel.destroy?.();
    InlineTOC.destroy?.();

    initialized = false;
    editorRef = null;
}

/**
 * Show the home screen
 */
export function showHomeScreen() {
    HomeScreen.show();
}

/**
 * Hide the home screen
 */
export function hideHomeScreen() {
    HomeScreen.hide();
}

/**
 * Check if home screen is visible
 */
export function isHomeScreenVisible() {
    return HomeScreen.isShown();
}

// Re-export for external access
export { toggleMode };
export { FileNavigator, ToolRail, ToolPanel, TerminalOverlay, HomeScreen, QuickPicker, ClaudePanel, PortalScreen, InlineTOC };

export default {
    initCompactMode,
    isInitialized,
    destroyCompactMode,
    toggleMode,
    showHomeScreen,
    hideHomeScreen,
    isHomeScreenVisible
};

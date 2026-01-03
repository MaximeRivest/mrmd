/**
 * Compact Mode Orchestrator for MRMD
 *
 * Main entry point that initializes and coordinates all compact mode components.
 */

import * as SessionState from './session-state.js';
import { initModeController, toggleMode } from './mode-controller.js';
import * as CompactHeader from './compact-header.js';
import * as ProjectStatus from './project-status.js';
import * as FileNavigator from './file-navigator.js';
import * as ToolRail from './tool-rail.js';
import * as ToolPanel from './tool-panel.js';
// FormattingPanel removed - replaced by selection-triggered floating toolbar (selection-toolbar.js)
import * as AIPanel from './ai-panel.js';
import * as TerminalOverlay from './terminal-overlay.js';
import * as CompactStatus from './compact-status.js';
import * as DeveloperStatus from './developer-status.js';
import * as HomeScreen from './home-screen.js';
import * as QuickPicker from './quick-picker.js';
import * as ClaudePanel from './claude-panel.js';
import * as PortalScreen from './portal-screen.js';
// ProjectExplorer removed - functionality merged into QuickPicker browse mode
import * as TOCPanel from './toc-panel.js';
import * as InlineTOC from './inline-toc.js';
import { KeybindingManager } from './keybinding-manager.js';
import { initEditorKeybindings } from './editor-keybindings.js';

let initialized = false;
let editorRef = null;

/**
 * Initialize compact mode
 * @param {Object} options
 * @param {HTMLElement} options.container - Main container element
 * @param {HTMLElement} options.editorPane - Editor pane element
 * @param {Object} options.editor - Rich editor instance (deprecated, use getEditor)
 * @param {Function} options.getEditor - Function that returns current editor instance
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
        getEditor,
        createTerminal,
        fileBrowser
    } = options;

    if (!container) {
        console.error('[CompactMode] Container element required');
        return null;
    }

    // Prefer getEditor function, fallback to static editor reference
    const getEditorFn = getEditor || (() => editor);
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

    // Initialize project status service
    ProjectStatus.init();

    // Create compact header
    const headerEl = CompactHeader.createCompactHeader({
        onExit: () => {
            try {
                console.log('[CompactMode] Exit button clicked');
                // Check if current file is untitled before showing home screen
                const currentPath = SessionState.getActiveFilePath();
                const isUntitled = currentPath ? SessionState.isUntitledFile(currentPath) : false;
                console.log('[CompactMode] Current path:', currentPath, 'isUntitled:', isUntitled);
                if (currentPath && isUntitled) {
                    // Emit event to trigger save picker via codes/index.ts
                    // This ensures proper handling of recent notebooks, tabs, etc.
                    console.log('[CompactMode] Emitting untitled-file-exit-requested');
                    SessionState.emit('untitled-file-exit-requested', {
                        path: currentPath,
                        showHomeAfter: true,
                    });
                } else {
                    // Normal file or no file - just show home screen
                    console.log('[CompactMode] Showing home screen');
                    HomeScreen.show();
                }
            } catch (err) {
                console.error('[CompactMode] Error in onExit:', err);
                // Fallback to showing home screen
                HomeScreen.show();
            }
        },
        onMenu: () => {
            ToolRail.toggle();
        },
        onProjectClick: () => {
            // Open picker in browse mode to switch projects
            QuickPicker.open({ mode: 'browse', context: 'home' });
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

    // Use getEditorFn() to get fresh editor reference when panel opens
    ToolPanel.registerPanel('code', () => createCodeCellsPanel(getEditorFn()), {
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
        // Get the actual variables panel (created by variables-panel.js)
        // Check both the sidebar container AND the tool panel content (element gets moved)
        let content = document.querySelector('#variables-panel .variables-panel')
                   || document.querySelector('.tool-panel-content .variables-panel');

        if (content) {
            content.style.display = 'block';
            return content;
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
        // Project-organized file picker
        const wrapper = document.createElement('div');
        wrapper.className = 'quick-files-panel';

        const currentProject = SessionState.getCurrentProject();
        const openFiles = SessionState.getOpenFiles();
        const activeFile = SessionState.getActiveFilePath();
        const recentProjects = SessionState.getRecentProjects() || [];

        // Helper to create file item
        const createFileItem = (path, isActive, isModified) => {
            const item = document.createElement('button');
            item.className = 'quick-file-item' + (isActive ? ' active' : '');
            item.innerHTML = `
                <span class="quick-file-name">${path.split('/').pop()}</span>
                ${isModified ? '<span class="quick-file-modified">●</span>' : ''}
            `;
            item.addEventListener('click', () => {
                SessionState.emit('file-switch-requested', { path });
                ToolPanel.close();
            });
            return item;
        };

        // Helper to create project section
        const createProjectSection = (projectPath, projectName, files, isCurrentProject) => {
            const section = document.createElement('div');
            section.className = 'quick-files-project' + (isCurrentProject ? ' current' : '');

            const header = document.createElement('div');
            header.className = 'quick-files-project-header';
            header.innerHTML = `
                <span class="project-icon">${isCurrentProject ? '◆' : '◇'}</span>
                <span class="project-name">${projectName}</span>
                <span class="project-count">${files.length}</span>
            `;

            if (!isCurrentProject) {
                header.style.cursor = 'pointer';
                header.addEventListener('click', () => {
                    // Switch to this project
                    SessionState.openProject(projectPath);
                    ToolPanel.close();
                });
            }

            section.appendChild(header);

            if (isCurrentProject && files.length > 0) {
                const list = document.createElement('div');
                list.className = 'quick-files-list';
                files.forEach(({ path, modified }) => {
                    const isActive = path === activeFile;
                    list.appendChild(createFileItem(path, isActive, modified));
                });
                section.appendChild(list);
            }

            return section;
        };

        // Current project with open files
        if (currentProject) {
            const currentFiles = [];
            openFiles.forEach((fileData, path) => {
                currentFiles.push({ path, modified: fileData.modified });
            });
            wrapper.appendChild(createProjectSection(
                currentProject.path,
                currentProject.name,
                currentFiles,
                true
            ));
        } else if (openFiles.size > 0) {
            // No project but have open files (scratch)
            const scratchSection = document.createElement('div');
            scratchSection.className = 'quick-files-project current';
            const list = document.createElement('div');
            list.className = 'quick-files-list';
            openFiles.forEach((fileData, path) => {
                list.appendChild(createFileItem(path, path === activeFile, fileData.modified));
            });
            scratchSection.appendChild(list);
            wrapper.appendChild(scratchSection);
        }

        // Recent projects (not current)
        const otherProjects = recentProjects.filter(p =>
            !currentProject || p.path !== currentProject.path
        ).slice(0, 5);

        if (otherProjects.length > 0) {
            const divider = document.createElement('div');
            divider.className = 'quick-files-divider';
            divider.textContent = 'Recent Projects';
            wrapper.appendChild(divider);

            otherProjects.forEach(project => {
                const savedTabs = SessionState.getSavedProjectTabs?.(project.path);
                const fileCount = savedTabs?.tabs?.length || 0;
                wrapper.appendChild(createProjectSection(
                    project.path,
                    project.name,
                    [], // Don't show files for non-current projects
                    false
                ));
            });
        }

        // Empty state
        if (!currentProject && openFiles.size === 0 && otherProjects.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'quick-files-hint';
            hint.textContent = 'No open files';
            wrapper.appendChild(hint);
        }

        // Browse button
        const openBtn = document.createElement('button');
        openBtn.className = 'quick-files-open-btn';
        openBtn.textContent = 'Browse Files...';
        openBtn.addEventListener('click', () => {
            ToolPanel.close();
            FileNavigator.open();
        });
        wrapper.appendChild(openBtn);

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
                    // Update editor reference before toggling (editor may not be ready at init)
                    InlineTOC.setEditor(getEditorFn());
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
            const editor = getEditorFn();
            if (toggleId === 'source') {
                // Toggle raw/rendered view mode
                editor?.setRawMode?.(isActive);
            } else if (toggleId === 'whitespace') {
                // Toggle whitespace visibility
                editor?.setShowWhitespace?.(isActive);
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

    // Create compact status bar
    const statusEl = CompactStatus.createCompactStatus();

    // Initialize developer mode status bar (wires up session/venv badges in index.html)
    // These elements are hidden in compact mode via CSS, but need JS wiring for developer mode
    DeveloperStatus.initDeveloperStatus();

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

    // Initialize keybinding manager and register handlers
    initKeybindings(getEditorFn);

    initialized = true;

    console.log('[CompactMode] Initialized');
}

/**
 * Initialize keybindings for compact mode
 * Registers handlers and context providers with the central KeybindingManager
 * @param {Function} getEditor - Function that returns the current editor instance
 */
function initKeybindings(getEditor) {
    // Initialize the manager (safe to call multiple times)
    KeybindingManager.init();

    // Register context providers
    KeybindingManager.registerContext('editor', () => {
        const active = document.activeElement;
        return !!active?.closest('.cm-editor, .code-block-editor, [contenteditable="true"]');
    });

    KeybindingManager.registerContext('compact-mode', () => {
        return SessionState.getInterfaceMode() === 'compact';
    });

    // Initialize editor keybindings (code execution: Ctrl+Enter, Shift+Enter, etc.)
    if (getEditor) {
        const statusEl = document.getElementById('exec-status') || document.querySelector('.compact-status');
        initEditorKeybindings({ getEditor, statusEl });
    }

    // Handler for universal picker (⌘P)
    const openPicker = () => {
        // Only handle when in compact mode
        if (SessionState.getInterfaceMode() !== 'compact') return;

        if (QuickPicker.isVisible()) {
            QuickPicker.close();
        } else {
            // Determine context: 'home' if on home screen, 'project' otherwise
            const isOnHome = HomeScreen.isShown();
            const context = isOnHome || !SessionState.getCurrentProject() ? 'home' : 'project';
            QuickPicker.open({
                mode: 'files',
                context,
                onCreate: handleFileCreate,
            });
        }
    };

    // Handler for file creation from picker
    const handleFileCreate = async (path) => {
        // Create the file with initial content
        const filename = path.split('/').pop();
        const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
        const initialContent = `# ${nameWithoutExt}\n\n`;

        try {
            // Ensure parent directory exists
            const dir = path.substring(0, path.lastIndexOf('/'));
            await fetch('/api/file/mkdir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dir })
            });

            // Create the file
            await fetch('/api/file/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: initialContent })
            });

            // Open the file
            SessionState.emit('file-switch-requested', { path });

            // Hide home screen if visible
            if (HomeScreen.isShown()) {
                HomeScreen.hide();
            }
        } catch (err) {
            console.error('[CompactMode] Failed to create file:', err);
        }
    };

    // Register handler for nav:picker (replaces nav:project-explorer)
    KeybindingManager.handle('nav:picker', openPicker);

    // Toggle inline TOC
    KeybindingManager.handle('nav:toggle-toc', () => {
        if (SessionState.getInterfaceMode() !== 'compact') return;
        // Update editor reference before toggling (editor may not be ready at init)
        InlineTOC.setEditor(getEditor());
        InlineTOC.toggle();
    });
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
 * Directly calls editor methods and API endpoints for reliable execution.
 */
async function handleCodeCellAction(action, editor) {
    console.log('[CodeCellsPanel] Action:', action, 'Editor:', !!editor);

    if (!editor) {
        console.error('[CodeCellsPanel] No editor available for action:', action);
        return;
    }

    switch (action) {
        case 'run-all':
            if (editor.runAllCodeBlocks) {
                console.log('[CodeCellsPanel] Running all code blocks...');
                // Pause autosave during bulk execution to prevent race conditions
                SessionState.emit('autosave-pause');
                try {
                    // Pass callback to save after each block completes
                    await editor.runAllCodeBlocks(async (blockIndex, total) => {
                        // Save progress after each block
                        SessionState.emit('save-now');
                    });
                } finally {
                    // Resume autosave even if execution fails
                    SessionState.emit('autosave-resume');
                }
            } else {
                console.error('[CodeCellsPanel] runAllCodeBlocks not found on editor');
            }
            break;
        case 'run-above':
            if (editor?.runCodeBlocksAbove) {
                SessionState.emit('autosave-pause');
                try {
                    await editor.runCodeBlocksAbove(async () => {
                        SessionState.emit('save-now');
                    });
                } finally {
                    SessionState.emit('autosave-resume');
                }
            }
            break;
        case 'run-below':
            if (editor?.runCodeBlocksBelow) {
                SessionState.emit('autosave-pause');
                try {
                    await editor.runCodeBlocksBelow(async () => {
                        SessionState.emit('save-now');
                    });
                } finally {
                    SessionState.emit('autosave-resume');
                }
            }
            break;
        case 'clear-all-outputs':
            if (editor?.clearAllOutputs) {
                editor.clearAllOutputs();
            }
            break;
        case 'collapse-all-outputs':
            // Use CodeMirror's native fold system for proper collapse behavior
            if (editor?.foldAllOutputs) {
                const count = editor.foldAllOutputs();
                console.log('[CodeCellsPanel] Folded', count, 'output blocks');
            }
            break;
        case 'expand-all-outputs':
            // Use CodeMirror's native unfold system
            if (editor?.unfoldAllOutputs) {
                const count = editor.unfoldAllOutputs();
                console.log('[CodeCellsPanel] Unfolded', count, 'output blocks');
            }
            break;
        case 'restart-kernel':
            try {
                const response = await fetch('/api/server/restart', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                if (response.ok) {
                    console.log('[CodeCellsPanel] Kernel restart initiated');
                }
            } catch (err) {
                console.error('[CodeCellsPanel] Failed to restart kernel:', err);
            }
            break;
        case 'interrupt-kernel':
            // Cancel client-side executions
            if (editor?.cancelAllExecutions) {
                editor.cancelAllExecutions();
                console.log('[CodeCellsPanel] Client-side executions cancelled');
            }
            // Also send interrupt to server (for long-running Python code)
            try {
                const response = await fetch('/api/ipython/interrupt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                if (response.ok) {
                    console.log('[CodeCellsPanel] Server execution interrupted');
                }
            } catch (err) {
                console.error('[CodeCellsPanel] Failed to interrupt server execution:', err);
            }
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
    // Unregister keybinding handlers
    KeybindingManager.unhandle('nav:picker');
    KeybindingManager.unhandle('nav:toggle-toc');
    KeybindingManager.unregisterContext('editor');
    KeybindingManager.unregisterContext('compact-mode');

    PortalScreen.destroy?.();
    HomeScreen.destroy?.();
    CompactHeader.destroy?.();
    FileNavigator.destroy?.();
    ToolRail.destroy?.();
    ToolPanel.destroy?.();
    TerminalOverlay.destroy?.();
    CompactStatus.destroy?.();
    DeveloperStatus.destroyDeveloperStatus?.();
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

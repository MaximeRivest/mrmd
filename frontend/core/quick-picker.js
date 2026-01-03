/**
 * Universal Picker for MRMD
 *
 * A unified interface for all navigation, search, and file creation.
 *
 * Design philosophy:
 * - One shortcut (⌘P) opens one UI
 * - Prefixes unlock power features: / = browse, > = commands, ? = content search
 * - Context determines defaults (home shows all recent, project shows project files)
 * - File creation and file finding use the same interface
 *
 * Keybindings are defined centrally in keybindings.js
 */

import * as SessionState from './session-state.js';
import { createFileBrowser, fuzzyMatch, highlightMatches, getFileIcon, esc } from './file-browser.js';
import { grepSearch } from './grep-search.js';
import { KeybindingManager } from './keybinding-manager.js';
import { MOD_KEY_TEXT as modKey, getBindingDisplayString } from './keybindings.js';

let overlayEl = null;
let isOpen = false;
let currentMode = 'files';
let openContext = null; // 'home' | 'project' | null - set when picker opens
let browseStartPath = null; // Custom start path for browse mode
let fileBrowser = null;
let fileBrowserContainerEl = null;
let onSelect = null;
let onOpenProject = null;
let onCreate = null; // Callback for file creation
let getCollabClient = null;

// Preview state
let previewCache = new Map(); // path -> { content, timestamp }
let currentPreviewPath = null;
let previewAbortController = null;

// Content search state
let contentSearchResults = [];
let contentSearchQuery = '';

// Save-to mode state
let saveToState = {
    active: false,
    originalPath: null,      // The file being saved/moved
    currentDir: null,        // Current directory being browsed
    inputValue: '',          // Current input (filename or partial path)
    copyMode: false,         // true = copy, false = move
    closeAfter: false,       // true = close file after save (tab X scenario)
    onComplete: null,        // Callback when save completes: (newPath, wasCopy, closeAfter) => void
    onCancel: null,          // Callback when cancelled: (reason) => void
};

// Directory contents cache for save-to mode
const directoryCache = new Map(); // path -> { entries, timestamp }
const CACHE_TTL = 5000; // 5 seconds

// Available modes with their configurations
// Prefixes: (none) = files, / = browse, > = commands, ? = content search
// Note: 'save-to' is special and not included in prefix detection
const MODES = {
    files: {
        placeholder: 'Search files...',
        icon: '/',
        prefix: '',  // Default mode, no prefix needed
        emptyText: 'No files found',
        hasPreview: true,
    },
    browse: {
        placeholder: 'Navigate...',
        icon: '/',
        prefix: '/',  // Typing / switches to browse mode
        emptyText: 'Empty directory',
    },
    commands: {
        placeholder: 'Search commands...',
        icon: '>',
        prefix: '>',  // Typing > switches to commands mode
        emptyText: 'No commands found',
    },
    content: {
        placeholder: 'Search in files...',
        icon: '?',
        prefix: '?',  // Typing ? switches to content search
        emptyText: 'Type to search file contents',
        hasPreview: true,
    },
    'save-to': {
        placeholder: 'Save as...',
        icon: '↓',
        prefix: null,  // Not accessible via prefix
        emptyText: 'Type a filename or navigate to a folder',
        hasPreview: false,
        isPathBuilder: true,
        excludeFromCycle: true,
    },
};

// Available commands - shortcuts use modKey for platform-appropriate display
function getCommands() {
    return [
        { id: 'new-file', name: 'New File', description: 'Create a new file', shortcut: `${modKey}+N` },
        { id: 'new-notebook', name: 'New Notebook', description: 'Create a new markdown notebook', shortcut: '' },
        { id: 'open-folder', name: 'Open Folder', description: 'Open a project folder', shortcut: `${modKey}+O` },
        { id: 'save', name: 'Save', description: 'Save current file', shortcut: `${modKey}+S` },
        { id: 'save-as', name: 'Save As', description: 'Save file with new name', shortcut: `${modKey}+Shift+S` },
        { id: 'close-file', name: 'Close File', description: 'Close current file', shortcut: `${modKey}+W` },
        { id: 'toggle-terminal', name: 'Toggle Terminal', description: 'Show/hide terminal', shortcut: `${modKey}+\`` },
        { id: 'toggle-sidebar', name: 'Toggle Sidebar', description: 'Show/hide sidebar', shortcut: `${modKey}+B` },
        { id: 'run-cell', name: 'Run Cell', description: 'Execute current code cell', shortcut: `${modKey}+Enter` },
        { id: 'run-all', name: 'Run All Cells', description: 'Execute all code cells', shortcut: `${modKey}+Shift+Enter` },
        { id: 'settings', name: 'Settings', description: 'Open settings', shortcut: `${modKey}+,` },
        { id: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', description: 'View all shortcuts', shortcut: '' },
    ];
}

/**
 * Create the quick picker
 * @param {Object} options
 * @param {Function} options.onSelect - Called when a file is selected
 * @param {Function} options.onOpenProject - Called when a project is opened
 * @param {Function} options.onCommand - Called when a command is selected
 * @param {Function} options.getCollabClient - Function to get collab client
 * @returns {HTMLElement}
 */
export function createQuickPicker(options = {}) {
    onSelect = options.onSelect || (() => {});
    onOpenProject = options.onOpenProject || (() => {});
    getCollabClient = options.getCollabClient || null;

    overlayEl = document.createElement('div');
    overlayEl.className = 'quick-picker-overlay';
    overlayEl.innerHTML = `
        <div class="quick-picker">
            <div class="quick-picker-input-container">
                <span class="quick-picker-icon">/</span>
                <input
                    type="text"
                    class="quick-picker-input"
                    placeholder="Search files..."
                    autocomplete="off"
                    spellcheck="false"
                />
            </div>
            <div class="quick-picker-content" id="quick-picker-content">
                <div class="quick-picker-results">
                    <div class="quick-picker-list" id="quick-picker-list">
                        <!-- Results will be rendered here -->
                    </div>
                    <div class="quick-picker-browser" id="quick-picker-browser" style="display: none;">
                        <!-- File browser will be rendered here -->
                    </div>
                </div>
                <div class="quick-picker-preview" id="quick-picker-preview">
                    <div class="quick-picker-preview-header" id="quick-picker-preview-header"></div>
                    <div class="quick-picker-preview-content" id="quick-picker-preview-content">
                        <div class="quick-picker-preview-empty">Select a file to preview</div>
                    </div>
                </div>
            </div>
            <div class="quick-picker-footer">
                <span class="quick-picker-hint" id="quick-picker-hint">
                    <kbd>↑↓</kbd> navigate
                    <kbd>↵</kbd> select
                    <kbd>esc</kbd> close
                </span>
                <span class="quick-picker-path" id="quick-picker-path"></span>
            </div>
        </div>
    `;

    // Setup event listeners
    setupEventListeners(options);

    // Create file browser for browse mode
    fileBrowserContainerEl = overlayEl.querySelector('#quick-picker-browser');

    // Register keybinding handlers and context providers
    registerQuickPickerKeybindings();

    return overlayEl;
}

/**
 * Setup event listeners
 */
function setupEventListeners(options) {
    const input = overlayEl.querySelector('.quick-picker-input');

    // Close on overlay click
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
            if (currentMode === 'save-to' && saveToState.active) {
                handleSaveToCancel();
            } else {
                close();
            }
        }
    });

    // Input handling with prefix detection
    input.addEventListener('input', () => {
        if (currentMode === 'save-to') {
            renderSaveToResults();
            return;
        }

        // Check for prefix-based mode switching
        const value = input.value;
        const detectedMode = detectModeFromPrefix(value);

        if (detectedMode && detectedMode !== currentMode) {
            // Switch mode and strip the prefix
            setMode(detectedMode, { keepInput: true, stripPrefix: true });
        } else {
            renderResults();
        }
    });

    input.addEventListener('keydown', handleInputKeydown);
}

/**
 * Detect mode from input prefix
 * @param {string} value - Input value
 * @returns {string|null} - Mode name or null if no prefix detected
 */
function detectModeFromPrefix(value) {
    if (!value || value.length === 0) return null;

    const firstChar = value[0];

    // Check each mode's prefix
    for (const [modeName, config] of Object.entries(MODES)) {
        if (config.prefix && config.prefix === firstChar) {
            return modeName;
        }
    }

    return null;
}

/**
 * Handle input keydown
 * Note: Most navigation keys are now handled by KeybindingManager
 * This handler is kept for any picker-specific behavior not in the central config
 */
function handleInputKeydown(e) {
    // KeybindingManager handles: Escape, Enter, Ctrl+Enter, Arrow keys, Tab, Backspace (in browse)
    // We only need to handle things specific to the input that aren't in the central config
    // Currently, all navigation is handled centrally, so this is a no-op placeholder
}

/**
 * Register keybinding handlers and context providers with KeybindingManager
 */
function registerQuickPickerKeybindings() {
    // Register context providers
    KeybindingManager.registerContext('quick-picker', () => isOpen);
    KeybindingManager.registerContext('quick-picker-browse-mode', () => currentMode === 'browse');
    KeybindingManager.registerContext('quick-picker-input-empty', () => {
        const input = overlayEl?.querySelector('.quick-picker-input');
        return input && !input.value;
    });

    // Global shortcuts to open quick picker modes
    // Context is determined automatically based on current project state
    KeybindingManager.handle('nav:quick-open-commands', () => {
        if (isOpen && currentMode === 'commands') {
            close();
        } else {
            const context = SessionState.getCurrentProject() ? 'project' : 'home';
            open({ mode: 'commands', context });
        }
    });

    KeybindingManager.handle('nav:browse', () => {
        if (isOpen && currentMode === 'browse') {
            close();
        } else {
            const context = SessionState.getCurrentProject() ? 'project' : 'home';
            open({ mode: 'browse', context });
        }
    });

    KeybindingManager.handle('nav:search-content', () => {
        if (isOpen && currentMode === 'content') {
            close();
        } else {
            const context = SessionState.getCurrentProject() ? 'project' : 'home';
            open({ mode: 'content', context });
        }
    });

    // Picker-internal navigation (only when picker is open)
    KeybindingManager.handle('picker:close', () => {
        if (currentMode === 'save-to' && saveToState.active) {
            handleSaveToCancel();
        } else {
            close();
        }
    });

    KeybindingManager.handle('picker:select', () => {
        if (currentMode === 'save-to') {
            handleSaveToSelect();
        } else {
            selectCurrentItem();
        }
    });

    KeybindingManager.handle('picker:open-project', () => {
        if (fileBrowser && onOpenProject) {
            const currentPath = fileBrowser.getCurrentPath();
            close();
            onOpenProject(currentPath);
        }
    });

    KeybindingManager.handle('picker:navigate-up', () => {
        moveSelection(-1);
    });

    KeybindingManager.handle('picker:navigate-down', () => {
        moveSelection(1);
    });

    KeybindingManager.handle('picker:next-mode', () => {
        // Tab is for autocomplete in save-to mode
        if (currentMode === 'save-to') {
            handleSaveToAutocomplete();
            return;
        }
        // In other modes, Tab does nothing (we use prefixes for mode switching)
    });

    KeybindingManager.handle('picker:prev-mode', () => {
        // Shift-Tab does nothing (we use prefixes for mode switching)
    });

    KeybindingManager.handle('picker:go-up', () => {
        if (fileBrowser) {
            const currentPath = fileBrowser.getCurrentPath();
            const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
            if (parentPath !== currentPath) {
                fileBrowser.loadDirectory(parentPath);
            }
        }
    });
}

/**
 * Unregister keybinding handlers
 */
function unregisterQuickPickerKeybindings() {
    KeybindingManager.unregisterContext('quick-picker');
    KeybindingManager.unregisterContext('quick-picker-browse-mode');
    KeybindingManager.unregisterContext('quick-picker-input-empty');

    KeybindingManager.unhandle('nav:quick-open-commands');
    KeybindingManager.unhandle('nav:browse');
    KeybindingManager.unhandle('nav:search-content');
    KeybindingManager.unhandle('picker:close');
    KeybindingManager.unhandle('picker:select');
    KeybindingManager.unhandle('picker:open-project');
    KeybindingManager.unhandle('picker:navigate-up');
    KeybindingManager.unhandle('picker:navigate-down');
    KeybindingManager.unhandle('picker:next-mode');
    KeybindingManager.unhandle('picker:prev-mode');
    KeybindingManager.unhandle('picker:go-up');
}

/**
 * Set the current mode
 * @param {string} mode - Mode to switch to
 * @param {Object} options - Options
 * @param {boolean} options.keepInput - Keep current input value
 * @param {boolean} options.stripPrefix - Strip the prefix character from input
 */
function setMode(mode, options = {}) {
    if (!MODES[mode]) return;

    const { keepInput = false, stripPrefix = false } = options;

    currentMode = mode;
    const config = MODES[mode];

    const icon = overlayEl.querySelector('.quick-picker-icon');
    const input = overlayEl.querySelector('.quick-picker-input');

    icon.textContent = config.icon;
    input.placeholder = config.placeholder;

    // Handle input value
    if (!keepInput) {
        input.value = '';
    } else if (stripPrefix && config.prefix && input.value.startsWith(config.prefix)) {
        // Strip the prefix character
        input.value = input.value.slice(config.prefix.length);
    }

    // Show/hide appropriate content
    const listEl = overlayEl.querySelector('#quick-picker-list');
    const browserEl = overlayEl.querySelector('#quick-picker-browser');

    // Toggle preview pane
    const contentEl = overlayEl.querySelector('#quick-picker-content');
    const pickerEl = overlayEl.querySelector('.quick-picker');
    const hasPreview = config.hasPreview && mode !== 'browse';

    contentEl.classList.toggle('has-preview', hasPreview);
    pickerEl.classList.toggle('with-preview', hasPreview);

    // Clear preview when switching modes
    if (hasPreview) {
        clearPreview();
    }

    // Abort any pending content search when switching modes
    if (mode !== 'content') {
        grepSearch.abort();
        contentSearchResults = [];
        contentSearchQuery = '';
    }

    if (mode === 'browse') {
        listEl.style.display = 'none';
        browserEl.style.display = 'flex';
        initFileBrowser();
    } else if (mode === 'save-to') {
        listEl.style.display = 'block';
        browserEl.style.display = 'none';
        // Pre-fill with original filename if set
        if (saveToState.originalPath && !keepInput) {
            const filename = saveToState.originalPath.split('/').pop() || '';
            input.value = filename;
            input.placeholder = 'Enter filename...';
            // Select the name part (before extension)
            const dotIndex = filename.lastIndexOf('.');
            if (dotIndex > 0) {
                setTimeout(() => input.setSelectionRange(0, dotIndex), 0);
            }
        }
        renderSaveToResults();
    } else {
        listEl.style.display = 'block';
        browserEl.style.display = 'none';
        renderResults();
    }

    // Update hints based on mode
    updateHints();

    // Focus input reliably after DOM updates
    setTimeout(() => {
        if (isOpen) {
            input.focus();
        }
    }, 10);
}

/**
 * Update footer hints based on current mode
 */
function updateHints() {
    const hintEl = overlayEl.querySelector('#quick-picker-hint');
    if (!hintEl) return;

    if (currentMode === 'browse') {
        hintEl.innerHTML = `
            <kbd>↑↓</kbd> navigate
            <kbd>↵</kbd> open
            <kbd>${modKey}+↵</kbd> open as project
            <kbd>esc</kbd> close
        `;
    } else if (currentMode === 'save-to') {
        const actionLabel = saveToState.copyMode ? 'copy' : 'save';
        hintEl.innerHTML = `
            <kbd>↑↓</kbd> navigate
            <kbd>Tab</kbd> autocomplete
            <kbd>↵</kbd> ${actionLabel}
            <kbd>esc</kbd> cancel
        `;
    } else if (currentMode === 'files') {
        hintEl.innerHTML = `
            <kbd>↑↓</kbd> navigate
            <kbd>↵</kbd> open
            <kbd>/</kbd> browse
            <kbd>></kbd> commands
            <kbd>?</kbd> search content
        `;
    } else {
        hintEl.innerHTML = `
            <kbd>↑↓</kbd> navigate
            <kbd>↵</kbd> select
            <kbd>esc</kbd> close
        `;
    }
}

/**
 * Initialize file browser for browse mode
 * Context-aware: starts at ~/Projects when from home, at project root otherwise
 * Can be overridden with browseStartPath
 */
function initFileBrowser() {
    const project = SessionState.getCurrentProject();
    const isFromHome = openContext === 'home' || !project;

    // Determine starting path - browseStartPath takes precedence
    let initialPath;
    if (browseStartPath) {
        // Explicit start path provided (e.g., when clicking a project card)
        initialPath = browseStartPath;
    } else if (isFromHome) {
        // From home: start at ~/Projects for easy project browsing
        initialPath = getProjectsDirectory();
    } else {
        // In project: start at project root
        initialPath = project.path;
    }

    if (fileBrowser) {
        // Refresh to appropriate directory
        fileBrowser.loadDirectory(initialPath);
        updatePathDisplay(initialPath);
        return;
    }

    fileBrowser = createFileBrowser(fileBrowserContainerEl, {
        initialPath,
        mode: 'browse',
        showFilter: false, // We use our own input
        showProjectButton: true,
        // Custom render to show recent projects at top when in ~/Projects
        onBeforeRender: (entries, currentPath) => {
            if (isFromHome && currentPath === getProjectsDirectory()) {
                // Add recent projects section at top
                return addRecentProjectsToEntries(entries);
            }
            return entries;
        },
        onSelect: (path, isDir) => {
            if (!isDir) {
                close();
                if (onSelect) {
                    onSelect(path);
                }
            } else {
                // Navigated to folder - refocus input
                refocusInput();
            }
        },
        onNavigate: (path, isProject) => {
            updatePathDisplay(path);
            // Sync filter input and refocus
            const input = overlayEl.querySelector('.quick-picker-input');
            if (input) {
                input.value = '';
            }
            refocusInput();
        },
        onOpenProject: (path) => {
            close();
            if (onOpenProject) {
                onOpenProject(path);
            }
        },
        onCancel: () => {
            close();
        },
        getCollabClient,
    });

    updatePathDisplay(initialPath);

    // Sync our input with file browser filter
    const input = overlayEl.querySelector('.quick-picker-input');
    input.addEventListener('input', () => {
        if (currentMode === 'browse' && fileBrowser) {
            fileBrowser.setFilter(input.value);
        }
    });
}

/**
 * Get the ~/Projects directory path from server (canonical source)
 * Falls back to home directory detection only if server data not available
 */
function getProjectsDirectory() {
    // Use server-provided projects directory (canonical source of truth)
    const serverProjectsDir = SessionState.getProjectsDirectory();
    if (serverProjectsDir) {
        return serverProjectsDir;
    }

    // Fallback: Use home directory from server + /Projects
    const homeDir = SessionState.getHomeDirectory();
    if (homeDir) {
        return `${homeDir}/Projects`;
    }

    // Last resort fallback (should rarely happen - only before status is loaded)
    console.warn('[QuickPicker] Server home directory not available, using fallback');
    return '/home/user/Projects';
}

/**
 * Add recent projects section when browsing ~/Projects
 * Creates a proper two-section layout: RECENT PROJECTS + CURRENT DIRECTORY
 */
function addRecentProjectsToEntries(entries) {
    const recentProjects = SessionState.getRecentProjects() || [];

    if (recentProjects.length === 0) {
        // No recent projects - just add section header to regular entries
        return entries.map((entry, idx) => ({
            ...entry,
            sectionHeader: idx === 0 ? 'CURRENT DIRECTORY' : null,
        }));
    }

    // Build recent projects section from the project list
    // These appear at the top with their full paths as location hints
    const recentSection = recentProjects.slice(0, 5).map((project, idx) => {
        // Shorten path for display
        const pathParts = project.path.split('/');
        const locationHint = pathParts.slice(-2).join('/'); // e.g., "Projects/MyApp"

        return {
            name: project.name,
            path: project.path,
            is_dir: true,
            ext: '',
            isRecentProject: true,
            locationHint: `~/${locationHint}`,
            sectionHeader: idx === 0 ? 'RECENT PROJECTS' : null,
        };
    });

    // Get names of recent projects to exclude from current directory section
    const recentPaths = new Set(recentProjects.map(p => p.path));

    // Filter and label the current directory entries
    const currentDirSection = entries
        .filter(entry => !recentPaths.has(entry.path)) // Don't duplicate recent projects
        .map((entry, idx) => ({
            ...entry,
            sectionHeader: idx === 0 ? 'CURRENT DIRECTORY' : null,
        }));

    // Combine: recent projects first, then current directory
    return [...recentSection, ...currentDirSection];
}

/**
 * Refocus input after interactions
 */
function refocusInput() {
    setTimeout(() => {
        if (isOpen) {
            const input = overlayEl.querySelector('.quick-picker-input');
            if (input) input.focus();
        }
    }, 10);
}

/**
 * Update path display
 */
function updatePathDisplay(path) {
    const pathEl = overlayEl.querySelector('#quick-picker-path');
    if (pathEl) {
        // Shorten path for display
        const home = '/home/' + (path.split('/')[2] || '');
        const displayPath = path.startsWith(home) ? '~' + path.slice(home.length) : path;
        pathEl.textContent = displayPath;
    }
}

/**
 * Clear preview pane
 */
function clearPreview() {
    currentPreviewPath = null;
    const headerEl = overlayEl.querySelector('#quick-picker-preview-header');
    const contentEl = overlayEl.querySelector('#quick-picker-preview-content');
    if (headerEl) headerEl.textContent = '';
    if (contentEl) contentEl.innerHTML = '<div class="quick-picker-preview-empty">Select a file to preview</div>';
}

/**
 * Update preview pane with file content
 * @param {string} path - File path to preview
 * @param {number} lineNumber - Optional line to scroll to
 * @param {Array} matchIndices - Optional match positions [{start, end}]
 */
async function updatePreview(path, lineNumber = null, matchIndices = null) {
    const headerEl = overlayEl.querySelector('#quick-picker-preview-header');
    const contentEl = overlayEl.querySelector('#quick-picker-preview-content');

    if (!path || !headerEl || !contentEl) {
        clearPreview();
        return;
    }

    // Show filename immediately
    const filename = path.split('/').pop();
    headerEl.textContent = filename;

    // Check cache (valid for 5 seconds)
    const cached = previewCache.get(path);
    if (cached && Date.now() - cached.timestamp < 5000) {
        renderPreviewContent(cached.content, lineNumber, matchIndices);
        return;
    }

    // Show loading state
    contentEl.innerHTML = '<div class="quick-picker-preview-empty">Loading...</div>';

    // Prevent duplicate requests
    if (currentPreviewPath === path) return;
    currentPreviewPath = path;

    // Abort any pending preview request
    if (previewAbortController) {
        previewAbortController.abort();
    }
    previewAbortController = new AbortController();

    try {
        const response = await fetch('/api/file/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
            signal: previewAbortController.signal,
        });

        if (!response.ok) {
            contentEl.innerHTML = '<div class="quick-picker-preview-empty">Cannot preview file</div>';
            return;
        }

        const data = await response.json();

        // Cache result
        previewCache.set(path, {
            content: data.content,
            timestamp: Date.now(),
        });

        // Only render if still the current selection
        if (currentPreviewPath === path) {
            renderPreviewContent(data.content, lineNumber, matchIndices);
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            contentEl.innerHTML = '<div class="quick-picker-preview-empty">Error loading preview</div>';
        }
    }
}

/**
 * Render preview content (raw text with optional match highlight)
 */
function renderPreviewContent(content, lineNumber = null, matchIndices = null) {
    const contentEl = overlayEl.querySelector('#quick-picker-preview-content');
    if (!contentEl) return;

    // Truncate if too large (for performance)
    const maxLines = 500;
    const lines = content.split('\n');
    const truncated = lines.length > maxLines;
    const displayLines = truncated ? lines.slice(0, maxLines) : lines;

    // If we have a line to highlight, build HTML, otherwise use textContent (faster)
    if (lineNumber && lineNumber > 0 && lineNumber <= displayLines.length) {
        // Build HTML with highlighted match on the specific line
        const html = displayLines.map((line, idx) => {
            const ln = idx + 1;
            if (ln === lineNumber) {
                // Highlight the match within this line
                let highlightedLine;
                if (matchIndices && matchIndices.length > 0) {
                    // Highlight specific match positions
                    highlightedLine = highlightMatchInLine(line, matchIndices);
                } else {
                    highlightedLine = esc(line);
                }
                return `<span class="preview-line-highlight">${highlightedLine}</span>`;
            }
            return esc(line);
        }).join('\n') + (truncated ? '\n...' : '');

        contentEl.innerHTML = html;
    } else {
        // No highlight needed - use faster textContent
        contentEl.textContent = displayLines.join('\n') + (truncated ? '\n...' : '');
    }

    // Scroll to line if specified
    if (lineNumber && lineNumber > 0) {
        const lineHeight = 18;
        contentEl.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
    } else {
        contentEl.scrollTop = 0;
    }
}

/**
 * Highlight match positions within a line
 */
function highlightMatchInLine(line, matchIndices) {
    if (!matchIndices || matchIndices.length === 0) {
        return esc(line);
    }

    let result = '';
    let lastEnd = 0;

    // Sort by start position
    const sorted = [...matchIndices].sort((a, b) => a.start - b.start);

    for (const { start, end } of sorted) {
        if (start >= line.length) continue;
        const actualEnd = Math.min(end, line.length);
        result += esc(line.slice(lastEnd, start));
        result += `<mark class="preview-match">${esc(line.slice(start, actualEnd))}</mark>`;
        lastEnd = actualEnd;
    }
    result += esc(line.slice(lastEnd));

    return result;
}

/**
 * Render results for current mode
 */
function renderResults() {
    const listEl = overlayEl.querySelector('#quick-picker-list');
    const input = overlayEl.querySelector('.quick-picker-input');
    const query = input.value.trim();

    let items = [];
    let html = '';

    switch (currentMode) {
        case 'files':
            items = getFileResults(query);
            break;
        case 'content':
            items = getContentResults(query);
            break;
        case 'commands':
            items = getCommandResults(query);
            break;
    }

    // For files mode, add "Create" option if user typed something
    let createOption = null;
    if (currentMode === 'files' && query) {
        createOption = {
            type: 'create',
            name: query,
            icon: '+',
            path: null, // Will be determined on selection
        };
    }

    if (items.length === 0 && !createOption) {
        html = `<div class="quick-picker-empty">${MODES[currentMode].emptyText}</div>`;
        // Clear preview when no results
        if (MODES[currentMode]?.hasPreview) {
            clearPreview();
        }
    } else {
        // Render file results
        html = items.map((item, idx) => {
            const selectedClass = idx === 0 ? ' selected' : '';
            return renderItem(item, idx, selectedClass);
        }).join('');

        // Add create option at the bottom (for files mode)
        if (createOption) {
            const createSelectedClass = items.length === 0 ? ' selected' : '';
            const displayName = normalizeFilename(query);
            html += `
                <div class="quick-picker-separator"></div>
                <div class="quick-picker-item quick-picker-create-option${createSelectedClass}"
                     data-index="${items.length}"
                     data-type="create"
                     data-name="${esc(query)}">
                    <span class="quick-picker-item-icon">+</span>
                    <span class="quick-picker-item-name">Create "${esc(displayName)}"</span>
                </div>
            `;
        }
    }

    listEl.innerHTML = html;

    // Add click handlers
    listEl.querySelectorAll('.quick-picker-item').forEach(el => {
        el.addEventListener('click', () => {
            // Update selection
            listEl.querySelectorAll('.quick-picker-item').forEach(item => {
                item.classList.remove('selected');
            });
            el.classList.add('selected');

            const idx = parseInt(el.dataset.index);
            const isCreate = el.dataset.type === 'create';

            if (isCreate) {
                // Handle create action
                handleCreateFile(el.dataset.name);
            } else {
                // Update preview on click
                if (MODES[currentMode]?.hasPreview && currentMode !== 'browse') {
                    const path = el.dataset.path;
                    const line = el.dataset.line;
                    const matchIndices = items[idx]?.match_indices || null;
                    if (path) {
                        updatePreview(path, line ? parseInt(line) : null, matchIndices);
                    }
                }

                selectItem(items[idx]);
            }
        });
    });

    // Update preview for first selected item
    if (items.length > 0 && MODES[currentMode]?.hasPreview && currentMode !== 'browse') {
        const firstItem = items[0];
        if (firstItem.path) {
            updatePreview(firstItem.path, firstItem.line_number || null, firstItem.match_indices || null);
        }
    }
}

/**
 * Handle file creation from picker
 * @param {string} filename - The filename to create (may include path)
 */
async function handleCreateFile(filename) {
    // Determine target directory and normalize filename
    let targetDir;
    let baseName;
    const project = SessionState.getCurrentProject();

    if (filename.includes('/')) {
        // User specified a path - resolve it
        const lastSlash = filename.lastIndexOf('/');
        const pathPart = filename.substring(0, lastSlash);
        baseName = filename.substring(lastSlash + 1);

        if (pathPart.startsWith('/')) {
            targetDir = pathPart;
        } else if (project) {
            targetDir = `${project.path}/${pathPart}`;
        } else {
            // Use Scratch project
            const scratchPath = await getScratchProjectPath();
            targetDir = `${scratchPath}/${pathPart}`;
        }
    } else {
        // No path specified - use current project or Scratch
        baseName = filename;
        if (project) {
            targetDir = project.path;
        } else {
            targetDir = await getScratchProjectPath();
        }
    }

    // Normalize the filename (add .md if no extension)
    const normalizedName = normalizeFilename(baseName);
    const fullPath = `${targetDir}/${normalizedName}`;

    close();

    // Emit file creation request
    if (onCreate) {
        onCreate(fullPath);
    } else {
        // Fallback: emit event for other handlers
        SessionState.emit('file-create-requested', { path: fullPath });
    }
}

/**
 * Get the Scratch project path (or create it if needed)
 */
async function getScratchProjectPath() {
    // First try cached value from SessionState
    const cachedScratch = SessionState.getScratchPath();
    if (cachedScratch) {
        return cachedScratch;
    }

    // Otherwise fetch from server
    try {
        const response = await fetch('/api/mrmd/status');
        if (response.ok) {
            const data = await response.json();
            if (data.default_project) {
                return data.default_project;
            }
            // Fallback using server-provided home directory
            if (data.home_directory) {
                return `${data.home_directory}/Projects/Scratch`;
            }
        }
    } catch (err) {
        console.error('[QuickPicker] Failed to get Scratch path:', err);
    }

    // Last resort fallback using SessionState
    const homeDir = SessionState.getHomeDirectory();
    if (homeDir) {
        return `${homeDir}/Projects/Scratch`;
    }

    // Very last fallback (should rarely happen)
    console.warn('[QuickPicker] No home directory available for Scratch path');
    return '/tmp/mrmd-scratch';
}

/**
 * Render a single item
 */
function renderItem(item, index, selectedClass) {
    switch (currentMode) {
        case 'files':
            // Show project name when in global/home context
            const isGlobal = openContext === 'home' || !SessionState.getCurrentProject();
            const pathDisplay = isGlobal && item.projectName
                ? item.projectName
                : shortenPath(item.dirPath);

            return `
                <div class="quick-picker-item${selectedClass}" data-index="${index}" data-path="${esc(item.path)}">
                    <span class="quick-picker-item-icon">${item.icon}</span>
                    <span class="quick-picker-item-name">${item.nameHtml}</span>
                    ${item.isOpen ? '<span class="quick-picker-item-badge">open</span>' : ''}
                    <span class="quick-picker-item-path">${esc(pathDisplay)}</span>
                </div>
            `;
        case 'content':
            return `
                <div class="quick-picker-item${selectedClass}" data-index="${index}" data-path="${esc(item.path)}" data-line="${item.line_number || 1}">
                    <span class="quick-picker-item-icon">${item.icon}</span>
                    <div class="quick-picker-item-content">
                        <span class="quick-picker-item-name">${esc(item.name)}</span>
                        <span class="quick-picker-item-line">:${item.line_number || 1}</span>
                        ${item.match_text ? `<div class="quick-picker-item-match">${highlightContentMatch(item.match_text, item.match_indices)}</div>` : ''}
                    </div>
                </div>
            `;
        case 'commands':
            return `
                <div class="quick-picker-item${selectedClass}" data-index="${index}" data-command="${esc(item.id)}">
                    <span class="quick-picker-item-icon">></span>
                    <span class="quick-picker-item-name">${item.nameHtml}</span>
                    <span class="quick-picker-item-description">${esc(item.description)}</span>
                    ${item.shortcut ? `<span class="quick-picker-item-shortcut">${item.shortcut}</span>` : ''}
                </div>
            `;
        default:
            return '';
    }
}

/**
 * Highlight content search matches
 */
function highlightContentMatch(text, indices) {
    if (!indices || indices.length === 0) {
        return esc(text);
    }

    let result = '';
    let lastEnd = 0;

    for (const { start, end } of indices) {
        result += esc(text.slice(lastEnd, start));
        result += `<span class="match-highlight">${esc(text.slice(start, end))}</span>`;
        lastEnd = end;
    }
    result += esc(text.slice(lastEnd));

    return result;
}

// Cache for file search results
let fileSearchCache = { query: '', results: [], timestamp: 0, context: null };
let fileSearchPending = null;

/**
 * Get file search results - context-aware
 * - From home (no project): shows recent notebooks from ALL projects
 * - In project: shows current project files
 */
function getFileResults(query) {
    const isFromHome = openContext === 'home' || !SessionState.getCurrentProject();

    if (isFromHome) {
        return getGlobalRecentResults(query);
    } else {
        return getProjectFileResults(query);
    }
}

/**
 * Get recent notebooks from all projects (for home screen context)
 */
function getGlobalRecentResults(query) {
    const recentNotebooks = SessionState.getRecentNotebooks() || [];
    const openFiles = SessionState.getOpenFiles();

    // Combine open files and recent notebooks, avoiding duplicates
    const seenPaths = new Set();
    let results = [];

    // Open files first (most relevant)
    for (const [path, data] of openFiles.entries()) {
        if (seenPaths.has(path)) continue;
        seenPaths.add(path);

        const name = path.split('/').pop();
        const dirPath = path.substring(0, path.lastIndexOf('/'));
        const projectName = getProjectNameFromPath(dirPath);

        results.push({
            path,
            name,
            nameHtml: esc(name),
            dirPath,
            projectName,
            icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
            score: 100, // Boost open files
            isRecent: true,
            isOpen: true,
        });
    }

    // Recent notebooks
    for (const nb of recentNotebooks) {
        if (seenPaths.has(nb.path)) continue;
        seenPaths.add(nb.path);

        const name = nb.name || nb.path.split('/').pop();
        const dirPath = nb.path.substring(0, nb.path.lastIndexOf('/'));
        const projectName = nb.projectPath ? nb.projectPath.split('/').pop() : getProjectNameFromPath(dirPath);

        results.push({
            path: nb.path,
            name,
            nameHtml: esc(name),
            dirPath,
            projectName,
            icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
            score: 0,
            isRecent: true,
            timestamp: nb.timestamp,
        });
    }

    // Filter by query if provided
    if (query && query.length >= 1) {
        results = results.map(item => {
            const match = fuzzyMatch(item.name, query);
            if (match) {
                return {
                    ...item,
                    nameHtml: highlightMatches(item.name, match.indices),
                    score: match.score + (item.isOpen ? 100 : 0),
                };
            }
            return null;
        }).filter(Boolean);
    }

    // Sort by score (open files and better matches first)
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 30);
}

/**
 * Get project file search results (for in-project context)
 */
function getProjectFileResults(query) {
    const openFiles = SessionState.getOpenFiles();
    const openFilePaths = new Set(openFiles.keys());

    // No query - show recent/open files
    if (!query || query.length < 2) {
        const results = [];
        for (const [path, data] of openFiles.entries()) {
            const name = path.split('/').pop();
            const dirPath = path.substring(0, path.lastIndexOf('/'));
            results.push({
                path,
                name,
                nameHtml: esc(name),
                dirPath,
                icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
                score: 0,
                isRecent: true,
            });
        }
        return results.slice(0, 20);
    }

    // Return cached results if same query, context, and recent (within 500ms)
    const cacheKey = `${query}:${openContext}`;
    if (fileSearchCache.query === cacheKey && Date.now() - fileSearchCache.timestamp < 500) {
        return fileSearchCache.results;
    }

    // Trigger async search if not already pending
    if (!fileSearchPending || fileSearchPending.query !== cacheKey) {
        fileSearchPending = { query: cacheKey, promise: searchFilesAsync(query, openFilePaths) };
        fileSearchPending.promise.then(results => {
            fileSearchCache = { query: cacheKey, results, timestamp: Date.now() };
            // Re-render if still on files mode
            if (currentMode === 'files' && isOpen) {
                renderResults();
            }
        });
    }

    // Return cached results while loading (may be stale)
    return fileSearchCache.results;
}

/**
 * Extract project name from a file path
 */
function getProjectNameFromPath(dirPath) {
    if (!dirPath) return 'Scratch';

    // Look for common project root patterns
    const parts = dirPath.split('/');
    const projectsIdx = parts.indexOf('Projects');
    if (projectsIdx >= 0 && parts[projectsIdx + 1]) {
        return parts[projectsIdx + 1];
    }

    // Fallback: use the deepest directory name
    return parts[parts.length - 1] || 'Scratch';
}

/**
 * Search files via API
 */
async function searchFilesAsync(query, openFilePaths = new Set()) {
    const project = SessionState.getCurrentProject();
    const root = project?.path || '/home';

    try {
        const response = await fetch('/api/files/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                root,
                mode: 'files',
                extensions: ['.md', '.py', '.js', '.ts', '.json', '.html', '.css', '.txt', '.yml', '.yaml', '.toml'],
                max_results: 30,
            }),
        });

        if (!response.ok) {
            console.error('[QuickPicker] File search failed:', response.status);
            return [];
        }

        const data = await response.json();
        const results = (data.results || []).map(item => {
            const name = item.name || item.path.split('/').pop();
            const dirPath = item.path.substring(0, item.path.lastIndexOf('/'));
            const match = fuzzyMatch(name, query);
            const isRecent = openFilePaths.has(item.path);

            return {
                path: item.path,
                name,
                nameHtml: match ? highlightMatches(name, match.indices) : esc(name),
                dirPath,
                icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
                score: (match?.score || 0) + (isRecent ? 100 : 0), // Boost recent files
                isRecent,
            };
        });

        // Sort by score (recent files boosted)
        results.sort((a, b) => b.score - a.score);

        return results;
    } catch (err) {
        console.error('[QuickPicker] File search error:', err);
        return [];
    }
}

/**
 * Get recent file results
 */
function getRecentResults(query) {
    const openFiles = SessionState.getOpenFiles();
    const results = [];

    for (const [path, data] of openFiles.entries()) {
        const name = path.split('/').pop();
        const dirPath = path.substring(0, path.lastIndexOf('/'));

        if (query) {
            const match = fuzzyMatch(name, query);
            if (match) {
                results.push({
                    path,
                    name,
                    nameHtml: highlightMatches(name, match.indices),
                    dirPath,
                    icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
                    score: match.score,
                });
            }
        } else {
            results.push({
                path,
                name,
                nameHtml: esc(name),
                dirPath,
                icon: getFileIcon({ name, ext: '.' + name.split('.').pop() }),
                score: 0,
            });
        }
    }

    // Sort by score if filtering
    if (query) {
        results.sort((a, b) => b.score - a.score);
    }

    return results.slice(0, 20);
}

/**
 * Get command results
 */
function getCommandResults(query) {
    let results = getCommands().map(cmd => ({
        ...cmd,
        nameHtml: esc(cmd.name),
        score: 0,
    }));

    if (query) {
        results = results.map(cmd => {
            const nameMatch = fuzzyMatch(cmd.name, query);
            const descMatch = fuzzyMatch(cmd.description, query);

            if (nameMatch) {
                return {
                    ...cmd,
                    nameHtml: highlightMatches(cmd.name, nameMatch.indices),
                    score: nameMatch.score + 10, // Boost name matches
                };
            } else if (descMatch) {
                return {
                    ...cmd,
                    score: descMatch.score,
                };
            }
            return null;
        }).filter(Boolean);

        results.sort((a, b) => b.score - a.score);
    }

    return results;
}

/**
 * Get project results
 */
// getProjectResults removed - projects are now accessed via browse mode (/)

/**
 * Get content search results - searches inside files via streaming API
 */
function getContentResults(query) {
    // Need a query to search
    if (!query || query.length < 2) {
        return [];
    }

    // Return current results (streaming updates them)
    if (contentSearchQuery !== query) {
        // New query - start streaming search
        contentSearchQuery = query;
        contentSearchResults = [];
        startContentSearch(query);
    }

    return contentSearchResults;
}

/**
 * Start streaming content search
 */
function startContentSearch(query) {
    const project = SessionState.getCurrentProject();
    const root = project?.path || '/home';

    grepSearch.search(
        query,
        root,
        // onMatch - called for each result as it streams in
        (match) => {
            const item = {
                path: match.path,
                name: match.filename,
                line_number: match.line_number,
                match_text: match.match_text,
                match_indices: match.match_indices || [],
                icon: getFileIcon({ name: match.filename, ext: '.' + match.filename.split('.').pop() }),
            };
            contentSearchResults.push(item);

            // Re-render if still in content mode
            if (currentMode === 'content' && isOpen) {
                renderResults();
                // Update preview for first result
                if (contentSearchResults.length === 1) {
                    updatePreview(item.path, item.line_number, item.match_indices);
                }
            }
        },
        // onDone
        (data) => {
            // Search complete - could show "X results" in footer
        },
        // onError
        (error) => {
            console.error('[QuickPicker] Content search error:', error);
        },
        // options
        {
            maxResults: 50,
            extensions: ['.md', '.py', '.js', '.ts', '.json', '.txt', '.html', '.css', '.yml', '.yaml'],
        }
    );
}

/**
 * Move selection
 */
function moveSelection(delta) {
    if (currentMode === 'browse' && fileBrowser) {
        // Let file browser handle it
        const fakeEvent = { key: delta > 0 ? 'ArrowDown' : 'ArrowUp', preventDefault: () => {} };
        fileBrowser.handleKeydown(fakeEvent);
        return;
    }

    const items = overlayEl.querySelectorAll('.quick-picker-item');
    if (items.length === 0) return;

    const currentSelected = overlayEl.querySelector('.quick-picker-item.selected');
    const currentIndex = currentSelected ? parseInt(currentSelected.dataset.index) : -1;

    let newIndex = currentIndex + delta;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;

    items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === newIndex);
    });

    // Scroll into view
    items[newIndex]?.scrollIntoView({ block: 'nearest' });

    // Update preview for modes with preview
    if (MODES[currentMode]?.hasPreview && currentMode !== 'browse') {
        const selectedEl = items[newIndex];
        if (selectedEl) {
            const path = selectedEl.dataset.path;
            const line = selectedEl.dataset.line;
            // Get match indices from the items array
            const itemsArray = getCurrentItems();
            const matchIndices = itemsArray[newIndex]?.match_indices || null;
            if (path) {
                updatePreview(path, line ? parseInt(line) : null, matchIndices);
            }
        }
    }
}

/**
 * Select current item
 */
function selectCurrentItem() {
    if (currentMode === 'browse' && fileBrowser) {
        // Let file browser handle it
        const fakeEvent = { key: 'Enter', preventDefault: () => {} };
        fileBrowser.handleKeydown(fakeEvent);
        return;
    }

    const selected = overlayEl.querySelector('.quick-picker-item.selected');
    if (selected) {
        // Check if this is a create option
        if (selected.dataset.type === 'create') {
            handleCreateFile(selected.dataset.name);
            return;
        }

        const index = parseInt(selected.dataset.index);
        const items = getCurrentItems();
        if (items[index]) {
            selectItem(items[index]);
        }
    }
}

/**
 * Get current items list
 */
function getCurrentItems() {
    const input = overlayEl.querySelector('.quick-picker-input');
    const query = input.value.trim();

    switch (currentMode) {
        case 'files': return getFileResults(query);
        case 'content': return getContentResults(query);
        case 'commands': return getCommandResults(query);
        default: return [];
    }
}

/**
 * Select an item
 */
function selectItem(item) {
    close();

    switch (currentMode) {
        case 'files':
        case 'recent':
            if (onSelect && item.path) {
                onSelect(item.path);
            }
            break;
        case 'content':
            if (onSelect && item.path) {
                // Pass line number so editor can jump to it
                onSelect(item.path, { lineNumber: item.line_number });
            }
            break;
        case 'commands':
            SessionState.emit('command-executed', { command: item.id });
            break;
        case 'projects':
            if (onOpenProject && item.path) {
                onOpenProject(item.path);
            }
            break;
    }
}

/**
 * Open the quick picker
 * @param {Object} options
 * @param {string} options.mode - Initial mode ('files', 'browse', 'commands', 'content')
 * @param {string} options.query - Initial query string
 * @param {string} options.context - Context: 'home' (global search) or 'project' (scoped)
 * @param {string} options.startPath - For browse mode: start at this directory
 * @param {string} options.projectName - For browse mode: display name of the project being browsed
 * @param {Function} options.onCreate - Callback for file creation
 */
export function open(options = {}) {
    if (!overlayEl) return;

    const mode = options.mode || 'files';
    const initialQuery = options.query || '';

    // Set context - determines search scope
    // 'home' = global search across all projects
    // 'project' = scoped to current project
    openContext = options.context || (SessionState.getCurrentProject() ? 'project' : 'home');

    // Store start path for browse mode (allows opening at a specific directory)
    browseStartPath = options.startPath || null;

    // Store onCreate callback if provided
    if (options.onCreate) {
        onCreate = options.onCreate;
    }

    overlayEl.classList.add('open');
    isOpen = true;

    setMode(mode);

    const input = overlayEl.querySelector('.quick-picker-input');
    if (initialQuery) {
        input.value = initialQuery;
        renderResults();
    }

    // Focus with delay to ensure overlay is visible and rendered
    setTimeout(() => {
        if (isOpen && input) {
            input.focus();
        }
    }, 50);
}

/**
 * Close the quick picker
 */
export function close() {
    if (!overlayEl) return;

    overlayEl.classList.remove('open');
    isOpen = false;

    const input = overlayEl.querySelector('.quick-picker-input');
    input.value = '';

    // Abort any pending searches
    grepSearch.abort();
    if (previewAbortController) {
        previewAbortController.abort();
        previewAbortController = null;
    }

    // Clear content search state
    contentSearchResults = [];
    contentSearchQuery = '';

    // Reset context and callbacks
    openContext = null;
    browseStartPath = null;
    onCreate = null;

    // Reset save-to state
    resetSaveToState();
}

/**
 * Toggle the quick picker
 */
export function toggle(options = {}) {
    if (isOpen) {
        close();
    } else {
        open(options);
    }
}

/**
 * Check if picker is open
 */
export function isVisible() {
    return isOpen;
}

/**
 * Get the element
 */
export function getElement() {
    return overlayEl;
}

// ============================================================================
// Save-To Mode Functions
// ============================================================================

/**
 * Open the picker in save-to mode
 * @param {Object} options
 * @param {string} options.filePath - Current file path
 * @param {string} options.startDir - Directory to start in (default: file's directory)
 * @param {boolean} options.copyMode - If true, copy instead of move
 * @param {boolean} options.closeAfter - If true, close file after operation
 * @param {Function} options.onComplete - Called with (newPath, wasCopy, closeAfter) on success
 * @param {Function} options.onCancel - Called when user cancels: (reason) => void
 */
export function openSaveTo(options = {}) {
    const { filePath, startDir, copyMode = false, closeAfter = false, onComplete, onCancel } = options;

    if (!filePath) {
        console.error('[QuickPicker] openSaveTo requires filePath');
        return;
    }

    // Determine starting directory (current file's dir by default)
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));

    saveToState = {
        active: true,
        originalPath: filePath,
        currentDir: startDir || fileDir,
        inputValue: '',
        copyMode,
        closeAfter,
        onComplete: onComplete || (() => {}),
        onCancel: onCancel || (() => {}),
    };

    open({ mode: 'save-to' });
}

/**
 * Reset save-to state
 */
function resetSaveToState() {
    saveToState = {
        active: false,
        originalPath: null,
        currentDir: null,
        inputValue: '',
        copyMode: false,
        closeAfter: false,
        onComplete: null,
        onCancel: null,
    };
}

/**
 * Fetch directory contents with caching
 */
async function fetchDirectoryContents(dirPath) {
    const cached = directoryCache.get(dirPath);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.entries;
    }

    try {
        const response = await fetch('/api/file/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath, show_hidden: false }),
        });

        const data = await response.json();
        const entries = data.entries || [];

        directoryCache.set(dirPath, { entries, timestamp: Date.now() });
        return entries;
    } catch (err) {
        console.error('[QuickPicker] Failed to fetch directory:', err);
        return [];
    }
}

/**
 * Check if a file exists
 */
async function checkFileExists(filePath) {
    try {
        const response = await fetch('/api/file/exists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath }),
        });
        const data = await response.json();
        return data.exists && data.is_file;
    } catch (err) {
        return false;
    }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectoryExists(dirPath) {
    try {
        const response = await fetch('/api/file/exists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dirPath }),
        });
        const data = await response.json();

        if (!data.exists) {
            await fetch('/api/file/mkdir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dirPath }),
            });
        }
    } catch (err) {
        console.error('[QuickPicker] Failed to create directory:', err);
        throw err;
    }
}

/**
 * Normalize filename - add .md extension if none provided
 */
function normalizeFilename(filename) {
    if (!filename) return filename;
    // If no extension (no dot, or dot at start like .gitignore), add .md
    if (!filename.includes('.') || (filename.startsWith('.') && filename.lastIndexOf('.') === 0)) {
        return filename + '.md';
    }
    return filename;
}

/**
 * Build destination path from current dir and filename input
 */
function buildDestinationPath(dir, filename) {
    if (!filename) {
        filename = saveToState.originalPath?.split('/').pop() || 'file.md';
    }
    filename = normalizeFilename(filename);
    return `${dir}/${filename}`;
}

/**
 * Render save-to mode results
 */
async function renderSaveToResults() {
    const listEl = overlayEl.querySelector('#quick-picker-list');
    const input = overlayEl.querySelector('.quick-picker-input');
    const query = input.value.trim();

    // Parse input: could be just filename, or path/to/filename
    const hasSlash = query.includes('/');
    let targetDir = saveToState.currentDir;
    let filenameFilter = query;

    if (hasSlash) {
        // User is typing a path
        const lastSlash = query.lastIndexOf('/');
        const pathPart = query.substring(0, lastSlash);
        filenameFilter = query.substring(lastSlash + 1);

        // Resolve path
        if (pathPart.startsWith('/')) {
            targetDir = pathPart;
        } else if (pathPart === '..') {
            targetDir = saveToState.currentDir.substring(0, saveToState.currentDir.lastIndexOf('/')) || '/';
        } else if (pathPart) {
            targetDir = `${saveToState.currentDir}/${pathPart}`;
        }
    }

    // Fetch directory contents
    const entries = await fetchDirectoryContents(targetDir);

    const items = [];

    // Parent directory option
    if (targetDir !== '/') {
        items.push({
            type: 'parent',
            name: '..',
            path: targetDir.substring(0, targetDir.lastIndexOf('/')) || '/',
            icon: '↑',
            score: Infinity, // Always first
        });
    }

    // Filter and sort entries
    for (const entry of entries) {
        // Skip hidden files unless filter starts with dot
        if (entry.name.startsWith('.') && !filenameFilter.startsWith('.')) continue;

        const match = filenameFilter ? fuzzyMatch(entry.name, filenameFilter) : { score: 0, indices: [] };
        if (filenameFilter && !match) continue;

        items.push({
            type: entry.is_dir ? 'dir' : 'file',
            name: entry.name,
            path: `${targetDir}/${entry.name}`,
            icon: entry.is_dir ? '>' : getFileIcon({ name: entry.name, ext: '.' + (entry.name.split('.').pop() || '') }),
            score: match?.score || 0,
            nameHtml: match?.indices ? highlightMatches(entry.name, match.indices) : esc(entry.name),
        });
    }

    // Sort: parent first, then dirs, then files, by score
    items.sort((a, b) => {
        if (a.type === 'parent') return -1;
        if (b.type === 'parent') return 1;
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return (b.score || 0) - (a.score || 0);
    });

    // Build HTML
    let html = '';

    // Destination preview
    const destPath = buildDestinationPath(targetDir, filenameFilter || input.value);
    const displayPath = shortenPath(destPath);
    html += `
        <div class="quick-picker-save-destination">
            <span class="save-destination-label">${saveToState.copyMode ? 'Copy to:' : 'Save to:'}</span>
            <span class="save-destination-path">${esc(displayPath)}</span>
        </div>
    `;

    // Copy checkbox (only if not forced copy mode)
    html += `
        <label class="quick-picker-copy-toggle">
            <input type="checkbox" id="save-to-copy-checkbox" ${saveToState.copyMode ? 'checked' : ''} />
            <span>Copy (keep original)</span>
        </label>
    `;

    // Items
    if (items.length === 0 && !filenameFilter) {
        html += `<div class="quick-picker-empty">Empty directory</div>`;
    } else {
        // Find first non-parent item for default selection
        const firstSelectableIdx = items.findIndex(i => i.type !== 'parent');
        const defaultSelectedIdx = firstSelectableIdx >= 0 ? firstSelectableIdx : 0;

        html += items.map((item, idx) => `
            <div class="quick-picker-item${idx === defaultSelectedIdx ? ' selected' : ''}"
                 data-index="${idx}"
                 data-path="${esc(item.path)}"
                 data-type="${item.type}">
                <span class="quick-picker-item-icon">${item.icon}</span>
                <span class="quick-picker-item-name">${item.nameHtml || esc(item.name)}</span>
                ${item.type === 'dir' ? '<span class="quick-picker-item-type">/</span>' : ''}
            </div>
        `).join('');
    }

    listEl.innerHTML = html;

    // Wire up click handlers
    listEl.querySelectorAll('.quick-picker-item').forEach(el => {
        el.addEventListener('click', () => handleSaveToItemClick(el));
    });

    // Wire up copy checkbox
    const checkbox = listEl.querySelector('#save-to-copy-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => {
            saveToState.copyMode = e.target.checked;
            // Re-render to update label
            renderSaveToResults();
        });
    }

    // Update current dir tracking
    saveToState.currentDir = targetDir;
    updatePathDisplay(targetDir);
}

/**
 * Shorten a path for display
 */
function shortenPath(path) {
    const home = '/home/' + (path.split('/')[2] || '');
    if (path.startsWith(home)) {
        return '~' + path.slice(home.length);
    }
    return path;
}

/**
 * Handle clicking on an item in save-to mode
 */
function handleSaveToItemClick(el) {
    const type = el.dataset.type;
    const path = el.dataset.path;
    const input = overlayEl.querySelector('.quick-picker-input');

    if (type === 'parent' || type === 'dir') {
        // Navigate into directory
        saveToState.currentDir = path;
        input.value = '';
        renderSaveToResults();
        refocusInput();
    } else if (type === 'file') {
        // Use filename as template
        const filename = path.split('/').pop();
        input.value = filename;
        renderSaveToResults();
        refocusInput();
    }
}

/**
 * Handle Enter key in save-to mode
 */
async function handleSaveToSelect() {
    const input = overlayEl.querySelector('.quick-picker-input');
    const filename = input.value.trim();
    const selected = overlayEl.querySelector('.quick-picker-item.selected');

    // If user typed a filename, save to that (don't navigate to selected dir)
    if (filename) {
        // Check if filename exactly matches a directory name - if so, navigate
        const selectedName = selected?.querySelector('.quick-picker-item-name')?.textContent;
        const isExactDirMatch = selected &&
            (selected.dataset.type === 'dir' || selected.dataset.type === 'parent') &&
            (selectedName === filename || selectedName === filename + '/');

        if (isExactDirMatch) {
            handleSaveToItemClick(selected);
            return;
        }

        // Otherwise, save to the typed filename
    } else {
        // No filename - if directory selected, navigate into it
        if (selected && (selected.dataset.type === 'dir' || selected.dataset.type === 'parent')) {
            handleSaveToItemClick(selected);
            return;
        }
        // No filename and no directory selected - do nothing
        return;
    }

    // Build final path
    const destPath = buildDestinationPath(saveToState.currentDir, filename);
    const srcPath = saveToState.originalPath;

    // Check if destination path contains new directories
    const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
    if (destDir !== saveToState.currentDir) {
        try {
            await ensureDirectoryExists(destDir);
        } catch (err) {
            console.error('[QuickPicker] Failed to create directory:', err);
            return;
        }
    }

    // Check if file exists (and it's not the same file)
    if (destPath !== srcPath) {
        const exists = await checkFileExists(destPath);
        if (exists) {
            if (!confirm(`"${destPath.split('/').pop()}" already exists. Overwrite?`)) {
                return;
            }
        }
    }

    // Execute the operation
    await executeSaveToOperation(srcPath, destPath);
}

/**
 * Execute the save/copy/move operation
 */
async function executeSaveToOperation(srcPath, destPath) {
    const { copyMode, closeAfter, onComplete } = saveToState;

    try {
        close();

        if (copyMode) {
            // Copy file
            await fetch('/api/file/copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ src_path: srcPath, dest_path: destPath }),
            });
        } else {
            // Move file (rename)
            await fetch('/api/file/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_path: srcPath, new_path: destPath }),
            });
        }

        // Success callback
        if (onComplete) {
            onComplete(destPath, copyMode, closeAfter);
        }
    } catch (err) {
        console.error('[QuickPicker] Save-to operation failed:', err);
        // Could show notification here
    }
}

/**
 * Handle cancel in save-to mode
 */
function handleSaveToCancel() {
    const { closeAfter, onCancel } = saveToState;

    if (closeAfter) {
        // User is closing an untitled file - show discard dialog
        const discard = confirm('Discard changes?\n\nThe file will not be saved.');
        if (discard) {
            close();
            if (onCancel) onCancel('discard');
        }
        // If not discard, stay in picker
    } else {
        // Just cancel the operation
        close();
        if (onCancel) onCancel('cancel');
    }
}

/**
 * Handle Tab autocomplete in save-to mode
 */
function handleSaveToAutocomplete() {
    const selected = overlayEl.querySelector('.quick-picker-item.selected');
    if (!selected) return;

    const input = overlayEl.querySelector('.quick-picker-input');
    const type = selected.dataset.type;
    const name = selected.querySelector('.quick-picker-item-name')?.textContent;

    if (!name) return;

    if (type === 'dir') {
        // Autocomplete directory with trailing slash
        input.value = name + '/';
    } else if (type === 'parent') {
        // Go to parent
        input.value = '../';
    } else {
        // Autocomplete filename
        input.value = name;
    }

    renderSaveToResults();
    refocusInput();
}

/**
 * Destroy the quick picker
 */
export function destroy() {
    // Unregister keybinding handlers
    unregisterQuickPickerKeybindings();

    if (fileBrowser) {
        fileBrowser.destroy();
        fileBrowser = null;
    }

    if (overlayEl && overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
    }

    overlayEl = null;
    isOpen = false;
}

export default {
    createQuickPicker,
    open,
    close,
    toggle,
    isVisible,
    getElement,
    destroy,
    openSaveTo,
};

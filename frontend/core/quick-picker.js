/**
 * Quick Picker for MRMD
 *
 * A Telescope-like fuzzy finder overlay that can be invoked from anywhere.
 * Supports multiple modes:
 * - files: Search files in the current project
 * - recent: Recently opened files
 * - browse: Browse directories
 * - commands: Search commands
 * - projects: Switch projects
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
let fileBrowser = null;
let fileBrowserContainerEl = null;
let onSelect = null;
let onOpenProject = null;
let getCollabClient = null;

// Preview state
let previewCache = new Map(); // path -> { content, timestamp }
let currentPreviewPath = null;
let previewAbortController = null;

// Content search state
let contentSearchResults = [];
let contentSearchQuery = '';

// Available modes with their configurations (order matters for Tab cycling)
const MODES = {
    projects: {
        placeholder: 'Switch project...',
        icon: '~',
        emptyText: 'No projects',
    },
    browse: {
        placeholder: 'filter...',
        icon: '>',
        emptyText: 'Empty directory',
    },
    files: {
        placeholder: 'Search files...',
        icon: '/',
        emptyText: 'No recent files',
        hasPreview: true,
    },
    content: {
        placeholder: 'Search in files...',
        icon: '?',
        emptyText: 'Type to search file contents',
        hasPreview: true,
    },
    commands: {
        placeholder: 'Search commands...',
        icon: ':',
        emptyText: 'No commands found',
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
            <div class="quick-picker-header">
                <div class="quick-picker-mode-tabs">
                    <button class="quick-picker-tab" data-mode="projects" title="Projects">
                        <span class="tab-icon">~</span>
                        <span class="tab-label">Projects</span>
                    </button>
                    <button class="quick-picker-tab" data-mode="browse" title="Folders (${modKey}+O)">
                        <span class="tab-icon">></span>
                        <span class="tab-label">Folders</span>
                    </button>
                    <button class="quick-picker-tab active" data-mode="files" title="Files (${modKey}+P)">
                        <span class="tab-icon">/</span>
                        <span class="tab-label">Files</span>
                    </button>
                    <button class="quick-picker-tab" data-mode="content" title="Content (${modKey}+Shift+F)">
                        <span class="tab-icon">?</span>
                        <span class="tab-label">Content</span>
                    </button>
                    <button class="quick-picker-tab" data-mode="commands" title="Commands (${modKey}+Shift+P)">
                        <span class="tab-icon">:</span>
                        <span class="tab-label">Commands</span>
                    </button>
                </div>
            </div>
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
    const tabs = overlayEl.querySelectorAll('.quick-picker-tab');

    // Close on overlay click
    overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
            close();
        }
    });

    // Input handling
    input.addEventListener('input', () => {
        renderResults();
    });

    input.addEventListener('keydown', handleInputKeydown);

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            setMode(mode);
        });
    });
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
    KeybindingManager.handle('nav:quick-open-commands', () => {
        if (isOpen && currentMode === 'commands') {
            close();
        } else {
            open({ mode: 'commands' });
        }
    });

    KeybindingManager.handle('nav:browse', () => {
        if (isOpen && currentMode === 'browse') {
            close();
        } else {
            open({ mode: 'browse' });
        }
    });

    KeybindingManager.handle('nav:search-content', () => {
        if (isOpen && currentMode === 'content') {
            close();
        } else {
            open({ mode: 'content' });
        }
    });

    // Picker-internal navigation (only when picker is open)
    KeybindingManager.handle('picker:close', () => {
        close();
    });

    KeybindingManager.handle('picker:select', () => {
        selectCurrentItem();
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
        const modes = Object.keys(MODES);
        const currentIndex = modes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % modes.length;
        setMode(modes[nextIndex]);
    });

    KeybindingManager.handle('picker:prev-mode', () => {
        const modes = Object.keys(MODES);
        const currentIndex = modes.indexOf(currentMode);
        const prevIndex = (currentIndex - 1 + modes.length) % modes.length;
        setMode(modes[prevIndex]);
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
 */
function setMode(mode) {
    if (!MODES[mode]) return;

    currentMode = mode;
    const config = MODES[mode];

    // Update UI
    const tabs = overlayEl.querySelectorAll('.quick-picker-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    const icon = overlayEl.querySelector('.quick-picker-icon');
    const input = overlayEl.querySelector('.quick-picker-input');

    icon.textContent = config.icon;
    input.placeholder = config.placeholder;
    input.value = '';

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
    } else {
        listEl.style.display = 'block';
        browserEl.style.display = 'none';
        renderResults();
    }

    // Update hints based on mode
    const hintEl = overlayEl.querySelector('#quick-picker-hint');
    if (hintEl) {
        if (mode === 'browse') {
            hintEl.innerHTML = `
                <kbd>↑↓</kbd> navigate
                <kbd>↵</kbd> open
                <kbd>${modKey}+↵</kbd> open project
                <kbd>esc</kbd> close
            `;
        } else {
            hintEl.innerHTML = `
                <kbd>↑↓</kbd> navigate
                <kbd>↵</kbd> select
                <kbd>esc</kbd> close
            `;
        }
    }

    // Focus input reliably after DOM updates
    setTimeout(() => {
        if (isOpen) {
            input.focus();
        }
    }, 10);
}

/**
 * Initialize file browser for browse mode
 */
function initFileBrowser() {
    if (fileBrowser) {
        // Refresh to current project
        const project = SessionState.getCurrentProject();
        const path = project?.path || '/home';
        fileBrowser.loadDirectory(path);
        updatePathDisplay(path);
        return;
    }

    const project = SessionState.getCurrentProject();
    const initialPath = project?.path || '/home';

    fileBrowser = createFileBrowser(fileBrowserContainerEl, {
        initialPath,
        mode: 'browse',
        showFilter: false, // We use our own input
        showProjectButton: true,
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
        case 'projects':
            items = getProjectResults(query);
            break;
    }

    if (items.length === 0) {
        html = `<div class="quick-picker-empty">${MODES[currentMode].emptyText}</div>`;
        // Clear preview when no results
        if (MODES[currentMode]?.hasPreview) {
            clearPreview();
        }
    } else {
        html = items.map((item, idx) => {
            const selectedClass = idx === 0 ? ' selected' : '';
            return renderItem(item, idx, selectedClass);
        }).join('');
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

            // Update preview on click
            const idx = parseInt(el.dataset.index);
            if (MODES[currentMode]?.hasPreview && currentMode !== 'browse') {
                const path = el.dataset.path;
                const line = el.dataset.line;
                const matchIndices = items[idx]?.match_indices || null;
                if (path) {
                    updatePreview(path, line ? parseInt(line) : null, matchIndices);
                }
            }

            selectItem(items[idx]);
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
 * Render a single item
 */
function renderItem(item, index, selectedClass) {
    switch (currentMode) {
        case 'files':
            return `
                <div class="quick-picker-item${selectedClass}" data-index="${index}" data-path="${esc(item.path)}">
                    <span class="quick-picker-item-icon">${item.icon}</span>
                    <span class="quick-picker-item-name">${item.nameHtml}</span>
                    ${item.isRecent ? '<span class="quick-picker-item-recent">*</span>' : ''}
                    <span class="quick-picker-item-path">${esc(item.dirPath)}</span>
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
                    <span class="quick-picker-item-icon">:</span>
                    <span class="quick-picker-item-name">${item.nameHtml}</span>
                    <span class="quick-picker-item-description">${esc(item.description)}</span>
                    ${item.shortcut ? `<span class="quick-picker-item-shortcut">${item.shortcut}</span>` : ''}
                </div>
            `;
        case 'projects':
            return `
                <div class="quick-picker-item${selectedClass}" data-index="${index}" data-path="${esc(item.path)}">
                    <span class="quick-picker-item-icon">~</span>
                    <span class="quick-picker-item-name">${item.nameHtml}</span>
                    <span class="quick-picker-item-count">${item.notebookCount} notebooks</span>
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
let fileSearchCache = { query: '', results: [], timestamp: 0 };
let fileSearchPending = null;

/**
 * Get file search results - searches all files in project via API
 */
function getFileResults(query) {
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

    // Return cached results if same query and recent (within 500ms)
    if (fileSearchCache.query === query && Date.now() - fileSearchCache.timestamp < 500) {
        return fileSearchCache.results;
    }

    // Trigger async search if not already pending
    if (!fileSearchPending || fileSearchPending.query !== query) {
        fileSearchPending = { query, promise: searchFilesAsync(query, openFilePaths) };
        fileSearchPending.promise.then(results => {
            fileSearchCache = { query, results, timestamp: Date.now() };
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
function getProjectResults(query) {
    const projects = SessionState.getRecentProjects();

    let results = projects.map(proj => ({
        ...proj,
        nameHtml: esc(proj.name),
        notebookCount: proj.notebook_count || 0,
        score: 0,
    }));

    if (query) {
        results = results.map(proj => {
            const match = fuzzyMatch(proj.name, query);
            if (match) {
                return {
                    ...proj,
                    nameHtml: highlightMatches(proj.name, match.indices),
                    score: match.score,
                };
            }
            return null;
        }).filter(Boolean);

        results.sort((a, b) => b.score - a.score);
    }

    return results;
}

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
        case 'projects': return getProjectResults(query);
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
 */
export function open(options = {}) {
    if (!overlayEl) return;

    const mode = options.mode || 'files';
    const initialQuery = options.query || '';

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
};

/**
 * Project Explorer for MRMD
 *
 * A natural, non-technical way to browse a project's files.
 * Inspired by the Quick Picker but feels like browsing your own space.
 *
 * Features:
 * - Recent files first, then alphabetically
 * - Fuzzy search in names AND paths (type folder/file)
 * - Preview pane on the right
 * - Simple toggles: Notebooks / All files / Search contents
 * - Start typing immediately - no click required
 *
 * Design philosophy (from SaaS Vision):
 * - "The notebook is the conversation"
 * - "Make it so quiet that the user's own thoughts are the loudest thing"
 * - Writers first, then they discover they can code
 */

import * as SessionState from './session-state.js';
import { fuzzyMatch, highlightMatches, getFileIcon } from './file-browser.js';
import { grepSearch } from './grep-search.js';

let containerEl = null;
let isVisible = false;
let currentProject = null;
let currentMode = 'notebooks'; // 'notebooks', 'all', 'content'
let allFiles = [];
let recentPaths = new Set();
let previewCache = new Map();
let previewAbortController = null;
let searchQuery = '';
let contentResults = [];
let onSelect = null;
let onClose = null;

// Notebook extensions
const NOTEBOOK_EXTENSIONS = ['.md', '.markdown', '.txt'];

/**
 * Create the project explorer overlay
 * @param {Object} options
 * @param {Function} options.onSelect - Called when a file is selected (path, options)
 * @param {Function} options.onClose - Called when closed
 * @returns {HTMLElement}
 */
export function createProjectExplorer(options = {}) {
    onSelect = options.onSelect || (() => {});
    onClose = options.onClose || (() => {});

    containerEl = document.createElement('div');
    containerEl.className = 'project-explorer-overlay';
    containerEl.innerHTML = `
        <div class="project-explorer">
            <div class="project-explorer-header">
                <span class="project-explorer-name" id="pe-project-name"></span>
                <div class="project-explorer-modes">
                    <button class="pe-mode active" data-mode="notebooks">Notebooks</button>
                    <button class="pe-mode" data-mode="all">All files</button>
                    <button class="pe-mode" data-mode="content">Search</button>
                </div>
            </div>

            <div class="project-explorer-search">
                <input
                    type="text"
                    class="pe-search-input"
                    id="pe-search"
                    placeholder="filter..."
                    autocomplete="off"
                    spellcheck="false"
                />
            </div>

            <div class="project-explorer-body">
                <div class="project-explorer-list" id="pe-list">
                    <!-- Files listed here -->
                </div>
                <div class="project-explorer-preview" id="pe-preview">
                    <div class="pe-preview-header" id="pe-preview-header"></div>
                    <div class="pe-preview-content" id="pe-preview-content">
                        <div class="pe-preview-empty">Select a file to preview</div>
                    </div>
                </div>
            </div>

            <div class="project-explorer-footer">
                <span class="pe-footer-hint">
                    <kbd>↑↓</kbd> navigate
                    <kbd>↵</kbd> open
                    <kbd>esc</kbd> close
                </span>
                <span class="pe-footer-count" id="pe-count"></span>
            </div>
        </div>
    `;

    setupEventListeners();
    return containerEl;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Close on overlay click
    containerEl.addEventListener('click', (e) => {
        if (e.target === containerEl) {
            close();
        }
    });

    // Search input
    const searchInput = containerEl.querySelector('#pe-search');
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleKeydown);

    // Mode buttons
    containerEl.querySelectorAll('.pe-mode').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setMode(mode);
        });
    });

    // Global escape key handler
    document.addEventListener('keydown', handleGlobalKeydown);
}

/**
 * Handle global keyboard shortcuts
 */
function handleGlobalKeydown(e) {
    if (!isVisible) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
    }
}

/**
 * Handle search input changes
 */
function handleSearchInput(e) {
    searchQuery = e.target.value;

    if (currentMode === 'content') {
        // Content search - debounced
        startContentSearch(searchQuery);
    } else {
        // Filter existing list instantly
        renderList();
    }
}

/**
 * Handle keyboard navigation
 */
function handleKeydown(e) {
    // Note: Escape is handled by the global listener

    if (e.key === 'Enter') {
        e.preventDefault();
        selectCurrentItem();
        return;
    }

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
        return;
    }

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
        return;
    }

    // Tab to switch modes
    if (e.key === 'Tab') {
        e.preventDefault();
        const modes = ['notebooks', 'all', 'content'];
        const currentIndex = modes.indexOf(currentMode);
        const nextIndex = e.shiftKey
            ? (currentIndex - 1 + modes.length) % modes.length
            : (currentIndex + 1) % modes.length;
        setMode(modes[nextIndex]);
    }
}

/**
 * Set the current mode
 */
function setMode(mode) {
    if (mode === currentMode) return;

    currentMode = mode;

    // Update button states
    containerEl.querySelectorAll('.pe-mode').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update placeholder
    const searchInput = containerEl.querySelector('#pe-search');
    if (mode === 'content') {
        searchInput.placeholder = 'search in files...';
    } else if (mode === 'all') {
        searchInput.placeholder = 'filter all files...';
    } else {
        searchInput.placeholder = 'filter...';
    }

    // Clear and re-render
    if (mode !== 'content') {
        contentResults = [];
        grepSearch.abort();
    }

    renderList();
    focusSearch();
}

/**
 * Focus the search input
 */
function focusSearch() {
    setTimeout(() => {
        if (isVisible) {
            const input = containerEl.querySelector('#pe-search');
            input?.focus();
        }
    }, 10);
}

/**
 * Move selection up/down
 */
function moveSelection(delta) {
    const items = containerEl.querySelectorAll('.pe-item');
    if (items.length === 0) return;

    const currentSelected = containerEl.querySelector('.pe-item.selected');
    const currentIndex = currentSelected
        ? Array.from(items).indexOf(currentSelected)
        : -1;

    let newIndex = currentIndex + delta;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;

    items.forEach((item, idx) => {
        item.classList.toggle('selected', idx === newIndex);
    });

    items[newIndex]?.scrollIntoView({ block: 'nearest' });

    // Update preview
    const path = items[newIndex]?.dataset.path;
    const line = items[newIndex]?.dataset.line;
    if (path) {
        updatePreview(path, line ? parseInt(line) : null);
    }
}

/**
 * Select the currently highlighted item
 */
function selectCurrentItem() {
    const selected = containerEl.querySelector('.pe-item.selected');
    if (selected) {
        const path = selected.dataset.path;
        const line = selected.dataset.line;
        close();
        if (onSelect && path) {
            onSelect(path, {
                ...(line ? { lineNumber: parseInt(line) } : {}),
                projectPath: currentProject?.path || null,
            });
        }
    } else if (searchQuery && currentProject?.path && currentMode !== 'content') {
        // No file found - create new file at the typed path
        let newPath = searchQuery.trim();

        // If no extension, add .md by default
        if (!newPath.includes('.')) {
            newPath += '.md';
        }

        // Build full path - if the query doesn't start with /, it's relative to project
        const fullPath = newPath.startsWith('/')
            ? newPath
            : currentProject.path + '/' + newPath;

        close();
        if (onSelect) {
            onSelect(fullPath, {
                projectPath: currentProject.path,
                createIfNotExists: true,
            });
        }
    }
}

/**
 * Get filtered and sorted file list
 */
function getFilteredFiles() {
    const query = searchQuery.toLowerCase().trim();

    // Filter by mode
    let files = currentMode === 'notebooks'
        ? allFiles.filter(f => NOTEBOOK_EXTENSIONS.some(ext => f.path.endsWith(ext)))
        : allFiles;

    // Apply fuzzy search
    let results;
    if (query) {
        results = files.map(file => {
            // Search in both name and relative path
            const nameMatch = fuzzyMatch(file.name, query);
            const pathMatch = fuzzyMatch(file.relpath, query);

            // Use best match
            const match = nameMatch && pathMatch
                ? (nameMatch.score > pathMatch.score ? nameMatch : pathMatch)
                : nameMatch || pathMatch;

            if (!match) return null;

            return {
                ...file,
                match,
                nameHtml: nameMatch ? highlightMatches(file.name, nameMatch.indices) : esc(file.name),
                pathHtml: pathMatch ? highlightMatches(file.relpath, pathMatch.indices) : esc(file.relpath),
            };
        }).filter(Boolean);

        // Sort by match score (best first)
        results.sort((a, b) => b.match.score - a.match.score);
    } else {
        results = files.map(file => ({
            ...file,
            nameHtml: esc(file.name),
            pathHtml: esc(file.relpath),
        }));

        // Sort: recent first, then alphabetically
        results.sort((a, b) => {
            const aRecent = recentPaths.has(a.path);
            const bRecent = recentPaths.has(b.path);
            if (aRecent && !bRecent) return -1;
            if (!aRecent && bRecent) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    return results;
}

/**
 * Render the file list
 */
function renderList() {
    const listEl = containerEl.querySelector('#pe-list');
    const countEl = containerEl.querySelector('#pe-count');

    if (currentMode === 'content') {
        renderContentResults();
        return;
    }

    const files = getFilteredFiles();
    countEl.textContent = `${files.length} ${currentMode === 'notebooks' ? 'notebooks' : 'files'}`;

    if (files.length === 0) {
        const emptyMessage = searchQuery
            ? `Press Enter to create "${searchQuery}${searchQuery.includes('.') ? '' : '.md'}"`
            : `No ${currentMode === 'notebooks' ? 'notebooks' : 'files'} found`;
        listEl.innerHTML = `<div class="pe-empty">${emptyMessage}</div>`;
        clearPreview();
        return;
    }

    listEl.innerHTML = files.slice(0, 100).map((file, idx) => {
        const isRecent = recentPaths.has(file.path);
        const icon = getFileIcon({ name: file.name, ext: '.' + file.name.split('.').pop() });

        return `
            <div class="pe-item${idx === 0 ? ' selected' : ''}" data-path="${esc(file.path)}" data-index="${idx}">
                <span class="pe-item-icon">${icon}</span>
                <span class="pe-item-name">${file.nameHtml}</span>
                ${isRecent ? '<span class="pe-item-recent">recent</span>' : ''}
                <span class="pe-item-path">${file.pathHtml}</span>
            </div>
        `;
    }).join('');

    // Click handlers
    listEl.querySelectorAll('.pe-item').forEach(el => {
        el.addEventListener('click', () => {
            listEl.querySelectorAll('.pe-item').forEach(i => i.classList.remove('selected'));
            el.classList.add('selected');
            updatePreview(el.dataset.path);
        });

        el.addEventListener('dblclick', () => {
            close();
            if (onSelect) onSelect(el.dataset.path, { projectPath: currentProject?.path || null });
        });
    });

    // Preview first item
    if (files.length > 0) {
        updatePreview(files[0].path);
    }
}

/**
 * Start content search (with streaming)
 */
let contentSearchTimeout = null;
function startContentSearch(query) {
    // Debounce
    if (contentSearchTimeout) clearTimeout(contentSearchTimeout);

    if (!query || query.length < 2) {
        contentResults = [];
        renderContentResults();
        return;
    }

    contentSearchTimeout = setTimeout(() => {
        contentResults = [];
        renderContentResults();

        grepSearch.search(
            query,
            currentProject.path,
            // onMatch
            (match) => {
                contentResults.push({
                    path: match.path,
                    name: match.filename,
                    line_number: match.line_number,
                    match_text: match.match_text,
                    match_indices: match.match_indices || [],
                });
                renderContentResults();
            },
            // onDone
            () => {},
            // onError
            (err) => console.error('[ProjectExplorer] Search error:', err),
            // options
            {
                maxResults: 50,
                extensions: currentMode === 'notebooks'
                    ? ['.md', '.markdown', '.txt']
                    : ['.md', '.py', '.js', '.ts', '.json', '.html', '.css', '.txt', '.yml', '.yaml'],
            }
        );
    }, 150);
}

/**
 * Render content search results
 */
function renderContentResults() {
    const listEl = containerEl.querySelector('#pe-list');
    const countEl = containerEl.querySelector('#pe-count');

    if (searchQuery.length < 2) {
        listEl.innerHTML = '<div class="pe-empty">Type to search in files...</div>';
        countEl.textContent = '';
        clearPreview();
        return;
    }

    countEl.textContent = `${contentResults.length} matches`;

    if (contentResults.length === 0) {
        listEl.innerHTML = '<div class="pe-empty">Searching...</div>';
        clearPreview();
        return;
    }

    listEl.innerHTML = contentResults.slice(0, 50).map((result, idx) => {
        const icon = getFileIcon({ name: result.name, ext: '.' + result.name.split('.').pop() });
        const matchHtml = highlightContentMatch(result.match_text, result.match_indices);

        return `
            <div class="pe-item pe-content-item${idx === 0 ? ' selected' : ''}"
                 data-path="${esc(result.path)}"
                 data-line="${result.line_number}"
                 data-index="${idx}">
                <span class="pe-item-icon">${icon}</span>
                <div class="pe-item-content">
                    <span class="pe-item-name">${esc(result.name)}</span>
                    <span class="pe-item-line">:${result.line_number}</span>
                    <div class="pe-item-match">${matchHtml}</div>
                </div>
            </div>
        `;
    }).join('');

    // Click handlers
    listEl.querySelectorAll('.pe-item').forEach(el => {
        el.addEventListener('click', () => {
            listEl.querySelectorAll('.pe-item').forEach(i => i.classList.remove('selected'));
            el.classList.add('selected');
            updatePreview(el.dataset.path, parseInt(el.dataset.line));
        });

        el.addEventListener('dblclick', () => {
            close();
            if (onSelect) {
                onSelect(el.dataset.path, {
                    lineNumber: parseInt(el.dataset.line),
                    projectPath: currentProject?.path || null,
                });
            }
        });
    });

    // Preview first result
    if (contentResults.length > 0) {
        updatePreview(contentResults[0].path, contentResults[0].line_number);
    }
}

/**
 * Highlight match text
 */
function highlightContentMatch(text, indices) {
    if (!indices || indices.length === 0) {
        return esc(text);
    }

    let result = '';
    let lastEnd = 0;

    for (const { start, end } of indices) {
        result += esc(text.slice(lastEnd, start));
        result += `<mark>${esc(text.slice(start, end))}</mark>`;
        lastEnd = end;
    }
    result += esc(text.slice(lastEnd));

    return result;
}

/**
 * Update preview pane
 */
async function updatePreview(path, lineNumber = null) {
    const headerEl = containerEl.querySelector('#pe-preview-header');
    const contentEl = containerEl.querySelector('#pe-preview-content');

    if (!path) {
        clearPreview();
        return;
    }

    // Show filename
    const filename = path.split('/').pop();
    headerEl.textContent = filename;

    // Check cache
    const cached = previewCache.get(path);
    if (cached && Date.now() - cached.timestamp < 5000) {
        renderPreviewContent(cached.content, lineNumber);
        return;
    }

    contentEl.innerHTML = '<div class="pe-preview-empty">Loading...</div>';

    // Abort previous request
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
            contentEl.innerHTML = '<div class="pe-preview-empty">Cannot preview</div>';
            return;
        }

        const data = await response.json();

        // Cache it
        previewCache.set(path, {
            content: data.content,
            timestamp: Date.now(),
        });

        renderPreviewContent(data.content, lineNumber);
    } catch (e) {
        if (e.name !== 'AbortError') {
            contentEl.innerHTML = '<div class="pe-preview-empty">Error loading preview</div>';
        }
    }
}

/**
 * Render preview content
 */
function renderPreviewContent(content, lineNumber = null) {
    const contentEl = containerEl.querySelector('#pe-preview-content');
    if (!contentEl) return;

    const maxLines = 500;
    const lines = content.split('\n');
    const displayLines = lines.slice(0, maxLines);

    if (lineNumber && lineNumber > 0) {
        // Highlight the matched line
        const html = displayLines.map((line, idx) => {
            if (idx + 1 === lineNumber) {
                return `<span class="pe-preview-highlight">${esc(line)}</span>`;
            }
            return esc(line);
        }).join('\n');
        contentEl.innerHTML = html;

        // Scroll to line
        const lineHeight = 18;
        contentEl.scrollTop = Math.max(0, (lineNumber - 5) * lineHeight);
    } else {
        contentEl.textContent = displayLines.join('\n');
        contentEl.scrollTop = 0;
    }
}

/**
 * Clear preview
 */
function clearPreview() {
    const headerEl = containerEl.querySelector('#pe-preview-header');
    const contentEl = containerEl.querySelector('#pe-preview-content');
    if (headerEl) headerEl.textContent = '';
    if (contentEl) contentEl.innerHTML = '<div class="pe-preview-empty">Select a file to preview</div>';
}

/**
 * Open the explorer for a project
 * @param {string} projectPath
 * @param {string} projectName
 */
export async function open(projectPath, projectName) {
    if (!containerEl) return;

    currentProject = { path: projectPath, name: projectName };
    searchQuery = '';
    currentMode = 'notebooks';
    contentResults = [];
    allFiles = [];

    // Update UI
    containerEl.querySelector('#pe-project-name').textContent = projectName;
    containerEl.querySelector('#pe-search').value = '';
    containerEl.querySelectorAll('.pe-mode').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === 'notebooks');
    });

    // Show overlay
    containerEl.classList.add('visible');
    isVisible = true;

    // Load recent files from session state
    const openFiles = SessionState.getOpenFiles();
    recentPaths = new Set(openFiles.keys());

    // Show loading
    containerEl.querySelector('#pe-list').innerHTML = '<div class="pe-empty">Loading...</div>';

    // Load files
    await loadProjectFiles(projectPath);

    renderList();
    focusSearch();
}

/**
 * Load all files from project
 */
async function loadProjectFiles(projectPath) {
    try {
        // Load all common file types
        const allExtensions = [
            '.md', '.markdown', '.txt',  // Documents
            '.py', '.js', '.ts', '.jsx', '.tsx',  // Code
            '.json', '.yaml', '.yml', '.toml',  // Config
            '.html', '.css', '.scss',  // Web
            '.sh', '.bash',  // Scripts
            '.sql',  // Data
            '.gitignore', '.env',  // Dotfiles
        ];

        const response = await fetch('/api/files/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: '',
                root: projectPath,
                mode: 'files',
                extensions: allExtensions,
                max_results: 500,
            }),
        });

        if (!response.ok) {
            console.error('[ProjectExplorer] Failed to load files');
            return;
        }

        const data = await response.json();
        allFiles = (data.results || []).map(item => ({
            path: item.path,
            name: item.name || item.path.split('/').pop(),
            relpath: item.path.startsWith(projectPath)
                ? item.path.slice(projectPath.length + 1)
                : item.path,
        }));
    } catch (err) {
        console.error('[ProjectExplorer] Error loading files:', err);
    }
}

/**
 * Close the explorer
 */
export function close() {
    if (!containerEl) return;

    containerEl.classList.remove('visible');
    isVisible = false;

    // Clean up
    grepSearch.abort();
    if (previewAbortController) {
        previewAbortController.abort();
        previewAbortController = null;
    }

    if (onClose) onClose();
}

/**
 * Check if visible
 */
export function isShown() {
    return isVisible;
}

/**
 * Get element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy
 */
export function destroy() {
    document.removeEventListener('keydown', handleGlobalKeydown);

    grepSearch.abort();
    if (previewAbortController) {
        previewAbortController.abort();
    }

    if (containerEl && containerEl.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    isVisible = false;
}

/**
 * Escape HTML
 */
function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

export default {
    createProjectExplorer,
    open,
    close,
    isShown,
    getElement,
    destroy,
};

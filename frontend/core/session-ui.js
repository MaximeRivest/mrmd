/**
 * Session UI Components for MRMD Web Editor
 * Minimal style matching Files and Variables panels
 */

import * as SessionState from './session-state.js';

// Inject modal styles (shared across app)
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    if (document.getElementById('modal-styles')) {
        stylesInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'modal-styles';
    style.textContent = `
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            z-index: 2000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .modal {
            background: var(--bg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            width: 320px;
            max-width: 90vw;
            max-height: 70vh;
            display: flex;
            flex-direction: column;
        }
        .modal-header {
            padding: 10px 14px;
            font-size: 11px;
            font-weight: 500;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .modal-close {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: none;
            cursor: pointer;
            opacity: 0.4;
            transition: opacity 0.15s;
            padding: 0;
        }
        .modal-close:hover { opacity: 0.8; }
        .modal-close::before {
            content: '';
            width: 10px;
            height: 10px;
            background: currentColor;
            mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M18 6L6 18M6 6l12 12'/%3E%3C/svg%3E");
            -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M18 6L6 18M6 6l12 12'/%3E%3C/svg%3E");
        }
        .modal-body {
            padding: 8px;
            overflow-y: auto;
            flex: 1;
        }
        .modal-filter {
            width: calc(100% - 8px);
            margin: 4px;
            padding: 6px 10px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            color: var(--text);
            font-size: 12px;
            outline: none;
        }
        .modal-filter:focus {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .modal-list {
            padding: 4px 0;
        }
        .modal-item {
            display: flex;
            align-items: center;
            padding: 6px 10px;
            margin: 1px 4px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            color: var(--text);
        }
        .modal-item:hover { background: rgba(255, 255, 255, 0.04); }
        .modal-item.selected { background: rgba(255, 255, 255, 0.08); }
        .modal-item-icon {
            width: 18px;
            margin-right: 8px;
            font-size: 11px;
            opacity: 0.6;
            text-align: center;
        }
        .modal-item-info { flex: 1; min-width: 0; }
        .modal-item-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .modal-item-path {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.7;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .modal-item-badge {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.6;
        }
        .modal-empty {
            padding: 20px;
            text-align: center;
            color: var(--muted);
            font-size: 11px;
            opacity: 0.6;
        }
        .modal-section {
            padding: 8px 10px 4px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
            opacity: 0.6;
        }
        .modal-footer {
            padding: 10px 14px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            gap: 8px;
        }
        .modal-btn {
            flex: 1;
            padding: 6px 12px;
            font-size: 11px;
            background: rgba(255, 255, 255, 0.06);
            border: none;
            border-radius: 4px;
            color: var(--muted);
            cursor: pointer;
        }
        .modal-btn:hover { background: rgba(255, 255, 255, 0.1); color: var(--text); }
        .modal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .modal-input {
            width: 100%;
            padding: 8px 10px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
            outline: none;
        }
        .modal-input:focus { border-color: rgba(255, 255, 255, 0.2); }
        .modal-error { color: #f7768e; font-size: 11px; margin-top: 6px; }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function shortenPath(path) {
    // Support both Linux (/home/user) and macOS (/Users/user)
    if (path?.startsWith('/home/') || path?.startsWith('/Users/')) {
        const parts = path.split('/');
        if (parts.length > 2) return '~/' + parts.slice(3).join('/');
    }
    return path || '';
}

// ============ Session Menu ============

let menuOverlay = null;

export function showSessionMenu(options = {}) {
    injectStyles();
    if (menuOverlay) return;

    const { onBrowseVenv, onBrowseProject, onCreateProject } = options;
    const project = SessionState.getCurrentProject();

    menuOverlay = document.createElement('div');
    menuOverlay.className = 'modal-overlay';

    if (project) {
        // Project mode - show full menu
        const recentProjects = SessionState.getRecentProjects();
        menuOverlay.innerHTML = `
            <div class="modal" style="width: 280px;">
                <div class="modal-header">
                    <span>Session</span>
                    <button class="modal-close"></button>
                </div>
                <div class="modal-body">
                    <div class="modal-section">current project</div>
                    <div class="modal-item selected">
                        <div class="modal-item-info">
                            <div class="modal-item-name">${esc(project.name)}</div>
                            <div class="modal-item-path">${esc(shortenPath(project.path))}</div>
                        </div>
                    </div>
                    <div class="modal-item" data-action="close-project">
                        <div class="modal-item-info">
                            <div class="modal-item-name" style="color: var(--muted);">Close project</div>
                        </div>
                    </div>
                    <div class="modal-item" data-action="create-project">
                        <div class="modal-item-info">
                            <div class="modal-item-name">New project</div>
                        </div>
                    </div>

                    ${recentProjects.length > 0 ? `
                    <div class="modal-section">recent</div>
                    ${recentProjects.slice(0, 5).filter(p => p.path !== project?.path).map(p => `
                    <div class="modal-item" data-action="open-recent" data-path="${esc(p.path)}">
                        <div class="modal-item-info">
                            <div class="modal-item-name">${esc(p.name)}</div>
                            <div class="modal-item-path">${esc(shortenPath(p.path))}</div>
                        </div>
                    </div>
                    `).join('')}
                    ` : ''}

                    <div class="modal-section">environment</div>
                    <div class="modal-item" data-action="browse-venv">
                        <div class="modal-item-info">
                            <div class="modal-item-name">Change Python...</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } else {
        // No project - simple RAM session info
        menuOverlay.innerHTML = `
            <div class="modal" style="width: 240px;">
                <div class="modal-header">
                    <span>Session</span>
                    <button class="modal-close"></button>
                </div>
                <div class="modal-body" style="padding: 12px 16px; font-size: 12px; color: var(--muted); line-height: 1.5;">
                    RAM session only. Open a project to save and restore sessions.
                </div>
            </div>
        `;
    }

    const close = () => {
        menuOverlay?.remove();
        menuOverlay = null;
    };

    menuOverlay.querySelector('.modal-close').addEventListener('click', close);
    menuOverlay.addEventListener('click', e => { if (e.target === menuOverlay) close(); });
    document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    menuOverlay.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', async () => {
            const action = el.dataset.action;
            switch (action) {
                case 'close-project':
                    SessionState.closeProject();
                    close();
                    break;
                case 'open-project':
                    close();
                    onBrowseProject?.();
                    break;
                case 'create-project':
                    close();
                    onCreateProject ? onCreateProject() : showCreateProjectModal();
                    break;
                case 'open-recent':
                    await SessionState.openProject(el.dataset.path);
                    close();
                    break;
                case 'browse-venv':
                    close();
                    onBrowseVenv?.();
                    break;
            }
        });
    });

    document.body.appendChild(menuOverlay);
}

export function hideSessionMenu() {
    menuOverlay?.remove();
    menuOverlay = null;
}

// ============ Venv Picker ============

let venvOverlay = null;
let selectedIndex = 0;
let venvItems = [];
let browseMode = false;
let currentBrowsePath = '/home';
let browseEntries = [];

// Fuzzy match for venv names/paths
function fuzzyMatch(text, pattern) {
    if (!pattern) return { score: 0, indices: [] };
    const textLower = text.toLowerCase();
    const patternLower = pattern.toLowerCase();
    let ti = 0, pi = 0;
    const indices = [];
    let score = 0;
    let consecutive = 0;

    while (ti < text.length && pi < patternLower.length) {
        if (textLower[ti] === patternLower[pi]) {
            indices.push(ti);
            consecutive++;
            score += consecutive * 2;
            if (ti === 0) score += 10;
            if (ti > 0 && '/._-'.includes(text[ti-1])) score += 5;
            pi++;
        } else {
            consecutive = 0;
        }
        ti++;
    }

    return pi === patternLower.length ? { score, indices } : null;
}

// Highlight matched characters
function highlightMatches(text, indices) {
    if (!indices || indices.length === 0) return esc(text);
    const chars = [...text];
    const indexSet = new Set(indices);
    let result = '';
    for (let i = 0; i < chars.length; i++) {
        if (indexSet.has(i)) {
            result += `<span class="venv-match">${esc(chars[i])}</span>`;
        } else {
            result += esc(chars[i]);
        }
    }
    return result;
}

/**
 * Show the venv picker modal.
 * Opens directly in browse mode - user navigates to find their venv folder.
 * Also searches for venvs in background and shows them in a list.
 *
 * @param {Object} options
 * @param {string} options.currentPython - Current python_path for highlighting
 * @param {string} options.projectRoot - Project root for searching
 * @param {Function} options.onSelect - Callback(pythonPath) when selected
 * @param {Function} options.onCancel - Callback when cancelled
 */
export async function showVenvPicker(options = {}) {
    injectStyles();
    injectVenvPickerStyles();
    if (venvOverlay) return;

    const {
        currentPython,
        projectRoot,
        onSelect,
        onCancel,
    } = options;

    const project = SessionState.getCurrentProject();

    // Determine user's home directory - try to extract from projectRoot or default
    // Support both Linux (/home/user) and macOS (/Users/user)
    let userHome = '/';
    if (projectRoot && (projectRoot.startsWith('/home/') || projectRoot.startsWith('/Users/'))) {
        const parts = projectRoot.split('/');
        if (parts.length >= 3) {
            userHome = '/' + parts[1] + '/' + parts[2];  // /home/username or /Users/username
        }
    }

    const searchRoot = projectRoot || userHome;
    currentBrowsePath = userHome;  // Start at user's home

    // State
    let confirmedVenv = null;
    let foundVenvs = [];  // Background search results
    let isSearching = true;
    let showingFound = true;  // Show found venvs section

    venvOverlay = document.createElement('div');
    venvOverlay.className = 'modal-overlay';
    venvOverlay.innerHTML = `
        <div class="modal venv-picker">
            <div class="modal-header">
                <span class="venv-header-title">Select Python Environment</span>
                <button class="modal-close"></button>
            </div>
            <div class="venv-filter-container">
                <input type="text" class="venv-filter" placeholder="filter..." spellcheck="false" autocomplete="off">
            </div>
            <div class="modal-body venv-list"></div>
            <div class="venv-hint">
                <span class="venv-hint-keys">arrows</span> navigate
                <span class="venv-hint-keys">enter</span> select
                <span class="venv-hint-keys">tab</span> switch view
            </div>
            <div class="modal-footer">
                <button class="modal-btn venv-select-btn" style="display: none;">Use this environment</button>
                <button class="modal-btn venv-cancel-btn">Cancel</button>
            </div>
        </div>
    `;

    // Global keydown handler (defined early so close can reference it)
    let globalKeydownHandler = null;

    const close = () => {
        if (globalKeydownHandler) {
            document.removeEventListener('keydown', globalKeydownHandler);
        }
        venvOverlay?.remove();
        venvOverlay = null;
        venvItems = [];
        browseEntries = [];
        selectedIndex = 0;
        confirmedVenv = null;
    };

    const filterInput = venvOverlay.querySelector('.venv-filter');
    const listContainer = venvOverlay.querySelector('.venv-list');
    const selectBtn = venvOverlay.querySelector('.venv-select-btn');
    const cancelBtn = venvOverlay.querySelector('.venv-cancel-btn');
    const hintEl = venvOverlay.querySelector('.venv-hint');

    // Close handlers
    venvOverlay.querySelector('.modal-close').addEventListener('click', () => { close(); onCancel?.(); });
    cancelBtn.addEventListener('click', () => { close(); onCancel?.(); });
    venvOverlay.addEventListener('click', e => { if (e.target === venvOverlay) { close(); onCancel?.(); } });

    // Select button - use confirmed venv
    selectBtn.addEventListener('click', async () => {
        if (!confirmedVenv) return;
        const pythonPath = confirmedVenv.path + '/bin/python';
        close();
        const result = await SessionState.reconfigureSession(pythonPath);
        if (result.success) {
            onSelect?.(pythonPath);
        }
    });

    document.body.appendChild(venvOverlay);
    filterInput.focus();

    // Background search for venvs
    async function searchForVenvs() {
        isSearching = true;
        render();

        try {
            // Search from user's home with good depth
            const results = await SessionState.searchVenvs(userHome, 4);
            foundVenvs = results.map(v => ({
                python_path: v.python_path,
                name: v.name || SessionState.extractVenvName(v.python_path),
                path: v.path || v.python_path.replace(/\/bin\/python[0-9.]*$/, ''),
            }));
        } catch (err) {
            console.error('[VenvPicker] Search error:', err);
            foundVenvs = [];
        }

        isSearching = false;
        render();
    }

    // Check if a directory is a venv (has bin/python)
    async function checkIsVenv(path) {
        try {
            const resp = await fetch('/api/file/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path + '/bin', show_hidden: false }),
            });
            const data = await resp.json();
            if (data.entries) {
                return data.entries.some(e => e.name === 'python' || e.name.startsWith('python3'));
            }
        } catch {}
        return false;
    }

    // Load directory contents for browse mode
    async function loadBrowseDirectory(path) {
        currentBrowsePath = path;
        confirmedVenv = null;
        selectBtn.style.display = 'none';

        try {
            const resp = await fetch('/api/file/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, show_hidden: true }),
            });
            const data = await resp.json();

            if (data.error) {
                browseEntries = [];
                render();
                return;
            }

            browseEntries = [];

            // Parent directory
            if (data.parent && data.parent !== data.path) {
                browseEntries.push({ name: '..', path: data.parent, isDir: true, isParent: true });
            }

            // Add directories only
            for (const entry of (data.entries || [])) {
                if (entry.is_dir) {
                    const looksLikeVenv = ['venv', '.venv', 'env', '.env'].includes(entry.name) ||
                                          entry.name.includes('venv');
                    browseEntries.push({
                        name: entry.name,
                        path: entry.path,
                        isDir: true,
                        looksLikeVenv,
                    });
                }
            }

            // Check if current directory is itself a venv
            const isCurrentVenv = await checkIsVenv(path);
            if (isCurrentVenv) {
                confirmedVenv = { path, name: path.split('/').pop() };
                selectBtn.style.display = '';
                selectBtn.textContent = `Use ${confirmedVenv.name}`;
            }

            selectedIndex = 0;
            render();
        } catch (err) {
            browseEntries = [];
            render();
        }
    }

    // Main render function
    function render() {
        const filter = filterInput.value.trim().toLowerCase();
        let html = '';
        venvItems = [];

        if (showingFound) {
            // Show found venvs list
            hintEl.innerHTML = `
                <span class="venv-hint-keys">arrows</span> navigate
                <span class="venv-hint-keys">enter</span> select
                <span class="venv-hint-keys">tab</span> browse folders
            `;

            if (isSearching) {
                html = `
                    <div class="venv-searching">
                        <div class="venv-searching-text">Searching for Python environments...</div>
                        <div class="venv-searching-path">${esc(userHome)}</div>
                    </div>
                `;
            } else if (foundVenvs.length === 0) {
                html = `
                    <div class="venv-empty">
                        <div>No Python environments found</div>
                        <div class="venv-empty-hint">Press Tab to browse folders manually</div>
                    </div>
                `;
            } else {
                // Filter found venvs
                let matches = [];
                for (const v of foundVenvs) {
                    if (!filter || v.name.toLowerCase().includes(filter) || v.path.toLowerCase().includes(filter)) {
                        const match = filter ? fuzzyMatch(v.name + ' ' + v.path, filter) : { score: 0, indices: [] };
                        if (match) matches.push({ venv: v, ...match });
                    }
                }

                if (filter) {
                    matches.sort((a, b) => b.score - a.score);
                }

                if (matches.length === 0) {
                    html = '<div class="venv-empty">No matches</div>';
                } else {
                    html = `<div class="venv-section-label">found in ${esc(shortenPath(userHome))}</div>`;
                    for (let i = 0; i < matches.length; i++) {
                        const { venv: v } = matches[i];
                        const isSelected = i === selectedIndex;
                        venvItems.push({ type: 'venv', ...v });

                        html += `
                            <div class="venv-found-item ${isSelected ? 'selected' : ''}" data-index="${i}">
                                <span class="venv-found-icon">py</span>
                                <div class="venv-found-info">
                                    <div class="venv-found-name">${esc(v.name)}</div>
                                    <div class="venv-found-path">${esc(shortenPath(v.path))}</div>
                                </div>
                            </div>
                        `;
                    }
                }
            }
        } else {
            // Show browse mode
            hintEl.innerHTML = `
                <span class="venv-hint-keys">arrows</span> navigate
                <span class="venv-hint-keys">enter</span> open
                <span class="venv-hint-keys">backspace</span> up
                <span class="venv-hint-keys">tab</span> found list
            `;

            // Path bar
            html = `<div class="venv-browse-path">${esc(currentBrowsePath)}</div>`;

            // Show venv confirmation if in venv folder
            if (confirmedVenv) {
                html += `
                    <div class="venv-confirmed">
                        <div class="venv-confirmed-icon">py</div>
                        <div class="venv-confirmed-info">
                            <div class="venv-confirmed-label">Python environment found</div>
                            <div class="venv-confirmed-name">${esc(confirmedVenv.name)}</div>
                        </div>
                    </div>
                `;
            }

            // Filter browse entries
            let filtered = [];
            for (const entry of browseEntries) {
                if (entry.isParent) {
                    filtered.push({ entry, score: -1, indices: [] });
                } else {
                    const match = fuzzyMatch(entry.name, filter);
                    if (match) {
                        filtered.push({ entry, ...match });
                    }
                }
            }

            // Sort
            filtered.sort((a, b) => {
                if (a.entry.isParent) return -1;
                if (b.entry.isParent) return 1;
                if (a.entry.looksLikeVenv && !b.entry.looksLikeVenv) return -1;
                if (!a.entry.looksLikeVenv && b.entry.looksLikeVenv) return 1;
                return b.score - a.score;
            });

            if (filtered.length === 0 && !confirmedVenv) {
                html += '<div class="venv-empty">No folders</div>';
            } else {
                for (let i = 0; i < filtered.length; i++) {
                    const { entry, indices } = filtered[i];
                    const isSelected = i === selectedIndex;
                    venvItems.push({ type: 'browse', ...entry });

                    const nameHtml = entry.isParent ? '..' :
                        (indices.length > 0 ? highlightMatches(entry.name, indices) : esc(entry.name));
                    const icon = entry.isParent ? '<' : (entry.looksLikeVenv ? 'py' : '>');

                    html += `
                        <div class="venv-browse-item ${isSelected ? 'selected' : ''} ${entry.looksLikeVenv ? 'looks-like-venv' : ''}"
                             data-index="${i}">
                            <span class="venv-browse-icon">${icon}</span>
                            <span class="venv-browse-name">${nameHtml}</span>
                        </div>
                    `;
                }
            }
        }

        listContainer.innerHTML = html;

        // Click handlers
        if (showingFound) {
            listContainer.querySelectorAll('.venv-found-item').forEach(el => {
                el.addEventListener('click', () => handleFoundSelect(parseInt(el.dataset.index)));
            });
        } else {
            listContainer.querySelectorAll('.venv-browse-item').forEach(el => {
                el.addEventListener('click', () => handleBrowseSelect(parseInt(el.dataset.index)));
            });
        }

        // Scroll selected into view
        const selected = listContainer.querySelector('.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    // Handle selecting a found venv
    async function handleFoundSelect(index) {
        if (index < 0 || index >= venvItems.length) return;
        const item = venvItems[index];
        if (item.type !== 'venv') return;

        const pythonPath = item.python_path;
        close();
        const result = await SessionState.reconfigureSession(pythonPath);
        if (result.success) {
            onSelect?.(pythonPath);
        }
    }

    // Handle selecting a browse item
    async function handleBrowseSelect(index) {
        if (index < 0 || index >= venvItems.length) return;
        const item = venvItems[index];
        if (item.type !== 'browse') return;
        await loadBrowseDirectory(item.path);
        filterInput.value = '';
    }

    // Keyboard navigation
    function handleKeydown(e) {
        if (e.key === 'Escape') {
            close();
            onCancel?.();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            showingFound = !showingFound;
            selectedIndex = 0;
            filterInput.value = '';
            if (!showingFound && browseEntries.length === 0) {
                loadBrowseDirectory(currentBrowsePath);
            } else {
                render();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, venvItems.length - 1);
            render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                render();
            } else if (!showingFound && browseEntries[0]?.isParent && filterInput.value === '') {
                loadBrowseDirectory(browseEntries[0].path);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (showingFound) {
                handleFoundSelect(selectedIndex);
            } else if (confirmedVenv && venvItems.length === 0) {
                selectBtn.click();
            } else {
                handleBrowseSelect(selectedIndex);
            }
        } else if (e.key === 'Backspace' && filterInput.value === '' && !showingFound) {
            e.preventDefault();
            const parentEntry = browseEntries.find(e => e.isParent);
            if (parentEntry) {
                loadBrowseDirectory(parentEntry.path);
            }
        }
    }

    filterInput.addEventListener('input', () => {
        selectedIndex = 0;
        render();
    });
    filterInput.addEventListener('keydown', handleKeydown);

    // Global keydown handler for Tab (works even when filter not focused)
    globalKeydownHandler = function(e) {
        if (!venvOverlay) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            showingFound = !showingFound;
            selectedIndex = 0;
            filterInput.value = '';
            filterInput.focus();
            if (!showingFound && browseEntries.length === 0) {
                loadBrowseDirectory(currentBrowsePath);
            } else {
                render();
            }
        } else if (e.key === 'Escape') {
            close();
            onCancel?.();
        }
    };
    document.addEventListener('keydown', globalKeydownHandler);

    // Start: show found venvs and search in background
    render();
    searchForVenvs();
}

/**
 * Show confirmation modal before switching venvs when session has state.
 */
export function showVenvSwitchConfirmation(options = {}) {
    injectStyles();
    injectVenvPickerStyles();

    const {
        fromVenv,
        toVenv,
        pythonPath,
        onConfirm,
        onCancel,
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal venv-confirm">
            <div class="modal-header">
                <span>Switch Environment?</span>
                <button class="modal-close"></button>
            </div>
            <div class="modal-body">
                <div class="venv-confirm-message">
                    <p>Switching from <strong>${esc(fromVenv)}</strong> to <strong>${esc(toVenv)}</strong> will restart your session.</p>
                    <p class="venv-confirm-warning">Your current variables will be lost.</p>
                </div>
            </div>
            <div class="modal-footer venv-confirm-actions">
                <button class="modal-btn venv-confirm-cancel">Cancel</button>
                <button class="modal-btn venv-confirm-switch">Switch</button>
            </div>
        </div>
    `;

    const close = () => overlay.remove();

    overlay.querySelector('.modal-close').addEventListener('click', () => { close(); onCancel?.(); });
    overlay.querySelector('.venv-confirm-cancel').addEventListener('click', () => { close(); onCancel?.(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { close(); onCancel?.(); } });

    overlay.querySelector('.venv-confirm-switch').addEventListener('click', () => {
        close();
        onConfirm?.();
    });

    // Escape to cancel
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            close();
            document.removeEventListener('keydown', escHandler);
            onCancel?.();
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
}

// Legacy alias
export async function showVenvBrowser(options = {}) {
    return showVenvPicker(options);
}

export function hideVenvBrowser() {
    venvOverlay?.remove();
    venvOverlay = null;
}

// Inject venv picker specific styles
let venvStylesInjected = false;
function injectVenvPickerStyles() {
    if (venvStylesInjected) return;
    if (document.getElementById('venv-picker-styles')) {
        venvStylesInjected = true;
        return;
    }

    const style = document.createElement('style');
    style.id = 'venv-picker-styles';
    style.textContent = `
        .venv-picker {
            width: 340px;
        }
        .venv-filter-container {
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .venv-filter {
            width: 100%;
            padding: 6px 10px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 4px;
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
            outline: none;
        }
        .venv-filter:focus {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .venv-filter::placeholder {
            color: var(--muted);
            opacity: 0.5;
        }
        .venv-list {
            max-height: 320px;
            overflow-y: auto;
            padding: 4px 0;
        }
        .venv-section {
            padding: 8px 14px 4px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
            opacity: 0.5;
        }
        .venv-item {
            display: flex;
            align-items: center;
            padding: 8px 14px;
            margin: 1px 6px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.1s ease;
        }
        .venv-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .venv-item.selected {
            background: rgba(255, 255, 255, 0.06);
        }
        .venv-item.current {
            opacity: 0.6;
        }
        .venv-radio {
            width: 14px;
            font-size: 8px;
            color: var(--muted);
            margin-right: 10px;
            text-align: center;
        }
        .venv-item.current .venv-radio {
            color: var(--accent, #7aa2f7);
        }
        .venv-info {
            flex: 1;
            min-width: 0;
        }
        .venv-name {
            font-size: 12px;
            color: var(--text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .venv-path {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.6;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-top: 1px;
        }
        .venv-version {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.5;
            margin-left: 8px;
            flex-shrink: 0;
        }
        .venv-empty {
            padding: 24px;
            text-align: center;
            color: var(--muted);
            font-size: 11px;
        }
        .venv-empty-hint {
            margin-top: 8px;
            font-size: 10px;
            opacity: 0.5;
        }
        .venv-section-label {
            padding: 8px 14px 4px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
            opacity: 0.5;
        }
        .venv-found-item {
            display: flex;
            align-items: center;
            padding: 8px 14px;
            margin: 1px 6px;
            cursor: pointer;
            border-radius: 4px;
        }
        .venv-found-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .venv-found-item.selected {
            background: rgba(100, 150, 255, 0.12);
        }
        .venv-found-icon {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(158, 206, 106, 0.12);
            border-radius: 4px;
            color: #9ece6a;
            font-size: 9px;
            font-weight: 600;
            margin-right: 10px;
            flex-shrink: 0;
        }
        .venv-found-info {
            flex: 1;
            min-width: 0;
        }
        .venv-found-name {
            font-size: 12px;
            color: var(--text);
        }
        .venv-found-path {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.6;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .venv-searching {
            padding: 32px 24px;
            text-align: center;
        }
        .venv-searching-text {
            font-size: 11px;
            color: var(--text);
            margin-bottom: 6px;
        }
        .venv-searching-path {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.5;
        }
        .venv-match {
            color: #7aa2f7;
            font-weight: 500;
        }
        /* Browse mode */
        .venv-browse-path {
            padding: 6px 14px;
            font-size: 10px;
            color: var(--muted);
            opacity: 0.6;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .venv-browse-item {
            display: flex;
            align-items: center;
            padding: 6px 14px;
            margin: 1px 6px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
            color: var(--muted);
        }
        .venv-browse-item:hover {
            background: rgba(255, 255, 255, 0.04);
            color: var(--text);
        }
        .venv-browse-item.selected {
            background: rgba(100, 150, 255, 0.12);
            color: var(--text);
        }
        .venv-browse-item.is-venv {
            color: var(--text);
        }
        .venv-browse-icon {
            width: 18px;
            margin-right: 8px;
            font-size: 10px;
            opacity: 0.5;
            text-align: center;
            font-family: 'SF Mono', 'Consolas', monospace;
        }
        .venv-browse-item.is-venv .venv-browse-icon {
            color: #9ece6a;
            opacity: 1;
        }
        .venv-browse-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .venv-browse-item.looks-like-venv {
            color: var(--text);
        }
        .venv-browse-item.looks-like-venv .venv-browse-icon {
            color: #9ece6a;
            opacity: 1;
        }
        /* Keyboard hints */
        .venv-hint {
            padding: 6px 14px;
            font-size: 10px;
            color: var(--muted);
            opacity: 0.4;
            border-top: 1px solid rgba(255, 255, 255, 0.04);
        }
        .venv-hint-keys {
            display: inline-block;
            padding: 1px 4px;
            background: rgba(255, 255, 255, 0.06);
            border-radius: 2px;
            margin-right: 2px;
            font-family: 'SF Mono', 'Consolas', monospace;
            font-size: 9px;
        }
        /* Confirmed venv banner */
        .venv-confirmed {
            display: flex;
            align-items: center;
            padding: 10px 14px;
            margin: 6px;
            background: rgba(158, 206, 106, 0.08);
            border: 1px solid rgba(158, 206, 106, 0.2);
            border-radius: 6px;
        }
        .venv-confirmed-icon {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(158, 206, 106, 0.15);
            border-radius: 4px;
            color: #9ece6a;
            font-size: 10px;
            font-weight: 600;
            margin-right: 10px;
        }
        .venv-confirmed-info {
            flex: 1;
        }
        .venv-confirmed-label {
            font-size: 10px;
            color: #9ece6a;
            opacity: 0.8;
        }
        .venv-confirmed-name {
            font-size: 12px;
            color: var(--text);
            font-weight: 500;
        }
        .venv-select-btn {
            background: rgba(158, 206, 106, 0.15) !important;
            color: #9ece6a !important;
            border: 1px solid rgba(158, 206, 106, 0.2) !important;
        }
        .venv-select-btn:hover {
            background: rgba(158, 206, 106, 0.25) !important;
        }
        /* Confirmation modal */
        .venv-confirm {
            width: 360px;
        }
        .venv-confirm-message {
            padding: 8px 0;
        }
        .venv-confirm-message p {
            margin: 0 0 8px;
            font-size: 12px;
            color: var(--text);
            line-height: 1.5;
        }
        .venv-confirm-message strong {
            color: var(--text);
            font-weight: 500;
        }
        .venv-confirm-warning {
            color: var(--muted) !important;
            opacity: 0.7;
            font-size: 11px !important;
        }
        .venv-confirm-actions {
            justify-content: flex-end;
        }
        .venv-confirm-actions .modal-btn {
            flex: none;
            min-width: 70px;
        }
        .venv-confirm-switch {
            background: rgba(122, 162, 247, 0.15) !important;
            color: #7aa2f7 !important;
        }
        .venv-confirm-switch:hover {
            background: rgba(122, 162, 247, 0.25) !important;
        }
    `;
    document.head.appendChild(style);
    venvStylesInjected = true;
}

// ============ Create Project Modal ============

let createOverlay = null;

// Inject create project specific styles
let createStylesInjected = false;
function injectCreateProjectStyles() {
    if (createStylesInjected) return;
    if (document.getElementById('create-project-styles')) {
        createStylesInjected = true;
        return;
    }
    const style = document.createElement('style');
    style.id = 'create-project-styles';
    style.textContent = `
        .create-project-modal {
            width: 400px;
        }
        .create-project-field {
            margin-bottom: 14px;
        }
        .create-project-label {
            display: block;
            font-size: 10px;
            color: var(--muted);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .create-project-templates {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .create-project-template {
            display: flex;
            align-items: flex-start;
            padding: 10px 12px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.1s ease;
        }
        .create-project-template:hover {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .create-project-template.selected {
            background: rgba(122, 162, 247, 0.08);
            border-color: rgba(122, 162, 247, 0.3);
        }
        .create-project-template-radio {
            margin-right: 10px;
            margin-top: 2px;
        }
        .create-project-template-info {
            flex: 1;
        }
        .create-project-template-name {
            font-size: 12px;
            font-weight: 500;
            color: var(--text);
            margin-bottom: 2px;
        }
        .create-project-template-desc {
            font-size: 10px;
            color: var(--muted);
            line-height: 1.4;
        }
    `;
    document.head.appendChild(style);
    createStylesInjected = true;
}

export function showCreateProjectWizard(options = {}) {
    showCreateProjectModal(options);
}

export function showCreateProjectModal(options = {}) {
    injectStyles();
    injectCreateProjectStyles();
    if (createOverlay) return;

    const { onCreated } = options;

    const templates = [
        { id: 'writer', name: 'Writer / Academic', desc: 'Just write and run code. Use %pip install.' },
        { id: 'analyst', name: 'Data Analyst', desc: 'Reproducible deps with %add. Shared code in src/.' },
        { id: 'pythonista', name: 'Pythonista', desc: 'Full package with src layout, tests, editable install.' }
    ];

    createOverlay = document.createElement('div');
    createOverlay.className = 'modal-overlay';
    createOverlay.innerHTML = `
        <div class="modal create-project-modal">
            <div class="modal-header">
                <span>New Project</span>
                <button class="modal-close"></button>
            </div>
            <div class="modal-body" style="padding: 14px;">
                <div class="create-project-field">
                    <label class="create-project-label">Name</label>
                    <input type="text" class="modal-input" id="project-name" placeholder="my-project" spellcheck="false" autocomplete="off">
                </div>
                <div class="create-project-field">
                    <label class="create-project-label">Template</label>
                    <div class="create-project-templates">
                        ${templates.map((t, i) => `
                            <label class="create-project-template${i === 1 ? ' selected' : ''}" data-template="${t.id}">
                                <input type="radio" name="template" value="${t.id}" class="create-project-template-radio"${i === 1 ? ' checked' : ''}>
                                <div class="create-project-template-info">
                                    <div class="create-project-template-name">${t.name}</div>
                                    <div class="create-project-template-desc">${t.desc}</div>
                                </div>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="modal-error" id="project-error" style="display: none;"></div>
            </div>
            <div class="modal-footer">
                <button class="modal-btn" id="create-btn" disabled>Create</button>
            </div>
        </div>
    `;

    const close = () => { createOverlay?.remove(); createOverlay = null; };

    createOverlay.querySelector('.modal-close').addEventListener('click', close);
    createOverlay.addEventListener('click', e => { if (e.target === createOverlay) close(); });

    const input = createOverlay.querySelector('#project-name');
    const btn = createOverlay.querySelector('#create-btn');
    const error = createOverlay.querySelector('#project-error');
    const templateLabels = createOverlay.querySelectorAll('.create-project-template');

    // Template selection
    templateLabels.forEach(label => {
        label.addEventListener('click', () => {
            templateLabels.forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');
        });
    });

    input.addEventListener('input', () => {
        const name = input.value.trim();
        btn.disabled = !name || !/^[a-zA-Z0-9_-]+$/.test(name);
        error.style.display = 'none';
    });

    btn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return;

        const selectedTemplate = createOverlay.querySelector('input[name="template"]:checked')?.value || 'analyst';

        btn.disabled = true;
        btn.textContent = 'Creating...';

        try {
            const result = await SessionState.createProject(name, null, selectedTemplate);
            if (result.success) {
                close();
                onCreated?.(result);
            } else {
                error.textContent = result.message || result.error;
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Create';
            }
        } catch (err) {
            error.textContent = err.message;
            error.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Create';
        }
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !btn.disabled) btn.click();
        if (e.key === 'Escape') close();
    });

    document.body.appendChild(createOverlay);
    setTimeout(() => input.focus(), 50);
}

export function hideCreateProjectWizard() {
    createOverlay?.remove();
    createOverlay = null;
}

// ============ Session Picker (Multi-Session) ============

let sessionPickerOverlay = null;

// Inject session picker specific styles
let sessionPickerStylesInjected = false;
function injectSessionPickerStyles() {
    if (sessionPickerStylesInjected) return;
    if (document.getElementById('session-picker-styles')) {
        sessionPickerStylesInjected = true;
        return;
    }

    const style = document.createElement('style');
    style.id = 'session-picker-styles';
    style.textContent = `
        .session-picker {
            width: 320px;
        }
        .session-picker-list {
            max-height: 280px;
            overflow-y: auto;
            padding: 4px 0;
        }
        .session-picker-section {
            padding: 10px 14px 4px;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
            opacity: 0.5;
        }
        .session-picker-item {
            display: flex;
            align-items: center;
            padding: 8px 14px;
            margin: 1px 6px;
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.1s ease;
        }
        .session-picker-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .session-picker-item.selected {
            background: rgba(100, 150, 255, 0.12);
        }
        .session-picker-item.current {
            background: rgba(158, 206, 106, 0.08);
            border-left: 2px solid #9ece6a;
            padding-left: 12px;
        }
        .session-picker-icon {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 9px;
            font-weight: 600;
            flex-shrink: 0;
        }
        .session-picker-icon.live {
            background: rgba(158, 206, 106, 0.15);
            color: #9ece6a;
        }
        .session-picker-icon.saved {
            background: rgba(122, 162, 247, 0.15);
            color: #7aa2f7;
        }
        .session-picker-info {
            flex: 1;
            min-width: 0;
        }
        .session-picker-name {
            font-size: 12px;
            color: var(--text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .session-picker-meta {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.6;
            margin-top: 1px;
        }
        .session-picker-badge {
            font-size: 9px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 8px;
            flex-shrink: 0;
        }
        .session-picker-badge.live {
            background: rgba(158, 206, 106, 0.12);
            color: #9ece6a;
        }
        .session-picker-badge.saved {
            background: rgba(122, 162, 247, 0.12);
            color: #7aa2f7;
        }
        .session-picker-badge.dirty {
            background: rgba(255, 158, 100, 0.12);
            color: #ff9e64;
        }
        .session-picker-actions {
            display: flex;
            gap: 4px;
            margin-left: 8px;
            opacity: 0;
            transition: opacity 0.1s;
        }
        .session-picker-item:hover .session-picker-actions {
            opacity: 1;
        }
        .session-picker-action {
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.04);
            border: none;
            border-radius: 3px;
            color: var(--muted);
            cursor: pointer;
            font-size: 10px;
            padding: 0;
        }
        .session-picker-action:hover {
            background: rgba(255, 255, 255, 0.1);
            color: var(--text);
        }
        .session-picker-action.danger:hover {
            background: rgba(247, 118, 142, 0.15);
            color: #f7768e;
        }
        .session-picker-action.restore {
            background: rgba(122, 162, 247, 0.1);
            color: #7aa2f7;
        }
        .session-picker-action.restore:hover {
            background: rgba(122, 162, 247, 0.2);
        }
        .session-picker-name-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .session-picker-tags {
            display: flex;
            gap: 4px;
        }
        .session-tag {
            font-size: 9px;
            padding: 1px 5px;
            border-radius: 3px;
            font-weight: 500;
        }
        .session-tag.connected {
            background: rgba(158, 206, 106, 0.15);
            color: #9ece6a;
        }
        .session-tag.running {
            background: rgba(122, 162, 247, 0.15);
            color: #7aa2f7;
        }
        .session-tag.saved {
            background: rgba(255, 158, 100, 0.12);
            color: #ff9e64;
        }
        .session-tag.saved.stale {
            opacity: 0.6;
        }
        .session-picker-empty {
            padding: 24px;
            text-align: center;
            color: var(--muted);
            font-size: 11px;
        }
        .session-picker-create {
            display: flex;
            align-items: center;
            padding: 8px 14px;
            margin: 4px 6px;
            cursor: pointer;
            border-radius: 4px;
            border: 1px dashed rgba(255, 255, 255, 0.1);
            color: var(--muted);
            font-size: 12px;
        }
        .session-picker-create:hover {
            background: rgba(255, 255, 255, 0.02);
            border-color: rgba(255, 255, 255, 0.2);
            color: var(--text);
        }
        .session-picker-create-icon {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
            font-size: 14px;
            opacity: 0.5;
        }
        /* Create session form */
        .session-create-form {
            padding: 12px 14px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .session-create-row {
            display: flex;
            gap: 8px;
        }
        .session-create-input {
            flex: 1;
            padding: 6px 10px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
            outline: none;
        }
        .session-create-input:focus {
            border-color: rgba(255, 255, 255, 0.2);
        }
        .session-create-btn {
            padding: 6px 12px;
            background: rgba(122, 162, 247, 0.15);
            border: none;
            border-radius: 4px;
            color: #7aa2f7;
            font-size: 11px;
            cursor: pointer;
        }
        .session-create-btn:hover {
            background: rgba(122, 162, 247, 0.25);
        }
        .session-create-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        /* Saved session restore prompt */
        .session-restore-prompt {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg);
            border: 1px solid rgba(122, 162, 247, 0.3);
            border-radius: 8px;
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            z-index: 1500;
            animation: slideUp 0.2s ease;
        }
        @keyframes slideUp {
            from { transform: translateX(-50%) translateY(20px); opacity: 0; }
            to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
        .session-restore-icon {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(122, 162, 247, 0.15);
            border-radius: 6px;
            color: #7aa2f7;
            font-size: 12px;
        }
        .session-restore-info {
            flex: 1;
        }
        .session-restore-title {
            font-size: 12px;
            color: var(--text);
            font-weight: 500;
        }
        .session-restore-desc {
            font-size: 10px;
            color: var(--muted);
            margin-top: 2px;
        }
        .session-restore-actions {
            display: flex;
            gap: 8px;
        }
        .session-restore-btn {
            padding: 6px 12px;
            font-size: 11px;
            border-radius: 4px;
            cursor: pointer;
            border: none;
        }
        .session-restore-btn.restore {
            background: rgba(122, 162, 247, 0.15);
            color: #7aa2f7;
        }
        .session-restore-btn.restore:hover {
            background: rgba(122, 162, 247, 0.25);
        }
        .session-restore-btn.dismiss {
            background: transparent;
            color: var(--muted);
        }
        .session-restore-btn.dismiss:hover {
            color: var(--text);
        }
    `;
    document.head.appendChild(style);
    sessionPickerStylesInjected = true;
}

function formatBytes(bytes) {
    if (!bytes) return null;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)}KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)}MB`;
}

function formatSessionMeta(session, notebookCount) {
    const parts = [];

    // RAM usage for live sessions
    if (session.memory_bytes) {
        parts.push(formatBytes(session.memory_bytes));
    }

    // Variables count
    if (session.variables_count > 0) {
        parts.push(`${session.variables_count} vars`);
    }

    // Saved file size for saved sessions
    if (session.state === 'saved' && session.size) {
        parts.push(formatBytes(session.size));
    }

    // Notebook count
    if (notebookCount > 0) {
        parts.push(`${notebookCount} notebook${notebookCount > 1 ? 's' : ''}`);
    }

    return parts.join(' · ');
}

/**
 * Show the session picker modal
 * @param {Object} options
 * @param {Function} options.onSelect - Callback when session is selected
 * @param {Function} options.onClose - Callback when picker is closed
 */
export async function showSessionPicker(options = {}) {
    injectStyles();
    injectSessionPickerStyles();
    if (sessionPickerOverlay) return;

    const { onSelect, onClose } = options;

    const project = SessionState.getCurrentProject();
    if (!project) {
        console.warn('[SessionPicker] No project open');
        return;
    }

    // Load sessions and notebook bindings
    const { sessions: loadedSessions, notebookBindings } = await SessionState.loadProjectSessions();
    let sessions = loadedSessions;
    const currentSessionName = SessionState.getCurrentSessionName();

    // Count notebooks per session
    function countNotebooks(sessionName) {
        let count = 0;
        for (const session of Object.values(notebookBindings)) {
            if (session === sessionName) count++;
        }
        return count;
    }

    let showCreateForm = false;

    sessionPickerOverlay = document.createElement('div');
    sessionPickerOverlay.className = 'modal-overlay';

    const close = () => {
        sessionPickerOverlay?.remove();
        sessionPickerOverlay = null;
        onClose?.();
    };

    function render() {
        // Filter out sessions that are neither running nor have saved state
        // A session exists if: running (live) OR has_saved_state
        const validSessions = sessions.filter(s => s.state === 'live' || s.has_saved_state);

        sessionPickerOverlay.innerHTML = `
            <div class="modal session-picker">
                <div class="modal-header">
                    <span>Sessions</span>
                    <button class="modal-close"></button>
                </div>
                <div class="modal-body session-picker-list">
                    ${validSessions.length > 0 ?
                        validSessions.map(s => renderSessionItem(s, currentSessionName, countNotebooks(s.name), s.has_saved_state)).join('')
                    : `
                        <div class="session-picker-empty">No sessions yet. Run some code to create the default session.</div>
                    `}
                    <div class="session-picker-create" data-action="toggle-create">
                        <span class="session-picker-create-icon">+</span>
                        <span>New session</span>
                    </div>
                </div>
                ${showCreateForm ? `
                    <div class="session-create-form">
                        <div class="session-create-row">
                            <input type="text" class="session-create-input" placeholder="session name" spellcheck="false" autocomplete="off">
                            <button class="session-create-btn">Create</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        // Event handlers
        sessionPickerOverlay.querySelector('.modal-close').addEventListener('click', close);
        sessionPickerOverlay.addEventListener('click', e => { if (e.target === sessionPickerOverlay) close(); });

        // Session item clicks
        sessionPickerOverlay.querySelectorAll('.session-picker-item').forEach(el => {
            el.addEventListener('click', async (e) => {
                if (e.target.closest('.session-picker-action')) return;
                const name = el.dataset.name;
                if (name !== currentSessionName) {
                    close();
                    // Skip warning - picker already shows unsaved state, user can save explicitly
                    const result = await SessionState.switchToSession(name, true);
                    if (result.success) {
                        // Bind current notebook to this session
                        const activeFile = SessionState.getActiveFilePath();
                        if (activeFile && activeFile.endsWith('.md')) {
                            await SessionState.bindNotebookToSession(activeFile, name);
                        }
                        onSelect?.(name);
                    }
                }
            });
        });

        // Save button (save without stopping)
        sessionPickerOverlay.querySelectorAll('[data-action="save"]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = el.closest('.session-picker-item').dataset.name;
                el.disabled = true;
                el.textContent = '...';
                const result = await SessionState.saveSession(name);
                if (result.success) {
                    const { sessions: updated } = await SessionState.loadProjectSessions();
                    sessions = updated;
                    render();
                } else {
                    alert('Failed to save: ' + (result.message || 'Unknown error'));
                    el.disabled = false;
                    el.textContent = '💾';
                }
            });
        });

        // Delete saved state button
        sessionPickerOverlay.querySelectorAll('[data-action="delete-saved"]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = el.closest('.session-picker-item').dataset.name;
                if (confirm(`Delete saved state for "${name}"?`)) {
                    await SessionState.deleteSessionSavedState(name);
                    const { sessions: updated } = await SessionState.loadProjectSessions();
                    sessions = updated;
                    render();
                }
            });
        });

        // Kill button (for live sessions - discard without saving)
        sessionPickerOverlay.querySelectorAll('[data-action="kill"]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = el.closest('.session-picker-item').dataset.name;
                if (confirm(`Stop session "${name}" and discard all variables?`)) {
                    el.disabled = true;
                    el.textContent = '...';
                    const result = await SessionState.killSession(name, false);
                    if (result.success) {
                        const { sessions: updated } = await SessionState.loadProjectSessions();
                        sessions = updated;
                        render();
                    } else {
                        alert('Failed to stop: ' + (result.message || 'Unknown error'));
                        el.disabled = false;
                        el.textContent = '×';
                    }
                }
            });
        });

        // Restore button (for saved sessions)
        sessionPickerOverlay.querySelectorAll('[data-action="restore"]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = el.closest('.session-picker-item').dataset.name;
                el.disabled = true;
                el.textContent = '...';
                const result = await SessionState.restoreSession(name);
                if (result.success) {
                    const { sessions: updated } = await SessionState.loadProjectSessions();
                    sessions = updated;
                    render();
                } else {
                    alert('Failed to restore: ' + (result.message || result.error || 'Unknown error'));
                    el.disabled = false;
                    el.textContent = '▶';
                }
            });
        });

        // Toggle create form
        sessionPickerOverlay.querySelector('[data-action="toggle-create"]')?.addEventListener('click', () => {
            showCreateForm = !showCreateForm;
            render();
            if (showCreateForm) {
                setTimeout(() => sessionPickerOverlay.querySelector('.session-create-input')?.focus(), 50);
            }
        });

        // Create form handlers
        const createInput = sessionPickerOverlay.querySelector('.session-create-input');
        const createBtn = sessionPickerOverlay.querySelector('.session-create-btn');
        if (createInput && createBtn) {
            const doCreate = async () => {
                const name = createInput.value.trim();
                if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return;
                if (sessions.some(s => s.name === name)) {
                    alert('Session name already exists');
                    return;
                }
                createBtn.disabled = true;
                const result = await SessionState.createProjectSession(name);
                if (result.success) {
                    const { sessions: updated } = await SessionState.loadProjectSessions();
                    sessions = updated;
                    showCreateForm = false;
                    render();
                } else {
                    alert(result.message || 'Failed to create session');
                    createBtn.disabled = false;
                }
            };
            createBtn.addEventListener('click', doCreate);
            createInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') doCreate();
                if (e.key === 'Escape') { showCreateForm = false; render(); }
            });
        }

        // Escape to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', escHandler);
                close();
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    function renderSessionItem(session, currentName, notebookCount, hasSavedState) {
        const isConnected = session.name === currentName;
        const isRunning = session.state === 'live';
        const canDelete = session.name !== 'main';

        // Status tags
        const tags = [];
        if (isConnected) {
            tags.push('<span class="session-tag connected">connected</span>');
        }
        if (isRunning) {
            tags.push('<span class="session-tag running">running</span>');
        }
        if (hasSavedState) {
            // Check if saved state is stale (saved before last_used)
            const isStale = isRunning; // If running, saved state might be outdated
            tags.push(`<span class="session-tag saved${isStale ? ' stale' : ''}">on disk${isStale ? ' (stale)' : ''}</span>`);
        }

        // Actions based on state
        let actions = [];

        if (isRunning) {
            // Save (without stopping)
            actions.push(`<button class="session-picker-action" data-action="save" title="Save to disk">💾</button>`);
            // Stop
            actions.push(`<button class="session-picker-action danger" data-action="kill" title="Stop process">⏹</button>`);
        } else if (hasSavedState) {
            // Start/restore from saved
            actions.push(`<button class="session-picker-action restore" data-action="restore" title="Start from saved">▶</button>`);
        }

        // Delete saved state (if has saved state and not main)
        if (hasSavedState && canDelete) {
            actions.push(`<button class="session-picker-action danger" data-action="delete-saved" title="Delete saved state">🗑</button>`);
        }

        const meta = formatSessionMeta(session, notebookCount);

        return `
            <div class="session-picker-item ${isConnected ? 'current' : ''}" data-name="${esc(session.name)}" data-state="${session.state}" data-has-saved="${hasSavedState}">
                <div class="session-picker-info">
                    <div class="session-picker-name-row">
                        <span class="session-picker-name">${esc(session.name)}</span>
                        <span class="session-picker-tags">${tags.join('')}</span>
                    </div>
                    ${meta ? `<div class="session-picker-meta">${meta}</div>` : ''}
                </div>
                <div class="session-picker-actions">
                    ${actions.join('')}
                </div>
            </div>
        `;
    }

    document.body.appendChild(sessionPickerOverlay);
    render();
}

export function hideSessionPicker() {
    sessionPickerOverlay?.remove();
    sessionPickerOverlay = null;
}

/**
 * Show a prompt to restore a saved session when opening a notebook
 * @param {Object} options
 * @param {string} options.sessionName - Name of the saved session
 * @param {Object} options.sessionInfo - Session info object
 * @param {string} options.notebookPath - Path to the notebook
 * @param {Function} options.onRestore - Callback to restore session
 * @param {Function} options.onDismiss - Callback to dismiss
 */
export function showSessionRestorePrompt(options = {}) {
    injectSessionPickerStyles();

    const { sessionName, sessionInfo, notebookPath, onRestore, onDismiss } = options;

    // Remove any existing prompt
    document.querySelector('.session-restore-prompt')?.remove();

    const prompt = document.createElement('div');
    prompt.className = 'session-restore-prompt';
    prompt.innerHTML = `
        <div class="session-restore-icon">◉</div>
        <div class="session-restore-info">
            <div class="session-restore-title">Restore session "${esc(sessionName)}"?</div>
            <div class="session-restore-desc">${sessionInfo.variables_count || 0} variables saved</div>
        </div>
        <div class="session-restore-actions">
            <button class="session-restore-btn dismiss">Skip</button>
            <button class="session-restore-btn restore">Restore</button>
        </div>
    `;

    const close = () => prompt.remove();

    prompt.querySelector('.restore').addEventListener('click', async () => {
        close();
        // First restore the saved state from disk
        const restoreResult = await SessionState.restoreSession(sessionName);
        if (restoreResult.success) {
            // Then switch to it
            await SessionState.switchToSession(sessionName);
            onRestore?.(sessionName);
        }
    });

    prompt.querySelector('.dismiss').addEventListener('click', () => {
        close();
        onDismiss?.();
    });

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
        if (document.body.contains(prompt)) {
            close();
        }
    }, 10000);

    document.body.appendChild(prompt);
}

// Legacy exports for compatibility
export function createSessionIndicator() { return document.createElement('span'); }
export function createProjectIndicator() { return document.createElement('span'); }

// Global access
window.SessionUI = {
    showSessionMenu,
    hideSessionMenu,
    showVenvPicker,
    showVenvSwitchConfirmation,
    showVenvBrowser,  // legacy alias
    hideVenvBrowser,
    showCreateProjectWizard,
    hideCreateProjectWizard,
    showCreateProjectModal,
    showSessionPicker,
    hideSessionPicker,
    showSessionRestorePrompt,
};

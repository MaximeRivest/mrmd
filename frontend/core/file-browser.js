/**
 * Reusable File Browser Component for MRMD
 *
 * Used by both the sidebar Files panel and the Save As modal.
 * Provides:
 * - Directory listing with lazy loading
 * - Fuzzy filtering with match highlighting
 * - Keyboard navigation (arrows, enter, backspace, escape)
 * - Parent directory navigation
 * - File/folder icons
 * - Project detection
 */

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

// File icons - minimal text symbols
function getFileIcon(entry) {
    if (entry.is_dir) return '>';
    const ext = entry.ext || (entry.name ? '.' + entry.name.split('.').pop() : '');
    if (['.md', '.markdown'].includes(ext)) return 'M';
    if (['.py'].includes(ext)) return 'py';
    if (['.js'].includes(ext)) return 'js';
    if (['.ts'].includes(ext)) return 'ts';
    if (['.json'].includes(ext)) return '{}';
    if (['.html', '.htm'].includes(ext)) return '<>';
    if (['.css'].includes(ext)) return '#';
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg'].includes(ext)) return 'im';
    if (['.toml', '.yaml', '.yml'].includes(ext)) return '=';
    if (['.sh', '.bash'].includes(ext)) return '$';
    if (['.txt'].includes(ext)) return '-';
    return '.';
}

// Simple fuzzy match - returns match info or null
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
            if (ti > 0 && (text[ti-1] === '/' || text[ti-1] === '_' || text[ti-1] === '-' || text[ti-1] === '.')) {
                score += 5;
            }
            pi++;
        } else {
            consecutive = 0;
        }
        ti++;
    }

    if (pi === patternLower.length) {
        return { score, indices };
    }
    return null;
}

// Highlight matched characters in text
function highlightMatches(text, indices) {
    if (!indices || indices.length === 0) return esc(text);

    const chars = [...text];
    const indexSet = new Set(indices);
    let result = '';

    for (let i = 0; i < chars.length; i++) {
        if (indexSet.has(i)) {
            result += `<span class="fb-match">${esc(chars[i])}</span>`;
        } else {
            result += esc(chars[i]);
        }
    }
    return result;
}

// Project markers - folders/files that indicate a project root
const PROJECT_MARKERS = ['.venv', 'venv', 'pyproject.toml', 'uv.lock', '.git'];

/**
 * Create a file browser instance
 *
 * @param {HTMLElement} container - Container element to render into
 * @param {Object} options - Configuration options
 * @param {string} options.initialPath - Starting directory path
 * @param {string} options.mode - 'browse' (default) or 'save' (folders only)
 * @param {boolean} options.showFilter - Show filter input (default true)
 * @param {boolean} options.showProjectButton - Show "Open as Project" button (default true in browse mode)
 * @param {Function} options.onSelect - Called when file/folder is selected
 * @param {Function} options.onNavigate - Called when directory changes
 * @param {Function} options.onOpenProject - Called when "Open as Project" is clicked
 * @param {Function} options.onCancel - Called when escape is pressed with empty filter
 * @param {Function} options.onFileDelete - Called when file delete is confirmed
 * @param {Function} options.onFileRename - Called when file rename is confirmed
 * @param {Function} options.onFileCreate - Called when a new file is created (path)
 * @param {Function} options.onFilesUploaded - Called when files are uploaded via drag/drop (files array)
 * @returns {Object} Browser API
 */
export function createFileBrowser(container, options = {}) {
    const {
        initialPath = '/home',
        mode = 'browse',
        showFilter = true,
        showProjectButton = mode === 'browse',
        onSelect = () => {},
        onNavigate = () => {},
        onOpenProject = () => {},
        onCancel = () => {},
        onFileDelete = null,
        onFileRename = null,
        onFileCreate = null,
        onFilesUploaded = null,
        getCollabClient = null,  // Optional: Function returning CollabClient instance for directory watching
        onBeforeRender = null,   // Optional: Transform entries before rendering (entries, currentPath) => entries
    } = options;

    // State
    let currentPath = initialPath;
    let entries = [];
    let parentPath = null;
    let filteredEntries = [];
    let selectedIndex = 0;
    let isProjectFolder = false;
    let contextMenu = null;
    let contextMenuCloseHandler = null;
    let activeFilePath = null;  // Currently open file in editor
    let watchedDirectory = null;  // Currently watched directory
    let directoryChangeHandlerAttached = false;  // Track if we've attached our handler
    let clipboard = null;  // { path, name, isDir, operation: 'copy' | 'cut' }
    let inlineEditEl = null;  // Currently active inline edit input
    let draggedItem = null;  // Currently dragged item { path, name, isDir }
    let externalFilter = '';  // Filter text set from outside (when showFilter is false)

    // Directory change handler
    const directoryChangeHandler = ({ dirPath, eventType, changedPath, isDir }) => {
        // Only refresh if this is the directory we're currently viewing
        if (dirPath === currentPath) {
            console.log('[FileBrowser] Directory changed:', eventType, changedPath);
            loadDirectory(currentPath);
        }
    };

    // Attach directory change handler to collab client (called when needed)
    function attachDirectoryChangeHandler() {
        if (directoryChangeHandlerAttached || !getCollabClient) return;
        const client = getCollabClient();
        if (!client) return;

        // Store original handler to check if it exists
        const originalHandler = client.options.onDirectoryChanged;
        client.options.onDirectoryChanged = (data) => {
            // Call original handler if any
            if (originalHandler) originalHandler(data);
            // Call our handler
            directoryChangeHandler(data);
        };
        directoryChangeHandlerAttached = true;
    }

    // Context menu functions
    function showContextMenu(e, path, name, isDir, isEmptyArea = false, targetEl = null) {
        e.preventDefault();
        e.stopPropagation();
        hideContextMenu();

        contextMenu = document.createElement('div');
        contextMenu.className = 'fb-context-menu';

        let menuHtml = '';

        // Empty area context menu (right-click on background)
        if (isEmptyArea) {
            menuHtml = `
                <div class="fb-context-item" data-action="new-file">
                    <span class="fb-context-icon">+</span>
                    <span>New File</span>
                </div>
                <div class="fb-context-item" data-action="new-folder">
                    <span class="fb-context-icon">+</span>
                    <span>New Folder</span>
                </div>
            `;
            if (clipboard) {
                menuHtml += `
                    <div class="fb-context-separator"></div>
                    <div class="fb-context-item" data-action="paste">
                        <span class="fb-context-icon">⌘V</span>
                        <span>Paste</span>
                    </div>
                `;
            }
        } else {
            // Item context menu
            menuHtml = `
                <div class="fb-context-item" data-action="new-file">
                    <span class="fb-context-icon">+</span>
                    <span>New File</span>
                </div>
                <div class="fb-context-item" data-action="new-folder">
                    <span class="fb-context-icon">+</span>
                    <span>New Folder</span>
                </div>
                <div class="fb-context-separator"></div>
                <div class="fb-context-item" data-action="copy">
                    <span class="fb-context-icon">⌘C</span>
                    <span>Copy</span>
                </div>
                <div class="fb-context-item" data-action="cut">
                    <span class="fb-context-icon">⌘X</span>
                    <span>Cut</span>
                </div>
            `;
            if (clipboard) {
                menuHtml += `
                    <div class="fb-context-item" data-action="paste">
                        <span class="fb-context-icon">⌘V</span>
                        <span>Paste</span>
                    </div>
                `;
            }
            menuHtml += `
                <div class="fb-context-item" data-action="duplicate">
                    <span class="fb-context-icon">⌘D</span>
                    <span>Duplicate</span>
                </div>
                <div class="fb-context-separator"></div>
                <div class="fb-context-item" data-action="copy-path">
                    <span class="fb-context-icon">⌘</span>
                    <span>Copy Path</span>
                </div>
            `;

            if (onFileRename) {
                menuHtml += `
                    <div class="fb-context-item" data-action="rename" data-is-dir="${isDir}">
                        <span class="fb-context-icon">✎</span>
                        <span>Rename</span>
                    </div>
                `;
            }

            if (onFileDelete) {
                menuHtml += `
                    <div class="fb-context-separator"></div>
                    <div class="fb-context-item danger" data-action="delete" data-is-dir="${isDir}">
                        <span class="fb-context-icon">⌫</span>
                        <span>Delete</span>
                    </div>
                `;
            }
        }

        contextMenu.innerHTML = menuHtml;

        // Position menu
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(contextMenu);

        // Adjust if off-screen
        requestAnimationFrame(() => {
            if (!contextMenu) return;
            const rect = contextMenu.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                contextMenu.style.left = (window.innerWidth - rect.width - 8) + 'px';
            }
            if (rect.bottom > window.innerHeight) {
                contextMenu.style.top = (e.clientY - rect.height) + 'px';
            }
        });

        // Handle clicks on menu items
        contextMenu.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
        });

        contextMenu.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const item = ev.target.closest('[data-action]');
            if (!item) return;
            const action = item.dataset.action;

            hideContextMenu();

            switch (action) {
                case 'new-file':
                    showInlineEdit('file');
                    break;
                case 'new-folder':
                    showInlineEdit('folder');
                    break;
                case 'copy':
                    clipboard = { path, name, isDir, operation: 'copy' };
                    break;
                case 'cut':
                    clipboard = { path, name, isDir, operation: 'cut' };
                    break;
                case 'paste':
                    if (clipboard) {
                        const existingNames = entries.map(e => e.name);
                        const destName = getUniqueName(clipboard.name, existingNames, clipboard.isDir);
                        const destPath = currentPath + '/' + destName;
                        try {
                            if (clipboard.operation === 'copy') {
                                const result = await copyFile(clipboard.path, destPath);
                                if (result.error) {
                                    console.error('Copy failed:', result.error);
                                } else {
                                    loadDirectory(currentPath);
                                }
                            } else {
                                const result = await moveFile(clipboard.path, destPath);
                                if (result.error) {
                                    console.error('Move failed:', result.error);
                                } else {
                                    clipboard = null;  // Clear clipboard after cut
                                    loadDirectory(currentPath);
                                }
                            }
                        } catch (err) {
                            console.error('Paste failed:', err);
                        }
                    }
                    break;
                case 'duplicate':
                    const existingNames = entries.map(e => e.name);
                    const dupName = getUniqueName(name, existingNames, isDir);
                    const dupPath = currentPath + '/' + dupName;
                    try {
                        const result = await copyFile(path, dupPath);
                        if (result.error) {
                            console.error('Duplicate failed:', result.error);
                        } else {
                            loadDirectory(currentPath);
                        }
                    } catch (err) {
                        console.error('Duplicate failed:', err);
                    }
                    break;
                case 'copy-path':
                    await navigator.clipboard.writeText(path);
                    break;
                case 'rename':
                    if (targetEl) {
                        showInlineRename(targetEl, path, name, isDir);
                    } else {
                        const dir = path.substring(0, path.lastIndexOf('/') + 1);
                        const newName = prompt(`Rename ${isDir ? 'folder' : 'file'}:`, name);
                        if (newName && newName !== name) {
                            const newPath = dir + newName;
                            if (onFileRename) onFileRename(path, newPath);
                        }
                    }
                    break;
                case 'delete':
                    const deleteIsDir = item.dataset.isDir === 'true';
                    const confirmMsg = deleteIsDir
                        ? `Delete folder "${name}" and ALL its contents?\n\nThis cannot be undone.`
                        : `Delete "${name}"?\n\nThis cannot be undone.`;
                    if (confirm(confirmMsg)) {
                        if (onFileDelete) onFileDelete(path, deleteIsDir);
                    }
                    break;
            }
        });

        // Close on outside click/contextmenu/escape
        contextMenuCloseHandler = (ev) => {
            if (ev.type === 'keydown' && ev.key === 'Escape') {
                hideContextMenu();
                return;
            }
            if (contextMenu && !contextMenu.contains(ev.target)) {
                hideContextMenu();
            }
        };
        document.addEventListener('mousedown', contextMenuCloseHandler, true);
        document.addEventListener('contextmenu', contextMenuCloseHandler, true);
        document.addEventListener('keydown', contextMenuCloseHandler, true);
    }

    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
        if (contextMenuCloseHandler) {
            document.removeEventListener('mousedown', contextMenuCloseHandler, true);
            document.removeEventListener('contextmenu', contextMenuCloseHandler, true);
            document.removeEventListener('keydown', contextMenuCloseHandler, true);
            contextMenuCloseHandler = null;
        }
    }

    // Inline editing for new file/folder creation
    function showInlineEdit(type = 'file') {
        hideInlineEdit();

        const defaultName = type === 'folder' ? 'new-folder' : 'untitled.md';

        inlineEditEl = document.createElement('div');
        inlineEditEl.className = 'fb-item fb-inline-edit';
        inlineEditEl.innerHTML = `
            <span class="fb-icon">${type === 'folder' ? '>' : '.'}</span>
            <input type="text" class="fb-inline-input" value="${defaultName}" spellcheck="false" autocomplete="off">
        `;

        // Insert at the top of the list (after parent link if present)
        const firstItem = listEl.querySelector('.fb-item:not(.fb-parent)');
        if (firstItem) {
            listEl.insertBefore(inlineEditEl, firstItem);
        } else {
            listEl.appendChild(inlineEditEl);
        }

        const input = inlineEditEl.querySelector('input');
        input.focus();
        // Select name without extension for files
        if (type === 'file') {
            const dotIndex = defaultName.lastIndexOf('.');
            if (dotIndex > 0) {
                input.setSelectionRange(0, dotIndex);
            } else {
                input.select();
            }
        } else {
            input.select();
        }

        const finishEdit = async (save) => {
            if (!inlineEditEl) return;
            const name = input.value.trim();
            hideInlineEdit();

            if (save && name) {
                const newPath = currentPath + '/' + name;
                try {
                    if (type === 'folder') {
                        const resp = await fetch('/api/file/mkdir', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: newPath }),
                        });
                        const data = await resp.json();
                        if (data.error) {
                            console.error('Failed to create folder:', data.error);
                        } else {
                            loadDirectory(currentPath);
                        }
                    } else {
                        const resp = await fetch('/api/file/write', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ path: newPath, content: '' }),
                        });
                        const data = await resp.json();
                        if (data.error) {
                            console.error('Failed to create file:', data.error);
                        } else {
                            loadDirectory(currentPath);
                            if (onFileCreate) onFileCreate(newPath);
                        }
                    }
                } catch (err) {
                    console.error('Failed to create:', err);
                }
            }
        };

        input.addEventListener('blur', () => finishEdit(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        });
    }

    function hideInlineEdit() {
        if (inlineEditEl) {
            inlineEditEl.remove();
            inlineEditEl = null;
        }
    }

    // Inline rename for existing item
    function showInlineRename(itemEl, path, name, isDir) {
        hideInlineEdit();

        const nameSpan = itemEl.querySelector('.fb-name');
        const originalHtml = nameSpan.innerHTML;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'fb-inline-input';
        input.value = name;
        input.spellcheck = false;
        input.autocomplete = 'off';

        nameSpan.innerHTML = '';
        nameSpan.appendChild(input);
        inlineEditEl = itemEl;

        input.focus();
        // Select name without extension for files
        if (!isDir) {
            const dotIndex = name.lastIndexOf('.');
            if (dotIndex > 0) {
                input.setSelectionRange(0, dotIndex);
            } else {
                input.select();
            }
        } else {
            input.select();
        }

        const finishEdit = async (save) => {
            const newName = input.value.trim();
            nameSpan.innerHTML = originalHtml;
            inlineEditEl = null;

            if (save && newName && newName !== name) {
                const dir = path.substring(0, path.lastIndexOf('/') + 1);
                const newPath = dir + newName;
                if (onFileRename) onFileRename(path, newPath);
            }
        };

        input.addEventListener('blur', () => finishEdit(true));
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEdit(false);
            }
        });
    }

    // File operations via API
    async function copyFile(srcPath, destPath) {
        const resp = await fetch('/api/file/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ src_path: srcPath, dest_path: destPath }),
        });
        return resp.json();
    }

    async function moveFile(srcPath, destPath) {
        const resp = await fetch('/api/file/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_path: srcPath, new_path: destPath }),
        });
        return resp.json();
    }

    async function uploadFiles(files, destDir) {
        const formData = new FormData();
        formData.append('dest_dir', destDir);
        for (const file of files) {
            formData.append('files', file, file.name);
        }
        const resp = await fetch('/api/file/upload', {
            method: 'POST',
            body: formData,
        });
        return resp.json();
    }

    // Get unique name for paste (add -copy suffix if needed)
    function getUniqueName(baseName, existingNames, isDir) {
        if (!existingNames.includes(baseName)) return baseName;

        const ext = isDir ? '' : (baseName.includes('.') ? '.' + baseName.split('.').pop() : '');
        const nameWithoutExt = isDir ? baseName : baseName.replace(ext, '');

        let counter = 1;
        let newName;
        do {
            newName = `${nameWithoutExt}-copy${counter > 1 ? counter : ''}${ext}`;
            counter++;
        } while (existingNames.includes(newName));

        return newName;
    }

    // Create DOM structure
    container.innerHTML = `
        ${showFilter ? `
        <div class="fb-filter-container">
            <input type="text" class="fb-filter" placeholder="filter..." autocomplete="off" spellcheck="false">
        </div>
        ` : ''}
        <div class="fb-list"></div>
    `;

    const filterInput = container.querySelector('.fb-filter');
    const listEl = container.querySelector('.fb-list');

    // Inject styles once
    injectStyles();

    // Load directory
    async function loadDirectory(path) {
        const client = getCollabClient ? getCollabClient() : null;

        // Unwatch previous directory if watching
        if (client && watchedDirectory && watchedDirectory !== path) {
            client.unwatchDirectory(watchedDirectory);
            watchedDirectory = null;
        }

        currentPath = path;
        listEl.innerHTML = '<div class="fb-loading">loading...</div>';

        try {
            const resp = await fetch('/api/file/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, show_hidden: true }),
            });
            const data = await resp.json();

            if (data.error) {
                listEl.innerHTML = `<div class="fb-empty">${esc(data.error)}</div>`;
                return;
            }

            entries = data.entries || [];
            parentPath = (data.parent && data.parent !== data.path) ? data.parent : null;

            // Detect if this is a project folder
            isProjectFolder = entries.some(e => PROJECT_MARKERS.includes(e.name));

            // In save mode, filter to directories only
            if (mode === 'save') {
                entries = entries.filter(e => e.is_dir);
            }

            // Watch this directory for changes
            if (client && client.isConnected()) {
                attachDirectoryChangeHandler();
                client.watchDirectory(path);
                watchedDirectory = path;
            }

            // Clear filter and render
            if (filterInput) {
                filterInput.value = '';
            }
            externalFilter = '';
            selectedIndex = 0;
            render();

            onNavigate(currentPath, isProjectFolder);

        } catch (err) {
            listEl.innerHTML = `<div class="fb-empty">Error: ${esc(err.message)}</div>`;
        }
    }

    // Render the list
    function render() {
        const filter = filterInput?.value.trim() || externalFilter;
        let html = '';

        // "Open as Project" button
        if (showProjectButton && isProjectFolder && !filter) {
            html += `<button class="fb-project-btn" data-action="open-project">Open as Project</button>`;
        }

        // Parent directory link
        if (parentPath) {
            const isSelected = !filter && selectedIndex === 0;
            html += `
                <div class="fb-item fb-parent ${isSelected ? 'selected' : ''}" data-path="${esc(parentPath)}" data-is-dir="true" data-idx="-1">
                    <span class="fb-icon">&lt;</span>
                    <span class="fb-name">..</span>
                </div>
            `;
        }

        // Apply onBeforeRender transformation if provided
        let renderEntries = entries;
        if (onBeforeRender) {
            renderEntries = onBeforeRender(entries, currentPath);
        }

        // Filter and score entries
        if (filter) {
            filteredEntries = [];
            for (const entry of renderEntries) {
                const match = fuzzyMatch(entry.name, filter);
                if (match) {
                    filteredEntries.push({ entry, ...match });
                }
            }
            filteredEntries.sort((a, b) => b.score - a.score);
        } else {
            filteredEntries = renderEntries.map(entry => ({ entry, score: 0, indices: [] }));
        }

        // Clamp selection
        const maxIdx = filteredEntries.length - 1;
        if (selectedIndex > maxIdx) selectedIndex = Math.max(0, maxIdx);

        // Render entries (with section header support)
        let currentSection = null;
        filteredEntries.forEach((item, idx) => {
            const entry = item.entry;

            // Render section header if this entry starts a new section
            if (entry.sectionHeader && entry.sectionHeader !== currentSection) {
                currentSection = entry.sectionHeader;
                html += `<div class="fb-section-header">${esc(currentSection)}</div>`;
            }

            const icon = getFileIcon(entry);
            const classes = ['fb-item'];
            if (entry.is_dir) classes.push('fb-dir');
            if (entry.ext === '.md' || entry.ext === '.markdown') classes.push('fb-md');
            if (idx === selectedIndex) classes.push('selected');
            if (entry.path === activeFilePath) classes.push('active');
            if (entry.isRecentProject) classes.push('fb-recent-project');

            // Highlight matches
            let nameHtml;
            if (filter && item.indices.length > 0) {
                nameHtml = highlightMatches(entry.name, item.indices);
            } else {
                nameHtml = esc(entry.name);
            }

            // Show location hint for recent projects
            const locationHtml = entry.locationHint
                ? `<span class="fb-location">${esc(entry.locationHint)}</span>`
                : '';

            html += `
                <div class="${classes.join(' ')}" data-path="${esc(entry.path)}" data-is-dir="${entry.is_dir}" data-idx="${idx}">
                    <span class="fb-icon">${icon}</span>
                    <span class="fb-name">${nameHtml}</span>
                    ${locationHtml}
                </div>
            `;
        });

        if (filteredEntries.length === 0 && filter) {
            html += '<div class="fb-empty">No matches</div>';
        }

        listEl.innerHTML = html;

        // Bind click handlers
        listEl.querySelectorAll('.fb-item').forEach(el => {
            el.addEventListener('click', () => handleItemClick(el));

            // Right-click context menu on item
            el.addEventListener('contextmenu', (e) => {
                const path = el.dataset.path;
                const isDir = el.dataset.isDir === 'true';
                const name = path.split('/').pop();
                showContextMenu(e, path, name, isDir, false, el);
            });

            // Drag start - make items draggable
            el.draggable = true;
            el.addEventListener('dragstart', (e) => {
                const path = el.dataset.path;
                const isDir = el.dataset.isDir === 'true';
                const name = path.split('/').pop();
                draggedItem = { path, name, isDir };
                el.classList.add('fb-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', path);
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('fb-dragging');
                draggedItem = null;
                listEl.querySelectorAll('.fb-drop-target').forEach(t => t.classList.remove('fb-drop-target'));
            });

            // Drop on folders
            if (el.dataset.isDir === 'true') {
                el.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Don't allow dropping on self or parent dir
                    if (draggedItem && draggedItem.path !== el.dataset.path) {
                        e.dataTransfer.dropEffect = 'move';
                        el.classList.add('fb-drop-target');
                    }
                });

                el.addEventListener('dragleave', (e) => {
                    el.classList.remove('fb-drop-target');
                });

                el.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    el.classList.remove('fb-drop-target');

                    const destDir = el.dataset.path;

                    // Handle internal drag (moving files)
                    if (draggedItem && draggedItem.path !== destDir) {
                        const destPath = destDir + '/' + draggedItem.name;
                        try {
                            const result = await moveFile(draggedItem.path, destPath);
                            if (result.error) {
                                console.error('Move failed:', result.error);
                            } else {
                                loadDirectory(currentPath);
                            }
                        } catch (err) {
                            console.error('Move failed:', err);
                        }
                        draggedItem = null;
                        return;
                    }

                    // Handle OS file drop
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                        try {
                            const result = await uploadFiles(files, destDir);
                            if (result.error) {
                                console.error('Upload failed:', result.error);
                            } else {
                                loadDirectory(currentPath);
                                if (onFilesUploaded) onFilesUploaded(result.files);
                            }
                        } catch (err) {
                            console.error('Upload failed:', err);
                        }
                    }
                });
            }
        });

        // Project button handler
        const projectBtn = listEl.querySelector('.fb-project-btn');
        if (projectBtn) {
            projectBtn.addEventListener('click', () => onOpenProject(currentPath));
        }

        // Scroll selected into view
        const selectedEl = listEl.querySelector('.fb-item.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    // Set up list-level event handlers (once, not on each render)
    let listHandlersAttached = false;
    function attachListHandlers() {
        if (listHandlersAttached) return;
        listHandlersAttached = true;

        // Double-click on empty area to create new file
        listEl.addEventListener('dblclick', (e) => {
            if (e.target === listEl || e.target.classList.contains('fb-empty')) {
                showInlineEdit('file');
            }
        });

        // Right-click on empty area
        listEl.addEventListener('contextmenu', (e) => {
            // Only trigger if clicking on the list background, not on an item
            if (e.target === listEl || e.target.classList.contains('fb-empty')) {
                showContextMenu(e, null, null, false, true);
            }
        });

        // Drag over list (for OS file drop and internal drag)
        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();  // Always prevent default to allow drop
            if (!draggedItem && e.dataTransfer.types.includes('Files')) {
                e.dataTransfer.dropEffect = 'copy';
                listEl.classList.add('fb-drop-zone');
            } else if (draggedItem) {
                e.dataTransfer.dropEffect = 'move';
            }
        });

        listEl.addEventListener('dragleave', (e) => {
            // Only remove if leaving the list entirely
            if (!listEl.contains(e.relatedTarget)) {
                listEl.classList.remove('fb-drop-zone');
            }
        });

        // Drop on list (OS files to current directory)
        listEl.addEventListener('drop', async (e) => {
            e.preventDefault();  // Always prevent default to stop browser from opening file
            listEl.classList.remove('fb-drop-zone');

            // Skip if dropping on a folder item (handled by item drop handler)
            if (e.target.closest('.fb-item.fb-dir')) return;

            // Handle internal drag
            if (draggedItem) {
                // Dropping on current directory - no action needed
                draggedItem = null;
                return;
            }

            // Handle OS file drop
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                try {
                    const result = await uploadFiles(files, currentPath);
                    if (result.error) {
                        console.error('Upload failed:', result.error);
                    } else {
                        loadDirectory(currentPath);
                        if (onFilesUploaded) onFilesUploaded(result.files);
                    }
                } catch (err) {
                    console.error('Upload failed:', err);
                }
            }
        });
    }

    // Handle item click
    function handleItemClick(el) {
        const path = el.dataset.path;
        const isDir = el.dataset.isDir === 'true';

        if (isDir) {
            loadDirectory(path);
        } else {
            onSelect(path, false);
        }
    }

    // Select current item
    function selectCurrent() {
        const item = filteredEntries[selectedIndex];
        if (item) {
            if (item.entry.is_dir) {
                loadDirectory(item.entry.path);
            } else {
                onSelect(item.entry.path, false);
            }
        } else if (parentPath && filteredEntries.length === 0) {
            // No results, go to parent
            loadDirectory(parentPath);
        }
    }

    // Handle keyboard navigation
    function handleKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < filteredEntries.length - 1) {
                selectedIndex++;
                render();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                render();
            } else if (parentPath && !filterInput?.value) {
                // At top with no filter, go to parent
                loadDirectory(parentPath);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            selectCurrent();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (filterInput?.value || externalFilter) {
                if (filterInput) filterInput.value = '';
                externalFilter = '';
                selectedIndex = 0;
                render();
            } else {
                onCancel();
            }
        } else if (e.key === 'Backspace' && !filterInput?.value && !externalFilter && parentPath) {
            e.preventDefault();
            loadDirectory(parentPath);
        } else if (e.key === 'Tab') {
            // Let Tab propagate for modal usage
        }
    }

    // Filter input handlers
    if (filterInput) {
        filterInput.addEventListener('input', () => {
            selectedIndex = 0;
            render();
        });
        filterInput.addEventListener('keydown', handleKeydown);
    }

    // API
    const api = {
        loadDirectory,
        getCurrentPath: () => currentPath,
        getEntries: () => entries,
        getFilteredEntries: () => filteredEntries,
        getSelectedIndex: () => selectedIndex,
        isProjectFolder: () => isProjectFolder,
        focus: () => filterInput?.focus(),
        setFilter: (text) => {
            if (filterInput) {
                filterInput.value = text;
            } else {
                externalFilter = text.trim();
            }
            selectedIndex = 0;
            render();
        },
        setActiveFile: (path) => {
            activeFilePath = path;
            render();
        },
        getActiveFile: () => activeFilePath,
        refresh: () => loadDirectory(currentPath),
        setRoot: (path) => {
            currentPath = path;
            loadDirectory(path);
        },
        handleKeydown,
        destroy: () => {
            // Cleanup: unwatch directory
            const client = getCollabClient ? getCollabClient() : null;
            if (client && watchedDirectory) {
                client.unwatchDirectory(watchedDirectory);
                watchedDirectory = null;
            }
            hideContextMenu();
        },
    };

    // Attach list-level handlers (once)
    attachListHandlers();

    // Initial load
    loadDirectory(initialPath);

    return api;
}

// Inject component styles once
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    if (document.getElementById('file-browser-styles')) {
        stylesInjected = true;
        return;
    }

    const style = document.createElement('style');
    style.id = 'file-browser-styles';
    style.textContent = `
        .fb-filter-container {
            padding: 4px 8px 8px 8px;
        }
        .fb-filter {
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
        .fb-filter:focus {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .fb-filter::placeholder {
            color: var(--muted);
            opacity: 0.5;
        }
        .fb-list {
            flex: 1;
            overflow-y: auto;
            padding: 0 0 8px 0;
        }
        .fb-item {
            display: flex;
            align-items: center;
            padding: 5px 12px;
            margin: 0 8px;
            cursor: pointer;
            font-size: 12px;
            color: var(--muted);
            border-radius: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .fb-item:hover {
            background: rgba(255, 255, 255, 0.04);
            color: var(--text);
        }
        .fb-item.selected {
            background: rgba(100, 150, 255, 0.12);
            color: var(--text);
        }
        .fb-item.active {
            color: var(--text);
            font-weight: 500;
        }
        .fb-item.active .fb-icon {
            color: #7aa2f7;
            opacity: 1;
        }
        .fb-item.fb-dir {
            color: var(--text);
        }
        .fb-item.fb-md .fb-name {
            color: var(--text);
        }
        .fb-item.fb-parent {
            opacity: 0.7;
        }
        .fb-icon {
            width: 18px;
            margin-right: 8px;
            font-size: 10px;
            opacity: 0.5;
            flex-shrink: 0;
            text-align: center;
            font-family: 'SF Mono', 'Consolas', monospace;
        }
        .fb-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .fb-match {
            color: #7aa2f7;
            font-weight: 500;
        }
        .fb-empty, .fb-loading {
            padding: 20px;
            text-align: center;
            color: var(--muted);
            font-size: 11px;
            opacity: 0.5;
        }
        .fb-project-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 4px 8px 8px 8px;
            padding: 8px 12px;
            background: rgba(122, 162, 247, 0.1);
            border: 1px solid rgba(122, 162, 247, 0.2);
            border-radius: 4px;
            color: #7aa2f7;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .fb-project-btn:hover {
            background: rgba(122, 162, 247, 0.18);
            border-color: rgba(122, 162, 247, 0.3);
        }
        /* Context Menu */
        .fb-context-menu {
            position: fixed;
            background: var(--bg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 4px;
            min-width: 140px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 9999;
            font-size: 12px;
        }
        .fb-context-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 4px;
            cursor: pointer;
            color: var(--text);
            transition: background 0.1s ease;
        }
        .fb-context-item:hover {
            background: rgba(255, 255, 255, 0.06);
        }
        .fb-context-item.danger {
            color: #f7768e;
        }
        .fb-context-item.danger:hover {
            background: rgba(247, 118, 142, 0.1);
        }
        .fb-context-icon {
            width: 14px;
            text-align: center;
            opacity: 0.7;
            font-size: 11px;
        }
        .fb-context-separator {
            height: 1px;
            background: rgba(255, 255, 255, 0.06);
            margin: 4px 0;
        }
        /* Inline editing */
        .fb-inline-edit {
            background: rgba(100, 150, 255, 0.08);
        }
        .fb-inline-input {
            flex: 1;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(122, 162, 247, 0.4);
            border-radius: 3px;
            padding: 2px 6px;
            color: var(--text);
            font-size: 12px;
            font-family: inherit;
            outline: none;
            min-width: 0;
        }
        .fb-inline-input:focus {
            border-color: rgba(122, 162, 247, 0.7);
            background: rgba(255, 255, 255, 0.08);
        }
        /* Drag and drop */
        .fb-item.fb-dragging {
            opacity: 0.4;
        }
        .fb-item.fb-drop-target {
            background: rgba(122, 162, 247, 0.2);
            outline: 1px dashed rgba(122, 162, 247, 0.5);
        }
        .fb-list.fb-drop-zone {
            background: rgba(122, 162, 247, 0.05);
            outline: 2px dashed rgba(122, 162, 247, 0.3);
            outline-offset: -4px;
        }
        /* Section headers for grouped entries */
        .fb-section-header {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--muted);
            opacity: 0.6;
            padding: 12px 16px 4px 16px;
            font-weight: 500;
        }
        .fb-section-header:not(:first-child) {
            margin-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 12px;
        }
        /* Location hint for recent projects */
        .fb-location {
            font-size: 10px;
            color: var(--muted);
            opacity: 0.5;
            margin-left: auto;
            padding-left: 8px;
            flex-shrink: 0;
        }
        /* Recent project styling */
        .fb-item.fb-recent-project {
            color: var(--text);
        }
        .fb-item.fb-recent-project .fb-icon {
            color: #7aa2f7;
            opacity: 0.8;
        }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

// Export utilities
export { fuzzyMatch, highlightMatches, getFileIcon, esc };

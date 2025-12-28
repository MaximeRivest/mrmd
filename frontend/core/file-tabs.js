/**
 * File Tabs Component for MRMD Web Editor
 *
 * Manages multiple open files in project mode with:
 * - Tab bar with file names
 * - Modified indicator
 * - Close buttons
 * - Tab switching
 */

import * as SessionState from './session-state.js';
import { escapeHtml } from './utils.js';

// CSS styles
const styles = `
/* File Tabs Bar */
.file-tabs {
    display: flex;
    align-items: center;
    padding: 0 8px;
    background: var(--bg);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    height: 34px;
    overflow: hidden;
    gap: 2px;
    flex-shrink: 0;
    min-width: 0; /* Allow flex item to shrink below content size */
    max-width: 100%;
}

/* Tab Context Menu */
.tab-context-menu {
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
.tab-context-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text);
    transition: background 0.1s ease;
}
.tab-context-item:hover {
    background: rgba(255, 255, 255, 0.06);
}
.tab-context-item.danger {
    color: #f7768e;
}
.tab-context-item.danger:hover {
    background: rgba(247, 118, 142, 0.1);
}
.tab-context-icon {
    width: 14px;
    text-align: center;
    opacity: 0.7;
    font-size: 11px;
}
.tab-context-separator {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 0;
}
/* Scrollbar for tabs container */
.file-tabs-scroll::-webkit-scrollbar {
    height: 3px;
}
.file-tabs-scroll::-webkit-scrollbar-track {
    background: transparent;
}
.file-tabs-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 2px;
}

/* Hide file tabs when no project */
.file-tabs.hidden {
    display: none;
}

/* Individual Tab */
.file-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    padding-right: 4px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    font-size: 12px;
    color: var(--muted);
    transition: all 0.1s ease;
    max-width: 160px;
}
.file-tab:hover {
    background: rgba(255, 255, 255, 0.04);
    color: var(--text);
}
.file-tab.active {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
}
.file-tab.modified .tab-name::after {
    content: '●';
    margin-left: 4px;
    color: var(--accent);
    font-size: 10px;
}
/* Running execution indicator */
.file-tab.running .tab-icon::before {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    background: var(--accent, #7aa2f7);
    border-radius: 50%;
    animation: tab-pulse 1.5s ease-in-out infinite;
    margin-left: -2px;
    margin-top: -2px;
}
.file-tab .tab-icon {
    position: relative;
    font-size: 11px;
    opacity: 0.6;
    flex-shrink: 0;
}
.file-tab .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
}
.file-tab .tab-close {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    opacity: 0;
    transition: all 0.1s ease;
    flex-shrink: 0;
}
.file-tab:hover .tab-close,
.file-tab.active .tab-close {
    opacity: 0.6;
}
.file-tab .tab-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
    opacity: 1;
}

/* Pulse animation for running indicator */
@keyframes tab-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
}

/* Add tab button */
.file-tabs-add {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    margin-left: 4px;
    flex-shrink: 0;
}
.file-tabs-add:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
}

/* Project header in tabs */
.file-tabs-project {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    margin-right: 8px;
    background: rgba(122, 162, 247, 0.1);
    border-radius: 4px;
    font-size: 11px;
    color: #7aa2f7;
    cursor: pointer;
    flex-shrink: 0;
}
.file-tabs-project:hover {
    background: rgba(122, 162, 247, 0.15);
}
.file-tabs-project .project-icon {
    font-size: 12px;
}
.file-tabs-project .project-name {
    font-weight: 500;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;

// Inject styles
let stylesInjected = false;
function injectStyles() {
    if (stylesInjected) return;
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
    stylesInjected = true;
}

/**
 * Create file tabs component
 *
 * @param {Object} options
 * @param {Function} options.onTabSelect - Called when tab is clicked: (path) => void
 * @param {Function} options.onTabClose - Called when tab close is clicked: (path) => void
 * @param {Function} options.onBeforeClose - Called before closing to save: async (path) => void
 * @param {Function} options.onNewFile - Called when add button is clicked
 * @param {Function} options.onProjectClick - Called when project indicator is clicked
 * @param {Function} options.onFileDelete - Called when delete is confirmed: (path) => void
 * @param {Function} options.onFileRename - Called when rename is confirmed: (oldPath, newPath) => void
 */
export function createFileTabs(options = {}) {
    injectStyles();

    const { onTabSelect, onTabClose, onBeforeClose, onNewFile, onProjectClick, onFileDelete, onFileRename } = options;

    // Context menu state
    let contextMenu = null;
    let contextMenuCloseHandler = null;

    function showContextMenu(e, path, fileName) {
        e.preventDefault();
        e.stopPropagation();
        hideContextMenu();

        contextMenu = document.createElement('div');
        contextMenu.className = 'tab-context-menu';
        contextMenu.innerHTML = `
            <div class="tab-context-item" data-action="close">
                <span class="tab-context-icon">×</span>
                <span>Close</span>
            </div>
            <div class="tab-context-item" data-action="close-others">
                <span class="tab-context-icon">○</span>
                <span>Close others</span>
            </div>
            <div class="tab-context-separator"></div>
            <div class="tab-context-item" data-action="copy-path">
                <span class="tab-context-icon">⌘</span>
                <span>Copy path</span>
            </div>
            <div class="tab-context-item" data-action="rename">
                <span class="tab-context-icon">✎</span>
                <span>Rename</span>
            </div>
            <div class="tab-context-separator"></div>
            <div class="tab-context-item danger" data-action="delete">
                <span class="tab-context-icon">⌫</span>
                <span>Delete file</span>
            </div>
        `;

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
                case 'close':
                    SessionState.removeOpenFile(path);
                    if (onTabClose) onTabClose(path);
                    break;
                case 'close-others':
                    const openFiles = SessionState.getOpenFiles();
                    for (const [p] of openFiles) {
                        if (p !== path) {
                            SessionState.removeOpenFile(p);
                        }
                    }
                    break;
                case 'copy-path':
                    await navigator.clipboard.writeText(path);
                    break;
                case 'rename':
                    const dir = path.substring(0, path.lastIndexOf('/') + 1);
                    const newName = prompt('Rename file:', fileName);
                    if (newName && newName !== fileName) {
                        const newPath = dir + newName;
                        if (onFileRename) onFileRename(path, newPath);
                    }
                    break;
                case 'delete':
                    if (confirm(`Delete "${fileName}"?\n\nThis cannot be undone.`)) {
                        if (onFileDelete) onFileDelete(path);
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

    const container = document.createElement('div');
    container.className = 'file-tabs hidden';

    // Project indicator (shown when project is open)
    const projectEl = document.createElement('div');
    projectEl.className = 'file-tabs-project';
    projectEl.style.display = 'none';
    projectEl.innerHTML = `
        <span class="project-icon">◆</span>
        <span class="project-name"></span>
    `;
    projectEl.addEventListener('click', () => {
        if (onProjectClick) onProjectClick();
    });
    container.appendChild(projectEl);

    // Tabs container (scrollable when many tabs)
    const tabsContainer = document.createElement('div');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.flex = '1';
    tabsContainer.style.minWidth = '0'; // Allow shrinking below content
    tabsContainer.style.overflowX = 'auto';
    tabsContainer.style.overflowY = 'hidden';
    tabsContainer.style.gap = '2px';
    tabsContainer.style.scrollbarWidth = 'thin'; // Firefox
    tabsContainer.className = 'file-tabs-scroll';

    // Convert vertical scroll to horizontal scroll when hovering over tabs
    tabsContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            tabsContainer.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    container.appendChild(tabsContainer);

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'file-tabs-add';
    addBtn.textContent = '+';
    addBtn.title = 'New file';
    addBtn.addEventListener('click', () => {
        if (onNewFile) onNewFile();
    });
    container.appendChild(addBtn);

    // State listeners
    SessionState.on('files-changed', ({ openFiles, activeFilePath }) => {
        renderTabs(tabsContainer, openFiles, activeFilePath, { onTabSelect, onTabClose, showContextMenu });
        updateVisibility(container, openFiles, projectEl, addBtn);
    });

    SessionState.on('file-modified', ({ path, modified }) => {
        const tab = tabsContainer.querySelector(`[data-path="${CSS.escape(path)}"]`);
        if (tab) {
            tab.classList.toggle('modified', modified);
        }
    });

    SessionState.on('project-opened', (project) => {
        projectEl.style.display = 'flex';
        projectEl.querySelector('.project-name').textContent = project.name;
        projectEl.querySelector('.project-icon').textContent = '◆';
        projectEl.title = project.path;
    });

    SessionState.on('project-closed', () => {
        projectEl.style.display = 'none';
    });

    // Initial render
    const openFiles = SessionState.getOpenFiles();
    const activeFilePath = SessionState.getActiveFilePath();
    const project = SessionState.getCurrentProject();

    if (project) {
        projectEl.style.display = 'flex';
        projectEl.querySelector('.project-name').textContent = project.name;
        projectEl.querySelector('.project-icon').textContent = '◆';
    }

    renderTabs(tabsContainer, openFiles, activeFilePath, { onTabSelect, onTabClose, showContextMenu });
    updateVisibility(container, openFiles, projectEl, addBtn);

    // Return API object for programmatic control
    return {
        /** The DOM container element */
        element: container,

        /**
         * Add a tab for a file (uses SessionState internally)
         * @param {string} path - File path
         * @param {string} _filename - Filename (unused, extracted from path)
         * @param {boolean} modified - Whether file is modified
         */
        addTab(path, _filename, modified = false) {
            // SessionState handles the tab rendering via events
            SessionState.addOpenFile(path, '', modified);
        },

        /**
         * Remove a tab
         * @param {string} path - File path
         */
        removeTab(path) {
            SessionState.removeOpenFile(path);
        },

        /**
         * Set the active tab
         * @param {string} path - File path
         */
        setActiveTab(path) {
            SessionState.setActiveFile(path);
        },

        /**
         * Update tab modified state
         * @param {string} path - File path
         * @param {boolean} modified - Whether file is modified
         */
        updateTabModified(path, modified) {
            // Use updateFileContent to set modified state (doesn't change content)
            const file = SessionState.getOpenFiles().get(path);
            if (file) {
                SessionState.updateFileContent(path, file.content || '', modified);
            }
        },

        /**
         * Rename a tab (close old, open new)
         * @param {string} oldPath - Old file path
         * @param {string} newPath - New file path
         * @param {string} _newFilename - New filename (unused)
         */
        renameTab(oldPath, newPath, _newFilename) {
            const fileState = SessionState.getOpenFiles().get(oldPath);
            if (fileState) {
                SessionState.removeOpenFile(oldPath);
                SessionState.addOpenFile(newPath, fileState.content || '', fileState.modified || false);
                SessionState.setActiveFile(newPath);
            }
        },

        /**
         * Update tab running state (shows spinner for executing code)
         * @param {string} path - File path
         * @param {boolean} running - Whether file has running execution
         */
        updateTabRunning(path, running) {
            const tab = tabsContainer.querySelector(`[data-path="${CSS.escape(path)}"]`);
            if (tab) {
                tab.classList.toggle('running', running);
            }
        },

        /**
         * Update running state for multiple tabs at once
         * @param {Set<string>} runningFiles - Set of file paths with running executions
         */
        updateAllRunningStates(runningFiles) {
            const tabs = tabsContainer.querySelectorAll('.file-tab');
            for (const tab of tabs) {
                const path = tab.dataset.path;
                tab.classList.toggle('running', runningFiles.has(path));
            }
        },
    };
}

function renderTabs(container, openFiles, activeFilePath, options) {
    container.innerHTML = '';

    for (const [path, fileState] of openFiles) {
        const tab = createTab(path, fileState, path === activeFilePath, options);
        container.appendChild(tab);
    }
}

function createTab(path, fileState, isActive, options) {
    const { onTabSelect, onTabClose, showContextMenu } = options;

    const tab = document.createElement('div');
    tab.className = 'file-tab' + (isActive ? ' active' : '') + (fileState.modified ? ' modified' : '');
    tab.dataset.path = path;

    const fileName = path.split('/').pop();
    const ext = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    const icon = getFileIcon(ext);

    tab.innerHTML = `
        <span class="tab-icon">${icon}</span>
        <span class="tab-name">${escapeHtml(fileName)}</span>
        <button class="tab-close" title="Close">×</button>
    `;

    tab.title = path;

    // Click to select
    tab.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close')) {
            SessionState.setActiveFile(path);
            if (onTabSelect) onTabSelect(path);
        }
    });

    // Right-click context menu
    tab.addEventListener('contextmenu', (e) => {
        if (showContextMenu) showContextMenu(e, path, fileName);
    });

    // Close button
    tab.querySelector('.tab-close').addEventListener('click', async (e) => {
        e.stopPropagation();

        // If file is modified, save it first
        if (fileState.modified && onBeforeClose) {
            await onBeforeClose(path);
        }

        SessionState.removeOpenFile(path);
        if (onTabClose) onTabClose(path);
    });

    return tab;
}

function updateVisibility(container, openFiles, projectEl, addBtn) {
    // Always show the tab bar so + button is accessible
    container.classList.remove('hidden');
}

function getFileIcon(ext) {
    switch (ext.toLowerCase()) {
        case '.md':
        case '.markdown':
            return '¶';
        case '.py':
            return 'λ';
        case '.js':
            return 'js';
        case '.ts':
            return 'ts';
        case '.json':
            return '{}';
        case '.html':
        case '.htm':
            return '‹›';
        case '.css':
            return '#';
        default:
            return '·';
    }
}


// Export for global access
window.FileTabs = {
    createFileTabs,
};

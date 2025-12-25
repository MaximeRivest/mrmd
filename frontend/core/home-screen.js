/**
 * Home Screen for MRMD
 *
 * The landing page when no document is open.
 * Design philosophy (from SaaS Vision):
 * - Notebooks first, front and center
 * - Projects second, shown small at bottom
 * - Actions hidden (keyboard shortcuts, right-click, or ask Claude)
 * - For new users: just welcome message with blinking cursor
 */

import * as SessionState from './session-state.js';
import * as ProjectExplorer from './project-explorer.js';

let containerEl = null;
let isVisible = false;
let onProjectOpen = null;
let onOpenPicker = null;
let onOpenPortal = null;

/**
 * Create the home screen element
 * @param {Object} options
 * @param {Function} options.onProjectOpen - Callback when a project is opened
 * @param {Function} options.onOpenPicker - Callback to open the quick picker
 * @param {Function} options.onOpenPortal - Callback to open the portal screen
 * @returns {HTMLElement}
 */
export function createHomeScreen(options = {}) {
    onProjectOpen = options.onProjectOpen;
    onOpenPicker = options.onOpenPicker;
    onOpenPortal = options.onOpenPortal;

    containerEl = document.createElement('div');
    containerEl.className = 'home-screen';
    containerEl.innerHTML = `
        <div class="home-screen-content">
            <main class="home-main">
                <div class="home-welcome" id="home-welcome">
                    <!-- Welcome message for new users -->
                </div>

                <div class="home-notebooks" id="home-notebooks">
                    <!-- Recent notebooks will be rendered here -->
                </div>

                <div class="home-projects" id="home-projects">
                    <!-- Projects shown small at bottom -->
                </div>
            </main>

            <footer class="home-footer">
                <span class="home-footer-project" id="home-current-project"></span>
                <span class="home-footer-spacer"></span>
                <span class="home-footer-hints" id="home-footer-hints">
                    <span class="home-hint"><kbd>N</kbd> new</span>
                    <span class="home-hint"><kbd>P</kbd> browse</span>
                </span>
                <button class="home-footer-env" id="home-current-env" title="Switch space"></button>
            </footer>
        </div>
    `;

    // Create project explorer (mounted to body, not containerEl)
    const explorerEl = ProjectExplorer.createProjectExplorer({
        onSelect: async (path, opts) => {
            hide();
            const { projectPath, createIfNotExists, ...restOpts } = opts;

            if (createIfNotExists) {
                // Create new file at the specified path
                await createNewFile(path, projectPath);
            } else {
                // Use openNotebook to handle project switching if needed
                await openNotebook(path, projectPath);
            }
        },
        onClose: () => {
            // Focus back on home screen if still visible
        },
    });
    document.body.appendChild(explorerEl);

    // Wire up event listeners
    setupEventListeners();

    // Listen for state changes
    SessionState.on('recent-projects', renderProjects);
    SessionState.on('recent-notebooks', renderNotebooks);
    SessionState.on('project-opened', handleProjectOpened);

    // Initial render
    renderWelcome();
    renderNotebooks();
    renderProjects();
    updateFooterProject();
    updateFooterEnv();
    updateFooterHints();

    return containerEl;
}

/**
 * Set up DOM event listeners
 */
function setupEventListeners() {
    // Current project click (opens project's notebooks)
    const projectLabel = containerEl.querySelector('#home-current-project');
    projectLabel?.addEventListener('click', handleProjectLabelClick);

    // Environment button click (opens portal)
    const envButton = containerEl.querySelector('#home-current-env');
    envButton?.addEventListener('click', handleEnvButtonClick);

    // Click on empty space behavior depends on state:
    // - New users (no notebooks): click anywhere to start writing
    // - Returning users: background is inert, notebooks are the click targets
    const mainContent = containerEl.querySelector('.home-main');
    mainContent?.addEventListener('click', (e) => {
        // Don't trigger if clicking on interactive elements
        if (e.target.closest('.home-notebook') ||
            e.target.closest('.home-project-card') ||
            e.target.closest('.home-footer') ||
            e.target.closest('button')) {
            return;
        }

        // Only trigger quick capture for new users (no notebooks AND no projects)
        if (isNewUser()) {
            startQuickCapture();
        }
        // For returning users: do nothing. Notebooks are the interface.
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);
}

/**
 * Check if this is a new user (no notebooks AND no projects)
 * Centralized check to ensure consistent behavior across all interactions
 */
function isNewUser() {
    const notebooks = SessionState.getRecentNotebooks();
    const projects = SessionState.getRecentProjects();
    return notebooks.length === 0 && projects.length === 0;
}

/**
 * Render welcome message for new users
 */
function renderWelcome() {
    const container = containerEl?.querySelector('#home-welcome');
    if (!container) return;

    // Only show welcome for new users (no notebooks AND no projects)
    if (!isNewUser()) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = `
        <div class="home-welcome-text">
            <p>Welcome.</p>
            <p>This is your space. Start writing.</p>
            <p class="home-welcome-cursor">_</p>
        </div>
    `;

    // Click anywhere in welcome to create new notebook
    container.addEventListener('click', handleNewNotebook);
}

/**
 * Render projects list (shown small at bottom)
 */
function renderProjects() {
    const container = containerEl?.querySelector('#home-projects');
    if (!container) return;

    const projects = SessionState.getRecentProjects();
    const currentProject = SessionState.getCurrentProject();

    if (projects.length === 0 && !currentProject) {
        container.innerHTML = '';
        return;
    }

    // Combine current project with recent, avoiding duplicates
    let allProjects;
    if (currentProject) {
        const recentMatch = projects.find(p => p.path === currentProject.path);
        const enrichedCurrent = recentMatch
            ? { ...currentProject, notebook_count: recentMatch.notebook_count }
            : currentProject;
        allProjects = [enrichedCurrent, ...projects.filter(p => p.path !== currentProject.path)];
    } else {
        allProjects = projects;
    }

    // Projects shown small at bottom (per vision doc)
    container.innerHTML = `
        <div class="home-projects-row">
            ${allProjects.slice(0, 6).map((project, index) => {
                const notebookCount = project.notebook_count || 0;
                const countText = notebookCount === 1 ? '1 notebook'
                    : notebookCount > 1 ? `${notebookCount} notebooks`
                    : '';

                return `
                    <button class="home-project-card" data-path="${escapeHtml(project.path)}" data-index="${index}">
                        <span class="home-project-name">${escapeHtml(project.name)}</span>
                        ${countText ? `<span class="home-project-count">${escapeHtml(countText)}</span>` : ''}
                    </button>
                `;
            }).join('')}
        </div>
    `;

    // Add click handlers - show project's notebooks (per vision doc)
    container.querySelectorAll('.home-project-card').forEach(card => {
        card.addEventListener('click', () => {
            const path = card.dataset.path;
            const name = card.querySelector('.home-project-name')?.textContent || '';
            showProjectView(path, name);
        });
    });

    // Update footer project label
    updateFooterProject();
}

/**
 * Format timestamp in a quiet, understated way
 * No "ago" - just facts. Craft over marketing.
 */
function formatQuietTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Today: just the time
    if (diffDays === 0) {
        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        return `${diffHours}h`;
    }

    // Yesterday
    if (diffDays === 1) return 'yesterday';

    // This week: day name
    if (diffDays < 7) {
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        return days[date.getDay()];
    }

    // This month: "2 weeks" or "3 weeks"
    if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return weeks === 1 ? '1 week' : `${weeks} weeks`;
    }

    // Older: month abbreviation
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    return months[date.getMonth()];
}

/**
 * Render recent notebooks list (front and center per vision doc)
 */
function renderNotebooks() {
    const container = containerEl?.querySelector('#home-notebooks');
    if (!container) return;

    const notebooks = SessionState.getRecentNotebooks();

    if (notebooks.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Notebooks front and center - show filename, project, and when
    container.innerHTML = `
        <div class="home-notebooks-list">
            ${notebooks.slice(0, 8).map((notebook, index) => {
                // Get first line/title from overview
                const title = notebook.overview || notebook.name;
                const project = notebook.projectName || '';
                const when = formatQuietTime(notebook.timestamp);

                return `
                    <button class="home-notebook"
                            data-path="${escapeHtml(notebook.path)}"
                            data-project-path="${escapeHtml(notebook.projectPath || '')}"
                            data-index="${index}">
                        <span class="home-notebook-name">${escapeHtml(notebook.name)}</span>
                        <span class="home-notebook-title">${escapeHtml(title)}</span>
                        <span class="home-notebook-meta">
                            ${project ? `<span class="home-notebook-project">${escapeHtml(project)}</span>` : ''}
                            ${when ? `<span class="home-notebook-when">${escapeHtml(when)}</span>` : ''}
                        </span>
                    </button>
                `;
            }).join('')}
        </div>
    `;

    // Add click handlers (with guard against double-clicks)
    let isOpening = false;
    container.querySelectorAll('.home-notebook').forEach(card => {
        card.addEventListener('click', () => {
            if (isOpening) return;
            isOpening = true;

            const path = card.dataset.path;
            const projectPath = card.dataset.projectPath;
            openNotebook(path, projectPath);

            // Reset after a delay
            setTimeout(() => { isOpening = false; }, 500);
        });
    });
}

/**
 * Update footer with current project name
 */
function updateFooterProject() {
    const projectLabel = containerEl?.querySelector('#home-current-project');
    if (!projectLabel) return;

    const currentProject = SessionState.getCurrentProject();
    if (currentProject) {
        projectLabel.textContent = currentProject.name;
        projectLabel.style.cursor = 'pointer';
    } else {
        projectLabel.textContent = 'Scratch';
        projectLabel.style.cursor = 'default';
    }
}

/**
 * Update footer with current environment (Claude's Home)
 */
function updateFooterEnv() {
    const envButton = containerEl?.querySelector('#home-current-env');
    if (!envButton) return;

    const currentHome = SessionState.getCurrentHome?.();
    if (currentHome) {
        envButton.textContent = currentHome.name;
    } else {
        // Default/mock for development
        envButton.textContent = 'Workshop';
    }
}

/**
 * Update footer hints visibility based on user state
 * - New users: hide hints (the welcome message is the guide)
 * - Returning users: show hints
 */
function updateFooterHints() {
    const hintsEl = containerEl?.querySelector('#home-footer-hints');
    if (!hintsEl) return;

    hintsEl.style.display = isNewUser() ? 'none' : 'flex';
}

/**
 * Handle environment button click (opens portal)
 */
function handleEnvButtonClick() {
    if (onOpenPortal) {
        onOpenPortal();
    } else {
        SessionState.emit('portal-requested', {});
    }
}

/**
 * Create a new file at the specified path
 * @param {string} path - Full path to create the file at
 * @param {string} projectPath - Path to the project (optional)
 */
async function createNewFile(path, projectPath = null) {
    // Hide home screen immediately
    hide();

    // Extract filename for title
    const filename = path.split('/').pop();
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    const initialContent = `# ${nameWithoutExt}\n\n`;

    try {
        // Create the file with initial content
        const response = await fetch('/api/file/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path,
                content: initialContent
            })
        });

        if (!response.ok) {
            const data = await response.json();
            console.error('[HomeScreen] Failed to create file:', data.error);
            // Still try to open it - maybe it exists
        }
    } catch (err) {
        console.error('[HomeScreen] Error creating file:', err);
    }

    // Now open the file (whether creation succeeded or not)
    await openNotebook(path, projectPath);
}

/**
 * Open a notebook file, switching projects if needed
 * @param {string} path - Full path to the notebook file
 * @param {string} projectPath - Path to the notebook's project (optional, will detect if not provided)
 */
async function openNotebook(path, projectPath = null) {
    // Hide home screen immediately
    hide();

    // FAST PATH: Open the file immediately for instant feedback
    // Don't wait for project detection - user sees content right away
    SessionState.emit('file-switch-requested', { path });

    const currentProject = SessionState.getCurrentProject();

    // If no projectPath provided, detect the project from the file path (in background)
    let detectedProjectPath = projectPath;
    if (!detectedProjectPath) {
        try {
            const detected = await SessionState.detectProject(path);
            if (detected?.project_root) {
                detectedProjectPath = detected.project_root;
                console.log('[HomeScreen] Detected project from path:', detectedProjectPath);
            }
        } catch (err) {
            console.warn('[HomeScreen] Failed to detect project:', err);
        }
    }

    const needsProjectSwitch = detectedProjectPath && detectedProjectPath !== currentProject?.path;

    if (needsProjectSwitch) {
        // Switch project in background - file is already open, this just sets up the venv
        console.log('[HomeScreen] Switching project in background:', detectedProjectPath);

        // Emit that kernel is initializing so UI can show status
        SessionState.emit('kernel-initializing', {
            projectPath: detectedProjectPath,
            message: 'Switching to project environment...'
        });

        // Don't pass openFileAfter since we already opened the file
        SessionState.openProject(detectedProjectPath, true, {
            skipFileOpen: true,  // We already opened the file
        }).then(result => {
            if (!result.success) {
                console.warn('[HomeScreen] Project switch failed:', result.message);
            }
            // kernel-ready event is emitted by openProject when venv is configured
        }).catch(err => {
            console.error('[HomeScreen] Project switch error:', err);
            SessionState.emit('kernel-error', { error: err.message });
        });
    }
}

/**
 * Handle project label click (opens project's notebooks)
 */
function handleProjectLabelClick() {
    const currentProject = SessionState.getCurrentProject();
    if (currentProject) {
        showProjectView(currentProject.path, currentProject.name);
    }
}

/**
 * Show project explorer with project's files
 * Per vision doc: "Click project name in footer: [shows project's notebooks]"
 * Enhanced with fuzzy search, preview, and content search
 */
function showProjectView(projectPath, projectName) {
    ProjectExplorer.open(projectPath, projectName);
}

/**
 * Close project view overlay
 */
function closeProjectView() {
    ProjectExplorer.close();
}

/**
 * Open a notebook from project view, switching projects if needed
 * @param {string} projectPath - Path to the project containing the notebook
 * @param {string} notebookPath - Full path to the notebook file
 */
async function openNotebookFromProject(projectPath, notebookPath) {
    // Hide home screen immediately
    hide();

    // Use the same logic as openNotebook - switch projects if needed
    await openNotebook(notebookPath, projectPath);
}

/**
 * Open a project
 */
async function openProject(path) {
    try {
        await SessionState.openProject(path);
        if (onProjectOpen) {
            onProjectOpen(path);
        }
        hide();
    } catch (err) {
        console.error('[HomeScreen] Open project error:', err);
    }
}

/**
 * Handle project opened event
 */
function handleProjectOpened(data) {
    hide();
}

/**
 * Start quick capture - immediately open editor, do project setup async
 * This is the "click anywhere to start writing" behavior from the vision doc
 */
function startQuickCapture() {
    // Hide home screen IMMEDIATELY - user should see editor right away
    hide();

    // Emit quick-capture event - handler will open editor instantly,
    // then do file creation and project switching in background
    SessionState.emit('quick-capture-requested', {});
}

/**
 * Handle new notebook action (from welcome screen click or keyboard)
 */
function handleNewNotebook(initialContent = '') {
    const currentProject = SessionState.getCurrentProject();

    // For new users without a project, create in Scratch
    SessionState.emit('new-notebook-requested', {
        projectPath: currentProject?.path || null,
        initialContent: initialContent
    });
    hide();
}

/**
 * Handle global keyboard shortcuts
 *
 * Behavior differs by state:
 * - New users (no notebooks): any key creates a notebook
 * - Returning users: typing opens picker, N/Enter creates notebook
 */
function handleGlobalKeydown(e) {
    if (!isVisible) return;

    // Project explorer handles its own keyboard events
    if (ProjectExplorer.isShown()) {
        return;
    }

    // Ctrl+P / Cmd+P is handled by compact-mode.js globally
    // Don't handle it here to avoid conflicts

    // Ignore other modifier combos, navigation, function keys
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length > 1 && !['Enter', 'Backspace'].includes(e.key)) return;

    if (isNewUser()) {
        // New user: any printable character or Enter creates notebook
        if (e.key.length === 1 || e.key === 'Enter') {
            e.preventDefault();
            const initialChar = e.key === 'Enter' ? '' : e.key;
            handleNewNotebook(initialChar);
        }
    } else {
        // Returning user: N or Enter creates notebook, P opens project explorer
        if (e.key === 'n' || e.key === 'N' || e.key === 'Enter') {
            e.preventDefault();
            handleNewNotebook('');
        } else if (e.key === 'p' || e.key === 'P') {
            // P opens project explorer (the clean notebook browser)
            e.preventDefault();
            const currentProject = SessionState.getCurrentProject();
            if (currentProject) {
                showProjectView(currentProject.path, currentProject.name);
            }
        }
        // Other keys do nothing - no accidental actions
    }
}

/**
 * Show the home screen
 */
export function show() {
    if (!containerEl) return;

    containerEl.classList.add('visible');
    isVisible = true;

    // Clean up empty untitled notebooks in background
    cleanupEmptyUntitledNotebooks();

    renderWelcome();
    renderNotebooks();
    renderProjects();
    updateFooterProject();
    updateFooterEnv();
    updateFooterHints();

    SessionState.emit('home-screen-shown', {});
}

/**
 * Check if a filename looks like an untitled/default name
 * Matches: untitled.md, Untitled-123.md, Untitled-1703345678901.md, untitled1.md
 */
function isUntitledFilename(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    // Match: untitled.md, untitled123.md, untitled-123.md, untitled-timestamp.md
    return /^untitled(-?\d*)\.md$/.test(lower);
}

/**
 * Check if a notebook is empty (blank or just default template)
 */
function isEmptyNotebook(content) {
    const trimmed = (content || '').trim();
    return trimmed === '' ||
           trimmed === '# Untitled' ||
           /^#\s*Untitled\s*$/.test(trimmed) ||
           /^#\s*Untitled\s*\n\s*```\w*\s*\n*```\s*$/.test(trimmed);
}

/**
 * Clean up empty untitled notebooks from all projects
 * Called when home screen is shown to keep things tidy
 */
async function cleanupEmptyUntitledNotebooks() {
    console.log('[HomeScreen] Starting cleanup of empty untitled notebooks...');
    let deletedCount = 0;

    try {
        // First, check open tabs for empty untitled notebooks and close them
        const openFiles = SessionState.getOpenFiles();
        const tabsToClose = [];

        for (const [filePath, fileData] of openFiles.entries()) {
            const filename = filePath.split('/').pop();
            if (isUntitledFilename(filename) && isEmptyNotebook(fileData.content)) {
                tabsToClose.push(filePath);
            }
        }

        // Close empty tabs
        for (const filePath of tabsToClose) {
            SessionState.removeOpenFile(filePath);
            console.log('[HomeScreen] Closed empty tab:', filePath);
        }

        // Check recent notebooks for untitled files - this is more reliable
        // than scanning project directories since we know these files exist
        const recentNotebooks = SessionState.getRecentNotebooks() || [];
        const untitledNotebooks = recentNotebooks.filter(nb =>
            nb.path && isUntitledFilename(nb.path.split('/').pop())
        );

        console.log('[HomeScreen] Found', untitledNotebooks.length, 'untitled notebooks in recent list');

        for (const notebook of untitledNotebooks) {
            const filePath = notebook.path;
            const filename = filePath.split('/').pop();

            // Read the file to check if it's empty
            try {
                const readResponse = await fetch('/api/file/read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath })
                });

                if (!readResponse.ok) {
                    // File might not exist anymore - remove from recent
                    console.log('[HomeScreen] File not found, removing from recent:', filePath);
                    SessionState.removeRecentNotebook(filePath);
                    deletedCount++;
                    continue;
                }

                const fileData = await readResponse.json();
                const isEmpty = isEmptyNotebook(fileData.content);

                console.log('[HomeScreen] Checking:', filename, 'empty?', isEmpty, 'content:', JSON.stringify(fileData.content?.substring(0, 50)));

                if (isEmpty) {
                    // Close tab if open
                    if (openFiles.has(filePath)) {
                        SessionState.removeOpenFile(filePath);
                        console.log('[HomeScreen] Closed tab:', filePath);
                    }

                    // Delete the file
                    const deleteResponse = await fetch('/api/file/delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: filePath })
                    });

                    if (deleteResponse.ok) {
                        SessionState.removeRecentNotebook(filePath);
                        console.log('[HomeScreen] Deleted empty notebook:', filePath);
                        deletedCount++;
                    } else {
                        console.warn('[HomeScreen] Failed to delete:', filePath);
                    }
                }
            } catch (err) {
                console.warn('[HomeScreen] Error checking notebook:', filePath, err);
            }
        }

        // If we deleted anything, refresh the notebooks list and re-render
        if (deletedCount > 0) {
            console.log('[HomeScreen] Cleaned up', deletedCount, 'notebooks, refreshing...');
            await SessionState.fetchRecentNotebooks();
            renderNotebooks();
        }
    } catch (err) {
        console.warn('[HomeScreen] Error cleaning up untitled notebooks:', err);
    }
}

/**
 * Clean up empty untitled notebooks from a specific project
 * @returns {number} Number of files deleted
 */
async function cleanupProjectUntitledNotebooks(projectPath) {
    let deletedCount = 0;

    try {
        // List files in project root
        const response = await fetch('/api/file/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: projectPath })
        });

        if (!response.ok) {
            console.log('[HomeScreen] Failed to list project:', projectPath);
            return 0;
        }
        const data = await response.json();
        if (!data.entries) return 0;

        // Find untitled .md files
        const untitledFiles = data.entries.filter(entry =>
            entry.type === 'file' &&
            entry.name.endsWith('.md') &&
            isUntitledFilename(entry.name)
        );

        console.log('[HomeScreen] Found', untitledFiles.length, 'untitled files in', projectPath);

        // Check each one and delete if empty
        for (const file of untitledFiles) {
            const filePath = `${projectPath}/${file.name}`;

            // Read the file to check if it's empty
            const readResponse = await fetch('/api/file/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath })
            });

            if (!readResponse.ok) {
                console.log('[HomeScreen] Failed to read:', filePath);
                continue;
            }
            const fileData = await readResponse.json();
            const isEmpty = isEmptyNotebook(fileData.content);

            console.log('[HomeScreen] Checking:', file.name, 'empty?', isEmpty, 'content length:', fileData.content?.length);

            if (isEmpty) {
                // Close tab if open
                const openFiles = SessionState.getOpenFiles();
                if (openFiles.has(filePath)) {
                    SessionState.removeOpenFile(filePath);
                    console.log('[HomeScreen] Closed tab for empty notebook:', filePath);
                }

                // Delete the empty file
                const deleteResponse = await fetch('/api/file/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath })
                });

                if (deleteResponse.ok) {
                    // Remove from recent notebooks
                    SessionState.removeRecentNotebook(filePath);
                    console.log('[HomeScreen] Deleted empty notebook:', filePath);
                    deletedCount++;
                } else {
                    console.warn('[HomeScreen] Failed to delete:', filePath);
                }
            }
        }
    } catch (err) {
        console.warn('[HomeScreen] Error cleaning up project:', projectPath, err);
    }

    return deletedCount;
}

/**
 * Hide the home screen
 */
export function hide() {
    if (!containerEl) return;

    containerEl.classList.remove('visible');
    isVisible = false;

    SessionState.emit('home-screen-hidden', {});
}

/**
 * Toggle home screen visibility
 */
export function toggle() {
    if (isVisible) {
        hide();
    } else {
        show();
    }
}

/**
 * Check if home screen is visible
 */
export function isShown() {
    return isVisible;
}

/**
 * Get the container element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the home screen
 */
export function destroy() {
    document.removeEventListener('keydown', handleGlobalKeydown);

    SessionState.off('recent-projects', renderProjects);
    SessionState.off('recent-notebooks', renderNotebooks);
    SessionState.off('project-opened', handleProjectOpened);

    // Clean up project explorer
    ProjectExplorer.destroy();

    if (containerEl && containerEl.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    isVisible = false;
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

export default {
    createHomeScreen,
    show,
    hide,
    toggle,
    isShown,
    getElement,
    destroy
};

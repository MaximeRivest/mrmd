/**
 * Compact Header Component for MRMD
 *
 * Minimal floating UI with project status display.
 * Shows project name, environment status indicator, and toggle button.
 */

import * as SessionState from './session-state.js';
import * as ProjectStatus from './project-status.js';

let containerEl = null;
let toggleBtn = null;
let exitBtn = null;
let projectStatusEl = null;
let onExitClick = null;
let onMenuClick = null;
let onProjectClick = null;

// Cleanup handlers
let cleanupHandlers = [];

/**
 * Create the compact header elements
 * @param {Object} options
 * @param {Function} options.onExit - Callback when exit button clicked
 * @param {Function} options.onMenu - Callback when menu button clicked
 * @param {Function} options.onProjectClick - Callback when project status clicked
 * @returns {HTMLElement}
 */
export function createCompactHeader(options = {}) {
    onExitClick = options.onExit || (() => {});
    onMenuClick = options.onMenu || (() => {});
    onProjectClick = options.onProjectClick || (() => {});

    // Container for floating buttons and project status
    containerEl = document.createElement('div');
    containerEl.className = 'compact-floating-ui';
    containerEl.innerHTML = `
        <button class="compact-toggle-btn" title="Toggle tool rail">&equiv;</button>
        <div class="compact-project-status" title="Click to switch project">
            <span class="project-name">No project</span>
            <span class="project-status-indicator none" title="No environment"></span>
        </div>
        <button class="compact-exit-btn" title="Exit to files">&times;</button>
    `;

    toggleBtn = containerEl.querySelector('.compact-toggle-btn');
    exitBtn = containerEl.querySelector('.compact-exit-btn');
    projectStatusEl = containerEl.querySelector('.compact-project-status');

    // Event listeners
    toggleBtn.addEventListener('click', handleMenuClick);
    exitBtn.addEventListener('click', handleExitClick);
    projectStatusEl.addEventListener('click', handleProjectClick);

    // Listen for project/status changes
    const cleanup1 = SessionState.on('project-changed', updateProjectDisplay);
    const cleanup2 = SessionState.on('project-opened', handleProjectOpened);
    const cleanup3 = ProjectStatus.on('status-changed', updateStatusIndicator);
    const cleanup4 = ProjectStatus.on('viewing-mode-changed', handleViewingModeChanged);

    cleanupHandlers = [cleanup1, cleanup2, cleanup3, cleanup4];

    // Initial update
    updateProjectDisplay();
    updateStatusIndicator();

    return containerEl;
}

/**
 * Handle exit button click
 */
function handleExitClick() {
    if (onExitClick) {
        onExitClick();
    }
}

/**
 * Handle menu button click
 */
function handleMenuClick() {
    const isOpen = toggleBtn?.classList.contains('active');
    const newState = !isOpen;

    // Toggle active state on button
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', newState);
    }
    if (containerEl) {
        containerEl.classList.toggle('rail-open', newState);
    }

    // Persist state
    SessionState.setToolRailOpen(newState);

    if (onMenuClick) {
        onMenuClick();
    }
}

/**
 * Handle project status click
 */
function handleProjectClick() {
    if (onProjectClick) {
        onProjectClick();
    }
}

/**
 * Handle project opened event - clear viewing mode since we're in the active project
 */
function handleProjectOpened() {
    updateProjectDisplay();
    // Clear viewing mode when project changes
    setViewingMode(false);
}

/**
 * Handle viewing mode change from ProjectStatus
 * Shows "(viewing)" suffix when file is from a different project
 */
function handleViewingModeChanged({ viewing, fileProject }) {
    if (viewing && fileProject) {
        setViewingMode(true, fileProject.projectName);
    } else {
        setViewingMode(false);
    }
}

/**
 * Update project name display
 */
function updateProjectDisplay() {
    if (!projectStatusEl) return;

    const project = SessionState.getCurrentProject();
    const nameEl = projectStatusEl.querySelector('.project-name');

    if (nameEl) {
        if (project) {
            nameEl.textContent = project.name;
            projectStatusEl.classList.remove('no-project');
        } else {
            nameEl.textContent = 'Scratch';
            projectStatusEl.classList.add('no-project');
        }
    }
}

/**
 * Update status indicator based on environment status
 */
function updateStatusIndicator() {
    if (!projectStatusEl) return;

    const indicator = projectStatusEl.querySelector('.project-status-indicator');
    if (!indicator) return;

    const status = ProjectStatus.getStatus();

    // Remove all status classes
    indicator.classList.remove('ready', 'setting-up', 'none', 'error');

    // Add current status class and update title
    switch (status) {
        case ProjectStatus.ENV_STATUS.READY:
            indicator.classList.add('ready');
            indicator.title = 'Environment ready';
            break;
        case ProjectStatus.ENV_STATUS.SETTING_UP:
            indicator.classList.add('setting-up');
            indicator.title = 'Setting up environment...';
            break;
        case ProjectStatus.ENV_STATUS.ERROR:
            indicator.classList.add('error');
            indicator.title = `Setup failed: ${ProjectStatus.getError() || 'Unknown error'}`;
            break;
        case ProjectStatus.ENV_STATUS.NONE:
        default:
            indicator.classList.add('none');
            indicator.title = 'No Python environment';
            break;
    }
}

/**
 * Set viewing mode (when file is from different project)
 * @param {boolean} viewing - True if viewing a file from different project
 * @param {string} projectName - Name of the file's project
 */
export function setViewingMode(viewing, projectName = null) {
    if (!projectStatusEl) return;

    const nameEl = projectStatusEl.querySelector('.project-name');
    if (!nameEl) return;

    if (viewing && projectName) {
        nameEl.textContent = `${projectName} (viewing)`;
        projectStatusEl.classList.add('viewing-mode');
    } else {
        updateProjectDisplay();
        projectStatusEl.classList.remove('viewing-mode');
    }
}

/**
 * Set menu button active state (and show/hide exit button)
 * @param {boolean} active
 */
export function setMenuActive(active) {
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', active);
    }
    if (containerEl) {
        containerEl.classList.toggle('rail-open', active);
    }
}

/**
 * Set the document title manually (no-op in floating UI mode)
 * @param {string} title
 * @param {boolean} modified
 */
export function setTitle(title, modified = false) {
    // No title display in floating UI mode
}

/**
 * Get the container element
 */
export function getElement() {
    return containerEl;
}

/**
 * Destroy the compact header
 */
export function destroy() {
    // Clean up event listeners
    if (toggleBtn) {
        toggleBtn.removeEventListener('click', handleMenuClick);
    }
    if (exitBtn) {
        exitBtn.removeEventListener('click', handleExitClick);
    }
    if (projectStatusEl) {
        projectStatusEl.removeEventListener('click', handleProjectClick);
    }

    // Clean up state change listeners
    cleanupHandlers.forEach(fn => fn?.());
    cleanupHandlers = [];

    if (containerEl && containerEl.parentNode) {
        containerEl.parentNode.removeChild(containerEl);
    }

    containerEl = null;
    toggleBtn = null;
    exitBtn = null;
    projectStatusEl = null;
}

export default {
    createCompactHeader,
    setTitle,
    setMenuActive,
    setViewingMode,
    getElement,
    destroy
};

/**
 * Recent Projects Panel for MRMD Web Editor
 * Minimal style matching Files and Variables panels
 */

import * as SessionState from './session-state.js';

/**
 * Create recent projects panel
 */
export function createRecentProjectsPanel(options = {}) {
    const { onProjectOpen, onBrowseProject, onCreateProject } = options;

    const panel = document.createElement('div');
    panel.className = 'projects-panel';
    panel.innerHTML = `
        <div class="env-pane-header">
            <span class="env-pane-title">Projects</span>
            <button class="env-pane-refresh" id="projects-refresh" title="Refresh">↻</button>
        </div>
        <div class="projects-actions">
            <button class="projects-action" data-action="browse">Open...</button>
            ${window.electronAPI ? '<button class="projects-action" data-action="new-window">New Window</button>' : ''}
            <button class="projects-action" data-action="create">New</button>
        </div>
        <div class="projects-current"></div>
        <div class="projects-list"></div>
    `;

    const listEl = panel.querySelector('.projects-list');
    const currentEl = panel.querySelector('.projects-current');

    // Styles (injected once)
    if (!document.getElementById('projects-panel-styles')) {
        const style = document.createElement('style');
        style.id = 'projects-panel-styles';
        style.textContent = `
            .projects-panel {
                display: flex;
                flex-direction: column;
                height: 100%;
            }
            .projects-actions {
                display: flex;
                gap: 4px;
                padding: 0 8px 8px;
            }
            .projects-action {
                flex: 1;
                padding: 5px 8px;
                font-size: 11px;
                background: rgba(255, 255, 255, 0.04);
                border: none;
                border-radius: 4px;
                color: var(--muted);
                cursor: pointer;
            }
            .projects-action:hover {
                background: rgba(255, 255, 255, 0.08);
                color: var(--text);
            }
            .projects-current {
                padding: 0 8px;
            }
            .projects-current-item {
                padding: 8px 10px;
                background: rgba(255, 255, 255, 0.04);
                border-radius: 4px;
                margin-bottom: 8px;
            }
            .projects-current-label {
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: var(--muted);
                opacity: 0.6;
                margin-bottom: 4px;
            }
            .projects-current-name {
                font-size: 12px;
                color: var(--text);
                margin-bottom: 2px;
            }
            .projects-current-path {
                font-size: 10px;
                color: var(--muted);
                opacity: 0.7;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .projects-current-close {
                margin-top: 6px;
                padding: 4px 8px;
                font-size: 10px;
                background: transparent;
                border: none;
                color: var(--muted);
                cursor: pointer;
                opacity: 0.6;
            }
            .projects-current-close:hover {
                color: var(--text);
                opacity: 1;
            }
            .projects-list {
                flex: 1;
                overflow-y: auto;
                padding: 0 8px;
            }
            .projects-list-title {
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: var(--muted);
                opacity: 0.6;
                padding: 8px 8px 4px;
            }
            .project-item {
                display: flex;
                align-items: center;
                padding: 6px 8px;
                cursor: pointer;
                border-radius: 4px;
                margin: 1px 0;
            }
            .project-item:hover {
                background: rgba(255, 255, 255, 0.04);
            }
            .project-item-info {
                flex: 1;
                min-width: 0;
            }
            .project-item-name {
                font-size: 12px;
                color: var(--text);
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .project-item-path {
                font-size: 10px;
                color: var(--muted);
                opacity: 0.6;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .project-item-remove {
                background: none;
                border: none;
                color: var(--muted);
                font-size: 14px;
                cursor: pointer;
                opacity: 0;
                padding: 2px 6px;
            }
            .project-item:hover .project-item-remove {
                opacity: 0.4;
            }
            .project-item-remove:hover {
                opacity: 1 !important;
                color: var(--text);
            }
            .project-item-newwin {
                background: none;
                border: none;
                color: var(--muted);
                font-size: 12px;
                cursor: pointer;
                opacity: 0;
                padding: 2px 6px;
            }
            .project-item:hover .project-item-newwin {
                opacity: 0.4;
            }
            .project-item-newwin:hover {
                opacity: 1 !important;
                color: var(--accent, #7aa2f7);
            }
            .project-item.loading {
                pointer-events: none;
                opacity: 0.7;
            }
            .project-item.loading .project-item-name::after {
                content: '';
                display: inline-block;
                width: 10px;
                height: 10px;
                margin-left: 8px;
                border: 1.5px solid var(--muted);
                border-top-color: transparent;
                border-radius: 50%;
                animation: project-spin 0.8s linear infinite;
                vertical-align: middle;
            }
            @keyframes project-spin {
                to { transform: rotate(360deg); }
            }
            .projects-empty {
                padding: 24px 16px;
                text-align: center;
                color: var(--muted);
                font-size: 11px;
                opacity: 0.6;
            }
        `;
        document.head.appendChild(style);
    }

    // Actions
    panel.querySelector('[data-action="browse"]').addEventListener('click', async () => {
        if (onBrowseProject) {
            onBrowseProject();
        } else if (window.electronAPI?.selectFolder) {
            // Use native Electron folder picker
            const path = await window.electronAPI.selectFolder();
            if (path) SessionState.openProject(path);
        } else {
            // Fallback for web browser
            const path = prompt('Project folder path:');
            if (path) SessionState.openProject(path);
        }
    });

    panel.querySelector('[data-action="create"]').addEventListener('click', () => {
        if (onCreateProject) {
            onCreateProject();
        } else {
            showNewProjectDialog();
        }
    });

    // New Window button (Electron only)
    panel.querySelector('[data-action="new-window"]')?.addEventListener('click', async () => {
        if (window.electronAPI?.selectFolder && window.electronAPI?.openProjectWindow) {
            const path = await window.electronAPI.selectFolder();
            if (path) {
                await window.electronAPI.openProjectWindow(path);
            }
        }
    });

    panel.querySelector('#projects-refresh').addEventListener('click', () => {
        SessionState.loadRecentProjects();
    });

    function render() {
        const projects = SessionState.getRecentProjects();
        const current = SessionState.getCurrentProject();

        // Current project
        if (current) {
            currentEl.innerHTML = `
                <div class="projects-current-item">
                    <div class="projects-current-label">current</div>
                    <div class="projects-current-name">${esc(current.name)}</div>
                    <div class="projects-current-path">${esc(current.path)}</div>
                    <button class="projects-current-close">close</button>
                </div>
            `;
            currentEl.querySelector('.projects-current-close').addEventListener('click', () => {
                SessionState.closeProject();
            });
        } else {
            currentEl.innerHTML = '';
        }

        // Recent list
        const filtered = projects.filter(p => p.path !== current?.path);

        if (filtered.length === 0 && !current) {
            listEl.innerHTML = '<div class="projects-empty">No recent projects</div>';
            return;
        }

        if (filtered.length === 0) {
            listEl.innerHTML = '';
            return;
        }

        listEl.innerHTML = `
            <div class="projects-list-title">recent</div>
            ${filtered.map(p => `
                <div class="project-item" data-path="${esc(p.path)}">
                    <div class="project-item-info">
                        <div class="project-item-name">${esc(p.name)}</div>
                        <div class="project-item-path">${esc(shortenPath(p.path))}</div>
                    </div>
                    ${window.electronAPI ? '<button class="project-item-newwin" title="Open in New Window">⧉</button>' : ''}
                    <button class="project-item-remove" title="Remove">×</button>
                </div>
            `).join('')}
        `;

        listEl.querySelectorAll('.project-item').forEach(el => {
            const path = el.dataset.path;

            el.addEventListener('click', async (e) => {
                if (e.target.classList.contains('project-item-remove')) return;
                if (el.classList.contains('loading')) return;
                el.classList.add('loading');
                try {
                    await SessionState.openProject(path);
                    if (onProjectOpen) onProjectOpen(path);
                } finally {
                    el.classList.remove('loading');
                }
            });

            el.querySelector('.project-item-remove').addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch('/api/mrmd/recent-projects', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path }),
                });
                await SessionState.loadRecentProjects();
            });

            // Open in new window button (Electron only)
            el.querySelector('.project-item-newwin')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (window.electronAPI?.openProjectWindow) {
                    await window.electronAPI.openProjectWindow(path);
                }
            });
        });
    }

    SessionState.on('recent-projects', render);
    SessionState.on('project-opened', render);
    SessionState.on('project-closed', render);

    render();
    return panel;
}

/**
 * Show new project dialog with template selection
 */
function showNewProjectDialog() {
    // Inject styles if needed
    if (!document.getElementById('new-project-dialog-styles')) {
        const style = document.createElement('style');
        style.id = 'new-project-dialog-styles';
        style.textContent = `
            .new-project-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                z-index: 2000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .new-project-dialog {
                background: var(--bg);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 24px;
                width: 420px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }
            .new-project-title {
                font-size: 16px;
                font-weight: 600;
                color: var(--text);
                margin-bottom: 16px;
            }
            .new-project-field {
                margin-bottom: 16px;
            }
            .new-project-label {
                display: block;
                font-size: 11px;
                color: var(--muted);
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .new-project-input {
                width: 100%;
                padding: 10px 12px;
                font-size: 13px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: var(--text);
                box-sizing: border-box;
            }
            .new-project-input:focus {
                outline: none;
                border-color: var(--accent, #7aa2f7);
            }
            .new-project-templates {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            .new-project-template {
                display: flex;
                align-items: flex-start;
                padding: 12px;
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .new-project-template:hover {
                background: rgba(255, 255, 255, 0.04);
                border-color: rgba(255, 255, 255, 0.15);
            }
            .new-project-template.selected {
                background: rgba(122, 162, 247, 0.1);
                border-color: rgba(122, 162, 247, 0.4);
            }
            .new-project-template-radio {
                margin-right: 12px;
                margin-top: 2px;
            }
            .new-project-template-info {
                flex: 1;
            }
            .new-project-template-name {
                font-size: 13px;
                font-weight: 500;
                color: var(--text);
                margin-bottom: 3px;
            }
            .new-project-template-desc {
                font-size: 11px;
                color: var(--muted);
                line-height: 1.4;
            }
            .new-project-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 20px;
            }
            .new-project-btn {
                padding: 8px 16px;
                font-size: 12px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .new-project-btn.cancel {
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: var(--muted);
            }
            .new-project-btn.cancel:hover {
                background: rgba(255, 255, 255, 0.04);
                color: var(--text);
            }
            .new-project-btn.create {
                background: #7aa2f7;
                border: none;
                color: #1a1b26;
            }
            .new-project-btn.create:hover {
                background: #89b4fa;
            }
            .new-project-btn.create:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    const templates = [
        {
            id: 'writer',
            name: 'Writer / Academic',
            desc: 'Just write and run code. Flat structure, no pyproject.toml. Use %pip install.'
        },
        {
            id: 'analyst',
            name: 'Data Analyst',
            desc: 'Reproducible dependencies with %add. Shared code in src/utils.py, data/ folder.'
        },
        {
            id: 'pythonista',
            name: 'Pythonista',
            desc: 'Full package with src layout, tests, editable install. Ready to publish.'
        }
    ];

    const overlay = document.createElement('div');
    overlay.className = 'new-project-overlay';
    overlay.innerHTML = `
        <div class="new-project-dialog">
            <div class="new-project-title">New Project</div>
            <div class="new-project-field">
                <label class="new-project-label">Project Name</label>
                <input type="text" class="new-project-input" id="new-project-name" placeholder="my-project" autofocus>
            </div>
            <div class="new-project-field">
                <label class="new-project-label">Template</label>
                <div class="new-project-templates">
                    ${templates.map((t, i) => `
                        <label class="new-project-template${i === 1 ? ' selected' : ''}" data-template="${t.id}">
                            <input type="radio" name="template" value="${t.id}" class="new-project-template-radio"${i === 1 ? ' checked' : ''}>
                            <div class="new-project-template-info">
                                <div class="new-project-template-name">${t.name}</div>
                                <div class="new-project-template-desc">${t.desc}</div>
                            </div>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="new-project-actions">
                <button class="new-project-btn cancel">Cancel</button>
                <button class="new-project-btn create" disabled>Create</button>
            </div>
        </div>
    `;

    const nameInput = overlay.querySelector('#new-project-name');
    const createBtn = overlay.querySelector('.new-project-btn.create');
    const cancelBtn = overlay.querySelector('.new-project-btn.cancel');
    const templateLabels = overlay.querySelectorAll('.new-project-template');

    // Template selection
    templateLabels.forEach(label => {
        label.addEventListener('click', () => {
            templateLabels.forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');
        });
    });

    // Enable/disable create button based on name
    nameInput.addEventListener('input', () => {
        createBtn.disabled = !nameInput.value.trim();
    });

    // Create project
    const doCreate = async () => {
        const name = nameInput.value.trim();
        if (!name) return;

        const selectedTemplate = overlay.querySelector('input[name="template"]:checked')?.value || 'analyst';

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';

        try {
            const result = await SessionState.createProject(name, null, selectedTemplate);
            if (result.success) {
                overlay.remove();
            } else {
                alert('Failed to create project: ' + (result.message || result.error));
                createBtn.disabled = false;
                createBtn.textContent = 'Create';
            }
        } catch (err) {
            alert('Error: ' + err.message);
            createBtn.disabled = false;
            createBtn.textContent = 'Create';
        }
    };

    createBtn.addEventListener('click', doCreate);

    // Enter to create
    nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && nameInput.value.trim()) {
            doCreate();
        }
    });

    // Cancel
    cancelBtn.addEventListener('click', () => overlay.remove());

    // Escape to cancel
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Close on overlay click (not dialog)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
    nameInput.focus();
}

function shortenPath(path) {
    // Support both Linux (/home/user) and macOS (/Users/user)
    if (path.startsWith('/home/')) {
        const parts = path.split('/');
        if (parts.length > 2) {
            return '~/' + parts.slice(3).join('/');
        }
    } else if (path.startsWith('/Users/')) {
        const parts = path.split('/');
        if (parts.length > 2) {
            return '~/' + parts.slice(3).join('/');
        }
    }
    return path;
}

function esc(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

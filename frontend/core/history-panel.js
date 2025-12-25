/**
 * History Panel - Version history browser and restore UI
 *
 * Shows a timeline of file versions with:
 * - Version list with timestamps and authors
 * - Diff view between versions
 * - Restore functionality
 */

export class HistoryPanel {
    constructor(container, options = {}) {
        this.container = container;
        this.options = options;
        this.projectRoot = null;
        this.currentFile = null;
        this.versions = [];
        this.selectedVersion = null;
        this.compareVersion = null;  // For diff comparison

        this._render();
        this._bindEvents();
    }

    _render() {
        this.container.innerHTML = `
            <div class="history-panel">
                <div class="history-header">
                    <span class="history-title">Version History</span>
                    <button class="history-close" title="Close">&times;</button>
                </div>
                <div class="history-file-info">
                    <span class="history-filename">No file selected</span>
                </div>
                <div class="history-list-container">
                    <div class="history-list"></div>
                </div>
                <div class="history-actions">
                    <button class="history-btn history-restore-btn" disabled>Restore Selected</button>
                    <button class="history-btn history-diff-btn" disabled>Compare</button>
                </div>
                <div class="history-diff-container" style="display: none;">
                    <div class="history-diff-header">
                        <span class="diff-title">Changes</span>
                        <button class="diff-close">&times;</button>
                    </div>
                    <div class="history-diff-content"></div>
                </div>
            </div>
        `;

        // Cache elements
        this.listEl = this.container.querySelector('.history-list');
        this.filenameEl = this.container.querySelector('.history-filename');
        this.restoreBtn = this.container.querySelector('.history-restore-btn');
        this.diffBtn = this.container.querySelector('.history-diff-btn');
        this.diffContainer = this.container.querySelector('.history-diff-container');
        this.diffContent = this.container.querySelector('.history-diff-content');

        this._injectStyles();
    }

    _injectStyles() {
        if (document.getElementById('history-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'history-panel-styles';
        style.textContent = `
            .history-panel {
                display: flex;
                flex-direction: column;
                height: 100%;
                background: var(--code-bg, var(--bg));
                border-left: 1px solid var(--border);
                font-size: 12px;
            }
            .history-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 12px;
                border-bottom: 1px solid var(--border);
                background: var(--bg);
            }
            .history-title {
                font-weight: 600;
                color: var(--text, #fff);
            }
            .history-close {
                background: none;
                border: none;
                color: var(--muted, #888);
                font-size: 18px;
                cursor: pointer;
                padding: 0 4px;
                line-height: 1;
            }
            .history-close:hover {
                color: var(--text, #fff);
            }
            .history-file-info {
                padding: 8px 12px;
                background: color-mix(in srgb, var(--text) 3%, transparent);
                border-bottom: 1px solid var(--border);
            }
            .history-filename {
                color: var(--muted, #888);
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .history-list-container {
                flex: 1;
                overflow-y: auto;
                min-height: 0;
            }
            .history-list {
                padding: 8px 0;
            }
            .history-item {
                padding: 10px 12px;
                cursor: pointer;
                border-left: 3px solid transparent;
                transition: background 0.15s, border-color 0.15s;
            }
            .history-item:hover {
                background: color-mix(in srgb, var(--text) 5%, transparent);
            }
            .history-item.selected {
                background: color-mix(in srgb, var(--text) 8%, transparent);
                border-left-color: var(--accent, #007acc);
            }
            .history-item.compare {
                border-left-color: var(--warning, #cca700);
            }
            .history-item-time {
                font-size: 11px;
                color: var(--text, #fff);
                margin-bottom: 2px;
            }
            .history-item-meta {
                font-size: 10px;
                color: var(--muted, #888);
                display: flex;
                gap: 8px;
            }
            .history-item-author {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .history-item-author.ai {
                color: var(--accent, #007acc);
            }
            .history-item-message {
                color: var(--muted, #666);
                font-style: italic;
            }
            .history-actions {
                padding: 10px 12px;
                border-top: 1px solid var(--border, rgba(255,255,255,0.1));
                display: flex;
                gap: 8px;
            }
            .history-btn {
                flex: 1;
                padding: 6px 10px;
                background: color-mix(in srgb, var(--text) 8%, transparent);
                border: 1px solid var(--border);
                border-radius: 4px;
                color: var(--text);
                font-size: 11px;
                cursor: pointer;
                transition: background 0.15s;
            }
            .history-btn:hover:not(:disabled) {
                background: color-mix(in srgb, var(--text) 12%, transparent);
            }
            .history-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .history-restore-btn:hover:not(:disabled) {
                background: rgba(0, 122, 204, 0.3);
                border-color: var(--accent, #007acc);
            }
            .history-diff-container {
                border-top: 1px solid var(--border);
                max-height: 40%;
                display: flex;
                flex-direction: column;
            }
            .history-diff-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: var(--bg);
                border-bottom: 1px solid var(--border);
            }
            .diff-title {
                font-size: 11px;
                font-weight: 600;
            }
            .diff-close {
                background: none;
                border: none;
                color: var(--muted, #888);
                font-size: 14px;
                cursor: pointer;
                padding: 0 4px;
            }
            .history-diff-content {
                flex: 1;
                overflow: auto;
                padding: 8px;
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 11px;
                line-height: 1.5;
                white-space: pre-wrap;
                background: var(--code-bg, var(--bg));
            }
            .diff-line {
                padding: 1px 4px;
            }
            .diff-line.added {
                background: rgba(40, 167, 69, 0.2);
                color: #85e89d;
            }
            .diff-line.removed {
                background: rgba(220, 53, 69, 0.2);
                color: #f97583;
            }
            .diff-line.header {
                color: var(--accent, #007acc);
                font-weight: bold;
            }
            .diff-line.context {
                color: var(--muted, #888);
            }
            .history-empty {
                padding: 20px;
                text-align: center;
                color: var(--muted, #888);
            }
            .history-loading {
                padding: 20px;
                text-align: center;
                color: var(--muted, #888);
            }
        `;
        document.head.appendChild(style);
    }

    _bindEvents() {
        // Close button
        this.container.querySelector('.history-close').addEventListener('click', () => {
            this.hide();
        });

        // Restore button
        this.restoreBtn.addEventListener('click', () => {
            if (this.selectedVersion) {
                this._restoreVersion(this.selectedVersion);
            }
        });

        // Diff button
        this.diffBtn.addEventListener('click', () => {
            if (this.selectedVersion && this.compareVersion) {
                this._showDiff(this.compareVersion.id, this.selectedVersion.id);
            } else if (this.selectedVersion && this.versions.length > 1) {
                // Compare with previous version
                const idx = this.versions.findIndex(v => v.id === this.selectedVersion.id);
                if (idx < this.versions.length - 1) {
                    this._showDiff(this.versions[idx + 1].id, this.selectedVersion.id);
                }
            }
        });

        // Diff close
        this.container.querySelector('.diff-close').addEventListener('click', () => {
            this.diffContainer.style.display = 'none';
        });
    }

    async setFile(filePath, projectRoot) {
        this.currentFile = filePath;
        this.projectRoot = projectRoot;
        this.selectedVersion = null;
        this.compareVersion = null;

        if (!filePath) {
            this.filenameEl.textContent = 'No file selected';
            this.listEl.innerHTML = '<div class="history-empty">No file selected</div>';
            this._updateButtons();
            return;
        }

        const filename = filePath.split('/').pop();
        this.filenameEl.textContent = filename;
        this.filenameEl.title = filePath;

        await this._loadVersions();
    }

    async _loadVersions() {
        if (!this.currentFile || !this.projectRoot) return;

        this.listEl.innerHTML = '<div class="history-loading">Loading...</div>';

        try {
            const response = await fetch('/api/history/versions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_root: this.projectRoot,
                    file_path: this.currentFile,
                    limit: 50
                })
            });
            const data = await response.json();

            if (data.error) {
                this.listEl.innerHTML = `<div class="history-empty">Error: ${data.error}</div>`;
                return;
            }

            this.versions = data.versions || [];
            this._renderVersions();
        } catch (err) {
            console.error('[History] Failed to load versions:', err);
            this.listEl.innerHTML = '<div class="history-empty">Failed to load history</div>';
        }
    }

    _renderVersions() {
        if (this.versions.length === 0) {
            this.listEl.innerHTML = '<div class="history-empty">No version history yet.<br>Save the file to create the first version.</div>';
            this._updateButtons();
            return;
        }

        this.listEl.innerHTML = this.versions.map(v => {
            const date = new Date(v.timestamp * 1000);
            const timeStr = this._formatTime(date);
            const authorParts = (v.author || 'unknown').split(':');
            const authorType = authorParts[0];
            const authorName = authorParts[1] || authorType;
            const isAI = authorType === 'ai';
            const message = v.message || '';

            return `
                <div class="history-item" data-version-id="${v.id}">
                    <div class="history-item-time">${timeStr}</div>
                    <div class="history-item-meta">
                        <span class="history-item-author ${isAI ? 'ai' : ''}">
                            ${isAI ? '🤖' : '👤'} ${authorName}
                        </span>
                        ${message ? `<span class="history-item-message">${this._escapeHtml(message)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind click events
        this.listEl.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', (e) => {
                const versionId = parseInt(el.dataset.versionId);
                const version = this.versions.find(v => v.id === versionId);

                if (e.shiftKey && this.selectedVersion) {
                    // Shift+click for compare selection
                    this.compareVersion = version;
                } else {
                    this.selectedVersion = version;
                    this.compareVersion = null;
                }

                this._updateSelection();
                this._updateButtons();
            });
        });

        this._updateButtons();
    }

    _updateSelection() {
        this.listEl.querySelectorAll('.history-item').forEach(el => {
            el.classList.remove('selected', 'compare');
            const versionId = parseInt(el.dataset.versionId);
            if (this.selectedVersion && versionId === this.selectedVersion.id) {
                el.classList.add('selected');
            }
            if (this.compareVersion && versionId === this.compareVersion.id) {
                el.classList.add('compare');
            }
        });
    }

    _updateButtons() {
        this.restoreBtn.disabled = !this.selectedVersion;

        // Enable diff if we have a selection (compare with previous) or two selections
        const canDiff = this.selectedVersion && (
            this.compareVersion ||
            this.versions.findIndex(v => v.id === this.selectedVersion.id) < this.versions.length - 1
        );
        this.diffBtn.disabled = !canDiff;
    }

    async _showDiff(fromVersionId, toVersionId) {
        try {
            const response = await fetch('/api/history/diff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_root: this.projectRoot,
                    from_version: fromVersionId,
                    to_version: toVersionId
                })
            });
            const data = await response.json();

            if (data.error) {
                alert('Error loading diff: ' + data.error);
                return;
            }

            this._renderDiff(data.diff);
            this.diffContainer.style.display = 'flex';
        } catch (err) {
            console.error('[History] Failed to load diff:', err);
            alert('Failed to load diff');
        }
    }

    _renderDiff(diffText) {
        if (!diffText || diffText.trim() === '') {
            this.diffContent.innerHTML = '<div class="diff-line context">No changes</div>';
            return;
        }

        const lines = diffText.split('\n');
        this.diffContent.innerHTML = lines.map(line => {
            let className = 'context';
            if (line.startsWith('+') && !line.startsWith('+++')) {
                className = 'added';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                className = 'removed';
            } else if (line.startsWith('@@')) {
                className = 'header';
            }
            return `<div class="diff-line ${className}">${this._escapeHtml(line)}</div>`;
        }).join('');
    }

    async _restoreVersion(version) {
        if (!confirm(`Restore to version from ${this._formatTime(new Date(version.timestamp * 1000))}?\n\nThis will create a new version with the old content.`)) {
            return;
        }

        try {
            const response = await fetch('/api/history/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_root: this.projectRoot,
                    file_path: this.currentFile,
                    version_id: version.id,
                    author: 'user:editor'
                })
            });
            const data = await response.json();

            if (data.error) {
                alert('Error restoring version: ' + data.error);
                return;
            }

            // Notify parent to reload file
            if (this.options.onRestore) {
                this.options.onRestore(this.currentFile, data.content, data.new_version_id);
            }

            // Reload version list
            await this._loadVersions();

        } catch (err) {
            console.error('[History] Failed to restore:', err);
            alert('Failed to restore version');
        }
    }

    _formatTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    show() {
        this.container.style.display = 'block';
        if (this.currentFile) {
            this._loadVersions();
        }
    }

    hide() {
        this.container.style.display = 'none';
        if (this.options.onClose) {
            this.options.onClose();
        }
    }

    refresh() {
        if (this.currentFile) {
            this._loadVersions();
        }
    }
}

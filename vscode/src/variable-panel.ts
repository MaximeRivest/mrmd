/**
 * Rich Variable Explorer Panel for mrmd
 *
 * WebView-based variable explorer with RStudio-like columnar display.
 */

import * as vscode from 'vscode';

interface VariableInfo {
    name: string;
    type: string;
    kind: string;
    preview?: string;
    shape?: string;
    dtype?: string;
    size?: number;
    columns?: string[];
    keys?: string[];
    module?: string;
    expandable?: boolean;
    value?: string;
    members?: string;
    signature?: string;
    doc?: string;
    length?: number;
    memory_size?: number;
}

interface VariablesResponse {
    session_id: string;
    variables: VariableInfo[];
}

export class VariablePanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mrmd.variablePanel';

    private _view?: vscode.WebviewView;
    private _variables: VariableInfo[] = [];
    private serverUrl: () => string;
    private getSessionId: () => string;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        serverUrlGetter: () => string,
        sessionIdGetter: () => string
    ) {
        this.serverUrl = serverUrlGetter;
        this.getSessionId = sessionIdGetter;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

        // Retain context to avoid reloading issues
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh':
                    await this.refresh();
                    break;
                case 'clear':
                    vscode.commands.executeCommand('mrmd.clearVariables');
                    break;
                case 'copy':
                    await vscode.env.clipboard.writeText(data.value);
                    vscode.window.showInformationMessage(`Copied: ${data.value}`);
                    break;
                case 'insert':
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, data.value);
                        });
                    }
                    break;
                case 'view':
                    vscode.commands.executeCommand('mrmd.viewData', { path: data.path, variable: data.variable });
                    break;
                case 'expand':
                    await this.expandVariable(data.path);
                    break;
            }
        });

        // Initial refresh
        this.refresh();
    }

    public async refresh(): Promise<void> {
        try {
            const response = await fetch(`${this.serverUrl()}/api/ipython/variables`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: this.getSessionId() }),
            });

            if (response.ok) {
                const data = await response.json() as VariablesResponse;
                this._variables = data.variables || [];
            } else {
                this._variables = [];
            }
        } catch {
            this._variables = [];
        }

        this._updateView();
    }

    private async expandVariable(path: string): Promise<void> {
        try {
            const response = await fetch(`${this.serverUrl()}/api/ipython/inspect_object`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: this.getSessionId(),
                    path: path,
                }),
            });

            if (response.ok) {
                const data = await response.json() as { children?: Array<VariableInfo & { path?: string }> };
                console.log('Expanded data for', path, ':', JSON.stringify(data.children?.slice(0, 2)));
                this._view?.webview.postMessage({
                    type: 'expanded',
                    path: path,
                    children: data.children || []
                });
            }
        } catch {
            // Ignore
        }
    }

    private _updateView() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                variables: this._variables
            });
        }
    }

    public dispose() {
        // Nothing to dispose explicitly - webview lifecycle is managed by VS Code
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _getHtmlForWebview(_webview: vscode.Webview): string {
        // Simple inline HTML - no external resources needed
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Variables</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --fg-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --hover-bg: var(--vscode-list-hoverBackground);
            --header-bg: var(--vscode-sideBarSectionHeader-background);
            --type-color: var(--vscode-symbolIcon-classForeground, #4EC9B0);
            --value-color: var(--vscode-symbolIcon-stringForeground, #CE9178);
            --number-color: var(--vscode-symbolIcon-numberForeground, #B5CEA8);
            --size-color: var(--vscode-descriptionForeground);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size, 13px);
            color: var(--fg-color);
            background: var(--bg-color);
            padding: 0;
            overflow-x: auto;
        }

        .toolbar {
            display: flex;
            gap: 4px;
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color);
            background: var(--header-bg);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .toolbar button {
            background: transparent;
            border: none;
            color: var(--fg-color);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 3px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .toolbar button:hover {
            background: var(--hover-bg);
        }

        .toolbar .spacer {
            flex: 1;
        }

        .toolbar .count {
            color: var(--size-color);
            font-size: 11px;
            padding: 4px 8px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        thead {
            position: sticky;
            top: 32px;
            z-index: 50;
        }

        th {
            background: var(--header-bg);
            padding: 6px 8px;
            text-align: left;
            font-weight: 500;
            border-bottom: 1px solid var(--border-color);
            white-space: nowrap;
            user-select: none;
        }

        th.sortable {
            cursor: pointer;
        }

        th.sortable:hover {
            background: var(--hover-bg);
        }

        th .sort-icon {
            opacity: 0.5;
            margin-left: 4px;
        }

        td {
            padding: 4px 8px;
            border-bottom: 1px solid var(--border-color);
            vertical-align: middle;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        tr:hover td {
            background: var(--hover-bg);
        }

        tr.group-header td {
            background: var(--header-bg);
            font-weight: 500;
            padding: 8px;
            cursor: pointer;
        }

        tr.group-header .icon {
            margin-right: 6px;
        }

        .name-cell {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .expand-btn {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            opacity: 0.7;
            flex-shrink: 0;
        }

        .expand-btn:hover {
            opacity: 1;
        }

        .expand-btn.expanded {
            transform: rotate(90deg);
        }

        .expand-btn.placeholder {
            visibility: hidden;
        }

        .type-icon {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .type-icon.data { color: #4FC3F7; }
        .type-icon.collection { color: #FFB74D; }
        .type-icon.primitive { color: #81C784; }
        .type-icon.object { color: #BA68C8; }
        .type-icon.callable { color: #64B5F6; }

        .var-name {
            font-weight: 500;
            cursor: pointer;
        }

        .var-name:hover {
            text-decoration: underline;
        }

        .type-cell {
            color: var(--type-color);
            font-family: var(--vscode-editor-font-family);
        }

        .shape-cell {
            color: var(--number-color);
            font-family: var(--vscode-editor-font-family);
        }

        .size-cell {
            color: var(--size-color);
            text-align: right;
            font-size: 11px;
        }

        .value-cell {
            color: var(--value-color);
            font-family: var(--vscode-editor-font-family);
            max-width: 250px;
        }

        .value-cell.string { color: #CE9178; }
        .value-cell.number { color: #B5CEA8; }
        .value-cell.bool { color: #569CD6; }

        .actions-cell {
            width: 60px;
            text-align: right;
        }

        .action-btn {
            background: transparent;
            border: none;
            color: var(--fg-color);
            cursor: pointer;
            padding: 2px 4px;
            opacity: 0;
            transition: opacity 0.1s;
        }

        tr:hover .action-btn {
            opacity: 0.7;
        }

        .action-btn:hover {
            opacity: 1 !important;
        }

        .nested.nested-1 .name-cell { padding-left: 20px; }
        .nested.nested-2 .name-cell { padding-left: 40px; }
        .nested.nested-3 .name-cell { padding-left: 60px; }
        .nested.nested-4 .name-cell { padding-left: 80px; }
        .nested.nested-5 .name-cell { padding-left: 100px; }

        tr[data-parent] {
            background: rgba(255,255,255,0.02);
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--size-color);
        }

        .empty-state .icon {
            font-size: 32px;
            margin-bottom: 12px;
            opacity: 0.5;
        }

        /* Color indicators like RStudio */
        .color-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 6px;
        }

        .color-dot.data { background: #4FC3F7; }
        .color-dot.collection { background: #FFB74D; }
        .color-dot.primitive { background: #81C784; }
        .color-dot.object { background: #BA68C8; }
        .color-dot.callable { background: #64B5F6; }

        /* DataFrame special display */
        .df-info {
            font-size: 11px;
            color: var(--size-color);
        }

        .columns-preview {
            font-size: 10px;
            color: var(--size-color);
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="refresh()" title="Refresh">
            <span>↻</span> Refresh
        </button>
        <button onclick="clearVars()" title="Clear All">
            <span>🗑</span> Clear
        </button>
        <div class="spacer"></div>
        <span class="count" id="var-count">0 variables</span>
    </div>

    <table id="var-table">
        <thead>
            <tr>
                <th style="width: 30px;"></th>
                <th class="sortable" onclick="sortBy('name')">Name <span class="sort-icon">↕</span></th>
                <th class="sortable" onclick="sortBy('type')">Type</th>
                <th>Shape/Len</th>
                <th>Size</th>
                <th>Value</th>
                <th style="width: 60px;"></th>
            </tr>
        </thead>
        <tbody id="var-body">
        </tbody>
    </table>

    <div class="empty-state" id="empty-state" style="display: none;">
        <div class="icon">📊</div>
        <div>No variables yet</div>
        <div style="margin-top: 8px; font-size: 11px;">Run some Python code to see variables here</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let variables = [];
        let expandedPaths = new Set();
        let sortColumn = 'name';
        let sortAsc = true;

        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }

        function clearVars() {
            vscode.postMessage({ type: 'clear' });
        }

        function copyVar(name) {
            vscode.postMessage({ type: 'copy', value: name });
        }

        function insertVar(name) {
            vscode.postMessage({ type: 'insert', value: name });
        }

        function viewData(path, variable) {
            vscode.postMessage({ type: 'view', path: path, variable: variable });
        }

        // Store children data for expanded items
        const expandedChildren = new Map();

        function toggleExpand(path, btn) {
            if (expandedPaths.has(path)) {
                expandedPaths.delete(path);
                expandedChildren.delete(path);
                btn.classList.remove('expanded');
                // Remove child rows
                removeChildRows(path);
            } else {
                expandedPaths.add(path);
                btn.classList.add('expanded');
                vscode.postMessage({ type: 'expand', path: path });
            }
        }

        function removeChildRows(parentPath) {
            // Remove all rows that are children of this path
            const rows = document.querySelectorAll(\`tr[data-parent="\${parentPath}"]\`);
            rows.forEach(row => {
                // Recursively remove children of children
                const childPath = row.getAttribute('data-path');
                if (childPath) {
                    removeChildRows(childPath);
                    expandedPaths.delete(childPath);
                    expandedChildren.delete(childPath);
                }
                row.remove();
            });
        }

        function getDepthFromPath(path) {
            // Count dots/brackets to estimate depth
            const matches = path.match(/[\.\[]/g);
            return matches ? matches.length : 0;
        }

        function sortBy(column) {
            if (sortColumn === column) {
                sortAsc = !sortAsc;
            } else {
                sortColumn = column;
                sortAsc = true;
            }
            renderVariables();
        }

        function formatSize(bytes) {
            if (bytes === undefined || bytes === null) return '';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        function getTypeIcon(kind, type) {
            const icons = {
                'data': '⊞',
                'collection': '☰',
                'primitive': '•',
                'object': '◆',
                'callable': 'ƒ',
                'class': '◇'
            };
            return icons[kind] || '•';
        }

        function getValueClass(kind, type) {
            if (type === 'str') return 'string';
            if (['int', 'float', 'complex'].includes(type)) return 'number';
            if (type === 'bool') return 'bool';
            return '';
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function renderVariableRow(v, depth = 0, parentPath = '') {
            if (!v) return '';
            const path = v.path || v.name || '';
            const isExpanded = expandedPaths.has(path);
            const shapeOrLen = v.shape || (v.size !== undefined ? v.size : (v.length !== undefined ? v.length : ''));
            const nestClass = depth > 0 ? \`nested nested-\${Math.min(depth, 3)}\` : '';

            const kind = v.kind || 'object';
            const type = v.type || 'unknown';
            const name = v.name || path.split(/[\.\[]/).pop()?.replace(']', '') || path;

            let valueDisplay = v.preview || v.value || '';
            if (kind === 'data' && v.columns) {
                valueDisplay = v.columns.slice(0, 5).join(', ') + (v.columns.length > 5 ? '...' : '');
            }

            const parentAttr = parentPath ? \`data-parent="\${escapeHtml(parentPath)}"\` : '';

            return \`
                <tr data-path="\${escapeHtml(path)}" data-kind="\${kind}" \${parentAttr}>
                    <td>
                        \${v.expandable
                            ? \`<span class="expand-btn \${isExpanded ? 'expanded' : ''}" onclick="toggleExpand('\${escapeHtml(path)}', this)">▶</span>\`
                            : '<span class="expand-btn placeholder"></span>'
                        }
                    </td>
                    <td>
                        <div class="name-cell \${nestClass}">
                            <span class="color-dot \${kind}"></span>
                            <span class="var-name" onclick="copyVar('\${escapeHtml(path)}')" title="Click to copy">\${escapeHtml(name)}</span>
                        </div>
                    </td>
                    <td class="type-cell">\${escapeHtml(type)}</td>
                    <td class="shape-cell">\${escapeHtml(String(shapeOrLen))}</td>
                    <td class="size-cell">\${formatSize(v.memory_size)}</td>
                    <td class="value-cell \${getValueClass(kind, type)}" title="\${escapeHtml(valueDisplay)}">\${escapeHtml(valueDisplay)}</td>
                    <td class="actions-cell">
                        <button class="action-btn" onclick="insertVar('\${escapeHtml(path)}')" title="Insert">⎘</button>
                        \${kind === 'data' || kind === 'collection'
                            ? \`<button class="action-btn" onclick="viewData('\${escapeHtml(path)}', \${JSON.stringify(v).replace(/"/g, '&quot;')})" title="View">👁</button>\`
                            : ''
                        }
                    </td>
                </tr>
            \`;
        }

        function renderVariables() {
            const tbody = document.getElementById('var-body');
            const emptyState = document.getElementById('empty-state');
            const varCount = document.getElementById('var-count');

            if (variables.length === 0) {
                tbody.innerHTML = '';
                emptyState.style.display = 'block';
                varCount.textContent = '0 variables';
                return;
            }

            emptyState.style.display = 'none';
            varCount.textContent = \`\${variables.length} variable\${variables.length !== 1 ? 's' : ''}\`;

            // Sort variables
            const sorted = [...variables].sort((a, b) => {
                let aVal = a[sortColumn] || '';
                let bVal = b[sortColumn] || '';
                if (typeof aVal === 'string') aVal = aVal.toLowerCase();
                if (typeof bVal === 'string') bVal = bVal.toLowerCase();
                if (aVal < bVal) return sortAsc ? -1 : 1;
                if (aVal > bVal) return sortAsc ? 1 : -1;
                return 0;
            });

            // Group by kind
            const groups = {
                data: { label: 'Data', items: [] },
                collection: { label: 'Collections', items: [] },
                primitive: { label: 'Values', items: [] },
                object: { label: 'Objects', items: [] },
                callable: { label: 'Functions', items: [] },
                class: { label: 'Classes', items: [] }
            };

            for (const v of sorted) {
                const kind = v.kind || 'object';
                if (groups[kind]) {
                    groups[kind].items.push(v);
                } else {
                    groups['object'].items.push(v);
                }
            }

            let html = '';
            const order = ['data', 'collection', 'primitive', 'object', 'callable', 'class'];

            for (const kind of order) {
                const group = groups[kind];
                if (group.items.length > 0) {
                    html += \`
                        <tr class="group-header">
                            <td colspan="7">
                                <span class="color-dot \${kind}"></span>
                                \${group.label} (\${group.items.length})
                            </td>
                        </tr>
                    \`;
                    for (const v of group.items) {
                        html += renderVariableRow(v);
                    }
                }
            }

            tbody.innerHTML = html;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    variables = message.variables || [];
                    renderVariables();
                    break;
                case 'expanded':
                    // Insert children after the parent row
                    console.log('Received expanded for', message.path, 'children:', message.children?.length);
                    const parentRow = document.querySelector(\`tr[data-path="\${message.path}"]\`);
                    console.log('Parent row found:', !!parentRow);
                    if (parentRow && message.children && message.children.length > 0) {
                        // Store children for later
                        expandedChildren.set(message.path, message.children);

                        // Calculate depth from parent path
                        const depth = getDepthFromPath(message.path) + 1;
                        console.log('Rendering', message.children.length, 'children at depth', depth);

                        let childHtml = '';
                        for (const child of message.children) {
                            // Child is the info object directly with path added
                            const childInfo = child;
                            const childPath = child.path || child.name;
                            // Ensure child has the full path
                            if (!childInfo.path) {
                                childInfo.path = childPath;
                            }
                            console.log('Child:', childInfo.name, 'path:', childInfo.path, 'expandable:', childInfo.expandable);
                            childHtml += renderVariableRow(childInfo, depth, message.path);
                        }
                        parentRow.insertAdjacentHTML('afterend', childHtml);
                    }
                    break;
            }
        });

        // Initial render
        renderVariables();
    </script>
</body>
</html>`;
    }
}

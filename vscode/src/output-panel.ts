/**
 * Rich Output Panel for mrmd
 *
 * Displays rich outputs from IPython that can't go in markdown:
 * - Matplotlib plots (PNG, SVG)
 * - HTML outputs (pandas tables, widgets)
 * - LaTeX rendered math
 * - Interactive visualizations
 * - Images
 */

import * as vscode from 'vscode';

interface DisplayData {
    data: Record<string, string>;
    metadata?: Record<string, unknown>;
}

interface OutputItem {
    id: string;
    timestamp: number;
    cell_id?: string;
    display_data: DisplayData;
}

export class OutputPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mrmd.outputPanel';

    private _view?: vscode.WebviewView;
    private _outputs: OutputItem[] = [];
    private _outputCounter = 0;
    private _maxOutputs = 50; // Keep last 50 outputs

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}

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

        webviewView.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'clear':
                    this.clear();
                    break;
                case 'copy':
                    await vscode.env.clipboard.writeText(data.value);
                    vscode.window.showInformationMessage('Copied to clipboard');
                    break;
                case 'save':
                    await this._saveOutput(data.id, data.format);
                    break;
                case 'openExternal':
                    // Open HTML in browser
                    this._openInBrowser(data.html);
                    break;
            }
        });

        // Refresh on visibility change
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updateView();
            }
        });

        // Initial render
        this._updateView();
    }

    /**
     * Add a new output from IPython execution
     */
    public addOutput(displayData: DisplayData, cellId?: string): void {
        const output: OutputItem = {
            id: `output_${++this._outputCounter}`,
            timestamp: Date.now(),
            cell_id: cellId,
            display_data: displayData
        };

        this._outputs.unshift(output); // Add to front (newest first)

        // Limit stored outputs
        if (this._outputs.length > this._maxOutputs) {
            this._outputs = this._outputs.slice(0, this._maxOutputs);
        }

        this._updateView();
    }

    /**
     * Add multiple outputs from execution result
     */
    public addOutputs(displayDataList: DisplayData[], cellId?: string): void {
        for (const displayData of displayDataList) {
            this.addOutput(displayData, cellId);
        }
    }

    /**
     * Clear all outputs
     */
    public clear(): void {
        this._outputs = [];
        this._updateView();
    }

    public dispose(): void {
        // Nothing to dispose
    }

    private _updateView(): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                outputs: this._outputs
            });
        }
    }

    private async _saveOutput(id: string, format: string): Promise<void> {
        const output = this._outputs.find(o => o.id === id);
        if (!output) return;

        const data = output.display_data.data;

        let content: string | undefined;
        let defaultName: string;
        let filters: Record<string, string[]>;

        if (format === 'png' && data['image/png']) {
            // Save as PNG
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`output_${id}.png`),
                filters: { 'PNG Image': ['png'] }
            });
            if (uri) {
                const buffer = Buffer.from(data['image/png'], 'base64');
                await vscode.workspace.fs.writeFile(uri, buffer);
                vscode.window.showInformationMessage(`Saved to ${uri.fsPath}`);
            }
            return;
        } else if (format === 'svg' && data['image/svg+xml']) {
            content = data['image/svg+xml'];
            defaultName = `output_${id}.svg`;
            filters = { 'SVG Image': ['svg'] };
        } else if (format === 'html' && data['text/html']) {
            content = data['text/html'];
            defaultName = `output_${id}.html`;
            filters = { 'HTML File': ['html'] };
        } else {
            return;
        }

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultName),
            filters
        });

        if (uri && content) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
            vscode.window.showInformationMessage(`Saved to ${uri.fsPath}`);
        }
    }

    private async _openInBrowser(html: string): Promise<void> {
        // Create a temporary HTML file and open it
        const tmpDir = vscode.Uri.joinPath(this._extensionUri, '.tmp');
        try {
            await vscode.workspace.fs.createDirectory(tmpDir);
        } catch {
            // Directory may already exist
        }

        const tmpFile = vscode.Uri.joinPath(tmpDir, `output_${Date.now()}.html`);
        await vscode.workspace.fs.writeFile(tmpFile, Buffer.from(html, 'utf-8'));
        await vscode.env.openExternal(tmpFile);
    }

    private _getHtmlForWebview(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Outputs</title>
    <style>
        :root {
            --bg-color: var(--vscode-editor-background);
            --fg-color: var(--vscode-editor-foreground);
            --border-color: var(--vscode-panel-border);
            --hover-bg: var(--vscode-list-hoverBackground);
            --header-bg: var(--vscode-sideBarSectionHeader-background);
            --accent-color: var(--vscode-focusBorder);
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
            overflow-x: hidden;
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
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            padding: 4px 8px;
        }

        .outputs {
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .output-item {
            border: 1px solid var(--border-color);
            border-radius: 4px;
            overflow: hidden;
        }

        .output-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 8px;
            background: var(--header-bg);
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .output-header .type-badge {
            background: var(--accent-color);
            color: var(--vscode-button-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 500;
        }

        .output-header .type-badge.png { background: #4CAF50; }
        .output-header .type-badge.svg { background: #FF9800; }
        .output-header .type-badge.html { background: #2196F3; }
        .output-header .type-badge.latex { background: #9C27B0; }
        .output-header .type-badge.text { background: #607D8B; }

        .output-header .time {
            flex: 1;
        }

        .output-header .actions {
            display: flex;
            gap: 4px;
        }

        .output-header .actions button {
            background: transparent;
            border: none;
            color: var(--fg-color);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            opacity: 0.7;
        }

        .output-header .actions button:hover {
            opacity: 1;
            background: var(--hover-bg);
        }

        .output-content {
            padding: 8px;
            background: var(--bg-color);
            overflow: auto;
            max-height: 400px;
        }

        .output-content img {
            max-width: 100%;
            height: auto;
            display: block;
        }

        .output-content svg {
            max-width: 100%;
            height: auto;
        }

        .output-content table {
            border-collapse: collapse;
            font-size: 12px;
            width: 100%;
        }

        .output-content table th,
        .output-content table td {
            border: 1px solid var(--border-color);
            padding: 4px 8px;
            text-align: left;
        }

        .output-content table th {
            background: var(--header-bg);
        }

        .output-content pre {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-all;
        }

        .output-content .latex {
            font-family: 'Times New Roman', serif;
            font-size: 14px;
            text-align: center;
            padding: 8px;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state .icon {
            font-size: 32px;
            margin-bottom: 12px;
            opacity: 0.5;
        }

        /* Dark theme adjustments for HTML content */
        .output-content.html-content {
            background: white;
            color: black;
        }

        .output-content.html-content table {
            border-color: #ddd;
        }

        .output-content.html-content table th {
            background: #f5f5f5;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button onclick="clearOutputs()" title="Clear All">
            <span>🗑</span> Clear
        </button>
        <div class="spacer"></div>
        <span class="count" id="output-count">0 outputs</span>
    </div>

    <div class="outputs" id="outputs-container">
    </div>

    <div class="empty-state" id="empty-state">
        <div class="icon">📊</div>
        <div>No outputs yet</div>
        <div style="margin-top: 8px; font-size: 11px;">
            Run code with plots, HTML, or other rich outputs<br>
            to see them here
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let outputs = [];

        function clearOutputs() {
            vscode.postMessage({ type: 'clear' });
        }

        function saveOutput(id, format) {
            vscode.postMessage({ type: 'save', id: id, format: format });
        }

        function copyOutput(id, format) {
            const output = outputs.find(o => o.id === id);
            if (!output) return;

            const data = output.display_data.data;
            let value = '';

            if (format === 'html' && data['text/html']) {
                value = data['text/html'];
            } else if (format === 'svg' && data['image/svg+xml']) {
                value = data['image/svg+xml'];
            } else if (data['text/plain']) {
                value = data['text/plain'];
            }

            vscode.postMessage({ type: 'copy', value: value });
        }

        function openExternal(id) {
            const output = outputs.find(o => o.id === id);
            if (!output) return;

            const data = output.display_data.data;
            if (data['text/html']) {
                vscode.postMessage({ type: 'openExternal', html: data['text/html'] });
            }
        }

        function getOutputType(data) {
            if (data['image/png']) return 'png';
            if (data['image/svg+xml']) return 'svg';
            if (data['text/html']) return 'html';
            if (data['text/latex']) return 'latex';
            if (data['application/json']) return 'json';
            return 'text';
        }

        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString();
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function renderOutputContent(output) {
            const data = output.display_data.data;

            // Priority: PNG > SVG > HTML > LaTeX > Text
            if (data['image/png']) {
                return \`<img src="data:image/png;base64,\${data['image/png']}" alt="Plot">\`;
            }

            if (data['image/svg+xml']) {
                return data['image/svg+xml'];
            }

            if (data['text/html']) {
                // Sanitize HTML somewhat but allow tables and common elements
                return \`<div class="html-content">\${data['text/html']}</div>\`;
            }

            if (data['text/latex']) {
                return \`<div class="latex">\${escapeHtml(data['text/latex'])}</div>\`;
            }

            if (data['application/json']) {
                return \`<pre>\${escapeHtml(JSON.stringify(data['application/json'], null, 2))}</pre>\`;
            }

            if (data['text/plain']) {
                return \`<pre>\${escapeHtml(data['text/plain'])}</pre>\`;
            }

            return '<em>Unknown output type</em>';
        }

        function renderOutput(output) {
            const type = getOutputType(output.display_data.data);
            const time = formatTime(output.timestamp);

            let actions = '';
            if (type === 'png') {
                actions = \`
                    <button onclick="saveOutput('\${output.id}', 'png')" title="Save PNG">💾</button>
                \`;
            } else if (type === 'svg') {
                actions = \`
                    <button onclick="saveOutput('\${output.id}', 'svg')" title="Save SVG">💾</button>
                    <button onclick="copyOutput('\${output.id}', 'svg')" title="Copy SVG">📋</button>
                \`;
            } else if (type === 'html') {
                actions = \`
                    <button onclick="saveOutput('\${output.id}', 'html')" title="Save HTML">💾</button>
                    <button onclick="openExternal('\${output.id}')" title="Open in Browser">🔗</button>
                \`;
            }

            return \`
                <div class="output-item" data-id="\${output.id}">
                    <div class="output-header">
                        <span class="type-badge \${type}">\${type.toUpperCase()}</span>
                        <span class="time">\${time}</span>
                        <div class="actions">\${actions}</div>
                    </div>
                    <div class="output-content \${type === 'html' ? 'html-content' : ''}">
                        \${renderOutputContent(output)}
                    </div>
                </div>
            \`;
        }

        function renderOutputs() {
            const container = document.getElementById('outputs-container');
            const emptyState = document.getElementById('empty-state');
            const countEl = document.getElementById('output-count');

            countEl.textContent = \`\${outputs.length} output\${outputs.length !== 1 ? 's' : ''}\`;

            if (outputs.length === 0) {
                container.innerHTML = '';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';
            container.innerHTML = outputs.map(renderOutput).join('');
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    outputs = message.outputs || [];
                    renderOutputs();
                    break;
            }
        });

        // Initial render
        renderOutputs();
    </script>
</body>
</html>`;
    }
}

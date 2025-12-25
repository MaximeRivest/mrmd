/**
 * mrmd Editor Provider
 *
 * Custom editor for markdown files with integrated REPL.
 * Uses shared frontend modules from core/.
 */

import * as vscode from 'vscode';
import { MrmdServerManager } from './server-manager';

export class MrmdEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'mrmd.markdownEditor';

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly serverManager: MrmdServerManager
    ) {}

    /**
     * Called when a custom editor is opened
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Ensure server is running
        const autoStart = vscode.workspace.getConfiguration('mrmd').get('autoStartServer', true);
        if (autoStart && !this.serverManager.isRunning) {
            await this.serverManager.start();
        }

        // Configure webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };

        // Set initial HTML
        webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, document);

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    // Send initial document content
                    webviewPanel.webview.postMessage({
                        type: 'setContent',
                        content: document.getText(),
                        filename: document.fileName.split('/').pop(),
                        filepath: document.fileName
                    });
                    break;

                case 'save':
                    await this.saveDocument(document, message.content);
                    break;

                case 'update':
                    // Document was updated in the webview
                    await this.updateDocument(document, message.content);
                    break;

                case 'showInfo':
                    vscode.window.showInformationMessage(message.message);
                    break;

                case 'showError':
                    vscode.window.showErrorMessage(message.message);
                    break;
            }
        });

        // Sync document changes to webview (external changes)
        const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                // Only sync if change came from outside (e.g., git, another editor)
                // Skip if it was triggered by our own updateDocument call
                webviewPanel.webview.postMessage({
                    type: 'externalChange',
                    content: document.getText()
                });
            }
        });

        // Clean up
        webviewPanel.onDidDispose(() => {
            changeSubscription.dispose();
        });
    }

    /**
     * Generate the webview HTML content using shared core modules
     */
    private getHtmlContent(webview: vscode.Webview, document: vscode.TextDocument): string {
        const mediaUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media')
        );

        const serverUrl = this.serverManager.serverUrl;
        const nonce = getNonce();

        // Generate script URIs for core modules
        const coreUri = `${mediaUri}/core`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src ${webview.cspSource} https://cdn.jsdelivr.net; img-src ${webview.cspSource} https: data:; connect-src ${serverUrl};">
    <title>mrmd</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" nonce="${nonce}"></script>
    <link rel="stylesheet" href="${mediaUri}/main.css">
    <link rel="stylesheet" href="${mediaUri}/vscode.css">
</head>
<body>
    <div class="bar">
        <span class="mode" id="mode">ready</span>
        <div class="view-mgr">
            <button id="btnOverlay" class="active">edit</button>
            <button id="btnText">text</button>
            <button id="btnPreview">preview</button>
            <button id="btnNotebook">notebook</button>
        </div>
        <span class="spacer"></span>
        <span id="filename">${document.fileName.split('/').pop()}</span>
    </div>

    <div class="main">
        <textarea id="editor" class="editor-base" spellcheck="false" style="display:none"></textarea>
        <div id="preview" class="editor-base" style="display:none"></div>
        <div id="overlay-container" style="display:none">
            <div id="overlay-blocks" class="editor-base overlay-layer"></div>
            <div id="overlay-preview" class="editor-base overlay-layer"></div>
            <textarea id="overlay-editor" class="editor-base overlay-layer" spellcheck="false"></textarea>
            <div id="overlay-interactive" class="editor-base overlay-layer"></div>
        </div>
        <div id="notebook" style="display:none"></div>
    </div>

    <div class="hint">
        <kbd>ctrl+enter</kbd> execute · <kbd>ctrl+s</kbd> save · <kbd>ctrl+m</kbd> cycle views
    </div>

    <div id="terminal-overlay">
        <div id="terminal-bar">
            <span class="session" id="sessionLabel">default</span>
            <span class="spacer"></span>
            <span><kbd>esc</kbd> to exit</span>
        </div>
        <div id="terminal-content" tabindex="0"></div>
    </div>

    <script type="module" nonce="${nonce}">
        // Import core modules
        import { createApp } from '${coreUri}/app.js';
        import { escapeHtml } from '${coreUri}/utils.js';

        // Get VSCode API
        const vscode = acquireVsCodeApi();

        // Server URL for API calls
        const serverUrl = '${serverUrl}';

        // Create application with VSCode-specific configuration
        const app = createApp({
            apiBase: serverUrl,
            statusElement: document.getElementById('mode'),
            onViewChange: updateViewButtons,
            onFileChange: updateFileInfo,
            onSessionsChange: () => {}
        });

        // Initialize with DOM elements
        app.init({
            editor: document.getElementById('editor'),
            preview: document.getElementById('preview'),
            notebook: document.getElementById('notebook'),
            overlayContainer: document.getElementById('overlay-container'),
            overlayBlocks: document.getElementById('overlay-blocks'),
            overlayPreview: document.getElementById('overlay-preview'),
            overlayEditor: document.getElementById('overlay-editor'),
            overlayInteractive: document.getElementById('overlay-interactive'),
            terminalOverlay: document.getElementById('terminal-overlay'),
            terminalContent: document.getElementById('terminal-content'),
            sessionLabel: document.getElementById('sessionLabel'),
            modeEl: document.getElementById('mode'),
            filenameEl: document.getElementById('filename')
        });

        // Make app global for debugging
        window.app = app;

        // UI update callbacks
        function updateViewButtons(view) {
            document.getElementById('btnText').classList.toggle('active', view === 'text');
            document.getElementById('btnOverlay').classList.toggle('active', view === 'overlay');
            document.getElementById('btnPreview').classList.toggle('active', view === 'preview');
            document.getElementById('btnNotebook').classList.toggle('active', view === 'notebook');
        }

        function updateFileInfo(info) {
            document.getElementById('filename').textContent = info.filename || 'untitled.md';
        }

        // Wire up view buttons
        document.getElementById('btnText').addEventListener('click', () => app.setView('text'));
        document.getElementById('btnOverlay').addEventListener('click', () => app.setView('overlay'));
        document.getElementById('btnPreview').addEventListener('click', () => app.setView('preview'));
        document.getElementById('btnNotebook').addEventListener('click', () => app.setView('notebook'));

        // Override save to use VSCode's document system
        const originalSaveFile = app.saveFile.bind(app);
        app.saveFile = async function() {
            const content = this.getContent();
            vscode.postMessage({ type: 'save', content });
        };

        // Sync content changes to VSCode
        const editor = document.getElementById('editor');
        const overlayEditor = document.getElementById('overlay-editor');

        function syncToVSCode() {
            vscode.postMessage({ type: 'update', content: editor.value });
        }

        editor.addEventListener('input', syncToVSCode);
        overlayEditor.addEventListener('input', () => {
            editor.value = overlayEditor.value;
            syncToVSCode();
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.type) {
                case 'setContent':
                    app.setContent(message.content);
                    if (message.filename) {
                        document.getElementById('filename').textContent = message.filename;
                    }
                    break;

                case 'externalChange':
                    // External change (e.g., git) - update if content differs
                    if (app.getContent() !== message.content) {
                        app.setContent(message.content);
                    }
                    break;
            }
        });

        // Tell extension we're ready
        vscode.postMessage({ type: 'ready' });

        // Wait for KaTeX
        function waitForKatex() {
            if (typeof katex !== 'undefined') {
                app._renderCurrentView();
            } else {
                setTimeout(waitForKatex, 100);
            }
        }
        waitForKatex();
    </script>
</body>
</html>`;
    }

    /**
     * Save document with new content
     */
    private async saveDocument(document: vscode.TextDocument, content: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            content
        );
        await vscode.workspace.applyEdit(edit);
        await document.save();
    }

    /**
     * Update document with new content (without saving)
     */
    private async updateDocument(document: vscode.TextDocument, content: string): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            content
        );
        await vscode.workspace.applyEdit(edit);
    }
}

/**
 * Generate a nonce for CSP
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

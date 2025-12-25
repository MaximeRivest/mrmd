/**
 * Execution Manager for mrmd
 *
 * Handles running code blocks and injecting output into the document.
 */

import * as vscode from 'vscode';
import { MrmdServerManager } from './server-manager';
import { MrmdCodeLensProvider } from './codelens-provider';

interface CodeBlock {
    language: string;
    code: string;
    startLine: number;
    endLine: number;
    fenceStart: number;
    fenceEnd: number;
    fenceLength?: number;
    fenceChar?: string;
    isNested?: boolean;
    parentFenceStart?: number;
}

// Language to REPL command mapping
const LANG_COMMANDS: Record<string, { start: string; exec: (code: string) => string }> = {
    python: {
        start: 'python',  // Will be detected by server
        exec: (code) => code,
    },
    py: {
        start: 'python',
        exec: (code) => code,
    },
    javascript: {
        start: 'node',
        exec: (code) => code,
    },
    js: {
        start: 'node',
        exec: (code) => code,
    },
    bash: {
        start: 'bash',
        exec: (code) => code,
    },
    sh: {
        start: 'bash',
        exec: (code) => code,
    },
    repl: {
        start: '',  // Direct shell
        exec: (code) => code,
    },
};

export class ExecutionManager {
    private statusBarItem: vscode.StatusBarItem;
    private currentSession: string = 'default';
    private outputChannel: vscode.OutputChannel;

    constructor(
        private serverManager: MrmdServerManager,
        private codeLensProvider: MrmdCodeLensProvider
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.text = '$(terminal) mrmd: ready';
        this.statusBarItem.command = 'mrmd.showSessions';
        this.statusBarItem.show();

        this.outputChannel = vscode.window.createOutputChannel('mrmd');
    }

    dispose() {
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }

    /**
     * Run a code block and inject output
     */
    async runCodeBlock(
        uri: vscode.Uri,
        blockIndex: number,
        block: CodeBlock
    ): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);

        // Ensure server is running
        if (!this.serverManager.isRunning) {
            await this.serverManager.start();
        }

        this.setStatus('running', block.language);

        try {
            // Execute the code
            const output = await this.executeCode(block.language, block.code, document);

            // Inject the output into the document
            await this.injectOutput(editor, block, output);

            this.setStatus('ready');
            this.codeLensProvider.refresh();
        } catch (error) {
            this.setStatus('error');
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`mrmd: ${errorMsg}`);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
        }
    }

    /**
     * Run the code block at the current cursor position
     */
    async runBlockAtCursor(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'markdown') {
            vscode.window.showInformationMessage('mrmd: Not a markdown file');
            return;
        }

        const blocks = this.codeLensProvider.parseCodeBlocks(document);
        const position = editor.selection.active;

        // Find the block containing the cursor
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (position.line >= block.fenceStart && position.line <= block.fenceEnd) {
                if (block.language === 'output' || block.language === 'result') {
                    vscode.window.showInformationMessage('mrmd: Cannot run output block');
                    return;
                }
                await this.runCodeBlock(document.uri, i, block);
                return;
            }
        }

        vscode.window.showInformationMessage('mrmd: Cursor not in a code block');
    }

    /**
     * Run all code blocks in the document
     */
    async runAllBlocks(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            return;
        }

        const document = editor.document;
        const blocks = this.codeLensProvider.parseCodeBlocks(document);

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            if (block.language !== 'output' && block.language !== 'result') {
                await this.runCodeBlock(document.uri, i, block);
                // Re-parse after each injection since line numbers change
                // This is a simplification - ideally we'd track offsets
            }
        }
    }

    /**
     * Execute code via the mrmd server with streaming support
     */
    private async executeCode(
        language: string,
        code: string,
        document: vscode.TextDocument
    ): Promise<string> {
        const serverUrl = this.serverManager.serverUrl;
        const langConfig = LANG_COMMANDS[language.toLowerCase()];

        // Determine session ID based on language
        const sessionId = this.getSessionId(language);

        // Get working directory from document
        const cwd = document.uri.fsPath
            ? require('path').dirname(document.uri.fsPath)
            : undefined;

        // Start the appropriate REPL if needed
        if (langConfig?.start) {
            // First interaction to ensure REPL is started
            const initResponse = await fetch(`${serverUrl}/api/interact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: sessionId,
                    keys: '',
                    wait: 0.5,
                    cwd: cwd,
                }),
            });

            if (!initResponse.ok) {
                throw new Error('Failed to initialize session');
            }

            const initData = await initResponse.json() as { screen?: string; lines?: string[] };

            // Check if we need to start the REPL
            // Server returns 'lines' array, join to get screen text
            const screen = initData.lines ? initData.lines.join('\n') : (initData.screen || '');
            const needsRepl = !screen.includes('>>>') && !screen.includes('In [');

            if (needsRepl && langConfig.start === 'python') {
                // Get the python command for this project
                const cmdResponse = await fetch(`${serverUrl}/api/python/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cwd }),
                });
                const cmdData = await cmdResponse.json() as { command?: string };
                const pythonCmd = cmdData.command || 'python3';

                await fetch(`${serverUrl}/api/interact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session: sessionId,
                        keys: `${pythonCmd}<enter>`,
                        wait: 2,
                    }),
                });
            }
        }

        // Use the new /api/execute endpoint
        const execResponse = await fetch(`${serverUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session: sessionId,
                code: code,
                language: language,
                cwd: cwd,
                stream: false,  // For now, use non-streaming
            }),
        });

        if (!execResponse.ok) {
            throw new Error('Execution failed');
        }

        const data = await execResponse.json() as {
            stdout?: string;
            return_value?: string;
            error?: { error_type?: string; message?: string; raw?: string };
            has_error?: boolean;
            output?: string;
        };

        // Build output from structured response
        const parts: string[] = [];

        // Add stdout (print statements, etc.)
        if (data.stdout) {
            parts.push(data.stdout);
        }

        // Add return value if present and not already in stdout
        if (data.return_value && !data.stdout?.includes(data.return_value)) {
            parts.push(data.return_value);
        }

        // If we have parts, return them
        if (parts.length > 0) {
            return parts.join('\n');
        }

        // Fallback to raw output
        return data.output || '';
    }

    /**
     * Execute code with streaming (for long-running operations)
     * Returns an async generator that yields screen updates
     */
    async *executeCodeStreaming(
        language: string,
        code: string,
        document: vscode.TextDocument
    ): AsyncGenerator<{ screen: string; done: boolean }> {
        const serverUrl = this.serverManager.serverUrl;
        const sessionId = this.getSessionId(language);
        const cwd = document.uri.fsPath
            ? require('path').dirname(document.uri.fsPath)
            : undefined;

        // Start streaming execution
        const execResponse = await fetch(`${serverUrl}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session: sessionId,
                code: code,
                language: language,
                cwd: cwd,
                stream: true,
            }),
        });

        if (!execResponse.ok) {
            throw new Error('Failed to start execution');
        }

        const execData = await execResponse.json() as { stream_url?: string; session_id?: string };

        // Connect to SSE stream
        const streamUrl = `${serverUrl}${execData.stream_url}`;

        // Use EventSource for SSE (or fetch with reader for environments without EventSource)
        const response = await fetch(streamUrl);
        const reader = response.body?.getReader();

        if (!reader) {
            throw new Error('Failed to get stream reader');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        try {
                            const event = JSON.parse(jsonStr) as { screen: string; done: boolean };
                            yield event;
                            if (event.done) {
                                return;
                            }
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Clean up the output - extract just the result from the last executed code
     */
    private cleanOutput(screen: string, code: string): string {
        const lines = screen.split('\n');
        const codeFirstLine = code.split('\n')[0]?.trim() || '';

        // Find the LAST occurrence of our code being executed
        // Look for the pattern: "In [N]: <code>" or ">>> <code>"
        let codeLineIndex = -1;

        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];

            // IPython: "In [N]: code"
            const ipythonMatch = line.match(/^In \[\d+\]:\s*(.*)/);
            if (ipythonMatch) {
                const codePart = ipythonMatch[1].trim();
                if (codePart && codeFirstLine.includes(codePart.substring(0, 20))) {
                    codeLineIndex = i;
                    break;
                }
            }

            // Python REPL: ">>> code"
            if (line.startsWith('>>> ')) {
                const codePart = line.substring(4).trim();
                if (codePart && codeFirstLine.includes(codePart.substring(0, 20))) {
                    codeLineIndex = i;
                    break;
                }
            }
        }

        if (codeLineIndex === -1) {
            return '';
        }

        // Collect output lines after our code until the next prompt
        const outputLines: string[] = [];
        for (let i = codeLineIndex + 1; i < lines.length; i++) {
            const line = lines[i];

            // Stop at next prompt (>>> with optional space, or In [N]:)
            if (line.match(/^In \[\d+\]:/) || line.match(/^>>>\s*$/)) {
                break;
            }

            // Skip continuation prompts (multiline input)
            if (line.startsWith('... ') || line.match(/^\s+\.\.\.:?\s*/)) {
                continue;
            }

            // Handle "Out[N]:" - extract just the value
            const outMatch = line.match(/^Out\[\d+\]:\s*(.*)/);
            if (outMatch) {
                if (outMatch[1].trim()) {
                    outputLines.push(outMatch[1]);
                }
                continue;
            }

            // Skip leading empty lines
            if (outputLines.length === 0 && !line.trim()) {
                continue;
            }

            outputLines.push(line);
        }

        // Trim trailing empty lines
        while (outputLines.length > 0 && !outputLines[outputLines.length - 1]?.trim()) {
            outputLines.pop();
        }

        return outputLines.join('\n');
    }

    /**
     * Check if output contains code fences that would break a 3-backtick wrapper.
     * Only returns true for actual fence patterns (```language or ``` on its own line).
     */
    private hasCodeFences(output: string): boolean {
        // Match code fence patterns: ``` at start of line, optionally followed by language
        return /^`{3,}(\w*)\s*$/m.test(output);
    }

    /**
     * Calculate the minimum fence length needed to safely wrap output.
     * Returns 3 unless there are code fences in the output.
     */
    private calculateMinFenceLength(output: string): number {
        if (!this.hasCodeFences(output)) {
            return 3;
        }

        // Find the longest fence in the output
        const fenceMatches = output.match(/^`{3,}/gm) || [];
        const maxFenceLength = fenceMatches.length > 0
            ? Math.max(...fenceMatches.map(m => m.length))
            : 0;

        // Need one more than the max found
        return Math.max(3, maxFenceLength + 1);
    }

    /**
     * Inject output into the document after the code block.
     * Handles backticks in output by using longer fences when needed.
     *
     * @param editor - The text editor
     * @param block - The code block to inject output after
     * @param output - The output content
     * @param streaming - If true, use 4 backticks for safety during streaming
     */
    async injectOutput(
        editor: vscode.TextEditor,
        block: CodeBlock,
        output: string,
        streaming: boolean = false
    ): Promise<void> {
        const document = editor.document;

        // Find existing output block
        const existingOutput = this.codeLensProvider.findOutputBlock(document, block.fenceEnd);

        // Handle empty output: remove existing output block if present
        if (!output.trim()) {
            if (existingOutput) {
                // Remove the output block (including any blank line before it)
                const blankLineStart = block.fenceEnd + 1;
                const startPos = new vscode.Position(blankLineStart, 0);
                const endPos = new vscode.Position(existingOutput.end, document.lineAt(existingOutput.end).text.length);
                // Include the newline after the closing fence if there is one
                const deleteEnd = existingOutput.end + 1 < document.lineCount
                    ? new vscode.Position(existingOutput.end + 1, 0)
                    : endPos;
                await editor.edit(editBuilder => {
                    editBuilder.delete(new vscode.Range(startPos, deleteEnd));
                });
            }
            return;
        }

        // Calculate fence length
        let fenceLength: number;
        if (streaming) {
            // While streaming: use at least 4 backticks for safety
            // But upgrade if we see 4+ backticks in the output
            const minNeeded = this.calculateMinFenceLength(output);
            fenceLength = Math.max(4, minNeeded);
        } else {
            // Final output: use minimum needed (could be 3 if no backticks in output)
            fenceLength = this.calculateMinFenceLength(output);
        }

        const fence = '`'.repeat(fenceLength);

        await editor.edit(editBuilder => {
            if (existingOutput) {
                // Replace existing output block
                const startPos = new vscode.Position(existingOutput.start, 0);
                const endPos = new vscode.Position(existingOutput.end, document.lineAt(existingOutput.end).text.length);
                editBuilder.replace(new vscode.Range(startPos, endPos), `${fence}output\n${output}\n${fence}`);
            } else {
                // Insert new output block after the code block
                const insertPos = new vscode.Position(block.fenceEnd, document.lineAt(block.fenceEnd).text.length);
                editBuilder.insert(insertPos, `\n${fence}output\n${output}\n${fence}`);
            }
        });

        // TODO: WIP - Scroll position preservation during streaming output
        // Goal: Keep the editor view stable (centered on cursor) when output is injected
        // Current approach using revealRange doesn't work reliably
        // Possible alternatives to investigate:
        // - Save/restore scrollTop via editor.visibleRanges
        // - Use setDecorations to create an anchor point
        // - Debounce reveals to reduce flicker
        // - Use VS Code's built-in scroll preservation options
    }

    /**
     * Insert markdown content after the output block (or after code block if no output).
     * Used for inserting image links that should be rendered as markdown, not code.
     *
     * @param editor - The text editor
     * @param block - The code block
     * @param content - The markdown content to insert
     */
    async insertAfterOutput(
        editor: vscode.TextEditor,
        block: CodeBlock,
        content: string
    ): Promise<void> {
        if (!content.trim()) {
            return;
        }

        const document = editor.document;

        // Find existing output block
        const existingOutput = this.codeLensProvider.findOutputBlock(document, block.fenceEnd);

        // Determine where to insert: after output block if exists, otherwise after code block
        let insertLine: number;
        if (existingOutput) {
            insertLine = existingOutput.end;
        } else {
            insertLine = block.fenceEnd;
        }

        // Check if the content already exists to avoid duplicates
        // Only check for image links (![](path)) to avoid false positives with HTML
        const nextLineStart = insertLine + 1;
        if (nextLineStart < document.lineCount) {
            const nextLine = document.lineAt(nextLineStart).text.trim();
            // For image links, check if the exact link already exists
            if (content.startsWith('![](') && nextLine === content.trim()) {
                return;
            }
        }

        await editor.edit(editBuilder => {
            const insertPos = new vscode.Position(insertLine, document.lineAt(insertLine).text.length);
            editBuilder.insert(insertPos, `\n\n${content}`);
        });
    }

    /**
     * Get session ID for a language
     */
    private getSessionId(language: string): string {
        const langLower = language.toLowerCase();
        if (langLower === 'python' || langLower === 'py') {
            return 'python';
        }
        if (langLower === 'javascript' || langLower === 'js' || langLower === 'typescript' || langLower === 'ts') {
            return 'node';
        }
        if (langLower === 'bash' || langLower === 'sh') {
            return 'bash';
        }
        return 'default';
    }

    private setStatus(status: 'ready' | 'running' | 'error', language?: string) {
        switch (status) {
            case 'running':
                this.statusBarItem.text = `$(sync~spin) mrmd: running ${language || ''}`;
                break;
            case 'error':
                this.statusBarItem.text = '$(error) mrmd: error';
                break;
            default:
                this.statusBarItem.text = '$(terminal) mrmd: ready';
        }
    }

    /**
     * Show session management quick pick
     */
    async showSessions(): Promise<void> {
        if (!this.serverManager.isRunning) {
            const start = await vscode.window.showQuickPick(['Start server', 'Cancel'], {
                placeHolder: 'mrmd server is not running',
            });
            if (start === 'Start server') {
                await this.serverManager.start();
            }
            return;
        }

        try {
            const response = await fetch(`${this.serverManager.serverUrl}/api/sessions`);
            const data = await response.json() as { sessions?: string[] };
            const sessions: string[] = data.sessions || [];

            const items = [
                ...sessions.map(s => ({ label: s, description: 'Active session' })),
                { label: '$(add) New session', description: 'Create a new session' },
                { label: '$(trash) Clear all', description: 'Close all sessions' },
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a session',
            });

            if (selected?.label === '$(add) New session') {
                // Create new session
                this.currentSession = `session_${Date.now()}`;
                vscode.window.showInformationMessage(`Created session: ${this.currentSession}`);
            } else if (selected?.label === '$(trash) Clear all') {
                await fetch(`${this.serverManager.serverUrl}/api/sessions/clear`, {
                    method: 'POST',
                });
                vscode.window.showInformationMessage('All sessions cleared');
            } else if (selected) {
                this.currentSession = selected.label;
                vscode.window.showInformationMessage(`Switched to session: ${this.currentSession}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get sessions');
        }
    }
}

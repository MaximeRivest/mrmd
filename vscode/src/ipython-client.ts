/**
 * IPython API client for the VSCode extension.
 *
 * Provides direct access to IPython shell features:
 * - Fast code execution with structured output
 * - Rich completions with types and signatures
 * - Object inspection for hover documentation
 *
 * NOTE: These types mirror frontend/core/types.ts
 * For new frontends, import from '@mrmd/core' or 'frontend/core/types.ts'
 *
 * @see docs/api-reference.md for full API documentation
 * @see frontend/core/types.ts for shared types
 * @see frontend/core/api-client.ts for shared API client
 */

import * as vscode from 'vscode';

// Types (mirrored from frontend/core/types.ts for VS Code compatibility)
// VS Code extensions can't easily import from shared modules, so we duplicate here.

export interface SavedAsset {
    path: string;
    mime_type: string;
    asset_type: 'image' | 'svg' | 'html';
}

export interface ExecutionResult {
    session_id: string;
    stdout: string;
    stderr: string;
    result: string | null;
    error: {
        type: string;
        message: string;
        traceback: string;
    } | null;
    success: boolean;
    execution_count: number;
    display_data: DisplayData[];
    // Paths to saved matplotlib figures (legacy)
    saved_figures: string[];
    // All saved assets (images, SVG, HTML)
    saved_assets: SavedAsset[];
    // Pre-formatted output from server (ANSI stripped, clean)
    formatted_output?: string;
}

export interface DisplayData {
    data: Record<string, string>;
    metadata?: Record<string, unknown>;
}

export interface CompletionResult {
    session_id: string;
    matches: string[];
    cursor_start: number;
    cursor_end: number;
    metadata: {
        types?: string[];
        signatures?: string[];
        error?: string;
    };
}

export interface InspectionResult {
    session_id: string;
    found: boolean;
    name: string;
    docstring: string | null;
    signature: string | null;
    type_name: string | null;
    source: string | null;
}

export interface IsCompleteResult {
    session_id: string;
    status: 'complete' | 'incomplete' | 'invalid' | 'unknown';
    indent: string;
}

export class IPythonClient {
    private getServerUrl: () => string;
    private sessionId: string;

    constructor(serverUrlOrGetter: string | (() => string), sessionId: string = 'default') {
        // Accept either a static URL string or a function that returns the URL
        this.getServerUrl = typeof serverUrlOrGetter === 'function'
            ? serverUrlOrGetter
            : () => serverUrlOrGetter;
        this.sessionId = sessionId;
    }

    private get serverUrl(): string {
        return this.getServerUrl();
    }

    /**
     * Execute Python code and return structured result.
     */
    async execute(code: string, storeHistory: boolean = true): Promise<ExecutionResult> {
        const response = await fetch(`${this.serverUrl}/api/ipython/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                session: this.sessionId,
                store_history: storeHistory,
            }),
        });

        if (!response.ok) {
            throw new Error(`Execution failed: ${response.statusText}`);
        }

        return await response.json() as ExecutionResult;
    }

    /**
     * Get completions at cursor position.
     */
    async complete(code: string, cursorPos: number): Promise<CompletionResult> {
        const response = await fetch(`${this.serverUrl}/api/ipython/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                cursor_pos: cursorPos,
                session: this.sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Completion failed: ${response.statusText}`);
        }

        return await response.json() as CompletionResult;
    }

    /**
     * Get object information for hover/inspection.
     */
    async inspect(code: string, cursorPos: number): Promise<InspectionResult> {
        const response = await fetch(`${this.serverUrl}/api/ipython/inspect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                cursor_pos: cursorPos,
                session: this.sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Inspection failed: ${response.statusText}`);
        }

        return await response.json() as InspectionResult;
    }

    /**
     * Check if code is complete or needs more input.
     */
    async isComplete(code: string): Promise<IsCompleteResult> {
        const response = await fetch(`${this.serverUrl}/api/ipython/is_complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                session: this.sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Is-complete check failed: ${response.statusText}`);
        }

        return await response.json() as IsCompleteResult;
    }

    /**
     * Reset the session (clear namespace).
     */
    async reset(): Promise<void> {
        const response = await fetch(`${this.serverUrl}/api/ipython/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session: this.sessionId,
            }),
        });

        if (!response.ok) {
            throw new Error(`Reset failed: ${response.statusText}`);
        }
    }

    /**
     * Interrupt the currently executing code (sends KeyboardInterrupt).
     */
    async interrupt(): Promise<boolean> {
        try {
            const response = await fetch(`${this.serverUrl}/api/ipython/interrupt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: this.sessionId,
                }),
            });

            if (!response.ok) {
                console.error(`Interrupt failed: ${response.statusText}`);
                return false;
            }

            const result = await response.json() as { success: boolean };
            return result.success === true;
        } catch (error) {
            console.error('Interrupt error:', error);
            return false;
        }
    }

    /**
     * Set the session ID (e.g., based on document).
     */
    setSession(sessionId: string): void {
        this.sessionId = sessionId;
    }

    /**
     * Get session ID for a document.
     * By default, all files in a workspace share the same session.
     * Format: ws_{workspace_hash} (shared) or ws_{workspace_hash}:doc_{filename} (dedicated)
     */
    static getSessionIdForDocument(document: vscode.TextDocument, dedicated: boolean = false): string {
        // Get workspace folder for this document
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const workspacePath = workspaceFolder?.uri.fsPath || 'global';

        // Create a short hash of workspace path for namespacing
        let workspaceHash = 0;
        for (let i = 0; i < workspacePath.length; i++) {
            const char = workspacePath.charCodeAt(i);
            workspaceHash = ((workspaceHash << 5) - workspaceHash) + char;
            workspaceHash = workspaceHash & workspaceHash;
        }
        const workspaceId = `ws_${Math.abs(workspaceHash).toString(36).substring(0, 6)}`;

        // By default, all documents share the workspace session
        if (!dedicated) {
            return workspaceId;
        }

        // Dedicated session for this specific document
        const filename = document.fileName;
        const basename = filename.split('/').pop() || 'default';
        const docId = basename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

        return `${workspaceId}:doc_${docId}`;
    }

    /**
     * Get the workspace root path for a document.
     */
    static getWorkspaceRoot(document: vscode.TextDocument): string | undefined {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        return workspaceFolder?.uri.fsPath;
    }
}


/**
 * IPython Completion Provider for VSCode.
 *
 * Provides completions inside Python code blocks in markdown files.
 */
export class IPythonCompletionProvider implements vscode.CompletionItemProvider {
    private client: IPythonClient;
    private codeBlockParser: CodeBlockParser;

    constructor(client: IPythonClient) {
        this.client = client;
        this.codeBlockParser = new CodeBlockParser();
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | undefined> {
        // Check if we're inside a Python code block
        const block = this.codeBlockParser.getBlockAtPosition(document, position);
        if (!block || !this.isPythonBlock(block.language)) {
            return undefined;
        }

        // Calculate cursor position within the code block
        const codeBeforeCursor = this.getCodeBeforeCursor(document, position, block);
        const cursorPos = codeBeforeCursor.length;

        // Get the full code in the block up to cursor
        const fullCode = this.getFullCodeUpToCursor(document, position, block);

        try {
            // Set session for this document
            this.client.setSession(IPythonClient.getSessionIdForDocument(document));

            const result = await this.client.complete(fullCode, cursorPos);

            if (!result.matches || result.matches.length === 0) {
                return undefined;
            }

            // Convert to VSCode completion items
            return result.matches.map((match, index) => {
                const item = new vscode.CompletionItem(match);

                // Set completion kind based on type
                const type = result.metadata.types?.[index];
                item.kind = this.getCompletionKind(type);

                // Add signature as detail
                const signature = result.metadata.signatures?.[index];
                if (signature) {
                    item.detail = signature;
                }

                // Set sort order
                item.sortText = index.toString().padStart(4, '0');

                return item;
            });
        } catch (error) {
            return undefined;
        }
    }

    private isPythonBlock(language: string): boolean {
        return ['python', 'py', 'python3'].includes(language.toLowerCase());
    }

    private getCompletionKind(type: string | undefined): vscode.CompletionItemKind {
        switch (type) {
            case 'function':
            case 'builtin_function_or_method':
                return vscode.CompletionItemKind.Function;
            case 'class':
                return vscode.CompletionItemKind.Class;
            case 'module':
                return vscode.CompletionItemKind.Module;
            case 'keyword':
                return vscode.CompletionItemKind.Keyword;
            case 'instance':
                return vscode.CompletionItemKind.Variable;
            case 'statement':
                return vscode.CompletionItemKind.Snippet;
            default:
                return vscode.CompletionItemKind.Text;
        }
    }

    private getCodeBeforeCursor(
        document: vscode.TextDocument,
        position: vscode.Position,
        block: CodeBlock
    ): string {
        const lines: string[] = [];
        for (let i = block.contentStart; i <= position.line; i++) {
            if (i === position.line) {
                lines.push(document.lineAt(i).text.substring(0, position.character));
            } else {
                lines.push(document.lineAt(i).text);
            }
        }
        return lines.join('\n');
    }

    private getFullCodeUpToCursor(
        document: vscode.TextDocument,
        position: vscode.Position,
        block: CodeBlock
    ): string {
        return this.getCodeBeforeCursor(document, position, block);
    }
}


/**
 * IPython Hover Provider for VSCode.
 *
 * Provides hover documentation inside Python code blocks.
 */
export class IPythonHoverProvider implements vscode.HoverProvider {
    private client: IPythonClient;
    private codeBlockParser: CodeBlockParser;

    constructor(client: IPythonClient) {
        this.client = client;
        this.codeBlockParser = new CodeBlockParser();
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        // Check if we're inside a Python code block
        const block = this.codeBlockParser.getBlockAtPosition(document, position);
        if (!block || !this.isPythonBlock(block.language)) {
            return undefined;
        }

        // Get the word at cursor
        const wordRange = document.getWordRangeAtPosition(position, /[\w.]+/);
        if (!wordRange) {
            return undefined;
        }

        // Get the code up to cursor for context
        const codeUpToCursor = this.getCodeUpToPosition(document, position, block);
        const cursorPos = codeUpToCursor.length;

        try {
            // Set session for this document
            this.client.setSession(IPythonClient.getSessionIdForDocument(document));

            const result = await this.client.inspect(codeUpToCursor, cursorPos);

            if (!result.found) {
                return undefined;
            }

            // Build hover content
            const contents = new vscode.MarkdownString();

            // Type and name
            if (result.type_name) {
                contents.appendMarkdown(`**${result.type_name}** `);
            }
            contents.appendMarkdown(`\`${result.name}\`\n\n`);

            // Signature
            if (result.signature) {
                contents.appendCodeblock(result.signature, 'python');
                contents.appendMarkdown('\n');
            }

            // Docstring (truncate if too long)
            if (result.docstring) {
                const docstring = result.docstring.length > 1000
                    ? result.docstring.substring(0, 1000) + '...'
                    : result.docstring;
                contents.appendMarkdown(docstring);
            }

            return new vscode.Hover(contents, wordRange);
        } catch (error) {
            return undefined;
        }
    }

    private isPythonBlock(language: string): boolean {
        return ['python', 'py', 'python3'].includes(language.toLowerCase());
    }

    private getCodeUpToPosition(
        document: vscode.TextDocument,
        position: vscode.Position,
        block: CodeBlock
    ): string {
        const lines: string[] = [];
        for (let i = block.contentStart; i <= position.line; i++) {
            if (i === position.line) {
                // Include up to end of word at cursor
                const line = document.lineAt(i).text;
                const wordRange = document.getWordRangeAtPosition(position, /[\w.]+/);
                const endChar = wordRange ? wordRange.end.character : position.character;
                lines.push(line.substring(0, endChar));
            } else {
                lines.push(document.lineAt(i).text);
            }
        }
        return lines.join('\n');
    }
}


/**
 * Code block parser for markdown files.
 */
interface CodeBlock {
    language: string;
    fenceStart: number;  // Line number of opening ```
    contentStart: number;  // First line of code
    contentEnd: number;  // Last line of code
    fenceEnd: number;  // Line number of closing ```
}

class CodeBlockParser {
    private cache: Map<string, { version: number; blocks: CodeBlock[] }> = new Map();

    /**
     * Get the code block at a given position, or undefined if not in a block.
     */
    getBlockAtPosition(document: vscode.TextDocument, position: vscode.Position): CodeBlock | undefined {
        const blocks = this.parseBlocks(document);
        return blocks.find(block =>
            position.line >= block.contentStart &&
            position.line <= block.contentEnd
        );
    }

    /**
     * Parse all code blocks in a document.
     */
    parseBlocks(document: vscode.TextDocument): CodeBlock[] {
        const key = document.uri.toString();
        const cached = this.cache.get(key);

        if (cached && cached.version === document.version) {
            return cached.blocks;
        }

        const blocks: CodeBlock[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let inBlock = false;
        let currentBlock: Partial<CodeBlock> = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (!inBlock) {
                // Look for opening fence
                const match = line.match(/^```(\w*)/);
                if (match) {
                    inBlock = true;
                    currentBlock = {
                        language: match[1] || '',
                        fenceStart: i,
                        contentStart: i + 1,
                    };
                }
            } else {
                // Look for closing fence
                if (line.startsWith('```')) {
                    currentBlock.contentEnd = i - 1;
                    currentBlock.fenceEnd = i;
                    blocks.push(currentBlock as CodeBlock);
                    inBlock = false;
                    currentBlock = {};
                }
            }
        }

        this.cache.set(key, { version: document.version, blocks });
        return blocks;
    }
}


/**
 * Callback for streaming output updates.
 */
export type StreamingOutputCallback = (output: string, done: boolean, displayData?: DisplayData[], savedAssets?: SavedAsset[]) => void;

/**
 * IPython-based execution manager.
 *
 * Replaces the brepl-based execution for Python code blocks.
 */
export class IPythonExecutionManager {
    private client: IPythonClient;
    private _serverUrlGetter: () => string;
    private codeBlockParser: CodeBlockParser;
    private outputChannel: vscode.OutputChannel;

    constructor(serverUrlOrGetter: string | (() => string)) {
        // Accept either a static URL string or a function that returns the URL
        this._serverUrlGetter = typeof serverUrlOrGetter === 'function'
            ? serverUrlOrGetter
            : () => serverUrlOrGetter;
        this.client = new IPythonClient(this._serverUrlGetter);
        this.codeBlockParser = new CodeBlockParser();
        this.outputChannel = vscode.window.createOutputChannel('mrmd IPython');
    }

    private get serverUrl(): string {
        return this._serverUrlGetter();
    }

    /**
     * Execute a code block and return the output.
     */
    async executeBlock(
        document: vscode.TextDocument,
        blockIndex: number
    ): Promise<string> {
        const blocks = this.codeBlockParser.parseBlocks(document);
        const block = blocks.filter(b => !['output', 'result'].includes(b.language))[blockIndex];

        if (!block) {
            throw new Error(`Code block ${blockIndex} not found`);
        }

        // Get the code from the block
        const code = this.getBlockCode(document, block);

        // Set session for this document
        this.client.setSession(IPythonClient.getSessionIdForDocument(document));

        // Execute
        this.outputChannel.appendLine(`[${new Date().toISOString()}] Executing: ${code.substring(0, 50)}...`);

        const result = await this.client.execute(code);

        this.outputChannel.appendLine(`[${new Date().toISOString()}] Result: success=${result.success}`);

        // Format output
        return this.formatOutput(result);
    }

    /**
     * Execute a code block with streaming output.
     * Calls onOutput with each chunk, and the final formatted output when done.
     * Falls back to regular execution if streaming endpoint unavailable.
     */
    async executeBlockStreaming(
        document: vscode.TextDocument,
        blockIndex: number,
        onOutput: StreamingOutputCallback
    ): Promise<string> {
        const blocks = this.codeBlockParser.parseBlocks(document);
        const block = blocks.filter(b => !['output', 'result'].includes(b.language))[blockIndex];

        if (!block) {
            throw new Error(`Code block ${blockIndex} not found`);
        }

        const code = this.getBlockCode(document, block);
        const sessionId = IPythonClient.getSessionIdForDocument(document);

        this.outputChannel.appendLine(`[${new Date().toISOString()}] Streaming execution: ${code.substring(0, 50)}...`);

        try {
            return await this.executeCodeStreaming(code, sessionId, onOutput);
        } catch (error) {
            // Fallback to regular execution if streaming fails (e.g., older server)
            this.outputChannel.appendLine(`Streaming failed, falling back to regular execution: ${error}`);
            const output = await this.executeBlock(document, blockIndex);
            onOutput(output, true);
            return output;
        }
    }

    /**
     * Execute code with streaming output via SSE.
     * Server handles ANSI stripping and progress bar handling.
     *
     * @param code - Code to execute
     * @param sessionId - Session identifier
     * @param onOutput - Callback for output updates
     * @param figureDir - Optional directory to save matplotlib figures
     */
    async executeCodeStreaming(
        code: string,
        sessionId: string,
        onOutput: StreamingOutputCallback,
        figureDir?: string,
        cwd?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            let finalResult: ExecutionResult | null = null;

            // Use fetch with streaming
            const requestBody: Record<string, unknown> = {
                code,
                session: sessionId,
                store_history: true,
                figure_dir: figureDir,
            };
            if (cwd) {
                requestBody.cwd = cwd;
            }
            fetch(`${this.serverUrl}/api/ipython/execute/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Streaming execution failed: ${response.statusText}`);
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error('No response body');
                }

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Parse SSE events from buffer
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    let eventType = '';
                    let eventData = '';

                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            eventType = line.slice(7);
                        } else if (line.startsWith('data: ')) {
                            eventData = line.slice(6);

                            if (eventType && eventData) {
                                try {
                                    const parsed = JSON.parse(eventData);

                                    if (eventType === 'chunk') {
                                        // Server provides accumulated output (ANSI stripped, progress handled)
                                        const accumulated = parsed.accumulated || parsed.content || '';
                                        onOutput(accumulated, false);
                                    } else if (eventType === 'result') {
                                        finalResult = parsed as ExecutionResult;
                                    } else if (eventType === 'done') {
                                        // Use server's formatted_output
                                        if (finalResult) {
                                            const formattedOutput = this.formatOutput(finalResult);
                                            // Pass display_data and saved_assets for rich outputs
                                            onOutput(formattedOutput, true, finalResult.display_data, finalResult.saved_assets);
                                            resolve(formattedOutput);
                                        } else {
                                            resolve('');
                                        }
                                    }
                                } catch (e) {
                                    this.outputChannel.appendLine(`Parse error: ${e}`);
                                }

                                eventType = '';
                                eventData = '';
                            }
                        }
                    }
                }
            }).catch(error => {
                this.outputChannel.appendLine(`Streaming error: ${error}`);
                reject(error);
            });
        });
    }

    /**
     * Execute code directly (for REPL-style usage).
     */
    async executeCode(document: vscode.TextDocument, code: string): Promise<string> {
        this.client.setSession(IPythonClient.getSessionIdForDocument(document));
        const result = await this.client.execute(code);
        return this.formatOutput(result);
    }

    /**
     * Execute code with a specific session ID and return the raw result.
     * Useful for internal operations like loading magic extensions.
     */
    async executeCodeRaw(code: string, sessionId: string): Promise<ExecutionResult> {
        this.client.setSession(sessionId);
        return await this.client.execute(code, false);
    }

    /**
     * Get the IPython client for advanced usage.
     */
    getClient(): IPythonClient {
        return this.client;
    }

    /**
     * Get the current server URL.
     */
    getCurrentServerUrl(): string {
        return this.serverUrl;
    }

    /**
     * Interrupt execution for a specific session.
     * Sends KeyboardInterrupt to the IPython shell.
     */
    async interruptSession(sessionId: string): Promise<boolean> {
        this.client.setSession(sessionId);
        const success = await this.client.interrupt();
        if (success) {
            this.outputChannel.appendLine(`[${new Date().toISOString()}] Interrupted session: ${sessionId}`);
        }
        return success;
    }

    private getBlockCode(document: vscode.TextDocument, block: CodeBlock): string {
        const lines: string[] = [];
        for (let i = block.contentStart; i <= block.contentEnd; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines.join('\n');
    }

    /**
     * Format output from execution result.
     * Uses server's formatted_output when available (preferred),
     * falls back to client-side formatting if needed.
     */
    private formatOutput(result: ExecutionResult): string {
        // Prefer server's pre-formatted output (ANSI stripped, clean)
        if (result.formatted_output) {
            return result.formatted_output;
        }

        // Fallback: client-side formatting (for older servers)
        const parts: string[] = [];

        if (result.stdout) {
            const stdout = result.stdout.replace(/^Out\[\d+\]:\s*/gm, '');
            if (stdout.trim()) {
                parts.push(stdout.trim());
            }
        }

        if (result.result && !result.stdout?.includes(result.result)) {
            parts.push(result.result);
        }

        if (result.error) {
            if (result.error.traceback) {
                parts.push(result.error.traceback);
            } else {
                parts.push(`${result.error.type}: ${result.error.message}`);
            }
        }

        for (const display of result.display_data) {
            const data = display.data || display;  // Handle both formats
            if (data['image/png']) {
                parts.push(`![output](data:image/png;base64,${data['image/png']})`);
            } else if (data['image/jpeg']) {
                parts.push(`![output](data:image/jpeg;base64,${data['image/jpeg']})`);
            } else if (data['text/html']) {
                parts.push(data['text/html']);
            } else if (data['text/plain']) {
                parts.push(data['text/plain']);
            }
        }

        return parts.join('\n');
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

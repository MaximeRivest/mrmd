/**
 * mrmd VSCode Extension
 *
 * AI-native literate programming for VS Code.
 * Uses CodeLens approach - keeps native VSCode editing with run buttons.
 *
 * By Maxime Rivest | https://mrmd.dev
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MrmdServerManager, findRunningServers, killServerOnPort } from './server-manager';
import { MrmdCodeLensProvider } from './codelens-provider';
import { MrmdCompletionProvider } from './completion-provider';
import { ExecutionManager } from './execution-manager';
import { OutputDecorationProvider, OutputFoldingProvider } from './decorations';
import { SetupManager } from './setup-manager';
import {
    IPythonClient,
    IPythonCompletionProvider,
    IPythonHoverProvider,
    IPythonExecutionManager,
    SavedAsset
} from './ipython-client';
import { VariableExplorerProvider } from './variable-explorer';
import { VariablePanelProvider } from './variable-panel';
import { OutputPanelProvider } from './output-panel';

let serverManager: MrmdServerManager;
let setupManager: SetupManager;
let executionManager: ExecutionManager;
let ipythonExecutionManager: IPythonExecutionManager;
let codeLensProvider: MrmdCodeLensProvider;
let decorationProvider: OutputDecorationProvider;
// Variable explorer - use interface so we can swap implementations
let variableExplorer: { refresh(): Promise<void> | void; dispose(): void };
let outputPanel: OutputPanelProvider;

// Execution queue for managing cell executions
interface QueuedExecution {
    id: string;
    editor: vscode.TextEditor;
    code: string;           // The actual code to execute (immutable)
    codeHash: string;       // Hash of the code for identification
    language: string;
    sessionId: string;
    abortController: AbortController;
}

const executionQueue: QueuedExecution[] = [];
let currentExecution: QueuedExecution | null = null;
let isProcessingQueue = false;

// Track which documents use dedicated (per-file) sessions instead of shared workspace session
const dedicatedSessions = new Set<string>();

// Helper to get session ID respecting dedicated session preference
function getDocumentSessionId(document: vscode.TextDocument): string {
    const isDedicated = dedicatedSessions.has(document.uri.fsPath);
    return IPythonClient.getSessionIdForDocument(document, isDedicated);
}

// Simple hash function for code identification
function hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}

// Find a block by matching its code content
function findBlockByCode(document: vscode.TextDocument, codeHash: string, provider: MrmdCodeLensProvider): { block: any; index: number } | null {
    const blocks = provider.parseCodeBlocks(document);
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (hashCode(block.code) === codeHash) {
            return { block, index: i };
        }
    }
    return null;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('mrmd extension activating...');

    // Initialize setup manager and run first-time setup check
    setupManager = new SetupManager(context);

    // Initialize server manager
    serverManager = new MrmdServerManager(context);

    // Initialize CodeLens provider
    codeLensProvider = new MrmdCodeLensProvider();

    // Initialize execution manager
    executionManager = new ExecutionManager(serverManager, codeLensProvider);

    // Initialize completion provider
    const completionProvider = new MrmdCompletionProvider(serverManager, codeLensProvider);

    // Initialize decoration provider
    decorationProvider = new OutputDecorationProvider();

    // Initialize folding provider for output blocks
    const foldingProvider = new OutputFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'markdown', scheme: 'file' },
            foldingProvider
        )
    );

    // Initialize IPython-based providers (direct shell, richer features)
    // Pass a getter function so they always use the current server URL (port is dynamic)
    const getServerUrl = () => serverManager.serverUrl;
    const ipythonClient = new IPythonClient(getServerUrl);
    ipythonExecutionManager = new IPythonExecutionManager(getServerUrl);
    const ipythonCompletionProvider = new IPythonCompletionProvider(ipythonClient);
    const ipythonHoverProvider = new IPythonHoverProvider(ipythonClient);

    // Initialize variable explorer
    const getSessionId = () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            return getDocumentSessionId(editor.document);
        }
        return 'default';
    };

    // Detect if we're in a VS Code fork (Cursor, Antigravity, etc.) that has webview issues
    const appName = vscode.env.appName.toLowerCase();
    const isVSCodeFork = appName.includes('cursor') ||
                         appName.includes('antigravity') ||
                         appName.includes('windsurf') ||
                         (!appName.includes('visual studio code') && !appName.includes('code - oss'));

    // Set context for conditional view visibility
    vscode.commands.executeCommand('setContext', 'mrmd.useTreeView', isVSCodeFork);

    if (isVSCodeFork) {
        // Use TreeView for forks (no service worker issues)
        console.log(`mrmd: Using TreeView for variable explorer (detected: ${vscode.env.appName})`);
        const treeProvider = new VariableExplorerProvider(getServerUrl, getSessionId);
        variableExplorer = treeProvider;
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('mrmd.variableTree', treeProvider)
        );
    } else {
        // Use WebView for VS Code (nicer UI)
        console.log(`mrmd: Using WebView for variable explorer (detected: ${vscode.env.appName})`);
        const webviewProvider = new VariablePanelProvider(context.extensionUri, getServerUrl, getSessionId);
        variableExplorer = webviewProvider;
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('mrmd.variablePanel', webviewProvider)
        );
    }

    // Initialize output panel for rich outputs (plots, HTML, SVG)
    outputPanel = new OutputPanelProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('mrmd.outputPanel', outputPanel)
    );

    // Register CodeLens provider for markdown files
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'markdown', scheme: 'file' },
            codeLensProvider
        )
    );

    // Register completion providers for markdown files
    // IPython provider for Python blocks (rich completions)
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'markdown', scheme: 'file' },
            ipythonCompletionProvider,
            '.', // Trigger on dot
            '(' // Trigger on open paren
        )
    );

    // Fallback brepl-based completion
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'markdown', scheme: 'file' },
            completionProvider,
            '.', // Trigger on dot
            '(' // Trigger on open paren
        )
    );

    // Register hover provider for Python documentation
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'markdown', scheme: 'file' },
            ipythonHoverProvider
        )
    );

    // Helper to check if a block is Python
    const isPythonBlock = (language: string): boolean => {
        return ['python', 'py', 'python3'].includes(language.toLowerCase());
    };

    // Map of languages that can be executed via IPython cell magics
    // These require the appropriate IPython extensions (rpy2, julia, etc.)
    const ipythonMagicLanguages: Record<string, string> = {
        'r': '%%R',
        'julia': '%%julia',
        'sh': '%%sh',
        'bash': '%%bash',
        'zsh': '%%bash',
        'ruby': '%%ruby',
        'perl': '%%perl',
        'javascript': '%%javascript',
        'js': '%%javascript',
        'html': '%%html',
        'latex': '%%latex',
        'svg': '%%svg',
        'sql': '%%sql',  // requires ipython-sql
    };

    // Map of languages that require additional packages
    const magicDependencies: Record<string, { package: string; loadMagic?: string; description: string }> = {
        'r': { package: 'rpy2', loadMagic: '%load_ext rpy2.ipython', description: 'R language support' },
        'julia': { package: 'julia', loadMagic: '%load_ext julia.magic', description: 'Julia language support' },
        'sql': { package: 'ipython-sql', loadMagic: '%load_ext sql', description: 'SQL support' },
    };

    // Track which extensions we've already loaded this session
    const loadedMagicExtensions = new Set<string>();

    // Check if language can be executed via IPython magic
    const canExecuteViaMagic = (language: string): boolean => {
        return language.toLowerCase() in ipythonMagicLanguages;
    };

    // Check and install magic dependencies if needed
    const ensureMagicDependency = async (language: string, sessionId: string): Promise<boolean> => {
        const langLower = language.toLowerCase();
        const dep = magicDependencies[langLower];

        if (!dep) {
            return true; // No dependency needed (built-in magic)
        }

        // If already loaded this session, skip
        if (loadedMagicExtensions.has(langLower)) {
            return true;
        }

        // Try to load the extension first
        try {
            if (dep.loadMagic) {
                const result = await ipythonExecutionManager.executeCodeRaw(dep.loadMagic, sessionId);
                if (result.success && !result.error) {
                    loadedMagicExtensions.add(langLower);
                    return true;
                }

                // Check if it's a "not found" error
                const errorMsg = result.error?.message || result.stderr || '';
                if (errorMsg.includes('No module named') || errorMsg.includes('ModuleNotFoundError')) {
                    // Offer to install
                    const install = await vscode.window.showWarningMessage(
                        `${dep.description} requires the '${dep.package}' package. Install it?`,
                        'Install',
                        'Cancel'
                    );

                    if (install === 'Install') {
                        // Install using %pip magic
                        const installResult = await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Installing ${dep.package}...`,
                            cancellable: false
                        }, async () => {
                            return await ipythonExecutionManager.executeCodeRaw(
                                `%pip install ${dep.package}`,
                                sessionId
                            );
                        });

                        if (!installResult.success || installResult.error) {
                            const errMsg = installResult.error?.message || installResult.stderr || 'Unknown error';
                            vscode.window.showErrorMessage(`Failed to install ${dep.package}: ${errMsg}`);
                            return false;
                        }

                        // Try loading again
                        const retryResult = await ipythonExecutionManager.executeCodeRaw(dep.loadMagic, sessionId);
                        if (retryResult.success && !retryResult.error) {
                            loadedMagicExtensions.add(langLower);
                            vscode.window.showInformationMessage(`${dep.package} installed and loaded!`);
                            return true;
                        } else {
                            const errMsg = retryResult.error?.message || retryResult.stderr || 'Unknown error';
                            vscode.window.showErrorMessage(`Failed to load ${dep.package}: ${errMsg}`);
                            return false;
                        }
                    }
                    return false;
                }
            }
        } catch (error) {
            // Continue anyway, the actual execution will show the error
        }

        return true;
    };

    // Wrap code with appropriate IPython cell magic
    const wrapWithMagic = (code: string, language: string): string => {
        const magic = ipythonMagicLanguages[language.toLowerCase()];
        if (magic) {
            return `${magic}\n${code}`;
        }
        return code;
    };

    // Helper to find block at cursor and get executable blocks
    const getBlockAtCursor = (editor: vscode.TextEditor) => {
        const position = editor.selection.active;
        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const executableBlocks = blocks.filter(b =>
            !['output', 'result'].includes(b.language)
        );

        const blockIndex = executableBlocks.findIndex(block =>
            position.line >= block.fenceStart &&
            position.line <= block.fenceEnd
        );

        return { blocks, executableBlocks, blockIndex };
    };

    // Helper to get code from a block
    const getBlockCode = (document: vscode.TextDocument, block: any): string => {
        const lines: string[] = [];
        // startLine is first line of content (after fence), endLine is last line of content (before closing fence)
        for (let i = block.startLine; i < block.fenceEnd; i++) {
            lines.push(document.lineAt(i).text);
        }
        return lines.join('\n');
    };

    // Helper to find next block of same language
    const findNextBlockOfSameLanguage = (executableBlocks: any[], currentBlockIndex: number, language: string): number => {
        const langLower = language.toLowerCase();
        const sameLangGroup = ['python', 'py', 'python3'];
        const isCurrentLangPython = sameLangGroup.includes(langLower);

        for (let i = currentBlockIndex + 1; i < executableBlocks.length; i++) {
            const blockLang = executableBlocks[i].language.toLowerCase();
            if (isCurrentLangPython && sameLangGroup.includes(blockLang)) {
                return i;
            } else if (!isCurrentLangPython && blockLang === langLower) {
                return i;
            }
        }
        return -1; // No next block of same language
    };

    // Helper to create a new code block of given language after a position
    const createNewCodeBlock = async (editor: vscode.TextEditor, afterLine: number, language: string): Promise<number> => {
        const document = editor.document;
        const insertPos = new vscode.Position(afterLine, document.lineAt(afterLine).text.length);

        // Insert new code block with blank line
        const newBlock = `\n\n\`\`\`${language}\n\n\`\`\``;

        await editor.edit(editBuilder => {
            editBuilder.insert(insertPos, newBlock);
        });

        // Return the line where cursor should go (inside the new block)
        // afterLine + 2 (blank line + fence) + 1 (content line)
        return afterLine + 3;
    };

    // Helper to move cursor to a specific line
    const moveCursorToLine = (editor: vscode.TextEditor, line: number) => {
        const newPosition = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(newPosition, newPosition);
        editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenter);
    };

    // Helper to find any block (including output) at cursor
    const getAnyBlockAtCursor = (editor: vscode.TextEditor) => {
        const position = editor.selection.active;
        const blocks = codeLensProvider.parseCodeBlocks(editor.document);

        const blockIndex = blocks.findIndex(block =>
            position.line >= block.fenceStart &&
            position.line <= block.fenceEnd
        );

        return { blocks, blockIndex, block: blockIndex >= 0 ? blocks[blockIndex] : null };
    };

    // Helper to find the output block for a code block
    // Output can be immediately after or with a blank line in between
    const findOutputForBlock = (blocks: any[], codeBlock: any) => {
        return blocks.find(b =>
            (b.language === 'output' || b.language === 'result') &&
            (b.fenceStart === codeBlock.fenceEnd + 1 || b.fenceStart === codeBlock.fenceEnd + 2)
        );
    };

    // Helper to find the parent code block for an output block
    const findParentForOutput = (blocks: any[], outputBlock: any) => {
        return blocks.find(b =>
            !['output', 'result'].includes(b.language) &&
            b.fenceEnd + 1 === outputBlock.fenceStart
        );
    };

    // Helper to check if a block is an output block
    const isOutputBlock = (block: any) => {
        return ['output', 'result'].includes(block.language);
    };

    // Helper to check if a block is collapsed
    const isBlockCollapsed = (document: vscode.TextDocument, block: any) => {
        const fenceLine = document.lineAt(block.fenceStart).text;
        return fenceLine.includes(' collapsed');
    };

    // Navigate to previous code block
    const goToPreviousBlock = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const executableBlocks = blocks.filter(b => !['output', 'result'].includes(b.language));
        const position = editor.selection.active;

        if (executableBlocks.length === 0) return;

        // Find which block we're in or near (including inside the block's fences)
        let currentBlockIndex = -1;
        for (let i = 0; i < executableBlocks.length; i++) {
            if (position.line >= executableBlocks[i].fenceStart && position.line <= executableBlocks[i].fenceEnd) {
                currentBlockIndex = i;
                break;
            }
        }

        if (currentBlockIndex > 0) {
            // We're in a block - go to previous
            moveCursorToLine(editor, executableBlocks[currentBlockIndex - 1].startLine);
        } else if (currentBlockIndex === 0) {
            // We're in the first block - stay put
            return;
        } else {
            // Not in any block - find the nearest block before cursor
            for (let i = executableBlocks.length - 1; i >= 0; i--) {
                if (executableBlocks[i].fenceEnd < position.line) {
                    moveCursorToLine(editor, executableBlocks[i].startLine);
                    return;
                }
            }
            // Cursor is before all blocks - go to first
            if (executableBlocks.length > 0 && executableBlocks[0].fenceStart > position.line) {
                moveCursorToLine(editor, executableBlocks[0].startLine);
            }
        }
    };

    // Navigate to next code block
    const goToNextBlock = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const executableBlocks = blocks.filter(b => !['output', 'result'].includes(b.language));
        const position = editor.selection.active;

        if (executableBlocks.length === 0) return;

        // Find which block we're in (including inside the block's fences)
        let currentBlockIndex = -1;
        for (let i = 0; i < executableBlocks.length; i++) {
            if (position.line >= executableBlocks[i].fenceStart && position.line <= executableBlocks[i].fenceEnd) {
                currentBlockIndex = i;
                break;
            }
        }

        if (currentBlockIndex >= 0 && currentBlockIndex < executableBlocks.length - 1) {
            // We're in a block and there's a next one - go to it
            moveCursorToLine(editor, executableBlocks[currentBlockIndex + 1].startLine);
        } else if (currentBlockIndex === executableBlocks.length - 1) {
            // We're in the last block - stay put
            return;
        } else {
            // Not in any block - find the nearest block after cursor
            for (const block of executableBlocks) {
                if (block.fenceStart > position.line) {
                    moveCursorToLine(editor, block.startLine);
                    return;
                }
            }
        }
    };

    // Move block up (with its output)
    const moveBlockUp = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const document = editor.document;
        const blocks = codeLensProvider.parseCodeBlocks(document);
        const executableBlocks = blocks.filter(b => !['output', 'result'].includes(b.language));
        const position = editor.selection.active;

        // Find current block
        let blockIndex = -1;
        for (let i = 0; i < executableBlocks.length; i++) {
            if (position.line >= executableBlocks[i].fenceStart && position.line <= executableBlocks[i].fenceEnd) {
                blockIndex = i;
                break;
            }
        }

        if (blockIndex <= 0) return; // Already at top or not in a block

        const currentBlock = executableBlocks[blockIndex];
        const prevBlock = executableBlocks[blockIndex - 1];

        // Find outputs - look for output block starting right after code block fence (with or without blank line)
        const currentOutput = blocks.find(b =>
            ['output', 'result'].includes(b.language) &&
            b.fenceStart > currentBlock.fenceEnd &&
            b.fenceStart <= currentBlock.fenceEnd + 2
        );
        const prevOutput = blocks.find(b =>
            ['output', 'result'].includes(b.language) &&
            b.fenceStart > prevBlock.fenceEnd &&
            b.fenceStart <= prevBlock.fenceEnd + 2
        );

        // Calculate ranges
        const currentStart = currentBlock.fenceStart;
        const currentEnd = currentOutput ? currentOutput.fenceEnd : currentBlock.fenceEnd;
        const prevStart = prevBlock.fenceStart;
        const prevEnd = prevOutput ? prevOutput.fenceEnd : prevBlock.fenceEnd;

        // Calculate cursor offset within the block
        const cursorOffset = position.line - currentStart;

        // Get the three regions:
        // 1. Previous block (with output)
        // 2. Content between (markdown text, etc.)
        // 3. Current block (with output)
        const prevText = document.getText(new vscode.Range(
            new vscode.Position(prevStart, 0),
            new vscode.Position(prevEnd, document.lineAt(prevEnd).text.length)
        ));

        const betweenText = prevEnd + 1 < currentStart
            ? document.getText(new vscode.Range(
                new vscode.Position(prevEnd + 1, 0),
                new vscode.Position(currentStart - 1, document.lineAt(currentStart - 1).text.length)
            ))
            : '';

        const currentText = document.getText(new vscode.Range(
            new vscode.Position(currentStart, 0),
            new vscode.Position(currentEnd, document.lineAt(currentEnd).text.length)
        ));

        // Rebuild: current, between, previous
        const newText = betweenText
            ? currentText + '\n' + betweenText + '\n' + prevText
            : currentText + '\n' + prevText;

        await editor.edit(editBuilder => {
            editBuilder.replace(
                new vscode.Range(
                    new vscode.Position(prevStart, 0),
                    new vscode.Position(currentEnd, document.lineAt(currentEnd).text.length)
                ),
                newText
            );
        });

        // Move cursor to new position (current block is now at prevStart)
        moveCursorToLine(editor, prevStart + cursorOffset);
    };

    // Move block down (with its output)
    const moveBlockDown = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const document = editor.document;
        const blocks = codeLensProvider.parseCodeBlocks(document);
        const executableBlocks = blocks.filter(b => !['output', 'result'].includes(b.language));
        const position = editor.selection.active;

        // Find current block
        let blockIndex = -1;
        for (let i = 0; i < executableBlocks.length; i++) {
            if (position.line >= executableBlocks[i].fenceStart && position.line <= executableBlocks[i].fenceEnd) {
                blockIndex = i;
                break;
            }
        }

        if (blockIndex < 0 || blockIndex >= executableBlocks.length - 1) return; // Not in block or already at bottom

        const currentBlock = executableBlocks[blockIndex];
        const nextBlock = executableBlocks[blockIndex + 1];

        // Find outputs
        const currentOutput = blocks.find(b =>
            ['output', 'result'].includes(b.language) &&
            b.fenceStart > currentBlock.fenceEnd &&
            b.fenceStart <= currentBlock.fenceEnd + 2
        );
        const nextOutput = blocks.find(b =>
            ['output', 'result'].includes(b.language) &&
            b.fenceStart > nextBlock.fenceEnd &&
            b.fenceStart <= nextBlock.fenceEnd + 2
        );

        // Calculate ranges
        const currentStart = currentBlock.fenceStart;
        const currentEnd = currentOutput ? currentOutput.fenceEnd : currentBlock.fenceEnd;
        const nextStart = nextBlock.fenceStart;
        const nextEnd = nextOutput ? nextOutput.fenceEnd : nextBlock.fenceEnd;

        // Calculate cursor offset
        const cursorOffset = position.line - currentStart;

        // Get the three regions
        const currentText = document.getText(new vscode.Range(
            new vscode.Position(currentStart, 0),
            new vscode.Position(currentEnd, document.lineAt(currentEnd).text.length)
        ));

        const betweenText = currentEnd + 1 < nextStart
            ? document.getText(new vscode.Range(
                new vscode.Position(currentEnd + 1, 0),
                new vscode.Position(nextStart - 1, document.lineAt(nextStart - 1).text.length)
            ))
            : '';

        const nextText = document.getText(new vscode.Range(
            new vscode.Position(nextStart, 0),
            new vscode.Position(nextEnd, document.lineAt(nextEnd).text.length)
        ));

        // Rebuild: next, between, current
        const newText = betweenText
            ? nextText + '\n' + betweenText + '\n' + currentText
            : nextText + '\n' + currentText;

        // Calculate new cursor position
        const nextBlockLines = nextEnd - nextStart + 1;
        const betweenLines = betweenText ? betweenText.split('\n').length : 0;

        await editor.edit(editBuilder => {
            editBuilder.replace(
                new vscode.Range(
                    new vscode.Position(currentStart, 0),
                    new vscode.Position(nextEnd, document.lineAt(nextEnd).text.length)
                ),
                newText
            );
        });

        // Move cursor: current block is now after next block and between content
        const newCursorLine = currentStart + nextBlockLines + (betweenText ? betweenLines + 1 : 1) + cursorOffset;
        moveCursorToLine(editor, newCursorLine);
    };

    // Delete output block (works from code block or output block)
    const deleteOutput = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { blocks, block } = getAnyBlockAtCursor(editor);
        if (!block) return;

        let outputBlock: any;
        if (isOutputBlock(block)) {
            outputBlock = block;
        } else {
            outputBlock = findOutputForBlock(blocks, block);
        }

        if (!outputBlock) return;

        const document = editor.document;
        await editor.edit(editBuilder => {
            // Delete the output block including the newline before it
            const startLine = outputBlock.fenceStart > 0 ? outputBlock.fenceStart - 1 : 0;
            const startChar = outputBlock.fenceStart > 0 ? document.lineAt(startLine).text.length : 0;
            editBuilder.delete(new vscode.Range(
                new vscode.Position(startLine, startChar),
                new vscode.Position(outputBlock.fenceEnd, document.lineAt(outputBlock.fenceEnd).text.length)
            ));
        });
    };

    // Clear all outputs in document
    const clearAllOutputs = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const outputBlocks = blocks.filter(b => isOutputBlock(b)).reverse(); // Reverse to delete from bottom

        const document = editor.document;
        await editor.edit(editBuilder => {
            for (const outputBlock of outputBlocks) {
                const startLine = outputBlock.fenceStart > 0 ? outputBlock.fenceStart - 1 : 0;
                const startChar = outputBlock.fenceStart > 0 ? document.lineAt(startLine).text.length : 0;
                editBuilder.delete(new vscode.Range(
                    new vscode.Position(startLine, startChar),
                    new vscode.Position(outputBlock.fenceEnd, document.lineAt(outputBlock.fenceEnd).text.length)
                ));
            }
        });

        vscode.window.showInformationMessage(`Cleared ${outputBlocks.length} output block(s)`);
    };

    // Toggle collapse on output block - just use VS Code's native folding
    const toggleCollapse = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { blocks, block } = getAnyBlockAtCursor(editor);
        if (!block) return;

        let outputBlock: any;
        if (isOutputBlock(block)) {
            outputBlock = block;
        } else {
            outputBlock = findOutputForBlock(blocks, block);
        }

        if (!outputBlock) return;

        const savedPosition = editor.selection.active;
        editor.selection = new vscode.Selection(
            new vscode.Position(outputBlock.fenceStart, 0),
            new vscode.Position(outputBlock.fenceStart, 0)
        );
        await vscode.commands.executeCommand('editor.toggleFold');
        editor.selection = new vscode.Selection(savedPosition, savedPosition);
    };

    // Collapse output - use VS Code's native folding
    const collapseOutput = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { blocks, block } = getAnyBlockAtCursor(editor);
        if (!block) return;

        let outputBlock: any;
        if (isOutputBlock(block)) {
            outputBlock = block;
        } else {
            outputBlock = findOutputForBlock(blocks, block);
        }

        if (!outputBlock) return;

        const savedPosition = editor.selection.active;
        editor.selection = new vscode.Selection(
            new vscode.Position(outputBlock.fenceStart, 0),
            new vscode.Position(outputBlock.fenceStart, 0)
        );
        await vscode.commands.executeCommand('editor.fold');
        editor.selection = new vscode.Selection(savedPosition, savedPosition);
    };

    // Expand output - use VS Code's native folding
    const expandOutput = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { blocks, block } = getAnyBlockAtCursor(editor);
        if (!block) return;

        let outputBlock: any;
        if (isOutputBlock(block)) {
            outputBlock = block;
        } else {
            outputBlock = findOutputForBlock(blocks, block);
        }

        if (!outputBlock) return;

        const savedPosition = editor.selection.active;
        editor.selection = new vscode.Selection(
            new vscode.Position(outputBlock.fenceStart, 0),
            new vscode.Position(outputBlock.fenceStart, 0)
        );
        await vscode.commands.executeCommand('editor.unfold');
        editor.selection = new vscode.Selection(savedPosition, savedPosition);
    };

    // Collapse all outputs - use VS Code's native folding
    const collapseAllOutputs = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const outputBlocks = blocks.filter(b => isOutputBlock(b));
        const savedPosition = editor.selection.active;

        for (const outputBlock of outputBlocks) {
            editor.selection = new vscode.Selection(
                new vscode.Position(outputBlock.fenceStart, 0),
                new vscode.Position(outputBlock.fenceStart, 0)
            );
            await vscode.commands.executeCommand('editor.fold');
        }
        editor.selection = new vscode.Selection(savedPosition, savedPosition);
    };

    // Expand all outputs - use VS Code's native folding
    const expandAllOutputs = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        const outputBlocks = blocks.filter(b => isOutputBlock(b));
        const savedPosition = editor.selection.active;

        for (const outputBlock of outputBlocks) {
            editor.selection = new vscode.Selection(
                new vscode.Position(outputBlock.fenceStart, 0),
                new vscode.Position(outputBlock.fenceStart, 0)
            );
            await vscode.commands.executeCommand('editor.unfold');
        }
        editor.selection = new vscode.Selection(savedPosition, savedPosition);
    };

    // Split block at cursor
    const splitBlock = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { block } = getAnyBlockAtCursor(editor);
        if (!block || isOutputBlock(block)) return;

        const position = editor.selection.active;
        if (position.line <= block.startLine || position.line >= block.fenceEnd) return;

        const document = editor.document;
        const language = block.language;
        const fence = '`'.repeat(block.fenceLength || 3);

        await editor.edit(editBuilder => {
            // Insert closing fence, blank line, opening fence at cursor line
            const insertPos = new vscode.Position(position.line, 0);
            editBuilder.insert(insertPos, `${fence}\n\n${fence}${language}\n`);
        });

        // Move cursor to new block
        moveCursorToLine(editor, position.line + 3);
    };

    // Merge with next block of same language
    const mergeBlocks = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') return;

        const { blocks, executableBlocks, blockIndex } = getBlockAtCursor(editor);
        if (blockIndex < 0 || blockIndex >= executableBlocks.length - 1) return;

        const currentBlock = executableBlocks[blockIndex];
        const nextBlock = executableBlocks[blockIndex + 1];

        // Check same language
        const sameLang = currentBlock.language.toLowerCase() === nextBlock.language.toLowerCase() ||
            (isPythonBlock(currentBlock.language) && isPythonBlock(nextBlock.language));
        if (!sameLang) {
            vscode.window.showWarningMessage('Can only merge blocks of the same language');
            return;
        }

        // Check if there's an output between them - remove it
        const outputBetween = findOutputForBlock(blocks, currentBlock);

        const document = editor.document;
        await editor.edit(editBuilder => {
            // Delete from current block's closing fence to next block's opening fence (inclusive)
            const deleteStart = currentBlock.fenceEnd;
            const deleteEnd = nextBlock.startLine;
            editBuilder.delete(new vscode.Range(
                new vscode.Position(deleteStart, 0),
                new vscode.Position(deleteEnd, 0)
            ));
        });
    };

    // Select Python environment
    const selectPythonEnvironment = async () => {
        const config = vscode.workspace.getConfiguration('mrmd');
        const currentPath = config.get<string>('pythonPath', '');

        type PythonOption = { label: string; description?: string; detail?: string; path: string };
        const options: PythonOption[] = [];

        // Option to auto-detect
        options.push({
            label: '$(search) Auto-detect from .venv',
            description: 'Look for .venv in workspace or markdown folder',
            path: '',
        });

        // Find .venv folders in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        for (const folder of workspaceFolders) {
            const venvPath = vscode.Uri.joinPath(folder.uri, '.venv', 'bin', 'python').fsPath;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(venvPath));
                options.push({
                    label: `$(folder) ${folder.name}/.venv`,
                    description: venvPath,
                    path: venvPath,
                });
            } catch {
                // .venv doesn't exist in this folder
            }
        }

        // Option to browse
        options.push({
            label: '$(file-directory) Browse...',
            description: 'Select a Python executable or venv folder',
            path: 'browse',
        });

        // Show current if set
        if (currentPath) {
            options.unshift({
                label: `$(check) Current: ${currentPath}`,
                description: 'Currently selected',
                path: currentPath,
            });
        }

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select Python environment for mrmd',
        });

        if (!selected) return;

        let pythonPath = selected.path;

        if (pythonPath === 'browse') {
            const result = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Python or venv folder',
                filters: {
                    'Python': ['exe', ''],
                    'All': ['*'],
                },
            });

            if (!result || result.length === 0) return;

            pythonPath = result[0].fsPath;

            // If user selected a folder, look for bin/python or Scripts/python.exe
            try {
                const stat = await vscode.workspace.fs.stat(result[0]);
                if (stat.type === vscode.FileType.Directory) {
                    // Check for bin/python (Unix) or Scripts/python.exe (Windows)
                    const unixPath = vscode.Uri.joinPath(result[0], 'bin', 'python').fsPath;
                    const winPath = vscode.Uri.joinPath(result[0], 'Scripts', 'python.exe').fsPath;
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(unixPath));
                        pythonPath = unixPath;
                    } catch {
                        try {
                            await vscode.workspace.fs.stat(vscode.Uri.file(winPath));
                            pythonPath = winPath;
                        } catch {
                            vscode.window.showWarningMessage('Could not find Python in selected folder');
                            return;
                        }
                    }
                }
            } catch {
                // Use as-is
            }
        }

        // Save to workspace settings
        await config.update('pythonPath', pythonPath, vscode.ConfigurationTarget.Workspace);

        if (pythonPath) {
            vscode.window.showInformationMessage(`Python set to: ${pythonPath}`);
        } else {
            vscode.window.showInformationMessage('Python set to auto-detect');
        }

        // Offer to restart server if running
        if (serverManager.isRunning) {
            const restart = await vscode.window.showInformationMessage(
                'Restart server to use new Python environment?',
                'Restart',
                'Later'
            );
            if (restart === 'Restart') {
                await serverManager.restart();
            }
        }
    };

    // Track running/queued states by code hash
    const runningHashes = new Set<string>();
    const queuedHashes = new Set<string>();

    // Update decorations based on current hash states
    const updateExecutionDecorations = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        // Clear all status first
        decorationProvider.clearAllStatus();

        // Find current line numbers for running/queued blocks
        const blocks = codeLensProvider.parseCodeBlocks(editor.document);
        for (const block of blocks) {
            const blockHash = hashCode(block.code);
            if (runningHashes.has(blockHash)) {
                decorationProvider.setRunning(block.fenceStart);
            } else if (queuedHashes.has(blockHash)) {
                decorationProvider.setQueued(block.fenceStart);
            }
        }

        decorationProvider.updateDecorations(editor);
    };

    // Queue an execution and process it
    const queueExecution = (execution: QueuedExecution) => {
        executionQueue.push(execution);
        queuedHashes.add(execution.codeHash);
        updateExecutionDecorations();
        processQueue();
    };

    // Process the execution queue
    const processQueue = async () => {
        if (isProcessingQueue || executionQueue.length === 0) {
            return;
        }

        isProcessingQueue = true;

        // Ensure server is running before processing any executions
        if (!serverManager.isRunning) {
            const config = vscode.workspace.getConfiguration('mrmd');
            const autoStart = config.get<boolean>('autoStartServer', true);

            if (autoStart) {
                const started = await serverManager.start();
                if (!started) {
                    // Server failed to start - it will offer to install mrmd if needed
                    // Clear the queue since we can't execute
                    for (const exec of executionQueue) {
                        queuedHashes.delete(exec.codeHash);
                    }
                    executionQueue.length = 0;
                    isProcessingQueue = false;
                    updateExecutionDecorations();
                    return;
                }
            } else {
                vscode.window.showWarningMessage('mrmd server is not running. Start it with "mrmd: Start Server" command.');
                isProcessingQueue = false;
                return;
            }
        }

        while (executionQueue.length > 0) {
            const execution = executionQueue.shift()!;
            currentExecution = execution;

            // Update state: running, not queued
            queuedHashes.delete(execution.codeHash);
            runningHashes.add(execution.codeHash);
            updateExecutionDecorations();

            try {
                // Check if this is Python or a language we can execute via IPython magic
                const useIPython = isPythonBlock(execution.language) || canExecuteViaMagic(execution.language);

                if (useIPython) {
                    // For non-Python languages, ensure the magic extension is loaded
                    if (!isPythonBlock(execution.language) && canExecuteViaMagic(execution.language)) {
                        const ready = await ensureMagicDependency(execution.language, execution.sessionId);
                        if (!ready) {
                            // User cancelled or install failed, skip this execution
                            continue;
                        }
                    }

                    // Wrap non-Python code with appropriate cell magic
                    let codeToExecute = execution.code;
                    if (!isPythonBlock(execution.language) && canExecuteViaMagic(execution.language)) {
                        codeToExecute = wrapWithMagic(execution.code, execution.language);
                    }

                    // Calculate figure directory: .mrmd_assets/ next to the markdown file
                    const docUri = execution.editor.document.uri;
                    const docDir = vscode.Uri.joinPath(docUri, '..');
                    const figureDir = vscode.Uri.joinPath(docDir, '.mrmd_assets').fsPath;

                    // Get workspace root for working directory
                    const workspaceRoot = IPythonClient.getWorkspaceRoot(execution.editor.document);

                    // Use streaming execution for live output updates
                    await ipythonExecutionManager.executeCodeStreaming(
                        codeToExecute,
                        execution.sessionId,
                        async (output, done, displayData, savedAssets) => {
                            // Check for abort
                            if (execution.abortController.signal.aborted) {
                                return;
                            }

                            // Find the current block by code hash (robust to line shifts)
                            const found = findBlockByCode(execution.editor.document, execution.codeHash, codeLensProvider);

                            if (found) {
                                const streaming = !done;
                                await executionManager.injectOutput(execution.editor, found.block, output, streaming);
                                // Update decorations after output injection (lines may have shifted)
                                updateExecutionDecorations();
                            }

                            // Handle saved assets - inject appropriate markdown after output block
                            if (done && savedAssets && savedAssets.length > 0) {

                                // Get relative paths from the markdown file
                                const docPath = execution.editor.document.uri.fsPath;
                                const docDirPath = path.dirname(docPath);

                                // Build markdown for each asset type
                                const markdownParts: string[] = [];

                                for (const asset of savedAssets) {
                                    const relativePath = path.relative(docDirPath, asset.path);
                                    // Use forward slashes for markdown compatibility
                                    const mdPath = relativePath.replace(/\\/g, '/');

                                    switch (asset.asset_type) {
                                        case 'image':
                                            // PNG images - standard markdown image
                                            markdownParts.push(`![](${mdPath})`);
                                            break;
                                        case 'svg':
                                            // SVG - standard markdown image (works in most renderers)
                                            markdownParts.push(`![](${mdPath})`);
                                            break;
                                        case 'html':
                                            // HTML - read and inline the content directly
                                            try {
                                                const htmlContent = fs.readFileSync(asset.path, 'utf-8');
                                                // Extract just the body content (skip the wrapper we added)
                                                const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
                                                if (bodyMatch) {
                                                    const bodyContent = bodyMatch[1].trim();
                                                    markdownParts.push(bodyContent);
                                                } else {
                                                    markdownParts.push(htmlContent);
                                                }
                                            } catch (e) {
                                                markdownParts.push(`[View output](${mdPath})`);
                                            }
                                            break;
                                    }
                                }

                                // Insert markdown after the output block
                                if (markdownParts.length > 0 && found) {
                                    const markdown = markdownParts.join('\n\n');
                                    await executionManager.insertAfterOutput(execution.editor, found.block, markdown);
                                    updateExecutionDecorations();
                                }
                            }

                            // Send rich outputs (plots, HTML, etc.) to output panel
                            if (done && displayData && displayData.length > 0) {
                                for (const display of displayData) {
                                    // Only add to output panel if it has rich content (not just text/plain)
                                    const hasRichContent = display.data && (
                                        display.data['image/png'] ||
                                        display.data['image/svg+xml'] ||
                                        display.data['text/html'] ||
                                        display.data['text/latex'] ||
                                        display.data['application/json']
                                    );
                                    if (hasRichContent) {
                                        outputPanel.addOutput(display);
                                    }
                                }
                            }
                        },
                        figureDir,  // Pass the figure directory
                        workspaceRoot  // Pass workspace root as working directory
                    );
                } else {
                    // Find block for non-Python execution (fallback)
                    const found = findBlockByCode(execution.editor.document, execution.codeHash, codeLensProvider);
                    if (found) {
                        await executionManager.runCodeBlock(
                            execution.editor.document.uri,
                            found.index,
                            found.block
                        );
                    }
                }
            } catch (error) {
                if (!execution.abortController.signal.aborted) {
                    vscode.window.showErrorMessage(`Execution failed: ${error}`);
                }
            } finally {
                // Clear running state
                runningHashes.delete(execution.codeHash);
                updateExecutionDecorations();

                // Refresh variable panel after execution
                variableExplorer.refresh();
            }

            currentExecution = null;
        }

        isProcessingQueue = false;
    };

    // Cancel execution for the cell at cursor (or remove from queue)
    // This does both client-side cancellation AND server-side interrupt
    const cancelExecutionAtCursor = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            return;
        }

        const { executableBlocks, blockIndex } = getBlockAtCursor(editor);
        if (blockIndex === -1) {
            return; // Not in a code block, do nothing
        }

        const block = executableBlocks[blockIndex];
        const blockHash = hashCode(block.code);

        // Check if this cell is currently running
        if (currentExecution && currentExecution.codeHash === blockHash) {
            // 1. Abort the client-side fetch (stops receiving output)
            currentExecution.abortController.abort();

            // 2. Send interrupt to server (actually stops Python execution)
            if (isPythonBlock(currentExecution.language)) {
                await ipythonExecutionManager.interruptSession(currentExecution.sessionId);
            }

            runningHashes.delete(blockHash);
            updateExecutionDecorations();
            vscode.window.showInformationMessage('Execution interrupted');
            return;
        }

        // Check if this cell is in the queue
        const queueIndex = executionQueue.findIndex(exec => exec.codeHash === blockHash);
        if (queueIndex !== -1) {
            const removed = executionQueue.splice(queueIndex, 1)[0];
            removed.abortController.abort();
            queuedHashes.delete(blockHash);
            updateExecutionDecorations();
            vscode.window.showInformationMessage('Removed from queue');
        }
    };

    // Register commands
    context.subscriptions.push(
        // Run code block from CodeLens
        vscode.commands.registerCommand('mrmd.runCodeBlock', async (uri, blockIndex, block) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // Get code and queue execution
            const code = getBlockCode(editor.document, block);
            const sessionId = getDocumentSessionId(editor.document);

            queueExecution({
                id: `${Date.now()}-${Math.random()}`,
                editor,
                code,
                codeHash: hashCode(code),
                language: block.language,
                sessionId,
                abortController: new AbortController(),
            });
        }),

        // Ctrl+Enter: Run block, stay in place (like Jupyter)
        vscode.commands.registerCommand('mrmd.runBlock', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                return;
            }

            const { executableBlocks, blockIndex } = getBlockAtCursor(editor);

            if (blockIndex === -1) {
                vscode.window.showWarningMessage('No code block at cursor');
                return;
            }

            const block = executableBlocks[blockIndex];
            const code = getBlockCode(editor.document, block);
            const sessionId = getDocumentSessionId(editor.document);

            queueExecution({
                id: `${Date.now()}-${Math.random()}`,
                editor,
                code,
                codeHash: hashCode(code),
                language: block.language,
                sessionId,
                abortController: new AbortController(),
            });
        }),

        // Shift+Enter: Run block and move to next IMMEDIATELY (before execution)
        vscode.commands.registerCommand('mrmd.runBlockAndAdvance', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                return;
            }

            const { executableBlocks, blockIndex } = getBlockAtCursor(editor);

            if (blockIndex === -1) {
                vscode.window.showWarningMessage('No code block at cursor');
                return;
            }

            const block = executableBlocks[blockIndex];
            const language = block.language;
            const code = getBlockCode(editor.document, block);
            const sessionId = getDocumentSessionId(editor.document);

            // IMMEDIATELY queue the execution (non-blocking)
            queueExecution({
                id: `${Date.now()}-${Math.random()}`,
                editor,
                code,
                codeHash: hashCode(code),
                language: block.language,
                sessionId,
                abortController: new AbortController(),
            });

            // IMMEDIATELY move cursor to next block (before execution completes)
            // Find next block of same language
            const nextBlockIndex = findNextBlockOfSameLanguage(executableBlocks, blockIndex, language);

            if (nextBlockIndex !== -1) {
                // Move to existing block (startLine is first line of code content)
                const nextBlock = executableBlocks[nextBlockIndex];
                moveCursorToLine(editor, nextBlock.startLine);
            } else {
                // Create new block after the output (or after code block if no output)
                const existingOutput = codeLensProvider.findOutputBlock(editor.document, block.fenceEnd);
                const insertAfterLine = existingOutput ? existingOutput.end : block.fenceEnd;

                const newBlockLine = await createNewCodeBlock(editor, insertAfterLine, language);
                moveCursorToLine(editor, newBlockLine);
            }
        }),

        // Cancel execution for cell at cursor
        vscode.commands.registerCommand('mrmd.cancelExecution', cancelExecutionAtCursor),

        // Run all code blocks
        vscode.commands.registerCommand('mrmd.runAllBlocks', async () => {
            await executionManager.runAllBlocks();
        }),

        // Variable explorer commands
        vscode.commands.registerCommand('mrmd.refreshVariables', () => {
            variableExplorer.refresh();
        }),

        vscode.commands.registerCommand('mrmd.clearVariables', async () => {
            // Clear variables in the current session by running reset command
            const sessionId = getSessionId();
            try {
                await ipythonExecutionManager.executeCodeRaw('%reset -f', sessionId);
                variableExplorer.refresh();
                vscode.window.showInformationMessage('Variables cleared');
            } catch {
                vscode.window.showErrorMessage('Failed to clear variables');
            }
        }),

        // Show variable detail (for non-expandable items)
        vscode.commands.registerCommand('mrmd.showVariableDetail', async (path: string, variable: any) => {
            // Show in output channel or info message
            const lines: string[] = [];
            lines.push(`Variable: ${variable.name}`);
            lines.push(`Type: ${variable.module ? variable.module + '.' : ''}${variable.type}`);
            if (variable.shape) lines.push(`Shape: ${variable.shape}`);
            if (variable.dtype) lines.push(`Dtype: ${variable.dtype}`);
            if (variable.size !== undefined) lines.push(`Size: ${variable.size}`);
            if (variable.preview) lines.push(`Value: ${variable.preview}`);

            // For simple values, copy to clipboard
            if (variable.preview && variable.kind === 'primitive') {
                await vscode.env.clipboard.writeText(variable.preview);
                vscode.window.showInformationMessage(`${variable.name} = ${variable.preview} (copied to clipboard)`);
            } else {
                vscode.window.showInformationMessage(lines.join(' | '));
            }
        }),

        // Copy variable to clipboard
        vscode.commands.registerCommand('mrmd.copyVariable', async (item: any) => {
            if (item?.path) {
                await vscode.env.clipboard.writeText(item.path);
                vscode.window.showInformationMessage(`Copied: ${item.path}`);
            }
        }),

        // Insert variable into editor
        vscode.commands.registerCommand('mrmd.insertVariable', async (item: any) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && item?.path) {
                await editor.edit(editBuilder => {
                    editBuilder.insert(editor.selection.active, item.path);
                });
            }
        }),

        // View DataFrame/array in new tab (for data items)
        vscode.commands.registerCommand('mrmd.viewData', async (item: any) => {
            if (!item?.path) return;

            const sessionId = getSessionId();
            try {
                // Execute code to display the data
                const result = await ipythonExecutionManager.executeCodeRaw(
                    `${item.path}`,
                    sessionId
                );

                // Show in output channel
                const outputChannel = vscode.window.createOutputChannel(`mrmd: ${item.path}`);
                outputChannel.clear();
                outputChannel.appendLine(`# ${item.path}`);
                outputChannel.appendLine(`# Type: ${item.variable?.type || 'unknown'}`);
                outputChannel.appendLine('');

                if (result.formatted_output) {
                    outputChannel.appendLine(result.formatted_output);
                } else if (result.result) {
                    outputChannel.appendLine(result.result);
                } else if (result.stdout) {
                    outputChannel.appendLine(result.stdout);
                }

                outputChannel.show();
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to view ${item.path}`);
            }
        }),

        // Legacy command (kept for compatibility)
        vscode.commands.registerCommand('mrmd.runBlockIPython', async () => {
            await vscode.commands.executeCommand('mrmd.runBlock');
        }),

        // Select/manage sessions
        vscode.commands.registerCommand('mrmd.selectSession', async (language) => {
            vscode.window.showInformationMessage(`Session: ${language}`);
        }),

        // Show sessions quick pick
        vscode.commands.registerCommand('mrmd.showSessions', async () => {
            await executionManager.showSessions();
        }),

        // Server commands
        vscode.commands.registerCommand('mrmd.startServer', async () => {
            const success = await serverManager.start();
            if (success) {
                vscode.window.showInformationMessage('mrmd server started');
            } else {
                vscode.window.showErrorMessage('Failed to start mrmd server');
            }
        }),

        vscode.commands.registerCommand('mrmd.stopServer', () => {
            serverManager.stop();
            vscode.window.showInformationMessage('mrmd server stopped');
        }),

        vscode.commands.registerCommand('mrmd.restartServer', async () => {
            vscode.window.showInformationMessage('Restarting mrmd server...');
            const success = await serverManager.restart();
            if (success) {
                vscode.window.showInformationMessage('mrmd server restarted');
            } else {
                vscode.window.showErrorMessage('Failed to restart mrmd server');
            }
        }),

        vscode.commands.registerCommand('mrmd.showOutput', () => {
            vscode.commands.executeCommand('workbench.action.output.show');
        }),

        // Setup commands
        vscode.commands.registerCommand('mrmd.runSetup', async () => {
            await setupManager.runSetupWizard();
        }),

        vscode.commands.registerCommand('mrmd.resetSetup', async () => {
            await setupManager.resetSetup();
        }),

        // Server management command
        vscode.commands.registerCommand('mrmd.manageServers', async () => {
            const servers = await findRunningServers();
            const currentPort = serverManager.serverPort;
            const isRunning = serverManager.isRunning;

            // Get current Python path setting
            const config = vscode.workspace.getConfiguration('mrmd');
            const currentPythonPath = config.get<string>('pythonPath', '');

            // Build menu items
            type MenuItem = { label: string; description?: string; detail?: string; action: string; port?: number };
            const items: MenuItem[] = [];

            // Server status and actions
            if (isRunning) {
                items.push({
                    label: `$(check) Server Running`,
                    description: `Port ${currentPort}`,
                    action: 'status',
                });
                items.push({
                    label: '$(debug-restart) Restart Server',
                    description: 'Restart with current settings',
                    action: 'restart',
                });
                items.push({
                    label: '$(stop) Stop Server',
                    action: 'stop',
                });
            } else {
                items.push({
                    label: '$(play) Start Server',
                    action: 'start',
                });
            }

            // Separator
            items.push({ label: '', action: 'separator', description: '─'.repeat(40) });

            // Python environment
            items.push({
                label: '$(folder) Select Python Environment',
                description: currentPythonPath || '(auto-detect from .venv)',
                detail: 'Choose a Python interpreter or virtual environment',
                action: 'select-python',
            });

            // Show other servers if any
            const otherServers = servers.filter(s => s.port !== currentPort);
            if (otherServers.length > 0) {
                items.push({ label: '', action: 'separator', description: '─'.repeat(40) });
                for (const server of otherServers) {
                    items.push({
                        label: `$(server) Port ${server.port}`,
                        description: `${server.sessions.length} session(s) - orphan`,
                        action: 'kill-server',
                        port: server.port,
                    });
                }
            }

            const selected = await vscode.window.showQuickPick(items.filter(i => i.action !== 'separator'), {
                placeHolder: 'mrmd Server Management',
            });

            if (!selected) return;

            switch (selected.action) {
                case 'start':
                    await serverManager.start();
                    break;
                case 'restart':
                    await serverManager.restart();
                    vscode.window.showInformationMessage('Server restarted');
                    break;
                case 'stop':
                    await serverManager.stop();
                    vscode.window.showInformationMessage('Server stopped');
                    break;
                case 'select-python':
                    await selectPythonEnvironment();
                    break;
                case 'kill-server':
                    if (selected.port) {
                        await killServerOnPort(selected.port);
                        vscode.window.showInformationMessage(`Server on port ${selected.port} killed`);
                    }
                    break;
            }
        }),

        // Select Python environment command
        vscode.commands.registerCommand('mrmd.selectPython', selectPythonEnvironment),

        // Navigation commands
        vscode.commands.registerCommand('mrmd.goToPreviousBlock', goToPreviousBlock),
        vscode.commands.registerCommand('mrmd.goToNextBlock', goToNextBlock),

        // Block movement commands
        vscode.commands.registerCommand('mrmd.moveBlockUp', moveBlockUp),
        vscode.commands.registerCommand('mrmd.moveBlockDown', moveBlockDown),

        // Output management commands
        vscode.commands.registerCommand('mrmd.deleteOutput', deleteOutput),
        vscode.commands.registerCommand('mrmd.clearAllOutputs', clearAllOutputs),

        // Collapse/expand commands
        vscode.commands.registerCommand('mrmd.toggleCollapse', toggleCollapse),
        vscode.commands.registerCommand('mrmd.collapseOutput', collapseOutput),
        vscode.commands.registerCommand('mrmd.expandOutput', expandOutput),
        vscode.commands.registerCommand('mrmd.collapseAllOutputs', collapseAllOutputs),
        vscode.commands.registerCommand('mrmd.expandAllOutputs', expandAllOutputs),

        // Block editing commands
        vscode.commands.registerCommand('mrmd.splitBlock', splitBlock),
        vscode.commands.registerCommand('mrmd.mergeBlocks', mergeBlocks),

        // Show shortcuts cheatsheet
        vscode.commands.registerCommand('mrmd.showShortcuts', async () => {
            const shortcuts = [
                { label: '$(play) Run Block', description: 'Ctrl+Enter', detail: 'Execute the code block at cursor' },
                { label: '$(run-all) Run Block & Advance', description: 'Shift+Enter', detail: 'Execute and move to next block' },
                { label: '$(run-all) Run All Blocks', description: 'Ctrl+Shift+Enter', detail: 'Execute all code blocks in document' },
                { label: '$(stop) Cancel Execution', description: 'Escape', detail: 'Stop the current execution' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(arrow-up) Previous Block', description: 'Alt+PageUp', detail: 'Jump to previous code block' },
                { label: '$(arrow-down) Next Block', description: 'Alt+PageDown', detail: 'Jump to next code block' },
                { label: '$(fold-up) Move Block Up', description: 'Ctrl+Shift+PageUp', detail: 'Move block up (with output)' },
                { label: '$(fold-down) Move Block Down', description: 'Ctrl+Shift+PageDown', detail: 'Move block down (with output)' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(trash) Delete Output', description: 'Ctrl+Shift+D', detail: 'Delete output block' },
                { label: '$(clear-all) Clear All Outputs', description: 'Ctrl+Shift+L', detail: 'Remove all output blocks' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(fold) Toggle Collapse', description: 'Ctrl+Shift+\\', detail: 'Collapse/expand output' },
                { label: '$(chevron-right) Collapse Output', description: 'Ctrl+Shift+[', detail: 'Collapse output block' },
                { label: '$(chevron-down) Expand Output', description: 'Ctrl+Shift+]', detail: 'Expand output block' },
                { label: '$(collapse-all) Collapse All', description: 'Ctrl+K Ctrl+[', detail: 'Collapse all outputs' },
                { label: '$(expand-all) Expand All', description: 'Ctrl+K Ctrl+]', detail: 'Expand all outputs' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(split-horizontal) Split Block', description: 'Ctrl+Shift+S', detail: 'Split block at cursor' },
                { label: '$(merge) Merge Blocks', description: 'Ctrl+Shift+M', detail: 'Merge with next block' },
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(lightbulb) Snippets', description: 'Type prefix + Tab', detail: 'py, pyf, pyc, js, sh, sql, pip...' },
            ];

            await vscode.window.showQuickPick(shortcuts as vscode.QuickPickItem[], {
                placeHolder: 'mrmd Keyboard Shortcuts (press Escape to close)',
                matchOnDescription: true,
                matchOnDetail: true,
            });
        })
    );

    // Check setup on first markdown file open
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor && editor.document.languageId === 'markdown') {
                await setupManager.checkOnFirstOpen();
            }
        })
    );

    // Also check if a markdown file is already open
    if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
        setupManager.checkOnFirstOpen();
    }

    // Update decorations when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            decorationProvider.updateDecorations(editor);
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                decorationProvider.updateDecorations(editor);
            }
        })
    );

    // Initial decoration update
    if (vscode.window.activeTextEditor) {
        decorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }

    // Refresh variable explorer when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            // Refresh to show variables for current document's session
            if (serverManager.isRunning) {
                variableExplorer.refresh();
            }
        })
    );

    // Register for cleanup
    context.subscriptions.push({
        dispose: () => {
            serverManager.dispose();
            executionManager.dispose();
            ipythonExecutionManager.dispose();
            decorationProvider.dispose();
            setupManager.dispose();
            variableExplorer.dispose();
        }
    });

    // Status bar item for server status
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(markdown) mrmd';
    statusBarItem.tooltip = 'mrmd - Click to manage servers';
    statusBarItem.command = 'mrmd.manageServers';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Update status bar based on server state
    serverManager.onServerReady(() => {
        const port = serverManager.serverPort;
        statusBarItem.text = `$(markdown) mrmd :${port}`;
        statusBarItem.tooltip = `mrmd server running on port ${port} - Click to manage`;
    });

    serverManager.onServerStopped(() => {
        statusBarItem.text = '$(markdown) mrmd';
        statusBarItem.tooltip = 'mrmd server stopped - Click to manage';
    });

    // Session status bar item - shows current IPython session
    const sessionStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        99  // Just left of mrmd status
    );
    sessionStatusBar.command = 'mrmd.switchSession';
    context.subscriptions.push(sessionStatusBar);

    // Update session status bar based on active editor
    const updateSessionStatus = () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            sessionStatusBar.hide();
            return;
        }

        const docPath = editor.document.uri.fsPath;
        const isDedicated = dedicatedSessions.has(docPath);
        const sessionId = getDocumentSessionId(editor.document);

        if (isDedicated) {
            sessionStatusBar.text = '$(git-branch) Session: dedicated';
            sessionStatusBar.tooltip = `IPython session: ${sessionId}\nClick to switch to shared workspace session`;
        } else {
            sessionStatusBar.text = '$(globe) Session: shared';
            sessionStatusBar.tooltip = `IPython session: ${sessionId}\nAll markdown files share this session\nClick to use dedicated session for this file`;
        }
        sessionStatusBar.show();
    };

    // Update on editor change
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateSessionStatus)
    );
    updateSessionStatus();

    // Command to switch between shared and dedicated session
    context.subscriptions.push(
        vscode.commands.registerCommand('mrmd.switchSession', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown') {
                vscode.window.showInformationMessage('Open a markdown file to switch sessions');
                return;
            }

            const docPath = editor.document.uri.fsPath;
            const isDedicated = dedicatedSessions.has(docPath);

            const options = isDedicated
                ? ['Switch to shared workspace session', 'Keep dedicated session']
                : ['Use dedicated session for this file', 'Keep shared session'];

            const choice = await vscode.window.showQuickPick(options, {
                placeHolder: isDedicated
                    ? 'Currently using a dedicated session for this file'
                    : 'Currently sharing session with all workspace markdown files'
            });

            if (choice === 'Switch to shared workspace session') {
                dedicatedSessions.delete(docPath);
                vscode.window.showInformationMessage('Switched to shared workspace session');
            } else if (choice === 'Use dedicated session for this file') {
                dedicatedSessions.add(docPath);
                vscode.window.showInformationMessage('Now using dedicated session for this file');
            }

            updateSessionStatus();
        })
    );

    console.log('mrmd extension activated');
}

export function deactivate() {
    if (serverManager) {
        serverManager.stop();
    }
}

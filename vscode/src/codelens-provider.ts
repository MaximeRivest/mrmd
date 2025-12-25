/**
 * CodeLens Provider for mrmd
 *
 * Adds "▶ Run" buttons above code blocks in markdown files.
 * Properly handles nested fences (e.g., 4-backtick blocks containing 3-backtick code).
 */

import * as vscode from 'vscode';

interface CodeBlock {
    language: string;
    code: string;
    startLine: number;
    endLine: number;
    fenceStart: number;  // Line of opening fence
    fenceEnd: number;    // Line of closing fence
    fenceLength: number; // Number of backticks/tildes in the fence
    fenceChar: string;   // '`' or '~'
    isNested?: boolean;  // True if this is a code block inside an output block
    parentFenceStart?: number; // If nested, the parent output block's fence start
}

export class MrmdCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const codeLenses: vscode.CodeLens[] = [];
        const blocks = this.parseCodeBlocks(document);

        // Add toolbar at line 0
        const toolbarRange = new vscode.Range(0, 0, 0, 0);
        codeLenses.push(new vscode.CodeLens(toolbarRange, {
            title: '▶ Run All',
            command: 'mrmd.runAllBlocks'
        }));
        codeLenses.push(new vscode.CodeLens(toolbarRange, {
            title: '↺ Restart',
            command: 'mrmd.restartServer'
        }));
        codeLenses.push(new vscode.CodeLens(toolbarRange, {
            title: '⌨ Shortcuts',
            command: 'mrmd.showShortcuts'
        }));
        codeLenses.push(new vscode.CodeLens(toolbarRange, {
            title: '⚙',
            command: 'workbench.action.openSettings',
            arguments: ['mrmd']
        }));

        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];

            // Skip pure output blocks (but allow nested python blocks inside output)
            if ((block.language === 'output' || block.language === 'result') && !block.isNested) {
                continue;
            }

            // Only show run buttons for executable languages
            // Includes Python and languages that can be executed via IPython magics
            const executableLanguages = [
                // Python
                'python', 'py', 'python3',
                // Shell (%%bash, %%sh)
                'bash', 'sh', 'zsh',
                // IPython magic languages
                'r',           // %%R (requires rpy2)
                'julia',       // %%julia (requires julia magics)
                'ruby',        // %%ruby
                'perl',        // %%perl
                'javascript', 'js',  // %%javascript
                'html',        // %%html
                'latex',       // %%latex
                'svg',         // %%svg
                'sql',         // %%sql (requires ipython-sql)
            ];
            if (!executableLanguages.includes(block.language.toLowerCase())) {
                continue;
            }

            const range = new vscode.Range(block.fenceStart, 0, block.fenceStart, 0);

            // Run button - mark nested blocks differently
            const title = block.isNested ? '▶ Run (from output)' : '▶ Run';
            codeLenses.push(new vscode.CodeLens(range, {
                title,
                command: 'mrmd.runCodeBlock',
                arguments: [document.uri, i, block]
            }));

            // Run in session button (shows current session)
            codeLenses.push(new vscode.CodeLens(range, {
                title: `[${block.language}]`,
                command: 'mrmd.selectSession',
                arguments: [block.language]
            }));
        }

        return codeLenses;
    }

    /**
     * Parse all fenced code blocks from the document.
     * Properly handles nested fences by tracking fence length.
     * A fence closes only when we see the same char with >= length.
     */
    parseCodeBlocks(document: vscode.TextDocument): CodeBlock[] {
        const blocks: CodeBlock[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Stack to handle nested blocks
        interface FenceState {
            fenceChar: string;
            fenceLength: number;
            language: string;
            fenceStart: number;
            startLine: number;
            codeLines: string[];
            isOutputBlock: boolean;
        }

        const stack: FenceState[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for fence (``` or ~~~) with optional language
            const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)\s*$/);

            if (fenceMatch) {
                const fenceStr = fenceMatch[1];
                const fenceChar = fenceStr[0];
                const fenceLength = fenceStr.length;
                const language = fenceMatch[2] || 'text';

                // Check if this closes the current block
                if (stack.length > 0) {
                    const current = stack[stack.length - 1];

                    // Closes if: same char, no language specifier, and length >= opening
                    if (fenceChar === current.fenceChar &&
                        fenceLength >= current.fenceLength &&
                        !fenceMatch[2]) {

                        // Close this block
                        const closed = stack.pop()!;

                        const block: CodeBlock = {
                            language: closed.language,
                            code: closed.codeLines.join('\n'),
                            startLine: closed.startLine,
                            endLine: i - 1,
                            fenceStart: closed.fenceStart,
                            fenceEnd: i,
                            fenceLength: closed.fenceLength,
                            fenceChar: closed.fenceChar,
                        };

                        // If this was inside an output block, mark nested python blocks
                        if (stack.length > 0 && stack[stack.length - 1].isOutputBlock) {
                            block.isNested = true;
                            block.parentFenceStart = stack[stack.length - 1].fenceStart;
                        }

                        blocks.push(block);
                        continue;
                    }
                }

                // This is opening a new block
                const isOutputBlock = ['output', 'result'].includes(language.toLowerCase());
                stack.push({
                    fenceChar,
                    fenceLength,
                    language,
                    fenceStart: i,
                    startLine: i + 1,
                    codeLines: [],
                    isOutputBlock,
                });
            } else if (stack.length > 0) {
                // Inside a block, accumulate content
                stack[stack.length - 1].codeLines.push(line);
            }
        }

        // Sort blocks by fenceStart to maintain document order
        blocks.sort((a, b) => a.fenceStart - b.fenceStart);

        return blocks;
    }

    /**
     * Find the output block immediately following a code block, if any
     */
    findOutputBlock(document: vscode.TextDocument, afterLine: number): { start: number; end: number; fenceChar: string; fenceLength: number } | null {
        const lines = document.getText().split('\n');

        // Skip blank lines after the code block
        let i = afterLine + 1;
        while (i < lines.length && lines[i].trim() === '') {
            i++;
        }

        // Check if there's an output block (captures fence char and length)
        // Allow optional trailing whitespace or content after output/result
        const fenceMatch = lines[i]?.match(/^(`{3,}|~{3,})(output|result)\b/);
        if (!fenceMatch) {
            return null;
        }

        const fenceChar = fenceMatch[1][0]; // '`' or '~'
        const fenceLength = fenceMatch[1].length;
        const start = i;
        i++;

        // Find the closing fence - match same length OR be lenient and accept any 3+ fence
        // This handles both proper markdown (same length) and edge cases
        const char = fenceChar === '`' ? '`' : '~';
        const closingPattern = new RegExp(`^${char}{${fenceLength}}$`);
        const lenientClosingPattern = new RegExp(`^${char}{3,}$`);
        while (i < lines.length) {
            if (closingPattern.test(lines[i]) || lenientClosingPattern.test(lines[i])) {
                return { start, end: i, fenceChar, fenceLength };
            }
            i++;
        }

        return null;
    }
}

/**
 * Get the code block at a given position
 */
export function getCodeBlockAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    provider: MrmdCodeLensProvider
): CodeBlock | null {
    const blocks = provider.parseCodeBlocks(document);

    for (const block of blocks) {
        if (position.line >= block.fenceStart && position.line <= block.fenceEnd) {
            return block;
        }
    }

    return null;
}

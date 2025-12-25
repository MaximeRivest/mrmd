/**
 * Completion Provider for mrmd
 *
 * Provides autocompletion inside code blocks by calling the mrmd server.
 */

import * as vscode from 'vscode';
import { MrmdServerManager } from './server-manager';
import { MrmdCodeLensProvider, getCodeBlockAtPosition } from './codelens-provider';

export class MrmdCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private serverManager: MrmdServerManager,
        private codeLensProvider: MrmdCodeLensProvider
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem[] | null> {
        // Check if we're inside a code block
        const block = getCodeBlockAtPosition(document, position, this.codeLensProvider);
        if (!block) {
            return null;
        }

        // Skip output blocks
        if (block.language === 'output' || block.language === 'result') {
            return null;
        }

        // Only provide completions for supported languages
        const supportedLangs = ['python', 'py', 'javascript', 'js', 'typescript', 'ts', 'bash', 'sh', 'repl'];
        if (!supportedLangs.includes(block.language.toLowerCase())) {
            return null;
        }

        // Get the code up to the cursor position
        const lineInBlock = position.line - block.startLine;
        const codeLines = block.code.split('\n');

        if (lineInBlock < 0 || lineInBlock >= codeLines.length) {
            return null;
        }

        // Build the prefix: all code up to cursor
        const prefixLines = codeLines.slice(0, lineInBlock);
        prefixLines.push(codeLines[lineInBlock].substring(0, position.character - 0)); // Adjust for line offset
        const prefix = prefixLines.join('\n');

        if (!prefix.trim()) {
            return null;
        }

        // Call the server for completions
        try {
            const serverUrl = this.serverManager.serverUrl;
            const sessionId = this.getSessionId(block.language);

            const response = await fetch(`${serverUrl}/api/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session: sessionId,
                    prefix: prefix,
                }),
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json() as { candidates?: string[] };
            const candidates: string[] = data.candidates || [];

            return candidates.map((candidate, index) => {
                const item = new vscode.CompletionItem(candidate, vscode.CompletionItemKind.Variable);
                item.sortText = index.toString().padStart(5, '0');
                return item;
            });
        } catch (error) {
            console.error('Completion error:', error);
            return null;
        }
    }

    private getSessionId(language: string): string {
        // Map language to session ID
        const langMap: Record<string, string> = {
            'python': 'python',
            'py': 'python',
            'javascript': 'node',
            'js': 'node',
            'typescript': 'node',
            'ts': 'node',
            'bash': 'bash',
            'sh': 'bash',
            'repl': 'repl',
        };
        return langMap[language.toLowerCase()] || 'default';
    }
}

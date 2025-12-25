/**
 * Decorations for mrmd
 *
 * Styles output blocks to make them visually distinct.
 * Also provides running cell indicators.
 */

import * as vscode from 'vscode';

export class OutputDecorationProvider {
    private outputDecoration: vscode.TextEditorDecorationType;
    private outputFenceDecoration: vscode.TextEditorDecorationType;
    private runningDecoration: vscode.TextEditorDecorationType;
    private queuedDecoration: vscode.TextEditorDecorationType;
    private runningLines: Set<number> = new Set();
    private queuedLines: Set<number> = new Set();

    constructor() {
        // Style for output block content - dimmed
        this.outputDecoration = vscode.window.createTextEditorDecorationType({
            opacity: '0.7',
            fontStyle: 'italic',
        });

        // Style for output fences - even more dimmed
        this.outputFenceDecoration = vscode.window.createTextEditorDecorationType({
            opacity: '0.4',
            color: new vscode.ThemeColor('descriptionForeground'),
        });

        // Style for running cells - spinner indicator
        this.runningDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse('data:image/svg+xml,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-dasharray="20" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="rotate" dur="1s" from="0 8 8" to="360 8 8" repeatCount="indefinite"/>
                    </circle>
                </svg>
            `)),
            gutterIconSize: 'contain',
            overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            isWholeLine: true,
            backgroundColor: 'rgba(79, 195, 247, 0.08)',
        });

        // Style for queued cells - clock indicator
        this.queuedDecoration = vscode.window.createTextEditorDecorationType({
            gutterIconPath: vscode.Uri.parse('data:image/svg+xml,' + encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="#ffb74d" stroke-width="1.5"/>
                    <line x1="8" y1="8" x2="8" y2="5" stroke="#ffb74d" stroke-width="1.5" stroke-linecap="round"/>
                    <line x1="8" y1="8" x2="11" y2="8" stroke="#ffb74d" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            `)),
            gutterIconSize: 'contain',
            overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
            overviewRulerLane: vscode.OverviewRulerLane.Left,
            isWholeLine: true,
            backgroundColor: 'rgba(255, 183, 77, 0.05)',
        });
    }

    dispose() {
        this.outputDecoration.dispose();
        this.outputFenceDecoration.dispose();
        this.runningDecoration.dispose();
        this.queuedDecoration.dispose();
    }

    /**
     * Mark a line (fence start) as running
     */
    setRunning(line: number): void {
        this.runningLines.add(line);
        this.queuedLines.delete(line);
    }

    /**
     * Mark a line (fence start) as queued
     */
    setQueued(line: number): void {
        if (!this.runningLines.has(line)) {
            this.queuedLines.add(line);
        }
    }

    /**
     * Clear running/queued status for a line
     */
    clearStatus(line: number): void {
        this.runningLines.delete(line);
        this.queuedLines.delete(line);
    }

    /**
     * Clear all running/queued statuses
     */
    clearAllStatus(): void {
        this.runningLines.clear();
        this.queuedLines.clear();
    }

    /**
     * Update decorations for the active editor
     */
    updateDecorations(editor: vscode.TextEditor | undefined) {
        if (!editor || editor.document.languageId !== 'markdown') {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');

        const outputRanges: vscode.Range[] = [];
        const fenceRanges: vscode.Range[] = [];
        const runningRanges: vscode.Range[] = [];
        const queuedRanges: vscode.Range[] = [];

        let inOutputBlock = false;
        let outputStart = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for output block start
            if (line.match(/^(`{3,}|~{3,})(output|result)/)) {
                inOutputBlock = true;
                outputStart = i;
                // Mark the opening fence
                fenceRanges.push(new vscode.Range(i, 0, i, line.length));
            } else if (inOutputBlock && line.match(/^(`{3,}|~{3,})$/)) {
                // Mark the closing fence
                fenceRanges.push(new vscode.Range(i, 0, i, line.length));

                // Mark the content
                if (outputStart + 1 < i) {
                    outputRanges.push(new vscode.Range(outputStart + 1, 0, i - 1, lines[i - 1].length));
                }

                inOutputBlock = false;
                outputStart = -1;
            }

            // Check for running/queued code blocks
            if (this.runningLines.has(i)) {
                runningRanges.push(new vscode.Range(i, 0, i, line.length));
            }
            if (this.queuedLines.has(i)) {
                queuedRanges.push(new vscode.Range(i, 0, i, line.length));
            }
        }

        editor.setDecorations(this.outputDecoration, outputRanges);
        editor.setDecorations(this.outputFenceDecoration, fenceRanges);
        editor.setDecorations(this.runningDecoration, runningRanges);
        editor.setDecorations(this.queuedDecoration, queuedRanges);
    }
}

/**
 * Folding Range Provider for mrmd
 *
 * Provides folding ranges for output blocks.
 */
export class OutputFoldingProvider implements vscode.FoldingRangeProvider {
    private _onDidChangeFoldingRanges = new vscode.EventEmitter<void>();
    readonly onDidChangeFoldingRanges = this._onDidChangeFoldingRanges.event;

    refresh(): void {
        this._onDidChangeFoldingRanges.fire();
    }

    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        let inOutputBlock = false;
        let outputStart = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check for output block start
            const startMatch = line.match(/^(`{3,}|~{3,})(output|result)/);
            if (startMatch) {
                inOutputBlock = true;
                outputStart = i;
            } else if (inOutputBlock && line.match(/^(`{3,}|~{3,})$/)) {
                // Create folding range for output block
                if (outputStart < i - 1) {
                    ranges.push(new vscode.FoldingRange(
                        outputStart,
                        i,
                        vscode.FoldingRangeKind.Region
                    ));
                }

                inOutputBlock = false;
                outputStart = -1;
            }
        }

        return ranges;
    }

    dispose(): void {
        this._onDidChangeFoldingRanges.dispose();
    }
}

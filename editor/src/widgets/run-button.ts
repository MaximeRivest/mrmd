import { WidgetType, EditorView } from '@codemirror/view';
import type { ExecutionTracker } from '../execution/tracker';
import type { CellOptions } from '../cells/types';

/**
 * Widget for the run button on code blocks
 */
export class RunButtonWidget extends WidgetType {
  constructor(
    readonly codeBlockFrom: number,
    readonly codeBlockTo: number,
    readonly language: string,
    readonly view: EditorView,
    readonly tracker: ExecutionTracker | null,
    readonly cellOptions?: CellOptions
  ) {
    super();
  }

  eq(other: RunButtonWidget): boolean {
    return (
      other.codeBlockFrom === this.codeBlockFrom &&
      other.codeBlockTo === this.codeBlockTo
    );
  }

  toDOM(): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'cm-run-button';
    btn.innerHTML = '▶';
    btn.title = `Run ${this.language || 'code'}`;

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.runCode();
    };

    return btn;
  }

  private runCode(): void {
    const state = this.view.state;

    // Extract code content (between the fences)
    const fullText = state.doc.sliceString(this.codeBlockFrom, this.codeBlockTo);
    const lines = fullText.split('\n');
    // Remove first (```lang) and last (```) lines
    const codeLines = lines.slice(1, -1);
    const code = codeLines.join('\n');

    if (this.tracker) {
      // Use the execution tracker for proper streaming
      this.tracker.runBlock(code, this.language, this.codeBlockTo, this.cellOptions);
    } else {
      // Fallback: just insert a placeholder output
      this.insertMockOutput(code);
    }
  }

  private insertMockOutput(code: string): void {
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const insertPos = this.codeBlockTo;

    // Check for existing output
    const afterText = this.view.state.doc.sliceString(
      insertPos,
      Math.min(insertPos + 100, this.view.state.doc.length)
    );
    const existingOutput = afterText.match(/^\n```output(?::[^\n]*)?\n/);

    if (existingOutput) {
      const outputStart = insertPos + 1;
      const restOfDoc = this.view.state.doc.sliceString(outputStart, this.view.state.doc.length);
      const outputMatch = restOfDoc.match(/^```output(?::[^\n]*)?\n([\s\S]*?)```/);

      if (outputMatch) {
        this.view.dispatch({
          changes: {
            from: outputStart,
            to: outputStart + outputMatch[0].length,
            insert: `\`\`\`output:${execId}\nRunning ${this.language}...\n> ${code.split('\n')[0]}\nExecution complete.\n\`\`\``,
          },
        });
        return;
      }
    }

    // Insert new output block
    this.view.dispatch({
      changes: {
        from: insertPos,
        insert: `\n\`\`\`output:${execId}\nRunning ${this.language}...\n> ${code.split('\n')[0]}\nExecution complete.\n\`\`\``,
      },
    });
  }

  ignoreEvent(): boolean {
    return true;
  }
}

import type { EditorView } from '@codemirror/view';
import type { Executor, StreamCallback } from './executor';
import { clearCellScripts } from '../widgets/html/script-manager';
import { serializeCellOptions } from '../cells/options';
import type { CellOptions } from '../cells/types';

/**
 * Tracks running executions and manages streaming output
 */
export class ExecutionTracker {
  private running = new Map<string, AbortController>();
  private view: EditorView;
  private executor: Executor;

  constructor(view: EditorView, executor: Executor) {
    this.view = view;
    this.executor = executor;
  }

  /**
   * Update the editor view reference
   */
  setView(view: EditorView): void {
    this.view = view;
  }

  /**
   * Run a code block and stream output
   */
  async runBlock(
    code: string,
    language: string,
    codeBlockEnd: number,
    options?: CellOptions
  ): Promise<string> {
    // Generate unique execution ID
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // HTML is handled specially - it's "executed" by rendering
    if (language === 'html') {
      return this.runHtmlBlock(code, codeBlockEnd, execId, options);
    }

    // Don't cancel other executions - allow parallel streaming
    // Each execution has its own unique ID so they won't interfere

    // Create abort controller for this execution
    const controller = new AbortController();
    this.running.set(execId, controller);

    // Insert or replace output block
    this.insertOutputBlock(codeBlockEnd, execId);

    try {
      // Stream execution
      await this.executor.executeStreaming(code, language, (chunk, accumulated, done) => {
        if (controller.signal.aborted) return;
        // Use accumulated output and process terminal control chars
        this.replaceOutputContent(execId, this.processTerminalOutput(accumulated));
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.appendToOutput(execId, `\nError: ${errorMsg}\n`);
      }
    } finally {
      // Ensure closing fence is on its own line after all output
      this.ensureOutputNewline(execId);
      // Schedule a final check after DOM updates settle (cleaner than multiple timeouts)
      requestAnimationFrame(() => this.ensureOutputNewline(execId));
      this.running.delete(execId);
    }

    return execId;
  }

  /**
   * Run an HTML block by creating a rendered output block
   * HTML "execution" means inserting the content into a special
   * html-rendered block that gets replaced with a live DOM widget
   */
  private runHtmlBlock(
    html: string,
    codeBlockEnd: number,
    execId: string,
    options?: CellOptions
  ): string {
    // Clear any previous scripts for this cell to allow fresh execution
    clearCellScripts(execId);

    const optStr = options ? serializeCellOptions(options) : '';
    const state = this.view.state;

    // Check for existing html-rendered block after this code block
    const afterText = state.doc.sliceString(
      codeBlockEnd,
      Math.min(codeBlockEnd + 100, state.doc.length)
    );

    const existingMatch = afterText.match(/^\n```html-rendered(?::[^\s{]*)?(?:\s*\{[^}]*\})?\n/);

    if (existingMatch) {
      // Replace existing html-rendered block
      const outputStart = codeBlockEnd + 1;
      const restOfDoc = state.doc.sliceString(outputStart, state.doc.length);
      const blockMatch = restOfDoc.match(
        /^```html-rendered(?::[^\s{]*)?(?:\s*\{[^}]*\})?\n([\s\S]*?)```/
      );

      if (blockMatch) {
        this.view.dispatch({
          changes: {
            from: outputStart,
            to: outputStart + blockMatch[0].length,
            insert: `\`\`\`html-rendered:${execId}${optStr}\n${html}\n\`\`\``,
          },
        });
        return execId;
      }
    }

    // Insert new html-rendered block
    this.view.dispatch({
      changes: {
        from: codeBlockEnd,
        insert: `\n\`\`\`html-rendered:${execId}${optStr}\n${html}\n\`\`\``,
      },
    });

    return execId;
  }

  /**
   * Cancel a running execution
   */
  cancel(execId: string): void {
    const controller = this.running.get(execId);
    if (controller) {
      controller.abort();
      this.running.delete(execId);
    }
  }

  /**
   * Cancel all running executions
   */
  cancelAll(): void {
    for (const controller of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
  }

  /**
   * Check if any execution is running
   */
  isRunning(): boolean {
    return this.running.size > 0;
  }

  /**
   * Insert or replace output block after code block
   */
  private insertOutputBlock(codeBlockEnd: number, execId: string): void {
    const state = this.view.state;
    const afterText = state.doc.sliceString(
      codeBlockEnd,
      Math.min(codeBlockEnd + 100, state.doc.length)
    );

    // Check if there's already an output block
    const existingOutput = afterText.match(/^\n```output(?::[^\n]*)?\n/);

    if (existingOutput) {
      // Replace existing output block
      const outputStart = codeBlockEnd + 1;
      const restOfDoc = state.doc.sliceString(outputStart, state.doc.length);
      const outputMatch = restOfDoc.match(/^```output(?::[^\n]*)?\n([\s\S]*?)```/);

      if (outputMatch) {
        this.view.dispatch({
          changes: {
            from: outputStart,
            to: outputStart + outputMatch[0].length,
            insert: `\`\`\`output:${execId}\n\`\`\``,
          },
        });
        return;
      }
    }

    // Insert new output block
    this.view.dispatch({
      changes: {
        from: codeBlockEnd,
        insert: `\n\`\`\`output:${execId}\n\`\`\``,
      },
    });
  }

  /**
   * Process terminal output - handle \r (carriage return) and \n
   * Simulates how a terminal would render the output
   */
  private processTerminalOutput(text: string): string {
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '\r') {
        // Carriage return - go to start of current line
        // If followed by \n, it's just a Windows line ending
        if (text[i + 1] === '\n') {
          lines.push(currentLine);
          currentLine = '';
          i++; // Skip the \n
        } else {
          // Pure \r - reset to start of line (for progress bars)
          currentLine = '';
        }
      } else if (char === '\n') {
        // Newline - save current line and start new one
        lines.push(currentLine);
        currentLine = '';
      } else {
        currentLine += char;
      }
    }

    // Include the last line (even if no trailing newline)
    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join('\n');
  }

  /**
   * Replace entire output block content
   */
  private replaceOutputContent(execId: string, content: string): void {
    const doc = this.view.state.doc.toString();
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);

    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const existingContent = closingMatch[1];
    const replaceFrom = outputStart;
    const replaceTo = outputStart + existingContent.length;

    // Ensure content ends with newline so closing fence is on its own line
    const finalContent = content && !content.endsWith('\n') ? content + '\n' : content;

    this.view.dispatch({
      changes: { from: replaceFrom, to: replaceTo, insert: finalContent },
    });
  }

  /**
   * Append text to an output block (used for errors)
   */
  private appendToOutput(execId: string, text: string): void {
    if (!text) return;

    const doc = this.view.state.doc.toString();
    const marker = `\`\`\`output:${execId}\n`;
    const markerPos = doc.indexOf(marker);

    if (markerPos === -1) return;

    const outputStart = markerPos + marker.length;
    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const insertPos = outputStart + closingMatch[1].length;
    this.view.dispatch({
      changes: { from: insertPos, insert: text },
    });
  }

  /**
   * Ensure output block ends with newline before closing fence
   */
  ensureOutputNewline(execId: string): void {
    const doc = this.view.state.doc.toString();

    // Find the output block - try both with and without the execId
    const markers = [
      `\`\`\`output:${execId}\n`,
      `\`\`\`output:${execId}`,
    ];

    let markerPos = -1;
    let marker = '';
    for (const m of markers) {
      markerPos = doc.indexOf(m);
      if (markerPos !== -1) {
        marker = m;
        break;
      }
    }

    if (markerPos === -1) return;

    // Find content after the marker (after the newline following marker)
    let outputStart = markerPos + marker.length;
    // Skip newline if marker doesn't include it
    if (!marker.endsWith('\n') && doc[outputStart] === '\n') {
      outputStart++;
    }

    const afterOutput = doc.slice(outputStart);
    const closingMatch = afterOutput.match(/^([\s\S]*?)```/);

    if (!closingMatch) return;

    const content = closingMatch[1];

    // Check if content doesn't end with newline (and has content)
    if (content.length > 0 && !content.endsWith('\n')) {
      const insertPos = outputStart + content.length;
      this.view.dispatch({
        changes: { from: insertPos, insert: '\n' },
      });
    }
  }
}

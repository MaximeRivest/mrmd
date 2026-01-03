/**
 * Output Block Widget
 *
 * Renders code execution output with:
 * - ANSI escape code support (colors, bold, etc.)
 * - Status line display for queue state
 * - Click to copy functionality
 * - Collapsible long output
 */

import { WidgetType, EditorView } from '@codemirror/view';
import { ansiToHtml, hasAnsi, stripAnsi } from '../execution/ansi';

/** Maximum lines to show before collapsing */
const MAX_VISIBLE_LINES = 50;

/** Configuration for output widget */
export interface OutputWidgetConfig {
  /** Whether to render ANSI codes as HTML (default: true) */
  renderAnsi?: boolean;
  /** Maximum lines before showing "show more" (default: 50) */
  maxVisibleLines?: number;
  /** Whether output can be copied on click */
  copyOnClick?: boolean;
  /** Whether widget is hidden (cursor in block) */
  hidden?: boolean;
}

/**
 * Widget for rendering output blocks with ANSI support
 */
export class OutputWidget extends WidgetType {
  constructor(
    readonly content: string,
    readonly execId: string,
    readonly config: OutputWidgetConfig = {}
  ) {
    super();
  }

  eq(other: OutputWidget): boolean {
    return (
      other.content === this.content &&
      other.execId === this.execId &&
      other.config.hidden === this.config.hidden
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-output-widget';
    if (this.config.hidden) {
      container.classList.add('cm-output-widget-hidden');
    }
    container.dataset.execId = this.execId;

    // Parse content for status line
    const { status, output } = this.parseContent(this.content);

    // Render status if present
    if (status) {
      const statusEl = document.createElement('div');
      statusEl.className = 'cm-output-status';
      statusEl.textContent = status;

      // Add appropriate styling based on status
      if (status.includes('running')) {
        statusEl.classList.add('cm-output-status-running');
      } else if (status.includes('queued')) {
        statusEl.classList.add('cm-output-status-queued');
      }

      container.appendChild(statusEl);
    }

    // Render output content
    const outputEl = document.createElement('div');
    outputEl.className = 'cm-output-content';

    const renderAnsi = this.config.renderAnsi !== false;
    const maxLines = this.config.maxVisibleLines ?? MAX_VISIBLE_LINES;

    // Check if we need to collapse
    const lines = output.split('\n');
    const needsCollapse = lines.length > maxLines;

    // Check for ANSI codes
    const hasAnsiCodes = hasAnsi(output);

    // Debug: log what we're receiving
    console.log('[OutputWidget] content length:', output.length);
    console.log('[OutputWidget] hasAnsiCodes:', hasAnsiCodes);
    console.log('[OutputWidget] first 100 chars (JSON):', JSON.stringify(output.slice(0, 100)));
    console.log('[OutputWidget] charCodes:', Array.from(output.slice(0, 20)).map(c => c.charCodeAt(0)));

    if (renderAnsi && hasAnsiCodes) {
      // Render with ANSI colors
      const visibleOutput = needsCollapse
        ? lines.slice(0, maxLines).join('\n')
        : output;
      const html = ansiToHtml(visibleOutput);
      console.log('[OutputWidget] ansiToHtml output:', html);
      outputEl.innerHTML = html;
      outputEl.classList.add('cm-output-ansi');
    } else {
      // Plain text
      const visibleOutput = needsCollapse
        ? lines.slice(0, maxLines).join('\n')
        : output;
      outputEl.textContent = visibleOutput;
    }

    container.appendChild(outputEl);

    // Add "show more" button if collapsed
    if (needsCollapse) {
      const hiddenCount = lines.length - maxLines;
      const moreBtn = document.createElement('button');
      moreBtn.className = 'cm-output-show-more';
      moreBtn.textContent = `Show ${hiddenCount} more lines...`;

      moreBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Expand to full content
        if (renderAnsi && hasAnsi(output)) {
          outputEl.innerHTML = ansiToHtml(output);
        } else {
          outputEl.textContent = output;
        }
        moreBtn.remove();
      };

      container.appendChild(moreBtn);
    }

    // Copy on click functionality
    if (this.config.copyOnClick !== false) {
      container.title = 'Click to copy output';
      container.style.cursor = 'pointer';

      container.onclick = (e) => {
        // Don't copy if clicking the show more button
        if ((e.target as HTMLElement).classList.contains('cm-output-show-more')) {
          return;
        }

        // Copy plain text (without ANSI codes)
        const plainText = stripAnsi(output);
        navigator.clipboard.writeText(plainText).then(() => {
          // Show feedback
          const feedback = document.createElement('div');
          feedback.className = 'cm-output-copy-feedback';
          feedback.textContent = 'Copied!';
          container.appendChild(feedback);

          setTimeout(() => feedback.remove(), 1500);
        });
      };
    }

    return container;
  }

  /**
   * Parse content to extract status line and actual output
   */
  private parseContent(content: string): { status: string | null; output: string } {
    // Check for status line at start: [status:running] or [status:queued] [2/3]
    const statusMatch = content.match(/^(\[status:[^\]]+\][^\n]*)\n/);

    if (statusMatch) {
      return {
        status: statusMatch[1],
        output: content.slice(statusMatch[0].length),
      };
    }

    return { status: null, output: content };
  }

  ignoreEvent(): boolean {
    return false; // Allow click events for copy
  }
}

/**
 * CSS styles for output widget
 * Include these in the editor theme
 */
export const outputWidgetStyles = `
.cm-output-widget {
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  line-height: 1.4;
  padding: 8px 12px;
  background: var(--output-bg, rgba(0, 0, 0, 0.2));
  border-radius: 4px;
  margin: 4px 0;
  position: relative;
  overflow-x: auto;
}

.cm-output-status {
  font-size: 0.85em;
  padding: 2px 8px;
  border-radius: 3px;
  margin-bottom: 8px;
  display: inline-block;
}

.cm-output-status-running {
  background: var(--status-running-bg, rgba(59, 130, 246, 0.2));
  color: var(--status-running-color, #60a5fa);
  animation: pulse 1.5s ease-in-out infinite;
}

.cm-output-status-queued {
  background: var(--status-queued-bg, rgba(234, 179, 8, 0.2));
  color: var(--status-queued-color, #fbbf24);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.cm-output-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.cm-output-content.cm-output-ansi {
  /* ANSI content may have inline styles */
}

.cm-output-show-more {
  display: block;
  margin-top: 8px;
  padding: 4px 12px;
  background: var(--btn-bg, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--btn-border, rgba(255, 255, 255, 0.2));
  border-radius: 4px;
  color: var(--btn-color, inherit);
  cursor: pointer;
  font-size: 0.85em;
}

.cm-output-show-more:hover {
  background: var(--btn-hover-bg, rgba(255, 255, 255, 0.15));
}

.cm-output-copy-feedback {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  background: var(--feedback-bg, rgba(34, 197, 94, 0.9));
  color: var(--feedback-color, white);
  border-radius: 4px;
  font-size: 0.8em;
  animation: fadeOut 1.5s ease-out forwards;
}

@keyframes fadeOut {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}
`;

/**
 * Create an output widget for use in decorations
 */
export function createOutputWidget(
  content: string,
  execId: string,
  config?: OutputWidgetConfig
): OutputWidget {
  return new OutputWidget(content, execId, config);
}

/**
 * Widget for empty output blocks - shows subtle "No output" indicator
 */
export class EmptyOutputWidget extends WidgetType {
  constructor(
    readonly execId: string,
    readonly hidden: boolean = false
  ) {
    super();
  }

  eq(other: EmptyOutputWidget): boolean {
    return other.execId === this.execId && other.hidden === this.hidden;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-empty-output-widget';
    if (this.hidden) {
      container.classList.add('cm-output-widget-hidden');
    }
    container.dataset.execId = this.execId;
    container.textContent = 'No output';
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * CSS styles for empty output widget
 */
export const emptyOutputWidgetStyles = `
.cm-empty-output-widget {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  color: var(--empty-output-color, rgba(255, 255, 255, 0.35));
  padding: 4px 8px;
  margin: 2px 0;
  font-style: italic;
}
`;

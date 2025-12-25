import { WidgetType } from '@codemirror/view';

/**
 * Collapsed placeholder for HTML source cells when echo=false
 *
 * Shows a compact indicator that the cell exists, clickable to expand
 */
export class HtmlCellPlaceholder extends WidgetType {
  constructor(
    readonly lineCount: number,
    readonly preview: string,
    readonly hasOutput: boolean
  ) {
    super();
  }

  eq(other: HtmlCellPlaceholder): boolean {
    return (
      this.lineCount === other.lineCount &&
      this.preview === other.preview &&
      this.hasOutput === other.hasOutput
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-html-cell-placeholder';

    const icon = document.createElement('span');
    icon.className = 'cm-cell-icon';
    icon.textContent = this.hasOutput ? '📄' : '📝';

    const label = document.createElement('span');
    label.className = 'cm-cell-label';
    label.textContent = 'HTML';

    const meta = document.createElement('span');
    meta.className = 'cm-cell-meta';
    meta.textContent = `(${this.lineCount} lines)`;

    el.appendChild(icon);
    el.appendChild(label);
    el.appendChild(meta);

    if (this.preview) {
      const previewEl = document.createElement('span');
      previewEl.className = 'cm-cell-preview';
      previewEl.textContent = this.truncate(this.preview, 40);
      el.appendChild(previewEl);
    }

    el.title = 'Click to edit source';

    return el;
  }

  private truncate(str: string, maxLen: number): string {
    const cleaned = str.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned.slice(0, maxLen - 1) + '…';
  }

  ignoreEvent(): boolean {
    // Allow click to pass through to editor (cursor placement)
    return false;
  }
}

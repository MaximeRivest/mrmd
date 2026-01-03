/**
 * Table Widget
 *
 * Renders markdown tables as clean, minimal HTML tables with Tufte Markdown extensions.
 *
 * Design philosophy (inspired by the masters):
 * - Tufte: Maximize data-ink ratio, no chartjunk, decimal alignment
 * - Rams: Less but better, honest materials
 * - Leonardo: Proportional harmony, natural reading flow
 * - Jobs: Seamless edit/view transition
 * - Norman: Clear affordances, consistent patterns
 *
 * Tufte Markdown Features:
 * - Column widths: |:--{30%}| in delimiter row
 * - Colspan: | > | merges with cell to left
 * - Rowspan: | ^ | merges with cell above
 * - Decimal alignment: |---.| or auto-detected
 * - Captions: *italic* before/after table
 *
 * Follows the same patterns as OutputWidget and ImageOutputWidget:
 * - Stable eq() to prevent unnecessary recreation
 * - toDOM() for rendering
 * - CSS classes for styling (defined in zen.ts)
 */

import { WidgetType, EditorView } from '@codemirror/view';
import type { ParsedTable, TableRow, TableCell, ColumnAlignment, ColumnWidth } from '../core/tables';
import { isNumericContent, normalizeTable } from '../core/tables';

/**
 * Configuration for table widget rendering
 */
export interface TableWidgetConfig {
  /** Whether to auto-detect numeric columns for right alignment */
  autoAlignNumbers?: boolean;
  /** Whether to align numbers on decimal point (Tufte's requirement) */
  decimalAlignment?: boolean;
  /** Whether to render inline markdown (bold, italic, code) */
  renderInlineMarkdown?: boolean;
  /** Whether to show column resize handles (future feature) */
  showResizeHandles?: boolean;
  /** Maximum width for the table (CSS value) */
  maxWidth?: string;
  /** Optional caption text (detected from surrounding context) */
  caption?: string;
  /** Caption position: above (default) or below (scientific style) */
  captionPosition?: 'above' | 'below';
}

/**
 * Widget for rendering markdown tables with Tufte Markdown extensions
 *
 * This widget is designed for stability:
 * - eq() compares content to avoid recreation on cursor moves
 * - toDOM() renders a minimal, semantic HTML table
 * - Styling is handled via CSS classes for theme consistency
 */
export class TableWidget extends WidgetType {
  private readonly normalizedTable: ParsedTable;

  constructor(
    readonly table: ParsedTable,
    readonly tableId: string,
    readonly config: TableWidgetConfig = {}
  ) {
    super();
    // Normalize on construction to ensure consistent rendering
    this.normalizedTable = normalizeTable(table);
  }

  /**
   * Compare tables for equality
   * Only recreate if actual content changed, not just cursor position
   */
  eq(other: TableWidget): boolean {
    if (this.tableId !== other.tableId) return false;
    if (this.normalizedTable.columnCount !== other.normalizedTable.columnCount) return false;
    if (this.normalizedTable.rows.length !== other.normalizedTable.rows.length) return false;

    // Deep compare rows
    for (let i = 0; i < this.normalizedTable.rows.length; i++) {
      const a = this.normalizedTable.rows[i];
      const b = other.normalizedTable.rows[i];

      if (a.cells.length !== b.cells.length) return false;
      if (a.isHeader !== b.isHeader) return false;
      if (a.isDelimiter !== b.isDelimiter) return false;

      for (let j = 0; j < a.cells.length; j++) {
        if (a.cells[j].content !== b.cells[j].content) return false;
        if (a.cells[j].colspan !== b.cells[j].colspan) return false;
        if (a.cells[j].rowspan !== b.cells[j].rowspan) return false;
        if (a.cells[j].hidden !== b.cells[j].hidden) return false;
      }
    }

    // Compare alignments
    for (let i = 0; i < this.normalizedTable.alignments.length; i++) {
      if (this.normalizedTable.alignments[i] !== other.normalizedTable.alignments[i]) {
        return false;
      }
    }

    // Compare config
    if (this.config.caption !== other.config.caption) return false;
    if (this.config.captionPosition !== other.config.captionPosition) return false;

    return true;
  }

  /**
   * Render the table as a DOM element
   */
  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-table-widget';
    container.dataset.tableId = this.tableId;

    if (this.config.maxWidth) {
      container.style.maxWidth = this.config.maxWidth;
    }

    const tableEl = document.createElement('table');
    tableEl.className = 'cm-table';

    // Add semantic caption element (Tufte: context is essential)
    // Use proper <caption> element with CSS caption-side for positioning
    if (this.config.caption) {
      const caption = document.createElement('caption');
      caption.className = 'cm-table-caption';
      if (this.config.captionPosition === 'below') {
        caption.classList.add('cm-table-caption-below');
      }
      caption.textContent = this.config.caption;
      tableEl.appendChild(caption);
    }

    // Apply column widths if specified (Tufte Markdown extension)
    this.applyColumnWidths(tableEl);

    // Detect numeric columns for auto-alignment (if enabled)
    // Also include explicitly marked decimal columns
    const numericColumns = this.detectNumericColumns();

    // Compute decimal alignment info if enabled (Tufte's requirement)
    const decimalInfo = this.config.decimalAlignment !== false
      ? this.computeDecimalAlignment(numericColumns)
      : null;

    // Render table sections
    const { thead, tbody } = this.renderSections(numericColumns, decimalInfo);

    if (thead) {
      tableEl.appendChild(thead);
    }
    tableEl.appendChild(tbody);

    container.appendChild(tableEl);
    return container;
  }

  /**
   * Apply column widths using CSS (via colgroup)
   */
  private applyColumnWidths(tableEl: HTMLTableElement): void {
    const widths = this.normalizedTable.columnWidths;
    const hasWidths = widths.some(w => w !== null);

    if (!hasWidths) return;

    const colgroup = document.createElement('colgroup');

    for (let i = 0; i < this.normalizedTable.columnCount; i++) {
      const col = document.createElement('col');
      const width = widths[i];

      if (width) {
        col.style.width = `${width.value}${width.unit}`;
      }

      colgroup.appendChild(col);
    }

    tableEl.appendChild(colgroup);
  }

  /**
   * Compute decimal alignment info for numeric columns
   * Returns the max width of integer and decimal parts for each column
   */
  private computeDecimalAlignment(
    numericColumns: Set<number>
  ): Map<number, { maxIntWidth: number; maxDecWidth: number }> {
    const info = new Map<number, { maxIntWidth: number; maxDecWidth: number }>();

    for (const col of numericColumns) {
      let maxIntWidth = 0;
      let maxDecWidth = 0;

      for (const row of this.normalizedTable.rows) {
        if (row.isHeader || row.isDelimiter) continue;

        const cell = row.cells[col];
        if (!cell || cell.hidden) continue;

        const parts = this.splitDecimal(cell.content);
        if (parts) {
          maxIntWidth = Math.max(maxIntWidth, parts.integer.length);
          maxDecWidth = Math.max(maxDecWidth, parts.decimal.length);
        }
      }

      if (maxIntWidth > 0 || maxDecWidth > 0) {
        info.set(col, { maxIntWidth, maxDecWidth });
      }
    }

    return info;
  }

  /**
   * Parse a numeric string into its components for decimal alignment
   * Handles: $1,234.56M, -12.5%, €100, 1.2M, 78,000, etc.
   */
  private parseNumericParts(content: string): {
    prefix: string;
    integer: string;
    decimal: string;
    suffix: string;
  } | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    // Match pattern: [currency][-][digits,digits][.digits][suffix]
    const match = trimmed.match(
      /^([$€£¥]?)\s*(-?[\d,]+(?:\.\d+)?)\s*([%MKBkmb]?)$/
    );

    if (!match) return null;

    const [, prefix, number, suffix] = match;
    const dotIndex = number.indexOf('.');

    if (dotIndex === -1) {
      return {
        prefix: prefix || '',
        integer: number,
        decimal: '',
        suffix: suffix || '',
      };
    }

    return {
      prefix: prefix || '',
      integer: number.slice(0, dotIndex),
      decimal: number.slice(dotIndex),
      suffix: suffix || '',
    };
  }

  /**
   * Split a numeric string into integer and decimal parts
   */
  private splitDecimal(content: string): { integer: string; decimal: string } | null {
    const parts = this.parseNumericParts(content);
    if (!parts) return null;

    return {
      integer: parts.prefix + parts.integer,
      decimal: parts.decimal + parts.suffix,
    };
  }

  /**
   * Detect which columns should use decimal alignment
   * Combines: explicit decimal columns + auto-detected numeric columns
   */
  private detectNumericColumns(): Set<number> {
    const numericColumns = new Set<number>();

    // Include explicitly marked decimal columns from delimiter row
    for (const col of this.normalizedTable.decimalColumns) {
      numericColumns.add(col);
    }

    // Auto-detect if enabled
    if (this.config.autoAlignNumbers !== false) {
      const columnCount = this.normalizedTable.columnCount;

      for (let col = 0; col < columnCount; col++) {
        // Skip if already marked
        if (numericColumns.has(col)) continue;

        let numericCount = 0;
        let totalCount = 0;

        for (const row of this.normalizedTable.rows) {
          if (row.isHeader || row.isDelimiter) continue;

          const cell = row.cells[col];
          if (cell && cell.content.trim() !== '' && !cell.hidden) {
            totalCount++;
            if (isNumericContent(cell.content)) {
              numericCount++;
            }
          }
        }

        // Consider column numeric if >70% of non-empty cells are numbers
        if (totalCount > 0 && numericCount / totalCount > 0.7) {
          numericColumns.add(col);
        }
      }
    }

    return numericColumns;
  }

  /**
   * Render thead and tbody sections
   */
  private renderSections(
    numericColumns: Set<number>,
    decimalInfo: Map<number, { maxIntWidth: number; maxDecWidth: number }> | null
  ): {
    thead: HTMLTableSectionElement | null;
    tbody: HTMLTableSectionElement;
  } {
    let thead: HTMLTableSectionElement | null = null;
    const tbody = document.createElement('tbody');

    for (const row of this.normalizedTable.rows) {
      // Skip delimiter rows - they're structural, not content
      if (row.isDelimiter) continue;

      const tr = this.renderRow(row, numericColumns, decimalInfo);

      if (row.isHeader) {
        if (!thead) {
          thead = document.createElement('thead');
        }
        thead.appendChild(tr);
      } else {
        tbody.appendChild(tr);
      }
    }

    return { thead, tbody };
  }

  /**
   * Render a single table row with colspan/rowspan support
   */
  private renderRow(
    row: TableRow,
    numericColumns: Set<number>,
    decimalInfo: Map<number, { maxIntWidth: number; maxDecWidth: number }> | null
  ): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.className = row.isHeader ? 'cm-table-header-row' : 'cm-table-data-row';

    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i];

      // Skip hidden cells (merged into another cell via colspan/rowspan)
      if (cell.hidden) continue;

      const alignment = this.getEffectiveAlignment(i, numericColumns);
      const cellEl = document.createElement(row.isHeader ? 'th' : 'td');
      cellEl.className = 'cm-table-cell';

      // Apply colspan if > 1
      if (cell.colspan > 1) {
        cellEl.colSpan = cell.colspan;
        cellEl.classList.add('cm-table-cell-spanning');
      }

      // Apply rowspan if > 1
      if (cell.rowspan > 1) {
        cellEl.rowSpan = cell.rowspan;
        cellEl.classList.add('cm-table-cell-spanning');
      }

      // Apply column width if specified and cell doesn't span
      if (cell.colspan === 1) {
        const width = this.normalizedTable.columnWidths[i];
        if (width) {
          // Width is handled via colgroup, but add class for styling
          cellEl.classList.add('cm-table-cell-width-set');
        }
      }

      // Apply alignment
      if (alignment) {
        cellEl.classList.add(`cm-table-align-${alignment}`);
      }

      // Check if numeric for special styling
      const isNumeric = !row.isHeader && isNumericContent(cell.content);
      if (isNumeric) {
        cellEl.classList.add('cm-table-cell-numeric');
      }

      // Render cell content
      if (isNumeric && decimalInfo?.has(i)) {
        this.renderDecimalAligned(cellEl, cell.content, decimalInfo.get(i)!);
      } else if (this.config.renderInlineMarkdown !== false) {
        this.renderInlineMarkdown(cellEl, cell.content);
      } else {
        cellEl.textContent = cell.content;
      }

      tr.appendChild(cellEl);
    }

    return tr;
  }

  /**
   * Render a number with decimal alignment (Tufte's requirement)
   * Uses a two-part structure: integer (right-aligned) + decimal (left-aligned)
   */
  private renderDecimalAligned(
    cellEl: HTMLElement,
    content: string,
    info: { maxIntWidth: number; maxDecWidth: number }
  ): void {
    const parts = this.splitDecimal(content);

    if (!parts) {
      cellEl.textContent = content;
      return;
    }

    cellEl.classList.add('cm-table-cell-decimal-aligned');

    const intSpan = document.createElement('span');
    intSpan.className = 'cm-table-decimal-int';
    intSpan.textContent = parts.integer;
    intSpan.style.minWidth = `${info.maxIntWidth}ch`;

    const decSpan = document.createElement('span');
    decSpan.className = 'cm-table-decimal-frac';
    decSpan.textContent = parts.decimal;
    decSpan.style.minWidth = `${info.maxDecWidth}ch`;

    cellEl.appendChild(intSpan);
    cellEl.appendChild(decSpan);
  }

  /**
   * Render inline markdown (bold, italic, code, strikethrough)
   * Parses: **bold**, *italic*, `code`, ~~strike~~
   */
  private renderInlineMarkdown(cellEl: HTMLElement, content: string): void {
    const patterns = [
      { regex: /\*\*(.+?)\*\*/g, tag: 'strong' },
      { regex: /\*(.+?)\*/g, tag: 'em' },
      { regex: /`(.+?)`/g, tag: 'code' },
      { regex: /~~(.+?)~~/g, tag: 's' },
    ];

    const hasMarkdown = patterns.some(p => p.regex.test(content));

    if (!hasMarkdown) {
      cellEl.textContent = content;
      return;
    }

    let html = this.escapeHtml(content);

    for (const { regex, tag } of patterns) {
      regex.lastIndex = 0;
      html = html.replace(regex, `<${tag}>$1</${tag}>`);
    }

    cellEl.innerHTML = html;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Get effective alignment for a column
   * Priority: explicit decimal > explicit alignment > auto-detect > default
   */
  private getEffectiveAlignment(
    columnIndex: number,
    numericColumns: Set<number>
  ): ColumnAlignment {
    // Check for explicit decimal alignment
    if (this.normalizedTable.decimalColumns.has(columnIndex)) {
      return 'decimal';
    }

    // Check explicit alignment from delimiter row
    const explicit = this.normalizedTable.alignments[columnIndex];
    if (explicit && explicit !== 'decimal') {
      return explicit;
    }

    // Auto-align numeric columns to right
    if (numericColumns.has(columnIndex)) {
      return 'right';
    }

    return null;
  }

  /**
   * Don't capture events - let them bubble to the editor
   */
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Create a table widget for use in decorations
 */
export function createTableWidget(
  table: ParsedTable,
  tableId: string,
  config?: TableWidgetConfig
): TableWidget {
  return new TableWidget(table, tableId, config);
}

/**
 * Generate a stable table ID from position
 */
export function generateTableId(from: number): string {
  return `table-${from}`;
}

/**
 * Table Detection and Parsing Utilities
 *
 * Provides utilities for parsing GFM-style markdown tables with Tufte Markdown extensions.
 *
 * Base: GFM spec https://github.github.com/gfm/#tables-extension-
 *
 * Tufte Markdown Extensions:
 * - Column widths: |:--{30%}| in delimiter row
 * - Colspan: | > | merges with cell to left
 * - Rowspan: | ^ | merges with cell above
 * - Decimal alignment: |---.| in delimiter row
 * - Captions: *italic text* before/after table (handled in decorations.ts)
 *
 * Table structure:
 * | Header 1 | Header 2 |   <- TableHeader row
 * |:--{40%}--|--{60%}.:|   <- Delimiter row (alignment, width, decimal)
 * | Cell 1   | 12.50    |   <- Data rows
 * | ^        | 100.25   |   <- Rowspan marker
 * | Spans    | >        |   <- Colspan marker
 *
 * Design principles:
 * - Parse once, use everywhere
 * - Handle edge cases gracefully (escaped pipes, empty cells)
 * - Degrade gracefully in other editors
 * - Preserve original spacing for round-trip fidelity
 */

import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// =============================================================================
// Types
// =============================================================================

/**
 * Column alignment as defined by the delimiter row
 * 'decimal' is Tufte extension for decimal-point alignment
 */
export type ColumnAlignment = 'left' | 'center' | 'right' | 'decimal' | null;

/**
 * Column width specification from delimiter row
 */
export interface ColumnWidth {
  value: number;
  unit: '%' | 'px' | 'fr' | 'em';
}

/**
 * A single parsed table cell with span information
 */
export interface TableCell {
  /** Raw content (trimmed) */
  content: string;
  /** Original content with whitespace */
  raw: string;
  /** Colspan value (default 1) */
  colspan: number;
  /** Rowspan value (default 1) */
  rowspan: number;
  /** Whether this cell is hidden (merged into another) */
  hidden: boolean;
  /** Whether this cell contains a colspan marker (>) */
  isColspanMarker: boolean;
  /** Whether this cell contains a rowspan marker (^) */
  isRowspanMarker: boolean;
}

/**
 * A parsed table row
 */
export interface TableRow {
  cells: TableCell[];
  isHeader: boolean;
  isDelimiter: boolean;
}

/**
 * Complete parsed table structure with Tufte extensions
 */
export interface ParsedTable {
  rows: TableRow[];
  alignments: ColumnAlignment[];
  columnWidths: (ColumnWidth | null)[];
  columnCount: number;
  /** Columns marked for explicit decimal alignment */
  decimalColumns: Set<number>;
  /** Start position in document */
  from: number;
  /** End position in document */
  to: number;
}

/**
 * Information about a table block in the document
 */
export interface TableBlockInfo {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  parsed: ParsedTable;
}

// =============================================================================
// Constants
// =============================================================================

/** Marker for colspan (merge with cell to left) */
const COLSPAN_MARKER = '>';

/** Marker for rowspan (merge with cell above) */
const ROWSPAN_MARKER = '^';

// =============================================================================
// Detection Functions
// =============================================================================

/**
 * Check if a line looks like a table row (contains pipes)
 * This is a quick heuristic, not a full parse
 */
export function isTableLine(line: string): boolean {
  // Must contain at least one pipe that's not escaped
  // Simple check: contains | and doesn't start with code fence
  if (line.startsWith('```') || line.startsWith('~~~')) {
    return false;
  }
  return line.includes('|');
}

/**
 * Check if a line is a table delimiter row
 * Enhanced to support Tufte extensions: |:--{30%}| and |---.|
 */
export function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') && !trimmed.includes('|')) {
    return false;
  }

  const cells = splitTableRow(trimmed);
  if (cells.length === 0) {
    return false;
  }

  // Each cell must match the delimiter pattern
  // Extended pattern allows: colons, dashes, dots, and width specs in various orders
  // Examples: ---, :---, ---:, :---:, ---., :--{30%}, --{100px}:, :--{30%}:
  // The core requirement is at least one dash, with optional colons, dot, and width
  const delimiterPattern = /^:?-+(?:\{[^}]+\})?\.?:?$|^:?-+\.?(?:\{[^}]+\})?:?$/;
  return cells.every(cell => delimiterPattern.test(cell.trim()));
}

/**
 * Check if cell content is a colspan marker
 */
export function isColspanMarker(content: string): boolean {
  return content.trim() === COLSPAN_MARKER;
}

/**
 * Check if cell content is a rowspan marker
 */
export function isRowspanMarker(content: string): boolean {
  return content.trim() === ROWSPAN_MARKER;
}

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Parse column alignments and widths from a delimiter row
 *
 * Supports:
 * - :--- (left), ---: (right), :---: (center)
 * - ---. (decimal alignment - Tufte)
 * - {30%}, {100px}, {2fr} (column widths - Tufte)
 *
 * @returns Object with alignments, widths, and decimal column indices
 */
export function parseDelimiterRow(delimiterLine: string): {
  alignments: ColumnAlignment[];
  widths: (ColumnWidth | null)[];
  decimalColumns: Set<number>;
} {
  const cells = splitTableRow(delimiterLine);
  const alignments: ColumnAlignment[] = [];
  const widths: (ColumnWidth | null)[] = [];
  const decimalColumns = new Set<number>();

  cells.forEach((cell, index) => {
    const trimmed = cell.trim();

    // Extract width if present: {30%}, {100px}, {2fr}, {1.5em}
    let width: ColumnWidth | null = null;
    const widthMatch = trimmed.match(/\{(\d+(?:\.\d+)?)(px|%|fr|em)\}/);
    if (widthMatch) {
      width = {
        value: parseFloat(widthMatch[1]),
        unit: widthMatch[2] as '%' | 'px' | 'fr' | 'em',
      };
    }
    widths.push(width);

    // Remove width specification for alignment parsing
    const alignPart = trimmed.replace(/\{[^}]+\}/, '');

    // Check for decimal alignment marker (.)
    const hasDecimal = alignPart.includes('.');
    if (hasDecimal) {
      decimalColumns.add(index);
    }

    // Parse alignment from colons
    const leftColon = alignPart.startsWith(':');
    const rightColon = alignPart.endsWith(':');

    if (hasDecimal) {
      // Decimal alignment (Tufte extension)
      alignments.push('decimal');
    } else if (leftColon && rightColon) {
      alignments.push('center');
    } else if (rightColon) {
      alignments.push('right');
    } else if (leftColon) {
      alignments.push('left');
    } else {
      alignments.push(null);
    }
  });

  return { alignments, widths, decimalColumns };
}

/**
 * Parse column alignments from a delimiter row (legacy interface)
 */
export function parseAlignments(delimiterLine: string): ColumnAlignment[] {
  return parseDelimiterRow(delimiterLine).alignments;
}

/**
 * Split a table row into cells, handling escaped pipes
 *
 * GFM spec: Pipes inside cells must be escaped as \|
 * Leading/trailing pipes are optional but common
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let i = 0;

  // Skip leading pipe if present
  const trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    i = trimmed.indexOf('|') + 1;
  } else {
    i = 0;
  }

  while (i < trimmed.length) {
    const char = trimmed[i];

    if (char === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      // Escaped pipe - include the pipe in content
      current += '|';
      i += 2;
    } else if (char === '|') {
      // Cell boundary
      cells.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }

  // Don't add the last segment if it's empty (trailing pipe case)
  // But do add it if there's content
  if (current.trim() !== '') {
    cells.push(current);
  }

  return cells;
}

/**
 * Parse a table row into structured cells
 */
export function parseTableRow(
  line: string,
  isHeader: boolean = false,
  isDelimiter: boolean = false
): TableRow {
  const rawCells = splitTableRow(line);

  const cells: TableCell[] = rawCells.map(raw => {
    const content = raw.trim();
    return {
      content,
      raw,
      colspan: 1,
      rowspan: 1,
      hidden: false,
      isColspanMarker: isColspanMarker(content),
      isRowspanMarker: isRowspanMarker(content),
    };
  });

  return {
    cells,
    isHeader,
    isDelimiter,
  };
}

/**
 * Process colspan markers in a table
 * A cell with ">" merges with the cell to its left
 */
function processColspans(rows: TableRow[]): void {
  for (const row of rows) {
    if (row.isDelimiter) continue;

    // Process right-to-left so we can accumulate spans
    for (let col = row.cells.length - 1; col >= 0; col--) {
      const cell = row.cells[col];

      if (cell.isColspanMarker && col > 0) {
        // Find the non-marker cell to the left
        let targetCol = col - 1;
        while (targetCol >= 0 && row.cells[targetCol].isColspanMarker) {
          targetCol--;
        }

        if (targetCol >= 0) {
          // Expand the target cell's colspan
          row.cells[targetCol].colspan++;
          // Mark this cell as hidden
          cell.hidden = true;
        }
      }
    }
  }
}

/**
 * Process rowspan markers in a table
 * A cell with "^" merges with the cell above it
 */
function processRowspans(rows: TableRow[]): void {
  // Skip header and delimiter rows for rowspan processing
  const dataStartIndex = rows.findIndex(r => !r.isHeader && !r.isDelimiter);
  if (dataStartIndex === -1) return;

  // Process bottom-to-top so we can accumulate spans
  for (let rowIdx = rows.length - 1; rowIdx >= 0; rowIdx--) {
    const row = rows[rowIdx];
    if (row.isDelimiter) continue;

    for (let col = 0; col < row.cells.length; col++) {
      const cell = row.cells[col];

      if (cell.isRowspanMarker) {
        // Find the non-marker cell above
        let targetRow = rowIdx - 1;
        while (targetRow >= 0) {
          const aboveRow = rows[targetRow];
          if (aboveRow.isDelimiter) {
            targetRow--;
            continue;
          }

          if (col < aboveRow.cells.length) {
            const aboveCell = aboveRow.cells[col];
            if (aboveCell.isRowspanMarker) {
              targetRow--;
              continue;
            }
            // Expand the target cell's rowspan
            aboveCell.rowspan++;
            // Mark this cell as hidden
            cell.hidden = true;
            break;
          }
          break;
        }
      }
    }
  }
}

/**
 * Parse a complete markdown table from text lines
 *
 * @param lines - Array of line strings making up the table
 * @param from - Start position in document
 * @param to - End position in document
 */
export function parseTable(lines: string[], from: number, to: number): ParsedTable | null {
  if (lines.length < 2) {
    return null; // Tables need at least header + delimiter
  }

  // Find the delimiter row (should be second row in a valid table)
  let delimiterIndex = -1;
  for (let i = 0; i < lines.length && i < 3; i++) {
    if (isTableDelimiter(lines[i])) {
      delimiterIndex = i;
      break;
    }
  }

  if (delimiterIndex === -1 || delimiterIndex === 0) {
    return null; // No delimiter found or no header before delimiter
  }

  // Parse delimiter row for alignments, widths, and decimal columns
  const { alignments, widths, decimalColumns } = parseDelimiterRow(lines[delimiterIndex]);
  const columnCount = alignments.length;

  // Parse all rows
  const rows: TableRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === delimiterIndex) {
      // Include delimiter row but mark it
      rows.push(parseTableRow(lines[i], false, true));
    } else if (i < delimiterIndex) {
      // Header row(s)
      rows.push(parseTableRow(lines[i], true, false));
    } else {
      // Data rows
      rows.push(parseTableRow(lines[i], false, false));
    }
  }

  // Process colspan and rowspan markers
  processColspans(rows);
  processRowspans(rows);

  return {
    rows,
    alignments,
    columnWidths: widths,
    columnCount,
    decimalColumns,
    from,
    to,
  };
}

// =============================================================================
// Document Integration
// =============================================================================

/**
 * Get table block info at a given position using the syntax tree
 *
 * This is the primary way to detect tables - it uses the parser's
 * Table node which handles all the edge cases correctly.
 */
export function getTableAtPosition(state: EditorState, pos: number): TableBlockInfo | null {
  const tree = syntaxTree(state);
  let foundFrom = -1;
  let foundTo = -1;

  // Find Table node containing position
  tree.iterate({
    from: 0,
    to: state.doc.length,
    enter: (node) => {
      if (node.name === 'Table') {
        if (pos >= node.from && pos <= node.to) {
          foundFrom = node.from;
          foundTo = node.to;
          return false; // Stop iteration
        }
      }
    },
  });

  if (foundFrom === -1) {
    return null;
  }

  // Extract lines and parse
  const startLine = state.doc.lineAt(foundFrom);
  const endLine = state.doc.lineAt(foundTo);

  const lines: string[] = [];
  for (let i = startLine.number; i <= endLine.number; i++) {
    lines.push(state.doc.line(i).text);
  }

  const parsed = parseTable(lines, foundFrom, foundTo);
  if (!parsed) {
    return null;
  }

  return {
    from: foundFrom,
    to: foundTo,
    startLine: startLine.number,
    endLine: endLine.number,
    parsed,
  };
}

/**
 * Find all tables in a document
 */
export function getAllTables(state: EditorState): TableBlockInfo[] {
  const tables: TableBlockInfo[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        const startLine = state.doc.lineAt(node.from);
        const endLine = state.doc.lineAt(node.to);

        const lines: string[] = [];
        for (let i = startLine.number; i <= endLine.number; i++) {
          lines.push(state.doc.line(i).text);
        }

        const parsed = parseTable(lines, node.from, node.to);
        if (parsed) {
          tables.push({
            from: node.from,
            to: node.to,
            startLine: startLine.number,
            endLine: endLine.number,
            parsed,
          });
        }
      }
    },
  });

  return tables;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a cell content looks like a number
 * Used for automatic right-alignment and decimal alignment of numeric data
 *
 * Matches:
 * - Integers: 123, -456, 1,234,567
 * - Decimals: 12.34, -0.5, 1,234.56
 * - Percentages: 50%, -12.5%
 * - Currency: $100, €50.25, £30, ¥1000
 * - Magnitudes: 1.2M, 500K, 2.5B, 100k
 * - Combinations: $1.2M, €500K, -12.5%
 */
export function isNumericContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === '') return false;

  // Pattern: [currency][sign][digits with commas][.decimals][suffix]
  // Currency: $, €, £, ¥
  // Suffix: %, M, K, B (case insensitive)
  const numericPattern = /^[$€£¥]?\s*-?[\d,]+(?:\.\d+)?\s*[%MKBkmb]?$/;
  return numericPattern.test(trimmed);
}

/**
 * Normalize a table to have consistent column counts
 * Pads rows with empty cells if needed
 */
export function normalizeTable(table: ParsedTable): ParsedTable {
  const maxColumns = Math.max(
    table.columnCount,
    ...table.rows.map(row => row.cells.length)
  );

  const normalizedRows = table.rows.map(row => {
    if (row.cells.length < maxColumns) {
      const padding: TableCell[] = [];
      for (let i = row.cells.length; i < maxColumns; i++) {
        padding.push({
          content: '',
          raw: '',
          colspan: 1,
          rowspan: 1,
          hidden: false,
          isColspanMarker: false,
          isRowspanMarker: false,
        });
      }
      return {
        ...row,
        cells: [...row.cells, ...padding],
      };
    }
    return row;
  });

  // Ensure alignments array matches column count
  const normalizedAlignments = [...table.alignments];
  while (normalizedAlignments.length < maxColumns) {
    normalizedAlignments.push(null);
  }

  // Ensure widths array matches column count
  const normalizedWidths = [...table.columnWidths];
  while (normalizedWidths.length < maxColumns) {
    normalizedWidths.push(null);
  }

  return {
    ...table,
    rows: normalizedRows,
    alignments: normalizedAlignments,
    columnWidths: normalizedWidths,
    columnCount: maxColumns,
  };
}

/**
 * Get effective alignment for a column
 * Considers explicit alignment, decimal marking, and auto-detection
 */
export function getEffectiveAlignment(
  table: ParsedTable,
  columnIndex: number,
  autoDetectNumeric: boolean = true
): ColumnAlignment {
  // Check explicit decimal columns first
  if (table.decimalColumns.has(columnIndex)) {
    return 'decimal';
  }

  // Check explicit alignment
  const explicit = table.alignments[columnIndex];
  if (explicit) {
    return explicit;
  }

  // Auto-detect numeric columns
  if (autoDetectNumeric) {
    let numericCount = 0;
    let totalCount = 0;

    for (const row of table.rows) {
      if (row.isHeader || row.isDelimiter) continue;
      const cell = row.cells[columnIndex];
      if (cell && cell.content.trim() !== '' && !cell.hidden) {
        totalCount++;
        if (isNumericContent(cell.content)) {
          numericCount++;
        }
      }
    }

    // Consider column numeric if >70% of non-empty cells are numbers
    if (totalCount > 0 && numericCount / totalCount > 0.7) {
      return 'right';
    }
  }

  return null;
}

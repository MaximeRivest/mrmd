/**
 * Table Parsing Tests
 *
 * Comprehensive tests for GFM table parsing utilities.
 * Tests edge cases, alignment detection, and various table formats.
 */

import { describe, it, expect } from 'vitest';
import {
  isTableLine,
  isTableDelimiter,
  parseAlignments,
  splitTableRow,
  parseTableRow,
  parseTable,
  isNumericContent,
  normalizeTable,
  isColspanMarker,
  isRowspanMarker,
} from '../tables';

describe('Table Detection', () => {
  describe('isTableLine', () => {
    it('detects lines with pipes', () => {
      expect(isTableLine('| a | b |')).toBe(true);
      expect(isTableLine('a | b')).toBe(true);
      expect(isTableLine('|---|---|')).toBe(true);
    });

    it('rejects lines without pipes', () => {
      expect(isTableLine('no pipes here')).toBe(false);
      expect(isTableLine('')).toBe(false);
    });

    it('rejects code fences', () => {
      expect(isTableLine('```javascript')).toBe(false);
      expect(isTableLine('~~~python')).toBe(false);
    });
  });

  describe('isTableDelimiter', () => {
    it('detects basic delimiter rows', () => {
      expect(isTableDelimiter('|---|---|')).toBe(true);
      expect(isTableDelimiter('| --- | --- |')).toBe(true);
      expect(isTableDelimiter('|-----|-----|')).toBe(true);
    });

    it('detects aligned delimiter rows', () => {
      expect(isTableDelimiter('|:---|---:|')).toBe(true);
      expect(isTableDelimiter('|:---:|:---:|')).toBe(true);
      expect(isTableDelimiter('| :--- | ---: | :---: |')).toBe(true);
    });

    it('rejects non-delimiter rows', () => {
      expect(isTableDelimiter('| a | b |')).toBe(false);
      expect(isTableDelimiter('| 123 | 456 |')).toBe(false);
      expect(isTableDelimiter('no table here')).toBe(false);
    });

    it('handles edge cases', () => {
      expect(isTableDelimiter('|-|')).toBe(true); // Single dash is valid
      expect(isTableDelimiter('|--|')).toBe(true);
      expect(isTableDelimiter('')).toBe(false);
    });
  });
});

describe('Alignment Parsing', () => {
  describe('parseAlignments', () => {
    it('parses left alignment', () => {
      expect(parseAlignments('|:---|:---|')).toEqual(['left', 'left']);
    });

    it('parses right alignment', () => {
      expect(parseAlignments('|---:|---:|')).toEqual(['right', 'right']);
    });

    it('parses center alignment', () => {
      expect(parseAlignments('|:---:|:---:|')).toEqual(['center', 'center']);
    });

    it('parses mixed alignments', () => {
      expect(parseAlignments('|:---|:---:|---:|')).toEqual(['left', 'center', 'right']);
    });

    it('returns null for default alignment', () => {
      expect(parseAlignments('|---|---|')).toEqual([null, null]);
    });

    it('handles spaces in delimiter', () => {
      expect(parseAlignments('| :--- | ---: | :---: | --- |')).toEqual([
        'left', 'right', 'center', null
      ]);
    });
  });
});

describe('Row Splitting', () => {
  describe('splitTableRow', () => {
    it('splits basic rows', () => {
      // Note: spaces are preserved, trimming happens in parseTableRow
      expect(splitTableRow('| a | b | c |')).toEqual([' a ', ' b ', ' c ']);
    });

    it('handles escaped pipes', () => {
      expect(splitTableRow('| a \\| b | c |')).toEqual([' a | b ', ' c ']);
    });

    it('handles no leading pipe', () => {
      expect(splitTableRow('a | b | c')).toEqual(['a ', ' b ', ' c']);
    });

    it('handles trailing pipe', () => {
      const result = splitTableRow('| a | b |');
      expect(result).toEqual([' a ', ' b ']);
    });

    it('handles empty cells', () => {
      expect(splitTableRow('| a |  | c |')).toEqual([' a ', '  ', ' c ']);
    });
  });

  describe('parseTableRow', () => {
    it('parses data row', () => {
      const row = parseTableRow('| Hello | World |');
      expect(row.isHeader).toBe(false);
      expect(row.isDelimiter).toBe(false);
      expect(row.cells.length).toBe(2);
      expect(row.cells[0].content).toBe('Hello');
      expect(row.cells[1].content).toBe('World');
    });

    it('parses header row', () => {
      const row = parseTableRow('| Name | Age |', true);
      expect(row.isHeader).toBe(true);
      expect(row.isDelimiter).toBe(false);
    });

    it('parses delimiter row', () => {
      const row = parseTableRow('|---|---|', false, true);
      expect(row.isHeader).toBe(false);
      expect(row.isDelimiter).toBe(true);
    });
  });
});

describe('Table Parsing', () => {
  describe('parseTable', () => {
    it('parses a simple table', () => {
      const lines = [
        '| Name | Age |',
        '|------|-----|',
        '| Alice | 30 |',
        '| Bob | 25 |',
      ];

      const table = parseTable(lines, 0, 100);

      expect(table).not.toBeNull();
      expect(table!.columnCount).toBe(2);
      expect(table!.rows.length).toBe(4);
      expect(table!.alignments).toEqual([null, null]);

      // Check header
      expect(table!.rows[0].isHeader).toBe(true);
      expect(table!.rows[0].cells[0].content).toBe('Name');

      // Check delimiter
      expect(table!.rows[1].isDelimiter).toBe(true);

      // Check data
      expect(table!.rows[2].isHeader).toBe(false);
      expect(table!.rows[2].cells[0].content).toBe('Alice');
    });

    it('parses table with alignments', () => {
      const lines = [
        '| Left | Center | Right |',
        '|:-----|:------:|------:|',
        '| a | b | c |',
      ];

      const table = parseTable(lines, 0, 100);

      expect(table).not.toBeNull();
      expect(table!.alignments).toEqual(['left', 'center', 'right']);
    });

    it('returns null for invalid tables', () => {
      // No delimiter row
      expect(parseTable(['| a | b |', '| c | d |'], 0, 10)).toBeNull();

      // Empty input
      expect(parseTable([], 0, 0)).toBeNull();

      // Only one line
      expect(parseTable(['| a | b |'], 0, 10)).toBeNull();
    });

    it('handles tables with varying column counts', () => {
      const lines = [
        '| A | B |',
        '|---|---|',
        '| 1 | 2 | 3 |', // Extra column
        '| 4 |',         // Missing column
      ];

      const table = parseTable(lines, 0, 100);
      expect(table).not.toBeNull();
      // Should still parse, normalization handles column count
    });
  });

  describe('normalizeTable', () => {
    it('pads rows with empty cells', () => {
      const lines = [
        '| A | B | C |',
        '|---|---|---|',
        '| 1 | 2 |',      // Missing one cell
        '| 3 |',          // Missing two cells
      ];

      const table = parseTable(lines, 0, 100);
      const normalized = normalizeTable(table!);

      expect(normalized.columnCount).toBe(3);
      expect(normalized.rows[2].cells.length).toBe(3);
      expect(normalized.rows[3].cells.length).toBe(3);
      expect(normalized.rows[3].cells[1].content).toBe('');
      expect(normalized.rows[3].cells[2].content).toBe('');
    });

    it('extends alignments array', () => {
      const lines = [
        '| A | B | C | D |',
        '|---|---|',  // Only 2 alignment specs
        '| 1 | 2 | 3 | 4 |',
      ];

      const table = parseTable(lines, 0, 100);
      const normalized = normalizeTable(table!);

      expect(normalized.alignments.length).toBe(4);
      expect(normalized.alignments[2]).toBeNull();
      expect(normalized.alignments[3]).toBeNull();
    });
  });
});

describe('Numeric Detection', () => {
  describe('isNumericContent', () => {
    it('detects integers', () => {
      expect(isNumericContent('123')).toBe(true);
      expect(isNumericContent('-456')).toBe(true);
      expect(isNumericContent('0')).toBe(true);
    });

    it('detects decimals', () => {
      expect(isNumericContent('12.34')).toBe(true);
      expect(isNumericContent('-0.5')).toBe(true);
      expect(isNumericContent('3.14159')).toBe(true);
    });

    it('detects percentages', () => {
      expect(isNumericContent('50%')).toBe(true);
      expect(isNumericContent('-12.5%')).toBe(true);
    });

    it('detects currency', () => {
      expect(isNumericContent('$100')).toBe(true);
      expect(isNumericContent('€50')).toBe(true);
      expect(isNumericContent('£30.99')).toBe(true);
      expect(isNumericContent('¥1000')).toBe(true);
    });

    it('detects numbers with commas', () => {
      expect(isNumericContent('1,000')).toBe(true);
      expect(isNumericContent('1,234,567')).toBe(true);
      expect(isNumericContent('1,234.56')).toBe(true);
    });

    it('detects magnitude suffixes (M, K, B)', () => {
      expect(isNumericContent('1.2M')).toBe(true);
      expect(isNumericContent('500K')).toBe(true);
      expect(isNumericContent('2.5B')).toBe(true);
      expect(isNumericContent('100k')).toBe(true);
      expect(isNumericContent('1.5m')).toBe(true);
    });

    it('detects combinations', () => {
      expect(isNumericContent('$1.2M')).toBe(true);
      expect(isNumericContent('€500K')).toBe(true);
      expect(isNumericContent('$1,234.56')).toBe(true);
      expect(isNumericContent('-12.5%')).toBe(true);
    });

    it('rejects non-numeric content', () => {
      expect(isNumericContent('hello')).toBe(false);
      expect(isNumericContent('abc123')).toBe(false);
      expect(isNumericContent('')).toBe(false);
      expect(isNumericContent('   ')).toBe(false);
      expect(isNumericContent('N/A')).toBe(false);
      expect(isNumericContent('Active')).toBe(false);
    });
  });
});

// =============================================================================
// Tufte Markdown Extensions
// =============================================================================

describe('Tufte Markdown: Column Widths', () => {
  it('parses width from delimiter row', () => {
    const lines = [
      '| A | B |',
      '|:--{30%}|--{70%}:|',
      '| 1 | 2 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();
    expect(table!.columnWidths[0]).toEqual({ value: 30, unit: '%' });
    expect(table!.columnWidths[1]).toEqual({ value: 70, unit: '%' });
  });

  it('parses different width units', () => {
    const lines = [
      '| A | B | C | D |',
      '|--{100px}|--{2fr}|--{1.5em}|---|',
      '| 1 | 2 | 3 | 4 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table!.columnWidths[0]).toEqual({ value: 100, unit: 'px' });
    expect(table!.columnWidths[1]).toEqual({ value: 2, unit: 'fr' });
    expect(table!.columnWidths[2]).toEqual({ value: 1.5, unit: 'em' });
    expect(table!.columnWidths[3]).toBeNull();
  });
});

describe('Tufte Markdown: Colspan', () => {
  it('detects colspan markers', () => {
    expect(isColspanMarker('>')).toBe(true);
    expect(isColspanMarker(' > ')).toBe(true);
    expect(isColspanMarker('text')).toBe(false);
    expect(isColspanMarker('> text')).toBe(false);
  });

  it('parses colspan from > markers', () => {
    const lines = [
      '| A | B | C |',
      '|---|---|---|',
      '| Spans two | > | Single |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();

    const dataRow = table!.rows[2];
    expect(dataRow.cells[0].colspan).toBe(2);
    expect(dataRow.cells[0].hidden).toBe(false);
    expect(dataRow.cells[1].hidden).toBe(true);
    expect(dataRow.cells[2].colspan).toBe(1);
  });

  it('handles multiple consecutive colspans', () => {
    const lines = [
      '| A | B | C | D |',
      '|---|---|---|---|',
      '| Spans all | > | > | > |',
    ];

    const table = parseTable(lines, 0, 100);
    const dataRow = table!.rows[2];

    expect(dataRow.cells[0].colspan).toBe(4);
    expect(dataRow.cells[1].hidden).toBe(true);
    expect(dataRow.cells[2].hidden).toBe(true);
    expect(dataRow.cells[3].hidden).toBe(true);
  });
});

describe('Tufte Markdown: Rowspan', () => {
  it('detects rowspan markers', () => {
    expect(isRowspanMarker('^')).toBe(true);
    expect(isRowspanMarker(' ^ ')).toBe(true);
    expect(isRowspanMarker('text')).toBe(false);
    expect(isRowspanMarker('^ text')).toBe(false);
  });

  it('parses rowspan from ^ markers', () => {
    const lines = [
      '| A | B |',
      '|---|---|',
      '| Spans | 1 |',
      '| ^ | 2 |',
      '| ^ | 3 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();

    // First data row
    expect(table!.rows[2].cells[0].rowspan).toBe(3);
    expect(table!.rows[2].cells[0].hidden).toBe(false);

    // Second data row
    expect(table!.rows[3].cells[0].hidden).toBe(true);

    // Third data row
    expect(table!.rows[4].cells[0].hidden).toBe(true);
  });
});

describe('Tufte Markdown: Decimal Alignment', () => {
  it('detects decimal alignment marker in delimiter', () => {
    const lines = [
      '| Name | Value |',
      '|------|----.|',
      '| A | 12.50 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();
    expect(table!.decimalColumns.has(1)).toBe(true);
    expect(table!.alignments[1]).toBe('decimal');
  });

  it('parses decimal with other alignment markers', () => {
    const lines = [
      '| Left | Decimal | Center |',
      '|:---|---.|:---:|',
      '| A | 12.50 | B |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table!.alignments[0]).toBe('left');
    expect(table!.alignments[1]).toBe('decimal');
    expect(table!.alignments[2]).toBe('center');
  });
});

describe('Tufte Markdown: Combined Features', () => {
  it('parses table with colspan, rowspan, and widths', () => {
    const lines = [
      '| Category | 2024 | > |',
      '|:--{30%}|:--{35%}:|:--{35%}:|',
      '| ^ | Q1 | Q2 |',
      '| Sales | 100 | 150 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();

    // Check widths
    expect(table!.columnWidths[0]).toEqual({ value: 30, unit: '%' });
    expect(table!.columnWidths[1]).toEqual({ value: 35, unit: '%' });

    // Check header colspan
    expect(table!.rows[0].cells[1].colspan).toBe(2);

    // Note: Rowspan in header row is unusual but should still parse
  });
});

describe('Edge Cases', () => {
  it('handles Unicode content', () => {
    const lines = [
      '| 名前 | 年齢 |',
      '|------|------|',
      '| 田中 | 25 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();
    expect(table!.rows[0].cells[0].content).toBe('名前');
  });

  it('handles emoji content', () => {
    const lines = [
      '| Status | Count |',
      '|--------|-------|',
      '| ✅ | 10 |',
      '| ❌ | 5 |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();
    expect(table!.rows[2].cells[0].content).toBe('✅');
  });

  it('handles inline code in cells', () => {
    const lines = [
      '| Function | Description |',
      '|----------|-------------|',
      '| `map()` | Transform elements |',
    ];

    const table = parseTable(lines, 0, 100);
    expect(table).not.toBeNull();
    expect(table!.rows[2].cells[0].content).toBe('`map()`');
  });

  it('handles empty tables gracefully', () => {
    const lines = [
      '| A | B |',
      '|---|---|',
    ];

    const table = parseTable(lines, 0, 50);
    expect(table).not.toBeNull();
    expect(table!.rows.length).toBe(2);
    // Only header and delimiter, no data rows
  });
});

import { DEFAULT_CELL_OPTIONS, type CellOptions } from './types';

/**
 * Parse cell options from a fenced code block opening line
 *
 * Supports RMarkdown-style syntax:
 *   ```html {shadow=true, echo=false}
 *   ```python {eval=false}
 *
 * Boolean options can be:
 *   - key=true / key=false
 *   - key (shorthand for key=true)
 *   - !key (shorthand for key=false)
 */
export function parseCellOptions(fenceLine: string): {
  language: string;
  options: CellOptions;
  execId?: string;
} {
  // Match: ```language:execId {options} or ```language {options}
  const match = fenceLine.match(
    /^`{3,}(\w+)(?::([^\s{]+))?(?:\s*\{([^}]*)\})?/
  );

  if (!match) {
    return { language: '', options: { ...DEFAULT_CELL_OPTIONS } };
  }

  const language = match[1];
  const execId = match[2];
  const optStr = match[3] || '';
  const options = { ...DEFAULT_CELL_OPTIONS };

  if (optStr.trim()) {
    parseOptionsString(optStr, options);
  }

  return { language, options, execId };
}

/**
 * Parse options string into CellOptions object
 */
function parseOptionsString(optStr: string, options: CellOptions): void {
  // Split by comma, handling potential whitespace
  const pairs = optStr.split(/,\s*/);

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    // Handle !key shorthand for key=false
    if (trimmed.startsWith('!')) {
      const key = trimmed.slice(1) as keyof CellOptions;
      if (key in options) {
        options[key] = false;
      }
      continue;
    }

    // Handle key=value or just key (shorthand for key=true)
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      // Shorthand: just "shadow" means shadow=true
      const key = trimmed as keyof CellOptions;
      if (key in options) {
        options[key] = true;
      }
    } else {
      const key = trimmed.slice(0, eqIndex).trim() as keyof CellOptions;
      const val = trimmed.slice(eqIndex + 1).trim().toLowerCase();
      if (key in options) {
        options[key] = val !== 'false' && val !== '0';
      }
    }
  }
}

/**
 * Parse inline options from rendered block fence
 * e.g., ```html-rendered:exec123 {shadow, !echo}
 */
export function parseRenderedOptions(fenceLine: string): {
  execId: string;
  options: CellOptions;
} {
  const match = fenceLine.match(
    /^`{3,}html-rendered:([^\s{]+)(?:\s*\{([^}]*)\})?/
  );

  if (!match) {
    return { execId: '', options: { ...DEFAULT_CELL_OPTIONS } };
  }

  const execId = match[1];
  const optStr = match[2] || '';
  const options = { ...DEFAULT_CELL_OPTIONS };

  if (optStr.trim()) {
    parseOptionsString(optStr, options);
  }

  return { execId, options };
}

/**
 * Serialize options back to string for embedding in fence
 */
export function serializeCellOptions(options: Partial<CellOptions>): string {
  const parts: string[] = [];

  if (options.shadow) parts.push('shadow');
  if (options.echo === false) parts.push('!echo');
  if (options.defer) parts.push('defer');
  if (options.scope) parts.push('scope');

  return parts.length > 0 ? ` {${parts.join(', ')}}` : '';
}

/**
 * Footnote Widgets
 *
 * Renders footnote references as superscript numbers/labels.
 * [^1] -> ¹, [^note] -> [note]
 */

import { WidgetType, EditorView } from '@codemirror/view';

// Unicode superscript digits
const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/**
 * Convert a number string to superscript
 */
function toSuperscript(str: string): string {
  if (/^\d+$/.test(str)) {
    return str.split('').map(d => SUPERSCRIPT_DIGITS[d] || d).join('');
  }
  // For non-numeric IDs, return as-is in brackets
  return `[${str}]`;
}

/**
 * Widget for rendering footnote references
 */
export class FootnoteRefWidget extends WidgetType {
  constructor(private readonly id: string) {
    super();
  }

  eq(other: FootnoteRefWidget): boolean {
    return this.id === other.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-footnote-ref';
    span.textContent = toSuperscript(this.id);
    span.title = `Footnote ${this.id}`;
    return span;
  }
}

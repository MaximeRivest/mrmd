import { WidgetType } from '@codemirror/view';

/**
 * Allowlist of typographic inline HTML tags that are safe to render
 * These are semantic/presentational tags that don't execute code
 */
export const INLINE_HTML_TAGS = new Set([
  'kbd',      // Keyboard input
  'mark',     // Highlighted text
  'sup',      // Superscript
  'sub',      // Subscript
  'abbr',     // Abbreviation
  'small',    // Small print
  'del',      // Deleted text
  'ins',      // Inserted text
  'cite',     // Citation
  'q',        // Inline quotation
  'code',     // Code (though markdown has this)
  'samp',     // Sample output
  'var',      // Variable
  'time',     // Time/date
  'dfn',      // Definition term
  'em',       // Emphasis (though markdown has this)
  'strong',   // Strong (though markdown has this)
  'b',        // Bold
  'i',        // Italic
  'u',        // Underline
  's',        // Strikethrough
  'span',     // Generic inline container
]);

/**
 * Self-closing HTML tags
 */
export const SELF_CLOSING_TAGS = new Set([
  'br',
  'hr',
  'wbr',
]);

/**
 * Regex to match inline HTML elements
 * Captures: full match, tag name, attributes, content (for paired tags)
 */
export const INLINE_HTML_REGEX = new RegExp(
  // Paired tags: <tag attrs>content</tag>
  `<(${[...INLINE_HTML_TAGS].join('|')})([^>]*)>([\\s\\S]*?)<\\/\\1>` +
  '|' +
  // Self-closing: <br>, <hr>, <br/>, <hr />
  `<(${[...SELF_CLOSING_TAGS].join('|')})([^>]*)\\/?>`,
  'gi'
);

/**
 * Widget that renders inline HTML elements
 */
export class InlineHTMLWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly tagName: string
  ) {
    super();
  }

  eq(other: InlineHTMLWidget): boolean {
    return this.html === other.html;
  }

  toDOM(): HTMLElement {
    // Create a wrapper span to hold the rendered HTML
    const wrapper = document.createElement('span');
    wrapper.className = `cm-inline-html cm-inline-html-${this.tagName}`;

    // Use createContextualFragment for safe parsing
    const range = document.createRange();
    try {
      const fragment = range.createContextualFragment(this.html);
      wrapper.appendChild(fragment);
    } catch {
      // Fallback: show raw HTML if parsing fails
      wrapper.textContent = this.html;
      wrapper.classList.add('cm-inline-html-error');
    }

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Placeholder shown when cursor is on the line (reveals raw HTML)
 */
export class InlineHTMLPlaceholder extends WidgetType {
  constructor(
    readonly tagName: string,
    readonly content: string
  ) {
    super();
  }

  eq(other: InlineHTMLPlaceholder): boolean {
    return this.tagName === other.tagName && this.content === other.content;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-inline-html-placeholder';
    span.textContent = `<${this.tagName}>`;
    span.title = 'Inline HTML';
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Find all inline HTML matches in a line
 */
export function findInlineHTML(
  text: string,
  lineStart: number
): Array<{
  from: number;
  to: number;
  html: string;
  tagName: string;
}> {
  const matches: Array<{
    from: number;
    to: number;
    html: string;
    tagName: string;
  }> = [];

  // Reset regex state
  INLINE_HTML_REGEX.lastIndex = 0;

  let match;
  while ((match = INLINE_HTML_REGEX.exec(text)) !== null) {
    // match[1] = paired tag name, match[4] = self-closing tag name
    const tagName = (match[1] || match[4]).toLowerCase();

    matches.push({
      from: lineStart + match.index,
      to: lineStart + match.index + match[0].length,
      html: match[0],
      tagName,
    });
  }

  return matches;
}

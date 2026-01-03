import {
  EditorView,
  ViewPlugin,
  Decoration,
  DecorationSet,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
// RangeSetBuilder not needed - using Decoration.set with sort:true instead
import { syntaxTree } from '@codemirror/language';
import {
  ImageWidget,
  ImageSyntaxPlaceholder,
  MathWidget,
  RunButtonWidget,
  RenderedHTMLWidget,
  HtmlCellPlaceholder,
  InlineHTMLWidget,
  findInlineHTML,
  CellStatusWidget,
  getCellState,
  OutputWidget,
  EmptyOutputWidget,
  ImageOutputWidget,
  parseImageMarkdown,
  TableWidget,
  generateTableId,
  TaskCheckboxWidget,
  AlertTitleWidget,
  MermaidWidget,
  FootnoteRefWidget,
} from '../widgets';
import { parseTable, isTableLine, isTableDelimiter } from '../core/tables';
import { parseCellOptions, parseRenderedOptions } from '../cells/options';
import { DEFAULT_CELL_OPTIONS } from '../cells/types';
import type { ExecutionTracker } from '../execution/tracker';
import type { ExecutionQueue } from '../execution/queue';
import { isOutputBlock, isHtmlRenderedBlock, isImageOutputBlock, extractLanguage } from '../core/code-blocks';

interface DecorationItem {
  from: number;
  to?: number;
  type: 'mark' | 'line' | 'widget' | 'replace';
  class?: string;
  widget?: WidgetType;
}

/**
 * Mutable reference to ExecutionTracker
 * Allows the tracker to be set after the editor view is created
 */
export interface TrackerRef {
  current: ExecutionTracker | null;
}

/**
 * Mutable reference to ExecutionQueue
 * Allows the queue to be set after the editor view is created
 */
export interface QueueRef {
  current: ExecutionQueue | null;
}

/**
 * Mutable reference to current file path
 */
export interface FilePathRef {
  current: string | null;
}

interface MarkdownDecorationOptions {
  resolveImageUrl?: (url: string) => string;
  /** Reference to execution queue for cell status display */
  queueRef?: QueueRef;
  /** Reference to current file path for queue state lookup */
  filePathRef?: FilePathRef;
}

/**
 * Creates the markdown decorations plugin
 * @param trackerRef - Mutable reference to the execution tracker
 * @param options - Rendering options
 */
export function markdownDecorations(
  trackerRef: TrackerRef = { current: null },
  options: MarkdownDecorationOptions = {}
) {
  const resolveImageUrl = options.resolveImageUrl;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      buildDecorations(view: EditorView): DecorationSet {
        const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
        const items: DecorationItem[] = [];

        syntaxTree(view.state).iterate({
          from: view.viewport.from,
          to: view.viewport.to,
          enter: (node) => {
            const lineNum = view.state.doc.lineAt(node.from).number;
            const isActiveLine = lineNum === cursorLine;
            const hiddenClass = isActiveLine ? 'cm-md-marker' : 'cm-md-hidden';

            // Headings
            if (node.name.startsWith('ATXHeading')) {
              const level = node.name.match(/\d/)?.[0] || '1';

              // Find content start (after # markers and space)
              let contentStart = node.from;
              const headingCursor = node.node.cursor();
              if (headingCursor.firstChild()) {
                do {
                  if (headingCursor.name === 'HeaderMark') {
                    contentStart = headingCursor.to;
                    while (
                      contentStart < node.to &&
                      view.state.doc.sliceString(contentStart, contentStart + 1) === ' '
                    ) {
                      contentStart++;
                    }
                    break;
                  }
                } while (headingCursor.nextSibling());
              }

              if (contentStart < node.to) {
                items.push({
                  from: contentStart,
                  to: node.to,
                  type: 'mark',
                  class: `cm-md-h${level}`,
                });
              }
            }

            // Header markers (# ## ###)
            if (node.name === 'HeaderMark') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: hiddenClass });
            }

            // Bold
            if (node.name === 'StrongEmphasis') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: 'cm-md-bold' });
            }

            // Italic
            if (node.name === 'Emphasis') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: 'cm-md-italic' });
            }

            // Emphasis markers (* **)
            if (node.name === 'EmphasisMark') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: hiddenClass });
            }

            // Inline code
            if (node.name === 'InlineCode') {
              items.push({
                from: node.from,
                to: node.to,
                type: 'mark',
                class: 'cm-md-inline-code',
              });
            }

            // Code backticks (inline)
            if (node.name === 'CodeMark') {
              const text = view.state.doc.sliceString(node.from, node.to);
              if (text.length < 3) {
                items.push({ from: node.from, to: node.to, type: 'mark', class: hiddenClass });
              }
            }

            // Fenced code blocks
            if (node.name === 'FencedCode') {
              const startLine = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(node.to);
              const firstLineText = startLine.text;

              // Check for html-rendered blocks (rendered HTML output)
              if (firstLineText.startsWith('```html-rendered')) {
                const { execId, options } = parseRenderedOptions(firstLineText);

                // Check if cursor is inside this block (show source for editing)
                const cursorPos = view.state.selection.main.head;
                const cursorInBlock = cursorPos >= node.from && cursorPos <= node.to;

                // Extract HTML content between fences
                const contentStart = startLine.to + 1;
                const contentEnd = endLine.from;
                const htmlContent =
                  contentEnd > contentStart
                    ? view.state.doc.sliceString(contentStart, contentEnd).trim()
                    : '';

                if (cursorInBlock) {
                  // Cursor is inside - show source with syntax highlighting
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-html-rendered-editing',
                    });
                  }
                } else {
                  // Cursor is outside - hide source and show rendered widget
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    if (line.to > line.from) {
                      items.push({
                        from: line.from,
                        to: line.to,
                        type: 'mark',
                        class: 'cm-html-rendered-hidden',
                      });
                    }
                  }

                  // Add rendered widget after the block
                  items.push({
                    from: node.to,
                    type: 'widget',
                    widget: new RenderedHTMLWidget(
                      htmlContent,
                      execId,
                      options,
                      node.from,
                      view
                    ),
                  });
                }

                return; // Skip normal code block processing
              }

              // Check for HTML source blocks with echo=false
              if (firstLineText.startsWith('```html')) {
                const { options } = parseCellOptions(firstLineText);

                // Check if there's a rendered block after this (has been executed)
                const afterBlock = view.state.doc.sliceString(
                  node.to,
                  Math.min(node.to + 50, view.state.doc.length)
                );
                const hasRendered = /^\n```html-rendered/.test(afterBlock);

                // Collapse source if echo=false and has output and not editing
                if (!options.echo && hasRendered && !isActiveLine) {
                  const lineCount = endLine.number - startLine.number + 1;
                  // Get first line of content as preview
                  const previewLine =
                    startLine.number + 1 <= endLine.number
                      ? view.state.doc.line(startLine.number + 1).text
                      : '';

                  // Hide all lines (can't use replace across lines in plugins)
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-html-source-hidden',
                    });
                  }

                  // Add placeholder widget after
                  items.push({
                    from: node.to,
                    type: 'widget',
                    widget: new HtmlCellPlaceholder(lineCount, previewLine, hasRendered),
                  });

                  return; // Skip normal code block processing
                }
              }

              // Use shared utilities for consistent detection (supports 3+ backticks)
              const lang = extractLanguage(firstLineText);
              const isOutput = isOutputBlock(firstLineText);
              const isHtmlRendered = isHtmlRenderedBlock(firstLineText);
              const isImageOutput = isImageOutputBlock(firstLineText);
              const isMermaid = lang === 'mermaid';

              // Handle output blocks with ANSI rendering
              if (isOutput) {
                // Extract exec ID from fence (e.g., "output:exec-123" -> "exec-123")
                const execIdMatch = firstLineText.match(/output:([^\s{]+)/);
                const execId = execIdMatch ? execIdMatch[1] : `output-${node.from}`;

                // Check if cursor is inside the output block (allows editing when focused)
                const cursorInBlock = cursorLine >= startLine.number && cursorLine <= endLine.number;

                // Check if there's content (more than just the fences)
                const hasContentLines = endLine.number > startLine.number + 1;

                // All lines always take same space - only text visibility changes (no shift)
                // This prevents flicker during drag-select operations
                for (let i = startLine.number; i <= endLine.number; i++) {
                  const line = view.state.doc.line(i);
                  items.push({
                    from: line.from,
                    type: 'line',
                    class: cursorInBlock
                      ? 'cm-md-output-line-visible'   // Text visible for editing
                      : 'cm-md-output-line-hidden',   // Text invisible, same height
                  });
                }

                // ALWAYS show widget (stable layout - same as image output pattern)
                // When editing, widget is hidden via CSS class
                if (hasContentLines) {
                  // Extract content for the widget (lines between fences)
                  const contentStart = startLine.to + 1;
                  const contentEnd = endLine.from;
                  const content = view.state.sliceDoc(contentStart, contentEnd);

                  // Add OutputWidget after opening fence line
                  // Pass cursorInBlock to control visibility via CSS class
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new OutputWidget(content, execId, { hidden: cursorInBlock }),
                  });
                } else {
                  // Empty block: show "no output" widget
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new EmptyOutputWidget(execId, cursorInBlock),
                  });
                }
              } else if (isImageOutput) {
                // Handle image-output blocks (matplotlib figures, etc.)
                // Extract exec ID from fence (e.g., "image-output:exec-123" -> "exec-123")
                const execIdMatch = firstLineText.match(/image-output:([^\s{]+)/);
                const execId = execIdMatch ? execIdMatch[1] : `image-output-${node.from}`;

                // Check if cursor is in block
                const cursorInBlock = cursorLine >= startLine.number && cursorLine <= endLine.number;

                // Check if there's content (more than just the fences)
                const hasContentLines = endLine.number > startLine.number + 1;

                // Extract content for the widget
                const contentStart = startLine.to + 1;
                const contentEnd = endLine.from;
                const rawContent = view.state.sliceDoc(contentStart, contentEnd).trim();

                // All lines always take same space - only text visibility changes (no shift)
                for (let i = startLine.number; i <= endLine.number; i++) {
                  const line = view.state.doc.line(i);
                  items.push({
                    from: line.from,
                    type: 'line',
                    class: cursorInBlock
                      ? 'cm-md-image-output-line-visible'   // Text visible for editing
                      : 'cm-md-image-output-line-hidden',   // Text invisible, same height
                  });
                }

                // Always show image widget (stable - eq only compares src/alt/execId)
                if (hasContentLines) {
                  const imageInfo = parseImageMarkdown(rawContent);

                  if (imageInfo) {
                    const resolvedSrc = resolveImageUrl
                      ? resolveImageUrl(imageInfo.src)
                      : imageInfo.src;

                    items.push({
                      from: startLine.to,
                      type: 'widget',
                      widget: new ImageOutputWidget(
                        resolvedSrc,
                        imageInfo.alt,
                        execId,
                        { resolveUrl: resolveImageUrl }
                      ),
                    });
                  }
                }
              } else if (isMermaid) {
                // Handle Mermaid diagram blocks
                const cursorInBlock = cursorLine >= startLine.number && cursorLine <= endLine.number;

                // Extract diagram code
                const contentStart = startLine.to + 1;
                const contentEnd = endLine.from;
                const mermaidCode = view.state.sliceDoc(contentStart, contentEnd).trim();

                if (cursorInBlock) {
                  // Show source for editing
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-code-block-line',
                    });
                  }
                } else if (mermaidCode) {
                  // Hide source and show rendered diagram
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-mermaid-line-hidden',
                    });
                  }

                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new MermaidWidget(mermaidCode),
                  });
                }
              } else {
                // Non-output code blocks: add line decorations
                for (let i = startLine.number; i <= endLine.number; i++) {
                  const line = view.state.doc.line(i);
                  items.push({
                    from: line.from,
                    type: 'line',
                    class: isHtmlRendered
                      ? 'cm-md-output-block-line'
                      : 'cm-md-code-block-line',
                  });
                }
              }

              // Add run button or status widget for executable code blocks
              if (!isOutput && !isImageOutput && lang && !['text', 'markdown', 'md', 'output'].includes(lang)) {
                // For HTML blocks, pass the parsed options
                const cellOptions =
                  lang === 'html' ? parseCellOptions(firstLineText).options : undefined;

                // Check queue state to determine widget type
                const queue = options.queueRef?.current ?? null;
                const filePath = options.filePathRef?.current ?? '';
                const { state: cellState, queuePosition, execId } = getCellState(
                  queue,
                  filePath,
                  node.to
                );

                if (cellState !== 'idle' && queue) {
                  // Cell is queued or running - show status widget with cancel
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new CellStatusWidget(
                      node.from,
                      node.to,
                      lang,
                      cellState,
                      queuePosition,
                      execId,
                      view,
                      queue,
                      () => {
                        // onRun callback - re-trigger if needed
                        trackerRef.current?.runBlock(
                          view.state.sliceDoc(node.from, node.to),
                          lang,
                          node.to,
                          cellOptions
                        );
                      }
                    ),
                  });
                } else {
                  // Cell is idle - show run button
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new RunButtonWidget(
                      node.from,
                      node.to,
                      lang,
                      view,
                      trackerRef.current,
                      cellOptions
                    ),
                  });
                }
              }
            }

            // Code fence markers
            if (node.name === 'CodeMark') {
              const text = view.state.doc.sliceString(node.from, node.to);
              if (text.length >= 3) {
                const lineText = view.state.doc.lineAt(node.from).text;
                items.push({
                  from: node.from,
                  to: node.to,
                  type: 'mark',
                  class: isOutputBlock(lineText) ? 'cm-md-output-fence' : 'cm-md-code-fence',
                });
              }
            }

            // Code language
            if (node.name === 'CodeInfo') {
              const langText = view.state.doc.sliceString(node.from, node.to);
              // Check if langText indicates output (e.g., "output" or "output:exec-id")
              const isOutputLang = langText === 'output' || langText.startsWith('output:');
              items.push({
                from: node.from,
                to: node.to,
                type: 'mark',
                class: isOutputLang ? 'cm-md-output-fence' : 'cm-md-code-lang',
              });
            }

            // Links
            if (node.name === 'Link') {
              // Check if this link contains an image (linked image: [![alt](img)](url))
              // If so, skip - the Image handler will handle the entire syntax
              const cursor = node.node.cursor();
              let containsImage = false;
              if (cursor.firstChild()) {
                do {
                  if (cursor.name === 'Image') {
                    containsImage = true;
                    break;
                  }
                } while (cursor.nextSibling());
              }

              if (containsImage) {
                // Skip link processing - Image handler will handle everything
                return;
              }

              // Process regular links
              cursor.moveTo(node.from); // Reset cursor
              if (cursor.firstChild()) {
                do {
                  const childLine = view.state.doc.lineAt(cursor.from).number;
                  const childHidden = childLine === cursorLine ? 'cm-md-marker' : 'cm-md-hidden';

                  if (cursor.name === 'LinkMark') {
                    items.push({
                      from: cursor.from,
                      to: cursor.to,
                      type: 'mark',
                      class: childHidden,
                    });
                  }
                  if (cursor.name === 'LinkLabel') {
                    items.push({
                      from: cursor.from,
                      to: cursor.to,
                      type: 'mark',
                      class: 'cm-md-link-text',
                    });
                  }
                  if (cursor.name === 'URL') {
                    items.push({
                      from: cursor.from,
                      to: cursor.to,
                      type: 'mark',
                      class: childHidden,
                    });
                  }
                } while (cursor.nextSibling());
              }
            }

            // Blockquotes (with GitHub-style alerts support)
            if (node.name === 'Blockquote') {
              const startLine = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(node.to);

              // Check for GitHub-style alert marker: > [!NOTE], [!TIP], etc.
              const firstLineText = startLine.text;
              const alertMatch = firstLineText.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
              const alertType = alertMatch ? alertMatch[1].toLowerCase() : null;

              for (let i = startLine.number; i <= endLine.number; i++) {
                const line = view.state.doc.line(i);
                if (alertType) {
                  // Apply alert-specific styling
                  items.push({ from: line.from, type: 'line', class: `cm-md-alert cm-md-alert-${alertType}` });
                } else {
                  items.push({ from: line.from, type: 'line', class: 'cm-md-blockquote-line' });
                }
              }

              // Hide the alert marker [!TYPE] when not on that line
              if (alertType && startLine.number !== cursorLine) {
                const markerStart = startLine.from + firstLineText.indexOf('[!');
                const markerEnd = startLine.from + firstLineText.indexOf(']') + 1;
                items.push({
                  from: markerStart,
                  to: markerEnd,
                  type: 'replace',
                  widget: new AlertTitleWidget(alertType),
                });
              }
            }

            // Tables (GFM)
            if (node.name === 'Table') {
              const startLine = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(node.to);

              // Check if cursor is inside the table
              const cursorInTable = cursorLine >= startLine.number && cursorLine <= endLine.number;

              // Generate stable table ID from position
              const tableId = generateTableId(node.from);

              // Detect caption: look for italic paragraph before OR after table
              // Format: *Caption text* or _Caption text_ on its own line
              // Tufte Markdown: caption can be above (default) or below (scientific style)
              let captionAbove: string | undefined;
              let captionBelow: string | undefined;
              let captionAboveLine: number | undefined;
              let captionBelowLine: number | undefined;

              // Check for caption BEFORE table
              if (startLine.number > 1) {
                const prevLine = view.state.doc.line(startLine.number - 1);
                const prevText = prevLine.text.trim();
                // Check for italic-wrapped text (entire line is italic)
                const italicMatch = prevText.match(/^[*_](.+)[*_]$/);
                if (italicMatch && !prevText.includes('|')) {
                  captionAbove = italicMatch[1];
                  captionAboveLine = startLine.number - 1;
                }
              }

              // Check for caption AFTER table
              if (endLine.number < view.state.doc.lines) {
                const nextLine = view.state.doc.line(endLine.number + 1);
                const nextText = nextLine.text.trim();
                // Check for italic-wrapped text (entire line is italic)
                const italicMatch = nextText.match(/^[*_](.+)[*_]$/);
                if (italicMatch && !nextText.includes('|')) {
                  captionBelow = italicMatch[1];
                  captionBelowLine = endLine.number + 1;
                }
              }

              // Use caption above if present, otherwise below
              const caption = captionAbove || captionBelow;
              const captionLine = captionAbove ? captionAboveLine : captionBelowLine;
              const captionPosition: 'above' | 'below' | undefined = captionAbove ? 'above' : (captionBelow ? 'below' : undefined);

              if (cursorInTable) {
                // Cursor in table: show raw markdown with subtle styling
                for (let i = startLine.number; i <= endLine.number; i++) {
                  const line = view.state.doc.line(i);
                  items.push({
                    from: line.from,
                    type: 'line',
                    class: 'cm-md-table-line-visible',
                  });
                }
              } else {
                // Cursor outside: hide markdown, show rendered widget
                // Extract table lines for parsing
                const lines: string[] = [];
                for (let i = startLine.number; i <= endLine.number; i++) {
                  lines.push(view.state.doc.line(i).text);
                }

                // Parse the table
                const parsed = parseTable(lines, node.from, node.to);

                if (parsed && parsed.rows.length > 0) {
                  // Hide all table lines (text invisible but lines remain for structure)
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-table-line-hidden',
                    });
                  }

                  // Hide caption line too (it's rendered in the widget)
                  if (captionLine) {
                    const capLine = view.state.doc.line(captionLine);
                    items.push({
                      from: capLine.from,
                      type: 'line',
                      class: 'cm-md-table-line-hidden',
                    });
                  }

                  // Add rendered table widget after first line
                  // Widget is positioned absolutely to overlay hidden lines
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new TableWidget(parsed, tableId, {
                      autoAlignNumbers: true,
                      decimalAlignment: true, // Tufte's requirement: align on decimal point
                      renderInlineMarkdown: true,
                      caption,
                      captionPosition,
                    }),
                  });
                } else {
                  // Parsing failed - show raw markdown with basic styling
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-table-line-visible',
                    });
                  }
                }
              }

              return false; // Don't recurse into table children
            }

            // Quote marker
            if (node.name === 'QuoteMark') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: hiddenClass });
            }

            // List markers
            if (node.name === 'ListMark') {
              items.push({
                from: node.from,
                to: node.to,
                type: 'mark',
                class: 'cm-md-list-marker',
              });
            }

            // Task list checkboxes: - [ ] or - [x]
            if (node.name === 'ListItem') {
              const itemText = view.state.doc.sliceString(node.from, Math.min(node.from + 10, node.to));
              // Match: marker + space + [ ] or [x] or [X]
              const taskMatch = itemText.match(/^[-*+]\s+\[([ xX])\]/);
              if (taskMatch) {
                const isChecked = taskMatch[1].toLowerCase() === 'x';
                // Find the position of '[' in the document
                const bracketOffset = itemText.indexOf('[');
                const bracketPos = node.from + bracketOffset;

                // Don't render widget if cursor is on this line
                const itemLine = view.state.doc.lineAt(node.from);
                if (itemLine.number !== cursorLine) {
                  // Hide the [ ], [x], or [X] text
                  items.push({
                    from: bracketPos,
                    to: bracketPos + 3,
                    type: 'replace',
                    widget: new TaskCheckboxWidget(isChecked, bracketPos),
                  });
                }
              }
            }

            // Horizontal rule
            if (node.name === 'HorizontalRule') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: 'cm-md-hr' });
              const line = view.state.doc.lineAt(node.from);
              items.push({ from: line.from, type: 'line', class: 'cm-md-hr-line' });
            }

            // Images
            if (node.name === 'Image') {
              let imageUrl = '';
              let imageAlt = '';

              const cursor = node.node.cursor();
              if (cursor.firstChild()) {
                do {
                  if (cursor.name === 'URL') {
                    imageUrl = view.state.doc.sliceString(cursor.from, cursor.to);
                  }
                  if (cursor.name === 'LinkLabel') {
                    imageAlt = view.state.doc.sliceString(cursor.from, cursor.to);
                  }
                } while (cursor.nextSibling());
              }

              // Check if this image is inside a link (linked image: [![alt](img)](url))
              const parent = node.node.parent;
              const isLinkedImage = parent?.name === 'Link';
              const syntaxEnd = isLinkedImage ? parent.to : node.to;
              const syntaxStart = isLinkedImage ? parent.from : node.from;

              if (isActiveLine) {
                // Show full syntax when editing
                items.push({
                  from: syntaxStart,
                  to: syntaxEnd,
                  type: 'mark',
                  class: 'cm-md-widget-syntax',
                });
              } else {
                // Replace with compact placeholder when not editing
                items.push({
                  from: syntaxStart,
                  to: syntaxEnd,
                  type: 'replace',
                  widget: new ImageSyntaxPlaceholder(imageAlt, imageUrl, isLinkedImage),
                });
              }

              // Always show rendered image below (after full syntax including link wrapper)
              if (imageUrl) {
                const resolvedImageUrl = resolveImageUrl
                  ? resolveImageUrl(imageUrl)
                  : imageUrl;
                items.push({
                  from: syntaxEnd,
                  type: 'widget',
                  widget: new ImageWidget(resolvedImageUrl, imageAlt, isLinkedImage),
                });
              }
            }

            // Strikethrough
            if (node.name === 'Strikethrough') {
              items.push({
                from: node.from,
                to: node.to,
                type: 'mark',
                class: 'cm-md-strikethrough',
              });
            }
            if (node.name === 'StrikethroughMark') {
              items.push({ from: node.from, to: node.to, type: 'mark', class: hiddenClass });
            }
          },
        });

        // =====================================================================
        // Manual Table Detection (Tufte Markdown Fallback)
        // =====================================================================
        // The GFM parser only recognizes standard delimiter rows (:?-+:?)
        // Our Tufte Markdown extensions (|:--{30%}|, |---.|) break recognition.
        // This fallback scans for tables the syntax tree missed.

        // Track positions already processed as tables
        const processedTableRanges: Array<{ from: number; to: number }> = [];
        for (const item of items) {
          if (item.class === 'cm-md-table-line-hidden' || item.class === 'cm-md-table-line-visible') {
            // Extract line range - item.from is line start
            const line = view.state.doc.lineAt(item.from);
            const existing = processedTableRanges.find(r => r.from <= line.from && r.to >= line.to);
            if (!existing) {
              processedTableRanges.push({ from: line.from, to: line.to });
            }
          }
        }

        // Helper to check if a position is already processed
        const isProcessedAsTable = (from: number, to: number): boolean => {
          return processedTableRanges.some(r => from >= r.from && to <= r.to);
        };

        // Scan for potential tables line by line
        let lineNum = 1;
        while (lineNum <= view.state.doc.lines) {
          const line = view.state.doc.line(lineNum);

          // Skip if outside viewport
          if (line.to < view.viewport.from || line.from > view.viewport.to) {
            lineNum++;
            continue;
          }

          // Check if this looks like a table header row
          if (isTableLine(line.text)) {
            // Look for delimiter on next line
            if (lineNum < view.state.doc.lines) {
              const nextLine = view.state.doc.line(lineNum + 1);

              if (isTableDelimiter(nextLine.text)) {
                // Found a potential table! Collect all table lines
                const tableStartLine = lineNum;
                let tableEndLine = lineNum + 1; // At least header + delimiter

                // Continue collecting data rows
                while (tableEndLine < view.state.doc.lines) {
                  const checkLine = view.state.doc.line(tableEndLine + 1);
                  if (isTableLine(checkLine.text)) {
                    tableEndLine++;
                  } else {
                    break;
                  }
                }

                const tableStart = view.state.doc.line(tableStartLine).from;
                const tableEnd = view.state.doc.line(tableEndLine).to;

                // Skip if already processed by syntax tree
                if (!isProcessedAsTable(tableStart, tableEnd)) {
                  const startLine = view.state.doc.line(tableStartLine);
                  const endLine = view.state.doc.line(tableEndLine);

                  // Check if cursor is inside the table
                  const cursorInTable = cursorLine >= tableStartLine && cursorLine <= tableEndLine;

                  // Generate stable table ID from position
                  const tableId = generateTableId(tableStart);

                  // Detect captions (before and after)
                  let captionAbove: string | undefined;
                  let captionBelow: string | undefined;
                  let captionAboveLineNum: number | undefined;
                  let captionBelowLineNum: number | undefined;

                  if (tableStartLine > 1) {
                    const prevLine = view.state.doc.line(tableStartLine - 1);
                    const prevText = prevLine.text.trim();
                    const italicMatch = prevText.match(/^[*_](.+)[*_]$/);
                    if (italicMatch && !prevText.includes('|')) {
                      captionAbove = italicMatch[1];
                      captionAboveLineNum = tableStartLine - 1;
                    }
                  }

                  if (tableEndLine < view.state.doc.lines) {
                    const nextLine = view.state.doc.line(tableEndLine + 1);
                    const nextText = nextLine.text.trim();
                    const italicMatch = nextText.match(/^[*_](.+)[*_]$/);
                    if (italicMatch && !nextText.includes('|')) {
                      captionBelow = italicMatch[1];
                      captionBelowLineNum = tableEndLine + 1;
                    }
                  }

                  const caption = captionAbove || captionBelow;
                  const captionLineNum = captionAbove ? captionAboveLineNum : captionBelowLineNum;
                  const captionPosition: 'above' | 'below' | undefined = captionAbove ? 'above' : (captionBelow ? 'below' : undefined);

                  // Extract table lines for parsing
                  const lines: string[] = [];
                  for (let i = tableStartLine; i <= tableEndLine; i++) {
                    lines.push(view.state.doc.line(i).text);
                  }

                  // Parse the table
                  const parsed = parseTable(lines, tableStart, tableEnd);

                  if (cursorInTable) {
                    // Cursor in table: show raw markdown with subtle styling
                    for (let i = tableStartLine; i <= tableEndLine; i++) {
                      const tableLine = view.state.doc.line(i);
                      items.push({
                        from: tableLine.from,
                        type: 'line',
                        class: 'cm-md-table-line-visible',
                      });
                    }
                  } else if (parsed && parsed.rows.length > 0) {
                    // Hide all table lines
                    for (let i = tableStartLine; i <= tableEndLine; i++) {
                      const tableLine = view.state.doc.line(i);
                      items.push({
                        from: tableLine.from,
                        type: 'line',
                        class: 'cm-md-table-line-hidden',
                      });
                    }

                    // Hide caption line too
                    if (captionLineNum) {
                      const capLine = view.state.doc.line(captionLineNum);
                      items.push({
                        from: capLine.from,
                        type: 'line',
                        class: 'cm-md-table-line-hidden',
                      });
                    }

                    // Add rendered table widget
                    items.push({
                      from: startLine.to,
                      type: 'widget',
                      widget: new TableWidget(parsed, tableId, {
                        autoAlignNumbers: true,
                        decimalAlignment: true,
                        renderInlineMarkdown: true,
                        caption,
                        captionPosition,
                      }),
                    });
                  }

                  // Track this range as processed
                  processedTableRanges.push({ from: tableStart, to: tableEnd });
                }

                // Skip to end of table
                lineNum = tableEndLine + 1;
                continue;
              }
            }
          }

          lineNum++;
        }

        // Find math blocks ($$...$$)
        const text = view.state.doc.toString();
        const mathRegex = /\$\$([^$]+)\$\$/g;
        let match;
        while ((match = mathRegex.exec(text)) !== null) {
          const from = match.index;
          const to = from + match[0].length;
          const latex = match[1].trim();

          if (to >= view.viewport.from && from <= view.viewport.to) {
            items.push({ from, to, type: 'mark', class: 'cm-md-widget-syntax' });
            items.push({ from: to, type: 'widget', widget: new MathWidget(latex) });
          }
        }

        // Find highlight syntax (==text==)
        const highlightRegex = /==([^=]+)==/g;
        while ((match = highlightRegex.exec(text)) !== null) {
          const from = match.index;
          const to = from + match[0].length;

          if (to >= view.viewport.from && from <= view.viewport.to) {
            // Check if on current line - show syntax if so
            const matchLine = view.state.doc.lineAt(from);
            if (matchLine.number === cursorLine) {
              items.push({ from, to, type: 'mark', class: 'cm-md-highlight-syntax' });
            } else {
              // Hide the == markers and highlight the content
              items.push({ from, to: from + 2, type: 'mark', class: 'cm-md-hidden' });
              items.push({ from: from + 2, to: to - 2, type: 'mark', class: 'cm-md-highlight' });
              items.push({ from: to - 2, to, type: 'mark', class: 'cm-md-hidden' });
            }
          }
        }

        // Find footnote references [^1], [^note], etc.
        const footnoteRefRegex = /\[\^([^\]]+)\]/g;
        while ((match = footnoteRefRegex.exec(text)) !== null) {
          const from = match.index;
          const to = from + match[0].length;
          const footnoteId = match[1];

          // Skip footnote definitions (lines starting with [^id]:)
          const lineStart = view.state.doc.lineAt(from).from;
          const linePrefix = view.state.sliceDoc(lineStart, from);
          if (linePrefix.trim() === '') {
            // This is a definition, not a reference
            continue;
          }

          if (to >= view.viewport.from && from <= view.viewport.to) {
            const matchLine = view.state.doc.lineAt(from);
            if (matchLine.number !== cursorLine) {
              // Render as superscript
              items.push({
                from,
                to,
                type: 'replace',
                widget: new FootnoteRefWidget(footnoteId),
              });
            }
          }
        }

        // Find bare URLs (not already in markdown links)
        // Pattern: https://... or http://... not preceded by ]( or ](
        const urlRegex = /(?<![(\[])https?:\/\/[^\s<>)\]]+/g;
        while ((match = urlRegex.exec(text)) !== null) {
          const from = match.index;
          const to = from + match[0].length;
          const url = match[0];

          if (to >= view.viewport.from && from <= view.viewport.to) {
            const matchLine = view.state.doc.lineAt(from);
            if (matchLine.number !== cursorLine) {
              // Make it a clickable link
              items.push({
                from,
                to,
                type: 'mark',
                class: 'cm-md-autolink',
              });
            }
          }
        }

        // Find inline HTML (kbd, mark, sup, sub, etc.)
        // First, collect all code block ranges to skip
        const codeBlockRanges: Array<{ from: number; to: number }> = [];
        syntaxTree(view.state).iterate({
          from: view.viewport.from,
          to: view.viewport.to,
          enter: (node) => {
            if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
              codeBlockRanges.push({ from: node.from, to: node.to });
            }
          },
        });

        // Check if a position is inside a code block
        const isInCodeBlock = (pos: number): boolean => {
          return codeBlockRanges.some((r) => pos >= r.from && pos <= r.to);
        };

        // Process line by line to check if cursor is on the line
        for (let i = 1; i <= view.state.doc.lines; i++) {
          const line = view.state.doc.line(i);

          // Skip lines outside viewport
          if (line.to < view.viewport.from || line.from > view.viewport.to) {
            continue;
          }

          // Skip if cursor is on this line (show raw HTML for editing)
          if (i === cursorLine) {
            continue;
          }

          // Skip lines inside code blocks
          if (isInCodeBlock(line.from)) {
            continue;
          }

          const inlineMatches = findInlineHTML(line.text, line.from);

          for (const m of inlineMatches) {
            // Double-check not in code block (for edge cases)
            if (isInCodeBlock(m.from)) {
              continue;
            }

            // Replace with rendered widget
            items.push({
              from: m.from,
              to: m.to,
              type: 'replace',
              widget: new InlineHTMLWidget(m.html, m.tagName),
            });
          }
        }

        // Filter out overlapping replace decorations (keep first one by position)
        items.sort((a, b) => a.from - b.from);
        const usedRanges: Array<{ from: number; to: number }> = [];
        const filteredItems = items.filter((item) => {
          if (item.type === 'replace' && item.to !== undefined) {
            const overlaps = usedRanges.some(
              (r) => item.from < r.to && item.to! > r.from
            );
            if (overlaps) {
              return false;
            }
            usedRanges.push({ from: item.from, to: item.to });
          }
          return true;
        });

        // Convert items to Range<Decoration> array
        const decorations: Array<import('@codemirror/state').Range<Decoration>> = [];

        for (const item of filteredItems) {
          if (item.type === 'mark' && item.to !== undefined) {
            decorations.push(
              Decoration.mark({ class: item.class }).range(item.from, item.to)
            );
          } else if (item.type === 'line') {
            decorations.push(
              Decoration.line({ class: item.class }).range(item.from)
            );
          } else if (item.type === 'widget' && item.widget) {
            decorations.push(
              Decoration.widget({ widget: item.widget, side: 1 }).range(item.from)
            );
          } else if (item.type === 'replace' && item.to !== undefined && item.widget) {
            decorations.push(
              Decoration.replace({ widget: item.widget }).range(item.from, item.to)
            );
          }
        }

        // Use Decoration.set with sort: true to handle startSide ordering
        return Decoration.set(decorations, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

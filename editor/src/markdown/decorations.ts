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
} from '../widgets';
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

              // Handle output blocks with ANSI rendering
              if (isOutput) {
                // Extract exec ID from fence (e.g., "output:exec-123" -> "exec-123")
                const execIdMatch = firstLineText.match(/output:([^\s{]+)/);
                const execId = execIdMatch ? execIdMatch[1] : `output-${node.from}`;

                // Check if cursor is inside the output block (allows editing when focused)
                const cursorInBlock = cursorLine >= startLine.number && cursorLine <= endLine.number;

                // Check if there's content (more than just the fences)
                const hasContentLines = endLine.number > startLine.number + 1;

                if (hasContentLines && !cursorInBlock) {
                  // Cursor NOT in block: hide content lines and show rendered widget
                  // Add line decoration for opening fence
                  items.push({
                    from: startLine.from,
                    type: 'line',
                    class: 'cm-md-output-block-line',
                  });

                  // Hide content lines (between fences) with CSS
                  for (let i = startLine.number + 1; i < endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-output-content-hidden',
                    });
                  }

                  // Add line decoration for closing fence
                  items.push({
                    from: endLine.from,
                    type: 'line',
                    class: 'cm-md-output-block-line',
                  });

                  // Extract content for the widget (lines between fences)
                  const contentStart = startLine.to + 1;
                  const contentEnd = endLine.from;
                  const content = view.state.sliceDoc(contentStart, contentEnd);

                  // Add OutputWidget after opening fence line
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new OutputWidget(content, execId),
                  });
                } else if (!hasContentLines && !cursorInBlock) {
                  // Empty block, cursor NOT in block: show "no output" widget
                  // Keep BOTH fence lines (invisible text) so vertical space matches markdown
                  items.push({
                    from: startLine.from,
                    type: 'line',
                    class: 'cm-md-output-block-line cm-md-output-empty-line',
                  });
                  items.push({
                    from: endLine.from,
                    type: 'line',
                    class: 'cm-md-output-block-line cm-md-output-empty-line',
                  });

                  // Add EmptyOutputWidget after opening fence (positioned to not add space)
                  items.push({
                    from: startLine.to,
                    type: 'widget',
                    widget: new EmptyOutputWidget(execId),
                  });
                } else {
                  // Cursor IN block: show raw text for editing
                  for (let i = startLine.number; i <= endLine.number; i++) {
                    const line = view.state.doc.line(i);
                    items.push({
                      from: line.from,
                      type: 'line',
                      class: 'cm-md-output-block-line',
                    });
                  }
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

            // Blockquotes
            if (node.name === 'Blockquote') {
              const startLine = view.state.doc.lineAt(node.from);
              const endLine = view.state.doc.lineAt(node.to);
              for (let i = startLine.number; i <= endLine.number; i++) {
                const line = view.state.doc.line(i);
                items.push({ from: line.from, type: 'line', class: 'cm-md-blockquote-line' });
              }
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

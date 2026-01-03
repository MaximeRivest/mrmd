/**
 * Comprehensive Whitespace Visualization Extension
 *
 * Shows ALL whitespace characters:
 * - Spaces as middle dots (·)
 * - Tabs as arrows (→) preserving tab width
 * - Newlines as pilcrows (¶) at end of each line
 *
 * Design: Single ViewPlugin that creates decorations for visible range.
 * Simple, maintainable, and complete.
 */

import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
} from '@codemirror/view';

/**
 * Widget for newline marker (¶) at end of lines
 */
class NewlineWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-whitespace-newline';
    span.textContent = '¶';
    return span;
  }

  eq(): boolean {
    return true;
  }
}

const newlineWidget = new NewlineWidget();

// Decoration for spaces
const spaceDeco = Decoration.mark({ class: 'cm-whitespace-space' });

// Decoration for tabs
const tabDeco = Decoration.mark({ class: 'cm-whitespace-tab' });

// Widget decoration for newlines (placed at end of line)
const newlineDeco = Decoration.widget({
  widget: newlineWidget,
  side: 1, // After the position
});

/**
 * Build decorations for all whitespace in the visible range
 */
function buildDecorations(view: EditorView): DecorationSet {
  const decorations: { from: number; to: number; deco: Decoration }[] = [];

  // Get visible range (with some buffer for smooth scrolling)
  const { from, to } = view.viewport;

  // Scan the visible document
  const doc = view.state.doc;
  const text = doc.sliceString(from, to);

  let pos = from;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === ' ') {
      decorations.push({ from: pos, to: pos + 1, deco: spaceDeco });
    } else if (char === '\t') {
      decorations.push({ from: pos, to: pos + 1, deco: tabDeco });
    }
    // Newlines are handled separately below

    pos++;
  }

  // Add newline markers at end of each visible line
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(Math.min(to, doc.length)).number;

  for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
    const line = doc.line(lineNum);
    // Don't add newline marker to the last line if it doesn't end with newline
    if (lineNum < doc.lines || line.to < doc.length) {
      decorations.push({ from: line.to, to: line.to, deco: newlineDeco });
    }
  }

  // Sort by position and convert to DecorationSet
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);

  return Decoration.set(
    decorations.map((d) =>
      d.from === d.to
        ? d.deco.range(d.from) // Widget
        : d.deco.range(d.from, d.to) // Mark
    )
  );
}

/**
 * ViewPlugin that manages whitespace decorations
 */
const whitespacePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild if document changed or viewport scrolled significantly
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * CSS styles for whitespace markers
 */
const whitespaceStyles = EditorView.baseTheme({
  // Space marker - subtle dot
  '.cm-whitespace-space': {
    position: 'relative',
  },
  '.cm-whitespace-space::before': {
    content: '"·"',
    position: 'absolute',
    color: 'var(--text-light, #bbb)',
    pointerEvents: 'none',
  },

  // Tab marker - arrow, preserves tab width
  '.cm-whitespace-tab': {
    position: 'relative',
  },
  '.cm-whitespace-tab::before': {
    content: '"→"',
    position: 'absolute',
    left: '0',
    color: 'var(--text-light, #bbb)',
    pointerEvents: 'none',
  },

  // Newline marker - pilcrow at end of line
  '.cm-whitespace-newline': {
    color: 'var(--text-light, #bbb)',
    pointerEvents: 'none',
    userSelect: 'none',
    marginLeft: '2px',
  },
});

/**
 * Complete whitespace visualization extension.
 * Shows spaces (·), tabs (→), and newlines (¶).
 */
export function showWhitespace() {
  return [whitespacePlugin, whitespaceStyles];
}

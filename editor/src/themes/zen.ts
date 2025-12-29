import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * Zen theme CSS variables
 *
 * These are automatically injected into the document when zenTheme() is used.
 * The .cm-zen-theme class is added to the editor, making it fully self-contained.
 */
export const zenThemeStyles = `
  .cm-zen-theme, .cm-zen-theme .cm-editor {
    /* Light mode - warm, paper-like */
    --bg: #faf9f7;
    --bg-gradient: linear-gradient(180deg, #faf9f7 0%, #f5f3f0 100%);
    --text: #37352f;
    --text-muted: #9b9a97;
    --text-light: #b4b4b0;
    --accent: #6b7280;
    --accent-soft: rgba(107, 114, 128, 0.12);
    --surface: rgba(0, 0, 0, 0.03);
    --surface-hover: rgba(0, 0, 0, 0.06);
    --border: rgba(0, 0, 0, 0.08);
    --marker: #bbb;
    --selection: rgba(45, 170, 219, 0.2);
    --code-bg: rgba(0, 0, 0, 0.04);
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.04);

    /* Light mode ANSI colors */
    --ansi-black: #000;
    --ansi-red: #c91b00;
    --ansi-green: #00a600;
    --ansi-yellow: #a68a00;
    --ansi-blue: #0451a5;
    --ansi-magenta: #bc05bc;
    --ansi-cyan: #0598bc;
    --ansi-white: #555;
    --ansi-bright-black: #666;
    --ansi-bright-red: #e74c3c;
    --ansi-bright-green: #27ae60;
    --ansi-bright-yellow: #f39c12;
    --ansi-bright-blue: #3498db;
    --ansi-bright-magenta: #9b59b6;
    --ansi-bright-cyan: #1abc9c;
    --ansi-bright-white: #333;
  }

  @media (prefers-color-scheme: dark) {
    .cm-zen-theme, .cm-zen-theme .cm-editor {
      --bg: #191919;
      --bg-gradient: linear-gradient(180deg, #191919 0%, #1a1a1a 100%);
      --text: #e0e0e0;
      --text-muted: #6b6b6b;
      --text-light: #4a4a4a;
      --accent: #8b9298;
      --accent-soft: rgba(139, 146, 152, 0.1);
      --surface: rgba(255, 255, 255, 0.03);
      --surface-hover: rgba(255, 255, 255, 0.06);
      --border: rgba(255, 255, 255, 0.06);
      --marker: #555;
      --selection: rgba(45, 170, 219, 0.25);
      --code-bg: rgba(255, 255, 255, 0.04);
      --shadow: 0 1px 3px rgba(0, 0, 0, 0.2);

      /* Dark mode ANSI colors */
      --ansi-black: #1d1f21;
      --ansi-red: #cc6666;
      --ansi-green: #b5bd68;
      --ansi-yellow: #f0c674;
      --ansi-blue: #81a2be;
      --ansi-magenta: #b294bb;
      --ansi-cyan: #8abeb7;
      --ansi-white: #c5c8c6;
      --ansi-bright-black: #969896;
      --ansi-bright-red: #de935f;
      --ansi-bright-green: #a3be8c;
      --ansi-bright-yellow: #ebcb8b;
      --ansi-bright-blue: #88c0d0;
      --ansi-bright-magenta: #b48ead;
      --ansi-bright-cyan: #96b5b4;
      --ansi-bright-white: #eceff4;
    }
  }

  /* Keyframe animations */
  @keyframes cm-cell-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes cm-output-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  @keyframes cm-output-fadeout {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; }
  }

  .cm-output-status-running {
    animation: cm-output-pulse 1.5s ease-in-out infinite;
  }

  .cm-output-copy-feedback {
    animation: cm-output-fadeout 1.5s ease-out forwards;
  }
`;

/**
 * Zen theme editor view theme
 */
export const zenEditorTheme = EditorView.theme({
  '&': {
    fontFamily: "'Charter', 'Bitstream Charter', 'Sitka Text', Cambria, Georgia, serif",
    fontSize: '17px',
    lineHeight: '1.8',
    background: 'transparent',
    letterSpacing: '-0.003em',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    padding: '0',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '2px 0',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '1.5px',
  },
  '.cm-activeLine': {
    background: 'transparent !important',
  },
  '.cm-selectionBackground': {
    background: 'var(--selection) !important',
    borderRadius: '2px',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'var(--selection) !important',
  },
  '.cm-gutters': {
    background: 'transparent !important',
    border: 'none !important',
    minWidth: '0 !important',
  },
  '.cm-gutter': {
    background: 'transparent !important',
  },
  '.cm-lineNumbers': {
    display: 'none',
  },
  '.cm-foldGutter': {
    width: '16px',
    minWidth: '16px',
    background: 'transparent !important',
  },
  '.cm-foldGutter .cm-gutterElement': {
    color: 'var(--text-light)',
    opacity: '0',
    transition: 'opacity 0.2s ease, color 0.2s ease',
    cursor: 'pointer',
    fontSize: '9px',
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent !important',
  },
  '&:hover .cm-foldGutter .cm-gutterElement': {
    opacity: '0.5',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    opacity: '1 !important',
    color: 'var(--text-muted)',
  },
  '.cm-foldPlaceholder': {
    background: 'transparent !important',
    border: 'none !important',
    padding: '0 4px',
    margin: '0 2px',
    color: 'var(--text-light)',
    fontSize: '0.8em',
    cursor: 'pointer',
  },
  '.cm-foldPlaceholder:hover': {
    color: 'var(--text-muted)',
  },

  // Markdown styling
  '.cm-md-hidden': {
    fontSize: '0 !important',
    width: '0 !important',
    display: 'inline-block',
    overflow: 'hidden',
  },
  '.cm-md-marker': {
    color: 'var(--marker)',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.85em',
  },
  // Heading styles - no underlines
  '.cm-md-h1, .cm-md-h2, .cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6': {
    textDecoration: 'none !important',
  },
  '.cm-md-h1': {
    fontSize: '1.875em',
    fontWeight: '600',
    lineHeight: '1.3',
    letterSpacing: '-0.02em',
  },
  '.cm-md-h2': {
    fontSize: '1.5em',
    fontWeight: '600',
    lineHeight: '1.35',
    letterSpacing: '-0.015em',
  },
  '.cm-md-h3': {
    fontSize: '1.25em',
    fontWeight: '600',
    lineHeight: '1.4',
  },
  '.cm-md-h4, .cm-md-h5, .cm-md-h6': {
    fontSize: '1.1em',
    fontWeight: '600',
  },
  '.cm-md-bold': {
    fontWeight: '600',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
  },
  '.cm-md-inline-code': {
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.875em',
    background: 'var(--code-bg)',
    padding: '0.2em 0.45em',
    borderRadius: '4px',
  },
  '.cm-md-code-block-line': {
    position: 'relative',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace !important",
    fontSize: '0.875em',
    lineHeight: '1.6',
  },
  '.cm-md-code-block-line::before': {
    content: '""',
    position: 'absolute',
    left: '-32px',
    right: '-32px',
    top: '0',
    bottom: '0',
    background: 'var(--code-bg)',
    zIndex: '-1',
    pointerEvents: 'none',
  },
  '.cm-md-code-fence': {
    color: 'var(--marker)',
    fontSize: '0.85em',
  },
  '.cm-md-code-lang': {
    color: 'var(--text-muted)',
  },
  '.cm-md-output-block-line': {
    position: 'relative',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace !important",
    fontSize: '0.85em',
    lineHeight: '1.5',
    color: 'var(--text-muted)',
  },
  '.cm-md-output-block-line::before': {
    content: '""',
    position: 'absolute',
    left: '-32px',
    right: '-32px',
    top: '0',
    bottom: '0',
    background: 'var(--surface)',
    borderLeft: '2px solid var(--accent)',
    zIndex: '-1',
    pointerEvents: 'none',
  },
  '.cm-md-output-fence': {
    color: 'var(--marker)',
    fontSize: '0.85em',
  },
  '.cm-md-link-text': {
    color: 'var(--text)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--border)',
    textUnderlineOffset: '2px',
  },
  '.cm-md-link-url': {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
  },
  '.cm-md-blockquote-line': {
    borderLeft: '2px solid var(--border)',
    paddingLeft: '1.25em',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  '.cm-md-list-marker': {
    color: 'var(--text-light)',
  },
  '.cm-md-hr': {
    color: 'var(--border)',
  },
  '.cm-md-hr-line::after': {
    content: '""',
    display: 'block',
    position: 'absolute',
    left: '0',
    right: '0',
    top: '50%',
    borderTop: '1px solid var(--border)',
  },
  '.cm-md-widget-syntax': {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  },
  // Image syntax placeholder (collapsed state)
  '.cm-image-syntax-placeholder': {
    display: 'inline-block',
    padding: '2px 8px',
    background: 'var(--surface)',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
    verticalAlign: 'baseline',
  },
  '.cm-image-syntax-placeholder:hover': {
    background: 'var(--surface-hover)',
    color: 'var(--text)',
  },
  '.cm-md-strikethrough': {
    textDecoration: 'line-through',
    opacity: '0.6',
  },

  // Widgets
  '.cm-image-widget': {
    display: 'block',
    margin: '1.5em 0',
    maxWidth: '100%',
  },
  '.cm-image-widget img': {
    maxWidth: '100%',
    borderRadius: '6px',
    display: 'block',
    boxShadow: 'var(--shadow)',
  },
  '.cm-image-loading': {
    background: 'var(--surface)',
    borderRadius: '6px',
    padding: '3em',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '0.875em',
  },
  '.cm-image-error': {
    background: 'var(--surface)',
    borderRadius: '6px',
    padding: '1.5em',
    color: 'var(--text-muted)',
    fontSize: '0.85em',
    textAlign: 'center',
  },
  '.cm-math-widget': {
    display: 'block',
    margin: '1.5em 0',
    textAlign: 'center',
    padding: '1em',
  },
  '.cm-math-widget .katex': {
    fontSize: '1.2em',
  },
  '.cm-math-error': {
    color: 'var(--text-muted)',
    fontSize: '0.85em',
  },

  // Run button
  '.cm-run-button': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    marginLeft: '8px',
    verticalAlign: 'middle',
    border: 'none',
    background: 'var(--surface-hover)',
    borderRadius: '4px',
    cursor: 'pointer',
    opacity: '0.4',
    transition: 'opacity 0.15s, background 0.15s, transform 0.1s',
    color: 'var(--text-muted)',
    fontSize: '9px',
  },
  '.cm-run-button:hover': {
    background: 'var(--accent-soft)',
    color: 'var(--accent)',
    opacity: '1',
    transform: 'scale(1.1)',
  },
  '.cm-line:hover .cm-run-button': {
    opacity: '0.7',
  },

  // Rendered HTML widget wrapper
  '.cm-html-rendered-wrapper': {
    display: 'block',
    margin: '1em 0',
    position: 'relative',
  },
  '.cm-html-rendered-toolbar': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: '10',
    opacity: '0',
    transition: 'opacity 0.15s ease',
  },
  '.cm-html-rendered-wrapper:hover .cm-html-rendered-toolbar': {
    opacity: '1',
  },
  '.cm-html-edit-btn': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    padding: '0',
    fontSize: '12px',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
    transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
  },
  '.cm-html-edit-btn:hover': {
    background: 'var(--surface-hover)',
    color: 'var(--text)',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  // Rendered HTML content container
  '.cm-html-rendered': {
    display: 'block',
    padding: '1em',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg)',
    boxShadow: 'var(--shadow)',
    overflow: 'hidden',
  },
  // Editing state - show source with highlight
  '.cm-html-rendered-editing': {
    background: 'var(--selection) !important',
  },

  // Hidden text for html-rendered blocks (source is hidden, widget shown)
  '.cm-html-rendered-hidden': {
    display: 'none',
  },

  // Hidden lines for collapsed HTML source (echo=false)
  '.cm-html-source-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
  },

  // Hidden lines for output blocks (when showing rendered widget)
  '.cm-md-output-content-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
  },

  // HTML cell placeholder (collapsed source)
  '.cm-html-cell-placeholder': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5em',
    padding: '6px 12px',
    background: 'var(--surface)',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    fontSize: '0.875em',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  },
  '.cm-html-cell-placeholder:hover': {
    background: 'var(--surface-hover)',
    color: 'var(--text)',
  },
  '.cm-html-cell-placeholder .cm-cell-icon': {
    fontSize: '1em',
  },
  '.cm-html-cell-placeholder .cm-cell-label': {
    fontWeight: '500',
  },
  '.cm-html-cell-placeholder .cm-cell-meta': {
    color: 'var(--text-light)',
    fontSize: '0.9em',
  },
  '.cm-html-cell-placeholder .cm-cell-preview': {
    color: 'var(--text-light)',
    fontSize: '0.85em',
    maxWidth: '200px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  // Inline HTML widgets
  '.cm-inline-html': {
    display: 'inline',
  },
  '.cm-inline-html-kbd kbd, .cm-inline-html kbd': {
    display: 'inline-block',
    padding: '0.15em 0.4em',
    fontSize: '0.85em',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    lineHeight: '1',
    color: 'var(--text)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 2px 0 0 var(--bg) inset',
  },
  '.cm-inline-html-mark mark, .cm-inline-html mark': {
    background: 'rgba(250, 204, 21, 0.4)',
    padding: '0.1em 0.2em',
    borderRadius: '2px',
  },
  '.cm-inline-html-sup sup': {
    fontSize: '0.75em',
    verticalAlign: 'super',
  },
  '.cm-inline-html-sub sub': {
    fontSize: '0.75em',
    verticalAlign: 'sub',
  },
  '.cm-inline-html-del del, .cm-inline-html-s s': {
    textDecoration: 'line-through',
    opacity: '0.7',
  },
  '.cm-inline-html-ins ins': {
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
  },
  '.cm-inline-html-abbr abbr': {
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    cursor: 'help',
  },
  '.cm-inline-html-small small': {
    fontSize: '0.85em',
  },
  '.cm-inline-html-cite cite, .cm-inline-html-q q': {
    fontStyle: 'italic',
  },
  '.cm-inline-html-code code': {
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.875em',
    background: 'var(--code-bg)',
    padding: '0.2em 0.4em',
    borderRadius: '3px',
  },
  '.cm-inline-html-error': {
    color: 'var(--text-muted)',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.85em',
  },
  '.cm-inline-html-placeholder': {
    color: 'var(--marker)',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.85em',
  },

  // ============================================================================
  // Cell Status Widget (queued/running indicators)
  // ============================================================================
  '.cm-cell-status': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    marginLeft: '8px',
    verticalAlign: 'middle',
  },
  '.cm-cell-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: '0',
    border: 'none',
    borderRadius: '3px',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '12px',
    transition: 'all 0.15s ease',
  },
  '.cm-cell-btn:hover': {
    background: 'var(--surface-hover)',
    color: 'var(--text)',
  },
  '.cm-cell-btn-play': {
    color: '#4ade80',
  },
  '.cm-cell-btn-play:hover': {
    color: '#22c55e',
    background: 'rgba(74, 222, 128, 0.1)',
  },
  '.cm-cell-btn-cancel': {
    color: 'var(--text-muted)',
    fontSize: '10px',
  },
  '.cm-cell-btn-cancel:hover': {
    color: '#f87171',
    background: 'rgba(248, 113, 113, 0.1)',
  },
  '.cm-cell-status-queued': {
    color: '#fbbf24',
  },
  '.cm-cell-status-running': {
    color: '#60a5fa',
  },
  '.cm-cell-queue-status': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    fontSize: '12px',
  },
  '.cm-cell-queue-icon': {
    fontSize: '14px',
  },
  '.cm-cell-queue-pos': {
    fontSize: '10px',
    fontWeight: '600',
    minWidth: '14px',
    textAlign: 'center',
  },
  '.cm-cell-spinner': {
    fontSize: '14px',
    animation: 'cm-cell-spin 1s linear infinite',
  },

  // ============================================================================
  // ANSI Color Support for Output Blocks
  // ============================================================================
  '.ansi-bold': { fontWeight: 'bold' },
  '.ansi-dim': { opacity: '0.7' },
  '.ansi-italic': { fontStyle: 'italic' },
  '.ansi-underline': { textDecoration: 'underline' },
  '.ansi-strikethrough': { textDecoration: 'line-through' },
  '.ansi-inverse': { filter: 'invert(1)' },

  // ANSI foreground colors
  '.ansi-fg-black': { color: 'var(--ansi-black, #000)' },
  '.ansi-fg-red': { color: 'var(--ansi-red, #c91b00)' },
  '.ansi-fg-green': { color: 'var(--ansi-green, #00c200)' },
  '.ansi-fg-yellow': { color: 'var(--ansi-yellow, #c7c400)' },
  '.ansi-fg-blue': { color: 'var(--ansi-blue, #0225c7)' },
  '.ansi-fg-magenta': { color: 'var(--ansi-magenta, #c930c7)' },
  '.ansi-fg-cyan': { color: 'var(--ansi-cyan, #00c5c7)' },
  '.ansi-fg-white': { color: 'var(--ansi-white, #c7c7c7)' },
  // Bright foreground colors
  '.ansi-fg-bright-black': { color: 'var(--ansi-bright-black, #676767)' },
  '.ansi-fg-bright-red': { color: 'var(--ansi-bright-red, #ff6d67)' },
  '.ansi-fg-bright-green': { color: 'var(--ansi-bright-green, #5ff967)' },
  '.ansi-fg-bright-yellow': { color: 'var(--ansi-bright-yellow, #fefb67)' },
  '.ansi-fg-bright-blue': { color: 'var(--ansi-bright-blue, #6871ff)' },
  '.ansi-fg-bright-magenta': { color: 'var(--ansi-bright-magenta, #ff76ff)' },
  '.ansi-fg-bright-cyan': { color: 'var(--ansi-bright-cyan, #5ffdff)' },
  '.ansi-fg-bright-white': { color: 'var(--ansi-bright-white, #fff)' },

  // ANSI background colors
  '.ansi-bg-black': { background: 'var(--ansi-black, #000)' },
  '.ansi-bg-red': { background: 'var(--ansi-red, #c91b00)' },
  '.ansi-bg-green': { background: 'var(--ansi-green, #00c200)' },
  '.ansi-bg-yellow': { background: 'var(--ansi-yellow, #c7c400)' },
  '.ansi-bg-blue': { background: 'var(--ansi-blue, #0225c7)' },
  '.ansi-bg-magenta': { background: 'var(--ansi-magenta, #c930c7)' },
  '.ansi-bg-cyan': { background: 'var(--ansi-cyan, #00c5c7)' },
  '.ansi-bg-white': { background: 'var(--ansi-white, #c7c7c7)' },

  // ============================================================================
  // Output Widget Styles
  // ============================================================================
  '.cm-output-widget': {
    display: 'block',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '0.9em',
    lineHeight: '1.4',
    padding: '8px 12px',
    background: 'var(--code-bg)',
    borderRadius: '4px',
    margin: '4px 0',
    position: 'relative',
    overflowX: 'auto',
  },
  '.cm-output-status': {
    fontSize: '0.85em',
    padding: '2px 8px',
    borderRadius: '3px',
    marginBottom: '8px',
    display: 'inline-block',
  },
  '.cm-output-status-running': {
    background: 'rgba(59, 130, 246, 0.2)',
    color: '#60a5fa',
  },
  '.cm-output-status-queued': {
    background: 'rgba(234, 179, 8, 0.2)',
    color: '#fbbf24',
  },
  '.cm-output-content': {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '.cm-output-show-more': {
    display: 'block',
    marginTop: '8px',
    padding: '4px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '0.85em',
  },
  '.cm-output-show-more:hover': {
    background: 'var(--surface-hover)',
  },
  '.cm-output-copy-feedback': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    padding: '4px 8px',
    background: 'rgba(34, 197, 94, 0.9)',
    color: 'white',
    borderRadius: '4px',
    fontSize: '0.8em',
  },

  // ============================================================================
  // Image Output Widget Styles
  // ============================================================================
  '.cm-image-output-widget': {
    display: 'block',
    margin: '8px 0',
    position: 'relative',
  },
  '.cm-image-output-wrapper': {
    display: 'block',
    background: 'var(--surface)',
    borderRadius: '6px',
    padding: '12px',
    textAlign: 'center',
    overflow: 'hidden',
  },
  '.cm-image-output-wrapper.cm-image-output-loading': {
    color: 'var(--text-muted)',
    fontSize: '0.9em',
    minHeight: '100px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-image-output-wrapper.cm-image-output-error': {
    color: 'var(--text-muted)',
    fontSize: '0.9em',
    padding: '1.5em',
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
  },
  '.cm-image-output-img': {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '4px',
    display: 'block',
    margin: '0 auto',
    boxShadow: 'var(--shadow)',
  },
  // Line decorations for image-output blocks
  '.cm-md-image-output-block-line': {
    position: 'relative',
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace !important",
    fontSize: '0.85em',
    lineHeight: '1.5',
    color: 'var(--text-muted)',
  },
  '.cm-md-image-output-block-line::before': {
    content: '""',
    position: 'absolute',
    left: '-32px',
    right: '-32px',
    top: '0',
    bottom: '0',
    background: 'var(--surface)',
    borderLeft: '2px solid var(--accent)',
    zIndex: '-1',
    pointerEvents: 'none',
  },
  '.cm-md-image-output-content-hidden': {
    display: 'none !important',
    height: '0 !important',
    overflow: 'hidden !important',
  },
});

/**
 * Zen syntax highlighting for code
 */
export const zenHighlightStyle = HighlightStyle.define([
  // Remove heading underlines
  { tag: tags.heading, textDecoration: 'none' },
  { tag: tags.heading1, textDecoration: 'none' },
  { tag: tags.heading2, textDecoration: 'none' },
  { tag: tags.heading3, textDecoration: 'none' },
  { tag: tags.heading4, textDecoration: 'none' },
  { tag: tags.heading5, textDecoration: 'none' },
  { tag: tags.heading6, textDecoration: 'none' },

  // Muted, monochromatic code syntax
  { tag: tags.keyword, color: '#8a8a8a', fontWeight: '500' },
  { tag: tags.controlKeyword, color: '#8a8a8a', fontWeight: '500' },
  { tag: tags.operatorKeyword, color: '#8a8a8a', fontWeight: '500' },
  { tag: tags.definitionKeyword, color: '#8a8a8a', fontWeight: '500' },
  { tag: tags.moduleKeyword, color: '#8a8a8a', fontWeight: '500' },

  { tag: tags.function(tags.variableName), color: '#909090' },
  { tag: tags.function(tags.propertyName), color: '#909090' },
  { tag: tags.definition(tags.variableName), color: '#909090' },
  { tag: tags.definition(tags.propertyName), color: '#909090' },

  { tag: tags.variableName, color: '#858585' },
  { tag: tags.propertyName, color: '#858585' },
  { tag: tags.attributeName, color: '#858585' },

  { tag: tags.string, color: '#7a8a70' },
  { tag: tags.special(tags.string), color: '#7a8a70' },

  { tag: tags.number, color: '#90857a' },
  { tag: tags.bool, color: '#90857a' },
  { tag: tags.null, color: '#90857a' },

  { tag: tags.comment, color: '#606060', fontStyle: 'italic' },
  { tag: tags.lineComment, color: '#606060', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#606060', fontStyle: 'italic' },

  { tag: tags.operator, color: '#707070' },
  { tag: tags.punctuation, color: '#606060' },
  { tag: tags.bracket, color: '#606060' },
  { tag: tags.paren, color: '#606060' },
  { tag: tags.brace, color: '#606060' },
  { tag: tags.squareBracket, color: '#606060' },

  { tag: tags.typeName, color: '#858585' },
  { tag: tags.className, color: '#858585' },
  { tag: tags.namespace, color: '#858585' },

  { tag: tags.meta, color: '#707070' },
  { tag: tags.invalid, color: '#888', textDecoration: 'line-through' },
]);

// ============================================================================
// Style Injection
// ============================================================================

/** Tracks whether styles have been injected into the document */
let stylesInjected = false;

/** Style element ID for deduplication */
const STYLE_ID = 'cm-zen-theme-styles';

/**
 * Injects the zen theme CSS variables into the document.
 * Safe to call multiple times - only injects once.
 */
export function injectZenStyles(): void {
  if (stylesInjected) return;

  // Check if already exists (e.g., from SSR or previous instance)
  if (typeof document !== 'undefined' && document.getElementById(STYLE_ID)) {
    stylesInjected = true;
    return;
  }

  // Inject styles
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = zenThemeStyles;
    document.head.appendChild(style);
    stylesInjected = true;
  }
}

/**
 * Extension that adds the .cm-zen-theme class to the editor wrapper.
 * This enables CSS variable scoping for the theme.
 */
const zenThemeClass = EditorView.editorAttributes.of({ class: 'cm-zen-theme' });

/**
 * Complete zen theme extension.
 *
 * This is fully self-contained:
 * - Automatically injects CSS variables into the document
 * - Adds .cm-zen-theme class to the editor for scoping
 * - Includes all editor styling and syntax highlighting
 *
 * Works anywhere without external CSS dependencies.
 */
export function zenTheme(): Extension {
  // Inject CSS variables (once per document)
  injectZenStyles();

  return [
    zenThemeClass,
    zenEditorTheme,
    syntaxHighlighting(zenHighlightStyle),
  ];
}

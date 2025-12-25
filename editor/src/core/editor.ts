import { EditorState, Extension, EditorSelection } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightSpecialChars,
  ViewPlugin,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { foldGutter, foldKeymap, foldService } from '@codemirror/language';

import type { EditorConfig, CodeBlockInfo } from './config';
import { defaultConfig } from './config';
import { markdownDecorations, TrackerRef } from '../markdown/decorations';
import { zenTheme } from '../themes/zen';
import { ExecutionTracker } from '../execution/tracker';
import { MockExecutor } from '../execution/executor';
import {
  createCollabExtension,
  createPresenceExtension,
  createLockManager,
  lockExtension,
  streamingOverlayExtension,
  LockManager,
} from '../collaboration';

/**
 * The main editor instance
 */
export class MrmdEditor {
  readonly view: EditorView;
  readonly lockManager: LockManager | null = null;
  readonly tracker: ExecutionTracker | null = null;
  private trackerRef: TrackerRef = { current: null };
  private config: EditorConfig;

  constructor(config: EditorConfig) {
    this.config = { ...defaultConfig, ...config };

    // Set up executor
    const executor = this.config.executor ?? new MockExecutor();

    // Set up lock manager if collab is enabled
    if (this.config.collab) {
      const { userId, userName } = this.config.collab;
      const userColor = this.config.collab.userColor || this.generateUserColor(userId);
      this.lockManager = createLockManager({
        userId,
        userName: userName || 'Anonymous',
        userColor,
        onEvent: (event) => {
          console.log('Lock event:', event.type, event);
        },
      });
    }

    // Build extensions (trackerRef will be populated after view creation)
    const extensions = this.buildExtensions();

    // Create editor state
    const state = EditorState.create({
      doc: this.config.doc || '',
      extensions,
    });

    // Create editor view
    this.view = new EditorView({
      state,
      parent: this.config.parent,
    });

    // Initialize tracker with view and update the ref
    this.tracker = new ExecutionTracker(this.view, executor);
    this.trackerRef.current = this.tracker;

    // Focus editor
    this.view.focus();
  }

  private buildExtensions(): Extension[] {
    const extensions: Extension[] = [
      // Core
      history(),
      drawSelection(),
      highlightSpecialChars(),
      EditorView.lineWrapping,

      // Markdown
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
      }),

      // Decorations (uses trackerRef which gets populated after view creation)
      markdownDecorations(this.trackerRef, {
        resolveImageUrl: this.config.resolveImageUrl,
      }),

      // Folding
      headingFoldService,
      foldGutter({
        openText: '▼',
        closedText: '▶',
      }),

      // Theme
      this.getThemeExtension(),

      // Keymaps
      keymap.of([...foldKeymap, ...defaultKeymap, ...historyKeymap]),
    ];

    // Change callback
    if (this.config.onChange) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.config.onChange?.(update.state.doc.toString());
          }
        })
      );
    }

    // Cursor change callback
    if (this.config.onCursorChange) {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const state = update.state;
            const { from, to, head } = state.selection.main;
            const line = state.doc.lineAt(head);
            this.config.onCursorChange?.({
              pos: head,
              line: line.number,
              col: head - line.from + 1,
              from,
              to,
              selectedText: from !== to ? state.sliceDoc(from, to) : '',
            });
          }
        })
      );
    }

    // Streaming overlay for AI/execution output - always included
    // This allows AI actions to use the overlay even without full collaboration
    extensions.push(streamingOverlayExtension());

    // Collaboration
    if (this.config.collab) {
      const { adapter, filePath, userId, startVersion } = this.config.collab;

      // Only add OT-based collab if adapter is provided
      // (When using Yjs, extensions are passed via config.extensions instead)
      if (adapter) {
        // Add collab extension for OT
        extensions.push(
          createCollabExtension({
            adapter,
            filePath,
            userId,
            startVersion,
          })
        );

        // Add presence extension for remote cursors
        extensions.push(createPresenceExtension(adapter));
      }

      // Add lock extension for block-level locking
      if (this.lockManager) {
        extensions.push(lockExtension({ manager: this.lockManager }));
      }
    }

    // Custom extensions
    if (this.config.extensions) {
      extensions.push(...this.config.extensions);
    }

    return extensions;
  }

  private getThemeExtension(): Extension {
    if (typeof this.config.theme === 'string') {
      switch (this.config.theme) {
        case 'zen':
        case 'light':
        case 'dark':
          return zenTheme();
        default:
          return zenTheme();
      }
    }
    return this.config.theme ?? zenTheme();
  }

  /**
   * Get document statistics (word count, line count, etc.)
   */
  getStats(): { words: number; lines: number; chars: number } {
    const text = this.view.state.doc.toString();
    return {
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      lines: this.view.state.doc.lines,
      chars: text.length,
    };
  }

  // ============================================================================
  // Code Block API
  // ============================================================================

  /**
   * Information about a code block in the document
   */
  getCodeBlocks(): CodeBlockInfo[] {
    const doc = this.view.state.doc.toString();
    const blocks: CodeBlockInfo[] = [];

    // Regex to find code blocks: ```lang\ncode\n```
    const regex = /^```(\w*)\n([\s\S]*?)^```$/gm;
    let match;
    let index = 0;

    while ((match = regex.exec(doc)) !== null) {
      const lang = match[1] || '';
      const code = match[2];

      // Skip output and html-rendered blocks
      if (lang.startsWith('output') || lang.startsWith('html-rendered')) {
        continue;
      }

      blocks.push({
        index,
        language: lang,
        code,
        start: match.index,
        end: match.index + match[0].length,
        codeStart: match.index + 3 + lang.length + 1, // After ```lang\n
        codeEnd: match.index + 3 + lang.length + 1 + code.length,
      });
      index++;
    }

    return blocks;
  }

  /**
   * Get a specific code block by index
   */
  getCodeBlock(blockIndex: number): CodeBlockInfo | null {
    const blocks = this.getCodeBlocks();
    return blocks[blockIndex] ?? null;
  }

  /**
   * Run a code block by index
   */
  async runCodeBlock(blockIndex: number): Promise<string | null> {
    const block = this.getCodeBlock(blockIndex);
    if (!block || !this.tracker) return null;

    return this.tracker.runBlock(block.code, block.language, block.end);
  }

  /**
   * Find and remove output block after a code block
   */
  clearCodeBlockOutput(blockIndex: number): boolean {
    const block = this.getCodeBlock(blockIndex);
    if (!block) return false;

    const doc = this.view.state.doc.toString();
    const afterBlock = doc.slice(block.end);

    // Look for output block immediately after
    const outputMatch = afterBlock.match(/^\n```output(?::[^\n]*)?\n[\s\S]*?```/);
    if (!outputMatch) return false;

    this.view.dispatch({
      changes: {
        from: block.end,
        to: block.end + outputMatch[0].length,
        insert: '',
      },
    });

    return true;
  }

  /**
   * Clear all output blocks in the document
   */
  clearAllOutputs(): void {
    const doc = this.view.state.doc.toString();

    // Find all output and html-rendered blocks
    const outputRegex = /\n```(?:output|html-rendered)(?::[^\n]*)?\n[\s\S]*?```/g;
    const changes: { from: number; to: number; insert: string }[] = [];

    let match;
    while ((match = outputRegex.exec(doc)) !== null) {
      changes.push({
        from: match.index,
        to: match.index + match[0].length,
        insert: '',
      });
    }

    if (changes.length > 0) {
      // Apply changes in reverse order to maintain positions
      changes.reverse();
      this.view.dispatch({ changes });
    }
  }

  /**
   * Set output for a code block (creates or replaces output block)
   */
  setCodeBlockOutput(blockIndex: number, output: string): boolean {
    const block = this.getCodeBlock(blockIndex);
    if (!block) return false;

    const doc = this.view.state.doc.toString();
    const afterBlock = doc.slice(block.end);

    // Generate a stable execId based on block index
    const execId = `block-${blockIndex}`;

    // Look for existing output block
    const outputMatch = afterBlock.match(/^\n```output(?::[^\n]*)?\n([\s\S]*?)```/);

    if (outputMatch) {
      // Replace existing output content
      const outputStart = block.end + 1; // Skip the newline
      const contentStart = outputStart + outputMatch[0].indexOf('\n') + 1;
      const contentEnd = block.end + outputMatch[0].length - 3; // Before closing ```

      this.view.dispatch({
        changes: {
          from: outputStart,
          to: block.end + outputMatch[0].length,
          insert: `\`\`\`output:${execId}\n${output}\n\`\`\``,
        },
      });
    } else {
      // Insert new output block
      const finalOutput = output.endsWith('\n') ? output : output + '\n';
      this.view.dispatch({
        changes: {
          from: block.end,
          insert: `\n\`\`\`output:${execId}\n${finalOutput}\`\`\``,
        },
      });
    }

    return true;
  }

  /**
   * Get the current document as string
   */
  getDoc(): string {
    return this.view.state.doc.toString();
  }

  /**
   * Set the document content
   */
  setDoc(content: string): void {
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: content,
      },
    });
  }

  /**
   * Focus the editor
   */
  focus(): void {
    this.view.focus();
  }

  // ============================================================================
  // Cursor & Selection API
  // ============================================================================

  /**
   * Get the current cursor position (head of main selection)
   */
  getCursor(): number {
    return this.view.state.selection.main.head;
  }

  /**
   * Set cursor position
   */
  setCursor(pos: number): void {
    const docLength = this.view.state.doc.length;
    const clampedPos = Math.max(0, Math.min(pos, docLength));
    this.view.dispatch({
      selection: EditorSelection.cursor(clampedPos),
      scrollIntoView: true,
    });
  }

  /**
   * Get the current selection range and text
   * Returns null if no selection (just a cursor)
   */
  getSelection(): { from: number; to: number; text: string } | null {
    const { from, to } = this.view.state.selection.main;
    if (from === to) return null;
    return {
      from,
      to,
      text: this.view.state.sliceDoc(from, to),
    };
  }

  /**
   * Set selection range
   */
  setSelection(from: number, to: number): void {
    const docLength = this.view.state.doc.length;
    const clampedFrom = Math.max(0, Math.min(from, docLength));
    const clampedTo = Math.max(0, Math.min(to, docLength));
    this.view.dispatch({
      selection: EditorSelection.range(clampedFrom, clampedTo),
      scrollIntoView: true,
    });
  }

  /**
   * Scroll to a position in the document
   */
  scrollToPos(pos: number): void {
    const clampedPos = Math.max(0, Math.min(pos, this.view.state.doc.length));
    this.view.dispatch({
      effects: EditorView.scrollIntoView(clampedPos, { y: 'center' }),
    });
  }

  /**
   * Scroll to a specific line number (1-indexed)
   */
  scrollToLine(lineNumber: number): void {
    const totalLines = this.view.state.doc.lines;
    const clampedLine = Math.max(1, Math.min(lineNumber, totalLines));
    const line = this.view.state.doc.line(clampedLine);
    this.view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }

  /**
   * Get cursor position as line and column
   */
  getCursorLineCol(): { line: number; col: number } {
    const pos = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(pos);
    return {
      line: line.number,
      col: pos - line.from + 1,
    };
  }

  // ============================================================================
  // Text Manipulation API
  // ============================================================================

  /**
   * Insert text at position (or at cursor if position not specified)
   */
  insertText(text: string, at?: number): void {
    const docLength = this.view.state.doc.length;
    const pos = at !== undefined
      ? Math.max(0, Math.min(at, docLength))
      : this.view.state.selection.main.head;
    this.view.dispatch({
      changes: { from: pos, insert: text },
      selection: EditorSelection.cursor(pos + text.length),
    });
  }

  /**
   * Replace a range of text
   */
  replaceRange(from: number, to: number, text: string): void {
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
    });
  }

  /**
   * Wrap the current selection with prefix and suffix
   * If no selection, inserts prefix + suffix and places cursor between
   */
  wrapSelection(prefix: string, suffix: string): void {
    const { from, to } = this.view.state.selection.main;
    const selectedText = this.view.state.sliceDoc(from, to);
    const newText = prefix + selectedText + suffix;

    this.view.dispatch({
      changes: { from, to, insert: newText },
      selection: from === to
        ? EditorSelection.cursor(from + prefix.length)
        : EditorSelection.range(from + prefix.length, from + prefix.length + selectedText.length),
    });
  }

  /**
   * Add a prefix to the current line(s)
   * Useful for adding heading markers, list markers, etc.
   */
  setLinePrefix(prefix: string): void {
    const { from, to } = this.view.state.selection.main;
    const fromLine = this.view.state.doc.lineAt(from);
    const toLine = this.view.state.doc.lineAt(to);

    const changes: { from: number; to: number; insert: string }[] = [];

    for (let lineNum = fromLine.number; lineNum <= toLine.number; lineNum++) {
      const line = this.view.state.doc.line(lineNum);
      // Check if line already has this prefix (toggle behavior)
      if (line.text.startsWith(prefix)) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
      } else {
        changes.push({ from: line.from, to: line.from, insert: prefix });
      }
    }

    this.view.dispatch({ changes });
  }

  /**
   * Insert a code block at the current position
   */
  insertCodeBlock(lang: string = ''): void {
    const { from, to } = this.view.state.selection.main;
    const selectedText = this.view.state.sliceDoc(from, to);
    const codeBlock = `\`\`\`${lang}\n${selectedText}\n\`\`\``;

    this.view.dispatch({
      changes: { from, to, insert: codeBlock },
      selection: EditorSelection.cursor(from + 3 + lang.length + 1),
    });
  }

  // ============================================================================
  // Undo/Redo API
  // ============================================================================

  /**
   * Undo the last change
   */
  undo(): boolean {
    return undo(this.view);
  }

  /**
   * Redo the last undone change
   */
  redo(): boolean {
    return redo(this.view);
  }

  /**
   * Destroy the editor
   */
  destroy(): void {
    this.tracker?.cancelAll();
    this.lockManager?.destroy();
    // Leave file before destroying (only if using adapter-based collab)
    this.config.collab?.adapter?.leaveFile();
    this.view.destroy();
  }

  /**
   * Join a file for collaborative editing
   */
  joinFile(filePath: string): void {
    this.config.collab?.adapter?.joinFile(filePath);
  }

  /**
   * Leave the current file
   */
  leaveFile(): void {
    this.config.collab?.adapter?.leaveFile();
  }

  /**
   * Notify that the file was saved
   */
  notifySaved(): void {
    if (this.config.collab?.adapter) {
      this.config.collab.adapter.notifySaved(
        this.config.collab.filePath,
        this.view.state.doc.toString()
      );
    }
  }

  /**
   * Check if collaboration is enabled
   */
  get isCollaborative(): boolean {
    return !!this.config.collab;
  }

  /**
   * Generate a consistent color from user ID
   */
  private generateUserColor(userId: string): string {
    const colors = [
      '#f87171', '#fb923c', '#fbbf24', '#a3e635',
      '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8',
      '#c084fc', '#f472b6',
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }
}

/**
 * Heading-based folding service
 */
const headingFoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  const match = text.match(/^(#{1,6})\s/);
  if (!match) return null;

  const level = match[1].length;
  const startLine = line.number;

  for (let i = startLine + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i);
    const nextMatch = nextLine.text.match(/^(#{1,6})\s/);
    if (nextMatch && nextMatch[1].length <= level) {
      const foldEnd = state.doc.line(i - 1).to;
      if (foldEnd > line.to) {
        return { from: line.to, to: foldEnd };
      }
      return null;
    }
  }

  if (state.doc.length > line.to) {
    return { from: line.to, to: state.doc.length };
  }
  return null;
});

/**
 * Create a new editor instance
 */
export function createEditor(config: EditorConfig): MrmdEditor {
  return new MrmdEditor(config);
}

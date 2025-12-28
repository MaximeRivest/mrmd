import type { Extension } from '@codemirror/state';
import type { Executor } from '../execution/executor';
import type { CollabClientAdapter } from '../collaboration/types';

// Re-export CodeBlockInfo from the canonical source
export type { CodeBlockInfo } from './code-blocks';

// ============================================================================
// Code Intelligence Types
// ============================================================================

/**
 * Cursor/selection info passed to callbacks
 */
export interface CursorInfo {
  /** Absolute position in document */
  pos: number;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed) */
  col: number;
  /** Selection start (same as pos if no selection) */
  from: number;
  /** Selection end (same as pos if no selection) */
  to: number;
  /** Selected text (empty string if no selection) */
  selectedText: string;
}

/**
 * Code completion result
 */
export interface CompletionResult {
  /** Completion options */
  completions: CompletionItem[];
  /** Start position for replacement */
  from: number;
  /** End position for replacement */
  to: number;
}

/**
 * Single completion item
 */
export interface CompletionItem {
  /** Display label */
  label: string;
  /** Text to insert */
  insertText?: string;
  /** Item type (function, variable, class, etc.) */
  type?: string;
  /** Optional detail/signature */
  detail?: string;
  /** Optional documentation */
  documentation?: string;
}

/**
 * Code inspection result (Shift+Tab)
 */
export interface InspectionResult {
  /** Whether info was found */
  found: boolean;
  /** Object/function name */
  name?: string;
  /** Signature (for functions) */
  signature?: string;
  /** Docstring/documentation */
  docstring?: string;
  /** Type info */
  type?: string;
}

/**
 * Hover documentation result
 */
export interface HoverResult {
  /** Content to display */
  content: string;
  /** Optional range to highlight */
  range?: { from: number; to: number };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for creating an editor instance
 */
export interface EditorConfig {
  /** Parent element to mount the editor */
  parent: HTMLElement;

  /** Initial document content */
  doc?: string;

  /** Code executor for running code blocks */
  executor?: Executor;

  /** Collaboration configuration */
  collab?: CollabConfig;

  /** Theme name or custom theme extension */
  theme?: 'zen' | 'light' | 'dark' | Extension;

  /** Callback when document should be saved */
  onSave?: (doc: string) => void;

  /** Callback when document changes */
  onChange?: (doc: string) => void;

  /** Callback when cursor/selection changes */
  onCursorChange?: (info: CursorInfo) => void;

  // ===========================================================================
  // Code Intelligence Callbacks
  // ===========================================================================

  /**
   * Code completion provider (Tab in code blocks)
   * Return completions for the given code and cursor position
   */
  onComplete?: (
    code: string,
    cursorPos: number,
    language: string
  ) => Promise<CompletionResult | null>;

  /**
   * Code inspection provider (Shift+Tab in code blocks)
   * Return info about the symbol at cursor
   */
  onInspect?: (
    code: string,
    cursorPos: number,
    language: string
  ) => Promise<InspectionResult | null>;

  /**
   * Hover documentation provider
   * Return documentation for the hovered word
   */
  onHover?: (
    word: string,
    language: string
  ) => Promise<HoverResult | null>;

  /** Whether to show line numbers */
  lineNumbers?: boolean;

  /** Whether to enable focus mode */
  focusMode?: boolean;

  /** Additional CM6 extensions */
  extensions?: Extension[];

  /**
   * Resolve image URLs before rendering (e.g., convert relative paths to API URLs)
   */
  resolveImageUrl?: (url: string) => string;
}

/**
 * Collaboration configuration
 */
export interface CollabConfig {
  /** Collaboration client adapter (optional - not needed for Yjs-based collab) */
  adapter?: CollabClientAdapter;

  /** File path being edited */
  filePath: string;

  /** Current user ID */
  userId: string;

  /** Current user display name */
  userName?: string;

  /** User color (hex) - assigned by server if not provided */
  userColor?: string;

  /** Starting document version (for reconnection) */
  startVersion?: number;
}

/**
 * Default configuration values
 */
export const defaultConfig: Partial<EditorConfig> = {
  doc: '',
  theme: 'zen',
  lineNumbers: false,
  focusMode: false,
};

import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { CellOptions } from '../cells/types';
import { parseCellOptions } from '../cells/options';

/**
 * Information about a code block extracted from the syntax tree
 */
export interface CodeBlockInfo {
  /** Index of this block among all code blocks */
  index: number;
  /** Language identifier (python, javascript, etc.) */
  language: string;
  /** The code content (without fences) */
  code: string;
  /** Start position of the entire block (including opening fence) */
  start: number;
  /** End position of the entire block (including closing fence) */
  end: number;
  /** Start position of the code content */
  codeStart: number;
  /** End position of the code content */
  codeEnd: number;
  /** Cell options (for HTML blocks) */
  cellOptions?: CellOptions;
}

/**
 * Non-executable language tags
 */
const NON_EXECUTABLE_LANGS = new Set(['text', 'markdown', 'md', 'output']);

/**
 * Check if a fence line represents an output block (supports 3+ backticks)
 */
export function isOutputBlock(fenceLine: string): boolean {
  // Match: ```output, ````output, ```output:exec-id, etc.
  return /^`{3,}output(?::|$|\s)/i.test(fenceLine);
}

/**
 * Check if a fence line represents an html-rendered block (supports 3+ backticks)
 */
export function isHtmlRenderedBlock(fenceLine: string): boolean {
  return /^`{3,}html-rendered/i.test(fenceLine);
}

/**
 * Check if a fence line represents an image-output block (supports 3+ backticks)
 */
export function isImageOutputBlock(fenceLine: string): boolean {
  // Match: ```image-output, ````image-output, ```image-output:exec-id, etc.
  return /^`{3,}image-output(?::|$|\s)/i.test(fenceLine);
}

/**
 * Extract language from a fence line (supports 3+ backticks)
 */
export function extractLanguage(fenceLine: string): string {
  const match = fenceLine.match(/^`{3,}(\w+)/);
  return match ? match[1] : '';
}

/**
 * Get all executable code blocks from the editor state using the syntax tree.
 * This is the authoritative way to find code blocks - used by both
 * the run button decorations and programmatic execution (Run All, etc.)
 */
export function getCodeBlocksFromAST(state: EditorState): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  const tree = syntaxTree(state);
  let index = 0;

  tree.iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        const startLine = state.doc.lineAt(node.from);
        const firstLineText = startLine.text;

        // Extract language from the opening fence (supports 3+ backticks)
        const lang = extractLanguage(firstLineText);

        // Skip output, html-rendered, image-output, and non-executable blocks
        const isOutput = isOutputBlock(firstLineText);
        const isHtmlRendered = isHtmlRenderedBlock(firstLineText);
        const isImageOutput = isImageOutputBlock(firstLineText);

        if (isOutput || isHtmlRendered || isImageOutput) {
          return;
        }

        // Skip blocks without a language or with non-executable languages
        if (!lang || NON_EXECUTABLE_LANGS.has(lang)) {
          return;
        }

        // Extract code content (between the fences)
        const fullText = state.doc.sliceString(node.from, node.to);
        const lines = fullText.split('\n');
        // Remove first (```lang) and last (```) lines
        const codeLines = lines.slice(1, -1);
        const code = codeLines.join('\n');

        // Calculate code positions
        const codeStart = node.from + startLine.text.length + 1; // After ```lang\n
        const codeEnd = node.to - 3 - 1; // Before \n```

        // Parse cell options for HTML blocks
        const cellOptions = lang === 'html' ? parseCellOptions(firstLineText).options : undefined;

        blocks.push({
          index,
          language: lang,
          code,
          start: node.from,
          end: node.to,
          codeStart,
          codeEnd,
          cellOptions,
        });

        index++;
      }
    },
  });

  return blocks;
}

/**
 * Get a specific code block by index
 */
export function getCodeBlockByIndex(state: EditorState, blockIndex: number): CodeBlockInfo | null {
  const blocks = getCodeBlocksFromAST(state);
  return blocks[blockIndex] ?? null;
}

/**
 * Find the code block at or before a given position
 */
export function getCodeBlockAtPosition(state: EditorState, pos: number): CodeBlockInfo | null {
  const blocks = getCodeBlocksFromAST(state);

  // Find the block that contains or is closest before the position
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].start <= pos) {
      return blocks[i];
    }
  }

  return null;
}

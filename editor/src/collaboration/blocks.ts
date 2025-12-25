/**
 * Block Detection System
 *
 * Parses a markdown document into structural blocks for lock granularity.
 * Blocks are the unit of locking - one user can edit one block at a time.
 */

import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'code'
  | 'output'
  | 'list'
  | 'blockquote'
  | 'table'
  | 'thematic-break'
  | 'html'
  | 'empty';

export interface Block {
  id: string;
  type: BlockType;
  startLine: number;
  endLine: number;
  startPos: number;
  endPos: number;
  metadata?: {
    level?: number;        // For headings (1-6)
    lang?: string;         // For code blocks
    parentCodeId?: string; // For output blocks
  };
}

export interface BlockMap {
  blocks: Block[];
  byLine: Map<number, Block>;
  byId: Map<string, Block>;
}

/**
 * Generate a stable ID for a block based on its position and type
 */
function generateBlockId(type: BlockType, startLine: number, content?: string): string {
  // Use type + line for basic ID, could add content hash for more stability
  return `${type}-L${startLine}`;
}

/**
 * Parse document into structural blocks using the syntax tree
 */
export function parseBlocks(state: EditorState): BlockMap {
  const blocks: Block[] = [];
  const byLine = new Map<number, Block>();
  const byId = new Map<string, Block>();

  const doc = state.doc;
  const tree = syntaxTree(state);

  // Track which lines are already assigned to blocks
  const assignedLines = new Set<number>();

  // First pass: identify code blocks, blockquotes, lists from syntax tree
  tree.iterate({
    enter: (node) => {
      const startLine = doc.lineAt(node.from).number;
      const endLine = doc.lineAt(node.to).number;

      // Fenced code blocks
      if (node.name === 'FencedCode') {
        const firstLineText = doc.lineAt(node.from).text;
        const langMatch = firstLineText.match(/^```(\S*)/);
        const lang = langMatch?.[1] || '';
        const isOutput = lang === 'output' || lang.startsWith('output:');

        const block: Block = {
          id: generateBlockId(isOutput ? 'output' : 'code', startLine),
          type: isOutput ? 'output' : 'code',
          startLine,
          endLine,
          startPos: node.from,
          endPos: node.to,
          metadata: { lang },
        };

        // Link output to previous code block
        if (isOutput && blocks.length > 0) {
          const prevBlock = blocks[blocks.length - 1];
          if (prevBlock.type === 'code') {
            block.metadata!.parentCodeId = prevBlock.id;
          }
        }

        blocks.push(block);
        for (let i = startLine; i <= endLine; i++) {
          assignedLines.add(i);
          byLine.set(i, block);
        }
        byId.set(block.id, block);
        return false; // Don't recurse into code blocks
      }

      // Blockquotes
      if (node.name === 'Blockquote') {
        const block: Block = {
          id: generateBlockId('blockquote', startLine),
          type: 'blockquote',
          startLine,
          endLine,
          startPos: node.from,
          endPos: node.to,
        };
        blocks.push(block);
        for (let i = startLine; i <= endLine; i++) {
          assignedLines.add(i);
          byLine.set(i, block);
        }
        byId.set(block.id, block);
        return false;
      }

      // Lists (BulletList or OrderedList)
      if (node.name === 'BulletList' || node.name === 'OrderedList') {
        const block: Block = {
          id: generateBlockId('list', startLine),
          type: 'list',
          startLine,
          endLine,
          startPos: node.from,
          endPos: node.to,
        };
        blocks.push(block);
        for (let i = startLine; i <= endLine; i++) {
          assignedLines.add(i);
          byLine.set(i, block);
        }
        byId.set(block.id, block);
        return false;
      }

      // Headings
      if (node.name.startsWith('ATXHeading')) {
        const level = parseInt(node.name.match(/\d/)?.[0] || '1', 10);
        const block: Block = {
          id: generateBlockId('heading', startLine),
          type: 'heading',
          startLine,
          endLine: startLine, // Headings are single line
          startPos: node.from,
          endPos: node.to,
          metadata: { level },
        };
        blocks.push(block);
        assignedLines.add(startLine);
        byLine.set(startLine, block);
        byId.set(block.id, block);
        return false;
      }

      // Thematic break (---, ***, ___)
      if (node.name === 'HorizontalRule') {
        const block: Block = {
          id: generateBlockId('thematic-break', startLine),
          type: 'thematic-break',
          startLine,
          endLine: startLine,
          startPos: node.from,
          endPos: node.to,
        };
        blocks.push(block);
        assignedLines.add(startLine);
        byLine.set(startLine, block);
        byId.set(block.id, block);
        return false;
      }

      // HTML blocks
      if (node.name === 'HTMLBlock') {
        const block: Block = {
          id: generateBlockId('html', startLine),
          type: 'html',
          startLine,
          endLine,
          startPos: node.from,
          endPos: node.to,
        };
        blocks.push(block);
        for (let i = startLine; i <= endLine; i++) {
          assignedLines.add(i);
          byLine.set(i, block);
        }
        byId.set(block.id, block);
        return false;
      }

      // Table (GFM)
      if (node.name === 'Table') {
        const block: Block = {
          id: generateBlockId('table', startLine),
          type: 'table',
          startLine,
          endLine,
          startPos: node.from,
          endPos: node.to,
        };
        blocks.push(block);
        for (let i = startLine; i <= endLine; i++) {
          assignedLines.add(i);
          byLine.set(i, block);
        }
        byId.set(block.id, block);
        return false;
      }
    }
  });

  // Second pass: identify paragraphs (unassigned non-empty lines)
  let paragraphStart: number | null = null;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    const isEmpty = line.text.trim() === '';
    const isAssigned = assignedLines.has(lineNum);

    if (!isAssigned && !isEmpty) {
      // Start or continue a paragraph
      if (paragraphStart === null) {
        paragraphStart = lineNum;
      }
    } else if (paragraphStart !== null) {
      // End the paragraph
      const endLine = lineNum - 1;
      const startPos = doc.line(paragraphStart).from;
      const endPos = doc.line(endLine).to;

      const block: Block = {
        id: generateBlockId('paragraph', paragraphStart),
        type: 'paragraph',
        startLine: paragraphStart,
        endLine,
        startPos,
        endPos,
      };
      blocks.push(block);
      for (let i = paragraphStart; i <= endLine; i++) {
        byLine.set(i, block);
      }
      byId.set(block.id, block);
      paragraphStart = null;
    }

    // Mark empty lines
    if (isEmpty && !isAssigned) {
      const block: Block = {
        id: generateBlockId('empty', lineNum),
        type: 'empty',
        startLine: lineNum,
        endLine: lineNum,
        startPos: line.from,
        endPos: line.to,
      };
      // Don't add empty blocks to the main list, but track in byLine
      byLine.set(lineNum, block);
    }
  }

  // Handle paragraph at end of document
  if (paragraphStart !== null) {
    const endLine = doc.lines;
    const startPos = doc.line(paragraphStart).from;
    const endPos = doc.line(endLine).to;

    const block: Block = {
      id: generateBlockId('paragraph', paragraphStart),
      type: 'paragraph',
      startLine: paragraphStart,
      endLine,
      startPos,
      endPos,
    };
    blocks.push(block);
    for (let i = paragraphStart; i <= endLine; i++) {
      byLine.set(i, block);
    }
    byId.set(block.id, block);
  }

  // Sort blocks by start position
  blocks.sort((a, b) => a.startPos - b.startPos);

  return { blocks, byLine, byId };
}

/**
 * Get the block at a given position
 */
export function getBlockAtPos(state: EditorState, pos: number): Block | null {
  const line = state.doc.lineAt(pos);
  const blockMap = parseBlocks(state);
  return blockMap.byLine.get(line.number) || null;
}

/**
 * Get the block containing a given line number
 */
export function getBlockAtLine(blockMap: BlockMap, lineNum: number): Block | null {
  return blockMap.byLine.get(lineNum) || null;
}

/**
 * Check if two ranges overlap
 */
export function blocksOverlap(a: Block, b: Block): boolean {
  return !(a.endLine < b.startLine || b.endLine < a.startLine);
}

/**
 * Get all blocks that overlap with a given range
 */
export function getBlocksInRange(
  blockMap: BlockMap,
  startLine: number,
  endLine: number
): Block[] {
  return blockMap.blocks.filter(block =>
    !(block.endLine < startLine || block.startLine > endLine)
  );
}

/**
 * Output Sync Manager
 *
 * Handles code execution output SEPARATELY from Yjs CRDT.
 *
 * Why separate?
 * - Output can be huge (DataFrames, images as base64)
 * - Output changes don't need merge semantics (it's append-only or replace)
 * - We don't want output history in CRDT (bloats storage)
 * - Output is ephemeral until file save
 *
 * Architecture:
 * - Output blocks in markdown are placeholders: ```output:block-123\n```
 * - Actual content is stored in OutputSyncManager
 * - On save, content is inlined into markdown
 * - On load, content is extracted back to manager
 */

import type { CollabClientAdapter } from './types';

/**
 * Output block content
 */
export interface OutputBlock {
  /** Unique block ID */
  blockId: string;
  /** Output content (text, can contain ANSI codes) */
  content: string;
  /** Rich output (images, HTML, etc.) */
  richContent?: RichOutput[];
  /** Execution status */
  status: 'idle' | 'running' | 'streaming' | 'completed' | 'error';
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp of last update */
  lastUpdate: number;
}

/**
 * Rich output (images, HTML, etc.)
 */
export interface RichOutput {
  /** MIME type */
  mimeType: string;
  /** Data (base64 for binary, string for text) */
  data: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Events emitted by OutputSyncManager
 */
export interface OutputSyncEvents {
  /** Output block updated */
  update: { blockId: string; block: OutputBlock };
  /** Output block cleared */
  clear: { blockId: string };
  /** All outputs cleared */
  clearAll: void;
}

type EventHandler<T> = (data: T) => void;

/**
 * Configuration for OutputSyncManager
 */
export interface OutputSyncConfig {
  /** Collaboration adapter for broadcasting (optional) */
  adapter?: CollabClientAdapter;
  /** File path being edited */
  filePath: string;
  /** Broadcast output to other users? */
  broadcastOutput?: boolean;
}

/**
 * Manages execution output separately from document CRDT
 */
export class OutputSyncManager {
  private outputs = new Map<string, OutputBlock>();
  private config: OutputSyncConfig;
  private eventHandlers = new Map<string, Set<EventHandler<unknown>>>();

  constructor(config: OutputSyncConfig) {
    this.config = {
      broadcastOutput: true,
      ...config,
    };

    // Listen for remote output if adapter provided
    if (config.adapter) {
      this.setupRemoteOutputListener();
    }
  }

  /**
   * Get output for a block
   */
  get(blockId: string): OutputBlock | undefined {
    return this.outputs.get(blockId);
  }

  /**
   * Get all outputs
   */
  getAll(): Map<string, OutputBlock> {
    return new Map(this.outputs);
  }

  /**
   * Start execution for a block (creates/resets block)
   */
  startExecution(blockId: string): void {
    const block: OutputBlock = {
      blockId,
      content: '',
      richContent: [],
      status: 'running',
      lastUpdate: Date.now(),
    };

    this.outputs.set(blockId, block);
    this.emit('update', { blockId, block });
    this.broadcastUpdate(blockId, block);
  }

  /**
   * Append streaming output chunk
   */
  appendChunk(blockId: string, chunk: string): void {
    let block = this.outputs.get(blockId);

    if (!block) {
      block = {
        blockId,
        content: '',
        richContent: [],
        status: 'streaming',
        lastUpdate: Date.now(),
      };
      this.outputs.set(blockId, block);
    }

    block.content += chunk;
    block.status = 'streaming';
    block.lastUpdate = Date.now();

    this.emit('update', { blockId, block });
    this.broadcastChunk(blockId, chunk);
  }

  /**
   * Add rich output (image, HTML, etc.)
   */
  addRichOutput(blockId: string, output: RichOutput): void {
    let block = this.outputs.get(blockId);

    if (!block) {
      block = {
        blockId,
        content: '',
        richContent: [],
        status: 'streaming',
        lastUpdate: Date.now(),
      };
      this.outputs.set(blockId, block);
    }

    if (!block.richContent) {
      block.richContent = [];
    }
    block.richContent.push(output);
    block.lastUpdate = Date.now();

    this.emit('update', { blockId, block });
    this.broadcastUpdate(blockId, block);
  }

  /**
   * Complete execution
   */
  completeExecution(blockId: string, error?: string): void {
    const block = this.outputs.get(blockId);
    if (!block) return;

    block.status = error ? 'error' : 'completed';
    block.error = error;
    block.lastUpdate = Date.now();

    this.emit('update', { blockId, block });
    this.broadcastUpdate(blockId, block);
  }

  /**
   * Set full output content (for non-streaming execution)
   */
  setContent(blockId: string, content: string, richContent?: RichOutput[]): void {
    const block: OutputBlock = {
      blockId,
      content,
      richContent: richContent || [],
      status: 'completed',
      lastUpdate: Date.now(),
    };

    this.outputs.set(blockId, block);
    this.emit('update', { blockId, block });
    this.broadcastUpdate(blockId, block);
  }

  /**
   * Clear output for a block
   */
  clear(blockId: string): void {
    this.outputs.delete(blockId);
    this.emit('clear', { blockId });

    // Broadcast clear
    if (this.config.adapter && this.config.broadcastOutput) {
      // Use existing adapter's generic operation mechanism
      // The backend/other clients need to understand this
    }
  }

  /**
   * Clear all outputs
   */
  clearAll(): void {
    this.outputs.clear();
    this.emit('clearAll', undefined);
  }

  /**
   * Load outputs from saved markdown
   * Extracts content from output blocks and stores in manager
   */
  loadFromMarkdown(markdown: string): string {
    // Match output blocks with content: ```output:blockId\ncontent\n```
    const outputRegex = /```output:([^\n]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = outputRegex.exec(markdown)) !== null) {
      const blockId = match[1];
      const content = match[2];

      if (content.trim()) {
        this.outputs.set(blockId, {
          blockId,
          content,
          richContent: [],
          status: 'completed',
          lastUpdate: Date.now(),
        });
      }
    }

    // Return markdown with output blocks emptied (placeholders only)
    return markdown.replace(outputRegex, '```output:$1\n```');
  }

  /**
   * Inline outputs into markdown for saving
   */
  inlineToMarkdown(markdown: string): string {
    // Replace empty output placeholders with actual content
    return markdown.replace(
      /```output:([^\n]+)\n```/g,
      (match, blockId) => {
        const block = this.outputs.get(blockId);
        if (block && block.content) {
          return `\`\`\`output:${blockId}\n${block.content}\`\`\``;
        }
        return match; // Keep placeholder if no content
      }
    );
  }

  /**
   * Generate markdown for rich outputs (images, etc.)
   * Can be called separately to embed rich content
   */
  getRichOutputMarkdown(blockId: string): string {
    const block = this.outputs.get(blockId);
    if (!block?.richContent?.length) return '';

    const parts: string[] = [];

    for (const output of block.richContent) {
      if (output.mimeType.startsWith('image/')) {
        // Embed as base64 image
        parts.push(`![Output](data:${output.mimeType};base64,${output.data})`);
      } else if (output.mimeType === 'text/html') {
        // Could embed as HTML block or render separately
        parts.push('<!-- HTML output available -->');
      }
    }

    return parts.join('\n');
  }

  // Event handling
  on<K extends keyof OutputSyncEvents>(
    event: K,
    handler: EventHandler<OutputSyncEvents[K]>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  off<K extends keyof OutputSyncEvents>(
    event: K,
    handler: EventHandler<OutputSyncEvents[K]>
  ): void {
    this.eventHandlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof OutputSyncEvents>(
    event: K,
    data: OutputSyncEvents[K]
  ): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[OutputSync] Error in event handler for ${event}:`, err);
      }
    });
  }

  // Remote sync (broadcasts to other users viewing the same file)
  private setupRemoteOutputListener(): void {
    // This would listen for output broadcasts from other users
    // For now, using a custom message type through the existing adapter
    // Real implementation depends on your backend protocol
  }

  private broadcastChunk(blockId: string, chunk: string): void {
    if (!this.config.adapter || !this.config.broadcastOutput) return;

    // Send through existing WebSocket as a custom message
    // The adapter would need to support this message type
    // For now, we'll log it - implement based on your protocol
    console.log('[OutputSync] Would broadcast chunk:', blockId, chunk.length, 'chars');
  }

  private broadcastUpdate(blockId: string, block: OutputBlock): void {
    if (!this.config.adapter || !this.config.broadcastOutput) return;

    console.log('[OutputSync] Would broadcast update:', blockId, block.status);
  }

  /**
   * Apply remote output update (from another user)
   */
  applyRemoteUpdate(blockId: string, block: Partial<OutputBlock>): void {
    const existing = this.outputs.get(blockId);

    if (existing) {
      Object.assign(existing, block, { lastUpdate: Date.now() });
    } else {
      this.outputs.set(blockId, {
        blockId,
        content: '',
        richContent: [],
        status: 'idle',
        lastUpdate: Date.now(),
        ...block,
      } as OutputBlock);
    }

    this.emit('update', { blockId, block: this.outputs.get(blockId)! });
  }

  /**
   * Apply remote chunk (from another user)
   */
  applyRemoteChunk(blockId: string, chunk: string): void {
    this.appendChunk(blockId, chunk);
  }

  destroy(): void {
    this.outputs.clear();
    this.eventHandlers.clear();
  }
}

/**
 * Create an output sync manager
 */
export function createOutputSyncManager(config: OutputSyncConfig): OutputSyncManager {
  return new OutputSyncManager(config);
}

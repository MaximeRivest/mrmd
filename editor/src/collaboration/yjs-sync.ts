/**
 * Yjs-based Collaboration Sync
 *
 * This module provides CRDT-based real-time collaboration using Yjs.
 * It handles:
 * - Human ↔ Human editing with proper merge
 * - Cursor/selection awareness
 * - Integration with y-codemirror.next
 *
 * Output streaming and AI edits are handled separately (see output-sync.ts and external-changes.ts)
 */

import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { Awareness } from 'y-protocols/awareness';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import type { CollabClientAdapter } from './types';

/**
 * Configuration for Yjs sync
 */
export interface YjsSyncConfig {
  /** User ID */
  userId: string;
  /** User display name */
  userName: string;
  /** User color (hex) */
  userColor: string;
  /** File path being edited */
  filePath: string;
  /** Initial document content (for new docs or when no server state) */
  initialContent?: string;
  /** Called when doc syncs with server */
  onSync?: () => void;
  /** Called on sync error */
  onError?: (error: Error) => void;
}

/**
 * Yjs document manager for a single file
 *
 * Manages:
 * - Y.Doc instance
 * - Y.Text for document content
 * - Awareness for cursors/presence
 */
export class YjsDocManager {
  readonly ydoc: Y.Doc;
  readonly ytext: Y.Text;
  readonly awareness: Awareness;

  private config: YjsSyncConfig;
  private provider: YjsProvider | null = null;
  private destroyed = false;

  constructor(config: YjsSyncConfig) {
    this.config = config;

    // Create Yjs document
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('content');
    this.awareness = new Awareness(this.ydoc);

    // Set local awareness state
    this.awareness.setLocalStateField('user', {
      name: config.userName,
      color: config.userColor,
      colorLight: this.lightenColor(config.userColor, 0.8),
    });

    // Initialize with content if provided and doc is empty
    if (config.initialContent && this.ytext.length === 0) {
      this.ydoc.transact(() => {
        this.ytext.insert(0, config.initialContent!);
      }, 'init');
    }

    console.log('[YjsSync] Document created for', config.filePath);
  }

  /**
   * Connect to a Yjs provider (WebSocket, etc.)
   */
  connectProvider(provider: YjsProvider): void {
    if (this.provider) {
      this.provider.disconnect();
    }
    this.provider = provider;
    provider.connect(this.ydoc, this.awareness);
    console.log('[YjsSync] Provider connected');
  }

  /**
   * Get CodeMirror extensions for this document
   */
  getExtensions(): Extension[] {
    return [
      yCollab(this.ytext, this.awareness, {
        undoManager: new Y.UndoManager(this.ytext, {
          // Track origin to distinguish local vs remote changes
          trackedOrigins: new Set([null, 'local']),
        }),
      }),
      keymap.of(yUndoManagerKeymap),
    ];
  }

  /**
   * Get current document content as string
   */
  getContent(): string {
    return this.ytext.toString();
  }

  /**
   * Apply external change to the document
   * Used for AI edits that modify the file externally
   */
  applyExternalChange(newContent: string, origin = 'external'): void {
    const currentContent = this.ytext.toString();

    if (newContent === currentContent) {
      return; // No change
    }

    console.log('[YjsSync] Applying external change, origin:', origin);

    // Compute diff and apply as Yjs operations
    this.ydoc.transact(() => {
      // Simple diff: find common prefix and suffix
      let prefixLen = 0;
      while (
        prefixLen < currentContent.length &&
        prefixLen < newContent.length &&
        currentContent[prefixLen] === newContent[prefixLen]
      ) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (
        suffixLen < currentContent.length - prefixLen &&
        suffixLen < newContent.length - prefixLen &&
        currentContent[currentContent.length - 1 - suffixLen] ===
          newContent[newContent.length - 1 - suffixLen]
      ) {
        suffixLen++;
      }

      const deleteFrom = prefixLen;
      const deleteTo = currentContent.length - suffixLen;
      const insertText = newContent.slice(prefixLen, newContent.length - suffixLen);

      if (deleteTo > deleteFrom) {
        this.ytext.delete(deleteFrom, deleteTo - deleteFrom);
      }
      if (insertText.length > 0) {
        this.ytext.insert(deleteFrom, insertText);
      }
    }, origin);
  }

  /**
   * Observe document changes
   */
  observe(callback: (event: Y.YTextEvent, transaction: Y.Transaction) => void): void {
    this.ytext.observe(callback);
  }

  /**
   * Stop observing document changes
   */
  unobserve(callback: (event: Y.YTextEvent, transaction: Y.Transaction) => void): void {
    this.ytext.unobserve(callback);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.provider) {
      this.provider.disconnect();
    }
    this.awareness.destroy();
    this.ydoc.destroy();

    console.log('[YjsSync] Document destroyed');
  }

  private lightenColor(hex: string, factor: number): string {
    // Convert hex to RGB, lighten, convert back
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const lighten = (c: number) => Math.round(c + (255 - c) * factor);

    const lr = lighten(r).toString(16).padStart(2, '0');
    const lg = lighten(g).toString(16).padStart(2, '0');
    const lb = lighten(b).toString(16).padStart(2, '0');

    return `#${lr}${lg}${lb}`;
  }
}

/**
 * Interface for Yjs providers (WebSocket, WebRTC, etc.)
 */
export interface YjsProvider {
  /** Connect provider to a Y.Doc */
  connect(ydoc: Y.Doc, awareness: Awareness): void;

  /** Disconnect and clean up */
  disconnect(): void;

  /** Check if currently connected to server */
  readonly isConnected: boolean;

  /** Check if initial sync is complete */
  isSynced(): boolean;

  /** Wait for initial sync */
  whenSynced(): Promise<void>;
}

/**
 * Create a Yjs sync setup for the editor
 */
export function createYjsSync(config: YjsSyncConfig): YjsDocManager {
  return new YjsDocManager(config);
}

/**
 * Annotation types for Yjs transactions
 */
export const YJS_ORIGINS = {
  /** Local user edit */
  LOCAL: 'local',
  /** Remote user edit (via Yjs sync) */
  REMOTE: 'remote',
  /** External file change (AI, etc.) */
  EXTERNAL: 'external',
  /** Initialization */
  INIT: 'init',
  /** Output block update */
  OUTPUT: 'output',
} as const;

export type YjsOrigin = (typeof YJS_ORIGINS)[keyof typeof YJS_ORIGINS];

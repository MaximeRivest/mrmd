/**
 * External Change Handler
 *
 * Handles changes to files made outside the editor:
 * - AI/LLM edits via external processes
 * - Direct file modifications
 * - Git operations
 *
 * Uses file watching (watchdog on backend) to detect changes,
 * then applies them to the Yjs document so all collaborators see them.
 */

import type { YjsDocManager } from './yjs-sync';
import type { CollabClientAdapter, CollabEvents } from './types';

/**
 * Configuration for external change handling
 */
export interface ExternalChangeConfig {
  /** Yjs document manager */
  docManager: YjsDocManager;
  /** Collaboration adapter (for file watching) */
  adapter: CollabClientAdapter;
  /** File path being edited */
  filePath: string;
  /** How to handle conflicts between local and external changes */
  conflictStrategy: 'external-wins' | 'local-wins' | 'prompt';
  /** Called when external change detected */
  onExternalChange?: (info: ExternalChangeInfo) => void;
  /** Called when conflict detected (if strategy is 'prompt') */
  onConflict?: (info: ConflictInfo) => Promise<'accept' | 'reject' | 'merge'>;
  /** Function to load file content */
  loadFile: (path: string) => Promise<string>;
}

/**
 * Information about an external change
 */
export interface ExternalChangeInfo {
  filePath: string;
  eventType: 'modified' | 'created' | 'deleted';
  source: 'ai' | 'git' | 'unknown';
  timestamp: number;
}

/**
 * Information about a conflict
 */
export interface ConflictInfo {
  filePath: string;
  localContent: string;
  externalContent: string;
  diff: DiffRegion[];
}

/**
 * A region that differs between local and external
 */
export interface DiffRegion {
  startLine: number;
  endLine: number;
  localLines: string[];
  externalLines: string[];
}

/**
 * Handles external file changes and applies them to Yjs
 */
export class ExternalChangeHandler {
  private config: ExternalChangeConfig;
  private lastKnownContent: string = '';
  private lastKnownMtime: number = 0;
  private pendingCheck: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: ExternalChangeConfig) {
    this.config = config;

    // Store initial content
    this.lastKnownContent = config.docManager.getContent();

    // Listen for file change events from the adapter
    this.setupFileWatcher();
  }

  private setupFileWatcher(): void {
    const handler = (event: CollabEvents['fileChanged']) => {
      if (event.filePath === this.config.filePath) {
        this.handleFileChanged(event);
      }
    };

    this.config.adapter.on('fileChanged', handler);

    // Store for cleanup
    (this as any)._fileChangedHandler = handler;
  }

  private async handleFileChanged(event: CollabEvents['fileChanged']): Promise<void> {
    if (this.destroyed) return;

    console.log('[ExternalChanges] File changed:', event.eventType, event.filePath);

    // Debounce rapid changes
    if (this.pendingCheck) {
      clearTimeout(this.pendingCheck);
    }

    this.pendingCheck = setTimeout(async () => {
      this.pendingCheck = null;
      await this.checkAndApplyChanges(event);
    }, 100);
  }

  private async checkAndApplyChanges(event: CollabEvents['fileChanged']): Promise<void> {
    if (event.eventType === 'deleted') {
      // File was deleted - notify but don't try to load
      this.config.onExternalChange?.({
        filePath: event.filePath,
        eventType: 'deleted',
        source: this.guessSource(),
        timestamp: event.mtime,
      });
      return;
    }

    try {
      // Load the new file content
      const newContent = await this.config.loadFile(event.filePath);
      const currentContent = this.config.docManager.getContent();

      // Check if content actually changed
      if (newContent === currentContent) {
        console.log('[ExternalChanges] Content unchanged, ignoring');
        return;
      }

      // Check if this is a conflict (local changes + external changes)
      const hasLocalChanges = currentContent !== this.lastKnownContent;

      if (hasLocalChanges && this.config.conflictStrategy === 'prompt') {
        // Ask user how to handle conflict
        const decision = await this.handleConflict(currentContent, newContent);

        switch (decision) {
          case 'accept':
            this.applyExternalContent(newContent, event);
            break;
          case 'reject':
            console.log('[ExternalChanges] User rejected external changes');
            break;
          case 'merge':
            // For now, external wins on conflict regions
            // Could implement smarter merge later
            this.applyExternalContent(newContent, event);
            break;
        }
      } else if (this.config.conflictStrategy === 'external-wins' || !hasLocalChanges) {
        // Apply external changes
        this.applyExternalContent(newContent, event);
      } else {
        // local-wins: keep current content, ignore external
        console.log('[ExternalChanges] Local wins, ignoring external change');
      }

      // Update last known state
      this.lastKnownContent = this.config.docManager.getContent();
      this.lastKnownMtime = event.mtime;

    } catch (error) {
      console.error('[ExternalChanges] Failed to handle file change:', error);
    }
  }

  private applyExternalContent(
    newContent: string,
    event: CollabEvents['fileChanged']
  ): void {
    console.log('[ExternalChanges] Applying external content');

    // Apply to Yjs document with 'external' origin
    this.config.docManager.applyExternalChange(newContent, 'external');

    // Notify listeners
    this.config.onExternalChange?.({
      filePath: event.filePath,
      eventType: event.eventType,
      source: this.guessSource(),
      timestamp: event.mtime,
    });
  }

  private async handleConflict(
    localContent: string,
    externalContent: string
  ): Promise<'accept' | 'reject' | 'merge'> {
    if (!this.config.onConflict) {
      // No handler, default to accept external
      return 'accept';
    }

    const diff = this.computeDiff(localContent, externalContent);

    return this.config.onConflict({
      filePath: this.config.filePath,
      localContent,
      externalContent,
      diff,
    });
  }

  private computeDiff(local: string, external: string): DiffRegion[] {
    // Simple line-based diff
    const localLines = local.split('\n');
    const externalLines = external.split('\n');
    const regions: DiffRegion[] = [];

    let i = 0;
    let j = 0;

    while (i < localLines.length || j < externalLines.length) {
      // Find next difference
      while (
        i < localLines.length &&
        j < externalLines.length &&
        localLines[i] === externalLines[j]
      ) {
        i++;
        j++;
      }

      if (i >= localLines.length && j >= externalLines.length) {
        break;
      }

      // Found a difference - find extent
      const startLine = i;
      const diffLocalLines: string[] = [];
      const diffExternalLines: string[] = [];

      // Collect differing lines (simple approach)
      while (
        i < localLines.length &&
        j < externalLines.length &&
        localLines[i] !== externalLines[j]
      ) {
        diffLocalLines.push(localLines[i]);
        diffExternalLines.push(externalLines[j]);
        i++;
        j++;
      }

      // Handle unequal length
      while (i < localLines.length && (j >= externalLines.length || localLines[i] !== externalLines[j])) {
        diffLocalLines.push(localLines[i]);
        i++;
      }
      while (j < externalLines.length && (i >= localLines.length || localLines[i] !== externalLines[j])) {
        diffExternalLines.push(externalLines[j]);
        j++;
      }

      if (diffLocalLines.length > 0 || diffExternalLines.length > 0) {
        regions.push({
          startLine,
          endLine: Math.max(startLine + diffLocalLines.length, startLine + diffExternalLines.length),
          localLines: diffLocalLines,
          externalLines: diffExternalLines,
        });
      }
    }

    return regions;
  }

  private guessSource(): 'ai' | 'git' | 'unknown' {
    // Could be smarter - check if AI process is running, check git status, etc.
    // For now, return unknown
    return 'unknown';
  }

  /**
   * Manually check for external changes (useful after AI operation)
   */
  async checkForChanges(): Promise<boolean> {
    try {
      const newContent = await this.config.loadFile(this.config.filePath);
      const currentContent = this.config.docManager.getContent();

      if (newContent !== currentContent) {
        this.applyExternalContent(newContent, {
          filePath: this.config.filePath,
          eventType: 'modified',
          mtime: Date.now(),
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('[ExternalChanges] Failed to check for changes:', error);
      return false;
    }
  }

  /**
   * Update the "last known" content (call after save)
   */
  markAsSaved(content: string): void {
    this.lastKnownContent = content;
    this.lastKnownMtime = Date.now();
  }

  destroy(): void {
    this.destroyed = true;

    if (this.pendingCheck) {
      clearTimeout(this.pendingCheck);
    }

    // Remove file change handler
    const handler = (this as any)._fileChangedHandler;
    if (handler) {
      this.config.adapter.off('fileChanged', handler);
    }
  }
}

/**
 * Create an external change handler
 */
export function createExternalChangeHandler(
  config: ExternalChangeConfig
): ExternalChangeHandler {
  return new ExternalChangeHandler(config);
}

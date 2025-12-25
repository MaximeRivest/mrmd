/**
 * Lock Extension for CodeMirror 6
 *
 * Provides:
 * - Visual decorations for locked blocks
 * - Gutter markers showing lock state
 * - Edit guard to prevent edits to hard-locked blocks
 * - Cursor tracking for soft/hard lock transitions
 */

import {
  EditorState,
  StateField,
  StateEffect,
  Extension,
  Transaction,
  RangeSetBuilder,
  Facet,
} from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
  GutterMarker,
  gutter,
} from '@codemirror/view';
import { Lock, LockEvent } from './types';
import { LockManager } from './lock-manager';
import { parseBlocks, Block, BlockMap } from '../blocks';

// ============================================
// State Effects
// ============================================

export const updateLocksEffect = StateEffect.define<Map<string, Lock>>();
export const updateBlocksEffect = StateEffect.define<BlockMap>();

/**
 * Effect to trigger edit denied feedback
 */
export const editDeniedEffect = StateEffect.define<{
  blockId: string;
  holder: Lock['owner'];
  lineFrom: number;
  lineTo: number;
}>();

/**
 * Effect to clear edit denied feedback
 */
export const clearEditDeniedEffect = StateEffect.define<void>();

// ============================================
// Facet for Lock Manager
// ============================================

export const lockManagerFacet = Facet.define<LockManager, LockManager | null>({
  combine: values => values[0] || null,
});

// ============================================
// State Field: Locks
// ============================================

export interface LockFieldState {
  locks: Map<string, Lock>;
  blocks: BlockMap;
}

export const lockField = StateField.define<LockFieldState>({
  create(state) {
    return {
      locks: new Map(),
      blocks: parseBlocks(state),
    };
  },

  update(value, tr) {
    let { locks, blocks } = value;
    let changed = false;

    // Update blocks if document changed
    if (tr.docChanged) {
      blocks = parseBlocks(tr.state);

      // Map lock positions through the changes and update blockIds
      if (locks.size > 0) {
        const newLocks = new Map<string, Lock>();

        for (const [oldBlockId, lock] of locks) {
          // Map the anchor position through the change
          const newPos = tr.changes.mapPos(lock.anchorPos, 1); // 1 = assoc right (stay with content)

          // Find the block at the new position
          const newLine = tr.state.doc.lineAt(Math.min(newPos, tr.state.doc.length));
          const newBlock = blocks.byLine.get(newLine.number);

          if (newBlock) {
            // Update the lock with new blockId and position
            const updatedLock: Lock = {
              ...lock,
              blockId: newBlock.id,
              anchorPos: newBlock.startPos,
            };
            newLocks.set(newBlock.id, updatedLock);
          }
          // If no block found, the lock is orphaned and will be dropped
        }

        locks = newLocks;
        changed = true;
      }
    }

    // Apply lock updates from effects
    for (const effect of tr.effects) {
      if (effect.is(updateLocksEffect)) {
        locks = effect.value;
        changed = true;
      }
      if (effect.is(updateBlocksEffect)) {
        blocks = effect.value;
        changed = true;
      }
    }

    return changed ? { locks, blocks } : value;
  },
});

// ============================================
// Decorations Plugin
// ============================================

class LockDecorations {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.transactions.some(tr =>
        tr.effects.some(e => e.is(updateLocksEffect) || e.is(updateBlocksEffect))
      )
    ) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const state = view.state;
    const { locks, blocks } = state.field(lockField);
    const manager = state.facet(lockManagerFacet);
    const currentUserId = manager?.currentUser.userId;

    // Create decorations for each block with a lock
    for (const block of blocks.blocks) {
      const lock = locks.get(block.id);
      if (!lock) continue;

      const isOwn = lock.owner.userId === currentUserId;
      const isHard = lock.state === 'hard';
      const isAiOrExec = lock.owner.type === 'ai' || lock.owner.type === 'execution';

      // Line decoration for the block
      for (let lineNum = block.startLine; lineNum <= block.endLine; lineNum++) {
        const line = state.doc.line(lineNum);

        // Build class names
        const classes = ['cm-locked-line'];
        if (isOwn) classes.push('cm-locked-own');
        else classes.push('cm-locked-other');
        if (isHard) classes.push('cm-locked-hard');
        else classes.push('cm-locked-soft');
        if (isAiOrExec) classes.push('cm-locked-operation');

        // Add CSS variable for user color
        const style = `--lock-color: ${lock.owner.userColor}`;

        builder.add(
          line.from,
          line.from,
          Decoration.line({
            class: classes.join(' '),
            attributes: { style },
          })
        );
      }
    }

    return builder.finish();
  }
}

const lockDecorationsPlugin = ViewPlugin.fromClass(LockDecorations, {
  decorations: v => v.decorations,
});

// ============================================
// Gutter Marker
// ============================================

class LockGutterMarker extends GutterMarker {
  constructor(
    readonly lock: Lock,
    readonly isOwn: boolean
  ) {
    super();
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-lock-gutter-marker';

    // Icon based on lock type
    let icon: string;
    if (this.lock.owner.type === 'ai') {
      icon = '🤖';
    } else if (this.lock.owner.type === 'execution') {
      icon = '⚡';
    } else if (this.lock.state === 'hard') {
      icon = '🔒';
    } else {
      icon = '○'; // Soft lock - just presence
    }

    el.textContent = icon;
    el.style.setProperty('--lock-color', this.lock.owner.userColor);
    el.title = this.getTooltip();

    return el;
  }

  getTooltip(): string {
    const { owner, state } = this.lock;
    const action = owner.type === 'ai'
      ? owner.operation || 'AI working'
      : owner.type === 'execution'
        ? owner.operation || 'Running code'
        : state === 'hard'
          ? 'editing'
          : 'viewing';
    return `${owner.userName} is ${action}`;
  }
}

const lockGutter = gutter({
  class: 'cm-lock-gutter',
  lineMarker: (view, line) => {
    const { locks, blocks } = view.state.field(lockField);
    const manager = view.state.facet(lockManagerFacet);
    const currentUserId = manager?.currentUser.userId;

    const lineNum = view.state.doc.lineAt(line.from).number;
    const block = blocks.byLine.get(lineNum);
    if (!block) return null;

    const lock = locks.get(block.id);
    if (!lock) return null;

    // Only show marker on first line of block
    if (lineNum !== block.startLine) return null;

    const isOwn = lock.owner.userId === currentUserId;
    return new LockGutterMarker(lock, isOwn);
  },
});

// ============================================
// Edit Guard
// ============================================

/**
 * Find if any change affects a hard-locked block owned by someone else
 */
function findBlockingLock(
  tr: Transaction,
  locks: Map<string, Lock>,
  blocks: BlockMap,
  currentUserId: string
): Lock | null {
  const state = tr.startState;
  let blocker: Lock | null = null;

  tr.changes.iterChanges((fromA, toA) => {
    if (blocker) return;

    // Find blocks affected by this change
    const startLine = state.doc.lineAt(fromA).number;
    const endLine = state.doc.lineAt(Math.min(toA, state.doc.length)).number;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const block = blocks.byLine.get(lineNum);
      if (!block) continue;

      const lock = locks.get(block.id);
      if (lock && lock.owner.userId !== currentUserId && lock.state === 'hard') {
        blocker = lock;
        return;
      }
    }
  });

  return blocker;
}

/**
 * Transaction filter that prevents edits to hard-locked blocks
 */
const editGuard = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged) return tr;

  const state = tr.startState;
  const { locks, blocks } = state.field(lockField);
  const manager = state.facet(lockManagerFacet);

  if (!manager) return tr;

  const currentUserId = manager.currentUser.userId;
  const blockedBy = findBlockingLock(tr, locks, blocks, currentUserId);

  if (blockedBy) {
    // Find the block to show feedback
    const block = blocks.byId.get(blockedBy.blockId);

    // Emit lock-denied event to manager
    manager.transition({
      type: 'KEYSTROKE',
      userId: currentUserId,
      blockId: blockedBy.blockId,
    });

    // Return a transaction that only has the denied effect (no doc changes)
    // This triggers the visual feedback
    if (block) {
      return {
        effects: editDeniedEffect.of({
          blockId: blockedBy.blockId,
          holder: blockedBy.owner,
          lineFrom: block.startLine,
          lineTo: block.endLine,
        }),
      };
    }

    // Cancel the transaction
    return [];
  }

  return tr;
});

// ============================================
// Cursor Tracking
// ============================================

const cursorTracker = ViewPlugin.fromClass(
  class {
    private lastBlockId: string | null = null;

    constructor(private view: EditorView) {
      this.updateCursorBlock();
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) {
        this.updateCursorBlock();
      }
    }

    updateCursorBlock() {
      const state = this.view.state;
      const manager = state.facet(lockManagerFacet);
      if (!manager) return;

      const { blocks } = state.field(lockField);
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      const block = blocks.byLine.get(line.number);
      const blockId = block?.id || null;

      if (blockId !== this.lastBlockId) {
        // Cursor moved to different block
        if (this.lastBlockId) {
          manager.transition({
            type: 'CURSOR_LEAVE',
            userId: manager.currentUser.userId,
            blockId: this.lastBlockId,
          });
        }
        if (block && blockId) {
          manager.transition({
            type: 'CURSOR_ENTER',
            userId: manager.currentUser.userId,
            blockId,
            anchorPos: block.startPos,
          });
        }
        this.lastBlockId = blockId;
      }
    }

    destroy() {
      // Release lock on destroy
      const manager = this.view.state.facet(lockManagerFacet);
      if (manager && this.lastBlockId) {
        manager.transition({
          type: 'CURSOR_LEAVE',
          userId: manager.currentUser.userId,
          blockId: this.lastBlockId,
        });
      }
    }
  }
);

// ============================================
// Keystroke Tracker
// ============================================

const keystrokeTracker = EditorView.updateListener.of(update => {
  if (!update.docChanged) return;

  const manager = update.state.facet(lockManagerFacet);
  if (!manager) return;

  const { blocks } = update.state.field(lockField);

  // Find which blocks were affected by this change
  update.changes.iterChanges((fromA, toA) => {
    const startLine = update.startState.doc.lineAt(fromA).number;
    const endLine = update.startState.doc.lineAt(Math.min(toA, update.startState.doc.length)).number;

    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const block = blocks.byLine.get(lineNum);
      if (block) {
        manager.transition({
          type: 'KEYSTROKE',
          userId: manager.currentUser.userId,
          blockId: block.id,
          anchorPos: block.startPos,
        });
        break; // Only need to notify once per change
      }
    }
  });
});

// ============================================
// Edit Denied Feedback Plugin
// ============================================

class EditDeniedTooltip extends WidgetType {
  constructor(readonly holder: Lock['owner']) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-lock-denied-tooltip';
    el.style.setProperty('--lock-color', this.holder.userColor);

    const icon = this.holder.type === 'ai' ? '🤖' :
                 this.holder.type === 'execution' ? '⚡' : '🔒';
    const action = this.holder.type === 'ai' ? 'AI is working' :
                   this.holder.type === 'execution' ? 'Code running' : 'editing';

    el.innerHTML = `
      <span class="cm-lock-denied-icon">${icon}</span>
      <span class="cm-lock-denied-text">
        <strong style="color: ${this.holder.userColor}">${this.holder.userName}</strong>
        is ${action}
      </span>
    `;

    // Auto-hide after animation
    setTimeout(() => {
      el.classList.add('cm-lock-denied-hiding');
    }, 2000);

    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Plugin that shows visual feedback when edit is denied
 */
const editDeniedFeedback = ViewPlugin.fromClass(
  class {
    private timeout: ReturnType<typeof setTimeout> | null = null;
    decorations: DecorationSet;

    constructor(_view: EditorView) {
      this.decorations = Decoration.none;
    }

    update(update: ViewUpdate) {
      // Check for edit denied effects
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(editDeniedEffect)) {
            this.showFeedback(update.view, effect.value);
          }
          if (effect.is(clearEditDeniedEffect)) {
            this.decorations = Decoration.none;
          }
        }
      }
    }

    showFeedback(
      view: EditorView,
      info: { blockId: string; holder: Lock['owner']; lineFrom: number; lineTo: number }
    ) {
      const { holder, lineFrom, lineTo } = info;
      const doc = view.state.doc;

      // Collect all decorations first, then sort by position
      const decorations: { from: number; to: number; value: Decoration }[] = [];

      // Line decorations for shake effect
      for (let lineNum = lineFrom; lineNum <= lineTo; lineNum++) {
        if (lineNum > doc.lines) break;
        const line = doc.line(lineNum);

        decorations.push({
          from: line.from,
          to: line.from,
          value: Decoration.line({
            class: 'cm-lock-denied-shake',
            attributes: { style: `--lock-color: ${holder.userColor}` },
          }),
        });
      }

      // Tooltip widget at start of block
      if (lineFrom <= doc.lines) {
        const firstLine = doc.line(lineFrom);
        decorations.push({
          from: firstLine.from,
          to: firstLine.from,
          value: Decoration.widget({
            widget: new EditDeniedTooltip(holder),
            side: -1, // Before the line
          }),
        });
      }

      // Sort by position, then by side (widgets with side -1 come first)
      decorations.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        // Widget decorations with side -1 should come before line decorations
        const aSide = a.value.spec.side ?? 0;
        const bSide = b.value.spec.side ?? 0;
        return aSide - bSide;
      });

      // Build the decoration set
      const builder = new RangeSetBuilder<Decoration>();
      for (const d of decorations) {
        builder.add(d.from, d.to, d.value);
      }

      this.decorations = builder.finish();

      // Clear after animation completes using proper effect
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = setTimeout(() => {
        view.dispatch({
          effects: clearEditDeniedEffect.of(undefined),
        });
      }, 2500);
    }

    destroy() {
      if (this.timeout) clearTimeout(this.timeout);
    }
  },
  {
    decorations: v => v.decorations,
  }
);

// ============================================
// CSS Theme
// ============================================

const lockTheme = EditorView.baseTheme({
  // Lock gutter
  '.cm-lock-gutter': {
    width: '20px',
    minWidth: '20px',
  },
  '.cm-lock-gutter-marker': {
    fontSize: '12px',
    lineHeight: '1.4em',
    textAlign: 'center',
    opacity: '0.8',
  },

  // Locked lines - soft lock (presence only)
  '.cm-locked-line.cm-locked-soft': {
    position: 'relative',
    backgroundColor: 'color-mix(in srgb, var(--lock-color) 8%, transparent)',
    borderLeft: '2px solid color-mix(in srgb, var(--lock-color) 50%, transparent)',
    marginLeft: '-2px',
    paddingLeft: '2px',
  },

  // Locked lines - hard lock
  '.cm-locked-line.cm-locked-hard': {
    position: 'relative',
    backgroundColor: 'color-mix(in srgb, var(--lock-color) 15%, transparent)',
    borderLeft: '3px solid var(--lock-color)',
    marginLeft: '-3px',
    paddingLeft: '3px',
  },
  '.cm-locked-line.cm-locked-hard.cm-locked-other': {
    backgroundColor: 'color-mix(in srgb, var(--lock-color) 20%, transparent)',
  },

  // Operation locks (AI, execution) - striped pattern
  '.cm-locked-line.cm-locked-operation': {
    backgroundImage: `repeating-linear-gradient(
      -45deg,
      var(--lock-color),
      var(--lock-color) 2px,
      transparent 2px,
      transparent 6px
    )`,
    backgroundSize: '8px 8px',
    opacity: '0.9',
  },

  // Edit denied shake animation
  '.cm-lock-denied-shake': {
    animation: 'cm-lock-shake 0.4s ease-in-out',
    backgroundColor: 'color-mix(in srgb, var(--lock-color) 30%, transparent) !important',
  },

  '@keyframes cm-lock-shake': {
    '0%, 100%': { transform: 'translateX(0)' },
    '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
    '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
  },

  // Edit denied tooltip
  '.cm-lock-denied-tooltip': {
    position: 'absolute',
    top: '0',
    left: '50%',
    transform: 'translateX(-50%) translateY(-100%)',
    backgroundColor: 'var(--lock-color)',
    color: 'white',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
    zIndex: '100',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    animation: 'cm-lock-tooltip-in 0.2s ease-out',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },

  '.cm-lock-denied-tooltip.cm-lock-denied-hiding': {
    animation: 'cm-lock-tooltip-out 0.3s ease-in forwards',
  },

  '.cm-lock-denied-icon': {
    fontSize: '14px',
  },

  '@keyframes cm-lock-tooltip-in': {
    '0%': { opacity: '0', transform: 'translateX(-50%) translateY(-80%)' },
    '100%': { opacity: '1', transform: 'translateX(-50%) translateY(-100%)' },
  },

  '@keyframes cm-lock-tooltip-out': {
    '0%': { opacity: '1', transform: 'translateX(-50%) translateY(-100%)' },
    '100%': { opacity: '0', transform: 'translateX(-50%) translateY(-120%)' },
  },
});

// ============================================
// Lock Manager Bridge Plugin
// ============================================

/**
 * Plugin that bridges the LockManager to the editor state.
 * When locks change in the manager, it dispatches effects to update decorations.
 */
const lockManagerBridge = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    private unsubscribe: (() => void) | null = null;

    constructor(view: EditorView) {
      this.view = view;
      const manager = view.state.facet(lockManagerFacet);

      if (manager) {
        // Subscribe to lock state changes
        const originalOnStateChange = manager.config.onStateChange;
        manager.config.onStateChange = (locks) => {
          // Defer dispatch to avoid "update during update" error
          // This happens because onStateChange is called from cursor tracking
          // which runs during an update cycle
          queueMicrotask(() => {
            this.view.dispatch({
              effects: updateLocksEffect.of(locks),
            });
          });

          // Call original handler if exists
          if (originalOnStateChange) {
            originalOnStateChange(locks);
          }
        };

        // Store cleanup function
        this.unsubscribe = () => {
          manager.config.onStateChange = originalOnStateChange || undefined;
        };

        // Initialize with current locks
        const currentLocks = manager.getLocks();
        if (currentLocks.size > 0) {
          this.view.dispatch({
            effects: updateLocksEffect.of(currentLocks),
          });
        }
      }
    }

    update() {
      // Nothing needed on update - we're event-driven
    }

    destroy() {
      if (this.unsubscribe) {
        this.unsubscribe();
      }
    }
  }
);

// ============================================
// Main Extension
// ============================================

export interface LockExtensionConfig {
  manager: LockManager;
}

/**
 * Create the lock extension for CodeMirror
 */
export function lockExtension(config: LockExtensionConfig): Extension {
  const { manager } = config;

  return [
    lockManagerFacet.of(manager),
    lockField,
    lockDecorationsPlugin,
    lockManagerBridge,  // Bridge that connects manager to editor state
    lockGutter,
    editGuard,
    editDeniedFeedback,  // Visual feedback when edit is denied
    cursorTracker,
    keystrokeTracker,
    lockTheme,
  ];
}

/**
 * Update locks in the editor state
 */
export function updateLocks(view: EditorView, locks: Map<string, Lock>): void {
  view.dispatch({
    effects: updateLocksEffect.of(locks),
  });
}

/**
 * Get current locks from editor state
 */
export function getLocks(state: EditorState): Map<string, Lock> {
  return state.field(lockField).locks;
}

/**
 * Get block map from editor state
 */
export function getBlocks(state: EditorState): BlockMap {
  return state.field(lockField).blocks;
}

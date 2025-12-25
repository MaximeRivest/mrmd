import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
} from '@codemirror/state';
import type { Extension } from '@codemirror/state';

import type { CollabClientAdapter, RemoteCursor, Presence } from './types';

/**
 * Effect to update remote cursors
 */
const updateCursorsEffect = StateEffect.define<RemoteCursor>();
const removeCursorEffect = StateEffect.define<string>(); // sessionId

/**
 * State field to track remote cursors
 */
const remoteCursorsField = StateField.define<Map<string, RemoteCursor>>({
  create: () => new Map(),

  update(cursors, tr) {
    let changed = false;
    let newCursors = cursors;

    for (const effect of tr.effects) {
      if (effect.is(updateCursorsEffect)) {
        if (!changed) {
          newCursors = new Map(cursors);
          changed = true;
        }
        newCursors.set(effect.value.sessionId, effect.value);
      } else if (effect.is(removeCursorEffect)) {
        if (!changed) {
          newCursors = new Map(cursors);
          changed = true;
        }
        newCursors.delete(effect.value);
      }
    }

    // Clean up stale cursors (older than 30 seconds)
    const now = Date.now();
    const staleThreshold = 30000;

    for (const [sessionId, cursor] of newCursors) {
      if (now - cursor.lastUpdate > staleThreshold) {
        if (!changed) {
          newCursors = new Map(cursors);
          changed = true;
        }
        newCursors.delete(sessionId);
      }
    }

    return newCursors;
  },
});

/**
 * Widget for remote cursor caret
 */
class CursorWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly userName: string
  ) {
    super();
  }

  eq(other: CursorWidget): boolean {
    return other.color === this.color && other.userName === this.userName;
  }

  toDOM(): HTMLElement {
    const cursor = document.createElement('span');
    cursor.className = 'cm-remote-cursor';
    cursor.style.cssText = `
      border-left: 2px solid ${this.color};
      margin-left: -1px;
      position: relative;
    `;

    // Name label that appears above cursor
    const label = document.createElement('span');
    label.className = 'cm-remote-cursor-label';
    label.textContent = this.userName;
    label.style.cssText = `
      position: absolute;
      bottom: 100%;
      left: -1px;
      background: ${this.color};
      color: white;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px 3px 3px 0;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
    `;

    cursor.appendChild(label);

    // Show label on hover
    cursor.addEventListener('mouseenter', () => {
      label.style.opacity = '1';
    });
    cursor.addEventListener('mouseleave', () => {
      label.style.opacity = '0';
    });

    // Brief flash of label when cursor moves
    setTimeout(() => {
      label.style.opacity = '1';
      setTimeout(() => {
        label.style.opacity = '0';
      }, 1500);
    }, 0);

    return cursor;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Plugin that renders remote cursors and selections
 */
const remoteCursorsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild if cursors changed or document changed
      if (
        update.docChanged ||
        update.transactions.some(tr =>
          tr.effects.some(e => e.is(updateCursorsEffect) || e.is(removeCursorEffect))
        )
      ) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const cursors = view.state.field(remoteCursorsField);
      const builder = new RangeSetBuilder<Decoration>();

      // Collect all decorations with positions
      const decorations: { from: number; to: number; decoration: Decoration }[] = [];

      for (const cursor of cursors.values()) {
        const docLength = view.state.doc.length;

        // Clamp positions to document bounds
        const offset = Math.min(Math.max(0, cursor.offset), docLength);

        // Cursor caret
        decorations.push({
          from: offset,
          to: offset,
          decoration: Decoration.widget({
            widget: new CursorWidget(cursor.color, cursor.userName),
            side: 1,
          }),
        });

        // Selection highlight
        if (cursor.selection) {
          const anchor = Math.min(Math.max(0, cursor.selection.anchor), docLength);
          const head = Math.min(Math.max(0, cursor.selection.head), docLength);
          const from = Math.min(anchor, head);
          const to = Math.max(anchor, head);

          if (from < to) {
            decorations.push({
              from,
              to,
              decoration: Decoration.mark({
                class: 'cm-remote-selection',
                attributes: {
                  style: `background-color: ${cursor.color}33;`, // 20% opacity
                },
              }),
            });
          }
        }
      }

      // Sort by position for RangeSetBuilder
      decorations.sort((a, b) => a.from - b.from || a.to - b.to);

      for (const { from, to, decoration } of decorations) {
        builder.add(from, to, decoration);
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * CSS styles for remote cursors
 */
const presenceStyles = EditorView.baseTheme({
  '.cm-remote-cursor': {
    position: 'relative',
    borderLeft: '2px solid',
    marginLeft: '-1px',
  },
  '.cm-remote-cursor-label': {
    position: 'absolute',
    bottom: '100%',
    left: '-1px',
    color: 'white',
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: '3px 3px 3px 0',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  '.cm-remote-selection': {
    // Background color set inline based on user color
  },
});

/**
 * Create presence extension that shows remote cursors
 */
export function createPresenceExtension(adapter: CollabClientAdapter): Extension {
  // Plugin to listen for cursor updates from adapter
  const listenerPlugin = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      // Store bound handlers so we can properly remove them
      private boundHandleCursor: (cursor: RemoteCursor) => void;
      private boundHandleUserLeft: (data: { sessionId: string }) => void;
      private boundHandlePresence: (presence: Presence) => void;

      constructor(view: EditorView) {
        this.view = view;

        // Create bound handlers once
        this.boundHandleCursor = this.handleCursor.bind(this);
        this.boundHandleUserLeft = this.handleUserLeft.bind(this);
        this.boundHandlePresence = this.handlePresence.bind(this);

        // Register handlers
        console.log('[Presence] Registering event handlers on adapter');
        adapter.on('cursor', this.boundHandleCursor);
        adapter.on('userLeft', this.boundHandleUserLeft);
        adapter.on('presence', this.boundHandlePresence);
      }

      handleCursor(cursor: RemoteCursor) {
        console.log('[Presence] Received cursor:', cursor.userName, cursor.offset);
        this.view.dispatch({
          effects: updateCursorsEffect.of(cursor),
        });
      }

      handleUserLeft(data: { sessionId: string }) {
        console.log('[Presence] User left:', data.sessionId);
        this.view.dispatch({
          effects: removeCursorEffect.of(data.sessionId),
        });
      }

      handlePresence(presence: Presence) {
        console.log('[Presence] Presence update:', presence.users.length, 'users');
        // Remove cursors for users no longer present
        const cursors = this.view.state.field(remoteCursorsField);
        const presentSessionIds = new Set(presence.users.map(u => u.sessionId));

        const effects: StateEffect<string>[] = [];
        for (const sessionId of cursors.keys()) {
          if (!presentSessionIds.has(sessionId)) {
            effects.push(removeCursorEffect.of(sessionId));
          }
        }

        if (effects.length > 0) {
          this.view.dispatch({ effects });
        }
      }

      destroy() {
        console.log('[Presence] Removing event handlers');
        adapter.off('cursor', this.boundHandleCursor);
        adapter.off('userLeft', this.boundHandleUserLeft);
        adapter.off('presence', this.boundHandlePresence);
      }

      update() {}
    }
  );

  return [
    remoteCursorsField,
    remoteCursorsPlugin,
    listenerPlugin,
    presenceStyles,
  ];
}

/**
 * Get current remote cursors from editor state
 */
export function getRemoteCursors(view: EditorView): Map<string, RemoteCursor> {
  return view.state.field(remoteCursorsField);
}

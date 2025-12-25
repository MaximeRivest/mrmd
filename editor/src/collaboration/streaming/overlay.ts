/**
 * Streaming Overlay
 *
 * Provides ephemeral visual content for AI/code output that's not yet
 * committed to the document. This content:
 * - Is visible to all users (via awareness broadcast)
 * - Does NOT go into undo history
 * - Is NOT part of the Yjs document during streaming
 * - Gets committed as a single transaction when complete
 */

import {
  EditorState,
  StateField,
  StateEffect,
  Extension,
  RangeSetBuilder,
} from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  WidgetType,
} from '@codemirror/view';

// ============================================
// Types
// ============================================

export type StreamType = 'ai' | 'execution' | 'external';

export interface StreamingOverlay {
  id: string;
  type: StreamType;
  // Where in the document this overlay appears
  anchorPos: number;          // Position in document to anchor overlay
  anchorType: 'after' | 'replace'; // After position or replace range
  replaceFrom?: number;       // If replace, start of range
  replaceTo?: number;         // If replace, end of range
  // Content
  content: string;            // Accumulated stream content
  status: 'streaming' | 'complete' | 'error';
  // Metadata
  owner: {
    userId: string;
    userName: string;
    userColor: string;
  };
  operation?: string;         // "Refactoring function" etc.
  startedAt: number;
  lastChunkAt: number;
  error?: string;
}

export interface StreamingState {
  overlays: Map<string, StreamingOverlay>;
}

// ============================================
// State Effects
// ============================================

export const startStreamEffect = StateEffect.define<{
  id: string;
  type: StreamType;
  anchorPos: number;
  anchorType: 'after' | 'replace';
  replaceFrom?: number;
  replaceTo?: number;
  owner: StreamingOverlay['owner'];
  operation?: string;
}>();

export const streamChunkEffect = StateEffect.define<{
  id: string;
  chunk: string;
  replace?: boolean; // Replace content instead of append
}>();

export const completeStreamEffect = StateEffect.define<{
  id: string;
  finalContent?: string; // Optional final content (if different from accumulated)
}>();

export const errorStreamEffect = StateEffect.define<{
  id: string;
  error: string;
}>();

export const cancelStreamEffect = StateEffect.define<{
  id: string;
}>();

export const applyRemoteStreamsEffect = StateEffect.define<StreamingOverlay[]>();

// ============================================
// State Field
// ============================================

export const streamingField = StateField.define<StreamingState>({
  create() {
    return { overlays: new Map() };
  },

  update(state, tr) {
    let overlays = state.overlays;
    let changed = false;

    for (const effect of tr.effects) {
      if (effect.is(startStreamEffect)) {
        const { id, type, anchorPos, anchorType, replaceFrom, replaceTo, owner, operation } = effect.value;
        const now = Date.now();
        overlays = new Map(overlays);
        overlays.set(id, {
          id,
          type,
          anchorPos,
          anchorType,
          replaceFrom,
          replaceTo,
          content: '',
          status: 'streaming',
          owner,
          operation,
          startedAt: now,
          lastChunkAt: now,
        });
        changed = true;
      }

      if (effect.is(streamChunkEffect)) {
        const { id, chunk, replace } = effect.value;
        const overlay = overlays.get(id);
        if (overlay && overlay.status === 'streaming') {
          overlays = new Map(overlays);
          overlays.set(id, {
            ...overlay,
            content: replace ? chunk : overlay.content + chunk,
            lastChunkAt: Date.now(),
          });
          changed = true;
        }
      }

      if (effect.is(completeStreamEffect)) {
        const { id, finalContent } = effect.value;
        const overlay = overlays.get(id);
        if (overlay) {
          overlays = new Map(overlays);
          overlays.set(id, {
            ...overlay,
            content: finalContent ?? overlay.content,
            status: 'complete',
          });
          changed = true;
        }
      }

      if (effect.is(errorStreamEffect)) {
        const { id, error } = effect.value;
        const overlay = overlays.get(id);
        if (overlay) {
          overlays = new Map(overlays);
          overlays.set(id, {
            ...overlay,
            status: 'error',
            error,
          });
          changed = true;
        }
      }

      if (effect.is(cancelStreamEffect)) {
        const { id } = effect.value;
        if (overlays.has(id)) {
          overlays = new Map(overlays);
          overlays.delete(id);
          changed = true;
        }
      }

      if (effect.is(applyRemoteStreamsEffect)) {
        const remoteOverlays = effect.value;
        overlays = new Map(overlays);
        // Remove overlays not in remote (except our own)
        for (const [id, overlay] of overlays) {
          // Keep local streams, remove stale remote ones
          const isRemote = !remoteOverlays.find(ro => ro.id === id);
          if (isRemote) {
            // Check if this is a remote overlay that's no longer present
            // For now, keep all local overlays
          }
        }
        // Add/update remote overlays
        for (const remote of remoteOverlays) {
          overlays.set(remote.id, remote);
        }
        changed = true;
      }
    }

    // Map positions through document changes
    if (tr.docChanged && overlays.size > 0) {
      overlays = new Map(overlays);
      for (const [id, overlay] of overlays) {
        const newAnchor = tr.changes.mapPos(overlay.anchorPos);
        const newReplaceFrom = overlay.replaceFrom !== undefined
          ? tr.changes.mapPos(overlay.replaceFrom)
          : undefined;
        const newReplaceTo = overlay.replaceTo !== undefined
          ? tr.changes.mapPos(overlay.replaceTo)
          : undefined;

        if (newAnchor !== overlay.anchorPos ||
            newReplaceFrom !== overlay.replaceFrom ||
            newReplaceTo !== overlay.replaceTo) {
          overlays.set(id, {
            ...overlay,
            anchorPos: newAnchor,
            replaceFrom: newReplaceFrom,
            replaceTo: newReplaceTo,
          });
          changed = true;
        }
      }
    }

    return changed ? { overlays } : state;
  },
});

// ============================================
// Streaming Widget
// ============================================

class StreamingWidget extends WidgetType {
  constructor(readonly overlay: StreamingOverlay) {
    super();
  }

  eq(other: StreamingWidget): boolean {
    return (
      other.overlay.id === this.overlay.id &&
      other.overlay.content === this.overlay.content &&
      other.overlay.status === this.overlay.status
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = `cm-streaming-overlay cm-streaming-${this.overlay.type} cm-streaming-${this.overlay.status}`;
    container.style.setProperty('--stream-color', this.overlay.owner.userColor);

    // Header
    const header = document.createElement('div');
    header.className = 'cm-streaming-header';

    const icon = this.overlay.type === 'ai' ? '🤖' : this.overlay.type === 'execution' ? '⚡' : '📝';
    const statusText = this.overlay.status === 'streaming'
      ? this.overlay.operation || 'Working...'
      : this.overlay.status === 'complete'
        ? 'Complete'
        : `Error: ${this.overlay.error}`;

    header.innerHTML = `
      <span class="cm-streaming-icon">${icon}</span>
      <span class="cm-streaming-user" style="color: ${this.overlay.owner.userColor}">${this.overlay.owner.userName}</span>
      <span class="cm-streaming-status">${statusText}</span>
    `;
    container.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'cm-streaming-content';

    if (this.overlay.type === 'ai' || this.overlay.type === 'external') {
      // Show as markdown/code preview
      content.innerHTML = `<pre>${escapeHtml(this.overlay.content)}</pre>`;
    } else {
      // Execution output
      content.innerHTML = `<pre class="cm-streaming-output">${escapeHtml(this.overlay.content)}</pre>`;
    }

    // Streaming cursor
    if (this.overlay.status === 'streaming') {
      const cursor = document.createElement('span');
      cursor.className = 'cm-streaming-cursor';
      cursor.textContent = '▋';
      content.querySelector('pre')?.appendChild(cursor);
    }

    container.appendChild(content);

    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// Decorations Plugin
// ============================================

class StreamingDecorations {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.transactions.some(tr =>
        tr.effects.some(e =>
          e.is(startStreamEffect) ||
          e.is(streamChunkEffect) ||
          e.is(completeStreamEffect) ||
          e.is(errorStreamEffect) ||
          e.is(cancelStreamEffect) ||
          e.is(applyRemoteStreamsEffect)
        )
      )
    ) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const { overlays } = view.state.field(streamingField);

    // Collect and sort by position
    const sorted = Array.from(overlays.values()).sort((a, b) => a.anchorPos - b.anchorPos);

    for (const overlay of sorted) {
      // Add widget after anchor position
      builder.add(
        overlay.anchorPos,
        overlay.anchorPos,
        Decoration.widget({
          widget: new StreamingWidget(overlay),
          side: 1, // After the position
          block: true,
        })
      );

      // If replacing, add background to the range being replaced
      if (overlay.anchorType === 'replace' && overlay.replaceFrom !== undefined && overlay.replaceTo !== undefined) {
        // Mark the range being replaced
        const from = Math.min(overlay.replaceFrom, view.state.doc.length);
        const to = Math.min(overlay.replaceTo, view.state.doc.length);

        if (from < to) {
          builder.add(
            from,
            to,
            Decoration.mark({
              class: 'cm-streaming-replace-range',
              attributes: {
                style: `--stream-color: ${overlay.owner.userColor}`,
              },
            })
          );
        }
      }
    }

    return builder.finish();
  }
}

const streamingDecorationsPlugin = ViewPlugin.fromClass(StreamingDecorations, {
  decorations: v => v.decorations,
});

// ============================================
// Theme
// ============================================

const streamingTheme = EditorView.baseTheme({
  '.cm-streaming-overlay': {
    margin: '0.5em 0',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid var(--stream-color)',
    backgroundColor: 'var(--surface, #f5f5f5)',
  },

  '.cm-streaming-header': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
    padding: '0.5em 1em',
    backgroundColor: 'var(--stream-color)',
    opacity: '0.9',
    color: 'white',
    fontSize: '0.85em',
  },

  '.cm-streaming-icon': {
    fontSize: '1.1em',
  },

  '.cm-streaming-user': {
    fontWeight: '600',
  },

  '.cm-streaming-status': {
    marginLeft: 'auto',
    opacity: '0.9',
  },

  '.cm-streaming-content': {
    padding: '1em',
    maxHeight: '300px',
    overflow: 'auto',
  },

  '.cm-streaming-content pre': {
    margin: '0',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: '0.9em',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },

  '.cm-streaming-output': {
    color: 'var(--text-muted, #666)',
  },

  '.cm-streaming-cursor': {
    animation: 'cm-streaming-blink 1s infinite',
    color: 'var(--stream-color)',
  },

  '@keyframes cm-streaming-blink': {
    '0%, 50%': { opacity: '1' },
    '51%, 100%': { opacity: '0' },
  },

  // Status variants
  '.cm-streaming-complete .cm-streaming-header': {
    backgroundColor: '#22c55e',
  },

  '.cm-streaming-error .cm-streaming-header': {
    backgroundColor: '#ef4444',
  },

  // Range being replaced
  '.cm-streaming-replace-range': {
    backgroundColor: 'var(--stream-color)',
    opacity: '0.1',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--stream-color)',
  },
});

// ============================================
// Extension
// ============================================

export function streamingOverlayExtension(): Extension {
  return [
    streamingField,
    streamingDecorationsPlugin,
    streamingTheme,
  ];
}

// ============================================
// API Functions
// ============================================

/**
 * Start a new streaming overlay
 */
export function startStream(
  view: EditorView,
  options: {
    id: string;
    type: StreamType;
    anchorPos: number;
    anchorType?: 'after' | 'replace';
    replaceFrom?: number;
    replaceTo?: number;
    owner: StreamingOverlay['owner'];
    operation?: string;
  }
): void {
  view.dispatch({
    effects: startStreamEffect.of({
      id: options.id,
      type: options.type,
      anchorPos: options.anchorPos,
      anchorType: options.anchorType || 'after',
      replaceFrom: options.replaceFrom,
      replaceTo: options.replaceTo,
      owner: options.owner,
      operation: options.operation,
    }),
  });
}

/**
 * Append a chunk to an active stream
 */
export function streamChunk(
  view: EditorView,
  id: string,
  chunk: string,
  replace = false
): void {
  view.dispatch({
    effects: streamChunkEffect.of({ id, chunk, replace }),
  });
}

/**
 * Mark a stream as complete
 */
export function completeStream(
  view: EditorView,
  id: string,
  finalContent?: string
): void {
  view.dispatch({
    effects: completeStreamEffect.of({ id, finalContent }),
  });
}

/**
 * Mark a stream as errored
 */
export function errorStream(
  view: EditorView,
  id: string,
  error: string
): void {
  view.dispatch({
    effects: errorStreamEffect.of({ id, error }),
  });
}

/**
 * Cancel/remove a stream
 */
export function cancelStream(view: EditorView, id: string): void {
  view.dispatch({
    effects: cancelStreamEffect.of({ id }),
  });
}

/**
 * Apply remote streams from awareness
 */
export function applyRemoteStreams(view: EditorView, overlays: StreamingOverlay[]): void {
  view.dispatch({
    effects: applyRemoteStreamsEffect.of(overlays),
  });
}

/**
 * Get active streams
 */
export function getStreams(state: EditorState): Map<string, StreamingOverlay> {
  return state.field(streamingField).overlays;
}

/**
 * Get a specific stream
 */
export function getStream(state: EditorState, id: string): StreamingOverlay | undefined {
  return state.field(streamingField).overlays.get(id);
}

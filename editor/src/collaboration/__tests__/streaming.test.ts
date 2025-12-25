/**
 * Streaming Overlay Tests
 *
 * Tests for the ephemeral streaming overlay system.
 * These tests focus on state management, not DOM rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import {
  streamingField,
  startStreamEffect,
  streamChunkEffect,
  completeStreamEffect,
  errorStreamEffect,
  cancelStreamEffect,
} from '../streaming/overlay';
import type { StreamingOverlay } from '../streaming/overlay';

describe('Streaming State', () => {
  let state: EditorState;

  const initialDoc = `# Test Document

This is a paragraph.

\`\`\`python
print("hello")
\`\`\`

Another paragraph.`;

  beforeEach(() => {
    state = EditorState.create({
      doc: initialDoc,
      extensions: [
        markdown(),
        streamingField,
      ],
    });
  });

  describe('startStreamEffect', () => {
    it('should create a streaming overlay', () => {
      const tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
          operation: 'Generating code',
        }),
      });

      const newState = tr.state;
      const streams = newState.field(streamingField);
      expect(streams.overlays.size).toBe(1);

      const stream = streams.overlays.get('stream-1');
      expect(stream).toBeDefined();
      expect(stream!.type).toBe('ai');
      expect(stream!.status).toBe('streaming');
      expect(stream!.content).toBe('');
      expect(stream!.operation).toBe('Generating code');
    });

    it('should support replace mode', () => {
      const tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 20,
          anchorType: 'replace',
          replaceFrom: 20,
          replaceTo: 40,
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.anchorType).toBe('replace');
      expect(stream!.replaceFrom).toBe(20);
      expect(stream!.replaceTo).toBe(40);
    });
  });

  describe('streamChunkEffect', () => {
    it('should append content to stream', () => {
      // Start stream
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'execution',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      // Append chunks
      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Hello ' }),
      });
      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'World!' }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.content).toBe('Hello World!');
    });

    it('should replace content when replace=true', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'execution',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Initial' }),
      });
      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Replaced', replace: true }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.content).toBe('Replaced');
    });

    it('should not append to completed stream', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'execution',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Hello' }),
      });
      tr = tr.state.update({
        effects: completeStreamEffect.of({ id: 'stream-1' }),
      });
      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: ' World' }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.content).toBe('Hello');
    });
  });

  describe('completeStreamEffect', () => {
    it('should mark stream as complete', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Generated content' }),
      });
      tr = tr.state.update({
        effects: completeStreamEffect.of({ id: 'stream-1' }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.status).toBe('complete');
    });

    it('should allow final content override', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-1', chunk: 'Partial' }),
      });
      tr = tr.state.update({
        effects: completeStreamEffect.of({ id: 'stream-1', finalContent: 'Final complete content' }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.content).toBe('Final complete content');
    });
  });

  describe('errorStreamEffect', () => {
    it('should mark stream as error with message', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'execution',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      tr = tr.state.update({
        effects: errorStreamEffect.of({ id: 'stream-1', error: 'Connection timeout' }),
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.status).toBe('error');
      expect(stream!.error).toBe('Connection timeout');
    });
  });

  describe('cancelStreamEffect', () => {
    it('should remove stream entirely', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      expect(tr.state.field(streamingField).overlays.size).toBe(1);

      tr = tr.state.update({
        effects: cancelStreamEffect.of({ id: 'stream-1' }),
      });

      expect(tr.state.field(streamingField).overlays.size).toBe(0);
    });
  });

  describe('position mapping', () => {
    it('should map anchor position through document changes', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 50,
          anchorType: 'after',
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      // Insert text before the anchor
      tr = tr.state.update({
        changes: { from: 0, insert: 'INSERTED ' },
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.anchorPos).toBe(50 + 'INSERTED '.length);
    });

    it('should map replace range through document changes', () => {
      let tr = state.update({
        effects: startStreamEffect.of({
          id: 'stream-1',
          type: 'ai',
          anchorPos: 20,
          anchorType: 'replace',
          replaceFrom: 20,
          replaceTo: 40,
          owner: {
            userId: 'alice',
            userName: 'Alice',
            userColor: '#3b82f6',
          },
        }),
      });

      // Insert text before the range
      tr = tr.state.update({
        changes: { from: 0, insert: '12345' },
      });

      const stream = tr.state.field(streamingField).overlays.get('stream-1');
      expect(stream!.replaceFrom).toBe(25);
      expect(stream!.replaceTo).toBe(45);
    });
  });

  describe('multiple streams', () => {
    it('should support multiple concurrent streams', () => {
      let tr = state.update({
        effects: [
          startStreamEffect.of({
            id: 'stream-alice',
            type: 'ai',
            anchorPos: 50,
            anchorType: 'after',
            owner: {
              userId: 'alice',
              userName: 'Alice',
              userColor: '#3b82f6',
            },
          }),
          startStreamEffect.of({
            id: 'stream-bob',
            type: 'execution',
            anchorPos: 100,
            anchorType: 'after',
            owner: {
              userId: 'bob',
              userName: 'Bob',
              userColor: '#ef4444',
            },
          }),
        ],
      });

      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-alice', chunk: 'Alice content' }),
      });
      tr = tr.state.update({
        effects: streamChunkEffect.of({ id: 'stream-bob', chunk: 'Bob output' }),
      });

      const streams = tr.state.field(streamingField).overlays;
      expect(streams.size).toBe(2);
      expect(streams.get('stream-alice')!.content).toBe('Alice content');
      expect(streams.get('stream-bob')!.content).toBe('Bob output');
    });
  });
});

/**
 * Collaboration Integration Tests
 *
 * End-to-end tests simulating real multi-user collaboration scenarios.
 * These tests verify that all components work together correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

import {
  LockManager,
  createLockManager,
  lockExtension,
  DEFAULT_TIMEOUT_CONFIG,
} from '../locks';
import { streamingOverlayExtension } from '../streaming';
import { YjsAwarenessAdapter, createYjsAwarenessAdapter } from '../yjs-awareness';
import { AwarenessSyncManager, createAwarenessSync, MockAwarenessProvider } from '../streaming/awareness-sync';
import { parseBlocks, getBlockAtPos } from '../blocks';

/**
 * Helper to create a test editor with all collaboration extensions
 */
interface TestEditor {
  view: EditorView;
  lockManager: LockManager;
  container: HTMLElement;
  destroy: () => void;
}

function createTestEditor(options: {
  doc: string;
  userId: string;
  userName: string;
  userColor: string;
}): TestEditor {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const lockManager = createLockManager({
    userId: options.userId,
    userName: options.userName,
    userColor: options.userColor,
    timeouts: DEFAULT_TIMEOUT_CONFIG,
  });

  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      markdown(),
      streamingOverlayExtension(),
      lockExtension({ manager: lockManager }),
    ],
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  return {
    view,
    lockManager,
    container,
    destroy: () => {
      view.destroy();
      lockManager.destroy();
      container.remove();
    },
  };
}

describe('Two-User Collaboration', () => {
  let alice: TestEditor;
  let bob: TestEditor;

  const initialDoc = `# Shared Document

This is paragraph one.

This is paragraph two.

\`\`\`python
print("hello")
\`\`\`

Final paragraph.`;

  beforeEach(() => {
    alice = createTestEditor({
      doc: initialDoc,
      userId: 'alice',
      userName: 'Alice',
      userColor: '#3b82f6',
    });

    bob = createTestEditor({
      doc: initialDoc,
      userId: 'bob',
      userName: 'Bob',
      userColor: '#ef4444',
    });
  });

  afterEach(() => {
    alice.destroy();
    bob.destroy();
  });

  describe('Lock Conflicts', () => {
    it('Alice edits a block, Bob is denied access to same block', () => {
      // Parse blocks to find paragraph positions
      const blocks = parseBlocks(alice.view.state);
      const paragraph1 = blocks.blocks.find(b => b.type === 'paragraph' && b.startLine === 3);
      expect(paragraph1).toBeDefined();

      // Alice acquires lock on paragraph 1
      const aliceResult = alice.lockManager.acquireLock({
        blockId: paragraph1!.id,
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: paragraph1!.startPos,
      });
      expect(aliceResult.success).toBe(true);

      // Alice starts typing (upgrades to hard lock)
      alice.lockManager.transition({
        type: 'KEYSTROKE',
        userId: 'alice',
        blockId: paragraph1!.id,
      });

      // Simulate sharing lock state with Bob
      const aliceLocks = Array.from(alice.lockManager.getLocks().values());
      bob.lockManager.applyRemoteLocks(aliceLocks);

      // Bob tries to edit same block
      const bobResult = bob.lockManager.acquireLock({
        blockId: paragraph1!.id,
        userId: 'bob',
        userName: 'Bob',
        userColor: '#ef4444',
        type: 'human',
        anchorPos: paragraph1!.startPos,
      });

      expect(bobResult.success).toBe(false);
      expect(bobResult.reason).toBe('already-locked');
      expect(bobResult.currentHolder?.userId).toBe('alice');
    });

    it('Alice and Bob can edit different blocks simultaneously', () => {
      const aliceBlocks = parseBlocks(alice.view.state);
      const paragraph1 = aliceBlocks.blocks.find(b => b.type === 'paragraph' && b.startLine === 3);
      const paragraph2 = aliceBlocks.blocks.find(b => b.type === 'paragraph' && b.startLine === 5);

      expect(paragraph1).toBeDefined();
      expect(paragraph2).toBeDefined();
      expect(paragraph1!.id).not.toBe(paragraph2!.id);

      // Alice takes paragraph 1
      const aliceResult = alice.lockManager.acquireLock({
        blockId: paragraph1!.id,
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: paragraph1!.startPos,
      });

      // Share locks
      bob.lockManager.applyRemoteLocks(Array.from(alice.lockManager.getLocks().values()));

      // Bob takes paragraph 2
      const bobResult = bob.lockManager.acquireLock({
        blockId: paragraph2!.id,
        userId: 'bob',
        userName: 'Bob',
        userColor: '#ef4444',
        type: 'human',
        anchorPos: paragraph2!.startPos,
      });

      expect(aliceResult.success).toBe(true);
      expect(bobResult.success).toBe(true);

      // Both have their locks
      expect(alice.lockManager.getLock(paragraph1!.id)).toBeDefined();
      expect(bob.lockManager.getLock(paragraph2!.id)).toBeDefined();
    });

    it('Lock is released when Alice leaves the block', () => {
      const blocks = parseBlocks(alice.view.state);
      const paragraph1 = blocks.blocks.find(b => b.type === 'paragraph');

      alice.lockManager.acquireLock({
        blockId: paragraph1!.id,
        userId: 'alice',
        userName: 'Alice',
        userColor: '#3b82f6',
        type: 'human',
        anchorPos: paragraph1!.startPos,
      });

      expect(alice.lockManager.getLock(paragraph1!.id)).toBeDefined();

      // Alice leaves the block
      alice.lockManager.transition({
        type: 'CURSOR_LEAVE',
        userId: 'alice',
        blockId: paragraph1!.id,
      });

      expect(alice.lockManager.getLock(paragraph1!.id)).toBeNull();

      // Now Bob can acquire it
      const bobResult = bob.lockManager.acquireLock({
        blockId: paragraph1!.id,
        userId: 'bob',
        userName: 'Bob',
        userColor: '#ef4444',
        type: 'human',
        anchorPos: paragraph1!.startPos,
      });

      expect(bobResult.success).toBe(true);
    });
  });

  describe('AI Streaming with Locks', () => {
    it('AI operation locks block and prevents other edits', () => {
      const blocks = parseBlocks(alice.view.state);
      const codeBlock = blocks.blocks.find(b => b.type === 'code');
      expect(codeBlock).toBeDefined();

      // Start AI operation (automatically acquires hard lock)
      alice.lockManager.transition({
        type: 'AI_START',
        userId: 'alice',
        blockId: codeBlock!.id,
        operation: 'Refactoring code',
      });

      const lock = alice.lockManager.getLock(codeBlock!.id);
      expect(lock).toBeDefined();
      expect(lock!.state).toBe('hard');
      expect(lock!.owner.type).toBe('ai');

      // Share with Bob
      bob.lockManager.applyRemoteLocks(Array.from(alice.lockManager.getLocks().values()));

      // Bob cannot edit
      const bobResult = bob.lockManager.acquireLock({
        blockId: codeBlock!.id,
        userId: 'bob',
        userName: 'Bob',
        userColor: '#ef4444',
        type: 'human',
        anchorPos: codeBlock!.startPos,
      });

      expect(bobResult.success).toBe(false);
      expect(bobResult.currentHolder?.type).toBe('ai');
    });

    // Note: Tests that use streamingOverlayExtension() with EditorView
    // cause "Block decorations may not be specified via plugins" in jsdom.
    // These are tested separately in streaming.test.ts using state-only tests.
    // Full E2E tests should run in a real browser environment.
  });
});

describe('Awareness Sync', () => {
  let ydoc: Y.Doc;
  let awareness: Awareness;
  let adapter: YjsAwarenessAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    ydoc = new Y.Doc();
    awareness = new Awareness(ydoc);
    adapter = createYjsAwarenessAdapter({
      awareness,
      userId: 'test-user',
      userName: 'Test User',
      userColor: '#3b82f6',
    });
  });

  afterEach(() => {
    adapter.destroy();
    awareness.destroy();
    ydoc.destroy();
    vi.useRealTimers();
  });

  it('should set and get local state', () => {
    const state = adapter.getLocalState();
    expect(state).toBeDefined();
    expect(state!.user.id).toBe('test-user');
    expect(state!.user.name).toBe('Test User');
    expect(state!.role).toBe('collaborator');
  });

  it('should update cursor position', () => {
    // Cursor updates are throttled, advance timer to flush
    adapter.setLocalStateField('cursor', { from: 10, to: 10 });
    vi.advanceTimersByTime(50);

    const state = adapter.getLocalState();
    expect(state!.cursor).toEqual({ from: 10, to: 10 });
  });

  it('should update selection', () => {
    // Selection updates are throttled
    adapter.setLocalStateField('selection', { from: 10, to: 20 });
    vi.advanceTimersByTime(50);

    const state = adapter.getLocalState();
    expect(state!.selection).toEqual({ from: 10, to: 20 });
  });

  it('should serialize and deserialize locks', () => {
    adapter.setLocalState({
      locks: [
        {
          id: 'lock-1',
          blockId: 'paragraph-L1',
          state: 'hard',
          owner: {
            userId: 'test-user',
            userName: 'Test User',
            userColor: '#3b82f6',
            type: 'human',
          },
          acquiredAt: Date.now(),
          lastActivityAt: Date.now(),
          anchorPos: 0,
        },
      ],
    });

    const state = adapter.getLocalState();
    expect(state!.locks).toHaveLength(1);
    expect(state!.locks[0].blockId).toBe('paragraph-L1');
    expect(state!.locks[0].state).toBe('hard');
  });

  it('should notify on changes', () => {
    const handler = vi.fn();
    adapter.on('change', handler);

    // Use setLocalState (not throttled) to trigger immediate change
    adapter.setLocalState({ role: 'presenter' });

    // Yjs awareness triggers change
    expect(handler).toHaveBeenCalled();

    adapter.off('change', handler);
  });

  it('should clear state on destroy', () => {
    adapter.destroy();

    // Local state should be null after destroy
    const rawState = awareness.getLocalState();
    expect(rawState).toBeNull();
  });
});

describe('Block Detection', () => {
  let view: EditorView;
  let container: HTMLElement;

  const doc = `# Heading

Paragraph with **bold** text.

- List item 1
- List item 2

\`\`\`python
code here
\`\`\`

\`\`\`output
output here
\`\`\`

> Blockquote text

| A | B |
|---|---|
| 1 | 2 |

---

Final text.`;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    const state = EditorState.create({
      doc,
      extensions: [markdown()],
    });

    view = new EditorView({
      state,
      parent: container,
    });
  });

  afterEach(() => {
    view.destroy();
    container.remove();
  });

  it('should detect all block types', () => {
    const blocks = parseBlocks(view.state);

    const types = blocks.blocks.map(b => b.type);

    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list');
    expect(types).toContain('code');
    expect(types).toContain('output');
    expect(types).toContain('blockquote');
    // Table detection depends on GFM extension
  });

  it('should link output block to code block', () => {
    const blocks = parseBlocks(view.state);

    const outputBlock = blocks.blocks.find(b => b.type === 'output');
    const codeBlock = blocks.blocks.find(b => b.type === 'code');

    expect(outputBlock).toBeDefined();
    expect(codeBlock).toBeDefined();
    expect(outputBlock!.metadata?.parentCodeId).toBe(codeBlock!.id);
  });

  it('should get block at position', () => {
    // Position in the heading
    const headingPos = 5;
    const block = getBlockAtPos(view.state, headingPos);

    expect(block).toBeDefined();
    expect(block!.type).toBe('heading');
  });

  it('should generate stable block IDs', () => {
    const blocks1 = parseBlocks(view.state);
    const blocks2 = parseBlocks(view.state);

    // Same document should produce same IDs
    expect(blocks1.blocks.map(b => b.id)).toEqual(blocks2.blocks.map(b => b.id));
  });
});

describe('Full Lock Workflow', () => {
  let editor: TestEditor;

  const doc = `# Document

\`\`\`python
x = 1
\`\`\`

Done.`;

  beforeEach(() => {
    editor = createTestEditor({
      doc,
      userId: 'alice',
      userName: 'Alice',
      userColor: '#3b82f6',
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it('should complete full AI lock workflow', () => {
    const blocks = parseBlocks(editor.view.state);
    const codeBlock = blocks.blocks.find(b => b.type === 'code')!;

    // 1. Acquire AI lock
    const lockResult = editor.lockManager.acquireLock({
      blockId: codeBlock.id,
      userId: 'alice',
      userName: 'Alice',
      userColor: '#3b82f6',
      type: 'ai',
      operation: 'Refactoring',
      anchorPos: codeBlock.startPos,
    });
    expect(lockResult.success).toBe(true);
    expect(lockResult.lock?.state).toBe('hard');
    expect(lockResult.lock?.owner.type).toBe('ai');

    // 2. Simulate AI activity
    editor.lockManager.transition({
      type: 'AI_CHUNK',
      userId: 'alice',
      blockId: codeBlock.id,
    });

    // 3. Lock still held
    expect(editor.lockManager.getLock(codeBlock.id)).not.toBeNull();

    // 4. Complete AI operation
    editor.lockManager.transition({
      type: 'AI_COMPLETE',
      userId: 'alice',
      blockId: codeBlock.id,
    });

    // 5. Lock released
    expect(editor.lockManager.getLock(codeBlock.id)).toBeNull();
  });

  // Note: Full streaming workflow tests with EditorView are skipped in jsdom
  // due to "Block decorations may not be specified via plugins" error.
  // The streaming state management is tested in streaming.test.ts
  // Full E2E tests should run in a real browser environment (Playwright/Cypress).
});

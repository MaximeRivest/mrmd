# Collaboration Architecture

## Philosophy

This is NOT Google Docs. We're building a **whiteboard**, not a free-for-all.

**Core beliefs:**
- One writer per region at a time (like passing a marker)
- Everyone sees everything in real-time
- Streaming (AI/code) is visual until committed
- Conflicts are prevented by UX, not resolved by algorithms
- We're all adults - no permission systems

## Quick Start

```typescript
import { createEditorBridge } from '/core/editor-bridge.js';

const editor = createEditorBridge({ parent: document.getElementById('editor') });

// Enable collaboration
await editor.initCollaborative({
  url: 'ws://localhost:8000/api/collab',
  roomId: '/path/to/file.md',
  userId: 'alice',
  userName: 'Alice',
});

// Everything works automatically:
// ✓ Document syncs between users
// ✓ Remote cursors visible
// ✓ Locks prevent conflicts
// ✓ External file changes sync via Yjs

// Broadcast execution output to other users
editor.broadcastOutput('block-0', 'Hello World\n', 'completed');

// File watching (uses same WebSocket as Yjs)
editor.watchDirectory('/project/path');
```

## The Four Layers

### 1. Committed Content (Yjs)
```
Y.Text('content') → The markdown source of truth
```
- CRDT-based, handles offline/reconnect
- Everything in undo/redo history
- Synced via WebSocket to all users
- **External file changes automatically update Yjs** (via server-side file watcher)

### 2. Ephemeral State (Awareness)
```
awareness.setLocalState({
  cursor, selection, scroll,
  locks: [...],      // What blocks I own
  streams: [...],    // AI/code output I'm generating
  outputs: [...],    // Execution results from my code blocks
  role: 'presenter' | 'viewer' | 'collaborator',
  following: 'user-xyz',
})
```
- NOT persisted
- Real-time broadcast to all users
- Handles presence, cursors, streaming visibility
- **Execution outputs are synced** so all users see results

### 3. Streaming Overlay (CM6 Extension)
```
Visual layer that shows AI/code output BEFORE it's committed
```
- NOT in the document during streaming
- NOT in undo history during streaming
- Committed as SINGLE undo step when complete
- All users see it via awareness broadcast

### 4. Output Sync (Execution Results)
```
When User A runs a code block, User B sees the output
```
- Synced via awareness (not Yjs) to avoid bloating CRDT
- Ephemeral - not persisted until file save
- Supports streaming updates during execution

## Lock System

### Why Locks?

We want the **whiteboard feel** - you can see everyone, but only one person writes in a spot at a time. No merge conflicts, no confusion.

### Lock Granularity: Structural Blocks

```
Document = [
  Block(heading, lines 1-1),
  Block(paragraph, lines 3-5),
  Block(code, lines 7-15),
  Block(output, lines 16-20),
  Block(paragraph, lines 22-24),
  ...
]
```

Why blocks, not lines or characters?
- **Lines**: Too fine-grained, editing a function = locking 20 lines manually
- **Characters**: CRDT handles this but feels chaotic
- **Blocks**: Natural units humans think in (paragraph, code block, list)

### Soft Lock vs Hard Lock

```
CURSOR ENTERS BLOCK        FIRST KEYSTROKE
        ↓                        ↓
   [SOFT LOCK]              [HARD LOCK]
   "Alice is here"          "Alice is editing"
   Others CAN edit          Others CANNOT edit
   (with warning)           (blocked)
```

Why two phases?
- **Soft lock**: Shows presence without blocking. "Oh, Alice is looking at that section."
- **Hard lock**: Only when actually typing. Prevents conflicts.

### Timeouts

| Context | Timeout | Why |
|---------|---------|-----|
| Human idle | 10s | Don't block others if AFK |
| AI no chunks | 30s | API might be stuck |
| Code no output | 60s | Long-running code is okay |
| Disconnect | Immediate | Obvious |

**Key insight for AI/code**: Timeout is since last chunk, not total time. If AI is streaming, it's alive. If it stops streaming for 30s, something's wrong.

## Streaming Architecture

### Why NOT Put Streaming in the Document?

1. **Undo history pollution**: User doesn't want to Ctrl+Z through 500 AI chunks
2. **Cursor chaos**: Document changing under you while AI writes
3. **Yjs overhead**: Every character = CRDT operation = sync overhead

### The Solution: Overlay

```
┌─────────────────────────────────────────┐
│ Real document (Yjs)                     │
│                                         │
│ def hello():                            │
│     print("hi")                         │
│                                         │
├─────────────────────────────────────────┤
│ STREAMING OVERLAY (ephemeral)           │
│ ┌─────────────────────────────────────┐ │
│ │ 🤖 Alice: Refactoring...            │ │
│ │ def hello():                        │ │
│ │     """Greets the user"""           │ │
│ │     print("hi")█                    │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ # Next section (real document)          │
└─────────────────────────────────────────┘
```

When streaming completes:
1. Clear overlay
2. Single Yjs transaction replaces target region
3. ONE undo step
4. Lock released

## Presenter/Viewer Mode

### The Use Case

Teacher demos to students. Team lead reviews with juniors. Pair programming.

One person "drives", others watch. Occasionally someone jumps in to show something.

### Implementation

```typescript
awareness.setLocalStateField('role', 'presenter');
awareness.setLocalStateField('role', 'viewer');
awareness.setLocalStateField('following', 'presenter-user-id');
```

Viewer mode:
- Auto-scrolls to follow presenter
- Can break away by scrolling manually
- Can "take control" (become collaborator) anytime
- No permissions - social norms handle this

## File Structure

```
collaboration/
├── index.ts               # Main exports
├── collaborative-editor.ts # Factory that wires everything together
├── blocks.ts              # Parse document into structural blocks
├── locks/
│   ├── types.ts           # Lock state machine, timeout config
│   ├── lock-manager.ts    # Acquires/releases locks, handles timeouts
│   └── lock-extension.ts  # CM6 decorations, gutter, edit guard
├── streaming/
│   ├── overlay.ts         # Ephemeral visual layer
│   ├── commit.ts          # Commit stream → single undo step
│   └── awareness-sync.ts  # Broadcast locks/streams/outputs to others
├── yjs-sync.ts            # Yjs document manager
├── yjs-provider.ts        # Generic WebSocket provider (y-websocket protocol)
├── mrmd-yjs-provider.ts   # MRMD-specific provider (JSON protocol + file watching)
├── yjs-awareness.ts       # Bridges Yjs awareness to our AwarenessProvider interface
├── output-sync.ts         # Execution output manager (uses awareness for sync)
└── types.ts               # Shared types
```

## Connection Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser                                  │
├─────────────────────────────────────────────────────────────┤
│  EditorBridge                                               │
│  └── CollaborativeEditor                                    │
│      ├── MrmdYjsProvider (single WebSocket)                 │
│      │   ├── Yjs sync (document changes)                    │
│      │   ├── Awareness (cursors, locks, outputs)            │
│      │   ├── File watching notifications                    │
│      │   └── Directory watching                             │
│      ├── LockManager                                        │
│      ├── AwarenessSyncManager                               │
│      └── OutputSyncManager                                  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Single WebSocket (/api/collab)
                           │ JSON protocol with base64 Yjs updates
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Python Server                            │
├─────────────────────────────────────────────────────────────┤
│  CollabHandler                                              │
│  ├── Session management                                     │
│  ├── YjsDocumentManager (pycrdt)                           │
│  │   ├── CRDT document state                               │
│  │   ├── Persistence to disk                               │
│  │   └── Apply file watcher changes → Yjs                  │
│  ├── Awareness broadcast                                    │
│  └── File watcher (watchdog)                               │
│      └── On change → update Yjs → broadcast to clients     │
└─────────────────────────────────────────────────────────────┘
```

**Key insight:** External file changes (e.g., from AI tools, git) are applied
to the Yjs document on the server, then broadcast to clients via normal Yjs
sync. This eliminates the need for separate `file_changed` message handling.

## Decisions We Made

### "Why not just use Yjs for everything?"

Yjs is great for text. But:
- Streaming output shouldn't pollute undo history
- Locks are coordination, not content
- Presence is ephemeral, not persisted

### "Why not CRDT merge conflicts instead of locks?"

CRDTs merge text but can't merge intent. If Alice refactors a function while Bob adds a feature to it, the merge is valid text but broken code.

Locks make you coordinate. That's the point.

### "Why structural blocks, not arbitrary regions?"

- Predictable: everyone knows what "this paragraph" means
- Visible: gutter shows lock status per block
- Matches mental model: "I'm working on the intro" not "I'm working on lines 3-7"

### "Why no permission system?"

We're building for teams that trust each other. If you're in the doc, you can edit. Social norms handle the rest.

If you need permissions, add them at the room/connection level (who can join), not the document level.

## Testing

```typescript
// Mock awareness for testing
const awareness = new MockAwarenessProvider();

// Add fake remote user
awareness.addRemoteUser({
  user: { id: 'bob', name: 'Bob', color: '#38bdf8' },
  cursor: { from: 100, to: 100 },
  locks: [{ blockId: 'paragraph-L5', state: 'hard', ... }],
  streams: [],
  role: 'collaborator',
});

// Now your editor shows Bob's cursor and lock
```

## Future Work

- [ ] Comments layer (always unlocked, parallel to document)
- [ ] Suggestion mode (proposed edits, not direct changes)
- [ ] Line-level history (git blame style)
- [ ] Conflict resolution UI (when locks fail)

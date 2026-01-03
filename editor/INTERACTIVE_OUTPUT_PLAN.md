# Interactive Output Widget Integration Plan

## Executive Summary

Replace static `OutputWidget` with a unified `ResponseWidget` that seamlessly handles both static output AND interactive input, using xterm.js for terminal emulation when needed.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Code Cell                                                   │
│   ```python                                                 │
│   %magic                                                    │
│   ```                                                       │
└─────────────────────────────────────────────────────────────┘
                         ↓ execute
┌─────────────────────────────────────────────────────────────┐
│ SSE Stream: /api/ipython/execute/stream                     │
│   → chunks (stdout/stderr with ANSI)                        │
│   → result (final output + display_data)                    │
│   ✗ NO stdin_request handling                               │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ ExecutionTracker                                            │
│   → TerminalBuffer (cursor movement)                        │
│   → replaceOutputContent() in document                      │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ OutputWidget (read-only)                                    │
│   → ansiToHtml() for colors                                 │
│   → Static DOM, no input                                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Limitations
1. No `input_request` handling from IPython kernel
2. No way to send stdin to running code
3. Pagers/interactive apps (less, %magic) don't work
4. Widget is purely display, no keyboard input

---

## Proposed Architecture: "The Response"

```
┌─────────────────────────────────────────────────────────────┐
│ Code Cell                                                   │
└─────────────────────────────────────────────────────────────┘
                         ↓ execute
┌─────────────────────────────────────────────────────────────┐
│ Enhanced SSE Stream                                         │
│   → chunks (stdout/stderr)                                  │
│   → stdin_request (prompt, password mode)          NEW      │
│   → result (final output)                                   │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ ExecutionTracker (enhanced)                                 │
│   → Detects stdin_request                          NEW      │
│   → Manages ResponseWidget lifecycle               NEW      │
│   → Routes input back to kernel                    NEW      │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ ResponseWidget (unified)                           NEW      │
│                                                             │
│   Mode 1: Static (no stdin)                                 │
│   ├── Renders like current OutputWidget                     │
│   ├── Fast, lightweight, no xterm overhead                  │
│   └── Pure HTML with ANSI colors                            │
│                                                             │
│   Mode 2: Interactive (stdin requested)                     │
│   ├── Embedded xterm.js instance                            │
│   ├── Keyboard input captured                               │
│   ├── stdin sent to kernel                                  │
│   └── Seamless visual transition                            │
│                                                             │
│   Mode 3: Full Terminal (pager detected)                    │
│   ├── Full xterm with scroll, search                        │
│   ├── 'q' to quit, navigation keys work                     │
│   └── Returns to static after pager exits                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Backend stdin Support (Server-side)

**Files to modify:**
- `src/mrmd/server/handlers.py` - Add stdin_request to SSE stream
- `src/mrmd/server/ipython_subprocess.py` - Expose input_request messages

**Changes:**

```python
# handlers.py - Enhanced stream endpoint
async def execute_stream_handler(request):
    async def stream_generator():
        # Existing chunk/result handling...

        # NEW: Handle stdin requests from kernel
        async for msg in session.iterate_messages():
            if msg['msg_type'] == 'input_request':
                yield f"event: stdin_request\n"
                yield f"data: {json.dumps({
                    'prompt': msg['content']['prompt'],
                    'password': msg['content'].get('password', False)
                })}\n\n"
```

```python
# ipython_subprocess.py - Add send_input method
def send_input(self, text: str):
    """Send user input to kernel stdin"""
    self._send_message({
        "method": "send_input",
        "params": {"text": text}
    })
```

**Deliverable:** SSE endpoint emits `stdin_request` events, kernel accepts input

---

### Phase 2: Frontend stdin Wiring

**Files to modify:**
- `frontend/core/ipython-client.js` - Add stdin handling to EventSource
- `editor/src/execution/ipython.ts` - Add sendInput() to IPythonExecutor
- `editor/src/execution/tracker.ts` - Handle stdin_request in execution flow

**Changes:**

```typescript
// ipython-client.js
class IPythonClient {
  async executeStreaming(code, onChunk, onStdinRequest) {
    source.addEventListener('stdin_request', (e) => {
      const data = JSON.parse(e.data);
      onStdinRequest(data.prompt, data.password);
    });
  }

  async sendInput(sessionId, execId, text) {
    return fetch(`/api/ipython/input`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, exec_id: execId, text })
    });
  }
}
```

```typescript
// tracker.ts
async processQueuedExecution(entry) {
  await this.executor.executeStreaming(code, {
    onChunk: (chunk, accumulated, done) => { /* existing */ },
    onStdinRequest: (prompt, password) => {
      // Emit event for ResponseWidget to handle
      this.emit('stdin-request', { execId, prompt, password });
    }
  });
}
```

**Deliverable:** Frontend receives stdin_request, can send input back

---

### Phase 3: ResponseWidget Implementation

**Files to create:**
- `editor/src/widgets/response.ts` - New unified widget

**Architecture:**

```typescript
interface ResponseWidgetConfig {
  execId: string;
  content: string;
  hidden: boolean;
  onSendInput?: (text: string) => void;  // Callback for stdin
}

type ResponseMode = 'static' | 'interactive' | 'terminal';

class ResponseWidget extends WidgetType {
  private mode: ResponseMode = 'static';
  private xterm?: Terminal;
  private staticContent?: HTMLElement;

  constructor(config: ResponseWidgetConfig) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-response';

    // Start in static mode (fast, lightweight)
    this.renderStatic(container);

    return container;
  }

  // Called when new output arrives
  appendOutput(content: string) {
    if (this.mode === 'static') {
      this.updateStaticContent(content);
    } else {
      this.xterm?.write(content);
    }
  }

  // Called when stdin is requested
  requestInput(prompt: string, password: boolean) {
    if (this.mode === 'static') {
      this.upgradeToInteractive();
    }

    // Show prompt, enable input
    this.xterm?.write(prompt);
    this.xterm?.focus();
    this.setupInputHandler(password);
  }

  // Seamless upgrade from static to interactive
  private upgradeToInteractive() {
    // Capture current static content
    const currentContent = this.staticContent?.textContent || '';

    // Create xterm
    this.xterm = new Terminal({
      cursorBlink: true,
      cursorInactiveStyle: 'none',
      disableStdin: false,
      theme: this.getTheme(),
      // Match static styling
      fontFamily: 'inherit',
      fontSize: 14,
    });

    // Write existing content
    this.xterm.write(currentContent);

    // Replace static content with xterm
    this.container.innerHTML = '';
    this.xterm.open(this.container);

    this.mode = 'interactive';
  }

  // Handle user input
  private setupInputHandler(password: boolean) {
    let inputBuffer = '';

    this.xterm?.onData((data) => {
      if (data === '\r') {
        // Enter pressed - send input
        this.config.onSendInput?.(inputBuffer + '\n');
        inputBuffer = '';
        this.xterm?.write('\r\n');
      } else if (data === '\x7f') {
        // Backspace
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          this.xterm?.write('\b \b');
        }
      } else {
        inputBuffer += data;
        // Echo (unless password mode)
        this.xterm?.write(password ? '*' : data);
      }
    });
  }

  // Detect pager mode (less, more, %magic)
  private detectPagerMode(content: string): boolean {
    // Pagers typically use alternate screen buffer
    return content.includes('\x1b[?1049h') ||  // Enter alternate screen
           content.includes('\x1b[?47h');       // Old-style alternate
  }
}
```

**Deliverable:** Widget that starts static, upgrades to xterm when input needed

---

### Phase 4: Visual Polish (Jobs/Ive standard)

**CSS for seamless transitions:**

```css
.cm-response {
  /* Invisible container - content defines appearance */
  position: absolute;
  left: 0;
  right: 0;
  z-index: 1;
}

/* Static mode - beautiful typography */
.cm-response.static .cm-response-content {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.9em;
  line-height: 1.5;
  padding: 8px 12px;
  background: var(--code-bg);
  border-radius: 4px;
  color: var(--text);
}

/* Interactive mode - xterm seamlessly takes over */
.cm-response.interactive {
  /* No visual change - xterm styled to match */
}

.cm-response .xterm-viewport {
  background: var(--code-bg) !important;
}

.cm-response .xterm-screen {
  padding: 8px 12px;
}

/* Cursor only visible when input expected */
.cm-response:not(.expecting-input) .xterm-cursor {
  display: none !important;
}

/* Subtle indicator that input is possible */
.cm-response.expecting-input::after {
  content: '';
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}
```

---

### Phase 5: Integration with Existing System

**Modify decorations.ts:**

```typescript
// Instead of OutputWidget, use ResponseWidget
if (isOutput) {
  const widget = new ResponseWidget({
    execId,
    content,
    hidden: cursorInBlock,
    onSendInput: (text) => {
      // Route through execution tracker
      trackerRef.current?.sendInput(execId, text);
    }
  });

  items.push({
    from: startLine.to,
    type: 'widget',
    widget,
  });
}
```

**Modify tracker.ts:**

```typescript
class ExecutionTracker {
  private responseWidgets = new Map<string, ResponseWidget>();

  // Register widget when created
  registerResponseWidget(execId: string, widget: ResponseWidget) {
    this.responseWidgets.set(execId, widget);
  }

  // Route stdin request to widget
  handleStdinRequest(execId: string, prompt: string, password: boolean) {
    const widget = this.responseWidgets.get(execId);
    widget?.requestInput(prompt, password);
  }

  // Route user input to kernel
  async sendInput(execId: string, text: string) {
    await this.executor.sendInput(execId, text);
  }
}
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| xterm.js bundle size (300KB) | Page load | Lazy load only when needed |
| Widget lifecycle complexity | Bugs, memory leaks | Clear state machine, cleanup |
| Flicker during mode switch | Poor UX | Pre-render xterm hidden, swap instantly |
| Theme mismatch | Visual inconsistency | Use CSS variables everywhere |
| CM6 keyboard conflicts | Input not captured | Use `ignoreEvent()` carefully |
| Cursor position sync | Wrong edit location | Update doc position on input |

---

## Success Criteria

1. **Simple output**: `print("hello")` renders identically to current system
2. **Input request**: `input("Name: ")` shows prompt, accepts typing, resumes
3. **Pagers**: `%magic` shows scrollable pager, 'q' exits cleanly
4. **No flicker**: Mode transitions are imperceptible
5. **Keyboard**: All keys work naturally when focused
6. **Theming**: Matches editor theme perfectly (light/dark)
7. **Performance**: <50ms upgrade from static to interactive

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/mrmd/server/handlers.py` | Modify | Add stdin_request to SSE |
| `src/mrmd/server/ipython_subprocess.py` | Modify | Add send_input method |
| `frontend/core/ipython-client.js` | Modify | Handle stdin events |
| `editor/src/widgets/response.ts` | **NEW** | Unified response widget |
| `editor/src/widgets/output.ts` | Deprecate | Replaced by response.ts |
| `editor/src/execution/tracker.ts` | Modify | stdin routing |
| `editor/src/execution/ipython.ts` | Modify | sendInput method |
| `editor/src/markdown/decorations.ts` | Modify | Use ResponseWidget |
| `editor/src/themes/zen.ts` | Modify | Response widget styles |

---

## Implementation Order

1. **Backend first** - stdin_request in SSE, send_input endpoint
2. **Client wiring** - IPythonClient.sendInput(), tracker integration
3. **ResponseWidget** - Static mode only (drop-in replacement)
4. **Interactive mode** - xterm upgrade path
5. **Visual polish** - Seamless transitions, cursor behavior
6. **Edge cases** - Pagers, password mode, cancellation

---

## Open Questions

1. **Widget identity**: When content changes, does CM6 recreate widget?
   - Need stable `eq()` that doesn't cause flicker

2. **Document sync**: When user types input, should it appear in markdown?
   - Probably no - input is ephemeral, only output persists

3. **Reconnection**: What if page reloads during input request?
   - Execution is lost, show "execution interrupted"

4. **Multiple inputs**: Can a cell request input multiple times?
   - Yes, need to handle sequential stdin_requests

5. **Cancellation**: What if user cancels during input?
   - Send EOF/interrupt to kernel, cleanup widget state

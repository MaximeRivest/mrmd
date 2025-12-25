# mrmd API Reference

> **For Frontend Developers**: This document describes the backend API and shared utilities.
> All output formatting, ANSI stripping, and progress handling is done **server-side**.
> Clients should be thin and just display what they receive.

## Quick Start

```typescript
// Execute Python code
const response = await fetch('http://localhost:8765/api/ipython/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: 'print("Hello")',
    session: 'my-document-id'
  })
});

const result = await response.json();
// Use result.formatted_output - it's clean and ready to display!
console.log(result.formatted_output);
```

## Core Principle

**The server does all the heavy lifting:**
- ANSI escape code stripping
- Traceback cleaning
- Progress bar handling (`\r` carriage returns)
- Output formatting (images, HTML, plain text)

**Clients just display `formatted_output`.**

---

## Endpoints

### Execute Code

#### `POST /api/ipython/execute`

Execute Python code and get results.

**Request:**
```json
{
  "code": "print('hello')\n1 + 1",
  "session": "document-id",
  "store_history": true
}
```

**Response:**
```json
{
  "session_id": "document-id",
  "success": true,
  "execution_count": 5,
  "stdout": "hello\n",
  "stderr": "",
  "result": "2",
  "error": null,
  "display_data": [],
  "formatted_output": "hello\n2"
}
```

**Key Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `formatted_output` | `string` | **Use this!** Clean, ANSI-stripped, ready for display |
| `success` | `boolean` | Whether execution succeeded |
| `error` | `object\|null` | Error info if failed |
| `display_data` | `array` | Rich outputs (images, HTML) |

---

#### `POST /api/ipython/execute/stream`

Execute with streaming output (for progress bars, long-running code).

**Request:** Same as `/execute`

**Response:** Server-Sent Events (SSE)

```
event: chunk
data: {"type": "stdout", "content": "Processing...", "accumulated": "Processing..."}

event: chunk
data: {"type": "stdout", "content": "50%", "accumulated": "50%"}

event: result
data: {"session_id": "...", "formatted_output": "Done!", ...}

event: done
data: {}
```

**Chunk Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `type` | `"stdout"\|"stderr"` | Output stream |
| `content` | `string` | This chunk's content (ANSI stripped) |
| `accumulated` | `string` | **Use this!** Full output so far, with progress bar handling |

---

### Completions

#### `POST /api/ipython/complete`

Get code completions.

**Request:**
```json
{
  "code": "import nu",
  "cursor_pos": 9,
  "session": "document-id"
}
```

**Response:**
```json
{
  "session_id": "document-id",
  "matches": ["numpy", "numbers"],
  "cursor_start": 7,
  "cursor_end": 9,
  "metadata": {
    "types": ["module", "module"],
    "signatures": [null, null]
  }
}
```

---

### Inspection (Hover)

#### `POST /api/ipython/inspect`

Get documentation for hover tooltips.

**Request:**
```json
{
  "code": "len",
  "cursor_pos": 3,
  "session": "document-id"
}
```

**Response:**
```json
{
  "session_id": "document-id",
  "found": true,
  "name": "len",
  "type_name": "builtin_function_or_method",
  "signature": "len(obj, /)",
  "docstring": "Return the number of items in a container."
}
```

---

### Session Management

#### `GET /api/ipython/sessions`
List active sessions.

#### `POST /api/ipython/reset`
Reset a session (clear namespace).

```json
{"session": "document-id"}
```

---

## TypeScript Types

Import from `@mrmd/types` or copy from `frontend/core/types.ts`:

```typescript
interface ExecutionResult {
  session_id: string;
  success: boolean;
  execution_count: number;
  stdout: string;
  stderr: string;
  result: string | null;
  error: ExecutionError | null;
  display_data: DisplayData[];
  /** Clean output ready for display - USE THIS */
  formatted_output: string;
}

interface ExecutionError {
  type: string;      // e.g., "ValueError"
  message: string;   // e.g., "invalid literal"
  traceback: string; // Full traceback (cleaned)
}

interface DisplayData {
  'image/png'?: string;   // Base64 encoded
  'image/jpeg'?: string;  // Base64 encoded
  'text/html'?: string;
  'text/plain'?: string;
  metadata: Record<string, unknown>;
}

interface StreamChunk {
  type: 'stdout' | 'stderr';
  content: string;
  /** Accumulated output with progress handling - USE THIS */
  accumulated: string;
}

interface CompletionResult {
  session_id: string;
  matches: string[];
  cursor_start: number;
  cursor_end: number;
  metadata: {
    types?: string[];
    signatures?: string[];
  };
}

interface InspectionResult {
  session_id: string;
  found: boolean;
  name: string;
  type_name: string | null;
  signature: string | null;
  docstring: string | null;
}
```

---

## Server-Side Utilities

These are implemented in `src/mrmd/server/utils.py`. You don't call these directly - the API uses them automatically.

### `strip_ansi(text: str) -> str`
Removes all ANSI escape codes (colors, cursor movement, etc.)

### `format_execution_result(...) -> str`
Combines stdout, result, errors, and display_data into clean output.

### `handle_progress_output(current: str, chunk: str) -> str`
Handles `\r` carriage returns for progress bars (replaces current line).

### `clean_traceback(traceback: str) -> str`
Cleans Python tracebacks (strips ANSI, removes IPython markers).

---

## Examples

### Basic Execution (Any Frontend)

```typescript
async function runCode(code: string, sessionId: string): Promise<string> {
  const res = await fetch('/api/ipython/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, session: sessionId })
  });

  const data = await res.json();

  if (!data.success && data.error) {
    // Error is already formatted in formatted_output
    return data.formatted_output;
  }

  return data.formatted_output;
}
```

### Streaming (Progress Bars)

```typescript
async function runCodeStreaming(
  code: string,
  sessionId: string,
  onUpdate: (output: string) => void
): Promise<string> {
  const res = await fetch('/api/ipython/execute/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, session: sessionId })
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalOutput = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.accumulated !== undefined) {
          // Streaming chunk - update display
          onUpdate(data.accumulated);
        } else if (data.formatted_output !== undefined) {
          // Final result
          finalOutput = data.formatted_output;
          onUpdate(finalOutput);
        }
      }
    }
  }

  return finalOutput;
}
```

### Display Images

```typescript
function renderDisplayData(displayData: DisplayData[]): string {
  return displayData.map(d => {
    if (d['image/png']) {
      return `![output](data:image/png;base64,${d['image/png']})`;
    }
    if (d['image/jpeg']) {
      return `![output](data:image/jpeg;base64,${d['image/jpeg']})`;
    }
    if (d['text/html']) {
      return d['text/html'];
    }
    return d['text/plain'] || '';
  }).join('\n');
}
```

---

## Session ID Convention

Use the document filename (sanitized) as the session ID for isolation:

```typescript
function getSessionId(filename: string): string {
  return filename
    .split('/').pop()!                    // Get basename
    .replace(/\.[^/.]+$/, '')             // Remove extension
    .replace(/[^a-zA-Z0-9_-]/g, '_');     // Sanitize
}
```

---

## Magic Commands

IPython magic commands work automatically:

```python
%time sum(range(1000000))      # Line magic
%matplotlib inline              # Enable plots

%%timeit                        # Cell magic
sum(range(1000))
```

The server's `formatted_output` will include the magic command output properly formatted.

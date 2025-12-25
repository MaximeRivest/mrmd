# JS Notebook: The RMarkdown of JavaScript

> A literate programming environment for JavaScript that feels like R or Python, not like callback hell.
 
## Vision
 
JavaScript is the most widely deployed programming language in the world, yet it lacks a proper notebook experience. Jupyter supports JS through kernels, but it feels like an afterthought. Observable is powerful but uses proprietary syntax and requires hosting.

**JS Notebook** brings the R/Python notebook experience to JavaScript:
- Write prose and code together in standard markdown
- Execute code blocks with Ctrl+Enter
- See results inline, beautifully formatted
- Build interactive artifacts in a side canvas
- No async/await pollution - it just works

## Two Modes, One System

### Mode 1: Notebook Mode (Data Science)

For exploration, analysis, and visualization. Code blocks without a session identifier execute inline with results shown directly below.

~~~markdown
# Sales Analysis

Let's load and explore the data:

```javascript
const sales = read.csv('/data/sales.csv')
sales.head(5)
```

The average revenue is:

```javascript
mean(sales.revenue)
```

Visualizing the trend:

```javascript
plot(sales, { x: 'date', y: 'revenue', type: 'line' })
```
~~~

**Characteristics:**
- Output appears inline after each block
- Last expression auto-prints (like browser console)
- Arrays/objects get pretty-printed as tables
- DOM nodes render directly
- Shared global scope across all blocks
- Top-level await works transparently

### Mode 2: Artifact Mode (Building Things)

For crafting interactive documents, widgets, and applications. Code blocks with a `:session` suffix render to a side canvas.

~~~markdown
# Interactive Counter

Building a counter widget step by step.

```javascript:counter
canvas.innerHTML = `
  <button id="dec">-</button>
  <span id="count">0</span>
  <button id="inc">+</button>
`;
```

```javascript:counter
let count = 0;
const display = canvas.querySelector('#count');

canvas.querySelector('#dec').onclick = () => {
  display.textContent = --count;
};
canvas.querySelector('#inc').onclick = () => {
  display.textContent = ++count;
};
```
~~~

**Characteristics:**
- Output renders in side panel canvas
- `canvas` global references the session's container
- Multiple sessions = multiple tabs in side panel
- State persists as you scroll the document
- Export as standalone HTML
- REPL-like experience: edit and re-run any block

## The Async Problem (And Our Solution)

JavaScript's async nature creates friction for data science:

```javascript
// The JavaScript way (noisy)
const response = await fetch('/data.json');
const data = await response.json();
const filtered = data.filter(x => x.value > 10);
```

```python
# The Python way (clean)
data = pd.read_json('/data.json')
filtered = data[data.value > 10]
```

### Our Solution: Implicit Async

**1. Cell output awaits promises automatically**

```javascript
fetch('/data.json').then(r => r.json())
```
Output shows the resolved data, not `Promise { <pending> }`.

**2. Standard library functions handle async internally**

```javascript
const data = read.json('/data.json')  // no await needed
data.filter(x => x.value > 10)
```

**3. Full async still available when needed**

```javascript
// For complex cases, standard JS works
const [users, posts] = await Promise.all([
  fetch('/users').then(r => r.json()),
  fetch('/posts').then(r => r.json())
]);
```

## Standard Library

A built-in library provides R/Python-like ergonomics. All I/O functions handle async transparently.

### Data Loading (`read.*`)

```javascript
read.csv(url)       // → DataFrame
read.json(url)      // → Object or Array
read.text(url)      // → String
read.image(url)     // → ImageBitmap (ready for canvas)
read.html(url)      // → Document
```

### DataFrame Operations

Wraps arrays of objects with a chainable, pandas-like API:

```javascript
const df = read.csv('/sales.csv')

df.head(10)                          // first 10 rows
df.tail(5)                           // last 5 rows
df.columns                           // ['date', 'product', 'revenue']
df.shape                             // [1000, 3]
df.describe()                        // summary statistics

df.select('date', 'revenue')         // subset columns
df.filter(row => row.revenue > 1000) // filter rows
df.sort('revenue', 'desc')           // sort
df.groupBy('product').mean()         // aggregate

df.join(other, 'product_id')         // join DataFrames
```

### Visualization (`plot.*`)

Declarative plotting that renders inline:

```javascript
plot(df, { x: 'date', y: 'revenue' })                    // auto-detect type
plot(df, { x: 'date', y: 'revenue', type: 'line' })      // line chart
plot(df, { x: 'category', y: 'count', type: 'bar' })     // bar chart

scatter(df, { x: 'age', y: 'income', color: 'region' })  // scatter plot
histogram(df.revenue, { bins: 20 })                       // histogram
heatmap(matrix, { xLabels, yLabels })                     // heatmap
```

### Statistics

```javascript
mean(array)          // average
median(array)        // median
std(array)           // standard deviation
sum(array)           // sum
min(array), max(array)
quantile(array, 0.95)
corr(a, b)           // correlation coefficient
linreg(x, y)         // → { slope, intercept, r2 }
```

### Display Helpers

```javascript
print(value)         // pretty-print anything
table(data)          // render as table
html`<div>...</div>` // render HTML
md`# Title`          // render markdown
tex`\frac{1}{2}`     // render LaTeX
```

## Pretty Printing

The last expression in each cell is automatically displayed. The rendering depends on the value type:

| Type | Rendering |
|------|-----------|
| `undefined` | No output |
| Primitives (number, string, boolean) | Formatted value |
| Arrays of objects | Table view |
| Plain objects | Collapsible tree |
| DOM elements | Rendered inline |
| ImageBitmap / ImageData | Displayed as image |
| DataFrame | Table with column headers |
| Promise | Awaited, then rendered |
| Error | Stack trace with source mapping |

### Examples

```javascript
42 * 10
```
```
420
```

```javascript
[{name: 'Alice', age: 30}, {name: 'Bob', age: 25}]
```
```
┌───────┬─────┐
│ name  │ age │
├───────┼─────┤
│ Alice │ 30  │
│ Bob   │ 25  │
└───────┴─────┘
```

```javascript
document.createElement('button').textContent = 'Click me'
```
```
┌──────────────┐
│ [Click me]   │  ← live, clickable button
└──────────────┘
```

```javascript
let x = 5;  // no output (undefined)
```

## Execution Model

### Shared Scope

All cells in a notebook share a global scope. Variables defined in one cell are available in subsequent cells:

```javascript
// Cell 1
const data = [1, 2, 3, 4, 5];
```

```javascript
// Cell 2
data.map(x => x * 2)  // → [2, 4, 6, 8, 10]
```

### REPL Semantics

The experience mirrors the browser developer console:

| Dev Console | JS Notebook |
|-------------|-------------|
| Type in console | Edit code block |
| Press Enter | Ctrl+Enter |
| Up arrow to previous | Click earlier block |
| Edit & re-run | Edit block, Ctrl+Enter |
| Refresh page | "Restart & Run All" |

**State is ephemeral.** Re-running an earlier cell doesn't automatically re-run later cells. The user is in control.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Run current cell, stay in place |
| `Shift+Enter` | Run current cell, move to next |
| `Ctrl+Shift+Enter` | Run all cells in session (artifact mode) |
| `Escape` | Exit edit mode |
| `Enter` (on cell) | Enter edit mode |

## Artifact Mode Details

### Session Canvas

Each session (`:name` suffix) gets its own canvas in the side panel:

```
┌────────────────────────────────────────────────────────┐
│ Sessions: [counter] [chart] [dashboard]        [+ New] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌────────────────────────────────────────────────┐   │
│  │                                                │   │
│  │         [ - ]    42    [ + ]                  │   │
│  │                                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                        │
├────────────────────────────────────────────────────────┤
│ [↻ Restart] [Export HTML] [Copy Link]                  │
└────────────────────────────────────────────────────────┘
```

### Canvas API

Inside session blocks, these globals are available:

```javascript
canvas          // The session's root element (a div)
clear()         // Clear the canvas: canvas.innerHTML = ''
```

Full DOM APIs work:

```javascript
// Add elements
canvas.innerHTML = '<h1>Hello</h1>';
canvas.appendChild(document.createElement('div'));

// Query elements
const btn = canvas.querySelector('#myButton');

// Add styles
const style = document.createElement('style');
style.textContent = `.foo { color: red }`;
canvas.appendChild(style);

// Everything in the canvas is isolated from the main document
```

### Export

"Export HTML" generates a standalone file:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Counter Widget</title>
  <style>/* extracted styles */</style>
</head>
<body>
  <!-- canvas contents -->
  <script>/* extracted scripts */</script>
</body>
</html>
```

## External Libraries

### ES Modules from CDN

Import any library from esm.sh, skypack, or unpkg:

```javascript
import * as d3 from 'https://esm.sh/d3';
import confetti from 'https://esm.sh/canvas-confetti';

// Use immediately
d3.select(canvas).append('svg')...
confetti();
```

### Persistent Imports

Imports are cached for the session. Re-running a cell doesn't re-fetch.

### Suggested Pattern

```javascript
// Cell 1: Setup (run once)
import * as d3 from 'https://esm.sh/d3';
import * as Plot from 'https://esm.sh/@observablehq/plot';
```

```javascript
// Cell 2+: Use libraries
Plot.plot({
  marks: [Plot.dot(data, {x: "x", y: "y"})]
})
```

---

# Implementation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      JS Notebook                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Parser    │  │  Executor   │  │   Output Renderer   │ │
│  │             │  │             │  │                     │ │
│  │ - Detect    │  │ - Shared    │  │ - Pretty print      │ │
│  │   sessions  │  │   scope     │  │ - Tables            │ │
│  │ - Extract   │  │ - Async     │  │ - DOM nodes         │ │
│  │   code      │  │   handling  │  │ - Errors            │ │
│  └─────────────┘  │ - Console   │  └─────────────────────┘ │
│                   │   capture   │                          │
│                   └─────────────┘                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Standard Library                     │   │
│  │                                                      │   │
│  │  read.*  │  DataFrame  │  plot.*  │  stats  │  display │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Session Manager                      │   │
│  │                                                      │   │
│  │  - Canvas per session                                │   │
│  │  - Side panel UI                                     │   │
│  │  - Export functionality                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Phased Implementation

### Phase 1: Execution Engine

The foundation. A robust JS execution environment.

**1.1 Shared Scope**
- Create a persistent global scope object
- Inject scope into each cell execution
- Variables persist across cell runs

**1.2 Last Expression Capture**
- Transform code to capture the last expression's value
- Handle edge cases: blocks, if/else, loops

**1.3 Async Handling**
- Wrap cell code in async function
- Automatically await the final expression if it's a Promise
- Display resolved value, not Promise object

**1.4 Console Capture**
- Intercept console.log/warn/error
- Display captured output in cell
- Restore original console after execution

**1.5 Error Handling**
- Catch exceptions with stack traces
- Map to source line numbers
- Display friendly error output

### Phase 2: Output Rendering

Pretty-printing that makes JS feel like R/Python.

**2.1 Type Detection**
- Identify arrays, objects, DOM nodes, primitives
- Special handling for DataFrame instances
- Detect ImageBitmap, ImageData for images

**2.2 Table Renderer**
- Arrays of objects → HTML table
- Column headers from object keys
- Truncate long tables with "show more"

**2.3 Object Inspector**
- Collapsible tree view for objects
- Syntax highlighting for values
- Expand/collapse nested objects

**2.4 DOM Renderer**
- Clone DOM nodes into output area
- Maintain event handlers
- Isolate styles with Shadow DOM or scoped CSS

**2.5 Image Renderer**
- Render ImageBitmap to inline canvas
- Support for Blob URLs
- Handle SVG elements

### Phase 3: Standard Library

The ergonomics layer that eliminates async friction.

**3.1 read.* Module**
- `read.csv()` - Parse CSV to DataFrame
- `read.json()` - Fetch and parse JSON
- `read.text()` - Fetch as string
- All functions async internally, sync interface externally

**3.2 DataFrame Class**
- Wrap array of objects
- Implement head, tail, filter, select, sort
- groupBy with aggregation
- Pretty-print integration

**3.3 Statistics Functions**
- mean, median, std, sum, min, max
- quantile, correlation
- Linear regression

**3.4 Plotting**
- Wrap Observable Plot or build on D3
- Declarative API: `plot(data, {x, y, type})`
- Common chart types: line, bar, scatter, histogram
- Return SVG for inline rendering

**3.5 Display Helpers**
- `print()` - Force pretty-print
- `table()` - Force table rendering
- Tagged templates: html, md, tex

### Phase 4: Session Canvas

Artifact mode with side panel.

**4.1 Session Manager**
- Track named sessions
- Create canvas element per session
- Manage session lifecycle

**4.2 Side Panel UI**
- Tab bar for multiple sessions
- Canvas viewport
- Toolbar: Restart, Export, Share

**4.3 Canvas Globals**
- Inject `canvas` and `clear()` into session cells
- Isolate session scope from notebook scope

**4.4 Export**
- Extract canvas HTML, CSS, JS
- Bundle into standalone file
- Inline all dependencies

### Phase 5: Polish & Integration

**5.1 Keyboard Navigation**
- Ctrl+Enter, Shift+Enter handling
- Cell focus management
- Run All, Restart commands

**5.2 Visual Feedback**
- Running indicator on cells
- Success/error state
- Stale indicator (code changed since run)

**5.3 Persistence (Optional)**
- Save outputs in markdown (as HTML comments or code blocks)
- Restore on reopen
- Clear outputs command

---

# Standalone Package

The JS Notebook runtime can be extracted as a standalone library for use outside of mrmd.

## Package Structure

```
js-notebook/
├── src/
│   ├── executor.js       # Code execution engine
│   ├── output.js         # Pretty printing
│   ├── stdlib/
│   │   ├── read.js       # Data loading
│   │   ├── dataframe.js  # DataFrame class
│   │   ├── plot.js       # Visualization
│   │   ├── stats.js      # Statistics
│   │   └── display.js    # Display helpers
│   ├── session.js        # Session/canvas manager
│   └── index.js          # Main entry
├── dist/
│   ├── js-notebook.esm.js
│   └── js-notebook.umd.js
└── package.json
```

## Standalone Usage

```html
<script type="module">
import { Notebook } from 'js-notebook';

const notebook = new Notebook({
  container: document.getElementById('notebook'),
  stdlib: true,  // Include standard library
});

// Execute a cell
const result = await notebook.run(`
  const data = [1, 2, 3, 4, 5];
  mean(data)
`);
// result.output = 3, result.type = 'number'

// Execute in a session
await notebook.run(`
  canvas.innerHTML = '<h1>Hello</h1>';
`, { session: 'myapp' });
</script>
```

## API

```typescript
interface Notebook {
  // Execute code and return result
  run(code: string, options?: RunOptions): Promise<RunResult>;

  // Get/create a session canvas
  getSession(name: string): SessionCanvas;

  // Clear all state
  restart(): void;

  // Export a session as standalone HTML
  export(session: string): string;
}

interface RunOptions {
  session?: string;       // Session name for artifact mode
  silent?: boolean;       // Don't display output
  timeout?: number;       // Execution timeout in ms
}

interface RunResult {
  value: any;             // The result value
  output: string | Node;  // Rendered output
  logs: LogEntry[];       // Captured console output
  error?: Error;          // If execution failed
  duration: number;       // Execution time in ms
}

interface SessionCanvas {
  element: HTMLElement;   // The canvas DOM element
  clear(): void;          // Clear contents
  export(): string;       // Export as HTML
}
```

---

# Design Decisions

## Why Not Observable Syntax?

Observable's cell syntax (`viewof`, `mutable`, etc.) is powerful but proprietary:

```javascript
// Observable
viewof x = Inputs.range([0, 100])
y = x * 2  // reactive dependency

// JS Notebook
const x = 50;  // standard JS
x * 2
```

We prioritize **standard JavaScript** that users already know.

## Why Not Jupyter Protocol?

Jupyter's kernel protocol is complex and designed for multi-language support. We're focused on JavaScript and can optimize for:

- Instant startup (no kernel launch)
- Direct DOM access
- Browser-native execution
- No server required

## Why Implicit Async?

Data scientists shouldn't think about event loops. The stdlib handles async internally:

```javascript
// They write:
const data = read.csv('/data.csv')

// We execute:
const data = await __read_csv('/data.csv')
```

The transformation is invisible but impactful.

## Why Sessions for Artifacts?

The `:session` syntax clearly separates:
- **Exploration** (inline output, ephemeral)
- **Building** (side canvas, persistent artifact)

Both use standard JS. The suffix is the only difference.

---

# Examples

## Data Analysis Workflow

~~~markdown
# Analyzing COVID-19 Data

```javascript
const covid = read.csv('https://covid.ourworldindata.org/data.csv')
covid.columns
```

```javascript
const us = covid.filter(r => r.location === 'United States')
us.shape
```

```javascript
plot(us, {
  x: 'date',
  y: 'new_cases_smoothed',
  type: 'line',
  title: 'US COVID-19 Cases'
})
```

```javascript
// Peak cases
us.sort('new_cases', 'desc').head(5).select('date', 'new_cases')
```
~~~

## Interactive Widget

~~~markdown
# Color Picker Widget

```javascript:picker
canvas.innerHTML = `
  <input type="color" id="color" value="#4cc9f0">
  <div id="preview" style="width:100px;height:100px;margin-top:10px;"></div>
`;

const input = canvas.querySelector('#color');
const preview = canvas.querySelector('#preview');

preview.style.background = input.value;

input.oninput = () => {
  preview.style.background = input.value;
};
```
~~~

## D3 Visualization

~~~markdown
# D3 Bar Chart

```javascript
import * as d3 from 'https://esm.sh/d3';
```

```javascript:chart
const data = [
  { name: 'A', value: 30 },
  { name: 'B', value: 80 },
  { name: 'C', value: 45 },
  { name: 'D', value: 60 },
  { name: 'E', value: 20 },
];

const width = 400, height = 200;
const margin = { top: 20, right: 20, bottom: 30, left: 40 };

canvas.innerHTML = '';

const svg = d3.select(canvas)
  .append('svg')
  .attr('width', width)
  .attr('height', height);

const x = d3.scaleBand()
  .domain(data.map(d => d.name))
  .range([margin.left, width - margin.right])
  .padding(0.1);

const y = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .range([height - margin.bottom, margin.top]);

svg.selectAll('rect')
  .data(data)
  .join('rect')
  .attr('x', d => x(d.name))
  .attr('y', d => y(d.value))
  .attr('width', x.bandwidth())
  .attr('height', d => y(0) - y(d.value))
  .attr('fill', 'steelblue');

svg.append('g')
  .attr('transform', `translate(0,${height - margin.bottom})`)
  .call(d3.axisBottom(x));

svg.append('g')
  .attr('transform', `translate(${margin.left},0)`)
  .call(d3.axisLeft(y));
```
~~~

---

# Interactive Content Strategy

Virtualized scrolling and live interactive content (Plotly, Bokeh, D3, etc.) require careful handling. This section describes the robust solution.

## No Iframes in Notebooks

**Rule: Notebook outputs never use iframes. Everything is direct DOM injection.**

Why:
- `appendChild()` on a div with a Plotly chart just moves it - no re-render
- Single library load shared across all plots (one Plotly.js, one D3.js)
- No iframe boundaries = DOM elements move freely
- InteractiveContentManager works perfectly
- Full interactivity preserved

The key insight: chart libraries bind to div elements. That binding survives DOM moves.

```javascript
// ❌ WRONG: iframe reloads scripts on every DOM recreation
<iframe srcdoc="...plotly html..."></iframe>

// ✅ RIGHT: direct injection, scripts run once, div moves freely
<div class="output-interactive">
  <div id="plot-123"></div>  <!-- Plotly binds here -->
</div>
```

This applies to all interactive outputs:
- **Plotly** - binds to div, survives moves
- **Bokeh** - binds to div, survives moves
- **Vega/Altair** - binds to div, survives moves
- **D3** - SVG in div, survives moves
- **Any chart library** - they all bind to container elements

## HTML File Links → Artifacts

If a user links to an `.html` file in markdown:

```markdown
See my [dashboard](./dashboard.html)
```

We do NOT render it as an inline iframe. Instead:
- Open it in the **Artifacts panel** (side canvas)
- Or open in a new tab
- The artifact system handles external HTML documents

This keeps the notebook scroll area iframe-free and virtualization-safe.

## The Problem

| Issue | Cause |
|-------|-------|
| Scripts re-run on scroll | Virtualization destroys and recreates DOM |
| Iframes capture focus | Recreation triggers focus events |
| State lost | Chart zoom, video position, scroll position reset |
| Janky scroll | Complex DOM updates during scroll |

## The Solution: Offscreen Pool + Smart Pinning

Two key ideas:

1. **Offscreen Pool** - Keep interactive elements alive in a hidden container, move them into/out of the viewport as needed
2. **Smart Pinning** - Some content should never be moved (actively playing video, user interaction in progress)

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ DOCUMENT                                                            │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ OFFSCREEN POOL (position: absolute; left: -9999px)              │ │
│ │                                                                 │ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │ │
│ │  │ Plotly 1 │ │ D3 chart │ │ Bokeh 3  │  ← alive but hidden    │ │
│ │  │ (live)   │ │ (live)   │ │ (live)   │    state preserved     │ │
│ │  └──────────┘ └──────────┘ └──────────┘                        │ │
│ │                                                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ SCROLL CONTAINER (virtualized)                                  │ │
│ │                                                                 │ │
│ │   Text line (virtualized)                                       │ │
│ │   Text line (virtualized)                                       │ │
│ │   ┌─────────────────────────────────────────┐                  │ │
│ │   │ PLACEHOLDER for Plotly 1                │ ← sized empty box│ │
│ │   │ height: 400px                           │                  │ │
│ │   └─────────────────────────────────────────┘                  │ │
│ │   Text line (virtualized)                                       │ │
│ │   ...                                                           │ │
│ │                                                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Key Insight: appendChild() Moves, Doesn't Clone

When you call `parent.appendChild(element)`, the element is **moved**, not copied:

- No DOM recreation
- No script re-execution
- Event handlers preserved
- Internal state preserved (Plotly zoom, scroll position, video playback)

### State Machine

Each interactive item follows this lifecycle:

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐         │
│ Created │───▶│  Pool   │───▶│ Visible │───▶│  Pool   │─────────┘
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                    │              │
                    │              ▼
                    │         ┌─────────┐
                    └────────▶│ Pinned  │ (stays visible regardless of scroll)
                              └─────────┘
```

### Visibility Timeline

```
TIME →

1. Page loads, Plotly output created
   Pool: [Plotly1]
   Scroll: [placeholder1 (empty)]

2. User scrolls, placeholder1 enters viewport
   IntersectionObserver fires
   Plotly1 moved: Pool → placeholder1
   Pool: []
   Scroll: [placeholder1 contains Plotly1]

3. User scrolls away, placeholder1 exits viewport
   IntersectionObserver fires
   Plotly1 moved: placeholder1 → Pool
   Pool: [Plotly1]
   Scroll: [placeholder1 (empty)]

4. Virtualization recreates placeholder1 as placeholder1'
   We call updatePlaceholder() to track new element
   Pool: [Plotly1]
   Scroll: [placeholder1' (new element)]

5. User scrolls back, placeholder1' enters viewport
   Plotly1 moved: Pool → placeholder1'
   Same Plotly instance! State preserved! No re-execution!
```

### When to Pin

Some content should never be moved to pool:

```javascript
const shouldPin = (item) => {
  return (
    item.isPlaying      ||  // Video/audio playing
    item.hasFocus       ||  // User is interacting (typing, clicking)
    item.isAnimating    ||  // Animation in progress
    item.userPinned         // Explicitly pinned by user
  );
};
```

Pinned items stay in the scroll container even when scrolled out of view.

### Implementation

```javascript
class InteractiveContentManager {
  constructor(scrollContainer) {
    this.scrollContainer = scrollContainer;

    // The offscreen pool - hidden but alive
    this.pool = document.createElement('div');
    this.pool.style.cssText = `
      position: absolute;
      left: -9999px;
      top: 0;
      visibility: hidden;
      pointer-events: none;
    `;
    document.body.appendChild(this.pool);

    // Track all interactive items
    // blockId → { element, placeholder, state: 'pool'|'visible'|'pinned' }
    this.items = new Map();

    // Watch for visibility changes
    this.observer = new IntersectionObserver(
      (entries) => this._handleIntersections(entries),
      { root: scrollContainer, rootMargin: '100px' }
    );
  }

  /**
   * Register interactive content (Plotly, Bokeh, D3, etc.)
   */
  register(blockId, element, placeholder) {
    this.pool.appendChild(element);

    this.items.set(blockId, {
      element,
      placeholder,
      state: 'pool',
      pinned: false
    });

    this.observer.observe(placeholder);
  }

  /**
   * Handle visibility changes
   */
  _handleIntersections(entries) {
    for (const entry of entries) {
      const blockId = entry.target.dataset.blockId;
      const item = this.items.get(blockId);
      if (!item) continue;

      if (entry.isIntersecting) {
        this._moveToVisible(item);
      } else if (!item.pinned) {
        this._moveToPool(item);
      }
    }
  }

  /**
   * Move from pool to visible
   */
  _moveToVisible(item) {
    if (item.state !== 'pool') return;
    item.placeholder.appendChild(item.element);
    item.state = 'visible';
  }

  /**
   * Move from visible to pool
   */
  _moveToPool(item) {
    if (item.state === 'pool' || item.pinned) return;
    this.pool.appendChild(item.element);
    item.state = 'pool';
  }

  /**
   * Pin item (stays visible even when scrolled away)
   */
  pin(blockId) {
    const item = this.items.get(blockId);
    if (!item) return;

    item.pinned = true;
    if (item.state === 'pool') {
      this._moveToVisible(item);
    }
    item.state = 'pinned';
  }

  /**
   * Called when virtualization recreates placeholder
   */
  updatePlaceholder(blockId, newPlaceholder) {
    const item = this.items.get(blockId);
    if (!item) return;

    // Stop observing old, start observing new
    if (item.placeholder) {
      this.observer.unobserve(item.placeholder);
    }
    item.placeholder = newPlaceholder;
    this.observer.observe(newPlaceholder);

    // If was visible, move to new placeholder
    if (item.state === 'visible' || item.state === 'pinned') {
      newPlaceholder.appendChild(item.element);
    }
  }
}
```

### Integration with Virtualization

The continuous scroll adapter generates placeholders:

```javascript
// Generate HTML with sized placeholders
_renderItems(startIndex, endIndex) {
  for (const item of items) {
    if (item.isInteractive) {
      // Just a sized div - content managed separately
      html += `<div class="interactive-placeholder"
                    data-block-id="${item.blockId}"
                    style="height: ${item.measuredHeight}px;">
               </div>`;
    } else {
      html += this._renderStaticContent(item);
    }
  }
}

// After DOM update, reconnect placeholders
_afterRender() {
  const placeholders = this.editorEl.querySelectorAll('.interactive-placeholder');
  for (const placeholder of placeholders) {
    const blockId = placeholder.dataset.blockId;
    this.contentManager.updatePlaceholder(blockId, placeholder);
  }
}
```

### Memory Management (Optional LRU)

For documents with many interactive outputs (100+ charts), add eviction:

```javascript
class InteractiveContentManager {
  constructor(options) {
    this.maxAlive = options.maxAlive || 50;  // Keep max 50 alive
    this.accessOrder = [];  // LRU tracking
  }

  _moveToVisible(item) {
    // Track access order
    this.accessOrder = this.accessOrder.filter(id => id !== item.blockId);
    this.accessOrder.push(item.blockId);

    // Evict oldest if over limit
    while (this.accessOrder.length > this.maxAlive) {
      const oldestId = this.accessOrder.shift();
      this._evict(oldestId);
    }

    // ... rest of move logic
  }

  _evict(blockId) {
    const item = this.items.get(blockId);
    if (!item || item.pinned) return;

    // Serialize state if possible
    const state = this._serializeState(item.element);

    // Destroy element
    item.element.remove();
    item.element = null;
    item.serializedState = state;
    item.state = 'evicted';
  }

  _restore(blockId) {
    const item = this.items.get(blockId);
    if (item.state !== 'evicted') return;

    // Recreate from serialized state
    item.element = this._deserialize(item.serializedState);
    item.state = 'pool';
    this.pool.appendChild(item.element);
  }
}
```

### What This Enables

| Content Type | Behavior |
|--------------|----------|
| Plotly chart | Zoom/pan state preserved across scroll |
| Video | Playback continues when pinned |
| Bokeh | Interactivity maintained |
| D3/SVG | Hover states, tooltips preserved |
| Custom widgets | Event handlers intact |

### Why This is the Most Robust Solution

1. **No recreation** - Elements move, never destroyed/recreated
2. **No script re-execution** - Scripts ran once at creation
3. **Full state preservation** - Everything maintained
4. **Virtualization compatible** - Placeholders can be recreated freely
5. **Memory bounded** - LRU eviction for large documents
6. **Escape hatch** - Pinning for edge cases

---

# Applying to Python/IPython Notebooks

The same InteractiveContentManager works for Python notebook outputs.

## What IPython/Jupyter Sends

Python notebooks produce these output types:

| Output Type | Example | Interactive? |
|-------------|---------|--------------|
| `text/plain` | `42` | No |
| `text/html` | Tables, styled output | Sometimes |
| `image/png` | Matplotlib static | No |
| `application/vnd.plotly.v1+json` | Plotly chart | **Yes** |
| `text/html` with scripts | Bokeh, Altair | **Yes** |
| `application/javascript` | Custom JS | **Yes** |

## Detection Strategy

```javascript
function isInteractiveOutput(output) {
  // Check MIME types
  if (output.data['application/vnd.plotly.v1+json']) return true;
  if (output.data['application/vnd.bokehjs_load.v0+json']) return true;
  if (output.data['application/vnd.vegalite.v4+json']) return true;

  // Check for script tags in HTML
  const html = output.data['text/html'];
  if (html && /<script[\s>]/i.test(html)) return true;

  // Check for known library markers
  if (html && /plotly|bokeh|altair|vega/i.test(html)) return true;

  return false;
}
```

## Integration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Python Kernel executes cell                                         │
│                                                                     │
│ Cell contains: fig.show()  (Plotly)                                 │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Kernel returns output:                                              │
│ {                                                                   │
│   "data": {                                                         │
│     "application/vnd.plotly.v1+json": { ... chart spec ... },       │
│     "text/html": "<div id='plotly-123'>...</div><script>...</script>"│
│   }                                                                 │
│ }                                                                   │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Output Renderer detects: isInteractiveOutput() → true              │
│                                                                     │
│ 1. Create container element                                         │
│ 2. Render HTML into container (scripts execute)                     │
│ 3. Measure height                                                   │
│ 4. Register with InteractiveContentManager                          │
│    - Element goes to pool                                           │
│    - Placeholder goes in document                                   │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ User scrolls → IntersectionObserver fires                          │
│                                                                     │
│ Placeholder visible? → Move chart from pool to placeholder          │
│ Placeholder hidden?  → Move chart from placeholder to pool          │
│                                                                     │
│ Plotly chart moves, never recreated. Zoom state preserved.          │
└─────────────────────────────────────────────────────────────────────┘
```

## Rendering Pipeline

```javascript
class OutputRenderer {
  constructor(contentManager) {
    this.contentManager = contentManager;
  }

  render(blockId, output) {
    if (isInteractiveOutput(output)) {
      return this._renderInteractive(blockId, output);
    } else {
      return this._renderStatic(output);
    }
  }

  _renderInteractive(blockId, output) {
    // 1. Create container
    const container = document.createElement('div');
    container.className = 'output-interactive';

    // 2. Render content (executes scripts)
    const html = output.data['text/html'];
    container.innerHTML = html;
    this._activateScripts(container);

    // 3. Wait for render, then measure
    requestAnimationFrame(() => {
      const height = container.getBoundingClientRect().height;

      // 4. Create placeholder
      const placeholder = document.createElement('div');
      placeholder.className = 'output-placeholder';
      placeholder.dataset.blockId = blockId;
      placeholder.style.height = `${height}px`;

      // 5. Register with manager
      this.contentManager.register(blockId, container, placeholder);

      // 6. Return placeholder for document
      this._insertPlaceholder(blockId, placeholder);
    });
  }

  _renderStatic(output) {
    // Static content renders directly, virtualizes normally
    const html = output.data['text/html'] ||
                 `<pre>${output.data['text/plain']}</pre>`;
    return html;
  }

  _activateScripts(container) {
    // Scripts in innerHTML don't execute - recreate them
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }
}
```

## Height Tracking

Interactive outputs may change height after initial render:

```javascript
// In InteractiveContentManager
_setupResizeObserver() {
  this.resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const item = this._findItemByElement(entry.target);
      if (!item) continue;

      // Update placeholder height to match content
      const newHeight = entry.contentRect.height;
      if (item.placeholder) {
        item.placeholder.style.height = `${newHeight}px`;
      }

      // Notify scroll model
      this.onHeightChange?.(item.blockId, newHeight);
    }
  });
}

register(blockId, element, placeholder) {
  // ... existing code ...

  // Watch for size changes
  this.resizeObserver.observe(element);
}
```

## Error Recovery

If an interactive output fails to render:

```javascript
_renderInteractive(blockId, output) {
  const container = document.createElement('div');

  try {
    container.innerHTML = html;
    this._activateScripts(container);
  } catch (error) {
    // Fall back to static rendering
    console.warn(`Interactive render failed for ${blockId}:`, error);
    return this._renderFallback(output, error);
  }

  // ... rest of logic
}

_renderFallback(output, error) {
  // Show static image if available
  if (output.data['image/png']) {
    return `<img src="data:image/png;base64,${output.data['image/png']}">`;
  }

  // Show text representation
  if (output.data['text/plain']) {
    return `<pre>${output.data['text/plain']}</pre>`;
  }

  // Show error
  return `<div class="output-error">Failed to render: ${error.message}</div>`;
}
```

---

# Persistence: The Freeze-Dry Architecture

> **The Holy Grail of reproducible research: The document IS the database.**

## Core Concept

The notebook file contains two independent things:
1. **Code** - the executable chunks (what you wrote)
2. **Output snapshots** - frozen HTML of what you saw (what it produced)

When you open a notebook:
- You see all the outputs immediately (they're just HTML)
- Runtime memory is empty (`x` is undefined)
- The *plot of x* is visible because it's an `<svg>` sitting in the document

When you run a cell:
- Code executes, updates runtime memory
- Output snapshot is replaced with new result
- Other cells' outputs are **untouched**

This is exactly how Jupyter works, and it's the right model.

## File Format

The markdown file is "proper markdown" - readable on GitHub, in any markdown viewer:

~~~markdown
# My Analysis

First, define the dataset.

```javascript
const data = [10, 20, 30, 40];
data
```

<!--nb:output block="1" exec="17"-->
<table class="nb-table">
  <tr><td>10</td><td>20</td><td>30</td><td>40</td></tr>
</table>
<!--/nb:output-->

Now visualize it.

```javascript
plot(data, { type: 'bar' })
```

<!--nb:output block="2" exec="18"-->
<svg viewBox="0 0 400 200">
  <!-- the actual chart, frozen -->
</svg>
<!--/nb:output-->
~~~

**Key properties:**
- Code renders as code blocks (everywhere)
- SVG renders visually (most viewers)
- HTML tables render (most viewers)
- Comments are invisible (clean reading)
- Our app reads the `<!--nb:output-->` markers for rehydration

## The Two Layers

### Layer A: Rendered Document (what you see)
- Markdown prose
- Code blocks (syntax highlighted)
- Output snapshots (static HTML)
- Stable across reloads - comes from file

### Layer B: Runtime Session (what you have in memory)
- Current `globalThis` / variables
- Import cache
- NOT required to match the document

When you run a cell:
1. Execute in runtime session
2. Replace **only that cell's** output snapshot
3. Do NOT touch other outputs

## Output Snapshot Format

### Static Outputs (simple)

```html
<!--nb:output block="3" exec="42" mime="text/plain"-->
<pre>42</pre>
<!--/nb:output-->
```

### SVG Outputs (ideal - portable, crisp)

```html
<!--nb:output block="4" exec="43" mime="image/svg+xml"-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <!-- D3/Plot output serializes perfectly -->
</svg>
<!--/nb:output-->
```

### Canvas Outputs (converted to image)

```html
<!--nb:output block="5" exec="44" mime="image/png"-->
<img src="data:image/png;base64,iVBORw0KGgo..." alt="Chart output">
<!--/nb:output-->
```

### Interactive Outputs (dual storage)

For libraries like Plotly that need JS to be interactive:

```html
<!--nb:output block="6" exec="45" mime="image/png"-->
<img src="data:image/png;base64,..." alt="Plotly chart (static)">
<!--/nb:output-->

<!--nb:bundle block="6" mime="application/vnd.plotly.v1+json" encoding="base64"-->
eyJkYXRhIjpbeyJ4IjpbMSwyLDNdLCJ5IjpbMiwzLDFdfV0sImxheW91dCI6e319
<!--/nb:bundle-->
```

- **Fallback image** - renders everywhere (GitHub, forums, etc.)
- **JSON bundle** - our app rehydrates to interactive Plotly

## Serialization Algorithm

```javascript
function serializeCell(cell) {
  const output = cell.outputElement;
  let markdown = '';

  // 1. Code
  markdown += '```javascript\n' + cell.code + '\n```\n\n';

  // 2. Output
  let staticHTML = '';
  let bundle = null;

  // SVG - perfect serialization
  const svg = output.querySelector('svg');
  if (svg) {
    staticHTML = svg.outerHTML;
  }
  // Canvas - convert to image
  else if (output.querySelector('canvas')) {
    const canvas = output.querySelector('canvas');
    staticHTML = `<img src="${canvas.toDataURL('image/png')}" alt="Output">`;
  }
  // Plotly/Bokeh - save both static + bundle
  else if (output.querySelector('.plotly')) {
    staticHTML = captureAsImage(output);
    bundle = { mime: 'application/vnd.plotly.v1+json', data: Plotly.toJSON(output) };
  }
  // Default - just take innerHTML (strips event listeners)
  else {
    staticHTML = output.innerHTML;
  }

  // Write output marker
  markdown += `<!--nb:output block="${cell.id}" exec="${cell.lastExec}"-->\n`;
  markdown += staticHTML + '\n';
  markdown += `<!--/nb:output-->\n\n`;

  // Write bundle if needed
  if (bundle) {
    markdown += `<!--nb:bundle block="${cell.id}" mime="${bundle.mime}" encoding="base64"-->\n`;
    markdown += btoa(JSON.stringify(bundle.data)) + '\n';
    markdown += `<!--/nb:bundle-->\n\n`;
  }

  return markdown;
}
```

## Loading Algorithm

```javascript
function loadNotebook(markdown) {
  const cells = parseMarkdown(markdown);

  for (const cell of cells) {
    // 1. Render code block (as syntax-highlighted text)
    renderCodeBlock(cell.code);

    // 2. Render output (as static HTML)
    if (cell.outputHtml) {
      const outputDiv = document.createElement('div');
      outputDiv.innerHTML = cell.outputHtml;
      outputDiv.classList.add('nb-output', 'nb-frozen');

      // 3. Check for interactive bundle
      if (cell.bundle) {
        // Rehydrate when user interacts or scrolls into view
        outputDiv.dataset.bundle = cell.bundle;
        outputDiv.dataset.bundleMime = cell.bundleMime;
      }

      appendOutput(outputDiv);
    }

    // 4. Do NOT execute code - runtime is empty
  }
}
```

## Staleness Model

We use execution order, not dependency analysis (JS dependencies are too complex to track).

### How It Works

1. Maintain a session counter `execCounter` that increments on each execution
2. Each cell stores `lastExec = execCounter` when it runs
3. A cell is "stale" if any cell **above** it has `lastExec > thisCell.lastExec`

```javascript
class NotebookState {
  constructor() {
    this.execCounter = 0;
    this.cellExecTimes = new Map(); // cellId → lastExec
  }

  onCellRun(cellId) {
    this.execCounter++;
    this.cellExecTimes.set(cellId, this.execCounter);
    this.updateStaleIndicators();
  }

  updateStaleIndicators() {
    const cells = this.getCellsInOrder();
    let maxExecAbove = 0;

    for (const cell of cells) {
      const cellExec = this.cellExecTimes.get(cell.id) || 0;

      if (cellExec < maxExecAbove) {
        cell.markStale(); // Show warning indicator
      } else {
        cell.markFresh();
      }

      maxExecAbove = Math.max(maxExecAbove, cellExec);
    }
  }
}
```

### Visual Indicator

```
┌────────────────────────────────────────┐
│ ```javascript                    [Run] │
│ const x = 10;                          │
│ ```                                    │
│ Output: 10                 exec #3 ✓   │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│ ```javascript                    [Run] │
│ x * 2                                  │
│ ```                                    │
│ Output: 20                 exec #2 ⚠️   │  ← Stale! Cell above ran more recently
└────────────────────────────────────────┘
```

User sees warning, knows to re-run if they want fresh output.

## The Dependency "Gotcha"

If you restart the notebook and run Cell 3 (which uses `d3`), but haven't run Cell 1 (which imports `d3`), it fails:

```
Error: d3 is not defined
```

**This is correct behavior.** It matches Jupyter, R, Python. Linear execution is the user's responsibility.

## Session vs Notebook Persistence

| Aspect | Session Canvas (Artifacts) | Notebook Outputs |
|--------|---------------------------|------------------|
| Storage | Side panel | Inline in document |
| Persistence | Export as standalone HTML | Saved in markdown |
| On open | Empty canvas | Frozen outputs visible |
| On run | Canvas updates live | Output snapshot replaced |

Artifacts are for **building things**. Notebook outputs are for **documenting results**.

---

# Variable Inspection: DevTools Integration

The browser's DevTools Console has the best object inspector and autocomplete. We leverage it rather than rebuild it.

## Strategy: Pin to Console

Expose a `pin()` function that puts values into a global namespace:

```javascript
// Built into the notebook runtime
globalThis.__pins = Object.create(null);

globalThis.pin = (value, name) => {
  const key = name ?? `p${Object.keys(__pins).length + 1}`;
  __pins[key] = value;
  console.log(`Pinned as __pins.${key}:`, value);
  return value;
};
```

Usage in a cell:

```javascript
const df = read.csv('/data.csv')
pin(df, 'df')
pin(model, 'model')
```

Now in DevTools Console:
- Type `__pins.df.` → autocomplete shows all DataFrame properties
- Expand `__pins.df` → full object inspector
- Native browser experience, zero work for us

## What This Gives Us

| Feature | Our Notebook | DevTools |
|---------|--------------|----------|
| Code editing | Yes | No |
| Run cells | Yes | No |
| Pretty-print output | Yes | Yes |
| Object inspection | Basic | **Excellent** |
| Autocomplete | Limited | **Excellent** |
| Performance profiling | No | Yes |
| Network inspection | No | Yes |

We build the notebook UX. DevTools handles deep inspection.

## Future: Monaco Autocomplete

For in-editor autocomplete (Phase 5+):

1. Use Monaco editor with TypeScript language service for **static** completions
2. Add **runtime** completions by querying `Object.getOwnPropertyNames()` on scope
3. Merge both into suggestion list

But this is a "nice to have" - pinning to DevTools works great for v1.

---

# Artifact Links: The Publishing Story

Artifacts (session canvases) can be exported as standalone HTML files. Linked HTML files open in the Artifacts panel.

## The Flow

```
1. Build artifact          2. Export to file           3. Link in markdown
   :dashboard       →      /artifacts/dashboard.html → [dashboard](./artifacts/dashboard.html)

4. Opens in Artifacts panel (or new tab)
   ┌─────────────────────────────────┐
   │  Artifacts: [dashboard]         │
   │  ┌───────────────────────────┐  │
   │  │  Live dashboard           │  │
   │  └───────────────────────────┘  │
   └─────────────────────────────────┘
```

Note: HTML links do NOT render as inline iframes in the document. This keeps the notebook scroll area clean and virtualization-safe. External HTML documents belong in the Artifacts panel.

## Auto-Export (Optional)

When the user saves the markdown, auto-export all sessions:

```
my-notebook.md
artifacts/
  dashboard.html    ← auto-generated from :dashboard
  counter.html      ← auto-generated from :counter
  chart.html        ← auto-generated from :chart
```

The markdown references them. They're always up to date.

## The Meta Beauty

The notebook becomes a **build system**:

- **Source**: markdown with `:session` blocks
- **Output**: standalone HTML artifacts
- **Documentation**: the prose around the code

Like RMarkdown → HTML, but:
- **Live editing** - see changes instantly in canvas
- **Incremental** - re-run one block, not the whole thing
- **Publishable** - artifacts are standalone, shareable

---

# Future Considerations

## Reactivity

**Decision: No automatic reactivity.**

Observable-style reactivity breaks mental models:

```javascript
// Observable: "everything is connected"
x = 10
y = x * 2      // y magically updates when x changes

// But wait... what's the state NOW? Which ran first?
```

The R/Python/Julia model is predictable:

```python
x = 10
y = x * 2      # y is 20, period.
x = 50         # y is still 20. You re-run to update.
```

We follow the imperative model. User controls execution.

## Collaboration

Real-time shared notebooks:
- Cursor presence
- Live output sync
- Conflict resolution

## Kernel Mode

Optional server-side execution for:
- Node.js APIs
- File system access
- Database connections
- Heavy computation

---

*This document is the specification for JS Notebook. Implementation follows the phased approach outlined above.*

# Web Notebook Demo
```python

``` 
This notebook demonstrates the **power** of combining HTML, CSS, and JavaScript in a literate programming environment.

## Isolated vs Shared Scope    

Code blocks without a session are **isolated** - they won't affect the rest of the document.

### Isolated CSS (no session)

```css
.container {
  display: flex;
  background: red;
}
```

This CSS is safely isolated in an iframe preview. It won't break the page layout!

### Isolated HTML (no session)

```html
<div style="padding: 20px; background: lightyellow; border: 2px solid orange;">
  <h3>I'm isolated!</h3>
  <p>This HTML is in its own iframe.</p>
</div>
```

### Full HTML Document (always isolated)

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Georgia, serif; background: #f0f0f0; padding: 20px; }
    h1 { color: navy; }
  </style>
</head>
<body>
  <h1>Complete HTML Page</h1>
  <p>This is a full HTML document renderfdsfdsfsed in a sanfdsfdsdboxed iframe.</p>
</body>
</html>
```

---

## Shared Canvas with Sessions

Now the magic! Use sessions (`:sessionname`) to create a shared canvas where CSS, HTML, and JS work together.

### Simple Test

A minimal example - HTML + JS sharing a session:

```html:test
<div id="test-box" style="padding: 20px; background: #eee; border-radius: 8px;">
  <span id="test-msg">Waiting...</span>
</div>
```

```javascript:test
document.getElementById('test-msg').textContent = 'JS ran!';
document.getElementById('test-box').style.background = '#d4edda';
console.log('Simple test passed');
```
```output
Simple test passed
```

### Step 1: Define Styles

```css:viz
#chart-container {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  padding: 24px;
  margin: 10px 0;
}

.bar {
  fill: #4cc9f0;
  transition: fill 0.2s ease;
}

.bar:hover {
  fill: #f72585;
}

.axis text {
  fill: #a0a0a0;
  font-size: 11px;
}

.axis line,
.axis path {
  stroke: #404040;
}

.chart-title {
  fill: white;
  font-size: 16px;
  font-weight: bold;
}
```

### Step 2: Create the HTML Structure
 
```html:viz
<div id="chart-container">
  <svg id="bar-chart" width="500" height="300"></svg>
</div>
```

### Step 3: Bring it to Life with JavaScript

```javascript:viz
// Sample data
const data = [
  { label: 'Python', value: 85 },
  { label: 'JavaScript', value: 78 },
  { label: 'Rust', value: 45 },
  { label: 'Go', value: 52 },
  { label: 'TypeScript', value: 67 }
];

const svg = document.getElementById('bar-chart');
const width = 500;
const height = 300;
const margin = { top: 40, right: 20, bottom: 40, left: 80 };
const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

// Clear previous content
svg.innerHTML = '';

// Create group for chart
const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
g.setAttribute('transform', `translate(${margin.left},${margin.top})`);
svg.appendChild(g);

// Title
const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
title.setAttribute('class', 'chart-title');
title.setAttribute('x', innerWidth / 2);
title.setAttribute('y', -15);
title.setAttribute('text-anchor', 'middle');
title.textContent = 'Programming Language Popularity';
g.appendChild(title);

// Calculate scales
const maxValue = Math.max(...data.map(d => d.value));
const barHeight = innerHeight / data.length - 8;

// Draw bars
data.forEach((d, i) => {
  const barWidth = (d.value / maxValue) * innerWidth;
  const y = i * (innerHeight / data.length) + 4;

  // Bar
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'bar');
  rect.setAttribute('x', 0);
  rect.setAttribute('y', y);
  rect.setAttribute('width', barWidth);
  rect.setAttribute('height', barHeight);
  rect.setAttribute('rx', 4);
  g.appendChild(rect);

  // Label
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('class', 'axis');
  label.setAttribute('x', -10);
  label.setAttribute('y', y + barHeight / 2 + 4);
  label.setAttribute('text-anchor', 'end');
  label.textContent = d.label;
  g.appendChild(label);

  // Value
  const value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  value.setAttribute('class', 'axis');
  value.setAttribute('x', barWidth + 8);
  value.setAttribute('y', y + barHeight / 2 + 4);
  value.textContent = d.value + '%';
  g.appendChild(value);
});

console.log('Chart rendered!');
```
```output
Chart rendered!
```

---

## Interactive Widget Example

Another session for an interactive counter widget:

```css:counter
.counter-widget {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #1e1e2e;
  border-radius: 12px;
  width: fit-content;
  margin: 10px 0;
}

.counter-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  font-size: 24px;
  cursor: pointer;
  transition: transform 0.1s, background 0.2s;
}

.counter-btn:hover {
  transform: scale(1.1);
}

.counter-btn.decrement {
  background: #f38ba8;
  color: #1e1e2e;
}

.counter-btn.increment {
  background: #a6e3a1;
  color: #1e1e2e;
}

.counter-display {
  font-size: 48px;
  font-weight: bold;
  color: #cdd6f4;
  min-width: 80px;
  text-align: center;
  font-family: 'SF Mono', monospace;
}
```

```html:counter
<div class="counter-widget">
  <button class="counter-btn decrement" onclick="updateCounter(-1)">−</button>
  <span class="counter-display" id="counter-value">38</span>
  <button class="counter-btn increment" onclick="updateCounter(1)">+</button>
</div>
```

```javascript:counter
let count = 0;

function updateCounter(delta) {
  count += delta;
  document.getElementById('counter-value').textContent = count;
}

console.log('Counter initialized!');
```
 

---

## Mixing Sessions

You can have multiple independent sessions in the same document. The `:viz` and `:counter` sessions above don't interfere with each other.

This enables building complex interactive documents with multiple independent visualizations!
 
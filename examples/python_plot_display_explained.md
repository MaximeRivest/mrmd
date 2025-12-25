# Understanding Python Plot Display Mechanisms

This guide explains how Python visualization libraries (matplotlib, seaborn, plotly, etc.) display plots, the underlying architecture, and how different backends work.

## Table of Contents

1. [The Fundamentals: How Plot Display Works](#1-the-fundamentals-how-plot-display-works)
2. [Matplotlib Deep Dive](#2-matplotlib-deep-dive)
.](#5-ipythonjupyter-display-system)
6. [How MRMD Handles Plots](#6-how-mrmd-handles-plots)
7. [Common Issues and Solutions](#7-common-issues-and-solutions)

---
 
## 1. The Fundamentals: How Plot Display Works
 
### The Two-Step Process
 
Every plotting library follows this basic pattern:
 
```
[Build Figure in Memory] → [Render/Display the Figure]
```

The **display step** is where things get interesting - it depends on:
- The **backend** (GUI toolkit, file format, or web renderer)
- The **environment** (terminal, Jupyter, IDE, web server)

### Display Methods

| Method | Description | Use Case |
| --- | --- | --- |
| GUI Window | Opens native window (Tk, Qt, GTK) | Interactive desktop use |
| Inline | Embeds in notebook as PNG/SVG | Jupyter notebooks |
| Save to File | Writes PNG, SVG, PDF, etc. | Automation, servers |
| HTML/JavaScript | Interactive web visualization | Plotly, Bokeh, Altair |

---
 
## 2. Matplotlib Deep Dive

### 2.1 The Backend System

Matplotlib has a **two-layer architecture**:

```
┌─────────────────────────────────────────┐
│         Artist Layer (Figure, Axes)     │  ← What you draw
├─────────────────────────────────────────┤
│              Backend Layer              │  ← How it renders
│  ┌─────────────┐  ┌─────────────────┐   │
│  │ Interactive │  │ Non-Interactive │   │
│  │ (TkAgg,     │  │ (Agg, PDF,      │   │
│  │  QtAgg)     │  │  SVG, PS)       │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

### 2.2 Backend Types Explained

```python
%pip install matplotlib
```

```python
# ============================================================
# MATPLOTLIB BACKENDS EXPLAINED
# ============================================================

import matplotlib
import matplotlib.pyplot as plt
import numpy as np

# Check current backend
print(f"Current backend: {matplotlib.get_backend()}")

# ------------------------------------------------------------
# INTERACTIVE BACKENDS (open GUI windows)
# ------------------------------------------------------------
# These require a display server (X11, Wayland, macOS, Windows)

# TkAgg - Uses Tkinter (usually default on desktop)
# matplotlib.use('TkAgg')

# Qt5Agg - Uses PyQt5 or PySide2
# matplotlib.use('Qt5Agg')

# GTK3Agg - Uses GTK3
# matplotlib.use('GTK3Agg')

# MacOSX - Native macOS
# matplotlib.use('MacOSX')

# ------------------------------------------------------------
# NON-INTERACTIVE BACKENDS (no GUI, for file output)
# ------------------------------------------------------------

# Agg - Anti-Grain Geometry, renders to PNG buffer
# matplotlib.use('Agg')

# PDF - Direct PDF output
# matplotlib.use('PDF')

# SVG - Scalable Vector Graphics
# matplotlib.use('SVG')

# PS - PostScript
# matplotlib.use('PS')
```

### 2.3 What Happens When You Call plt.show()

```python
# ============================================================
# DISSECTING plt.show()
# ============================================================

import matplotlib
import matplotlib.pyplot as plt
import numpy as np

# Step 1: Create figure and axes (happens in memory)
fig, ax = plt.subplots()
print(f"Figure created: {fig}")
print(f"Figure ID (number): {fig.number}")

# Step 2: Draw data (still in memory, not rendered yet)
x = np.linspace(0, 10, 100)
line, = ax.plot(x, np.sin(x))
print(f"Line object: {line}")
print(f"Figure has {len(fig.axes)} axes")

# Step 3: Let's see what figures exist
print(f"All figure numbers: {plt.get_fignums()}")

# Step 4: plt.show() does different things based on backend:
#
# Interactive backend (TkAgg, Qt5Agg):
#   - Renders figure to a bitmap/screen buffer
#   - Opens a GUI window
#   - Enters an event loop (blocks until window closed)
#   - Window has zoom, pan, save buttons
#
# Non-interactive backend (Agg):
#   - Renders figure to internal buffer
#   - Returns immediately (no window)
#   - Figure data is available via fig.canvas.buffer_rgba()

# To see this in action:
print(f"Backend: {matplotlib.get_backend()}")
print(f"Figure canvas: {fig.canvas}")
print(f"Canvas type: {type(fig.canvas)}")

# DON'T actually call plt.show() in this cell if you want to continue
# plt.show()  # This would either open window (interactive) or do nothing (Agg)
```

### 2.4 Figure Lifecycle

```python
# ============================================================
# FIGURE LIFECYCLE - CREATION TO DESTRUCTION
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

# --- Stage 1: Figure Creation ---
fig = plt.figure(figsize=(8, 6), dpi=100)
print(f"Created figure #{fi''''fdsffdsffdsnumber}")
print(f"Size: {fig.get_size_inches()} inches")
print(f"DPI: {fig.dpi}")
print(f"Total figures in memory: {len(plt.get_fignums())}")

# --- Stag Axes ---
ax = fig.add_subplot(111)  # 1 row, 1 col, position 1
print(f"Axes added: {ax}")
print(f"Axes bounding box: {ax.get_position()}")

# --- Stadbefore display/save
fig.canvas.draw()
print(f"Canvas drawn, renderer: {fig.canvas.get_renderer()}")

# --- Stage 5: Get the rendered data ---
# This is what backends use to display or save

# Get RGBA buffer (what Agg backend produces)
buf = fig.canvas.buffer_rgba()
print(f"Buffer shape: {np.asarray(buf).shape}")  # (height, width, 4) RGBA

# --- Stage 6: Save to file (alternative to show) ---
fig.savefig('/tmp/test_figure.png', dpi=150, bbox_inches='tight')
print("Figure saved to /tmp/test_figure.png")

# --- Stage 7: Close and free memory ---
plt.close(fig)
print(f"Figure closed. Remaining: {plt.get_fignums()}")

# Or close all figures
plt.close('all')
```

### 2.5 The plt State Machine vs Object-Oriented
 
```python
# ============================================================
# TWO INTERFACES: pyplot STATE MACHINE vs OOP
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)

# ------------------------------------------------------------
# State Machine Interface (pyplot)
# Maintains "current figure" and "current axes" internally
# ------------------------------------------------------------

plt.figure()                    # Create figure, set as current
plt.plot(x, np.sin(x))         # Plot on current axes
plt.title('State Machine')      # Set title on current axes
plt.xlabel('x')
plt.ylabel('sin(x)')
# plt.show()                    # Show current figure
plt.savefig('/tmp/state_machine.png')
plt.close()

# Behind the scenes, pyplot tracks:
# - plt.gcf() = "get current figure"
# - plt.gca() = "get current axes"

# ------------------------------------------------------------
# Object-Oriented Interface (explicit)
# You manage figure/axes objects directly
# ------------------------------------------------------------

fig, ax = plt.subplots()        # Create both, get references
ax.plot(x, np.sin(x))          # Plot on specific axes
ax.set_title('OOP Style')       # Set title on specific axes
ax.set_xlabel('x')
ax.set_ylabel('sin(x)')
fig.savefig('/tmp/oop_style.png')
plt.close(fig)

# OOP is recommended for:
# - Complex figures with multiple subplots
# - Functions that create plots (no global state)
# - Embedding in applications

print("Both approaches produce identical plots!")
```

### 2.6 Saving Figures - All the Options

```python
# ============================================================
# SAVING FIGURES - FORMAT AND OPTIONS DEEP DIVE
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

fig, ax = plt.subplots(figsize=(8, 6))
x = np.linspace(0, 10, 100)
ax.plot(x, np.sin(x), 'b-', linewidth=2)
ax.fill_between(x, np.sin(x), alpha=0.3)
ax.set_title('Test Figure')

# --- PNG (raster, most common) ---
fig.savefig('/tmp/figure.png',
    dpi=150,              # Dots per inch (150 is good balance)
    bbox_inches='tight',  # Remove whitespace around plot
    facecolor='white',    # Background color
    edgecolor='none',     # Edge color
    transparent=False,    # Transparent background?
    pad_inches=0.1,       # Padding when using bbox_inches='tight'
)

# --- SVG (vector, scalable) ---
fig.savefig('/tmp/figure.svg',
    format='svg',
    bbox_inches='tight',
)

# --- PDF (vector, for publications) ---
fig.savefig('/tmp/figure.pdf',
    format='pdf',
    bbox_inches='tight',
    metadata={'Title': 'My Figure', 'Author': 'Me'},
)

# --- JPEG (raster, smaller but lossy) ---
fig.savefig('/tmp/figure.jpg',
    format='jpeg',
    dpi=150,
    quality=95,  # JPEG quality 1-100
)

# --- Save to bytes buffer (for web/API) ---
from io import BytesIO
import base64

buffer = BytesIO()
fig.savefig(buffer, format='png', dpi=100)
buffer.seek(0)
png_bytes = buffer.getvalue()
base64_str = base64.b64encode(png_bytes).decode('utf-8')
print(f"PNG size: {len(png_bytes)} bytes")
print(f"Base64 length: {len(base64_str)} chars")
# This base64 can be embedded in HTML: <img src="data:image/png;base64,{base64_str}">

plt.close(fig)
```

---

## 3. Seaborn (Built on Matplotlib)

Seaborn is a **high-level wrapper** around matplotlib. All the backend concepts apply.

```python
%pip install seaborn
```

```python
# ============================================================
# SEABORN - MATPLOTLIB UNDER THE HOOD
# ============================================================

import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import pandas as pd

# Seaborn creates matplotlib figures/axes behind the scenes

# --- Example 1: Simple plot ---
tips = sns.load_dataset('tips')

# This creates a matplotlib figure internally
g = sns.scatterplot(data=tips, x='total_bill', y='tip', hue='time')
print(f"Type of g: {type(g)}")  # matplotlib.axes.Axes

# Get the underlying figure
fig = g.get_figure()
print(f"Figure: {fig}")

plt.savefig('/tmp/seaborn_scatter.png')
plt.close()

# --- Example 2: FacetGrid (multiple figures) ---
g = sns.FacetGrid(tips, col='time', row='smoker')
g.map(sns.scatterplot, 'total_bill', 'tip')
print(f"Type of g: {type(g)}")  # seaborn.axisgrid.FacetGrid
print(f"Underlying figure: {g.figure}")

g.savefig('/tmp/seaborn_facet.png')  # FacetGrid has its own savefig
plt.close()

# --- Example 3: Statistical plots ---
fig, ax = plt.subplots(figsize=(10, 6))
sns.boxplot(data=tips, x='day', y='total_bill', hue='sex', ax=ax)
# Note: passing ax= tells seaborn where to draw

plt.savefig('/tmp/seaborn_box.png')
plt.close()

print("Seaborn plots saved!")
```

### Seaborn Figure-Level vs Axes-Level

```python
# ============================================================
# SEABORN: FIGURE-LEVEL vs AXES-LEVEL FUNCTIONS
# ============================================================

import matplotlib.pyplot as plt
import seaborn as sns

tips = sns.load_dataset('tips')

# ------------------------------------------------------------
# AXES-LEVEL functions
# - Work on a single matplotlib axes
# - Return matplotlib Axes object
# - Can be passed an ax= parameter
# - Examples: scatterplot, lineplot, barplot, boxplot, histplot
# ------------------------------------------------------------

fig, axes = plt.subplots(1, 2, figsize=(12, 5))

# Axes-level: control exactly where it goes
sns.histplot(data=tips, x='total_bill', ax=axes[0])
axes[0].set_title('Axes-Level: histplot')

sns.boxplot(data=tips, x='day', y='total_bill', ax=axes[1])
axes[1].set_title('Axes-Level: boxplot')

plt.tight_layout()
plt.savefig('/tmp/seaborn_axes_level.png')
plt.close()

# ------------------------------------------------------------
# FIGURE-LEVEL functions
# - Create their own figure with potentially multiple axes
# - Return a FacetGrid or similar object
# - Cannot be passed ax= (they manage their own figure)
# - Examples: relplot, catplot, displot, lmplot, pairplot
# ------------------------------------------------------------

# Figure-level: manages its own figure
g = sns.displot(data=tips, x='total_bill', col='time', kind='hist')
print(f"Type: {type(g)}")  # FacetGrid
print(f"Figure: {g.figure}")
print(f"Axes array: {g.axes}")

g.savefig('/tmp/seaborn_figure_level.png')
plt.close()

# Key difference:
# - Axes-level: you control the figure, use fig.savefig()
# - Figure-level: it controls the figure, use g.savefig() or g.figure.savefig()
```

---

## 4. Plotly: Interactive HTML-Based Plots

```python
%pip install plotly
```

Plotly takes a completely different approach - it generates **HTML/JavaScript**.

```python
# ============================================================
# PLOTLY DISPLAY SYSTEM
# ============================================================

import plotly.graph_objects as go
import plotly.express as px
import numpy as np

# --- How Plotly Differs from Matplotlib ---
#
# Matplotlib: Python → Rasterize → PNG/Screen
# Plotly:     Python → JSON → JavaScript → Browser renders
#
# Plotly figures are actually JSON data that plotly.js interprets

# Create a simple figure
fig = go.Figure()
x = np.linspace(0, 10, 100)
fig.add_trace(go.Scatter(x=x, y=np.sin(x), name='sin(x)'))
fig.update_layout(title='Plotly Figure')

# See the underlying structure
print("Figure is JSON-serializable:")
print(f"Data traces: {len(fig.data)}")
print(f"Trace type: {fig.data[0].type}")

# --- Display Methods ---

# Method 1: Show in browser (opens new tab)
# fig.show()  # Opens browser with interactive plot

# Method 2: Save as static image (requires kaleido)
# fig.write_image('/tmp/plotly_static.png')

# Method 3: Save as HTML (self-contained interactive plot)
fig.write_html('/tmp/plotly_interactive.html', include_plotlyjs=True)
print("Saved interactive HTML to /tmp/plotly_interactive.html")

# Method 4: Get HTML string (for embedding)
html_str = fig.to_html(include_plotlyjs='cdn', full_html=False)
print(f"HTML string length: {len(html_str)} chars")

# Method 5: Get JSON (for API transmission)
json_str = fig.to_json()
print(f"JSON length: {len(json_str)} chars")
```

### Plotly Display Renderers

```python
# ============================================================
# PLOTLY RENDERERS - HOW DISPLAY WORKS
# ============================================================

import plotly.io as pio
import plotly.graph_objects as go
import numpy as np

# Plotly uses "renderers" to display figures
print("Available renderers:", pio.renderers)
print("Default renderer:", pio.renderers.default)

# Common renderers:
# - 'browser': Opens in web browser (default for scripts)
# - 'notebook': For Jupyter notebooks (inline)
# - 'jupyterlab': For JupyterLab
# - 'png': Renders as static PNG
# - 'svg': Renders as static SVG
# - 'json': Shows raw JSON

# Set default renderer
# pio.renderers.default = 'browser'

# Create figure
fig = go.Figure()
fig.add_trace(go.Scatter(
    x=np.linspace(0, 10, 50),
    y=np.random.randn(50).cumsum(),
    mode='lines+markers'
))

# Display with specific renderer
# fig.show(renderer='browser')   # Opens browser
# fig.show(renderer='png')       # Shows PNG inline (Jupyter)

# For headless/server environments, save to file:
fig.write_html('/tmp/plotly_fig.html')
print("Plotly figure saved!")
```

### Plotly Express (High-Level API)

```python
# ============================================================
# PLOTLY EXPRESS - QUICK PLOTS
# ============================================================

import plotly.express as px
import pandas as pd
import numpy as np

# Create sample data
np.random.seed(42)
df = pd.DataFrame({
    'x': range(100),
    'y': np.random.randn(100).cumsum(),
    'category': np.random.choice(['A', 'B', 'C'], 100),
    'size': np.random.uniform(5, 20, 100)
})

# Plotly Express returns standard plotly figures
fig = px.scatter(df, x='x', y='y', color='category', size='size',
                 title='Plotly Express Scatter')

print(f"Type: {type(fig)}")  # plotly.graph_objs.Figure

# Same display/save methods work
fig.write_html('/tmp/px_scatter.html')

# Interactive features are automatic:
# - Hover tooltips
# - Zoom/pan
# - Legend toggle
# - Download as PNG button

print("Express figure saved!")
```
 
---

## 5. IPython/Jupyter Display System

When running in IPython or Jupyter, there's a special display system.

```python
# ============================================================
# IPYTHON DISPLAY SYSTEM
# ============================================================

# IPython has a rich display system that visualization libraries use

from IPython.display import display, HTML, Image, SVG, Markdown

# --- How it works ---
#
# 1. Objects can define _repr_*_ methods:
#    - _repr_html_()    → HTML representation
#    - _repr_png_()     → PNG bytes
#    - _repr_svg_()     → SVG string
#    - _repr_latex_()   → LaTeX string
#    - _repr_json_()    → JSON dict
#
# 2. IPython chooses the best representation for the frontend
#
# 3. Jupyter/IPython frontends know how to render these

# --- Example: Display HTML ---
display(HTML("<h3 style='color: blue;'>Hello from HTML!</h3>"))

# --- Example: Display Image ---
# display(Image(filename='/tmp/figure.png'))

# --- Example: Display Markdown ---
display(Markdown("**Bold** and *italic* text"))

# --- How Matplotlib Integrates ---
# When you run %matplotlib inline in Jupyter:
# 1. It sets backend to 'module://matplotlib_inline.backend_inline'
# 2. plt.show() calls display(figure) instead of opening window
# 3. Figure's _repr_png_() method renders to PNG
# 4. Jupyter displays the PNG inline
```

### Matplotlib in IPython

```python
# ============================================================
# MATPLOTLIB + IPYTHON MAGIC
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

# In Jupyter, you'd run:
# %matplotlib inline     # PNG output, embedded in notebook
# %matplotlib widget    # Interactive widget (ipympl)
# %matplotlib qt        # Qt window (requires display)

# The inline backend works like this:

# 1. Creates a custom backend that hooks into IPython's display
# 2. When plt.show() is called:
#    a. Renders figure to PNG (or SVG based on config)
#    b. Calls IPython's display() with the image
#    c. Closes the figure

# Configuration for inline backend:
# from IPython import get_ipython
# ip = get_ipython()
# if ip:
#     ip.run_line_magic('matplotlib', 'inline')
#     # Configure inline backend
#     ip.run_line_magic('config', "InlineBackend.figure_format = 'retina'")

# Create a figure (this would display inline in Jupyter)
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 2])
ax.set_title('Inline Backend Demo')
plt.savefig('/tmp/inline_demo.png')
plt.close()

print("In Jupyter, this would display inline automatically!")
```

### Custom Display Objects

```python
# ============================================================
# CREATING CUSTOM DISPLAYABLE OBJECTS
# ============================================================

from IPython.display import display
import base64

class MyPlot:
    """A custom class that can display itself in IPython"""

    def __init__(self, data):
        self.data = data

    def _repr_html_(self):
        """HTML representation (rich)"""
        return f"""
        <div style="border: 2px solid blue; padding: 10px;">
            <h4>MyPlot Object</h4>
            <p>Data points: {len(self.data)}</p>
            <p>Range: {min(self.data):.2f} to {max(self.data):.2f}</p>
        </div>
        """

    def _repr_png_(self):
        """PNG representation (image)"""
        import matplotlib.pyplot as plt
        from io import BytesIO

        fig, ax = plt.subplots(figsize=(6, 4))
        ax.plot(self.data)
        ax.set_title('MyPlot Data')

        buf = BytesIO()
        fig.savefig(buf, format='png')
        plt.close(fig)
        buf.seek(0)
        return buf.getvalue()

    def _repr_latex_(self):
        """LaTeX representation (for math-heavy displays)"""
        return f"$\\text{{MyPlot with }} n={len(self.data)} \\text{{ points}}$"

# Usage
import numpy as np
plot = MyPlot(np.sin(np.linspace(0, 10, 100)))

# In IPython/Jupyter, just typing 'plot' would auto-display
# IPython chooses: HTML in notebook, PNG in qtconsole, etc.

# Explicit display
# display(plot)

print("Custom display class defined!")
print("HTML repr:", plot._repr_html_()[:100], "...")
```

---

## 6. How MRMD Handles Plots

MRMD uses a specific architecture to capture and display plots from executed Python code.

### The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User's Python Code                        │
│                  (plt.show(), plotly fig.show())             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  IPython Worker Process                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Matplotlib Hook (Agg backend)                       │    │
│  │  - Intercepts plt.show()                             │    │
│  │  - Saves figures as PNG (150 DPI)                    │    │
│  │  - Records filepath                                  │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Display Publisher                                   │    │
│  │  - Captures image/png (base64)                       │    │
│  │  - Captures image/svg+xml                            │    │
│  │  - Captures text/html (plotly, bokeh)                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Asset Storage                             │
│  /project/.mrmd/assets/                                     │
│    figure_0001.png                                          │
│    figure_0002.png                                          │
│    output_0001.html (for plotly/interactive)                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Display                          │
│  - PNG: <img src="/api/file/asset/...">                     │
│  - HTML: Rendered in iframe or directly                     │
│  - SVG: Inline SVG element                                  │
└─────────────────────────────────────────────────────────────┘
```

### MRMD's Matplotlib Hook (Simplified)

```python
# ============================================================
# HOW MRMD CAPTURES MATPLOTLIB PLOTS
# (Simplified version of actual implementation)
# ============================================================

import matplotlib
matplotlib.use('Agg')  # Non-interactive backend - no GUI!

import matplotlib.pyplot as plt
from pathlib import Path

# Storage for captured displays
captured_displays = []
figure_counter = 0
figure_dir = Path('/tmp/mrmd_figures')
figure_dir.mkdir(exist_ok=True)

# Save the original plt.show
_original_show = plt.show

def hooked_show(*args, **kwargs):
    """Custom plt.show() that saves instead of displaying"""
    global figure_counter

    # Get all open figures
    for fig_num in plt.get_fignums():
        fig = plt.figure(fig_num)

        # Generate filename
        figure_counter += 1
        filename = f"figure_{figure_counter:04d}.png"
        filepath = figure_dir / filename

        # Save the figure
        fig.savefig(
            filepath,
            dpi=150,
            bbox_inches='tight',
            facecolor='white',
            edgecolor='none'
        )

        # Record what was saved
        captured_displays.append({
            "data": {"saved_figure": str(filepath)},
            "metadata": {"mime_type": "image/png"}
        })

        print(f"[MRMD] Saved figure to {filepath}")

    # Always close figures to free memory
    plt.close('all')

# Replace plt.show with our hook
plt.show = hooked_show

# --- Test the hook ---
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
ax.set_title('MRMD Captured Plot')
plt.show()  # This now saves instead of displaying!

print(f"\nCaptured displays: {captured_displays}")
```

### MRMD's Display Capture (IPython Integration)

```python
# ============================================================
# HOW MRMD CAPTURES DISPLAY DATA
# (Simplified version of actual implementation)
# ============================================================

import base64
from io import BytesIO
from pathlib import Path

# This simulates what IPython's display_pub does
class CapturingDisplayPublisher:
    """Captures all display() calls instead of rendering"""

    def __init__(self):
        self.displays = []

    def publish(self, data, metadata=None):
        """Called whenever display() is used"""
        self.displays.append({
            "data": data,
            "metadata": metadata or {}
        })


def save_displays_to_files(displays, output_dir):
    """Save captured displays to files with priority handling"""
    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)
    saved = []
    counter = 0

    for display in displays:
        data = display.get("data", {})
        counter += 1

        # Priority: PNG > SVG > HTML
        if "image/png" in data:
            # PNG image (matplotlib, seaborn, etc.)
            filename = f"figure_{counter:04d}.png"
            filepath = output_dir / filename

            content = data["image/png"]
            if isinstance(content, str):
                # Base64 encoded
                content = base64.b64decode(content)

            filepath.write_bytes(content)
            saved.append({"path": str(filepath), "type": "image/png"})

        elif "image/svg+xml" in data:
            # SVG (some plotly, altair)
            filename = f"figure_{counter:04d}.svg"
            filepath = output_dir / filename

            content = data["image/svg+xml"]
            if isinstance(content, bytes):
                content = content.decode("utf-8")

            filepath.write_text(content)
            saved.append({"path": str(filepath), "type": "image/svg+xml"})

        elif "text/html" in data:
            # HTML (plotly, bokeh, folium)
            filename = f"output_{counter:04d}.html"
            filepath = output_dir / filename

            content = data["text/html"]

            # Wrap in full HTML document for standalone viewing
            html_doc = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>{content}</body>
</html>"""

            filepath.write_text(html_doc)
            saved.append({"path": str(filepath), "type": "text/html"})

    return saved

# --- Example ---
publisher = CapturingDisplayPublisher()

# Simulate what plotly does when you call fig.show() in IPython
plotly_html = '<div id="plotly-chart">...</div><script>Plotly.newPlot(...);</script>'
publisher.publish({"text/html": plotly_html})

# Simulate matplotlib inline
import matplotlib.pyplot as plt
import numpy as np

fig, ax = plt.subplots()
ax.plot(np.random.randn(100).cumsum())

buf = BytesIO()
fig.savefig(buf, format='png')
buf.seek(0)
png_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
plt.close(fig)

publisher.publish({"image/png": png_base64})

print(f"Captured {len(publisher.displays)} displays")

# Save to files
saved = save_displays_to_files(publisher.displays, '/tmp/mrmd_outputs')
print(f"Saved: {saved}")
```

---

## 7. Common Issues and Solutions

### Issue 1: No Display or Empty Window

```python
# ============================================================
# PROBLEM: plt.show() does nothing or shows empty window
# ============================================================

import matplotlib
import matplotlib.pyplot as plt

# SOLUTION 1: Check backend
print(f"Current backend: {matplotlib.get_backend()}")

# If backend is 'Agg', plt.show() won't open a window
# Fix: Set interactive backend BEFORE importing pyplot
# matplotlib.use('TkAgg')  # Must be before import matplotlib.pyplot

# SOLUTION 2: In scripts, figures might close immediately
# Add this to keep window open:
# plt.show(block=True)

# SOLUTION 3: If running in server/headless environment
# Use file output instead:
fig, ax = plt.subplots()
ax.plot([1, 2, 3])
fig.savefig('/tmp/output.png')
plt.close(fig)
print("Use savefig() in headless environments!")
```

### Issue 2: Multiple Figures Piling Up

```python
# ============================================================
# PROBLEM: Memory keeps growing, old figures not closed
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

# BAD: Creates new figure every iteration, never closes
# for i in range(100):
#     plt.figure()
#     plt.plot(np.random.randn(100))
#     plt.savefig(f'/tmp/fig_{i}.png')
# Result: 100 figures in memory!

# GOOD: Explicitly close figures
for i in range(5):
    fig, ax = plt.subplots()
    ax.plot(np.random.randn(100))
    fig.savefig(f'/tmp/fig_{i}.png')
    plt.close(fig)  # Free memory

print(f"Figures in memory: {len(plt.get_fignums())}")  # Should be 0

# ALSO GOOD: Reuse same figure
fig, ax = plt.subplots()
for i in range(5):
    ax.clear()  # Clear axes, keep figure
    ax.plot(np.random.randn(100))
    fig.savefig(f'/tmp/fig_reuse_{i}.png')
plt.close(fig)

print("Memory managed correctly!")
```

### Issue 3: Plots Not Updating in Interactive Mode

```python
# ============================================================
# PROBLEM: Plot doesn't update when data changes
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

# For interactive updating, you need to:
# 1. Turn on interactive mode
# 2. Use draw() or pause() to update

# plt.ion()  # Turn on interactive mode

fig, ax = plt.subplots()
line, = ax.plot([], [])
ax.set_xlim(0, 100)
ax.set_ylim(-3, 3)

# Simulate updating plot
data = []
for i in range(100):
    data.append(np.random.randn())
    line.set_data(range(len(data)), data)
    # fig.canvas.draw()
    # fig.canvas.flush_events()
    # plt.pause(0.01)  # Small pause to allow update

# plt.ioff()  # Turn off interactive mode
plt.savefig('/tmp/interactive_final.png')
plt.close()

print("Interactive mode requires a display!")
print("For animations, consider matplotlib.animation module")
```

### Issue 4: Plotly Not Showing in Jupyter

```python
# ============================================================
# PROBLEM: Plotly shows blank or doesn't display
# ============================================================

import plotly.graph_objects as go
import plotly.io as pio

# SOLUTION 1: Set correct renderer
# pio.renderers.default = 'notebook'  # For classic notebook
# pio.renderers.default = 'jupyterlab'  # For JupyterLab

# SOLUTION 2: Use write_html for guaranteed output
fig = go.Figure()
fig.add_trace(go.Scatter(x=[1, 2, 3], y=[1, 4, 2]))

# This always works:
fig.write_html('/tmp/plotly_debug.html')
print("If fig.show() fails, use write_html()")

# SOLUTION 3: Check if plotly.js is loaded
html_str = fig.to_html(include_plotlyjs='cdn')  # Use CDN
# Or: include_plotlyjs=True  # Embed full library (~3MB)

print("Renderer:", pio.renderers.default)
```

### Issue 5: Figure Size and DPI Issues

```python
# ============================================================
# PROBLEM: Figure is too small, blurry, or wrong size
# ============================================================

import matplotlib.pyplot as plt
import numpy as np

# Size is in inches, not pixels!
# Pixels = inches × DPI

# Example: Want 1200×800 pixels?
width_px, height_px = 1200, 800
dpi = 100
width_in = width_px / dpi
height_in = height_px / dpi

fig, ax = plt.subplots(figsize=(width_in, height_in), dpi=dpi)
ax.plot(np.random.randn(100).cumsum())
ax.set_title(f'Figure size: {width_px}×{height_px} pixels')

# Save with same DPI to maintain size
fig.savefig('/tmp/correct_size.png', dpi=dpi)

# Save with higher DPI for sharper image (larger file)
fig.savefig('/tmp/higher_dpi.png', dpi=200)

plt.close(fig)

print(f"Created {width_px}×{height_px} figure")
print("Higher DPI = sharper but larger file")
```


---

## Summary

| Library | Display Method | Output Format | Server/Headless Strategy |
| --- | --- | --- | --- |
| Matplotlib | `plt.show()` or `savefig()` | GUI window, PNG, SVG, PDF | Use `Agg` backend + `savefig()` |
| Seaborn | Same as matplotlib | Same as matplotlib | Same as matplotlib |
| Plotly | `fig.show()` or `write_html()` | Browser, HTML, JSON | Use `write_html()` or `to_json()` |
| Bokeh | `show()` or `save()` | Browser, HTML | Use `save()` to HTML |
| Altair | `chart.display()` | Browser, HTML, PNG | Use `chart.save()` |

**Key Takeaways:**

1. **Matplotlib uses backends** - `Agg` for servers, `TkAgg`/`QtAgg` for desktops
2. **Always close figures** - `plt.close(fig)` prevents memory leaks
3. **IPython captures display data** - PNG, SVG, HTML in `_repr_*_()` methods
4. **Plotly/Bokeh are HTML-based** - They generate JavaScript, not raster images
5. **MRMD hooks into plt.show()** - Saves to files instead of displaying

---

## 8. Quick Test Examples for MRMD

```python
import sys
print(sys.executable)
```

Run these code blocks to verify plotting works correctly in MRMD:

### Matplotlib Quick Test

```python
%pip install matplotlib 
```

```python
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
plt.figure(figsize=(8, 4))
plt.plot(x, np.sin(x), label='sin(x)')
plt.plot(x, np.cos(x), label='cos(x)')
plt.title('Matplotlib Test')
plt.legend()
plt.show()
```
```output
![output](.mrmd/assets/figure_0001.png)
```

### Plotly Quick Test

```python
%pip install plotly pandas nbformat
```
 d
 
```python
import plotly.express as px
import pandas as pd

df = pd.DataFrame({
    'x': range(20),
    'y': [i**2 for i in range(20)],
    'category': ['A' if i % 2 == 0 else 'B' for i in range(20)]
})

fig = px.scatter(df, x='x', y='y', color='category', title='Plotly Interactive Test')
fig.show()
```
```output
[View interactive output](.mrmd/assets/output_0002.html)
```
 
### Seaborn Quick Test

```python
%pip install seaborn
```

```python
import seaborn as sns
import matplotlib.pyplot as plt

tips = sns.load_dataset('tips')
plt.figure(figsize=(8, 4))
sns.boxplot(data=tips, x='day', y='total_bill', hue='sex')
plt.title('Seaborn Test')
plt.show()
```
```output
![output](.mrmd/assets/figure_0001.png)
```

### Base64 Image Test

```python
# This tests inline base64 image display
import matplotlib.pyplot as plt
import numpy as np
from io import BytesIO
import base64
from IPython.display import display, Image

fig, ax = plt.subplots(figsize=(6, 4))
ax.bar(['A', 'B', 'C', 'D'], [3, 7, 2, 5])
ax.set_title('Base64 Inline Image Test')

buf = BytesIO()
fig.savefig(buf, format='png', dpi=100)
buf.seek(0)
plt.close(fig)

# Display as IPython image (base64)
display(Image(data=buf.getvalue()))
```
 
HTML Table Test (Pandas DataFrame)
 
```python
import pandas as pd
import numpy as np

df = pd.DataFrame({
    'Name': ['Alice', 'Bob', 'Charlie', 'Diana'],
    'Age': [25, 30, 35, 28],
    'Score': [85.5, 92.3, 78.9, 95.1]
})

# This should render as a styled HTML table
df.style.highlight_max(color='lightgreen')
```
```output
<pandas.io.formats.style.Styler at 0x72436a942ad0>
<pandas.io.formats.style.Styler object at 0x72436a942ad0>
[View interactive output](.mrmd/assets/output_0004.html)
```

 
```python
df
```
```output
Name  Age  Score
0    Alice   25   85.5
1      Bob   30   92.3
2  Charlie   35   78.9
3    Diana   28   95.1
[View interactive output](.mrmd/assets/output_0005.html)
```

```python

```



 
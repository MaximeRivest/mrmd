# Plot Test

Testing matplotlib plotting in mrmd.

## Simple Line Plot

```python
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.figure(figsize=(8, 4))
plt.plot(x, y)
plt.title("Sine Wave")
plt.xlabel("x")
plt.ylabel("sin(x)")
plt.grid(True)
plt.show()
```
```output:exec-1767034172525-k0vl6
```

## Multiple Lines

```python
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2 * np.pi, 100)

plt.figure(figsize=(8, 4))
plt.plot(x, np.sin(x), label='sin(x)')
plt.plot(x, np.cos(x), label='cos(x)')
plt.legend()
plt.title("Trigonometric Functions")
plt.grid(True)
plt.show()
```
```output:exec-1767034173359-g1hod
```

## Scatter Plot

```python
import matplotlib.pyplot as plt
import numpy as np

np.random.seed(42)
x = np.random.randn(50)
y = np.random.randn(50)
colors = np.random.rand(50)

plt.figure(figsize=(6, 6))
plt.scatter(x, y, c=colors, cmap='viridis', s=100, alpha=0.7)
plt.colorbar()
plt.title("Random Scatter Plot")
plt.show()
```
```output:exec-1767034174003-08awa
```

## Bar Chart

```python
import matplotlib.pyplot as plt

categories = ['A', 'B', 'C', 'D', 'E']
values = [23, 45, 56, 78, 32]

plt.figure(figsize=(8, 4))
plt.bar(categories, values, color='steelblue')
plt.title("Bar Chart Example")
plt.ylabel("Values")
plt.show()
```
```output:exec-1767034174919-ijv79
```

```python

```

---

## Progress Bars

### tqdm Progress Bar

```python
from tqdm import tqdm
import time

for i in tqdm(range(50), desc="Processing"):
    time.sleep(0.05)
```
```output:exec-1767034687275-deqc0
Processing: 100% 50/50 [00:02<00:00, 19.90it/s]
```

### tqdm with Custom Format

```python
from tqdm import tqdm
import time

with tqdm(total=100, desc="Downloading", unit="MB") as pbar:
    for i in range(10):
        time.sleep(0.1)
        pbar.update(10)
```
```output:exec-1767034691882-0iqam
Downloading: 100% 100/100 [00:01<00:00, 99.68MB/s]
```

---

## Rich Library

### Rich Progress Bar

```python
from rich.progress import Progress
import time

with Progress() as progress:
    task = progress.add_task("[green]Processing...", total=100)
    while not progress.finished:
        progress.update(task, advance=2)
        time.sleep(0.05)
```
```output:exec-1767034694825-xgie5
[32mProcessing...[0m [38;2;114;156;31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[0m [35m100%[0m [36m0:00:00[0m
```

### Rich Console Output

```python
from rich.console import Console
from rich.table import Table

console = Console()
console.print("[bold red]Error:[/bold red] Something went wrong!")
console.print("[bold green]Success:[/bold green] Task completed!")
console.print("[italic blue]Info:[/italic blue] Processing data...")
```
```output:exec-1767034695759-67504
[1;31mError:[0m Something went wrong!
[1;32mSuccess:[0m Task completed!
[3;34mInfo:[0m Processing data[33m...[0m
```

### Rich Table

```python
from rich.console import Console
from rich.table import Table

console = Console()
table = Table(title="Sample Data")

table.add_column("Name", style="cyan")
table.add_column("Age", style="magenta")
table.add_column("City", style="green")

table.add_row("Alice", "30", "Paris")
table.add_row("Bob", "25", "London")
table.add_row("Charlie", "35", "Berlin")

console.print(table)
```
```output:exec-1767034699934-dbotn
[3m       Sample Data        [0m
┏━━━━━━━━━┳━━━━━┳━━━━━━━━┓
┃[1m Name    [0m┃[1m Age [0m┃[1m City   [0m┃
┡━━━━━━━━━╇━━━━━╇━━━━━━━━┩
│[36m Alice   [0m│[35m 30  [0m│[32m Paris  [0m│
│[36m Bob     [0m│[35m 25  [0m│[32m London [0m│
│[36m Charlie [0m│[35m 35  [0m│[32m Berlin [0m│
└─────────┴─────┴────────┘
```

### Rich Panel

```python
from rich.console import Console
from rich.panel import Panel

console = Console()
console.print(Panel("Hello from [bold magenta]Rich[/bold magenta]!", title="Welcome", subtitle="mrmd test"))
```
```output:exec-1767034701143-bt88b
╭────────────────────────────────── Welcome ───────────────────────────────────╮
│ Hello from [1;35mRich[0m!                                                             │
╰───────────────────────────────── mrmd test ──────────────────────────────────╯
```

---

## Live Output Tests

### Carriage Return Animation

```python
import time
import sys

symbols = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
for i in range(30):
    sys.stdout.write(f'\r{symbols[i % len(symbols)]} Loading... {i*3}%')
    sys.stdout.flush()
    time.sleep(0.1)
print('\r✓ Done!              ')
```
```output:exec-1767034704646-ty93i
✓ Done!              
```

### ANSI Color Output

```python
print("\033[31mRed text\033[0m")
print("\033[32mGreen text\033[0m")
print("\033[33mYellow text\033[0m")
print("\033[34mBlue text\033[0m")
print("\033[1m\033[35mBold Magenta\033[0m")
print("\033[4m\033[36mUnderlined Cyan\033[0m")
```
```output:exec-1767034707185-5cvfc
[31mRed text[0m
[32mGreen text[0m
[33mYellow text[0m
[34mBlue text[0m
[1;35mBold Magenta[0m
[4;36mUnderlined Cyan[0m
```

### Rich Live Display

```python
from rich.live import Live
from rich.table import Table
import time

def make_table(step):
    table = Table(title="Live Metrics")
    table.add_column("Metric")
    table.add_column("Value")
    table.add_row("Step", str(step))
    table.add_row("Progress", f"{step * 2}%")
    table.add_row("Status", "Running" if step < 50 else "Complete")
    return table

with Live(make_table(0), refresh_per_second=4) as live:
    for step in range(51):
        time.sleep(0.08)
        live.update(make_table(step))
```
```output:exec-1767034716355-hrp98
[3m     Live Metrics      [0m
┏━━━━━━━━━━┳━━━━━━━━━━┓
┃[1m Metric   [0m┃[1m Value    [0m┃
┡━━━━━━━━━━╇━━━━━━━━━━┩
│ Step     │ 50       │
│ Progress │ 100%     │
│ Status   │ Complete │
└──────────┴──────────┘
```

---

## Async Progress

```python
import asyncio
from tqdm.asyncio import tqdm_asyncio

async def fetch(n):
    await asyncio.sleep(0.03)
    return n * 2

async def main():
    tasks = [fetch(i) for i in range(50)]
    results = await tqdm_asyncio.gather(*tasks, desc="Async tasks")
    print(f"Sum: {sum(results)}")

asyncio.run(main())
```

---

## Inline Plot Display

Using IPython display to show plots inline:

```python
import matplotlib.pyplot as plt
import numpy as np
from IPython.display import display, SVG
import io
import base64

# Create a plot
fig, ax = plt.subplots(figsize=(6, 4))
x = np.linspace(0, 2*np.pi, 100)
ax.plot(x, np.sin(x), 'b-', label='sin(x)')
ax.plot(x, np.cos(x), 'r--', label='cos(x)')
ax.set_title('Inline Plot Test')
ax.legend()
ax.grid(True)

# Save to SVG for inline display
buf = io.StringIO()
fig.savefig(buf, format='svg')
buf.seek(0)
display(SVG(buf.getvalue()))
plt.close(fig)
```
```output:exec-1767034776421-98y7t
```

### Plot as PNG (base64)

```python
import matplotlib.pyplot as plt
import numpy as np
from IPython.display import display, Image
import io
import base64

fig, ax = plt.subplots(figsize=(6, 4))
theta = np.linspace(0, 4*np.pi, 200)
r = theta
ax.plot(theta * np.cos(theta), theta * np.sin(theta))
ax.set_title('Spiral')
ax.set_aspect('equal')

buf = io.BytesIO()
fig.savefig(buf, format='png', dpi=100)
buf.seek(0)
display(Image(data=buf.getvalue()))
plt.close(fig)
```
```output:exec-1767034779349-m02qn
```

```python

```

### Plot as HTML img tag

```python
import matplotlib.pyplot as plt
import numpy as np
import io
import base64
from IPython.display import display, HTML

fig, ax = plt.subplots(figsize=(6, 4))
x = np.linspace(0, 10, 100)
ax.plot(x, np.sin(x), 'b-', linewidth=2)
ax.set_title('Sin Wave - HTML Embed')
ax.grid(True)

buf = io.BytesIO()
fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
buf.seek(0)
img_base64 = base64.b64encode(buf.read()).decode('utf-8')
plt.close(fig)

html = f'<img src="data:image/png;base64,{img_base64}" />'
display(HTML(html))
```
```output:exec-1767034874872-wthnw
```

### Direct print of HTML

```python
import matplotlib.pyplot as plt
import numpy as np
import io
import base64

fig, ax = plt.subplots(figsize=(5, 3))
ax.bar(['A', 'B', 'C'], [3, 7, 5], color=['red', 'green', 'blue'])
ax.set_title('Bar Chart')

buf = io.BytesIO()
fig.savefig(buf, format='png', dpi=80, bbox_inches='tight')
buf.seek(0)
img_base64 = base64.b64encode(buf.read()).decode('utf-8')
plt.close(fig)

print(f'<img src="data:image/png;base64,{img_base64}" />')
```
```output:exec-1767034877087-wmngm
<img src="data:image/png;base64,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" />
```

```python

```


---

> **Note:** Test results:
>
> **Working:**
> - tqdm progress bars with live updates
> - Rich library components (tables, panels, progress bars, styled text)
> - ANSI color codes
> - Carriage return animations
>
> **TODO - Not yet wired up:**
> - `display(HTML(...))` - empty output (need to handle `display_data` mime type `text/html`)
> - `display(Image(...))` - empty output (need to handle `image/png` mime type)
> - `display(SVG(...))` - empty output (need to handle `image/svg+xml` mime type)
> - matplotlib plots - need to hook into display system
> - Async operations with progress tracking
>
> *Generated on 2025-12-29*

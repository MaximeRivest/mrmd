# Plot Test

Testing matplotlib plotting in mrmd.

allo kek chose
allo 
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
```image-output:exec-1767062130698-vj2kc
![Figure 1](/api/file/asset/home/maxime/Projects/mrmd/.mrmd/assets/figure_0001.png)
```
```output:exec-1767058956651-1swn5
```


do you see my messagbe? ouiiii


 i love you! 
 HIIHHIHIHIIHIIII 

 

 

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
```output:exec-1767062223689-g9dvi
```
```image-output:exec-1767062223689-g9dvi
![Figure 1](/api/file/asset/home/maxime/Projects/mrmd/.mrmd/assets/figure_0003.png)
```

do you see my messagbe? ouiiii


 i love you! 
 HIIHHIHIHIIHIIII 

 

 

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
```output:exec-1767062226684-2lzgj
```
```image-output:exec-1767062226684-2lzgj
![Figure 1](/api/file/asset/home/maxime/Projects/mrmd/.mrmd/assets/figure_0004.png)
```

## Scatter P

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
```output:exec-1767062230337-jmghk
```
```image-output:exec-1767062230337-jmghk
![Figure 1](/api/file/asset/home/maxime/Projects/mrmd/.mrmd/assets/figure_0005.png)
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
```output:exec-1767062320594-iwwao
```
```image-output:exec-1767062320594-iwwao
![Figure 1](/api/file/asset/home/maxime/Projects/mrmd/.mrmd/assets/figure_0001.png)
```

```python

```

---

## Progress Bars

### tqdm Progress Bar


you see this
yes hellooooo


```python
from tqdm import tqdm
import time

for i in tqdm(range(50), desc="Processing"):
    time.sleep(0.05)
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

### Rich Console Output

```python
from rich.console import Console
from rich.table import Table

console = Console()
console.print("[bold red]Error:[/bold red] Something went wrong!")
console.print("[bold green]Success:[/bold green] Task completed!")
console.print("[italic blue]Info:[/italic blue] Processing data...")
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

### Rich Panel

```python
from rich.console import Console
from rich.panel import Panel

console = Console()
console.print(Panel("Hello from [bold magenta]Rich[/bold magenta]!", title="Welcome", subtitle="mrmd test"))
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

### ANSI Color Output

```python
print("\033[31mRed text\033[0m")
print("\033[32mGreen text\033[0m")
print("\033[33mYellow text\033[0m")
print("\033[34mBlue text\033[0m")
print("\033[1m\033[35mBold Magenta\033[0m")
print("\033[4m\033[36mUnderlined Cyan\033[0m")
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


```python
import matplotlib.pyplot as plt
plt.plot([1, 2, 3, 4])
plt.title("Test Plot")
plt.show()
```

and here is a test for plotly and here is a test for plotly 

```python
%add  plotly nbformat
```

```python
import plotly.graph_objects as go
import numpy as np

# Create sample data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Create interactive plotly figure
fig = go.Figure(data=go.Scatter(x=x, y=y, mode='lines', name='sin(x)'))
fig.update_layout(title='Interactive Plotly Plot', xaxis_title='x', yaxis_title='sin(x)')
fig.show()
```i

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
> - Plotly interactive plots
>
> **TODO - Not yet wired up:**
> - `display(HTML(...))` - empty output (need to handle `display_data` mime type `text/html`)
> - `display(Image(...))` - empty output (need to handle `image/png` mime type)
> - `display(SVG(...))` - empty output (need to handle `image/svg+xml` mime type)
> - matplotlib plots - need to hook into display system
> - Async operations with progress tracking
>
> *Generated on 2025-12-29*




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

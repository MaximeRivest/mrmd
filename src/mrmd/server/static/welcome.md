# Welcome to MRMD

**Markdown that runs.** MRMD is a literate programming environment where your markdown files become executable notebooks.

## Quick Start

Run code by pressing `Shift+Enter` in a code block:

```python
# Try it! Press Shift+Enter to run this cell
message = "Hello from MRMD!"
print(message)
```

## Features

### Live Code Execution

Write Python code in fenced code blocks and execute them inline. Output appears right below:

```python
# Math expressions
import math
radius = 5
area = math.pi * radius ** 2
print(f"Circle area: {area:.2f}")
```

### Rich Output

MRMD supports rich output including plots, dataframes, and more:

```python
# Create some data
data = [1, 4, 9, 16, 25, 36, 49]
print("Squares:", data)

# If you have matplotlib installed:
# import matplotlib.pyplot as plt
# plt.plot(data)
# plt.title("Square numbers")
# plt.show()
```

### Session Management

Your code runs in an IPython session that persists across cells. Variables defined in one cell are available in others:

```python
# This uses 'message' from the first cell
print(f"Previous message: {message}")
print(f"Previous area: {area:.2f}")
```

### Package Management

Install packages using `%pip`:

```python
# %pip install pandas numpy matplotlib
# (Uncomment and run to install)
```

## Navigation

- **Projects tab**: Open or create projects with their own virtual environments
- **Files tab**: Browse and open markdown files
- **Variables tab**: Inspect your session variables
- **Session indicator** (bottom left): Click to switch environments

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift+Enter` | Run current code block |
| `Ctrl+Enter` | Run block, stay in block |
| `Ctrl+S` | Save file |
| `Ctrl+P` | Open file browser |
| `Tab` | Autocomplete |
| `Shift+Tab` | Show documentation |
| `Escape` | Exit focus mode |

## Next Steps

1. **Create a project**: Click the Projects tab and create a new project
2. **Open a file**: Browse to a `.md` file and start editing
3. **Experiment**: This welcome page is read-only, but your own files are fully editable

---

*MRMD - Where markdown meets execution*

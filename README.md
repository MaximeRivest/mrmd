# mrmd

Collaborative markdown notebooks - edit and run code together.

## Quick Start

```bash
# Run directly with uvx (no install needed)
uvx mrmd

# Or install and run
pip install mrmd
mrmd
```

## What it does

`mrmd` opens a collaborative markdown editor in your browser. You can:

- Write markdown with live preview
- Add executable code blocks (Python, JavaScript, etc.)
- Collaborate in real-time with others
- Run code and see output inline

## Usage

```bash
# Open editor in current project
mrmd

# Use custom docs directory
mrmd --docs ./notes

# Use custom port
mrmd --port 3000

# Don't open browser automatically
mrmd --no-browser
```

## How it works

mrmd automatically detects your project root by looking for common markers:
- `.git` - Git repository
- `.venv` - Python virtual environment
- `pyproject.toml` - Python project
- `package.json` - Node.js project
- etc.

It then:
1. Starts a sync server for real-time collaboration (Yjs/CRDT)
2. Starts a Python runtime for code execution
3. Serves the editor UI
4. Opens your browser

Documents are saved to the `docs/` directory in your project (or `notebooks/`, `notes/` if they exist).

## Development

```bash
# Clone the repo
git clone https://github.com/anthropics/mrmd-packages
cd mrmd-packages/mrmd

# Install in development mode
uv pip install -e .

# Run
mrmd
```

## License

MIT

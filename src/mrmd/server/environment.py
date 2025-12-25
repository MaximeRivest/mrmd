"""
MRMD Environment Management

Handles:
- Global MRMD config (~/.mrmd/)
- Project management (each project has its own .venv and .mrmd/sessions/)
- Default "Scratch" project for loose notebooks
"""

import json
import re
import subprocess
import shutil
import sys
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime


# MRMD home directory (config only, no venv)
MRMD_HOME = Path.home() / ".mrmd"
CONFIG_FILE = MRMD_HOME / "config.json"
RECENT_PROJECTS_FILE = MRMD_HOME / "recent_projects.json"
RECENT_NOTEBOOKS_FILE = MRMD_HOME / "recent_notebooks.json"

# Default projects directory
DEFAULT_PROJECTS_DIR = Path.home() / "Projects"
DEFAULT_SCRATCH_NAME = "Scratch"


def ensure_mrmd_in_gitignore(project_path: Path) -> bool:
    """
    Ensure .mrmd/ is listed in the project's .gitignore.

    If .gitignore exists, appends .mrmd/ if not already present.
    If .gitignore doesn't exist, creates it with .mrmd/.

    Args:
        project_path: Path to the project root

    Returns:
        True if .gitignore was modified or created, False if already had .mrmd/
    """
    gitignore_path = project_path / ".gitignore"
    mrmd_pattern = ".mrmd/"

    try:
        if gitignore_path.exists():
            content = gitignore_path.read_text()
            lines = content.splitlines()

            # Check if .mrmd/ or .mrmd is already ignored
            for line in lines:
                stripped = line.strip()
                if stripped in (".mrmd/", ".mrmd", "/.mrmd/", "/.mrmd"):
                    return False  # Already ignored

            # Append .mrmd/ to existing .gitignore
            # Add newline if file doesn't end with one
            if content and not content.endswith("\n"):
                content += "\n"
            content += f"\n# MRMD editor state (auto-added)\n{mrmd_pattern}\n"
            gitignore_path.write_text(content)
            return True
        else:
            # Create new .gitignore with .mrmd/
            gitignore_path.write_text(f"# MRMD editor state\n{mrmd_pattern}\n")
            return True
    except (OSError, IOError) as e:
        # Don't fail project creation if gitignore can't be written
        print(f"Warning: Could not update .gitignore: {e}")
        return False


def get_mrmd_home() -> Path:
    """Get the MRMD home directory path."""
    return MRMD_HOME


def get_config() -> Dict[str, Any]:
    """Get the user configuration."""
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text())
    except:
        return {}


def set_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Update the user configuration."""
    config = get_config()
    config.update(updates)
    config["updated"] = datetime.now().isoformat()

    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
        return {"success": True, "config": config}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_default_project_path() -> Path:
    """Get the path to the default (Scratch) project."""
    config = get_config()
    if "default_project" in config:
        return Path(config["default_project"])
    return DEFAULT_PROJECTS_DIR / DEFAULT_SCRATCH_NAME


def get_uv_path() -> Optional[str]:
    """Get the path to the uv executable."""
    return shutil.which("uv")


def get_project_venv_python(project_path: str) -> Optional[str]:
    """Get the Python executable path for a project's venv."""
    project = Path(project_path)

    # Check common venv locations
    venv_names = [".venv", "venv", ".env", "env"]
    for venv_name in venv_names:
        venv_path = project / venv_name
        if venv_path.is_dir():
            if sys.platform == "win32":
                python_path = venv_path / "Scripts" / "python.exe"
            else:
                python_path = venv_path / "bin" / "python"

            if python_path.exists():
                return str(python_path)

    return None


def is_mrmd_initialized() -> bool:
    """Check if MRMD is properly initialized."""
    if not MRMD_HOME.exists():
        return False
    if not CONFIG_FILE.exists():
        return False

    config = get_config()
    if "initialized" not in config or not config["initialized"]:
        return False

    # Check that default project exists and has a venv
    default_project = get_default_project_path()
    if not default_project.exists():
        return False

    if not get_project_venv_python(str(default_project)):
        return False

    return True


def ensure_mrmd_home() -> bool:
    """
    Create the ~/.mrmd directory structure if it doesn't exist.
    Returns True if successful.
    """
    try:
        MRMD_HOME.mkdir(parents=True, exist_ok=True)

        # Create recent projects file if not exists
        if not RECENT_PROJECTS_FILE.exists():
            RECENT_PROJECTS_FILE.write_text(json.dumps([], indent=2))

        return True
    except Exception as e:
        print(f"Error creating MRMD home: {e}")
        return False


def create_project(name: str, parent_dir: Optional[str] = None, template: str = "analyst") -> Dict[str, Any]:
    """
    Create a new MRMD project.

    Args:
        name: Project name
        parent_dir: Parent directory (default: ~/Projects)
        template: Project template - "writer", "analyst", or "pythonista"

    Templates:
    - writer: Flat structure, just venv + files, no pyproject.toml
    - analyst: Flat notebooks, src/ for utils, data/, pyproject.toml
    - pythonista: Full src layout package for development/distribution
    """
    result = {
        "success": False,
        "message": "",
        "project_path": None,
        "venv_path": None,
        "python_path": None,
    }

    # Determine parent directory
    if parent_dir:
        parent = Path(parent_dir)
    else:
        config = get_config()
        parent = Path(config.get("projects_directory", str(DEFAULT_PROJECTS_DIR)))

    # Create parent if needed
    parent.mkdir(parents=True, exist_ok=True)

    # Project path
    project_path = parent / name
    if project_path.exists():
        # Check if it's already a valid project
        if get_project_venv_python(str(project_path)):
            result["success"] = True
            result["message"] = f"Project '{name}' already exists"
            result["project_path"] = str(project_path)
            result["venv_path"] = str(project_path / ".venv")
            result["python_path"] = get_project_venv_python(str(project_path))
            return result
        else:
            result["message"] = f"Directory exists but is not a valid project: {project_path}"
            return result

    # Check for uv
    uv_path = get_uv_path()
    if not uv_path:
        result["message"] = "uv not found. Please install uv first: https://docs.astral.sh/uv/"
        return result

    try:
        # Create project directory
        project_path.mkdir(parents=True)

        # Create .mrmd/sessions/ directory for this project
        sessions_dir = project_path / ".mrmd" / "sessions"
        sessions_dir.mkdir(parents=True, exist_ok=True)

        # Ensure .mrmd/ is in .gitignore
        ensure_mrmd_in_gitignore(project_path)

        # Convert project name to valid Python package name (for pythonista template)
        pkg_name = name.replace("-", "_").replace(" ", "_").lower()

        # Template-specific setup
        if template == "writer":
            # Writer/Academic: Flat structure, just venv + files
            # No pyproject.toml - use %pip install for packages
            subprocess.run(
                [uv_path, "venv"],
                cwd=str(project_path),
                check=True,
                capture_output=True,
                text=True,
            )

            venv_python = project_path / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / "python"
            if venv_python.exists():
                subprocess.run(
                    [uv_path, "pip", "install", "-p", str(venv_python), "ipython"],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            # Create main notebook (flat, at root)
            notebook_content = f"""# {name}

Welcome to your notebook! Just write and run code.

```python
# Install packages as needed
%pip install numpy pandas matplotlib
```

```python
# Then use them
import numpy as np
print("Hello from {name}!")
```

## Notes

Write your thoughts here...

```python
# More code
```
"""
            (project_path / "notes.md").write_text(notebook_content)

            # Simple README
            readme_content = f"""# {name}

Just write and run code. Install packages with `%pip install`:

```python
%pip install pandas matplotlib
```

Then import and use them.
"""
            (project_path / "README.md").write_text(readme_content)

        elif template == "analyst":
            # Data Analyst: Flat notebooks, src/ for utils, pyproject.toml
            subprocess.run(
                [uv_path, "init"],
                cwd=str(project_path),
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [uv_path, "venv"],
                cwd=str(project_path),
                check=True,
                capture_output=True,
                text=True,
            )

            # Remove hello.py from uv init
            hello_py = project_path / "hello.py"
            if hello_py.exists():
                hello_py.unlink()

            venv_python = project_path / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / "python"
            if venv_python.exists():
                subprocess.run(
                    [uv_path, "pip", "install", "-p", str(venv_python), "ipython"],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            # Create src/ for shared utilities
            src_dir = project_path / "src"
            src_dir.mkdir(exist_ok=True)

            utils_content = '''"""
Shared utilities - import with: from utils import *
"""

def load_csv(path: str):
    """Load a CSV file."""
    import pandas as pd
    return pd.read_csv(path)


def describe(df) -> None:
    """Print a summary of a DataFrame."""
    print(f"Shape: {df.shape[0]} rows × {df.shape[1]} columns")
    print(f"Columns: {list(df.columns)}")
'''
            (src_dir / "utils.py").write_text(utils_content)

            # Create data directory
            (project_path / "data").mkdir(exist_ok=True)
            (project_path / "data" / ".gitkeep").write_text("")

            # Create main notebook (flat, at root)
            notebook_content = f"""# {name}

## Setup

```python
from utils import load_csv, describe
```

## Add Packages

```python
# Track dependencies in pyproject.toml
%add pandas numpy matplotlib
```

## Analysis

```python
# df = load_csv("data/your_file.csv")
# describe(df)
```

```python
# Your analysis here
```
"""
            (project_path / "analysis.md").write_text(notebook_content)

            # README explaining the pattern
            readme_content = f"""# {name}

## Adding Packages

Use `%add` to install and track dependencies:

```python
%add pandas numpy matplotlib
```

This runs `uv add` and updates `pyproject.toml`.

## Shared Code

Put utilities in `src/utils.py` and import them:

```python
from utils import load_csv, describe
```

Changes auto-reload - just edit and re-run.

## Structure

```
{name}/
├── analysis.md     # Your notebooks (flat at root)
├── src/
│   └── utils.py    # Shared code
├── data/           # Data files
├── pyproject.toml  # Dependencies
└── .venv/
```
"""
            (project_path / "README.md").write_text(readme_content)

        else:  # pythonista
            # Full package development setup
            subprocess.run(
                [uv_path, "init"],
                cwd=str(project_path),
                check=True,
                capture_output=True,
                text=True,
            )
            subprocess.run(
                [uv_path, "venv"],
                cwd=str(project_path),
                check=True,
                capture_output=True,
                text=True,
            )

            # Remove hello.py
            hello_py = project_path / "hello.py"
            if hello_py.exists():
                hello_py.unlink()

            # Create src layout package
            src_dir = project_path / "src" / pkg_name
            src_dir.mkdir(parents=True, exist_ok=True)

            init_content = f'''"""
{name} - A Python package.
"""

__version__ = "0.1.0"


def hello() -> str:
    """Return a greeting."""
    return "Hello from {pkg_name}!"
'''
            (src_dir / "__init__.py").write_text(init_content)

            # Update pyproject.toml for src layout
            pyproject = project_path / "pyproject.toml"
            if pyproject.exists():
                content = pyproject.read_text()
                # Ensure package name matches the Python module name (underscores, not hyphens)
                content = re.sub(
                    r'^name = "[^"]*"',
                    f'name = "{pkg_name}"',
                    content,
                    flags=re.MULTILINE
                )
                # Add build-system (required for editable installs)
                if "[build-system]" not in content:
                    content = '''[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

''' + content
                # Add setuptools config for src layout
                if "[tool.setuptools" not in content:
                    content += f'''
[tool.setuptools.packages.find]
where = ["src"]
'''
                pyproject.write_text(content)

            venv_python = project_path / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / "python"
            if venv_python.exists():
                subprocess.run(
                    [uv_path, "pip", "install", "-p", str(venv_python), "ipython", "pytest"],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                # Install package in editable mode
                subprocess.run(
                    [uv_path, "pip", "install", "-p", str(venv_python), "-e", str(project_path)],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            # Create notebooks directory (pythonista needs separation)
            notebooks_dir = project_path / "notebooks"
            notebooks_dir.mkdir(exist_ok=True)

            notebook_content = f"""# {name} - Development

```python
from {pkg_name} import hello
print(hello())
```

Edit `src/{pkg_name}/` and changes auto-reload.

```python
# Run tests
!pytest tests/
```
"""
            (notebooks_dir / "dev.md").write_text(notebook_content)

            # Create tests directory
            tests_dir = project_path / "tests"
            tests_dir.mkdir(exist_ok=True)
            test_content = f'''"""Tests for {pkg_name}."""

from {pkg_name} import hello


def test_hello():
    assert hello() == "Hello from {pkg_name}!"
'''
            (tests_dir / f"test_{pkg_name}.py").write_text(test_content)

            # README
            readme_content = f"""# {name}

A Python package.

## Usage

```python
from {pkg_name} import hello
print(hello())
```

## Development

Installed in editable mode. Edit `src/{pkg_name}/` and changes auto-reload.

```bash
pytest tests/      # Run tests
uv add requests    # Add dependency
uv build           # Build package
```

## Structure

```
{name}/
├── src/{pkg_name}/   # Package code
├── tests/            # Tests
├── notebooks/        # Dev notebooks
├── pyproject.toml
└── .venv/
```
"""
            (project_path / "README.md").write_text(readme_content)

        result["success"] = True
        result["message"] = f"Project '{name}' created successfully"
        result["project_path"] = str(project_path)
        result["venv_path"] = str(project_path / ".venv")
        result["python_path"] = str(venv_python)

        # Add to recent projects
        add_recent_project(str(project_path), name)

    except subprocess.CalledProcessError as e:
        result["message"] = f"Failed to initialize project: {e.stderr}"
        # Clean up on failure
        if project_path.exists():
            shutil.rmtree(project_path, ignore_errors=True)
    except Exception as e:
        result["message"] = f"Error creating project: {str(e)}"
        if project_path.exists():
            shutil.rmtree(project_path, ignore_errors=True)

    return result


def initialize_mrmd(scratch_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Full initialization of MRMD environment.

    Args:
        scratch_path: Custom path for the default Scratch project.
                     Defaults to ~/Projects/Scratch/

    Creates:
    - ~/.mrmd/ with config
    - Default Scratch project with venv
    """
    # Determine scratch project path
    if scratch_path:
        default_project = Path(scratch_path)
    else:
        default_project = DEFAULT_PROJECTS_DIR / DEFAULT_SCRATCH_NAME

    result = {
        "success": False,
        "message": "",
        "mrmd_home": str(MRMD_HOME),
        "default_project": str(default_project),
        "python_path": None,
        "projects_directory": str(default_project.parent),
    }

    # Check for uv first
    uv_path = get_uv_path()
    if not uv_path:
        result["message"] = "uv not found. Please install uv first: https://docs.astral.sh/uv/"
        return result

    # Create MRMD home
    if not ensure_mrmd_home():
        result["message"] = "Failed to create MRMD home directory"
        return result

    # Create the default Scratch project
    project_result = create_project(default_project.name, str(default_project.parent))
    if not project_result["success"]:
        result["message"] = project_result["message"]
        return result

    result["python_path"] = project_result["python_path"]

    # Save config with initialization flag and default project path
    config = {
        "version": 1,
        "initialized": True,
        "created": datetime.now().isoformat(),
        "default_project": str(default_project),
        "projects_directory": str(default_project.parent),
        "theme": "dark",
        "auto_save": True,
        "show_welcome": True,
    }
    CONFIG_FILE.write_text(json.dumps(config, indent=2))

    result["success"] = True
    result["message"] = "MRMD initialized successfully"

    return result


def get_mrmd_status() -> Dict[str, Any]:
    """
    Get the current status of MRMD initialization.
    """
    initialized = is_mrmd_initialized()
    config = get_config()
    default_project = get_default_project_path()

    status = {
        "initialized": initialized,
        "mrmd_home": str(MRMD_HOME),
        "mrmd_home_exists": MRMD_HOME.exists(),
        "default_project": str(default_project),
        "default_project_exists": default_project.exists(),
        "default_python": get_project_venv_python(str(default_project)) if default_project.exists() else None,
        "uv_available": get_uv_path() is not None,
        "uv_path": get_uv_path(),
        "projects_directory": config.get("projects_directory", str(DEFAULT_PROJECTS_DIR)),
        "suggested_scratch_path": str(DEFAULT_PROJECTS_DIR / DEFAULT_SCRATCH_NAME),
    }

    # Add config if exists
    if config:
        status["config"] = config
    else:
        status["config"] = None

    return status


# ==================== Recent Projects ====================

# Cache for notebook lists: project_path -> {"files": [...], "mtime": timestamp}
_notebook_cache: Dict[str, Dict[str, Any]] = {}


def _get_excluded_dirs() -> set:
    """Get the set of directory names to exclude from notebook search."""
    return {
        "node_modules", "__pycache__", ".cache", ".npm", ".cargo",
        ".local", ".git", ".venv", "venv", ".tox", ".pytest_cache",
        ".mypy_cache", ".mrmd", ".vscode", ".idea", "dist", "build",
    }


def list_notebooks_in_project(project_path: str, use_cache: bool = True) -> List[str]:
    """
    List all .md notebook files in a project directory.

    Uses recursive search with same exclusions as file search API.
    Results are cached and invalidated by file watcher.

    Args:
        project_path: Path to the project directory
        use_cache: Whether to use cached results (default True)

    Returns:
        List of absolute paths to .md files
    """
    global _notebook_cache

    path = Path(project_path).resolve()
    cache_key = str(path)

    # Check cache
    if use_cache and cache_key in _notebook_cache:
        return _notebook_cache[cache_key]["files"]

    if not path.exists():
        return []

    excluded_dirs = _get_excluded_dirs()
    notebooks = []

    def scan_dir(dir_path: Path):
        """Recursively scan directory for .md files."""
        try:
            for entry in dir_path.iterdir():
                # Skip hidden files/dirs (starting with .)
                if entry.name.startswith('.'):
                    continue
                # Skip excluded directories
                if entry.is_dir():
                    if entry.name in excluded_dirs:
                        continue
                    scan_dir(entry)
                elif entry.is_file() and entry.suffix.lower() == '.md':
                    notebooks.append(str(entry))
        except PermissionError:
            pass

    scan_dir(path)

    # Sort by path for consistent ordering
    notebooks.sort()

    # Update cache
    _notebook_cache[cache_key] = {
        "files": notebooks,
        "mtime": datetime.now().timestamp(),
    }

    return notebooks


def invalidate_notebook_cache(project_path: str = None):
    """
    Invalidate the notebook cache for a project.

    Args:
        project_path: Path to invalidate, or None to invalidate all
    """
    global _notebook_cache

    if project_path is None:
        _notebook_cache.clear()
    else:
        path = Path(project_path).resolve()
        cache_key = str(path)
        if cache_key in _notebook_cache:
            del _notebook_cache[cache_key]
        # Also invalidate parent projects that might contain this path
        to_remove = []
        for key in _notebook_cache:
            if str(path).startswith(key + "/"):
                to_remove.append(key)
        for key in to_remove:
            del _notebook_cache[key]


def count_notebooks_in_project(project_path: str) -> int:
    """Count .md notebook files in a project directory using consistent recursive search."""
    return len(list_notebooks_in_project(project_path))


def get_recent_projects() -> List[Dict[str, Any]]:
    """Get the list of recent projects with notebook counts."""
    if not RECENT_PROJECTS_FILE.exists():
        return []
    try:
        projects = json.loads(RECENT_PROJECTS_FILE.read_text())
        # Enrich with notebook counts
        for project in projects:
            project["notebook_count"] = count_notebooks_in_project(project.get("path", ""))
        return projects
    except:
        return []


def add_recent_project(project_path: str, project_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Add a project to the recent projects list."""
    projects = get_recent_projects()

    # Remove if already exists
    projects = [p for p in projects if p.get("path") != project_path]

    # Add to front
    project_entry = {
        "path": project_path,
        "name": project_name or Path(project_path).name,
        "last_opened": datetime.now().isoformat(),
    }
    projects.insert(0, project_entry)

    # Keep only last 20
    projects = projects[:20]

    try:
        RECENT_PROJECTS_FILE.write_text(json.dumps(projects, indent=2))
    except:
        pass

    return projects


def remove_recent_project(project_path: str) -> List[Dict[str, Any]]:
    """Remove a project from the recent projects list."""
    projects = get_recent_projects()
    projects = [p for p in projects if p.get("path") != project_path]

    try:
        RECENT_PROJECTS_FILE.write_text(json.dumps(projects, indent=2))
    except:
        pass

    return projects


# ==================== Recent Notebooks ====================


def get_recent_notebooks() -> List[Dict[str, Any]]:
    """Get the list of recent notebooks."""
    if not RECENT_NOTEBOOKS_FILE.exists():
        return []
    try:
        notebooks = json.loads(RECENT_NOTEBOOKS_FILE.read_text())
        return notebooks
    except:
        return []


def add_recent_notebook(
    notebook_path: str,
    overview: str = "",
    project_path: Optional[str] = None,
    project_name: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Add a notebook to the recent notebooks list."""
    notebooks = get_recent_notebooks()

    # Remove if already exists
    notebooks = [n for n in notebooks if n.get("path") != notebook_path]

    # Add to front
    notebook_entry = {
        "path": notebook_path,
        "name": Path(notebook_path).name,
        "overview": overview,
        "projectPath": project_path or "",
        "projectName": project_name or "",
        "timestamp": datetime.now().isoformat(),
    }
    notebooks.insert(0, notebook_entry)

    # Keep only last 30
    notebooks = notebooks[:30]

    try:
        RECENT_NOTEBOOKS_FILE.write_text(json.dumps(notebooks, indent=2))
    except:
        pass

    return notebooks


def remove_recent_notebook(notebook_path: str) -> List[Dict[str, Any]]:
    """Remove a notebook from the recent notebooks list."""
    notebooks = get_recent_notebooks()
    notebooks = [n for n in notebooks if n.get("path") != notebook_path]

    try:
        RECENT_NOTEBOOKS_FILE.write_text(json.dumps(notebooks, indent=2))
    except:
        pass

    return notebooks


def clear_recent_notebooks() -> List[Dict[str, Any]]:
    """Clear all recent notebooks."""
    try:
        RECENT_NOTEBOOKS_FILE.write_text(json.dumps([], indent=2))
    except:
        pass
    return []


# ==================== Venv Detection ====================


def detect_venv_in_directory(directory: str) -> Optional[Dict[str, Any]]:
    """
    Detect a Python venv in a directory.
    Returns venv info if found, None otherwise.
    """
    dir_path = Path(directory)

    # Common venv directory names
    venv_names = [".venv", "venv", ".env", "env"]

    for venv_name in venv_names:
        venv_path = dir_path / venv_name
        if venv_path.is_dir():
            # Check for Python executable
            if sys.platform == "win32":
                python_path = venv_path / "Scripts" / "python.exe"
            else:
                python_path = venv_path / "bin" / "python"

            if python_path.exists():
                # Get Python version
                try:
                    result = subprocess.run(
                        [str(python_path), "--version"],
                        capture_output=True,
                        text=True,
                    )
                    version = result.stdout.strip()
                except:
                    version = "unknown"

                # Check if uv-managed
                is_uv = (dir_path / "uv.lock").exists()

                return {
                    "name": venv_name,
                    "path": str(venv_path),
                    "python_path": str(python_path),
                    "version": version,
                    "type": "uv" if is_uv else "venv",
                }

    return None


def list_venvs_in_tree(root: str, max_depth: int = 3) -> List[Dict[str, Any]]:
    """
    Search for venvs in a directory tree.
    Returns list of venv info dicts.
    """
    venvs = []
    root_path = Path(root)

    def search(path: Path, depth: int):
        if depth > max_depth:
            return

        try:
            for item in path.iterdir():
                if item.is_dir():
                    # Check if this is a venv
                    if item.name in [".venv", "venv", ".env", "env"]:
                        venv_info = detect_venv_in_directory(str(path))
                        if venv_info:
                            venvs.append(venv_info)
                    # Skip common non-project directories
                    elif item.name not in ["node_modules", "__pycache__", ".git", "dist", "build", ".mrmd"]:
                        search(item, depth + 1)
        except PermissionError:
            pass

    search(root_path, 0)
    return venvs


# ==================== Session Persistence ====================


def get_project_sessions_dir(project_path: str) -> Path:
    """
    Get the sessions directory for a project.
    Sessions are stored in <project>/.mrmd/sessions/
    """
    return Path(project_path) / ".mrmd" / "sessions"


def list_sessions(project_path: str) -> List[Dict[str, Any]]:
    """
    List all saved sessions for a project.

    Returns list of session info:
    - name: Session name
    - path: Path to pickle file
    - size: File size in bytes
    - created: Creation timestamp
    - modified: Last modified timestamp
    """
    sessions_dir = get_project_sessions_dir(project_path)

    if not sessions_dir.exists():
        return []

    sessions = []
    for pkl_file in sessions_dir.glob("*.pkl"):
        stat = pkl_file.stat()
        sessions.append({
            "name": pkl_file.stem,
            "path": str(pkl_file),
            "size": stat.st_size,
            "size_human": _format_size(stat.st_size),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })

    # Sort by modified time, most recent first
    sessions.sort(key=lambda s: s["modified"], reverse=True)
    return sessions


def _format_size(size_bytes: int) -> str:
    """Format bytes as human-readable string."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def save_session(project_path: str, session_name: str, session_data: bytes) -> Dict[str, Any]:
    """
    Save session data (pickled IPython state) to disk.

    Args:
        project_path: Path to the project
        session_name: Name for the session
        session_data: Pickled session bytes

    Returns:
        Result dict with success, path, and message
    """
    result = {"success": False, "path": None, "message": ""}

    try:
        sessions_dir = get_project_sessions_dir(project_path)
        sessions_dir.mkdir(parents=True, exist_ok=True)

        # Sanitize session name
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in session_name)
        if not safe_name:
            safe_name = "session"

        session_path = sessions_dir / f"{safe_name}.pkl"

        # Write session data
        session_path.write_bytes(session_data)

        result["success"] = True
        result["path"] = str(session_path)
        result["message"] = f"Session saved to {session_path.name}"

    except Exception as e:
        result["message"] = f"Failed to save session: {str(e)}"

    return result


def load_session(session_path: str) -> Dict[str, Any]:
    """
    Load session data from disk.

    Args:
        session_path: Path to the session pickle file

    Returns:
        Result dict with success, data (bytes), and message
    """
    result = {"success": False, "data": None, "message": ""}

    try:
        path = Path(session_path)
        if not path.exists():
            result["message"] = "Session file not found"
            return result

        session_data = path.read_bytes()

        result["success"] = True
        result["data"] = session_data
        result["message"] = f"Session loaded from {path.name}"

    except Exception as e:
        result["message"] = f"Failed to load session: {str(e)}"

    return result


def delete_session(session_path: str) -> Dict[str, Any]:
    """
    Delete a saved session.

    Args:
        session_path: Path to the session pickle file

    Returns:
        Result dict with success and message
    """
    result = {"success": False, "message": ""}

    try:
        path = Path(session_path)
        if not path.exists():
            result["message"] = "Session file not found"
            return result

        path.unlink()

        result["success"] = True
        result["message"] = "Session deleted"

    except Exception as e:
        result["message"] = f"Failed to delete session: {str(e)}"

    return result


def rename_session(session_path: str, new_name: str) -> Dict[str, Any]:
    """
    Rename a saved session.

    Args:
        session_path: Path to the session pickle file
        new_name: New name for the session

    Returns:
        Result dict with success, new_path, and message
    """
    result = {"success": False, "new_path": None, "message": ""}

    try:
        path = Path(session_path)
        if not path.exists():
            result["message"] = "Session file not found"
            return result

        # Sanitize new name
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in new_name)
        if not safe_name:
            result["message"] = "Invalid session name"
            return result

        new_path = path.parent / f"{safe_name}.pkl"

        if new_path.exists() and new_path != path:
            result["message"] = "A session with that name already exists"
            return result

        path.rename(new_path)

        result["success"] = True
        result["new_path"] = str(new_path)
        result["message"] = f"Session renamed to {safe_name}"

    except Exception as e:
        result["message"] = f"Failed to rename session: {str(e)}"

    return result

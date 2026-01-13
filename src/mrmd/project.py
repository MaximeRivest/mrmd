"""
Project root detection for mrmd.

Finds the project root by looking for common markers like .git, .venv, etc.
"""

from pathlib import Path
from typing import Optional
import os


# Markers that indicate a project root, in order of priority
PROJECT_MARKERS = [
    ".git",           # Git repository
    ".venv",          # Python virtual environment
    "venv",           # Alternative venv name
    ".vscode",        # VS Code settings
    ".idea",          # JetBrains IDE settings
    "pyproject.toml", # Python project
    "package.json",   # Node.js project
    "Cargo.toml",     # Rust project
    "go.mod",         # Go project
    "Makefile",       # Make-based project
    ".mrmd",          # mrmd-specific marker
]


def find_project_root(start_path: Optional[Path] = None) -> Path:
    """
    Find the project root by looking for marker files/directories.

    Walks up from start_path (or cwd) looking for common project markers.
    Returns the first directory containing any marker, or cwd if none found.

    Args:
        start_path: Starting directory for search. Defaults to current working directory.

    Returns:
        Path to the detected project root.
    """
    path = Path(start_path) if start_path else Path.cwd()
    path = path.resolve()

    # Walk up the directory tree
    for directory in [path] + list(path.parents):
        for marker in PROJECT_MARKERS:
            if (directory / marker).exists():
                return directory

    # No marker found, return cwd
    return Path.cwd()


def find_docs_dir(project_root: Path) -> Path:
    """
    Find or create the docs directory for mrmd documents.

    Looks for existing docs directories in order of preference:
    1. ./docs (standard)
    2. ./notebooks
    3. ./notes

    If none exist, returns ./docs (will be created on first save).

    Args:
        project_root: The project root directory.

    Returns:
        Path to the docs directory.
    """
    candidates = ["docs", "notebooks", "notes"]

    for name in candidates:
        docs_dir = project_root / name
        if docs_dir.is_dir():
            return docs_dir

    # Default to docs
    return project_root / "docs"


def find_venv(project_root: Path) -> Optional[Path]:
    """
    Find a Python virtual environment in the project.

    Args:
        project_root: The project root directory.

    Returns:
        Path to venv directory, or None if not found.
    """
    candidates = [".venv", "venv", ".env", "env"]

    for name in candidates:
        venv_path = project_root / name
        # Check for Python executable to confirm it's a venv
        if (venv_path / "bin" / "python").exists():
            return venv_path
        if (venv_path / "Scripts" / "python.exe").exists():
            return venv_path

    return None


def get_project_info(start_path: Optional[Path] = None) -> dict:
    """
    Get comprehensive project information.

    Args:
        start_path: Starting directory for search.

    Returns:
        Dictionary with project information.
    """
    project_root = find_project_root(start_path)
    docs_dir = find_docs_dir(project_root)
    venv = find_venv(project_root)

    # Detect project type
    project_type = "unknown"
    if (project_root / "pyproject.toml").exists():
        project_type = "python"
    elif (project_root / "package.json").exists():
        project_type = "node"
    elif (project_root / "Cargo.toml").exists():
        project_type = "rust"
    elif (project_root / "go.mod").exists():
        project_type = "go"

    # Get project name
    project_name = project_root.name

    return {
        "root": project_root,
        "name": project_name,
        "type": project_type,
        "docs_dir": docs_dir,
        "venv": venv,
        "has_git": (project_root / ".git").exists(),
    }

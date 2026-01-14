"""
Project root detection for mrmd.

Finds the project root by looking for common markers like .git, .venv, etc.
Implements bounded search (stops at home directory) and scratch project fallback.
"""

import hashlib
import subprocess
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

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

# Default scratch project location
SCRATCH_PROJECT_PATH = Path.home() / "Projects" / "scratch"


def get_project_hash(project_root: Path) -> str:
    """
    Get a unique hash for a project root path.

    Args:
        project_root: The project root directory.

    Returns:
        A 12-character hash string.
    """
    resolved = project_root.resolve()
    hash_input = str(resolved).encode('utf-8')
    return hashlib.sha256(hash_input).hexdigest()[:12]


def get_project_state_dir(project_root: Path) -> Path:
    """
    Get the mrmd state directory for a project.

    Args:
        project_root: The project root directory.

    Returns:
        Path to ~/.mrmd/projects/{hash}/
    """
    project_hash = get_project_hash(project_root)
    state_dir = Path.home() / ".mrmd" / "projects" / project_hash
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir


def find_project_root_bounded(start_path: Optional[Path] = None) -> Tuple[Path, bool]:
    """
    Find the project root, stopping at home directory.

    Walks up from start_path (or cwd) looking for common project markers.
    Stops searching when reaching the user's home directory.

    Args:
        start_path: Starting directory for search. Defaults to current working directory.

    Returns:
        Tuple of (project_root, found) where found is True if a marker was found,
        False if we hit home directory without finding anything.
    """
    path = Path(start_path) if start_path else Path.cwd()
    path = path.resolve()
    home = Path.home().resolve()

    # Walk up the directory tree, stopping at home
    for directory in [path] + list(path.parents):
        # Stop at home directory (don't search above it)
        if directory == home:
            break

        for marker in PROJECT_MARKERS:
            if (directory / marker).exists():
                return directory, True

    # No marker found before reaching home
    return path, False


def find_project_root(start_path: Optional[Path] = None) -> Path:
    """
    Find the project root by looking for marker files/directories.

    This is the main entry point that handles scratch project fallback.

    Args:
        start_path: Starting directory for search. Defaults to current working directory.

    Returns:
        Path to the detected project root, or scratch project if none found.
    """
    project_root, found = find_project_root_bounded(start_path)

    if found:
        return project_root

    # No project found - use or create scratch
    return get_or_create_scratch()


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


def get_or_create_scratch() -> Path:
    """
    Get or create the scratch project.

    The scratch project is used when no project root is found.
    Located at ~/Projects/scratch by default.

    Returns:
        Path to the scratch project root.
    """
    scratch = SCRATCH_PROJECT_PATH

    if not scratch.exists():
        logger.info(f"Creating scratch project at {scratch}")
        scratch.mkdir(parents=True, exist_ok=True)

        # Initialize with uv
        try:
            subprocess.run(
                ["uv", "init", "--name", "scratch"],
                cwd=scratch,
                check=True,
                capture_output=True,
            )
            logger.info("Initialized scratch project with uv")
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to run 'uv init': {e}")
        except FileNotFoundError:
            logger.warning("uv not found, skipping project initialization")

        # Create venv
        try:
            subprocess.run(
                ["uv", "venv"],
                cwd=scratch,
                check=True,
                capture_output=True,
            )
            logger.info("Created venv in scratch project")
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to create venv: {e}")
        except FileNotFoundError:
            pass

        # Create a default README
        readme = scratch / "README.md"
        if not readme.exists():
            readme.write_text(
                "# Scratch\n\n"
                "Quick notes and experiments.\n\n"
                "This is the default mrmd project used when no project root is found.\n"
            )

    return scratch


def resolve_target(target: Optional[str]) -> Tuple[Path, Optional[Path]]:
    """
    Resolve a CLI target to project root and optional file.

    Args:
        target: CLI argument - can be None, ".", a directory path, or a file path.

    Returns:
        Tuple of (project_root, target_file) where target_file is the file to open
        (None if target was a directory or not specified).
    """
    if target is None or target == ".":
        # No target or explicit current directory
        project_root = find_project_root(Path.cwd())
        return project_root, None

    target_path = Path(target).expanduser().resolve()

    if target_path.is_file():
        # Target is a file - find project from its parent directory
        project_root, found = find_project_root_bounded(target_path.parent)
        if not found:
            # No project found - use scratch but remember the file
            project_root = get_or_create_scratch()
        return project_root, target_path

    elif target_path.is_dir():
        # Target is a directory - find project from there
        project_root = find_project_root(target_path)
        return project_root, None

    else:
        # Target doesn't exist - treat as potential new file
        # Find project from its would-be parent
        parent = target_path.parent
        if parent.exists():
            project_root, found = find_project_root_bounded(parent)
            if not found:
                project_root = get_or_create_scratch()
            return project_root, target_path
        else:
            # Parent doesn't exist either, use scratch
            project_root = get_or_create_scratch()
            return project_root, target_path


def get_initial_document(project_root: Path, target_file: Optional[Path], cwd: Path) -> str:
    """
    Determine which document to open initially in the editor.

    Args:
        project_root: The project root directory.
        target_file: Optional specific file requested by user.
        cwd: The current working directory when mrmd was invoked.

    Returns:
        Document name (without .md extension) to open.
    """
    # If user specified a file, use that
    if target_file is not None:
        if target_file.suffix.lower() == ".md":
            return target_file.stem
        else:
            # Non-markdown file, just use the name
            return target_file.stem

    # Look for README.md in project root
    readme = project_root / "README.md"
    if readme.exists():
        return "README"

    # Look for readme.md (lowercase)
    readme_lower = project_root / "readme.md"
    if readme_lower.exists():
        return "readme"

    # Find first .md file in cwd (where command was run)
    md_files = sorted(cwd.glob("*.md"))
    if md_files:
        return md_files[0].stem

    # Find first .md file in project root
    md_files = sorted(project_root.glob("*.md"))
    if md_files:
        return md_files[0].stem

    # Default to untitled
    return "untitled"


def get_project_info(start_path: Optional[Path] = None) -> dict:
    """
    Get comprehensive project information.

    Args:
        start_path: Starting directory for search.

    Returns:
        Dictionary with project information.
    """
    project_root, found = find_project_root_bounded(start_path)

    if not found:
        project_root = get_or_create_scratch()

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

    # Get project hash for state directory
    project_hash = get_project_hash(project_root)

    return {
        "root": project_root,
        "name": project_name,
        "type": project_type,
        "project_root": project_root,
        "project_hash": project_hash,
        "venv": venv,
        "has_git": (project_root / ".git").exists(),
        "is_scratch": project_root == SCRATCH_PROJECT_PATH,
    }

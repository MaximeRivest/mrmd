"""
Venv Discovery Module

Progressive virtual environment discovery with caching.
Uses ripgrep for fast searching and maintains a global cache.
"""

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)

# Cache file location
VENV_CACHE_FILE = Path.home() / ".mrmd" / "known-venvs.json"
CACHE_MAX_AGE_SECONDS = 86400  # 24 hours


def _get_python_version(python_path: Path) -> str:
    """Get Python version from executable."""
    try:
        result = subprocess.run(
            [str(python_path), "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip().replace("Python ", "")
    except Exception:
        return "unknown"


def _is_valid_venv(path: Path) -> Optional[dict]:
    """Check if path is a valid venv and return info."""
    if not path.exists() or not path.is_dir():
        return None

    # Check for Python executable
    if sys.platform == "win32":
        python = path / "Scripts" / "python.exe"
    else:
        python = path / "bin" / "python"
        if not python.exists():
            python = path / "bin" / "python3"

    if not python.exists():
        return None

    return {
        "path": str(path.resolve()),
        "name": path.name,
        "python": str(python),
        "version": _get_python_version(python),
        "parent": path.parent.name,  # Project folder name
    }


def load_cache() -> dict:
    """Load venv cache from disk."""
    if not VENV_CACHE_FILE.exists():
        return {"venvs": [], "last_scan": 0}

    try:
        with open(VENV_CACHE_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load venv cache: {e}")
        return {"venvs": [], "last_scan": 0}


def save_cache(cache: dict):
    """Save venv cache to disk."""
    VENV_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(VENV_CACHE_FILE, 'w') as f:
            json.dump(cache, f, indent=2)
    except IOError as e:
        logger.warning(f"Failed to save venv cache: {e}")


def add_to_cache(venv_info: dict):
    """Add a venv to the cache."""
    cache = load_cache()

    # Check if already in cache
    existing = next((v for v in cache["venvs"] if v["path"] == venv_info["path"]), None)
    if existing:
        # Update existing entry
        existing.update(venv_info)
        existing["last_seen"] = time.time()
    else:
        venv_info["last_seen"] = time.time()
        cache["venvs"].append(venv_info)

    save_cache(cache)


def get_cached_venvs() -> list[dict]:
    """Get all cached venvs, filtering out stale entries."""
    cache = load_cache()
    now = time.time()

    # Filter to venvs that still exist
    valid_venvs = []
    for venv in cache["venvs"]:
        path = Path(venv["path"])
        if path.exists():
            venv["source"] = "cached"
            valid_venvs.append(venv)

    return valid_venvs


def search_venvs_near(start_path: Path, max_depth: int = 3) -> list[dict]:
    """
    Search for venvs near a path, expanding outward.

    Args:
        start_path: Starting point (file or directory)
        max_depth: How many parent directories to check

    Returns:
        List of discovered venvs
    """
    if start_path.is_file():
        start_path = start_path.parent

    venvs = []
    seen = set()

    # Common venv folder names
    venv_names = [".venv", "venv", ".env", "env"]

    # Check current and parent directories
    current = start_path.resolve()
    for _ in range(max_depth + 1):
        # Check standard locations
        for name in venv_names:
            venv_path = current / name
            if str(venv_path) not in seen:
                seen.add(str(venv_path))
                info = _is_valid_venv(venv_path)
                if info:
                    info["source"] = "nearby"
                    venvs.append(info)
                    add_to_cache(info)

        # Check sibling directories
        if current.parent.exists():
            for sibling in current.parent.iterdir():
                if sibling.is_dir() and sibling != current:
                    for name in venv_names:
                        venv_path = sibling / name
                        if str(venv_path) not in seen:
                            seen.add(str(venv_path))
                            info = _is_valid_venv(venv_path)
                            if info:
                                info["source"] = "sibling"
                                venvs.append(info)
                                add_to_cache(info)

        # Move up
        if current.parent == current:  # Reached root
            break
        current = current.parent

    return venvs


def search_venvs_ripgrep(search_root: Path = None, max_results: int = 20) -> list[dict]:
    """
    Use ripgrep to find venvs across the filesystem.

    Args:
        search_root: Root to search from (default: home directory)
        max_results: Maximum number of results

    Returns:
        List of discovered venvs
    """
    if search_root is None:
        search_root = Path.home()

    venvs = []
    seen = set()

    # Use ripgrep to find python executables in bin directories
    # This is faster than walking the filesystem
    try:
        # Search for bin/python files (indicates a venv)
        result = subprocess.run(
            [
                "rg", "--files",
                "--glob", "*/.venv/bin/python",
                "--glob", "*/venv/bin/python",
                "--glob", "*/.env/bin/python",
                "--max-count", str(max_results * 2),  # Get extra to filter
                str(search_root)
            ],
            capture_output=True,
            text=True,
            timeout=30,  # Limit search time
        )

        for line in result.stdout.strip().split('\n'):
            if not line:
                continue

            # Extract venv path from python path
            # e.g., /home/user/project/.venv/bin/python -> /home/user/project/.venv
            python_path = Path(line)
            venv_path = python_path.parent.parent  # Go up from bin/python

            if str(venv_path) not in seen:
                seen.add(str(venv_path))
                info = _is_valid_venv(venv_path)
                if info:
                    info["source"] = "ripgrep"
                    venvs.append(info)
                    add_to_cache(info)

                    if len(venvs) >= max_results:
                        break

    except FileNotFoundError:
        logger.debug("ripgrep not installed, falling back to fd")
        # Try fd as fallback
        try:
            result = subprocess.run(
                [
                    "fd", "-t", "f", "^python3?$",
                    "--full-path", ".*/.venv/bin/python",
                    "--max-results", str(max_results),
                    str(search_root)
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )

            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                python_path = Path(line)
                venv_path = python_path.parent.parent

                if str(venv_path) not in seen:
                    seen.add(str(venv_path))
                    info = _is_valid_venv(venv_path)
                    if info:
                        info["source"] = "fd"
                        venvs.append(info)
                        add_to_cache(info)

        except FileNotFoundError:
            logger.debug("Neither ripgrep nor fd installed")
        except subprocess.TimeoutExpired:
            logger.warning("Venv search timed out")
    except subprocess.TimeoutExpired:
        logger.warning("Venv search timed out")

    return venvs


def discover_venvs(
    start_path: Optional[Path] = None,
    include_cached: bool = True,
    include_running: bool = True,
    deep_search: bool = False,
) -> list[dict]:
    """
    Comprehensive venv discovery.

    Args:
        start_path: Starting point for nearby search
        include_cached: Include cached venvs
        include_running: Include currently running runtimes' venvs
        deep_search: Do a ripgrep search across home directory

    Returns:
        List of unique venvs, sorted by relevance
    """
    from . import python_runtime

    all_venvs = []
    seen_paths = set()

    def add_unique(venv: dict):
        if venv["path"] not in seen_paths:
            seen_paths.add(venv["path"])
            all_venvs.append(venv)

    # 1. Running runtimes (highest priority)
    if include_running:
        for rt in python_runtime.list_runtimes():
            if rt.get("venv"):
                info = _is_valid_venv(Path(rt["venv"]))
                if info:
                    info["source"] = "running"
                    add_unique(info)

    # 2. Nearby venvs
    if start_path:
        for venv in search_venvs_near(start_path):
            add_unique(venv)

    # 3. Cached venvs
    if include_cached:
        for venv in get_cached_venvs():
            add_unique(venv)

    # 4. Deep search (optional, slower)
    if deep_search:
        for venv in search_venvs_ripgrep():
            add_unique(venv)

    # Sort: running first, then nearby, then cached
    priority = {"running": 0, "nearby": 1, "sibling": 2, "cached": 3, "ripgrep": 4, "fd": 4}
    all_venvs.sort(key=lambda v: (priority.get(v.get("source", "cached"), 5), v["path"]))

    return all_venvs


def clear_cache():
    """Clear the venv cache."""
    if VENV_CACHE_FILE.exists():
        VENV_CACHE_FILE.unlink()
        logger.info("Venv cache cleared")

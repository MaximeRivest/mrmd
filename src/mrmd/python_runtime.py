"""
Python Runtime Management - wrapper around runtimes module.

Provides backwards-compatible interface for Python runtime management.
"""

import logging
from pathlib import Path
from typing import Optional

from . import runtimes

logger = logging.getLogger(__name__)


def start_runtime(
    runtime_id: str = "default",
    venv: Optional[str] = None,
    cwd: Optional[str] = None,
    port: int = 0,
) -> Optional[dict]:
    """
    Start a Python runtime.

    If already running, returns existing runtime info.

    Args:
        runtime_id: Unique ID for this runtime
        venv: Virtual environment path (uses that venv's Python)
        cwd: Working directory
        port: Port to use (0 = auto-assign)

    Returns:
        Runtime info dict with url, pid, port, etc. or None if failed
    """
    info = runtimes.start_runtime(runtime_id, venv=venv, cwd=cwd, port=port)
    return info.to_dict() if info else None


def stop_runtime(runtime_id: str) -> bool:
    """
    Stop a Python runtime.

    This kills the process, releasing all memory including GPU/VRAM.

    Args:
        runtime_id: Runtime ID to stop

    Returns:
        True if stopped (or wasn't running)
    """
    return runtimes.stop_runtime(runtime_id)


def stop_all_runtimes() -> int:
    """
    Stop all Python runtimes.

    Returns:
        Number of runtimes stopped
    """
    return runtimes.stop_all_runtimes()


def list_runtimes() -> list[dict]:
    """
    List all running Python runtimes.

    Returns:
        List of runtime info dicts
    """
    return runtimes.list_runtimes()


def get_runtime_info(runtime_id: str) -> Optional[dict]:
    """
    Get info about a specific runtime.

    Returns:
        Runtime info dict or None if not found
    """
    info = runtimes.get_runtime(runtime_id)
    if info:
        result = info.to_dict()
        result["alive"] = runtimes.is_runtime_alive(runtime_id)
        return result
    return None


def is_runtime_alive(runtime_id: str) -> bool:
    """Check if a runtime is still running."""
    return runtimes.is_runtime_alive(runtime_id)


def get_runtime_url(runtime_id: str) -> Optional[str]:
    """Get the URL for a runtime."""
    info = runtimes.get_runtime(runtime_id)
    return info.url if info else None


def ensure_runtime(
    runtime_id: str = "default",
    venv: Optional[str] = None,
    cwd: Optional[str] = None,
) -> Optional[str]:
    """
    Ensure a runtime is running and return its URL.

    Starts the runtime if not already running.

    Args:
        runtime_id: Runtime ID
        venv: Virtual environment path
        cwd: Working directory

    Returns:
        Runtime URL or None if failed
    """
    # Check if already running
    if runtimes.is_runtime_alive(runtime_id):
        info = runtimes.get_runtime(runtime_id)
        return info.url if info else None

    # Start it
    info = runtimes.start_runtime(runtime_id, venv=venv, cwd=cwd)
    return info.url if info else None

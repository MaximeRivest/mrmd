"""
Python Runtime Management - uses mrmd-python daemon directly.

This module provides a simple interface to mrmd-python daemons.
Runtimes are independent processes that survive orchestrator restarts.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Import mrmd-python functions directly (it's a dependency)
from mrmd_python.runtime_daemon import (
    spawn_daemon,
    kill_runtime as _kill_runtime,
    list_runtimes as _list_runtimes,
    read_runtime_info,
    is_runtime_alive as _is_alive,
)


def start_runtime(
    runtime_id: str = "default",
    venv: Optional[str] = None,
    cwd: Optional[str] = None,
    port: int = 0,
) -> Optional[dict]:
    """
    Start a Python runtime daemon.

    If already running, returns existing runtime info.

    Args:
        runtime_id: Unique ID for this runtime
        venv: Virtual environment path (auto-detected if not specified)
        cwd: Working directory
        port: Port to use (0 = auto-assign)

    Returns:
        Runtime info dict with url, pid, port, etc. or None if failed
    """
    try:
        # Resolve paths
        resolved_venv = str(Path(venv).expanduser().resolve()) if venv else None
        resolved_cwd = str(Path(cwd).expanduser().resolve()) if cwd else None

        info = spawn_daemon(
            runtime_id=runtime_id,
            venv=resolved_venv,
            cwd=resolved_cwd,
            port=port,
        )
        logger.info(f"Started runtime {runtime_id}: {info.get('url')}")
        return info
    except Exception as e:
        logger.error(f"Failed to start runtime {runtime_id}: {e}")
        return None


def stop_runtime(runtime_id: str) -> bool:
    """
    Stop a Python runtime daemon.

    This kills the process, releasing all memory including GPU/VRAM.

    Args:
        runtime_id: Runtime ID to stop

    Returns:
        True if stopped (or wasn't running)
    """
    try:
        result = _kill_runtime(runtime_id)
        if result:
            logger.info(f"Stopped runtime {runtime_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to stop runtime {runtime_id}: {e}")
        return False


def stop_all_runtimes() -> int:
    """
    Stop all Python runtime daemons.

    Returns:
        Number of runtimes stopped
    """
    runtimes = _list_runtimes()
    killed = 0
    for rt in runtimes:
        if _kill_runtime(rt["id"]):
            killed += 1
    logger.info(f"Stopped {killed} runtime(s)")
    return killed


def list_runtimes() -> list[dict]:
    """
    List all running Python runtimes.

    Returns:
        List of runtime info dicts
    """
    return _list_runtimes()


def get_runtime_info(runtime_id: str) -> Optional[dict]:
    """
    Get info about a specific runtime.

    Returns:
        Runtime info dict or None if not found
    """
    info = read_runtime_info(runtime_id)
    if info:
        info["alive"] = _is_alive(runtime_id)
    return info


def is_runtime_alive(runtime_id: str) -> bool:
    """Check if a runtime is still running."""
    return _is_alive(runtime_id)


def get_runtime_url(runtime_id: str) -> Optional[str]:
    """Get the URL for a runtime."""
    info = get_runtime_info(runtime_id)
    return info.get("url") if info else None


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
    if is_runtime_alive(runtime_id):
        return get_runtime_url(runtime_id)

    # Start it
    info = start_runtime(runtime_id, venv=venv, cwd=cwd)
    return info.get("url") if info else None

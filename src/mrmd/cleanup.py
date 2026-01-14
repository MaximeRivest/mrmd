"""
Cleanup utilities for mrmd.

Handles project-scoped cleanup:
- Finding free ports
- Killing stale mrmd processes FOR THIS PROJECT ONLY
- Cleaning up orphaned PID files
- Cleaning up orphaned runtime registries

IMPORTANT: This module implements project-level isolation. It will NEVER kill
processes belonging to other projects. Each project's state is stored in
~/.mrmd/projects/{project_hash}/
"""

import os
import socket
import signal
import json
import time
import logging
from pathlib import Path
from typing import Optional, List

from .project import get_project_hash, get_project_state_dir

logger = logging.getLogger(__name__)


def find_free_port(start: int = 0, max_attempts: int = 100) -> int:
    """
    Find a free port.

    Args:
        start: Port to start searching from (0 = let OS assign)
        max_attempts: Maximum number of ports to try

    Returns:
        A free port number
    """
    if start == 0:
        # Let OS assign a free port
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            return s.getsockname()[1]

    for offset in range(max_attempts):
        port = start + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue

    # Fallback: let OS assign
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def is_port_free(port: int) -> bool:
    """Check if a port is available."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', port))
            return True
    except OSError:
        return False


def get_port_pid(port: int) -> Optional[int]:
    """Get the PID of process using a port, or None if port is free."""
    try:
        import subprocess
        result = subprocess.run(
            ['lsof', '-ti', f':{port}'],
            capture_output=True,
            text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            # May return multiple PIDs, take first
            return int(result.stdout.strip().split('\n')[0])
    except Exception:
        pass
    return None


def is_process_alive(pid: int) -> bool:
    """Check if a process is still running."""
    try:
        os.kill(pid, 0)  # Signal 0 = check existence
        return True
    except (OSError, ProcessLookupError):
        return False


def kill_process(pid: int, force: bool = False) -> bool:
    """Kill a process by PID."""
    try:
        sig = signal.SIGKILL if force else signal.SIGTERM
        os.kill(pid, sig)
        return True
    except (OSError, ProcessLookupError):
        return False


def get_sync_state_dir(project_root: Path) -> Path:
    """Get the mrmd-sync state directory for a project."""
    project_hash = get_project_hash(project_root)
    return Path(f'/tmp/mrmd-sync-{project_hash}')


def load_project_state(project_root: Path) -> Optional[dict]:
    """
    Load the state for a project.

    Args:
        project_root: The project root directory.

    Returns:
        State dict or None if no state file exists.
    """
    state_dir = get_project_state_dir(project_root)
    state_file = state_dir / "state.json"

    if not state_file.exists():
        return None

    try:
        with open(state_file) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Failed to load project state: {e}")
        return None


def save_project_state(project_root: Path, state: dict) -> bool:
    """
    Save state for a project.

    Args:
        project_root: The project root directory.
        state: State dict to save.

    Returns:
        True if save succeeded.
    """
    state_dir = get_project_state_dir(project_root)
    state_file = state_dir / "state.json"

    try:
        with open(state_file, 'w') as f:
            json.dump(state, f, indent=2)
        return True
    except IOError as e:
        logger.warning(f"Failed to save project state: {e}")
        return False


def cleanup_stale_sync(project_root: Path) -> bool:
    """
    Clean up stale mrmd-sync state for THIS project only.

    Returns True if cleanup was needed and successful.
    """
    state_dir = get_sync_state_dir(project_root)
    pid_file = state_dir / 'server.pid'

    if not pid_file.exists():
        return False

    try:
        with open(pid_file) as f:
            data = json.load(f)
            pid = data.get('pid')

        if pid and is_process_alive(pid):
            # Process is alive - check if it's actually mrmd-sync
            try:
                import subprocess
                result = subprocess.run(
                    ['ps', '-p', str(pid), '-o', 'comm='],
                    capture_output=True,
                    text=True
                )
                comm = result.stdout.strip()
                if 'node' in comm or 'mrmd-sync' in comm:
                    logger.info(f"Killing stale mrmd-sync for this project (PID {pid})")
                    kill_process(pid)
                    time.sleep(0.5)
                    if is_process_alive(pid):
                        kill_process(pid, force=True)
            except Exception as e:
                logger.warning(f"Error checking process {pid}: {e}")

        # Remove the PID file
        pid_file.unlink(missing_ok=True)
        logger.info(f"Removed stale sync PID file: {pid_file}")
        return True

    except Exception as e:
        logger.warning(f"Error cleaning up sync state: {e}")
        return False


def cleanup_project_runtimes(project_root: Path) -> int:
    """
    Clean up stale Python runtimes for THIS project only.

    Returns number of stale runtimes cleaned up.
    """
    state_dir = get_project_state_dir(project_root)
    runtimes_dir = state_dir / "runtimes"

    if not runtimes_dir.exists():
        return 0

    cleaned = 0
    for registry_file in runtimes_dir.glob('*.json'):
        try:
            with open(registry_file) as f:
                data = json.load(f)

            pid = data.get('pid')
            if pid and not is_process_alive(pid):
                logger.info(f"Removing stale runtime registry: {registry_file.stem} (PID {pid} dead)")
                registry_file.unlink()
                cleaned += 1

        except Exception as e:
            logger.warning(f"Error checking runtime {registry_file}: {e}")

    return cleaned


def cleanup_project_processes(project_root: Path) -> List[int]:
    """
    Clean up stale processes for THIS project based on saved state.

    Only kills processes that:
    1. Are recorded in this project's state file
    2. Have 'mrmd' in their command line

    Returns list of ports that were freed.
    """
    state = load_project_state(project_root)
    if not state:
        return []

    freed_ports = []
    pids_to_check = state.get('pids', {})  # {service_name: pid}
    ports = state.get('ports', {})  # {service_name: port}

    for service, pid in pids_to_check.items():
        if not is_process_alive(pid):
            # Process already dead
            if service in ports:
                freed_ports.append(ports[service])
            continue

        # Verify this is our process
        try:
            import subprocess
            result = subprocess.run(
                ['ps', '-p', str(pid), '-o', 'args='],
                capture_output=True,
                text=True
            )
            cmdline = result.stdout.strip()

            if 'mrmd' in cmdline.lower():
                logger.info(f"Killing stale {service} for this project (PID {pid})")
                kill_process(pid)
                time.sleep(0.3)
                if is_process_alive(pid):
                    kill_process(pid, force=True)
                    time.sleep(0.2)

                if service in ports:
                    freed_ports.append(ports[service])
            else:
                logger.debug(f"PID {pid} for {service} is not an mrmd process, skipping")

        except Exception as e:
            logger.warning(f"Error checking process {pid}: {e}")

    return freed_ports


def cleanup_project(project_root: Path) -> dict:
    """
    Clean up all stale mrmd state for THIS project only.

    This is the main cleanup entry point. It will NEVER affect other projects.

    Args:
        project_root: Project directory

    Returns:
        Dict with cleanup results
    """
    results = {
        'sync_cleaned': False,
        'runtimes_cleaned': 0,
        'processes_cleaned': [],
        'project_root': str(project_root),
        'project_hash': get_project_hash(project_root),
    }

    # Clean stale sync for this project
    results['sync_cleaned'] = cleanup_stale_sync(project_root)

    # Clean stale runtimes for this project
    results['runtimes_cleaned'] = cleanup_project_runtimes(project_root)

    # Clean stale processes based on saved state
    results['processes_cleaned'] = cleanup_project_processes(project_root)

    return results


def cleanup_all_global_runtimes() -> int:
    """
    Clean up stale global runtime registries (legacy location).

    This handles the old ~/.mrmd/runtimes/ location for backwards compatibility.

    Returns number of stale runtimes cleaned up.
    """
    runtimes_dir = Path.home() / '.mrmd' / 'runtimes'
    if not runtimes_dir.exists():
        return 0

    cleaned = 0
    for registry_file in runtimes_dir.glob('*.json'):
        try:
            with open(registry_file) as f:
                data = json.load(f)

            pid = data.get('pid')
            if pid and not is_process_alive(pid):
                logger.info(f"Removing stale global runtime registry: {registry_file.stem} (PID {pid} dead)")
                registry_file.unlink()
                cleaned += 1

        except Exception as e:
            logger.warning(f"Error checking runtime {registry_file}: {e}")

    return cleaned


# Legacy function for backwards compatibility
def cleanup_all(project_root: str, ports: Optional[List[int]] = None) -> dict:
    """
    Legacy cleanup function. Now just calls project-scoped cleanup.

    The 'ports' argument is ignored - we no longer kill by port globally.
    """
    project_path = Path(project_root)
    results = cleanup_project(project_path)

    # Also clean legacy global runtimes
    global_cleaned = cleanup_all_global_runtimes()
    if global_cleaned:
        results['runtimes_cleaned'] += global_cleaned

    # Convert for backwards compatibility
    return {
        'sync_cleaned': results['sync_cleaned'],
        'runtimes_cleaned': results['runtimes_cleaned'],
        'ports_cleaned': results['processes_cleaned'],
    }

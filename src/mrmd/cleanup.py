"""
Cleanup utilities for mrmd.

Handles:
- Finding free ports
- Killing stale mrmd processes
- Cleaning up orphaned PID files
- Cleaning up orphaned runtime registries
"""

import os
import socket
import signal
import json
import hashlib
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def find_free_port(start: int = 41580, max_attempts: int = 100) -> int:
    """
    Find a free port starting from the given port.

    Args:
        start: Port to start searching from
        max_attempts: Maximum number of ports to try

    Returns:
        A free port number
    """
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


def get_sync_state_dir(project_root: str) -> Path:
    """Get the mrmd-sync state directory for a project."""
    resolved = Path(project_root).resolve()
    hash_input = str(resolved).encode('utf-8')
    dir_hash = hashlib.sha256(hash_input).hexdigest()[:12]
    return Path(f'/tmp/mrmd-sync-{dir_hash}')


def cleanup_stale_sync(project_root: str) -> bool:
    """
    Clean up stale mrmd-sync state for a project.

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
                    logger.info(f"Killing stale mrmd-sync (PID {pid})")
                    kill_process(pid)
                    # Give it a moment
                    import time
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


def cleanup_stale_runtimes() -> int:
    """
    Clean up stale Python runtime registries.

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
                logger.info(f"Removing stale runtime registry: {registry_file.stem} (PID {pid} dead)")
                registry_file.unlink()
                cleaned += 1

        except Exception as e:
            logger.warning(f"Error checking runtime {registry_file}: {e}")

    return cleaned


def cleanup_port(port: int, process_name: str = "mrmd") -> bool:
    """
    Clean up a process using a specific port if it matches our process name.

    Returns True if port was freed.
    """
    pid = get_port_pid(port)
    if not pid:
        return True  # Already free

    # Check if it's one of ours
    try:
        import subprocess
        result = subprocess.run(
            ['ps', '-p', str(pid), '-o', 'args='],
            capture_output=True,
            text=True
        )
        cmdline = result.stdout.strip()

        # Check if this looks like our process
        if process_name in cmdline or 'mrmd' in cmdline:
            logger.info(f"Killing stale {process_name} on port {port} (PID {pid})")
            kill_process(pid)

            # Wait a moment and verify
            import time
            time.sleep(0.5)
            if is_process_alive(pid):
                kill_process(pid, force=True)
                time.sleep(0.2)

            return not is_process_alive(pid)
        else:
            logger.warning(f"Port {port} in use by non-mrmd process: {cmdline[:50]}")
            return False

    except Exception as e:
        logger.warning(f"Error checking port {port}: {e}")
        return False


def cleanup_all(project_root: str, ports: Optional[list[int]] = None) -> dict:
    """
    Clean up all stale mrmd state for a project.

    Args:
        project_root: Project directory
        ports: List of ports to check (default: common mrmd ports)

    Returns:
        Dict with cleanup results
    """
    if ports is None:
        ports = [41580, 41444, 41765, 51790]  # editor, sync, runtime, ai

    results = {
        'sync_cleaned': False,
        'runtimes_cleaned': 0,
        'ports_cleaned': [],
    }

    # Clean stale sync
    results['sync_cleaned'] = cleanup_stale_sync(project_root)

    # Clean stale runtimes
    results['runtimes_cleaned'] = cleanup_stale_runtimes()

    # Clean stale ports
    for port in ports:
        if cleanup_port(port):
            if get_port_pid(port) is None:
                results['ports_cleaned'].append(port)

    return results

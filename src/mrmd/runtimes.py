"""
Runtime Management for mrmd.

Manages multiple mrmd-python server processes. Each runtime:
- Runs in a specific venv (using that venv's Python)
- Has its own port
- Can be started/stopped independently
- Documents attach to runtimes by URL

Runtimes are stored in ~/.mrmd/runtimes/{id}.json for persistence.
"""

import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Runtime registry directory
RUNTIMES_DIR = Path.home() / ".mrmd" / "runtimes"


@dataclass
class RuntimeInfo:
    """Information about a running mrmd-python runtime."""
    id: str
    pid: int
    port: int
    venv: Optional[str]
    python: str  # Path to Python executable
    cwd: str
    url: str
    started_at: float
    host: str = "127.0.0.1"  # Optional for backwards compat

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "RuntimeInfo":
        """Create from dict, ignoring unknown fields."""
        known_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in known_fields}
        return cls(**filtered)


def _get_runtime_file(runtime_id: str) -> Path:
    """Get path to runtime info file."""
    RUNTIMES_DIR.mkdir(parents=True, exist_ok=True)
    # Sanitize ID for filesystem
    safe_id = runtime_id.replace("/", "_").replace(":", "_")
    return RUNTIMES_DIR / f"{safe_id}.json"


def _find_free_port() -> int:
    """Find a free port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        return s.getsockname()[1]


def _get_python_for_venv(venv: Optional[str]) -> str:
    """Get Python executable path for a venv."""
    if not venv:
        return sys.executable

    venv_path = Path(venv).expanduser().resolve()

    if sys.platform == "win32":
        python = venv_path / "Scripts" / "python.exe"
    else:
        python = venv_path / "bin" / "python"

    if python.exists():
        return str(python)

    # Try python3
    python3 = venv_path / "bin" / "python3"
    if python3.exists():
        return str(python3)

    logger.warning(f"Python not found in venv {venv}, using system Python")
    return sys.executable


def _is_process_alive(pid: int) -> bool:
    """Check if a process is still running."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _wait_for_server(url: str, timeout: float = 10.0) -> bool:
    """Wait for server to be ready."""
    import urllib.request
    import urllib.error

    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.urlopen(f"{url}/capabilities", timeout=1)
            req.close()
            return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.1)
    return False


def _find_local_mrmd_python() -> Optional[str]:
    """Find local mrmd-python source for development installs."""
    # Check relative to this file (mrmd-packages/mrmd/src/mrmd/runtimes.py)
    # Path: .../mrmd-packages/mrmd/src/mrmd/runtimes.py
    #       .parent = .../mrmd-packages/mrmd/src/mrmd
    #       .parent.parent = .../mrmd-packages/mrmd/src
    #       .parent.parent.parent = .../mrmd-packages/mrmd
    #       .parent.parent.parent.parent = .../mrmd-packages  <- This is what we want
    this_file = Path(__file__)
    mrmd_packages = this_file.parent.parent.parent.parent  # Go up to mrmd-packages
    local_mrmd_python = mrmd_packages / "mrmd-python"
    if local_mrmd_python.exists() and (local_mrmd_python / "pyproject.toml").exists():
        logger.debug(f"Found local mrmd-python at {local_mrmd_python}")
        return str(local_mrmd_python)
    logger.debug(f"No local mrmd-python found (checked {local_mrmd_python})")
    return None


def _ensure_mrmd_python_installed(python: str, venv: Optional[str]) -> bool:
    """
    Ensure mrmd-python is installed in the target venv.
    Auto-installs if missing. Verifies it can actually run.
    """
    try:
        # Check if mrmd-python can be run (not just imported)
        result = subprocess.run(
            [python, "-c", "from mrmd_python.cli import main; print('OK')"],
            capture_output=True,
            timeout=10,
        )
        if result.returncode == 0:
            # Also verify __main__ works
            result2 = subprocess.run(
                [python, "-m", "mrmd_python", "--help"],
                capture_output=True,
                timeout=10,
            )
            if result2.returncode == 0:
                logger.debug(f"mrmd-python ready in {venv or 'system'}")
                return True
            logger.warning(f"mrmd-python installed but __main__ missing, reinstalling...")

        # Not installed or broken, try to install
        logger.info(f"Installing mrmd-python in {venv or 'system Python'}...")

        # Check for local source (development mode)
        local_source = _find_local_mrmd_python()

        # Build install commands - prefer local source in dev
        install_cmds = []
        if local_source:
            logger.info(f"Using local mrmd-python from {local_source}")
            if venv:
                install_cmds.append(["uv", "pip", "install", "-e", local_source, "--python", python])
            install_cmds.append([python, "-m", "pip", "install", "-e", local_source])
        else:
            # Install from PyPI
            if venv:
                install_cmds.append(["uv", "pip", "install", "mrmd-python", "--python", python])
            install_cmds.append([python, "-m", "pip", "install", "mrmd-python"])

        for cmd in install_cmds:
            try:
                logger.debug(f"Trying: {' '.join(cmd)}")
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    logger.info(f"Successfully installed mrmd-python")
                    return True
                logger.debug(f"Command failed: {result.stderr}")
            except FileNotFoundError:
                # uv not available, try next command
                continue
            except subprocess.TimeoutExpired:
                logger.warning(f"Install command timed out")
                continue

        logger.error(f"Failed to install mrmd-python in {venv or 'system'}")
        return False

    except Exception as e:
        logger.error(f"Error ensuring mrmd-python installed: {e}")
        return False


def start_runtime(
    runtime_id: str,
    venv: Optional[str] = None,
    cwd: Optional[str] = None,
    port: int = 0,
) -> Optional[RuntimeInfo]:
    """
    Start a new mrmd-python runtime.

    If a runtime with this ID is already running, returns its info.

    Args:
        runtime_id: Unique identifier for this runtime
        venv: Path to virtual environment (None = system Python)
        cwd: Working directory for the runtime
        port: Port to use (0 = auto-assign)

    Returns:
        RuntimeInfo or None if failed
    """
    # Check if already running
    existing = get_runtime(runtime_id)
    if existing and is_runtime_alive(runtime_id):
        logger.info(f"Runtime {runtime_id} already running at {existing.url}")
        return existing

    # Clean up stale info file
    if existing:
        _get_runtime_file(runtime_id).unlink(missing_ok=True)

    # Resolve paths
    python = _get_python_for_venv(venv)
    resolved_cwd = str(Path(cwd).expanduser().resolve()) if cwd else os.getcwd()
    resolved_venv = str(Path(venv).expanduser().resolve()) if venv else None

    # Ensure mrmd-python is installed (auto-install if needed)
    if not _ensure_mrmd_python_installed(python, resolved_venv):
        logger.error(f"Cannot start runtime: mrmd-python not available in {resolved_venv or 'system'}")
        return None

    # Find port
    if port == 0:
        port = _find_free_port()

    # Build command
    cmd = [
        python,
        "-m", "mrmd_python",
        "--port", str(port),
        "--host", "127.0.0.1",
    ]

    logger.info(f"Starting runtime {runtime_id}: {' '.join(cmd)}")

    try:
        # Start process
        # Use start_new_session to make it independent
        process = subprocess.Popen(
            cmd,
            cwd=resolved_cwd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

        url = f"http://127.0.0.1:{port}/mrp/v1"

        # Wait for server to be ready
        if not _wait_for_server(url):
            logger.error(f"Runtime {runtime_id} failed to start (timeout)")
            try:
                process.kill()
            except Exception:
                pass
            return None

        # Create runtime info
        info = RuntimeInfo(
            id=runtime_id,
            pid=process.pid,
            port=port,
            venv=resolved_venv,
            python=python,
            cwd=resolved_cwd,
            url=url,
            started_at=time.time(),
        )

        # Save to registry
        runtime_file = _get_runtime_file(runtime_id)
        runtime_file.write_text(json.dumps(info.to_dict(), indent=2))

        logger.info(f"Runtime {runtime_id} started: {url} (PID {process.pid})")
        return info

    except Exception as e:
        logger.error(f"Failed to start runtime {runtime_id}: {e}")
        return None


def stop_runtime(runtime_id: str) -> bool:
    """
    Stop a runtime.

    Args:
        runtime_id: Runtime to stop

    Returns:
        True if stopped (or wasn't running)
    """
    info = get_runtime(runtime_id)
    if not info:
        return True

    try:
        # Kill the process group to ensure all children are killed
        # This is important for releasing GPU memory
        try:
            pgid = os.getpgid(info.pid)
            os.killpg(pgid, signal.SIGTERM)
        except (OSError, ProcessLookupError):
            # Try killing just the process
            try:
                os.kill(info.pid, signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass

        # Wait a bit for graceful shutdown
        time.sleep(0.5)

        # Force kill if still running
        if _is_process_alive(info.pid):
            try:
                pgid = os.getpgid(info.pid)
                os.killpg(pgid, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                try:
                    os.kill(info.pid, signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass

        logger.info(f"Stopped runtime {runtime_id} (PID {info.pid})")

    except Exception as e:
        logger.warning(f"Error stopping runtime {runtime_id}: {e}")

    # Remove registry file
    _get_runtime_file(runtime_id).unlink(missing_ok=True)
    return True


def get_runtime(runtime_id: str) -> Optional[RuntimeInfo]:
    """Get runtime info by ID."""
    runtime_file = _get_runtime_file(runtime_id)
    if not runtime_file.exists():
        return None

    try:
        data = json.loads(runtime_file.read_text())
        return RuntimeInfo.from_dict(data)
    except Exception as e:
        logger.warning(f"Error reading runtime info for {runtime_id}: {e}")
        return None


def is_runtime_alive(runtime_id: str) -> bool:
    """Check if a runtime is still running."""
    info = get_runtime(runtime_id)
    if not info:
        return False
    return _is_process_alive(info.pid)


def list_runtimes() -> list[dict]:
    """
    List all registered runtimes.

    Returns:
        List of runtime info dicts with 'alive' status added
    """
    if not RUNTIMES_DIR.exists():
        return []

    runtimes = []
    for f in RUNTIMES_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            data["alive"] = _is_process_alive(data.get("pid", 0))
            runtimes.append(data)
        except Exception as e:
            logger.warning(f"Error reading runtime file {f}: {e}")

    return runtimes


def stop_all_runtimes() -> int:
    """
    Stop all runtimes.

    Returns:
        Number of runtimes stopped
    """
    runtimes = list_runtimes()
    stopped = 0
    for rt in runtimes:
        if stop_runtime(rt["id"]):
            stopped += 1
    return stopped


def cleanup_dead_runtimes():
    """Remove registry entries for dead runtimes."""
    if not RUNTIMES_DIR.exists():
        return

    for f in RUNTIMES_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
            if not _is_process_alive(data.get("pid", 0)):
                f.unlink()
                logger.debug(f"Cleaned up dead runtime: {data.get('id')}")
        except Exception:
            pass

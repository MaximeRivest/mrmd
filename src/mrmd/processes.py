"""
Process management for mrmd services.

Manages Node.js subprocesses (mrmd-sync, mrmd-monitor) and Python runtime.
"""

import asyncio
import logging
import os
import signal
import sys
from collections import deque
from pathlib import Path
from typing import Optional, Callable
import subprocess

logger = logging.getLogger(__name__)


def get_node_executable() -> str:
    """
    Get the Node.js executable path.

    First tries nodejs-bin (bundled), then falls back to system node.

    Returns:
        Path to node executable.

    Raises:
        RuntimeError: If Node.js is not available.
    """
    # Try nodejs-bin first (installed as dependency)
    try:
        from nodejs import node
        # nodejs-bin provides the path via node.path or we can use node.run
        return "node"  # nodejs-bin patches PATH
    except ImportError:
        pass

    # Fall back to system node
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return "node"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    raise RuntimeError(
        "Node.js not found. Install nodejs-bin: pip install nodejs-bin\n"
        "Or install Node.js from https://nodejs.org"
    )


def find_package_path(package_name: str) -> Optional[Path]:
    """
    Find the path to a bundled or sibling package.

    Looks in:
    1. Bundled directory (for installed package)
    2. Sibling directory (for development)

    Args:
        package_name: Name of the package (e.g., 'mrmd-sync')

    Returns:
        Path to the package directory, or None if not found.
    """
    # Check bundled directory
    bundled_path = Path(__file__).parent / "bundled" / package_name.replace("mrmd-", "")
    if bundled_path.exists():
        return bundled_path

    # Check sibling directory (development mode)
    # Go from src/mrmd/ up to mrmd-packages/
    dev_root = Path(__file__).parent.parent.parent.parent
    sibling_path = dev_root / package_name
    if sibling_path.exists():
        return sibling_path

    # Check environment variable
    env_path = os.environ.get("MRMD_PACKAGES_DIR")
    if env_path:
        env_package_path = Path(env_path) / package_name
        if env_package_path.exists():
            return env_package_path

    return None


class ProcessManager:
    """
    Manages background processes for mrmd services.

    Handles starting, stopping, and monitoring Node.js and Python subprocesses.
    """

    def __init__(self):
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._output_buffers: dict[str, deque] = {}
        self._output_tasks: dict[str, asyncio.Task] = {}
        self._max_output_lines = 1000

    async def start_node_process(
        self,
        name: str,
        script_path: Path,
        args: list[str] = None,
        cwd: Path = None,
        env: dict = None,
        on_output: Callable[[str], None] = None,
    ) -> bool:
        """
        Start a Node.js subprocess.

        Args:
            name: Unique name for this process.
            script_path: Path to the JS script to run.
            args: Command line arguments.
            cwd: Working directory.
            env: Environment variables (merged with current env).
            on_output: Callback for output lines.

        Returns:
            True if started successfully.
        """
        if name in self._processes:
            logger.warning(f"Process {name} already running")
            return False

        try:
            node = get_node_executable()
        except RuntimeError as e:
            logger.error(str(e))
            return False

        cmd = [node, str(script_path)] + (args or [])

        # Merge environment
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        logger.info(f"Starting {name}: {' '.join(cmd)}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                env=process_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            self._processes[name] = process
            self._output_buffers[name] = deque(maxlen=self._max_output_lines)

            # Start output reader task
            self._output_tasks[name] = asyncio.create_task(
                self._read_output(name, process, on_output)
            )

            logger.info(f"Started {name} with PID {process.pid}")
            return True

        except Exception as e:
            logger.error(f"Failed to start {name}: {e}")
            return False

    async def start_python_process(
        self,
        name: str,
        module: str,
        args: list[str] = None,
        cwd: Path = None,
        env: dict = None,
        venv: Path = None,
        on_output: Callable[[str], None] = None,
    ) -> bool:
        """
        Start a Python subprocess.

        Args:
            name: Unique name for this process.
            module: Python module to run (e.g., 'mrmd_python.cli').
            args: Command line arguments.
            cwd: Working directory.
            env: Environment variables.
            venv: Virtual environment path.
            on_output: Callback for output lines.

        Returns:
            True if started successfully.
        """
        if name in self._processes:
            logger.warning(f"Process {name} already running")
            return False

        # Determine Python executable
        if venv:
            if sys.platform == "win32":
                python = venv / "Scripts" / "python.exe"
            else:
                python = venv / "bin" / "python"
        else:
            python = sys.executable

        cmd = [str(python), "-m", module] + (args or [])

        # Merge environment
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        logger.info(f"Starting {name}: {' '.join(cmd)}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                env=process_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            self._processes[name] = process
            self._output_buffers[name] = deque(maxlen=self._max_output_lines)

            # Start output reader task
            self._output_tasks[name] = asyncio.create_task(
                self._read_output(name, process, on_output)
            )

            logger.info(f"Started {name} with PID {process.pid}")
            return True

        except Exception as e:
            logger.error(f"Failed to start {name}: {e}")
            return False

    async def start_npx_process(
        self,
        name: str,
        package: str,
        args: list[str] = None,
        cwd: Path = None,
        env: dict = None,
        on_output: Callable[[str], None] = None,
    ) -> bool:
        """
        Start a Node.js package via npx.

        Args:
            name: Unique name for this process.
            package: npm package name to run via npx.
            args: Command line arguments.
            cwd: Working directory.
            env: Environment variables (merged with current env).
            on_output: Callback for output lines.

        Returns:
            True if started successfully.
        """
        if name in self._processes:
            logger.warning(f"Process {name} already running")
            return False

        # Use npx from nodejs-bin
        try:
            from nodejs import npx
            npx_cmd = "npx"
        except ImportError:
            npx_cmd = "npx"

        cmd = [npx_cmd, package] + (args or [])

        # Merge environment
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        logger.info(f"Starting {name}: {' '.join(cmd)}")

        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                env=process_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            self._processes[name] = process
            self._output_buffers[name] = deque(maxlen=self._max_output_lines)

            # Start output reader task
            self._output_tasks[name] = asyncio.create_task(
                self._read_output(name, process, on_output)
            )

            logger.info(f"Started {name} with PID {process.pid}")
            return True

        except Exception as e:
            logger.error(f"Failed to start {name}: {e}")
            return False

    async def _read_output(
        self,
        name: str,
        process: asyncio.subprocess.Process,
        callback: Callable[[str], None] = None,
    ):
        """Read output from a process and store in buffer."""
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break

                line_str = line.decode("utf-8", errors="replace").rstrip()
                self._output_buffers[name].append(line_str)

                if callback:
                    callback(line_str)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error reading output from {name}: {e}")

    def is_running(self, name: str) -> bool:
        """Check if a process is running."""
        if name not in self._processes:
            return False
        return self._processes[name].returncode is None

    def get_output(self, name: str, lines: int = 50) -> list[str]:
        """Get recent output lines from a process."""
        if name not in self._output_buffers:
            return []
        buffer = self._output_buffers[name]
        return list(buffer)[-lines:]

    async def stop(self, name: str, timeout: float = 5.0) -> bool:
        """
        Stop a process gracefully.

        Sends SIGTERM, waits for timeout, then SIGKILL if needed.

        Args:
            name: Process name.
            timeout: Seconds to wait before SIGKILL.

        Returns:
            True if stopped successfully.
        """
        if name not in self._processes:
            return True

        process = self._processes[name]

        if process.returncode is not None:
            # Already stopped
            del self._processes[name]
            return True

        logger.info(f"Stopping {name} (PID {process.pid})")

        # Send SIGTERM
        try:
            process.terminate()
        except ProcessLookupError:
            del self._processes[name]
            return True

        # Wait for graceful shutdown
        try:
            await asyncio.wait_for(process.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.warning(f"{name} didn't stop gracefully, sending SIGKILL")
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass

        # Cancel output reader
        if name in self._output_tasks:
            self._output_tasks[name].cancel()
            try:
                await self._output_tasks[name]
            except asyncio.CancelledError:
                pass
            del self._output_tasks[name]

        del self._processes[name]
        logger.info(f"Stopped {name}")
        return True

    async def stop_all(self, timeout: float = 5.0):
        """Stop all running processes."""
        names = list(self._processes.keys())
        for name in names:
            await self.stop(name, timeout)

    def get_status(self) -> dict:
        """Get status of all processes."""
        return {
            name: {
                "running": self.is_running(name),
                "pid": proc.pid if proc.returncode is None else None,
                "returncode": proc.returncode,
            }
            for name, proc in self._processes.items()
        }

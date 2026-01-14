"""
Process management for mrmd services.

Handles starting, stopping, and monitoring subprocess lifecycle.
"""

import asyncio
import subprocess
import signal
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Callable
import logging

logger = logging.getLogger(__name__)


@dataclass
class ProcessInfo:
    """Information about a managed process."""

    name: str
    process: Optional[asyncio.subprocess.Process] = None
    pid: Optional[int] = None
    command: list[str] = field(default_factory=list)
    cwd: Optional[str] = None
    status: str = "stopped"  # stopped, starting, running, stopping, failed
    output_lines: list[str] = field(default_factory=list)
    max_output_lines: int = 100

    def add_output(self, line: str):
        """Add output line, keeping buffer bounded."""
        self.output_lines.append(line)
        if len(self.output_lines) > self.max_output_lines:
            self.output_lines = self.output_lines[-self.max_output_lines:]


class ProcessManager:
    """Manages subprocess lifecycle for mrmd services."""

    def __init__(self):
        self.processes: dict[str, ProcessInfo] = {}
        self._output_tasks: dict[str, asyncio.Task] = {}
        self._on_output: Optional[Callable[[str, str], None]] = None

    def set_output_handler(self, handler: Callable[[str, str], None]):
        """Set callback for process output: handler(process_name, line)."""
        self._on_output = handler

    async def start(
        self,
        name: str,
        command: list[str],
        cwd: Optional[str] = None,
        env: Optional[dict] = None,
        wait_for: Optional[str] = None,
        timeout: float = 30.0,
    ) -> ProcessInfo:
        """
        Start a process.

        Args:
            name: Unique name for this process
            command: Command and arguments
            cwd: Working directory
            env: Additional environment variables
            wait_for: String to wait for in output before returning
            timeout: Timeout for wait_for

        Returns:
            ProcessInfo with status
        """
        if name in self.processes and self.processes[name].status == "running":
            logger.warning(f"Process {name} already running")
            return self.processes[name]

        info = ProcessInfo(name=name, command=command, cwd=cwd, status="starting")
        self.processes[name] = info

        # Prepare environment
        process_env = dict(subprocess.os.environ)
        if env:
            process_env.update(env)

        # Force unbuffered output for Python
        process_env["PYTHONUNBUFFERED"] = "1"

        try:
            logger.info(f"Starting {name}: {' '.join(command)}")

            process = await asyncio.create_subprocess_exec(
                *command,
                cwd=cwd,
                env=process_env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )

            info.process = process
            info.pid = process.pid

            # Start output reader
            ready_event = asyncio.Event() if wait_for else None
            self._output_tasks[name] = asyncio.create_task(
                self._read_output(name, process, wait_for, ready_event)
            )

            # Wait for ready string or just a moment
            if wait_for and ready_event:
                try:
                    await asyncio.wait_for(ready_event.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    logger.warning(f"{name} did not show '{wait_for}' within {timeout}s")

            # Check if still running
            if process.returncode is not None:
                info.status = "failed"
                logger.error(f"{name} exited with code {process.returncode}")
            else:
                info.status = "running"
                logger.info(f"{name} started (PID {process.pid})")

        except Exception as e:
            info.status = "failed"
            logger.error(f"Failed to start {name}: {e}")

        return info

    async def _read_output(
        self,
        name: str,
        process: asyncio.subprocess.Process,
        wait_for: Optional[str],
        ready_event: Optional[asyncio.Event],
    ):
        """Read process output and handle wait_for."""
        info = self.processes.get(name)
        if not info or not process.stdout:
            return

        try:
            async for line_bytes in process.stdout:
                line = line_bytes.decode("utf-8", errors="replace").rstrip()
                info.add_output(line)

                if self._on_output:
                    self._on_output(name, line)
                else:
                    # Default: print with prefix
                    print(f"[{name}] {line}")

                # Check for ready string
                if wait_for and ready_event and wait_for in line:
                    ready_event.set()

        except Exception as e:
            logger.error(f"Error reading {name} output: {e}")

        # Process ended
        if info:
            info.status = "stopped"
            logger.info(f"{name} exited")

    async def stop(self, name: str, timeout: float = 5.0) -> bool:
        """
        Stop a process gracefully.

        Args:
            name: Process name
            timeout: Seconds to wait before force kill

        Returns:
            True if stopped successfully
        """
        info = self.processes.get(name)
        if not info or not info.process:
            return True

        if info.status != "running":
            return True

        info.status = "stopping"
        process = info.process

        try:
            # Try graceful termination
            logger.info(f"Stopping {name} (PID {process.pid})")
            process.terminate()

            try:
                await asyncio.wait_for(process.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                # Force kill
                logger.warning(f"{name} did not stop gracefully, killing")
                process.kill()
                await process.wait()

            info.status = "stopped"
            info.pid = None
            logger.info(f"{name} stopped")
            return True

        except Exception as e:
            logger.error(f"Error stopping {name}: {e}")
            return False

    async def stop_all(self, timeout: float = 5.0):
        """Stop all managed processes."""
        tasks = [
            self.stop(name, timeout)
            for name, info in self.processes.items()
            if info.status == "running"
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def get_status(self) -> dict[str, dict]:
        """Get status of all processes."""
        return {
            name: {
                "status": info.status,
                "pid": info.pid,
                "command": info.command,
            }
            for name, info in self.processes.items()
        }

    def get_output(self, name: str, lines: int = 50) -> list[str]:
        """Get recent output lines from a process."""
        info = self.processes.get(name)
        if not info:
            return []
        return info.output_lines[-lines:]

    def is_running(self, name: str) -> bool:
        """Check if a process is running."""
        info = self.processes.get(name)
        return info is not None and info.status == "running"

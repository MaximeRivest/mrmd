"""
Main orchestrator for mrmd services.

Coordinates starting/stopping of sync server, monitors, and runtimes.
Supports per-document dedicated Python runtimes for true process isolation.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .config import OrchestratorConfig
from .processes import ProcessManager
from .project import find_project_root, find_venv, get_project_info
from . import python_runtime

logger = logging.getLogger(__name__)


@dataclass
class SessionInfo:
    """Information about an active session (document + its resources)."""
    doc: str
    monitor_process: Optional[str] = None
    runtime_process: Optional[str] = None
    runtime_url: Optional[str] = None
    runtime_port: Optional[int] = None
    dedicated_runtime: bool = False
    venv: Optional[str] = None  # Path to virtual environment


class Orchestrator:
    """
    Orchestrates mrmd services.

    Can run in two modes:
    - Local/development: Starts all services as subprocesses
    - Distributed: Connects to existing remote services
    """

    def __init__(self, config: Optional[OrchestratorConfig] = None, project_dir: Optional[str] = None):
        self.config = config or OrchestratorConfig.for_development()
        self.processes = ProcessManager()
        self._monitors: dict[str, str] = {}  # doc_name -> process_name
        self._sessions: dict[str, SessionInfo] = {}  # doc_name -> SessionInfo
        self._started = False

        # Detect project info (venv, cwd, etc.)
        self._project_info = get_project_info(project_dir)
        self._project_venv: Optional[str] = None
        if self._project_info.get("venv"):
            self._project_venv = str(self._project_info["venv"])
            logger.info(f"Detected project venv: {self._project_venv}")

    async def start(self):
        """Start all managed services."""
        if self._started:
            return

        logger.info("Starting mrmd orchestrator...")

        # Start sync server if managed
        if self.config.sync.managed:
            await self._start_sync()

        # Start runtimes if managed
        for lang, runtime_config in self.config.runtimes.items():
            if runtime_config.managed:
                await self._start_runtime(lang, runtime_config)

        # Start AI server if managed
        if self.config.ai.managed:
            await self._start_ai()

        self._started = True
        logger.info("Orchestrator ready")

    async def stop(self):
        """Stop all managed services."""
        if not self._started:
            return

        logger.info("Stopping mrmd orchestrator...")

        # Stop all monitors first
        for doc_name in list(self._monitors.keys()):
            await self.stop_monitor(doc_name)

        # Stop daemon runtimes (unless --keep-runtime was specified)
        # This releases GPU memory and other resources
        keep_runtime = getattr(self, '_keep_runtime', False)
        if not keep_runtime:
            killed = python_runtime.stop_all_runtimes()
            if killed > 0:
                logger.info("Python runtime stopped (GPU memory released)")
        else:
            logger.info("Keeping Python runtime running (use 'mrmd-python --kill-all' to stop)")

        # Stop all managed processes
        await self.processes.stop_all()

        self._started = False
        logger.info("Orchestrator stopped")

    async def _start_sync(self):
        """Start mrmd-sync server."""
        config = self.config.sync
        package_path = Path(config.package_path) if config.package_path else None

        # Ensure project root exists
        project_root = Path(config.project_root)
        project_root.mkdir(parents=True, exist_ok=True)

        # Use local package if available, otherwise fall back to npx
        if package_path and package_path.exists():
            command = [
                "node",
                str(package_path / "bin" / "cli.js"),
                "--port", str(config.port),
                str(project_root.absolute()),
            ]
            cwd = str(package_path)
        else:
            # Fall back to npx (uses npm package)
            logger.info("Using npx mrmd-sync (npm package)")
            command = [
                "npx", "mrmd-sync",
                "--port", str(config.port),
                str(project_root.absolute()),
            ]
            cwd = str(project_root)

        await self.processes.start(
            name="mrmd-sync",
            command=command,
            cwd=cwd,
            wait_for="Server started",  # JSON output contains this
            timeout=30.0,  # npx may take longer to download
        )

    async def _start_runtime(self, language: str, runtime_config):
        """Start a runtime server."""
        if language == "python":
            await self._start_python_runtime(runtime_config)
        else:
            logger.warning(f"Unknown runtime language: {language}")

    async def _start_python_runtime(self, runtime_config):
        """
        Start the shared mrmd-python runtime as an independent daemon.

        The daemon:
        - Runs as an independent process (survives orchestrator restart)
        - Registers in ~/.mrmd/runtimes/ for discovery
        - Variables persist across orchestrator restarts
        - GPU memory released only when explicitly killed
        """
        env_config = getattr(self, '_environment', {})
        cwd = env_config.get('cwd') or str(Path.cwd())

        # Use port from config if specified
        port = runtime_config.port if runtime_config.port else 0

        # Start daemon (or get existing)
        info = python_runtime.start_runtime(
            runtime_id="shared",
            venv=self._project_venv,
            cwd=cwd,
            port=port,
        )

        if info:
            # Update config with actual URL from daemon
            runtime_config.url = info.get("url")
            logger.info(f"Python runtime ready: {info.get('url')} (PID {info.get('pid')})")
        else:
            logger.error("Failed to start Python runtime")

    async def _start_ai(self):
        """Start mrmd-ai server."""
        import os
        config = self.config.ai
        package_path = Path(config.package_path) if config.package_path else None

        # Pass through API keys from environment
        env = {}
        for key in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]:
            if value := os.environ.get(key):
                env[key] = value

        # Check if we have API keys (AI is useless without them)
        if not env:
            logger.info("No AI API keys found in environment, AI features disabled")
            return

        # Determine how to run mrmd-ai
        if package_path and package_path.exists() and (package_path / "src").exists():
            # Development mode: use uv run from package directory
            logger.debug(f"Starting mrmd-ai from development source: {package_path}")
            command = [
                "uv", "run", "mrmd-ai-server",
                "--host", "127.0.0.1",
                "--port", str(config.port),
            ]
            cwd = str(package_path)
        else:
            # Installed mode: try to run mrmd-ai as installed package
            import sys
            try:
                import mrmd_ai  # noqa: F401
                logger.debug("Starting mrmd-ai from installed package")
                command = [
                    sys.executable, "-m", "mrmd_ai.server",
                    "--host", "127.0.0.1",
                    "--port", str(config.port),
                ]
                cwd = str(Path.cwd())
            except ImportError:
                logger.info("mrmd-ai not installed, AI features disabled")
                return

        await self.processes.start(
            name="mrmd-ai",
            command=command,
            cwd=cwd,
            env=env,
            wait_for="Uvicorn running",
            timeout=15.0,
        )

    async def start_monitor(self, doc_name: str) -> bool:
        """
        Start a monitor for a specific document.

        Args:
            doc_name: Document name (Yjs room name)

        Returns:
            True if monitor started successfully
        """
        if not self.config.monitor.managed:
            logger.warning("Monitors not managed by orchestrator")
            return False

        if doc_name in self._monitors:
            logger.info(f"Monitor for {doc_name} already running")
            return True

        package_path = Path(self.config.monitor.package_path) if self.config.monitor.package_path else None

        process_name = f"monitor:{doc_name}"

        # Use local package if available, otherwise fall back to npx
        if package_path and package_path.exists():
            command = [
                "node",
                str(package_path / "bin" / "cli.js"),
                "--doc", doc_name,
                self.config.sync.url,
            ]
            cwd = str(package_path)
        else:
            # Fall back to npx (uses npm package)
            logger.info(f"Using npx mrmd-monitor for {doc_name}")
            command = [
                "npx", "mrmd-monitor",
                "--doc", doc_name,
                self.config.sync.url,
            ]
            cwd = str(Path.cwd())

        info = await self.processes.start(
            name=process_name,
            command=command,
            cwd=cwd,
            wait_for="Monitor ready",
            timeout=30.0,  # npx may take longer to download
        )

        if info.status == "running":
            self._monitors[doc_name] = process_name
            logger.info(f"Started monitor for {doc_name}")
            return True
        else:
            logger.error(f"Failed to start monitor for {doc_name}")
            return False

    async def stop_monitor(self, doc_name: str) -> bool:
        """
        Stop the monitor for a specific document.

        Args:
            doc_name: Document name

        Returns:
            True if monitor stopped successfully
        """
        process_name = self._monitors.get(doc_name)
        if not process_name:
            return True

        success = await self.processes.stop(process_name)
        if success:
            del self._monitors[doc_name]
            logger.info(f"Stopped monitor for {doc_name}")
        return success

    def get_monitor_docs(self) -> list[str]:
        """Get list of documents with active monitors."""
        return list(self._monitors.keys())

    def is_monitor_running(self, doc_name: str) -> bool:
        """Check if monitor is running for a document."""
        process_name = self._monitors.get(doc_name)
        return process_name is not None and self.processes.is_running(process_name)

    def get_status(self) -> dict:
        """Get status of all services."""
        # Get Python runtime status from daemon registry
        python_runtimes = python_runtime.list_runtimes()
        shared_runtime = next((r for r in python_runtimes if r.get("id") == "shared"), None)

        return {
            "started": self._started,
            "sync": {
                "managed": self.config.sync.managed,
                "url": self.config.sync.url,
                "running": self.processes.is_running("mrmd-sync"),
            },
            "runtimes": {
                "python": {
                    "managed": True,
                    "url": shared_runtime.get("url") if shared_runtime else None,
                    "running": shared_runtime.get("alive", False) if shared_runtime else False,
                    "pid": shared_runtime.get("pid") if shared_runtime else None,
                    "daemon": True,  # Indicates it's an independent daemon
                },
            },
            "ai": {
                "managed": self.config.ai.managed,
                "url": self.config.ai.url,
                "running": self.processes.is_running("mrmd-ai"),
                "default_juice_level": self.config.ai.default_juice_level,
            },
            "monitors": {
                doc: {
                    "running": self.is_monitor_running(doc),
                }
                for doc in self._monitors
            },
            "python_daemons": [
                {
                    "id": r.get("id"),
                    "url": r.get("url"),
                    "pid": r.get("pid"),
                    "alive": r.get("alive", False),
                }
                for r in python_runtimes
            ],
            "processes": self.processes.get_status(),
        }

    def get_urls(self) -> dict:
        """Get URLs for all services."""
        return {
            "sync": self.config.sync.url,
            "runtimes": {
                lang: cfg.url
                for lang, cfg in self.config.runtimes.items()
            },
            "ai": self.config.ai.url if self.config.ai.managed or self.config.ai.url else None,
            "editor": f"http://localhost:{self.config.editor.port}" if self.config.editor.enabled else None,
        }

    # =========================================================================
    # Session Management (per-document resources)
    # =========================================================================

    async def create_session(
        self,
        doc_name: str,
        python: str = "shared",
        venv: Optional[str] = None,
    ) -> SessionInfo:
        """
        Create a session for a document with optional dedicated runtime.

        Args:
            doc_name: Document name (Yjs room name)
            python: "shared" to use the shared runtime, "dedicated" for isolated runtime
            venv: Path to virtual environment. If None and python="dedicated",
                  uses the auto-detected project venv if available.

        Returns:
            SessionInfo with URLs and process info

        Note:
            When a dedicated session uses a venv, the runtime runs as a separate
            process. Destroying the session kills that process, releasing all
            resources including GPU memory (important for vLLM, etc.).
        """
        # For dedicated sessions, use detected project venv if no venv specified
        effective_venv = venv
        if python == "dedicated" and not venv and self._project_venv:
            effective_venv = self._project_venv
            logger.info(f"Using detected project venv for dedicated session: {effective_venv}")

        # Check if session already exists
        if doc_name in self._sessions:
            session = self._sessions[doc_name]
            # If requesting dedicated but have shared (or vice versa), or different venv, recreate
            if (python == "dedicated") != session.dedicated_runtime or session.venv != effective_venv:
                await self.destroy_session(doc_name)
            else:
                return session

        session = SessionInfo(doc=doc_name, venv=effective_venv)

        # Start monitor for this document
        if self.config.monitor.managed:
            await self.start_monitor(doc_name)
            session.monitor_process = self._monitors.get(doc_name)

        # Handle Python runtime - use daemon-based approach
        if python == "dedicated":
            # Start dedicated daemon runtime for this document
            runtime_id = f"doc:{doc_name}"
            info = python_runtime.start_runtime(
                runtime_id=runtime_id,
                venv=effective_venv,
                cwd=str(Path.cwd()),
            )

            if info:
                session.runtime_process = runtime_id  # Now just the daemon ID
                session.runtime_url = info.get("url")
                session.runtime_port = info.get("port")
                session.dedicated_runtime = True
                logger.info(f"Started dedicated Python runtime for {doc_name}: {info.get('url')}")
            else:
                logger.error(f"Failed to start dedicated runtime for {doc_name}")
        else:
            # Use shared runtime - ensure it's running
            url = python_runtime.ensure_runtime(
                runtime_id="shared",
                venv=self._project_venv,
            )
            if url:
                session.runtime_url = url
                session.dedicated_runtime = False
            else:
                # Fallback to config URL
                python_config = self.config.runtimes.get("python")
                if python_config:
                    session.runtime_url = python_config.url
                    session.dedicated_runtime = False

        self._sessions[doc_name] = session
        logger.info(f"Created session for {doc_name} (dedicated={session.dedicated_runtime})")
        return session

    async def destroy_session(self, doc_name: str) -> bool:
        """
        Destroy a session and clean up its resources.

        For dedicated runtimes, this kills the daemon process,
        releasing all memory including GPU/VRAM.

        Args:
            doc_name: Document name

        Returns:
            True if session was destroyed
        """
        session = self._sessions.get(doc_name)
        if not session:
            return True

        # Stop dedicated runtime daemon if any
        if session.dedicated_runtime and session.runtime_process:
            # runtime_process is now the daemon ID
            python_runtime.stop_runtime(session.runtime_process)
            logger.info(f"Killed dedicated runtime for {doc_name}")

        # Stop monitor
        if session.monitor_process:
            await self.stop_monitor(doc_name)

        del self._sessions[doc_name]
        logger.info(f"Destroyed session for {doc_name}")
        return True

    def get_session(self, doc_name: str) -> Optional[SessionInfo]:
        """Get session info for a document."""
        return self._sessions.get(doc_name)

    def get_sessions(self) -> dict[str, SessionInfo]:
        """Get all active sessions."""
        return dict(self._sessions)

    def get_session_info(self, doc_name: str) -> Optional[dict]:
        """Get session info as a dict for API responses."""
        session = self._sessions.get(doc_name)
        if not session:
            return None

        return {
            "doc": session.doc,
            "sync": self.config.sync.url,
            "monitor": {
                "status": "running" if self.is_monitor_running(doc_name) else "stopped",
                "name": session.monitor_process,
            },
            "runtimes": {
                "python": {
                    "url": session.runtime_url,
                    "dedicated": session.dedicated_runtime,
                    "port": session.runtime_port,
                    "process": session.runtime_process,
                    "venv": session.venv,
                }
            } if session.runtime_url else {},
        }

    def get_project_info(self) -> dict:
        """Get detected project info."""
        return {
            "root": str(self._project_info.get("root", "")),
            "name": self._project_info.get("name", ""),
            "type": self._project_info.get("type", "unknown"),
            "venv": self._project_venv,
            "project_root": str(self._project_info.get("project_root", "")),
        }

    @property
    def project_venv(self) -> Optional[str]:
        """Get the detected project venv path."""
        return self._project_venv

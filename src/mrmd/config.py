"""
Configuration for mrmd-orchestrator.

Supports both local (start everything) and distributed (connect to remote services) modes.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
import os


@dataclass
class SyncConfig:
    """Configuration for mrmd-sync."""

    # If True, orchestrator starts mrmd-sync. If False, connects to existing.
    managed: bool = True

    # WebSocket URL (used when managed=False, or as the URL to expose)
    url: str = "ws://localhost:41444"

    # Port to run on (when managed=True)
    port: int = 41444

    # Project root directory to sync (when managed=True)
    project_root: str = "."

    # Path to mrmd-sync package (auto-detected if None)
    package_path: Optional[str] = None


@dataclass
class RuntimeConfig:
    """Configuration for a runtime (mrmd-python, etc.)."""

    # If True, orchestrator starts this runtime. If False, connects to existing.
    managed: bool = True

    # HTTP URL for the runtime
    url: str = "http://localhost:41765/mrp/v1"

    # Port to run on (when managed=True)
    port: int = 41765

    # Language this runtime handles
    language: str = "python"

    # Path to runtime package (auto-detected if None)
    package_path: Optional[str] = None


@dataclass
class MonitorConfig:
    """Configuration for mrmd-monitor."""

    # If True, orchestrator can start monitors. If False, monitors are external.
    managed: bool = True

    # Path to mrmd-monitor package (auto-detected if None)
    package_path: Optional[str] = None

    # Auto-start monitor when document is opened
    auto_start: bool = True

    # Auto-stop monitor after idle timeout (seconds, 0 = never)
    idle_timeout: int = 0


@dataclass
class EditorConfig:
    """Configuration for serving the editor."""

    # If True, serve editor static files
    enabled: bool = True

    # Port for HTTP server
    port: int = 41580

    # Path to mrmd-editor package (auto-detected if None)
    package_path: Optional[str] = None


@dataclass
class AiConfig:
    """Configuration for mrmd-ai server."""

    # If True, orchestrator starts mrmd-ai. If False, connects to existing.
    managed: bool = True

    # HTTP URL for the AI server
    url: str = "http://localhost:51790"

    # Port to run on (when managed=True)
    port: int = 51790

    # Default juice level (0-4)
    default_juice_level: int = 0

    # Path to mrmd-ai package (auto-detected if None)
    package_path: Optional[str] = None


@dataclass
class OrchestratorConfig:
    """Main configuration for the orchestrator."""

    # Base directory for mrmd-packages (auto-detected if None)
    packages_dir: Optional[str] = None

    # Sync server config
    sync: SyncConfig = field(default_factory=SyncConfig)

    # Runtime configs (language -> config)
    runtimes: dict[str, RuntimeConfig] = field(default_factory=lambda: {
        "python": RuntimeConfig()
    })

    # Monitor config
    monitor: MonitorConfig = field(default_factory=MonitorConfig)

    # Editor config
    editor: EditorConfig = field(default_factory=EditorConfig)

    # AI server config
    ai: AiConfig = field(default_factory=AiConfig)

    # Log level
    log_level: str = "info"

    def resolve_paths(self) -> "OrchestratorConfig":
        """Resolve package paths relative to packages_dir."""
        if self.packages_dir is None:
            # Try to auto-detect from current file location or cwd
            self.packages_dir = self._find_packages_dir()

        packages = Path(self.packages_dir)

        if self.sync.package_path is None:
            self.sync.package_path = str(packages / "mrmd-sync")

        if self.monitor.package_path is None:
            self.monitor.package_path = str(packages / "mrmd-monitor")

        if self.editor.package_path is None:
            self.editor.package_path = str(packages / "mrmd-editor")

        if self.ai.package_path is None:
            self.ai.package_path = str(packages / "mrmd-ai")

        for runtime in self.runtimes.values():
            if runtime.package_path is None:
                if runtime.language == "python":
                    runtime.package_path = str(packages / "mrmd-python")
                # Add more languages as needed

        return self

    def _find_packages_dir(self) -> str:
        """Try to find mrmd-packages directory."""
        # Check environment variable
        if env_dir := os.environ.get("MRMD_PACKAGES_DIR"):
            return env_dir

        # Check current directory
        cwd = Path.cwd()
        if (cwd / "mrmd-sync").is_dir():
            return str(cwd)

        # Check parent directory
        if (cwd.parent / "mrmd-sync").is_dir():
            return str(cwd.parent)

        # Check if we're inside a package
        for parent in cwd.parents:
            if (parent / "mrmd-sync").is_dir():
                return str(parent)

        # Default to cwd
        return str(cwd)

    @classmethod
    def for_development(cls) -> "OrchestratorConfig":
        """Create config suitable for local development."""
        return cls().resolve_paths()

    @classmethod
    def for_distributed(
        cls,
        sync_url: str,
        runtime_urls: dict[str, str],
    ) -> "OrchestratorConfig":
        """Create config for connecting to remote services."""
        config = cls()

        config.sync.managed = False
        config.sync.url = sync_url

        config.runtimes = {}
        for lang, url in runtime_urls.items():
            config.runtimes[lang] = RuntimeConfig(
                managed=False,
                url=url,
                language=lang,
            )

        config.monitor.managed = False

        return config

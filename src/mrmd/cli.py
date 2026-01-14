#!/usr/bin/env python3
"""
mrmd CLI

Starts all mrmd services and provides HTTP API for management.

Usage:
    mrmd                          # Start in current project, open README.md
    mrmd .                        # Same as above
    mrmd path/to/file.md          # Open specific file in its project
    mrmd ~/random/notes.md        # If no project found, use scratch project

Project Resolution:
    - Walks up from target looking for .git, .venv, pyproject.toml, etc.
    - Stops at home directory
    - If no project found, uses ~/Projects/scratch (created if needed)

Options:
    mrmd --port 3000              # Custom HTTP port
    mrmd --no-editor              # Don't serve editor
    mrmd --session my-notebook    # Auto-start session
"""

import argparse
import asyncio
import logging
import signal
import sys
from pathlib import Path

from .config import OrchestratorConfig, SyncConfig, RuntimeConfig, MonitorConfig, EditorConfig, AiConfig
from .orchestrator import Orchestrator
from .project import (
    resolve_target,
    get_initial_document,
    get_project_info,
    get_project_hash,
    find_venv,
)
from .venv import ensure_venv, ensure_node_deps
from .server import run_server
from .cleanup import cleanup_project, find_free_port

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("mrmd")


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        prog="mrmd",
        description="Markdown notebook editor with live Python execution",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  mrmd                           Start in current project
  mrmd .                         Same as above
  mrmd notes.md                  Open notes.md in current project
  mrmd ~/docs/ideas.md           Open file (uses scratch if no project)
  mrmd /path/to/project          Start in specific directory

Project Detection:
  mrmd looks for .git, .venv, pyproject.toml, package.json, etc.
  If no project found before reaching ~, uses ~/Projects/scratch.

The orchestrator starts:
  - mrmd-sync (Yjs sync server)
  - mrmd-python (Python runtime)
  - HTTP server for editor and API
        """,
    )

    # Positional argument: target file or directory
    parser.add_argument(
        "target",
        nargs="?",
        default=None,
        help="File to open or directory to start in (default: current directory)",
    )

    # Paths
    parser.add_argument(
        "--packages",
        help="Path to mrmd-packages directory (auto-detected by default)",
    )

    # Ports - now default to 0 (auto-assign)
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=0,
        help="HTTP server port for editor and API (default: auto-assign)",
    )
    parser.add_argument(
        "--sync-port",
        type=int,
        default=0,
        help="WebSocket port for mrmd-sync (default: auto-assign)",
    )
    parser.add_argument(
        "--runtime-port",
        type=int,
        default=0,
        help="HTTP port for Python runtime (default: auto-assign)",
    )
    parser.add_argument(
        "--ai-port",
        type=int,
        default=0,
        help="HTTP port for AI server (default: auto-assign)",
    )

    # Remote services
    parser.add_argument(
        "--sync-url",
        help="Connect to existing sync server instead of starting one",
    )
    parser.add_argument(
        "--runtime-url",
        help="Connect to existing Python runtime instead of starting one",
    )
    parser.add_argument(
        "--ai-url",
        help="Connect to existing AI server instead of starting one",
    )

    # Disable services
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="Don't start mrmd-sync",
    )
    parser.add_argument(
        "--no-runtime",
        action="store_true",
        help="Don't start mrmd-python",
    )
    parser.add_argument(
        "--no-editor",
        action="store_true",
        help="Don't serve editor files",
    )
    parser.add_argument(
        "--no-monitors",
        action="store_true",
        help="Don't allow starting monitors",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Don't start AI server",
    )

    # AI options
    parser.add_argument(
        "--juice-level", "-j",
        type=int,
        default=0,
        choices=[0, 1, 2, 3, 4],
        help="Default AI juice level: 0=Quick, 1=Balanced, 2=Deep, 3=Maximum, 4=Ultimate (default: 0)",
    )

    # Auto-start monitors
    parser.add_argument(
        "--monitor",
        action="append",
        dest="monitors",
        metavar="DOC",
        help="Auto-start monitor for document (can be repeated)",
    )

    # Auto-start sessions (with optional dedicated runtime)
    parser.add_argument(
        "--session",
        action="append",
        dest="sessions",
        metavar="DOC[:MODE]",
        help="Auto-start session for document. MODE is 'shared' (default) or 'dedicated'. "
             "Examples: --session notebook, --session notebook:dedicated (can be repeated)",
    )

    # Virtual environment for dedicated sessions
    parser.add_argument(
        "--venv",
        help="Path to virtual environment for dedicated sessions. "
             "If not specified, auto-detects .venv or venv in project root.",
    )

    # Runtime management
    parser.add_argument(
        "--keep-runtime",
        action="store_true",
        help="Keep Python runtime daemon running on exit (preserves variables)",
    )

    # Misc
    parser.add_argument(
        "--log-level",
        choices=["debug", "info", "warning", "error"],
        default="info",
        help="Log level (default: info)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Skip automatic cleanup of stale processes and PID files",
    )
    parser.add_argument(
        "--no-venv-setup",
        action="store_true",
        help="Skip automatic venv creation and dependency installation",
    )

    return parser.parse_args()


def build_config(args, project_root: Path, venv_path: Path = None) -> OrchestratorConfig:
    """Build configuration from arguments."""
    config = OrchestratorConfig()

    # Package path
    if args.packages:
        config.packages_dir = args.packages

    # Allocate ports (auto-assign by default)
    editor_port = args.port if args.port else find_free_port()
    sync_port = args.sync_port if args.sync_port else find_free_port()
    runtime_port = args.runtime_port if args.runtime_port else find_free_port()
    ai_port = args.ai_port if args.ai_port else find_free_port()

    # Sync config
    if args.sync_url:
        config.sync = SyncConfig(
            managed=False,
            url=args.sync_url,
        )
    elif args.no_sync:
        config.sync = SyncConfig(
            managed=False,
            url=f"ws://localhost:{sync_port}",
        )
    else:
        config.sync = SyncConfig(
            managed=True,
            url=f"ws://localhost:{sync_port}",
            port=sync_port,
            project_root=str(project_root),
        )

    # Runtime config
    if args.runtime_url:
        config.runtimes = {
            "python": RuntimeConfig(
                managed=False,
                url=args.runtime_url,
                language="python",
            )
        }
    elif args.no_runtime:
        config.runtimes = {
            "python": RuntimeConfig(
                managed=False,
                url=f"http://localhost:{runtime_port}/mrp/v1",
                language="python",
            )
        }
    else:
        config.runtimes = {
            "python": RuntimeConfig(
                managed=True,
                url=f"http://localhost:{runtime_port}/mrp/v1",
                port=runtime_port,
                language="python",
            )
        }

    # Monitor config
    config.monitor = MonitorConfig(
        managed=not args.no_monitors,
    )

    # Editor config
    config.editor = EditorConfig(
        enabled=not args.no_editor,
        port=editor_port,
    )

    # AI config
    if args.ai_url:
        config.ai = AiConfig(
            managed=False,
            url=args.ai_url,
            default_juice_level=args.juice_level,
        )
    elif args.no_ai:
        config.ai = AiConfig(
            managed=False,
            url=f"http://localhost:{ai_port}",
            default_juice_level=args.juice_level,
        )
    else:
        config.ai = AiConfig(
            managed=True,
            url=f"http://localhost:{ai_port}",
            port=ai_port,
            default_juice_level=args.juice_level,
        )

    # Log level
    config.log_level = args.log_level

    # Resolve package paths
    config.resolve_paths()

    return config


async def async_main(args):
    """Async main entry point."""

    # Resolve target to project root and optional file
    cwd = Path.cwd()
    project_root, target_file = resolve_target(args.target)

    # Get project info
    project_info = get_project_info(project_root)
    project_hash = get_project_hash(project_root)

    logger.info(f"Project: {project_root.name} ({project_hash[:8]})")
    if project_info.get('is_scratch'):
        logger.info("Using scratch project (no project root found)")

    # Ensure venv exists (unless disabled)
    venv_path = None
    if not args.no_venv_setup:
        venv_path = ensure_venv(project_root)
        if venv_path:
            logger.info(f"Using venv: {venv_path}")
        else:
            logger.warning("No venv available, some features may not work")

        # Ensure Node.js dependencies are installed and up to date
        node_bin_dir = ensure_node_deps(check_updates=True)
        if node_bin_dir:
            logger.debug(f"Node.js deps ready: {node_bin_dir}")
        else:
            logger.warning("Node.js deps not available, will use npx (slower)")

    # Cleanup stale processes for THIS project only (unless disabled)
    if not args.no_cleanup:
        results = cleanup_project(project_root)
        if results['sync_cleaned']:
            logger.info("Cleaned up stale mrmd-sync state")
        if results['runtimes_cleaned']:
            logger.info(f"Cleaned up {results['runtimes_cleaned']} stale runtime(s)")
        if results['processes_cleaned']:
            logger.info(f"Freed ports: {results['processes_cleaned']}")

    # Build config with auto-assigned ports
    config = build_config(args, project_root, venv_path)

    # Set log level
    logging.getLogger().setLevel(getattr(logging, config.log_level.upper()))

    # Determine initial document to open
    initial_doc = get_initial_document(project_root, target_file, cwd)
    logger.info(f"Opening document: {initial_doc}")

    # Create orchestrator
    orchestrator = Orchestrator(config)

    # Set project root and venv
    orchestrator._project_root = project_root
    if args.venv:
        orchestrator._project_venv = str(Path(args.venv).expanduser().resolve())
        logger.info(f"Using explicit venv: {orchestrator._project_venv}")
    elif venv_path:
        orchestrator._project_venv = str(venv_path)

    # Setup shutdown handler with force-exit on second Ctrl+C
    shutdown_event = asyncio.Event()
    shutdown_count = [0]

    def handle_signal():
        shutdown_count[0] += 1
        if shutdown_count[0] == 1:
            logger.info("Shutdown requested... (Ctrl+C again to force exit)")
            shutdown_event.set()
        else:
            logger.info("Force exit!")
            import os
            os._exit(0)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    try:
        # Start orchestrator
        await orchestrator.start()

        # Auto-start monitors if specified (legacy flag)
        if args.monitors:
            for doc in args.monitors:
                await orchestrator.create_session(doc, python="shared")

        # Auto-start sessions if specified
        if args.sessions:
            for session_spec in args.sessions:
                if ":" in session_spec:
                    parts = session_spec.rsplit(":", 1)
                    doc = parts[0]
                    mode = parts[1].lower()
                    if mode not in ("shared", "dedicated"):
                        logger.warning(f"Invalid session mode '{mode}' for {doc}, using 'shared'")
                        mode = "shared"
                else:
                    doc = session_spec
                    mode = "shared"

                session_venv = args.venv if args.venv else None
                await orchestrator.create_session(doc, python=mode, venv=session_venv)
                logger.info(f"Started session for {doc} (python={mode})")

        # Print status
        urls = orchestrator.get_urls()
        sessions = orchestrator.get_sessions()
        juice_names = ["Quick", "Balanced", "Deep", "Maximum", "Ultimate"]

        print()
        print(f"\033[36m  mrmd - {project_root.name}\033[0m")
        print("  " + "─" * 40)
        print(f"  Project:  {project_root}")
        print(f"  Editor:   http://localhost:{config.editor.port}")
        print(f"  Sync:     {urls['sync']}")
        print(f"  Runtime:  {urls['runtimes'].get('python', 'not running')}")
        if orchestrator.project_venv:
            print(f"  Venv:     {orchestrator.project_venv}")
        if urls.get('ai'):
            print(f"  AI:       {urls['ai']} (juice={juice_names[config.ai.default_juice_level]})")
        print(f"  Document: {initial_doc}")
        print()

        # Show active sessions
        if sessions:
            print("  \033[36mActive Sessions:\033[0m")
            for doc, session in sessions.items():
                runtime_info = "dedicated" if session.dedicated_runtime else "shared"
                port_info = f" (port {session.runtime_port})" if session.runtime_port else ""
                venv_info = f", venv" if session.venv else ""
                print(f"    {doc}: python={runtime_info}{port_info}{venv_info}")
            print()

        # Run server (blocks until shutdown)
        server_task = asyncio.create_task(
            run_server(
                orchestrator,
                port=config.editor.port,
                initial_doc=initial_doc,
            )
        )

        # Wait for shutdown signal
        await shutdown_event.wait()

        # Cancel server
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass

    finally:
        # Stop orchestrator
        orchestrator._keep_runtime = getattr(args, 'keep_runtime', False)
        await orchestrator.stop()


def main():
    """Main entry point."""
    args = parse_args()

    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

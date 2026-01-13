#!/usr/bin/env python3
"""
mrmd - Collaborative markdown notebooks.

Usage:
    mrmd                    # Open editor in current project
    mrmd --docs ./notes     # Use custom docs directory
    mrmd --port 3000        # Use custom port
    mrmd --no-browser       # Don't open browser automatically
"""

import argparse
import asyncio
import logging
import signal
import sys
import webbrowser
from pathlib import Path

from .project import find_project_root, find_docs_dir, get_project_info
from .processes import ProcessManager
from .server import create_app, run_server

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
        description="Collaborative markdown notebooks - edit and run code together",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  mrmd                      Open editor in current project
  mrmd --docs ./notes       Use custom docs directory
  mrmd --port 3000          Use custom port
  mrmd --no-browser         Don't open browser automatically

mrmd automatically detects your project root by looking for:
  .git, .venv, pyproject.toml, package.json, etc.
        """,
    )

    parser.add_argument(
        "--docs", "-d",
        help="Documents directory (default: auto-detect ./docs, ./notebooks, or ./notes)",
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8080,
        help="HTTP server port (default: 8080)",
    )
    parser.add_argument(
        "--sync-port",
        type=int,
        default=4444,
        help="WebSocket sync port (default: 4444)",
    )
    parser.add_argument(
        "--runtime-port",
        type=int,
        default=8765,
        help="Python runtime port (default: 8765)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open browser automatically",
    )
    parser.add_argument(
        "--no-runtime",
        action="store_true",
        help="Don't start Python runtime",
    )
    parser.add_argument(
        "--log-level",
        choices=["debug", "info", "warning", "error"],
        default="info",
        help="Log level (default: info)",
    )

    return parser.parse_args()


async def async_main(args):
    """Async main entry point."""

    # Get project info
    project_info = get_project_info()
    project_root = project_info["root"]

    # Determine docs directory
    if args.docs:
        docs_dir = Path(args.docs)
        if not docs_dir.is_absolute():
            docs_dir = project_root / docs_dir
    else:
        docs_dir = find_docs_dir(project_root)

    # Ensure docs directory exists
    docs_dir.mkdir(parents=True, exist_ok=True)

    # URLs
    sync_url = f"ws://localhost:{args.sync_port}"
    runtime_url = f"http://localhost:{args.runtime_port}/mrp/v1"
    orchestrator_url = f"http://localhost:{args.port}"

    # Print banner
    print()
    print("\033[36m  mrmd\033[0m - collaborative markdown notebooks")
    print("  " + "─" * 45)
    print(f"  Project:  {project_root}")
    print(f"  Docs:     {docs_dir}")
    print(f"  Editor:   {orchestrator_url}")
    print(f"  Sync:     {sync_url}")
    if not args.no_runtime:
        print(f"  Runtime:  {runtime_url}")
    print()

    # Create process manager
    processes = ProcessManager()

    # Shutdown event
    shutdown_event = asyncio.Event()

    def handle_signal():
        logger.info("Shutdown requested...")
        shutdown_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    try:
        # Start mrmd-sync via npx (uses npm package)
        await processes.start_npx_process(
            "mrmd-sync",
            "mrmd-sync",
            args=[
                "--port", str(args.sync_port),
                str(docs_dir),
            ],
            on_output=lambda line: logger.debug(f"[sync] {line}"),
        )

        # Wait a moment for sync to start
        await asyncio.sleep(0.5)

        # Start mrmd-python runtime (installed as dependency)
        if not args.no_runtime:
            await processes.start_python_process(
                "mrmd-python",
                "mrmd_python.cli",
                args=["--port", str(args.runtime_port)],
                cwd=project_root,
                on_output=lambda line: logger.debug(f"[runtime] {line}"),
            )

        # Create and configure FastAPI app
        app = create_app(
            project_root=project_root,
            docs_dir=docs_dir,
            sync_url=sync_url,
            sync_port=args.sync_port,
            runtime_url=runtime_url,
        )

        # Open browser
        if not args.no_browser:
            webbrowser.open(orchestrator_url)

        # Start HTTP server
        server_task = asyncio.create_task(
            run_server(app, port=args.port)
        )

        # Wait for shutdown
        await shutdown_event.wait()

        # Cancel server
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass

    finally:
        # Stop all processes
        print()
        logger.info("Stopping services...")
        await processes.stop_all()
        logger.info("Goodbye!")


def main():
    """Main entry point."""
    args = parse_args()

    # Set log level
    logging.getLogger().setLevel(getattr(logging, args.log_level.upper()))

    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

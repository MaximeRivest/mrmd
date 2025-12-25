"""
mrmd server application.

Main entry point for the mrmd web server.
"""

import asyncio
import atexit
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

from aiohttp import web

from .handlers import setup_http_routes
from .pty_handler import setup_pty_routes
from .collab_handler import setup_collab_routes, init_collab_file_watcher, shutdown_collab_file_watcher
from .sessions import SessionManager


# Global reference to AI server process for cleanup
_ai_server_process = None


def kill_process_on_port(port: int) -> bool:
    """Kill any process using the specified port. Returns True if killed."""
    try:
        result = subprocess.run(
            ["lsof", "-t", f"-i:{port}"],
            capture_output=True,
            text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except (ProcessLookupError, ValueError):
                    pass
            return True
    except Exception:
        pass
    return False


def get_ai_server_path() -> Path | None:
    """Get path to the ai-server directory."""
    # Check for bundled app
    resources_dir = os.environ.get("MRMD_RESOURCES")
    if resources_dir:
        bundled_ai = Path(resources_dir) / "ai-server"
        if bundled_ai.exists():
            return bundled_ai

    # Check relative to package
    pkg_dir = Path(__file__).parent.parent.parent.parent
    ai_path = pkg_dir / "ai-server"
    if ai_path.exists():
        return ai_path

    return None


def start_ai_server(host: str = "127.0.0.1", port: int = 51790) -> subprocess.Popen | None:
    """Start the AI server (mrmd-ai-server with juice support) as a subprocess.

    Returns the subprocess.Popen object or None if failed.
    """
    global _ai_server_process

    ai_server_path = get_ai_server_path()
    if not ai_server_path:
        print("  [AI] ai-server directory not found, AI features disabled")
        return None

    # Check if port is already in use (maybe from previous run)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind((host if host != "localhost" else "127.0.0.1", port))
        sock.close()
    except OSError:
        print(f"  [AI] Port {port} in use, stopping existing AI server...")
        kill_process_on_port(port)
        import time
        time.sleep(0.5)
        sock.close()

    # Start AI server
    try:
        # Use uv run to execute our custom mrmd-ai-server with juice support
        cmd = [os.path.expanduser("~/.local/bin/uv"), "run", "mrmd-ai-server", "--host", host, "--port", str(port)]

        print(f"  [AI] Starting AI server on port {port} (with juice levels)...")

        # Start process with output suppressed (or redirected to log)
        log_path = ai_server_path / "logs" / "server.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)

        with open(log_path, "w") as log_file:
            _ai_server_process = subprocess.Popen(
                cmd,
                cwd=ai_server_path,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # Detach from terminal
            )

        print(f"  [AI] AI server started (PID: {_ai_server_process.pid})")
        print(f"  [AI] Log: {log_path}")

        return _ai_server_process

    except FileNotFoundError:
        print("  [AI] 'uv' not found, AI features disabled")
        print("  [AI] Install with: curl -LsSf https://astral.sh/uv/install.sh | sh")
        return None
    except Exception as e:
        print(f"  [AI] Failed to start AI server: {e}")
        return None


def stop_ai_server():
    """Stop the AI server subprocess."""
    global _ai_server_process

    if _ai_server_process is not None:
        print("  [AI] Stopping AI server...")
        try:
            _ai_server_process.terminate()
            try:
                _ai_server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _ai_server_process.kill()
            print("  [AI] AI server stopped")
        except Exception as e:
            print(f"  [AI] Error stopping AI server: {e}")
        _ai_server_process = None


# Register cleanup on exit
atexit.register(stop_ai_server)


@web.middleware
async def cors_middleware(request: web.Request, handler):
    """Add CORS headers to all responses for Tauri app support."""
    # Handle preflight OPTIONS requests
    if request.method == "OPTIONS":
        response = web.Response()
    else:
        try:
            response = await handler(request)
        except web.HTTPException as ex:
            response = ex

    # Add CORS headers to all responses
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Juice-Level"
    response.headers["Access-Control-Max-Age"] = "3600"

    # Add no-cache headers for JavaScript files during development
    # This prevents browser caching issues when code changes
    path = request.path
    if path.startswith('/core/') and path.endswith('.js'):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response


async def on_startup(app: web.Application):
    """Initialize async resources on startup."""
    await init_collab_file_watcher()


async def on_cleanup(app: web.Application):
    """Cleanup async resources on shutdown."""
    await shutdown_collab_file_watcher()


def create_app(session_manager: SessionManager | None = None, ai_port: int = 51790) -> web.Application:
    """Create and configure the mrmd aiohttp application."""
    app = web.Application(middlewares=[cors_middleware])

    # Initialize session manager
    if session_manager is None:
        session_manager = SessionManager()
    app["session_manager"] = session_manager
    app["ai_port"] = ai_port

    # Setup routes
    setup_http_routes(app, ai_port=ai_port)
    setup_pty_routes(app)
    setup_collab_routes(app)

    # Setup startup/cleanup hooks for file watcher
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    return app


def get_frontend_path() -> Path:
    """Get the path to the frontend files."""
    import os

    # Check for bundled app (Electron packaged) - MRMD_RESOURCES env or cwd
    resources_dir = os.environ.get("MRMD_RESOURCES")
    if resources_dir:
        bundled_frontend = Path(resources_dir) / "frontend" / "web"
        if bundled_frontend.exists():
            return bundled_frontend

    # Check current working directory (Electron sets cwd to resources)
    cwd_frontend = Path.cwd() / "frontend" / "web"
    if cwd_frontend.exists():
        return cwd_frontend

    # In development, frontend is at mrmd/frontend/web
    # In installed package, it should be bundled
    pkg_dir = Path(__file__).parent.parent.parent.parent
    frontend_path = pkg_dir / "frontend" / "web"
    if frontend_path.exists():
        return frontend_path

    # Fallback to package data location
    import importlib.resources
    try:
        with importlib.resources.files("mrmd").joinpath("frontend/web") as p:
            return Path(p)
    except:
        return frontend_path


def run_server(
    host: str = "localhost",
    port: int = 51789,
    reuse_port: bool = True,
    ai_port: int = 51790,
    start_ai: bool = True,
):
    """Run the mrmd server.

    Args:
        host: Host to bind to
        port: Port to listen on
        reuse_port: If True, kill any existing process on the port first
        ai_port: Port for the AI server (dspy-cli)
        start_ai: If True, automatically start the AI server
    """
    # Check if port is in use and kill existing process if requested
    if reuse_port:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind((host if host != "localhost" else "127.0.0.1", port))
            sock.close()
        except OSError:
            print(f"Port {port} in use, stopping existing server...")
            if kill_process_on_port(port):
                import time
                time.sleep(0.5)  # Give it time to release the port
            sock.close()

    app = create_app(ai_port=ai_port)

    # Start AI server
    ai_status = "disabled"
    if start_ai:
        ai_proc = start_ai_server(host=host, port=ai_port)
        if ai_proc:
            ai_status = f"http://{host}:{ai_port}/"
        else:
            ai_status = "failed to start"

    print(f"""
╔══════════════════════════════════════════╗
║             mrmd server                  ║
║        Markdown that runs                ║
╚══════════════════════════════════════════╝

  URL:  http://{host}:{port}/
  AI:   {ai_status}

  Press Ctrl+C to stop
""")

    try:
        web.run_app(app, host=host, port=port, print=None, reuse_address=True)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"Error: Port {port} is still in use. Try a different port with --port")
            sys.exit(1)
        raise
    finally:
        # Cleanup AI server on exit
        stop_ai_server()


if __name__ == "__main__":
    run_server()

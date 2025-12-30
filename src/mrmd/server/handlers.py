"""
HTTP route handlers for mrmd server.
"""

import asyncio
import json
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional, List, Dict

from aiohttp import web, ClientSession, ClientTimeout

from . import sessions as session_mgmt
from .sessions import SessionManager
from .ipython_subprocess import SubprocessIPythonSessionManager
from .utils import strip_ansi, format_execution_result, handle_progress_output, accumulate_raw_output
from . import environment
from .history import get_history_manager
from .jobs import get_job_manager, JobStatus, JobType
from .project_pool import get_project_pool, init_project_pool


def setup_http_routes(app: web.Application, ai_port: int = 51790):
    """Setup all HTTP routes."""
    app["ai_server_url"] = f"http://localhost:{ai_port}"
    # Static pages
    app.router.add_get("/", handle_index)
    app.router.add_get("/terminal", handle_terminal)  # Terminal interface
    app.router.add_get("/rich-editor-test", handle_rich_editor_test)  # Rich editor test
    app.router.add_get("/virtualization-test", handle_virtualization_test)  # Virtualization test

    # Static file serving for frontend modules
    frontend_path = get_frontend_path().parent
    app.router.add_static("/core/", frontend_path / "core", show_index=False)
    app.router.add_static("/styles/", frontend_path / "styles", show_index=False)
    app.router.add_static("/dist/", frontend_path / "dist", show_index=False)
    app.router.add_static("/vendor/", frontend_path / "vendor", show_index=False)
    app.router.add_static("/src/", frontend_path / "src", show_index=False)  # New service architecture

    # Serve @mrmd/editor dist for new editor (with explicit MIME type for .js files)
    editor_dist = get_editor_dist_path()
    if editor_dist.exists():
        # Ensure .js files are served as JavaScript (add MIME type once at setup)
        import mimetypes as _mimetypes
        _mimetypes.add_type('application/javascript', '.js')
        _mimetypes.add_type('text/css', '.css')

        # Use custom handler to ensure correct MIME type for JavaScript modules
        def _make_editor_dist_handler(dist_path: Path):
            # Explicit MIME type mapping - takes precedence over mimetypes.guess_type
            MIME_TYPES = {
                '.js': 'application/javascript',
                '.mjs': 'application/javascript',
                '.css': 'text/css',
                '.html': 'text/html',
                '.json': 'application/json',
                '.map': 'application/json',
                '.wasm': 'application/wasm',
            }

            async def handler(request: web.Request) -> web.StreamResponse:
                """Serve editor dist files with correct MIME types."""
                import mimetypes
                file_path = request.match_info.get('path', '')
                full_path = dist_path / file_path

                if not full_path.exists() or not full_path.is_file():
                    raise web.HTTPNotFound()

                # Use explicit mapping first, then fall back to mimetypes
                ext = full_path.suffix.lower()
                content_type = MIME_TYPES.get(ext)
                if content_type is None:
                    content_type, _ = mimetypes.guess_type(str(full_path))
                if content_type is None:
                    content_type = 'application/octet-stream'

                return web.FileResponse(full_path, headers={'Content-Type': content_type})
            return handler

        app.router.add_get("/editor-dist/{path:.*}", _make_editor_dist_handler(editor_dist))
    app.router.add_get("/new-editor-test", handle_new_editor_test)

    # Session API (brepl-based, terminal emulation)
    app.router.add_post("/api/interact", handle_interact)
    app.router.add_post("/api/execute", handle_execute)  # Execute with streaming
    app.router.add_get("/api/stream/{session_id}", handle_stream)  # SSE streaming
    app.router.add_post("/api/reset", handle_reset)
    app.router.add_post("/api/resize", handle_resize)
    app.router.add_get("/api/sessions", handle_list_sessions)
    app.router.add_post("/api/close", handle_close_session)
    app.router.add_post("/api/sessions/clear-all", handle_clear_all_sessions)

    # IPython API (direct shell, richer features)
    app.router.add_post("/api/ipython/execute", handle_ipython_execute)
    app.router.add_post("/api/ipython/execute/stream", handle_ipython_execute_stream)
    app.router.add_post("/api/ipython/complete", handle_ipython_complete)
    app.router.add_post("/api/ipython/inspect", handle_ipython_inspect)
    app.router.add_post("/api/ipython/is_complete", handle_ipython_is_complete)
    app.router.add_get("/api/ipython/sessions", handle_ipython_list_sessions)
    app.router.add_post("/api/ipython/variables", handle_ipython_variables)
    app.router.add_post("/api/ipython/inspect_object", handle_ipython_inspect_object)
    app.router.add_post("/api/ipython/hover", handle_ipython_hover)
    app.router.add_post("/api/ipython/reset", handle_ipython_reset)
    app.router.add_post("/api/ipython/interrupt", handle_ipython_interrupt)
    app.router.add_post("/api/ipython/session_info", handle_ipython_session_info)
    app.router.add_post("/api/ipython/reconfigure", handle_ipython_reconfigure)
    app.router.add_post("/api/ipython/format", handle_format_code)

    # File operations
    app.router.add_post("/api/file/read", handle_file_read)
    app.router.add_post("/api/file/write", handle_file_write)
    app.router.add_post("/api/file/exists", handle_file_exists)
    app.router.add_post("/api/file/list", handle_file_list)
    app.router.add_post("/api/file/delete", handle_file_delete)
    app.router.add_post("/api/file/rename", handle_file_rename)
    app.router.add_post("/api/file/mkdir", handle_file_mkdir)
    app.router.add_post("/api/file/copy", handle_file_copy)
    app.router.add_post("/api/file/upload", handle_file_upload)
    app.router.add_post("/api/file/mtimes", handle_file_mtimes)
    app.router.add_get("/api/file/asset/{path:.*}", handle_file_asset)
    app.router.add_get("/api/file/relative/{path:.*}", handle_file_relative)
    app.router.add_get("/api/file/relative", handle_file_relative)  # Query param version

    # Asset cleanup
    app.router.add_post("/api/assets/cleanup", handle_assets_cleanup)

    # Project detection
    app.router.add_post("/api/project/detect", handle_project_detect)

    # Environment management
    app.router.add_post("/api/environments/list", handle_environments_list)
    app.router.add_post("/api/session/configure", handle_session_configure)

    # File search
    app.router.add_post("/api/files/search", handle_file_search)
    app.router.add_post("/api/files/grep/stream", handle_file_grep_stream)
    app.router.add_get("/api/pythons", handle_find_pythons)

    # Completion
    app.router.add_post("/api/complete", handle_complete)
    app.router.add_post("/api/python/command", handle_get_python_command)

    # Code formatting
    app.router.add_post("/api/format", handle_format_code)

    # Server management
    app.router.add_post("/api/server/restart", handle_server_restart)
    app.router.add_get("/api/health", handle_health)

    # MRMD environment management
    app.router.add_get("/api/mrmd/status", handle_mrmd_status)
    app.router.add_post("/api/mrmd/initialize", handle_mrmd_initialize)
    app.router.add_get("/api/mrmd/config", handle_mrmd_config_get)
    app.router.add_post("/api/mrmd/config", handle_mrmd_config_set)
    app.router.add_get("/api/mrmd/recent-projects", handle_mrmd_recent_projects_get)
    app.router.add_post("/api/mrmd/recent-projects", handle_mrmd_recent_projects_add)
    app.router.add_delete("/api/mrmd/recent-projects", handle_mrmd_recent_projects_remove)
    app.router.add_get("/api/mrmd/recent-notebooks", handle_mrmd_recent_notebooks_get)
    app.router.add_post("/api/mrmd/recent-notebooks", handle_mrmd_recent_notebooks_add)
    app.router.add_delete("/api/mrmd/recent-notebooks", handle_mrmd_recent_notebooks_remove)
    app.router.add_post("/api/project/create", handle_project_create)
    app.router.add_post("/api/project/notebooks", handle_project_notebooks)
    app.router.add_post("/api/venvs/search", handle_venvs_search)

    # Project pool (instant switching)
    app.router.add_post("/api/project/switch", handle_project_switch)
    app.router.add_post("/api/project/warm", handle_project_warm)
    app.router.add_get("/api/project/pool/status", handle_project_pool_status)

    # Welcome content
    app.router.add_get("/api/mrmd/welcome", handle_mrmd_welcome)

    # Session persistence (multi-session per project)
    app.router.add_post("/api/sessions/list", handle_sessions_list)
    app.router.add_post("/api/sessions/create", handle_sessions_create)
    app.router.add_post("/api/sessions/save", handle_sessions_save)
    app.router.add_post("/api/sessions/load", handle_sessions_load)
    app.router.add_post("/api/sessions/delete", handle_sessions_delete)
    app.router.add_post("/api/sessions/rename", handle_sessions_rename)
    app.router.add_post("/api/sessions/clear", handle_sessions_clear)
    app.router.add_post("/api/sessions/kill", handle_sessions_kill)
    app.router.add_post("/api/sessions/restore", handle_sessions_restore)
    app.router.add_post("/api/sessions/delete-saved", handle_sessions_delete_saved)
    app.router.add_post("/api/sessions/bind", handle_sessions_bind)
    app.router.add_post("/api/sessions/notebook", handle_sessions_notebook)

    # AI proxy routes (forwards to AI server on port 8766)
    app.router.add_get("/api/ai/programs", handle_ai_proxy)
    app.router.add_post("/api/ai/{program}/stream", handle_ai_proxy_stream)
    app.router.add_post("/api/ai/{program}", handle_ai_proxy)

    # Claude Code CLI integration (invoke claude CLI with context)
    app.router.add_post("/api/claude/ask", handle_claude_ask)

    # Version history
    app.router.add_post("/api/history/versions", handle_history_versions)
    app.router.add_post("/api/history/get", handle_history_get)
    app.router.add_post("/api/history/save", handle_history_save)
    app.router.add_post("/api/history/diff", handle_history_diff)
    app.router.add_post("/api/history/restore", handle_history_restore)
    app.router.add_get("/api/history/stats", handle_history_stats)

    # Jobs and notifications
    app.router.add_get("/api/jobs", handle_jobs_list)
    app.router.add_get("/api/jobs/status", handle_jobs_status)
    app.router.add_get("/api/jobs/notifications", handle_jobs_notifications)
    app.router.add_post("/api/jobs/notifications/read", handle_jobs_notifications_read)
    app.router.add_get("/api/jobs/{job_id}", handle_jobs_get)
    app.router.add_delete("/api/jobs/{job_id}", handle_jobs_delete)

    # Unified process status (for process sidebar)
    app.router.add_get("/api/processes/status", handle_processes_status)


def get_session_manager(request: web.Request) -> SessionManager:
    """Get the session manager from the app."""
    return request.app["session_manager"]


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

    # Development: frontend is at mrmd/frontend/web
    pkg_dir = Path(__file__).parent.parent.parent.parent
    return pkg_dir / "frontend" / "web"


def get_editor_dist_path() -> Path:
    """Get the path to the @mrmd/editor dist files."""
    import os

    # Check for bundled app
    resources_dir = os.environ.get("MRMD_RESOURCES")
    if resources_dir:
        bundled_editor = Path(resources_dir) / "editor" / "dist"
        if bundled_editor.exists():
            return bundled_editor

    # Check current working directory
    cwd_editor = Path.cwd() / "editor" / "dist"
    if cwd_editor.exists():
        return cwd_editor

    # Development: editor is at mrmd/editor/dist
    pkg_dir = Path(__file__).parent.parent.parent.parent
    return pkg_dir / "editor" / "dist"


# ==================== Static Pages ====================


async def handle_index(request: web.Request) -> web.Response:
    """Serve the main mrmd UI (rich editor)."""
    html_path = get_frontend_path() / "index.html"
    with open(html_path) as f:
        return web.Response(text=f.read(), content_type="text/html")


async def handle_terminal(request: web.Request) -> web.Response:
    """Serve the terminal interface (test page)."""
    html_path = get_frontend_path().parent / "test" / "web_interface.html"
    with open(html_path) as f:
        return web.Response(text=f.read(), content_type="text/html")


async def handle_rich_editor_test(request: web.Request) -> web.Response:
    """Serve the rich editor test page (legacy route, redirects to index)."""
    html_path = get_frontend_path() / "index.html"
    with open(html_path) as f:
        return web.Response(text=f.read(), content_type="text/html")


async def handle_virtualization_test(request: web.Request) -> web.Response:
    """Serve the virtualization test page."""
    html_path = get_frontend_path().parent / "test" / "virtualization-test.html"
    with open(html_path) as f:
        return web.Response(text=f.read(), content_type="text/html")


async def handle_new_editor_test(request: web.Request) -> web.Response:
    """Serve the new CodeMirror 6 editor test page."""
    html_path = get_frontend_path() / "test-new-editor.html"
    with open(html_path) as f:
        return web.Response(text=f.read(), content_type="text/html")


# ==================== Session API ====================


async def handle_interact(request: web.Request) -> web.Response:
    """Handle interact API calls."""
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
        keys = data.get("keys", "")
        wait = data.get("wait", "auto")
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_env = data.get("python_env")

        session, is_new = session_mgr.get_or_create(session_id, cwd, python_env)
        if session_id == "new":
            session_id = f"session_{session_mgr._counter}"

        state = session.interact(keys, wait=wait)

        response = state.to_dict()
        response["session_id"] = session_id
        response["session_metadata"] = session_mgr.get_metadata(session_id)

        return web.json_response(response)

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_execute(request: web.Request) -> web.Response:
    """Execute code and return result with structured output.

    Uses brepl's session.execute() for proper output parsing.
    Returns stdout, return_value, and error separately.

    For streaming: POST with stream=true, then connect to /api/stream/{session_id}
    """
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_env = data.get("python_env")
        stream = data.get("stream", False)
        language = data.get("language", "python")

        session, is_new = session_mgr.get_or_create(session_id, cwd, python_env)

        if stream:
            # For streaming, just start execution and return immediately
            # Client should connect to /api/stream/{session_id} for updates
            session.send(code)
            session.send("<enter>")
            return web.json_response({
                "status": "streaming",
                "session_id": session_id,
                "stream_url": f"/api/stream/{session_id}",
            })

        # Use brepl's execute() for structured output parsing
        # For multi-line code, we need to handle it specially:
        # - Single line: just execute directly
        # - Multi-line: use bracketed paste mode or execute as single block
        code = code.strip()
        lines = code.split('\n')

        all_stdout = []
        all_return_values = []
        last_result = None
        error_info = None

        if len(lines) == 1:
            # Single line - execute directly
            result = session.execute(code)
            last_result = result
            if result.stdout:
                all_stdout.append(result.stdout)
            if result.return_value:
                all_return_values.append(result.return_value)
            if result.has_error and result.error:
                err = result.error
                error_info = {
                    "type": getattr(err, 'error_type', type(err).__name__),
                    "message": getattr(err, 'message', str(err)),
                    "raw": getattr(err, 'raw_text', str(err)),
                }
                if hasattr(err, 'to_dict'):
                    error_info = err.to_dict()
        else:
            # Multi-line: execute each line (IPython/Python handle this)
            # TODO: Use %paste or bracketed paste for speed
            for line in lines:
                if line.strip():
                    result = session.execute(line)
                    last_result = result

                    if result.stdout:
                        all_stdout.append(result.stdout)
                    if result.return_value:
                        all_return_values.append(result.return_value)

                    if result.has_error and result.error:
                        err = result.error
                        error_info = {
                            "type": getattr(err, 'error_type', type(err).__name__),
                            "message": getattr(err, 'message', str(err)),
                            "raw": getattr(err, 'raw_text', str(err)),
                        }
                        if hasattr(err, 'to_dict'):
                            error_info = err.to_dict()
                        break

        # Build response
        response = {
            "session_id": session_id,
            "stdout": "\n".join(all_stdout) if all_stdout else "",
            "return_value": all_return_values[-1] if all_return_values else None,
            "error": error_info,
            "has_error": error_info is not None,
            "success": error_info is None,
        }

        # Add raw output for fallback
        if last_result:
            response["output"] = last_result.output
            response["raw_output"] = last_result.raw_output

        return web.json_response(response)

    except Exception as e:
        import traceback
        return web.json_response({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, status=500)


async def handle_stream(request: web.Request) -> web.StreamResponse:
    """Server-Sent Events (SSE) endpoint for streaming execution output.

    Connect to /api/stream/{session_id} after starting execution.
    Events:
      - data: {"screen": "...", "done": false}
      - done: {"screen": "...", "done": true}
    """
    import asyncio
    import json

    session_id = request.match_info.get("session_id", "default")
    session_mgr = get_session_manager(request)
    session = session_mgr.get(session_id)

    if not session:
        return web.json_response({"error": "Session not found"}, status=404)

    # Set up SSE response
    response = web.StreamResponse(
        status=200,
        reason="OK",
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )
    await response.prepare(request)

    # Stream screen updates
    last_screen = ""
    stable_count = 0
    max_stable = 10  # Consider done after 10 unchanged polls (~2 seconds)

    try:
        for _ in range(100):  # Max 100 iterations (~20 seconds)
            state = session.interact("", wait=0.1)
            current_screen = state.screen if hasattr(state, 'screen') else str(state)

            if current_screen != last_screen:
                # Screen changed, send update
                event_data = json.dumps({
                    "screen": current_screen,
                    "done": False,
                    "env_stack": state.env_stack if hasattr(state, 'env_stack') else [],
                })
                await response.write(f"data: {event_data}\n\n".encode())
                last_screen = current_screen
                stable_count = 0
            else:
                stable_count += 1

            # Check if execution appears complete
            if stable_count >= max_stable:
                # Send final event
                event_data = json.dumps({
                    "screen": current_screen,
                    "done": True,
                })
                await response.write(f"data: {event_data}\n\n".encode())
                break

            await asyncio.sleep(0.2)

    except asyncio.CancelledError:
        pass
    except ConnectionResetError:
        pass

    return response


async def handle_reset(request: web.Request) -> web.Response:
    """Reset/restart a session."""
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")
    session_mgr.close(session_id)

    session, _ = session_mgr.get_or_create(session_id)
    state = session.interact("", wait=0.3)

    response = state.to_dict()
    response["session_id"] = session_id
    return web.json_response(response)


async def handle_list_sessions(request: web.Request) -> web.Response:
    """List all active sessions."""
    session_mgr = get_session_manager(request)
    return web.json_response({"sessions": session_mgr.list_sessions()})


async def handle_close_session(request: web.Request) -> web.Response:
    """Close a specific session."""
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")

    if session_mgr.close(session_id):
        return web.json_response({"status": "closed", "session_id": session_id})
    return web.json_response({"error": "session not found"}, status=404)


async def handle_clear_all_sessions(request: web.Request) -> web.Response:
    """Close all sessions."""
    session_mgr = get_session_manager(request)
    closed = session_mgr.close_all()
    return web.json_response({"status": "cleared", "closed": closed})


async def handle_resize(request: web.Request) -> web.Response:
    """Resize terminal (future feature)."""
    return web.json_response({"status": "ok"})


# ==================== File Operations ====================


async def handle_file_read(request: web.Request) -> web.Response:
    """Read a file from disk."""
    try:
        data = await request.json()
        file_path = data.get("path")

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        path = Path(file_path).resolve()

        if not path.exists():
            return web.json_response({"error": "file not found"}, status=404)

        if not path.is_file():
            return web.json_response({"error": "not a file"}, status=400)

        content = path.read_text(encoding="utf-8")
        project_root = detect_project_root(str(path))
        environments = detect_python_environments(project_root)
        mtime = path.stat().st_mtime

        # Get latest version ID if in a project
        version_id = None
        if project_root:
            try:
                history = get_history_manager(project_root)
                latest = history.get_latest_version(str(path))
                if latest:
                    version_id = latest['id']
            except Exception:
                pass  # Don't fail read if history lookup fails

        return web.json_response({
            "content": content,
            "path": str(path),
            "project_root": project_root,
            "environments": environments,
            "mtime": mtime,
            "version_id": version_id,
        })

    except UnicodeDecodeError:
        return web.json_response({"error": "file is not valid UTF-8 text"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_write(request: web.Request) -> web.Response:
    """Write a file to disk.

    Request body: {
        path: string,
        content: string,
        author?: string (for version tracking),
        message?: string (for version tracking),
        track_version?: boolean (default true if in project)
    }

    SAFETY: Refuses to write empty content to a non-empty file to prevent
    data loss from sync issues.
    """
    try:
        data = await request.json()
        file_path = data.get("path")
        content = data.get("content")

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        if content is None:
            return web.json_response({"error": "content required"}, status=400)

        path = Path(file_path).resolve()

        # CRITICAL SAFETY CHECK: Never write empty content to non-empty file
        # This prevents data loss from sync issues or frontend bugs
        if len(content) == 0 and path.exists() and path.is_file():
            try:
                disk_size = path.stat().st_size
                if disk_size > 0:
                    print(f'[FileWrite] BLOCKED: Refusing to write empty content to non-empty file: {path} (disk size: {disk_size})')
                    return web.json_response({
                        "error": "blocked_empty_write",
                        "message": f"Refusing to overwrite {disk_size} bytes with empty content",
                        "path": str(path),
                    }, status=400)
            except Exception as check_err:
                print(f'[FileWrite] Warning: Could not check file size: {check_err}')
                # If we can't check, block to be safe
                return web.json_response({
                    "error": "blocked_empty_write",
                    "message": "Cannot verify file before empty write",
                    "path": str(path),
                }, status=400)

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        mtime = path.stat().st_mtime

        # Track version if in a project
        version_id = None
        project_root = detect_project_root(str(path))
        track_version = data.get("track_version", True)

        if project_root and track_version:
            try:
                author = data.get("author", "user:unknown")
                message = data.get("message")
                history = get_history_manager(project_root)
                version_id = history.save_version(
                    file_path=str(path),
                    content=content,
                    author=author,
                    message=message
                )
            except Exception as e:
                # Don't fail the save if version tracking fails
                print(f"[History] Failed to track version: {e}")

        return web.json_response({
            "status": "ok",
            "path": str(path),
            "bytes_written": len(content.encode("utf-8")),
            "mtime": mtime,
            "version_id": version_id,
            "project_root": project_root,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_exists(request: web.Request) -> web.Response:
    """Check if a file exists."""
    try:
        data = await request.json()
        file_path = data.get("path")

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        path = Path(file_path).resolve()

        return web.json_response({
            "exists": path.exists(),
            "is_file": path.is_file(),
            "is_dir": path.is_dir(),
            "path": str(path),
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_list(request: web.Request) -> web.Response:
    """List files in a directory."""
    try:
        data = await request.json()
        dir_path = data.get("path", ".")
        show_hidden = data.get("show_hidden", False)

        path = Path(dir_path).resolve()

        if not path.exists():
            return web.json_response({"error": "directory not found"}, status=404)

        if not path.is_dir():
            return web.json_response({"error": "not a directory"}, status=400)

        entries = []
        try:
            for entry in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                name = entry.name

                # Skip hidden files unless requested
                if not show_hidden and name.startswith('.'):
                    continue

                # Skip common non-useful directories
                if name in ('__pycache__', 'node_modules', '.git', '.venv', 'venv', '.tox', '.pytest_cache', '.mypy_cache'):
                    if entry.is_dir():
                        entries.append({
                            "name": name,
                            "path": str(entry),
                            "is_dir": True,
                            "is_file": False,
                            "collapsed": True,  # Mark as collapsed/hidden by default
                        })
                        continue

                entries.append({
                    "name": name,
                    "path": str(entry),
                    "is_dir": entry.is_dir(),
                    "is_file": entry.is_file(),
                    "size": entry.stat().st_size if entry.is_file() else None,
                    "ext": entry.suffix.lower() if entry.is_file() else None,
                })
        except PermissionError:
            return web.json_response({"error": "permission denied"}, status=403)

        return web.json_response({
            "path": str(path),
            "entries": entries,
            "parent": str(path.parent) if path != path.parent else None,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_delete(request: web.Request) -> web.Response:
    """Delete a file or directory from disk."""
    try:
        data = await request.json()
        file_path = data.get("path")
        recursive = data.get("recursive", False)

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        path = Path(file_path).resolve()

        if not path.exists():
            return web.json_response({"error": "not found"}, status=404)

        # Safety check: don't delete outside home directory
        home = Path.home()
        try:
            path.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only delete within home directory"}, status=403)

        # Additional safety: don't delete home directory itself or immediate children of home
        if path == home or path.parent == home:
            return web.json_response({"error": "cannot delete home directory or top-level folders"}, status=403)

        was_directory = path.is_dir()

        if path.is_dir():
            if not recursive:
                return web.json_response({"error": "directory deletion requires recursive=true"}, status=400)
            import shutil
            shutil.rmtree(path)
        else:
            path.unlink()

        return web.json_response({
            "status": "ok",
            "path": str(path),
            "deleted": True,
            "was_directory": was_directory,
        })

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_rename(request: web.Request) -> web.Response:
    """Rename a file or directory."""
    try:
        data = await request.json()
        old_path = data.get("old_path")
        new_path = data.get("new_path")

        if not old_path or not new_path:
            return web.json_response({"error": "old_path and new_path required"}, status=400)

        old = Path(old_path).resolve()
        new = Path(new_path).resolve()

        if not old.exists():
            return web.json_response({"error": "file not found"}, status=404)

        if new.exists():
            return web.json_response({"error": "destination already exists"}, status=400)

        # Safety check: don't rename outside home directory
        home = Path.home()
        try:
            old.relative_to(home)
            new.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only rename within home directory"}, status=403)

        old.rename(new)

        return web.json_response({
            "status": "ok",
            "old_path": str(old),
            "new_path": str(new),
        })

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_mkdir(request: web.Request) -> web.Response:
    """Create a directory."""
    try:
        data = await request.json()
        dir_path = data.get("path")

        if not dir_path:
            return web.json_response({"error": "path required"}, status=400)

        path = Path(dir_path).resolve()

        # Safety check: don't create outside home directory
        home = Path.home()
        try:
            path.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only create within home directory"}, status=403)

        if path.exists():
            return web.json_response({"error": "path already exists"}, status=400)

        path.mkdir(parents=True, exist_ok=False)

        return web.json_response({
            "status": "ok",
            "path": str(path),
        })

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_copy(request: web.Request) -> web.Response:
    """Copy a file or directory."""
    import shutil
    try:
        data = await request.json()
        src_path = data.get("src_path")
        dest_path = data.get("dest_path")

        if not src_path or not dest_path:
            return web.json_response({"error": "src_path and dest_path required"}, status=400)

        src = Path(src_path).resolve()
        dest = Path(dest_path).resolve()

        if not src.exists():
            return web.json_response({"error": "source not found"}, status=404)

        # Safety check: don't copy outside home directory
        home = Path.home()
        try:
            src.relative_to(home)
            dest.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only copy within home directory"}, status=403)

        if dest.exists():
            return web.json_response({"error": "destination already exists"}, status=400)

        if src.is_dir():
            shutil.copytree(src, dest)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)

        return web.json_response({
            "status": "ok",
            "src_path": str(src),
            "dest_path": str(dest),
        })

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_upload(request: web.Request) -> web.Response:
    """Upload files to a directory (handles multipart form data)."""
    try:
        reader = await request.multipart()
        dest_dir = None
        uploaded_files = []

        async for field in reader:
            if field.name == 'dest_dir':
                dest_dir = await field.text()
            elif field.name == 'files':
                if not dest_dir:
                    return web.json_response({"error": "dest_dir must come before files"}, status=400)

                dest_path = Path(dest_dir).resolve()

                # Safety check: don't upload outside home directory
                home = Path.home()
                try:
                    dest_path.relative_to(home)
                except ValueError:
                    return web.json_response({"error": "can only upload within home directory"}, status=403)

                dest_path.mkdir(parents=True, exist_ok=True)

                filename = field.filename
                if not filename:
                    continue

                file_path = dest_path / filename

                # Read file content
                content = await field.read()

                # Write to disk
                with open(file_path, 'wb') as f:
                    f.write(content)

                uploaded_files.append({
                    "name": filename,
                    "path": str(file_path),
                    "size": len(content),
                })

        return web.json_response({
            "status": "ok",
            "files": uploaded_files,
        })

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_mtimes(request: web.Request) -> web.Response:
    """Check modification times of multiple files.

    Used for detecting external file changes (e.g., when AI edits files).
    Request body: {"paths": ["/path/to/file1", "/path/to/file2", ...]}
    Response: {"mtimes": {"/path/to/file1": 1234567890.123, ...}}
    Files that don't exist will have null mtime.
    """
    try:
        data = await request.json()
        paths = data.get("paths", [])

        if not isinstance(paths, list):
            return web.json_response({"error": "paths must be an array"}, status=400)

        mtimes = {}
        for file_path in paths:
            try:
                path = Path(file_path).resolve()
                if path.exists() and path.is_file():
                    mtimes[file_path] = path.stat().st_mtime
                else:
                    mtimes[file_path] = None
            except Exception:
                mtimes[file_path] = None

        return web.json_response({"mtimes": mtimes})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_asset(request: web.Request) -> web.Response:
    """Serve a static asset file (images, etc.) from disk.

    Path should be an absolute path to the file.
    Used for serving matplotlib figures and other generated assets.
    """
    import mimetypes

    try:
        file_path = request.match_info.get("path", "")

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        # The route captures without the leading slash, so add it back
        if not file_path.startswith("/"):
            file_path = "/" + file_path

        path = Path(file_path).resolve()

        # Safety check: must be within home directory
        home = Path.home()
        try:
            path.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only serve files within home directory"}, status=403)

        if not path.exists():
            return web.json_response({"error": "file not found"}, status=404)

        if not path.is_file():
            return web.json_response({"error": "not a file"}, status=400)

        # Determine content type
        content_type, _ = mimetypes.guess_type(str(path))
        if content_type is None:
            content_type = "application/octet-stream"

        # Read and serve the file
        content = path.read_bytes()

        return web.Response(
            body=content,
            content_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",
            }
        )

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_relative(request: web.Request) -> web.Response:
    """Serve a file relative to a base path (for markdown image references).

    The relative path can come from URL path segment OR 'path' query parameter.
    The base path comes from the 'base' query parameter.

    Examples:
        GET /api/file/relative/.mrmd/assets/figure.png?base=/home/user/project
        GET /api/file/relative?path=../../.mrmd/assets/figure.png&base=/home/user/docs
        -> Serves the resolved file
    """
    import mimetypes

    try:
        # Support both path segment and query parameter
        relative_path = request.match_info.get("path", "") or request.query.get("path", "")
        base_path = request.query.get("base", "")

        if not relative_path:
            return web.json_response({"error": "path required"}, status=400)

        if not base_path:
            return web.json_response({"error": "base query parameter required"}, status=400)

        # Resolve the full path
        base = Path(base_path).resolve()
        full_path = (base / relative_path).resolve()

        # Safety check: resolved path must be within home directory
        home = Path.home()
        try:
            full_path.relative_to(home)
        except ValueError:
            return web.json_response({"error": "can only serve files within home directory"}, status=403)

        # Additional safety: prevent path traversal that escapes base
        try:
            full_path.relative_to(base)
        except ValueError:
            # Path traversal attempted but still within home - allow it
            # This is needed because .mrmd might be at project root
            pass

        if not full_path.exists():
            return web.json_response({"error": f"file not found: {relative_path}"}, status=404)

        if not full_path.is_file():
            return web.json_response({"error": "not a file"}, status=400)

        # Determine content type
        content_type, _ = mimetypes.guess_type(str(full_path))
        if content_type is None:
            content_type = "application/octet-stream"

        # Read and serve the file
        content = full_path.read_bytes()

        return web.Response(
            body=content,
            content_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",
            }
        )

    except PermissionError:
        return web.json_response({"error": "permission denied"}, status=403)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== Asset Cleanup ====================


async def handle_assets_cleanup(request: web.Request) -> web.Response:
    """
    Delete all asset files for a given execution ID.

    This is used when re-running a code cell to clean up the previous execution's
    assets (images, HTML files, etc.) before creating new ones.

    Request body:
        exec_id: The execution ID prefix to match (e.g., "exec-1704067200000-a3d2f")
        assets_dir: The assets directory path (e.g., "/path/to/project/.mrmd/assets")

    Response:
        deleted: List of deleted file paths
        count: Number of files deleted
    """
    try:
        data = await request.json()
        exec_id = data.get("exec_id")
        assets_dir = data.get("assets_dir")

        if not exec_id:
            return web.json_response({"error": "exec_id required"}, status=400)
        if not assets_dir:
            return web.json_response({"error": "assets_dir required"}, status=400)

        # Validate the exec_id format (basic security check)
        if not exec_id.startswith("exec-"):
            return web.json_response({"error": "invalid exec_id format"}, status=400)

        assets_path = Path(assets_dir)
        if not assets_path.exists():
            return web.json_response({"deleted": [], "count": 0})

        if not assets_path.is_dir():
            return web.json_response({"error": "assets_dir is not a directory"}, status=400)

        # Find and delete all files matching the exec_id prefix
        deleted = []
        pattern = f"{exec_id}_*"

        for file_path in assets_path.glob(pattern):
            if file_path.is_file():
                try:
                    file_path.unlink()
                    deleted.append(str(file_path))
                except Exception as e:
                    print(f"[Assets] Failed to delete {file_path}: {e}", file=sys.stderr)

        return web.json_response({
            "deleted": deleted,
            "count": len(deleted),
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== Project Detection ====================


def detect_project_root(file_path: str) -> Optional[str]:
    """Detect the project root directory by looking for common markers."""
    path = Path(file_path).resolve()
    if path.is_file():
        path = path.parent

    markers = [
        ".git", "pyproject.toml", ".venv", "venv",
        "uv.lock", "package.json", ".vscode", "Cargo.toml", "go.mod",
    ]

    current = path
    while current != current.parent:
        for marker in markers:
            if (current / marker).exists():
                return str(current)
        current = current.parent

    return str(path if path.is_dir() else path.parent)


def detect_python_environments(project_root: str) -> List[Dict]:
    """Detect available Python environments in/near a project."""
    envs = []
    root = Path(project_root)

    # Check for local venv directories
    venv_dirs = [".venv", "venv", ".env", "env"]
    for venv_name in venv_dirs:
        venv_path = root / venv_name
        if venv_path.is_dir():
            python_path = venv_path / "bin" / "python"
            if python_path.exists():
                version = get_python_version(str(python_path))
                envs.append({
                    "name": f"{venv_name} (local)",
                    "path": str(python_path),
                    "type": "venv",
                    "version": version,
                })

    # Check for uv-managed environment
    uv_venv = root / ".venv"
    if uv_venv.is_dir() and (root / "uv.lock").exists():
        python_path = uv_venv / "bin" / "python"
        if python_path.exists():
            for env in envs:
                if env["path"] == str(python_path):
                    env["type"] = "uv"
                    env["name"] = ".venv (uv)"
                    break

    # Add system Python
    for sys_python in ["/usr/bin/python3", "/usr/local/bin/python3"]:
        if Path(sys_python).exists():
            version = get_python_version(sys_python)
            envs.append({
                "name": "System Python",
                "path": sys_python,
                "type": "system",
                "version": version,
            })
            break

    return envs


def get_python_version(python_path: str) -> str:
    """Get Python version string from executable."""
    try:
        result = subprocess.run(
            [python_path, "--version"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() or result.stderr.strip()
    except:
        return "unknown"


async def handle_project_detect(request: web.Request) -> web.Response:
    """Detect project root and available environments for a file path."""
    try:
        data = await request.json()
        file_path = data.get("path")

        if not file_path:
            return web.json_response({"error": "path required"}, status=400)

        project_root = detect_project_root(file_path)
        environments = detect_python_environments(project_root)

        root = Path(project_root)
        project_type = "unknown"
        if (root / "uv.lock").exists():
            project_type = "uv"
        elif (root / "pyproject.toml").exists():
            project_type = "python"
        elif (root / "package.json").exists():
            project_type = "node"
        elif (root / "Cargo.toml").exists():
            project_type = "rust"
        elif (root / "go.mod").exists():
            project_type = "go"
        elif (root / ".git").exists():
            project_type = "git"

        return web.json_response({
            "project_root": project_root,
            "project_type": project_type,
            "environments": environments,
            "file_path": str(Path(file_path).resolve()),
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== Environment Management ====================


async def handle_environments_list(request: web.Request) -> web.Response:
    """List available Python environments."""
    try:
        data = await request.json() if request.body_exists else {}
        project_root = data.get("project_root", os.getcwd())

        environments = detect_python_environments(project_root)

        return web.json_response({
            "environments": environments,
            "project_root": project_root,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_session_configure(request: web.Request) -> web.Response:
    """Configure session settings (cwd, python env, etc.)."""
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_env = data.get("python_env")

        if cwd:
            session_mgr.set_metadata(session_id, "cwd", cwd)
            session = session_mgr.get(session_id)
            if session:
                session.interact(f"cd {cwd}<enter>", wait="auto")

        if python_env:
            session_mgr.set_metadata(session_id, "python_env", python_env)

        return web.json_response({
            "status": "ok",
            "session_id": session_id,
            "config": session_mgr.get_metadata(session_id),
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== File Search ====================


def fuzzy_match(pattern: str, text: str) -> tuple:
    """Simple fuzzy matching. Returns (match_score, matched_indices)."""
    pattern = pattern.lower()
    text_lower = text.lower()

    if not pattern:
        return (1, [])

    pattern_idx = 0
    indices = []
    consecutive_bonus = 0
    last_idx = -2

    for i, char in enumerate(text_lower):
        if pattern_idx < len(pattern) and char == pattern[pattern_idx]:
            indices.append(i)
            if i == last_idx + 1:
                consecutive_bonus += 10
            if i == 0 or text[i-1] in "/_-.":
                consecutive_bonus += 5
            last_idx = i
            pattern_idx += 1

    if pattern_idx < len(pattern):
        return (0, [])

    score = 100 - len(text) * 0.5 + consecutive_bonus
    return (score, indices)


# Project markers for detecting project roots
PROJECT_MARKERS = {
    ".git": "git",
    "pyproject.toml": "python",
    "setup.py": "python",
    "package.json": "node",
    "Cargo.toml": "rust",
    "go.mod": "go",
    "uv.lock": "uv",
    ".venv": "python",
    "venv": "python",
}


def detect_project_type(folder_path: str) -> Optional[Dict]:
    """Detect if a folder is a project root and return project info."""
    folder = Path(folder_path)
    if not folder.is_dir():
        return None

    markers_found = []
    project_type = None

    try:
        entries = set(e.name for e in folder.iterdir())
        for marker, ptype in PROJECT_MARKERS.items():
            if marker in entries:
                markers_found.append(marker)
                if project_type is None:
                    project_type = ptype
    except (PermissionError, OSError):
        pass

    if markers_found:
        return {
            "is_project": True,
            "type": project_type,
            "markers": markers_found,
        }
    return None


async def handle_file_search(request: web.Request) -> web.Response:
    """Search for files/folders using fzf for fast fuzzy matching.

    Modes:
    - "files": Search for files (default: markdown files)
    - "folders": Search for directories (with project detection)
    - "all": Search both files and folders
    """
    try:
        data = await request.json()
        query = data.get("query", "")
        root = data.get("root", os.path.expanduser("~"))
        mode = data.get("mode", "files")  # "files", "folders", "all"
        extensions = data.get("extensions", [".md"])  # Only for files mode
        max_results = data.get("max_results", 50)
        include_hidden = data.get("include_hidden", False)

        root = Path(root).resolve()
        if not root.exists():
            root = Path.home()

        # Build exclusion patterns
        exclude_patterns = [
            "*/node_modules/*",
            "*/__pycache__/*",
            "*/.cache/*",
            "*/.npm/*",
            "*/.cargo/registry/*",
            "*/.local/share/Trash/*",
        ]
        if not include_hidden:
            exclude_patterns.append("*/.*")

        exclude_args = " ".join([f"-not -path '{p}'" for p in exclude_patterns])

        # Build find command based on mode
        if mode == "folders":
            # Search for directories only
            find_cmd = f"find {root} -type d {exclude_args} 2>/dev/null"
        elif mode == "all":
            # Search both files and directories
            ext_filter = ""
            if extensions:
                ext_args = " -o ".join([f"-name '*{ext}'" for ext in extensions])
                ext_filter = f"\\( {ext_args} \\)"
            find_cmd = f"find {root} \\( -type f {ext_filter} -o -type d \\) {exclude_args} 2>/dev/null"
        else:
            # Default: search files only
            ext_args = " -o ".join([f"-name '*{ext}'" for ext in extensions])
            find_cmd = f"find {root} \\( -type f -o -type l \\) \\( {ext_args} \\) {exclude_args} 2>/dev/null"

        # Use fzf for filtering if query provided
        if query:
            # Escape single quotes in query for shell safety
            safe_query = query.replace("'", "'\\''")
            fzf_cmd = f"{find_cmd} | fzf --filter='{safe_query}' --no-sort | head -{max_results}"
        else:
            fzf_cmd = f"{find_cmd} | head -{max_results * 2}"

        try:
            result = subprocess.run(fzf_cmd, shell=True, capture_output=True, text=True, timeout=15)
            paths = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
        except subprocess.TimeoutExpired:
            paths = []
        except FileNotFoundError:
            # fzf not installed, fall back to basic filtering
            result = subprocess.run(find_cmd, shell=True, capture_output=True, text=True, timeout=15)
            all_paths = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            if query:
                # Basic substring matching fallback
                query_lower = query.lower()
                paths = [p for p in all_paths if query_lower in p.lower()][:max_results]
            else:
                paths = all_paths[:max_results * 2]

        results = []
        for filepath in paths[:max_results]:
            try:
                relpath = os.path.relpath(filepath, root)
                filename = os.path.basename(filepath)
                is_dir = os.path.isdir(filepath)
                _, indices = fuzzy_match(query, relpath) if query else (0, [])

                entry = {
                    "path": filepath,
                    "relpath": relpath,
                    "filename": filename,
                    "is_dir": is_dir,
                    "score": max_results - len(results),
                    "indices": indices,
                }

                # Add project detection for folders
                if is_dir:
                    project_info = detect_project_type(filepath)
                    if project_info:
                        entry["project"] = project_info

                results.append(entry)
            except (ValueError, OSError):
                # Skip paths that cause issues (e.g., permission errors)
                continue

        return web.json_response({
            "results": results,
            "root": str(root),
            "query": query,
            "mode": mode,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_file_grep_stream(request: web.Request) -> web.StreamResponse:
    """Stream content search results via SSE using ripgrep.

    Request body:
    {
        "query": "search pattern",
        "root": "/path/to/project",
        "max_results": 50,
        "extensions": [".py", ".js", ".md"],  # optional filter
        "case_sensitive": false
    }

    SSE Events:
    - match: {"path": "...", "filename": "...", "line_number": N, "match_text": "...", "match_indices": [...]}
    - done: {"total": N, "truncated": bool}
    - error: {"message": "..."}
    """
    response = web.StreamResponse(
        status=200,
        reason='OK',
        headers={
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        }
    )
    await response.prepare(request)

    proc = None
    try:
        data = await request.json()
        query = data.get("query", "").strip()
        root = data.get("root", os.path.expanduser("~"))
        max_results = min(data.get("max_results", 50), 100)
        extensions = data.get("extensions", [".md", ".py", ".js", ".ts", ".json", ".txt", ".html", ".css"])
        case_sensitive = data.get("case_sensitive", False)

        if not query or len(query) < 2:
            await response.write(b"event: done\ndata: {\"total\": 0, \"truncated\": false}\n\n")
            return response

        root = Path(root).resolve()
        if not root.exists():
            root = Path.home()

        # Build ripgrep command
        rg_args = [
            "rg",
            "--json",                    # Structured output for parsing
            "--max-count", "3",          # Max matches per file
            "--max-filesize", "1M",      # Skip huge files
            "--no-heading",              # Separate lines per match
        ]

        if not case_sensitive:
            rg_args.append("--smart-case")

        # Add file type filters
        for ext in extensions:
            rg_args.extend(["--glob", f"*{ext}"])

        # Exclude common directories
        for exclude in ["node_modules", "__pycache__", ".git", ".cache", "venv", ".venv", ".tox", "dist", "build"]:
            rg_args.extend(["--glob", f"!{exclude}/**"])

        rg_args.append("--")
        rg_args.append(query)
        rg_args.append(str(root))

        # Start ripgrep subprocess
        proc = await asyncio.create_subprocess_exec(
            *rg_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        total_matches = 0
        seen_files = set()
        truncated = False

        # Stream results line by line
        async for line in proc.stdout:
            if total_matches >= max_results:
                truncated = True
                break

            try:
                entry = json.loads(line.decode('utf-8', errors='replace'))
                if entry.get("type") != "match":
                    continue

                match_data = entry.get("data", {})
                path_data = match_data.get("path", {})
                filepath = path_data.get("text", "")

                # Skip if we've already sent a match for this file
                if filepath in seen_files:
                    continue
                seen_files.add(filepath)

                line_number = match_data.get("line_number", 1)
                lines = match_data.get("lines", {})
                match_text = lines.get("text", "").strip()[:200]  # Truncate long lines

                # Get match positions for highlighting
                submatches = match_data.get("submatches", [])
                match_indices = []
                for sm in submatches:
                    match_indices.append({
                        "start": sm.get("start", 0),
                        "end": sm.get("end", 0)
                    })

                result = {
                    "path": filepath,
                    "filename": os.path.basename(filepath),
                    "line_number": line_number,
                    "match_text": match_text,
                    "match_indices": match_indices,
                }

                sse_data = f"event: match\ndata: {json.dumps(result)}\n\n"
                await response.write(sse_data.encode('utf-8'))
                total_matches += 1

            except json.JSONDecodeError:
                continue

        # Send done event
        done_data = {"total": total_matches, "truncated": truncated}
        await response.write(f"event: done\ndata: {json.dumps(done_data)}\n\n".encode('utf-8'))

    except FileNotFoundError:
        # ripgrep not installed - send error
        error_msg = {"message": "ripgrep (rg) not installed. Install with: sudo apt install ripgrep"}
        await response.write(f"event: error\ndata: {json.dumps(error_msg)}\n\n".encode('utf-8'))
    except Exception as e:
        error_msg = {"message": str(e)}
        await response.write(f"event: error\ndata: {json.dumps(error_msg)}\n\n".encode('utf-8'))
    finally:
        if proc:
            try:
                proc.kill()
                await proc.wait()
            except ProcessLookupError:
                pass

    return response


async def handle_find_pythons(request: web.Request) -> web.Response:
    """Find all Python interpreters (venvs, system, pyenv, etc.)."""
    try:
        scan_root = request.query.get("root", "/home")
        scan_root = Path(scan_root).resolve()
        if not scan_root.exists():
            scan_root = Path.home()

        pythons = []
        seen_paths = set()

        try:
            cmd = f"find {scan_root} \\( -type f -o -type l \\) \\( -name 'python' -o -name 'python3' \\) -path '*/bin/*' -not -path '*/lib/*' -not -path '*/.pyenv/shims/*' 2>/dev/null"
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)

            for line in result.stdout.strip().split("\n"):
                path = line.strip()
                if path and path not in seen_paths and os.path.exists(path):
                    seen_paths.add(path)

                    env_type = "venv"
                    if ".pyenv/versions" in path:
                        env_type = "pyenv"
                    elif "/usr/" in path:
                        env_type = "system"
                    elif ".local/share/uv/python" in path:
                        env_type = "uv-managed"

                    parts = Path(path).parts
                    if "bin" in parts:
                        bin_idx = parts.index("bin")
                        venv_name = parts[bin_idx - 1] if bin_idx > 0 else "unknown"
                        project_path = str(Path(*parts[:bin_idx]))
                    else:
                        venv_name = "python"
                        project_path = str(Path(path).parent.parent)

                    version = get_python_version(path)

                    pythons.append({
                        "path": path,
                        "name": venv_name,
                        "type": env_type,
                        "version": version,
                        "project": project_path,
                    })
        except subprocess.TimeoutExpired:
            pass

        for sys_path in ["/usr/bin/python3", "/usr/bin/python", "/usr/local/bin/python3"]:
            if os.path.exists(sys_path) and sys_path not in seen_paths:
                seen_paths.add(sys_path)
                pythons.append({
                    "path": sys_path,
                    "name": "System Python",
                    "type": "system",
                    "version": get_python_version(sys_path),
                    "project": "/usr",
                })

        pythons.sort(key=lambda x: (0 if x["type"] in ["venv", "uv"] else 1, x["path"]))

        return web.json_response({
            "pythons": pythons,
            "count": len(pythons),
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def get_ipython_start_command(python_path: Optional[str] = None, cwd: Optional[str] = None) -> str:
    """Get the command to start IPython, with fallback to regular Python."""
    if cwd:
        uv_lock = Path(cwd) / "uv.lock"
        pyproject = Path(cwd) / "pyproject.toml"
        if uv_lock.exists() or pyproject.exists():
            try:
                result = subprocess.run(
                    ["uv", "run", "ipython", "--version"],
                    capture_output=True, text=True, timeout=5, cwd=cwd
                )
                if result.returncode == 0:
                    return "uv run ipython"
            except:
                pass
            try:
                result = subprocess.run(
                    ["uv", "run", "python", "-c", "import IPython"],
                    capture_output=True, text=True, timeout=5, cwd=cwd
                )
                if result.returncode == 0:
                    return "uv run python -m IPython"
            except:
                pass
            return "uv run python"

    if python_path:
        venv_bin = Path(python_path).parent
        ipython_path = venv_bin / "ipython"
        if ipython_path.exists():
            return str(ipython_path)
        try:
            result = subprocess.run(
                [python_path, "-c", "import IPython"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return f"{python_path} -m IPython"
        except:
            pass
        return python_path

    try:
        result = subprocess.run(["ipython", "--version"], capture_output=True, timeout=5)
        if result.returncode == 0:
            return "ipython"
    except:
        pass
    try:
        result = subprocess.run(["python3", "-c", "import IPython"], capture_output=True, timeout=5)
        if result.returncode == 0:
            return "python3 -m IPython"
    except:
        pass
    return "python3"


async def handle_get_python_command(request: web.Request) -> web.Response:
    """Get the command to start IPython for a given configuration."""
    try:
        data = await request.json()
    except:
        data = {}

    python_path = data.get("python_path")
    cwd = data.get("cwd")

    command = get_ipython_start_command(python_path, cwd)

    return web.json_response({
        "command": command,
        "is_ipython": "ipython" in command.lower() or "IPython" in command,
    })


async def handle_complete(request: web.Request) -> web.Response:
    """Get completions for a prefix in a session."""
    session_mgr = get_session_manager(request)

    try:
        data = await request.json()
        session_id = data.get("session", "python")
        prefix = data.get("prefix", "")

        session = session_mgr.get(session_id)
        if not session:
            return web.json_response({
                "error": "Session not found",
                "candidates": [],
                "inserted_text": "",
                "mode": "NONE",
            }, status=404)

        # Clear any existing input first
        session.interact("<ctrl+u>", wait=0.05)

        # Type the prefix
        if prefix:
            session.interact(prefix, wait=0.05)

        # Use CompletionEngine
        result = session._completer.complete()

        # Clean up
        session.interact("<escape><ctrl+u>", wait=0.05)

        return web.json_response({
            "candidates": result.candidates,
            "inserted_text": result.inserted_text,
            "mode": result.mode,
            "is_complete": result.is_complete,
        })

    except Exception as e:
        return web.json_response({
            "error": str(e),
            "candidates": [],
            "inserted_text": "",
            "mode": "NONE",
        }, status=500)


# ==================== IPython API ====================
# Direct IPython shell integration for richer features


def get_ipython_manager(request: web.Request) -> SubprocessIPythonSessionManager:
    """Get the IPython session manager from the app."""
    if "ipython_manager" not in request.app:
        request.app["ipython_manager"] = SubprocessIPythonSessionManager()
    return request.app["ipython_manager"]


def get_or_create_session_with_restore(
    manager: SubprocessIPythonSessionManager,
    session_id: str,
    project_path: Optional[str] = None,
    python_path: Optional[str] = None,
    cwd: Optional[str] = None,
    figure_dir: Optional[str] = None,
):
    """
    Get or create an IPython session, auto-restoring saved state if available.

    If the session doesn't exist yet and there's saved state on disk,
    automatically restore it.
    """
    # Check if session already exists (is running)
    is_new = session_id not in manager.sessions

    # Create or get the session
    session = manager.get_or_create(
        session_id,
        python_path=python_path,
        cwd=cwd or project_path,
        figure_dir=figure_dir,
    )

    # If this is a new session and we have a project path, check for saved state
    if is_new and project_path:
        proj_manager = session_mgmt.get_project_session_manager(project_path)
        if proj_manager.has_saved_state(session_id):
            saved_path = proj_manager.get_saved_path(session_id)
            try:
                load_result = session.load_namespace(str(saved_path), merge=False)
                if load_result.get("success"):
                    # Update metadata to reflect loaded state
                    proj_manager.update_session(
                        session_id,
                        state="live",
                        variables_count=load_result.get("loaded_count", 0),
                    )
                    print(f"[Sessions] Auto-restored {session_id} with {load_result.get('loaded_count', 0)} variables")
            except Exception as e:
                print(f"[Sessions] Failed to auto-restore {session_id}: {e}")

    return session


async def handle_ipython_execute(request: web.Request) -> web.Response:
    """
    Execute Python code in an IPython session.

    Returns structured output with stdout, stderr, result, and rich displays.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_path = data.get("python_path")  # Python executable to use
        store_history = data.get("store_history", True)
        figure_dir = data.get("figure_dir")  # Directory to save matplotlib figures
        project_path = data.get("project_path")  # Project root for relative paths
        exec_id = data.get("exec_id")  # Execution ID for asset naming

        session = manager.get_or_create(
            session_id,
            python_path=python_path,
            cwd=cwd,
            figure_dir=figure_dir,
        )

        result = session.execute(code, store_history=store_history, exec_id=exec_id)

        # Convert display_data to JSON-safe format
        display_data = []
        for display in result.display_data:
            # New format: asset reference (from matplotlib hook, plotly, etc.)
            if "asset" in display:
                display_data.append({"asset": display["asset"]})
                continue

            # Legacy format: inline MIME data
            item = {
                "data": {},
                "metadata": display.get("metadata", {})
            }
            data_dict = display.get("data", {})

            for mime_type, content in data_dict.items():
                if mime_type.startswith("image/"):
                    if isinstance(content, bytes):
                        item["data"][mime_type] = content.decode("utf-8")
                    else:
                        item["data"][mime_type] = content
                else:
                    item["data"][mime_type] = content

            display_data.append(item)

        # Format output for display (clean, ANSI-stripped)
        formatted_output = format_execution_result(
            stdout=result.stdout,
            stderr=result.stderr,
            result=result.result,
            error=result.error,
            display_data=display_data,
            strip_ansi_codes=True,
            project_root=project_path or cwd
        )

        # Get the actual Python being used by this session
        session_info = session.get_info()

        return web.json_response({
            "session_id": session_id,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "result": result.result,
            "error": result.error,
            "success": result.success,
            "execution_count": result.execution_count,
            "display_data": display_data,
            "saved_assets": result.saved_assets,
            "formatted_output": formatted_output,
            # Include Python info so frontend knows what's running
            "python_path": session_info.get("python"),
        })

    except Exception as e:
        import traceback
        return web.json_response({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, status=500)


async def handle_ipython_execute_stream(request: web.Request) -> web.StreamResponse:
    """
    Execute Python code with streaming output via Server-Sent Events.

    Sends chunks IN REAL-TIME as they're produced, then final result.
    Events:
      - chunk: {"stream": "stdout"|"stderr", "content": "...", "accumulated": "..."}
      - result: Full ExecutionResult JSON with formatted_output
      - done: Signals completion
    """
    import json
    import asyncio
    import threading
    import queue as queue_module

    manager = get_ipython_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_path = data.get("python_path")
        store_history = data.get("store_history", True)
        figure_dir = data.get("figure_dir")
        project_path = data.get("project_path")  # For auto-restore of saved sessions
        exec_id = data.get("exec_id")  # Execution ID for asset naming

        session = get_or_create_session_with_restore(
            manager,
            session_id,
            project_path=project_path,
            python_path=python_path,
            cwd=cwd,
            figure_dir=figure_dir,
        )

        # Set up SSE response
        response = web.StreamResponse(
            status=200,
            reason="OK",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "X-Accel-Buffering": "no",
            }
        )
        await response.prepare(request)

        # Queue for streaming chunks from the subprocess
        output_queue = queue_module.Queue()
        accumulated_stdout = ""
        accumulated_stderr = ""

        def on_output(stream_name: str, content: str):
            output_queue.put({"stream": stream_name, "content": content})

        # Run execution in background thread
        result_holder = [None]
        error_holder = [None]

        def run_execution():
            try:
                result_holder[0] = session.execute_streaming(
                    code,
                    on_output=on_output,
                    store_history=store_history,
                    exec_id=exec_id,
                )
            except Exception as e:
                import traceback
                error_holder[0] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
                print(f"[IPython] Execution thread error: {error_holder[0]}", file=sys.stderr)
            finally:
                output_queue.put({"done": True})

        exec_thread = threading.Thread(target=run_execution, daemon=True)
        exec_thread.start()

        # Stream output as it comes
        while True:
            try:
                try:
                    msg = output_queue.get(timeout=0.05)
                except queue_module.Empty:
                    await asyncio.sleep(0.01)
                    continue

                if msg.get("done"):
                    break

                content = msg.get("content", "")
                stream = msg.get("stream", "stdout")

                # Accumulate RAW output with all escape sequences preserved
                # The client's TerminalBuffer will handle cursor movement, colors, etc.
                if stream == "stderr":
                    accumulated_stderr = accumulate_raw_output(accumulated_stderr, content)
                else:
                    accumulated_stdout = accumulate_raw_output(accumulated_stdout, content)

                combined = accumulated_stdout
                if accumulated_stderr:
                    if combined and not combined.endswith('\n'):
                        combined += '\n'
                    combined += accumulated_stderr

                # Send RAW content and accumulated - client will process escape sequences
                chunk_data = {
                    "stream": stream,
                    "content": content,  # Raw content with escape sequences
                    "accumulated": combined  # Raw accumulated with escape sequences
                }
                await response.write(f"event: chunk\ndata: {json.dumps(chunk_data)}\n\n".encode())

            except Exception as e:
                print(f"Streaming error: {e}")
                break

        exec_thread.join(timeout=1.0)

        # Check for thread errors
        if error_holder[0]:
            error_data = json.dumps({
                "session_id": session_id,
                "stdout": "",
                "stderr": error_holder[0],
                "result": None,
                "error": {"type": "ExecutionError", "message": error_holder[0]},
                "success": False,
                "execution_count": 0,
                "display_data": [],
                "saved_assets": [],
                "formatted_output": f"Execution error: {error_holder[0]}",
                "python_path": None,
            })
            await response.write(f"event: result\ndata: {error_data}\n\n".encode())
            await response.write(f"event: done\ndata: {{}}\n\n".encode())
            return response

        # Send final result
        final_result = result_holder[0]
        if final_result:
            display_data = []
            for display in (final_result.display_data or []):
                # New format: asset reference (from matplotlib hook, plotly, etc.)
                if "asset" in display:
                    display_data.append({"asset": display["asset"]})
                    continue

                # Legacy format: inline MIME data
                item = {"data": {}, "metadata": display.get("metadata", {})}
                for mime_type, content in display.get("data", {}).items():
                    if isinstance(content, bytes):
                        item["data"][mime_type] = content.decode("utf-8")
                    else:
                        item["data"][mime_type] = content
                display_data.append(item)

            formatted_output = format_execution_result(
                stdout=final_result.stdout,
                stderr=final_result.stderr,
                result=final_result.result,
                error=final_result.error,
                display_data=display_data,
                strip_ansi_codes=True,
                project_root=project_path or cwd
            )

            session_info = session.get_info()

            result_data = json.dumps({
                "session_id": session_id,
                "stdout": final_result.stdout,
                "stderr": final_result.stderr,
                "result": final_result.result,
                "error": final_result.error,
                "success": final_result.success,
                "execution_count": final_result.execution_count,
                "display_data": display_data,
                "saved_assets": final_result.saved_assets,
                "formatted_output": formatted_output,
                "python_path": session_info.get("python"),
            })
            await response.write(f"event: result\ndata: {result_data}\n\n".encode())

        await response.write(f"event: done\ndata: {{}}\n\n".encode())
        return response

    except Exception as e:
        import traceback
        return web.json_response({
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, status=500)


async def handle_ipython_complete(request: web.Request) -> web.Response:
    """
    Get completions at cursor position.

    Used for inline completion and autocomplete popups.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        cursor_pos = data.get("cursor_pos", len(code))
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_path = data.get("python_path")

        # Use get_or_create to ensure session exists for completion
        session = manager.get_or_create(session_id, python_path=python_path, cwd=cwd)
        if not session:
            return web.json_response({
                "session_id": session_id,
                "matches": [],
                "cursor_start": cursor_pos,
                "cursor_end": cursor_pos,
                "metadata": {},
            })

        result = session.complete(code, cursor_pos)

        return web.json_response({
            "session_id": session_id,
            "matches": result.matches,
            "cursor_start": result.cursor_start,
            "cursor_end": result.cursor_end,
            "metadata": result.metadata,
        })

    except Exception as e:
        return web.json_response({
            "error": str(e),
            "matches": [],
        }, status=500)


async def handle_ipython_inspect(request: web.Request) -> web.Response:
    """
    Get object information for hover/inspection.

    Returns docstring, signature, type info.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        cursor_pos = data.get("cursor_pos", len(code))
        session_id = data.get("session", "default")
        cwd = data.get("cwd")
        python_path = data.get("python_path")

        # Use get_or_create to ensure session exists for inspection
        session = manager.get_or_create(session_id, python_path=python_path, cwd=cwd)
        if not session:
            return web.json_response({
                "session_id": session_id,
                "found": False,
            })

        result = session.inspect(code, cursor_pos)

        return web.json_response({
            "session_id": session_id,
            "found": result.get("found", False),
            "name": result.get("name"),
            "docstring": result.get("docstring"),
            "signature": result.get("signature"),
            "type_name": result.get("type_name"),
        })

    except Exception as e:
        return web.json_response({
            "error": str(e),
            "found": False,
        }, status=500)


async def handle_ipython_is_complete(request: web.Request) -> web.Response:
    """
    Check if code is complete or needs more input.

    Used to determine if Enter should execute or add a newline.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
        code = data.get("code", "")
        session_id = data.get("session", "default")

        session = manager.get(session_id)
        if not session:
            # No session yet, use simple heuristic
            return web.json_response({
                "session_id": session_id,
                "status": "complete",
                "indent": "",
            })

        result = session.is_complete(code)

        return web.json_response({
            "session_id": session_id,
            "status": result.get("status", "complete"),
            "indent": result.get("indent", ""),
        })

    except Exception as e:
        return web.json_response({
            "error": str(e),
            "status": "unknown",
        }, status=500)


async def handle_ipython_list_sessions(request: web.Request) -> web.Response:
    """List all active IPython sessions."""
    manager = get_ipython_manager(request)
    return web.json_response({
        "sessions": manager.list_sessions(),
    })


async def handle_ipython_variables(request: web.Request) -> web.Response:
    """
    Get variables in a session's namespace.
    Like RStudio's Environment pane.

    Returns variable info: name, type, shape/size, preview.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")

    session = manager.get(session_id)
    if not session:
        return web.json_response({
            "session_id": session_id,
            "variables": [],
        })

    variables = session.get_variables()

    return web.json_response({
        "session_id": session_id,
        "variables": variables,
    })


async def handle_ipython_inspect_object(request: web.Request) -> web.Response:
    """
    Inspect an object by path for drill-down.

    Accepts path like "df", "obj.attr", "mylist[0]".
    Returns info about the object and its children (attributes, items, etc).
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session_id = data.get("session", "default")
    path = data.get("path")

    if not path:
        return web.json_response({"error": "Missing 'path' parameter"}, status=400)

    session = manager.get(session_id)
    if not session:
        return web.json_response({"error": "Session not found"}, status=404)

    result = session.inspect_object(path)
    result["session_id"] = session_id

    return web.json_response(result)


async def handle_ipython_hover(request: web.Request) -> web.Response:
    """
    Get hover information for a variable/expression.

    Returns value preview, type info, and docstring for hover tooltips.
    Used by the rich editor for IDE-like hover inspection.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    session_id = data.get("session", "default")
    name = data.get("name")

    if not name:
        return web.json_response({"error": "Missing 'name' parameter"}, status=400)

    session = manager.get(session_id)
    if not session:
        return web.json_response({"error": "Session not found", "found": False}, status=404)

    result = session.hover_inspect(name)
    result["session_id"] = session_id

    return web.json_response(result)


async def handle_ipython_reset(request: web.Request) -> web.Response:
    """Reset an IPython session (clear namespace)."""
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")

    session = manager.get(session_id)
    if session:
        session.reset()
        return web.json_response({
            "status": "reset",
            "session_id": session_id,
        })

    return web.json_response({
        "error": "Session not found",
    }, status=404)


async def handle_ipython_interrupt(request: web.Request) -> web.Response:
    """
    Interrupt execution in an IPython session.

    Sends a keyboard interrupt signal to try to stop running code.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")

    session = manager.get(session_id)
    if session:
        try:
            session.interrupt()
            return web.json_response({
                "status": "interrupted",
                "session_id": session_id,
            })
        except Exception as e:
            return web.json_response({
                "status": "interrupt_attempted",
                "session_id": session_id,
                "warning": str(e),
            })

    return web.json_response({
        "error": "Session not found",
    }, status=404)


async def handle_ipython_session_info(request: web.Request) -> web.Response:
    """
    Get information about an IPython session.

    Returns the Python path, version, cwd, and other session metadata.
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")

    session = manager.get(session_id)
    if not session:
        return web.json_response({
            "session_id": session_id,
            "exists": False,
        })

    info = session.get_info()
    return web.json_response({
        "session_id": session_id,
        "exists": True,
        "alive": session.is_alive(),
        "python_path": session.python_path,
        "python_executable": info.get("python_executable"),
        "python_version": info.get("python_version"),
        "cwd": info.get("cwd"),
        "pid": info.get("pid"),
    })


async def handle_ipython_reconfigure(request: web.Request) -> web.Response:
    """
    Reconfigure a session with a new Python executable and/or cwd.

    This closes the existing session subprocess and starts a new one.
    All session state (variables, history) is lost.

    Request:
        {
            "session": "default",
            "python_path": "/path/to/.venv/bin/python",  # optional
            "cwd": "/path/to/project"  # optional
        }

    Response:
        {
            "success": true,
            "session_id": "default",
            "python_path": "/path/to/.venv/bin/python",
            "python_version": "3.11.5",
            "cwd": "/path/to/project"
        }
    """
    manager = get_ipython_manager(request)

    try:
        data = await request.json()
    except:
        data = {}

    session_id = data.get("session", "default")
    python_path = data.get("python_path")
    cwd = data.get("cwd")

    # Validate python_path if provided
    if python_path:
        python_path_obj = Path(python_path)
        if not python_path_obj.exists():
            return web.json_response({
                "success": False,
                "error": f"Python executable not found: {python_path}",
            }, status=400)
        if not python_path_obj.is_file():
            return web.json_response({
                "success": False,
                "error": f"Not a file: {python_path}",
            }, status=400)

    # Reconfigure the session (closes old, starts new)
    try:
        success = manager.reconfigure(session_id, python_path, cwd)

        if not success:
            return web.json_response({
                "success": False,
                "error": "Failed to start new session. The target Python may not have mrmd installed.",
            }, status=500)

        # Get info from the new session
        session = manager.get(session_id)
        if session and session.is_alive():
            info = session.get_info()
            return web.json_response({
                "success": True,
                "session_id": session_id,
                "python_path": session.python_path,
                "python_executable": info.get("python_executable"),
                "python_version": info.get("python_version"),
                "cwd": info.get("cwd"),
                "pid": info.get("pid"),
            })
        else:
            return web.json_response({
                "success": False,
                "error": "Session not alive after reconfigure. The target Python may not have mrmd installed.",
            }, status=500)

    except Exception as e:
        import traceback
        return web.json_response({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }, status=500)


# ==================== Code Formatting ====================


async def handle_format_code(request: web.Request) -> web.Response:
    """
    Format code using black (Python) or other formatters.
    """
    try:
        data = await request.json()
    except:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    code = data.get("code", "")
    language = data.get("language", "python").lower()

    if not code.strip():
        return web.json_response({"formatted": code})

    if language in ("python", "py", ""):
        try:
            import black
        except ImportError:
            return web.json_response({"error": "black not installed"}, status=500)

        try:
            # Use black to format
            formatted = black.format_str(code, mode=black.Mode(line_length=88))
            # Remove trailing newline that black adds
            formatted = formatted.rstrip('\n')

            return web.json_response({"formatted": formatted})

        except black.InvalidInput as e:
            return web.json_response({"error": f"Syntax error: {e}"}, status=400)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    else:
        return web.json_response({"error": f"Unsupported language: {language}"})


# ==================== Server Management ====================


async def handle_server_restart(request: web.Request) -> web.Response:
    """
    Restart the server process.

    Sends response first, then triggers restart via os.execv to replace
    the current process with a fresh one.
    """
    import sys
    import asyncio

    async def do_restart():
        # Give time for response to be sent
        await asyncio.sleep(0.5)
        # Re-exec the current process
        os.execv(sys.executable, [sys.executable] + sys.argv)

    # Schedule restart after response
    asyncio.create_task(do_restart())

    return web.json_response({
        "status": "restarting",
        "message": "Server will restart in 0.5 seconds"
    })


async def handle_health(request: web.Request) -> web.Response:
    """Health check endpoint."""
    return web.json_response({"status": "ok"})


# ==================== MRMD Environment Management ====================


async def handle_mrmd_status(request: web.Request) -> web.Response:
    """Get MRMD initialization status."""
    status = environment.get_mrmd_status()
    return web.json_response(status)


async def handle_mrmd_initialize(request: web.Request) -> web.Response:
    """Initialize MRMD environment (create ~/.mrmd and Scratch project)."""
    try:
        data = await request.json()
        scratch_path = data.get("scratch_path")  # Optional custom path
    except:
        scratch_path = None

    result = environment.initialize_mrmd(scratch_path=scratch_path)
    status_code = 200 if result["success"] else 500
    return web.json_response(result, status=status_code)


async def handle_mrmd_config_get(request: web.Request) -> web.Response:
    """Get MRMD user configuration."""
    config = environment.get_config()
    return web.json_response({"config": config})


async def handle_mrmd_config_set(request: web.Request) -> web.Response:
    """Update MRMD user configuration."""
    try:
        data = await request.json()
        updates = data.get("config", data)
        result = environment.set_config(updates)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=400)


async def handle_mrmd_recent_projects_get(request: web.Request) -> web.Response:
    """Get list of recent projects."""
    projects = environment.get_recent_projects()
    return web.json_response({"projects": projects})


async def handle_mrmd_recent_projects_add(request: web.Request) -> web.Response:
    """Add a project to recent projects."""
    try:
        data = await request.json()
        path = data.get("path")
        name = data.get("name")
        if not path:
            return web.json_response({"error": "path required"}, status=400)
        projects = environment.add_recent_project(path, name)
        return web.json_response({"projects": projects})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_mrmd_recent_projects_remove(request: web.Request) -> web.Response:
    """Remove a project from recent projects."""
    try:
        data = await request.json()
        path = data.get("path")
        if not path:
            return web.json_response({"error": "path required"}, status=400)
        projects = environment.remove_recent_project(path)
        return web.json_response({"projects": projects})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_mrmd_recent_notebooks_get(request: web.Request) -> web.Response:
    """Get list of recent notebooks."""
    notebooks = environment.get_recent_notebooks()
    return web.json_response({"notebooks": notebooks})


async def handle_mrmd_recent_notebooks_add(request: web.Request) -> web.Response:
    """Add a notebook to recent notebooks."""
    try:
        data = await request.json()
        path = data.get("path")
        overview = data.get("overview", "")
        project_path = data.get("projectPath", "")
        project_name = data.get("projectName", "")
        if not path:
            return web.json_response({"error": "path required"}, status=400)
        notebooks = environment.add_recent_notebook(path, overview, project_path, project_name)
        return web.json_response({"notebooks": notebooks})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_mrmd_recent_notebooks_remove(request: web.Request) -> web.Response:
    """Remove a notebook from recent notebooks."""
    try:
        data = await request.json()
        path = data.get("path")
        if not path:
            return web.json_response({"error": "path required"}, status=400)
        notebooks = environment.remove_recent_notebook(path)
        return web.json_response({"notebooks": notebooks})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_project_notebooks(request: web.Request) -> web.Response:
    """List notebooks in a project (cached with file watching).

    Request body:
        path: Project path (required)
        refresh: Force cache refresh (optional, default: false)
    """
    try:
        data = await request.json()
        project_path = data.get("path")
        refresh = data.get("refresh", False)

        if not project_path:
            return web.json_response({"error": "path required"}, status=400)

        # Get notebook list (uses cache unless refresh requested)
        notebooks = environment.list_notebooks_in_project(
            project_path,
            use_cache=not refresh
        )

        # Convert to relative paths with metadata
        from pathlib import Path
        project_root = Path(project_path)
        results = []
        for filepath in notebooks:
            try:
                fp = Path(filepath)
                relpath = fp.relative_to(project_root)
                results.append({
                    "path": filepath,
                    "relpath": str(relpath),
                    "name": fp.name,
                })
            except (ValueError, OSError):
                continue

        return web.json_response({
            "notebooks": results,
            "count": len(results),
            "path": project_path,
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_project_create(request: web.Request) -> web.Response:
    """Create a new MRMD project.

    Request body:
        name: Project name (required)
        parent_dir: Parent directory (optional, default: ~/Projects)
        template: Project template (optional, default: "analyst")
            - "writer": Simple notebooks + venv, no pyproject.toml
            - "analyst": Notebooks + pyproject.toml + utils.py
            - "pythonista": Full src layout package
    """
    try:
        data = await request.json()
        name = data.get("name")
        parent_dir = data.get("parent_dir")
        template = data.get("template", "analyst")

        if not name:
            return web.json_response({"error": "name required"}, status=400)

        # Validate template
        valid_templates = ["writer", "analyst", "pythonista"]
        if template not in valid_templates:
            return web.json_response({
                "error": f"Invalid template '{template}'. Must be one of: {', '.join(valid_templates)}"
            }, status=400)

        result = environment.create_project(name, parent_dir, template=template)

        # Add template info to result for frontend
        if result["success"]:
            result["template"] = template
            # Include the main notebook path for auto-opening
            # Writer and analyst have flat structure, pythonista uses notebooks/
            notebooks = {
                "writer": "notes.md",
                "analyst": "analysis.md",
                "pythonista": "notebooks/dev.md",
            }
            result["main_notebook"] = notebooks.get(template)

        status_code = 200 if result["success"] else 400
        return web.json_response(result, status=status_code)
    except Exception as e:
        return web.json_response({"success": False, "error": str(e)}, status=400)


async def handle_venvs_search(request: web.Request) -> web.Response:
    """Search for Python venvs in a directory tree."""
    try:
        data = await request.json()
        root = data.get("root", str(Path.home()))
        max_depth = data.get("max_depth", 3)
        venvs = environment.list_venvs_in_tree(root, max_depth)
        return web.json_response({"venvs": venvs, "root": root})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


# ==================== Project Pool (Instant Switching) ====================


async def handle_project_switch(request: web.Request) -> web.Response:
    """
    Switch to a project, returning cached data if warm.

    This is a FAST path - only returns already-cached data.
    No file I/O is done here to keep it instant.

    Request: { path, tab_paths?, active_file? }
    Response: {
        status: "warm" | "cold",
        session_id,
        files: { path: { content, mtime } },
        variables: [...],
        active_file
    }
    """
    try:
        data = await request.json()
        project_path = data.get("path")
        active_file = data.get("active_file")

        if not project_path:
            return web.json_response({"error": "path required"}, status=400)

        # Get the project pool
        pool = get_project_pool()

        # Ensure pool has IPython manager
        if not pool.ipython_manager:
            ipython_manager = get_ipython_manager(request)
            pool.set_ipython_manager(ipython_manager)

        # Try to get warm project (instant - just a dict lookup)
        project = pool.switch_to(project_path)

        if project:
            # Project is warm - return ONLY already-cached data (no I/O!)
            files = {}
            for file_path, cached in project.open_files.items():
                files[file_path] = {
                    "content": cached.content,
                    "mtime": cached.mtime,
                }

            return web.json_response({
                "status": "warm",
                "session_id": project.session_id,
                "files": files,
                "variables": project.variables,
                "active_file": active_file or project.active_file,
            })

        # Project is cold - return immediately
        return web.json_response({
            "status": "cold",
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_project_warm(request: web.Request) -> web.Response:
    """
    Pre-warm a project (start session, cache files).

    Request: { path, name, python_path?, tab_paths?, active_file? }
    Response: { status, session_id, cached_files }

    NOTE: This runs blocking operations in a thread pool to not block the event loop.
    """
    try:
        data = await request.json()
        project_path = data.get("path")
        name = data.get("name", Path(project_path).name if project_path else "Unknown")
        python_path = data.get("python_path")
        tab_paths = data.get("tab_paths", [])
        active_file = data.get("active_file")

        if not project_path:
            return web.json_response({"error": "path required"}, status=400)

        # Auto-detect Python if not provided
        if not python_path:
            python_path = environment.get_project_venv_python(project_path)
            if not python_path:
                python_path = sys.executable

        # Get the project pool
        pool = get_project_pool()

        # Ensure pool has IPython manager
        if not pool.ipython_manager:
            ipython_manager = get_ipython_manager(request)
            pool.set_ipython_manager(ipython_manager)

        # Run blocking warm operation in thread pool
        loop = asyncio.get_event_loop()
        project = await loop.run_in_executor(
            None,  # Use default executor
            lambda: pool.warm_project(
                project_path=project_path,
                name=name,
                python_path=python_path,
                tab_paths=tab_paths,
                active_file=active_file,
            )
        )

        return web.json_response({
            "status": "warmed",
            "session_id": project.session_id,
            "cached_files": len(project.open_files),
            "python_path": python_path,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_project_pool_status(request: web.Request) -> web.Response:
    """Get project pool status (for debugging)."""
    pool = get_project_pool()
    return web.json_response(pool.get_status())


async def handle_mrmd_welcome(request: web.Request) -> web.Response:
    """Get the welcome notebook content."""
    static_dir = Path(__file__).parent / "static"
    welcome_path = static_dir / "welcome.md"

    if welcome_path.exists():
        content = welcome_path.read_text(encoding="utf-8")
        return web.json_response({
            "content": content,
            "path": "__welcome__",
            "readonly": True,
            "title": "Welcome to MRMD",
        })
    else:
        # Fallback content
        return web.json_response({
            "content": "# Welcome to MRMD\n\nMarkdown that runs.",
            "path": "__welcome__",
            "readonly": True,
            "title": "Welcome to MRMD",
        })


# ==================== Session Persistence Endpoints ====================

from . import sessions as session_mgmt
from dataclasses import asdict


async def handle_sessions_list(request: web.Request) -> web.Response:
    """List all sessions for a project (live and saved)."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        if not project_path:
            return web.json_response({"error": "project_path required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)
        sessions = manager.list_sessions()
        session_names = {s.name for s in sessions}

        # Get live IPython sessions info
        ipython_manager = get_ipython_manager(request)
        live_sessions = ipython_manager.list_sessions()
        live_by_id = {s["id"]: s for s in live_sessions if s["alive"]}

        # Scan for orphan .dill.gz files not in metadata
        from pathlib import Path
        sessions_dir = Path(project_path) / ".mrmd" / "sessions"
        if sessions_dir.exists():
            for dill_file in sessions_dir.glob("*.dill.gz"):
                name = dill_file.stem.replace(".dill", "")
                if name not in session_names:
                    # Orphan saved session - add to list
                    sessions.append(session_mgmt.SessionInfo(
                        name=name,
                        created="",
                        last_used="",
                        state="saved",
                        size=dill_file.stat().st_size,
                        variables_count=0,
                        python_path=None,
                    ))

        # Enrich with live status, memory, real-time variable count, and saved state check
        result = []
        for s in sessions:
            info = asdict(s)

            # Check if saved state exists on disk
            has_saved = manager.has_saved_state(s.name)
            info["has_saved_state"] = has_saved

            # Get saved file modification time for staleness check
            if has_saved:
                saved_path = manager.get_saved_path(s.name)
                info["saved_mtime"] = saved_path.stat().st_mtime
                info["saved_size"] = saved_path.stat().st_size

            # Check if this session is live in IPython (session_id = session_name)
            if s.name in live_by_id:
                live_info = live_by_id[s.name]
                info["state"] = "live"
                info["memory_bytes"] = live_info.get("memory_bytes")
                info["pid"] = live_info.get("pid")
                # Get real-time variable count from live session
                session = ipython_manager.get(s.name)
                if session and session.is_alive():
                    try:
                        variables = session.get_variables()
                        info["variables_count"] = len(variables) if variables else 0
                    except:
                        pass
            result.append(info)

        return web.json_response({
            "sessions": result,
            "project_path": project_path,
            "notebook_bindings": manager._meta.notebook_bindings,
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_create(request: web.Request) -> web.Response:
    """Create a new named session for a project."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        session_name = data.get("session_name")

        if not project_path or not session_name:
            return web.json_response({"error": "project_path and session_name required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)

        # Check if session already exists
        if manager.get_session(session_name):
            return web.json_response({"error": f"Session '{session_name}' already exists"}, status=400)

        # Create session entry
        session_info = manager.create_session(session_name)

        return web.json_response({
            "success": True,
            "session": asdict(session_info),
        })
    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_save(request: web.Request) -> web.Response:
    """Save IPython session state to disk using dill."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        session_name = data.get("session_name", "main")
        session_id = data.get("session_id", "default")

        if not project_path:
            return web.json_response({"success": False, "error": "project_path required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)
        save_path = manager.get_saved_path(session_name)

        # Get the IPython session manager
        ipython_manager = get_ipython_manager(request)
        session = ipython_manager.get(session_id)

        if not session:
            return web.json_response({"success": False, "error": f"Session '{session_id}' not found"}, status=404)

        # Use subprocess session's save_namespace method
        result = session.save_namespace(str(save_path))

        if result.get("success"):
            # Update session metadata
            manager.update_session(
                session_name,
                state="saved",
                variables_count=result.get("saved_count", 0),
                size=result.get("size"),
            )
            # Ensure session exists in metadata
            if not manager.get_session(session_name):
                manager.create_session(session_name)

        return web.json_response(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)}, status=400)


async def handle_sessions_load(request: web.Request) -> web.Response:
    """Load session state from disk into IPython."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        session_name = data.get("session_name", "main")
        session_id = data.get("session_id", "default")
        merge = data.get("merge", True)

        if not project_path:
            return web.json_response({"success": False, "error": "project_path required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)
        load_path = manager.get_saved_path(session_name)

        if not load_path.exists():
            return web.json_response({"success": False, "error": f"No saved state for session '{session_name}'"}, status=404)

        # Get the IPython session manager
        ipython_manager = get_ipython_manager(request)
        session = ipython_manager.get(session_id)

        if not session:
            return web.json_response({"success": False, "error": f"Session '{session_id}' not found"}, status=404)

        # Use subprocess session's load_namespace method
        result = session.load_namespace(str(load_path), merge=merge)

        if result.get("success"):
            # Update session metadata - now live
            manager.update_session(session_name, state="live")

        return web.json_response(result)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)}, status=400)


async def handle_sessions_delete(request: web.Request) -> web.Response:
    """Delete a session (saved state and metadata)."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        session_name = data.get("session_name")

        if not project_path or not session_name:
            return web.json_response({"error": "project_path and session_name required"}, status=400)

        if session_name == "main":
            return web.json_response({"error": "Cannot delete main session"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)
        success = manager.delete_session(session_name)

        return web.json_response({
            "success": success,
            "message": f"Session '{session_name}' deleted" if success else f"Session '{session_name}' not found",
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_rename(request: web.Request) -> web.Response:
    """Rename a saved session."""
    try:
        data = await request.json()
        session_path = data.get("session_path")
        new_name = data.get("new_name")

        if not session_path or not new_name:
            return web.json_response({"error": "session_path and new_name required"}, status=400)

        result = environment.rename_session(session_path, new_name)
        return web.json_response(result)

    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_clear(request: web.Request) -> web.Response:
    """Clear all user variables from the IPython session."""
    try:
        data = await request.json()
        session_id = data.get("session_id", "default")

        # Get the IPython session manager
        ipython_manager = get_ipython_manager(request)
        session = ipython_manager.get(session_id)

        if not session:
            return web.json_response({"success": False, "message": f"Session '{session_id}' not found"}, status=404)

        # For subprocess sessions, use reset() method
        if not hasattr(session, 'shell'):
            success = session.reset()
            return web.json_response({
                "success": success,
                "message": "Session reset" if success else "Failed to reset session",
            })

        if not session.shell:
            return web.json_response({"success": True, "message": "Session already empty"})

        # Get list of user variables to clear
        skip_prefixes = ('_', 'In', 'Out', 'get_ipython', 'exit', 'quit')
        skip_names = {'__name__', '__doc__', '__package__', '__loader__', '__spec__', '__builtins__'}

        to_delete = []
        for name in list(session.shell.user_ns.keys()):
            if name in skip_names:
                continue
            if any(name.startswith(p) for p in skip_prefixes):
                continue
            to_delete.append(name)

        # Delete variables
        for name in to_delete:
            del session.shell.user_ns[name]

        return web.json_response({
            "success": True,
            "message": f"Cleared {len(to_delete)} variables",
            "cleared": to_delete,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"success": False, "message": str(e)}, status=400)


async def handle_sessions_kill(request: web.Request) -> web.Response:
    """Kill a live session (terminate the IPython subprocess)."""
    try:
        data = await request.json()
        session_name = data.get("session_name")
        save_first = data.get("save_first", False)
        project_path = data.get("project_path")

        if not session_name:
            return web.json_response({"error": "session_name required"}, status=400)

        ipython_manager = get_ipython_manager(request)

        # Check if session exists and is alive
        session = ipython_manager.get(session_name)
        if not session or not session.is_alive():
            return web.json_response({
                "success": False,
                "error": f"Session '{session_name}' not found or not running"
            }, status=404)

        # Optionally save before killing
        if save_first and project_path:
            manager = session_mgmt.get_project_session_manager(project_path)
            save_path = manager.get_saved_path(session_name)
            save_result = session.save_namespace(str(save_path))
            if save_result.get("success"):
                manager.update_session(
                    session_name,
                    state="saved",
                    variables_count=save_result.get("saved_count", 0),
                    size=save_result.get("size"),
                )

        # Kill the session
        success = ipython_manager.close(session_name)

        # Update metadata state if project provided
        if project_path:
            manager = session_mgmt.get_project_session_manager(project_path)
            if not save_first:
                # Mark as not live, no saved state
                manager.update_session(session_name, state="dead")

        return web.json_response({
            "success": success,
            "session_name": session_name,
            "saved": save_first,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_restore(request: web.Request) -> web.Response:
    """Restore a saved session (start subprocess and load pickled state)."""
    try:
        data = await request.json()
        session_name = data.get("session_name")
        project_path = data.get("project_path")

        if not session_name or not project_path:
            return web.json_response({"error": "session_name and project_path required"}, status=400)

        manager = session_mgmt.get_project_session_manager(project_path)
        saved_path = manager.get_saved_path(session_name)

        if not saved_path.exists():
            return web.json_response({
                "success": False,
                "error": f"No saved state for session '{session_name}'"
            }, status=404)

        # Create or get the IPython session
        ipython_manager = get_ipython_manager(request)
        session = ipython_manager.get_or_create(
            session_id=session_name,
            cwd=project_path,
        )

        # Load the saved namespace
        load_result = session.load_namespace(str(saved_path), merge=False)

        if load_result.get("success"):
            # Update metadata
            manager.update_session(
                session_name,
                state="live",
                variables_count=load_result.get("loaded_count", 0),
            )

            return web.json_response({
                "success": True,
                "session_name": session_name,
                "loaded_count": load_result.get("loaded_count", 0),
                "loaded_names": load_result.get("loaded_names", []),
            })
        else:
            return web.json_response({
                "success": False,
                "error": load_result.get("error", "Failed to load session")
            })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_delete_saved(request: web.Request) -> web.Response:
    """Delete only the saved state (.dill.gz) for a session, keeping metadata."""
    try:
        data = await request.json()
        session_name = data.get("session_name")
        project_path = data.get("project_path")

        if not session_name or not project_path:
            return web.json_response({"error": "session_name and project_path required"}, status=400)

        manager = session_mgmt.get_project_session_manager(project_path)
        saved_path = manager.get_saved_path(session_name)

        if not saved_path.exists():
            return web.json_response({
                "success": False,
                "error": f"No saved state for session '{session_name}'"
            }, status=404)

        # Delete the .dill.gz file
        saved_path.unlink()

        return web.json_response({
            "success": True,
            "session_name": session_name,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_bind(request: web.Request) -> web.Response:
    """Bind a notebook to a specific session."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        notebook_path = data.get("notebook_path")
        session_name = data.get("session_name", "main")

        if not project_path or not notebook_path:
            return web.json_response({"error": "project_path and notebook_path required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)

        # Verify session exists (or create if it's main)
        if session_name != "main" and not manager.get_session(session_name):
            return web.json_response({"error": f"Session '{session_name}' not found"}, status=404)

        # Bind notebook
        manager.bind_notebook(notebook_path, session_name)

        return web.json_response({
            "success": True,
            "notebook": notebook_path,
            "session": session_name,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


async def handle_sessions_notebook(request: web.Request) -> web.Response:
    """Get the session a notebook is bound to."""
    try:
        data = await request.json()
        project_path = data.get("project_path")
        notebook_path = data.get("notebook_path")

        if not project_path or not notebook_path:
            return web.json_response({"error": "project_path and notebook_path required"}, status=400)

        # Get project session manager
        manager = session_mgmt.get_project_session_manager(project_path)

        # Get notebook's session
        session_name = manager.get_notebook_session(notebook_path)
        session_info = manager.get_session(session_name)

        # Check if there's saved state
        has_saved = manager.has_saved_state(session_name)

        return web.json_response({
            "session_name": session_name,
            "session": asdict(session_info) if session_info else None,
            "has_saved_state": has_saved,
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=400)


# ==================== AI Proxy ====================


async def handle_ai_proxy(request: web.Request) -> web.Response:
    """Proxy requests to the AI server (mrmd-ai-server on port 8766).

    For POST requests, creates a job to track the AI call.
    """
    # Build target URL
    ai_server_url = request.app.get("ai_server_url", "http://localhost:51790")
    path = request.match_info.get("program", "programs")
    target_url = f"{ai_server_url}/{path}"

    # GET requests (like /programs list) don't need job tracking
    if request.method == "GET":
        try:
            timeout = ClientTimeout(total=30)
            async with ClientSession(timeout=timeout) as session:
                async with session.get(target_url) as resp:
                    body = await resp.read()
                    return web.Response(
                        body=body,
                        status=resp.status,
                        content_type=resp.content_type,
                    )
        except Exception as e:
            return web.json_response(
                {"error": f"AI server unavailable: {str(e)}"},
                status=503,
            )

    # POST requests - track as jobs
    job_manager = get_job_manager()
    job = None

    try:
        # Parse request body to get context
        body = await request.read()
        request_data = {}
        try:
            import json
            request_data = json.loads(body) if body else {}
        except:
            pass

        # Get juice level from header
        juice_level_str = request.headers.get("X-Juice-Level")
        juice_level = int(juice_level_str) if juice_level_str else 0

        # Extract file context if available
        file_path = request_data.get("file_path") or request_data.get("filePath")
        block_index = request_data.get("block_index") or request_data.get("blockIndex")

        # Create job to track this AI call
        job = job_manager.create_job(
            job_type=JobType.AI,
            request={"program": path, "juice_level": juice_level},
            file_path=file_path,
            block_index=block_index,
            program_name=path,
            juice_level=juice_level,
        )
        job_manager.start_job(job.id)

        # Forward to AI server
        timeout = ClientTimeout(total=300)  # 5 min timeout for AI calls (Ultimate can be slow)
        async with ClientSession(timeout=timeout) as session:
            headers = {"Content-Type": "application/json"}
            if juice_level_str:
                headers["X-Juice-Level"] = juice_level_str

            async with session.post(target_url, data=body, headers=headers) as resp:
                resp_body = await resp.read()

                # Complete the job
                if resp.status == 200:
                    try:
                        import json
                        result_data = json.loads(resp_body)
                        job_manager.complete_job(job.id, result=result_data)
                    except:
                        job_manager.complete_job(job.id, result={"raw": resp_body.decode()})
                else:
                    job_manager.complete_job(job.id, error=f"AI server returned {resp.status}")

                return web.Response(
                    body=resp_body,
                    status=resp.status,
                    content_type=resp.content_type,
                )

    except Exception as e:
        # Mark job as failed if it was created
        if job:
            job_manager.complete_job(job.id, error=str(e))
        return web.json_response(
            {"error": f"AI server unavailable: {str(e)}"},
            status=503,
        )


async def handle_ai_proxy_stream(request: web.Request) -> web.StreamResponse:
    """Proxy SSE streaming requests to the AI server.

    Forwards the stream from the AI server to the client for real-time status updates.
    """
    import json

    # Build target URL with /stream suffix
    ai_server_url = request.app.get("ai_server_url", "http://localhost:51790")
    path = request.match_info.get("program", "")
    target_url = f"{ai_server_url}/{path}/stream"

    try:
        # Parse request body
        body = await request.read()

        # Get juice level from header
        juice_level_str = request.headers.get("X-Juice-Level", "0")

        # Prepare SSE response
        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        await response.prepare(request)

        # Forward to AI server and stream back
        timeout = ClientTimeout(total=300)  # 5 min timeout
        async with ClientSession(timeout=timeout) as session:
            headers = {
                "Content-Type": "application/json",
                "X-Juice-Level": juice_level_str,
            }

            async with session.post(target_url, data=body, headers=headers) as resp:
                if resp.status != 200:
                    # Send error event
                    error_body = await resp.text()
                    error_event = f"event: error\ndata: {json.dumps({'message': error_body})}\n\n"
                    await response.write(error_event.encode())
                    await response.write_eof()
                    return response

                # Stream SSE events from AI server to client
                async for chunk in resp.content.iter_any():
                    if chunk:
                        await response.write(chunk)

        await response.write_eof()
        return response

    except Exception as e:
        # Try to send error via SSE if response started, otherwise return JSON
        import json
        error_data = json.dumps({"message": str(e)})
        try:
            response = web.StreamResponse(
                status=200,
                headers={"Content-Type": "text/event-stream"},
            )
            await response.prepare(request)
            await response.write(f"event: error\ndata: {error_data}\n\n".encode())
            await response.write_eof()
            return response
        except:
            return web.json_response(
                {"error": f"AI server unavailable: {str(e)}"},
                status=503,
            )


# ==================== Version History Handlers ====================


async def handle_history_versions(request: web.Request) -> web.Response:
    """List versions for a file.

    Request body: {
        project_root: string,
        file_path: string,
        limit?: number (default 50),
        since?: number (timestamp)
    }

    Response: {
        versions: [{id, file_path, author, timestamp, message}, ...]
    }
    """
    try:
        data = await request.json()
        project_root = data.get("project_root")
        file_path = data.get("file_path")

        if not project_root or not file_path:
            return web.json_response(
                {"error": "project_root and file_path required"},
                status=400
            )

        limit = data.get("limit", 50)
        since = data.get("since")

        history = get_history_manager(project_root)
        versions = history.list_versions(file_path, limit=limit, since=since)

        return web.json_response({"versions": versions})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_history_get(request: web.Request) -> web.Response:
    """Get content of a specific version.

    Request body: {
        project_root: string,
        version_id?: number,           # Either version_id
        file_path?: string,            # Or file_path + timestamp
        timestamp?: number
    }

    Response: {
        version: {id, file_path, content, author, timestamp, message}
    }
    """
    try:
        data = await request.json()
        project_root = data.get("project_root")

        if not project_root:
            return web.json_response(
                {"error": "project_root required"},
                status=400
            )

        history = get_history_manager(project_root)

        version_id = data.get("version_id")
        if version_id:
            version = history.get_version(version_id)
        else:
            file_path = data.get("file_path")
            timestamp = data.get("timestamp")
            if file_path and timestamp:
                version = history.get_version_at_time(file_path, timestamp)
            elif file_path:
                version = history.get_latest_version(file_path)
            else:
                return web.json_response(
                    {"error": "version_id or file_path required"},
                    status=400
                )

        if not version:
            return web.json_response(
                {"error": "Version not found"},
                status=404
            )

        return web.json_response({"version": version})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_history_save(request: web.Request) -> web.Response:
    """Save a new version of a file.

    Request body: {
        project_root: string,
        file_path: string,
        content: string,
        author: string,
        message?: string,
        base_version_id?: number
    }

    Response: {
        version_id: number,
        timestamp: number
    }
    """
    try:
        data = await request.json()
        project_root = data.get("project_root")
        file_path = data.get("file_path")
        content = data.get("content")
        author = data.get("author", "user:unknown")

        if not project_root or not file_path or content is None:
            return web.json_response(
                {"error": "project_root, file_path, and content required"},
                status=400
            )

        message = data.get("message")
        base_version_id = data.get("base_version_id")

        history = get_history_manager(project_root)

        # Check for conflicts if base_version_id provided
        if base_version_id:
            latest = history.get_latest_version(file_path)
            if latest and latest['id'] != base_version_id:
                # Version changed since base - potential conflict
                return web.json_response({
                    "conflict": True,
                    "your_base_version": base_version_id,
                    "current_version": latest['id'],
                    "current_content": latest['content'],
                    "message": "File was modified by another user"
                })

        version_id = history.save_version(
            file_path=file_path,
            content=content,
            author=author,
            message=message,
            parent_version_id=base_version_id
        )

        import time
        return web.json_response({
            "version_id": version_id,
            "timestamp": time.time()
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_history_diff(request: web.Request) -> web.Response:
    """Get diff between two versions.

    Request body: {
        project_root: string,
        from_version: number,
        to_version: number
    }

    Response: {
        diff: string (unified diff format)
    }
    """
    try:
        data = await request.json()
        project_root = data.get("project_root")
        from_version = data.get("from_version")
        to_version = data.get("to_version")

        if not all([project_root, from_version, to_version]):
            return web.json_response(
                {"error": "project_root, from_version, and to_version required"},
                status=400
            )

        history = get_history_manager(project_root)
        diff = history.get_diff(from_version, to_version)

        if diff is None:
            return web.json_response(
                {"error": "One or both versions not found"},
                status=404
            )

        return web.json_response({"diff": diff})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_history_restore(request: web.Request) -> web.Response:
    """Restore a file to a specific version.

    This saves a new version with the content from the old version
    and also writes the file to disk.

    Request body: {
        project_root: string,
        file_path: string,
        version_id: number,
        author?: string
    }

    Response: {
        success: true,
        new_version_id: number,
        content: string
    }
    """
    try:
        data = await request.json()
        project_root = data.get("project_root")
        file_path = data.get("file_path")
        version_id = data.get("version_id")
        author = data.get("author", "user:unknown")

        if not all([project_root, file_path, version_id]):
            return web.json_response(
                {"error": "project_root, file_path, and version_id required"},
                status=400
            )

        history = get_history_manager(project_root)

        # Get the version to restore
        version = history.get_version(version_id)
        if not version:
            return web.json_response(
                {"error": "Version not found"},
                status=404
            )

        # Save new version
        new_version_id = history.save_version(
            file_path=file_path,
            content=version['content'],
            author=author,
            message=f"Restored from version {version_id}"
        )

        # Write to disk
        path = Path(file_path)
        if not path.is_absolute():
            path = Path(project_root) / file_path
        path.write_text(version['content'], encoding='utf-8')

        return web.json_response({
            "success": True,
            "new_version_id": new_version_id,
            "content": version['content']
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_history_stats(request: web.Request) -> web.Response:
    """Get history database statistics.

    Query params: project_root

    Response: {
        version_count: number,
        file_count: number,
        session_count: number,
        db_size_bytes: number,
        db_path: string
    }
    """
    try:
        project_root = request.query.get("project_root")

        if not project_root:
            return web.json_response(
                {"error": "project_root query param required"},
                status=400
            )

        history = get_history_manager(project_root)
        stats = history.get_stats()

        return web.json_response(stats)

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== Jobs and Notifications ====================

async def handle_jobs_list(request: web.Request) -> web.Response:
    """List jobs with optional filters.

    Query params:
        status: Filter by status (pending, running, completed, error, cancelled)
        type: Filter by type (ai, code)
        file_path: Filter by file path

    Response: { jobs: [...] }
    """
    try:
        job_manager = get_job_manager()

        status = request.query.get("status")
        job_type = request.query.get("type")
        file_path = request.query.get("file_path")

        # Convert string params to enums
        status_enum = JobStatus(status) if status else None
        type_enum = JobType(job_type) if job_type else None

        jobs = job_manager.list_jobs(
            status=status_enum,
            job_type=type_enum,
            file_path=file_path
        )

        return web.json_response({
            "jobs": [j.to_dict() for j in jobs]
        })

    except ValueError as e:
        return web.json_response({"error": f"Invalid parameter: {e}"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_jobs_status(request: web.Request) -> web.Response:
    """Get quick status for status bar.

    Response: {
        running_count: number,
        pending_count: number,
        unread_notifications: number
    }
    """
    try:
        job_manager = get_job_manager()

        running = len(job_manager.get_running_jobs())
        pending = len(job_manager.get_pending_jobs())
        unread = job_manager.get_unread_count()

        return web.json_response({
            "running_count": running,
            "pending_count": pending,
            "unread_notifications": unread
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_jobs_get(request: web.Request) -> web.Response:
    """Get a specific job by ID.

    Response: { job: {...} } or 404
    """
    try:
        job_id = request.match_info["job_id"]
        job_manager = get_job_manager()

        job = job_manager.get_job(job_id)
        if not job:
            return web.json_response({"error": "Job not found"}, status=404)

        return web.json_response({"job": job.to_dict()})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_jobs_delete(request: web.Request) -> web.Response:
    """Cancel or delete a job.

    Running/pending jobs will be cancelled.
    Completed jobs will be deleted.
    """
    try:
        job_id = request.match_info["job_id"]
        job_manager = get_job_manager()

        job = job_manager.get_job(job_id)
        if not job:
            return web.json_response({"error": "Job not found"}, status=404)

        if job.status in (JobStatus.PENDING, JobStatus.RUNNING):
            job_manager.cancel_job(job_id)
            return web.json_response({"success": True, "action": "cancelled"})
        else:
            job_manager.delete_job(job_id)
            return web.json_response({"success": True, "action": "deleted"})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_jobs_notifications(request: web.Request) -> web.Response:
    """Get notifications.

    Query params:
        since: ISO timestamp - only get notifications after this time
        unread_only: "true" to only get unread notifications

    Response: { notifications: [...] }
    """
    try:
        job_manager = get_job_manager()

        since_str = request.query.get("since")
        unread_only = request.query.get("unread_only") == "true"

        since = None
        if since_str:
            from datetime import datetime
            since = datetime.fromisoformat(since_str)

        notifications = job_manager.get_notifications(
            since=since,
            unread_only=unread_only
        )

        return web.json_response({
            "notifications": [n.to_dict() for n in notifications]
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_jobs_notifications_read(request: web.Request) -> web.Response:
    """Mark notifications as read.

    Body: { notification_id: string } or { all: true }

    Response: { success: true, count: number }
    """
    try:
        data = await request.json()
        job_manager = get_job_manager()

        if data.get("all"):
            count = job_manager.mark_all_notifications_read()
            return web.json_response({"success": True, "count": count})

        notification_id = data.get("notification_id")
        if notification_id:
            success = job_manager.mark_notification_read(notification_id)
            return web.json_response({
                "success": success,
                "count": 1 if success else 0
            })

        return web.json_response(
            {"error": "Provide notification_id or all: true"},
            status=400
        )

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# ==================== Claude Code Integration ====================


async def handle_claude_ask(request: web.Request) -> web.Response:
    """Invoke Claude Code CLI with a prompt and context.

    Claude is given the file path and uses its own tools (Read, Edit, Write) to
    make changes. The full response becomes a notification shown to the user.

    Request body:
        prompt: str - The user's prompt/instruction
        selection: str | null - Selected text (for context)
        selection_start_line: int | null - Line number where selection starts
        selection_end_line: int | null - Line number where selection ends
        cursor_line: int | null - Current cursor line (if no selection)
        cursor_col: int | null - Current cursor column (if no selection)
        language: str | null - Programming language if in code block
        file_path: str | null - Current file path (absolute)

    Response:
        notification: str - Claude's full response to show to user
    """
    try:
        data = await request.json()
        prompt = data.get("prompt", "").strip()
        selection = data.get("selection")
        selection_start_line = data.get("selection_start_line")
        selection_end_line = data.get("selection_end_line")
        cursor_line = data.get("cursor_line")
        cursor_col = data.get("cursor_col")
        language = data.get("language")
        file_path = data.get("file_path")

        if not prompt:
            return web.json_response({"error": "No prompt provided"}, status=400)

        # Build the context prompt for Claude
        prompt_parts = []

        # System context
        prompt_parts.append("""You are assisting a user in MRMD, a markdown notebook application.
The user is working in their editor and has invoked you via a keyboard shortcut.
Use your file editing tools (Read, Edit, Write) to make any changes to files.
Respond naturally - your full response will be shown as a notification to the user.""")

        # File context
        prompt_parts.append("\n## Current Context")
        if file_path:
            prompt_parts.append(f"- **File:** `{file_path}`")
        if language:
            prompt_parts.append(f"- **Language:** {language}")

        # Selection or cursor info
        if selection:
            if selection_start_line and selection_end_line:
                if selection_start_line == selection_end_line:
                    prompt_parts.append(f"- **Selection:** Line {selection_start_line}")
                else:
                    prompt_parts.append(f"- **Selection:** Lines {selection_start_line}-{selection_end_line}")
            prompt_parts.append(f"\n### Selected Text\n```\n{selection}\n```")
        else:
            if cursor_line:
                pos = f"Line {cursor_line}"
                if cursor_col:
                    pos += f", Column {cursor_col}"
                prompt_parts.append(f"- **Cursor position:** {pos}")
                prompt_parts.append(f"  - When user says 'here', they mean at/near line {cursor_line}")
            prompt_parts.append("\n*(No text is selected)*")

        # User's request
        prompt_parts.append(f"\n## User's Request\n{prompt}")

        # Guidance
        prompt_parts.append("""
## Guidelines
- IMPORTANT: Read the file first to understand the context around the cursor position
- When user says "here" or "at this line", they mean at/near the cursor position shown above
- Use your Edit tool with the exact text to find and replace
- Keep your response concise - it will appear as a notification
- If you made changes, briefly summarize what you did""")

        full_prompt = "\n".join(prompt_parts)

        # Build claude command
        cmd = [
            "claude",
            "-p",
            full_prompt,
            "--output-format", "text",
            "--dangerously-skip-permissions",
        ]

        # Run claude CLI from the file's directory for proper context
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180,  # 3 minute timeout
                cwd=Path(file_path).parent if file_path else None,
            )

            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Claude command failed"
                return web.json_response({"error": error_msg}, status=500)

            # Return the full response as a notification
            response_text = result.stdout.strip()

            return web.json_response({
                "notification": response_text,
                "file_modified": file_path  # Tell frontend which file may have changed
            })

        except subprocess.TimeoutExpired:
            return web.json_response({"error": "Claude request timed out (3 min limit)"}, status=504)
        except FileNotFoundError:
            return web.json_response({
                "error": "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
            }, status=500)

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_processes_status(request: web.Request) -> web.Response:
    """Get unified status of all processes for the process sidebar.

    Returns running and pending jobs grouped by type (ai, code).

    Response: {
        running: [...jobs],
        pending: [...jobs]
    }
    """
    try:
        job_manager = get_job_manager()

        running_jobs = job_manager.get_running_jobs()
        pending_jobs = job_manager.get_pending_jobs()

        return web.json_response({
            "running": [j.to_dict() for j in running_jobs],
            "pending": [j.to_dict() for j in pending_jobs],
        })

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

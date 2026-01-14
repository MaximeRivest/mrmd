"""
HTTP API server for mrmd-orchestrator.

Provides:
- API for starting/stopping monitors
- Status endpoints
- Static file serving for mrmd-editor
- File management (browse, rename, copy)
- Environment management (venv, cwd)
"""

import asyncio
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
import httpx
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .orchestrator import Orchestrator
from .config import OrchestratorConfig

logger = logging.getLogger(__name__)


class MonitorRequest(BaseModel):
    """Request to start a monitor."""
    doc: str


class MonitorResponse(BaseModel):
    """Response for monitor operations."""
    doc: str
    running: bool
    message: str


class SessionRequest(BaseModel):
    """Request to create a session."""
    doc: str
    python: str = "shared"  # "shared" or "dedicated"
    venv: Optional[str] = None  # Path to virtual environment for dedicated runtimes


class SessionResponse(BaseModel):
    """Response for session operations."""
    doc: str
    sync: str
    monitor: dict
    runtimes: dict


# --- File Management Models ---

class FileEntry(BaseModel):
    """A file or directory entry."""
    name: str
    path: str  # Relative path from docs root
    type: str  # 'file' or 'directory'
    size: Optional[int] = None
    modified: Optional[float] = None


class FileListResponse(BaseModel):
    """Response for file listing."""
    files: List[FileEntry]
    path: str  # Current path being listed
    root: str  # Docs root directory


class RenameRequest(BaseModel):
    """Request to rename a file."""
    from_path: str  # Current filename (relative to docs)
    to_path: str  # New filename (relative to docs)


class CopyRequest(BaseModel):
    """Request to copy a file."""
    from_path: str  # Source file (relative to docs)
    to_path: str  # Destination (can be absolute or relative)


class BrowseResponse(BaseModel):
    """Response for filesystem browsing."""
    entries: List[FileEntry]
    path: str  # Current path
    parent: Optional[str] = None  # Parent path (None if at root)


# --- Environment Models ---

class PythonEnvironment(BaseModel):
    """Python environment information."""
    version: str
    executable: str
    venv: Optional[str] = None
    venv_name: Optional[str] = None
    cwd: str
    status: str  # 'ready', 'starting', 'stopped', 'error'


class EnvironmentResponse(BaseModel):
    """Response for environment info."""
    python: Optional[PythonEnvironment] = None
    project_root: str


class EnvironmentUpdateRequest(BaseModel):
    """Request to update environment."""
    venv: Optional[str] = None  # Path to venv (or None to use system Python)
    cwd: Optional[str] = None  # Working directory


def create_app(orchestrator: Orchestrator) -> FastAPI:
    """Create FastAPI application with orchestrator endpoints."""

    app = FastAPI(
        title="mrmd-orchestrator",
        description="Orchestrator for mrmd services",
        version="0.1.0",
    )

    # Add CORS middleware for browser access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Store orchestrator reference
    app.state.orchestrator = orchestrator

    # --- Health & Status ---

    @app.get("/health")
    async def health():
        """Health check endpoint."""
        return {"status": "healthy"}

    @app.get("/api/status")
    async def status():
        """Get status of all services."""
        return orchestrator.get_status()

    @app.get("/api/urls")
    async def urls():
        """Get URLs for all services."""
        result = orchestrator.get_urls()
        # Include initial document if set
        if hasattr(orchestrator, '_initial_doc'):
            result['initial_doc'] = orchestrator._initial_doc
        return result

    @app.get("/api/project")
    async def project():
        """Get project information."""
        return orchestrator.get_project_info()

    @app.get("/api/runtimes")
    async def list_runtimes():
        """
        List all running runtimes (shared and dedicated).

        Returns comprehensive runtime info including:
        - Shared Python runtime (daemon)
        - Dedicated runtimes per document
        - Venv and port info for each
        """
        from . import python_runtime

        result = {
            "shared": None,
            "dedicated": [],
            "project": orchestrator.get_project_info(),
        }

        # Get all registered runtimes from daemon registry
        all_runtimes = python_runtime.list_runtimes()

        for rt in all_runtimes:
            runtime_info = {
                "id": rt.get("id"),
                "url": rt.get("url"),
                "port": rt.get("port"),
                "pid": rt.get("pid"),
                "alive": rt.get("alive", False),
                "venv": rt.get("venv"),
                "cwd": rt.get("cwd"),
            }

            if rt.get("id") == "shared":
                result["shared"] = runtime_info
            else:
                runtime_info["doc"] = rt.get("id")  # For dedicated, id is the doc name
                result["dedicated"].append(runtime_info)

        # Also include sessions info
        sessions = orchestrator.get_sessions()
        result["sessions"] = [
            orchestrator.get_session_info(doc) for doc in sessions.keys()
        ]

        return result

    @app.delete("/api/runtimes/{runtime_id}")
    async def kill_runtime(runtime_id: str):
        """
        Kill a runtime by ID.

        For dedicated runtimes, this destroys the session.
        For shared runtime, this kills the daemon (will restart on next execution).
        """
        from . import python_runtime

        if runtime_id == "shared":
            # Kill the shared runtime daemon
            success = python_runtime.stop_runtime("shared")
            return {"id": runtime_id, "killed": success, "message": "Shared runtime killed. Will restart on next execution."}
        else:
            # For dedicated runtimes, destroy the session
            success = await orchestrator.destroy_session(runtime_id)
            return {"id": runtime_id, "killed": success, "message": f"Dedicated runtime for '{runtime_id}' destroyed."}

    # --- Monitor Management ---

    @app.get("/api/monitors")
    async def list_monitors():
        """List all active monitors."""
        docs = orchestrator.get_monitor_docs()
        return {
            "monitors": [
                {"doc": doc, "running": orchestrator.is_monitor_running(doc)}
                for doc in docs
            ]
        }

    @app.post("/api/monitors")
    async def start_monitor(request: MonitorRequest):
        """Start a monitor for a document."""
        doc = request.doc

        if orchestrator.is_monitor_running(doc):
            return MonitorResponse(
                doc=doc,
                running=True,
                message=f"Monitor for '{doc}' already running"
            )

        success = await orchestrator.start_monitor(doc)

        if success:
            return MonitorResponse(
                doc=doc,
                running=True,
                message=f"Started monitor for '{doc}'"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to start monitor for '{doc}'"
            )

    @app.delete("/api/monitors/{doc}")
    async def stop_monitor(doc: str):
        """Stop the monitor for a document."""
        if not orchestrator.is_monitor_running(doc):
            return MonitorResponse(
                doc=doc,
                running=False,
                message=f"Monitor for '{doc}' not running"
            )

        success = await orchestrator.stop_monitor(doc)

        if success:
            return MonitorResponse(
                doc=doc,
                running=False,
                message=f"Stopped monitor for '{doc}'"
            )
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to stop monitor for '{doc}'"
            )

    @app.get("/api/monitors/{doc}")
    async def get_monitor(doc: str):
        """Get monitor status for a document."""
        running = orchestrator.is_monitor_running(doc)
        return MonitorResponse(
            doc=doc,
            running=running,
            message=f"Monitor {'running' if running else 'not running'}"
        )

    # --- Process Output ---

    @app.get("/api/logs/{process_name}")
    async def get_logs(process_name: str, lines: int = 50):
        """Get recent log output from a process."""
        output = orchestrator.processes.get_output(process_name, lines)
        return {"process": process_name, "lines": output}

    # --- File Management ---

    def _list_directory(base_dir: Path, rel_path: str = "", recursive: bool = False) -> List[FileEntry]:
        """List files and directories in a path."""
        target_dir = base_dir / rel_path if rel_path else base_dir
        if not target_dir.exists():
            return []

        entries = []
        try:
            for item in sorted(target_dir.iterdir()):
                # Skip hidden files and .mrmd-sync directory
                if item.name.startswith('.'):
                    continue

                rel_item_path = str(item.relative_to(base_dir))

                if item.is_dir():
                    entry = FileEntry(
                        name=item.name,
                        path=rel_item_path,
                        type="directory"
                    )
                    entries.append(entry)

                    # Recursively list subdirectories if requested
                    if recursive:
                        entries.extend(_list_directory(base_dir, rel_item_path, recursive=True))

                elif item.is_file() and item.suffix == '.md':
                    stat = item.stat()
                    entries.append(FileEntry(
                        name=item.stem,  # filename without .md
                        path=rel_item_path,
                        type="file",
                        size=stat.st_size,
                        modified=stat.st_mtime
                    ))
        except PermissionError:
            pass

        return entries

    @app.get("/api/files")
    async def list_files(
        path: str = Query("", description="Subdirectory to list"),
        recursive: bool = Query(False, description="List recursively")
    ):
        """
        List markdown files in the project.

        Query params:
            path: Subdirectory to list (relative to project root)
            recursive: If true, list all files recursively
        """
        project_root = Path(orchestrator.config.sync.project_root).resolve()
        if not project_root.exists():
            return FileListResponse(files=[], path=path, root=str(project_root))

        files = _list_directory(project_root, path, recursive=recursive)
        return FileListResponse(
            files=files,
            path=path,
            root=str(project_root)
        )

    @app.post("/api/files")
    async def create_file(request: dict):
        """Create a new markdown file."""
        name = request.get("name", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")

        # Sanitize filename (allow subdirectories with /)
        parts = name.split('/')
        safe_parts = []
        for part in parts:
            safe_part = "".join(c for c in part if c.isalnum() or c in "-_. ").strip()
            if safe_part:
                safe_parts.append(safe_part)

        if not safe_parts:
            raise HTTPException(status_code=400, detail="Invalid filename")

        safe_name = "/".join(safe_parts)

        project_root = Path(orchestrator.config.sync.project_root)
        project_root.mkdir(parents=True, exist_ok=True)

        # Ensure the filename ends with .md
        if not safe_name.endswith('.md'):
            file_path = project_root / f"{safe_name}.md"
        else:
            file_path = project_root / safe_name
            safe_name = safe_name[:-3]  # Remove .md for display name

        # Create parent directories if needed
        file_path.parent.mkdir(parents=True, exist_ok=True)

        if file_path.exists():
            raise HTTPException(status_code=409, detail=f"File '{safe_name}' already exists")

        # Create with default content
        display_name = safe_parts[-1] if safe_parts else name
        content = request.get("content", f"# {display_name}\n\nStart writing...\n")
        file_path.write_text(content)

        return {"name": safe_name, "path": str(file_path.relative_to(project_root))}

    @app.post("/api/files/rename")
    async def rename_file(request: RenameRequest):
        """
        Rename a markdown file.

        Both paths are relative to project root.
        """
        project_root = Path(orchestrator.config.sync.project_root).resolve()

        from_path = project_root / request.from_path
        to_path = project_root / request.to_path

        # Ensure .md extension
        if not to_path.suffix == '.md':
            to_path = to_path.with_suffix('.md')

        # Security: ensure both paths are within project_root
        try:
            from_path.resolve().relative_to(project_root)
            to_path.resolve().relative_to(project_root)
        except ValueError:
            raise HTTPException(status_code=400, detail="Path must be within project directory")

        if not from_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {request.from_path}")

        if to_path.exists():
            raise HTTPException(status_code=409, detail=f"File already exists: {request.to_path}")

        # Create parent directories if needed
        to_path.parent.mkdir(parents=True, exist_ok=True)

        # Rename the file
        from_path.rename(to_path)

        # Update session if exists (rename in monitors, etc.)
        old_name = from_path.stem
        new_name = to_path.stem
        if old_name in orchestrator._sessions:
            # For now, just destroy old session - user can recreate
            await orchestrator.destroy_session(old_name)

        return {
            "success": True,
            "from_path": request.from_path,
            "to_path": str(to_path.relative_to(project_root))
        }

    @app.post("/api/files/copy")
    async def copy_file(request: CopyRequest):
        """
        Copy a file (Save As functionality).

        from_path is relative to project root.
        to_path can be:
            - Relative to project root (stays in project, synced)
            - Absolute path (outside project, not synced)
        """
        project_root = Path(orchestrator.config.sync.project_root).resolve()
        from_path = project_root / request.from_path

        if not from_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {request.from_path}")

        # Determine if to_path is absolute or relative
        to_path_str = request.to_path
        if os.path.isabs(to_path_str):
            to_path = Path(to_path_str)
            is_in_project = False
            try:
                to_path.resolve().relative_to(project_root)
                is_in_project = True
            except ValueError:
                pass
        else:
            to_path = project_root / to_path_str
            is_in_project = True

        # Ensure .md extension
        if not to_path.suffix == '.md':
            to_path = to_path.with_suffix('.md')

        if to_path.exists():
            raise HTTPException(status_code=409, detail=f"File already exists: {to_path}")

        # Create parent directories if needed
        to_path.parent.mkdir(parents=True, exist_ok=True)

        # Copy the file
        shutil.copy2(from_path, to_path)

        return {
            "success": True,
            "from_path": request.from_path,
            "to_path": str(to_path),
            "in_project": is_in_project,
            "synced": is_in_project
        }

    @app.delete("/api/files/{path:path}")
    async def delete_file(path: str):
        """Delete a markdown file."""
        project_root = Path(orchestrator.config.sync.project_root).resolve()

        # Handle both with and without .md extension
        if not path.endswith('.md'):
            file_path = project_root / f"{path}.md"
        else:
            file_path = project_root / path

        # Security: ensure path is within project_root
        try:
            file_path.resolve().relative_to(project_root)
        except ValueError:
            raise HTTPException(status_code=400, detail="Path must be within project directory")

        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {path}")

        # Also destroy session if exists
        name = file_path.stem
        await orchestrator.destroy_session(name)

        file_path.unlink()
        return {"status": "deleted", "path": path}

    # --- Filesystem Browsing (for pickers) ---

    @app.get("/api/browse")
    async def browse_filesystem(
        path: str = Query("~", description="Directory to browse"),
        type: str = Query("all", description="Filter: 'all', 'dir', 'file'"),
        show_hidden: bool = Query(False, description="Show hidden files")
    ):
        """
        Browse the filesystem for file/folder pickers.

        This allows browsing outside the project for selecting venvs, etc.
        """
        # Expand ~ to home directory
        browse_path = Path(path).expanduser().resolve()

        if not browse_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

        if not browse_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

        entries = []
        try:
            for item in sorted(browse_path.iterdir()):
                # Skip hidden files unless requested
                if not show_hidden and item.name.startswith('.'):
                    continue

                # Filter by type
                if type == "dir" and not item.is_dir():
                    continue
                if type == "file" and not item.is_file():
                    continue

                entry_type = "directory" if item.is_dir() else "file"

                try:
                    stat = item.stat()
                    entries.append(FileEntry(
                        name=item.name,
                        path=str(item),
                        type=entry_type,
                        size=stat.st_size if item.is_file() else None,
                        modified=stat.st_mtime
                    ))
                except (PermissionError, OSError):
                    # Skip files we can't access
                    entries.append(FileEntry(
                        name=item.name,
                        path=str(item),
                        type=entry_type
                    ))

        except PermissionError:
            raise HTTPException(status_code=403, detail=f"Permission denied: {path}")

        # Calculate parent path
        parent = str(browse_path.parent) if browse_path.parent != browse_path else None

        return BrowseResponse(
            entries=entries,
            path=str(browse_path),
            parent=parent
        )

    # --- Environment Management ---

    def _get_python_info() -> Optional[PythonEnvironment]:
        """Get information about the current Python runtime."""
        from . import python_runtime

        python_config = orchestrator.config.runtimes.get("python")
        if not python_config:
            return None

        # Get runtime info from daemon registry (most accurate source)
        shared_runtime = python_runtime.get_runtime_info("shared")

        # Check if runtime is running
        is_running = shared_runtime and shared_runtime.get("alive", False)
        status = "ready" if is_running else "stopped"

        # Get venv and cwd from daemon registry (actual values used by runtime)
        # Fall back to orchestrator's environment config, then project venv
        if shared_runtime:
            venv_path = shared_runtime.get("venv")
            cwd = shared_runtime.get("cwd", orchestrator.config.sync.project_root)
        else:
            env_config = getattr(orchestrator, '_environment', {})
            venv_path = env_config.get('venv') or orchestrator.project_venv
            cwd = env_config.get('cwd', orchestrator.config.sync.project_root)

        # Determine Python executable
        if venv_path:
            venv_path = Path(venv_path).expanduser().resolve()
            if sys.platform == 'win32':
                executable = str(venv_path / 'Scripts' / 'python.exe')
            else:
                executable = str(venv_path / 'bin' / 'python')
            venv_name = venv_path.name
        else:
            executable = sys.executable
            venv_name = None

        # Get Python version
        try:
            if venv_path and Path(executable).exists():
                result = subprocess.run(
                    [executable, '--version'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                version = result.stdout.strip().replace('Python ', '')
            else:
                version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        except Exception:
            version = "unknown"

        return PythonEnvironment(
            version=version,
            executable=executable,
            venv=str(venv_path) if venv_path else None,
            venv_name=venv_name,
            cwd=str(Path(cwd).resolve()),
            status=status
        )

    @app.get("/api/environment")
    async def get_environment():
        """Get current environment configuration."""
        project_root = Path(orchestrator.config.sync.project_root).resolve()

        return EnvironmentResponse(
            python=_get_python_info(),
            project_root=str(project_root)
        )

    @app.post("/api/environment")
    async def update_environment(request: EnvironmentUpdateRequest):
        """
        Update environment configuration for the SHARED runtime.

        NOTE: To change venv, use POST /api/sessions with a venv parameter
        to create a dedicated runtime for the document.

        This endpoint only supports changing cwd for the shared runtime.
        """
        # Store environment config on orchestrator
        if not hasattr(orchestrator, '_environment'):
            orchestrator._environment = {}

        changes = []

        # NOTE: venv changes are no longer supported via this endpoint.
        # Use POST /api/sessions with venv parameter for dedicated runtimes.
        if request.venv is not None:
            raise HTTPException(
                status_code=400,
                detail="Venv changes are not supported for the shared runtime. Use POST /api/sessions with venv parameter to create a dedicated runtime."
            )

        if request.cwd is not None:
            cwd_path = Path(request.cwd).expanduser().resolve()
            if not cwd_path.exists():
                raise HTTPException(status_code=400, detail=f"Directory not found: {request.cwd}")
            if not cwd_path.is_dir():
                raise HTTPException(status_code=400, detail=f"Not a directory: {request.cwd}")

            orchestrator._environment['cwd'] = str(cwd_path)
            changes.append('cwd')

        # Restart Python runtime with new config if changes were made
        if changes and orchestrator.processes.is_running("mrmd-python"):
            logger.info(f"Restarting Python runtime with new environment: {changes}")

            # Stop current runtime
            await orchestrator.processes.stop("mrmd-python")

            # Start with new settings
            python_config = orchestrator.config.runtimes.get("python")
            if python_config:
                await orchestrator._start_python_runtime_with_env(python_config)

        return {
            "success": True,
            "changes": changes,
            "environment": _get_python_info().model_dump() if _get_python_info() else None
        }

    # --- Session Management ---

    @app.get("/api/sessions")
    async def list_sessions():
        """List all active sessions."""
        sessions = orchestrator.get_sessions()
        return {
            "sessions": [
                orchestrator.get_session_info(doc) for doc in sessions.keys()
            ]
        }

    @app.post("/api/sessions")
    async def create_session(request: SessionRequest):
        """
        Create a session for a document.

        This starts a monitor and optionally a dedicated Python runtime.

        Request body:
            doc: Document name (Yjs room name)
            python: "shared" (default) or "dedicated"
            venv: Optional path to virtual environment for dedicated runtimes

        Returns session info with URLs for sync, monitor, and runtime.
        """
        doc = request.doc
        python = request.python
        venv = request.venv

        if python not in ("shared", "dedicated"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid python option: {python}. Must be 'shared' or 'dedicated'"
            )

        try:
            await orchestrator.create_session(doc, python=python, venv=venv)
            info = orchestrator.get_session_info(doc)

            if not info:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create session for '{doc}'"
                )

            return info
        except Exception as e:
            logger.error(f"Failed to create session for {doc}: {e}")
            raise HTTPException(
                status_code=500,
                detail=str(e)
            )

    @app.get("/api/sessions/{doc}")
    async def get_session(doc: str):
        """Get session info for a document."""
        info = orchestrator.get_session_info(doc)
        if not info:
            raise HTTPException(
                status_code=404,
                detail=f"No session for '{doc}'"
            )
        return info

    @app.delete("/api/sessions/{doc}")
    async def delete_session(doc: str):
        """
        Destroy a session and clean up its resources.

        This stops the monitor and any dedicated runtime for the document.
        """
        success = await orchestrator.destroy_session(doc)
        if success:
            return {"doc": doc, "status": "destroyed"}
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to destroy session for '{doc}'"
            )

    # --- AI Server Proxy ---

    @app.get("/api/ai/status")
    async def ai_status():
        """Get AI server status."""
        ai_config = orchestrator.config.ai
        return {
            "url": ai_config.url,
            "managed": ai_config.managed,
            "running": orchestrator.processes.is_running("mrmd-ai"),
            "default_juice_level": ai_config.default_juice_level,
        }

    @app.get("/api/ai/programs")
    async def ai_programs():
        """Get list of available AI programs."""
        ai_url = orchestrator.config.ai.url
        if not ai_url:
            raise HTTPException(status_code=503, detail="AI server not configured")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{ai_url}/programs", timeout=5.0)
                response.raise_for_status()
                return response.json()
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"AI server unavailable: {e}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))

    @app.post("/api/ai/{program}")
    async def ai_execute(program: str, request: Request):
        """
        Execute an AI program.

        Proxies request to AI server with optional X-Juice-Level header.
        """
        ai_url = orchestrator.config.ai.url
        if not ai_url:
            raise HTTPException(status_code=503, detail="AI server not configured")

        # Get request body
        try:
            body = await request.json()
        except Exception:
            body = {}

        # Get juice level from header or use default
        juice_level = request.headers.get("X-Juice-Level")
        if juice_level is None:
            juice_level = str(orchestrator.config.ai.default_juice_level)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{ai_url}/{program}",
                    json=body,
                    headers={"X-Juice-Level": juice_level},
                    timeout=120.0,  # AI requests can be slow
                )
                response.raise_for_status()
                return response.json()
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"AI server unavailable: {e}")
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail=str(e))

    @app.post("/api/ai/{program}/stream")
    async def ai_execute_stream(program: str, request: Request):
        """
        Execute an AI program with Server-Sent Events streaming.

        Returns SSE stream with progress events.
        """
        ai_url = orchestrator.config.ai.url
        if not ai_url:
            raise HTTPException(status_code=503, detail="AI server not configured")

        # Get request body
        try:
            body = await request.json()
        except Exception:
            body = {}

        # Get juice level from header or use default
        juice_level = request.headers.get("X-Juice-Level")
        if juice_level is None:
            juice_level = str(orchestrator.config.ai.default_juice_level)

        async def event_generator():
            """Stream SSE events from AI server."""
            try:
                async with httpx.AsyncClient() as client:
                    async with client.stream(
                        "POST",
                        f"{ai_url}/{program}/stream",
                        json=body,
                        headers={
                            "X-Juice-Level": juice_level,
                            "Accept": "text/event-stream",
                        },
                        timeout=300.0,  # Longer timeout for streaming
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if line:
                                yield line + "\n"
                            else:
                                yield "\n"
            except httpx.RequestError as e:
                yield f"event: error\ndata: {{\"error\": \"AI server unavailable: {e}\"}}\n\n"
            except httpx.HTTPStatusError as e:
                yield f"event: error\ndata: {{\"error\": \"HTTP {e.response.status_code}: {e}\"}}\n\n"

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )

    return app


def mount_editor(app: FastAPI, editor_path: Path, orchestrator: "Orchestrator" = None):
    """Mount mrmd-editor static files or serve from CDN."""

    if editor_path and editor_path.exists():
        # Local editor available - mount static files
        dist_path = editor_path / "dist"
        if dist_path.exists():
            app.mount("/dist", StaticFiles(directory=str(dist_path)), name="dist")

        examples_path = editor_path / "examples"
        if examples_path.exists():
            app.mount("/examples", StaticFiles(directory=str(examples_path), html=True), name="examples")

        @app.get("/")
        async def root(request: Request):
            """Serve studio from local dist."""
            orchestrator_url = f"http://{request.headers.get('host', 'localhost:41580')}"
            return HTMLResponse(
                content=f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>mrmd</title>
    <style>
        body {{ margin: 0; padding: 0; }}
        #editor {{ width: 100vw; height: 100vh; }}
    </style>
</head>
<body>
    <div id="editor"></div>
    <script type="module">
        import {{ createStudio }} from '/dist/mrmd.esm.js';

        const studio = createStudio(document.getElementById('editor'), {{
            orchestratorUrl: '{orchestrator_url}',
            doc: 'untitled',
        }});
    </script>
</body>
</html>""",
                status_code=200,
            )

        logger.info(f"Mounted editor from {editor_path}")
    else:
        # No local editor - serve CDN version
        logger.info("Serving editor from CDN (mrmd-editor not found locally)")

        @app.get("/")
        async def root(request: Request):
            """Serve editor from CDN."""
            # Get the orchestrator URL from the current request
            orchestrator_url = f"http://{request.headers.get('host', 'localhost:41580')}"

            # Get URLs from orchestrator config
            sync_url = "ws://localhost:41444"
            runtime_url = "http://localhost:41765/mrp/v1"
            if orchestrator:
                sync_url = orchestrator.config.sync.url
                runtime_url = orchestrator.config.runtimes.get("python", {})
                if hasattr(runtime_url, "url"):
                    runtime_url = runtime_url.url
                else:
                    runtime_url = "http://localhost:41765/mrp/v1"

            return HTMLResponse(
                content=f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>mrmd</title>
    <style>
        body {{ margin: 0; padding: 0; }}
        #editor {{ width: 100vw; height: 100vh; }}
    </style>
</head>
<body>
    <div id="editor"></div>
    <script type="module">
        import {{ createStudio }} from 'https://cdn.jsdelivr.net/npm/mrmd-editor@latest/dist/mrmd.esm.js';

        const studio = createStudio(document.getElementById('editor'), {{
            orchestratorUrl: '{orchestrator_url}',
            syncUrl: '{sync_url}',
            runtimeUrl: '{runtime_url}',
            doc: 'untitled',
        }});
    </script>
</body>
</html>""",
                status_code=200,
            )


async def run_server(
    orchestrator: Orchestrator,
    host: str = "0.0.0.0",
    port: int = 8080,
    initial_doc: str = "untitled",
):
    """Run the orchestrator HTTP server."""
    import uvicorn

    # Store initial doc in orchestrator for API access
    orchestrator._initial_doc = initial_doc

    app = create_app(orchestrator)

    # Mount editor if configured
    if orchestrator.config.editor.enabled:
        editor_path = Path(orchestrator.config.editor.package_path) if orchestrator.config.editor.package_path else None
        mount_editor(app, editor_path, orchestrator)

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()

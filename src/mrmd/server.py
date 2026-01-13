"""
HTTP server for mrmd.

Serves the editor UI and provides API endpoints.
"""

import logging
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# CDN URL for mrmd-editor
EDITOR_CDN_URL = "https://unpkg.com/mrmd-editor@0.1.0/dist/mrmd.esm.js"

logger = logging.getLogger(__name__)


# --- Models ---

class FileEntry(BaseModel):
    """A file or directory entry."""
    name: str
    path: str
    type: str  # 'file' or 'directory'
    size: Optional[int] = None
    modified: Optional[float] = None


class StatusResponse(BaseModel):
    """Server status response."""
    status: str
    project: dict
    services: dict


# --- App Factory ---

def create_app(
    project_root: Path,
    docs_dir: Path,
    sync_url: str = "ws://localhost:4444",
    sync_port: int = 4444,
    runtime_url: str = "http://localhost:8765/mrp/v1",
) -> FastAPI:
    """
    Create the FastAPI application.

    Args:
        project_root: Project root directory.
        docs_dir: Documents directory.
        sync_url: WebSocket URL for mrmd-sync.
        sync_port: Port for mrmd-sync.
        runtime_url: URL for Python runtime.

    Returns:
        Configured FastAPI app.
    """
    app = FastAPI(
        title="mrmd",
        description="Collaborative markdown notebooks",
        version="0.2.0",
    )

    # CORS for browser access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Store config in app state
    app.state.project_root = project_root
    app.state.docs_dir = docs_dir
    app.state.sync_url = sync_url
    app.state.sync_port = sync_port
    app.state.runtime_url = runtime_url

    # --- Health & Status ---

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    @app.get("/api/status")
    async def status():
        return {
            "status": "running",
            "project": {
                "root": str(project_root),
                "docs": str(docs_dir),
            },
            "services": {
                "sync": sync_url,
                "runtime": runtime_url,
            },
        }

    @app.get("/api/config")
    async def config():
        """Get configuration for the editor."""
        return {
            "syncUrl": sync_url,
            "syncPort": sync_port,
            "runtimeUrl": runtime_url,
            "projectRoot": str(project_root),
            "docsDir": str(docs_dir),
        }

    # --- File Management ---

    def list_files(base_dir: Path, rel_path: str = "") -> List[FileEntry]:
        """List markdown files in a directory."""
        target_dir = base_dir / rel_path if rel_path else base_dir
        if not target_dir.exists():
            return []

        entries = []
        try:
            for item in sorted(target_dir.iterdir()):
                # Skip hidden files
                if item.name.startswith('.'):
                    continue

                rel_item_path = str(item.relative_to(base_dir))

                if item.is_dir():
                    entries.append(FileEntry(
                        name=item.name,
                        path=rel_item_path,
                        type="directory",
                    ))
                elif item.is_file() and item.suffix == '.md':
                    stat = item.stat()
                    entries.append(FileEntry(
                        name=item.stem,
                        path=rel_item_path,
                        type="file",
                        size=stat.st_size,
                        modified=stat.st_mtime,
                    ))
        except PermissionError:
            pass

        return entries

    @app.get("/api/files")
    async def get_files(path: str = Query("", description="Subdirectory")):
        """List markdown files."""
        if not docs_dir.exists():
            docs_dir.mkdir(parents=True, exist_ok=True)
        files = list_files(docs_dir, path)
        return {"files": files, "path": path, "root": str(docs_dir)}

    @app.post("/api/files")
    async def create_file(request: dict):
        """Create a new markdown file."""
        name = request.get("name", "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")

        # Sanitize filename
        safe_name = "".join(c for c in name if c.isalnum() or c in "-_. ").strip()
        if not safe_name:
            raise HTTPException(status_code=400, detail="Invalid filename")

        docs_dir.mkdir(parents=True, exist_ok=True)
        file_path = docs_dir / f"{safe_name}.md"

        if file_path.exists():
            raise HTTPException(status_code=409, detail=f"File '{safe_name}' already exists")

        content = request.get("content", f"# {safe_name}\n\nStart writing...\n")
        file_path.write_text(content)

        return {"name": safe_name, "path": f"{safe_name}.md"}

    # --- Index Page (loads editor from CDN) ---

    @app.get("/", response_class=HTMLResponse)
    async def index():
        """Serve the main editor page, loading from CDN."""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mrmd - {project_root.name}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html, body {{ height: 100%; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: light-dark(#ffffff, #1e1e1e);
      color: light-dark(#1a1a1a, #e0e0e0);
      color-scheme: light dark;
    }}
    #app {{ height: 100vh; display: flex; flex-direction: column; }}
    .header {{
      height: 36px;
      background: light-dark(#f5f5f5, #252526);
      border-bottom: 1px solid light-dark(#e0e0e0, #3c3c3c);
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 13px;
      color: light-dark(#666, #999);
    }}
    .header .logo {{ font-weight: 600; color: light-dark(#2563eb, #4f9eff); }}
    .header .project {{ margin-left: 12px; opacity: 0.7; }}
    #studio {{ flex: 1; min-height: 0; }}
    .loading {{
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: light-dark(#666, #999);
    }}
  </style>
</head>
<body>
<div id="app">
  <div class="header">
    <span class="logo">mrmd</span>
    <span class="project">{project_root.name}</span>
  </div>
  <div id="studio"><div class="loading">Loading editor...</div></div>
</div>

<script type="module">
  import {{ createStudio }} from '{EDITOR_CDN_URL}';

  const studio = await createStudio('#studio', {{
    syncUrl: '{sync_url}',
    runtimeUrl: '{runtime_url}',
    editorOptions: {{
      cellControls: {{ enabled: true }},
    }},
  }});

  window.studio = studio;
  console.log('mrmd ready. Project:', '{project_root}');
</script>
</body>
</html>"""

    return app


async def run_server(
    app: FastAPI,
    host: str = "127.0.0.1",
    port: int = 8080,
):
    """
    Run the HTTP server.

    Args:
        app: FastAPI application.
        host: Host to bind to.
        port: Port to bind to.
    """
    import uvicorn

    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="warning",  # Reduce noise
    )
    server = uvicorn.Server(config)
    await server.serve()

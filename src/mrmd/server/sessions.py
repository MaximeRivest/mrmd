"""
MRMD Session Management

Handles:
- REPL session management (SessionManager)
- Multiple IPython sessions per project (ProjectSessionManager)
- Session lifecycle (create, save, load, delete)
- Notebook-session bindings
- Session state persistence using dill
"""

import json
import gzip
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
import threading

from brepl import Session

from .environment import ensure_mrmd_in_gitignore


# ==================== Legacy REPL Session Manager ====================

class SessionManager:
    """Manages multiple REPL sessions."""

    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.metadata: Dict[str, Dict[str, Any]] = {}
        self._counter: int = 0

    def get_or_create(
        self,
        session_id: str = "default",
        cwd: Optional[str] = None,
        python_env: Optional[str] = None,
    ) -> tuple[Session, bool]:
        """
        Get existing session or create new one.

        Returns:
            Tuple of (session, is_new)
        """
        if session_id == "new":
            self._counter += 1
            session_id = f"session_{self._counter}"

        is_new = session_id not in self.sessions
        if is_new:
            self.sessions[session_id] = Session()
            self.metadata[session_id] = {}

            if cwd:
                self.sessions[session_id].interact(f"cd {cwd}<enter>", wait="auto")
                self.metadata[session_id]["cwd"] = cwd

            if python_env:
                activate_cmd = self._get_activate_command(python_env)
                if activate_cmd:
                    self.sessions[session_id].interact(f"{activate_cmd}<enter>", wait="auto")
                self.metadata[session_id]["python_env"] = python_env

        return self.sessions[session_id], is_new

    def get(self, session_id: str) -> Optional[Session]:
        """Get a session by ID."""
        return self.sessions.get(session_id)

    def close(self, session_id: str) -> bool:
        """Close a specific session."""
        if session_id in self.sessions:
            self.sessions[session_id].close()
            del self.sessions[session_id]
            if session_id in self.metadata:
                del self.metadata[session_id]
            return True
        return False

    def close_all(self) -> list[str]:
        """Close all sessions. Returns list of closed session IDs."""
        closed = list(self.sessions.keys())
        for session_id in closed:
            try:
                self.sessions[session_id].close()
            except:
                pass
            del self.sessions[session_id]
        self.metadata.clear()
        return closed

    def list_sessions(self) -> list[str]:
        """List all active session IDs."""
        return list(self.sessions.keys())

    def _get_activate_command(self, python_env: str) -> Optional[str]:
        """Get the command to activate a Python environment."""
        env_path = Path(python_env)
        if env_path.is_file():
            # It's a python executable, find activate script
            bin_dir = env_path.parent
            activate = bin_dir / "activate"
            if activate.exists():
                return f"source {activate}"
        elif env_path.is_dir():
            # It's a venv directory
            activate = env_path / "bin" / "activate"
            if activate.exists():
                return f"source {activate}"
        return None


# ==================== Multi-Session Project Management ====================

@dataclass
class SessionInfo:
    """Information about a session."""
    name: str
    created: str  # ISO format
    last_used: str  # ISO format
    state: str  # "live" or "saved"
    size: Optional[int] = None  # bytes, only for saved
    variables_count: int = 0
    python_path: Optional[str] = None


@dataclass
class SessionMeta:
    """Metadata for all sessions in a project."""
    sessions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    notebook_bindings: Dict[str, str] = field(default_factory=dict)  # notebook_path -> session_name


class ProjectSessionManager:
    """
    Manages sessions for a single project.

    Each project has:
    - A "main" session that's always available (may or may not be saved)
    - Optional named sessions that can be live or saved
    - Notebook bindings that remember which session each notebook uses
    """

    def __init__(self, project_path: str):
        self.project_path = Path(project_path)
        self.sessions_dir = self.project_path / ".mrmd" / "sessions"
        self.meta_path = self.sessions_dir / "_meta.json"
        self._lock = threading.Lock()

        # Ensure sessions directory exists
        mrmd_dir = self.project_path / ".mrmd"
        created_dir = not mrmd_dir.exists()
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

        # If we just created .mrmd/, ensure it's in .gitignore
        if created_dir:
            ensure_mrmd_in_gitignore(self.project_path)

        # Load or initialize metadata
        self._meta = self._load_meta()

        # Save initial metadata if it doesn't exist
        if not self.meta_path.exists():
            self._save_meta()

    def _load_meta(self) -> SessionMeta:
        """Load session metadata from disk."""
        if self.meta_path.exists():
            try:
                with open(self.meta_path, 'r') as f:
                    data = json.load(f)
                return SessionMeta(
                    sessions=data.get("sessions", {}),
                    notebook_bindings=data.get("notebook_bindings", {}),
                )
            except Exception as e:
                print(f"[Sessions] Error loading meta: {e}")

        # Initialize with main session
        return SessionMeta(
            sessions={
                "main": {
                    "name": "main",
                    "created": datetime.now().isoformat(),
                    "last_used": datetime.now().isoformat(),
                    "state": "live",
                    "size": None,
                    "variables_count": 0,
                }
            },
            notebook_bindings={},
        )

    def _save_meta(self):
        """Save session metadata to disk."""
        with self._lock:
            try:
                with open(self.meta_path, 'w') as f:
                    json.dump({
                        "sessions": self._meta.sessions,
                        "notebook_bindings": self._meta.notebook_bindings,
                    }, f, indent=2)
            except Exception as e:
                print(f"[Sessions] Error saving meta: {e}")

    def list_sessions(self) -> List[SessionInfo]:
        """List all sessions for this project."""
        sessions = []
        for name, data in self._meta.sessions.items():
            # Check if saved file exists and get size
            saved_path = self.sessions_dir / f"{name}.dill.gz"
            if saved_path.exists():
                size = saved_path.stat().st_size
                if data.get("state") != "live":
                    data["state"] = "saved"
                    data["size"] = size

            sessions.append(SessionInfo(
                name=data.get("name", name),
                created=data.get("created", ""),
                last_used=data.get("last_used", ""),
                state=data.get("state", "saved"),
                size=data.get("size"),
                variables_count=data.get("variables_count", 0),
                python_path=data.get("python_path"),
            ))

        return sessions

    def get_session(self, name: str) -> Optional[SessionInfo]:
        """Get info about a specific session."""
        if name not in self._meta.sessions:
            return None

        data = self._meta.sessions[name]
        return SessionInfo(
            name=data.get("name", name),
            created=data.get("created", ""),
            last_used=data.get("last_used", ""),
            state=data.get("state", "saved"),
            size=data.get("size"),
            variables_count=data.get("variables_count", 0),
            python_path=data.get("python_path"),
        )

    def create_session(self, name: str, python_path: Optional[str] = None) -> SessionInfo:
        """Create a new session entry in metadata."""
        now = datetime.now().isoformat()

        self._meta.sessions[name] = {
            "name": name,
            "created": now,
            "last_used": now,
            "state": "live",
            "size": None,
            "variables_count": 0,
            "python_path": python_path,
        }
        self._save_meta()

        return self.get_session(name)

    def update_session(
        self,
        name: str,
        state: Optional[str] = None,
        variables_count: Optional[int] = None,
        size: Optional[int] = None,
    ):
        """Update session metadata."""
        if name not in self._meta.sessions:
            return

        self._meta.sessions[name]["last_used"] = datetime.now().isoformat()

        if state is not None:
            self._meta.sessions[name]["state"] = state
        if variables_count is not None:
            self._meta.sessions[name]["variables_count"] = variables_count
        if size is not None:
            self._meta.sessions[name]["size"] = size

        self._save_meta()

    def delete_session(self, name: str) -> bool:
        """Delete a session and its saved state."""
        if name == "main":
            return False  # Can't delete main session

        if name not in self._meta.sessions:
            return False

        # Delete saved file if exists
        saved_path = self.sessions_dir / f"{name}.dill.gz"
        if saved_path.exists():
            saved_path.unlink()

        # Remove from meta
        del self._meta.sessions[name]

        # Update any notebooks bound to this session to use main
        for notebook, session in list(self._meta.notebook_bindings.items()):
            if session == name:
                self._meta.notebook_bindings[notebook] = "main"

        self._save_meta()
        return True

    def get_saved_path(self, name: str) -> Path:
        """Get the path to a session's saved state file."""
        return self.sessions_dir / f"{name}.dill.gz"

    def has_saved_state(self, name: str) -> bool:
        """Check if a session has saved state on disk."""
        return self.get_saved_path(name).exists()

    # Notebook bindings

    def get_notebook_session(self, notebook_path: str) -> str:
        """Get the session name for a notebook. Returns 'main' if not bound."""
        rel_path = self._normalize_notebook_path(notebook_path)
        return self._meta.notebook_bindings.get(rel_path, "main")

    def bind_notebook(self, notebook_path: str, session_name: str):
        """Bind a notebook to a session."""
        rel_path = self._normalize_notebook_path(notebook_path)
        self._meta.notebook_bindings[rel_path] = session_name
        self._save_meta()

    def unbind_notebook(self, notebook_path: str):
        """Remove notebook binding (will use main)."""
        rel_path = self._normalize_notebook_path(notebook_path)
        if rel_path in self._meta.notebook_bindings:
            del self._meta.notebook_bindings[rel_path]
            self._save_meta()

    def get_notebooks_for_session(self, session_name: str) -> List[str]:
        """Get all notebooks bound to a session."""
        notebooks = []
        for notebook, session in self._meta.notebook_bindings.items():
            if session == session_name:
                notebooks.append(notebook)
        return notebooks

    def _normalize_notebook_path(self, notebook_path: str) -> str:
        """Normalize notebook path to be relative to project."""
        path = Path(notebook_path)
        try:
            return str(path.relative_to(self.project_path))
        except ValueError:
            # Already relative or outside project
            return str(path)


def serialize_namespace(namespace: Dict[str, Any], output_path: Path) -> Dict[str, Any]:
    """
    Serialize IPython user namespace to disk using dill.

    Returns dict with stats about what was saved.
    """
    try:
        import dill
    except ImportError:
        raise RuntimeError("dill is required for session persistence. Install with: uv add dill")

    # Filter namespace - skip internal IPython stuff
    skip_prefixes = ('_', 'In', 'Out', 'get_ipython', 'exit', 'quit')
    skip_names = {'__builtins__', '__name__', '__doc__'}

    to_save = {}
    skipped = []
    errors = []

    for name, value in namespace.items():
        if name in skip_names:
            continue
        if any(name.startswith(p) for p in skip_prefixes):
            continue

        # Try to pickle each object
        try:
            dill.dumps(value)  # Test if picklable
            to_save[name] = value
        except Exception as e:
            errors.append({"name": name, "type": type(value).__name__, "error": str(e)})

    # Save with gzip compression
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(output_path, 'wb') as f:
        dill.dump(to_save, f)

    size = output_path.stat().st_size

    return {
        "saved_count": len(to_save),
        "saved_names": list(to_save.keys()),
        "skipped_count": len(skipped),
        "error_count": len(errors),
        "errors": errors[:10],  # Limit error reporting
        "size": size,
    }


def deserialize_namespace(input_path: Path) -> Dict[str, Any]:
    """
    Load IPython namespace from disk.

    Returns dict with the namespace and stats.
    """
    try:
        import dill
    except ImportError:
        raise RuntimeError("dill is required for session persistence. Install with: uv add dill")

    if not input_path.exists():
        raise FileNotFoundError(f"Session file not found: {input_path}")

    with gzip.open(input_path, 'rb') as f:
        namespace = dill.load(f)

    return {
        "namespace": namespace,
        "loaded_count": len(namespace),
        "loaded_names": list(namespace.keys()),
    }


# Global project session managers cache
_managers: Dict[str, ProjectSessionManager] = {}
_managers_lock = threading.Lock()


def get_project_session_manager(project_path: str) -> ProjectSessionManager:
    """Get or create a session manager for a project."""
    with _managers_lock:
        if project_path not in _managers:
            _managers[project_path] = ProjectSessionManager(project_path)
        return _managers[project_path]

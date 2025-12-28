"""
Project Pool - Pre-warms recent projects for instant switching.

Keeps the last N projects "warm" with:
- IPython sessions running
- File contents cached
- Tab state ready

This enables near-instant project switching (<100ms) for recent projects.
"""

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime


@dataclass
class CachedFile:
    """A cached file with content and metadata."""
    path: str
    content: str
    mtime: float
    cached_at: float = field(default_factory=time.time)


@dataclass
class WarmProject:
    """A pre-warmed project with session and file cache."""
    path: str
    name: str
    session_id: str
    python_path: Optional[str]
    open_files: Dict[str, CachedFile] = field(default_factory=dict)
    active_file: Optional[str] = None
    last_accessed: float = field(default_factory=time.time)
    variables: List[Dict[str, Any]] = field(default_factory=list)

    def touch(self):
        """Mark as recently accessed."""
        self.last_accessed = time.time()


class ProjectPool:
    """
    Manages a pool of pre-warmed projects for instant switching.

    Architecture:
    - Keeps last N projects (default 3) with running IPython sessions
    - Caches file contents for open tabs
    - LRU eviction when over limit
    - File mtime checking to detect external changes
    """

    def __init__(self, max_projects: int = 3, ipython_manager=None):
        """
        Initialize the project pool.

        Args:
            max_projects: Maximum number of warm projects to keep
            ipython_manager: SubprocessIPythonSessionManager instance
        """
        self.max_projects = max_projects
        self.ipython_manager = ipython_manager
        self._projects: OrderedDict[str, WarmProject] = OrderedDict()
        self._lock = threading.RLock()
        self._current_project: Optional[str] = None

    def set_ipython_manager(self, manager):
        """Set the IPython manager (for deferred initialization)."""
        self.ipython_manager = manager

    def get_warm_project(self, project_path: str) -> Optional[WarmProject]:
        """Get a warm project if it exists."""
        with self._lock:
            return self._projects.get(project_path)

    def is_warm(self, project_path: str) -> bool:
        """Check if a project is warm (pre-loaded)."""
        return project_path in self._projects

    def get_current_project(self) -> Optional[WarmProject]:
        """Get the currently active project."""
        if self._current_project:
            return self._projects.get(self._current_project)
        return None

    def warm_project(
        self,
        project_path: str,
        name: str,
        python_path: Optional[str] = None,
        tab_paths: Optional[List[str]] = None,
        active_file: Optional[str] = None,
    ) -> WarmProject:
        """
        Pre-warm a project (start session, cache files).

        Args:
            project_path: Path to the project directory
            name: Project name (for display)
            python_path: Python executable to use
            tab_paths: List of file paths to pre-cache
            active_file: Currently active file

        Returns:
            The warmed project
        """
        # Quick check with lock - is it already warm?
        with self._lock:
            if project_path in self._projects:
                project = self._projects[project_path]
                project.touch()
                self._projects.move_to_end(project_path)
                if active_file:
                    project.active_file = active_file
                return project

            # Not warm - prepare to create (but don't block)
            self._evict_if_needed()
            session_id = self._make_session_id(project_path)

            # Create project entry first (without files cached)
            project = WarmProject(
                path=project_path,
                name=name,
                session_id=session_id,
                python_path=python_path,
                active_file=active_file,
            )
            self._projects[project_path] = project

        # Do slow operations OUTSIDE the lock
        # Start IPython session (can take seconds)
        if self.ipython_manager and python_path:
            try:
                figure_dir = str(Path(project_path) / ".mrmd" / "figures")
                self.ipython_manager.get_or_create(
                    session_id=session_id,
                    python_path=python_path,
                    cwd=project_path,
                    figure_dir=figure_dir,
                )
            except Exception as e:
                print(f"[ProjectPool] Error starting session: {e}")

        # Cache files (can be slow for many files)
        if tab_paths:
            self._cache_files(project, tab_paths)

        print(f"[ProjectPool] Warmed project: {name} ({len(self._projects)}/{self.max_projects})")
        return project

    def switch_to(self, project_path: str) -> Optional[WarmProject]:
        """
        Switch to a project (mark as current).

        Returns the project if warm, None if cold (needs loading).
        """
        with self._lock:
            if project_path in self._projects:
                project = self._projects[project_path]
                project.touch()
                self._projects.move_to_end(project_path)
                self._current_project = project_path
                return project
            return None

    def get_cached_file(self, project_path: str, file_path: str) -> Optional[CachedFile]:
        """Get a cached file if available and fresh."""
        with self._lock:
            project = self._projects.get(project_path)
            if not project:
                return None

            cached = project.open_files.get(file_path)
            if not cached:
                return None

            # Check if file changed on disk
            try:
                current_mtime = Path(file_path).stat().st_mtime
                if current_mtime > cached.mtime:
                    # File changed, invalidate cache
                    del project.open_files[file_path]
                    return None
            except OSError:
                return None

            return cached

    def cache_file(self, project_path: str, file_path: str, content: str, mtime: float):
        """Cache a file's content."""
        with self._lock:
            project = self._projects.get(project_path)
            if project:
                project.open_files[file_path] = CachedFile(
                    path=file_path,
                    content=content,
                    mtime=mtime,
                )

    def invalidate_file(self, project_path: str, file_path: str):
        """Invalidate a cached file (e.g., after external change)."""
        with self._lock:
            project = self._projects.get(project_path)
            if project and file_path in project.open_files:
                del project.open_files[file_path]

    def update_variables(self, project_path: str, variables: List[Dict[str, Any]]):
        """Update cached variables for a project."""
        with self._lock:
            project = self._projects.get(project_path)
            if project:
                project.variables = variables

    def get_status(self) -> Dict[str, Any]:
        """Get pool status for debugging."""
        with self._lock:
            return {
                "max_projects": self.max_projects,
                "warm_count": len(self._projects),
                "current_project": self._current_project,
                "projects": [
                    {
                        "path": p.path,
                        "name": p.name,
                        "session_id": p.session_id,
                        "cached_files": len(p.open_files),
                        "last_accessed": datetime.fromtimestamp(p.last_accessed).isoformat(),
                    }
                    for p in self._projects.values()
                ]
            }

    def shutdown(self):
        """Shutdown all sessions (for clean exit)."""
        with self._lock:
            for project in self._projects.values():
                if self.ipython_manager:
                    try:
                        self.ipython_manager.close(project.session_id)
                    except Exception as e:
                        print(f"[ProjectPool] Error closing session {project.session_id}: {e}")
            self._projects.clear()

    # Private methods

    def _evict_if_needed(self):
        """Evict oldest project if at capacity."""
        while len(self._projects) >= self.max_projects:
            # Get oldest (first item in OrderedDict)
            oldest_path, oldest = next(iter(self._projects.items()))

            # Don't evict current project
            if oldest_path == self._current_project and len(self._projects) > 1:
                # Move current to end and try again
                self._projects.move_to_end(oldest_path)
                oldest_path, oldest = next(iter(self._projects.items()))

            print(f"[ProjectPool] Evicting: {oldest.name}")

            # Shutdown session
            if self.ipython_manager:
                try:
                    self.ipython_manager.close(oldest.session_id)
                except Exception as e:
                    print(f"[ProjectPool] Error closing evicted session: {e}")

            del self._projects[oldest_path]

    def _cache_files(self, project: WarmProject, file_paths: List[str]):
        """Pre-cache files for a project."""
        for file_path in file_paths:
            if file_path in project.open_files:
                continue  # Already cached

            try:
                path = Path(file_path)
                if path.exists() and path.is_file():
                    content = path.read_text(encoding="utf-8", errors="replace")
                    mtime = path.stat().st_mtime
                    project.open_files[file_path] = CachedFile(
                        path=file_path,
                        content=content,
                        mtime=mtime,
                    )
            except Exception as e:
                print(f"[ProjectPool] Error caching {file_path}: {e}")

    def _make_session_id(self, project_path: str) -> str:
        """Create a session ID for a project."""
        # Use project path hash for deterministic ID
        import hashlib
        hash_str = hashlib.md5(project_path.encode()).hexdigest()[:8]
        return f"project_{hash_str}"


# Global instance
_pool: Optional[ProjectPool] = None
_pool_lock = threading.Lock()


def get_project_pool(max_projects: int = 3) -> ProjectPool:
    """Get or create the global project pool."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ProjectPool(max_projects=max_projects)
        return _pool


def init_project_pool(ipython_manager, max_projects: int = 3) -> ProjectPool:
    """Initialize the project pool with an IPython manager."""
    pool = get_project_pool(max_projects)
    pool.set_ipython_manager(ipython_manager)
    return pool

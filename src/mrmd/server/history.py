"""
Version history management using SQLite.

Provides autosave, version tracking, and history browsing for files.
"""

import sqlite3
import time
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
import json

from .environment import ensure_mrmd_in_gitignore


class HistoryManager:
    """Manages file version history in SQLite."""

    SCHEMA = """
    -- File versions (snapshots)
    CREATE TABLE IF NOT EXISTS file_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT NOT NULL,
        timestamp REAL NOT NULL,
        parent_version_id INTEGER,
        message TEXT,
        FOREIGN KEY (parent_version_id) REFERENCES file_versions(id)
    );

    -- Index for fast file history lookup
    CREATE INDEX IF NOT EXISTS idx_file_versions_path
        ON file_versions(file_path, timestamp DESC);

    -- Active editing sessions (presence)
    CREATE TABLE IF NOT EXISTS active_sessions (
        session_id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        user_type TEXT NOT NULL,
        file_path TEXT,
        cursor_line INTEGER,
        cursor_col INTEGER,
        last_heartbeat REAL NOT NULL
    );

    -- Index for session cleanup
    CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat
        ON active_sessions(last_heartbeat);
    """

    def __init__(self, project_root: str):
        """Initialize history manager for a project.

        Args:
            project_root: Path to project root directory
        """
        self.project_root = Path(project_root)
        self.mrmd_dir = self.project_root / ".mrmd"
        self.db_path = self.mrmd_dir / "history.db"
        self._ensure_db()

    def _ensure_db(self):
        """Ensure database and schema exist."""
        created_dir = not self.mrmd_dir.exists()
        self.mrmd_dir.mkdir(parents=True, exist_ok=True)

        # If we just created .mrmd/, ensure it's in .gitignore
        if created_dir:
            ensure_mrmd_in_gitignore(self.project_root)

        with self._get_conn() as conn:
            conn.executescript(self.SCHEMA)

    @contextmanager
    def _get_conn(self):
        """Get a database connection with proper cleanup."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _relative_path(self, file_path: str) -> str:
        """Convert absolute path to project-relative path."""
        try:
            return str(Path(file_path).relative_to(self.project_root))
        except ValueError:
            # Path not under project root, use as-is
            return file_path

    def _absolute_path(self, relative_path: str) -> str:
        """Convert project-relative path to absolute path."""
        return str(self.project_root / relative_path)

    # ==================== Version Operations ====================

    def save_version(
        self,
        file_path: str,
        content: str,
        author: str,
        message: Optional[str] = None,
        parent_version_id: Optional[int] = None
    ) -> int:
        """Save a new version of a file.

        Args:
            file_path: Absolute or relative file path
            content: File content
            author: Author identifier (e.g., 'user:john' or 'ai:claude')
            message: Optional commit-like message
            parent_version_id: Optional parent version for merge tracking

        Returns:
            New version ID
        """
        rel_path = self._relative_path(file_path)
        timestamp = time.time()

        # If no parent specified, use latest version as parent
        if parent_version_id is None:
            latest = self.get_latest_version(file_path)
            if latest:
                parent_version_id = latest['id']

        with self._get_conn() as conn:
            cursor = conn.execute(
                """
                INSERT INTO file_versions
                    (file_path, content, author, timestamp, parent_version_id, message)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (rel_path, content, author, timestamp, parent_version_id, message)
            )
            return cursor.lastrowid

    def get_version(self, version_id: int) -> Optional[Dict[str, Any]]:
        """Get a specific version by ID.

        Returns:
            Version dict with id, file_path, content, author, timestamp, message
            or None if not found
        """
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM file_versions WHERE id = ?",
                (version_id,)
            ).fetchone()
            if row:
                return dict(row)
        return None

    def get_latest_version(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Get the most recent version of a file.

        Args:
            file_path: Absolute or relative file path

        Returns:
            Version dict or None if no versions exist
        """
        rel_path = self._relative_path(file_path)
        with self._get_conn() as conn:
            row = conn.execute(
                """
                SELECT * FROM file_versions
                WHERE file_path = ?
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (rel_path,)
            ).fetchone()
            if row:
                return dict(row)
        return None

    def list_versions(
        self,
        file_path: str,
        limit: int = 50,
        since: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """List versions of a file.

        Args:
            file_path: Absolute or relative file path
            limit: Maximum number of versions to return
            since: Optional timestamp to filter versions after

        Returns:
            List of version dicts (without content, for efficiency)
        """
        rel_path = self._relative_path(file_path)
        with self._get_conn() as conn:
            if since:
                rows = conn.execute(
                    """
                    SELECT id, file_path, author, timestamp, parent_version_id, message
                    FROM file_versions
                    WHERE file_path = ? AND timestamp > ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (rel_path, since, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, file_path, author, timestamp, parent_version_id, message
                    FROM file_versions
                    WHERE file_path = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (rel_path, limit)
                ).fetchall()
            return [dict(row) for row in rows]

    def get_version_at_time(
        self,
        file_path: str,
        timestamp: float
    ) -> Optional[Dict[str, Any]]:
        """Get the version that was current at a specific time.

        Args:
            file_path: Absolute or relative file path
            timestamp: Unix timestamp

        Returns:
            Version dict or None
        """
        rel_path = self._relative_path(file_path)
        with self._get_conn() as conn:
            row = conn.execute(
                """
                SELECT * FROM file_versions
                WHERE file_path = ? AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT 1
                """,
                (rel_path, timestamp)
            ).fetchone()
            if row:
                return dict(row)
        return None

    # ==================== Diff Operations ====================

    def get_diff(
        self,
        from_version_id: int,
        to_version_id: int
    ) -> Optional[str]:
        """Get unified diff between two versions.

        Args:
            from_version_id: Starting version ID
            to_version_id: Ending version ID

        Returns:
            Unified diff string or None if versions not found
        """
        import difflib

        from_ver = self.get_version(from_version_id)
        to_ver = self.get_version(to_version_id)

        if not from_ver or not to_ver:
            return None

        from_lines = from_ver['content'].splitlines(keepends=True)
        to_lines = to_ver['content'].splitlines(keepends=True)

        diff = difflib.unified_diff(
            from_lines,
            to_lines,
            fromfile=f"v{from_version_id}",
            tofile=f"v{to_version_id}",
            fromfiledate=str(from_ver['timestamp']),
            tofiledate=str(to_ver['timestamp'])
        )
        return ''.join(diff)

    # ==================== Session/Presence Operations ====================

    def update_session(
        self,
        session_id: str,
        user_name: str,
        user_type: str = 'human',
        file_path: Optional[str] = None,
        cursor_line: Optional[int] = None,
        cursor_col: Optional[int] = None
    ):
        """Update or create an editing session.

        Args:
            session_id: Unique session identifier
            user_name: Display name
            user_type: 'human' or 'ai'
            file_path: Currently editing file (None if not editing)
            cursor_line: Current cursor line
            cursor_col: Current cursor column
        """
        rel_path = self._relative_path(file_path) if file_path else None
        timestamp = time.time()

        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO active_sessions
                    (session_id, user_name, user_type, file_path,
                     cursor_line, cursor_col, last_heartbeat)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (session_id, user_name, user_type, rel_path,
                 cursor_line, cursor_col, timestamp)
            )

    def remove_session(self, session_id: str):
        """Remove an editing session."""
        with self._get_conn() as conn:
            conn.execute(
                "DELETE FROM active_sessions WHERE session_id = ?",
                (session_id,)
            )

    def get_active_sessions(
        self,
        file_path: Optional[str] = None,
        timeout: float = 60.0
    ) -> List[Dict[str, Any]]:
        """Get active editing sessions.

        Args:
            file_path: Optional file path to filter by
            timeout: Seconds after which sessions are considered stale

        Returns:
            List of session dicts
        """
        cutoff = time.time() - timeout

        with self._get_conn() as conn:
            if file_path:
                rel_path = self._relative_path(file_path)
                rows = conn.execute(
                    """
                    SELECT * FROM active_sessions
                    WHERE file_path = ? AND last_heartbeat > ?
                    """,
                    (rel_path, cutoff)
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM active_sessions
                    WHERE last_heartbeat > ?
                    """,
                    (cutoff,)
                ).fetchall()
            return [dict(row) for row in rows]

    def cleanup_stale_sessions(self, timeout: float = 60.0) -> int:
        """Remove stale sessions.

        Args:
            timeout: Seconds after which sessions are considered stale

        Returns:
            Number of sessions removed
        """
        cutoff = time.time() - timeout
        with self._get_conn() as conn:
            cursor = conn.execute(
                "DELETE FROM active_sessions WHERE last_heartbeat < ?",
                (cutoff,)
            )
            return cursor.rowcount

    # ==================== Maintenance ====================

    def prune_old_versions(
        self,
        file_path: str,
        keep_count: int = 100,
        keep_days: int = 30
    ) -> int:
        """Prune old versions of a file, keeping recent ones.

        Keeps either:
        - The most recent `keep_count` versions, OR
        - All versions from the last `keep_days` days

        Whichever results in more versions being kept.

        Args:
            file_path: File path to prune
            keep_count: Minimum number of versions to keep
            keep_days: Minimum days of history to keep

        Returns:
            Number of versions deleted
        """
        rel_path = self._relative_path(file_path)
        cutoff_time = time.time() - (keep_days * 86400)

        with self._get_conn() as conn:
            # Get IDs to keep (by count)
            keep_by_count = conn.execute(
                """
                SELECT id FROM file_versions
                WHERE file_path = ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (rel_path, keep_count)
            ).fetchall()
            keep_ids = {row['id'] for row in keep_by_count}

            # Get IDs to keep (by time)
            keep_by_time = conn.execute(
                """
                SELECT id FROM file_versions
                WHERE file_path = ? AND timestamp > ?
                """,
                (rel_path, cutoff_time)
            ).fetchall()
            keep_ids.update(row['id'] for row in keep_by_time)

            if not keep_ids:
                return 0

            # Delete versions not in keep set
            placeholders = ','.join('?' * len(keep_ids))
            cursor = conn.execute(
                f"""
                DELETE FROM file_versions
                WHERE file_path = ? AND id NOT IN ({placeholders})
                """,
                (rel_path, *keep_ids)
            )
            return cursor.rowcount

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the history database.

        Returns:
            Dict with version_count, file_count, db_size, etc.
        """
        with self._get_conn() as conn:
            version_count = conn.execute(
                "SELECT COUNT(*) FROM file_versions"
            ).fetchone()[0]

            file_count = conn.execute(
                "SELECT COUNT(DISTINCT file_path) FROM file_versions"
            ).fetchone()[0]

            session_count = conn.execute(
                "SELECT COUNT(*) FROM active_sessions"
            ).fetchone()[0]

        db_size = self.db_path.stat().st_size if self.db_path.exists() else 0

        return {
            'version_count': version_count,
            'file_count': file_count,
            'session_count': session_count,
            'db_size_bytes': db_size,
            'db_path': str(self.db_path)
        }


# ==================== Global Instance Management ====================

_history_managers: Dict[str, HistoryManager] = {}


def get_history_manager(project_root: str) -> HistoryManager:
    """Get or create a HistoryManager for a project.

    Args:
        project_root: Path to project root directory

    Returns:
        HistoryManager instance
    """
    project_root = str(Path(project_root).resolve())
    if project_root not in _history_managers:
        _history_managers[project_root] = HistoryManager(project_root)
    return _history_managers[project_root]

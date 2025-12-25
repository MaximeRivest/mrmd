"""
File watcher using watchdog for efficient filesystem monitoring.

Replaces HTTP polling with push-based notifications via WebSocket.
Uses OS-native file watching (inotify on Linux, FSEvents on macOS).
"""

import asyncio
import os
import time
from pathlib import Path
from typing import Dict, Set, Callable, Optional, Any
from dataclasses import dataclass, field
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent, FileDeletedEvent


@dataclass
class WatchedFile:
    """A file being watched for changes."""
    path: str
    mtime: float
    watchers: Set[str] = field(default_factory=set)  # session_ids watching this file


class FileChangeHandler(FileSystemEventHandler):
    """Watchdog event handler that queues events for async processing."""

    def __init__(self, watcher: 'FileWatcher'):
        self.watcher = watcher
        super().__init__()

    def on_modified(self, event):
        if not event.is_directory:
            self.watcher._queue_event('modified', event.src_path)

    def on_created(self, event):
        # Queue directory change event for both files and directories
        self.watcher._queue_dir_event('created', event.src_path, event.is_directory)
        if not event.is_directory:
            self.watcher._queue_event('created', event.src_path)

    def on_deleted(self, event):
        # Queue directory change event for both files and directories
        self.watcher._queue_dir_event('deleted', event.src_path, event.is_directory)
        if not event.is_directory:
            self.watcher._queue_event('deleted', event.src_path)


class FileWatcher:
    """
    Manages file watching for multiple clients.

    Each client can watch multiple files. When a file changes, all clients
    watching that file are notified via callback.
    """

    def __init__(self, on_change: Callable[[str, str, float, Set[str]], Any],
                 on_dir_change: Callable[[str, str, str, bool, Set[str]], Any] = None):
        """
        Initialize file watcher.

        Args:
            on_change: Async callback called when file changes.
                       Signature: (path, event_type, mtime, session_ids) -> None
            on_dir_change: Async callback called when directory contents change.
                           Signature: (dir_path, event_type, changed_path, is_dir, session_ids) -> None
        """
        self.on_change = on_change
        self.on_dir_change = on_dir_change

        # path -> WatchedFile
        self.watched_files: Dict[str, WatchedFile] = {}

        # directory -> set of file paths being watched in that directory
        self.watched_dirs: Dict[str, Set[str]] = {}

        # Directory watchers: dir_path -> set of session_ids
        self.dir_watchers: Dict[str, Set[str]] = {}

        # watchdog observer
        self._observer: Optional[Observer] = None
        self._handler = FileChangeHandler(self)

        # Event queue for async processing
        self._event_queue: asyncio.Queue = None
        self._dir_event_queue: asyncio.Queue = None
        self._event_task: Optional[asyncio.Task] = None
        self._dir_event_task: Optional[asyncio.Task] = None

        # Debounce: path -> (timestamp, scheduled)
        # Prevents multiple rapid events for same file (e.g., editors that write multiple times)
        self._debounce: Dict[str, float] = {}
        self._debounce_ms = 100  # Debounce window
        self._dir_debounce: Dict[str, float] = {}
        self._dir_debounce_ms = 200  # Slightly longer debounce for directory events

        # Lock for thread-safe operations
        self._lock: Optional[asyncio.Lock] = None

    async def start(self):
        """Start the file watcher."""
        if self._observer is not None:
            return

        self._lock = asyncio.Lock()
        self._event_queue = asyncio.Queue()
        self._dir_event_queue = asyncio.Queue()
        self._observer = Observer()
        self._observer.start()

        # Start async event processors
        self._event_task = asyncio.create_task(self._process_events())
        self._dir_event_task = asyncio.create_task(self._process_dir_events())
        print('[FileWatcher] Started')

    async def stop(self):
        """Stop the file watcher."""
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

        if self._event_task:
            self._event_task.cancel()
            try:
                await self._event_task
            except asyncio.CancelledError:
                pass
            self._event_task = None

        if self._dir_event_task:
            self._dir_event_task.cancel()
            try:
                await self._dir_event_task
            except asyncio.CancelledError:
                pass
            self._dir_event_task = None

        print('[FileWatcher] Stopped')

    async def watch_file(self, path: str, session_id: str) -> Optional[float]:
        """
        Start watching a file for a session.

        Args:
            path: Absolute path to file
            session_id: Client session ID

        Returns:
            Current mtime of file, or None if file doesn't exist
        """
        if not self._observer:
            await self.start()

        async with self._lock:
            # Normalize path
            path = os.path.abspath(path)

            # Get current mtime
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                mtime = None

            if path in self.watched_files:
                # Already watching, just add session
                self.watched_files[path].watchers.add(session_id)
                if mtime:
                    self.watched_files[path].mtime = mtime
            else:
                # Start watching
                self.watched_files[path] = WatchedFile(
                    path=path,
                    mtime=mtime or 0,
                    watchers={session_id}
                )

                # Watch the directory
                dir_path = os.path.dirname(path)
                if dir_path not in self.watched_dirs:
                    self.watched_dirs[dir_path] = set()
                    # Schedule directory for watching
                    self._observer.schedule(self._handler, dir_path, recursive=False)
                    print(f'[FileWatcher] Watching directory: {dir_path}')

                self.watched_dirs[dir_path].add(path)

            return mtime

    async def unwatch_file(self, path: str, session_id: str):
        """
        Stop watching a file for a session.

        Args:
            path: Absolute path to file
            session_id: Client session ID
        """
        if not self._lock:
            return

        async with self._lock:
            path = os.path.abspath(path)

            if path not in self.watched_files:
                return

            watched = self.watched_files[path]
            watched.watchers.discard(session_id)

            # If no more watchers, stop watching
            if not watched.watchers:
                del self.watched_files[path]

                # Check if we can unwatch the directory
                dir_path = os.path.dirname(path)
                if dir_path in self.watched_dirs:
                    self.watched_dirs[dir_path].discard(path)
                    if not self.watched_dirs[dir_path]:
                        del self.watched_dirs[dir_path]
                        # Note: watchdog doesn't have a clean way to unschedule
                        # a single directory, so we leave it scheduled.
                        # This is fine - events for unwatched files are ignored.

    async def unwatch_all(self, session_id: str):
        """Stop watching all files and directories for a session."""
        if not self._lock:
            return

        async with self._lock:
            paths_to_unwatch = []
            for path, watched in self.watched_files.items():
                if session_id in watched.watchers:
                    paths_to_unwatch.append(path)

            dirs_to_unwatch = []
            for dir_path, watchers in self.dir_watchers.items():
                if session_id in watchers:
                    dirs_to_unwatch.append(dir_path)

        # Unwatch outside of lock to avoid nested lock
        for path in paths_to_unwatch:
            await self.unwatch_file(path, session_id)
        for dir_path in dirs_to_unwatch:
            await self.unwatch_directory(dir_path, session_id)

    # ==================== Directory Watching ====================

    async def watch_directory(self, dir_path: str, session_id: str) -> bool:
        """
        Start watching a directory for a session.

        Args:
            dir_path: Absolute path to directory
            session_id: Client session ID

        Returns:
            True if successfully watching, False if directory doesn't exist
        """
        if not self._observer:
            await self.start()

        async with self._lock:
            dir_path = os.path.abspath(dir_path)

            if not os.path.isdir(dir_path):
                return False

            if dir_path in self.dir_watchers:
                # Already watching, just add session
                self.dir_watchers[dir_path].add(session_id)
            else:
                # Start watching
                self.dir_watchers[dir_path] = {session_id}
                # Schedule directory for watching (non-recursive - just immediate children)
                self._observer.schedule(self._handler, dir_path, recursive=False)
                print(f'[FileWatcher] Watching directory: {dir_path}')

            return True

    async def unwatch_directory(self, dir_path: str, session_id: str):
        """
        Stop watching a directory for a session.

        Args:
            dir_path: Absolute path to directory
            session_id: Client session ID
        """
        if not self._lock:
            return

        async with self._lock:
            dir_path = os.path.abspath(dir_path)

            if dir_path not in self.dir_watchers:
                return

            self.dir_watchers[dir_path].discard(session_id)

            if not self.dir_watchers[dir_path]:
                del self.dir_watchers[dir_path]
                # Note: watchdog doesn't have clean unschedule, events for
                # unwatched dirs are ignored in _process_dir_events

    def _queue_event(self, event_type: str, path: str):
        """Queue a file event for async processing (called from watchdog thread)."""
        if self._event_queue:
            try:
                self._event_queue.put_nowait((event_type, path, time.time()))
            except asyncio.QueueFull:
                pass  # Drop event if queue is full

    def _queue_dir_event(self, event_type: str, path: str, is_directory: bool):
        """Queue a directory content change event (called from watchdog thread)."""
        if self._dir_event_queue:
            try:
                self._dir_event_queue.put_nowait((event_type, path, is_directory, time.time()))
            except asyncio.QueueFull:
                pass  # Drop event if queue is full

    async def _process_events(self):
        """Process file events from watchdog."""
        while True:
            try:
                event_type, path, timestamp = await self._event_queue.get()

                # Normalize path
                path = os.path.abspath(path)

                # Check if we're watching this file
                async with self._lock:
                    if path not in self.watched_files:
                        continue

                    # Debounce: skip if we recently processed this file
                    last_event = self._debounce.get(path, 0)
                    if timestamp - last_event < self._debounce_ms / 1000:
                        continue
                    self._debounce[path] = timestamp

                    watched = self.watched_files[path]

                    # Get new mtime
                    try:
                        new_mtime = os.path.getmtime(path)
                    except OSError:
                        new_mtime = None

                    # Skip if mtime hasn't actually changed (some editors trigger spurious events)
                    if new_mtime and watched.mtime and abs(new_mtime - watched.mtime) < 0.01:
                        continue

                    # Update stored mtime
                    if new_mtime:
                        watched.mtime = new_mtime

                    session_ids = set(watched.watchers)

                # Notify watchers (outside lock)
                if session_ids and self.on_change:
                    try:
                        await self.on_change(path, event_type, new_mtime, session_ids)
                    except Exception as e:
                        print(f'[FileWatcher] Error in change callback: {e}')

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f'[FileWatcher] Event processing error: {e}')

    async def _process_dir_events(self):
        """Process directory content change events from watchdog."""
        while True:
            try:
                event_type, path, is_directory, timestamp = await self._dir_event_queue.get()

                # Normalize path
                path = os.path.abspath(path)

                # Get parent directory
                dir_path = os.path.dirname(path)

                async with self._lock:
                    # Check if we're watching this directory
                    if dir_path not in self.dir_watchers:
                        continue

                    # Debounce: skip if we recently processed this directory
                    last_event = self._dir_debounce.get(dir_path, 0)
                    if timestamp - last_event < self._dir_debounce_ms / 1000:
                        continue
                    self._dir_debounce[dir_path] = timestamp

                    session_ids = set(self.dir_watchers[dir_path])

                # Notify watchers (outside lock)
                if session_ids and self.on_dir_change:
                    try:
                        await self.on_dir_change(dir_path, event_type, path, is_directory, session_ids)
                    except Exception as e:
                        print(f'[FileWatcher] Error in dir change callback: {e}')

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f'[FileWatcher] Dir event processing error: {e}')


# Global file watcher instance (initialized lazily)
_file_watcher: Optional[FileWatcher] = None


def get_file_watcher() -> Optional[FileWatcher]:
    """Get the global file watcher instance."""
    return _file_watcher


async def init_file_watcher(on_change: Callable, on_dir_change: Callable = None):
    """Initialize the global file watcher."""
    global _file_watcher
    if _file_watcher is None:
        _file_watcher = FileWatcher(on_change, on_dir_change)
        await _file_watcher.start()
    return _file_watcher


async def shutdown_file_watcher():
    """Shutdown the global file watcher."""
    global _file_watcher
    if _file_watcher:
        await _file_watcher.stop()
        _file_watcher = None

"""
Yjs Document Manager - Server-side CRDT document management.

Uses pycrdt for Yjs-compatible CRDT operations. This is NOT just a relay -
we maintain the authoritative document state on the server, enabling:

- Proper sync for new joiners (they get full document state)
- Persistence to disk (documents survive server restarts)
- Server-side document access (for AI, file watching, etc.)
- Conflict-free merging of concurrent edits

The Y.Doc contains:
- Y.Text('content'): The markdown source of truth
- Awareness state is handled separately (ephemeral, not persisted)
"""

import asyncio
import os
from pathlib import Path
from typing import Dict, Optional, Callable, Awaitable
from dataclasses import dataclass, field
import time

try:
    from pycrdt import Doc, Text
    _HAS_PYCRDT = True
except ImportError:  # pragma: no cover - runtime guard for optional dep
    Doc = None
    Text = None
    _HAS_PYCRDT = False


def _require_pycrdt():
    if not _HAS_PYCRDT:
        raise RuntimeError(
            "pycrdt is required for collaborative editing. Install it with "
            "'uv pip install pycrdt' or 'pip install pycrdt'."
        )


@dataclass
class YjsDocument:
    """A managed Yjs document for a file."""
    doc: Doc
    file_path: str
    last_modified: float = field(default_factory=time.time)
    pending_save: bool = False

    @property
    def content(self) -> str:
        """Get the current document content."""
        return str(self.doc.get('content', type=Text))

    @content.setter
    def content(self, value: str):
        """Set the document content (replaces all)."""
        text = self.doc.get('content', type=Text)
        text.clear()
        text.insert(0, value)
        self.last_modified = time.time()


class YjsDocumentManager:
    """
    Manages Yjs documents for real-time collaboration.

    This is the server-side authority for document state. Key responsibilities:

    1. **Document lifecycle**: Create, load, save, close documents
    2. **Sync protocol**: Handle Yjs sync messages from clients
    3. **Persistence**: Save documents to disk, load on reconnect
    4. **External updates**: Apply changes from AI, file system, etc.

    Thread-safe via asyncio locks.
    """

    def __init__(
        self,
        storage_dir: Optional[str] = None,
        auto_save_interval: float = 5.0,
        on_document_changed: Optional[Callable[[str, bytes], Awaitable[None]]] = None,
    ):
        """
        Initialize the Yjs document manager.

        Args:
            storage_dir: Directory for persisting document state (optional)
            auto_save_interval: Seconds between auto-saves (0 to disable)
            on_document_changed: Callback when document changes (for broadcasting)
        """
        _require_pycrdt()
        # file_path -> YjsDocument
        self._documents: Dict[str, YjsDocument] = {}
        self._lock = asyncio.Lock()

        # Persistence
        self._storage_dir = Path(storage_dir) if storage_dir else None
        if self._storage_dir:
            self._storage_dir.mkdir(parents=True, exist_ok=True)

        # Auto-save
        self._auto_save_interval = auto_save_interval
        self._auto_save_task: Optional[asyncio.Task] = None

        # Callbacks
        self._on_document_changed = on_document_changed

    async def start(self):
        """Start background tasks (auto-save, etc.)."""
        if self._auto_save_interval > 0:
            self._auto_save_task = asyncio.create_task(self._auto_save_loop())

    async def stop(self):
        """Stop background tasks and save all documents."""
        if self._auto_save_task:
            self._auto_save_task.cancel()
            try:
                await self._auto_save_task
            except asyncio.CancelledError:
                pass

        # Save all pending documents
        await self._save_all_pending()

    # =========================================================================
    # Document Lifecycle
    # =========================================================================

    async def get_or_create_document(
        self,
        file_path: str,
        initial_content: Optional[str] = None,
    ) -> YjsDocument:
        """
        Get an existing document or create a new one.

        If the document doesn't exist:
        1. Try to load from persistence storage
        2. Try to load from file system
        3. Create empty document with initial_content

        Args:
            file_path: Absolute path to the file
            initial_content: Content to use if creating new document

        Returns:
            The YjsDocument instance
        """
        async with self._lock:
            if file_path in self._documents:
                return self._documents[file_path]

            # Try to load from persistence
            doc = await self._load_from_storage(file_path)

            if doc is None:
                # Create new document
                doc = Doc()
                text = doc.get('content', type=Text)

                # Try to load from file system
                content = initial_content
                if content is None and os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                    except Exception as e:
                        print(f'[YjsManager] Failed to read {file_path}: {e}')
                        content = ''

                if content:
                    text.insert(0, content)

            yjs_doc = YjsDocument(doc=doc, file_path=file_path)
            self._documents[file_path] = yjs_doc

            print(f'[YjsManager] Document loaded: {file_path} ({len(yjs_doc.content)} chars)')
            return yjs_doc

    async def close_document(self, file_path: str, save: bool = True):
        """
        Close a document and optionally save it.

        Args:
            file_path: Path to the document
            save: Whether to save before closing
        """
        async with self._lock:
            if file_path not in self._documents:
                return

            yjs_doc = self._documents[file_path]

            if save:
                await self._save_to_storage(yjs_doc)

            del self._documents[file_path]
            print(f'[YjsManager] Document closed: {file_path}')

    def has_document(self, file_path: str) -> bool:
        """Check if a document is currently loaded."""
        return file_path in self._documents

    def get_document(self, file_path: str) -> Optional[YjsDocument]:
        """Get a loaded document (returns None if not loaded)."""
        return self._documents.get(file_path)

    # =========================================================================
    # Yjs Sync Protocol
    # =========================================================================

    async def apply_update(self, file_path: str, update: bytes, broadcast: bool = False) -> bool:
        """
        Apply a Yjs update to a document.

        This is the main entry point for client updates. The update is a
        binary blob from Y.encodeStateAsUpdate() or transaction updates.

        Args:
            file_path: Path to the document
            update: Binary Yjs update
            broadcast: Whether to trigger the on_document_changed callback.
                      Set to False when caller handles broadcasting (e.g., client updates).
                      Set to True for server-initiated changes (e.g., file watcher).

        Returns:
            True if applied successfully, False otherwise
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return False

        try:
            yjs_doc.doc.apply_update(update)
            yjs_doc.last_modified = time.time()
            yjs_doc.pending_save = True

            # Only notify listeners if requested (avoids double-broadcast for client updates)
            if broadcast and self._on_document_changed:
                await self._on_document_changed(file_path, update)

            return True
        except Exception as e:
            print(f'[YjsManager] Failed to apply update to {file_path}: {e}')
            return False

    def get_state_vector(self, file_path: str) -> Optional[bytes]:
        """
        Get the state vector for a document.

        The state vector represents what updates the server has seen.
        Clients use this to determine what updates to send.

        Args:
            file_path: Path to the document

        Returns:
            Binary state vector, or None if document not found
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return None

        return bytes(yjs_doc.doc.get_state())

    def get_full_state(self, file_path: str) -> Optional[bytes]:
        """
        Get the full document state as a Yjs update.

        This is used to sync new clients - they apply this update
        to get the complete document.

        Args:
            file_path: Path to the document

        Returns:
            Binary update containing full document state
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return None

        return bytes(yjs_doc.doc.get_update())

    def get_diff(self, file_path: str, state_vector: bytes) -> Optional[bytes]:
        """
        Get updates that the client is missing.

        Given the client's state vector, return an update with all
        changes the client doesn't have.

        Args:
            file_path: Path to the document
            state_vector: Client's state vector

        Returns:
            Binary update with missing changes
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return None

        try:
            return bytes(yjs_doc.doc.get_update(state_vector))
        except Exception as e:
            print(f'[YjsManager] Failed to get diff for {file_path}: {e}')
            # Fall back to full state
            return bytes(yjs_doc.doc.get_update())

    # =========================================================================
    # External Updates (AI, File System, etc.)
    # =========================================================================

    async def set_content(
        self,
        file_path: str,
        content: str,
        origin: str = 'external',
    ) -> Optional[bytes]:
        """
        Set document content from an external source.

        This replaces the entire document content. Use for:
        - AI rewrites
        - File system changes
        - Initial sync

        Args:
            file_path: Path to the document
            content: New content
            origin: Origin identifier for the transaction

        Returns:
            The update that was applied (for broadcasting), or None
        """
        yjs_doc = await self.get_or_create_document(file_path, content)

        # Skip if content is unchanged (prevents echo when saving to file)
        current_content = yjs_doc.content
        if current_content == content:
            print(f'[YjsManager] Content unchanged for {file_path}, skipping update')
            return None

        # Get state before change
        old_state = bytes(yjs_doc.doc.get_state())

        # Apply change
        text = yjs_doc.doc.get('content', type=Text)
        text.clear()
        text.insert(0, content)

        yjs_doc.last_modified = time.time()
        yjs_doc.pending_save = True

        # Get the update (diff from old state)
        update = bytes(yjs_doc.doc.get_update(old_state))

        if self._on_document_changed:
            await self._on_document_changed(file_path, update)

        print(f'[YjsManager] Content set for {file_path} from {origin}')
        return update

    def get_content(self, file_path: str) -> Optional[str]:
        """
        Get the current document content.

        Args:
            file_path: Path to the document

        Returns:
            Document content as string, or None if not loaded
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return None
        return yjs_doc.content

    # =========================================================================
    # Persistence
    # =========================================================================

    async def _save_to_storage(self, yjs_doc: YjsDocument):
        """Save a document to persistence storage."""
        if not self._storage_dir:
            return

        try:
            # Create a safe filename from the path
            safe_name = yjs_doc.file_path.replace('/', '__').replace('\\', '__')
            storage_path = self._storage_dir / f'{safe_name}.yjs'

            # Save full document state
            state = yjs_doc.doc.get_update()
            storage_path.write_bytes(bytes(state))

            yjs_doc.pending_save = False
            print(f'[YjsManager] Saved: {yjs_doc.file_path}')
        except Exception as e:
            print(f'[YjsManager] Failed to save {yjs_doc.file_path}: {e}')

    async def _load_from_storage(self, file_path: str) -> Optional[Doc]:
        """
        Load a document from persistence storage with validation.

        CRITICAL: We validate the persisted Yjs state against the actual disk file.
        If they don't match, we discard the Yjs state and return None to force
        a fresh load from disk. This prevents stale/corrupted .yjs files from
        causing empty document syncs.
        """
        if not self._storage_dir:
            return None

        try:
            safe_name = file_path.replace('/', '__').replace('\\', '__')
            storage_path = self._storage_dir / f'{safe_name}.yjs'

            if not storage_path.exists():
                return None

            state = storage_path.read_bytes()
            doc = Doc()
            doc.apply_update(state)

            # VALIDATION: Compare Yjs content with disk file
            yjs_content = str(doc.get('content', type=Text))

            if os.path.exists(file_path):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        disk_content = f.read()

                    if yjs_content != disk_content:
                        # Stale Yjs state - disk has different content
                        print(f'[YjsManager] Persisted state STALE for {file_path}')
                        print(f'[YjsManager]   Yjs: {len(yjs_content)} chars, Disk: {len(disk_content)} chars')
                        # Delete the stale .yjs file
                        try:
                            storage_path.unlink()
                            print(f'[YjsManager]   Deleted stale .yjs file')
                        except Exception:
                            pass
                        return None  # Force fresh load from disk

                except Exception as e:
                    print(f'[YjsManager] Could not validate against disk: {e}')
                    # If we can't read disk but Yjs is empty, don't trust it
                    if len(yjs_content) == 0:
                        print(f'[YjsManager] Empty Yjs state, discarding')
                        return None

            print(f'[YjsManager] Loaded from storage: {file_path} ({len(yjs_content)} chars)')
            return doc
        except Exception as e:
            print(f'[YjsManager] Failed to load {file_path} from storage: {e}')
            # Delete corrupted .yjs file
            try:
                safe_name = file_path.replace('/', '__').replace('\\', '__')
                storage_path = self._storage_dir / f'{safe_name}.yjs'
                if storage_path.exists():
                    storage_path.unlink()
                    print(f'[YjsManager] Deleted corrupted .yjs file')
            except Exception:
                pass
            return None

    async def _save_all_pending(self):
        """Save all documents with pending changes."""
        for yjs_doc in self._documents.values():
            if yjs_doc.pending_save:
                await self._save_to_storage(yjs_doc)

    async def _auto_save_loop(self):
        """Background task for auto-saving documents."""
        while True:
            try:
                await asyncio.sleep(self._auto_save_interval)
                await self._save_all_pending()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f'[YjsManager] Auto-save error: {e}')

    async def save_to_file(self, file_path: str) -> bool:
        """
        Save document content to the original file.

        This writes the Y.Text content to disk as a regular file.

        SAFETY: Refuses to write empty content to a non-empty file to prevent
        data loss from sync issues.

        Args:
            file_path: Path to the document

        Returns:
            True if saved successfully
        """
        yjs_doc = self._documents.get(file_path)
        if not yjs_doc:
            return False

        try:
            content = yjs_doc.content

            # CRITICAL SAFETY CHECK: Never write empty content to non-empty file
            # This prevents data loss if Yjs sync fails or returns empty
            if len(content) == 0:
                try:
                    # Check if file exists and has content
                    import os
                    if os.path.exists(file_path):
                        disk_size = os.path.getsize(file_path)
                        if disk_size > 0:
                            print(f'[YjsManager] BLOCKED: Refusing to write empty content to non-empty file: {file_path} (disk size: {disk_size})')
                            return False
                except Exception as check_err:
                    print(f'[YjsManager] Warning: Could not check disk file: {check_err}')
                    # If we can't check, block the empty write to be safe
                    print(f'[YjsManager] BLOCKED: Refusing to write empty content (could not verify disk): {file_path}')
                    return False

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'[YjsManager] Saved to file: {file_path} ({len(content)} chars)')
            return True
        except Exception as e:
            print(f'[YjsManager] Failed to save to file {file_path}: {e}')
            return False


# Global instance
_yjs_manager: Optional[YjsDocumentManager] = None


def get_yjs_manager() -> Optional[YjsDocumentManager]:
    """Get the global Yjs document manager."""
    return _yjs_manager


async def init_yjs_manager(
    storage_dir: Optional[str] = None,
    on_document_changed: Optional[Callable[[str, bytes], Awaitable[None]]] = None,
) -> YjsDocumentManager:
    """Initialize the global Yjs document manager."""
    global _yjs_manager

    _yjs_manager = YjsDocumentManager(
        storage_dir=storage_dir,
        on_document_changed=on_document_changed,
    )
    await _yjs_manager.start()

    print('[YjsManager] Initialized')
    return _yjs_manager


async def shutdown_yjs_manager():
    """Shutdown the global Yjs document manager."""
    global _yjs_manager

    if _yjs_manager:
        await _yjs_manager.stop()
        _yjs_manager = None
        print('[YjsManager] Shutdown complete')

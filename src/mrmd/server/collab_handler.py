"""
Real-time collaboration WebSocket handler.

Provides:
- Presence tracking (who's editing what)
- Cursor position sync
- Yjs CRDT document sync (via pycrdt)
- File locking/conflict detection
- File change notifications (via watchdog)

The Yjs sync protocol:
1. Client sends sync_step1 with their state vector
2. Server responds with sync_step2 containing missing updates
3. Server also sends sync_step1 to get client's updates
4. Client responds with sync_step2
5. After initial sync, updates are broadcast in real-time
"""

import asyncio
import base64
import json
import time
import uuid
from typing import Dict, Set, Optional, Any
from dataclasses import dataclass, field, asdict
from aiohttp import web, WSMsgType

from .history import get_history_manager
from .file_watcher import init_file_watcher, shutdown_file_watcher, get_file_watcher
from .environment import invalidate_notebook_cache
from .yjs_manager import (
    YjsDocumentManager,
    get_yjs_manager,
    init_yjs_manager,
    shutdown_yjs_manager,
)


# ==================== Data Structures ====================

@dataclass
class CursorPosition:
    """Cursor position using markdown character offsets."""
    md_offset: int = 0
    selection_start: Optional[int] = None  # mdStart
    selection_end: Optional[int] = None    # mdEnd


@dataclass
class UserSession:
    session_id: str
    user_name: str
    user_type: str  # 'human' or 'ai'
    color: str
    ws: web.WebSocketResponse
    project_root: Optional[str] = None
    current_file: Optional[str] = None
    cursor: CursorPosition = field(default_factory=CursorPosition)
    last_heartbeat: float = field(default_factory=time.time)

    def to_presence_dict(self) -> Dict[str, Any]:
        """Convert to presence info (without ws)."""
        return {
            'session_id': self.session_id,
            'user_name': self.user_name,
            'user_type': self.user_type,
            'color': self.color,
            'current_file': self.current_file,
            'cursor': asdict(self.cursor) if self.current_file else None
        }


# ==================== Collaboration Manager ====================

class CollabManager:
    """Manages real-time collaboration state."""

    # Color palette for user cursors - muted, zen palette
    COLORS = [
        '#7aa2f7',  # Soft blue
        '#9ece6a',  # Soft green
        '#bb9af7',  # Soft purple
        '#e0af68',  # Soft orange
        '#7dcfff',  # Soft cyan
        '#f7768e',  # Soft red
        '#73daca',  # Soft teal
        '#ff9e64',  # Soft peach
        '#c0caf5',  # Soft lavender
        '#a9b1d6',  # Soft gray-blue
    ]

    def __init__(self):
        # session_id -> UserSession
        self.sessions: Dict[str, UserSession] = {}
        # project_root -> set of session_ids
        self.project_sessions: Dict[str, Set[str]] = {}
        # file_path -> set of session_ids (users viewing this file)
        self.file_viewers: Dict[str, Set[str]] = {}
        # file_path -> Yjs document state (for syncing new joiners)
        self.yjs_states: Dict[str, list] = {}
        # Color assignment counter
        self._color_index = 0
        # Lock for thread safety
        self._lock = asyncio.Lock()

    def _get_next_color(self) -> str:
        """Get next color from palette."""
        color = self.COLORS[self._color_index % len(self.COLORS)]
        self._color_index += 1
        return color

    async def add_session(
        self,
        ws: web.WebSocketResponse,
        user_name: str,
        user_type: str = 'human',
        project_root: Optional[str] = None
    ) -> UserSession:
        """Add a new collaboration session."""
        async with self._lock:
            session_id = str(uuid.uuid4())[:8]
            color = self._get_next_color()

            session = UserSession(
                session_id=session_id,
                user_name=user_name,
                user_type=user_type,
                color=color,
                ws=ws,
                project_root=project_root
            )

            self.sessions[session_id] = session

            if project_root:
                if project_root not in self.project_sessions:
                    self.project_sessions[project_root] = set()
                self.project_sessions[project_root].add(session_id)

            return session

    async def remove_session(self, session_id: str):
        """Remove a collaboration session."""
        async with self._lock:
            session = self.sessions.get(session_id)
            if not session:
                return

            # Remove from project
            if session.project_root and session.project_root in self.project_sessions:
                self.project_sessions[session.project_root].discard(session_id)
                if not self.project_sessions[session.project_root]:
                    del self.project_sessions[session.project_root]

            # Remove from file viewers
            if session.current_file and session.current_file in self.file_viewers:
                self.file_viewers[session.current_file].discard(session_id)
                if not self.file_viewers[session.current_file]:
                    del self.file_viewers[session.current_file]
                    # Clear Yjs state when all users leave
                    self.clear_yjs_state(session.current_file)

            del self.sessions[session_id]

    async def join_file(self, session_id: str, file_path: str):
        """User started editing a file."""
        async with self._lock:
            session = self.sessions.get(session_id)
            if not session:
                return

            # Leave previous file
            if session.current_file and session.current_file in self.file_viewers:
                self.file_viewers[session.current_file].discard(session_id)
                if not self.file_viewers[session.current_file]:
                    del self.file_viewers[session.current_file]
                    # Clear Yjs state when all users leave (prevents stale state merging)
                    self.clear_yjs_state(session.current_file)

            # Join new file
            session.current_file = file_path
            if file_path:
                if file_path not in self.file_viewers:
                    self.file_viewers[file_path] = set()
                self.file_viewers[file_path].add(session_id)

    async def update_cursor(
        self,
        session_id: str,
        md_offset: int,
        selection: Optional[Dict] = None
    ):
        """Update user's cursor position (markdown offset)."""
        session = self.sessions.get(session_id)
        if not session:
            return

        session.cursor.md_offset = md_offset
        if selection:
            session.cursor.selection_start = selection.get('mdStart')
            session.cursor.selection_end = selection.get('mdEnd')
        else:
            session.cursor.selection_start = None
            session.cursor.selection_end = None

        session.last_heartbeat = time.time()

    async def heartbeat(self, session_id: str):
        """Update session heartbeat."""
        session = self.sessions.get(session_id)
        if session:
            session.last_heartbeat = time.time()

    def get_file_presence(self, file_path: str) -> list:
        """Get all users viewing a file."""
        session_ids = self.file_viewers.get(file_path, set())
        return [
            self.sessions[sid].to_presence_dict()
            for sid in session_ids
            if sid in self.sessions
        ]

    def get_project_presence(self, project_root: str) -> list:
        """Get all users in a project."""
        session_ids = self.project_sessions.get(project_root, set())
        return [
            self.sessions[sid].to_presence_dict()
            for sid in session_ids
            if sid in self.sessions
        ]

    async def broadcast_to_file(
        self,
        file_path: str,
        message: Dict,
        exclude_session: Optional[str] = None
    ):
        """Broadcast message to all users viewing a file."""
        session_ids = self.file_viewers.get(file_path, set())
        msg_str = json.dumps(message)

        for sid in session_ids:
            if sid == exclude_session:
                continue
            session = self.sessions.get(sid)
            if session and session.ws and not session.ws.closed:
                try:
                    await session.ws.send_str(msg_str)
                except Exception as e:
                    print(f'[Collab] Failed to send to {sid}: {e}')

    async def broadcast_to_project(
        self,
        project_root: str,
        message: Dict,
        exclude_session: Optional[str] = None
    ):
        """Broadcast message to all users in a project."""
        session_ids = self.project_sessions.get(project_root, set())
        msg_str = json.dumps(message)

        for sid in session_ids:
            if sid == exclude_session:
                continue
            session = self.sessions.get(sid)
            if session and session.ws and not session.ws.closed:
                try:
                    await session.ws.send_str(msg_str)
                except Exception as e:
                    print(f'[Collab] Failed to send to {sid}: {e}')

    def store_yjs_state(self, file_path: str, state: list):
        """Store Yjs document state for a file (for syncing new joiners)."""
        self.yjs_states[file_path] = state

    def get_yjs_state(self, file_path: str) -> Optional[list]:
        """Get stored Yjs document state for a file."""
        return self.yjs_states.get(file_path)

    def clear_yjs_state(self, file_path: str):
        """Clear Yjs state for a file (e.g., when file is closed by all users)."""
        if file_path in self.yjs_states:
            del self.yjs_states[file_path]

    async def notify_file_changed(
        self,
        file_path: str,
        event_type: str,
        mtime: Optional[float],
        session_ids: Set[str]
    ):
        """Notify sessions that a file changed on disk (external change)."""
        message = {
            'type': 'file_changed',
            'file_path': file_path,
            'event_type': event_type,  # 'modified', 'created', 'deleted'
            'mtime': mtime
        }
        msg_str = json.dumps(message)

        for sid in session_ids:
            session = self.sessions.get(sid)
            if session and session.ws and not session.ws.closed:
                try:
                    await session.ws.send_str(msg_str)
                except Exception as e:
                    print(f'[Collab] Failed to send file_changed to {sid}: {e}')

    async def notify_directory_changed(
        self,
        dir_path: str,
        event_type: str,
        changed_path: str,
        is_dir: bool,
        session_ids: Set[str]
    ):
        """Notify sessions that a directory's contents changed."""
        message = {
            'type': 'directory_changed',
            'dir_path': dir_path,
            'event_type': event_type,  # 'created', 'deleted'
            'changed_path': changed_path,
            'is_dir': is_dir
        }
        msg_str = json.dumps(message)

        for sid in session_ids:
            session = self.sessions.get(sid)
            if session and session.ws and not session.ws.closed:
                try:
                    await session.ws.send_str(msg_str)
                except Exception as e:
                    print(f'[Collab] Failed to send directory_changed to {sid}: {e}')


# Global collab manager instance
_collab_manager = CollabManager()


# ==================== File Watcher Integration ====================

async def _on_file_change(path: str, event_type: str, mtime: Optional[float], session_ids: Set[str]):
    """Callback from file watcher when a file changes.

    For external file modifications, we update the Yjs document so all clients
    get the changes via the normal Yjs sync protocol. This is cleaner than
    sending a separate 'file_changed' message.
    """
    manager = get_collab_manager()
    yjs = get_yjs_manager()

    if event_type == 'modified' and yjs and yjs.has_document(path):
        # File was modified externally - update Yjs document
        try:
            import os
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    new_content = f.read()

                # Update Yjs document - this will broadcast to all clients
                await yjs.set_content(path, new_content, 'file_watcher')
                print(f'[Collab] External file change applied to Yjs: {path}')
                return  # Yjs handles the broadcast
        except Exception as e:
            print(f'[Collab] Failed to apply external file change to Yjs: {e}')

    # Fall back to notification for non-Yjs cases or errors
    await manager.notify_file_changed(path, event_type, mtime, session_ids)


async def _on_dir_change(dir_path: str, event_type: str, changed_path: str, is_dir: bool, session_ids: Set[str]):
    """Callback from file watcher when directory contents change."""
    # Invalidate notebook cache when .md files are created/deleted
    if changed_path.endswith('.md') or is_dir:
        invalidate_notebook_cache(dir_path)

    manager = get_collab_manager()
    await manager.notify_directory_changed(dir_path, event_type, changed_path, is_dir, session_ids)


async def init_collab_file_watcher():
    """Initialize the file watcher for collaboration."""
    await init_file_watcher(_on_file_change, _on_dir_change)
    print('[Collab] File watcher initialized')


async def shutdown_collab_file_watcher():
    """Shutdown the file watcher."""
    await shutdown_file_watcher()
    print('[Collab] File watcher shutdown')


# ==================== Yjs Manager Integration ====================

async def _on_yjs_document_changed(file_path: str, update: bytes):
    """Callback when a Yjs document changes - broadcast to clients."""
    manager = get_collab_manager()
    # Encode update as base64 for JSON transport
    update_b64 = base64.b64encode(update).decode('ascii')
    await manager.broadcast_to_file(file_path, {
        'type': 'yjs_update',
        'update': update_b64,
    })


async def init_yjs():
    """Initialize the Yjs document manager."""
    # Use a storage directory for persistence
    import os
    storage_dir = os.path.expanduser('~/.mrmd/yjs-state')
    await init_yjs_manager(
        storage_dir=storage_dir,
        on_document_changed=_on_yjs_document_changed,
    )


async def shutdown_yjs():
    """Shutdown the Yjs document manager."""
    await shutdown_yjs_manager()


def get_collab_manager() -> CollabManager:
    return _collab_manager


# ==================== WebSocket Handler ====================

async def handle_collab_websocket(request: web.Request) -> web.WebSocketResponse:
    """WebSocket handler for real-time collaboration."""
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    # Get connection parameters
    project_root = request.query.get('project')
    user_name = request.query.get('user', 'Anonymous')
    user_type = request.query.get('type', 'human')

    manager = get_collab_manager()
    session = await manager.add_session(ws, user_name, user_type, project_root)

    print(f'[Collab] {user_name} ({user_type}) joined project {project_root}')

    # Send session info to client
    await ws.send_json({
        'type': 'connected',
        'session_id': session.session_id,
        'color': session.color
    })

    # Broadcast presence to others in project
    if project_root:
        await manager.broadcast_to_project(project_root, {
            'type': 'user_joined',
            'user': session.to_presence_dict()
        }, exclude_session=session.session_id)

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    await handle_message(manager, session, data)
                except json.JSONDecodeError:
                    print(f'[Collab] Invalid JSON from {session.session_id}')
                except Exception as e:
                    print(f'[Collab] Error handling message: {e}')

            elif msg.type == WSMsgType.ERROR:
                print(f'[Collab] WebSocket error: {ws.exception()}')
                break

    except Exception as e:
        print(f'[Collab] Connection error: {e}')

    finally:
        # Clean up
        print(f'[Collab] {user_name} left')

        # Stop watching files for this session
        file_watcher = get_file_watcher()
        if file_watcher:
            await file_watcher.unwatch_all(session.session_id)

        # Notify others
        if project_root:
            await manager.broadcast_to_project(project_root, {
                'type': 'user_left',
                'session_id': session.session_id
            }, exclude_session=session.session_id)

        await manager.remove_session(session.session_id)

    return ws


async def handle_message(manager: CollabManager, session: UserSession, data: Dict):
    """Handle incoming WebSocket message."""
    msg_type = data.get('type')
    print(f'[Collab] Message from {session.user_name} ({session.session_id}): {msg_type}')

    if msg_type == 'join_file':
        # User opened a file
        file_path = data.get('file_path')
        print(f'[Collab] {session.session_id} joining file: {file_path}')
        await manager.join_file(session.session_id, file_path)

        # Send current presence for this file
        presence = manager.get_file_presence(file_path)
        print(f'[Collab] Presence for {file_path}: {len(presence)} users - {[p["session_id"] for p in presence]}')
        await session.ws.send_json({
            'type': 'presence',
            'file_path': file_path,
            'users': presence
        })

        # Notify others
        if file_path:
            await manager.broadcast_to_file(file_path, {
                'type': 'user_joined_file',
                'file_path': file_path,
                'user': session.to_presence_dict()
            }, exclude_session=session.session_id)

    elif msg_type == 'leave_file':
        # User closed a file
        old_file = session.current_file
        await manager.join_file(session.session_id, None)

        if old_file:
            await manager.broadcast_to_file(old_file, {
                'type': 'user_left_file',
                'file_path': old_file,
                'session_id': session.session_id
            })

    elif msg_type == 'cursor':
        # Cursor position update (using markdown offset)
        md_offset = data.get('md_offset', 0)
        selection = data.get('selection')  # {mdStart, mdEnd} or None
        await manager.update_cursor(session.session_id, md_offset, selection)

        # Broadcast to others viewing same file
        if session.current_file:
            viewers = manager.file_viewers.get(session.current_file, set())
            print(f'[Collab] Cursor from {session.session_id} at offset {md_offset}, broadcasting to {len(viewers)-1} others')
            await manager.broadcast_to_file(session.current_file, {
                'type': 'cursor',
                'session_id': session.session_id,
                'user_name': session.user_name,
                'color': session.color,
                'md_offset': session.cursor.md_offset,
                'selection': {
                    'mdStart': session.cursor.selection_start,
                    'mdEnd': session.cursor.selection_end
                } if session.cursor.selection_start is not None else None
            }, exclude_session=session.session_id)

    elif msg_type == 'operation':
        # Content operation (edit)
        file_path = data.get('file_path')
        op_type = data.get('op_type')  # 'insert', 'delete', 'replace'
        op_data = data.get('data')
        version_id = data.get('version_id')

        if file_path and op_data:
            # Broadcast operation to others
            await manager.broadcast_to_file(file_path, {
                'type': 'operation',
                'session_id': session.session_id,
                'user_name': session.user_name,
                'file_path': file_path,
                'op_type': op_type,
                'data': op_data,
                'version_id': version_id,
                'timestamp': time.time()
            }, exclude_session=session.session_id)

    elif msg_type == 'file_saved':
        # File was saved - notify others
        file_path = data.get('file_path')
        version_id = data.get('version_id')
        content = data.get('content')  # Optional: for full sync

        if file_path:
            await manager.broadcast_to_file(file_path, {
                'type': 'file_saved',
                'session_id': session.session_id,
                'user_name': session.user_name,
                'file_path': file_path,
                'version_id': version_id,
                'has_content': content is not None,
                'content': content,  # Include content for sync
                'timestamp': time.time()
            }, exclude_session=session.session_id)

    elif msg_type == 'heartbeat':
        await manager.heartbeat(session.session_id)
        await session.ws.send_json({'type': 'heartbeat_ack'})

    elif msg_type == 'get_presence':
        # Get current presence for file or project
        file_path = data.get('file_path')
        if file_path:
            presence = manager.get_file_presence(file_path)
            await session.ws.send_json({
                'type': 'presence',
                'file_path': file_path,
                'users': presence
            })
        elif session.project_root:
            presence = manager.get_project_presence(session.project_root)
            await session.ws.send_json({
                'type': 'presence',
                'project': session.project_root,
                'users': presence
            })

    elif msg_type == 'yjs_sync':
        # Yjs CRDT sync using pycrdt on server
        subtype = data.get('subtype')
        payload = data.get('payload', {})
        file_path = session.current_file

        if not file_path:
            return

        yjs = get_yjs_manager()
        if not yjs:
            print('[Collab] YjsManager not initialized')
            return

        if subtype == 'sync_step1':
            # Client is requesting sync - send them our state
            # payload contains client's state vector (base64)
            client_state_b64 = payload.get('state_vector', '')

            # Get or create document
            await yjs.get_or_create_document(file_path)

            if client_state_b64:
                # Client has state - send diff
                client_state = base64.b64decode(client_state_b64)
                diff = yjs.get_diff(file_path, client_state)
                if diff:
                    await session.ws.send_json({
                        'type': 'yjs_sync',
                        'subtype': 'sync_step2',
                        'payload': {
                            'update': base64.b64encode(diff).decode('ascii')
                        }
                    })
            else:
                # Client has no state - send full document
                full_state = yjs.get_full_state(file_path)
                if full_state:
                    await session.ws.send_json({
                        'type': 'yjs_sync',
                        'subtype': 'sync_step2',
                        'payload': {
                            'update': base64.b64encode(full_state).decode('ascii')
                        }
                    })

            # Also request client's updates (server's sync_step1)
            server_state = yjs.get_state_vector(file_path)
            if server_state:
                await session.ws.send_json({
                    'type': 'yjs_sync',
                    'subtype': 'sync_step1',
                    'payload': {
                        'state_vector': base64.b64encode(server_state).decode('ascii')
                    }
                })

        elif subtype == 'sync_step2':
            # Client is sending us updates (response to our sync_step1)
            update_b64 = payload.get('update', '')
            if update_b64:
                update = base64.b64decode(update_b64)
                await yjs.apply_update(file_path, update)
                # Broadcast to other clients (handled by _on_yjs_document_changed callback)

        elif subtype == 'update':
            # Real-time update from client
            update_b64 = payload.get('update', '')
            if update_b64:
                update = base64.b64decode(update_b64)
                success = await yjs.apply_update(file_path, update)
                if success:
                    # Broadcast to others (NOT the sender)
                    await manager.broadcast_to_file(file_path, {
                        'type': 'yjs_update',
                        'update': update_b64,
                        'session_id': session.session_id
                    }, exclude_session=session.session_id)

        elif subtype == 'awareness':
            # Awareness updates (cursors, presence) - just broadcast
            await manager.broadcast_to_file(file_path, {
                'type': 'yjs_sync',
                'subtype': 'awareness',
                'payload': payload,
                'session_id': session.session_id
            }, exclude_session=session.session_id)

    elif msg_type == 'simple_sync':
        # Simple version-based sync
        subtype = data.get('subtype')
        payload = data.get('payload', {})
        target_session = data.get('target_session')  # Optional: send only to this session

        if session.current_file:
            message = {
                'type': 'simple_sync',
                'subtype': subtype,
                'payload': payload,
                'session_id': session.session_id
            }

            if target_session:
                # Unicast to specific session
                target = manager.sessions.get(target_session)
                if target and target.ws:
                    await target.ws.send_json(message)
            else:
                # Broadcast to all file viewers except sender
                await manager.broadcast_to_file(
                    session.current_file,
                    message,
                    exclude_session=session.session_id
                )

    elif msg_type == 'watch_file':
        # Start watching a file for external changes (e.g., AI edits)
        file_path = data.get('file_path')
        if file_path:
            file_watcher = get_file_watcher()
            if file_watcher:
                mtime = await file_watcher.watch_file(file_path, session.session_id)
                # Send confirmation with current mtime
                await session.ws.send_json({
                    'type': 'watch_file_ack',
                    'file_path': file_path,
                    'mtime': mtime
                })
                print(f'[Collab] {session.session_id} watching file: {file_path}')
            else:
                # File watcher not initialized yet
                await session.ws.send_json({
                    'type': 'watch_file_ack',
                    'file_path': file_path,
                    'mtime': None,
                    'error': 'file_watcher_not_ready'
                })

    elif msg_type == 'unwatch_file':
        # Stop watching a file
        file_path = data.get('file_path')
        if file_path:
            file_watcher = get_file_watcher()
            if file_watcher:
                await file_watcher.unwatch_file(file_path, session.session_id)
                print(f'[Collab] {session.session_id} stopped watching: {file_path}')

    elif msg_type == 'watch_directory':
        # Start watching a directory for content changes (files created/deleted)
        dir_path = data.get('dir_path')
        if dir_path:
            file_watcher = get_file_watcher()
            if file_watcher:
                success = await file_watcher.watch_directory(dir_path, session.session_id)
                await session.ws.send_json({
                    'type': 'watch_directory_ack',
                    'dir_path': dir_path,
                    'success': success
                })
                if success:
                    print(f'[Collab] {session.session_id} watching directory: {dir_path}')
            else:
                await session.ws.send_json({
                    'type': 'watch_directory_ack',
                    'dir_path': dir_path,
                    'success': False,
                    'error': 'file_watcher_not_ready'
                })

    elif msg_type == 'unwatch_directory':
        # Stop watching a directory
        dir_path = data.get('dir_path')
        if dir_path:
            file_watcher = get_file_watcher()
            if file_watcher:
                await file_watcher.unwatch_directory(dir_path, session.session_id)
                print(f'[Collab] {session.session_id} stopped watching directory: {dir_path}')


async def init_collaboration():
    """Initialize all collaboration subsystems."""
    await init_yjs()
    await init_collab_file_watcher()
    print('[Collab] All subsystems initialized')


async def shutdown_collaboration():
    """Shutdown all collaboration subsystems."""
    await shutdown_collab_file_watcher()
    await shutdown_yjs()
    print('[Collab] All subsystems shutdown')


def setup_collab_routes(app: web.Application):
    """Setup collaboration WebSocket routes."""
    app.router.add_get('/api/collab', handle_collab_websocket)

    # Register startup/shutdown handlers
    app.on_startup.append(lambda _: init_collaboration())
    app.on_cleanup.append(lambda _: shutdown_collaboration())

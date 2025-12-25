"""
PTY WebSocket handler for terminal blocks.

Provides a WebSocket endpoint that spawns a PTY (pseudo-terminal) and
connects it to the client for full terminal emulation.

Enhanced with:
- Terminal metadata tracking (name, cwd, venv, file associations)
- List/create/rename/kill terminal endpoints
- Persistent sessions across client reconnects
"""

import asyncio
import json
import os
import pty
import signal
import struct
import fcntl
import termios
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any

from aiohttp import web, WSMsgType


@dataclass
class TerminalMeta:
    """Metadata for a terminal session."""
    session_id: str
    name: str  # Display name
    cwd: str
    venv: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    last_activity: datetime = field(default_factory=datetime.now)
    file_path: Optional[str] = None  # Associated file (for notebook terminals)
    command: Optional[str] = None  # Specific command to run (e.g., "claude")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "name": self.name,
            "cwd": self.cwd,
            "venv": self.venv,
            "created_at": self.created_at.isoformat(),
            "last_activity": self.last_activity.isoformat(),
            "file_path": self.file_path,
            "command": self.command,
        }


class PtySession:
    """Manages a single PTY session with multiple client support."""

    # Size of output buffer to keep for reconnects (bytes)
    # Increased to 64KB for better history replay with TUI apps
    OUTPUT_BUFFER_SIZE = 65536

    def __init__(self, session_id: str):
        # Multiple WebSocket connections can view the same terminal
        self.clients: List[web.WebSocketResponse] = []
        self.session_id = session_id
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.pid: Optional[int] = None
        self.running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Buffer to store recent output for replay on reconnect
        self._output_buffer = bytearray()
        # Lock for thread-safe client list modifications
        self._clients_lock = asyncio.Lock()

    async def start(self, shell: str = None, cwd: str = None, venv: str = None, command: str = None):
        """Start the PTY session.

        Args:
            shell: Shell to use (default: $SHELL or /bin/bash)
            cwd: Working directory (default: os.getcwd())
            venv: Path to venv's python (e.g., /path/.venv/bin/python)
                  Will activate the venv in the shell
            command: Specific command to run instead of shell (e.g., "claude")
        """
        if shell is None:
            shell = os.environ.get('SHELL', '/bin/bash')

        if cwd is None:
            cwd = os.getcwd()

        self._loop = asyncio.get_event_loop()

        # Create PTY
        self.master_fd, self.slave_fd = pty.openpty()

        # Fork process
        self.pid = os.fork()

        if self.pid == 0:
            # Child process
            os.close(self.master_fd)

            # Create new session
            os.setsid()

            # Set controlling terminal
            fcntl.ioctl(self.slave_fd, termios.TIOCSCTTY, 0)

            # Redirect stdio
            os.dup2(self.slave_fd, 0)
            os.dup2(self.slave_fd, 1)
            os.dup2(self.slave_fd, 2)

            if self.slave_fd > 2:
                os.close(self.slave_fd)

            # Change directory
            try:
                os.chdir(cwd)
            except OSError:
                pass

            # Set environment
            env = os.environ.copy()
            env['TERM'] = 'xterm-256color'

            # Activate venv if provided
            if venv:
                # venv is path to python like /path/.venv/bin/python
                # Extract the venv root (remove /bin/python)
                venv_bin = os.path.dirname(venv)  # /path/.venv/bin
                venv_root = os.path.dirname(venv_bin)  # /path/.venv

                if os.path.isdir(venv_bin):
                    # Set VIRTUAL_ENV
                    env['VIRTUAL_ENV'] = venv_root
                    # Prepend venv bin to PATH
                    env['PATH'] = venv_bin + ':' + env.get('PATH', '')
                    # Unset PYTHONHOME if set
                    env.pop('PYTHONHOME', None)

            # Execute command or shell
            if command:
                # Run specific command (e.g., "claude")
                # Use -ic for interactive mode so the command stays open
                os.execvpe(shell, [shell, '-ic', command], env)
            else:
                # Execute interactive shell
                os.execvpe(shell, [shell], env)
        else:
            # Parent process
            os.close(self.slave_fd)
            self.slave_fd = None
            self.running = True

            # Set non-blocking mode
            flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Use asyncio to watch the file descriptor
            self._loop.add_reader(self.master_fd, self._on_pty_read)

    def _on_pty_read(self):
        """Called when PTY has data to read."""
        if not self.running or self.master_fd is None:
            return

        try:
            data = os.read(self.master_fd, 65536)
            if data:
                # Store in output buffer for reconnect replay
                self._output_buffer.extend(data)
                # Keep buffer at max size
                if len(self._output_buffer) > self.OUTPUT_BUFFER_SIZE:
                    self._output_buffer = self._output_buffer[-self.OUTPUT_BUFFER_SIZE:]
                # Schedule sending to websocket
                asyncio.create_task(self._send_to_ws(data))
            else:
                # EOF - process exited
                self._cleanup()
        except BlockingIOError:
            # No data available yet
            pass
        except OSError as e:
            if e.errno == 5:  # Input/output error - PTY closed
                self._cleanup()
            else:
                print(f"[PTY] Read error: {e}")
                self._cleanup()

    async def _send_to_ws(self, data: bytes):
        """Send data to all connected WebSocket clients."""
        if not self.clients:
            return

        text = data.decode('utf-8', errors='replace')
        disconnected = []

        async with self._clients_lock:
            for ws in self.clients:
                try:
                    if not ws.closed:
                        await ws.send_str(text)
                except Exception as e:
                    print(f"[PTY] WebSocket send error: {e}")
                    disconnected.append(ws)

            # Remove disconnected clients
            for ws in disconnected:
                if ws in self.clients:
                    self.clients.remove(ws)

    async def replay_buffer(self, ws: web.WebSocketResponse):
        """Replay the output buffer to a specific client."""
        if self._output_buffer:
            try:
                await ws.send_str(self._output_buffer.decode('utf-8', errors='replace'))
            except Exception as e:
                print(f"[PTY] Buffer replay error: {e}")

    async def add_client(self, ws: web.WebSocketResponse):
        """Add a client to this terminal session."""
        async with self._clients_lock:
            if ws not in self.clients:
                self.clients.append(ws)
                print(f"[PTY] Client added to {self.session_id}, total clients: {len(self.clients)}")

    async def remove_client(self, ws: web.WebSocketResponse):
        """Remove a client from this terminal session."""
        async with self._clients_lock:
            if ws in self.clients:
                self.clients.remove(ws)
                print(f"[PTY] Client removed from {self.session_id}, remaining clients: {len(self.clients)}")

    def _cleanup(self):
        """Clean up resources."""
        self.running = False
        if self._loop and self.master_fd is not None:
            try:
                self._loop.remove_reader(self.master_fd)
            except:
                pass

    def write(self, data: str):
        """Write data to PTY."""
        if self.master_fd is not None and self.running:
            try:
                os.write(self.master_fd, data.encode('utf-8'))
            except OSError as e:
                print(f"[PTY] Write error: {e}")

    def resize(self, cols: int, rows: int):
        """Resize the PTY."""
        if self.master_fd is not None:
            try:
                winsize = struct.pack('HHHH', rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError as e:
                print(f"[PTY] Resize error: {e}")

    def stop(self):
        """Stop the PTY session."""
        self._cleanup()

        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            # Schedule force kill
            if self._loop:
                self._loop.call_later(0.5, self._force_kill)

        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

    def _force_kill(self):
        """Force kill the process if still running."""
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(self.pid, os.WNOHANG)
            except:
                pass


# ==================== Terminal Registry ====================

# Store active PTY sessions by session_id (persistent across reconnects)
_pty_sessions: Dict[str, PtySession] = {}

# Store terminal metadata
_terminal_meta: Dict[str, TerminalMeta] = {}

def _generate_terminal_name() -> str:
    """Generate a unique terminal name based on existing terminals."""
    existing_names = {meta.name for meta in _terminal_meta.values()}

    # First terminal is "main"
    if "main" not in existing_names:
        return "main"

    # Find next available number
    i = 2
    while f"term-{i}" in existing_names:
        i += 1
    return f"term-{i}"


def get_terminal_list() -> List[TerminalMeta]:
    """Get list of all terminal sessions with metadata."""
    # Clean up stale metadata (no matching session or session not running)
    stale_ids = []
    for session_id in _terminal_meta:
        session = _pty_sessions.get(session_id)
        if not session or not session.running:
            stale_ids.append(session_id)

    for session_id in stale_ids:
        del _terminal_meta[session_id]
        if session_id in _pty_sessions:
            del _pty_sessions[session_id]

    return list(_terminal_meta.values())


def get_terminal_meta(session_id: str) -> Optional[TerminalMeta]:
    """Get metadata for a specific terminal."""
    return _terminal_meta.get(session_id)


def update_terminal_activity(session_id: str):
    """Update last activity timestamp for a terminal."""
    meta = _terminal_meta.get(session_id)
    if meta:
        meta.last_activity = datetime.now()


def rename_terminal(session_id: str, new_name: str) -> bool:
    """Rename a terminal session."""
    meta = _terminal_meta.get(session_id)
    if meta:
        meta.name = new_name
        return True
    return False


# ==================== WebSocket Handler ====================

async def handle_pty_websocket(request: web.Request) -> web.WebSocketResponse:
    """WebSocket handler for PTY connections.

    Supports multiple clients viewing the same terminal session.
    """
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Get parameters from query
    session_id = request.query.get('session_id', 'default')  # Unique session identifier
    cwd = request.query.get('cwd')  # Project root directory
    venv = request.query.get('venv')  # Path to venv python
    name = request.query.get('name')  # Display name (optional)
    file_path = request.query.get('file_path')  # Associated file (optional)

    print(f'[PTY] WebSocket connection for session {session_id}, cwd={cwd}, venv={venv}')

    # Check if we have an existing session to connect to
    session = _pty_sessions.get(session_id)
    is_new_session = False

    if session and session.running:
        # Connect to existing session (could be reconnect or additional client)
        print(f'[PTY] Joining existing session {session_id}')
        await session.add_client(ws)

        # Re-add the reader if needed (in case all clients had disconnected)
        if session.master_fd is not None and session._loop:
            try:
                # Try to add reader - will fail if already added, which is fine
                session._loop.add_reader(session.master_fd, session._on_pty_read)
            except:
                pass

        # Replay buffered output so client sees previous state
        await session.replay_buffer(ws)
        # Update activity
        update_terminal_activity(session_id)
    else:
        # Create new PTY session
        is_new_session = True
        session = PtySession(session_id)
        await session.add_client(ws)
        _pty_sessions[session_id] = session

        # Get or create metadata
        meta = _terminal_meta.get(session_id)
        if not meta:
            effective_cwd = cwd or os.getcwd()
            meta = TerminalMeta(
                session_id=session_id,
                name=name or _generate_terminal_name(),
                cwd=effective_cwd,
                venv=venv,
                file_path=file_path,
            )
            _terminal_meta[session_id] = meta

        try:
            # Start PTY with project cwd, venv, and optional command
            await session.start(cwd=cwd, venv=venv, command=meta.command)
        except Exception as e:
            print(f'[PTY] Failed to start session: {e}')
            await session.remove_client(ws)
            del _pty_sessions[session_id]
            if session_id in _terminal_meta:
                del _terminal_meta[session_id]
            return ws

    try:
        # Handle incoming messages from this client
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    msg_type = data.get('type')

                    if msg_type == 'input':
                        # User input -> PTY (any client can send input)
                        session.write(data.get('data', ''))
                        update_terminal_activity(session_id)
                    elif msg_type == 'resize':
                        # Resize terminal (last resize wins)
                        cols = data.get('cols', 80)
                        rows = data.get('rows', 24)
                        session.resize(cols, rows)
                except json.JSONDecodeError:
                    # Raw text input
                    session.write(msg.data)
                    update_terminal_activity(session_id)

            elif msg.type == WSMsgType.ERROR:
                print(f'[PTY] WebSocket error: {ws.exception()}')
                break

    except Exception as e:
        print(f'[PTY] Error: {e}')
    finally:
        # Remove this client from the session
        await session.remove_client(ws)

        # If no clients left, we keep the PTY running but remove the reader
        # to prevent errors. The reader will be re-added when a client connects.
        if not session.clients and session._loop and session.master_fd is not None:
            try:
                session._loop.remove_reader(session.master_fd)
            except:
                pass

        print(f'[PTY] WebSocket disconnected for session {session_id} (PTY still running, {len(session.clients)} clients remaining)')

    return ws


# ==================== HTTP Handlers ====================

async def handle_terminals_list(request: web.Request) -> web.Response:
    """List all terminal sessions."""
    terminals = get_terminal_list()
    return web.json_response({
        "terminals": [t.to_dict() for t in terminals]
    })


async def handle_terminals_create(request: web.Request) -> web.Response:
    """Create a new terminal session (pre-allocate metadata).

    This creates the metadata entry before the WebSocket connection.
    The client should then connect to /api/pty?session_id=<returned_id>

    Body: { name?, cwd?, venv?, file_path?, command? }
    Response: { session_id, name, ... }
    """
    try:
        data = await request.json()
    except:
        data = {}

    import uuid
    session_id = str(uuid.uuid4())[:8]

    meta = TerminalMeta(
        session_id=session_id,
        name=data.get('name') or _generate_terminal_name(),
        cwd=data.get('cwd') or os.getcwd(),
        venv=data.get('venv'),
        file_path=data.get('file_path'),
        command=data.get('command'),  # e.g., "claude" to run Claude Code
    )
    _terminal_meta[session_id] = meta

    return web.json_response(meta.to_dict())


async def handle_terminals_rename(request: web.Request) -> web.Response:
    """Rename a terminal session.

    Body: { session_id, name }
    """
    try:
        data = await request.json()
        session_id = data.get('session_id')
        new_name = data.get('name')

        if not session_id or not new_name:
            return web.json_response(
                {"error": "session_id and name required"},
                status=400
            )

        if rename_terminal(session_id, new_name):
            return web.json_response({"success": True})
        else:
            return web.json_response({"error": "Terminal not found"}, status=404)

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_pty_kill(request: web.Request) -> web.Response:
    """Kill a specific PTY session."""
    data = await request.json()
    session_id = data.get('session_id')

    if session_id and session_id in _pty_sessions:
        session = _pty_sessions[session_id]
        session.stop()
        del _pty_sessions[session_id]
        # Also remove metadata
        if session_id in _terminal_meta:
            del _terminal_meta[session_id]
        print(f'[PTY] Killed session {session_id}')
        return web.json_response({'status': 'ok'})

    # Check if we have metadata but no session (pre-allocated but not connected)
    if session_id and session_id in _terminal_meta:
        del _terminal_meta[session_id]
        return web.json_response({'status': 'ok'})

    return web.json_response({'status': 'not_found'}, status=404)


async def handle_terminals_kill_for_file(request: web.Request) -> web.Response:
    """Kill all terminal sessions associated with a file.

    Body: { file_path }
    """
    try:
        data = await request.json()
        file_path = data.get('file_path')

        if not file_path:
            return web.json_response({"error": "file_path required"}, status=400)

        killed = []
        for session_id, meta in list(_terminal_meta.items()):
            if meta.file_path == file_path:
                session = _pty_sessions.get(session_id)
                if session:
                    session.stop()
                    del _pty_sessions[session_id]
                del _terminal_meta[session_id]
                killed.append(session_id)
                print(f'[PTY] Killed session {session_id} (file closed: {file_path})')

        return web.json_response({"killed": killed})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


def setup_pty_routes(app: web.Application):
    """Setup PTY WebSocket routes."""
    app.router.add_get('/api/pty', handle_pty_websocket)
    app.router.add_post('/api/pty/kill', handle_pty_kill)
    # New terminal management endpoints
    app.router.add_get('/api/terminals', handle_terminals_list)
    app.router.add_post('/api/terminals', handle_terminals_create)
    app.router.add_post('/api/terminals/rename', handle_terminals_rename)
    app.router.add_post('/api/terminals/kill-for-file', handle_terminals_kill_for_file)

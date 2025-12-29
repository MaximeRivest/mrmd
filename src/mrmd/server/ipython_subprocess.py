"""
Subprocess-based IPython Session

Runs IPython in a separate process, allowing each session to use a different
Python interpreter (different venv). Communicates via JSON-RPC over stdin/stdout.
"""

import subprocess
import json
import threading
import queue
import os
import signal
import sys
from typing import Optional, Dict, Any, List, Callable
from dataclasses import dataclass, field
from pathlib import Path
import uuid


@dataclass
class ExecutionResult:
    """Result from executing code."""
    stdout: str = ""
    stderr: str = ""
    result: Optional[str] = None
    error: Optional[Dict[str, Any]] = None
    display_data: List[Dict[str, Any]] = field(default_factory=list)
    execution_count: int = 0
    success: bool = True
    saved_assets: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class CompletionResult:
    """Result from completion request."""
    matches: List[str] = field(default_factory=list)
    cursor_start: int = 0
    cursor_end: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


class SubprocessIPythonSession:
    """
    IPython session running in a subprocess with a specific Python interpreter.

    This allows each session to use a different venv's Python, enabling
    proper isolation between projects.
    """

    def __init__(
        self,
        python_path: str,
        cwd: Optional[str] = None,
        figure_dir: Optional[str] = None,
    ):
        """
        Create a new subprocess IPython session.

        Args:
            python_path: Path to the Python executable to use
            cwd: Working directory for the session
            figure_dir: Directory to save matplotlib figures
        """
        self.python_path = python_path
        self.cwd = cwd
        self.figure_dir = figure_dir

        self._process: Optional[subprocess.Popen] = None
        self._response_queue: queue.Queue = queue.Queue()
        self._pending_requests: Dict[str, queue.Queue] = {}
        self._stream_callbacks: Dict[str, Callable] = {}
        self._reader_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._started = False
        self._worker_info: Dict[str, Any] = {}

    def start(self) -> bool:
        """
        Start the subprocess worker.

        Returns True if started successfully.
        """
        if self._started:
            return True

        # Ensure IPython is installed in the target Python
        if not self._ensure_ipython():
            print(f"[SubprocessIPython] Failed to ensure IPython is installed", file=sys.stderr)
            return False

        # Run worker script directly (doesn't require mrmd in target venv)
        worker_script = Path(__file__).parent / "ipython_worker.py"

        cmd = [self.python_path, str(worker_script)]
        if self.cwd:
            cmd.extend(["--cwd", self.cwd])
        if self.figure_dir:
            cmd.extend(["--figure-dir", self.figure_dir])

        try:
            # Set up environment with venv activated
            # This ensures !commands in notebooks use the correct venv
            venv_bin = Path(self.python_path).parent
            venv_root = venv_bin.parent
            # Ensure ~/.local/bin is in PATH (common location for uv, pipx, etc.)
            home = os.path.expanduser("~")
            local_bin = os.path.join(home, ".local", "bin")
            base_path = os.environ.get("PATH", "")
            if local_bin not in base_path:
                base_path = local_bin + os.pathsep + base_path

            env = {
                **os.environ,
                "PYTHONUNBUFFERED": "1",
                "VIRTUAL_ENV": str(venv_root),
                "PATH": str(venv_bin) + os.pathsep + base_path,
                # Force ANSI colors in output - libraries check these to enable colors
                # even when not connected to a TTY (which we're not, since we use pipes)
                "FORCE_COLOR": "1",  # Used by many libs (chalk, click, rich, etc.)
                "CLICOLOR_FORCE": "1",  # BSD/macOS convention
                "TERM": "xterm-256color",  # Helps some libs detect color support
                "PY_COLORS": "1",  # Python-specific (pytest, etc.)
            }
            # Remove PYTHONHOME if set (can interfere with venv)
            env.pop("PYTHONHOME", None)

            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,  # Line buffered
                env=env,
            )

            # Wait for ready message BEFORE starting reader thread
            # (otherwise reader thread races with us to consume the message)
            try:
                ready_line = self._process.stdout.readline()
                if ready_line:
                    ready_msg = json.loads(ready_line)
                    if ready_msg.get("status") == "ready":
                        self._started = True
                        self._worker_info = {
                            "python_executable": ready_msg.get("python"),
                            "python_version": None,  # Will be fetched on first info request
                            "pid": ready_msg.get("pid"),
                        }
                        # Now start reader thread for subsequent messages
                        self._reader_thread = threading.Thread(target=self._read_output, daemon=True)
                        self._reader_thread.start()
                        return True
            except Exception as e:
                print(f"[SubprocessIPython] Failed to read ready message: {e}", file=sys.stderr)

            # If we get here, startup failed - check stderr for details
            if self._process:
                stderr = self._process.stderr.read()
                if stderr:
                    print(f"[SubprocessIPython] Worker stderr: {stderr}", file=sys.stderr)
            self._cleanup()
            return False

        except Exception as e:
            print(f"[SubprocessIPython] Failed to start worker: {e}", file=sys.stderr)
            self._cleanup()
            return False

    def _ensure_ipython(self) -> bool:
        """
        Ensure IPython and dill are installed in the target Python.
        Installs them if missing using pip or uv.

        Returns True if dependencies are available.
        """
        packages_to_check = ["IPython", "dill"]
        packages_to_install = []

        # Check which packages need to be installed
        for pkg in packages_to_check:
            try:
                result = subprocess.run(
                    [self.python_path, "-c", f"import {pkg}"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode != 0:
                    packages_to_install.append(pkg.lower())
            except Exception:
                packages_to_install.append(pkg.lower())

        if not packages_to_install:
            return True

        print(f"[SubprocessIPython] Installing missing packages: {packages_to_install}", file=sys.stderr)

        # Try to install packages
        # First, try uv (faster)
        venv_bin = Path(self.python_path).parent
        uv_path = venv_bin / "uv"
        if not uv_path.exists():
            # Try system uv
            try:
                result = subprocess.run(["which", "uv"], capture_output=True, text=True)
                if result.returncode == 0:
                    uv_path = Path(result.stdout.strip())
            except Exception:
                uv_path = None

        if uv_path and uv_path.exists():
            try:
                result = subprocess.run(
                    [str(uv_path), "pip", "install", *packages_to_install, "--python", self.python_path],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    print(f"[SubprocessIPython] Installed {packages_to_install} via uv", file=sys.stderr)
                    return True
                else:
                    print(f"[SubprocessIPython] uv install failed: {result.stderr}", file=sys.stderr)
            except Exception as e:
                print(f"[SubprocessIPython] uv install error: {e}", file=sys.stderr)

        # Fall back to pip
        pip_path = venv_bin / "pip"
        if not pip_path.exists():
            pip_path = venv_bin / "pip3"

        if pip_path.exists():
            try:
                result = subprocess.run(
                    [str(pip_path), "install", *packages_to_install],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode == 0:
                    print(f"[SubprocessIPython] Installed {packages_to_install} via pip", file=sys.stderr)
                    return True
                else:
                    print(f"[SubprocessIPython] pip install failed: {result.stderr}", file=sys.stderr)
            except Exception as e:
                print(f"[SubprocessIPython] pip install error: {e}", file=sys.stderr)

        # Try python -m pip as last resort
        try:
            result = subprocess.run(
                [self.python_path, "-m", "pip", "install", *packages_to_install],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                print(f"[SubprocessIPython] Installed {packages_to_install} via python -m pip", file=sys.stderr)
                return True
            else:
                print(f"[SubprocessIPython] python -m pip install failed: {result.stderr}", file=sys.stderr)
        except Exception as e:
            print(f"[SubprocessIPython] python -m pip error: {e}", file=sys.stderr)

        return False

    def _read_output(self):
        """Background thread that reads output from the worker."""
        try:
            while self._process and self._process.poll() is None:
                line = self._process.stdout.readline()
                if not line:
                    break

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                request_id = msg.get("id")

                # Check if this is a stream message
                if "stream" in msg:
                    callback = self._stream_callbacks.get(request_id)
                    if callback:
                        callback(msg["stream"], msg["content"])
                    continue

                # Regular response - put in the request's queue
                if request_id and request_id in self._pending_requests:
                    self._pending_requests[request_id].put(msg)

        except Exception as e:
            print(f"[SubprocessIPython] Reader error: {e}", file=sys.stderr)

    def _send_request(
        self,
        method: str,
        params: Dict[str, Any],
        timeout: float = 30.0,
        stream_callback: Optional[Callable] = None,
    ) -> Dict[str, Any]:
        """
        Send a request to the worker and wait for response.

        Args:
            method: The method to call
            params: Parameters for the method
            timeout: Timeout in seconds
            stream_callback: Optional callback for streaming output (stream_name, content)

        Returns:
            Response dict with 'result' or 'error'
        """
        if not self._started:
            if not self.start():
                return {"error": {"type": "NotStarted", "message": "Worker not started"}}

        # Check if process is still alive
        if not self.is_alive():
            print("[SubprocessIPython] Worker process died, attempting restart", file=sys.stderr)
            self._cleanup()
            self._started = False
            if not self.start():
                return {"error": {"type": "ProcessDied", "message": "Worker process died and could not be restarted"}}

        request_id = str(uuid.uuid4())
        request = {
            "id": request_id,
            "method": method,
            "params": params,
        }

        # Create response queue for this request
        response_queue: queue.Queue = queue.Queue()
        self._pending_requests[request_id] = response_queue

        if stream_callback:
            self._stream_callbacks[request_id] = stream_callback

        try:
            # Send request
            request_line = json.dumps(request) + "\n"
            try:
                self._process.stdin.write(request_line)
                self._process.stdin.flush()
            except (BrokenPipeError, OSError) as e:
                print(f"[SubprocessIPython] Failed to write to worker: {e}", file=sys.stderr)
                return {"error": {"type": "IOError", "message": f"Failed to communicate with worker: {e}"}}

            # Wait for response
            try:
                response = response_queue.get(timeout=timeout)
                return response
            except queue.Empty:
                return {"error": {"type": "Timeout", "message": f"Request timed out after {timeout}s"}}

        finally:
            # Cleanup
            del self._pending_requests[request_id]
            if request_id in self._stream_callbacks:
                del self._stream_callbacks[request_id]

    def execute(self, code: str, store_history: bool = True) -> ExecutionResult:
        """Execute code and return result."""
        response = self._send_request("execute", {
            "code": code,
            "store_history": store_history,
            "streaming": False,
        })

        if "error" in response:
            result = ExecutionResult(success=False)
            result.error = response["error"]
            return result

        data = response.get("result", {})
        return ExecutionResult(
            stdout=data.get("stdout", ""),
            stderr=data.get("stderr", ""),
            result=data.get("result"),
            error=data.get("error"),
            display_data=data.get("display_data", []),
            execution_count=data.get("execution_count", 0),
            success=data.get("success", False),
            saved_assets=data.get("saved_assets", []),
        )

    def execute_streaming(
        self,
        code: str,
        on_output: Callable[[str, str], None],
        store_history: bool = True,
        timeout: float = 300.0,
    ) -> ExecutionResult:
        """
        Execute code with streaming output.

        Args:
            code: Code to execute
            on_output: Callback(stream_name, content) for each output chunk
            store_history: Whether to store in history
            timeout: Timeout in seconds (default 5 minutes)

        Returns:
            ExecutionResult after completion
        """
        response = self._send_request(
            "execute",
            {
                "code": code,
                "store_history": store_history,
                "streaming": True,
            },
            timeout=timeout,
            stream_callback=on_output,
        )

        if "error" in response:
            result = ExecutionResult(success=False)
            result.error = response["error"]
            return result

        data = response.get("result", {})
        return ExecutionResult(
            stdout=data.get("stdout", ""),
            stderr=data.get("stderr", ""),
            result=data.get("result"),
            error=data.get("error"),
            display_data=data.get("display_data", []),
            execution_count=data.get("execution_count", 0),
            success=data.get("success", False),
            saved_assets=data.get("saved_assets", []),
        )

    def complete(self, code: str, cursor_pos: int) -> CompletionResult:
        """Get completions at cursor position."""
        response = self._send_request("complete", {
            "code": code,
            "cursor_pos": cursor_pos,
        })

        if "error" in response:
            return CompletionResult()

        data = response.get("result", {})
        return CompletionResult(
            matches=data.get("matches", []),
            cursor_start=data.get("cursor_start", cursor_pos),
            cursor_end=data.get("cursor_end", cursor_pos),
            metadata=data.get("metadata", {}),
        )

    def inspect(self, code: str, cursor_pos: int) -> Dict[str, Any]:
        """Get object info for hover."""
        response = self._send_request("inspect", {
            "code": code,
            "cursor_pos": cursor_pos,
        })

        if "error" in response:
            return {"found": False}

        return response.get("result", {"found": False})

    def get_variables(self) -> List[Dict[str, Any]]:
        """Get user variables."""
        response = self._send_request("variables", {})

        if "error" in response:
            return []

        return response.get("result", [])

    def reset(self) -> bool:
        """Reset the namespace."""
        response = self._send_request("reset", {})
        return response.get("result", {}).get("success", False)

    def save_namespace(self, output_path: str) -> Dict[str, Any]:
        """
        Save the user namespace to disk.

        Args:
            output_path: Path to save to (.dill.gz)

        Returns:
            Dict with success, saved_count, saved_names, errors, size
        """
        response = self._send_request("save_namespace", {
            "output_path": output_path,
        }, timeout=60.0)  # May take time for large namespaces

        if "error" in response:
            return {"success": False, "error": response["error"]}

        return response.get("result", {"success": False})

    def load_namespace(self, input_path: str, merge: bool = True) -> Dict[str, Any]:
        """
        Load namespace from disk.

        Args:
            input_path: Path to load from (.dill.gz)
            merge: If True, merge with existing. If False, reset first.

        Returns:
            Dict with success, loaded_count, loaded_names
        """
        response = self._send_request("load_namespace", {
            "input_path": input_path,
            "merge": merge,
        }, timeout=60.0)

        if "error" in response:
            return {"success": False, "error": response["error"]}

        return response.get("result", {"success": False})

    def get_info(self) -> Dict[str, Any]:
        """Get worker info (python path, version, etc)."""
        if self._worker_info:
            return self._worker_info

        response = self._send_request("info", {}, timeout=5.0)
        if "error" not in response:
            self._worker_info = response.get("result", {})
        return self._worker_info

    def inspect_object(self, path: str) -> Dict[str, Any]:
        """
        Inspect an object by path for drill-down exploration.

        Args:
            path: Dot/bracket notation path like "df", "obj.attr", "mylist[0]"

        Returns:
            Dict with 'info' about the object and 'children' for expandable items
        """
        response = self._send_request("inspect_object", {"path": path})

        if "error" in response:
            return {"error": response["error"], "path": path}

        return response.get("result", {"path": path, "info": {}, "children": []})

    def hover_inspect(self, name: str) -> Dict[str, Any]:
        """
        Get hover information for a variable/expression.

        Args:
            name: Variable name or expression to inspect

        Returns:
            Dict with found, name, type, value, docstring, signature
        """
        response = self._send_request("hover", {"name": name})

        if "error" in response:
            return {"found": False, "name": name}

        return response.get("result", {"found": False, "name": name})

    def is_complete(self, code: str) -> Dict[str, Any]:
        """
        Check if code is complete or needs more input.

        Args:
            code: The code to check

        Returns:
            Dict with 'status' ("complete", "incomplete", "invalid") and 'indent'
        """
        response = self._send_request("is_complete", {"code": code}, timeout=5.0)

        if "error" in response:
            return {"status": "unknown", "indent": ""}

        return response.get("result", {"status": "unknown", "indent": ""})

    def interrupt(self) -> bool:
        """Send interrupt signal to the worker."""
        if self._process and self._process.poll() is None:
            try:
                # Send SIGINT to the worker process
                if sys.platform != "win32":
                    os.kill(self._process.pid, signal.SIGINT)
                else:
                    # On Windows, use CTRL_C_EVENT
                    self._process.send_signal(signal.CTRL_C_EVENT)
                return True
            except Exception as e:
                print(f"[SubprocessIPython] Interrupt failed: {e}", file=sys.stderr)
        return False

    def is_alive(self) -> bool:
        """Check if the worker process is still running."""
        return self._process is not None and self._process.poll() is None

    def get_memory_usage(self) -> Optional[int]:
        """Get memory usage of the worker process in bytes."""
        if not self._process or self._process.poll() is not None:
            return None

        pid = self._process.pid
        try:
            # Try psutil first (most accurate)
            import psutil
            proc = psutil.Process(pid)
            return proc.memory_info().rss
        except ImportError:
            pass

        # Fallback: read from /proc on Linux
        try:
            with open(f'/proc/{pid}/status', 'r') as f:
                for line in f:
                    if line.startswith('VmRSS:'):
                        # Format: "VmRSS:    12345 kB"
                        parts = line.split()
                        if len(parts) >= 2:
                            return int(parts[1]) * 1024  # Convert KB to bytes
        except (FileNotFoundError, PermissionError, ValueError):
            pass

        return None

    def _update_figure_dir(self, figure_dir: str):
        """Update the figure directory in the running worker process."""
        if not self.is_alive():
            return

        # Send a config update to the worker
        request_id = f"config_{id(self)}_{threading.get_ident()}"
        response_queue = queue.Queue()

        with self._lock:
            self._pending_requests[request_id] = response_queue

        try:
            request = json.dumps({
                "id": request_id,
                "method": "set_config",
                "params": {"figure_dir": figure_dir}
            })
            self._process.stdin.write(request + "\n")
            self._process.stdin.flush()

            try:
                response = response_queue.get(timeout=5.0)
            except queue.Empty:
                print(f"[SubprocessIPython] Timeout updating figure_dir", file=sys.stderr)
        finally:
            with self._lock:
                self._pending_requests.pop(request_id, None)

    def close(self):
        """Close the session and terminate the worker."""
        self._cleanup()

    def _cleanup(self):
        """Clean up resources."""
        if self._process:
            try:
                self._process.stdin.close()
            except:
                pass
            try:
                self._process.terminate()
                self._process.wait(timeout=2)
            except:
                try:
                    self._process.kill()
                except:
                    pass
            self._process = None

        self._started = False

    def __del__(self):
        self._cleanup()


class SubprocessIPythonSessionManager:
    """
    Manages multiple subprocess IPython sessions.

    Each session can use a different Python interpreter.
    """

    def __init__(self):
        self.sessions: Dict[str, SubprocessIPythonSession] = {}
        self._lock = threading.Lock()
        self._default_python: Optional[str] = None

    def _get_default_python(self) -> str:
        """
        Get the default Python executable for new sessions.

        Priority:
        1. Cached default (if already found)
        2. Default MRMD project's venv (~/Projects/Scratch/.venv)
        3. Fall back to sys.executable
        """
        if self._default_python:
            return self._default_python

        # Try to find the default project's Python
        try:
            from . import environment
            default_project = environment.get_default_project_path()
            if default_project.exists():
                python_path = environment.get_project_venv_python(str(default_project))
                if python_path and Path(python_path).exists():
                    self._default_python = python_path
                    print(f"[SessionManager] Using default project Python: {python_path}", file=sys.stderr)
                    return python_path
        except Exception as e:
            print(f"[SessionManager] Error finding default Python: {e}", file=sys.stderr)

        # Fall back to sys.executable
        self._default_python = sys.executable
        print(f"[SessionManager] Falling back to sys.executable: {sys.executable}", file=sys.stderr)
        return self._default_python

    def get_or_create(
        self,
        session_id: str,
        python_path: Optional[str] = None,
        cwd: Optional[str] = None,
        figure_dir: Optional[str] = None,
    ) -> SubprocessIPythonSession:
        """
        Get existing session or create new one.

        Args:
            session_id: Unique session identifier
            python_path: Path to Python executable (required for new sessions)
            cwd: Working directory
            figure_dir: Directory for saving figures

        Returns:
            The session (existing or newly created)

        IMPORTANT - Dynamic figure_dir updates:
        Sessions are often created before the user opens a project (e.g., kernel
        auto-starts). When a project is opened later, figure_dir is passed with
        the first execution request. We detect this and dynamically update the
        running worker process via RPC (set_config method).

        This is critical for matplotlib support - without figure_dir, plt.show()
        does nothing because the worker's _hooked_show() checks if figure_dir is set.
        """
        with self._lock:
            if session_id in self.sessions:
                session = self.sessions[session_id]
                # Check if still alive
                if session.is_alive():
                    # CRITICAL: Update figure_dir if provided after session creation.
                    # This happens when user opens a project after kernel already started.
                    # Without this, matplotlib figures won't be saved.
                    if figure_dir and session.figure_dir != figure_dir:
                        print(f"[SessionManager] Updating figure_dir for {session_id}: {figure_dir}", file=sys.stderr)
                        session.figure_dir = figure_dir
                        # Tell the worker process about the new figure dir via RPC
                        session._update_figure_dir(figure_dir)
                    return session
                # Dead session, remove it
                del self.sessions[session_id]

            # Need to create new session
            if not python_path:
                # Try to use the default MRMD project's Python
                python_path = self._get_default_python()

            session = SubprocessIPythonSession(
                python_path=python_path,
                cwd=cwd,
                figure_dir=figure_dir,
            )
            self.sessions[session_id] = session
            return session

    def get(self, session_id: str) -> Optional[SubprocessIPythonSession]:
        """Get session by ID, or None if not found."""
        return self.sessions.get(session_id)

    def close(self, session_id: str) -> bool:
        """Close and remove a session."""
        with self._lock:
            if session_id in self.sessions:
                self.sessions[session_id].close()
                del self.sessions[session_id]
                return True
            return False

    def close_all(self) -> List[str]:
        """Close all sessions. Returns list of closed session IDs."""
        with self._lock:
            closed = list(self.sessions.keys())
            for session in self.sessions.values():
                session.close()
            self.sessions.clear()
            return closed

    def list_sessions(self) -> List[Dict[str, Any]]:
        """List all sessions with their info."""
        result = []
        for session_id, session in self.sessions.items():
            alive = session.is_alive()
            info = session.get_info() if alive else {}
            memory = session.get_memory_usage() if alive else None
            result.append({
                "id": session_id,
                "python_path": session.python_path,
                "cwd": session.cwd,
                "alive": alive,
                "python_version": info.get("python_version", ""),
                "pid": info.get("pid"),
                "memory_bytes": memory,
            })
        return result

    def restart(self, session_id: str) -> bool:
        """Restart a session (preserves python_path and cwd)."""
        with self._lock:
            if session_id not in self.sessions:
                return False

            old_session = self.sessions[session_id]
            python_path = old_session.python_path
            cwd = old_session.cwd
            figure_dir = old_session.figure_dir

            old_session.close()

            new_session = SubprocessIPythonSession(
                python_path=python_path,
                cwd=cwd,
                figure_dir=figure_dir,
            )
            self.sessions[session_id] = new_session
            return new_session.start()

    def reconfigure(
        self,
        session_id: str,
        python_path: Optional[str] = None,
        cwd: Optional[str] = None,
    ) -> bool:
        """
        Reconfigure a session with new Python or cwd.

        This will close the old session and start a new one.

        Returns True if successful.
        """
        with self._lock:
            old_session = self.sessions.get(session_id)

            if old_session:
                # Preserve settings not being changed
                if python_path is None:
                    python_path = old_session.python_path
                if cwd is None:
                    cwd = old_session.cwd
                figure_dir = old_session.figure_dir
                old_session.close()
            else:
                figure_dir = None

            if not python_path:
                python_path = sys.executable

            new_session = SubprocessIPythonSession(
                python_path=python_path,
                cwd=cwd,
                figure_dir=figure_dir,
            )
            self.sessions[session_id] = new_session
            return new_session.start()

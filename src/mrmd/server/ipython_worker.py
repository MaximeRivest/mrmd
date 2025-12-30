#!/usr/bin/env python3
"""
IPython Worker Process

This script runs as a subprocess, providing an IPython shell that communicates
with the parent mrmd server via JSON-RPC over stdin/stdout.

Protocol:
- Parent sends JSON requests on stdin (one per line)
- Worker sends JSON responses on stdout (one per line)
- stderr is used for debugging/logging only

Request format:
{
    "id": "unique-request-id",
    "method": "execute|complete|inspect|variables|reset|interrupt",
    "params": { ... method-specific params ... }
}

Response format:
{
    "id": "unique-request-id",
    "result": { ... },  # on success
    "error": { "type": "...", "message": "..." }  # on error
}

Streaming (for execute):
{
    "id": "unique-request-id",
    "stream": "stdout|stderr",
    "content": "..."
}
...followed by final result message
"""

import sys
import os
import json
import io
import traceback
import signal
import threading
import select
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict


# Save original file descriptors BEFORE any modification
# These are used for JSON-RPC communication with parent
_ORIGINAL_STDOUT_FD = os.dup(sys.stdout.fileno())
_ORIGINAL_STDERR_FD = os.dup(sys.stderr.fileno())

# Ensure we're not buffering
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, line_buffering=True)

# Configure multiprocessing for compatibility with GPU libraries
# 'spawn' creates clean processes that don't inherit problematic state
try:
    import multiprocessing
    if hasattr(multiprocessing, 'set_start_method'):
        try:
            multiprocessing.set_start_method('spawn', force=False)
        except RuntimeError:
            pass  # Already set
except ImportError:
    pass


def _write_to_parent(msg: str):
    """Write a message to parent process via original stdout."""
    os.write(_ORIGINAL_STDOUT_FD, (msg + '\n').encode('utf-8'))


@dataclass
class ExecutionResult:
    stdout: str = ""
    stderr: str = ""
    result: Optional[str] = None
    error: Optional[Dict[str, Any]] = None
    display_data: List[Dict[str, Any]] = field(default_factory=list)
    execution_count: int = 0
    success: bool = True
    saved_assets: List[Dict[str, Any]] = field(default_factory=list)


class IPythonWorker:
    """
    IPython worker that communicates via JSON-RPC over stdin/stdout.
    """

    def __init__(self, cwd: Optional[str] = None, figure_dir: Optional[str] = None):
        self.cwd = cwd
        self.figure_dir = figure_dir
        self.shell = None
        self._initialized = False
        self._captured_displays: List[Dict[str, Any]] = []
        self._figure_counter = 0
        self._interrupt_requested = False
        self._current_exec_id: Optional[str] = None  # Current execution ID for asset naming

    def _ensure_initialized(self):
        """Lazy initialization of IPython shell."""
        if self._initialized:
            return

        from IPython.core.interactiveshell import InteractiveShell

        # Create shell instance
        self.shell = InteractiveShell.instance()

        # Enable rich display for return values
        # This ensures objects like pandas Styler, plotly figures, etc.
        # have their _repr_html_() method called
        self.shell.display_formatter.active_types = [
            'text/plain',
            'text/html',
            'text/markdown',
            'text/latex',
            'image/png',
            'image/jpeg',
            'image/svg+xml',
            'application/json',
            'application/javascript',
        ]

        # Set up display capture
        self._setup_display_capture()

        # Set up matplotlib hook
        self._setup_matplotlib_hook()

        # Set up Plotly for HTML output
        self._setup_plotly_renderer()

        # Register %pip magic with uv
        self._register_uv_pip_magic()

        # Change to working directory if specified
        if self.cwd:
            os.chdir(self.cwd)
            # Ensure cwd is in sys.path for local imports
            if self.cwd not in sys.path:
                sys.path.insert(0, self.cwd)
            # Also add src/ if it exists (for data analyst template)
            src_dir = os.path.join(self.cwd, 'src')
            if os.path.isdir(src_dir) and src_dir not in sys.path:
                sys.path.insert(0, src_dir)

        # Enable autoreload for module development
        self._setup_autoreload()

        self._initialized = True

    def _setup_plotly_renderer(self):
        """
        Configure Plotly to render as HTML for our display system.

        Uses 'notebook_connected' renderer which outputs HTML with CDN reference.
        This works better in standalone iframes than 'notebook' which uses require.js.
        """
        try:
            import plotly.io as pio
            # Use 'notebook_connected' - outputs HTML with CDN reference, no require.js
            # This creates standalone HTML that works in iframes
            pio.renderers.default = 'notebook_connected'
        except ImportError:
            # Plotly not installed, skip
            pass

    def _save_asset(self, content: bytes, mime_type: str, extension: str) -> Optional[str]:
        """
        Save content as an asset file and return the path.

        Args:
            content: Raw bytes to save
            mime_type: MIME type of the content
            extension: File extension (without dot)

        Returns:
            Absolute path to saved file, or None if figure_dir not set
        """
        if not self.figure_dir:
            return None

        from pathlib import Path
        fig_dir = Path(self.figure_dir)
        fig_dir.mkdir(parents=True, exist_ok=True)

        self._figure_counter += 1
        # Include exec_id in filename for tracking and cleanup
        if self._current_exec_id:
            filename = f"{self._current_exec_id}_{self._figure_counter:04d}.{extension}"
        else:
            filename = f"output_{self._figure_counter:04d}.{extension}"
        filepath = fig_dir / filename

        filepath.write_bytes(content)
        return str(filepath)

    def _save_text_asset(self, content: str, mime_type: str, extension: str) -> Optional[str]:
        """Save text content as an asset file."""
        if not self.figure_dir:
            return None

        from pathlib import Path
        fig_dir = Path(self.figure_dir)
        fig_dir.mkdir(parents=True, exist_ok=True)

        self._figure_counter += 1
        # Include exec_id in filename for tracking and cleanup
        if self._current_exec_id:
            filename = f"{self._current_exec_id}_{self._figure_counter:04d}.{extension}"
        else:
            filename = f"output_{self._figure_counter:04d}.{extension}"
        filepath = fig_dir / filename

        filepath.write_text(content, encoding='utf-8')
        return str(filepath)

    def _wrap_html_standalone(self, html_content: str, title: str = "Output") -> str:
        """
        Wrap HTML content in a standalone document.

        For Plotly/Bokeh/interactive content, includes necessary JS libraries.
        """
        import re

        # Check if this looks like Plotly output
        is_plotly = 'plotly' in html_content.lower() or 'Plotly.newPlot' in html_content

        if is_plotly:
            # Strip require.js wrapper if present (from notebook renderer)
            # This converts require(['plotly'], function(Plotly) {...}) to just the inner function
            if 'require(' in html_content or 'requirejs(' in html_content:
                # Pattern: require(["plotly"], function(Plotly) { ... });
                # We want to extract the inner code and run it directly
                html_content = re.sub(
                    r'require\s*\(\s*\[[^\]]*\]\s*,\s*function\s*\([^)]*\)\s*\{',
                    '(function() {',
                    html_content
                )
                # Also handle requirejs variant
                html_content = re.sub(
                    r'requirejs\s*\(\s*\[[^\]]*\]\s*,\s*function\s*\([^)]*\)\s*\{',
                    '(function() {',
                    html_content
                )
                # Change the closing });  to })(); to make it an IIFE
                html_content = re.sub(r'\}\s*\)\s*;?\s*</script>', '})();</script>', html_content)

            return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="https://cdn.plot.ly/plotly-2.35.0.min.js"></script>
    <style>
        body {{ margin: 0; padding: 8px; background: white; }}
        .plotly-graph-div {{ width: 100% !important; }}
    </style>
</head>
<body>
{html_content}
</body>
</html>"""
        else:
            # Generic HTML (pandas tables, etc.)
            return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 16px;
            background: white;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
        }}
        th, td {{
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }}
        th {{
            background: #f5f5f5;
            font-weight: 600;
        }}
        tr:nth-child(even) {{
            background: #fafafa;
        }}
    </style>
</head>
<body>
{html_content}
</body>
</html>"""

    def _setup_display_capture(self):
        """
        Set up capture of rich display outputs with asset-based storage.

        This intercepts IPython's display system and saves rich outputs
        (images, HTML, SVG) as asset files rather than embedding them inline.
        """
        worker = self
        import base64

        class AssetCapturingDisplayPublisher:
            """
            Captures display() calls and saves rich content as assets.

            Priority order for MIME types:
            1. image/png - Save as PNG file
            2. image/jpeg - Save as JPEG file
            3. image/svg+xml - Save as SVG file
            4. text/html - Save as HTML file (for Plotly, pandas, etc.)
            5. text/plain - Keep inline (no file needed)
            """

            def __init__(self, shell):
                self.shell = shell
                self.is_publishing = False

            def publish(self, data, metadata=None, source=None, **kwargs):
                self.is_publishing = True
                try:
                    self._process_display(data, metadata or {})
                finally:
                    self.is_publishing = False

            def _process_display(self, data, metadata):
                """Process display data and save as assets where appropriate."""
                # Handle image/png
                if 'image/png' in data:
                    png_data = data['image/png']
                    if isinstance(png_data, str):
                        # Base64 encoded
                        png_bytes = base64.b64decode(png_data)
                    else:
                        png_bytes = png_data

                    filepath = worker._save_asset(png_bytes, 'image/png', 'png')
                    if filepath:
                        worker._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/png",
                                "type": "image"
                            }
                        })
                    else:
                        # Fallback: keep inline if no figure_dir
                        worker._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle image/jpeg
                if 'image/jpeg' in data:
                    jpeg_data = data['image/jpeg']
                    if isinstance(jpeg_data, str):
                        jpeg_bytes = base64.b64decode(jpeg_data)
                    else:
                        jpeg_bytes = jpeg_data

                    filepath = worker._save_asset(jpeg_bytes, 'image/jpeg', 'jpg')
                    if filepath:
                        worker._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/jpeg",
                                "type": "image"
                            }
                        })
                    else:
                        worker._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle image/svg+xml
                if 'image/svg+xml' in data:
                    svg_content = data['image/svg+xml']
                    if isinstance(svg_content, bytes):
                        svg_content = svg_content.decode('utf-8')

                    filepath = worker._save_text_asset(svg_content, 'image/svg+xml', 'svg')
                    if filepath:
                        worker._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/svg+xml",
                                "type": "svg"
                            }
                        })
                    else:
                        worker._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle text/html (Plotly, pandas styled, etc.)
                if 'text/html' in data:
                    html_content = data['text/html']
                    if isinstance(html_content, bytes):
                        html_content = html_content.decode('utf-8')

                    # Skip trivial/empty HTML
                    if not html_content or not html_content.strip():
                        return

                    # Skip very short HTML that's just text representations
                    # (pandas repr sometimes includes tiny HTML)
                    if len(html_content.strip()) < 50 and '<' not in html_content[10:]:
                        if 'text/plain' in data:
                            worker._captured_displays.append({
                                "data": {"text/plain": data['text/plain']},
                                "metadata": metadata,
                            })
                        return

                    # Skip Plotly "configuration" HTML that doesn't contain actual plot data
                    # notebook_connected renderer sends two outputs: config + actual plot
                    # We only want the one with Plotly.newPlot or plotly-graph-div
                    is_plotly_related = 'plotly' in html_content.lower()
                    has_plot_content = 'Plotly.newPlot' in html_content or 'plotly-graph-div' in html_content
                    if is_plotly_related and not has_plot_content:
                        # This is just Plotly config/loader HTML, skip it
                        return

                    # Wrap in standalone HTML document
                    standalone_html = worker._wrap_html_standalone(html_content)
                    filepath = worker._save_text_asset(standalone_html, 'text/html', 'html')

                    if filepath:
                        worker._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "text/html",
                                "type": "html"
                            }
                        })
                    else:
                        # Fallback: keep inline
                        worker._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle text/plain and other types - keep inline
                if 'text/plain' in data:
                    worker._captured_displays.append({
                        "data": {"text/plain": data['text/plain']},
                        "metadata": metadata,
                    })
                    return

                # Unknown type - pass through
                if data:
                    worker._captured_displays.append({
                        "data": data,
                        "metadata": metadata,
                    })

            def clear_output(self, wait=False):
                pass

        self.shell.display_pub = AssetCapturingDisplayPublisher(self.shell)

    def _setup_matplotlib_hook(self):
        """
        Set up matplotlib to save figures as assets.

        ARCHITECTURE NOTE:
        This hook intercepts plt.show() to save figures to disk as assets.
        The key complexity is that this worker process may start BEFORE
        figure_dir is known (because the kernel can auto-start before user
        opens a project).

        The solution:
        1. Hook is set up at worker init, but checks figure_dir at runtime
        2. When figure_dir is updated via set_config RPC, the closure
           automatically uses the new value
        3. If figure_dir is None, figures are silently closed without saving

        Figures are saved as PNG with:
        - 150 DPI for good quality
        - Tight bounding box to remove whitespace
        - White background for consistent appearance
        """
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt

            worker = self

            def _hooked_show(*args, **kwargs):
                """Save all open figures as assets when show() is called."""
                if worker.figure_dir:
                    from pathlib import Path
                    from io import BytesIO

                    fig_dir = Path(worker.figure_dir)
                    fig_dir.mkdir(parents=True, exist_ok=True)

                    for num in plt.get_fignums():
                        fig = plt.figure(num)

                        # Save to buffer first
                        buf = BytesIO()
                        fig.savefig(buf, format='png', dpi=150,
                                   bbox_inches='tight',
                                   facecolor='white', edgecolor='none')
                        buf.seek(0)
                        png_bytes = buf.getvalue()

                        # Save as asset with exec_id in filename
                        worker._figure_counter += 1
                        if worker._current_exec_id:
                            filename = f"{worker._current_exec_id}_{worker._figure_counter:04d}.png"
                        else:
                            filename = f"figure_{worker._figure_counter:04d}.png"
                        filepath = fig_dir / filename
                        filepath.write_bytes(png_bytes)

                        # Record as asset reference
                        worker._captured_displays.append({
                            "asset": {
                                "path": str(filepath),
                                "mime_type": "image/png",
                                "type": "image"
                            }
                        })

                # Always close figures to free memory
                plt.close('all')

            plt.show = _hooked_show
            if 'matplotlib.pyplot' in sys.modules:
                sys.modules['matplotlib.pyplot'].show = _hooked_show

        except ImportError:
            pass

    def _ensure_matplotlib_hook(self):
        """
        Ensure matplotlib.pyplot.show is hooked if matplotlib is loaded.

        This is called after each cell execution to handle the case where
        matplotlib was just imported by user code. The hook needs to be
        re-applied because a fresh import gets the original show() function.
        """
        if 'matplotlib.pyplot' not in sys.modules:
            return

        plt = sys.modules['matplotlib.pyplot']

        # Check if already hooked (our hook closes all figures, original doesn't)
        # We can detect this by checking if show has our specific behavior
        if hasattr(plt.show, '_mrmd_hooked'):
            return

        worker = self

        def _hooked_show(*args, **kwargs):
            """Save all open figures as assets when show() is called."""
            if worker.figure_dir:
                from pathlib import Path
                from io import BytesIO

                fig_dir = Path(worker.figure_dir)
                fig_dir.mkdir(parents=True, exist_ok=True)

                for num in plt.get_fignums():
                    fig = plt.figure(num)

                    # Save to buffer first
                    buf = BytesIO()
                    fig.savefig(buf, format='png', dpi=150,
                               bbox_inches='tight',
                               facecolor='white', edgecolor='none')
                    buf.seek(0)
                    png_bytes = buf.getvalue()

                    # Save as asset with exec_id in filename
                    worker._figure_counter += 1
                    if worker._current_exec_id:
                        filename = f"{worker._current_exec_id}_{worker._figure_counter:04d}.png"
                    else:
                        filename = f"figure_{worker._figure_counter:04d}.png"
                    filepath = fig_dir / filename
                    filepath.write_bytes(png_bytes)

                    # Record as asset reference
                    worker._captured_displays.append({
                        "asset": {
                            "path": str(filepath),
                            "mime_type": "image/png",
                            "type": "image"
                        }
                    })

            # Always close figures to free memory
            plt.close('all')

        # Mark as hooked so we don't re-hook
        _hooked_show._mrmd_hooked = True

        plt.show = _hooked_show

    def _register_uv_pip_magic(self):
        """Register %pip magic that uses uv."""
        import subprocess
        import shutil

        python_executable = sys.executable
        cwd = self.cwd

        def pip_magic(line):
            uv_path = shutil.which('uv')
            if not uv_path:
                print("Error: uv not found. Install from https://docs.astral.sh/uv/")
                return

            args = line.split()
            if args:
                subcommand = args[0]
                rest = args[1:]
                cmd = [uv_path, 'pip', subcommand, '-p', python_executable] + rest
            else:
                cmd = [uv_path, 'pip']

            print(f"Running: uv pip {' '.join(args)}")
            print("-" * 50)

            try:
                subprocess.run(cmd, capture_output=False, text=True, cwd=cwd)
            except Exception as e:
                print(f"Error: {e}")

            print("-" * 50)
            print("Note: Restart kernel to use newly installed packages.")

        self.shell.register_magic_function(pip_magic, 'line', 'pip')

        # Register %add magic for projects with pyproject.toml
        def add_magic(line):
            """Add packages using uv add (tracks in pyproject.toml)."""
            uv_path = shutil.which('uv')
            if not uv_path:
                print("Error: uv not found. Install from https://docs.astral.sh/uv/")
                return

            if not line.strip():
                print("Usage: %add package1 package2 ...")
                print("       %add pandas numpy matplotlib")
                return

            # Check for pyproject.toml
            from pathlib import Path
            project_dir = Path(cwd) if cwd else Path.cwd()
            if not (project_dir / 'pyproject.toml').exists():
                print("No pyproject.toml found. Use %pip install instead,")
                print("or create a project with 'Data Analyst' template.")
                return

            packages = line.split()
            cmd = [uv_path, 'add'] + packages

            print(f"Adding: {', '.join(packages)}")
            print("-" * 50)

            try:
                result = subprocess.run(cmd, capture_output=False, text=True, cwd=str(project_dir))
                if result.returncode == 0:
                    print("-" * 50)
                    print("Packages added to pyproject.toml")
                    print("Note: Restart kernel to use newly installed packages.")
            except Exception as e:
                print(f"Error: {e}")

        self.shell.register_magic_function(add_magic, 'line', 'add')

    def _setup_autoreload(self):
        """Enable autoreload extension for automatic module reloading.

        This allows users to edit Python files in their project and have
        changes automatically picked up without restarting the kernel.
        """
        try:
            # Load the autoreload extension
            self.shell.run_line_magic('load_ext', 'autoreload')
            # Set to mode 2: reload all modules every time before executing code
            self.shell.run_line_magic('autoreload', '2')
        except Exception:
            # Silently ignore if autoreload isn't available
            pass

    def execute(self, code: str, store_history: bool = True, exec_id: Optional[str] = None) -> ExecutionResult:
        """Execute code and return result."""
        self._ensure_initialized()
        self._captured_displays = []
        self._current_exec_id = exec_id  # Set for asset naming
        self._figure_counter = 0  # Reset counter for each execution

        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = captured_stdout = io.StringIO()
        sys.stderr = captured_stderr = io.StringIO()

        result = ExecutionResult()

        try:
            exec_result = self.shell.run_cell(code, store_history=store_history, silent=False)

            # Re-apply matplotlib hook after execution in case matplotlib was just imported
            # This handles the case where user runs `import matplotlib.pyplot as plt`
            self._ensure_matplotlib_hook()

            result.execution_count = self.shell.execution_count
            result.success = exec_result.success

            # Capture return value and trigger rich display if available
            if exec_result.result is not None:
                obj = exec_result.result
                try:
                    # Try to get rich representation and display it
                    # This ensures objects like pandas Styler, plotly figures, etc.
                    # have their rich output captured
                    if hasattr(obj, '_repr_html_'):
                        from IPython.display import display
                        display(obj)
                    elif hasattr(obj, '_repr_png_'):
                        from IPython.display import display
                        display(obj)
                    elif hasattr(obj, '_repr_svg_'):
                        from IPython.display import display
                        display(obj)

                    result.result = repr(obj)
                except Exception:
                    result.result = "<repr failed>"

            if exec_result.error_in_exec:
                result.error = self._format_exception(exec_result.error_in_exec)
                result.success = False
            elif exec_result.error_before_exec:
                result.error = self._format_exception(exec_result.error_before_exec)
                result.success = False

            result.display_data = self._captured_displays.copy()

        except Exception as e:
            result.error = self._format_exception(e)
            result.success = False

        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr
            result.stdout = captured_stdout.getvalue()
            result.stderr = captured_stderr.getvalue()
            self._current_exec_id = None  # Clear after execution

        return result

    def execute_streaming(self, code: str, request_id: str, store_history: bool = True, exec_id: Optional[str] = None):
        """Execute code with streaming output.

        Uses PTY (pseudo-terminal) for stdout/stderr redirection so that:
        1. sys.stdout.isatty() returns True - enabling ANSI colors in libraries
        2. Child processes inherit real file descriptors (important for multiprocessing)
        3. Libraries like tqdm, Rich, click emit colored output

        Falls back to pipes on systems without PTY support (Windows).
        """
        self._ensure_initialized()
        self._captured_displays = []
        self._current_exec_id = exec_id  # Set for asset naming
        self._figure_counter = 0  # Reset counter for each execution

        # Try to use PTY for TTY emulation (enables ANSI colors)
        use_pty = False
        try:
            import pty
            # Create PTY pairs for stdout and stderr
            stdout_master_fd, stdout_slave_fd = pty.openpty()
            stderr_master_fd, stderr_slave_fd = pty.openpty()
            use_pty = True
        except (ImportError, OSError):
            # Fall back to pipes on Windows or if PTY fails
            stdout_master_fd, stdout_slave_fd = os.pipe()
            stderr_master_fd, stderr_slave_fd = os.pipe()

        # Save original FDs (stdout=1, stderr=2)
        saved_stdout_fd = os.dup(1)
        saved_stderr_fd = os.dup(2)

        # Redirect stdout/stderr to PTY slave (or pipe write end)
        os.dup2(stdout_slave_fd, 1)
        os.dup2(stderr_slave_fd, 2)

        # Close slave FDs (we've dup'd them to 1 and 2)
        os.close(stdout_slave_fd)
        os.close(stderr_slave_fd)

        # Make master FDs non-blocking for reading
        try:
            import fcntl
            for fd in [stdout_master_fd, stderr_master_fd]:
                flags = fcntl.fcntl(fd, fcntl.F_GETFL)
                fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except ImportError:
            pass  # Windows doesn't have fcntl

        # Accumulated output
        accumulated_stdout = []
        accumulated_stderr = []
        stop_reader = threading.Event()

        def reader_thread():
            """Read from PTY masters (or pipes) and stream to parent."""
            while not stop_reader.is_set():
                # Use select to wait for data
                try:
                    readable, _, _ = select.select([stdout_master_fd, stderr_master_fd], [], [], 0.05)
                except (ValueError, OSError):
                    break

                for fd in readable:
                    try:
                        data = os.read(fd, 4096)
                        if not data:
                            continue

                        if fd == stdout_master_fd:
                            stream_name = "stdout"
                            buffer_list = accumulated_stdout
                        else:
                            stream_name = "stderr"
                            buffer_list = accumulated_stderr

                        # Decode and send (preserving ANSI escape sequences)
                        try:
                            text = data.decode('utf-8', errors='replace')
                            buffer_list.append(text)

                            # Stream to parent
                            msg = json.dumps({
                                "id": request_id,
                                "stream": stream_name,
                                "content": text
                            })
                            _write_to_parent(msg)
                        except Exception:
                            pass
                    except (BlockingIOError, OSError):
                        pass

            # Final read after stop signal
            for fd, stream_name, buffer_list in [
                (stdout_master_fd, "stdout", accumulated_stdout),
                (stderr_master_fd, "stderr", accumulated_stderr)
            ]:
                try:
                    while True:
                        data = os.read(fd, 4096)
                        if not data:
                            break
                        text = data.decode('utf-8', errors='replace')
                        buffer_list.append(text)
                        msg = json.dumps({
                            "id": request_id,
                            "stream": stream_name,
                            "content": text
                        })
                        _write_to_parent(msg)
                except (BlockingIOError, OSError):
                    pass

        # Start reader thread
        reader = threading.Thread(target=reader_thread, daemon=True)
        reader.start()

        # Update Python's sys.stdout/stderr to use the new FDs
        # With PTY, isatty() will return True!
        sys.stdout = io.TextIOWrapper(
            io.FileIO(1, mode='w', closefd=False),
            line_buffering=True
        )
        sys.stderr = io.TextIOWrapper(
            io.FileIO(2, mode='w', closefd=False),
            line_buffering=True
        )

        result = ExecutionResult()

        try:
            exec_result = self.shell.run_cell(code, store_history=store_history, silent=False)

            # Re-apply matplotlib hook after execution in case matplotlib was just imported
            self._ensure_matplotlib_hook()

            result.execution_count = self.shell.execution_count
            result.success = exec_result.success

            # Capture return value and trigger rich display if available
            if exec_result.result is not None:
                obj = exec_result.result
                try:
                    # Try to get rich representation and display it
                    if hasattr(obj, '_repr_html_'):
                        from IPython.display import display
                        display(obj)
                    elif hasattr(obj, '_repr_png_'):
                        from IPython.display import display
                        display(obj)
                    elif hasattr(obj, '_repr_svg_'):
                        from IPython.display import display
                        display(obj)

                    result.result = repr(obj)
                except Exception:
                    result.result = "<repr failed>"

            if exec_result.error_in_exec:
                result.error = self._format_exception(exec_result.error_in_exec)
                result.success = False
            elif exec_result.error_before_exec:
                result.error = self._format_exception(exec_result.error_before_exec)
                result.success = False

            result.display_data = self._captured_displays.copy()

        except KeyboardInterrupt:
            result.error = {"type": "KeyboardInterrupt", "message": "Interrupted", "traceback": ""}
            result.success = False
        except Exception as e:
            result.error = self._format_exception(e)
            result.success = False

        finally:
            # Flush Python buffers
            sys.stdout.flush()
            sys.stderr.flush()

            # Restore original FDs
            os.dup2(saved_stdout_fd, 1)
            os.dup2(saved_stderr_fd, 2)
            os.close(saved_stdout_fd)
            os.close(saved_stderr_fd)

            # Stop reader thread and wait
            stop_reader.set()
            reader.join(timeout=1.0)

            # Close master FDs
            os.close(stdout_master_fd)
            os.close(stderr_master_fd)

            # Restore Python sys.stdout/stderr
            sys.stdout = io.TextIOWrapper(
                io.FileIO(1, mode='w', closefd=False),
                line_buffering=True
            )
            sys.stderr = io.TextIOWrapper(
                io.FileIO(2, mode='w', closefd=False),
                line_buffering=True
            )

            result.stdout = ''.join(accumulated_stdout)
            result.stderr = ''.join(accumulated_stderr)
            self._current_exec_id = None  # Clear after execution

        return result

    def complete(self, code: str, cursor_pos: int) -> Dict[str, Any]:
        """Get completions."""
        self._ensure_initialized()

        try:
            from IPython.core.completer import provisionalcompleter

            with provisionalcompleter():
                completions = list(self.shell.Completer.completions(code, cursor_pos))

            if completions:
                return {
                    "matches": [c.text for c in completions],
                    "cursor_start": completions[0].start,
                    "cursor_end": completions[0].end,
                    "metadata": {
                        "types": [c.type for c in completions],
                    }
                }
        except Exception as e:
            return {"matches": [], "cursor_start": cursor_pos, "cursor_end": cursor_pos, "error": str(e)}

        return {"matches": [], "cursor_start": cursor_pos, "cursor_end": cursor_pos}

    def inspect(self, code: str, cursor_pos: int) -> Dict[str, Any]:
        """Get object info for hover."""
        self._ensure_initialized()

        try:
            name = self._extract_name_at_cursor(code, cursor_pos)
            if not name:
                return {"found": False}

            info = self.shell.object_inspect(name)
            if not info.get("found"):
                return {"found": False, "name": name}

            return {
                "found": True,
                "name": name,
                "docstring": info.get("docstring"),
                "type_name": info.get("type_name"),
                "signature": info.get("call_signature") or info.get("init_signature"),
            }
        except Exception:
            return {"found": False}

    def get_variables(self) -> List[Dict[str, Any]]:
        """Get user variables with type info."""
        self._ensure_initialized()

        variables = []
        user_ns = self.shell.user_ns

        skip_prefixes = ('_', 'In', 'Out', 'get_ipython', 'exit', 'quit')
        skip_types = (type(sys),)

        import builtins
        builtin_names = set(dir(builtins))

        for name, value in user_ns.items():
            if name.startswith(skip_prefixes):
                continue
            if isinstance(value, skip_types):
                continue
            if name in builtin_names:
                continue
            if callable(value) and hasattr(value, '__module__') and value.__module__ == 'builtins':
                continue

            try:
                var_info = {
                    'name': name,
                    'type': type(value).__name__,
                    'preview': self._get_preview(value),
                }

                if hasattr(value, 'shape'):
                    var_info['shape'] = str(value.shape)
                if hasattr(value, '__len__') and not isinstance(value, str):
                    try:
                        var_info['size'] = len(value)
                    except:
                        pass

                variables.append(var_info)
            except Exception:
                pass

        variables.sort(key=lambda v: v['name'])
        return variables

    def _get_preview(self, value) -> str:
        """Get a short preview of a value."""
        try:
            r = repr(value)
            if len(r) > 80:
                return r[:77] + '...'
            return r
        except Exception:
            return f"<{type(value).__name__}>"

    def reset(self):
        """Reset the namespace."""
        self._ensure_initialized()
        self.shell.reset()
        return {"success": True}

    def save_namespace(self, output_path: str) -> Dict[str, Any]:
        """
        Save the user namespace to disk using dill.

        Args:
            output_path: Path to save the namespace to (.dill.gz)

        Returns:
            Dict with save stats (saved_count, saved_names, errors, size)
        """
        self._ensure_initialized()

        try:
            import dill
            import gzip
            from pathlib import Path
        except ImportError:
            return {"success": False, "error": "dill is required. Install with: uv add dill"}

        # Filter namespace - skip internal IPython stuff
        skip_prefixes = ('_', 'In', 'Out', 'get_ipython', 'exit', 'quit')
        skip_names = {'__builtins__', '__name__', '__doc__'}

        to_save = {}
        errors = []

        for name, value in self.shell.user_ns.items():
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
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        try:
            with gzip.open(path, 'wb') as f:
                dill.dump(to_save, f)
            size = path.stat().st_size
        except Exception as e:
            return {"success": False, "error": str(e)}

        return {
            "success": True,
            "saved_count": len(to_save),
            "saved_names": list(to_save.keys()),
            "error_count": len(errors),
            "errors": errors[:10],  # Limit error reporting
            "size": size,
        }

    def load_namespace(self, input_path: str, merge: bool = True) -> Dict[str, Any]:
        """
        Load namespace from disk and restore into the session.

        Args:
            input_path: Path to the saved namespace (.dill.gz)
            merge: If True, merge with existing namespace. If False, reset first.

        Returns:
            Dict with load stats (loaded_count, loaded_names)
        """
        self._ensure_initialized()

        try:
            import dill
            import gzip
            from pathlib import Path
        except ImportError:
            return {"success": False, "error": "dill is required. Install with: uv add dill"}

        path = Path(input_path)
        if not path.exists():
            return {"success": False, "error": f"File not found: {input_path}"}

        try:
            with gzip.open(path, 'rb') as f:
                namespace = dill.load(f)
        except Exception as e:
            return {"success": False, "error": f"Failed to load: {e}"}

        if not merge:
            self.shell.reset()

        # Restore variables into user namespace
        loaded_names = []
        for name, value in namespace.items():
            try:
                self.shell.user_ns[name] = value
                loaded_names.append(name)
            except Exception as e:
                pass  # Skip variables that fail to restore

        return {
            "success": True,
            "loaded_count": len(loaded_names),
            "loaded_names": loaded_names,
        }

    def get_info(self) -> Dict[str, Any]:
        """Get info about this worker."""
        return {
            "python_executable": sys.executable,
            "python_version": sys.version,
            "cwd": os.getcwd(),
            "pid": os.getpid(),
        }

    def inspect_object(self, path: str) -> Dict[str, Any]:
        """
        Inspect an object by path for drill-down exploration.

        Args:
            path: Dot/bracket notation path like "df", "obj.attr", "mylist[0]"

        Returns:
            Dict with 'info' about the object and 'children' for expandable items
        """
        self._ensure_initialized()

        try:
            # Evaluate the path safely in the user namespace
            value = eval(path, {"__builtins__": {}}, self.shell.user_ns)
        except Exception as e:
            return {'error': str(e), 'path': path}

        result = {
            'path': path,
            'info': self._get_variable_info(path.split('.')[-1].split('[')[0], value),
            'children': []
        }

        type_name = type(value).__name__

        # Handle different types of expandable values
        if isinstance(value, dict):
            for i, (k, v) in enumerate(list(value.items())[:100]):
                child_path = f"{path}[{repr(k)}]"
                child_info = self._get_variable_info(repr(k), v)
                child_info['path'] = child_path
                child_info['key'] = k if isinstance(k, str) else repr(k)
                result['children'].append(child_info)

        elif isinstance(value, (list, tuple)):
            for i, item in enumerate(list(value)[:100]):
                child_path = f"{path}[{i}]"
                child_info = self._get_variable_info(f"[{i}]", item)
                child_info['path'] = child_path
                child_info['index'] = i
                result['children'].append(child_info)

        elif isinstance(value, (set, frozenset)):
            for i, item in enumerate(list(value)[:100]):
                child_info = self._get_variable_info(f"item", item)
                child_info['index'] = i
                result['children'].append(child_info)

        elif hasattr(value, 'shape') and hasattr(value, 'columns'):
            # DataFrame - show columns with sample values
            for col in list(value.columns)[:50]:
                child_path = f"{path}[{repr(col)}]"
                col_data = value[col]
                sample_vals = col_data.head(5).tolist()
                sample_str = ', '.join(self._safe_repr(v) for v in sample_vals)
                if len(col_data) > 5:
                    sample_str += ', ...'
                child_info = {
                    'name': str(col),
                    'type': str(col_data.dtype),
                    'kind': 'data',
                    'preview': f"[{sample_str}]",
                    'size': len(col_data),
                    'path': child_path,
                    'expandable': True
                }
                result['children'].append(child_info)

        elif hasattr(value, 'shape') and hasattr(value, 'dtype'):
            # numpy array or pandas Series
            try:
                flat = list(value.flatten()[:100]) if hasattr(value, 'flatten') else list(value)[:100]
                for i, v in enumerate(flat):
                    child_info = {
                        'name': f"[{i}]",
                        'type': type(v).__name__,
                        'kind': 'primitive' if isinstance(v, (int, float, str, bool, type(None))) else 'object',
                        'preview': self._safe_repr(v),
                        'expandable': not isinstance(v, (int, float, str, bool, type(None)))
                    }
                    result['children'].append(child_info)
                if hasattr(value, '__len__') and len(value) > 100:
                    result['children'].append({
                        'name': '...',
                        'type': '',
                        'kind': 'info',
                        'preview': f'({len(value) - 100} more)',
                        'expandable': False
                    })
            except Exception:
                pass

        elif isinstance(value, str) and len(value) > 50:
            result['info']['full_value'] = value

        elif isinstance(value, type):
            # Class - show methods and class attributes
            result['children'] = self._get_class_members(value, path)

        else:
            # Generic object - show attributes and methods
            result['children'] = self._get_object_members(value, path)

        return result

    def _get_variable_info(self, name: str, value: Any) -> Dict[str, Any]:
        """Get detailed info about a variable."""
        try:
            type_name = type(value).__name__
            module = getattr(type(value), '__module__', '')

            info = {
                'name': name,
                'type': type_name,
                'kind': self._classify_value(value),
            }

            if module and module not in ('', 'builtins'):
                info['module'] = module

            # Get shape/size for common data structures
            if hasattr(value, 'shape'):
                info['shape'] = str(value.shape)
                if hasattr(value, 'dtype'):
                    info['dtype'] = str(value.dtype)
                if hasattr(value, 'columns'):
                    info['preview'] = f"{value.shape[0]} rows × {value.shape[1]} cols"
                    info['kind'] = 'data'
                    info['expandable'] = True
                elif type_name == 'ndarray':
                    info['preview'] = f"array{value.shape}"
                    info['kind'] = 'data'
                    info['expandable'] = value.size > 0
                elif type_name == 'Series':
                    info['preview'] = f"Series ({value.shape[0]})"
                    info['kind'] = 'data'
                    info['expandable'] = True

            elif isinstance(value, dict):
                info['size'] = len(value)
                info['preview'] = f"{len(value)} items"
                info['kind'] = 'collection'
                info['expandable'] = len(value) > 0

            elif isinstance(value, (list, tuple)):
                info['size'] = len(value)
                info['preview'] = f"{len(value)} items"
                info['kind'] = 'collection'
                info['expandable'] = len(value) > 0

            elif isinstance(value, (set, frozenset)):
                info['size'] = len(value)
                info['preview'] = f"{len(value)} items"
                info['kind'] = 'collection'
                info['expandable'] = len(value) > 0

            elif isinstance(value, str):
                info['size'] = len(value)
                info['kind'] = 'primitive'
                info['preview'] = repr(value[:50]) + ('...' if len(value) > 50 else '')
                info['expandable'] = len(value) > 50

            elif isinstance(value, (int, float, complex, bool)) or value is None:
                info['preview'] = repr(value)
                info['kind'] = 'primitive'

            elif callable(value):
                info['kind'] = 'callable'
                import inspect
                try:
                    sig = inspect.signature(value)
                    info['signature'] = str(sig)
                    info['preview'] = f"{name}{sig}"
                except (ValueError, TypeError):
                    info['preview'] = f"{name}(...)"

                if isinstance(value, type):
                    info['kind'] = 'class'
                    info['preview'] = f"class {name}"
                    info['expandable'] = True

            else:
                info['kind'] = 'object'
                info['expandable'] = True
                info['preview'] = self._safe_repr(value)

            return info
        except Exception as e:
            return {'name': name, 'type': 'error', 'preview': str(e), 'kind': 'error'}

    def _classify_value(self, value: Any) -> str:
        """Classify a value into a category."""
        if value is None or isinstance(value, (bool, int, float, complex, str, bytes)):
            return 'primitive'
        if isinstance(value, (list, tuple, dict, set, frozenset)):
            return 'collection'
        if callable(value):
            return 'callable'
        if hasattr(value, 'shape'):
            return 'data'
        return 'object'

    def _get_object_members(self, obj: Any, base_path: str) -> List[Dict[str, Any]]:
        """Get attributes and methods of an object."""
        members = []

        for name in dir(obj):
            if name.startswith('_'):
                continue

            try:
                attr = getattr(obj, name)
            except Exception:
                continue

            member_info = self._get_variable_info(name, attr)
            if member_info:
                member_info['path'] = f"{base_path}.{name}"
                members.append(member_info)

        members.sort(key=lambda m: (0 if m.get('kind') != 'callable' else 1, m.get('name', '')))
        return members[:100]

    def _get_class_members(self, cls: type, base_path: str) -> List[Dict[str, Any]]:
        """Get class methods and attributes."""
        members = []

        for name in dir(cls):
            if name.startswith('_'):
                continue

            try:
                attr = getattr(cls, name)
            except Exception:
                continue

            member_info = self._get_variable_info(name, attr)
            if member_info:
                member_info['path'] = f"{base_path}.{name}"
                if isinstance(attr, classmethod):
                    member_info['decorator'] = 'classmethod'
                elif isinstance(attr, staticmethod):
                    member_info['decorator'] = 'staticmethod'
                elif isinstance(attr, property):
                    member_info['kind'] = 'property'
                    member_info['preview'] = 'property'
                members.append(member_info)

        members.sort(key=lambda m: (
            0 if m.get('kind') == 'property' else (1 if m.get('kind') != 'callable' else 2),
            m.get('name', '')
        ))
        return members[:100]

    def _safe_repr(self, value: Any) -> str:
        """Get a safe string representation."""
        try:
            type_name = type(value).__name__
            if type_name in ('int64', 'int32', 'float64', 'float32', 'bool_'):
                return str(value)
            r = repr(value)
            return r[:80] if len(r) > 80 else r
        except Exception:
            return f"<{type(value).__name__}>"

    def hover_inspect(self, name: str) -> Dict[str, Any]:
        """
        Get hover information for a variable/expression.

        Args:
            name: Variable name or expression to inspect

        Returns:
            Dict with found, name, type, value, docstring, signature
        """
        self._ensure_initialized()

        result = {
            'found': False,
            'name': name,
            'type': '',
            'value': '',
            'docstring': None,
            'signature': None,
        }

        try:
            value = eval(name, {"__builtins__": {}}, self.shell.user_ns)
            result['found'] = True
            result['type'] = type(value).__name__

            # Get value preview
            try:
                if hasattr(value, 'shape') and hasattr(value, 'head'):
                    if hasattr(value, 'columns'):
                        result['value'] = f"DataFrame {value.shape}\n{value.head(3).to_string()}"
                    else:
                        result['value'] = f"Series {value.shape}\n{value.head(5).to_string()}"
                elif hasattr(value, 'shape') and hasattr(value, 'dtype'):
                    flat = value.flatten()[:10]
                    preview = ', '.join(str(x) for x in flat)
                    if len(value.flatten()) > 10:
                        preview += ', ...'
                    result['value'] = f"array{value.shape} dtype={value.dtype}\n[{preview}]"
                elif isinstance(value, (list, tuple)):
                    preview = repr(value)
                    if len(preview) > 200:
                        preview = preview[:200] + '...'
                    result['value'] = f"{type(value).__name__}({len(value)} items)\n{preview}"
                elif isinstance(value, dict):
                    preview = repr(value)
                    if len(preview) > 200:
                        preview = preview[:200] + '...'
                    result['value'] = f"dict({len(value)} keys)\n{preview}"
                elif isinstance(value, str):
                    preview = repr(value)
                    if len(preview) > 200:
                        preview = preview[:200] + '...'
                    result['value'] = preview
                elif callable(value):
                    result['value'] = f"<{type(value).__name__}>"
                else:
                    preview = repr(value)
                    if len(preview) > 300:
                        preview = preview[:300] + '...'
                    result['value'] = preview
            except Exception:
                result['value'] = f"<{type(value).__name__}>"

            # Get docstring
            try:
                doc = getattr(value, '__doc__', None)
                if doc:
                    doc = doc.strip()
                    lines = doc.split('\n')
                    if len(lines) > 15:
                        doc = '\n'.join(lines[:15]) + '\n...'
                    elif len(doc) > 800:
                        doc = doc[:800] + '...'
                    result['docstring'] = doc
            except Exception:
                pass

            # Get signature for callables
            if callable(value):
                try:
                    import inspect
                    sig = inspect.signature(value)
                    result['signature'] = f"{name}{sig}"
                except Exception:
                    pass

        except Exception:
            result['found'] = False

        return result

    def is_complete(self, code: str) -> Dict[str, Any]:
        """Check if code is complete or needs more input."""
        self._ensure_initialized()

        try:
            status, indent = self.shell.input_transformer_manager.check_complete(code)
            return {
                "status": status,
                "indent": indent or "",
            }
        except Exception:
            return {
                "status": "unknown",
                "indent": "",
            }

    def _extract_name_at_cursor(self, code: str, cursor_pos: int) -> Optional[str]:
        """Extract Python name at cursor."""
        if cursor_pos > len(code):
            cursor_pos = len(code)

        start = cursor_pos
        while start > 0 and (code[start-1].isalnum() or code[start-1] in '_.'):
            start -= 1

        end = cursor_pos
        while end < len(code) and (code[end].isalnum() or code[end] == '_'):
            end += 1

        name = code[start:end]
        if name and (name[0].isalpha() or name[0] == '_'):
            return name
        return None

    def _format_exception(self, exc: Exception) -> Dict[str, Any]:
        """Format exception to dict."""
        tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
        return {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": "".join(tb_lines),
        }


def handle_request(worker: IPythonWorker, request: Dict[str, Any]) -> Dict[str, Any]:
    """Handle a single JSON-RPC request."""
    request_id = request.get("id", "unknown")
    method = request.get("method", "")
    params = request.get("params", {})

    try:
        if method == "execute":
            code = params.get("code", "")
            store_history = params.get("store_history", True)
            streaming = params.get("streaming", False)
            exec_id = params.get("exec_id")  # Execution ID for asset naming

            if streaming:
                result = worker.execute_streaming(code, request_id, store_history, exec_id=exec_id)
            else:
                result = worker.execute(code, store_history, exec_id=exec_id)

            return {"id": request_id, "result": asdict(result)}

        elif method == "complete":
            code = params.get("code", "")
            cursor_pos = params.get("cursor_pos", len(code))
            result = worker.complete(code, cursor_pos)
            return {"id": request_id, "result": result}

        elif method == "inspect":
            code = params.get("code", "")
            cursor_pos = params.get("cursor_pos", len(code))
            result = worker.inspect(code, cursor_pos)
            return {"id": request_id, "result": result}

        elif method == "variables":
            result = worker.get_variables()
            return {"id": request_id, "result": result}

        elif method == "reset":
            result = worker.reset()
            return {"id": request_id, "result": result}

        elif method == "info":
            result = worker.get_info()
            return {"id": request_id, "result": result}

        elif method == "inspect_object":
            path = params.get("path", "")
            result = worker.inspect_object(path)
            return {"id": request_id, "result": result}

        elif method == "hover":
            name = params.get("name", "")
            result = worker.hover_inspect(name)
            return {"id": request_id, "result": result}

        elif method == "is_complete":
            code = params.get("code", "")
            result = worker.is_complete(code)
            return {"id": request_id, "result": result}

        elif method == "save_namespace":
            output_path = params.get("output_path", "")
            if not output_path:
                return {"id": request_id, "error": {"type": "ValueError", "message": "output_path required"}}
            result = worker.save_namespace(output_path)
            return {"id": request_id, "result": result}

        elif method == "load_namespace":
            input_path = params.get("input_path", "")
            merge = params.get("merge", True)
            if not input_path:
                return {"id": request_id, "error": {"type": "ValueError", "message": "input_path required"}}
            result = worker.load_namespace(input_path, merge)
            return {"id": request_id, "result": result}

        elif method == "ping":
            return {"id": request_id, "result": {"pong": True}}

        elif method == "set_config":
            # Dynamic configuration update for running worker.
            # This is called by the parent process when settings change after
            # the worker has already started (e.g., user opens a project).
            #
            # IMPORTANT: This is the key to making matplotlib work when the kernel
            # starts before the user opens a project. The figure_dir gets set here
            # via RPC from SubprocessIPythonSession._update_figure_dir().
            figure_dir = params.get("figure_dir")
            if figure_dir:
                worker.figure_dir = figure_dir
                # Re-setup matplotlib hook - the hook closure references worker.figure_dir
                # so it will use the new value on next plt.show() call
                worker._setup_matplotlib_hook()
            return {"id": request_id, "result": {"success": True}}

        else:
            return {"id": request_id, "error": {"type": "MethodNotFound", "message": f"Unknown method: {method}"}}

    except Exception as e:
        return {
            "id": request_id,
            "error": {
                "type": type(e).__name__,
                "message": str(e),
                "traceback": traceback.format_exc(),
            }
        }


def main():
    """Main loop - read JSON requests from stdin, write responses to stdout."""
    import argparse

    parser = argparse.ArgumentParser(description="IPython worker process")
    parser.add_argument("--cwd", help="Working directory")
    parser.add_argument("--figure-dir", help="Directory to save figures")
    args = parser.parse_args()

    worker = IPythonWorker(cwd=args.cwd, figure_dir=args.figure_dir)

    # Handle SIGINT gracefully
    def handle_sigint(sig, frame):
        worker._interrupt_requested = True
        raise KeyboardInterrupt()

    signal.signal(signal.SIGINT, handle_sigint)

    # Send ready message via original stdout FD
    _write_to_parent(json.dumps({"status": "ready", "python": sys.executable, "pid": os.getpid()}))

    # Main loop - read from stdin (which is still the original)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            response = {"error": {"type": "JSONDecodeError", "message": str(e)}}
            _write_to_parent(json.dumps(response))
            continue

        response = handle_request(worker, request)
        _write_to_parent(json.dumps(response))


if __name__ == "__main__":
    main()

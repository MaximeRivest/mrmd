"""
Direct IPython shell integration for rich completion, inspection, and execution.

This provides a cleaner interface than terminal-based execution when working
with Python/IPython specifically. Used alongside brepl for best-of-both-worlds.
"""

import sys
import io
import asyncio
import traceback
import base64
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from pathlib import Path


@dataclass
class SavedAsset:
    """A saved asset file."""
    path: str  # Absolute path to the file
    mime_type: str  # e.g., "image/png", "image/svg+xml", "text/html"
    asset_type: str  # "image", "svg", "html"


@dataclass
class ExecutionResult:
    """Result from executing code."""
    stdout: str = ""
    stderr: str = ""
    result: Optional[str] = None  # repr of return value
    error: Optional[Dict[str, Any]] = None
    display_data: List[Dict[str, Any]] = field(default_factory=list)  # Rich outputs
    execution_count: int = 0
    success: bool = True
    saved_figures: List[str] = field(default_factory=list)  # Paths to saved plot files (legacy)
    saved_assets: List[SavedAsset] = field(default_factory=list)  # All saved assets


@dataclass
class CompletionResult:
    """Result from completion request."""
    matches: List[str] = field(default_factory=list)
    cursor_start: int = 0
    cursor_end: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class InspectionResult:
    """Result from inspection request."""
    found: bool = False
    name: str = ""
    docstring: Optional[str] = None
    signature: Optional[str] = None
    type_name: Optional[str] = None
    source: Optional[str] = None


class IPythonSession:
    """
    Wraps an IPython InteractiveShell for direct programmatic access.

    Provides:
    - Code execution with captured stdout/stderr
    - Tab completion with types
    - Object inspection for hover
    - Rich output capture (plots, HTML, etc.)
    """

    def __init__(self, cwd: Optional[str] = None):
        self.cwd = cwd
        self.shell = None
        self.display_pub = None
        self._captured_displays: List[Dict[str, Any]] = []
        self._initialized = False
        self._interrupt_requested = False
        self._figure_dir: Optional[Path] = None  # Directory to save figures
        self._figure_counter = 0  # Counter for unique figure names
        self._saved_figures: List[str] = []  # Figures saved during current execution

    def _ensure_initialized(self):
        """Lazy initialization of IPython shell."""
        if self._initialized:
            return

        # Import IPython components
        from IPython.core.interactiveshell import InteractiveShell
        from IPython.core.displaypub import DisplayPublisher

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

        # Set up matplotlib hook for auto-saving figures
        self._setup_matplotlib_hook()

        # Set up Plotly for HTML output
        self._setup_plotly_renderer()

        # Register custom %pip magic that uses uv
        self._register_uv_pip_magic()

        # Change to working directory if specified
        if self.cwd:
            import os
            os.chdir(self.cwd)

        self._initialized = True

    def _setup_plotly_renderer(self):
        """
        Configure Plotly to render as HTML that works with our display system.

        Sets up Plotly to use 'notebook' renderer which outputs HTML with
        embedded plotly.js, suitable for capture via IPython's display system.
        """
        try:
            import plotly.io as pio

            # Use 'notebook' renderer which outputs HTML via IPython's display system
            # This renderer includes the plotly.js library inline for self-contained output
            pio.renderers.default = 'notebook'

            # Alternative: 'plotly_mimetype+notebook' for notebook-style output
            # pio.renderers.default = 'plotly_mimetype+notebook'

        except ImportError:
            # Plotly not installed, skip
            pass

    def _register_uv_pip_magic(self):
        """
        Register custom %pip and %uv magics that install packages into the
        current Python environment using uv.
        """
        import subprocess
        import shutil

        python_executable = sys.executable

        def pip_magic(line):
            """
            Install packages using uv pip into the current environment.

            Usage:
                %pip install package1 package2
                %pip install -r requirements.txt
                %pip uninstall package
                %pip list
            """
            # Check if uv is available
            uv_path = shutil.which('uv')
            if not uv_path:
                print("Error: uv not found. Please install uv first: https://docs.astral.sh/uv/")
                return

            # Build the uv pip command
            # -p/--python must come after the subcommand (install, uninstall, etc.)
            args = line.split()
            if args:
                # Insert -p after the subcommand (e.g., "install -p python pkg")
                subcommand = args[0]
                rest = args[1:]
                cmd = [uv_path, 'pip', subcommand, '-p', python_executable] + rest
            else:
                cmd = [uv_path, 'pip']

            print(f"Running: uv pip {' '.join(args[:1])} -p {python_executable} {' '.join(args[1:])}")
            print("-" * 50)

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=False,
                    text=True,
                )
                if result.returncode != 0:
                    print(f"\nCommand exited with code {result.returncode}")
            except Exception as e:
                print(f"Error running uv pip: {e}")

            print("-" * 50)
            print("Note: You may need to restart the kernel to use newly installed packages.")

        def uv_magic(line):
            """
            Run uv commands directly.

            Usage:
                %uv pip install package
                %uv pip list
                %uv python list
            """
            uv_path = shutil.which('uv')
            if not uv_path:
                print("Error: uv not found. Please install uv first: https://docs.astral.sh/uv/")
                return

            args = line.split()

            # If it's a pip command, inject the -p flag after the subcommand
            if len(args) >= 2 and args[0] == 'pip':
                # e.g., "pip install pkg" -> "pip install -p python pkg"
                subcommand = args[1]
                rest = args[2:]
                args = ['pip', subcommand, '-p', python_executable] + rest

            cmd = [uv_path] + args

            print(f"Running: uv {' '.join(args)}")
            print("-" * 50)

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=False,
                    text=True,
                )
                if result.returncode != 0:
                    print(f"\nCommand exited with code {result.returncode}")
            except Exception as e:
                print(f"Error running uv: {e}")

        # Register with the shell directly (don't use decorators)
        self.shell.register_magic_function(pip_magic, 'line', 'pip')
        self.shell.register_magic_function(uv_magic, 'line', 'uv')

    def _setup_matplotlib_hook(self):
        """
        Set up matplotlib to save figures as assets.

        Uses matplotlib's Agg backend and hooks plt.show() to save figures
        to the assets directory instead of displaying them.
        """
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            from io import BytesIO

            session = self

            def _hooked_show(*args, **kwargs):
                """Save all open figures as assets when show() is called."""
                if session._figure_dir:
                    session._figure_dir.mkdir(parents=True, exist_ok=True)

                    for num in plt.get_fignums():
                        fig = plt.figure(num)

                        # Save to buffer first
                        buf = BytesIO()
                        fig.savefig(buf, format='png', dpi=150,
                                   bbox_inches='tight',
                                   facecolor='white', edgecolor='none')
                        buf.seek(0)
                        png_bytes = buf.getvalue()

                        # Save as asset
                        session._figure_counter += 1
                        filename = f"figure_{session._figure_counter:04d}.png"
                        filepath = session._figure_dir / filename
                        filepath.write_bytes(png_bytes)

                        # Record as asset reference (new format)
                        session._captured_displays.append({
                            "asset": {
                                "path": str(filepath),
                                "mime_type": "image/png",
                                "type": "image"
                            }
                        })

                        # Also track in saved_figures for backward compatibility
                        session._saved_figures.append(str(filepath))

                # Close all figures to free memory
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

        # Check if already hooked
        if hasattr(plt.show, '_mrmd_hooked'):
            return

        session = self

        def _hooked_show(*args, **kwargs):
            """Save all open figures as assets when show() is called."""
            if session._figure_dir:
                from io import BytesIO

                session._figure_dir.mkdir(parents=True, exist_ok=True)

                for num in plt.get_fignums():
                    fig = plt.figure(num)

                    # Save to buffer first
                    buf = BytesIO()
                    fig.savefig(buf, format='png', dpi=150,
                               bbox_inches='tight',
                               facecolor='white', edgecolor='none')
                    buf.seek(0)
                    png_bytes = buf.getvalue()

                    # Save as asset
                    session._figure_counter += 1
                    filename = f"figure_{session._figure_counter:04d}.png"
                    filepath = session._figure_dir / filename
                    filepath.write_bytes(png_bytes)

                    # Record as asset reference
                    session._captured_displays.append({
                        "asset": {
                            "path": str(filepath),
                            "mime_type": "image/png",
                            "type": "image"
                        }
                    })

                    # Also track in saved_figures for backward compatibility
                    session._saved_figures.append(str(filepath))

            # Close all figures to free memory
            plt.close('all')

        # Mark as hooked so we don't re-hook
        _hooked_show._mrmd_hooked = True

        plt.show = _hooked_show

    def set_figure_directory(self, path: Optional[str]):
        """
        Set the directory where figures/assets should be saved.

        Args:
            path: Absolute path to assets directory, or None to disable saving
        """
        if path:
            self._figure_dir = Path(path)
        else:
            self._figure_dir = None

    def _save_asset(self, content: bytes, mime_type: str, extension: str) -> Optional[str]:
        """Save binary content as an asset file."""
        if not self._figure_dir:
            return None

        self._figure_dir.mkdir(parents=True, exist_ok=True)
        self._figure_counter += 1
        filename = f"output_{self._figure_counter:04d}.{extension}"
        filepath = self._figure_dir / filename
        filepath.write_bytes(content)
        return str(filepath)

    def _save_text_asset(self, content: str, mime_type: str, extension: str) -> Optional[str]:
        """Save text content as an asset file."""
        if not self._figure_dir:
            return None

        self._figure_dir.mkdir(parents=True, exist_ok=True)
        self._figure_counter += 1
        filename = f"output_{self._figure_counter:04d}.{extension}"
        filepath = self._figure_dir / filename
        filepath.write_text(content, encoding='utf-8')
        return str(filepath)

    def _wrap_html_standalone(self, html_content: str, title: str = "Output") -> str:
        """Wrap HTML content in a standalone document with appropriate styling/scripts."""
        # Check if this looks like Plotly output
        is_plotly = 'plotly' in html_content.lower() or 'Plotly.newPlot' in html_content

        if is_plotly:
            return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        body {{ margin: 0; padding: 0; }}
        .plotly-graph-div {{ width: 100%; height: 100%; }}
    </style>
</head>
<body>
{html_content}
</body>
</html>"""
        else:
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

    def _save_display_data_to_files(self) -> List[SavedAsset]:
        """
        Process captured displays and extract SavedAsset info.

        With the new asset-based display capture, most rich content is already
        saved as files. This method extracts SavedAsset objects from the
        captured displays for the ExecutionResult.
        """
        if not self._captured_displays:
            return []

        saved_assets = []

        for display in self._captured_displays:
            # New format: asset reference
            if "asset" in display:
                asset = display["asset"]
                saved_assets.append(SavedAsset(
                    path=asset["path"],
                    mime_type=asset["mime_type"],
                    asset_type=asset["type"]
                ))

        return saved_assets

    def _setup_display_capture(self):
        """
        Set up capture of rich display outputs with asset-based storage.

        This intercepts IPython's display system and saves rich outputs
        (images, HTML, SVG) as asset files rather than embedding them inline.
        """
        session = self

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
                        png_bytes = base64.b64decode(png_data)
                    else:
                        png_bytes = png_data

                    filepath = session._save_asset(png_bytes, 'image/png', 'png')
                    if filepath:
                        session._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/png",
                                "type": "image"
                            }
                        })
                    else:
                        session._captured_displays.append({
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

                    filepath = session._save_asset(jpeg_bytes, 'image/jpeg', 'jpg')
                    if filepath:
                        session._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/jpeg",
                                "type": "image"
                            }
                        })
                    else:
                        session._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle image/svg+xml
                if 'image/svg+xml' in data:
                    svg_content = data['image/svg+xml']
                    if isinstance(svg_content, bytes):
                        svg_content = svg_content.decode('utf-8')

                    filepath = session._save_text_asset(svg_content, 'image/svg+xml', 'svg')
                    if filepath:
                        session._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "image/svg+xml",
                                "type": "svg"
                            }
                        })
                    else:
                        session._captured_displays.append({
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
                    if len(html_content.strip()) < 50 and '<' not in html_content[10:]:
                        if 'text/plain' in data:
                            session._captured_displays.append({
                                "data": {"text/plain": data['text/plain']},
                                "metadata": metadata,
                            })
                        return

                    # Wrap in standalone HTML document
                    standalone_html = session._wrap_html_standalone(html_content)
                    filepath = session._save_text_asset(standalone_html, 'text/html', 'html')

                    if filepath:
                        session._captured_displays.append({
                            "asset": {
                                "path": filepath,
                                "mime_type": "text/html",
                                "type": "html"
                            }
                        })
                    else:
                        session._captured_displays.append({
                            "data": data,
                            "metadata": metadata,
                        })
                    return

                # Handle text/plain and other types - keep inline
                if 'text/plain' in data:
                    session._captured_displays.append({
                        "data": {"text/plain": data['text/plain']},
                        "metadata": metadata,
                    })
                    return

                # Unknown type - pass through
                if data:
                    session._captured_displays.append({
                        "data": data,
                        "metadata": metadata,
                    })

            def clear_output(self, wait=False):
                pass

        self.shell.display_pub = AssetCapturingDisplayPublisher(self.shell)

    def execute(self, code: str, store_history: bool = True) -> ExecutionResult:
        """
        Execute code and return structured result.

        Args:
            code: Python code to execute
            store_history: Whether to add to IPython history

        Returns:
            ExecutionResult with stdout, stderr, result, errors, display_data
        """
        self._ensure_initialized()

        # Clear captured displays and saved figures
        self._captured_displays = []
        self._saved_figures = []

        # Capture stdout/stderr
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = captured_stdout = io.StringIO()
        sys.stderr = captured_stderr = io.StringIO()

        result = ExecutionResult()

        try:
            # Execute the code
            exec_result = self.shell.run_cell(
                code,
                store_history=store_history,
                silent=False,
            )

            # Re-apply matplotlib hook after execution in case matplotlib was just imported
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

            # Capture error
            if exec_result.error_in_exec:
                result.error = self._format_exception(exec_result.error_in_exec)
                result.success = False
            elif exec_result.error_before_exec:
                result.error = self._format_exception(exec_result.error_before_exec)
                result.success = False

            # Capture display data (plots, etc.)
            result.display_data = self._captured_displays.copy()

            # Save display data to files and capture paths
            result.saved_assets = self._save_display_data_to_files()

            # Add matplotlib figures saved via plt.show() hook to saved_assets
            for fig_path in self._saved_figures:
                result.saved_assets.append(SavedAsset(
                    path=fig_path,
                    mime_type="image/png",
                    asset_type="image"
                ))

            # Legacy: also populate saved_figures
            result.saved_figures = self._saved_figures.copy()

        except Exception as e:
            result.error = self._format_exception(e)
            result.success = False

        finally:
            # Restore stdout/stderr
            sys.stdout, sys.stderr = old_stdout, old_stderr
            result.stdout = captured_stdout.getvalue()
            result.stderr = captured_stderr.getvalue()

        return result

    def create_streaming_context(self, queue: "Queue"):
        """
        Create a streaming context that sends output to a queue.

        Args:
            queue: A queue.Queue to send chunks to

        Returns:
            Context manager for streaming execution
        """
        import queue as queue_module
        session = self

        class StreamingIO(io.StringIO):
            """Custom IO that sends output to queue in real-time."""

            def __init__(self, stream_type: str, output_queue: queue_module.Queue):
                super().__init__()
                self.stream_type = stream_type
                self.output_queue = output_queue
                self._line_buffer = ""

            def write(self, s: str) -> int:
                result = super().write(s)
                self._line_buffer += s

                # Send on newlines or carriage returns (for progress bars)
                if '\n' in s or '\r' in s:
                    self.output_queue.put({
                        'type': 'chunk',
                        'stream': self.stream_type,
                        'content': self._line_buffer
                    })
                    self._line_buffer = ""

                return result

            def flush(self):
                super().flush()
                # Also flush our buffer
                if self._line_buffer:
                    self.output_queue.put({
                        'type': 'chunk',
                        'stream': self.stream_type,
                        'content': self._line_buffer
                    })
                    self._line_buffer = ""

        class StreamingContext:
            def __init__(self, session, queue):
                self.session = session
                self.queue = queue
                self.old_stdout = None
                self.old_stderr = None
                self.streaming_stdout = None
                self.streaming_stderr = None

            def __enter__(self):
                self.session._ensure_initialized()
                self.session._captured_displays = []

                self.old_stdout = sys.stdout
                self.old_stderr = sys.stderr
                self.streaming_stdout = StreamingIO('stdout', self.queue)
                self.streaming_stderr = StreamingIO('stderr', self.queue)
                sys.stdout = self.streaming_stdout
                sys.stderr = self.streaming_stderr
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                # Flush any remaining output
                self.streaming_stdout.flush()
                self.streaming_stderr.flush()

                # Restore
                sys.stdout = self.old_stdout
                sys.stderr = self.old_stderr
                return False

            def get_captured_output(self):
                return (
                    self.streaming_stdout.getvalue(),
                    self.streaming_stderr.getvalue()
                )

        return StreamingContext(self, queue)

    def execute_with_queue(self, code: str, queue: "Queue", store_history: bool = True):
        """
        Execute code, sending output chunks to a queue in real-time.

        Args:
            code: Python code to execute
            queue: Queue to send chunks to (put {'type': 'chunk', 'content': ...})
            store_history: Whether to add to IPython history

        Sends to queue:
            - {'type': 'chunk', 'stream': 'stdout'|'stderr', 'content': str}
            - {'type': 'result', 'data': ExecutionResult}
            - {'type': 'done'}
        """
        result = ExecutionResult()

        # Clear any pending interrupt and saved figures
        self.clear_interrupt()
        self._saved_figures = []

        try:
            with self.create_streaming_context(queue) as ctx:
                # Execute the code
                exec_result = self.shell.run_cell(
                    code,
                    store_history=store_history,
                    silent=False,
                )

                result.execution_count = self.shell.execution_count
                result.success = exec_result.success

                # Capture return value
                if exec_result.result is not None:
                    try:
                        result.result = repr(exec_result.result)
                    except Exception:
                        result.result = "<repr failed>"

                # Capture error
                if exec_result.error_in_exec:
                    result.error = self._format_exception(exec_result.error_in_exec)
                    result.success = False
                elif exec_result.error_before_exec:
                    result.error = self._format_exception(exec_result.error_before_exec)
                    result.success = False

                # Capture display data
                result.display_data = self._captured_displays.copy()

                # Save display data to files and capture paths
                result.saved_assets = self._save_display_data_to_files()

                # Add matplotlib figures saved via plt.show() hook to saved_assets
                for fig_path in self._saved_figures:
                    result.saved_assets.append(SavedAsset(
                        path=fig_path,
                        mime_type="image/png",
                        asset_type="image"
                    ))

                # Legacy: also populate saved_figures
                result.saved_figures = self._saved_figures.copy()

                # Get captured output
                result.stdout, result.stderr = ctx.get_captured_output()

        except KeyboardInterrupt:
            result.error = {
                "type": "KeyboardInterrupt",
                "message": "Execution interrupted by user",
                "traceback": "",
            }
            result.success = False
        except Exception as e:
            result.error = self._format_exception(e)
            result.success = False
        finally:
            # Clear interrupt flag after execution
            self.clear_interrupt()

        # Send final result
        queue.put({'type': 'result', 'data': result})
        queue.put({'type': 'done'})

    def complete(self, code: str, cursor_pos: int) -> CompletionResult:
        """
        Get completions at cursor position.

        Args:
            code: The code being typed
            cursor_pos: Cursor position in the code

        Returns:
            CompletionResult with matches and position info
        """
        self._ensure_initialized()

        result = CompletionResult()

        try:
            from IPython.core.completer import provisionalcompleter, completions_sorting_key

            # Use the provisional completer API for rich completions
            with provisionalcompleter():
                completions = list(self.shell.Completer.completions(code, cursor_pos))

            if completions:
                # Sort using IPython's sorting algorithm
                completions_sorted = sorted(completions, key=lambda c: completions_sorting_key(c.text))
                result.matches = [c.text for c in completions_sorted]
                # All completions share the same cursor range
                result.cursor_start = completions_sorted[0].start
                result.cursor_end = completions_sorted[0].end
                # Include type info in metadata (maintain sorted order)
                result.metadata["types"] = [c.type for c in completions_sorted]
                result.metadata["signatures"] = [c.signature for c in completions_sorted if c.signature]

        except Exception as e:
            result.metadata["error"] = str(e)

        return result

    def inspect(self, code: str, cursor_pos: int) -> InspectionResult:
        """
        Get object information for hover/inspection.

        Args:
            code: The code containing the object
            cursor_pos: Cursor position (on or after the object name)

        Returns:
            InspectionResult with docstring, signature, type info
        """
        self._ensure_initialized()

        result = InspectionResult()

        try:
            # Extract the name at cursor position
            name = self._extract_name_at_cursor(code, cursor_pos)
            if not name:
                return result

            result.name = name

            # Get object info from IPython
            info = self.shell.object_inspect(name)

            result.found = info.get("found", False)

            if result.found:
                result.docstring = info.get("docstring")
                result.type_name = info.get("type_name")

                # Get signature if callable
                if info.get("isalias"):
                    result.signature = info.get("definition")
                elif info.get("call_signature"):
                    result.signature = f"{name}{info['call_signature']}"
                elif info.get("init_signature"):
                    result.signature = f"{name}{info['init_signature']}"
                elif info.get("signature"):
                    result.signature = str(info["signature"])

                # Get source if available
                result.source = info.get("source")

        except Exception as e:
            result.found = False

        return result

    def is_complete(self, code: str) -> Dict[str, Any]:
        """
        Check if code is complete or needs more input.

        Args:
            code: The code to check

        Returns:
            Dict with 'status' ("complete", "incomplete", "invalid") and 'indent'
        """
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

    def get_namespace(self) -> Dict[str, Any]:
        """Get the current namespace (variables)."""
        self._ensure_initialized()
        return dict(self.shell.user_ns)

    def get_variables(self) -> List[Dict[str, Any]]:
        """
        Get user variables with type info and previews.
        Like RStudio's Environment pane.
        """
        self._ensure_initialized()

        variables = []
        user_ns = self.shell.user_ns

        # Filter out IPython internals and modules
        skip_prefixes = ('_', 'In', 'Out', 'get_ipython', 'exit', 'quit')
        skip_types = (type(sys), )  # Skip modules
        # Known builtins that may appear in namespace
        import builtins
        builtin_names = set(dir(builtins))

        for name, value in user_ns.items():
            # Skip internal/private names
            if name.startswith(skip_prefixes):
                continue
            if isinstance(value, skip_types):
                continue
            # Skip known builtins by name
            if name in builtin_names:
                continue
            # Skip callables that are builtins
            if callable(value) and hasattr(value, '__module__') and value.__module__ == 'builtins':
                continue

            var_info = self._get_variable_info(name, value)
            if var_info:
                variables.append(var_info)

        # Sort by name
        variables.sort(key=lambda v: v['name'])
        return variables

    def _get_variable_info(self, name: str, value: Any, depth: int = 0) -> Optional[Dict[str, Any]]:
        """
        Get serializable info about a variable.

        Args:
            name: Variable name
            value: The value to inspect
            depth: Current nesting depth (0 = top level)
        """
        try:
            type_name = type(value).__name__
            module = getattr(type(value), '__module__', '')

            # Full qualified type for non-builtins
            if module and module != 'builtins':
                full_type = f"{module}.{type_name}"
            else:
                full_type = type_name

            info = {
                'name': name,
                'type': type_name,
                'kind': self._classify_value(value),  # 'primitive', 'collection', 'object', 'callable', 'data'
            }

            # Add full type path for objects
            if info['kind'] == 'object' and module not in ('', 'builtins'):
                info['module'] = module

            # Get shape/size for common data structures
            if hasattr(value, 'shape'):
                # numpy array, pandas DataFrame/Series
                info['shape'] = str(value.shape)
                if hasattr(value, 'dtype'):
                    info['dtype'] = str(value.dtype)
                if hasattr(value, 'columns'):
                    # DataFrame
                    info['columns'] = list(value.columns)[:20]
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
                else:
                    info['preview'] = f"{type_name}{value.shape}"
                    info['expandable'] = True

            elif isinstance(value, dict):
                info['size'] = len(value)
                info['preview'] = f"{len(value)} items" if len(value) != 1 else "1 item"
                info['kind'] = 'collection'
                info['expandable'] = len(value) > 0
                # Include keys preview for small dicts
                if len(value) <= 5:
                    info['keys'] = [str(k)[:30] for k in list(value.keys())]

            elif isinstance(value, (list, tuple)):
                info['size'] = len(value)
                info['preview'] = f"{len(value)} items" if len(value) != 1 else "1 item"
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
                if len(value) <= 50:
                    info['preview'] = repr(value)
                else:
                    info['preview'] = repr(value[:47] + '...')
                info['expandable'] = len(value) > 50

            elif isinstance(value, (int, float, complex)):
                info['preview'] = repr(value)
                info['kind'] = 'primitive'

            elif isinstance(value, bool):
                info['preview'] = repr(value)
                info['kind'] = 'primitive'

            elif value is None:
                info['preview'] = 'None'
                info['kind'] = 'primitive'

            elif callable(value):
                info['kind'] = 'callable'
                # Get signature if possible
                import inspect
                try:
                    sig = inspect.signature(value)
                    info['signature'] = str(sig)
                    info['preview'] = f"{name}{sig}"
                except (ValueError, TypeError):
                    info['preview'] = f"{name}(...)"

                # First line of docstring
                if hasattr(value, '__doc__') and value.__doc__:
                    doc = value.__doc__.strip()
                    first_line = doc.split('\n')[0][:100]
                    if first_line:
                        info['doc'] = first_line

                # Is it a class?
                if isinstance(value, type):
                    info['kind'] = 'class'
                    info['preview'] = f"class {name}"
                    info['expandable'] = True

            else:
                # Generic object - this is important for Python OOP
                info['kind'] = 'object'
                info['expandable'] = True

                # Try to get a meaningful preview
                try:
                    r = repr(value)
                    if len(r) <= 60:
                        info['preview'] = r
                    else:
                        info['preview'] = r[:57] + '...'
                except Exception:
                    info['preview'] = f"<{type_name}>"

                # Count public attributes for preview
                attrs = [a for a in dir(value) if not a.startswith('_')]
                methods = sum(1 for a in attrs if callable(getattr(value, a, None)))
                data_attrs = len(attrs) - methods
                if data_attrs > 0 or methods > 0:
                    parts = []
                    if data_attrs > 0:
                        parts.append(f"{data_attrs} attr{'s' if data_attrs > 1 else ''}")
                    if methods > 0:
                        parts.append(f"{methods} method{'s' if methods > 1 else ''}")
                    info['members'] = ', '.join(parts)

            return info
        except Exception as e:
            return {'name': name, 'type': 'error', 'preview': str(e), 'kind': 'error'}

    def _classify_value(self, value: Any) -> str:
        """Classify a value into a category for UI rendering."""
        if value is None or isinstance(value, (bool, int, float, complex, str, bytes)):
            return 'primitive'
        if isinstance(value, (list, tuple, dict, set, frozenset)):
            return 'collection'
        if callable(value):
            return 'callable'
        if hasattr(value, 'shape'):  # numpy/pandas
            return 'data'
        return 'object'

    def inspect_object(self, path: str) -> Dict[str, Any]:
        """
        Inspect an object by path (e.g., "df", "obj.attr", "mylist[0]").
        Returns detailed info including attributes and methods.

        Args:
            path: Dot/bracket notation path to object

        Returns:
            Dict with 'value' info and 'children' for expandable items
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
            # Show dict items
            for i, (k, v) in enumerate(list(value.items())[:100]):
                child_path = f"{path}[{repr(k)}]"
                child_info = self._get_variable_info(repr(k), v)
                child_info['path'] = child_path
                child_info['key'] = k if isinstance(k, str) else repr(k)
                result['children'].append(child_info)

        elif isinstance(value, (list, tuple)):
            # Show indexed items
            for i, item in enumerate(list(value)[:100]):
                child_path = f"{path}[{i}]"
                child_info = self._get_variable_info(f"[{i}]", item)
                child_info['path'] = child_path
                child_info['index'] = i
                result['children'].append(child_info)

        elif isinstance(value, (set, frozenset)):
            # Sets aren't indexable, just show items
            for i, item in enumerate(list(value)[:100]):
                child_info = self._get_variable_info(f"item", item)
                child_info['index'] = i
                result['children'].append(child_info)

        elif hasattr(value, 'shape') and hasattr(value, 'columns'):
            # DataFrame - show columns with sample values
            for col in list(value.columns)[:50]:
                child_path = f"{path}[{repr(col)}]"
                col_data = value[col]
                # Show first few values as preview
                sample_vals = col_data.head(5).tolist()
                sample_str = ', '.join(self._safe_repr(v) for v in sample_vals)
                if len(col_data) > 5:
                    sample_str += ', ...'
                child_info = {
                    'name': str(col),
                    'type': str(col_data.dtype),
                    'kind': 'data',
                    'preview': f"[{sample_str}]",
                    'members': f"{len(col_data)} values",
                    'path': child_path,
                    'expandable': True
                }
                result['children'].append(child_info)

        elif hasattr(value, 'dtype') and hasattr(value, 'tolist'):
            # pandas Series or numpy array with dtype - show actual values
            try:
                vals = list(value)[:100]  # Limit to 100 values
                for i, v in enumerate(vals):
                    child_path = f"{path}[{i}]" if hasattr(value, 'iloc') else f"{path}[{i}]"
                    child_info = {
                        'name': f"[{i}]",
                        'type': type(v).__name__,
                        'kind': 'primitive' if isinstance(v, (int, float, str, bool, type(None))) else 'object',
                        'preview': self._safe_repr(v),
                        'path': child_path,
                        'expandable': not isinstance(v, (int, float, str, bool, type(None)))
                    }
                    result['children'].append(child_info)
                if len(value) > 100:
                    result['children'].append({
                        'name': '...',
                        'type': '',
                        'kind': 'info',
                        'preview': f'({len(value) - 100} more values)',
                        'expandable': False
                    })
            except Exception:
                # Fallback for arrays that can't be iterated easily
                result['info']['shape_detail'] = list(value.shape) if hasattr(value, 'shape') else None
                result['info']['dtype'] = str(value.dtype)
                flat = value.flatten()[:10] if hasattr(value, 'flatten') else list(value)[:10]
                result['info']['sample'] = [self._safe_repr(x) for x in flat]

        elif hasattr(value, 'shape'):
            # numpy array without dtype attr - show shape info and sample values as children
            result['info']['shape_detail'] = list(value.shape)
            if hasattr(value, 'dtype'):
                result['info']['dtype'] = str(value.dtype)
            # Show values as children for 1D arrays
            try:
                flat = value.flatten()[:100]
                for i, v in enumerate(flat):
                    child_info = {
                        'name': f"[{i}]",
                        'type': type(v).__name__,
                        'kind': 'primitive',
                        'preview': self._safe_repr(v),
                        'expandable': False
                    }
                    result['children'].append(child_info)
                if len(value.flatten()) > 100:
                    result['children'].append({
                        'name': '...',
                        'type': '',
                        'kind': 'info',
                        'preview': f'({len(value.flatten()) - 100} more values)',
                        'expandable': False
                    })
            except Exception:
                # Fallback - just show sample in info
                flat = value.flatten()[:10]
                result['info']['sample'] = [self._safe_repr(x) for x in flat]

        elif isinstance(value, str) and len(value) > 50:
            # Long string - show full value
            result['info']['full_value'] = value

        elif isinstance(value, type):
            # Class - show methods and class attributes
            result['children'] = self._get_class_members(value, path)

        else:
            # Generic object - show attributes and methods
            result['children'] = self._get_object_members(value, path)

        return result

    def _get_object_members(self, obj: Any, base_path: str) -> List[Dict[str, Any]]:
        """Get attributes and methods of an object."""
        members = []

        # Get all public attributes
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

        # Sort: data attributes first, then methods
        members.sort(key=lambda m: (
            0 if m.get('kind') != 'callable' else 1,
            m.get('name', '')
        ))

        return members[:100]  # Limit

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
                # Mark if it's a classmethod/staticmethod/property
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
            # For numpy scalar types, just show the value
            type_name = type(value).__name__
            if type_name in ('int64', 'int32', 'float64', 'float32', 'bool_'):
                return str(value)
            r = repr(value)
            return r[:100] if len(r) > 100 else r
        except Exception:
            return f"<{type(value).__name__}>"

    def hover_inspect(self, name: str) -> Dict[str, Any]:
        """
        Get hover information for a variable/expression.
        Returns value preview, type info, and docstring.

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
            # Try to evaluate the name/expression
            value = eval(name, {"__builtins__": {}}, self.shell.user_ns)
            result['found'] = True
            result['type'] = type(value).__name__

            # Get value preview
            try:
                # For DataFrames/Series, show shape and head
                if hasattr(value, 'shape') and hasattr(value, 'head'):
                    if hasattr(value, 'columns'):
                        # DataFrame
                        result['value'] = f"DataFrame {value.shape}\n{value.head(3).to_string()}"
                    else:
                        # Series
                        result['value'] = f"Series {value.shape}\n{value.head(5).to_string()}"
                elif hasattr(value, 'shape') and hasattr(value, 'dtype'):
                    # numpy array
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
                    # Function/method/class
                    result['value'] = f"<{type(value).__name__}>"
                else:
                    preview = repr(value)
                    if len(preview) > 300:
                        preview = preview[:300] + '...'
                    result['value'] = preview
            except Exception as e:
                result['value'] = f"<{type(value).__name__}>"

            # Get docstring
            try:
                doc = getattr(value, '__doc__', None)
                if doc:
                    # Truncate long docstrings
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

        except Exception as e:
            # Name not found or error
            result['found'] = False

        return result

    def reset(self):
        """Reset the namespace."""
        self._ensure_initialized()
        self.shell.reset()

    def interrupt(self):
        """
        Request interruption of currently running code.

        Sets a flag that the streaming execution can check.
        Note: This won't immediately stop CPU-bound code, but will
        stop at the next opportunity (e.g., between loop iterations
        if using cooperative checking, or when output is flushed).
        """
        self._interrupt_requested = True

        # Also try to raise KeyboardInterrupt in the main thread
        # This helps interrupt blocking operations
        import signal
        import threading
        import ctypes

        # If running in main thread, we can use signals
        if threading.current_thread() is threading.main_thread():
            try:
                signal.raise_signal(signal.SIGINT)
            except (AttributeError, OSError):
                pass
        else:
            # For threads, try using ctypes to raise exception
            try:
                main_thread = threading.main_thread()
                thread_id = main_thread.ident
                if thread_id:
                    res = ctypes.pythonapi.PyThreadState_SetAsyncExc(
                        ctypes.c_ulong(thread_id),
                        ctypes.py_object(KeyboardInterrupt)
                    )
                    if res == 0:
                        pass  # Thread not found
                    elif res > 1:
                        # Reset if something went wrong
                        ctypes.pythonapi.PyThreadState_SetAsyncExc(
                            ctypes.c_ulong(thread_id), None
                        )
            except Exception:
                pass

        return True

    def clear_interrupt(self):
        """Clear the interrupt flag."""
        self._interrupt_requested = False

    def _extract_name_at_cursor(self, code: str, cursor_pos: int) -> Optional[str]:
        """Extract the Python name at or before the cursor position."""
        if cursor_pos > len(code):
            cursor_pos = len(code)

        # Work backwards to find start of name
        start = cursor_pos
        while start > 0 and (code[start-1].isalnum() or code[start-1] in '_.'):
            start -= 1

        # Work forwards to find end of name (but not past cursor for completion context)
        end = cursor_pos
        while end < len(code) and (code[end].isalnum() or code[end] == '_'):
            end += 1

        name = code[start:end]

        # Validate it's a proper name
        if name and (name[0].isalpha() or name[0] == '_'):
            return name
        return None

    def _format_exception(self, exc: Exception) -> Dict[str, Any]:
        """Format an exception into a structured dict."""
        tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)

        return {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": "".join(tb_lines),
        }


class IPythonSessionManager:
    """
    Manages multiple IPython sessions.

    Each session has its own namespace, allowing multiple documents
    to have independent execution contexts.
    """

    def __init__(self):
        self.sessions: Dict[str, IPythonSession] = {}

    def get_or_create(self, session_id: str, cwd: Optional[str] = None) -> IPythonSession:
        """Get existing session or create new one."""
        if session_id not in self.sessions:
            self.sessions[session_id] = IPythonSession(cwd=cwd)
        return self.sessions[session_id]

    def get(self, session_id: str) -> Optional[IPythonSession]:
        """Get session by ID."""
        return self.sessions.get(session_id)

    def close(self, session_id: str) -> bool:
        """Close and remove a session."""
        if session_id in self.sessions:
            del self.sessions[session_id]
            return True
        return False

    def list_sessions(self) -> List[str]:
        """List all session IDs."""
        return list(self.sessions.keys())

    def close_all(self) -> List[str]:
        """Close all sessions."""
        closed = list(self.sessions.keys())
        self.sessions.clear()
        return closed

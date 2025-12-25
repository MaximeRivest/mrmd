"""
Shared utilities for mrmd server.

These utilities are used across all clients (VS Code, Electron, Tauri, web)
to ensure consistent behavior. Output formatting, ANSI stripping, etc.
should be done server-side so all frontends receive clean data.
"""

import re
from typing import Optional, Dict, Any, List


# Comprehensive ANSI escape code pattern
# Matches:
#   - CSI sequences: ESC[ ... letter (colors, cursor, etc.)
#   - OSC sequences: ESC] ... BEL or ESC\
#   - Other escape sequences: ESC followed by various chars
ANSI_PATTERN = re.compile(
    r'\x1b\[[0-9;]*[a-zA-Z]'      # CSI sequences (most common)
    r'|\x1b\][^\x07]*(?:\x07|\x1b\\)'  # OSC sequences
    r'|\x1b[PX^_].*?\x1b\\'       # DCS, SOS, PM, APC sequences
    r'|\x1b.'                      # Two-char escape sequences
    r'|\x9b[0-9;]*[a-zA-Z]'       # 8-bit CSI
)


def strip_ansi(text: str) -> str:
    """
    Strip ANSI escape codes from text.

    Handles all common ANSI sequences:
    - Colors and formatting (ESC[...m)
    - Cursor movement (ESC[...H, ESC[...A, etc.)
    - Screen clearing (ESC[...J, ESC[...K)
    - OSC sequences (titles, hyperlinks)

    Args:
        text: Text potentially containing ANSI codes

    Returns:
        Clean text with all ANSI codes removed
    """
    if not text:
        return text
    return ANSI_PATTERN.sub('', text)


def process_terminal_output(text: str) -> str:
    """
    Process terminal output to handle carriage returns and produce clean final output.

    This simulates how a terminal would render the text - carriage return (\r)
    moves cursor to start of line, allowing subsequent text to overwrite.

    Args:
        text: Raw output text potentially containing \r

    Returns:
        Cleaned text as it would appear in a terminal
    """
    if not text:
        return text

    # First strip ANSI codes
    text = strip_ansi(text)

    # Process each line independently
    lines = text.split('\n')
    result_lines = []

    for line in lines:
        if '\r' not in line:
            result_lines.append(line)
        else:
            # Process carriage returns within the line
            # Each \r moves cursor back to start, so we only keep the last segment
            # But handle edge cases where \r is at the end (means just overwrite)
            segments = line.split('\r')
            # Filter out empty segments from consecutive \r or trailing \r
            segments = [s for s in segments if s]
            if segments:
                result_lines.append(segments[-1])
            else:
                result_lines.append('')

    return '\n'.join(result_lines)


def clean_traceback(traceback: str) -> str:
    """
    Clean up a Python traceback for display.

    - Strips ANSI codes
    - Removes IPython's "In [N]:" markers
    - Cleans up excessive blank lines

    Args:
        traceback: Raw traceback string

    Returns:
        Cleaned traceback suitable for display
    """
    if not traceback:
        return traceback

    # Strip ANSI codes
    cleaned = strip_ansi(traceback)

    # Remove IPython's "In [N]:" markers from tracebacks
    cleaned = re.sub(r'^In \[\d+\]:.*$', '', cleaned, flags=re.MULTILINE)

    # Clean up excessive blank lines
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)

    return cleaned.strip()


def format_execution_result(
    stdout: str = "",
    stderr: str = "",
    result: Optional[str] = None,
    error: Optional[Dict[str, Any]] = None,
    display_data: Optional[List[Dict[str, Any]]] = None,
    strip_ansi_codes: bool = True,
    project_root: Optional[str] = None
) -> str:
    """
    Format execution result into clean output string.

    This is the canonical way to format output for all frontends.

    Args:
        stdout: Standard output from execution
        stderr: Standard error from execution
        result: Return value representation
        error: Error dict with 'type', 'message', 'traceback'
        display_data: Rich display outputs (images, HTML, etc.)
        strip_ansi_codes: Whether to strip ANSI codes (default True)
        project_root: Project root path for converting absolute paths to relative

    Returns:
        Formatted output string suitable for display
    """
    parts: List[str] = []

    # Process stdout
    if stdout:
        # Process terminal control sequences (like \r for progress bars)
        clean_stdout = process_terminal_output(stdout) if strip_ansi_codes else stdout
        # Remove "Out[n]: " prefixes
        clean_stdout = re.sub(r'^Out\[\d+\]:\s*', '', clean_stdout, flags=re.MULTILINE)
        if clean_stdout.strip():
            parts.append(clean_stdout.strip())

    # Process stderr (tqdm and other progress bars write here)
    # Only include if there's no error (errors include traceback already)
    if stderr and not error:
        clean_stderr = process_terminal_output(stderr) if strip_ansi_codes else stderr
        if clean_stderr.strip():
            parts.append(clean_stderr.strip())

    # Process result (if not already in stdout)
    if result:
        clean_result = strip_ansi(result) if strip_ansi_codes else result
        if not stdout or clean_result not in stdout:
            # Avoid duplicate if result is same as last line of stdout
            if not parts or clean_result != parts[-1].split('\n')[-1]:
                parts.append(clean_result)

    # Process error
    if error:
        if error.get('traceback'):
            cleaned_tb = clean_traceback(error['traceback'])
            parts.append(cleaned_tb)
        else:
            error_type = error.get('type', 'Error')
            error_msg = error.get('message', 'Unknown error')
            if strip_ansi_codes:
                error_msg = strip_ansi(error_msg)
            parts.append(f"{error_type}: {error_msg}")

    # Process display data
    # Handles both new asset-based format and legacy inline format
    if display_data:
        for display in display_data:
            # New format: asset reference (preferred)
            if 'asset' in display:
                asset = display['asset']
                filepath = asset['path']

                # Convert absolute path to relative if project_root is provided
                if project_root and filepath.startswith(project_root):
                    filepath = filepath[len(project_root):]
                    if filepath.startswith('/'):
                        filepath = filepath[1:]

                asset_type = asset.get('type', '')
                mime_type = asset.get('mime_type', '')

                if asset_type == 'image' or mime_type.startswith('image/'):
                    # Image asset: use markdown image syntax
                    parts.append(f"![output]({filepath})")
                elif asset_type == 'html' or mime_type == 'text/html':
                    # HTML asset (Plotly, pandas styled, etc.): link to file
                    parts.append(f"[View interactive output]({filepath})")
                elif asset_type == 'svg' or mime_type == 'image/svg+xml':
                    parts.append(f"![output]({filepath})")
                else:
                    parts.append(f"[Output: {filepath}]({filepath})")
                continue

            # Legacy format: check for data dict or direct MIME keys
            data = display.get('data', display)

            # Legacy: saved_figure (old matplotlib hook format)
            if 'saved_figure' in data:
                filepath = data['saved_figure']
                if project_root and filepath.startswith(project_root):
                    filepath = filepath[len(project_root):]
                    if filepath.startswith('/'):
                        filepath = filepath[1:]
                parts.append(f"![output]({filepath})")
            elif 'image/png' in data:
                # Inline base64 - not ideal for storage but keep for backward compat
                parts.append(f"![output](data:image/png;base64,{data['image/png']})")
            elif 'image/jpeg' in data:
                parts.append(f"![output](data:image/jpeg;base64,{data['image/jpeg']})")
            elif 'text/html' in data:
                # Legacy inline HTML - show placeholder or strip to plain text
                if 'text/plain' in data:
                    plain = data['text/plain']
                    if strip_ansi_codes:
                        plain = strip_ansi(plain)
                    parts.append(plain)
                else:
                    parts.append('[HTML output]')
            elif 'image/svg+xml' in data:
                # SVG inline - not ideal but keep for backward compat
                parts.append('[SVG output]')
            elif 'text/plain' in data:
                plain = data['text/plain']
                if strip_ansi_codes:
                    plain = strip_ansi(plain)
                parts.append(plain)

    return '\n'.join(parts)


def handle_progress_output(current_output: str, new_chunk: str) -> str:
    """
    Handle progress bar output (carriage return based updates).

    Progress bars like tqdm use \\r to overwrite the current line.
    This function handles that behavior for text-based output.

    Args:
        current_output: Accumulated output so far
        new_chunk: New chunk of output to add

    Returns:
        Updated output with progress handling
    """
    if not new_chunk:
        return current_output

    # Strip ANSI from chunk
    clean_chunk = strip_ansi(new_chunk)

    if '\r' in clean_chunk:
        # Carriage return - replace current line
        # Split on \r and take the last segment (the update)
        segments = clean_chunk.split('\r')
        update = segments[-1]

        # Find the last newline in current output
        last_newline = current_output.rfind('\n')
        if last_newline >= 0:
            return current_output[:last_newline + 1] + update
        else:
            return update
    else:
        return current_output + clean_chunk

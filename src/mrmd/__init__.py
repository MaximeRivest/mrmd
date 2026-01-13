"""
mrmd - Collaborative markdown notebooks.

Edit and run code together in real-time.

Usage:
    $ uvx mrmd              # Run directly with uvx
    $ mrmd                  # Run after pip install

Python API:
    from mrmd import find_project_root, get_project_info
    from mrmd.processes import ProcessManager
    from mrmd.server import create_app
"""

__version__ = "0.2.0"

from .project import (
    find_project_root,
    find_docs_dir,
    find_venv,
    get_project_info,
)

__all__ = [
    "__version__",
    "find_project_root",
    "find_docs_dir",
    "find_venv",
    "get_project_info",
]

"""
mrmd - Collaborative markdown notebooks.

Edit and run code together in real-time.

Usage:
    $ uvx mrmd              # Run directly with uvx
    $ mrmd                  # Run after pip install

Python API:
    from mrmd import Orchestrator, OrchestratorConfig
    from mrmd import find_project_root, get_project_info
"""

__version__ = "0.9.12"

from .orchestrator import Orchestrator
from .config import OrchestratorConfig
from .project import (
    find_project_root,
    find_venv,
    get_project_info,
)

__all__ = [
    "__version__",
    "Orchestrator",
    "OrchestratorConfig",
    "find_project_root",
    "find_venv",
    "get_project_info",
]

"""
mrmd - Collaborative markdown notebooks.

Edit and run code together in real-time.

Usage:
    $ uvx mrmd              # Run directly with uvx
    $ mrmd                  # Run after pip install
    $ mrmd notes.md         # Open specific file
    $ mrmd ~/docs/ideas.md  # Open file (uses scratch if no project)

Python API:
    from mrmd import Orchestrator, OrchestratorConfig
    from mrmd import find_project_root, get_project_info, resolve_target
"""

__version__ = "0.9.17"

from .orchestrator import Orchestrator
from .config import OrchestratorConfig
from .project import (
    find_project_root,
    find_project_root_bounded,
    find_venv,
    get_project_info,
    get_project_hash,
    get_project_state_dir,
    get_or_create_scratch,
    resolve_target,
    get_initial_document,
    SCRATCH_PROJECT_PATH,
)
from .venv import (
    # Python venv
    ensure_venv,
    ensure_mrmd_deps,
    create_venv,
    install_mrmd_deps,
    get_python_path,
    # Node.js deps
    ensure_node_deps,
    get_node_bin,
    get_node_bin_dir,
    get_node_modules_dir,
    is_node_deps_installed,
    get_node_deps_info,
    MRMD_HOME,
)
from .cleanup import (
    cleanup_all,
    cleanup_project,
    find_free_port,
    cleanup_stale_sync,
    cleanup_project_runtimes,
    save_project_state,
    load_project_state,
)

__all__ = [
    "__version__",
    # Orchestrator
    "Orchestrator",
    "OrchestratorConfig",
    # Project detection
    "find_project_root",
    "find_project_root_bounded",
    "find_venv",
    "get_project_info",
    "get_project_hash",
    "get_project_state_dir",
    "get_or_create_scratch",
    "resolve_target",
    "get_initial_document",
    "SCRATCH_PROJECT_PATH",
    # Python venv management
    "ensure_venv",
    "ensure_mrmd_deps",
    "create_venv",
    "install_mrmd_deps",
    "get_python_path",
    # Node.js dependency management
    "ensure_node_deps",
    "get_node_bin",
    "get_node_bin_dir",
    "get_node_modules_dir",
    "is_node_deps_installed",
    "get_node_deps_info",
    "MRMD_HOME",
    # Cleanup
    "cleanup_all",
    "cleanup_project",
    "find_free_port",
    "cleanup_stale_sync",
    "cleanup_project_runtimes",
    "save_project_state",
    "load_project_state",
]

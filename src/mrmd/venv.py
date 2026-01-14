"""
Virtual environment and dependency management for mrmd.

Handles:
- Python venv creation and dependency installation
- Node.js dependency installation (mrmd-sync, mrmd-monitor)
- Automatic updates when new versions are available
"""

import subprocess
import json
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Packages that mrmd needs installed in the venv
MRMD_PYTHON_DEPS = [
    "mrmd-python",  # Python runtime for code execution
    "mrmd-ai",      # AI server for completions
]

# Node.js packages that mrmd needs
MRMD_NODE_DEPS = [
    "mrmd-sync",    # Yjs sync server
    "mrmd-monitor", # Execution monitor
]

# Marker file to track if mrmd deps are installed
MRMD_INSTALLED_MARKER = ".mrmd-deps-installed"

# Shared mrmd directory for node modules
MRMD_HOME = Path.home() / ".mrmd"


def find_venv(project_root: Path) -> Optional[Path]:
    """
    Find a Python virtual environment in the project.

    Args:
        project_root: The project root directory.

    Returns:
        Path to venv directory, or None if not found.
    """
    candidates = [".venv", "venv", ".env", "env"]

    for name in candidates:
        venv_path = project_root / name
        # Check for Python executable to confirm it's a venv
        if (venv_path / "bin" / "python").exists():
            return venv_path
        if (venv_path / "Scripts" / "python.exe").exists():
            return venv_path

    return None


def create_venv(project_root: Path) -> Optional[Path]:
    """
    Create a virtual environment using uv.

    Args:
        project_root: The project root directory.

    Returns:
        Path to the created venv, or None if creation failed.
    """
    venv_path = project_root / ".venv"

    if venv_path.exists():
        logger.debug(f"Venv already exists at {venv_path}")
        return venv_path

    logger.info(f"Creating venv at {venv_path}")

    try:
        result = subprocess.run(
            ["uv", "venv", str(venv_path)],
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Created venv successfully")
        return venv_path

    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to create venv: {e.stderr}")
        return None

    except FileNotFoundError:
        logger.error("uv not found. Please install uv: curl -LsSf https://astral.sh/uv/install.sh | sh")
        return None


def ensure_venv(project_root: Path) -> Optional[Path]:
    """
    Ensure project has a venv, creating one if needed.

    Args:
        project_root: The project root directory.

    Returns:
        Path to the venv, or None if we couldn't create one.
    """
    venv_path = find_venv(project_root)

    if venv_path is not None:
        return venv_path

    return create_venv(project_root)


def is_mrmd_installed(venv_path: Path) -> bool:
    """
    Check if mrmd dependencies are installed in the venv.

    Args:
        venv_path: Path to the virtual environment.

    Returns:
        True if mrmd deps are installed.
    """
    marker = venv_path / MRMD_INSTALLED_MARKER
    return marker.exists()


def install_mrmd_deps(venv_path: Path, project_root: Path, force: bool = False) -> bool:
    """
    Install mrmd dependencies into the venv.

    Args:
        venv_path: Path to the virtual environment.
        project_root: The project root directory.
        force: If True, reinstall even if already installed.

    Returns:
        True if installation succeeded.
    """
    marker = venv_path / MRMD_INSTALLED_MARKER

    if marker.exists() and not force:
        logger.debug("mrmd dependencies already installed")
        return True

    logger.info("Installing mrmd dependencies into venv...")

    try:
        # Use uv pip to install into the venv
        result = subprocess.run(
            ["uv", "pip", "install", "--python", str(venv_path / "bin" / "python")]
            + MRMD_PYTHON_DEPS,
            cwd=project_root,
            check=True,
            capture_output=True,
            text=True,
        )
        logger.info("Installed mrmd dependencies successfully")

        # Create marker file
        marker.touch()
        return True

    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to install mrmd dependencies: {e.stderr}")
        return False

    except FileNotFoundError:
        logger.error("uv not found")
        return False


def ensure_mrmd_deps(project_root: Path) -> Optional[Path]:
    """
    Ensure project has a venv with mrmd dependencies.

    This is the main entry point for venv setup.

    Args:
        project_root: The project root directory.

    Returns:
        Path to the venv with mrmd deps installed, or None if setup failed.
    """
    # First ensure we have a venv
    venv_path = ensure_venv(project_root)
    if venv_path is None:
        return None

    # Then ensure mrmd deps are installed
    if install_mrmd_deps(venv_path, project_root):
        return venv_path

    return None


def get_python_path(venv_path: Path) -> Path:
    """
    Get the Python executable path for a venv.

    Args:
        venv_path: Path to the virtual environment.

    Returns:
        Path to the Python executable.
    """
    # Unix
    python = venv_path / "bin" / "python"
    if python.exists():
        return python

    # Windows
    python = venv_path / "Scripts" / "python.exe"
    if python.exists():
        return python

    # Fallback
    return venv_path / "bin" / "python"


def get_venv_info(venv_path: Path) -> dict:
    """
    Get information about a venv.

    Args:
        venv_path: Path to the virtual environment.

    Returns:
        Dictionary with venv information.
    """
    python_path = get_python_path(venv_path)

    info = {
        "path": venv_path,
        "python": python_path,
        "exists": venv_path.exists(),
        "mrmd_installed": is_mrmd_installed(venv_path),
    }

    # Get Python version if possible
    if python_path.exists():
        try:
            result = subprocess.run(
                [str(python_path), "--version"],
                capture_output=True,
                text=True,
            )
            info["python_version"] = result.stdout.strip()
        except Exception:
            pass

    return info


# =============================================================================
# Node.js Dependency Management
# =============================================================================

def get_node_modules_dir() -> Path:
    """Get the shared mrmd node_modules directory."""
    return MRMD_HOME / "node_modules"


def get_node_bin_dir() -> Path:
    """Get the node_modules/.bin directory."""
    return get_node_modules_dir() / ".bin"


def _get_installed_node_version(package: str) -> Optional[str]:
    """
    Get the installed version of a Node.js package.

    Args:
        package: Package name (e.g., "mrmd-sync")

    Returns:
        Version string or None if not installed.
    """
    package_json = get_node_modules_dir() / package / "package.json"
    if not package_json.exists():
        return None

    try:
        with open(package_json) as f:
            data = json.load(f)
            return data.get("version")
    except (json.JSONDecodeError, IOError):
        return None


def _get_latest_npm_version(package: str) -> Optional[str]:
    """
    Get the latest version of a package from npm registry.

    Args:
        package: Package name

    Returns:
        Latest version string or None if lookup failed.
    """
    try:
        result = subprocess.run(
            ["npm", "view", package, "version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return None


def _needs_update(package: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Check if a Node.js package needs to be updated.

    Args:
        package: Package name

    Returns:
        Tuple of (needs_update, installed_version, latest_version)
    """
    installed = _get_installed_node_version(package)
    if installed is None:
        return True, None, None

    latest = _get_latest_npm_version(package)
    if latest is None:
        # Can't check, assume OK
        return False, installed, None

    return installed != latest, installed, latest


def ensure_node_deps(check_updates: bool = True) -> Optional[Path]:
    """
    Ensure mrmd Node.js dependencies are installed and up to date.

    Installs mrmd-sync and mrmd-monitor to ~/.mrmd/node_modules/
    so they can be used without npx.

    Args:
        check_updates: If True, check for and install updates.

    Returns:
        Path to node_modules/.bin directory, or None if installation failed.
    """
    MRMD_HOME.mkdir(parents=True, exist_ok=True)
    node_modules = get_node_modules_dir()
    bin_dir = get_node_bin_dir()

    # Check which packages need to be installed or updated
    packages_to_install = []

    for package in MRMD_NODE_DEPS:
        needs_update, installed, latest = _needs_update(package)

        if installed is None:
            logger.info(f"Installing {package}...")
            packages_to_install.append(package)
        elif needs_update and check_updates:
            logger.info(f"Updating {package}: {installed} -> {latest}")
            packages_to_install.append(package)
        else:
            logger.debug(f"{package} is up to date ({installed})")

    if not packages_to_install:
        logger.debug("All Node.js dependencies are up to date")
        return bin_dir

    # Install/update packages
    try:
        # Initialize package.json if needed
        package_json = MRMD_HOME / "package.json"
        if not package_json.exists():
            package_json.write_text(json.dumps({
                "name": "mrmd-deps",
                "version": "1.0.0",
                "private": True,
                "description": "mrmd Node.js dependencies",
            }, indent=2))

        # Install packages
        result = subprocess.run(
            ["npm", "install", "--save"] + packages_to_install,
            cwd=MRMD_HOME,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if result.returncode != 0:
            logger.error(f"npm install failed: {result.stderr}")
            # Check if packages exist anyway (partial success)
            if not bin_dir.exists():
                return None

        logger.info(f"Node.js dependencies installed to {node_modules}")
        return bin_dir

    except subprocess.TimeoutExpired:
        logger.error("npm install timed out")
        return bin_dir if bin_dir.exists() else None

    except FileNotFoundError:
        logger.error("npm not found. Please install Node.js: https://nodejs.org/")
        return None


def get_node_bin(command: str) -> Optional[Path]:
    """
    Get the path to a Node.js binary in the mrmd node_modules.

    Args:
        command: Command name (e.g., "mrmd-sync")

    Returns:
        Path to the binary, or None if not found.
    """
    bin_dir = get_node_bin_dir()
    bin_path = bin_dir / command

    if bin_path.exists():
        return bin_path

    # Windows
    bin_path_cmd = bin_dir / f"{command}.cmd"
    if bin_path_cmd.exists():
        return bin_path_cmd

    return None


def is_node_deps_installed() -> bool:
    """Check if all Node.js dependencies are installed."""
    for package in MRMD_NODE_DEPS:
        if _get_installed_node_version(package) is None:
            return False
    return True


def get_node_deps_info() -> dict:
    """Get information about installed Node.js dependencies."""
    info = {
        "node_modules": str(get_node_modules_dir()),
        "bin_dir": str(get_node_bin_dir()),
        "packages": {},
    }

    for package in MRMD_NODE_DEPS:
        version = _get_installed_node_version(package)
        bin_path = get_node_bin(package)
        info["packages"][package] = {
            "installed": version is not None,
            "version": version,
            "bin": str(bin_path) if bin_path else None,
        }

    return info

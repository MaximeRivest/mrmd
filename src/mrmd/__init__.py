"""
mrmd - Markdown that runs

AI-native literate programming by Maxime Rivest.
"""

__version__ = "0.1.0"

from .server.app import create_app, run_server

__all__ = ["create_app", "run_server", "__version__"]

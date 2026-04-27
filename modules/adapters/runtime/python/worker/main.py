from __future__ import annotations

import importlib
import sys
from os import getenv
from pathlib import Path

import uvicorn


def _load_app():
    if __package__:
        from .app import app as package_app

        return package_app

    # Support direct script execution (`python main.py`) used by the desktop supervisor.
    # In script mode, ensure repository root is importable so package-relative imports work.
    repository_root = Path(__file__).resolve().parents[5]
    root_path = str(repository_root)
    if root_path not in sys.path:
        sys.path.insert(0, root_path)

    module = importlib.import_module("modules.adapters.runtime.python.worker.app")
    return module.app


app = _load_app()


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=getenv("PYTHON_RUNTIME_HOST", "127.0.0.1"),
        port=int(getenv("PYTHON_RUNTIME_PORT", "43111")),
        reload=False,
        access_log=False,
    )

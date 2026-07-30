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


def _resolve_launch_configuration() -> tuple[str, int]:
    host = getenv("PYTHON_RUNTIME_HOST", "127.0.0.1").strip().lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise RuntimeError("Python runtime must bind to a host-owned loopback interface.")
    token = getenv("PYTHON_RUNTIME_AUTH_TOKEN", "").strip()
    if len(token) < 32:
        raise RuntimeError("Python runtime launch authentication is unavailable.")
    try:
        port = int(getenv("PYTHON_RUNTIME_PORT", "43111"))
    except ValueError as error:
        raise RuntimeError("Python runtime port must be an integer between 1024 and 65535.") from error
    if port < 1024 or port > 65535:
        raise RuntimeError("Python runtime port must be an integer between 1024 and 65535.")
    return host, port


if __name__ == "__main__":
    runtime_host, runtime_port = _resolve_launch_configuration()
    uvicorn.run(
        app,
        host=runtime_host,
        port=runtime_port,
        reload=False,
        access_log=False,
    )

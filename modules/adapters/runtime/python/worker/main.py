from __future__ import annotations

import importlib
import importlib.machinery
import importlib.util
import sys
from os import getenv
from pathlib import Path
from types import ModuleType

import uvicorn


def _load_app():
    if __package__:
        from .app import app as package_app

        return package_app

    # The shipped worker is a flat directory. Bind its relative imports to that
    # exact directory without searching a checkout or changing sys.path.
    worker_root = Path(__file__).resolve().parent
    worker_directory = str(worker_root)
    package_name = "_ai_system_builder_worker"
    package = sys.modules.get(package_name)
    cached = [(name, module) for name, module in list(sys.modules.items())
              if name == package_name or name.startswith(package_name + ".")]
    if package is None and cached:
        raise RuntimeError("Python runtime package directory is unavailable.")
    for name, module in cached:
        parts = name.split(".")[1:]
        if not isinstance(module, ModuleType) or any(not part.isidentifier() for part in parts):
            raise RuntimeError("Python runtime package directory is unavailable.")
        expected = worker_root.joinpath(*parts)
        module_file = getattr(module, "__file__", None)
        if module_file is not None:
            if not isinstance(module_file, str):
                raise RuntimeError("Python runtime package directory is unavailable.")
            actual = Path(module_file).resolve()
            if (not actual.is_relative_to(worker_root)
                    or actual not in {expected.with_suffix(".py"), expected / "__init__.py"}
                    or not actual.is_file()):
                raise RuntimeError("Python runtime package directory is unavailable.")
        module_paths = getattr(module, "__path__", None)
        if module_paths is not None:
            if (list(module_paths) != [str(expected)] or not expected.is_dir()
                    or expected.resolve() != expected):
                raise RuntimeError("Python runtime package directory is unavailable.")
        elif module_file is None:
            raise RuntimeError("Python runtime package directory is unavailable.")
    if package is not None:
        if list(getattr(package, "__path__", ())) != [worker_directory]:
            raise RuntimeError("Python runtime package directory is unavailable.")
    else:
        spec = importlib.machinery.ModuleSpec(package_name, loader=None, is_package=True)
        spec.submodule_search_locations = [worker_directory]
        package = importlib.util.module_from_spec(spec)
        sys.modules[package_name] = package
    module = importlib.import_module(f"{package_name}.app")
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

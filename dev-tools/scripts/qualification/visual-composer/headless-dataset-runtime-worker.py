"""Private offline host qualification; run the unchanged packaged worker.

The one identity record supports owned shutdown observation. It is not a native
filesystem fence, runtime readiness proof, or permission to adopt another task.
"""
import json
import os
from pathlib import Path
import re
import runpy
import stat
import sys


def regular_path(path, directory):
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400
            or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode))):
        raise ValueError("An ordinary qualification path is required.")
    return info


def admit(root, cwd, cache, environment, platform):
    if platform != "nt" or environment.get("NODE_ENV") != "test" or any(
            environment.get(key) != "1" for key in (
                "AISB_HEADLESS_DATASET_QUALIFICATION", "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX")):
        raise ValueError("The fixed offline qualification environment is required.")
    worker = root / "out/ai-system-builder-win32-x64/resources/worker"
    base = root / "artifacts/qualification/visual-composer/d"
    if (not root.is_absolute() or root.resolve() != root or cwd != worker or cwd.resolve() != cwd
            or not cache.is_absolute() or cache.resolve() != cache or not cache.is_relative_to(base)):
        raise ValueError("The current packaged worker and isolated cache are required.")
    relative = cache.relative_to(base).as_posix()
    if not re.fullmatch(r"(?:managed-[a-f0-9]{32}/runtime/controlled-model-cache|[a-f0-9]{16}/desktop/headless-plan-review/unused-model-cache)", relative):
        raise ValueError("The fixed Headless qualification cache is required.")
    for target in (worker, cache):
        for item in (root, *[root.joinpath(*target.relative_to(root).parts[:i])
                            for i in range(1, len(target.relative_to(root).parts) + 1)]):
            regular_path(item, True)
    main = worker / "main.py"
    info = regular_path(main, False)
    if main.resolve() != main or info.st_nlink != 1 or not 0 < info.st_size <= 1_048_576:
        raise ValueError("The packaged worker entry point is unavailable.")
    return main


def owned_launcher_parent(configured_python, read_process):
    """Observe the single Windows venv redirector, never search/adopt ancestors."""
    if not configured_python:
        return None
    configured = Path(configured_python)
    if not configured.is_absolute() or configured.name.lower() != "python.exe":
        raise ValueError("An exact configured Python executable is required.")
    launcher = read_process(os.getppid())
    if Path(launcher.exe()).resolve() != configured.resolve():
        return None  # Direct interpreter: its parent must be the owned Node host.
    parent = launcher.ppid()
    if not isinstance(parent, int) or parent <= 0 or parent in (os.getpid(), os.getppid()):
        raise ValueError("The configured Python launcher parent is unavailable.")
    return parent


def write_identity(cache, launcher_parent=None):
    name = cache / f"qualification-worker-identity-{os.getpid()}.json"
    identity = {"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "headless-provided-data"}
    if launcher_parent is not None:
        identity["configuredPythonLauncherParentPid"] = launcher_parent
    payload = json.dumps(identity).encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(name, flags, 0o600)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or os.write(descriptor, payload) != len(payload):
            raise ValueError("Qualification identity writing was not confirmed.")
        os.fsync(descriptor)
        after = regular_path(name, False)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino) or after.st_nlink != 1 or after.st_size != len(payload):
            raise ValueError("Qualification identity writing was not confirmed.")
    finally:
        os.close(descriptor)


def startup_failure_record(error):
    """Fixed diagnostic facts only: never exception messages, args or paths."""
    names = {kind: kind.__name__ for kind in (
        ImportError, ModuleNotFoundError, MemoryError, OSError, RuntimeError, ValueError, TimeoutError)}
    record = {"schemaVersion": "headless-worker-startup-failure-v1", "pid": os.getpid(),
              "errorType": names.get(type(error), "OtherError")}
    if type(error) in (OSError, TimeoutError):
        for name in ("errno", "winerror"):
            value = getattr(error, name, None)
            if type(value) is int and 0 <= value <= 65535:
                record[name] = value
    return record


def write_startup_failure(cache, error):
    regular_path(cache, True)
    name = cache / f"q-start-failure-{os.getpid()}.json"
    payload = json.dumps(startup_failure_record(error)).encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(name, flags, 0o600)
    try:
        before = os.fstat(descriptor)
        if (len(payload) > 1024 or not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or os.write(descriptor, payload) != len(payload)):
            raise ValueError("Qualification startup diagnosis was not recorded.")
        os.fsync(descriptor)
        after = regular_path(name, False)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino) or after.st_nlink != 1 or after.st_size != len(payload):
            raise ValueError("Qualification startup diagnosis changed.")
    finally:
        os.close(descriptor)


def main():
    if sys.argv[1:]:
        raise ValueError("This qualification entry accepts no arguments.")
    root = Path(__file__).resolve().parents[4]
    cache = Path(os.getenv("HF_HUB_CACHE", ""))
    entry = admit(root, Path.cwd(), cache, os.environ, os.name)
    import psutil  # Already a production worker dependency; no installation.
    write_identity(cache, owned_launcher_parent(os.getenv("PYTHON_RUNTIME_COMMAND"), psutil.Process))
    try:
        runpy.run_path(str(entry), run_name="__main__")
    except Exception as error:
        try:
            write_startup_failure(cache, error)
        except Exception:
            pass  # Diagnosis cannot replace the original worker failure.
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"event":"qualification.headless.dataset.worker.failed"}', flush=True)
        raise SystemExit(1)

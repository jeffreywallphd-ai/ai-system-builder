from __future__ import annotations

import runpy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from os import environ
from pathlib import Path
from unittest.mock import patch


class WorkerMainEntrypointTests(unittest.TestCase):
    def _run_flat_deployment(self, *, decoy=False, collision=False, missing_app=False,
                             private_cache=None, repeat=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            worker = root / "flat-deployment" / "worker"
            worker.mkdir(parents=True)
            shutil.copyfile(Path(__file__).resolve().parents[1] / "main.py", worker / "main.py")
            (worker / "models.py").write_text('MARKER = "deployment-local"\n', encoding="utf-8")
            (worker / "tasks").mkdir()
            (worker / "tasks" / "helper.py").write_text('VALUE = "relative-task"\n', encoding="utf-8")
            if not missing_app:
                (worker / "app.py").write_text(
                    'from .models import MARKER\nfrom .tasks.helper import VALUE\napp = (MARKER, VALUE)\n',
                    encoding="utf-8",
                )
            unrelated = root / "unrelated-working-directory"
            unrelated.mkdir()
            probe = '''
import json, runpy, sys, types
from pathlib import Path
main, decoy, collision, missing_app, private_cache, repeat = json.loads(sys.argv[1])
sys.modules["uvicorn"] = types.ModuleType("uvicorn")
if decoy:
    decoy_app = types.ModuleType("modules.adapters.runtime.python.worker.app")
    decoy_app.app = "wrong-repository-app"
    sys.modules[decoy_app.__name__] = decoy_app
if collision:
    foreign = types.ModuleType("_ai_system_builder_worker")
    foreign.__path__ = [str(Path(main).parent / "other")]
    sys.modules[foreign.__name__] = foreign
if private_cache:
    if private_cache != "orphan":
        parent = types.ModuleType("_ai_system_builder_worker")
        parent.__path__ = [str(Path(main).parent)]
        sys.modules[parent.__name__] = parent
    suffix = {"nested": "models", "package-search": "tasks", "missing-namespace": "ghost"}.get(private_cache, "app")
    foreign = types.ModuleType("_ai_system_builder_worker." + suffix)
    if private_cache == "package-search":
        init = Path(main).parent / "tasks" / "__init__.py"
        init.write_text("", encoding="utf-8")
        foreign.__file__ = str(init)
        foreign.__path__ = [str(Path(main).parent / "other")]
    elif private_cache == "missing-namespace":
        foreign.__path__ = [str(Path(main).parent / "ghost")]
    else:
        foreign.__file__ = str(Path(main).parent / "other" / (suffix + ".py"))
    foreign.app = "wrong-private-app"
    foreign.MARKER = "wrong-private-models"
    sys.modules[foreign.__name__] = foreign
before = list(sys.path)
try:
    result = runpy.run_path(main, run_name="flat_worker_probe")
except RuntimeError:
    assert collision or private_cache
except ModuleNotFoundError:
    assert missing_app and not collision
else:
    assert not collision and not missing_app and not private_cache
    assert result["app"] == ("deployment-local", "relative-task")
    if repeat:
        again = runpy.run_path(main, run_name="flat_worker_repeat_probe")
        assert again["app"] is result["app"]
assert sys.path == before, "worker bootstrap changed the interpreter search path"
'''
            environment = {key: value for key, value in os.environ.items()
                           if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}}
            result = subprocess.run(
                [sys.executable, "-I", "-B", "-c", probe,
                 json.dumps([str(worker / "main.py"), decoy, collision, missing_app, private_cache, repeat])],
                cwd=unrelated, env=environment, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr[-8192:].decode(errors="replace"))

    def test_flat_deployment_loads_relative_models_and_tasks_without_repository_or_cwd(self):
        self._run_flat_deployment()

    def test_flat_deployment_does_not_adopt_a_cached_repository_app(self):
        self._run_flat_deployment(decoy=True)

    def test_flat_deployment_refuses_a_conflicting_private_package(self):
        self._run_flat_deployment(collision=True)

    def test_missing_deployed_app_never_falls_back_to_cached_repository(self):
        self._run_flat_deployment(decoy=True, missing_app=True)

    def test_flat_deployment_refuses_orphan_private_app_cache(self):
        self._run_flat_deployment(private_cache="orphan")

    def test_flat_deployment_refuses_foreign_private_app_with_same_parent_path(self):
        self._run_flat_deployment(private_cache="same-parent")

    def test_flat_deployment_refuses_foreign_nested_private_module(self):
        self._run_flat_deployment(private_cache="nested")

    def test_flat_deployment_reuses_only_its_validated_same_package(self):
        self._run_flat_deployment(repeat=True)

    def test_flat_deployment_refuses_valid_package_file_with_foreign_search_path(self):
        self._run_flat_deployment(private_cache="package-search")

    def test_flat_deployment_refuses_nonexistent_cached_namespace_directory(self):
        self._run_flat_deployment(private_cache="missing-namespace")

    def test_module_context_keeps_existing_package_app(self):
        from modules.adapters.runtime.python.worker import app, main
        self.assertIs(main.app, app.app)

    def test_main_script_context_loads_app_without_relative_import_errors(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        self.assertIn("app", globals_after_run)

    def test_launch_configuration_rejects_remote_bind_and_missing_authentication(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        resolve_launch_configuration = globals_after_run["_resolve_launch_configuration"]
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "0.0.0.0",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "worker-runtime-token-0123456789abcdef",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "loopback"):
                resolve_launch_configuration()
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "127.0.0.1",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "authentication"):
                resolve_launch_configuration()

    def test_launch_configuration_accepts_authenticated_loopback(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        resolve_launch_configuration = globals_after_run["_resolve_launch_configuration"]
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "127.0.0.1",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "worker-runtime-token-0123456789abcdef",
            },
            clear=False,
        ):
            self.assertEqual(resolve_launch_configuration(), ("127.0.0.1", 43111))

    def test_launch_configuration_rejects_invalid_or_privileged_ports(self):
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        resolve = runpy.run_path(str(main_path), run_name="worker_main_test")["_resolve_launch_configuration"]
        for port in ("0", "1023", "65536", "not-a-port"):
            with self.subTest(port=port), patch.dict(environ, {
                "PYTHON_RUNTIME_HOST": "127.0.0.1",
                "PYTHON_RUNTIME_PORT": port,
                "PYTHON_RUNTIME_AUTH_TOKEN": "worker-runtime-token-0123456789abcdef",
            }):
                with self.assertRaisesRegex(RuntimeError, "port"):
                    resolve()


if __name__ == "__main__":
    unittest.main()

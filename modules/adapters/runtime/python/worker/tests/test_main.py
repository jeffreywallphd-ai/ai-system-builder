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
                             private_cache=None, repeat=False, bootstrap=False):
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
                    ('from .native.windows_original_worker_launch import INITIALIZED\nassert INITIALIZED\n' if bootstrap is True else '') +
                    'from .models import MARKER\nfrom .tasks.helper import VALUE\napp = (MARKER, VALUE)\n',
                    encoding="utf-8",
                )
            if bootstrap is True:
                (worker / "native").mkdir()
                (worker / "native/windows_original_worker_launch.py").write_text(
                    'INITIALIZED = False\ndef capture_original_model_bootstrap(nonce):\n'
                    '    global INITIALIZED\n    assert nonce == "a" * 64 and not INITIALIZED\n    INITIALIZED = True\n',encoding="utf8")
            unrelated = root / "unrelated-working-directory"
            unrelated.mkdir()
            probe = '''
import json, os, runpy, sys, types
from pathlib import Path
main, decoy, collision, missing_app, private_cache, repeat, bootstrap = json.loads(sys.argv[1])
if bootstrap: os.environ["PYTHON_RUNTIME_ORIGINAL_MODEL_BOOTSTRAP"] = "wrong" if bootstrap == "malformed" else "a" * 64
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
    assert collision or private_cache or bootstrap == "malformed"
except ModuleNotFoundError:
    assert (missing_app or bootstrap == "missing") and not collision
else:
    assert not collision and not missing_app and not private_cache and bootstrap not in ("missing", "malformed")
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
                 json.dumps([str(worker / "main.py"), decoy, collision, missing_app, private_cache, repeat, bootstrap])],
                cwd=unrelated, env=environment, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr[-8192:].decode(errors="replace"))

    def test_flat_deployment_loads_relative_models_and_tasks_without_repository_or_cwd(self):
        self._run_flat_deployment()

    def test_original_bootstrap_runs_from_fixed_deployed_package_before_app_import(self):
        self._run_flat_deployment(bootstrap=True,decoy=True)

    def test_missing_original_bootstrap_never_falls_back_to_repository(self):
        self._run_flat_deployment(bootstrap="missing",decoy=True)

    def test_malformed_bootstrap_mode_denies_before_app_import(self):
        self._run_flat_deployment(bootstrap="malformed")

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


class BoundedLocalTrainingBootTests(unittest.TestCase):
    def profile(self, root):
        import hashlib
        value = {"profileId": "bounded-local-inert-boot", "maximumDurationSeconds": 30, "stagingRoot": str(root),
            "maximumModelBytes": 4096, "maximumOutputBytes": 8192, "minimumFreeBytes": 1024}
        digest = "sha256:" + hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")).hexdigest()
        return {**value, "profileFingerprint": digest}

    def test_flat_deployed_boot_uses_fixed_module_and_preserves_import_isolation(self):
        with tempfile.TemporaryDirectory(prefix="local-training-boot-") as temporary:
            root = Path(temporary).resolve(); worker = root / "worker"; worker.mkdir(); (worker / "tasks").mkdir()
            shutil.copyfile(Path(__file__).resolve().parents[1] / "main.py", worker / "main.py")
            (worker / "app.py").write_text('app = "ordinary"\ndef configure_bounded_local_training(producer):\n'
                '    global app\n    app = ("local", producer.profile.profile_id)\n', encoding="utf-8")
            (worker / "tasks/approved_local_training_session.py").write_text(
                'class BoundedLocalTrainingProfile:\n'
                '    def __init__(self, profile_id, fingerprint, duration, root, model, output, free):\n'
                '        self.profile_id = profile_id\n'
                'class BoundedLocalTrainingProducer:\n'
                '    def __init__(self, profile): self.profile = profile\n', encoding="utf-8")
            profile = self.profile(root)
            packet = {"schema": "bounded-local-training-startup-v1", "nonce": "a" * 64, "profile": profile}
            probe = '''
import json, runpy, sys, types
from pathlib import Path
main = sys.argv[1]
sys.modules["uvicorn"] = types.ModuleType("uvicorn")
before = list(sys.path)
result = runpy.run_path(main, run_name="local_boot_probe")
assert result["app"] == ("local", "bounded-local-inert-boot")
assert sys.path == before
fixed = sys.modules["_ai_system_builder_worker.tasks.approved_local_training_session"]
assert Path(fixed.__file__).resolve() == Path(main).parent / "tasks/approved_local_training_session.py"
'''
            environment = {k: v for k, v in os.environ.items() if k.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}}
            environment.update(PYTHON_RUNTIME_STARTUP_PROOF="a" * 64, PYTHON_RUNTIME_AUTH_TOKEN="inert-".ljust(40, "x"),
                PYTHON_RUNTIME_BOUNDED_LOCAL_TRAINING_BOOT=json.dumps(packet))
            result = subprocess.run([sys.executable, "-I", "-B", "-c", probe, str(worker / "main.py")],
                cwd=root, env=environment, capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr[-4096:].decode(errors="replace"))

    def boot(self):
        from modules.adapters.runtime.python.worker import main
        return main._load_bounded_local_training_boot

    def environment(self, packet):
        return {"PYTHON_RUNTIME_BOUNDED_LOCAL_TRAINING_BOOT": json.dumps(packet),
            "PYTHON_RUNTIME_STARTUP_PROOF": "a" * 64, "PYTHON_RUNTIME_AUTH_TOKEN": "inert-".ljust(40, "x"),
            "PYTHON_RUNTIME_ORIGINAL_MODEL_BOOTSTRAP": ""}

    def test_packet_configures_the_real_fixed_producer_without_io_or_model_loading(self):
        from modules.adapters.runtime.python.worker import app
        from modules.adapters.runtime.python.worker.tasks.approved_local_training_session import BoundedLocalTrainingProducer
        boot = self.boot(); root = Path(tempfile.gettempdir()).resolve() / "inert-no-io-staging"
        packet = {"schema": "bounded-local-training-startup-v1", "nonce": "a" * 64, "profile": self.profile(root)}
        with patch.dict(environ, self.environment(packet)), patch.object(app, "TASK_REGISTRY", {}), \
             patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None), \
             patch.object(app, "_ORIGINAL_TRAINING_PROTOCOL", "settled-v1"):
            boot("modules.adapters.runtime.python.worker", app)
            self.assertIs(type(app._ORIGINAL_TRAINING_PRODUCER), BoundedLocalTrainingProducer)
            self.assertEqual(app._ORIGINAL_TRAINING_PROFILE.staging_root, str(root))
            self.assertEqual(app._ORIGINAL_TRAINING_PROFILE.fingerprint, packet["profile"]["profileFingerprint"])
            self.assertEqual(app._ORIGINAL_TRAINING_PROTOCOL, "settled-v1")
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                boot("modules.adapters.runtime.python.worker", app)

    def test_malformed_stale_unknown_or_mixed_packets_never_configure_the_app(self):
        from copy import deepcopy
        from types import SimpleNamespace
        from unittest.mock import Mock
        boot = self.boot(); root = Path(tempfile.gettempdir()).resolve() / "inert-no-io-staging"
        base = {"schema": "bounded-local-training-startup-v1", "nonce": "a" * 64, "profile": self.profile(root)}
        for mode in ("schema", "nonce", "unknown", "fingerprint", "profile-extra", "duration-bool", "token", "proof", "mixed", "duplicate", "oversize", "nonfinite"):
            with self.subTest(mode=mode):
                packet = deepcopy(base); environment = self.environment(packet)
                if mode == "schema": packet["schema"] = "other"
                if mode == "nonce": packet["nonce"] = "b" * 64
                if mode == "unknown": packet["callback"] = "not-authority"
                if mode == "fingerprint": packet["profile"]["profileFingerprint"] = "sha256:" + "f" * 64
                if mode == "profile-extra": packet["profile"]["native"] = True
                if mode == "duration-bool":
                    import hashlib
                    packet["profile"]["maximumDurationSeconds"] = True
                    canonical = {key: value for key, value in packet["profile"].items() if key != "profileFingerprint"}
                    packet["profile"]["profileFingerprint"] = "sha256:" + hashlib.sha256(json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode("utf8")).hexdigest()
                if mode == "token": environment["PYTHON_RUNTIME_AUTH_TOKEN"] = ""
                if mode == "proof": environment["PYTHON_RUNTIME_STARTUP_PROOF"] = ""
                if mode == "mixed": environment["PYTHON_RUNTIME_ORIGINAL_MODEL_BOOTSTRAP"] = "a" * 64
                raw = json.dumps(packet)
                if mode == "duplicate": raw = '{"nonce":"a",' + raw[1:]
                if mode == "oversize": raw = " " * 8193
                if mode == "nonfinite": raw = raw.replace('"maximumModelBytes": 4096', '"maximumModelBytes": NaN')
                environment["PYTHON_RUNTIME_BOUNDED_LOCAL_TRAINING_BOOT"] = raw
                target = SimpleNamespace(configure_bounded_local_training=Mock())
                with patch.dict(environ, environment):
                    with self.assertRaisesRegex(RuntimeError, "^Bounded local training startup is unavailable\.$"):
                        boot("modules.adapters.runtime.python.worker", target)
                target.configure_bounded_local_training.assert_not_called()


if __name__ == "__main__":
    unittest.main()

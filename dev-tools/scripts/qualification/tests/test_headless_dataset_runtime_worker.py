"""No worker/model import: guard tests for the private production-worker wrapper."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace

source = Path(__file__).resolve().parents[1] / "visual-composer/headless-dataset-runtime-worker.py"
spec = importlib.util.spec_from_file_location("headless_dataset_worker_fixture", source)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.worker = self.root / "out/ai-system-builder-win32-x64/resources/worker"
        self.worker.mkdir(parents=True)
        self.entry = self.worker / "main.py"
        self.entry.write_text("# Test entry is never executed.\n", encoding="utf-8")
        self.cache = self.root / ("artifacts/qualification/visual-composer/d/managed-" + "a" * 32 + "/runtime/controlled-model-cache")
        self.cache.mkdir(parents=True)
        self.environment = {"NODE_ENV": "test", **{key: "1" for key in (
            "AISB_HEADLESS_DATASET_QUALIFICATION", "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX")}}

    def tearDown(self):
        self.temp.cleanup()

    def admit(self, **changes):
        values = dict(root=self.root, cwd=self.worker, cache=self.cache, environment=self.environment, platform="nt")
        values.update(changes)
        return fixture.admit(**values)

    def test_exact_offline_packaged_entry_and_both_owned_cache_shapes(self):
        self.assertEqual(self.admit(), self.entry)
        desktop = self.root / ("artifacts/qualification/visual-composer/d/" + "b" * 16 + "/desktop/headless-plan-review/unused-model-cache")
        desktop.mkdir(parents=True)
        self.assertEqual(self.admit(cache=desktop), self.entry)

    def test_wrong_platform_production_missing_offline_foreign_paths_and_linked_entry_fail(self):
        for changes in [dict(platform="posix"), dict(environment={**self.environment, "NODE_ENV": "production"}),
                        dict(environment={**self.environment, "PIP_NO_INDEX": "0"}), dict(cache=self.root),
                        dict(cwd=self.root), dict(cache=self.cache / "..")]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.admit(**changes)
        alias = self.worker / "alias.py"
        os.link(self.entry, alias)
        with self.assertRaises(ValueError):
            self.admit()

    def test_identity_is_exclusive_finite_and_cannot_be_overwritten(self):
        fixture.write_identity(self.cache)
        identity = self.cache / f"qualification-worker-identity-{os.getpid()}.json"
        self.assertEqual(json.loads(identity.read_text(encoding="utf-8")),
                         {"pid": os.getpid(), "parentPid": os.getppid(), "scenario": "headless-provided-data"})
        self.assertLess(identity.stat().st_size, 1024)
        before = identity.read_bytes()
        with self.assertRaises(FileExistsError):
            fixture.write_identity(self.cache)
        self.assertEqual(identity.read_bytes(), before)
        secret = "synthetic-private-message-and-path"
        for error, expected in [(MemoryError(secret), "MemoryError"), (ModuleNotFoundError(secret), "ModuleNotFoundError"),
                                (OSError(12, secret), "OSError"), (Exception(secret), "OtherError")]:
            value = fixture.startup_failure_record(error)
            self.assertEqual(value["errorType"], expected)
            self.assertNotIn(secret, json.dumps(value))
            self.assertLess(len(json.dumps(value)), 1024)
        fixture.write_startup_failure(self.cache, OSError(12, secret))
        diagnostic = self.cache / f"q-start-failure-{os.getpid()}.json"
        self.assertEqual(json.loads(diagnostic.read_text())["errno"], 12)
        original = diagnostic.read_bytes()
        with self.assertRaises(FileExistsError):
            fixture.write_startup_failure(self.cache, ValueError(secret))
        self.assertEqual(diagnostic.read_bytes(), original)

    def test_only_the_exact_configured_venv_launcher_can_supply_one_parent(self):
        executable = self.root / "python.exe"
        executable.touch()
        host_pid = max(os.getpid(), os.getppid()) + 10
        seen = []
        def process(pid):
            seen.append(pid)
            return SimpleNamespace(exe=lambda: str(executable), ppid=lambda: host_pid)
        self.assertEqual(fixture.owned_launcher_parent(str(executable), process), host_pid)
        self.assertEqual(seen, [os.getppid()])
        foreign = lambda pid: SimpleNamespace(exe=lambda: str(self.root / "node.exe"), ppid=lambda: host_pid)
        self.assertIsNone(fixture.owned_launcher_parent(str(executable), foreign))
        with self.assertRaises(ValueError):
            fixture.owned_launcher_parent("python.exe", process)
        invalid = lambda pid: SimpleNamespace(exe=lambda: str(executable), ppid=lambda: os.getpid())
        with self.assertRaises(ValueError):
            fixture.owned_launcher_parent(str(executable), invalid)
        fixture.write_identity(self.cache, host_pid)
        record = json.loads((self.cache / f"qualification-worker-identity-{os.getpid()}.json").read_text())
        self.assertEqual(record["configuredPythonLauncherParentPid"], host_pid)


if __name__ == "__main__":
    unittest.main()

"""Require the actual source-copy fixtures and preserve conservative routing."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class NativeModelGraphRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py"
    test = "modules/adapters/runtime/python/worker/tests/test_native_training_model_graph.py"
    fixture = "modules/adapters/runtime/python/worker/tests/fixtures/native_training_model_graph.json"
    check = "headless-training-runtime-worker-unit"

    def select(self, paths, root=None, required=None):
        return {r["id"]: r for r in catalog.plan(root or self.root, paths, required or ["architecture"], "a" * 64)["selected"]}

    def test_exact_sources_select_the_real_two_test_module_executor(self):
        for source in (self.source, self.test, self.fixture):
            rows = self.select([source]); self.assertIn(self.check, rows); self.assertNotIn("focused-tests", rows)
            argv = rows[self.check]["argv"]
            self.assertIn(self.test, argv)
            self.assertIn("modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py", argv)
            self.assertIn("unittest", argv); self.assertNotIn(self.source, argv)
            self.assertFalse(any("test:all" in str(a) or "qualify_windows" in str(a) or "model-blocker" in str(a) for r in rows.values() for a in r["argv"]))

    def test_missing_test_or_fixture_never_borrows_a_pass_and_unknown_keeps_fallback(self):
        for missing in (self.test, self.fixture):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix="native-model-route-") as temporary:
                root = Path(temporary)
                for p in catalog.PUBLISHED_FORM_CHECKS[self.check]["automatic_required_files"]:
                    if p == missing: continue
                    target = root / p; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes((self.root / p).read_bytes())
                rows = self.select([self.source], root)
                self.assertNotIn(self.check, rows); self.assertIn("focused-tests", rows)
        self.assertIn("focused-tests", self.select([self.test.replace("native_training_model_graph", "unknown")]))


if __name__ == "__main__": unittest.main()

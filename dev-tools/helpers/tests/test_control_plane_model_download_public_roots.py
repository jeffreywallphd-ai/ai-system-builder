"""Public download integration selects fixed software checks, never model trials."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class PublicModelDownloadRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    profile = catalog.PUBLISHED_FORM_CHECKS["headless-model-download-public-unit"]

    def select(self, root, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(root, list(paths), list(required), "a" * 64)["selected"]}

    def test_real_roots_and_public_tests_select_fixed_unit_and_strict_types(self):
        for source in self.profile["automatic_sources"]:
            selected = self.select(self.root, [source])
            for identity in ("headless-model-download-public-unit", "headless-model-download-public-types", "headless-model-download-public-mcp-types"):
                self.assertIn(identity, selected)
            self.assertIn("--strict", selected["headless-model-download-public-types"]["argv"])
            self.assertIn("--strict", selected["headless-model-download-public-mcp-types"]["argv"])
            self.assertNotIn("completion-all", selected)
            self.assertNotIn("headless-bounded-text-feature", selected)
            self.assertNotIn("headless-bounded-training-feature", selected)
            for test in self.profile["automatic_sources"][:3]:
                self.assertIn(test, selected["headless-model-download-public-unit"]["argv"])

    def test_only_complete_known_scope_can_use_narrow_controller_regressions(self):
        paths = list(self.profile["sources"])
        selected = self.select(self.root, paths, ["control-plane"])
        self.assertIn("-k", selected["control-plane"]["argv"])
        self.assertIn("test_control_plane_focused.", selected["control-plane"]["argv"])
        for changed, required in [(paths + ["modules/hosts/shared/unknown.ts"], ["control-plane"]),
                                  (paths, ["focused-tests"]),
                                  ([p for p in paths if p != self.profile["automatic_required_files"][0]], ["control-plane"])]:
            self.assertNotIn("-k", self.select(self.root, changed, required)["control-plane"]["argv"])

    def test_archive_source_changes_require_archive_and_journal_regressions(self):
        paths = list(self.profile["sources"])
        selected = self.select(self.root, paths, ["control-plane"])
        for pattern in ("test_control_plane_archives.", "test_control_plane_journal_capacity."):
            self.assertIn(pattern, selected["control-plane"]["argv"])
        for omitted in ("dev-tools/helpers/control_plane/records.py",
                        "dev-tools/helpers/tests/test_control_plane_archives.py"):
            incomplete = [path for path in paths if path != omitted]
            self.assertNotIn("-k", self.select(self.root, incomplete, ["control-plane"])["control-plane"]["argv"])

    def test_missing_or_directory_support_cannot_select_complete_automatic_profile(self):
        with tempfile.TemporaryDirectory(prefix="model-public-check-") as temporary:
            root = Path(temporary)
            config = "dev-tools/config/contributor-check-profiles.json"
            (root / config).parent.mkdir(parents=True)
            (root / config).write_bytes((self.root / config).read_bytes())
            for name in self.profile["automatic_required_files"]:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert fixture\n")
            selected_path = self.profile["automatic_sources"][0]
            self.assertIn("headless-model-download-public-unit", self.select(root, [selected_path]))
            for name in self.profile["automatic_required_files"]:
                target = root / name
                target.unlink()
                for directory in (False, True):
                    if directory:
                        target.mkdir()
                    selected = self.select(root, [selected_path])
                    self.assertNotIn("headless-model-download-public-unit", selected)
                    self.assertNotIn("headless-model-download-public-types", selected)
                    if directory:
                        target.rmdir()
                target.write_text("// inert fixture\n")

    def test_unknown_sources_and_explicit_generic_requests_keep_generic_checks(self):
        known = self.profile["automatic_sources"][0]
        self.assertIn("focused-tests", self.select(self.root, [known, "modules/hosts/shared/new-boundary.ts"]))
        self.assertIn("focused-tests", self.select(self.root, [known], ["focused-tests"]))


if __name__ == "__main__":
    unittest.main()

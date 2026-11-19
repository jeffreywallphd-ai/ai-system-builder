"""Application source ownership uses focused checks, never full software/model suites."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelSourceApplicationRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    sources = (
        "modules/application/use-cases/model/model-download-tasks.use-case.ts",
        "modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
        "modules/hosts/desktop/composition/composeDesktopRuntimeTaskFeature.ts",
        "modules/hosts/desktop/composition/composeDesktopModelFeature.ts",
        "modules/hosts/server/composition/composeServerHost.ts",
        "modules/hosts/shared/composition/tests/headless-model-source-hosts.unit.test.ts",
    )

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_application_and_host_scope_keeps_owner_unit_and_strict_types(self):
        rows = self.selected(list(self.sources), ["headless-context-existing-runtime", "headless-context-installed-host"])
        for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
            self.assertIn(key, rows)
            for name in (self.sources[1], self.sources[-1]):
                self.assertIn(name, rows[key]["argv"])
        self.assertNotIn("focused-tests", rows)
        self.assertNotIn("completion-all", rows)
        self.assertNotIn("completion-standard-and-e2e", rows)

    def test_each_new_owner_source_selects_both_focused_profiles(self):
        for source in (self.sources[0], self.sources[1], self.sources[-1]):
            rows = self.selected([source], ["architecture"])
            self.assertIn("headless-model-metadata-owner-unit", rows)
            self.assertIn("headless-model-metadata-owner-types", rows)

    def test_unknown_source_and_explicit_generic_check_preserve_fallback(self):
        self.assertIn("focused-tests", self.selected([*self.sources, "modules/hosts/shared/composition/unknown-source-owner.ts"]))
        self.assertIn("focused-tests", self.selected(list(self.sources), ["focused-tests"]))


if __name__ == "__main__":
    unittest.main()

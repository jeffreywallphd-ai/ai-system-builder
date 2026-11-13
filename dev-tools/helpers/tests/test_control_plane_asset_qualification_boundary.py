"""Keep exact Asset and source-fixture checks inside their approved scope."""
from pathlib import Path
import subprocess
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog

ROOT = HELPERS.parents[1]


class AssetQualificationBoundaryTests(unittest.TestCase):
    def plan(self, paths, required):
        return {row["id"]: row for row in catalog.plan(ROOT, paths, required, "a" * 64)["selected"]}

    def test_asset_security_uses_only_exact_checked_in_nonlegacy_tests(self):
        check = "asset-defensive-acceptance"
        definitions = self.plan([], [check, "architecture"])
        self.assertEqual(set(definitions), {check, "architecture"})
        args = definitions[check]["argv"]
        self.assertEqual(args[:6], ["node", "--import", "tsx", "--test", "--test-concurrency=1", "--"])
        test_paths = args[6:]
        self.assertEqual(len(test_paths), len(set(test_paths)))
        self.assertGreaterEqual(len(test_paths), 8)
        self.assertTrue(all("legacy" not in p and "assets-workspace-authorization" not in p for p in test_paths))
        self.assertTrue(all(p.endswith((".unit.test.ts", ".unit.test.mjs")) for p in test_paths))
        result = subprocess.run(["git", "ls-files", "--error-unmatch", "--", *test_paths],
                                cwd=ROOT, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)

    def test_only_explicit_exact_image_and_runner_scopes_suppress_generic_check(self):
        image_id = "desktop-image-storage-labels"
        image = "apps/desktop/src/renderer/features/image-generation/tests/desktop-image-ipc-storage.ui.test.tsx"
        runner_id = "standard-source-fixture-runner"
        runner_test = "dev-tools/scripts/testing/tests/non-browser-test-runner-core.unit.test.ts"
        for name, source, argv in [
            (image_id, image, [sys.executable, "-B", "dev-tools/helpers/run_focused_checks.py", "--regression-test", image]),
            (runner_id, runner_test, ["node", "--import", "tsx", "--test", "--", runner_test]),
        ]:
            with self.subTest(name=name):
                self.assertNotIn(name, self.plan([source], ["documentation"]))
                exact = self.plan([source], [name])
                self.assertNotIn("focused-tests", exact)
                self.assertEqual(exact[name]["argv"], argv)
                self.assertIn("focused-tests", self.plan([source, "dev-tools/scripts/unknown.ts"], [name]))

    def test_browser_contract_owns_exact_paths_and_retains_unknown_fallback(self):
        name = "asset-browser-qualification-contract"
        checked = list(catalog.ASSET_BROWSER_SOURCES)
        self.assertIn("focused-tests", self.plan(checked, ["documentation"]))
        self.assertNotIn(name, self.plan(checked, ["documentation"]))
        scoped = self.plan(checked, [name])
        self.assertNotIn("focused-tests", scoped)
        self.assertEqual(scoped[name]["argv"], [
            "node", "--import", "tsx", "--test", "--", checked[1],
            "modules/ui/shared/styles/tests/page-dashboard-layout.unit.test.ts",
        ])
        self.assertNotIn(name, self.plan(["modules/ui/shared/styles/unknown.css"], ["documentation"]))
        self.assertIn("focused-tests", self.plan(checked + ["modules/ui/shared/styles/unknown.css"], [name]))


if __name__ == "__main__":
    unittest.main()

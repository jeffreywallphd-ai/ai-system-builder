"""Run the real shared training approval checks; retain unknown/missing fallback."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingApprovalRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    exact = (
        "modules/contracts/headless/headless-model-training-build-plan.ts",
        "modules/contracts/headless/tests/headless-model-training-build-plan.unit.test.ts",
        "modules/ui/shared/headless/tests/HeadlessModelTrainingApproval.interaction.ui.test.tsx",
    )

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]: row for row in catalog.plan(root or self.root, list(paths), list(required), "a" * 64)["selected"]}

    def test_owned_sources_select_real_contract_ui_assertions_and_strict_types(self):
        for source in self.exact:
            selected = self.selected([source])
            for name in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                for test in self.exact[1:]:
                    self.assertIn(test, selected[name]["argv"])
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)
            self.assertFalse(any("--run-ai" in row["argv"] for row in selected.values()))

    def test_unrelated_shared_unknown_and_explicit_generic_paths_keep_fallback(self):
        self.assertIn("focused-tests", self.selected(self.exact, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected((*self.exact, "modules/contracts/headless/unknown-training-approval.ts")))
        for path in ("modules/contracts/headless/index.ts", "modules/ui/shared/headless/HeadlessPlanApprovalDialog.tsx"):
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))

    def test_incomplete_checkout_cannot_automatically_borrow_approval_coverage(self):
        required = catalog.PUBLISHED_FORM_CHECKS["headless-model-metadata-owner-unit"]["automatic_required_files"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in required:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("// inert routing fixture\n", encoding="utf-8")
            self.assertIn("headless-model-metadata-owner-unit", self.selected(self.exact, root=root))
            (root / self.exact[2]).unlink()
            selected = self.selected(self.exact, root=root)
            self.assertNotIn("headless-model-metadata-owner-unit", selected)
            self.assertIn("focused-tests", selected)

    def test_real_feature_command_passes_named_assertions_without_models(self):
        # Execute only these feature assertions here; the governed owner command
        # separately runs the related legacy host/storage/Data/Context regressions.
        node = catalog.plan(self.root, [self.exact[0]], ["architecture"], "a" * 64)["selected"]
        owner = next(row for row in node if row["id"] == "headless-model-metadata-owner-unit")
        command = [owner["argv"][0], "--import", "tsx", "--test", "--", *self.exact[1:]]
        result = subprocess.run(command, cwd=self.root, env={**os.environ, "HF_HUB_OFFLINE": "1"},
                                capture_output=True, text=True, timeout=90, check=False)
        self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
        self.assertIn("tests 11", result.stdout)
        self.assertIn("pass 11", result.stdout)
        self.assertIn("fail 0", result.stdout)
        self.assertIn("both approval modes and channels", result.stdout)


if __name__ == "__main__":
    unittest.main()

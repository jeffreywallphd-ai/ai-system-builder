"""Reference-only Model metadata saves retain exact and unknown-source coverage."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelReferenceSaveRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    sources = ["modules/hosts/shared/composition/headlessModelReferenceSave.ts",
               "modules/adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore.ts",
               "modules/hosts/shared/composition/tests/headless-model-reference-save.unit.test.ts"]

    def selected(self, paths, required=("architecture",)):
        return {row["id"]: row for row in catalog.plan(self.root, paths, list(required), "a" * 64)["selected"]}

    def test_exact_sources_select_real_registry_core_sqlite_and_strict_types(self):
        for path in self.sources:
            selected = self.selected([path])
            for key in ("headless-model-metadata-owner-unit", "headless-model-metadata-owner-types"):
                self.assertIn(self.sources[2], selected[key]["argv"])
            for source in self.sources[:2]:
                self.assertIn(source, selected["headless-model-metadata-owner-types"]["argv"])
            self.assertIn("modules/application/use-cases/model/tests/headless-model-source-admission.unit.test.ts",
                          selected["headless-model-metadata-owner-unit"]["argv"])
            self.assertIn("modules/adapters/persistence/model/tests/local-model-registry.adapter.unit.test.ts",
                          selected["headless-model-metadata-owner-unit"]["argv"])
            self.assertNotIn("focused-tests", selected)
            self.assertNotIn("completion-all", selected)

    def test_unknown_or_explicit_generic_fallback_remains(self):
        self.assertIn("focused-tests", self.selected(self.sources, ("focused-tests",)))
        self.assertIn("focused-tests", self.selected(self.sources + ["modules/hosts/shared/composition/unknown-model-save.ts"]))
        self.assertIn("focused-tests", self.selected(self.sources + ["modules/adapters/persistence/system-builder/unknown-model-save.ts"]))

    def test_shared_files_and_unrelated_model_sources_do_not_borrow_profile(self):
        for path in ["modules/hosts/README.md", "modules/adapters/persistence/shared/structured-document-store.ts",
                     "modules/application/ports/model/model-registry.port.ts"]:
            self.assertNotIn("headless-model-metadata-owner-unit", self.selected([path]))


if __name__ == "__main__":
    unittest.main()

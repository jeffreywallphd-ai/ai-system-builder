"""Private source metadata uses exact Model tests, without a download/runtime pass."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelSourceInspectionRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    inspector = 'modules/adapters/model/huggingface/createHuggingFaceModelSourceInspector.ts'
    port = 'modules/application/ports/model/model-download-source.port.ts'

    def selected(self, paths, required=('documentation',)):
        return {row['id']: row for row in catalog.plan(self.root, paths, list(required), 'f' * 64)['selected']}

    def test_exact_feature_includes_installed_sdk_fixtures_and_ordinary_provider_regressions(self):
        rows = self.selected([self.inspector, self.port, 'modules/contracts/model/index.ts',
                              'modules/contracts/model/tests/model-family-invariants.unit.test.ts'])
        self.assertNotIn('focused-tests', rows)
        for filename in ['modules/contracts/model/tests/model-download-source.unit.test.ts',
                         'modules/adapters/model/huggingface/tests/model-download-source.unit.test.ts',
                         'modules/adapters/model/huggingface/tests/createHuggingFaceModelBrowseDetailsAdapter.unit.test.ts']:
            self.assertIn(filename, rows['headless-model-metadata-owner-unit']['argv'])
        self.assertIn('headless-model-metadata-owner-types', rows)
        self.assertNotIn('headless-context-model-worker', rows)
        self.assertNotIn('completion-all', rows)

    def test_borrowed_port_or_provider_alone_cannot_mask_generic_impact(self):
        for path in [self.port, 'modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts']:
            rows = self.selected([path], ['documentation'])
            self.assertNotIn('headless-model-metadata-owner-unit', rows)
            self.assertIn('focused-tests', rows)

    def test_unknown_sources_and_explicit_generic_checks_keep_their_guards(self):
        self.assertIn('focused-tests', self.selected([self.inspector], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([self.inspector,
            'modules/adapters/model/huggingface/unmapped-source-inspector.ts']))


if __name__ == '__main__':
    unittest.main()

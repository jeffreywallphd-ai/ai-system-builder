"""Private Model metadata gets exact feature evidence, never the app-wide owner."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelMetadataRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    path = 'modules/application/use-cases/model/headless-model-metadata.use-case.ts'

    def selected(self, paths, required=('documentation',)):
        return {c['id']: c for c in catalog.plan(self.root, paths, list(required), 'c' * 64)['selected']}

    def test_exact_owner_runs_new_and_related_model_cases_and_strict_types(self):
        rows = self.selected([self.path])
        self.assertIn('headless-model-metadata-owner-unit', rows)
        self.assertIn('headless-model-metadata-owner-types', rows)
        self.assertNotIn('focused-tests', rows)
        self.assertIn('modules/application/use-cases/model/tests/model-download-tasks.use-case.unit.test.ts', rows['headless-model-metadata-owner-unit']['argv'])
        self.assertIn('--strict', rows['headless-model-metadata-owner-types']['argv'])
        self.assertNotIn('completion-all', rows)

    def test_unrelated_model_sources_and_explicit_generic_requests_keep_fallback(self):
        self.assertIn('focused-tests', self.selected([self.path], ('focused-tests',)))
        self.assertIn('focused-tests', self.selected([self.path, self.path.replace('headless-model-metadata', 'unknown-model-helper')]))

    def test_exact_declared_readmes_do_not_expand_into_all_application_tests(self):
        paths = [self.path, 'modules/application/use-cases/README.md', 'modules/contracts/README.md']
        self.assertNotIn('focused-tests', self.selected(paths))
        self.assertIn('documentation', self.selected(paths))

    def test_shared_barrels_do_not_automatically_select_this_unrelated_component(self):
        path = 'modules/contracts/headless/index.ts'
        self.assertNotIn('headless-model-metadata-owner-unit', self.selected([path]))
        explicit = self.selected([path], ('headless-model-metadata-owner-unit',))
        self.assertIn('headless-model-metadata-owner-unit', explicit)
        self.assertNotIn('focused-tests', explicit)


if __name__ == '__main__': unittest.main()

"""Strict manifest changes use bounded file/protocol fixtures, never model execution."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ModelManifestRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    required = ['headless-model-metadata-owner-unit', 'headless-model-metadata-owner-types',
                'headless-context-model-worker', 'headless-model-manifest-worker', 'headless-context-existing-runtime']

    def selected(self, paths, required=None):
        return {row['id']: row for row in catalog.plan(self.root, paths, required or self.required, 'a' * 64)['selected']}

    def test_exact_manifest_closure_keeps_file_worker_client_types_and_owner_checks(self):
        paths = list(catalog.PUBLISHED_FORM_CHECKS['headless-model-manifest-worker']['sources'])
        rows = self.selected(paths)
        self.assertNotIn('focused-tests', rows)
        self.assertEqual(rows['headless-model-manifest-worker']['argv'], [sys.executable, '-B', '-m', 'unittest', '-v',
            'modules.adapters.runtime.python.worker.tests.test_model_download_manifest.ModelDownloadManifestTests'])
        for name in ['headless-model-metadata-owner-unit', 'headless-model-metadata-owner-types']:
            self.assertIn('modules/adapters/runtime/python/tests/model-download-manifest.unit.test.ts', rows[name]['argv'])
        self.assertIn('modules/adapters/runtime/python/tests/createPythonRuntimeTaskRegistryAdapter.unit.test.ts',
                      rows['headless-context-existing-runtime']['argv'])
        self.assertNotIn('completion-all', rows)

    def test_exact_new_sources_select_manifest_profile_but_shared_worker_does_not_borrow_it(self):
        for source in catalog.PUBLISHED_FORM_CHECKS['headless-model-manifest-worker']['automatic_sources']:
            self.assertIn('headless-model-manifest-worker', self.selected([source], ['architecture']))
        shared = self.selected(['modules/adapters/runtime/python/worker/models.py'], ['architecture'])
        self.assertNotIn('headless-model-manifest-worker', shared)
        self.assertIn('focused-tests', shared)

    def test_unknown_sources_and_explicit_generic_checks_retain_fallback(self):
        sources = list(catalog.PUBLISHED_FORM_CHECKS['headless-model-manifest-worker']['sources'])
        self.assertIn('focused-tests', self.selected(sources + ['modules/adapters/runtime/python/client/unknown-manifest-effect.ts']))
        self.assertIn('focused-tests', self.selected(sources, self.required + ['focused-tests']))


if __name__ == '__main__':
    unittest.main()

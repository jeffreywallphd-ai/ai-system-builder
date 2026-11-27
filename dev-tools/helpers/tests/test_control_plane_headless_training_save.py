"""Exact private Save checks preserve unknown-impact and missing-file fallbacks."""
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingSaveRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    unit = "headless-training-save-owner-unit"
    types = "headless-training-save-owner-types"

    def selected(self, paths, required=("architecture",), root=None):
        return {r['id']: r for r in catalog.plan(root or self.root, list(paths), list(required), 'b' * 64)['selected']}

    def test_new_owner_runs_whole_real_feature_files_and_strict_consumers(self):
        for source in catalog.PUBLISHED_FORM_CHECKS[self.unit]['automatic_sources']:
            rows = self.selected([source])
            self.assertNotIn('focused-tests', rows)
            self.assertEqual(rows[self.unit]['argv'], ['node', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', '--', *catalog.TRAINING_SAVE_OWNER_TESTS])
            command = rows[self.types]['argv']
            self.assertIn('--strict', command)
            self.assertIn(catalog.TRAINING_SAVE_OWNER_REQUIRED[0], command)
            for test in catalog.TRAINING_SAVE_OWNER_TESTS:
                self.assertIn(test, command)

    def test_unknown_or_explicit_generic_impact_retains_broad_selection(self):
        source = catalog.TRAINING_SAVE_OWNER_REQUIRED[0]
        self.assertIn('focused-tests', self.selected([source, 'modules/application/use-cases/model/unmapped-save.ts']))
        self.assertIn('focused-tests', self.selected([source], ('focused-tests',)))
        rows = self.selected(catalog.TRAINING_SAVE_OWNER_SCOPE)
        self.assertNotIn('focused-tests', rows)
        self.assertIn('test_control_plane_headless_training_save.', rows['control-plane']['argv'])
        self.assertNotIn('test_control_plane_headless_training_save.', self.selected(
            [*catalog.TRAINING_SAVE_OWNER_SCOPE, 'modules/application/use-cases/model/unmapped-save.ts'])['control-plane']['argv'])
        self.assertNotIn('test_control_plane_headless_training_save.', self.selected(
            catalog.TRAINING_SAVE_OWNER_SCOPE, ('focused-tests',))['control-plane']['argv'])

    def test_each_missing_or_nonregular_required_file_denies_narrow_coverage(self):
        required = catalog.TRAINING_SAVE_OWNER_REQUIRED
        for missing in required:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory(prefix='save-routing-') as directory:
                root = Path(directory)
                for name in required:
                    p = root/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('// presence fixture only\n')
                self.assertIn(self.unit, self.selected([required[0]], root=root))
                p = root/missing; p.unlink()
                for nonregular in (False, True):
                    if nonregular: p.mkdir()
                    rows = self.selected([required[0]], root=root)
                    self.assertNotIn(self.unit, rows)
                    self.assertNotIn(self.types, rows)
                    self.assertIn('focused-tests', rows)


if __name__ == '__main__':
    unittest.main()

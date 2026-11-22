"""Exercise actual private Model selection assertions, never a model/Native job."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingModelRecordCheckTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = 'modules/application/use-cases/model/headless-model-training-model.use-case.ts'
    test = 'modules/application/use-cases/model/tests/headless-model-training-model.unit.test.ts'
    unit = 'headless-training-model-record-unit'
    types = 'headless-training-model-record-types'

    def selected(self, paths, required=('architecture',), root=None):
        return {row['id']: row for row in catalog.plan(root or self.root, paths, list(required), 'a' * 64)['selected']}

    def test_exact_feature_and_type_commands_are_selected_together(self):
        for path in (self.source, self.test):
            selected = self.selected([path])
            self.assertEqual(selected[self.unit]['argv'], ['node', '--import', 'tsx', '--test', '--test-reporter=tap', '--', self.test])
            self.assertEqual(selected[self.types]['argv'][-2:], [self.source, self.test])
            self.assertIn('--noEmit', selected[self.types]['argv'])
            self.assertNotIn('completion-all', selected)
            self.assertNotIn('focused-tests', selected)

    def test_other_sources_and_explicit_generic_checks_keep_their_coverage(self):
        self.assertIn('focused-tests', self.selected([self.source], ('focused-tests',)))
        self.assertIn('focused-tests', self.selected([self.source, 'modules/unknown/new.ts']))
        self.assertTrue(set(self.selected(['dev-tools/helpers/control_plane/storage.py'])).issubset(
            self.selected([self.source, 'dev-tools/helpers/control_plane/storage.py'])))
        self.assertNotIn(self.unit, self.selected(['modules/application/use-cases/README.md']))

    def test_missing_source_cannot_select_an_automatic_feature_check(self):
        with tempfile.TemporaryDirectory(prefix='model-record-routing-') as folder:
            selected = self.selected([self.source], root=Path(folder))
            self.assertNotIn(self.unit, selected)
            self.assertNotIn(self.types, selected)

    def test_registered_commands_execute_real_model_record_and_type_assertions(self):
        selected = self.selected([self.source])
        with tempfile.TemporaryDirectory(prefix='model-record-command-') as folder:
            env = {**os.environ, 'TEMP': folder, 'TMP': folder, 'TMPDIR': folder}
            result = subprocess.run(selected[self.unit]['argv'], cwd=self.root, env=env, timeout=120,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8', errors='replace')
            self.assertEqual(result.returncode, 0, result.stdout[-5000:])
            count = re.search(r'(?m)^# tests ([0-9]+)\s*$', result.stdout)
            self.assertIsNotNone(count, result.stdout[-5000:])
            self.assertGreaterEqual(int(count[1]), 18)
            self.assertRegex(result.stdout, r'(?m)^# fail 0\s*$')
            self.assertRegex(result.stdout, r'(?m)^# skipped 0\s*$')
            typed = subprocess.run(selected[self.types]['argv'], cwd=self.root, env=env, timeout=120,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf8', errors='replace')
            self.assertEqual(typed.returncode, 0, typed.stdout[-5000:])
            print(f'Executed {count[1]} real private Model selection cases and selected type checks; no model/runtime/Native effect.')


if __name__ == '__main__':
    unittest.main()

"""Run portable UI evidence refusals; never replay the retained app/model effect."""
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingUiEvidenceRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = 'dev-tools/helpers/native-qualification/training_ui_evidence.py'
    test = 'dev-tools/helpers/native-qualification/tests/test_training_ui_evidence.py'
    report = 'docs/operations/headless-local-training-ui-qualification.json'
    unit = 'training-ui-evidence-unit'
    actual = 'training-ui-retained-evidence'

    def selected(self, paths, required=('architecture',), root=None):
        return {row['id']: row for row in catalog.plan(root or self.root, paths, list(required), 'a' * 64)['selected']}

    def test_distinct_unit_and_actual_commands_cannot_be_confused(self):
        for path in (self.source, self.test):
            selected = self.selected([path])
            self.assertEqual(selected[self.unit]['argv'], [sys.executable, '-B',
                'dev-tools/helpers/run_focused_checks.py', '--regression-test', self.test])
            self.assertNotIn(self.actual, selected)
            self.assertNotIn('completion-all', selected)
        selected = self.selected([self.report])
        self.assertEqual(selected[self.actual]['argv'], [sys.executable, '-B', self.source])
        self.assertEqual(selected[self.actual]['timeout'], 180)

    def test_other_impact_and_explicit_generic_checks_keep_original_coverage(self):
        self.assertIn('focused-tests', self.selected([self.source], ('focused-tests',)))
        self.assertIn('focused-tests', self.selected([self.source, 'modules/unknown/new.ts']))
        unknown = 'dev-tools/helpers/native-qualification/unknown.py'
        self.assertTrue(set(self.selected([unknown])).issubset(self.selected([self.source, unknown])))
        self.assertNotIn(self.unit, self.selected(['dev-tools/helpers/native-qualification/README.md']))

    def test_missing_sources_cannot_select_an_automatic_evidence_check(self):
        with tempfile.TemporaryDirectory(prefix='ui-routing-') as folder:
            self.assertNotIn(self.unit, self.selected([self.source], root=Path(folder)))
            self.assertNotIn(self.actual, self.selected([self.report], root=Path(folder)))

    def test_registered_unit_command_executes_actual_package_file_and_denial_cases(self):
        argv = self.selected([self.source])[self.unit]['argv']
        with tempfile.TemporaryDirectory(prefix='ui-command-') as folder:
            env = {**os.environ, 'TEMP': folder, 'TMP': folder, 'TMPDIR': folder,
                   'PYTEST_ADDOPTS': '--bad-ambient-option', 'PYTEST_PLUGINS': 'not-an-allowed-plugin'}
            result = subprocess.run(argv, cwd=self.root, env=env, timeout=120, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, encoding='utf8', errors='replace')
            self.assertEqual(result.returncode, 0, result.stdout[-5000:])
            counts = re.findall(r'\bRan ([0-9]+) tests? in ', result.stdout)
            self.assertTrue(counts, result.stdout[-5000:])
            self.assertGreaterEqual(int(counts[-1]), 15)
            self.assertRegex(result.stdout, r'(?m)^OK\s*$')
            self.assertNotRegex(result.stdout, r'\bskipped=[1-9]|\bFAILED\b')
            print(f'Executed {counts[-1]} actual UI evidence-parser cases; no build/extraction/launch/native/model effects.')


if __name__ == '__main__':
    unittest.main()

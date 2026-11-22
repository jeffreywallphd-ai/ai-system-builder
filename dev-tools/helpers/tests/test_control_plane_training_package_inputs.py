"""Run the actual disposable byte-preparation assertions through the fixed check."""
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingPackageInputsRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = 'dev-tools/helpers/native-qualification/training_package_inputs.py'
    test = 'dev-tools/helpers/native-qualification/tests/test_training_package_inputs.py'
    helper = 'dev-tools/helpers/run_focused_checks.py'
    check = 'training-package-inputs-unit'

    def selected(self, paths, required=('architecture',), root=None):
        return {row['id']: row for row in catalog.plan(root or self.root, paths, list(required), 'a' * 64)['selected']}

    def test_exact_source_and_test_choose_the_bounded_real_command(self):
        for path in (self.source, self.test):
            selected = self.selected([path])
            self.assertEqual(selected[self.check]['argv'], [sys.executable, '-B', self.helper,
                                                            '--regression-test', self.test])
            self.assertLessEqual(selected[self.check]['timeout'], 120)
            self.assertNotIn('focused-tests', selected)
            self.assertNotIn('operational-ui', selected)
            self.assertNotIn('completion-all', selected)

    def test_only_paired_readmes_borrow_the_selected_profile(self):
        for readme in ('dev-tools/README.md', 'dev-tools/helpers/native-qualification/README.md'):
            self.assertNotIn(self.check, self.selected([readme]))
            self.assertNotIn('focused-tests', self.selected([self.source, readme]))
            self.assertIn('focused-tests', self.selected([self.source, readme], ('focused-tests',)))

    def test_other_native_or_unknown_helpers_do_not_borrow_this_profile(self):
        for source in ('dev-tools/helpers/native-qualification/owned_command_job.py',
                       'dev-tools/helpers/native-qualification/unknown.py'):
            self.assertNotIn(self.check, self.selected([source]))
            # Keep all pre-existing coverage for the foreign path.
            self.assertTrue(set(self.selected([source])).issubset(self.selected([self.source, source])))
        self.assertIn('focused-tests', self.selected([self.source], ('focused-tests',)))

    def test_missing_or_nonregular_sources_cannot_select_the_new_check(self):
        with tempfile.TemporaryDirectory(prefix='training-input-routing-') as directory:
            root = Path(directory)
            for name in (self.source, self.test, self.helper):
                self.assertNotIn(self.check, self.selected([self.source], root=root))
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.mkdir()
                self.assertNotIn(self.check, self.selected([self.source], root=root))
                target.rmdir()
                target.write_text('# Presence fixture, not execution evidence.\n')
            self.assertIn(self.check, self.selected([self.source], root=root))

    def test_registered_command_runs_real_file_assertions_and_no_skips(self):
        argv = self.selected([self.source])[self.check]['argv']
        with tempfile.TemporaryDirectory(prefix='training-input-command-') as directory:
            env = {**os.environ, 'TEMP': directory, 'TMP': directory, 'TMPDIR': directory,
                   'PYTEST_ADDOPTS': '--bad-ambient-argument', 'PYTEST_PLUGINS': 'not_an_allowed_plugin'}
            result = subprocess.run(argv, cwd=self.root, env=env, timeout=120, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
            self.assertEqual(result.returncode, 0, result.stdout[-3000:])
            counts = re.findall(r'\bRan ([0-9]+) tests? in ', result.stdout)
            self.assertTrue(counts, result.stdout[-3000:])
            self.assertGreaterEqual(int(counts[-1]), 27)
            self.assertRegex(result.stdout, r'(?m)^OK\s*$')
            self.assertNotRegex(result.stdout, r'\bskipped=[1-9][0-9]*|\bFAILED\b')
            print(f'Training package byte preparation: {counts[-1]} actual disposable cases; no native/model execution.')


if __name__ == '__main__':
    unittest.main()

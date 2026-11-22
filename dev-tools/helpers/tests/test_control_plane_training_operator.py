"""Execute fixed renderer/role fixtures through the existing native policy profile."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingOperatorRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    sources = ('dev-tools/helpers/native-qualification/training_operator.py',
               'dev-tools/helpers/native-qualification/tests/test_training_operator.py',
               *('dev-tools/helpers/native-qualification/training-operator/' + name
                 for name in ('global-setup.mjs', 'offline-package.mjs', 'package-tree.mjs', 'playwright.config.mjs')))

    def selected(self, paths, required=('architecture',)):
        return {row['id']: row for row in catalog.plan(self.root, paths, list(required), 'a' * 64)['selected']}

    def test_all_six_exact_sources_select_the_existing_closed_profile(self):
        for source in self.sources:
            selected = self.selected([source])
            self.assertEqual(selected['native-host-policy']['argv'],
                [sys.executable, '-B', 'dev-tools/helpers/run_focused_checks.py', '--profile', 'native-host-policy'])
            self.assertNotIn('focused-tests', selected)
            self.assertNotIn('operational-ui', selected)
            self.assertNotIn('completion-all', selected)

    def test_profile_owns_actual_new_renderer_file_and_retains_prior_cases(self):
        profile = json.loads((self.root / 'dev-tools/config/contributor-check-profiles.json').read_text())['profiles']['native-host-policy']
        self.assertTrue(set(self.sources).issubset(profile['source_paths']))
        self.assertIn(self.sources[1], profile['test_paths'])
        self.assertIn('dev-tools/helpers/native-qualification/tests/test_owned_command_job.py', profile['test_paths'])
        self.assertIn('dev-tools/helpers/native-qualification/tests/test_serial_provided_coordinator.py', profile['test_paths'])
        self.assertIn('dev-tools/helpers/native-qualification/tests/provided-data-helpers.unit.test.mjs', profile['test_paths'])

    def test_unknown_neighbors_and_explicit_generic_checks_keep_fallback(self):
        self.assertIn('focused-tests', self.selected([self.sources[0]], ('focused-tests',)))
        unknown = 'dev-tools/helpers/native-qualification/unknown.py'
        self.assertTrue(set(self.selected([unknown])).issubset(self.selected([self.sources[0], unknown])))
        self.assertIn('focused-tests', self.selected([self.sources[0], 'modules/adapters/unknown/example.ts']))

    def test_registered_profile_executes_actual_new_cases_without_native_opt_in(self):
        argv = self.selected([self.sources[0]])['native-host-policy']['argv']
        # The ordinary portable profile must keep the physical opt-in absent.
        env = {key: value for key, value in os.environ.items() if key != 'AISB_RUN_FIXED_NATIVE_QUALIFICATION'}
        result = subprocess.run(argv, cwd=self.root, env=env, timeout=180, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, encoding='utf8', errors='replace')
        self.assertEqual(result.returncode, 0, result.stdout[-4000:])
        counts = re.findall(r'\bRan ([0-9]+) tests? in ', result.stdout)
        self.assertIn('11', counts, result.stdout[-4000:])
        self.assertNotIn('FAILED', result.stdout)
        print('Native policy profile executed the actual11 renderer/refusal cases; physical opt-in remains unavailable.')


if __name__ == '__main__':
    unittest.main()

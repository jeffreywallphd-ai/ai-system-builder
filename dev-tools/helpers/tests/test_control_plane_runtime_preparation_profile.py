"""Passive preparation checks retain bounded ownership and generic fallbacks."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import profile_commands

CONFIG = 'dev-tools/config/contributor-check-profiles.json'
PROFILE = 'security-runtime'
RUNTIME = 'modules/adapters/runtime/python/'
QUALIFICATION = 'dev-tools/scripts/qualification/'
CORE_SOURCES = [RUNTIME + name for name in [
    'pythonRuntimePreparationDiagnostics.ts', 'preparePythonRuntimeEnvironment.ts',
    'ensurePythonRuntimeWorkerDependencies.ts', 'ensurePythonRuntimeContextDependencies.ts', 'index.ts',
]] + [
    'modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts',
    'modules/hosts/server/composition/composeServerHost.ts',
    QUALIFICATION + 'visual-composer/provided-runtime-preparation-observer.ts',
]
CORE_TESTS = [RUNTIME + 'tests/' + name for name in [
    'python-runtime-preparation-diagnostics.unit.test.ts', 'preparePythonRuntimeEnvironment.unit.test.ts',
    'ensurePythonRuntimeWorkerDependencies.unit.test.ts', 'ensurePythonRuntimeContextDependencies.unit.test.ts',
]] + [
    'modules/hosts/desktop/composition/tests/composeDesktopHost.unit.test.ts',
    'modules/hosts/server/composition/tests/composeServerHost.unit.test.ts',
    QUALIFICATION + 'tests/provided-runtime-preparation-observer.unit.test.ts',
    QUALIFICATION + 'tests/provided-dataset-server-lifecycle.unit.test.ts',
]


class RuntimePreparationProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual = HELPERS.parents[1]
        self.profiles = json.loads((self.actual / CONFIG).read_bytes())['profiles']
        self.profile = self.profiles[PROFILE]
        temporary = tempfile.TemporaryDirectory(prefix='preparation-profile-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def configure(self, profile):
        target = self.root / CONFIG
        target.parent.mkdir(parents=True, exist_ok=True)
        profiles = copy.deepcopy(self.profiles)
        profiles[PROFILE] = profile
        target.write_text(json.dumps({'schema_version': 'contributor-check-profiles-v1',
                                     'profiles': profiles}), encoding='utf-8')

    def selected(self, paths, required=None):
        return catalog.plan(self.root, paths, required or [PROFILE], 'synthetic-candidate')

    def test_related_tests_are_registered_without_native_model_or_app_launches(self):
        self.assertEqual(len(self.profile['test_paths']), 36)
        self.assertEqual(len(self.profile['source_paths']), 68)
        self.assertTrue(set(CORE_SOURCES).issubset(self.profile['source_paths']))
        self.assertTrue(set(CORE_TESTS).issubset(self.profile['test_paths']))
        commands = profile_commands(self.actual, PROFILE)
        executed = {test for test in self.profile['test_paths'] for command in commands
                    if test in command or ('unittest' in command and Path(test).parent.as_posix() in command
                                           and Path(test).name in command)}
        self.assertEqual(executed, set(self.profile['test_paths']))
        for command in commands:
            self.assertFalse(any('playwright' in argument or '.ai.' in argument or
                                 'qualification_job' in argument or '--suite=' in argument
                                 for argument in command))
        self.assertNotIn(PROFILE, catalog.QUALIFICATION_PROFILE_PATTERNS)

    def test_complete_ownership_and_unknown_or_explicit_generic_checks(self):
        self.configure(self.profile)
        for extra, required, generic in [([], [PROFILE], False),
                                         ([RUNTIME + 'unreviewed.ts'], [PROFILE], True),
                                         ([], [PROFILE, 'focused-tests'], True)]:
            with self.subTest(extra=extra, required=required):
                ids = {row['id'] for row in self.selected(CORE_SOURCES + CORE_TESTS + extra, required)['selected']}
                self.assertIn(PROFILE, ids)
                self.assertEqual('focused-tests' in ids, generic)

    def test_missing_source_or_test_declaration_retains_generic_fallback(self):
        for field, missing in [('source_paths', CORE_SOURCES[0]), ('test_paths', CORE_TESTS[0])]:
            profile = copy.deepcopy(self.profile)
            profile[field].remove(missing)
            self.configure(profile)
            ids = {row['id'] for row in self.selected([missing])['selected']}
            self.assertIn('focused-tests', ids)

    def test_original_source_and_test_limits_still_refuse_oversized_profiles(self):
        for field, count in [('source_paths', 201), ('test_paths', 101)]:
            profile = copy.deepcopy(self.profile)
            profile[field] = [f'modules/synthetic/file-{number}.unit.test.ts' for number in range(count)]
            self.configure(profile)
            with self.assertRaises(ControlError):
                self.selected([CORE_SOURCES[0]])

    def test_fixed_profile_configuration_is_classified_without_widening_siblings(self):
        self.configure(self.profile)
        plan = self.selected([CONFIG])
        self.assertIn('control-plane', plan['coverage'][CONFIG])
        self.assertNotIn('focused-tests', {row['id'] for row in plan['selected']})
        sibling = 'dev-tools/config/unreviewed-profile.json'
        plan = self.selected([sibling])
        self.assertNotIn('control-plane', plan['coverage'][sibling])
        self.assertIn('focused-tests', {row['id'] for row in plan['selected']})


if __name__ == '__main__':
    unittest.main()

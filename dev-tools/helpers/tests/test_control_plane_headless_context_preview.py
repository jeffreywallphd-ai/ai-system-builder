"""Exact Context metadata tests retain the fallback for unmapped behavior."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class ContextPreviewRoutingTests(unittest.TestCase):
    def selected(self, paths, required=None):
        return {row['id']: row for row in catalog.plan(HELPERS.parents[1], paths, required or ['architecture'], 'a' * 64)['selected']}

    def test_metadata_contract_compiler_registry_and_two_host_fences_select_exact_checks(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-input-preview']
        selected = self.selected(list(definition['automatic_sources']))
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-input-preview']['argv']
        for path in definition['automatic_sources']:
            if '/tests/' in path:
                self.assertIn(path, command)
        self.assertNotIn('--suite=all', command)
        self.assertNotIn('focused-tests', self.selected(list(definition['automatic_sources']) + ['modules/hosts/server/composition/README.md']))
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']) + ['modules/application/use-cases/context-management/unmapped.ts']))
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']), ['focused-tests']))

    def test_context_addition_does_not_claim_unrelated_registry_or_runtime_coverage(self):
        for path in ['modules/adapters/persistence/model/unknown.ts', 'modules/adapters/runtime/python/worker/context/unknown.py']:
            self.assertIn('focused-tests', self.selected([path]))

    def test_owned_start_selects_exact_admission_lifecycle_and_ordinary_context_regressions(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-owned-start']
        selected = self.selected(list(definition['automatic_sources']))
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-owned-start']['argv']
        for name in ['context-approved-start.unit.test.ts', 'context-generation.use-case.unit.test.ts',
                     'context-browser.use-cases.unit.test.ts', 'owned-task-reconciler.service.unit.test.ts']:
            self.assertTrue(any(path.endswith('/' + name) for path in command))
        self.assertNotIn('--suite=all', command)
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']) + ['modules/application/use-cases/context-management/unmapped-start.ts']))
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']), ['focused-tests']))

    def test_existing_runtime_routes_exact_probe_supervisor_registry_and_router_checks(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-existing-runtime']
        selected = self.selected(list(definition['automatic_sources']))
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-existing-runtime']['argv']
        for path in definition['automatic_sources']:
            if '/tests/' in path:
                self.assertIn(path, command)
        self.assertNotIn('--suite=all', command)
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']) + ['modules/adapters/runtime/python/unknown-admission.ts']))
        self.assertIn('focused-tests', self.selected(list(definition['automatic_sources']), ['focused-tests']))

    def test_installed_hosts_select_only_the_scoped_composition_and_ordinary_compatibility_cases(self):
        definition = catalog.PUBLISHED_FORM_CHECKS['headless-context-installed-host']
        paths = list(definition['sources'])
        selected = self.selected(paths, ['headless-context-existing-runtime', 'architecture'])
        self.assertNotIn('focused-tests', selected)
        command = selected['headless-context-installed-host']['argv']
        self.assertIn('--test-name-pattern', command)
        pattern = command[command.index('--test-name-pattern') + 1]
        for name in ['installed-only', 'prepares Context dependencies', 'prepares text-training dependencies', 'starts the lazy Python runtime']:
            self.assertIn(name, pattern)
        for path in definition['sources']:
            if '/tests/' in path:
                self.assertIn(path, command)
        self.assertNotIn('--suite=all', command)
        self.assertIn('focused-tests', self.selected(paths))
        self.assertIn('focused-tests', self.selected(paths + ['modules/hosts/server/composition/unmapped-installed.ts'], ['headless-context-existing-runtime', 'architecture']))
        self.assertIn('focused-tests', self.selected(paths, ['headless-context-existing-runtime', 'focused-tests']))

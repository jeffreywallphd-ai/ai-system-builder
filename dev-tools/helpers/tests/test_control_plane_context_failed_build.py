"""Failure evidence requires exact actual journeys and bounded negative oracles."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class ContextFailedBuildRoutingTests(unittest.TestCase):
    def selected(self, paths, required=('documentation',)):
        return {row['id']: row for row in catalog.plan(HELPERS.parents[1], paths, list(required), 'b' * 64)['selected']}

    def test_failure_oracle_selects_negative_cases_and_strict_types_without_claiming_a_live_host(self):
        path = 'dev-tools/scripts/qualification/visual-composer/e2e/headless-context-failure-oracles.ts'
        rows = self.selected([path])
        self.assertIn('headless-context-failure-oracles', rows)
        self.assertIn('headless-context-failure-types', rows)
        self.assertIn('--strict', rows['headless-context-failure-types']['argv'])
        self.assertIn('dev-tools/scripts/qualification/tests/headless-context-failure-oracles.unit.test.ts', rows['headless-context-failure-oracles']['argv'])
        self.assertNotIn('headless-context-desktop-journey', rows)
        self.assertNotIn('headless-context-managed-journey', rows)
        self.assertNotIn('focused-tests', rows)
        self.assertIn('focused-tests', self.selected([path], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([path, path.replace('failure-oracles', 'unknown-oracle')]))

    def test_shared_real_workflow_still_executes_both_hosts_and_keeps_generic_fallback(self):
        path = 'dev-tools/scripts/qualification/visual-composer/e2e/headless-context-workflow.ts'
        rows = self.selected([path])
        for name in ['headless-context-desktop-journey', 'headless-context-managed-journey']:
            self.assertIn(name, rows)
        self.assertNotIn('headless-context-failure-oracles', rows)
        self.assertNotIn('focused-tests', rows)
        self.assertIn('focused-tests', self.selected([path], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([path, path.replace('headless-context-workflow', 'unknown-workflow')]))


if __name__ == '__main__':
    unittest.main()

"""Owned-startup evidence is exact, physical where declared, and non-transitive."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class OwnedRuntimeStartupRoutingTests(unittest.TestCase):
    def selected(self, paths, required=('documentation',)):
        return {row['id']: row for row in catalog.plan(HELPERS.parents[1], paths, list(required), 'b' * 64)['selected']}

    def test_exact_private_protocol_selects_node_collision_and_lifecycle_tests(self):
        path = 'modules/adapters/runtime/python/supervisor/ownedPythonRuntimeProof.ts'
        rows = self.selected([path])
        check = rows['python-runtime-owned-startup']
        for test in ['ownedPythonRuntimeProof', 'ownedPythonRuntimeStartup', 'createPythonRuntimeHttpClient']:
            self.assertIn('modules/adapters/runtime/python/tests/' + test + '.unit.test.ts', check['argv'])
        self.assertNotIn('focused-tests', rows)
        self.assertNotIn('completion-all', rows)
        self.assertIn('focused-tests', self.selected([path], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([path, path.replace('ownedPythonRuntimeProof', 'unknownProtocol')]))

    def test_worker_main_selects_exclusive_socket_and_existing_bootstrap_auth_tests(self):
        path = 'modules/adapters/runtime/python/worker/main.py'
        rows = self.selected([path])
        check = rows['python-runtime-owned-worker']
        for name in ['test_owned_startup', 'test_main', 'test_worker_authentication']:
            self.assertIn('modules.adapters.runtime.python.worker.tests.' + name, check['argv'])
        self.assertNotIn('focused-tests', rows)
        self.assertNotIn('completion-all', rows)
        self.assertIn('focused-tests', self.selected([path], ['focused-tests']))

    def test_borrowed_shared_client_requires_explicit_ownership_check(self):
        path = 'modules/adapters/runtime/python/client/createPythonRuntimeHttpClient.ts'
        row = catalog.PUBLISHED_FORM_CHECKS['python-runtime-owned-startup']
        self.assertIn(path, row['sources']); self.assertNotIn(path, row['automatic_sources'])
        self.assertNotIn('python-runtime-owned-startup', self.selected([path]))
        selected = self.selected([path], ['python-runtime-owned-startup'])
        self.assertIn('python-runtime-owned-startup', selected)
        self.assertNotIn('focused-tests', selected)
        self.assertIn('focused-tests', self.selected([path], ['python-runtime-owned-startup', 'focused-tests']))


if __name__ == '__main__':
    unittest.main()

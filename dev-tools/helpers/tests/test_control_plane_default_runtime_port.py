"""Default runtime port coverage cannot claim unrelated host source changes."""
from pathlib import Path
import sys
import unittest

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import catalog


class DefaultPortRoutingTests(unittest.TestCase):
    def selected(self, paths, required=('documentation',)):
        return {row['id']: row for row in catalog.plan(HELPERS.parents[1], paths, list(required), 'b' * 64)['selected']}

    def test_fixed_actual_case_is_separate_and_bounded(self):
        path = 'dev-tools/scripts/qualification/visual-composer/headless-context-default-port.mjs'
        rows = self.selected([path])
        self.assertEqual(rows['headless-context-default-port']['argv'][-1], path)
        self.assertEqual(rows['headless-context-default-port']['timeout'], 720)
        self.assertNotIn('focused-tests', rows)
        self.assertNotIn('headless-context-desktop-journey', rows)
        self.assertIn('focused-tests', self.selected([path], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([path, path.replace('default-port', 'unknown-port')]))

    def test_owned_unit_files_select_actual_sockets_and_composition_mocks(self):
        net = 'modules/adapters/runtime/python/network/selectPythonRuntimeEndpoint.ts'
        unit = 'modules/adapters/runtime/python/tests/selectPythonRuntimeEndpoint.unit.test.ts'
        socket = unit.replace('.unit.', '.socket.unit.')
        host = 'modules/hosts/desktop/composition/tests/composeDesktopPythonRuntimeFeature.unit.test.ts'
        rows = self.selected([net, unit, socket, host])
        self.assertIn('python-runtime-port-node', rows)
        self.assertIn('python-runtime-port-composition', rows)
        self.assertIn(socket, rows['python-runtime-port-node']['argv'])
        self.assertIn(host, rows['python-runtime-port-composition']['argv'])
        self.assertNotIn('focused-tests', rows)
        self.assertNotIn('headless-context-default-port', rows)
        self.assertIn('focused-tests', self.selected([net, unit, socket, host], ['focused-tests']))
        self.assertIn('focused-tests', self.selected([net, net.replace('selectPythonRuntimeEndpoint', 'unknownEndpoint')]))

    def test_shared_root_borrowing_requires_explicit_selection(self):
        root = 'modules/hosts/desktop/composition/composeDesktopHost.ts'
        check = catalog.PUBLISHED_FORM_CHECKS['python-runtime-port-node']
        self.assertIn(root, check['sources'])
        self.assertNotIn(root, check['automatic_sources'])
        rows = self.selected([root], ['python-runtime-port-node'])
        self.assertIn('python-runtime-port-node', rows)
        self.assertNotIn('python-runtime-port-composition', self.selected([root]))


if __name__ == '__main__':
    unittest.main()

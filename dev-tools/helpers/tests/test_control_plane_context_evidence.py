"""Only the fixed current Context report check can qualify its measurements."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ContextEvidenceRoutingTests(unittest.TestCase):
    def test_exact_guard_and_report_select_execution_and_negative_tests(self):
        root = Path(__file__).resolve().parents[3]
        path = 'dev-tools/scripts/qualification/check_headless_context_evidence.py'
        selected = {c['id']: c for c in catalog.plan(root, [path], ['documentation'], 'a' * 64)['selected']}
        self.assertIn('headless-context-current-evidence', selected)
        self.assertIn('headless-context-evidence-unit', selected)
        self.assertNotIn('focused-tests', selected)
        self.assertEqual(selected['headless-context-current-evidence']['argv'][-1], path)
        explicit = catalog.plan(root, [path], ['focused-tests'], 'a' * 64)
        self.assertIn('focused-tests', {c['id'] for c in explicit['selected']})
        unknown = catalog.plan(root, [path, path.replace('evidence.py', 'unknown.py')], ['documentation'], 'a' * 64)
        self.assertIn('focused-tests', {c['id'] for c in unknown['selected']})


if __name__ == '__main__': unittest.main()

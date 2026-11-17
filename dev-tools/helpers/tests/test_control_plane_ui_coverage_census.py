"""The controller checks the fixed read-only UI census without launching hosts."""
from pathlib import Path
import os
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]

class UiCoverageCensusTests(unittest.TestCase):
    def test_fixed_node_definition_and_failure_checks(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "The existing Node test runtime is required.")
        env = dict(os.environ)
        env.pop("NODE_TEST_CONTEXT", None)
        result = subprocess.run([node, "--test", "dev-tools/helpers/tests/ui-coverage-census.unit.test.mjs"],
                                cwd=ROOT, env=env, capture_output=True, timeout=45)
        self.assertLess(len(result.stdout) + len(result.stderr), 128 * 1024)
        self.assertEqual(result.returncode, 0, "The fixed UI definition census tests failed.")

if __name__ == "__main__":
    unittest.main()

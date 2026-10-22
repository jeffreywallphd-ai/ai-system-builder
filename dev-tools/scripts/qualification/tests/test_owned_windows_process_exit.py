import os
from pathlib import Path
import subprocess
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from observe_windows_process_exit import observe


@unittest.skipUnless(os.name == "nt", "Windows reference host only")
class OwnedExitTests(unittest.TestCase):
    def test_reads_actual_owned_exit_and_rejects_a_host_already_exited(self):
        child = subprocess.Popen([sys.executable, "-s", "-B", "-c", "import sys;sys.stdin.read(1);sys.exit(23)"], stdin=subprocess.PIPE)
        try:
            code = observe(child.pid, lambda: (child.stdin.write(b"x"), child.stdin.flush()))
            self.assertEqual(code, 23)
            child.wait(timeout=5)
            with self.assertRaises(ValueError):
                observe(child.pid, lambda: self.fail("Exited process admitted"))
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=5)
            child.stdin.close()

    def test_rejects_invalid_identity(self):
        for value in (0, -1, True, 2 ** 32, "1"):
            with self.assertRaises(ValueError): observe(value, lambda: self.fail("Invalid process admitted"))


if __name__ == "__main__": unittest.main()

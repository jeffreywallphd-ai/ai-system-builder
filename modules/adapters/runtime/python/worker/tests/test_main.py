from __future__ import annotations

import runpy
import unittest
from pathlib import Path


class WorkerMainEntrypointTests(unittest.TestCase):
    def test_main_script_context_loads_app_without_relative_import_errors(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        self.assertIn("app", globals_after_run)


if __name__ == "__main__":
    unittest.main()

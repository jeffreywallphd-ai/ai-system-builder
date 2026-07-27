from __future__ import annotations

import runpy
import unittest
from os import environ
from pathlib import Path
from unittest.mock import patch


class WorkerMainEntrypointTests(unittest.TestCase):
    def test_main_script_context_loads_app_without_relative_import_errors(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        self.assertIn("app", globals_after_run)

    def test_launch_configuration_rejects_remote_bind_and_missing_authentication(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        resolve_launch_configuration = globals_after_run["_resolve_launch_configuration"]
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "0.0.0.0",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "worker-runtime-token-0123456789abcdef",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "loopback"):
                resolve_launch_configuration()
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "127.0.0.1",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "authentication"):
                resolve_launch_configuration()

    def test_launch_configuration_accepts_authenticated_loopback(self) -> None:
        main_path = Path(__file__).resolve().parents[1] / "main.py"
        globals_after_run = runpy.run_path(str(main_path), run_name="worker_main_test")
        resolve_launch_configuration = globals_after_run["_resolve_launch_configuration"]
        with patch.dict(
            environ,
            {
                "PYTHON_RUNTIME_HOST": "127.0.0.1",
                "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "worker-runtime-token-0123456789abcdef",
            },
            clear=False,
        ):
            self.assertEqual(resolve_launch_configuration(), ("127.0.0.1", 43111))


if __name__ == "__main__":
    unittest.main()

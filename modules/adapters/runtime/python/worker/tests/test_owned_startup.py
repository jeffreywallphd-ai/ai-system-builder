from __future__ import annotations

import asyncio
import contextlib
import io
import os
from pathlib import Path
import runpy
import shutil
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class OwnedStartupTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="owned-runtime-protocol-")
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        shutil.copyfile(Path(__file__).resolve().parents[1] / "main.py", root / "main.py")
        (root / "app.py").write_text("app = object()\n", encoding="utf-8")
        self.started = True
        self.wrong_address = False
        fixture = self

        class Server:
            def __init__(self, config):
                self.started = False

            async def startup(self, sockets=None):
                self.started = fixture.started
                for owned in sockets:
                    owned.listen(1)
                actual = sockets
                if fixture.wrong_address:
                    actual = [SimpleNamespace(getsockname=lambda: ("0.0.0.0", 1))]
                self.servers = [SimpleNamespace(sockets=actual)]

            def run(self, sockets=None):
                asyncio.run(self.startup(sockets=sockets))

        self.uvicorn = SimpleNamespace(Server=Server, Config=Mock(), run=Mock())
        with patch.dict(sys.modules, {"uvicorn": self.uvicorn}):
            self.run_runtime = runpy.run_path(str(root / "main.py"), run_name="owned_runtime_test")["_run_runtime"]

    def available_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as selected:
            selected.bind(("127.0.0.1", 0))
            return selected.getsockname()[1]

    def run_captured(self, nonce, host="127.0.0.1"):
        output = io.StringIO()
        self.port = self.available_port()
        with patch.dict(os.environ, {"PYTHON_RUNTIME_STARTUP_PROOF": nonce}), contextlib.redirect_stdout(output):
            self.run_runtime(host, self.port)
        return output.getvalue()

    def test_proof_is_emitted_only_after_owned_exclusive_socket_listens(self):
        output = self.run_captured("a" * 64)
        self.assertEqual(output, "AISB_OWNED_RUNTIME_READY_V1 " + "a" * 64 + " 127.0.0.1:" + str(self.port) + "\n")
        self.assertFalse(self.uvicorn.run.called)
        self.assertEqual(self.uvicorn.Config.call_args.kwargs["workers"], 1)

    def test_failed_server_start_never_emits_ready(self):
        self.started = False
        self.assertEqual(self.run_captured("a" * 64), "")

    def test_wrong_bound_socket_cannot_supply_proof(self):
        self.wrong_address = True
        with self.assertRaisesRegex(RuntimeError, "listening socket ownership is unavailable"):
            self.run_captured("a" * 64)

    def test_unconfigured_standalone_mode_retains_no_proof_compatibility(self):
        self.assertEqual(self.run_captured(""), "")
        self.assertTrue(self.uvicorn.run.called)
        self.assertFalse(self.uvicorn.Config.called)

    def test_malformed_nonce_and_noncanonical_host_fail_before_server(self):
        for nonce in ("a" * 63, "a" * 65, "G" * 64, "private\nvalue"):
            with self.subTest(nonce_length=len(nonce)), self.assertRaisesRegex(RuntimeError, "ownership proof is unavailable"):
                self.run_captured(nonce)
        with self.assertRaisesRegex(RuntimeError, "listening socket ownership is unavailable"):
            self.run_captured("a" * 64, "localhost")
        self.assertFalse(self.uvicorn.Config.called)

    def test_existing_listener_denies_before_proof_or_server_initialization(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as foreign:
            if sys.platform == "win32":
                foreign.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            foreign.bind(("127.0.0.1", 0)); foreign.listen(1)
            output = io.StringIO()
            with patch.dict(os.environ, {"PYTHON_RUNTIME_STARTUP_PROOF": "a" * 64}), contextlib.redirect_stdout(output):
                with self.assertRaises(OSError):
                    self.run_runtime("127.0.0.1", foreign.getsockname()[1])
            self.assertEqual(output.getvalue(), "")
            self.assertFalse(self.uvicorn.Config.called)


if __name__ == "__main__":
    unittest.main()

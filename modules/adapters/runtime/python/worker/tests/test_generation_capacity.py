from __future__ import annotations

import io
import os
from pathlib import Path
import subprocess
from threading import Event, Thread
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker import generation_capacity as capacity

TOTAL = 8 * 1024 ** 3
PAYLOAD = b"8192, [N/A], [N/A]\r\n"


class BoundedStream(io.BytesIO):
    def __init__(self, raw):
        super().__init__(raw)
        self.requested = []

    def read(self, count):
        self.requested.append(count)
        return super().read(count)


class FakeProcess:
    def __init__(self, raw=PAYLOAD, *, code=0, held_exit=None, held_output=None):
        self.stdout = BoundedStream(raw)
        if held_output is not None:
            stream = self.stdout
            class HeldOutput:
                def read(self, count):
                    held_output.wait()
                    return stream.read(count)
                def close(self):
                    stream.close()
            self.stdout = HeldOutput()
        self.returncode = None
        self.code, self.held_exit = code, held_exit
        self.kills = 0
        self.waited = Event()

    def wait(self, timeout=None):
        self.waited.set()
        if self.held_exit is not None and not self.held_exit.is_set():
            raise subprocess.TimeoutExpired("fixed-driver", timeout)
        self.returncode = self.code
        return self.code

    def poll(self):
        return self.returncode

    def kill(self):
        self.kills += 1


class GenerationCapacityTests(unittest.TestCase):
    def setUp(self):
        context = patch.dict(os.environ, {}, clear=True)
        context.start(); self.addCleanup(context.stop)

    def test_parser_accepts_one_bounded_total_and_no_identifying_fields(self):
        for raw in (PAYLOAD, b"8192, Disabled, Disabled\n", b"8192,N/A,N/A"):
            self.assertEqual(capacity._parse_total(raw), TOTAL)
        for raw in (None, b"", b"0,N/A,N/A", b"-1,N/A,N/A", b"1.5,N/A,N/A",
                    b"8192,Enabled,Disabled", b"8192,Disabled,Enabled",
                    b"8192,Disabled,N/A",
                    b"8192,Unknown,Unknown", b"8192,N/A,N/A\n8192,N/A,N/A\n",
                    b"8192,N/A,N/A,private-fixture", b"\xff", b"9" * 4097):
            with self.subTest(raw_kind=type(raw).__name__):
                self.assertIsNone(capacity._parse_total(raw))

    def test_masks_and_mps_are_unknown_before_any_query(self):
        reader = capacity._CapacityReader()
        with patch.object(capacity, "_query_driver") as query:
            for variable, value in (("CUDA_VISIBLE_DEVICES", ""), ("CUDA_VISIBLE_DEVICES", "1"),
                                    ("CUDA_VISIBLE_DEVICES", "0,1"), ("CUDA_VISIBLE_DEVICES", "GPU-fixture"),
                                    ("CUDA_VISIBLE_DEVICES", "MIG-fixture"), ("NVIDIA_VISIBLE_DEVICES", "none"),
                                    ("NVIDIA_VISIBLE_DEVICES", ""), ("CUDA_DEVICE_ORDER", "unknown"),
                                    ("CUDA_MPS_PINNED_DEVICE_MEM_LIMIT", "0=1G")):
                with patch.dict(os.environ, {variable: value}, clear=True):
                    self.assertIsNone(reader.read())
            query.assert_not_called()
        for values in ({}, {"CUDA_VISIBLE_DEVICES": "0"}, {"NVIDIA_VISIBLE_DEVICES": "all"},
                       {"NVIDIA_VISIBLE_DEVICES": "0", "CUDA_DEVICE_ORDER": "PCI_BUS_ID"}):
            with patch.dict(os.environ, values, clear=True):
                self.assertIsNotNone(capacity._visibility_key())

    def test_fixed_read_only_query_has_bounded_output_and_no_inherited_secrets(self):
        process = FakeProcess()
        with patch.dict(os.environ, {"HF_TOKEN": "synthetic-private-marker", "PATH": "untrusted-tool-path"}), \
                patch.object(capacity, "_driver_context", return_value=("/usr/bin/nvidia-smi", {"LC_ALL": "C"})), \
                patch.object(capacity.subprocess, "Popen", return_value=process) as spawn:
            self.assertEqual(capacity._query_driver(), TOTAL)
        args, kwargs = spawn.call_args
        self.assertEqual(args[0], ["/usr/bin/nvidia-smi", *capacity._ARGS])
        self.assertEqual(kwargs["cwd"], str(Path("/usr/bin/nvidia-smi").parent))
        self.assertEqual(kwargs["env"], {"LC_ALL": "C"})
        self.assertIs(kwargs["shell"], False)
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertEqual(kwargs["stderr"], subprocess.DEVNULL)
        self.assertTrue(process.stdout.closed)
        self.assertEqual(process.stdout.requested, [4097])
        self.assertEqual(process.kills, 0)

    def test_platform_context_ignores_user_path_and_secret_environment(self):
        with patch.dict(os.environ, {"HF_TOKEN": "synthetic-private-marker", "PATH": "untrusted-tool-path", "ProgramFiles": "untrusted-tool-path"}):
            context = capacity._driver_context()
        if capacity.sys.platform == "win32":
            executable, environment = context
            self.assertTrue(Path(executable).is_absolute())
            self.assertEqual(Path(executable).name, "nvidia-smi.exe")
            self.assertEqual(environment["PATH"], str(Path(executable).parent))
            self.assertEqual(set(environment), {"SystemRoot", "WINDIR", "ProgramFiles", "PATH", "LANG", "LC_ALL"})
            self.assertTrue(Path(environment["ProgramFiles"]).is_absolute())
        elif capacity.sys.platform.startswith("linux"):
            self.assertEqual(context, ("/usr/bin/nvidia-smi", {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"}))
        else:
            self.assertIsNone(context)
        if context is not None:
            self.assertNotIn("HF_TOKEN", context[1])
            self.assertNotIn("untrusted-tool-path", context[1].values())

    def test_error_missing_driver_and_oversized_output_are_silent_unknowns(self):
        with patch.object(capacity, "_driver_context", return_value=("/usr/bin/nvidia-smi", {})), \
                patch("builtins.print") as printed:
            for value in (FakeProcess(code=1), FakeProcess(b"9" * 4097)):
                with patch.object(capacity.subprocess, "Popen", return_value=value):
                    self.assertIsNone(capacity._query_driver())
            with patch.object(capacity.subprocess, "Popen", side_effect=OSError("private-fixture-path")):
                reader = capacity._CapacityReader()
                self.assertIsNone(reader.read())
            printed.assert_not_called()
        with patch.object(capacity.sys, "platform", "darwin"):
            self.assertIsNone(capacity._driver_context())

    def test_cache_retains_known_and_unknown_results_and_expires(self):
        for value in (TOTAL, None):
            reader = capacity._CapacityReader()
            with patch.object(capacity, "_query_driver", return_value=value) as query:
                self.assertEqual(reader.read(), value)
                self.assertEqual(reader.read(), value)
                self.assertEqual(query.call_count, 1)
                with reader._lock:
                    reader._expires = 0
                self.assertEqual(reader.read(), value)
                self.assertEqual(query.call_count, 2)

    def test_concurrent_reads_share_one_probe_and_recheck_visibility(self):
        started, release = Event(), Event()
        def query():
            started.set(); release.wait(); return TOTAL
        reader = capacity._CapacityReader()
        with patch.object(capacity, "_query_driver", side_effect=query) as probe, \
                patch.object(capacity, "_CALLER_WAIT_SECONDS", 0.01):
            self.assertIsNone(reader.read()); self.assertTrue(started.wait(1))
            workers = [Thread(target=reader.read) for _ in range(5)]
            for worker in workers: worker.start()
            for worker in workers: worker.join(1); self.assertFalse(worker.is_alive())
            self.assertEqual(probe.call_count, 1)
            with patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": ""}):
                self.assertIsNone(reader.read())
            completion = reader._active
            release.set(); self.assertTrue(completion.wait(1))
            self.assertEqual(reader.read(), TOTAL)
            self.assertEqual(probe.call_count, 1)
            with patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "MIG-fixture"}):
                self.assertIsNone(reader.read())

    def test_timeout_does_not_release_probe_before_confirmed_child_exit(self):
        release = Event(); process = FakeProcess(held_exit=release)
        reader = capacity._CapacityReader()
        with patch.object(capacity, "_driver_context", return_value=("/usr/bin/nvidia-smi", {})), \
                patch.object(capacity.subprocess, "Popen", return_value=process) as spawn, \
                patch.object(capacity, "_CALLER_WAIT_SECONDS", 0.01):
            self.assertIsNone(reader.read()); self.assertTrue(process.waited.wait(1))
            self.assertIsNone(reader.read()); self.assertEqual(spawn.call_count, 1)
            self.assertIsNotNone(reader._active); self.assertGreater(process.kills, 0)
            completion = reader._active
            release.set(); self.assertTrue(completion.wait(1))
            self.assertIsNone(reader.read())  # Late exit cannot turn a timeout into success.
            self.assertEqual(spawn.call_count, 1)

    def test_held_output_also_fences_new_probes_after_child_exit(self):
        release = Event(); process = FakeProcess(held_output=release)
        retiring = Event(); actual_retire = capacity._retire
        def retire(child, reader):
            retiring.set(); actual_retire(child, reader)
        reader = capacity._CapacityReader()
        with patch.object(capacity, "_driver_context", return_value=("/usr/bin/nvidia-smi", {})), \
                patch.object(capacity.subprocess, "Popen", return_value=process) as spawn, \
                patch.object(capacity, "_retire", side_effect=retire), \
                patch.object(capacity, "_CALLER_WAIT_SECONDS", 0.01):
            self.assertIsNone(reader.read()); self.assertIsNone(reader.read())
            self.assertEqual(spawn.call_count, 1); self.assertIsNotNone(reader._active)
            completion = reader._active
            self.assertTrue(retiring.wait(1))  # The output-drain deadline expired.
            self.assertIsNone(reader.read())
            release.set(); self.assertTrue(completion.wait(1))
            self.assertIsNone(reader.read())
            self.assertEqual(spawn.call_count, 1)

    def test_wire_model_rejects_non_integer_and_unbounded_totals(self):
        from pydantic import ValidationError
        from modules.adapters.runtime.python.worker.models import PythonRuntimeCapabilitiesResult
        self.assertEqual(PythonRuntimeCapabilitiesResult(runtimeId="fixture", capabilities=[], totalAcceleratorMemoryBytes=TOTAL).totalAcceleratorMemoryBytes, TOTAL)
        for value in (True, 0, -1, 1.5, "8589934592", 2 ** 53):
            with self.assertRaises(ValidationError):
                PythonRuntimeCapabilitiesResult(runtimeId="fixture", capabilities=[], totalAcceleratorMemoryBytes=value)

    def test_failed_output_retirement_keeps_the_probe_fenced(self):
        for failure in (OSError("private-close-fixture"), RuntimeError("private-retire-fixture")):
            reader = capacity._CapacityReader()
            process = FakeProcess()
            with patch.object(capacity, "_driver_context", return_value=("/usr/bin/nvidia-smi", {})), \
                    patch.object(capacity.subprocess, "Popen", return_value=process) as spawn, \
                    patch.object(capacity, "_retire", side_effect=failure), \
                    patch.object(capacity, "_CALLER_WAIT_SECONDS", 0.01):
                self.assertIsNone(reader.read())
                self.assertIsNone(reader.read())
                self.assertEqual(spawn.call_count, 1)
                self.assertIsNotNone(reader._active)
                self.assertFalse(reader._active.is_set())
                self.assertIs(reader._unconfirmed.process, process)
                self.assertIsNotNone(reader._unconfirmed.reader)
            process.stdout.close()  # Dispose this inert fixture only.


if __name__ == "__main__":
    unittest.main()

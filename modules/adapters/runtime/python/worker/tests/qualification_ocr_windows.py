"""Explicit model-free Windows qualification; never part of ordinary test discovery.

Creates only new UUID fixture bundles below the fixed ignored qualification root.
Uses installed compiler/SDK, downloads nothing, and never enables product OCR.
Run from the repo: python -B -m modules.adapters.runtime.python.worker.tests.qualification_ocr_windows --native
"""
from __future__ import annotations
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import uuid

from modules.adapters.runtime.python.worker.ocr import resource as r, windows_process as p
from modules.adapters.runtime.python.worker.ocr.wire import readiness_frame, parse_response
from modules.adapters.runtime.python.worker.ocr.windows_api import NativeFailure, Windows, need

ROOT = Path(__file__).absolute().parents[6]
RUNS = ROOT / ".local-codex/ocr-native-owner-qualification-v1"
OCR = ROOT / "modules/adapters/runtime/python/worker/ocr"
_GUARDIANS = {}
_OBSERVERS = {}
_OPERATOR_PENDING = {}
_RETIREMENTS = {}
_RETIREMENT_LOCK = threading.RLock()


def fresh_operator():
    need(not _OPERATOR_PENDING and not _GUARDIANS and not _OBSERVERS and
         not p._PENDING and not r._UNCERTAIN_RESOURCES, "uncertain-qualification-owner")


def strict_crash_shutdown(before_wait, after_wait, exit_code):
    # A pre-exited helper and arbitrary nonzero native exit are never a crash pass.
    return (type(before_wait) is int and before_wait == 258 and type(after_wait) is int and
            after_wait == 0 and type(exit_code) is int and exit_code == 0)


def directory(path, *, create=False):
    need(ROOT.resolve() == ROOT and path.is_relative_to(ROOT), "qualification-directory-confinement")
    for current in (ROOT, *[ROOT.joinpath(*path.relative_to(ROOT).parts[:index])
                           for index in range(1, len(path.relative_to(ROOT).parts) + 1)]):
        if not current.exists() and not current.is_symlink():
            need(create, "qualification-directory-missing")
            current.mkdir()
        info = current.lstat()
        need(current.is_dir() and not current.is_symlink() and current.resolve() == current and
             not (getattr(info, "st_file_attributes", 0) & 0x400), "qualification-directory-redirected")


def _begin_retirement(entry, registry):
    with _RETIREMENT_LOCK:
        need(type(entry) is dict, "operator-retirement-entry")
        record = _RETIREMENTS.get(id(entry))
        if record is not None:
            need(record["entry"] is entry, "operator-retirement-identity")
            if record["state"] == "retired":
                return False
            record["state"] = "uncertain"
            _OPERATOR_PENDING[id(entry)] = entry
            raise NativeFailure("operator-retirement-unconfirmed")
        need(registry.get(id(entry)) is entry and id(entry) not in _OPERATOR_PENDING,
             "operator-retirement-authority")
        # Strong exact-entry custody exists before any wait, join, detach or
        # close. Do not hold this lock across those operations.
        _RETIREMENTS[id(entry)] = {"entry": entry, "state": "retiring"}
        return True


def _finish_retirement(entry, registry):
    with _RETIREMENT_LOCK:
        record = _RETIREMENTS[id(entry)]
        need(record["entry"] is entry and record["state"] == "retiring" and
             id(entry) not in _OPERATOR_PENDING and registry.get(id(entry)) is entry,
             "operator-retirement-unconfirmed")
        registry.pop(id(entry))
        record["state"] = "retired"


def _retain_retirement(entry):
    record = _RETIREMENTS.get(id(entry))
    if record is not None and record["entry"] is entry:
        _OPERATOR_PENDING[id(entry)] = entry
        record["state"] = "uncertain"


def retire_guardian(entry, native):
    try:
        if not _begin_retirement(entry, _GUARDIANS):
            return
        _retire_guardian_once(entry, native)
        _finish_retirement(entry, _GUARDIANS)
    except BaseException:
        _retain_retirement(entry)
        raise NativeFailure("guardian-retirement-unconfirmed") from None


def _retire_guardian_once(entry, native):
    """Independently attempt retirement; preserve exact unacknowledged owners."""
    errors = []
    child, reader = entry.get("child"), entry.get("reader")
    exited = child is None
    if child is not None:
        try:
            if child.poll() is None:
                child.terminate()  # Exact newly-created Popen handle, never PID lookup.
        except BaseException:
            errors.append("guardian-stop")
        try:
            child.wait(timeout=10)
            exited = True
        except BaseException:
            errors.append("guardian-exit")
        if reader is not None and reader.ident is not None:
            try:
                reader.join(timeout=3)
            except BaseException:
                errors.append("guardian-reader-join")
        drained = reader is None or not reader.is_alive()
        if not drained:
            errors.append("guardian-reader-retirement")
        if exited and drained:
            for name in ("stdin", "stdout"):
                stream = getattr(child, name)
                try:
                    stream.close()
                    need(stream.closed, "guardian-stream-close")
                except BaseException:
                    errors.append("guardian-" + name + "-close")
            try:
                record = _RETIREMENTS[id(entry)]
                need(record["state"] == "retiring" and "process_handle" not in entry,
                     "guardian-handle-state")
                wrapper = child._handle
                handle = int(wrapper)
                need(0 < handle < 2**64 - 1, "guardian-handle-identity")
                record["process_wrapper"], record["native_handle"] = wrapper, handle
                detached = wrapper.Detach()
                record["detached_value"] = detached
                need(type(detached) is int and detached == handle, "guardian-handle-transfer")
                entry["process_handle"] = detached
                transferred = detached
            except BaseException:
                errors.append("guardian-handle-detach")
                transferred = None
            if transferred:
                try:
                    need(_RETIREMENTS[id(entry)]["state"] == "retiring", "guardian-handle-state")
                    need(native.k.CloseHandle(transferred), "guardian-handle-close")
                    need(entry.get("process_handle") == transferred, "guardian-handle-drift")
                    entry.pop("process_handle")
                except BaseException:
                    errors.append("guardian-handle-close")
    if errors:
        entry["errors"] = errors
    need(not errors, "guardian-retirement-unconfirmed")


def retire_observer(entry, native):
    try:
        if not _begin_retirement(entry, _OBSERVERS):
            return
        handle = entry["handle"].value
        _RETIREMENTS[id(entry)]["native_handle"] = handle
        if handle:
            need(native.k.CloseHandle(handle), "observer-close")
            need(entry["handle"].value == handle, "observer-handle-drift")
        _finish_retirement(entry, _OBSERVERS)
    except BaseException:
        _retain_retirement(entry)
        raise NativeFailure("observer-close-unconfirmed") from None


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def build(folder, source, native):
    need(not folder.exists() and not folder.is_symlink(), "fresh-build-directory")
    directory(folder, create=True)
    directory(folder / "build", create=True)
    directory(folder / "compiler-tmp", create=True)
    copied = folder / "WindowsOcrHelper.cs"
    with copied.open("xb") as stream:
        stream.write(source.read_bytes())
    windows = Path(native.environment()["SystemRoot"])
    compiler = windows / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    # Closed qualification environment; no SDK discovery, install or fallback.
    refs = [Path(windows.anchor) / "Program Files (x86)/Windows Kits/10/UnionMetadata/10.0.26100.0/Windows.winmd",
            windows / "Microsoft.NET/Framework64/v4.0.30319/System.Runtime.WindowsRuntime.dll",
            windows / "Microsoft.NET/assembly/GAC_MSIL/System.Runtime/v4.0_4.0.0.0__b03f5f7f11d50a3a/System.Runtime.dll",
            *[windows / ("Microsoft.NET/Framework64/v4.0.30319/" + name + ".dll")
              for name in ("System.Web.Extensions", "System", "System.Core")]]
    need(compiler.is_file() and all(path.is_file() for path in refs), "installed-qualification-sdk-required")
    executable = folder / "build/WindowsOcrHelper.exe"
    argv = [str(compiler), "/nologo", "/noconfig", "/target:exe", "/platform:x64",
            "/out:" + str(executable), *["/reference:" + str(path) for path in refs], str(copied)]
    compile_environment = {**native.environment(), "TEMP": str(folder / "compiler-tmp"),
                           "TMP": str(folder / "compiler-tmp")}
    with (folder / "compiler.stdout.log").open("xb") as out, (folder / "compiler.stderr.log").open("xb") as err:
        result = subprocess.run(argv, cwd=ROOT, env=compile_environment, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err, timeout=120, creationflags=0x08000000)
    need(result.returncode == 0 and source.read_bytes() == copied.read_bytes(), "compile-failed")
    manifest = {"schema_version": "windows-ocr-resource-v1", "provider": "windows", "provider_version": "1",
                "architecture": "x64", "source_sha256": digest(copied), "binary_sha256": digest(executable),
                "binary_bytes": executable.stat().st_size}
    save(folder / "build/resource.json", manifest)
    r._validate_manifest((folder / "build/resource.json").read_bytes(), copied.read_bytes(), executable.read_bytes())
    save(folder / "compile-proof.json", {"source_sha256": digest(source), "compiler_sha256": digest(compiler),
         "references": {str(path.relative_to(windows.anchor)): digest(path) for path in refs},
         "manifest": manifest, "exit_code": result.returncode, "binary_launched_by_build": False})


class WindowsOcrQualification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        need(os.name == "nt" and Path.cwd() == ROOT and not p._PENDING and not r._UNCERTAIN_RESOURCES,
             "fresh-windows-qualification-required")
        cls.native = Windows()
        # No historical run is inspected or repaired; every bundle is new.
        directory(RUNS, create=True)
        cls.folder = RUNS / uuid.uuid4().hex
        need(not cls.folder.exists(), "fresh-qualification-directory")
        directory(cls.folder, create=True)
        cls.fixture, cls.helper = cls.folder / "fixture", cls.folder / "helper"
        build(cls.fixture, OCR / "native/OcrLifetimeFixture.cs", cls.native)
        build(cls.helper, OCR / "native/WindowsOcrHelper.cs", cls.native)
        sources = [OCR / name for name in ("windows_api.py", "resource.py", "windows_process.py",
                                           "protocol.py", "wire.py", "native/WindowsOcrHelper.cs",
                                           "native/OcrLifetimeFixture.cs")] + [Path(__file__).absolute()]
        cls.source_hashes = {str(path.relative_to(ROOT)): digest(path) for path in sources}
        save(cls.folder / "run.json", {"schema_version": "windows-ocr-native-owner-qualification-v1",
             "sources": cls.source_hashes, "models_used": False, "product_enabled": False,
             "parent_qualification": False, "run_id": cls.folder.name})

    @classmethod
    def tearDownClass(cls):
        need(all(digest(ROOT / name) == value for name, value in cls.source_hashes.items()), "source-drift")
        fresh_operator()

    def run_exchange(self, case, mode=b"0", *, cancelled=lambda: False, seconds=120,
                     helper=False, frame=None):
        fresh_operator()
        frame = frame if frame is not None else mode + b"0000"
        bundle = self.helper if helper else self.fixture
        with patch.object(p, "open_resource", side_effect=lambda native: r._open_bundle(native, bundle)), \
                patch.object(p, "DEADLINE_SECONDS", seconds):
            data, observation = p._execute(frame, cancelled)
        save(self.folder / (case + ".json"), observation)
        self.assertTrue(observation["cleanup_confirmed"], observation)
        self.assertTrue(observation["all_handles_closed"])
        if observation["accounting"] is not None:
            self.assertEqual(observation["accounting"]["active"], 0)
        self.assertFalse(p._PENDING)
        self.assertEqual(observation["limits"], {"process_bytes": 512 * 1024**2,
                                               "job_bytes": 512 * 1024**2, "members": 1})
        return data, observation

    def test_01_normal_private_pipes_and_successor(self):
        for case in ("normal", "successor"):
            data, observation = self.run_exchange(case)
            self.assertTrue(observation["passed"], observation)
            self.assertEqual(data, b"\x02\0\0\0OK")
            self.assertTrue(observation["assigned_at_creation"])
            self.assertTrue(observation["resumed_after_membership"])
            self.assertEqual(observation["stdio_handles_inherited"], 3)
            self.assertEqual(observation["root_exit_code"], 0)
            self.assertEqual(observation["accounting"]["total"], 1)

    def test_02_nonzero_is_failure_despite_confirmed_cleanup(self):
        _, result = self.run_exchange("nonzero", b"N")
        self.assertFalse(result["passed"])
        self.assertEqual(result["root_exit_code"], 23)

    def test_03_deadline_and_running_cancel_retire_owned_process(self):
        _, result = self.run_exchange("timeout", b"H", seconds=.5)
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "timeout")
        self.assertTrue(result["forced"])
        counter = []
        def cancel():
            counter.append(True)
            return len(counter) >= 3
        _, result = self.run_exchange("cancel-running", b"H", cancelled=cancel)
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "cancelled")
        self.assertTrue(result["forced"])

    def test_04_cancel_before_launch(self):
        _, result = self.run_exchange("cancel-before-launch", cancelled=lambda: True)
        self.assertFalse(result["passed"])
        self.assertEqual(result["reason"], "cancelled")
        self.assertIsNone(result["accounting"])

    def test_05_output_and_discarded_error_bounds(self):
        for case, mode in (("stdout-overflow", b"O"), ("stderr-overflow", b"E"), ("stderr-present", b"X")):
            data, result = self.run_exchange(case, mode)
            self.assertFalse(result["passed"])
            self.assertLessEqual(len(data), p.MAX_RESULT_BYTES + 4)
            self.assertNotIn("synthetic-private-diagnostic", json.dumps(result))
            self.assertNotIn(b"synthetic-private-diagnostic", data)
            self.assertTrue(result["overflow"] if mode != b"X" else result["observed_bytes"]["stderr"] > 0)

    def test_06_broken_input_pipe(self):
        _, result = self.run_exchange("input-broken", frame=b"B" + b"x" * (8 * 1024**2))
        self.assertFalse(result["passed"])
        self.assertTrue(result["pipe_error"])

    def test_07_memory_and_member_limits_reject_caught_failure(self):
        for case, mode, messages in (("memory-limit", b"M", (9, 10)), ("member-limit", b"C", (3,))):
            _, result = self.run_exchange(case, mode)
            self.assertFalse(result["passed"])
            self.assertTrue(set(result["limit_messages"]).intersection(messages), result)

    def test_08_ambient_credentials_not_inherited(self):
        with patch.dict(os.environ, {"ASB_OCR_TEST_SECRET": "synthetic-secret", "HF_TOKEN": "synthetic-secret"}):
            _, result = self.run_exchange("environment", b"V")
        self.assertTrue(result["passed"], result)

    def test_09_resource_file_and_directory_locks(self):
        resource = r._open_bundle(self.native, self.helper)
        rows = []
        try:
            for label, path, access, flags in (("file-write", resource.executable, 0x40000000, 0),
                                        ("file-delete", resource.executable, 0x10000, 0),
                                        ("directory-delete", self.helper, 0x10000, 0x02000000)):
                handle = self.native.k.CreateFileW(str(path), access, 7, None, 3, flags, None)
                opened = bool(handle and handle != c.c_void_p(-1).value)
                rows.append({"case": label, "opened": opened})
                if opened:
                    observer = {"handle": c.c_void_p(handle)}
                    _OBSERVERS[id(observer)] = observer
                    try:
                        self.fail("Pinned resource allowed " + label + " access")
                    finally:
                        retire_observer(observer, self.native)
        finally:
            closed = resource.close()
            save(self.folder / "resource-locks.json", {"attempts": rows, "close_acknowledged": closed})
            self.assertTrue(closed)

    def test_10_actual_helper_readiness_and_malformed_frame(self):
        data, result = self.run_exchange("helper-readiness", helper=True, frame=readiness_frame("en-US"))
        self.assertTrue(result["passed"], result)
        ready = parse_response(data)
        self.assertTrue(ready.available)
        self.assertEqual(ready.language, "en-US")
        data, result = self.run_exchange("helper-language-unavailable", helper=True, frame=readiness_frame("zz-ZZ"))
        self.assertTrue(result["passed"], result)
        self.assertFalse(parse_response(data).available)
        _, result = self.run_exchange("helper-malformed", helper=True, frame=b"\x01\0\0\0{")
        self.assertFalse(result["passed"])
        self.assertEqual(result["root_exit_code"], 2)

    def guardian(self, role):
        fresh_operator()
        argv = [sys.executable, "-B", "-m", __name__.replace("__main__", "modules.adapters.runtime.python.worker.tests.qualification_ocr_windows"),
                role, self.folder.name]
        entry = {}
        _GUARDIANS[id(entry)] = entry
        try:
            child = entry["child"] = subprocess.Popen(argv, cwd=ROOT, env=self.native.environment(), stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=0x8)
            messages = queue.Queue(maxsize=1)
            reader = entry["reader"] = threading.Thread(target=lambda: messages.put(child.stdout.readline(4097)), daemon=True)
            reader.start()
            raw = messages.get(timeout=15)
            need(0 < len(raw) <= 4096 and raw.endswith(b"\n"), "guardian-protocol")
            value = json.loads(raw)
            yield child, value
        finally:
            retire_guardian(entry, self.native)

    def test_11_owner_crash_kills_new_helper_without_job_handle_in_observer(self):
        guardian = self.guardian("--guardian")
        observer = {"handle": c.c_void_p()}
        k = self.native.k
        k.GetCurrentProcess.argtypes, k.GetCurrentProcess.restype = [], c.c_void_p
        k.DuplicateHandle.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p, c.POINTER(c.c_void_p),
                                     c.c_uint32, c.c_int, c.c_uint32]
        k.DuplicateHandle.restype = c.c_int
        try:
            child, value = next(guardian)
            _OBSERVERS[id(observer)] = observer
            self.assertTrue(k.DuplicateHandle(int(child._handle), value["root_handle"], k.GetCurrentProcess(),
                                             c.byref(observer["handle"]), 0x100000 | 0x1000, False, 0))
            self.assertEqual(self.native.identity(observer["handle"].value), value["root_identity"])
            self.assertFalse(self.native.inheritable(observer["handle"].value))
            before = k.WaitForSingleObject(observer["handle"].value, 0)
            self.assertEqual(before, 258)
            child.stdin.write(b"Q")
            child.stdin.flush()
            self.assertEqual(child.wait(timeout=10), 91)
            after = k.WaitForSingleObject(observer["handle"].value, 5000)
            self.assertEqual(after, 0)
            code = self.native.exit_code(observer["handle"].value)
            self.assertTrue(strict_crash_shutdown(before, after, code))
            save(self.folder / "owner-crash.json", {"guardian_exit": 91, "helper_native_exit": code,
                 "before_crash_wait": before, "after_crash_wait": after,
                 "exact_pid_and_creation_identity_matched": True,
                 "only_read_process_handle_duplicated": True, "job_handle_duplicated": False})
        finally:
            try:
                retire_observer(observer, self.native)
            finally:
                guardian.close()

    def test_12_uncertain_close_denies_successor_in_separate_owner(self):
        guardian = self.guardian("--uncertain")
        try:
            child, value = next(guardian)
            self.assertEqual(value, {"cleanup_confirmed": False, "successor_denied": True,
                                     "exact_job_handle_retained": True})
            child.stdin.write(b"Q")
            child.stdin.flush()
            self.assertEqual(child.wait(timeout=10), 91)
            save(self.folder / "uncertain-close.json", value)
        finally:
            guardian.close()


def guardian(role, identifier):
    need(len(identifier) == 32 and all(ch in "0123456789abcdef" for ch in identifier) and
         Path.cwd() == ROOT, "guardian-fixed-run")
    folder = RUNS / identifier
    directory(folder)
    record = json.loads((folder / "run.json").read_text())
    need(record["run_id"] == identifier and all(digest(ROOT / name) == value for name, value in record["sources"].items()),
         "guardian-current-source")
    native = Windows()
    with patch.object(p, "open_resource", side_effect=lambda value: r._open_bundle(value, folder / "fixture")):
        if role == "--guardian":
            owner = p._Owner(native)
            owner.prepare(b"H0000")
            print(json.dumps({"root_handle": owner.process,
                              "root_identity": native.identity(owner.process)}), flush=True)
        else:
            owner = p._Owner(native)
            original = native.k.CloseHandle
            job = []
            original_hold = owner.hold
            def hold(name, handle):
                value = original_hold(name, handle)
                if name == "job":
                    job.append(value)
                return value
            owner.hold = hold
            native.k.CloseHandle = lambda handle: 0 if job and handle == job[0] else original(handle)
            _, result = owner.run(b"00000", lambda: False)
            denied = False
            try:
                p._execute(b"00000", lambda: False)
            except NativeFailure:
                denied = True
            print(json.dumps({"cleanup_confirmed": result["cleanup_confirmed"], "successor_denied": denied,
                              "exact_job_handle_retained": owner.handles.get("job") == job[0]}), flush=True)
        need(sys.stdin.buffer.read(1) == b"Q", "guardian-close-protocol")
        os._exit(91)  # Deliberate owner crash; no Job handle is handed to the observer.


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in ("--guardian", "--uncertain"):
        guardian(sys.argv[1], sys.argv[2])
    elif sys.argv[1:] == ["--native"]:
        unittest.main(argv=[sys.argv[0]], verbosity=2, failfast=True)
    else:
        raise SystemExit("Use --native for the fixed local Windows qualification.")

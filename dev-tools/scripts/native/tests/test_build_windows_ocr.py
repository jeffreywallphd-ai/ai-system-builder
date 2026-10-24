"""Portable fixed-build failure tests. Never launches a compiler or OCR engine."""
import contextlib
import importlib.util
import io
import json
import struct
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).absolute().parents[1] / "build_windows_ocr.py"
spec = importlib.util.spec_from_file_location("ocr_build", SCRIPT)
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class FakeProcess:
    def __init__(self, stdout=b"", stderr=b"", code=0, alive=False):
        self.stdout, self.stderr = io.BytesIO(stdout), io.BytesIO(stderr)
        self.returncode, self.alive = code, alive
        self._handle = SimpleNamespace(Detach=Mock(return_value=91))
        self.killed = False

    def poll(self):
        return None if self.alive else self.returncode

    def wait(self, timeout):
        if self.alive:
            raise TimeoutError("synthetic timeout")
        return self.returncode

    def kill(self):
        self.killed = True
        self.alive = False
        self.returncode = 23


class FixedOcrBuildTests(unittest.TestCase):
    def setUp(self):
        self.pending = patch.object(b, "_PENDING", {})
        self.pending.start()
        self.addCleanup(self.pending.stop)

    def native(self, process=None):
        return SimpleNamespace(environment=lambda: {"SystemRoot": str(Path.cwd() / "synthetic-windows")},
                               exit_code=Mock(side_effect=lambda *args: process.returncode if process else 0),
                               k=SimpleNamespace(CloseHandle=Mock(return_value=1)))

    def run_compile(self, process, native=None, **patches):
        with tempfile.TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            native = native or self.native(process)
            with contextlib.ExitStack() as stack:
                launcher = stack.enter_context(patch.object(b.subprocess, "Popen", return_value=process))
                for name, value in patches.items():
                    stack.enter_context(patch.object(b, name, value))
                error = None
                try:
                    result = b.compile_fixed(native, Path("fixed-compiler"), [Path("fixed-reference")], folder)
                except b.NativeFailure as caught:
                    error, result = caught, None
                record = json.loads((folder / "compiler-result.json").read_text(encoding="utf-8"))
                logs = {name: ((folder / ("compiler." + name + ".log")).read_bytes()
                               if (folder / ("compiler." + name + ".log")).is_file() else None)
                        for name in ("stdout", "stderr")}
                return result, error, record, logs, launcher.call_args, native

    def test_fixed_compiler_arguments_private_environment_and_native_root_retirement(self):
        result, error, record, logs, call, native = self.run_compile(FakeProcess())
        self.assertIsNone(error)
        self.assertEqual(result.name, "WindowsOcrHelper.exe")
        self.assertEqual(call.args[0][:6], ["fixed-compiler", "/nologo", "/noconfig", "/warnaserror+", "/target:exe", "/platform:x64"])
        self.assertTrue(call.args[0][-1].endswith("WindowsOcrHelper.cs"))
        self.assertEqual(set(call.kwargs["env"]), {"SystemRoot", "TEMP", "TMP"})
        self.assertTrue(call.kwargs["close_fds"])
        self.assertEqual(call.kwargs["stdin"], b.subprocess.DEVNULL)
        self.assertTrue(record["root_retired"])
        self.assertFalse(record["compiler_tree_containment_claimed"])
        native.k.CloseHandle.assert_called_once_with(91)
        self.assertFalse(b._PENDING)

    def test_nonzero_and_any_stderr_are_denied_after_known_retirement(self):
        for process in (FakeProcess(code=2), FakeProcess(stderr=b"synthetic diagnostics")):
            with self.subTest(code=process.returncode):
                _, error, record, *_ = self.run_compile(process)
                self.assertIsNotNone(error)
                self.assertTrue(record["root_retired"])
                self.assertFalse(b._PENDING)

    def test_output_is_retained_only_to_each_cap_and_overflow_denies_success(self):
        process = FakeProcess(stdout=b"x" * (b.LOG_BYTES + 100), stderr=b"y" * (b.LOG_BYTES + 1))
        _, error, record, logs, *_ = self.run_compile(process)
        self.assertIsNotNone(error)
        self.assertTrue(record["output_overflow"])
        self.assertEqual([len(logs[name]) for name in ("stdout", "stderr")], [b.LOG_BYTES] * 2)

    def test_deadline_kills_only_exact_new_compiler_and_is_not_a_pass(self):
        process = FakeProcess(alive=True)
        _, error, record, *_ = self.run_compile(process, COMPILER_SECONDS=-1)
        self.assertIsNotNone(error)
        self.assertTrue(process.killed)
        self.assertTrue(record["timed_out"])
        self.assertTrue(record["forced"])
        self.assertTrue(record["root_retired"])

    def test_false_and_raised_native_handle_close_keep_exact_owner_and_deny_success(self):
        for raised in (False, True):
            process = FakeProcess()
            native = self.native(process)
            native.k.CloseHandle = Mock(side_effect=OSError("synthetic") if raised else None, return_value=0)
            _, error, record, *_ = self.run_compile(process, native)
            self.assertIsNotNone(error)
            self.assertFalse(record["root_retired"])
            owner = next(iter(b._PENDING.values()))
            self.assertIs(owner["process"], process)
            self.assertEqual(owner["handle"], 91)
            # These are fakes only. Give each independent subcase a fresh registry.
            if not raised:
                b._PENDING = {}

    def test_native_exit_failure_remains_a_failure_even_with_python_returncode_zero(self):
        process = FakeProcess()
        native = self.native(process)
        native.exit_code.side_effect = b.NativeFailure("synthetic exit uncertainty")
        _, error, record, *_ = self.run_compile(process, native)
        self.assertIsNotNone(error)
        self.assertFalse(record["root_retired"])
        self.assertTrue(b._PENDING)
        owner = next(iter(b._PENDING.values()))
        self.assertIs(owner["process"], process)
        self.assertEqual(owner["handle"], 91)
        native.k.CloseHandle.assert_not_called()

    def test_reader_start_failure_still_stops_and_retires_exact_new_compiler(self):
        process = FakeProcess(alive=True)
        thread = Mock(ident=None)
        thread.start.side_effect = RuntimeError("synthetic reader failure")
        thread.is_alive.return_value = False
        factory = lambda **kwargs: thread
        _, error, record, *_ = self.run_compile(process, threading=SimpleNamespace(
            Event=b.threading.Event, Thread=factory))
        self.assertIsNotNone(error)
        self.assertTrue(process.killed)
        self.assertTrue(record["root_retired"])
        self.assertTrue(record["pipe_failure"])
        self.assertTrue(process.stdout.closed)
        self.assertTrue(process.stderr.closed)
        self.assertFalse(b._PENDING)

    def test_unsupported_platform_does_not_construct_native_or_inspect_files(self):
        with patch.object(b, "supported", return_value=False), patch.object(b, "Windows") as native:
            self.assertEqual(b.build(), {"status": "unavailable", "reason": "unsupported-platform"})
        native.assert_not_called()

    def test_current_resource_reuse_requires_acknowledged_close_and_no_compile(self):
        native, lease, current = self.native(), Mock(), Mock()
        lease.close.return_value = current.close.return_value = True
        with patch.object(b, "supported", return_value=True), patch.object(b, "Windows", return_value=native), \
                patch.object(b, "BuildLease", return_value=lease), \
                patch.object(b.resource, "open_resource", return_value=current), patch.object(b, "compile_fixed") as compile:
            self.assertEqual(b.build(), {"status": "ready", "action": "reused"})
        lease.acquire.assert_called_once()
        lease.close.assert_called_once()
        current.close.assert_called_once()
        compile.assert_not_called()

    def test_missing_toolchain_is_explicit_unavailable_and_never_compiles(self):
        lease = Mock()
        lease.close.return_value = True
        with patch.object(b, "supported", return_value=True), patch.object(b, "Windows", return_value=self.native()), \
                patch.object(b, "BuildLease", return_value=lease), \
                patch.object(b.resource, "open_resource", side_effect=b.NativeFailure("missing")), \
                patch.object(b, "toolchain", return_value=(Path("absent-csc"), [], Path("absent-ref"))), \
                patch.object(b, "compile_fixed") as compile:
            self.assertEqual(b.build()["reason"], "installed-toolchain-unavailable")
        compile.assert_not_called()
        lease.close.assert_called_once()

    def test_unacknowledged_build_lock_close_is_retained_and_never_reused_as_success(self):
        native, lease, current = self.native(), Mock(), Mock()
        lease.close.return_value = False
        current.close.return_value = True
        with patch.object(b, "supported", return_value=True), patch.object(b, "Windows", return_value=native), \
                patch.object(b, "BuildLease", return_value=lease), patch.object(b.resource, "open_resource", return_value=current), \
                self.assertRaises(b.NativeFailure):
            b.build()
        self.assertIs(b._PENDING[id(lease)], lease)

    def test_build_lock_denies_unknown_inprocess_ownership_before_files(self):
        with patch.object(b, "_PENDING", {1: object()}), patch.object(b, "directory") as directory, \
                self.assertRaises(b.NativeFailure):
            b.BuildLease(self.native()).acquire()
        directory.assert_not_called()

    def test_false_lock_close_keeps_exact_handle_and_lease(self):
        native = self.native()
        native.k.CloseHandle.return_value = 0
        lease = b.BuildLease(native)
        lease.handle = 17  # Synthetic handle; no Windows function is called.
        self.assertFalse(lease.close())
        self.assertEqual(lease.handle, 17)
        self.assertIs(b._PENDING[id(lease)], lease)

    def test_compiled_file_with_multiple_links_is_denied_before_open(self):
        path = Mock()
        path.lstat.return_value = SimpleNamespace(st_file_attributes=0, st_nlink=2, st_size=256)
        path.is_file.return_value = True
        path.is_symlink.return_value = False
        path.resolve.return_value = path
        with self.assertRaises(b.NativeFailure):
            b.bounded_binary(path)
        path.open.assert_not_called()

    def test_redirected_directory_is_denied_and_no_parent_escape_is_admitted(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            with patch.object(b, "ROOT", root), self.assertRaises(b.NativeFailure):
                b.directory(root.parent)
            with patch.object(b, "ROOT", root), patch.object(Path, "resolve", return_value=root / "redirect"), \
                    self.assertRaises(b.NativeFailure):
                b.directory(root)

    def test_compiled_binary_size_and_link_identity_are_bounded_before_read(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / "helper.exe"
            path.write_bytes(b"x" * 255)
            with self.assertRaises(b.NativeFailure):
                b.bounded_binary(path)
            path.write_bytes(b"x" * 256)
            self.assertEqual(len(b.bounded_binary(path)), 256)

    def test_public_failure_never_prints_source_paths_or_exception_details(self):
        output = io.StringIO()
        with patch.object(b.sys, "argv", ["build_windows_ocr.py", "--build"]), \
                patch.object(b, "build", side_effect=RuntimeError("private payload or path")), \
                contextlib.redirect_stdout(output):
            self.assertEqual(b.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), {"status": "unavailable", "reason": "build-failed"})

    def publication_fixture(self, root, valid=True):
        native_dir = root / "native"
        native_dir.mkdir()
        source = native_dir / "WindowsOcrHelper.cs"
        source.write_bytes(b"fixed reviewed source")
        build_dir = native_dir / "build"
        build_dir.mkdir()
        compiler, reference, implicit = [root / name for name in ("csc.exe", "ref.dll", "mscorlib.dll")]
        for item in (compiler, reference, implicit):
            item.write_bytes(b"fixed installed toolchain")
        values = {item: item.read_bytes() for item in (source, compiler, reference, implicit)}
        values.update({b.BUILDER: b"fixed build script", b.HOOK: b"fixed hook"})
        binary = bytearray(256)
        binary[:2] = b"MZ"
        struct.pack_into("<I", binary, 0x3c, 64)
        binary[64:68] = b"PE\0\0"
        struct.pack_into("<H", binary, 68, 0x8664)
        if not valid:
            binary[0] = 0
        lease, inputs, copied, verified = Mock(), Mock(), Mock(), Mock()
        for item in (lease, inputs, copied, verified):
            item.close.return_value = True
        inputs.system_links = {p: 4 for p in (compiler, reference, implicit)}
        copied.pin.side_effect = lambda file, **kwargs: file.read_bytes()
        def compile(native, executable, references, folder):
            output = folder / "WindowsOcrHelper.exe"
            output.write_bytes(binary)
            return output
        return dict(native_dir=native_dir, source=source, build_dir=build_dir, compiler=compiler,
                    reference=reference, implicit=implicit, values=values, lease=lease,
                    inputs=inputs, copied=copied, verified=verified, compile=compile)

    def run_publication(self, root, fixture):
        f = fixture
        with contextlib.ExitStack() as stack:
            for name, value in {"ROOT": root, "NATIVE": f["native_dir"], "SOURCE": f["source"],
                                "BUILD": f["build_dir"], "RUNS": root / "artifacts/tmp/windows-ocr-build"}.items():
                stack.enter_context(patch.object(b, name, value))
            stack.enter_context(patch.object(b, "supported", return_value=True))
            stack.enter_context(patch.object(b, "Windows", return_value=self.native()))
            stack.enter_context(patch.object(b, "BuildLease", return_value=f["lease"]))
            stack.enter_context(patch.object(b, "toolchain", return_value=(f["compiler"], [f["reference"]], f["implicit"])))
            stack.enter_context(patch.object(b, "pin_inputs", return_value=(f["inputs"], f["values"])))
            stack.enter_context(patch.object(b.resource, "_Resource", return_value=f["copied"]))
            stack.enter_context(patch.object(b.resource, "open_resource", side_effect=[b.NativeFailure("partial"), f["verified"]]))
            stack.enter_context(patch.object(b, "compile_fixed", side_effect=f["compile"]))
            replace = stack.enter_context(patch.object(b.os, "replace", wraps=b.os.replace))
            result = b.build()
            return result, replace.call_args_list

    def test_manifest_last_publication_binds_exact_source_and_binary_without_launch(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            f = self.publication_fixture(root)
            result, replacements = self.run_publication(root, f)
            self.assertEqual(result, {"status": "ready", "action": "built"})
            self.assertEqual([call.args[1].name for call in replacements], ["WindowsOcrHelper.exe", "resource.json"])
            manifest = json.loads((f["build_dir"] / "resource.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["source_sha256"], b.digest(f["source"].read_bytes()))
            self.assertEqual(manifest["binary_sha256"], b.digest((f["build_dir"] / "WindowsOcrHelper.exe").read_bytes()))
            self.assertEqual(manifest["binary_bytes"], 256)
            for item in (f["lease"], f["inputs"], f["copied"], f["verified"]):
                item.close.assert_called_once()

    def test_invalid_compiled_image_is_denied_before_any_publication(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            f = self.publication_fixture(root, valid=False)
            old = f["build_dir"] / "resource.json"
            old.write_bytes(b"earlier incomplete record")
            with self.assertRaises(b.NativeFailure):
                self.run_publication(root, f)
            self.assertEqual(old.read_bytes(), b"earlier incomplete record")
            self.assertFalse((f["build_dir"] / "WindowsOcrHelper.exe").exists())
            for item in (f["lease"], f["inputs"], f["copied"]):
                item.close.assert_called_once()

    def test_interrupted_manifest_publication_is_recoverable_without_removing_old_runs(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            f = self.publication_fixture(root)
            old = f["build_dir"] / "resource.json"
            old.write_bytes(b"earlier incomplete record")
            replace, calls = b.os.replace, []
            def interrupt(source, target):
                calls.append(target.name)
                if target.name == "resource.json":
                    raise OSError("synthetic interrupted publication")
                return replace(source, target)
            with patch.object(b.os, "replace", side_effect=interrupt), self.assertRaises(OSError):
                self.run_publication(root, f)
            self.assertEqual(calls, ["WindowsOcrHelper.exe", "resource.json"])
            self.assertEqual(old.read_bytes(), b"earlier incomplete record")
            runs = root / "artifacts/tmp/windows-ocr-build"
            earlier = {p.name: (p / "proof.json").read_bytes() for p in runs.iterdir()}
            result, _ = self.run_publication(root, f)
            self.assertEqual(result["status"], "ready")
            self.assertEqual(len(list(runs.iterdir())), 2)
            self.assertTrue(all((runs / n / "proof.json").read_bytes() == raw for n, raw in earlier.items()))
            manifest = json.loads(old.read_text(encoding="utf-8"))
            b.resource._validate_manifest(old.read_bytes(), f["source"].read_bytes(),
                                          (f["build_dir"] / "WindowsOcrHelper.exe").read_bytes())
            self.assertEqual(manifest["provider"], "windows")

    def test_unknown_compiler_input_is_denied_before_any_native_open(self):
        native = self.native()
        native.k.CreateFileW = Mock()
        lease = b.InstalledInputs(native)
        with self.assertRaises(b.NativeFailure):
            lease.pin_installed(Path("unknown-source-or-compiler"))
        native.k.CreateFileW.assert_not_called()
        with self.assertRaises(b.NativeFailure):
            b.pin_inputs(native, [b.SOURCE])
        native.k.CreateFileW.assert_not_called()

    def test_fixed_installed_servicing_links_are_read_pinned_without_relaxing_sources(self):
        native = self.native()
        native.inheritable = lambda handle: False
        native.k.CreateFileW = Mock(return_value=17)
        native.k.GetFileType = Mock(return_value=1)
        def info(handle, output):
            value = output._obj
            value.links, value.size_low, value.attributes = 4, 9, 0
            return 1
        native.k.GetFileInformationByHandle = Mock(side_effect=info)
        calls = []
        def read(handle, buffer, length, output, overlap):
            if not calls:
                b.c.memmove(buffer, b"installed", 9)
                output._obj.value = 9
            else:
                output._obj.value = 0
            calls.append(True)
            return 1
        native.k.ReadFile = Mock(side_effect=read)
        compiler, _, _ = b.toolchain(native)
        lease = b.InstalledInputs(native)
        self.assertEqual(lease.pin_installed(compiler), b"installed")
        self.assertEqual(lease.system_links, {compiler: 4})
        self.assertEqual(native.k.CreateFileW.call_args.args[1:3], (0x80000000, 1))
        self.assertTrue(lease.close())
        strict = b.resource._Resource(native)
        with self.assertRaises(b.NativeFailure):
            strict.pin(compiler, maximum=1024)
        self.assertTrue(strict.close())


if __name__ == "__main__":
    unittest.main()

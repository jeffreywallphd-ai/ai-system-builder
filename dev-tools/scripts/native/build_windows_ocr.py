"""Fixed, no-fetch development build for the private Windows OCR resource.

No source/compiler/output/flag selector is exposed. The compiler is a trusted
developer tool, never a user-document processor or end-user runtime dependency.
"""
from __future__ import annotations
import argparse
import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).absolute().parents[3]
BUILDER = Path(__file__).absolute()
HOOK = BUILDER.with_suffix(".cjs")
sys.path.insert(0, str(ROOT))
from modules.adapters.runtime.python.worker.ocr import resource
from modules.adapters.runtime.python.worker.ocr.windows_api import FileInfo, NativeFailure, Windows, need

NATIVE = ROOT / "modules/adapters/runtime/python/worker/ocr/native"
BUILD = NATIVE / "build"
RUNS = ROOT / "artifacts/tmp/windows-ocr-build"
SOURCE = NATIVE / "WindowsOcrHelper.cs"
LOG_BYTES = 64 * 1024
COMPILER_SECONDS = 120
_PENDING = {}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def directory(path, *, create=False):
    need(path.is_absolute() and path.is_relative_to(ROOT) and ROOT.resolve() == ROOT,
         "build-directory-confinement")
    for part in (ROOT, *[ROOT.joinpath(*path.relative_to(ROOT).parts[:index])
                         for index in range(1, len(path.relative_to(ROOT).parts) + 1)]):
        if not part.exists() and not part.is_symlink():
            need(create, "build-directory-absent")
            part.mkdir(exist_ok=False)
        info = part.lstat()
        need(part.is_dir() and part.resolve() == part and not part.is_symlink() and
             not getattr(info, "st_file_attributes", 0) & 0x400, "build-directory-redirected")


def save(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


class BuildLease:
    """Process-owned file lock; termination releases it without deleting data."""
    def __init__(self, native):
        self.native = native
        self.handle = None

    def acquire(self):
        need(not _PENDING and not resource._UNCERTAIN_RESOURCES, "uncertain-build-ownership")
        directory(BUILD, create=True)
        handle = self.native.k.CreateFileW(str(BUILD / ".build.lock"), 0xC0000000,
                                           0, None, 4, 0x00200000, None)
        need(handle and handle != c.c_void_p(-1).value, "build-busy-or-lock-unavailable")
        self.handle = handle
        info = FileInfo()
        need(not self.native.inheritable(handle) and self.native.k.GetFileType(handle) == 1 and
             self.native.k.GetFileInformationByHandle(handle, c.byref(info)) and
             not info.attributes & (0x400 | 0x10) and info.links == 1,
             "build-lock-identity")

    def close(self):
        if self.handle:
            try:
                closed = bool(self.native.k.CloseHandle(self.handle))
            except BaseException:
                closed = False
            if not closed:
                _PENDING[id(self)] = self
                return False
            self.handle = None
        return True


def toolchain(native):
    windows = Path(native.environment()["SystemRoot"])
    compiler = windows / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    references = [Path(windows.anchor) / "Program Files (x86)/Windows Kits/10/UnionMetadata/10.0.26100.0/Windows.winmd",
                  windows / "Microsoft.NET/Framework64/v4.0.30319/System.Runtime.WindowsRuntime.dll",
                  windows / "Microsoft.NET/assembly/GAC_MSIL/System.Runtime/v4.0_4.0.0.0__b03f5f7f11d50a3a/System.Runtime.dll",
                  *[windows / ("Microsoft.NET/Framework64/v4.0.30319/" + name + ".dll")
                    for name in ("System.Web.Extensions", "System", "System.Core")]]
    implicit = windows / "Microsoft.NET/Framework64/v4.0.30319/mscorlib.dll"
    return compiler, references, implicit


class InstalledInputs(resource._Resource):
    """Fixed trusted OS compiler files may have Windows servicing hard links.

    Their native handles still deny write/delete sharing across the file object.
    Repository sources and runtime resources keep the existing single-link rule.
    """
    def __init__(self, native):
        super().__init__(native)
        self.system_links = {}

    def pin_installed(self, path):
        compiler, references, implicit = toolchain(self.native)
        need(path in (compiler, *references, implicit), "fixed-toolchain-file-required")
        handle = self.native.k.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x00200000, None)
        need(handle and handle != c.c_void_p(-1).value, "toolchain-open")
        self.handles.append(handle)
        info = FileInfo()
        need(not self.native.inheritable(handle) and self.native.k.GetFileType(handle) == 1 and
             self.native.k.GetFileInformationByHandle(handle, c.byref(info)) and
             not info.attributes & (0x400 | 0x10) and info.links >= 1, "toolchain-file-identity")
        length = info.size_low | info.size_high << 32
        need(0 < length <= 64 * 1024**2, "toolchain-file-bounds")
        self.system_links[path] = info.links
        data = bytearray()
        buffer = c.create_string_buffer(65536)
        while True:
            count = c.c_uint32()
            need(self.native.k.ReadFile(handle, buffer, len(buffer), c.byref(count), None), "toolchain-read")
            if not count.value:
                break
            data.extend(buffer.raw[:count.value])
            need(len(data) <= length, "toolchain-file-changed")
        need(len(data) == length, "toolchain-file-changed")
        return bytes(data)


def pin_inputs(native, paths):
    compiler, references, implicit = toolchain(native)
    need(paths == [SOURCE, BUILDER, HOOK, compiler, *references, implicit], "fixed-build-inputs-required")
    lease = InstalledInputs(native)
    try:
        directories = sorted({parent for path in paths for parent in path.parents}, key=lambda p: len(p.parts))
        for parent in directories:
            lease.pin(parent, directory=True)
        values, total = {}, 0
        for path in paths:
            values[path] = (lease.pin(path, maximum=resource.MAX_SOURCE_BYTES)
                            if path in (SOURCE, BUILDER, HOOK) else lease.pin_installed(path))
            total += len(values[path])
            need(total <= 128 * 1024**2, "build-input-total-bounds")
        return lease, values
    except BaseException:
        lease.close()
        raise


def compile_fixed(native, compiler, references, folder):
    """Only this fixed compiler/source form; no caller or file supplies argv."""
    copied = folder / "WindowsOcrHelper.cs"
    executable = folder / "WindowsOcrHelper.exe"
    argv = [str(compiler), "/nologo", "/noconfig", "/warnaserror+", "/target:exe", "/platform:x64",
            "/out:" + str(executable), *["/reference:" + str(path) for path in references], str(copied)]
    environment = {**native.environment(), "TEMP": str(folder / "compiler-tmp"),
                   "TMP": str(folder / "compiler-tmp")}
    process = subprocess.Popen(argv, cwd=folder, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               close_fds=True, creationflags=0x08000000)
    owner = {"process": process, "threads": [], "handle": None}
    _PENDING[id(owner)] = owner  # Register before any reader-thread preparation.
    overflow, failed = threading.Event(), threading.Event()
    counts, threads = {}, owner["threads"]
    def drain(stream, name):
        count = 0
        try:
            with (folder / ("compiler." + name + ".log")).open("xb") as log:
                while True:
                    data = stream.read(4096)
                    if not data:
                        break
                    keep = max(0, LOG_BYTES - count)
                    log.write(data[:keep])
                    count += len(data)
                    if count > LOG_BYTES:
                        overflow.set()
        except BaseException:
            failed.set()
        finally:
            try:
                stream.close()
            except BaseException:
                failed.set()
            counts[name] = count
    retired, forced, timed_out = False, False, False
    try:
        for name in ("stdout", "stderr"):
            thread = threading.Thread(target=drain, args=(getattr(process, name), name), daemon=True)
            threads.append(thread)
            thread.start()
        deadline = time.monotonic() + COMPILER_SECONDS
        while process.poll() is None:
            if overflow.is_set() or failed.is_set() or time.monotonic() >= deadline:
                timed_out = time.monotonic() >= deadline
                forced = True
                process.kill()  # Exact newly created compiler handle, never a PID lookup.
                break
            time.sleep(0.02)
        process.wait(timeout=10)
    except BaseException:
        failed.set()
    finally:
        # Independently retire the exact new root and readers after failures too.
        try:
            if process.poll() is None:
                forced = True
                process.kill()
            process.wait(timeout=10)
        except BaseException:
            failed.set()
        for thread in threads:
            try:
                if thread.ident is not None:
                    thread.join(timeout=3)
            except BaseException:
                failed.set()
        readers_done = not any(thread.is_alive() for thread in threads)
        native_exited = False
        code = None
        try:
            owner["handle"] = process._handle.Detach()
            code = native.exit_code(owner["handle"], 1000)
            need(code == process.returncode, "compiler-exit-identity")
            native_exited = True
        except BaseException:
            failed.set()
        finally:
            closed = False
            if native_exited:
                try:
                    closed = bool(owner["handle"] and native.k.CloseHandle(owner["handle"]))
                except BaseException:
                    closed = False
            if closed:
                owner["handle"] = None
        if readers_done:
            streams_closed = True
            for name in ("stdout", "stderr"):
                try:
                    getattr(process, name).close()
                    need(getattr(process, name).closed, "compiler-stream-close")
                except BaseException:
                    failed.set()
                    streams_closed = False
        else:
            streams_closed = False
        retired = readers_done and streams_closed and native_exited and closed
        if retired:
            _PENDING.pop(id(owner))  # Confirmed retirement, never an uncertain reset.
    result = {"exit_code": code, "retained_log_limit_each": LOG_BYTES,
              "observed_log_bytes": counts, "output_overflow": overflow.is_set(),
              "pipe_failure": failed.is_set(), "root_retired": retired,
              "forced": forced, "timed_out": timed_out,
              "compiler_tree_containment_claimed": False}
    save(folder / "compiler-result.json", result)
    need(retired and code == 0 and not forced and not timed_out and not overflow.is_set() and
         not failed.is_set() and counts.get("stderr") == 0, "compile-failed")
    return executable


def bounded_binary(path):
    info = path.lstat()
    need(path.is_file() and path.resolve() == path and not path.is_symlink() and
         not getattr(info, "st_file_attributes", 0) & 0x400 and info.st_nlink == 1 and
         256 <= info.st_size <= resource.MAX_BINARY_BYTES, "compiled-resource-bounds")
    with path.open("rb") as stream:
        raw = stream.read(resource.MAX_BINARY_BYTES + 1)
    need(len(raw) == info.st_size, "compiled-resource-changed")
    return raw


def supported():
    return os.name == "nt" and c.sizeof(c.c_void_p) == 8 and platform.machine().lower() in ("amd64", "x86_64")


def build():
    if not supported():
        return {"status": "unavailable", "reason": "unsupported-platform"}
    native = Windows()
    lock, inputs, copied_input = BuildLease(native), None, None
    try:
        lock.acquire()
        # Existing generated resources may be reused only after native identity
        # checks. A partial prior publication is rebuilt; no old process is adopted.
        current = None
        try:
            current = resource.open_resource(native)
        except (NativeFailure, OSError):
            need(not resource._UNCERTAIN_RESOURCES, "uncertain-resource-lease")
        if current is not None:
            need(current.close(), "resource-close-unconfirmed")
            return {"status": "ready", "action": "reused"}
        compiler, references, implicit = toolchain(native)
        if not all(path.is_file() for path in (compiler, *references, implicit)):
            return {"status": "unavailable", "reason": "installed-toolchain-unavailable"}
        inputs, values = pin_inputs(native, [SOURCE, BUILDER, HOOK, compiler, *references, implicit])
        directory(RUNS, create=True)
        folder = RUNS / uuid.uuid4().hex
        need(not folder.exists() and not folder.is_symlink(), "fresh-build-run-required")
        directory(folder, create=True)
        directory(folder / "compiler-tmp", create=True)
        with (folder / "WindowsOcrHelper.cs").open("xb") as stream:
            stream.write(values[SOURCE])
        copied_input = resource._Resource(native)
        need(copied_input.pin(folder / "WindowsOcrHelper.cs", maximum=resource.MAX_SOURCE_BYTES) ==
             values[SOURCE], "copied-source-identity")
        executable = compile_fixed(native, compiler, references, folder)
        binary = bounded_binary(executable)
        manifest = {"schema_version": "windows-ocr-resource-v1", "provider": "windows",
                    "provider_version": "1", "architecture": "x64", "source_sha256": digest(values[SOURCE]),
                    "binary_sha256": digest(binary), "binary_bytes": len(binary)}
        encoded = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
        resource._validate_manifest(encoded, values[SOURCE], binary)
        with (folder / "resource.json").open("xb") as stream:
            stream.write(encoded)
        save(folder / "proof.json", {"schema_version": "windows-ocr-trusted-build-v1",
             "source_sha256": digest(values[SOURCE]),
             "builder_sha256": digest(values[BUILDER]), "hook_sha256": digest(values[HOOK]),
             "build_profile": "windows-x64-csc-framework4-sdk26100-v1",
             "toolchain_hashes": {str(path.relative_to(path.anchor)): digest(values[path])
                                  for path in (compiler, *references, implicit)},
             "toolchain_native_links": {str(path.relative_to(path.anchor)): inputs.system_links[path]
                                        for path in (compiler, *references, implicit)},
             "manifest": manifest, "helper_launched": False,
             "compiler_trusted_development_tool": True, "runtime_availability_claimed": False})
        # Only generated fixed names are replaced, manifest last. Interrupted
        # publication leaves a detectable mismatch; retained runs are untouched.
        os.replace(executable, BUILD / "WindowsOcrHelper.exe")
        os.replace(folder / "resource.json", BUILD / "resource.json")
        verified = resource.open_resource(native)
        need(verified.close(), "resource-close-unconfirmed")
        return {"status": "ready", "action": "built"}
    finally:
        closed = True
        for lease in (copied_input, inputs, lock):
            if lease is not None:
                try:
                    acknowledged = bool(lease.close())
                except BaseException:
                    acknowledged = False
                if not acknowledged:
                    _PENDING[id(lease)] = lease
                closed = acknowledged and closed
        need(closed, "build-close-unconfirmed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", required=True)
    parser.parse_args()
    try:
        result = build()
        print(json.dumps(result))
        return 0
    except BaseException:
        print(json.dumps({"status": "unavailable", "reason": "build-failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

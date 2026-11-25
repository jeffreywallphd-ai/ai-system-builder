"""Private original-worker Job controller. Importing this module performs no IO.

The controller launches only its shipped sibling worker/main.py with its own
installed interpreter. Private composition may bind a fresh protected source-copy
owner. Source-aware v3 binds that owner through the original Node reservation
exchange and inherited worker bootstrap; v1 remains source-free and v2 remains
readable. This is not a model executor or a qualifier.
ABI declarations reuse the repository's existing Win32 launch patterns; no
qualification actor, effect grant or budget is imported or widened here.
"""
from __future__ import annotations

from _thread import LockType
import ctypes as C
import base64
import hashlib
import json
import ntpath
import os
from pathlib import Path
from contextlib import contextmanager
from collections import OrderedDict
import platform
from queue import Empty, Full, Queue
import re
import subprocess
import struct
import sys
from threading import Event, Lock, RLock, Thread, get_ident
from types import BuiltinMethodType, FunctionType, GetSetDescriptorType, MethodType, ModuleType
from weakref import WeakKeyDictionary, ref
import time

P, U32, I32 = C.c_void_p, C.c_uint32, C.c_int32
FLAGS = 0x2000 | 0x8 | 0x100 | 0x200  # kill-on-close, active, process/Job commit
JOB_LIST, HANDLE_LIST = 0x2000D, 0x20002
CREATE_FLAGS = 0x80000 | 0x4 | 0x400 | 0x08000000
FRAME_BYTES, CHUNK_BYTES, OUTPUT_BYTES = 65536, 8192, 1024 * 1024
DEFINITION_BYTES, DEFINITION_CHUNK_BYTES = 128 * 1024, 16 * 1024
MODEL_FILES, MODEL_PAGE_BYTES = 32, 65536
MODEL_WRITE_DENIAL = 0xD0156
MODEL_WORLD = b'\x01\x01\0\0\0\0\0\x01\0\0\0\0'
MODEL_OWNER_RIGHTS = b'\x01\x01\0\0\0\0\0\x03\x04\0\0\0'
_TRAINING_TASK_UUID = re.compile(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}")


class LaunchUnavailable(RuntimeError):
    def __init__(self):
        super().__init__("The original managed worker is unavailable.")


def need(value):
    if value is not True:
        raise LaunchUnavailable()


def exact(raw, keys):
    need(type(raw) is dict and set(raw) == set(keys))
    return raw


def integer(value, low, high):
    need(type(value) is int and low <= value <= high)
    return value


def capture_profile(raw):
    value = exact(raw, ("schema", "profileId", "processMemoryBytes", "jobMemoryBytes",
                        "maximumActiveProcesses", "maximumDurationMs", "observationMs"))
    need(value["schema"] == "windows-original-worker-job-v1")
    need(type(value["profileId"]) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", value["profileId"]) is not None)
    process = integer(value["processMemoryBytes"], 1, 2**53 - 1)
    integer(value["jobMemoryBytes"], process, 2**53 - 1)
    integer(value["maximumActiveProcesses"], 1, 32)
    integer(value["maximumDurationMs"], 1, 86400000)
    integer(value["observationMs"], 1, 5000)
    # All values are explicit configuration, never production defaults.
    return dict(value)


def profile_digest(profile):
    value = capture_profile(profile)
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def capture_boot(raw):
    need(type(raw) is dict)
    source_mode = raw.get("schema") in ("windows-original-worker-launch-v2", "windows-original-worker-launch-v3")
    bootstrap_mode = raw.get("schema") == "windows-original-worker-launch-v3"
    keys = ("schema", "nonce", "profile", "profileDigest", "environment")
    value = exact(raw, keys + (("modelSource", "definitionByteCount") if bootstrap_mode else ("modelSource",) if source_mode else ()))
    need(value["schema"] in ("windows-original-worker-launch-v1", "windows-original-worker-launch-v2", "windows-original-worker-launch-v3"))
    if bootstrap_mode: integer(value["definitionByteCount"], 1, DEFINITION_BYTES)
    need(type(value["nonce"]) is str and re.fullmatch(r"[a-f0-9]{64}", value["nonce"]) is not None)
    profile = capture_profile(value["profile"])
    need(value["profileDigest"] == profile_digest(profile))
    env = value["environment"]
    need(type(env) is dict and 1 <= len(env) <= 256)
    seen, copied = set(), {}
    for key, text in env.items():
        need(type(key) is str and 0 < len(key) <= 160 and not any(c in key for c in "=\x00\r\n")
             and key.casefold() not in seen and type(text) is str and len(text) <= 8192 and "\x00" not in text)
        seen.add(key.casefold()); copied[key] = text
    need(sum(len(k) + len(v) + 2 for k, v in copied.items()) <= 24000)
    need(copied.get("PYTHON_RUNTIME_HOST") == "127.0.0.1"
         and re.fullmatch(r"[0-9]{1,5}", copied.get("PYTHON_RUNTIME_PORT", "")) is not None
         and 1024 <= int(copied["PYTHON_RUNTIME_PORT"]) <= 65535)
    need(re.fullmatch(r"[a-f0-9]{64}", copied.get("PYTHON_RUNTIME_STARTUP_PROOF", "")) is not None
         and len(copied.get("PYTHON_RUNTIME_AUTH_TOKEN", "")) >= 32)
    source = capture_model_graph(value["modelSource"]) if source_mode else None
    return {**value, "profile": profile, "environment": copied,
            **({"modelSource": {**source, "files": [dict(row) for row in source["files"]]}} if source_mode else {})}


def parse_json_bytes(data, maximum):
    need(type(data) is bytes and 0 < len(data) <= maximum)
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result); result[key] = value
        return result
    try:
        return json.loads(data.decode("utf8"), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(LaunchUnavailable()))
    except (UnicodeError, ValueError, RecursionError):
        raise LaunchUnavailable() from None


def parse_frame(data):
    return parse_json_bytes(data, FRAME_BYTES)


class BasicLimits(C.Structure):
    _fields_ = [("process_time", C.c_int64), ("job_time", C.c_int64), ("flags", U32),
                ("minimum_working_set", C.c_size_t), ("maximum_working_set", C.c_size_t),
                ("active_process_limit", U32), ("affinity", C.c_size_t), ("priority", U32), ("scheduling", U32)]


class IoCounters(C.Structure):
    _fields_ = [(n, C.c_uint64) for n in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class ExtendedLimits(C.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory_limit", C.c_size_t),
                ("job_memory_limit", C.c_size_t), ("peak_process_memory", C.c_size_t), ("peak_job_memory", C.c_size_t)]


class Security(C.Structure):
    _fields_ = [("length", U32), ("descriptor", P), ("inherit", I32)]


class Startup(C.Structure):
    _fields_ = [("cb", U32), ("reserved", C.c_wchar_p), ("desktop", C.c_wchar_p), ("title", C.c_wchar_p),
                *[(n, U32) for n in ("x", "y", "width", "height", "chars_x", "chars_y", "fill", "flags")],
                ("show", C.c_uint16), ("reserved_size", C.c_uint16), ("reserved_bytes", P),
                ("stdin", P), ("stdout", P), ("stderr", P)]


class StartupEx(C.Structure):
    _fields_ = [("startup", Startup), ("attributes", P)]


class Process(C.Structure):
    _fields_ = [("process", P), ("thread", P), ("pid", U32), ("tid", U32)]


class Accounting(C.Structure):
    _fields_ = [(n, C.c_int64) for n in ("user", "kernel", "period_user", "period_kernel")] + [
        (n, U32) for n in ("faults", "total", "active", "terminated")]


class FileTime(C.Structure):
    _fields_ = [("low", U32), ("high", U32)]


class NativeUnicode(C.Structure):
    _fields_ = [("length", C.c_uint16), ("maximum", C.c_uint16), ("buffer", P)]


class NativeAttributes(C.Structure):
    _fields_ = [("length", U32), ("root", P), ("name", C.POINTER(NativeUnicode)),
                ("flags", U32), ("security", P), ("quality", P)]


class NativeIo(C.Structure):
    _fields_ = [("status", P), ("information", C.c_size_t)]


class NativeDescriptor(C.Structure):
    _fields_ = [("revision", C.c_ubyte), ("zero", C.c_ubyte), ("control", C.c_uint16),
                ("owner", P), ("group", P), ("sacl", P), ("dacl", P)]


class NativeFileStandard(C.Structure):
    _fields_ = [("allocated", C.c_int64), ("size", C.c_int64), ("links", U32),
                ("delete_pending", C.c_ubyte), ("directory", C.c_ubyte)]


class NativeVolumeSize(C.Structure):
    _fields_ = [("total", C.c_int64), ("available", C.c_int64), ("sectors", U32), ("sector_bytes", U32)]


def model_leaf(value):
    need(type(value) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", value) is not None
         and value[-1] != "." and value.split(".")[0].upper() not in
         {"CON", "PRN", "AUX", "NUL", *("COM" + str(n) for n in range(10)), *("LPT" + str(n) for n in range(10))})
    return value


def model_directory_component(value):
    """Existing directory names are not manifest files or fresh copy names.

    Common cache ancestors contain leading dots or internal spaces. Keep the
    initial bounded ASCII profile and deny Windows aliases before native opens;
    handle identity, locality and reparse checks still establish the real graph.
    """
    need(type(value) is str and re.fullmatch(r"[A-Za-z0-9_.-][A-Za-z0-9_. -]{0,119}", value) is not None
         and value not in (".", "..") and value[-1] not in (".", " ")
         and value.split(".", 1)[0].rstrip(" ").upper() not in
         {"CON", "PRN", "AUX", "NUL", *("COM" + str(n) for n in range(10)), *("LPT" + str(n) for n in range(10))})
    return value


def capture_model_graph(raw):
    """Closed data only. This does not grant source or reservation authority."""
    value = exact(raw, ("schema", "definitionDigest", "modelId", "modelUpdatedAt", "logicalPath", "sourcePath",
                        "freshParent", "freshName", "files", "maximumCopyBytes", "bufferBytes", "preparationMs"))
    need(value["schema"] == "windows-original-model-graph-v1")
    need(type(value["definitionDigest"]) is str and re.fullmatch(r"sha256:[a-f0-9]{64}", value["definitionDigest"]) is not None)
    for key in ("modelId", "modelUpdatedAt"):
        need(type(value[key]) is str and 0 < len(value[key]) <= 200 and not any(ord(c) < 32 for c in value[key]))
    for key in ("logicalPath", "sourcePath", "freshParent"):
        # Only local drive-rooted paths. Components are subsequently opened by
        # handle with FILE_OPEN_REPARSE_POINT; lexical checks grant no IO.
        text = value[key]
        need(type(text) is str and 3 < len(text) <= 4096 and re.fullmatch(r"[A-Za-z]:\\[^:\x00-\x1f]*", text) is not None)
        parts = text[3:].split("\\"); need(1 <= len(parts) <= 64)
        for part in parts: model_directory_component(part)
    model_leaf(value["freshName"])
    maximum = integer(value["maximumCopyBytes"], 1, 2**53 - 1)
    integer(value["bufferBytes"], 4096, 1024 * 1024)
    integer(value["preparationMs"], 1, 86400000)
    rows = value["files"]; need(type(rows) is list and 3 <= len(rows) <= MODEL_FILES)
    files, seen, total = [], set(), 0
    for raw_file in rows:
        row = exact(raw_file, ("name", "sizeBytes", "sha256")); name = model_leaf(row["name"])
        # This initial profile deliberately refuses shards, executable code,
        # adapters, pickle weights and unlisted auxiliary formats.
        need(name in ("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
                      "special_tokens_map.json", "vocab.json", "merges.txt", "tokenizer.model", "model.safetensors")
             and name.casefold() not in seen)
        size = integer(row["sizeBytes"], 1, maximum)
        need(type(row["sha256"]) is str and re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) is not None)
        total += size; need(total <= maximum); seen.add(name.casefold()); files.append(dict(row))
    need({"config.json", "tokenizer.json", "model.safetensors"} <= seen)
    return {**value, "files": tuple(files)}


def model_acl(principal, *, sealed):
    """Private construction ACL and an explicit World/OWNER_RIGHTS seal."""
    need(type(principal) is bytes and 8 <= len(principal) <= 68 and principal[0] == 1
         and principal[1] <= 15 and len(principal) == 8 + 4 * principal[1] and type(sealed) is bool)
    # Never permit a second control-only open during construction. Sharing
    # alone does not exclude WRITE_DAC, attributes or EA access. Only data/add
    # rights remain before sealing, under the original exclusive creator open.
    denial = MODEL_WRITE_DENIAL if sealed else MODEL_WRITE_DENIAL & ~6
    entries = [struct.pack("<BBHI", 1, 0, 20, denial) + MODEL_WORLD,
               struct.pack("<BBHI", 0, 0, 20, 0x20000) + MODEL_OWNER_RIGHTS]
    entries += [struct.pack("<BBHI", 0, 0, 8 + len(principal), 0x1701ff) + principal]
    body = b"".join(entries)
    return struct.pack("<BBHHH", 2, 0, 8 + len(body), len(entries), 0) + body


class Handle:
    def __init__(self, owner, role, slot=None):
        self.owner, self.role = owner, role
        self.slot = slot if slot is not None else P()
        self.known = self.close_attempted = self.closed = False


def _capture_output_io_native_return(record,value):
    """Capture the original output slot before any error-reader observer."""
    created = record.get("output_creation")
    if created is None:return
    need(type(created) is dict and type(created["slot"]) is P and created["returned"] is False)
    created.update(number=created["slot"].value,native_value=value,returned=True)


class WindowsKernel:
    """Real finite Win32 API table. Construction is explicit, not import-time."""
    def __init__(self):
        need(sys.platform == "win32" and C.sizeof(P) == 8 and platform.machine().lower() in ("amd64", "x86_64"))
        need(C.sizeof(StartupEx) == 112 and C.sizeof(Process) == 24 and C.sizeof(ExtendedLimits) == 144)
        k = C.WinDLL("kernel32", use_last_error=True)
        signatures = {
            "CreateJobObjectW": ([P, C.c_wchar_p], P), "SetInformationJobObject": ([P, I32, P, U32], I32),
            "QueryInformationJobObject": ([P, I32, P, U32, P], I32), "GetHandleInformation": ([P, C.POINTER(U32)], I32),
            "InitializeProcThreadAttributeList": ([P, U32, U32, C.POINTER(C.c_size_t)], I32),
            "UpdateProcThreadAttribute": ([P, U32, C.c_size_t, P, C.c_size_t, P, P], I32),
            "DeleteProcThreadAttributeList": ([P], None),
            "CreateProcessW": ([C.c_wchar_p, C.c_wchar_p, P, P, I32, U32, P, C.c_wchar_p, P, P], I32),
            "IsProcessInJob": ([P, P, C.POINTER(I32)], I32), "ResumeThread": ([P], U32),
            "WaitForSingleObject": ([P, U32], U32), "TerminateJobObject": ([P, U32], I32), "CloseHandle": ([P], I32),
            "CreatePipe": ([C.POINTER(P), C.POINTER(P), P, U32], I32), "SetHandleInformation": ([P, U32, U32], I32),
            "CreateFileW": ([C.c_wchar_p, U32, U32, P, U32, U32, P], P),
            "ReadFile": ([P, P, U32, C.POINTER(U32), P], I32),
            "GetStdHandle": ([U32], P), "GetFileType": ([P], U32),
            "GetNamedPipeInfo": ([P, P, P, P, P], I32),
            "PeekNamedPipe": ([P, P, U32, P, P, P], I32),
            "SetFilePointerEx": ([P, C.c_int64, P, U32], I32),
            "GetFinalPathNameByHandleW": ([P, C.c_wchar_p, U32, U32], U32),
            "GetProcessTimes": ([P, P, P, P, P], I32),
            "QueryFullProcessImageNameW": ([P, U32, C.c_wchar_p, C.POINTER(U32)], I32),
        }
        self.functions = {}
        for name, (args, result) in signatures.items():
            function = getattr(k, name); function.argtypes, function.restype = args, result
            self.functions[name] = function
        # These APIs are called only by an explicitly captured original source
        # owner. Merely loading the finite table performs no file operation.
        a, n = C.WinDLL("advapi32", use_last_error=True), C.WinDLL("ntdll", use_last_error=True)
        source_signatures = (
            (n, "NtCreateFile", [C.POINTER(P), U32, C.POINTER(NativeAttributes), C.POINTER(NativeIo), P, U32, U32, U32, U32, P, U32], I32),
            (n, "NtSetSecurityObject", [P, U32, P], I32),
            (n, "NtQueryVolumeInformationFile", [P, C.POINTER(NativeIo), P, U32, I32], I32),
            (n, "NtQueryObject", [P, I32, P, U32, P], I32),
            (k, "GetFileInformationByHandleEx", [P, I32, P, U32], I32),
            (k, "GetDriveTypeW", [C.c_wchar_p], U32),
            (k, "GetVolumeInformationByHandleW", [P, C.c_wchar_p, U32, P, P, C.POINTER(U32), C.c_wchar_p, U32], I32),
            (k, "WriteFile", [P, P, U32, C.POINTER(U32), P], I32),
            (k, "FlushFileBuffers", [P], I32),
            (k, "DuplicateHandle", [P, P, P, C.POINTER(P), U32, I32, U32], I32),
            (k, "GetCurrentProcess", [], P), (k, "LocalFree", [P], P),
            (a, "OpenProcessToken", [P, U32, C.POINTER(P)], I32),
            (a, "GetTokenInformation", [P, I32, P, U32, C.POINTER(U32)], I32),
            (a, "IsValidSid", [P], I32), (a, "IsValidAcl", [P], I32),
            (a, "GetSecurityInfo", [P, I32, U32, P, P, C.POINTER(P), P, C.POINTER(P)], U32),
            (a, "GetSecurityDescriptorControl", [P, C.POINTER(C.c_uint16), C.POINTER(U32)], I32),
            (a, "GetSecurityDescriptorLength", [P], U32),
            (a, "InitializeSecurityDescriptor", [P, U32], I32),
            (a, "SetSecurityDescriptorOwner", [P, P, I32], I32),
            (a, "SetSecurityDescriptorDacl", [P, I32, P, I32], I32),
            (a, "SetSecurityDescriptorControl", [P, C.c_uint16, C.c_uint16], I32),
            (a, "IsValidSecurityDescriptor", [P], I32),
        )
        for library, name, args, result in source_signatures:
            function = getattr(library, name); function.argtypes, function.restype = args, result
            self.functions[name] = function
        self.error = C.get_last_error

    def invoke(self, name, args, record, *, _capture=_capture_output_io_native_return):
        value = self.functions[name](*args)
        record.update(value=value, value_returned=True)  # Before the error reader.
        _capture(record,value)
        return value, self.error()


class NativeModelInspection:
    """Shared actual read-only Model ABI inspections; never constructs a worker.

    The concrete original producer or bootstrap owner retains every native call,
    output and handle. This class supplies no authority, filesystem mutation or
    independent readiness.
    """

    def call(self, name, *args, **kwargs):
        return self.owner.call(name, *args, **kwargs)[0]

    def access(self, handle, expected):
        basic, size = (U32 * 14)(), U32()
        self.call("NtQueryObject", self.owner.number(handle), 0, C.byref(basic), C.sizeof(basic), C.byref(size),
                  valid=lambda v: type(v) is int and v == 0, keep=(handle, basic, size))
        need(size.value == C.sizeof(basic) and basic[1] == expected)

    def kind(self, handle, directory):
        facts = (U32 * 2)()
        self.call("GetFileInformationByHandleEx", self.owner.number(handle), 9, C.byref(facts), C.sizeof(facts), keep=(handle, facts))
        need(bool(facts[0] & 0x10) is directory and facts[1] == 0
             and not facts[0] & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000 | 0x40 | 0x10000))

    def identity(self, handle):
        facts = (C.c_ubyte * 24)()
        self.call("GetFileInformationByHandleEx", self.owner.number(handle), 18, C.byref(facts), C.sizeof(facts), keep=(handle, facts))
        value = bytes(facts); need(any(value[:8]) and any(value[8:])); return value

    def facts(self, handle):
        self.kind(handle, False); facts = NativeFileStandard()
        self.call("GetFileInformationByHandleEx", self.owner.number(handle), 1, C.byref(facts), C.sizeof(facts), keep=(handle, facts))
        need(facts.links == 1 and not facts.directory and not facts.delete_pending
             and 0 <= facts.size <= self.descriptor["maximumCopyBytes"]
             and 0 <= facts.allocated <= self.descriptor["maximumCopyBytes"])
        streams = (C.c_uint64 * 512)()
        self.call("GetFileInformationByHandleEx", self.owner.number(handle), 7, C.byref(streams), C.sizeof(streams), keep=(handle, streams))
        raw = bytes(streams); following, length, size, allocated = struct.unpack_from("<IIqq", raw)
        need(following == 0 and length == 14 and raw[24:38] == "::$DATA".encode("utf-16-le")
             and size == facts.size and allocated == facts.allocated)
        return self.identity(handle), facts.size, facts.allocated

    def private_principal(self):
        token = self.owner.handle("model-copy-token")
        self.owned_handles.append(token)
        process = self.call("GetCurrentProcess", valid=lambda v: type(v) is int and v in (-1, C.c_void_p(-1).value))
        self.call("OpenProcessToken", process, 8, C.byref(token.slot), keep=(token,))
        self.owner.acknowledge(token, token.slot.value)
        length = U32()
        result, error = self.owner.call("GetTokenInformation", self.owner.number(token), 1, None, 0, C.byref(length),
                                        valid=lambda v: type(v) is int and v == 0, keep=(token, length))
        need(result == 0 and error == 122 and 16 <= length.value <= 4096)
        capacity = length.value; data = C.create_string_buffer(capacity)
        self.call("GetTokenInformation", self.owner.number(token), 1, data, capacity, C.byref(length), keep=(token, data, length))
        pointer = P.from_buffer(data).value
        need(16 <= length.value <= capacity and pointer is not None
             and C.addressof(data) <= pointer <= C.addressof(data) + length.value - 8)
        header = C.string_at(pointer, 8); size = 8 + 4 * header[1]
        need(header[0] == 1 and header[1] <= 15 and pointer + size <= C.addressof(data) + length.value)
        self.call("IsValidSid", pointer, keep=(token, data))
        principal = C.string_at(pointer, size); self.owner.close(token); return principal

    def permissions(self, handle):
        principal, acl, descriptor = P(), P(), P()
        # Retained allocation slots precede the allocator. Even a lost error
        # reader leaves the original returned allocation in pending custody.
        retained = (handle, principal, acl, descriptor); self.owner.buffers.append(retained)
        self.call("GetSecurityInfo", self.owner.number(handle), 1, 5, C.byref(principal), None,
                  C.byref(acl), None, C.byref(descriptor), valid=lambda v: type(v) is int and v == 0, keep=retained)
        need(principal.value is not None and acl.value is not None and descriptor.value is not None)
        control, revision = C.c_uint16(), U32()
        self.call("IsValidSecurityDescriptor", descriptor, keep=retained)
        self.call("GetSecurityDescriptorControl", descriptor, C.byref(control), C.byref(revision), keep=(*retained, control, revision))
        size = self.call("GetSecurityDescriptorLength", descriptor, valid=lambda v: type(v) is int and 20 <= v <= 131072, keep=retained)
        base, end = descriptor.value, descriptor.value + size
        need(base <= acl.value <= end - 8 and base <= principal.value <= end - 8)
        length = C.c_uint16.from_address(acl.value + 2).value; header = C.string_at(principal, 8)
        sid_length = 8 + 4 * header[1]
        need(8 <= length <= 65535 and acl.value + length <= end and header[0] == 1
             and header[1] <= 15 and principal.value + sid_length <= end)
        self.call("IsValidAcl", acl, keep=retained); self.call("IsValidSid", principal, keep=retained)
        result = C.string_at(acl, length), control.value & 0x150c, C.string_at(principal, sid_length)
        self.call("LocalFree", descriptor, valid=lambda v: v is None, keep=retained)
        self.owner.buffers.remove(retained)
        return result

    def entries(self, handle):
        rows, seen = [], set(); row_format = struct.Struct("<II6qIIII16s")
        for page in range(4):
            data = (C.c_uint64 * (MODEL_PAGE_BYTES // 8))()
            value, error = self.owner.call("GetFileInformationByHandleEx", self.owner.number(handle),
                                            20 if page == 0 else 19, C.byref(data), C.sizeof(data),
                                            valid=lambda v: type(v) is int and v in (0, 1), keep=(handle, data))
            if value == 0:
                need(error == 18 and not any(bytes(data))); return tuple(rows)
            raw, offset = bytes(data), 0
            for _ in range(MODEL_FILES + 2):
                need(offset % 8 == 0 and offset + row_format.size <= len(raw))
                row = row_format.unpack_from(raw, offset)
                following, size, allocated, attrs, length, ea, tag, file_id = row[0], row[6], row[7], row[8], row[9], row[10], row[11], row[12]
                need(0 < length <= 240 and length % 2 == 0 and offset + row_format.size + length <= len(raw)
                     and any(file_id) and ea == tag == 0 and 0 <= size <= self.descriptor["maximumCopyBytes"]
                     and 0 <= allocated <= self.descriptor["maximumCopyBytes"]
                     and not attrs & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000 | 0x40 | 0x10000))
                name = raw[offset + row_format.size:offset + row_format.size + length].decode("utf-16-le")
                need(name.casefold() not in seen); seen.add(name.casefold())
                if name in (".", ".."):
                    need(bool(attrs & 0x10) and size == 0)
                else:
                    model_leaf(name); need(not attrs & 0x10); rows.append((name, file_id, size))
                    need(len(rows) <= MODEL_FILES)
                if following == 0: break
                need(following % 8 == 0 and following >= row_format.size + length and offset + following + row_format.size <= len(raw))
                offset += following
            else: raise LaunchUnavailable()
        raise LaunchUnavailable()

    def graph_matches(self, directory, records):
        observed = self.entries(directory)
        need({n: (i, s) for n, i, s in observed} == {row["name"]: (row["identity"][8:], row["sizeBytes"]) for row in records})

    def verify_bytes(self, handle, row):
        remaining, digest = row["sizeBytes"], hashlib.sha256()
        buffer = C.create_string_buffer(self.descriptor["bufferBytes"])
        while remaining:
            self.guard(); count = U32(); capacity = min(remaining, len(buffer))
            self.call("ReadFile", self.owner.number(handle), buffer, capacity, C.byref(count), None,
                      keep=(handle, buffer, count))
            need(0 < count.value <= capacity); digest.update(buffer.raw[:count.value]); remaining -= count.value
        count = U32(); self.call("ReadFile", self.owner.number(handle), buffer, 1, C.byref(count), None,
                                keep=(handle, buffer, count))
        need(count.value == 0 and digest.hexdigest() == row["sha256"])


class _OriginalProtectedFlatCopy(NativeModelInspection):
    """Concrete file mechanics, shared only by the fixed private owners.

    Each finite owner validates and binds its own authority before calling this
    initializer. This base does not parse a wire family or construct a worker.
    """
    def _bind_copy(self, owner, descriptor, reservation, admission):
        self.owner = owner
        self.descriptor = descriptor
        self.reservation, self.admission = reservation, admission
        # Bound methods retain their original receivers even if attributes change.
        self.assert_reservation = reservation.assert_current
        self.charge = reservation.charge_source_copy
        self.retain = reservation.retain_source_copy
        output_record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
        if output_record is not None:
            need(_training_output_readers.get(self) is output_record)
            output_record["io"].update(reservation=reservation,retain=self.retain)
        self.current = admission.assert_current
        self.stage_check = getattr(admission, "checkpoint", None)
        need(self.stage_check is None or callable(self.stage_check))
        need(all(callable(f) for f in (self.assert_reservation, self.charge, self.retain, self.current)))
        self.phase = "bound"; self.attempted = self.charged = self.retired = False
        self.charge_attempted = False; self.lifetime_current = None; self.dispatched = False
        self.checking_authority = False
        self.started = None; self.source_handles = []; self.guards = []; self.duplicates = []
        self.owned_handles = []
        self.records = []; self.borrowers = 0; self.principal = None; self.fresh = None
        self.duplicate_attempted = self.retirement_attempted = False
        self.physical_path = self.descriptor["freshParent"] + "\\" + self.descriptor["freshName"]

    def guard(self):
        try:
            self.owner._main()
            need(not self.checking_authority)
            self.checking_authority = True
            need(not self.owner.unknown and self.phase not in ("failed", "retired")
                 and self.current() is True and self.assert_reservation() is True)
            if self.lifetime_current is not None: need(self.lifetime_current() is True)
            if self.started is not None and not self.dispatched:
                need((self.owner.clock() - self.started) * 1000 < self.descriptor["preparationMs"])
            need(self.phase not in ("failed", "retired") and not self.owner.unknown)
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None
        finally:
            self.checking_authority = False


    def checkpoint(self, phase):
        self.guard()
        if self.stage_check is not None:
            need(self.stage_check(phase) is True)
        self.guard()

    def open(self, parent, name, access, *, directory, fresh=False, security=None, share=1, allocation_bytes=None):
        self.guard()
        if parent is None:
            need(type(name) is str and re.fullmatch(r"\\\?\?\\[A-Za-z]:\\", name) is not None)
        else:
            if directory and not fresh:
                model_directory_component(name)
            else:
                model_leaf(name)
        handle = self.owner.handle("model-copy" if fresh else "model-read")
        self.owned_handles.append(handle)
        text = C.create_unicode_buffer(name)
        string = NativeUnicode(len(name.encode("utf-16-le")), C.sizeof(text), C.cast(text, P))
        attrs = NativeAttributes(C.sizeof(NativeAttributes), self.owner.number(parent) if parent else None,
                                 C.pointer(string), 0x40, None, None)
        if security is not None: attrs.security = C.cast(C.byref(security[1]), P)
        io = NativeIo()
        allocation = None if allocation_bytes is None else C.c_int64(integer(allocation_bytes, 1, self.descriptor["maximumCopyBytes"]))
        need(allocation is None or fresh and not directory)
        # Latch possible filesystem effects BEFORE the first creating call.
        if fresh: need(self.charged); self.attempted = True
        self.call("NtCreateFile", C.byref(handle.slot), access | 0x100000, C.byref(attrs), C.byref(io),
                  C.byref(allocation) if allocation is not None else None,
                  0x80, share, 2 if fresh else 1, 0x200000 | 0x20 | (1 if directory else 0x40), None, 0,
                  valid=lambda value: type(value) is int and value == 0,
                  keep=(handle, text, string, attrs, io, security, allocation))
        self.owner.acknowledge(handle, handle.slot.value)
        need(io.status in (None, 0) and io.information == (2 if fresh else 1))
        self.kind(handle, directory)
        self.access(handle, access | 0x100000)
        return handle





    def path(self, text):
        drive = text[:3]
        need(self.call("GetDriveTypeW", drive, valid=lambda v: type(v) is int and v == 3) == 3)
        root = self.open(None, "\\??\\" + drive, 0x200a1, directory=True)
        self.source_handles.append(root)
        filesystem, flags = C.create_unicode_buffer(32), U32()
        self.call("GetVolumeInformationByHandleW", self.owner.number(root), None, 0, None, None,
                  C.byref(flags), filesystem, 32, keep=(root, filesystem, flags))
        need(filesystem.value == "NTFS" and flags.value & 8 != 0)
        for name in text[3:].split("\\"):
            root = self.open(root, name, 0x200a1, directory=True)
            self.source_handles.append(root)
        return root


    def descriptor_for(self, *, sealed):
        acl = C.create_string_buffer(model_acl(self.principal, sealed=sealed))
        sid, descriptor = C.create_string_buffer(self.principal), NativeDescriptor()
        self.call("IsValidAcl", acl, keep=(acl, sid, descriptor))
        self.call("InitializeSecurityDescriptor", C.byref(descriptor), 1, keep=(acl, sid, descriptor))
        self.call("SetSecurityDescriptorOwner", C.byref(descriptor), sid, 0, keep=(acl, sid, descriptor))
        self.call("SetSecurityDescriptorDacl", C.byref(descriptor), 1, acl, 0, keep=(acl, sid, descriptor))
        self.call("SetSecurityDescriptorControl", C.byref(descriptor), 0x1500, 0x1000, keep=(acl, sid, descriptor))
        self.call("IsValidSecurityDescriptor", C.byref(descriptor), keep=(acl, sid, descriptor))
        return acl, descriptor, sid


    def seal(self, handle):
        identity = self.identity(handle)
        need(self.permissions(handle) == (model_acl(self.principal, sealed=False), 0x1004, self.principal))
        buffers = self.descriptor_for(sealed=True)
        self.call("NtSetSecurityObject", self.owner.number(handle), 4, C.byref(buffers[1]),
                  valid=lambda v: type(v) is int and v == 0, keep=(handle, buffers))
        need(self.identity(handle) == identity
             and self.permissions(handle) == (model_acl(self.principal, sealed=True), 0x1004, self.principal))
        return identity



    def allocation_plan(self, parent):
        facts, io = NativeVolumeSize(), NativeIo()
        self.call("NtQueryVolumeInformationFile", self.owner.number(parent), C.byref(io), C.byref(facts), C.sizeof(facts), 3,
                  valid=lambda v: type(v) is int and v == 0, keep=(parent, io, facts))
        need(io.information == C.sizeof(facts) and 1 <= facts.sectors <= 65536
             and 512 <= facts.sector_bytes <= 65536 and 0 <= facts.available <= facts.total)
        unit = facts.sectors * facts.sector_bytes; need(unit <= 1024 * 1024 and unit & (unit - 1) == 0)
        sizes = tuple((row["sizeBytes"] + unit - 1) // unit * unit for row in self.descriptor["files"])
        # Refuse BEFORE creating the destination: logical tiny files can each
        # consume one allocation unit. Free-space observation is not a quota or
        # a replacement for the original exclusive reservation.
        need(sum(sizes) <= self.descriptor["maximumCopyBytes"])
        return sizes


    def prepare(self):
        self.owner._main(); need(self.phase == "bound")
        self.phase = "preparing"; self.started = self.owner.clock()
        try:
            self.guard()
            # This captures an existing exclusive measured reservation. It is
            # not a capacity counter/default manufactured by this adapter.
            self.charge_attempted = True
            need(self.charge(self.descriptor["maximumCopyBytes"]) is True); self.charged = True
            self.guard()
            if self.owner.kernel is None:
                self.owner.kernel = WindowsKernel(); self.owner.invoke = self.owner.kernel.invoke
            self.principal = self.private_principal()
            source, parent = self.path(self.descriptor["sourcePath"]), self.path(self.descriptor["freshParent"])
            need(self.identity(source) != self.identity(parent))
            allocation_plan = self.allocation_plan(parent)
            source_records = []
            for row in self.descriptor["files"]:
                self.guard(); handle = self.open(source, row["name"], 0x20089, directory=False)
                self.source_handles.append(handle); identity, size, _ = self.facts(handle)
                need(size == row["sizeBytes"]); source_records.append({**row, "identity": identity, "handle": handle})
            self.graph_matches(source, source_records)
            self.checkpoint("allocate"); security = self.descriptor_for(sealed=False)
            self.fresh = self.open(parent, self.descriptor["freshName"], 0x1701ff, directory=True, fresh=True, security=security, share=0)
            need(self.permissions(self.fresh) == (model_acl(self.principal, sealed=False), 0x1004, self.principal))
            allocated, copied = 0, 0
            for original, requested_allocation in zip(source_records, allocation_plan):
                self.checkpoint("copy"); writer = self.open(self.fresh, original["name"], 0x1701ff, directory=False, fresh=True,
                                                security=security, share=0, allocation_bytes=requested_allocation)
                need(self.permissions(writer) == (model_acl(self.principal, sealed=False), 0x1004, self.principal))
                _, initial_size, initial_allocation = self.facts(writer)
                need(initial_size == 0 and original["sizeBytes"] <= initial_allocation <= requested_allocation
                     and allocated + initial_allocation <= self.descriptor["maximumCopyBytes"])
                identity = self.identity(writer); need(identity != original["identity"])
                digest, remaining = hashlib.sha256(), original["sizeBytes"]
                buffer = C.create_string_buffer(self.descriptor["bufferBytes"])
                while remaining:
                    self.guard(); count, written = U32(), U32(); capacity = min(remaining, len(buffer))
                    self.call("ReadFile", self.owner.number(original["handle"]), buffer, capacity, C.byref(count), None,
                              keep=(original, buffer, count))
                    need(0 < count.value <= capacity)
                    digest.update(buffer.raw[:count.value])
                    # The whole reservation is already charged. Bound logical
                    # writes BEFORE dispatch and validate actual allocated size.
                    need(copied + count.value <= self.descriptor["maximumCopyBytes"])
                    need(original["sizeBytes"] - remaining + count.value <= initial_allocation
                         and allocated + initial_allocation <= self.descriptor["maximumCopyBytes"])
                    self.guard()
                    self.call("WriteFile", self.owner.number(writer), buffer, count.value, C.byref(written), None,
                              keep=(writer, buffer, count, written))
                    need(written.value == count.value)
                    copied += count.value; remaining -= count.value
                    _, size, allocation = self.facts(writer)
                    need(size == original["sizeBytes"] - remaining and allocation == initial_allocation
                         and allocated + allocation <= self.descriptor["maximumCopyBytes"])
                count = U32(); self.call("ReadFile", self.owner.number(original["handle"]), buffer, 1, C.byref(count), None,
                                        keep=(original, buffer, count))
                need(count.value == 0 and digest.hexdigest() == original["sha256"])
                self.call("FlushFileBuffers", self.owner.number(writer), keep=(writer,))
                self.guard(); self.seal(writer); _, size, allocation = self.facts(writer); allocated += allocation
                self.owner.close(writer)
                read = self.open(self.fresh, original["name"], 0x20089, directory=False)
                need(self.facts(read) == (identity, size, allocation)); self.guards.append(read)
                _retain_training_input_read_handle(self,read,original,identity)
                self.verify_bytes(read, original)
                self.records.append({**{k: original[k] for k in ("name", "sizeBytes", "sha256")}, "identity": identity})
            self.graph_matches(source, source_records); self.graph_matches(self.fresh, self.records)
            self.checkpoint("seal"); root_identity = self.seal(self.fresh); self.owner.close(self.fresh)
            root = self.open(parent, self.descriptor["freshName"], 0x200a1, directory=True)
            need(self.identity(root) == root_identity); self.guards.append(root)
            _retain_training_input_read_handle(self,root,None,root_identity)
            for handle in self.guards:
                need(self.permissions(handle) == (model_acl(self.principal, sealed=True), 0x1004, self.principal))
            self.graph_matches(root, self.records)
            self.guard(); self.phase = "sealed"
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None

    def assert_sealed(self):
        self.guard(); need(self.phase == "sealed" and self.charged and self.attempted and not self.retired)
        need(len(self.guards) == len(self.records) + 1)
        for handle, row in zip(self.guards[:-1], self.records):
            identity, size, _ = self.facts(handle)
            need(identity == row["identity"] and size == row["sizeBytes"]
                 and self.permissions(handle) == (model_acl(self.principal, sealed=True), 0x1004, self.principal))
        root = self.guards[-1]
        need(self.permissions(root) == (model_acl(self.principal, sealed=True), 0x1004, self.principal))
        self.graph_matches(root, self.records); self.guard()

class OriginalModelGraph(_OriginalProtectedFlatCopy):
    """Fresh Model copy retained by the actual original controller/Job owner."""
    def __init__(self, owner, descriptor, reservation, admission):
        need(type(owner) is OriginalWorker)
        self._bind_copy(owner, capture_model_graph(descriptor), reservation, admission)

    def inherited_handles(self):
        """Actual read-only duplicate handles, prepared BEFORE CreateProcessW."""
        need(not self.duplicate_attempted)
        self.duplicate_attempted = True
        self.assert_sealed()
        process = self.call("GetCurrentProcess", valid=lambda v: type(v) is int and v in (-1, C.c_void_p(-1).value))
        try:
            for index, original in enumerate(self.guards):
                self.guard(); duplicate = self.owner.handle("model-copy-inherited-read")
                self.owned_handles.append(duplicate)
                # New access excludes WRITE_DAC, DELETE, data writes, metadata
                # writes and ownership changes. DUPLICATE_SAME_ACCESS is OFF.
                access = 0x1200a1 if index == len(self.guards) - 1 else 0x120089
                self.call("DuplicateHandle", process, self.owner.number(original), process, C.byref(duplicate.slot),
                          access, 1, 0, keep=(original, duplicate))
                self.owner.acknowledge(duplicate, duplicate.slot.value)
                flags = U32(); self.call("GetHandleInformation", self.owner.number(duplicate), C.byref(flags), keep=(duplicate, flags))
                need(flags.value == 1 and self.identity(duplicate) == self.identity(original))
                self.access(duplicate, access)
                self.duplicates.append(duplicate)
            self.assert_sealed()
            return tuple(self.duplicates)
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None

    def retain_after_worker(self):
        """Join the original worker/Job/readers first; keep source disk charge.

        This method cannot supply worker retirement. Its caller must already
        own and prove that retirement, and separately retain candidate output.
        """
        self.owner._main()
        if self.retired: return True
        if (self.owner.unknown or self.borrowers or self.retirement_attempted or self.owner.pending
                or self.phase == "preparing" or self.charge_attempted and not self.charged): return False
        if self.owner.create_attempted:
            if (not self.owner.stop_attempted or not self.owner.worker_exited() or self.owner.accounting().active != 0
                    or any(reader.is_alive() for reader in self.owner.readers)): return False
        self.retirement_attempted = True
        try:
            for handle in reversed(self.owned_handles):
                if not handle.closed: self.owner.close(handle)
            # Positive retained accounting is required even after every handle
            # closes. Files still occupy disk; closing is not deletion.
            if self.charged:
                need(self.retain(self.descriptor["maximumCopyBytes"]) is True)
            self.retired = True; self.phase = "retired"; return True
        except BaseException:
            self.phase = "failed"; return False


class OriginalModelBootstrapWriter:
    """One owned pipe writer; never writes into a suspended child's full pipe.

    The original controller retains its write handle and all buffers. Startup
    does not wait for the body before resuming the fixed child. Retirement joins
    this exact thread after the worker/Job, including partial and unknown IO.
    """
    def __init__(self, owner, handle):
        self.owner, self.handle = owner, handle
        self.attempted = False; self.outcome = "prepared"; self.bytes_written = 0
        graph = owner.model_graph; need(type(graph) is OriginalModelGraph)
        graph.assert_sealed(); need(len(graph.duplicates) == len(graph.records) + 1)
        raw = owner.definition_bytes; need(type(raw) is bytes and len(raw) == owner.boot["definitionByteCount"])
        header = {"schema": "windows-original-model-bootstrap-v1", "nonce": owner.boot["nonce"],
            "descriptor": graph.descriptor, "profile": owner.profile, "physicalPath": graph.physical_path, "principal": graph.principal.hex(),
            "root": {"handle": owner.number(graph.duplicates[-1]), "identity": graph.identity(graph.guards[-1]).hex()},
            "files": [{**row, "identity": row["identity"].hex(), "handle": owner.number(handle)}
                      for row, handle in zip(graph.records, graph.duplicates[:-1])]}
        data = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf8")
        need(len(data) <= FRAME_BYTES and len(raw) <= DEFINITION_BYTES)
        self.segments = (struct.pack("<I", len(data)), data, struct.pack("<I", len(raw)), raw)
        self.thread = Thread(target=self._write, daemon=True)
        owner.readers.append(self.thread)  # Retain BEFORE possible Thread.start.

    def start(self):
        self.owner._main(); need(not self.attempted and self.owner.phase == "running")
        self.attempted = True
        try: self.thread.start()
        except BaseException:
            self.owner.unknown = True; self.outcome = "unknown"
            raise LaunchUnavailable() from None

    def _write(self):
        self.outcome = "writing"
        try:
            for segment in self.segments:
                offset = 0
                while offset < len(segment):
                    if self.owner.stop_attempted:
                        self.outcome = "cancelled"; return
                    need(not self.owner.unknown and (self.owner.clock() - self.owner.started_at) * 1000 < self.owner.profile["maximumDurationMs"])
                    buffer = C.create_string_buffer(segment[offset:offset + CHUNK_BYTES]); count = U32()
                    size = min(CHUNK_BYTES, len(segment) - offset)
                    value, error = self.owner.call("WriteFile", self.owner.number(self.handle), buffer, size, C.byref(count), None,
                        valid=lambda v: type(v) is int and v in (0, 1), keep=(self.handle, buffer, count))
                    if value == 0 and error in (109, 232):
                        self.outcome = "failed"; return  # Known closed peer; no repeat.
                    # WriteFile's TRUE return and byte count establish success;
                    # GetLastError may still contain an earlier unrelated error.
                    need(value == 1 and 0 < count.value <= size)
                    offset += count.value; self.bytes_written += count.value
            self.outcome = "written"  # Keep the original writer open as a live peer.
        except BaseException:
            self.owner.unknown = True; self.outcome = "unknown"


_output_io_owners = WeakKeyDictionary()
_output_accounting_owners = WeakKeyDictionary()


def _assert_plain_output_io_type(cls, expected, fields):
    need(cls is expected and type(cls) is type)
    for base in type.__getattribute__(cls,"__mro__"):
        namespace = type.__getattribute__(base,"__dict__")
        need(not fields.intersection(namespace) and "__getattr__" not in namespace)
        for name,original in (("__getattribute__",object.__getattribute__),
                ("__setattr__",object.__setattr__),("__hash__",object.__hash__),("__eq__",object.__eq__)):
            need(name not in namespace or namespace[name] is original)


def _output_io_current(record, *, pending_call=None):
    """Original Native dispatch only; no SDK, business or resource observer."""
    owner,io = record["owner"],record["io"]
    invoke,kernel,clock,lock,pending,handles = record["native"]
    _assert_plain_output_io_type(type(owner),InheritedModelNativeCalls,
        frozenset(("invoke","kernel","clock","lock","pending","handles","buffers","unknown","thread")))
    need(type(owner) is InheritedModelNativeCalls and get_ident() == record["thread"]
         and _output_io_owners.get(owner) is record and owner.invoke is invoke and owner.kernel is kernel
         and owner.clock is clock and owner.lock is lock and owner.pending is pending and owner.handles is handles
         and owner.buffers is io["buffers"] and owner.unknown is False and type(owner.pending) is list
         and (not owner.pending if pending_call is None else len(owner.pending) == 1 and owner.pending[0] is pending_call)
         and type(owner.thread) is int and owner.thread == record["thread"])
    fields = object.__getattribute__(owner,"__dict__")
    namespace = type.__getattribute__(type(owner),"__dict__")
    need(all(name not in fields and namespace.get(name) is original for name,original in io["dispatch"]))
    need(type(handles) is list and len(handles) == len(io["handles"])
         and all(handle is row["handle"] for handle,row in zip(handles,io["handles"])))


def _output_io_row(record,handle):
    rows = [row for row in record["io"]["handles"] if row["handle"] is handle]
    need(len(rows) == 1)
    row = rows[0]
    _assert_plain_output_io_type(type(handle),Handle,
        frozenset(("owner","slot","role","known","closed","close_attempted")))
    need(type(handle) is Handle and handle.owner is record["owner"] and type(handle.slot) is P
         and handle.slot is row["slot"] and type(handle.role) is str and handle.role == row["role"]
         and type(handle.known) is bool and type(handle.closed) is bool and type(handle.close_attempted) is bool)
    return row


def _output_io_handle_created(owner,handle):
    record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
    if record is None:return
    io = record["io"]
    try:
        need(type(io["stage"]) is str and io["stage"] == "active" and len(io["handles"]) < 256
             and io["creation_open"] is True and io["operation_lock"].locked()
             and type(handle) is Handle and handle.owner is owner and type(handle.slot) is P
             and handle.known is False and handle.closed is False and handle.close_attempted is False
             and type(handle.role) is str and handle.role in ("model-copy-token","model-copy","model-read")
             and len(owner.handles) == len(io["handles"])+1 and owner.handles[-1] is handle)
        io["handles"].append({"handle":handle,"slot":handle.slot,"role":handle.role,
            "number":None,"closed":False,"close_attempt":None,"creation_call":None,"creation_number":None})
        _output_io_current(record)
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_native_started(owner,name,args,keep,call):
    record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
    if record is None:return None
    io = record["io"]
    try:
        need(type(name) is str and type(io["stage"]) is str
             and (io["stage"] == "active" or io["stage"] == "retiring" and name == "CloseHandle"))
        if name not in ("NtCreateFile","OpenProcessToken"):return None
        _output_io_current(record)
        need(io["stage"] == "active" and io["creation_open"] is True and io["operation_lock"].locked()
             and type(keep) is tuple and bool(keep))
        handle = keep[0];row = _output_io_row(record,handle)
        need(row["creation_call"] is None and row["number"] is None and handle.known is False
             and handle.closed is False and handle.close_attempted is False
             and "inherited" not in object.__getattribute__(handle,"__dict__")
             and "verified" not in object.__getattribute__(handle,"__dict__"))
        pointer = args[2] if name == "OpenProcessToken" else args[0]
        need(type(pointer) is type(C.byref(P())) and pointer._obj is row["slot"]
             and (row["role"] == "model-copy-token" if name == "OpenProcessToken" else row["role"] in ("model-copy","model-read")))
        created = {"slot":row["slot"],"returned":False,"number":None,"native_value":None}
        call["output_creation"] = created;row["creation_call"] = call
        return record,row,created
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_native_completed(creation,call,name,value):
    if creation is None:return
    record,row,created = creation;io = record["io"]
    try:
        _output_io_current(record,pending_call=call)
        need(io["stage"] == "active" and io["creation_open"] is True
             and row["creation_call"] is call and call["output_creation"] is created
             and created["returned"] is True and type(value) is int and type(created["native_value"]) is int
             and value == created["native_value"] == (1 if name == "OpenProcessToken" else 0)
             and created["slot"] is row["slot"] and type(created["number"]) is int
             and 0 < created["number"] < C.c_void_p(-1).value and created["number"] == row["slot"].value)
        row["creation_number"] = created["number"]
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_handle_acknowledged(owner,handle,value):
    record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
    if record is None:return
    io = record["io"]
    try:
        _output_io_current(record);row = _output_io_row(record,handle)
        need(io["stage"] == "active" and row["number"] is None and row["close_attempt"] is None
             and io["creation_open"] is True and row["creation_call"] is not None
             and type(row["creation_number"]) is int and value == row["creation_number"]
             and "inherited" not in object.__getattribute__(handle,"__dict__")
             and "verified" not in object.__getattribute__(handle,"__dict__")
             and type(value) is int and 0 < value < C.c_void_p(-1).value and handle.slot.value == value
             and handle.known is True and handle.closed is False and handle.close_attempted is False)
        row["number"] = value
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_close_attempt(owner,handle,value):
    record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
    if record is None:return None
    io = record["io"]
    try:
        _output_io_current(record);row = _output_io_row(record,handle)
        need(type(io["stage"]) is str and io["stage"] in ("active","retiring")
             and type(row["number"]) is int and type(value) is int and value == row["number"] == handle.slot.value
             and row["close_attempt"] is None and row["closed"] is False
             and handle.known is True and handle.closed is False and handle.close_attempted is False)
        token = object();row["close_attempt"] = token
        return token
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_close_completed(owner,handle,value,token):
    record = _output_io_owners.get(owner) if type(owner) is InheritedModelNativeCalls else None
    if record is None:return
    io = record["io"]
    try:
        _output_io_current(record);row = _output_io_row(record,handle)
        need(token is not None and row["close_attempt"] is token and row["closed"] is False
             and type(value) is int and row["number"] == value == handle.slot.value
             and handle.known is True and handle.closed is True and handle.close_attempted is True)
        row["closed"] = True
    except BaseException:
        io["stage"] = "failed";raise


def _output_io_accounting_current(record):
    """Passive original family accounting, independent of business lifetime."""
    proof = record["io"]["family_accounting"]
    if proof is None:return
    controls,family,book,member,methods,captured,reservation,admission,configuration,reference = proof
    _assert_plain_output_io_type(type(controls),_OriginalOutputFamilyControls,
        frozenset(("family","member","resource","business","charge","retain","checking")))
    data = object.__getattribute__(controls,"__dict__")
    _assert_plain_output_io_type(type(family),OriginalTrainingOutputFamily,frozenset())
    need(_output_accounting_owners.get(controls) is reference and reference() is record["io"]["graph"]
         and _training_output_families.get(family) is book and book["reservation"] is reservation
         and book["admission"] is admission and book["methods"] is methods
         and len(methods) == len(captured) and all(methods.get(key) is method for key,method in captured)
         and any(row is member for row in book["members"]) and member["graph"] is record["io"]["graph"]
         and member["configuration"] is configuration and data.get("family") is family and data.get("member") is member
         and data.get("checking") is False
         and all(data.get(key) is method for key,method in captured))
    io = record["io"]
    need(type(configuration["maximumCopyBytes"]) is int and type(io["maximum"]) is int
         and configuration["maximumCopyBytes"] == io["maximum"])
    for key,expected in (("charge_attempted",io["copy_charge_attempted"]),("charged",io["copy_charged"]),
            ("retain_attempted",io["family_retain_attempted"]),("retained",io["family_retained"])):
        need(type(expected) is bool and type(member.get(key)) is bool and member[key] is expected)


class OriginalWorker:
    """One actual worker/Job owner. Unknown native calls retain all their buffers."""
    def __init__(self, boot, *, kernel=None, executable=None, worker_root=None, clock=time.monotonic):
        self.boot = capture_boot(boot)
        self.profile = self.boot["profile"]
        self.kernel = kernel  # Trusted private test seam; wire data cannot select it.
        self.invoke = kernel.invoke if kernel is not None else None
        self.clock, self.thread = clock, get_ident()
        self.executable = executable if executable is not None else sys.executable
        self.root = worker_root if worker_root is not None else Path(__file__).absolute().parent.parent
        self.handles, self.buffers, self.pending, self.readers = [], [], [], []
        self.output_readers_started = False
        self.lock = Lock(); self.unknown = False
        self.create_attempted = self.resume_attempted = self.stop_attempted = False
        self.attributes_initialized = self.attributes_delete_attempted = self.attributes_deleted = False
        self.phase = "bound"; self.started_at = self.clock()
        self.job = self.process = self.primary_thread = None
        self.stdout = self.stderr = None
        self.creation_identity = None
        self.model_graph = None
        self.definition_bytes = None
        self.model_bootstrap = None

    def bind_model_graph(self, descriptor, reservation, admission):
        """Private original composition only; no BOOT/request field invokes it."""
        self._main(); need(self.phase == "bound" and self.model_graph is None)
        self.model_graph = OriginalModelGraph(self, descriptor, reservation, admission)
        return self.model_graph

    def _main(self):
        need(get_ident() == self.thread)

    def call(self, name, *args, valid=lambda value: type(value) is int and value != 0, keep=(),
             _output_started=_output_io_native_started, _output_completed=_output_io_native_completed):
        row = {"name": name, "args": args, "keep": keep, "thread": get_ident(), "returned": False}
        creation = _output_started(self,name,args,keep,row)
        with self.lock:
            self.pending.append(row)
        try:
            value, error = self.invoke(name, args, row)
            row.update(value=value, error=error, returned=True)
            need(type(error) is int and 0 <= error <= 0xffffffff and valid(value) is True)
            _output_completed(creation,row,name,value)
            with self.lock:
                self.pending.remove(row)
            return value, error
        except BaseException:
            self.unknown = True; self.phase = "uncertain"
            raise LaunchUnavailable() from None

    def handle(self, role, *, _output_created=_output_io_handle_created):
        handle = Handle(self, role); self.handles.append(handle)
        _output_created(self,handle)
        return handle

    def acknowledge(self, handle, value, *, _output_acknowledged=_output_io_handle_acknowledged):
        need(handle.owner is self and handle in self.handles and not handle.known
             and type(value) is int and 0 < value < C.c_void_p(-1).value
             and all(h is handle or not h.known or h.closed or h.slot.value != value for h in self.handles))
        handle.slot.value = value; handle.known = True
        _output_acknowledged(self,handle,value)
        return handle

    def number(self, handle):
        need(type(handle) is Handle and handle.owner is self and handle in self.handles and handle.known
             and not handle.close_attempted and not handle.closed)
        return handle.slot.value

    def close(self, handle, *, _output_attempt=_output_io_close_attempt, _output_completed=_output_io_close_completed):
        self._main(); value = self.number(handle)
        token = _output_attempt(self,handle,value)
        handle.close_attempted = True
        self.call("CloseHandle", value, keep=(handle, handle.slot)); handle.closed = True
        _output_completed(self,handle,value,token)

    def limits(self):
        limits = ExtendedLimits(); self.buffers.append(limits)
        self.call("QueryInformationJobObject", self.number(self.job), 9, C.byref(limits), C.sizeof(limits), None, keep=(limits, self.job))
        need(limits.basic.flags == FLAGS and limits.basic.active_process_limit == self.profile["maximumActiveProcesses"]
             and limits.process_memory_limit == self.profile["processMemoryBytes"] and limits.job_memory_limit == self.profile["jobMemoryBytes"]
             and limits.basic.process_time == 0 and limits.basic.job_time == 0)

    def accounting(self):
        accounting = Accounting()
        self.call("QueryInformationJobObject", self.number(self.job), 1, C.byref(accounting), C.sizeof(accounting), None, keep=(accounting, self.job))
        need(accounting.active <= self.profile["maximumActiveProcesses"] and accounting.total >= accounting.active)
        return accounting

    def image(self, process):
        size = U32(32768); buffer = C.create_unicode_buffer(size.value)
        self.call("QueryFullProcessImageNameW", process, 0, buffer, C.byref(size), keep=(buffer, size))
        need(0 < size.value < 32768)
        return os.path.normcase(os.path.normpath(buffer.value))

    def prepare(self, preparation_current=None):
        self._main(); need(self.phase == "bound" and not self.create_attempted)
        self.phase = "preparing"
        if self.kernel is None:
            self.kernel = WindowsKernel(); self.invoke = self.kernel.invoke
        need(callable(self.invoke) and type(self.executable) is str and bool(self.executable))
        root = Path(self.root); entry = root / "main.py"
        # Fixed shipped paths only. This preflight is not Model/file custody.
        need(root.is_absolute() and root.is_dir() and not root.is_symlink() and entry.is_file() and not entry.is_symlink())
        need(not any(getattr(p.lstat(), "st_file_attributes", 0) & 0x400 for p in (root, entry)))
        self.root, self.entry = root, entry
        if self.model_graph is not None:
            need(type(self.model_graph) is OriginalModelGraph and self.model_graph.owner is self
                 and callable(preparation_current) and self.model_graph.lifetime_current is None)
            self.model_graph.lifetime_current = preparation_current
            self.model_graph.prepare()
        self.job = self.handle("job")
        value, _ = self.call("CreateJobObjectW", None, None, valid=lambda v: type(v) is int and 0 < v < C.c_void_p(-1).value, keep=(self.job,))
        self.acknowledge(self.job, value)
        inherit = U32(); self.call("GetHandleInformation", self.number(self.job), C.byref(inherit), keep=(inherit, self.job))
        need(inherit.value & 1 == 0)
        limits = ExtendedLimits(); limits.basic.flags = FLAGS; limits.basic.active_process_limit = self.profile["maximumActiveProcesses"]
        limits.process_memory_limit = self.profile["processMemoryBytes"]; limits.job_memory_limit = self.profile["jobMemoryBytes"]
        self.buffers.append(limits)
        self.call("SetInformationJobObject", self.number(self.job), 9, C.byref(limits), C.sizeof(limits), keep=(limits, self.job)); self.limits()
        security = Security(C.sizeof(Security), None, 1); self.buffers.append(security)
        stdin = self.handle("stdin")
        bootstrap_write = None
        if self.boot["schema"] == "windows-original-worker-launch-v3":
            need(type(self.definition_bytes) is bytes and self.model_graph is not None)
            bootstrap_write = self.handle("model-bootstrap-write")
            self.call("CreatePipe", C.byref(stdin.slot), C.byref(bootstrap_write.slot), C.byref(security), 0,
                      keep=(stdin, bootstrap_write, security))
            self.acknowledge(stdin, stdin.slot.value); self.acknowledge(bootstrap_write, bootstrap_write.slot.value)
            self.call("SetHandleInformation", self.number(bootstrap_write), 1, 0, keep=(bootstrap_write,))
            flags = U32(); self.call("GetHandleInformation", self.number(bootstrap_write), C.byref(flags), keep=(bootstrap_write, flags))
            need(flags.value == 0)
        else:
            value, _ = self.call("CreateFileW", "NUL", 0x80000000, 3, C.byref(security), 3, 0, None,
                                 valid=lambda v: type(v) is int and 0 < v < C.c_void_p(-1).value, keep=(security, stdin))
            self.acknowledge(stdin, value)
        writers = []
        for role in ("stdout", "stderr"):
            reader, writer = self.handle(role), self.handle(role + "-write")
            self.call("CreatePipe", C.byref(reader.slot), C.byref(writer.slot), C.byref(security), 0, keep=(reader, writer, security))
            self.acknowledge(reader, reader.slot.value); self.acknowledge(writer, writer.slot.value)
            self.call("SetHandleInformation", self.number(reader), 1, 0, keep=(reader,))
            setattr(self, role, reader); writers.append(writer)
        size = C.c_size_t()
        value, error = self.call("InitializeProcThreadAttributeList", None, 2, 0, C.byref(size),
                                 valid=lambda v: type(v) is int and v == 0, keep=(size,))
        need(error == 122 and 0 < size.value <= 65536)
        attributes = C.create_string_buffer(size.value); self.attributes = attributes; self.buffers.append(attributes)
        self.call("InitializeProcThreadAttributeList", attributes, 2, 0, C.byref(size), keep=(attributes, size)); self.attributes_initialized = True
        jobs = (P * 1)(self.number(self.job))
        source_handles = self.model_graph.inherited_handles() if self.model_graph is not None else ()
        if bootstrap_write is not None: self.model_bootstrap = OriginalModelBootstrapWriter(self, bootstrap_write)
        inherited = (P * (3 + len(source_handles)))(self.number(stdin), *(self.number(h) for h in writers),
                                                   *(self.number(h) for h in source_handles))
        self.buffers.extend((jobs, inherited))
        self.call("UpdateProcThreadAttribute", attributes, 0, JOB_LIST, jobs, C.sizeof(jobs), None, None, keep=(attributes, jobs))
        self.call("UpdateProcThreadAttribute", attributes, 0, HANDLE_LIST, inherited, C.sizeof(inherited), None, None, keep=(attributes, inherited))
        startup = StartupEx(); startup.startup.cb = C.sizeof(startup); startup.startup.flags = 0x100
        startup.startup.stdin, startup.startup.stdout, startup.startup.stderr = tuple(inherited)[:3]; startup.attributes = C.cast(attributes, P)
        info = Process(); command = C.create_unicode_buffer(subprocess.list2cmdline([self.executable, "-I", "-B", "-u", str(entry)]))
        environment = dict(self.boot["environment"])
        if self.model_bootstrap is not None: environment["PYTHON_RUNTIME_ORIGINAL_MODEL_BOOTSTRAP"] = self.boot["nonce"]
        env = C.create_unicode_buffer("\0".join(k + "=" + v for k, v in sorted(environment.items(), key=lambda item: item[0].casefold())) + "\0\0")
        self.buffers.extend((startup, info, command, env))
        self.process, self.primary_thread = self.handle("process"), self.handle("thread")
        if self.model_graph is not None:
            self.model_graph.assert_sealed(); self.model_graph.checkpoint("create")
        self.create_attempted = True
        self.call("CreateProcessW", self.executable, command, None, None, 1, CREATE_FLAGS, env, str(root), C.byref(startup), C.byref(info),
                  keep=(info, startup, command, env, self.process, self.primary_thread))
        self.acknowledge(self.process, info.process); self.acknowledge(self.primary_thread, info.thread)
        if self.model_graph is not None: self.model_graph.dispatched = True
        for handle in (stdin, *writers): self.close(handle)
        member = I32(); self.call("IsProcessInJob", self.number(self.process), self.number(self.job), C.byref(member), keep=(member, self.process, self.job)); need(member.value == 1)
        # A Windows venv launcher runs this controller in its base interpreter.
        # Its suspended child is still the exact selected venv executable, not
        # the controller's base image. Its descendants remain in this same Job.
        need(self.image(self.number(self.process)) == os.path.normcase(os.path.normpath(self.executable)))
        times = [FileTime() for _ in range(4)]; self.buffers.extend(times)
        self.call("GetProcessTimes", self.number(self.process), *(C.byref(value) for value in times), keep=tuple(times))
        self.creation_identity = (times[0].high << 32) | times[0].low; need(self.creation_identity > 0)
        self.limits(); accounting = self.accounting(); need(accounting.active == accounting.total == 1)
        self.phase = "suspended"

    def resume(self, admission=lambda: True):
        self._main(); need(self.phase == "suspended" and not self.resume_attempted and not self.unknown)
        current = admission; need(callable(current) and current() is True)
        need((self.clock() - self.started_at) * 1000 < self.profile["maximumDurationMs"])
        self.limits(); need(self.accounting().active == 1)
        need(current() is True and not self.unknown)
        if self.model_graph is not None: self.model_graph.assert_sealed()
        if self.model_graph is not None: self.model_graph.checkpoint("dispatch")
        need((self.clock() - self.started_at) * 1000 < self.profile["maximumDurationMs"])
        self.resume_attempted = True
        self.call("ResumeThread", self.number(self.primary_thread), valid=lambda v: type(v) is int and v == 1, keep=(self.primary_thread,))
        self.close(self.primary_thread); self.phase = "running"
        if self.model_bootstrap is not None: self.model_bootstrap.start()

    def worker_exited(self):
        self._main()
        if self.process is None or not self.process.known or self.process.close_attempted: return False
        value, _ = self.call("WaitForSingleObject", self.number(self.process), 0,
                             valid=lambda v: type(v) is int and v in (0, 258), keep=(self.process,))
        return value == 0

    def request_stop(self):
        self._main()
        if self.stop_attempted: return
        need(self.job is not None and self.job.known and not self.job.close_attempted)
        self.stop_attempted = True
        self.call("TerminateJobObject", self.number(self.job), 75, keep=(self.job,))
        self.phase = "retiring"

    def observe_retirement(self):
        self._main()
        if self.phase == "retired": return True
        if self.unknown or not self.stop_attempted or not self.worker_exited(): return False
        if self.accounting().active != 0 or any(thread.is_alive() for thread in self.readers): return False
        with self.lock:
            if self.pending or self.unknown: return False
        if self.model_graph is not None and not self.model_graph.retain_after_worker(): return False
        self.attributes_delete_attempted = True
        self.call("DeleteProcThreadAttributeList", self.attributes, valid=lambda v: v is None, keep=(self.attributes,))
        self.attributes_deleted = True
        for handle in reversed(self.handles):
            if not handle.closed: self.close(handle)
        need(not self.pending and not self.unknown and all(h.closed for h in self.handles))
        self.phase = "retired"; return True

    def start_readers(self, publish):
        self._main(); need(not self.output_readers_started and self.phase in ("suspended", "running"))
        self.output_readers_started = True
        def read(handle, lane):
            try:
                while True:
                    buffer = C.create_string_buffer(CHUNK_BYTES); size = U32()
                    value, error = self.call("ReadFile", self.number(handle), buffer, CHUNK_BYTES, C.byref(size), None,
                                             valid=lambda v: type(v) is int and v in (0, 1), keep=(handle, buffer, size))
                    need(size.value <= CHUNK_BYTES)
                    if value == 0:
                        need(error == 109); return
                    if size.value == 0: return
                    publish(lane, bytes(buffer.raw[:size.value]))
            except BaseException:
                self.unknown = True
        for lane in ("stdout", "stderr"):
            thread = Thread(target=read, args=(getattr(self, lane), lane), daemon=True)
            self.readers.append(thread); thread.start()


def _copy_model_json(raw):
    nodes = 0
    def visit(value, depth=0):
        nonlocal nodes
        nodes += 1; need(nodes <= 8192 and depth <= 24)
        if value is None or type(value) in (str, int, bool): return value
        if type(value) is float:
            need(value == value and abs(value) != float("inf")); return value
        if type(value) is list: return [visit(item, depth+1) for item in value]
        need(type(value) is dict and all(type(key) is str for key in value))
        return {key: visit(item, depth+1) for key, item in value.items()}
    result = visit(raw)
    need(len(json.dumps(result, ensure_ascii=True, allow_nan=False).encode("ascii")) <= DEFINITION_BYTES)
    return result


def _same_model_json(left, right):
    if type(left) is not type(right): return False
    if type(left) is dict: return set(left) == set(right) and all(_same_model_json(left[key], right[key]) for key in left)
    if type(left) is list: return len(left) == len(right) and all(_same_model_json(a,b) for a,b in zip(left,right))
    return left == right


class InheritedModelNativeCalls:
    """Own finite Native calls without constructing/adopting a worker.

    Inherited numbers remain unverified until the WHOLE original bootstrap and
    actual graph pass. Querying them grants no CloseHandle authority. Returned
    tokens/buffers use the original finite call ledger and unknown-call rules.
    """
    def __init__(self, kernel, *, clock=time.monotonic):
        self.kernel, self.invoke = kernel, kernel.invoke
        self.clock = clock
        self.handles, self.buffers, self.pending = [], [], []
        self.lock = Lock(); self.unknown = False; self.phase = "verifying"; self.thread = get_ident()
    call = OriginalWorker.call
    handle = OriginalWorker.handle
    acknowledge = OriginalWorker.acknowledge
    number = OriginalWorker.number
    _main = OriginalWorker._main

    def observe(self, number, role):
        handle = self.handle(role); handle.inherited = True; handle.verified = False
        return self.acknowledge(handle, number)  # Consistency witness, not ownership.

    def close(self, handle):
        need(not getattr(handle, "inherited", False) or handle.verified is True)
        return OriginalWorker.close(self, handle)


class _OriginalModelView:
    __slots__ = ("__weakref__",)


_model_views = WeakKeyDictionary()
_model_leases = WeakKeyDictionary()
_verified_model_receivers = WeakKeyDictionary()
_sealed_training_inputs = WeakKeyDictionary()
_training_input_readers = WeakKeyDictionary()
_training_output_families = WeakKeyDictionary()
_training_output_readers = WeakKeyDictionary()
_training_output_streams = WeakKeyDictionary()


def _retain_training_input_read_handle(graph, handle, row, identity, *, _number=OriginalWorker.number):
    """Capture original copy locals before later observers; no Native effect."""
    record = _training_input_readers.get(graph)
    if record is None: return  # Other flat-copy owners keep their existing path.
    need(type(graph) is OriginalTrainingInputGraph and record["preparing"] and not record["sealed"]
         and graph.owner is record["owner"] and type(identity) is bytes and len(identity) == 24)
    number = _number(record["owner"],handle)
    if record["principal"] is None:
        need(type(graph.principal) is bytes and len(graph.principal) > 0)
        record["principal"] = graph.principal
    need(type(graph.principal) is bytes and graph.principal == record["principal"])
    if row is None:
        need(record["root"] is None and len(record["handles"]) == len(record["files"]))
        record["root"] = (handle,identity,number)
    else:
        index = len(record["handles"]); need(index < len(record["files"]) and type(row) is dict)
        name,size,sha,_ = record["files"][index]
        need(type(row.get("name")) is str and row["name"] == name
             and type(row.get("sizeBytes")) is int and row["sizeBytes"] == size
             and type(row.get("sha256")) is str and row["sha256"] == sha)
        record["handles"].append((handle,identity,number))


def _assert_training_input_read_binding(graph, record, *, preparing=False, _number=OriginalWorker.number):
    """Pure original associations; never adopts mutable graph metadata."""
    need(type(graph) is OriginalTrainingInputGraph and _training_input_readers.get(graph) is record
         and graph.owner is record["owner"] and type(graph.phase) is str and graph.phase == "sealed"
         and type(record["owner"]) is InheritedModelNativeCalls
         and type(record["owner"].handles) is list
         and all(type(handle) is Handle for handle in record["owner"].handles)
         and graph.retired is False and graph.retirement_attempted is False
         and graph.charged is True and graph.charge_attempted is True and graph.attempted is True
         and type(graph.principal) is bytes and graph.principal == record["principal"]
         and (record["sealed"] or preparing and record["preparing"])
         and record["read_state"] in ("unread","reading","complete"))
    descriptor = graph.descriptor
    need(type(descriptor) is dict and set(descriptor) == {key for key,_ in record["configuration"]}|{"files"})
    for key,value in record["configuration"]:
        need(type(descriptor[key]) is type(value) and descriptor[key] == value)
    files = descriptor["files"]
    need(type(files) is tuple and len(files) == len(record["files"])
         and len(record["handles"]) == len(files) and record["root"] is not None
         and type(graph.guards) is list and len(graph.guards) == len(files)+1
         and type(graph.records) is list and len(graph.records) == len(files)
         and type(graph.physical_path) is str and graph.physical_path == record["physical_path"])
    for index, (name,size,sha,_) in enumerate(record["files"]):
        declared,observed = files[index],graph.records[index]
        handle,identity,number = record["handles"][index]
        need(type(handle) is Handle and handle.known is True and handle.close_attempted is False
             and handle.closed is False and type(handle.slot) is P)
        need(type(declared) is dict and set(declared) == {"name","sizeBytes","sha256"}
             and type(observed) is dict and set(observed) == {"name","sizeBytes","sha256","identity"}
             and graph.guards[index] is handle and _number(record["owner"],handle) == number)
        for row in (declared,observed):
            need(type(row["name"]) is str and row["name"] == name
                 and type(row["sizeBytes"]) is int and row["sizeBytes"] == size
                 and type(row["sha256"]) is str and row["sha256"] == sha)
        need(type(observed["identity"]) is bytes and observed["identity"] == identity)
    root = record["root"][0]
    need(type(root) is Handle and root.known is True and root.close_attempted is False
         and root.closed is False and type(root.slot) is P
         and graph.guards[-1] is root and _number(record["owner"],root) == record["root"][2])


def _input_view_binding(state, request):
    if "input_copy_owner" not in state: return None
    graph = state["input_copy_owner"]
    need(type(graph) is OriginalTrainingInputGraph)
    record = _sealed_training_inputs.get(graph)
    need(record is not None and record["lease_state"] is state and not record["active"] and not record["lost"]
         and graph.owner is record["native_owner"] and graph.phase == "sealed" and not graph.retired
         and not graph.owner.unknown and not graph.owner.pending
         and state.get("input_copy_io_active") is None and state.get("input_source_read_active") is None
         and _same_model_json(record["request"],request))
    return record


class OriginalInheritedModelLease:
    """One exact live Model/optional input binding, never full producer proof."""
    def __init__(self, source):
        need(type(source) is OriginalModelBootstrapReceiver)
        record = _verified_model_receivers.get(source)
        need(record is not None and record["bound"] and not record["lease_issued"] and source.phase == "bound")
        record["lease_issued"] = True
        _model_leases[self] = {"source": source, "entered": False, "lock": source.lock,
            "guard": record["guard"], "model_guard": record["model_guard"], "physical_path": record["physical_path"],
            "native_owner": record["native_owner"]}

    @contextmanager
    def borrow(self, sealed_request):
        state = _model_leases.get(self); need(type(self) is OriginalInheritedModelLease and state is not None)
        source = state["source"]
        request = _copy_model_json(sealed_request)
        # Refuse partial/held input work before waiting on its operation lock.
        _input_view_binding(state,request)
        need(state.get("input_source_read_active") is None)
        lock = state["lock"]; need(lock.acquire(blocking=False))
        input_record = None
        try:
            owner = state["native_owner"]
            need(not state["entered"] and source.phase == "bound"
                 and source.owner is owner and not owner.unknown and not owner.pending
                 and state.get("input_source_read_active") is None)
            input_record = _input_view_binding(state,request)
            state["entered"] = True; state["view_lost"] = False
            source.phase = "borrowed"; owner.thread = get_ident()
            if input_record is not None:
                input_record["native_owner"].thread = get_ident()
                input_record["active"] = True
                state["borrowed_input"] = input_record
            view = _OriginalModelView()
            try:
                state["model_guard"](request)
                state["guard"]()
                if input_record is not None:
                    input_record["guard"]()
                    state["guard"]()
            except BaseException:
                source.phase = "failed"; state["view_lost"] = True
                if input_record is not None: input_record["active"] = False; input_record["lost"] = True
                raise
            _model_views[view] = (self, request, get_ident())
        finally: lock.release()
        try: yield view
        finally:
            with state["lock"]:
                _model_views.pop(view, None)
                if input_record is not None: input_record["active"] = False
                # Retain every guard. Context exit is not SDK/worker/Job IO
                # retirement, handle close, disk credit or another borrow.
                source.phase = "spent"


def resolve_original_training_references(view, sealed_request):
    """Private fixed-loader references; a caller cannot supply these as proof."""
    need(type(view) is _OriginalModelView)
    binding = _model_views.get(view); need(binding is not None)
    lease, expected, thread = binding
    state = _model_leases.get(lease); need(state is not None and thread == get_ident())
    lock = state["lock"]; need(lock.acquire(blocking=False))
    try:
        need(state["source"].phase == "borrowed" and not state["view_lost"]
             and _same_model_json(expected, _copy_model_json(sealed_request)))
        input_record = state.get("borrowed_input")
        if "input_copy_owner" in state:
            need(input_record is not None and _sealed_training_inputs.get(state["input_copy_owner"]) is input_record
                 and input_record["active"] and not input_record["lost"])
        # Caller thread/request mistakes above do not consume legitimate use.
        # An actual Native/currentness loss below is permanent for this view.
        try:
            need(state["source"].owner is state["native_owner"]
                 and not state["native_owner"].unknown and not state["native_owner"].pending)
            state["guard"]()
            if input_record is not None:
                input_record["guard"]()
                state["guard"]()
        except BaseException:
            state["view_lost"] = True
            if input_record is not None: input_record["lost"] = True
            raise
        return state["physical_path"], None if input_record is None else input_record["dataset_references"]
    finally: lock.release()


def resolve_original_model_view(view, sealed_request):
    return resolve_original_training_references(view,sealed_request)[0]


def resolve_original_training_task_id(view, sealed_request):
    """Original source metadata only; grants no IO, approval or task issuance."""
    need(type(view) is _OriginalModelView)
    binding = _model_views.get(view); need(binding is not None)
    lease, expected, thread = binding
    state = _model_leases.get(lease)
    need(state is not None and thread == get_ident())
    lock = state["lock"]; need(lock.acquire(blocking=False))
    try:
        need(_model_views.get(view) is binding and state["entered"] and not state["view_lost"]
             and _same_model_json(expected,_copy_model_json(sealed_request)))
        record = _verified_model_receivers.get(state["source"])
        need(record is not None and record["bound"] and record["lease_issued"]
             and record["native_owner"] is state["native_owner"])
        task_id = record.get("task_id")
        definition = record.get("definition")
        need(type(task_id) is str and len(task_id) == 36 and _TRAINING_TASK_UUID.fullmatch(task_id) is not None
             and type(definition) is dict and type(definition.get("requestId")) is str
             and definition["requestId"] == task_id)
        return task_id
    finally: lock.release()


def read_original_training_input_bytes(view, sealed_request):
    """One all-or-nothing read of original dataset handles, never recipe/paths."""
    need(type(view) is _OriginalModelView)
    binding = _model_views.get(view); need(binding is not None)
    lease, expected, thread = binding
    state = _model_leases.get(lease); need(state is not None and thread == get_ident())
    request = _copy_model_json(sealed_request)
    need(_same_model_json(expected,request))
    lock = state["lock"]; need(lock.acquire(blocking=False))
    entered = False; reader = None; input_record = None; owner = model_owner = None
    try:
        graph = state.get("input_copy_owner")
        need(type(graph) is OriginalTrainingInputGraph)
        input_record = _sealed_training_inputs.get(graph)
        reader = _training_input_readers.get(graph)
        need(input_record is not None and reader is not None and reader["sealed"] is True
             and input_record["lease_state"] is state and state.get("borrowed_input") is input_record
             and input_record["active"] is True and input_record["lost"] is False
             and _model_views.get(view) is binding and state["entered"] is True and state["view_lost"] is False
             and type(reader["read_state"]) is str)
        if reader["read_state"] == "reading":
            reader["read_state"] = "failed"; input_record["lost"] = True; state["view_lost"] = True
            raise LaunchUnavailable()  # Caught owned reentry cannot leave the first read valid.
        need(reader["read_state"] == "unread" and state.get("input_data_read_active") is None)
        operation = object()
        reader["active"] = operation; reader["read_state"] = "reading"
        state["input_data_read_active"] = operation; entered = True
        owner,model_owner = reader["owner"],state["native_owner"]
        source = state["source"]; source_record = _verified_model_receivers.get(source)
        files,configuration = reader["files"],reader["configuration"]
        handles,root = tuple(reader["handles"]),reader["root"]
        model_guard,input_guard = state["guard"],input_record["guard"]
        admission = input_record["current"]
        assert_binding = _assert_training_input_read_binding
        need(len(files) == len(request["datasets"])+1 and files[-1][3] == "recipe"
             and all(row[3] in ("train","validation") and row[3] == item["splitRole"]
                 for row,item in zip(files[:-1],request["datasets"])))
        assert_binding(graph,reader)

        def bound():
            need(_model_views.get(view) is binding and _model_leases.get(lease) is state
                 and state["source"] is source and source.owner is model_owner
                 and type(source.phase) is str and source.phase == "borrowed"
                 and _verified_model_receivers.get(source) is source_record and graph._lease_record is source_record
                 and graph.lease is lease and graph._lease_state is state
                 and state.get("input_copy_owner") is graph and state.get("borrowed_input") is input_record
                 and _sealed_training_inputs.get(graph) is input_record and input_record["active"] is True and input_record["lost"] is False
                 and state["entered"] is True and state["view_lost"] is False and _same_model_json(expected,request)
                 and state["guard"] is model_guard and input_record["guard"] is input_guard
                 and input_record["current"] is admission and input_record["native_owner"] is owner
                 and reader["files"] is files and reader["configuration"] is configuration and reader["root"] is root
                 and type(reader["handles"]) is list and len(reader["handles"]) == len(handles)
                 and all(a is b for a,b in zip(reader["handles"],handles))
                 and type(reader["read_state"]) is str and reader["read_state"] == "reading" and reader["active"] is operation
                 and state.get("input_data_read_active") is operation
                 and owner.unknown is False and type(owner.pending) is list and not owner.pending
                 and model_owner.unknown is False and type(model_owner.pending) is list and not model_owner.pending)
            assert_binding(graph,reader)

        def guard():
            bound(); model_guard(); bound(); input_guard(); bound(); model_guard(); bound()
            # No Native observer or replaceable instance method may run after
            # the final original business-admission decision before an effect.
            need(admission() is True); bound()

        native_call = OriginalWorker.call.__get__(owner)
        OriginalWorker._main(owner); guard()
        results = []; total = 0
        buffer_size = dict(configuration)["bufferBytes"]
        for (name,size,sha,role),(handle,identity,number) in zip(files[:-1],handles[:-1]):
            guard()
            need(NativeModelInspection.facts(graph,handle)[0:2] == (identity,size))
            guard(); position = C.c_int64()
            native_call("SetFilePointerEx",number,0,C.byref(position),0,keep=(handle,position))
            guard(); need(position.value == 0)
            remaining = size; parts = []; digest = hashlib.sha256()
            buffer = C.create_string_buffer(buffer_size)
            while remaining:
                guard(); count = U32(); capacity = min(remaining,buffer_size)
                native_call("ReadFile",number,buffer,capacity,C.byref(count),None,keep=(handle,buffer,count))
                guard(); need(0 < count.value <= capacity)
                chunk = buffer.raw[:count.value]; parts.append(chunk); digest.update(chunk)
                remaining -= count.value
            guard(); count = U32()
            native_call("ReadFile",number,buffer,1,C.byref(count),None,keep=(handle,buffer,count))
            guard(); need(count.value == 0 and digest.hexdigest() == sha)
            total += size; need(total <= 256*1024**2)
            raw = b"".join(parts); need(len(raw) == size); results.append(raw)
        guard()
        need(NativeModelInspection.identity(graph,root[0]) == root[1]); guard()
        result = tuple(results)
        reader["read_state"] = "complete"
        return result
    except BaseException:
        if entered:
            reader["read_state"] = "failed"; input_record["lost"] = True; state["view_lost"] = True
        raise LaunchUnavailable() from None
    finally:
        if (entered and owner is not None and model_owner is not None
                and owner.unknown is False and type(owner.pending) is list and not owner.pending
                and model_owner.unknown is False and type(model_owner.pending) is list and not model_owner.pending):
            reader["active"] = None; state.pop("input_data_read_active",None)
        lock.release()


class OriginalModelBootstrapReceiver(NativeModelInspection):
    """Fixed-entry consumer of the original creation-time stdin conduit.

    Original Node launch/ACK custody, parent-only writer/HANDLE_LIST and the
    actual protected graph compose provenance. Anonymous pipe metadata, env,
    nonce, JSON, PID and numeric handles do not authenticate an independent peer.
    The caller cannot select another pipe, reopen a Model path or supply a loader.
    """
    def __init__(self, nonce, *, kernel=None, clock=time.monotonic):
        need(type(nonce) is str and re.fullmatch(r"[a-f0-9]{64}", nonce) is not None)
        self.owner = InheritedModelNativeCalls(kernel if kernel is not None else WindowsKernel(),clock=clock)
        self.clock, self.started_at, self.lock = clock, clock(), RLock()
        self.phase = "verifying"; self.owned_handles = []; self.guards = []; self.records = []
        self.maximum_ms = None  # Parent Job owns the initial header-read deadline.
        self.pipe = self.owner.observe(self.call("GetStdHandle", 0xfffffff6,
            valid=lambda v: type(v) is int and 0 < v < C.c_void_p(-1).value), "original-bootstrap-read")
        need(self.call("GetFileType", self.owner.number(self.pipe), valid=lambda v: type(v) is int) == 3)
        self.access(self.pipe, 0x120089)
        flags, outgoing, incoming, instances = U32(), U32(), U32(), U32()
        self.call("GetNamedPipeInfo", self.owner.number(self.pipe), C.byref(flags), C.byref(outgoing), C.byref(incoming), C.byref(instances),
                  keep=(self.pipe, flags, outgoing, incoming, instances))
        need(flags.value in (0,1) and instances.value == 1 and 0 <= outgoing.value <= 1024**2 and 0 <= incoming.value <= 1024**2)
        header_length = struct.unpack("<I", self.read_exact(4))[0]; integer(header_length, 1, FRAME_BYTES)
        header = exact(parse_frame(self.read_exact(header_length)),
            ("schema","nonce","descriptor","profile","physicalPath","principal","root","files"))
        need(header["schema"] == "windows-original-model-bootstrap-v1" and header["nonce"] == nonce)
        self.profile = capture_profile(header["profile"]); self.maximum_ms = self.profile["maximumDurationMs"]
        self.descriptor = capture_model_graph(header["descriptor"])
        size = struct.unpack("<I", self.read_exact(4))[0]; integer(size, 1, DEFINITION_BYTES)
        raw = self.read_exact(size)
        need("sha256:" + hashlib.sha256(raw).hexdigest() == self.descriptor["definitionDigest"])
        self.definition = _copy_model_json(parse_json_bytes(raw, DEFINITION_BYTES))
        need(type(self.definition) is dict and self.definition.get("modelUpdatedAt") == self.descriptor["modelUpdatedAt"])
        # Freeze correlation from the already integrity-checked bytes before
        # later Native observers. Model-only bootstrap remains compatible.
        task_id = self.definition.get("requestId")
        if type(task_id) is not str or len(task_id) != 36 or _TRAINING_TASK_UUID.fullmatch(task_id) is None:
            task_id = None
        self.physical_path = self.descriptor["freshParent"] + "\\" + self.descriptor["freshName"]
        need(header["physicalPath"] == self.physical_path)
        self.principal = self.private_principal()
        need(type(header["principal"]) is str and header["principal"] == self.principal.hex())
        rows = header["files"]; need(type(rows) is list and len(rows) == len(self.descriptor["files"]))
        for supplied, expected in zip(rows, self.descriptor["files"]):
            exact(supplied, ("name","sizeBytes","sha256","identity","handle"))
            need(all(type(supplied[key]) is type(expected[key]) and supplied[key] == expected[key] for key in expected))
            identity = self.identity_bytes(supplied["identity"])
            handle = self.owner.observe(supplied["handle"], "inherited-model-read")
            self.access(handle, 0x120089); self.guards.append(handle); self.records.append({**expected,"identity":identity})
        root = exact(header["root"], ("handle","identity")); self.root_identity = self.identity_bytes(root["identity"])
        root_handle = self.owner.observe(root["handle"], "inherited-model-root")
        self.access(root_handle, 0x1200a1); self.guards.append(root_handle)
        self.assert_request_model(self.definition["request"])
        self.assert_graph()
        for handle,row in zip(self.guards[:-1],self.records):
            position = C.c_int64()
            self.call("SetFilePointerEx", self.owner.number(handle), 0, C.byref(position), 0, keep=(handle,position))
            need(position.value == 0); self.verify_bytes(handle,row)
        self.assert_graph()
        for handle in (self.pipe,*self.guards): handle.verified = True
        self.phase = "available"
        _verified_model_receivers[self] = {"definition": _copy_model_json(self.definition),
            "task_id": task_id,
            "definition_digest": self.descriptor["definitionDigest"], "physical_path": self.physical_path,
            "native_owner": self.owner,
            "guard": OriginalModelBootstrapReceiver.assert_graph.__get__(self),
            "model_guard": OriginalModelBootstrapReceiver.assert_request_model.__get__(self), "bound": False, "lease_issued": False}

    @staticmethod
    def identity_bytes(value):
        need(type(value) is str and re.fullmatch(r"[a-f0-9]{48}",value) is not None)
        return bytes.fromhex(value)

    def guard(self):
        need(not self.owner.unknown and self.phase in ("verifying","bound","borrowed") and get_ident() == self.owner.thread
             and (self.maximum_ms is None or (self.clock()-self.started_at)*1000 < self.maximum_ms))

    def read_exact(self, size):
        integer(size, 1, DEFINITION_BYTES); result = bytearray()
        while len(result) < size:
            self.guard(); amount = min(CHUNK_BYTES,size-len(result)); buffer = C.create_string_buffer(amount); count=U32()
            self.call("ReadFile",self.owner.number(self.pipe),buffer,amount,C.byref(count),None,keep=(self.pipe,buffer,count))
            need(0<count.value<=amount); result.extend(buffer.raw[:count.value])
        return bytes(result)

    def assert_request_model(self, request):
        need(type(request) is dict and type(request.get("baseModel")) is dict)
        model = request["baseModel"]
        need(model.get("modelRecordId") == self.descriptor["modelId"] and model.get("localPath") == self.descriptor["logicalPath"])

    def assert_graph(self):
        self.guard(); available=U32()
        self.call("PeekNamedPipe",self.owner.number(self.pipe),None,0,None,C.byref(available),None,keep=(self.pipe,available))
        need(available.value==0)
        root=self.guards[-1]; self.kind(root,True); need(self.identity(root)==self.root_identity)
        filesystem,flags=C.create_unicode_buffer(32),U32()
        self.call("GetVolumeInformationByHandleW",self.owner.number(root),None,0,None,None,C.byref(flags),filesystem,32,keep=(root,filesystem,flags))
        need(filesystem.value=="NTFS" and flags.value&8!=0)
        name=C.create_unicode_buffer(32768)
        length=self.call("GetFinalPathNameByHandleW",self.owner.number(root),name,len(name),0,
            valid=lambda v:type(v)is int and 0<v<32768,keep=(root,name))
        import ntpath
        need(name.value.startswith("\\\\?\\") and len(name.value)==length and
             ntpath.normcase(ntpath.normpath(name.value[4:]))==ntpath.normcase(ntpath.normpath(self.physical_path)))
        for handle in self.guards:
            need(self.permissions(handle)==(model_acl(self.principal,sealed=True),0x1004,self.principal))
        for handle,row in zip(self.guards[:-1],self.records):
            identity,size,_=self.facts(handle); need(identity==row["identity"] and size==row["sizeBytes"])
        self.graph_matches(root,self.records); self.guard()

    def bind(self, definition):
        value=_copy_model_json(definition)
        with self.lock:
            record = _verified_model_receivers.get(self)
            need(type(self) is OriginalModelBootstrapReceiver and record is not None and not record["bound"]
                 and self.phase=="available" and _same_model_json(record["definition"],value))
            record["bound"] = True
            self.phase="bound"
            return OriginalInheritedModelLease(self)


_original_model_bootstrap = None


def capture_original_model_bootstrap(nonce):
    """Fixed worker entry only. No public task/config can call or replace this."""
    global _original_model_bootstrap
    need(_original_model_bootstrap is None)
    # Retain the original receiver even if native verification raises.
    receiver = OriginalModelBootstrapReceiver.__new__(OriginalModelBootstrapReceiver)
    _original_model_bootstrap = receiver
    OriginalModelBootstrapReceiver.__init__(receiver,nonce)
    return receiver


_TRAINING_INPUT_MEDIA = {"application/x-ndjson":"jsonl", "application/jsonl":"jsonl",
    "application/json":"json", "text/json":"json", "text/csv":"csv", "application/csv":"csv",
    "application/x-parquet":"parquet", "application/vnd.apache.parquet":"parquet"}


def _input_copy_directory(value):
    need(type(value) is str and 3 < len(value) <= 4096
         and re.fullmatch(r"[A-Za-z]:\\[^:\x00-\x1f]*", value) is not None)
    parts = value[3:].split("\\"); need(1 <= len(parts) <= 64)
    for part in parts: model_directory_component(part)
    return value


def _input_copy_file(value):
    need(type(value) is str)
    parent, name = ntpath.split(value)
    _input_copy_directory(parent); model_leaf(name)
    need(value == parent + "\\" + name)
    return parent, name


def _capture_training_copy_configuration(configuration):
    """The shared finite flat-copy bounds; never a reservation or IO grant."""
    config = exact(_copy_model_json(configuration),
        ("freshParent","freshName","maximumCopyBytes","bufferBytes","preparationMs"))
    _input_copy_directory(config["freshParent"]); model_leaf(config["freshName"])
    integer(config["maximumCopyBytes"], 1, 2**53-1)
    integer(config["bufferBytes"], 4096, 1024**2); integer(config["preparationMs"], 1, 86400000)
    return config


def _capture_original_training_file_lease(lease):
    """Original unentered binding only. This supplies no resource readiness."""
    need(type(lease) is OriginalInheritedModelLease)
    state = _model_leases.get(lease); need(state is not None)
    lock = state["lock"]; need(lock.acquire(blocking=False))
    try:
        source = state["source"]; record = _verified_model_receivers.get(source)
        need(_model_leases.get(lease) is state
             and record is not None and record["bound"] is True and record["lease_issued"] is True
             and state["entered"] is False and "input_copy_owner" not in state
             and type(source.phase) is str and source.phase == "bound"
             and source.owner is record["native_owner"] is state["native_owner"]
             and type(record["native_owner"]) is InheritedModelNativeCalls
             and record["native_owner"].unknown is False
             and type(record["native_owner"].pending) is list and len(record["native_owner"].pending) == 0)
        return state,record,source,_copy_model_json(record["definition"])
    finally:lock.release()


def _capture_training_input_copy(definition, staged, configuration, definition_digest):
    """Pure manifest correlation; paths/JSON grant neither IO nor custody."""
    approved = _copy_model_json(definition)
    supplied = exact(_copy_model_json(staged), ("payload","recipe","outputDirectory"))
    config = _capture_training_copy_configuration(configuration)
    maximum = config["maximumCopyBytes"]
    need(type(approved) is dict and type(approved.get("request")) is dict
         and type(approved.get("inputs")) is list and type(approved.get("dataset")) is dict)
    expected = _copy_model_json(approved["request"])
    original_rows, staged_rows = expected.get("datasets"), supplied["payload"].get("datasets") if type(supplied["payload"]) is dict else None
    need(type(original_rows) is list and type(staged_rows) is list
         and 1 <= len(original_rows) == len(staged_rows) == len(approved["inputs"]) <= 16)
    need(type(expected.get("output")) is dict)
    _input_copy_directory(supplied["outputDirectory"])
    expected["output"]["outputDirectory"] = supplied["outputDirectory"]
    files, seen, source, total, train = [], set(), None, 0, False
    def entry(path, digest, size):
        nonlocal source, total
        parent, name = _input_copy_file(path)
        need(source is None or ntpath.normcase(parent) == ntpath.normcase(source))
        source = parent if source is None else source
        need(name.casefold() not in seen and type(digest) is str and re.fullmatch(r"sha256:[a-f0-9]{64}",digest) is not None)
        seen.add(name.casefold()); total += size
        need(total <= 256*1024**2 and total <= maximum)
        files.append({"name":name,"sizeBytes":size,"sha256":digest[7:]})
        return name
    for index, (original, staged_row, metadata) in enumerate(zip(original_rows,staged_rows,approved["inputs"])):
        exact(metadata,("artifactId","role","mediaType","digest","sizeBytes"))
        need(type(original) is dict and set(original) <= {"artifactId","splitRole","format"}
             and type(staged_row) is dict and original.get("artifactId") == metadata["artifactId"] == "input-"+str(index)
             and original.get("splitRole") == metadata["role"] and metadata["role"] in ("train","validation"))
        need(type(metadata["mediaType"]) is str)
        fmt = _TRAINING_INPUT_MEDIA.get(metadata["mediaType"]); need(fmt is not None)
        need("format" not in original or original["format"] == fmt)
        size = integer(metadata["sizeBytes"],1,64*1024**2)
        name = entry(staged_row.get("path"),metadata["digest"],size)
        need(name.lower().endswith("."+fmt) and name.casefold() != "approved-recipe.json")
        original.update(format=fmt,path=staged_row["path"])
        train = train or metadata["role"] == "train"
    need(train and _same_model_json(expected,supplied["payload"]))
    recipe = exact(supplied["recipe"],("path","digest","sizeBytes"))
    size = integer(approved.get("recipeSizeBytes"),1,512*1024)
    need(type(recipe["sizeBytes"]) is int and recipe["sizeBytes"] == size
         and recipe["digest"] == approved["dataset"].get("recipeDigest"))
    need(entry(recipe["path"],recipe["digest"],size) == "approved-recipe.json")
    return {"schema":"windows-original-training-input-graph-v1","definitionDigest":definition_digest,
        "sourcePath":source,**config,"files":tuple(files)}


def _capture_input_loader_request(definition, staged):
    """Use only the already-loaded fixed worker schema, without import effects.

    The standalone controller can inspect/copy a finite graph but cannot mint a
    worker input view. Missing worker models leave that consumer unavailable.
    """
    if not __package__: return None
    name = __package__.rsplit(".",1)[0]+".models"
    module = sys.modules.get(name)
    if module is None: return None
    need(type(module) is ModuleType)
    request_type = vars(module).get("TrainModelTaskRequest")
    model_type = vars(module).get("TrainModelBaseModelInput")
    dataset_type = vars(module).get("TrainModelDatasetInput")
    need(all(isinstance(item,type) and item.__module__ == name for item in (request_type,model_type,dataset_type)))
    validator = request_type.__pydantic_validator__.validate_python
    serializer = request_type.__pydantic_serializer__.to_python
    raw = _copy_model_json(staged["payload"])
    workspace = raw.pop("workspaceId",None)
    need(type(workspace) is str and workspace == definition.get("workspaceId")
         and set(raw) <= frozenset(request_type.model_fields)
         and type(raw.get("baseModel")) is dict and set(raw["baseModel"]) <= frozenset(model_type.model_fields)
         and type(raw.get("datasets")) is list
         and all(type(row) is dict and set(row) <= frozenset(dataset_type.model_fields) for row in raw["datasets"]))
    try: normalized = _copy_model_json(serializer(validator(raw),mode="json"))
    except Exception: raise LaunchUnavailable() from None
    # Only declared default fields may be added. No supplied scalar, open data
    # object, array order or nested value may be coerced, removed or rewritten.
    for key,value in raw.items():
        if key == "baseModel":
            need(all(_same_model_json(item,normalized[key][field]) for field,item in value.items()))
        elif key == "datasets":
            need(len(value) == len(normalized[key]) and all(
                all(_same_model_json(item,after[field]) for field,item in before.items())
                for before,after in zip(value,normalized[key])))
        else: need(_same_model_json(value,normalized[key]))
    return normalized


class _OriginalInputAdmission:
    """Compose actual registered Model custody with captured business admission."""
    def __init__(self, lease, state, record, admission, input_owner):
        self.lease, self.state, self.record = lease, state, record
        self.native_owner, self.input_owner = record["native_owner"], input_owner
        self.current = admission.assert_current
        need(callable(self.current)); self.lost = False

    def _bound(self):
        need(not self.lost and _model_leases.get(self.lease) is self.state
             and _verified_model_receivers.get(self.state["source"]) is self.record
             and self.state.get("input_copy_owner") is self.input_owner
             and self.state.get("input_copy_io_active") is self.input_owner
             and not self.state["entered"] and self.state["source"].phase == "bound"
             and self.state["source"].owner is self.native_owner)

    def assert_current(self):
        lock = self.state["lock"]; need(lock.acquire(blocking=False))
        entered, previous = False, None
        try:
            self._bound()
            need(self.state.get("input_source_read_active") is None
                 and not self.native_owner.unknown and not self.native_owner.pending)
            previous = self.native_owner.thread
            self.state["input_source_read_active"] = self
            self.native_owner.thread = get_ident(); entered = True
            self.record["guard"]()
            need(self.current() is True)
            self._bound(); need(self.state.get("input_source_read_active") is self)
            self.record["guard"]()
            self._bound()
            return True
        except BaseException:
            self.lost = True
            raise LaunchUnavailable() from None
        finally:
            # A lost native result retains the original thread, flight and slots.
            # Never transfer a still-running or uncertain call to another thread.
            if entered and not self.native_owner.unknown and not self.native_owner.pending:
                self.native_owner.thread = previous
                self.state.pop("input_source_read_active",None)
            lock.release()


class OriginalTrainingInputGraph(_OriginalProtectedFlatCopy):
    """Concrete input copy in the original worker; never full training readiness.

    Binding performs no IO. The genuine lease retains this owner before any
    supplier property is read. Preparation uses the same actual Native copy,
    allocation, protection and readback mechanics as the Model controller.
    Output custody, loader consumption and durable reservation stay separate.
    """
    def __init__(self, lease, staged, configuration, reservation, admission):
        need(type(lease) is OriginalInheritedModelLease)
        state = _model_leases.get(lease)
        need(state is not None)
        lock = state["lock"]; need(lock.acquire(blocking=False))
        try:
            source = state["source"]; record = _verified_model_receivers.get(source)
            need(record is not None and record["bound"] and record["lease_issued"]
                 and not state["entered"] and source.phase == "bound" and "input_copy_owner" not in state
                 and source.owner is record["native_owner"] and not record["native_owner"].unknown
                 and not record["native_owner"].pending and state.get("input_source_read_active") is None)
            descriptor = _capture_training_input_copy(record["definition"],staged,configuration,record["definition_digest"])
            roles = tuple(row["role"] for row in record["definition"]["inputs"])+( "recipe",)
            original_files = tuple((row["name"],row["sizeBytes"],row["sha256"],role)
                for row,role in zip(descriptor["files"],roles))
            need(len(original_files) == len(descriptor["files"]) == len(roles)
                 and original_files[-1][0] == "approved-recipe.json")
            loader_request = _capture_input_loader_request(record["definition"],staged)
            state["input_copy_owner"] = self  # Retain atomically BEFORE suppliers.
            self.lease, self._lease_state, self._lease_record = lease, state, record
            self._loader_request = loader_request
        finally: lock.release()
        owner = InheritedModelNativeCalls(record["native_owner"].kernel,clock=record["native_owner"].clock)
        self.owner = owner
        _training_input_readers[self] = {"owner":owner,"files":original_files,
            "configuration":tuple((key,value) for key,value in descriptor.items() if key != "files"),
            "physical_path":descriptor["freshParent"]+"\\"+descriptor["freshName"],
            "handles":[],"root":None,"principal":None,"preparing":False,"sealed":False,
            "read_state":"unread","active":None}
        authority = _OriginalInputAdmission(lease,state,record,admission,self)
        self._bind_copy(owner,descriptor,reservation,authority)

    @contextmanager
    def _copy_call(self):
        state = self._lease_state; lock = state["lock"]
        need(lock.acquire(blocking=False)); entered, previous = False, None
        try:
            native_model = self._lease_record["native_owner"]
            need(_model_leases.get(self.lease) is state and state.get("input_copy_owner") is self
                 and not state["entered"] and state.get("input_copy_io_active") is None
                 and state.get("input_source_read_active") is None
                 and not native_model.unknown and not native_model.pending
                 and not self.owner.unknown and not self.owner.pending)
            previous = self.owner.thread; self.owner.thread = get_ident()
            state["input_copy_io_active"] = self; entered = True
            yield
        finally:
            if entered and not self.owner.unknown and not self.owner.pending:
                self.owner.thread = previous
                state.pop("input_copy_io_active",None)
            lock.release()

    def guard(self):
        record = _sealed_training_inputs.get(self)
        if record is not None and self._lease_state.get("borrowed_input") is record:
            return self._borrow_guard(record)
        need(self._lease_state.get("input_copy_io_active") is self)
        return _OriginalProtectedFlatCopy.guard(self)

    def prepare(self):
        with self._copy_call():
            reader = _training_input_readers.get(self)
            need(reader is not None and not reader["preparing"] and not reader["sealed"])
            reader["preparing"] = True
            try:
                _OriginalProtectedFlatCopy.prepare(self)
                _assert_training_input_read_binding(self,reader,preparing=True)
                reader["sealed"] = True
            except BaseException:
                reader["read_state"] = "failed"; self.phase = "failed"
                raise
            if self._loader_request is not None:
                need(self not in _sealed_training_inputs)
                _sealed_training_inputs[self] = {"lease_state":self._lease_state,"native_owner":self.owner,
                    "request":_copy_model_json(self._loader_request),
                    "dataset_references":tuple(self.physical_path+"\\"+row["name"] for row in self.records[:-1]),
                    "guard":OriginalTrainingInputGraph._assert_live_borrow.__get__(self),
                    "current":self.admission.current,"active":False,"lost":False,"checking":False}

    def assert_sealed(self):
        with self._copy_call(): return _OriginalProtectedFlatCopy.assert_sealed(self)

    def _borrow_guard(self, record):
        if record["checking"]:
            record["lost"] = True
            raise LaunchUnavailable()
        record["checking"] = True
        try:
            self.owner._main()
            state = self._lease_state
            def bound():
                need(_sealed_training_inputs.get(self) is record and record["lease_state"] is state
                     and state.get("input_copy_owner") is self and state.get("borrowed_input") is record
                     and state["entered"] and state["source"].phase == "borrowed"
                     and record["active"] and not record["lost"] and self.owner is record["native_owner"]
                     and not self.owner.unknown and not self.owner.pending
                     and not state["native_owner"].unknown and not state["native_owner"].pending
                     and state.get("input_copy_io_active") is None and state.get("input_source_read_active") is None)
            bound(); need(record["current"]() is True); bound()
        except BaseException:
            record["lost"] = True
            raise LaunchUnavailable() from None
        finally: record["checking"] = False

    def _assert_live_borrow(self):
        record = _sealed_training_inputs.get(self); need(record is not None)
        try:
            reader = _training_input_readers.get(self); need(reader is not None)
            _assert_training_input_read_binding(self,reader)
            _OriginalProtectedFlatCopy.assert_sealed(self)
            _assert_training_input_read_binding(self,reader)
        except BaseException:
            record["lost"] = True
            raise LaunchUnavailable() from None

    def retire_copy_io(self):
        """Close this copy's own IO; retain bytes, not worker/global settlement.

        A borrowed combined view retains all guards after context exit. A future
        full producer must own SDK reader retirement, outputs and worker exit.
        This result cannot implement NativeTrainingResources.settle by itself.
        """
        if self.retired: return True
        try:
            with self._copy_call(): return self._retire_copy_io()
        except LaunchUnavailable: return False

    def _retire_copy_io(self):
        self.owner._main()
        if (self.owner.unknown or self.owner.pending or self.borrowers or self.retirement_attempted
                or self.phase == "preparing" or self.charge_attempted and not self.charged): return False
        self.retirement_attempted = True
        try:
            for handle in reversed(self.owned_handles):
                if not handle.closed: self.owner.close(handle)
            if self.charged: need(self.retain(self.descriptor["maximumCopyBytes"]) is True)
            self.retired = True; self.phase = "retired"; return True
        except BaseException:
            self.phase = "failed"; return False


_TENSOR_BYTE_WIDTHS = {"BOOL": 1, "U8": 1, "I8": 1, "I16": 2, "I32": 4, "I64": 8,
    "F16": 2, "BF16": 2, "F32": 4, "F64": 8}


class OriginalTrainingTensorStream:
    """Bounded dense safetensors framing, not a model or custody capability.

    The fixed SDK adapter must supply exact dense tensor bytes. This component
    neither imports an SDK nor collects weights or chooses an output location.
    """
    def __init__(self, tensors, streams, *, maximum_bytes, chunk_bytes):
        maximum = integer(maximum_bytes, 1, 2**53-1)
        self.chunk_bytes = integer(chunk_bytes, 4096, 1024**2)
        need(type(tensors) is list and 1 <= len(tensors) <= 4096 and type(streams) is dict)
        rows, names, offset = [], set(), 0
        header = {"__metadata__": {"format": "pt"}}
        for supplied in tensors:
            exact(supplied, ("name", "dtype", "shape"))
            name, dtype, shape = supplied["name"], supplied["dtype"], supplied["shape"]
            need(type(name) is str and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,511}", name) is not None
                 and name != "__metadata__" and name not in names and type(dtype) is str and dtype in _TENSOR_BYTE_WIDTHS
                 and type(shape) is list and len(shape) <= 32)
            count, dimensions, stride_bits = 1, [], _TENSOR_BYTE_WIDTHS[dtype] * 8
            for size in shape:
                dimensions.append(integer(size, 0, maximum))
                # Match the reader's checked bits * NONZERO dimensions rule.
                # Empty tensors still have consumer strides; a leading/middle
                # zero cannot hide overflow. Stored byte capacity is separate.
                if size:
                    need(stride_bits <= (2**64-1) // size)
                    stride_bits *= size
                count *= size
            size = count * _TENSOR_BYTE_WIDTHS[dtype]; need(offset + size <= maximum)
            header[name] = {"dtype": dtype, "shape": dimensions, "data_offsets": [offset, offset+size]}
            rows.append((name, size)); names.add(name); offset += size
        need(all(type(name) is str for name in streams) and set(streams) == names)
        raw = json.dumps(header, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
        need(len(raw) <= 1024**2)
        self._header = raw + b" " * (-len(raw) % 8)
        self._tensor_bytes = offset
        self._size = 8 + len(self._header) + offset; need(self._size <= maximum)
        self._rows = tuple(rows); self._streams = {name: streams[name] for name, _ in rows}
        self.phase = "bound"; self._thread = None; self._lock = Lock()

    @property
    def size_bytes(self): return self._size

    @property
    def tensor_bytes(self): return self._tensor_bytes

    @property
    def tensor_sizes(self): return self._rows

    def __iter__(self):
        if not self._lock.acquire(blocking=False):
            self.phase = "failed"
            raise LaunchUnavailable()
        try:
            if self.phase != "bound":
                if self.phase == "active": self.phase = "failed"
                raise LaunchUnavailable()
            self.phase = "active"; self._thread = get_ident()
            return _OriginalTensorIterator(self, self._frames())
        finally: self._lock.release()

    def _current(self):
        need(self.phase == "active" and self._thread == get_ident())

    def _frames(self):
        self._current(); yield struct.pack("<Q", len(self._header))
        for at in range(0, len(self._header), self.chunk_bytes):
            self._current(); yield self._header[at:at+self.chunk_bytes]
        for name, size in self._rows:
            self._current(); stream = iter(self._streams[name]); self._current()
            copied = 0
            while True:
                self._current()
                try: chunk = next(stream)
                except StopIteration: self._current(); break
                self._current()
                need(type(chunk) is bytes and 0 < len(chunk) <= self.chunk_bytes and copied+len(chunk) <= size)
                copied += len(chunk); yield chunk
            need(copied == size)


class OriginalTrainingDenseTensorStream:
    """Fixed already-loaded Torch byte adapter for selected original tensors.

    Selection of a model/PEFT state and export of its configuration are separate.
    This object grants no Native output or retirement authority.
    """
    def __init__(self, view, sealed_request, tensors, *, maximum_bytes, chunk_bytes):
        self.phase = "capturing"
        try: self._capture(view,sealed_request,tensors,maximum_bytes=maximum_bytes,chunk_bytes=chunk_bytes)
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None

    def _capture(self, view, sealed_request, tensors, *, maximum_bytes, chunk_bytes):
        self.phase = "capturing"; self._view = view; self._request = _copy_model_json(sealed_request)
        self._sdk_flight = None
        self._resolve = resolve_original_training_references
        self._lock, self._thread = Lock(), get_ident()
        self._current()
        module = sys.modules.get("torch")
        need(type(module) is ModuleType and sys.byteorder == "little")
        namespace = vars(module); tensor_type, device_type = namespace.get("Tensor"), namespace.get("device")
        need(isinstance(tensor_type, type) and isinstance(device_type, type))
        self._tensor_type, self._device_type = tensor_type, device_type
        self._size_type = namespace.get("Size"); need(isinstance(self._size_type,type))
        self._ops = {name: getattr(tensor_type,name) for name in
            ("size","stride","storage_offset","data_ptr","element_size","is_contiguous","is_conj","is_neg",
             "detach","view","narrow","to","numpy")}
        need(all(callable(fn) for fn in self._ops.values()))
        self._properties = {name: getattr(tensor_type,name).__get__ for name in
            ("dtype","device","layout","_version","is_quantized","shape")}
        names = {"BOOL":"bool","U8":"uint8","I8":"int8","I16":"int16","I32":"int32","I64":"int64",
            "F16":"float16","BF16":"bfloat16","F32":"float32","F64":"float64"}
        self._dtypes = tuple((code, namespace.get(name)) for code,name in names.items())
        need(all(value is not None for _,value in self._dtypes) and namespace.get("strided") is not None)
        self._strided, self._uint8 = namespace["strided"], namespace["uint8"]
        self.chunk_bytes = integer(chunk_bytes,4096,1024**2)
        need(type(tensors) in (dict, OrderedDict) and 1 <= len(tensors) <= 4096
             and all(type(name) is str for name in tensors))
        self._tensors = tuple(tensors.items()); self._snapshots = []
        rows, streams = [], {}
        for name,tensor in self._tensors:
            captured = self._snapshot(tensor)
            self._snapshots.append(captured)
            rows.append({"name":name,"dtype":captured["dtype"],"shape":list(captured["shape"])})
            streams[name] = _OriginalDenseTensorBytes(self,tensor,captured)
        self._framed = OriginalTrainingTensorStream(rows,streams,maximum_bytes=maximum_bytes,chunk_bytes=chunk_bytes)
        self._all_current(); self.phase = "bound"

    @property
    def size_bytes(self): return self._framed.size_bytes

    @property
    def tensor_bytes(self): return self._framed.tensor_bytes

    @property
    def tensor_sizes(self): return self._framed.tensor_sizes

    def _current(self):
        need(self.phase in ("capturing","bound","active") and self._thread == get_ident())
        _, inputs = self._resolve(self._view,self._request); need(inputs is not None)
        # The original proof calls captured business observers. Caught reentry
        # can latch this stream failed without withdrawing the original view.
        need(self.phase in ("capturing","bound","active") and self._thread == get_ident())

    def _sdk(self, name, tensor, *args, _slice=None, **kwargs):
        if self._sdk_flight is not None:
            self.phase = "failed"
            raise LaunchUnavailable()
        flight = {"operation":name,"tensor":tensor,"args":args,"kwargs":kwargs,"slice":_slice,
            "entered":False,"returned":False,"result":None}
        self._sdk_flight = flight
        try:
            self._current()
            if name == "to": self._check_copy_slice(tensor,_slice)
            else: need(_slice is None)
            flight["entered"] = True
            result = self._ops[name](tensor,*args,**kwargs)
            flight["result"], flight["returned"] = result, True
            self._current(); need(self._sdk_flight is flight)
            self._sdk_flight = None
            return result
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None

    def _closed_properties(self, tensor):
        need(type(tensor) is self._tensor_type)
        values = {name:get(tensor,self._tensor_type) for name,get in self._properties.items()}
        shape = values["shape"]
        need(type(shape) in (tuple,self._size_type) and len(shape) <= 32
             and all(type(size) is int and 0 <= size <= 2**53-1 for size in shape)
             and type(values["device"]) is self._device_type
             and type(values["_version"]) is int and values["_version"] >= 0)
        device = values["device"]
        values["shape"], values["device_key"] = tuple(shape), (device.type,device.index)
        return values

    def _check_copy_slice(self, tensor, context):
        # Closed private data, never a supplied predicate or public capability.
        need(type(context) is tuple and len(context) == 3)
        source,start,length = context
        need(type(source) is _OriginalDenseTensorBytes and source.owner is self
             and any(t is source.tensor and row is source.captured
                     for (_,t),row in zip(self._tensors,self._snapshots)))
        expected = source.captured; count = 1
        for size in expected["shape"]: count *= size
        need(type(start) is int and type(length) is int and 0 <= start < count
             and 1 <= length <= min(count-start,self.chunk_bytes//expected["width"]))
        # No business observer follows these fixed readonly properties before
        # dispatch. Recheck after _sdk's LAST original-view callback, not merely
        # after the earlier returned-slice inspection.
        values = self._closed_properties(tensor)
        dtype = next(dtype for code,dtype in self._dtypes if code == expected["dtype"])
        need(values["shape"] == (length,) and values["dtype"] is dtype
             and values["device_key"] == expected["device"] and values["_version"] == expected["version"]
             and values["layout"] is self._strided and values["is_quantized"] is False
             and self.phase == "active" and self._thread == get_ident())

    def _snapshot(self, tensor):
        self._current(); need(type(tensor) is self._tensor_type)
        values = self._closed_properties(tensor)
        self._current()
        need(values["layout"] is self._strided and values["is_quantized"] is False
             and type(values["_version"]) is int and values["_version"] >= 0
             and type(values["device"]) is self._device_type)
        code = next((code for code,dtype in self._dtypes if values["dtype"] is dtype), None); need(code is not None)
        device = values["device"]; device = (device.type,device.index)
        need(device == ("cpu",None) or device[0] == "cuda" and type(device[1]) is int and 0 <= device[1] <= 65535)
        shape, stride = self._sdk("size",tensor), self._sdk("stride",tensor)
        need(type(shape) in (tuple,self._size_type) and len(shape) <= 32)
        shape = tuple(shape)
        need(all(type(size) is int and 0 <= size <= 2**53-1 for size in shape)
             and type(stride) is tuple and len(stride) == len(shape)
             and all(type(size) is int and 0 <= size <= 2**63-1 for size in stride)
             and self._sdk("is_contiguous",tensor) is True and self._sdk("is_conj",tensor) is False
             and self._sdk("is_neg",tensor) is False)
        offset, pointer, width = (self._sdk(name,tensor) for name in ("storage_offset","data_ptr","element_size"))
        need(type(offset) is int and 0 <= offset <= 2**63-1 and type(pointer) is int and 0 <= pointer <= 2**64-1
             and type(width) is int and width == _TENSOR_BYTE_WIDTHS[code])
        self._current()
        after = self._closed_properties(tensor)
        need(after["shape"] == values["shape"] == shape and after["_version"] == values["_version"]
             and after["dtype"] is values["dtype"] and after["device_key"] == device
             and after["layout"] is self._strided and after["is_quantized"] is False)
        return {"dtype":code,"device":device,"shape":shape,"stride":stride,"offset":offset,
            "pointer":pointer,"version":values["_version"],"width":width}

    def _all_current(self):
        self._current()
        for (_,tensor),captured in zip(self._tensors,self._snapshots): need(self._snapshot(tensor) == captured)
        self._current()

    def __iter__(self):
        if not self._lock.acquire(blocking=False): self.phase = "failed"; raise LaunchUnavailable()
        try:
            self._current(); need(self.phase == "bound")
            self.phase = "active"
            return _OriginalDenseTensorIterator(self,iter(self._framed))
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None
        finally: self._lock.release()


class _OriginalDenseTensorBytes:
    def __init__(self, owner, tensor, captured): self.owner,self.tensor,self.captured = owner,tensor,captured
    def _check_view(self, view, start, length):
        expected = self.captured; observed = self.owner._snapshot(view)
        need(observed["dtype"] == expected["dtype"] and observed["device"] == expected["device"]
             and observed["shape"] == (length,) and observed["width"] == expected["width"]
             and (length <= 1 or observed["stride"] == (1,))
             and observed["offset"] == expected["offset"]+start
             and observed["pointer"] == expected["pointer"]+start*expected["width"]
             and observed["version"] == expected["version"])

    def __iter__(self):
        owner,tensor,captured = self.owner,self.tensor,self.captured
        need(owner._snapshot(tensor) == captured)
        count = 1
        for size in captured["shape"]: count *= size
        if count == 0: return
        flat = owner._sdk("view",owner._sdk("detach",tensor),-1)
        self._check_view(flat,0,count)
        capacity = owner.chunk_bytes // captured["width"]
        for at in range(0,count,capacity):
            need(owner._snapshot(tensor) == captured)
            length = min(capacity,count-at)
            part = owner._sdk("narrow",flat,0,at,length)
            # Validate the returned slice BEFORE any allocation/transfer. SDK
            # call arguments alone do not prove a bounded returned object.
            self._check_view(part,at,length)
            cpu = owner._sdk("to",part,device="cpu",copy=True,non_blocking=False,_slice=(self,at,length))
            copied = owner._snapshot(cpu)
            need(copied["dtype"] == captured["dtype"] and copied["device"] == ("cpu",None)
                 and copied["shape"] == (length,) and copied["offset"] == 0 and copied["pointer"] != captured["pointer"])
            byte_view = owner._sdk("view",cpu,owner._uint8)
            array = owner._sdk("numpy",byte_view)
            buffer = memoryview(array)
            try:
                need(buffer.c_contiguous and buffer.format == "B" and buffer.ndim == 1
                     and buffer.nbytes == length*captured["width"] <= owner.chunk_bytes)
                raw = buffer.tobytes()
            finally: buffer.release()
            owner._current(); need(owner._snapshot(tensor) == captured)
            yield raw
        need(owner._snapshot(tensor) == captured)


class _OriginalDenseTensorIterator:
    def __init__(self, owner, framed): self.owner,self.framed = owner,framed
    def __iter__(self): return self
    def __next__(self):
        owner = self.owner
        if not owner._lock.acquire(blocking=False): owner.phase = "failed"; raise LaunchUnavailable()
        try:
            if owner.phase == "complete": raise StopIteration
            owner._current()
            try: raw = next(self.framed)
            except StopIteration:
                owner._all_current(); owner.phase = "complete"
                raise
            owner._current(); return raw
        except StopIteration: raise
        except BaseException:
            owner.phase = "failed"
            raise LaunchUnavailable() from None
        finally: owner._lock.release()


class _OriginalTensorIterator:
    def __init__(self, owner, frames): self.owner, self.frames = owner, frames
    def __iter__(self): return self
    def __next__(self):
        owner = self.owner
        if not owner._lock.acquire(blocking=False):
            owner.phase = "failed"
            raise LaunchUnavailable()
        try:
            if owner.phase == "complete": raise StopIteration
            owner._current()
            try: result = next(self.frames)
            except StopIteration:
                owner._current(); owner.phase = "complete"
                raise
            owner._current(); return result
        except StopIteration: raise
        except BaseException:
            owner.phase = "failed"
            raise LaunchUnavailable() from None
        finally: owner._lock.release()


_TRAINING_OUTPUT_FILES = frozenset(("config.json", "generation_config.json", "tokenizer.json",
    "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt",
    "model.safetensors", "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"))


def _capture_training_output_configuration(configuration):
    return _capture_training_copy_configuration(configuration)


def _capture_training_output_family_configuration(configuration):
    raw = exact(_copy_model_json(configuration),("maximumCopyBytes", "outputs"))
    maximum = integer(raw["maximumCopyBytes"],1,2**53-1)
    need(type(raw["outputs"]) is list and 1 <= len(raw["outputs"]) <= 16)
    outputs = tuple(_capture_training_output_configuration(row) for row in raw["outputs"])
    need(len({row["freshName"].casefold() for row in outputs}) == len(outputs)
         and len({row["freshParent"].casefold() for row in outputs}) == 1
         and sum(row["maximumCopyBytes"] for row in outputs) <= maximum)
    return maximum,outputs


def _capture_training_output(request, configuration, files):
    """Finite byte-container profile; filenames never attest model validity."""
    config = _capture_training_output_configuration(configuration)
    maximum = config["maximumCopyBytes"]
    rows = _copy_model_json(files); need(type(rows) is list and 1 <= len(rows) <= len(_TRAINING_OUTPUT_FILES))
    names, total = set(), 0
    for row in rows:
        exact(row, ("name", "sizeBytes")); name = row["name"]
        need(type(name) is str and name in _TRAINING_OUTPUT_FILES and name not in names)
        names.add(name); total += integer(row["sizeBytes"], 1, maximum)
    need(total <= maximum and "tokenizer.json" in names)
    if request.get("method") in ("lora", "qlora"):
        need({"adapter_model.safetensors", "adapter_config.json"} <= names
             and not names & {"model.safetensors", "config.json", "generation_config.json"})
    else:
        need(request.get("method") == "full-finetune" and {"model.safetensors", "config.json"} <= names
             and not names & {"adapter_model.safetensors", "adapter_config.json"})
    return {"schema": "windows-original-training-output-graph-v1", **config, "files": tuple(rows)}


def _output_family_record(family):
    need(type(family) is OriginalTrainingOutputFamily)
    record = _training_output_families.get(family); need(record is not None)
    return record


def _output_family_snapshot(family, member=None):
    record = _output_family_record(family)
    need(get_ident() == record["thread"] and record["phase"] in ("bound", "sealed")
         and record["io"]["stage"] == "active"
         and _model_views.get(record["view"]) is record["binding"]
         and _model_leases.get(record["lease"]) is record["lease_state"]
         and record["lease_state"].get("output_copy_owner") is family
         and not record["lease_state"]["view_lost"] and record["lease_state"]["source"].phase == "borrowed")
    if member is not None:
        need(any(row is member for row in record["members"]) and member["stage"] in ("bound", "sealed"))
    return record


def _fail_output_family(family):
    if family is not None:
        _output_family_record(family)["phase"] = "failed"


class OriginalTrainingOutputFamily:
    """Finite fresh namespaces, not checkpoint policy or a durable quota.

    Trusted composition must already hold an exclusive measured reservation for
    the complete declared capacity. Every member keeps the original Native writer.
    """
    __slots__ = ("__weakref__",)

    def __init__(self, view, sealed_request, configuration, reservation, admission):
        need(type(self) is OriginalTrainingOutputFamily and self not in _training_output_families
             and type(view) is _OriginalModelView)
        binding = _model_views.get(view); need(binding is not None and binding[2] == get_ident())
        lease = binding[0]; state = _model_leases.get(lease); need(state is not None)
        _, inputs = resolve_original_training_references(view, sealed_request); need(inputs is not None)
        maximum,outputs = _capture_training_output_family_configuration(configuration)
        lock = state["lock"]; need(lock.acquire(blocking=False))
        try:
            need(_model_views.get(view) is binding and "output_copy_owner" not in state
                 and not state["view_lost"] and state["source"].phase == "borrowed")
            record = {"view":view, "binding":binding, "lease":lease, "lease_state":state,
                "thread":get_ident(), "request":_copy_model_json(sealed_request), "outputs":outputs,
                "maximum":maximum, "charged":0, "phase":"binding", "members":[],
                "reservation":reservation, "admission":admission, "methods":{}, "lock":Lock()}
            record["io"] = {"book":record,"stage":"binding","admission":"ready","members":[],
                "member_book":record["members"],"outputs":outputs,
                "configurations":tuple(tuple(row.items()) for row in outputs),"maximum":maximum,
                "methods":record["methods"],"captured":None,"reservation":reservation,"business":admission,
                "lock":record["lock"],"retire":_ORIGINAL_OUTPUT_GRAPH_RETIRE}
            _training_output_families[self] = record
            state["output_copy_owner"] = self  # Before any external attribute/receiver access.
            need(record["lock"].acquire(blocking=False))
            try:
                for key, owner, name in (("resource",reservation,"assert_current"),("charge",reservation,"charge_source_copy"),
                        ("retain",reservation,"retain_source_copy"),("business",admission,"assert_current")):
                    method = getattr(owner,name)
                    need(type(method) in (MethodType,BuiltinMethodType) and method.__self__ is owner)
                    record["methods"][key] = method
                need(record["phase"] == "binding")
                record["io"]["captured"] = tuple(record["methods"].items())
                record["io"]["stage"] = "active"
                record["phase"] = "bound"
                _output_family_snapshot(self)
            except BaseException:
                record["io"]["stage"] = "failed"
                record["phase"] = "failed"; raise LaunchUnavailable() from None
            finally: record["lock"].release()
        finally: lock.release()

    @property
    def phase(self): return _output_family_record(self)["phase"]

    @property
    def next_configuration(self):
        record = _output_family_snapshot(self)
        need(len(record["members"]) < len(record["outputs"]))
        return _copy_model_json(record["outputs"][len(record["members"])])


def _resolve_output_family_for_training(view, request):
    """Read only the original joint view's owner; never discover a path/provider."""
    _, inputs = resolve_original_training_references(view,request)
    need(inputs is not None)
    binding = _model_views.get(view); need(binding is not None)
    state = _model_leases.get(binding[0]); need(state is not None)
    family = state.get("output_copy_owner")
    if family is None: return None
    record = _output_family_snapshot(family)
    need(record["view"] is view and _same_model_json(record["request"],request))
    return family


def _claim_output_family_training(family, owner, binding, snapshot):
    """Retain opaque original task identities; never invoke their callback."""
    record = _output_family_snapshot(family)
    need(owner is not None and type(binding) is dict and type(snapshot) is FunctionType
         and not record["members"] and "training_owner" not in record)
    record["training_owner"] = (owner,binding,snapshot)


def _guard_output_family_training(family, owner, binding):
    record = _output_family_snapshot(family)
    proof = record.get("training_owner")
    need(type(proof) is tuple and len(proof) == 3 and proof[0] is owner and proof[1] is binding)
    if record.get("training_checking"):
        record["phase"] = "failed"; raise LaunchUnavailable()
    record["training_checking"] = True
    try:
        for key in ("business","resource"):
            need(record["methods"][key]() is True)
            current = _output_family_snapshot(family)
            need(current is record and current.get("training_owner") is proof and current.get("training_checking") is True)
    except BaseException:
        record["phase"] = "failed"; raise LaunchUnavailable() from None
    finally: record["training_checking"] = False


def _output_family_training_binding(family):
    """Read retained ownership after failure; grants no IO or renewed lifetime."""
    record = _output_family_record(family)
    need(get_ident() == record["thread"])
    return record.get("training_owner")


def _claim_output_family(family, graph, view, request, configuration, reservation, admission):
    record = _output_family_record(family)
    need(get_ident() == record["thread"])
    if not record["lock"].acquire(blocking=False):
        record["phase"] = "failed"; raise LaunchUnavailable()
    try:
        _output_family_snapshot(family)
        need(record["view"] is view and _same_model_json(record["request"],request)
             and record["reservation"] is reservation and record["admission"] is admission)
        need(len(record["members"]) < len(record["outputs"]))
        need(not record["members"] or record["members"][-1]["stage"] == "sealed")
        planned = record["outputs"][len(record["members"])]
        need(_same_model_json(planned,_capture_training_output_configuration(configuration)))
        member = {"graph":graph, "configuration":planned, "stage":"constructing", "charge_attempted":False,
            "charged":False, "retain_attempted":False, "retained":False}
        record["members"].append(member)  # Before any per-member supplier call.
        record["io"]["members"].append((member,graph,planned))
        return member
    except BaseException:
        record["phase"] = "failed"; raise LaunchUnavailable() from None
    finally: record["lock"].release()


class _OriginalOutputFamilyControls:
    def __init__(self, family, member):
        self.family, self.member = family, member
        record = _output_family_record(family)
        self.resource, self.business = record["methods"]["resource"], record["methods"]["business"]
        self.charge, self.retain = record["methods"]["charge"], record["methods"]["retain"]
        self.checking = False

    def assert_current(self):
        need(get_ident() == _output_family_record(self.family)["thread"])
        try:
            need(not self.checking); self.checking = True
            _output_family_snapshot(self.family,self.member)
            need(self.business() is True and self.resource() is True)
            _output_family_snapshot(self.family,self.member)
            return True
        except BaseException:
            _fail_output_family(self.family); raise LaunchUnavailable() from None
        finally: self.checking = False

    def charge_source_copy(self, amount):
        need(get_ident() == _output_family_record(self.family)["thread"])
        try:
            record = _output_family_snapshot(self.family,self.member); member = self.member
            need(member["graph"]._operation_active and member["stage"] == "bound"
                 and not member["charge_attempted"] and type(amount) is int
                 and amount == member["configuration"]["maximumCopyBytes"]
                 and record["charged"] + amount <= record["maximum"])
            member["charge_attempted"] = True; record["charged"] += amount
            need(self.charge(amount) is True)
            _output_family_snapshot(self.family,member)
            member["charged"] = True; return True
        except BaseException:
            _fail_output_family(self.family); raise LaunchUnavailable() from None

    def retain_source_copy(self, amount):
        # Accounting survives revoked business permission and expired borrow.
        # It grants no new IO, retry, deletion, credit or family revival.
        _assert_plain_output_io_type(type(self),_OriginalOutputFamilyControls,
            frozenset(("family","member","resource","business","charge","retain","checking")))
        reference = _output_accounting_owners.get(self)
        need(reference is not None)
        graph = reference();_assert_plain_output_graph_type(type(graph))
        reader = _training_output_readers.get(graph)
        need(reader is not None)
        proof = reader["io"]["family_accounting"]
        need(type(proof) is tuple and proof[0] is self)
        record,member = proof[2],proof[3]
        need(get_ident() == record["thread"])
        _output_io_accounting_current(reader)
        methods = dict(proof[5]);resource,retain = methods["resource"],methods["retain"]
        stage = reader["io"]["stage"]
        need(type(stage) is str and stage in ("active","retiring"))
        def current():
            _output_io_accounting_current(reader)
            need(type(reader["io"]["stage"]) is str and reader["io"]["stage"] == stage
                 and member["retain_attempted"] is True and member["retained"] is False)
        try:
            need(any(row is member for row in record["members"]) and member["charge_attempted"]
                 and not member["retain_attempted"] and type(amount) is int
                 and amount == member["configuration"]["maximumCopyBytes"])
            member["retain_attempted"] = True
            reader["io"]["family_retain_attempted"] = True
            need(resource() is True);current()
            need(retain(amount) is True);current()
            member["retained"] = True;reader["io"]["family_retained"] = True
            return True
        except BaseException:
            _fail_output_family(proof[1]); raise LaunchUnavailable() from None


class _OriginalOutputAdmission:
    def __init__(self, graph, admission):
        self.graph, self.current = graph, admission.assert_current
        need(callable(self.current))

    def assert_bound(self):
        graph = self.graph
        need(_model_views.get(graph.view) is graph._view_binding
             and _model_leases.get(graph.lease) is graph._lease_state
             and graph.owner is graph._native_owner and graph._operation_active)
        if graph._output_family is None:
            need(graph._lease_state.get("output_copy_owner") is graph)
        else:
            _output_family_snapshot(graph._output_family,graph._output_member)
            need(graph._output_member["graph"] is graph)
        _, inputs = resolve_original_training_references(graph.view, graph._request)
        need(inputs is not None)

    def assert_current(self):
        self.assert_bound(); need(self.current() is True); self.assert_bound()
        return True


_OUTPUT_READER_FIELDS = frozenset(("owner","_native_owner","phase","retired","retirement_attempted",
    "charged","charge_attempted","attempted","principal","view","_view_binding","lease","_lease_state",
    "_output_family","_output_member","_request","descriptor","guards","records"))


def _assert_plain_output_graph_type(cls):
    """Static namespaces only: no virtual access/hash/equality in passive proof."""
    need(type(cls) is type)
    bases = type.__getattribute__(cls,"__mro__")
    need(OriginalTrainingOutputGraph in bases)
    for base in bases:
        namespace = type.__getattribute__(base,"__dict__")
        need(not _OUTPUT_READER_FIELDS.intersection(namespace) and "__getattr__" not in namespace)
        for name,expected in (("__getattribute__",object.__getattribute__),
                ("__hash__",object.__hash__),("__eq__",object.__eq__)):
            need(name not in namespace or namespace[name] is expected)
        descriptor = namespace.get("__dict__")
        need(descriptor is None or type(descriptor) is GetSetDescriptorType)


def _retain_training_output_read_handle(graph, handle, row, identity, *, _number=OriginalWorker.number):
    _assert_plain_output_graph_type(type(graph))
    record = _training_output_readers.get(graph)
    need(record is not None and record["sealed"] is False and record["read_state"] == "unread"
         and graph.owner is record["owner"] and type(identity) is bytes and len(identity) == 24)
    number = _number(record["owner"],handle)
    if record["principal"] is None:
        need(type(graph.principal) is bytes and len(graph.principal) > 0)
        record["principal"] = graph.principal
    need(type(graph.principal) is bytes and graph.principal == record["principal"])
    if row is None:
        need(record["root"] is None and len(record["handles"]) == len(record["files"]))
        record["root"] = (handle,identity,number)
    else:
        index = len(record["handles"])
        need(type(row) is tuple and len(row) == 3 and index < len(record["files"]))
        name,size,sha = row
        need(type(name) is str and type(size) is int and (name,size) == record["files"][index]
             and type(sha) is str and re.fullmatch(r"[a-f0-9]{64}",sha) is not None)
        record["handles"].append((handle,identity,number,name,size,sha))


def _assert_training_output_read_binding(graph, record, *, preparing=False, _number=OriginalWorker.number):
    """Passive original associations, independent of producer/preparation lifetime."""
    _assert_plain_output_graph_type(type(graph))
    need(type(graph) is record["graph_type"])
    need(_training_output_readers.get(graph) is record and graph.owner is record["owner"]
         and graph._native_owner is record["owner"] and type(record["owner"]) is InheritedModelNativeCalls
         and type(graph.phase) is str and graph.phase == "sealed" and graph.retired is False
         and graph.retirement_attempted is False and graph.charged is True and graph.charge_attempted is True
         and graph.attempted is True and (record["sealed"] is True or preparing)
         and type(graph.principal) is bytes and graph.principal == record["principal"]
         and graph.view is record["view"] and graph._view_binding is record["binding"]
         and graph.lease is record["lease"] and graph._lease_state is record["state"]
         and graph._output_family is record["family"] and graph._output_member is record["member"]
         and type(graph._request) is dict and _same_model_json(graph._request,record["request"]))
    descriptor = graph.descriptor
    need(type(descriptor) is dict and set(descriptor) == {k for k,_ in record["configuration"]}|{"files"})
    for key,value in record["configuration"]:
        need(type(descriptor[key]) is type(value) and descriptor[key] == value)
    files,handles,root = descriptor["files"],record["handles"],record["root"]
    need(type(files) is tuple and len(files) == len(record["files"]) == len(handles)
         and type(graph.guards) is list and len(graph.guards) == len(files)+1
         and type(graph.records) is list and len(graph.records) == len(files) and root is not None)
    for i,(handle,identity,number,name,size,sha) in enumerate(handles):
        declared,observed = files[i],graph.records[i]
        need(type(declared) is dict and set(declared) == {"name","sizeBytes"}
             and type(observed) is dict and set(observed) == {"name","sizeBytes","sha256","identity"})
        for row in (declared,observed):
            need(type(row["name"]) is str and row["name"] == name
                 and type(row["sizeBytes"]) is int and row["sizeBytes"] == size)
        need(type(observed["sha256"]) is str and observed["sha256"] == sha
             and type(observed["identity"]) is bytes and observed["identity"] == identity
             and graph.guards[i] is handle and type(handle) is Handle and type(handle.slot) is P
             and _number(record["owner"],handle) == number)
    need(graph.guards[-1] is root[0] and type(root[0]) is Handle and type(root[0].slot) is P
         and _number(record["owner"],root[0]) == root[2])


class _OriginalOutputReadCalls:
    """Inspection adapter: captured Native dispatch, never graph/SDK methods."""
    def __init__(self, owner, bound, *, _call=OriginalWorker.call, _number=OriginalWorker.number):
        self.buffers, self._owner, self._bound = owner.buffers,owner,bound
        self._call,self._number = _call,_number

    def number(self, handle): return self._number(self._owner,handle)

    def call(self, name, *args, **kwargs):
        self._bound()
        result = self._call(self._owner,name,*args,**kwargs)
        self._bound()
        return result


class _OriginalTrainingOutputStream:
    """Opaque provisional byte stream; direct construction confers no authority."""
    __slots__ = ("__weakref__",)
    def __iter__(self): return self
    def __next__(self):
        need(type(self) is _OriginalTrainingOutputStream)
        operation = _training_output_streams.get(self)
        need(operation is not None)
        record,advance = operation
        need(get_ident() == record["thread"])  # Foreign mistakes never poison its owner.
        if record["read_state"] == "complete": raise StopIteration
        if not record["read_lock"].acquire(blocking=False):
            record["read_state"] = "failed"; record["state"]["view_lost"] = True
            raise LaunchUnavailable()
        try:
            need(record["read_state"] == "reading")
            return next(advance)
        except StopIteration: raise
        except BaseException:
            record["read_state"] = "failed"; record["state"]["view_lost"] = True
            raise LaunchUnavailable() from None
        finally: record["read_lock"].release()


def read_original_training_output_chunks(graph, view, sealed_request):
    """Read every original sealed result once. Empty chunks mark verified EOF.

    Chunks are provisional until all file markers and iterator completion. This
    proves byte custody, not format validity, retirement, Save or task success.
    """
    _assert_plain_output_graph_type(type(graph))
    record = _training_output_readers.get(graph)
    need(record is not None and type(view) is _OriginalModelView and view is record["view"]
         and get_ident() == record["thread"] and _same_model_json(record["request"],_copy_model_json(sealed_request)))
    if record["read_state"] == "reading":
        record["read_state"] = "failed"; record["state"]["view_lost"] = True
        raise LaunchUnavailable()
    need(record["sealed"] is True and record["read_state"] == "unread")
    record["read_state"] = "reading"; record["read_lock"] = Lock()  # Before any observer/IO.
    token = _OriginalTrainingOutputStream(); record["stream"] = token
    try:
        owner,state,lease,binding = record["owner"],record["state"],record["lease"],record["binding"]
        source,model_owner,source_record = record["source"],record["model_owner"],record["source_record"]
        inputs = record["inputs"]; need(inputs is not None)
        model_guard,input_guard = record["model_guard"],record["input_guard"]
        resource,business = record["resource"],record["business"]
        files,handles,root = record["files"],tuple(record["handles"]),record["root"]
        config,principal = record["configuration"],record["principal"]
        family,member = record["family"],record["member"]
        family_record = None if family is None else _output_family_record(family)
        buffers = owner.buffers
        assert_binding = _assert_training_output_read_binding
        plain_type = _assert_plain_output_graph_type

        def bound():
            plain_type(type(graph))
            need(_training_output_readers.get(graph) is record and record["stream"] is token
                 and type(record["read_state"]) is str and record["read_state"] == "reading"
                 and _model_views.get(view) is binding and _model_leases.get(lease) is state
                 and _same_model_json(binding[1],record["request"])
                 and state["source"] is source and source.owner is model_owner
                 and state["native_owner"] is model_owner
                 and _verified_model_receivers.get(source) is source_record
                 and type(source.phase) is str and source.phase == "borrowed"
                 and state["entered"] is True and state["view_lost"] is False
                 and state.get("borrowed_input") is inputs and inputs["active"] is True and inputs["lost"] is False
                 and _sealed_training_inputs.get(state.get("input_copy_owner")) is inputs
                 and state["guard"] is model_guard and inputs["guard"] is input_guard
                 and record["resource"] is resource and record["business"] is business
                 and record["files"] is files and record["configuration"] is config
                 and record["root"] is root and record["principal"] is principal
                 and type(record["handles"]) is list and len(record["handles"]) == len(handles)
                 and all(a is b for a,b in zip(record["handles"],handles))
                 and owner.buffers is buffers and owner.unknown is False and type(owner.pending) is list and not owner.pending
                 and model_owner.unknown is False and type(model_owner.pending) is list and not model_owner.pending)
            invoke,kernel,clock,lock,pending,native_handles = record["native"]
            need(owner.invoke is invoke and owner.kernel is kernel and owner.clock is clock
                 and owner.lock is lock and owner.pending is pending and owner.handles is native_handles
                 and type(owner.handles) is list and all(type(h) is Handle for h in owner.handles))
            if family is None: need(state.get("output_copy_owner") is graph)
            else:
                need(_training_output_families.get(family) is family_record
                     and state.get("output_copy_owner") is family and family_record["lease_state"] is state
                     and family_record["binding"] is binding and type(family_record["phase"]) is str
                     and family_record["phase"] in ("bound","sealed")
                     and family_record["methods"]["resource"] is resource and family_record["methods"]["business"] is business
                     and any(row is member for row in family_record["members"])
                     and member["graph"] is graph and type(member["stage"]) is str
                     and member["stage"] == "sealed" and member["charged"] is True)
            assert_binding(graph,record)

        def guard():
            bound(); model_guard(); bound(); input_guard(); bound(); model_guard(); bound()
            need(resource() is True); bound()
            need(business() is True); bound()  # Last callback before the effect.

        inspection = NativeModelInspection()
        inspection.owner = _OriginalOutputReadCalls(owner,bound)
        inspection.descriptor = dict(config)
        native_call = OriginalWorker.call.__get__(owner)
        buffer_size = dict(config)["bufferBytes"]
        acl = (model_acl(principal,sealed=True),0x1004,principal)

        def all_current():
            guard()
            for handle,identity,_,_,size,_ in handles:
                need(NativeModelInspection.facts(inspection,handle)[0:2] == (identity,size)
                     and NativeModelInspection.permissions(inspection,handle) == acl)
            need(NativeModelInspection.identity(inspection,root[0]) == root[1]
                 and NativeModelInspection.permissions(inspection,root[0]) == acl)
            NativeModelInspection.graph_matches(inspection,root[0],
                tuple({"name":name,"identity":identity,"sizeBytes":size} for _,identity,_,name,size,_ in handles))
            guard()

        def advance():
            OriginalWorker._main(owner); all_current()
            buffer = C.create_string_buffer(buffer_size)
            for handle,_,number,name,size,sha in handles:
                position = C.c_int64(); guard()
                native_call("SetFilePointerEx",number,0,C.byref(position),0,keep=(handle,position))
                guard(); need(position.value == 0)
                offset,digest = 0,hashlib.sha256()
                while offset < size:
                    all_current(); capacity = min(buffer_size,size-offset); count = U32()
                    native_call("ReadFile",number,buffer,capacity,C.byref(count),None,keep=(handle,buffer,count))
                    guard(); need(0 < count.value <= capacity)
                    chunk = buffer.raw[:count.value]; digest.update(chunk)
                    start = offset; offset += len(chunk)
                    yield (name,start,chunk)
                all_current(); count = U32()
                native_call("ReadFile",number,buffer,1,C.byref(count),None,keep=(handle,buffer,count))
                guard(); need(count.value == 0 and digest.hexdigest() == sha)
                yield (name,offset,b"")
            all_current(); record["read_state"] = "complete"

        _training_output_streams[token] = (record,advance())
        bound()
        return token
    except BaseException:
        record["read_state"] = "failed"; record["state"]["view_lost"] = True
        raise LaunchUnavailable() from None


class OriginalTrainingOutputGraph(_OriginalProtectedFlatCopy):
    """One streamed output graph in the original live training view.

    The future fixed serializer supplies declared sizes and bounded byte chunks.
    This implements custody, not serialization, model validity, Save, worker
    retirement or durable reservation. No existing path is adopted or removed.
    """
    def __init__(self, view, sealed_request, configuration, files, reservation, admission, *, _family=None):
        _assert_plain_output_graph_type(type(self))
        self._output_family, self._output_member = _family, None
        need(_family is None or type(_family) is OriginalTrainingOutputFamily)
        if _family is not None:
            _assert_plain_output_io_type(type(_family),OriginalTrainingOutputFamily,frozenset())
            family_record = _output_family_record(_family)
            need(type(family_record["io"]["stage"]) is str and family_record["io"]["stage"] == "active"
                 and type(family_record["phase"]) is str and family_record["phase"] in ("bound","sealed"))
        need(type(view) is _OriginalModelView)
        binding = _model_views.get(view); need(binding is not None)
        lease, _, thread = binding; need(thread == get_ident())
        _, inputs = resolve_original_training_references(view, sealed_request); need(inputs is not None)
        state = _model_leases.get(lease); lock = state["lock"]; need(lock.acquire(blocking=False))
        try:
            need(_model_views.get(view) is binding and (_family is not None or "output_copy_owner" not in state)
                 and not state["view_lost"] and state["source"].phase == "borrowed")
            if _family is not None:
                self._output_member = _claim_output_family(_family,self,view,sealed_request,configuration,reservation,admission)
            descriptor = _capture_training_output(sealed_request, configuration, files)
            if _family is None: state["output_copy_owner"] = self
            self.view, self.lease, self._view_binding, self._lease_state = view, lease, binding, state
            self._request = _copy_model_json(sealed_request)
        except BaseException:
            _fail_output_family(_family); raise
        finally: lock.release()
        self._operation_lock, self._operation_active, self._output_guard_active = Lock(), False, False
        owner = InheritedModelNativeCalls(state["native_owner"].kernel, clock=state["native_owner"].clock)
        self.owner = self._native_owner = owner
        reader = {"graph_type":type(self),"owner":owner,"view":view,"binding":binding,"state":state,"lease":lease,
            "request":_copy_model_json(self._request),"thread":thread,"family":_family,"member":self._output_member,
            "files":tuple((row["name"],row["sizeBytes"]) for row in descriptor["files"]),
            "configuration":tuple((key,value) for key,value in descriptor.items() if key != "files"),
            "handles":[],"root":None,"principal":None,"sealed":False,"read_state":"unread","stream":None}
        original_inputs = state.get("borrowed_input"); need(original_inputs is not None)
        reader.update(source=state["source"],model_owner=state["native_owner"],
            source_record=_verified_model_receivers.get(state["source"]),inputs=original_inputs,
            model_guard=state["guard"],input_guard=original_inputs["guard"],
            native=(owner.invoke,owner.kernel,owner.clock,owner.lock,owner.pending,owner.handles))
        namespace = type.__getattribute__(type(owner),"__dict__")
        reader["io"] = {"stage":"binding","handles":[],"buffers":owner.buffers,"graph":self,
            "operation_lock":self._operation_lock,"owned_handles":None,"reservation":None,"retain":None,
            "dispatch":tuple((name,namespace[name]) for name in ("call","number","_main","handle","acknowledge","close")),
            "close":OriginalWorker.close,
            "copy_charge_attempted":False,"copy_charged":False,"charge_attempted":False,"retained":False,
            "creation_open":False,"family_accounting":None,
            "maximum":dict(reader["configuration"])["maximumCopyBytes"],
            "family_retain_attempted":False,"family_retained":False}
        _training_output_readers[self] = reader  # Before supplier method access.
        need(owner not in _output_io_owners)
        _output_io_owners[owner] = reader
        try:
            controls = _OriginalOutputFamilyControls(_family,self._output_member) if _family is not None else None
            if controls is not None:
                family_record = _output_family_record(_family)
                reference = ref(self);_output_accounting_owners[controls] = reference
                reader["io"]["family_accounting"] = (controls,_family,family_record,self._output_member,
                    family_record["methods"],tuple(family_record["methods"].items()),reservation,admission,
                    self._output_member["configuration"],reference)
            self._output_admission = _OriginalOutputAdmission(self, controls if controls is not None else admission)
            if controls is not None:
                reader["resource"],reader["business"] = controls.resource,controls.business
            else:
                reader["resource"],reader["business"] = reservation.assert_current,self._output_admission.current
            self._bind_copy(owner, descriptor, controls if controls is not None else reservation, self._output_admission)
            if self._output_member is not None:
                record = _output_family_record(_family); need(record["phase"] == "bound")
                self._output_member["stage"] = "bound"
            io = reader["io"]
            need(io["stage"] == "binding" and callable(io["retain"]))
            io["owned_handles"] = self.owned_handles
            io["stage"] = "active"
        except BaseException:
            reader["io"]["stage"] = "failed"
            _fail_output_family(_family); raise

    def guard(self):
        try:
            need(_training_output_readers[self]["io"]["stage"] == "active")
            need(not self._output_guard_active)
            self._output_guard_active = True
            _OriginalProtectedFlatCopy.guard(self)
            # Reservation checks are callbacks too. They cannot be the last
            # authority check before an effect: repeat the actual fixed joint
            # proof after ALL captured business/reservation callbacks.
            _OriginalOutputAdmission.assert_bound(self._output_admission)
            need(not self.owner.unknown and not self.owner.pending and self.phase not in ("failed", "retired"))
            if self.started is not None:
                need((self.owner.clock() - self.started) * 1000 < self.descriptor["preparationMs"])
        except BaseException:
            self.phase = "failed"
            _fail_output_family(self._output_family)
            raise LaunchUnavailable() from None
        finally: self._output_guard_active = False

    @contextmanager
    def _output_call(self):
        self.owner._main()
        if not self._operation_lock.acquire(blocking=False):
            _fail_output_family(self._output_family); raise LaunchUnavailable()
        try:
            need(not self._operation_active and not self.owner.unknown and not self.owner.pending)
            self._operation_active = True
            yield
        finally:
            self._operation_active = False
            self._operation_lock.release()

    def prepare(self, contents):
        with self._output_call():
            need(self.phase == "bound"); self.phase = "preparing"; self.started = self.owner.clock()
            io = _training_output_readers[self]["io"];io["creation_open"] = True
            try:
                self.guard()
                need(type(contents) is dict and set(contents) == {row["name"] for row in self.descriptor["files"]})
                io = _training_output_readers[self]["io"]
                io["copy_charge_attempted"] = True;self.charge_attempted = True
                need(self.charge(self.descriptor["maximumCopyBytes"]) is True)
                io["copy_charged"] = True;self.charged = True
                self.guard(); self.principal = self.private_principal()
                parent = self.path(self.descriptor["freshParent"])
                allocation_plan = self.allocation_plan(parent)
                self.checkpoint("allocate"); security = self.descriptor_for(sealed=False)
                self.fresh = self.open(parent, self.descriptor["freshName"], 0x1701ff,
                    directory=True, fresh=True, security=security, share=0)
                need(self.permissions(self.fresh) == (model_acl(self.principal, sealed=False), 0x1004, self.principal))
                allocated = 0
                for row, requested_allocation in zip(self.descriptor["files"], allocation_plan):
                    self.checkpoint("copy")
                    writer = self.open(self.fresh, row["name"], 0x1701ff, directory=False, fresh=True,
                        security=security, share=0, allocation_bytes=requested_allocation)
                    need(self.permissions(writer) == (model_acl(self.principal, sealed=False), 0x1004, self.principal))
                    identity, size, allocation = self.facts(writer)
                    need(size == 0 and row["sizeBytes"] <= allocation <= requested_allocation
                         and allocated + allocation <= self.descriptor["maximumCopyBytes"])
                    self.guard(); stream = iter(contents[row["name"]]); self.guard()
                    copied, digest = 0, hashlib.sha256()
                    while True:
                        self.guard()
                        try: chunk = next(stream)
                        except StopIteration: self.guard(); break
                        self.guard()
                        need(type(chunk) is bytes and 0 < len(chunk) <= self.descriptor["bufferBytes"]
                             and copied + len(chunk) <= row["sizeBytes"] and copied + len(chunk) <= allocation)
                        buffer, written = C.create_string_buffer(chunk), U32()
                        self.call("WriteFile", self.owner.number(writer), buffer, len(chunk), C.byref(written), None,
                            keep=(writer, buffer, written))
                        self.guard(); need(written.value == len(chunk))
                        digest.update(chunk); copied += len(chunk)
                        need(self.facts(writer) == (identity, copied, allocation))
                    need(copied == row["sizeBytes"])
                    self.call("FlushFileBuffers", self.owner.number(writer), keep=(writer,))
                    self.guard(); need(self.seal(writer) == identity)
                    self.owner.close(writer)
                    read = self.open(self.fresh, row["name"], 0x20089, directory=False)
                    _retain_training_output_read_handle(self,read,(row["name"],copied,digest.hexdigest()),identity)
                    self.guards.append(read)
                    record = {**row, "sha256": digest.hexdigest(), "identity": identity}
                    need(self.facts(read) == (identity, copied, allocation))
                    self.verify_bytes(read, record); self.guard()
                    self.records.append(record); allocated += allocation
                self.graph_matches(self.fresh, self.records); self.checkpoint("seal")
                root_identity = self.seal(self.fresh); self.owner.close(self.fresh)
                root = self.open(parent, self.descriptor["freshName"], 0x200a1, directory=True)
                _retain_training_output_read_handle(self,root,None,root_identity)
                need(self.identity(root) == root_identity); self.guards.append(root)
                for handle in self.guards:
                    need(self.permissions(handle) == (model_acl(self.principal, sealed=True), 0x1004, self.principal))
                self.graph_matches(root, self.records); self.guard(); self.phase = "sealed"
                if self._output_member is not None:
                    self._output_member["stage"] = "sealed"
                    record = _output_family_record(self._output_family)
                    if len(record["members"]) == len(record["outputs"]): record["phase"] = "sealed"
                reader = _training_output_readers[self]
                _assert_training_output_read_binding(self,reader,preparing=True)
                reader["sealed"] = True
            except BaseException:
                self.phase = "failed"
                _fail_output_family(self._output_family)
                raise LaunchUnavailable() from None
            finally:io["creation_open"] = False

    def assert_sealed(self):
        with self._output_call():
            try: return _OriginalProtectedFlatCopy.assert_sealed(self)
            except BaseException:
                self.phase = "failed"
                _fail_output_family(self._output_family)
                raise LaunchUnavailable() from None

    def retire_copy_io(self):
        """Retire this original copy's IO once; keep bytes and their charge.

        This is not SDK/model/input/worker/Job/global retirement or Save. No
        business callback, path reopen, ACL change, deletion or credit follows.
        """
        try:
            _assert_plain_output_graph_type(type(self))
            record = _training_output_readers.get(self)
            if record is None or get_ident() != record["thread"]:return False
            io = record["io"]
            if type(io["stage"]) is not str:return False
            if io["stage"] == "complete":return True
            if io["stage"] == "retiring":
                io["stage"] = "failed"
                object.__getattribute__(self,"__dict__")["phase"] = "failed"
                return False
            if type(io["stage"]) is not str or io["stage"] != "active":return False
            operation = io["operation_lock"]
            if not operation.acquire(blocking=False):return False
        except (LaunchUnavailable,AttributeError,KeyError,TypeError):return False
        read_lock = record.get("read_lock");read_locked = False
        try:
            if read_lock is not None:
                read_locked = read_lock.acquire(blocking=False)
                if not read_locked:return False
            owner = record["owner"]
            data = object.__getattribute__(self,"__dict__")
            reservation,retain = io["reservation"],io["retain"]
            rows = tuple(io["handles"])
            maximum = io["maximum"]
            def snapshot():
                _assert_plain_output_graph_type(type(self))
                _output_io_current(record)
                _output_io_accounting_current(record)
                need(_training_output_readers.get(self) is record and type(self) is record["graph_type"]
                     and object.__getattribute__(self,"__dict__") is data
                     and data.get("owner") is owner and data.get("_native_owner") is owner
                     and data.get("_operation_lock") is operation and data.get("_operation_active") is False
                     and data.get("reservation") is reservation and data.get("retain") is retain
                     and data.get("owned_handles") is io["owned_handles"] and type(io["owned_handles"]) is list
                     and len(io["owned_handles"]) == len(rows)
                     and all(handle is row["handle"] for handle,row in zip(io["owned_handles"],rows)))
                need(type(data.get("phase")) is str and data["phase"] in ("bound","sealed","failed")
                     and data.get("retired") is False and type(data.get("charge_attempted")) is bool
                     and type(data.get("charged")) is bool
                     and data["charge_attempted"] is io["copy_charge_attempted"]
                     and data["charged"] is io["copy_charged"]
                     and (not io["copy_charge_attempted"] or io["copy_charged"] is True)
                     and type(data.get("retirement_attempted")) is bool
                     and data["retirement_attempted"] is (io["stage"] == "retiring")
                     and type(io["stage"]) is str and io["stage"] in ("active","retiring"))
                need(len(io["handles"]) == len(rows) and all(a is b for a,b in zip(io["handles"],rows)))
                for row in rows:
                    handle = row["handle"]
                    need(_output_io_row(record,handle) is row and type(row["number"]) is int
                         and handle.known is True and handle.slot.value == row["number"] == row["creation_number"]
                         and row["creation_call"] is not None
                         and "inherited" not in object.__getattribute__(handle,"__dict__")
                         and "verified" not in object.__getattribute__(handle,"__dict__")
                         and type(row["closed"]) is bool and handle.closed is row["closed"]
                         and handle.close_attempted is row["closed"]
                         and ((row["close_attempt"] is not None) is row["closed"]))
            snapshot()
            io["stage"] = "retiring";data["retirement_attempted"] = True
            if record["read_state"] != "complete":record["read_state"] = "closed"
            # The native stream cannot advance after this permanent state. Do
            # not run generator/SDK cleanup hooks or discard uncertain buffers.
            snapshot()
            for row in reversed(rows):
                if not row["closed"]:
                    io["close"](owner,row["handle"])
                    snapshot()
            need(all(row["closed"] is True for row in rows))
            if io["copy_charged"] and io["family_retained"] is not True:
                io["charge_attempted"] = True
                need(retain(maximum) is True)
                snapshot()
                io["retained"] = True
            snapshot()
            data.update(retired=True,phase="retired")
            io["stage"] = "complete"
            return True
        except BaseException:
            io["stage"] = "failed"
            object.__getattribute__(self,"__dict__")["phase"] = "failed"
            return False
        finally:
            if read_locked:read_lock.release()
            operation.release()


_ORIGINAL_OUTPUT_GRAPH_RETIRE = OriginalTrainingOutputGraph.retire_copy_io


def _original_output_family_io(family):
    _assert_plain_output_io_type(type(family),OriginalTrainingOutputFamily,frozenset())
    book = _training_output_families.get(family)
    need(book is not None and get_ident() == book["thread"])
    io = book["io"]
    need(type(io) is dict and io["book"] is book and type(io["stage"]) is str)
    return book,io


def _output_family_io_snapshot(family,book,io,rows,expected):
    current,current_io = _original_output_family_io(family)
    need(current is book and current_io is io and book["lock"] is io["lock"]
         and type(io["lock"]) is LockType and book["members"] is io["member_book"]
         and type(book["members"]) is list and len(book["members"]) == len(rows)
         and type(io["members"]) is list and len(io["members"]) == len(rows)
         and all(a is b for a,b in zip(io["members"],rows))
         and book["outputs"] is io["outputs"] and book["reservation"] is io["reservation"]
         and book["admission"] is io["business"] and book["methods"] is io["methods"]
         and io["retire"] is _ORIGINAL_OUTPUT_GRAPH_RETIRE
         and type(book["maximum"]) is int and type(io["maximum"]) is int and book["maximum"] == io["maximum"]
         and type(book["phase"]) is str and book["phase"] in ("bound","sealed","failed","retiring","retired")
         and type(io["captured"]) is tuple and len(book["methods"]) == len(io["captured"])
         and all(book["methods"].get(key) is method for key,method in io["captured"]))
    for configuration,captured in zip(io["outputs"],io["configurations"]):
        need(type(configuration) is dict and len(configuration) == len(captured)
             and all(type(configuration.get(key)) is type(value) and configuration[key] == value for key,value in captured))
    for index,(member,graph,configuration) in enumerate(rows):
        _assert_plain_output_graph_type(type(graph))
        reader = _training_output_readers.get(graph)
        need(type(member) is dict and book["members"][index] is member and member.get("graph") is graph
             and member.get("configuration") is configuration and configuration is io["outputs"][index]
             and reader is not None and reader["family"] is family and reader["member"] is member
             and type(reader["io"]["stage"]) is str and reader["io"]["stage"] == expected[index])
        _output_io_current(reader);_output_io_accounting_current(reader)


def retire_original_training_output_family(family):
    """One original family's local IO only; no global settlement or Save."""
    try:
        book,io = _original_output_family_io(family)
        if io["stage"] == "complete":return True
        if io["stage"] == "retiring":
            io["stage"] = "failed";book["phase"] = "failed";return False
        if io["stage"] != "active" or type(io["lock"]) is not LockType:return False
        if not io["lock"].acquire(blocking=False):return False
    except (LaunchUnavailable,AttributeError,KeyError,TypeError):return False
    try:
        rows = tuple(io["members"])
        expected = []
        for member,graph,configuration in rows:
            _assert_plain_output_graph_type(type(graph))
            reader = _training_output_readers.get(graph)
            need(reader is not None)
            operation,reading = reader["io"]["operation_lock"],reader.get("read_lock")
            need(type(operation) is LockType and (reading is None or type(reading) is LockType))
            if operation.locked() or reading is not None and reading.locked():return False
            state = reader["io"]["stage"]
            need(type(state) is str and state in ("active","complete"))
            expected.append(state)
        _output_family_io_snapshot(family,book,io,rows,expected)
        io["stage"] = "retiring";book["phase"] = "retiring"
        for index,(_,graph,_) in enumerate(rows):
            need(io["stage"] == "retiring" and io["retire"](graph) is True)
            expected[index] = "complete"
            _output_family_io_snapshot(family,book,io,rows,expected)
            need(io["stage"] == "retiring" and book["phase"] == "retiring")
        io["closed"] = (rows,tuple(expected))
        io["stage"] = "complete";book["phase"] = "retired"
        return True
    except BaseException:
        io["stage"] = "failed";book["phase"] = "failed"
        return False
    finally:io["lock"].release()


def admit_retired_training_output_family(family,owner,binding):
    """Current original resource/permission after local IO; no SDK observer."""
    book,io = _original_output_family_io(family)
    proof = book.get("training_owner")
    need(type(proof) is tuple and len(proof) == 3 and proof[0] is owner and proof[1] is binding)
    need(io["stage"] == "complete" and type(io["admission"]) is str)
    if io["admission"] == "checking":
        io["admission"] = "failed";raise LaunchUnavailable()
    need(io["admission"] == "ready")
    rows,expected = io["closed"]
    methods = dict(io["captured"])
    io["admission"] = "checking"
    try:
        def snapshot():
            _output_family_io_snapshot(family,book,io,rows,expected)
            need(io["stage"] == "complete" and book["phase"] == "retired"
                 and type(io["admission"]) is str and io["admission"] == "checking"
                 and book.get("training_owner") is proof)
        snapshot()
        need(methods["resource"]() is True);snapshot()
        need(methods["business"]() is True);snapshot()
        io["admission"] = "complete"
        return True
    except BaseException:
        io["admission"] = "failed"
        raise LaunchUnavailable() from None


class OriginalSourceExchange:
    """Controller half of the original Node-owned reservation channel.

    Descriptors/ACKs are correlation data. Only serve's original stdin/stdout
    and Node's retained observation/reservation owner compose this capability.
    No HTTP task, env field or supplied boolean can create that owner.
    """
    def __init__(self, owner, frame, replies, ended, overflow, stopped):
        self.owner, self.frame, self.replies = owner, frame, replies
        self.ended, self.overflow, self.stopped = ended, overflow, stopped
        self.sequence, self.lost = 0, False
        self.descriptor = owner.boot["modelSource"]

    def assert_current(self):
        return not self.lost and not self.ended.is_set() and not self.overflow.is_set() and not self.stopped.is_set()

    def request(self, phase, amount, index=None):
        need(not self.lost and not self.ended.is_set() and not self.overflow.is_set()
             and (phase == "retain" or not self.stopped.is_set()) and self.replies.empty())
        self.sequence += 1; need(self.sequence <= (48 if self.owner.boot["schema"] == "windows-original-worker-launch-v3" else 40))
        try:
            self.frame("source-request", sequence=self.sequence, phase=phase,
                       definitionDigest=self.descriptor["definitionDigest"], amount=amount,
                       **({"index": index} if phase == "definition" else {}))
            deadline = self.owner.clock() + self.owner.profile["observationMs"] / 1000
            while True:
                need(not self.ended.is_set() and not self.overflow.is_set()
                     and (phase == "retain" or not self.stopped.is_set()) and self.owner.clock() < deadline)
                try: reply = self.replies.get(timeout=min(0.025, max(0.001, deadline - self.owner.clock())))
                except Empty: continue
                need(reply["sequence"] == self.sequence and reply["phase"] == phase
                     and reply["definitionDigest"] == self.descriptor["definitionDigest"])
                return reply if phase == "definition" else True
        except BaseException:
            self.lost = True; self.owner.unknown = True
            raise LaunchUnavailable() from None

    def charge_source_copy(self, amount): return self.request("charge", amount)
    def retain_source_copy(self, amount): return self.request("retain", amount)
    def checkpoint(self, phase): return self.request(phase, self.descriptor["maximumCopyBytes"])

    def collect_definition(self):
        """Exact original bytes, not a cross-runtime re-serialization digest."""
        need(self.owner.definition_bytes is None and self.owner.boot["schema"] == "windows-original-worker-launch-v3")
        total = self.owner.boot["definitionByteCount"]; parts = []
        for index in range((total + DEFINITION_CHUNK_BYTES - 1) // DEFINITION_CHUNK_BYTES):
            reply = self.request("definition", self.descriptor["maximumCopyBytes"], index)
            expected = min(DEFINITION_CHUNK_BYTES, total - index * DEFINITION_CHUNK_BYTES)
            data = base64.b64decode(reply["data"], validate=True)
            need(reply["index"] == index and reply["totalBytes"] == total and len(data) == expected
                 and reply["final"] is ((index + 1) * DEFINITION_CHUNK_BYTES >= total))
            parts.append(data)
        raw = b"".join(parts)
        need("sha256:" + hashlib.sha256(raw).hexdigest() == self.descriptor["definitionDigest"])
        definition = parse_json_bytes(raw, DEFINITION_BYTES)
        need(type(definition) is dict and type(definition.get("request")) is dict
             and type(definition["request"].get("baseModel")) is dict)
        model = definition["request"]["baseModel"]
        need(model.get("modelRecordId") == self.descriptor["modelId"] and model.get("localPath") == self.descriptor["logicalPath"]
             and definition.get("modelUpdatedAt") == self.descriptor["modelUpdatedAt"])
        self.owner.definition_bytes = raw


def serve(stdin, stdout, *, owner_factory=OriginalWorker):
    """Closed private protocol. Worker bytes never become controller commands."""
    boot = capture_boot(parse_frame(stdin.readline(FRAME_BYTES + 1)))
    nonce, digest = boot["nonce"], boot["profileDigest"]
    owner = owner_factory(boot)
    commands, output, source_replies = Queue(maxsize=8), Queue(maxsize=8), Queue(maxsize=1)
    overflow, input_ended, stop_received = Event(), Event(), Event()
    output_total = 0
    def frame(kind, **fields):
        payload = json.dumps({"schema": "windows-original-worker-control-v1", "nonce": nonce, "profileDigest": digest,
                              "kind": kind, **fields}, separators=(",", ":"))
        need(len(payload.encode("utf8")) <= FRAME_BYTES)
        stdout.write(payload.encode("utf8") + b"\n"); stdout.flush()
    def read_commands():
        try:
            for _ in range(56 if boot["schema"] == "windows-original-worker-launch-v3" else 48 if "modelSource" in boot else 4):
                data = stdin.readline(FRAME_BYTES + 1)
                if not data: return
                value = parse_frame(data)
                if boot["schema"] == "windows-original-worker-launch-v3" and type(value) is dict and value.get("schema") == "windows-original-model-definition-v1":
                    exact(value, ("schema", "nonce", "profileDigest", "definitionDigest", "sequence", "phase", "index", "totalBytes", "final", "data"))
                    need(value["nonce"] == nonce and value["profileDigest"] == digest and value["definitionDigest"] == boot["modelSource"]["definitionDigest"]
                         and value["phase"] == "definition" and type(value["sequence"]) is int and 1 <= value["sequence"] <= 48
                         and type(value["index"]) is int and 0 <= value["index"] < 8
                         and type(value["totalBytes"]) is int and value["totalBytes"] == boot["definitionByteCount"]
                         and type(value["final"]) is bool and type(value["data"]) is str and len(value["data"]) <= 21848)
                    source_replies.put_nowait(value); continue
                if "modelSource" in boot and type(value) is dict and value.get("schema") == "windows-original-model-ack-v1":
                    exact(value, ("schema", "nonce", "profileDigest", "definitionDigest", "sequence", "phase"))
                    need(value["nonce"] == nonce and value["profileDigest"] == digest
                         and value["definitionDigest"] == boot["modelSource"]["definitionDigest"]
                         and type(value["sequence"]) is int and 1 <= value["sequence"] <= (48 if boot["schema"] == "windows-original-worker-launch-v3" else 40)
                         and value["phase"] in ("charge", "allocate", "copy", "seal", "create", "dispatch", "retain"))
                    source_replies.put_nowait(value)
                    continue
                value = exact(value, ("schema", "nonce", "profileDigest", "action"))
                need(value["schema"] == "windows-original-worker-command-v1" and value["nonce"] == nonce
                     and value["profileDigest"] == digest and value["action"] in ("resume", "stop"))
                if value["action"] == "stop": stop_received.set()
                commands.put_nowait(value["action"])
        except BaseException:
            overflow.set()
        finally:
            input_ended.set()
    def publish(lane, data):
        nonlocal output_total
        with owner.lock:
            output_total += len(data)
            if output_total > OUTPUT_BYTES: overflow.set(); return
        try: output.put_nowait((lane, data))
        except Full: overflow.set()
    def drain_output():
        import base64
        try:
            while True:
                lane, data = output.get_nowait()
                frame("worker-output", lane=lane, data=base64.b64encode(data).decode("ascii"))
        except Empty:
            pass
    try:
        if "modelSource" in boot:
            exchange = OriginalSourceExchange(owner, frame, source_replies, input_ended, overflow, stop_received)
            owner.bind_model_graph(boot["modelSource"], exchange, exchange)
        source_mode = getattr(owner, "model_graph", None) is not None
        if source_mode:
            # Arm cancellation BEFORE any source copy, ACL or process effect.
            # This is still private composition; v1 BOOT cannot select a source.
            Thread(target=read_commands, daemon=True).start()
            if boot["schema"] == "windows-original-worker-launch-v3": exchange.collect_definition()
            owner.prepare(lambda: not stop_received.is_set() and not input_ended.is_set() and not overflow.is_set())
        else:
            owner.prepare()
        owner.start_readers(publish)
        frame("suspended")
        if not source_mode: Thread(target=read_commands, daemon=True).start()
        uncertain_reported = False
        while True:
            drain_output()
            expired = (owner.clock() - owner.started_at) * 1000 >= owner.profile["maximumDurationMs"]
            if stop_received.is_set() or input_ended.is_set() or overflow.is_set() or expired or owner.worker_exited():
                owner.request_stop()
            elif not owner.stop_attempted:
                try:
                    action = commands.get_nowait()
                    if action == "resume":
                        owner.resume(lambda: not stop_received.is_set() and not input_ended.is_set() and not overflow.is_set())
                        frame("running")
                    else: owner.request_stop()
                except Empty: pass
            if owner.unknown and not uncertain_reported:
                frame("uncertain"); uncertain_reported = True
            if owner.observe_retirement():
                # Native retirement joins the reader lifetime. Drain the stable
                # final queue before announcing retirement or losing its output.
                drain_output()
                frame("retired"); return 0
            time.sleep(0.025)
    except BaseException:
        # Retain the original owner and all unknown native buffers. Never claim
        # original worker retirement because the controller itself is exiting.
        owner.unknown = True
        try:
            if owner.job is not None and owner.job.known and not owner.job.close_attempted:
                owner.request_stop()  # One stop of this owned Job, never a PID.
        except BaseException:
            pass
        try: frame("uncertain")
        except BaseException: pass
        while True:
            time.sleep(1)


def main():
    try:
        return serve(sys.stdin.buffer, sys.stdout.buffer)
    except BaseException:
        # No raw exception, command, path or environment reaches public sinks.
        return 75


if __name__ == "__main__":
    raise SystemExit(main())

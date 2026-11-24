"""Actual source-copy ABI code with in-memory Win32 replies; no Native effects."""
import copy
from contextlib import contextmanager
import ctypes as C
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from queue import Queue
import struct
import sys
from threading import Event, Thread, get_ident
from types import ModuleType
import unittest
from unittest.mock import patch

_root = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("_inert_native_model_graph", _root / "native/windows_original_worker_launch.py")
n = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(n)


def setUpModule():
    if sys.flags.optimize: raise RuntimeError("Native source fixtures require assertions.")


def descriptor():
    return json.loads((Path(__file__).parent / "fixtures/native_training_model_graph.json").read_text(encoding="utf8"))


def boot():
    p = {"schema": "windows-original-worker-job-v1", "profileId": "inert-copy", "processMemoryBytes": 1024**2,
         "jobMemoryBytes": 2 * 1024**2, "maximumActiveProcesses": 1, "maximumDurationMs": 30000, "observationMs": 30}
    return {"schema": "windows-original-worker-launch-v1", "nonce": "c" * 64, "profile": p, "profileDigest": n.profile_digest(p),
            "environment": {"PYTHON_RUNTIME_HOST": "127.0.0.1", "PYTHON_RUNTIME_PORT": "43111",
                            "PYTHON_RUNTIME_AUTH_TOKEN": "inert-".ljust(40, "x"), "PYTHON_RUNTIME_STARTUP_PROOF": "a" * 64}}


class Control:
    def __init__(self):
        self.current = True; self.charges = []; self.retained = []; self.retain_ok = True
    def assert_current(self): return self.current
    def charge_source_copy(self, amount): self.charges.append(amount); return True
    def retain_source_copy(self, amount): self.retained.append(amount); return self.retain_ok


class Kernel:
    """Bounded in-memory native objects. Unexpected operations fail the test."""
    sid = b"\x01\x02\0\0\0\0\0\x05" + struct.pack("<II", 21, 101)
    def __init__(self):
        self.calls = []; self.handles = {}; self.nodes = {}; self.next = 101; self.allocations = []
        self.opened_names = []
        self.fail = self.after = self.error_after_return = None; self.short_write = False
        self.identity_counter = 1; self.after_write = None
        self.active = 1; self.attributes = {}; self.limits = None
        self.pipe_writes = []; self.pipe_write_facts = []; self.pipe_before_write = None
        self.pipe_closed_failure = False
        self.child_snapshot = None; self.stdin_handle = None; self.child_tables = []
        self.duplicate_access = None
        self.creator_access = None; self.after_create = None
        for name in ("X:\\", "X:\\models", "X:\\models\\selected", "X:\\private", "X:\\private\\training"):
            self.node(name, True)
        for name, data in (("config.json", b"{}"), ("tokenizer.json", b"{}"), ("model.safetensors", b"synthetic-weight")):
            self.node("X:\\models\\selected\\" + name, False, data)
    def node(self, path, directory, data=b"", acl=None):
        value = {"path": path, "directory": directory, "data": bytearray(data), "id": self.identity_counter,
                 "acl": acl, "links": 1, "attributes": 0x10 if directory else 0x80, "tag": 0}
        self.identity_counter += 1; self.nodes[path] = value; return value
    def handle(self, node=None, access=0, inherit=False):
        value = self.next; self.next += 1
        self.handles[value] = {"node": node, "access": access, "inherit": inherit, "offset": 0, "closed": False}
        return value
    def invoke(self, name, args, record):
        self.calls.append((name, args)); value, error = self.result(name, args)
        record.update(value=value, value_returned=True)
        if self.after: self.after(name)
        if name == self.error_after_return: raise RuntimeError("synthetic lost error-reader result")
        return value, error
    def obj(self, number):
        value = self.handles[number]; assert not value["closed"]; return value
    def allowed(self, node, access):
        acl = node["acl"]
        if acl is None: return True
        count, cursor, denial, allowance, owner_rights = struct.unpack_from("<H", acl, 4)[0], 8, 0, 0, False
        for _ in range(count):
            kind, flags, size, mask = struct.unpack_from("<BBHI", acl, cursor); sid = acl[cursor + 8:cursor + size]
            if kind == 1 and sid == n.MODEL_WORLD: denial |= mask
            if kind == 0 and sid == self.sid: allowance |= mask
            if sid == n.MODEL_OWNER_RIGHTS: owner_rights = True
            cursor += size
        # Without OWNER_RIGHTS, Windows gives the owner implicit DAC control.
        requested = access if owner_rights else access & ~(0x20000 | 0x40000)
        return not requested & denial and requested & ~allowance == 0
    def foreign_open_allowed(self, node, access):
        if not self.allowed(node, access): return False
        for h in self.handles.values():
            if h["node"] is node and not h["closed"]:
                if any(access & mask and not h.get("share", 7) & flag for mask, flag in ((1, 1), (6, 2), (0x10000, 4))):
                    return False
        return True
    def result(self, name, a):
        if self.fail == name: return 0, 5
        if name == "GetCurrentProcess": return -1, 0
        if name == "OpenProcessToken": a[2]._obj.value = self.handle(); return 1, 0
        if name == "GetTokenInformation":
            a[4]._obj.value = 16 + len(self.sid)
            if a[2] is None: return 0, 122
            base = C.addressof(a[2]); C.memmove(base + 16, self.sid, len(self.sid)); n.P.from_buffer(a[2]).value = base + 16
            return 1, 0
        if name in ("IsValidSid", "IsValidAcl", "IsValidSecurityDescriptor"): return 1, 0
        if name == "InitializeSecurityDescriptor": a[0]._obj.revision = 1; return 1, 0
        if name == "SetSecurityDescriptorOwner": a[0]._obj.owner = C.cast(a[1], n.P); return 1, 0
        if name == "SetSecurityDescriptorDacl": a[0]._obj.dacl = C.cast(a[2], n.P); return 1, 0
        if name == "SetSecurityDescriptorControl": a[0]._obj.control = 0x1004; return 1, 0
        if name == "GetDriveTypeW": return 3, 0
        if name == "GetVolumeInformationByHandleW": a[6].value = "NTFS"; a[5]._obj.value = 8; return 1, 0
        if name == "NtQueryVolumeInformationFile":
            a[1]._obj.information = C.sizeof(n.NativeVolumeSize)
            a[2]._obj.total, a[2]._obj.available, a[2]._obj.sectors, a[2]._obj.sector_bytes = 1024, 512, 8, 512
            return 0, 0
        if name == "NtCreateFile":
            attrs = a[2]._obj; text = C.wstring_at(attrs.name.contents.buffer, attrs.name.contents.length // 2)
            self.opened_names.append(text)
            path = self.obj(attrs.root)["node"]["path"].rstrip("\\") + "\\" + text if attrs.root else text[4:]
            create, directory = a[7] == 2, bool(a[8] & 1)
            if create:
                if path in self.nodes: return -1073741771, 0
                assert attrs.security
                sd = C.cast(attrs.security, C.POINTER(n.NativeDescriptor)).contents
                acl_size = C.c_uint16.from_address(sd.dacl + 2).value
                node = self.node(path, directory, acl=C.string_at(sd.dacl, acl_size))
                if a[4] is not None: node["allocation"] = a[4]._obj.value
            else:
                if path not in self.nodes: return -1073741772, 0
                node = self.nodes[path]
                if not self.allowed(node, a[1]): return -1073741790, 0
            # Validate real sharing intent in the fixture, including guards.
            for h in self.handles.values():
                if h["closed"] or h["node"] is not node: continue
                old, new = h["access"], a[1]
                for mask, flag in ((1, 1), (6, 2), (0x10000, 4)):
                    if old & mask and not a[6] & flag: raise AssertionError("new share conflicts")
                    if new & mask and not h.get("share", 7) & flag: raise AssertionError("old share conflicts")
            actual_access = a[1] if not create or self.creator_access is None else self.creator_access
            value = self.handle(node, actual_access); self.handles[value]["share"] = a[6]
            a[0]._obj.value = value; a[3]._obj.information = 2 if create else 1
            if create and self.after_create: self.after_create(node)
            return 0, 0
        if name == "GetFileInformationByHandleEx":
            node = self.obj(a[0])["node"]; kind, out = a[1], a[2]._obj
            if kind == 9: out[0], out[1] = node["attributes"], node["tag"]
            elif kind == 18: C.memmove(a[2], struct.pack("<Q", 1) + node["id"].to_bytes(16, "little"), 24)
            elif kind == 1:
                out.size = len(node["data"]); out.allocated = node.get("allocation", (out.size + 4095) // 4096 * 4096)
                out.links = node["links"]; out.directory = node["directory"]
            elif kind == 7:
                size = len(node["data"]); raw = struct.pack("<IIqq", 0, 14, size, node.get("allocation", (size + 4095) // 4096 * 4096)) + "::$DATA".encode("utf-16-le")
                C.memmove(a[2], raw, len(raw))
            elif kind in (19, 20):
                h = self.obj(a[0])
                if kind == 20: h["enumerated"] = False
                if h.get("enumerated"): return 0, 18
                h["enumerated"] = True
                children = [x for p, x in self.nodes.items() if p.rsplit("\\", 1)[0] == node["path"].rstrip("\\")]
                if not children: return 0, 18
                rows = []
                for i, child in enumerate(children):
                    text = child["path"].rsplit("\\", 1)[1].encode("utf-16-le"); size = len(child["data"])
                    length = (88 + len(text) + 7) // 8 * 8
                    row = struct.pack("<II6qIIII16s", 0 if i == len(children) - 1 else length, 0, 0, 0, 0, 0,
                                      size, (size + 4095) // 4096 * 4096, child["attributes"], len(text), 0, child["tag"], child["id"].to_bytes(16, "little")) + text
                    rows.append(row.ljust(length, b"\0"))
                raw = b"".join(rows); C.memmove(a[2], raw, len(raw))
            else: raise AssertionError("unplanned file metadata")
            return 1, 0
        if name == "GetSecurityInfo":
            node = self.obj(a[0])["node"]; acl = node["acl"]; assert acl
            data = C.create_string_buffer(20 + len(acl) + len(self.sid)); base = C.addressof(data)
            C.memmove(base + 20, acl, len(acl)); C.memmove(base + 20 + len(acl), self.sid, len(self.sid))
            self.allocations.append(data); a[3]._obj.value = base + 20 + len(acl); a[5]._obj.value = base + 20; a[7]._obj.value = base
            return 0, 0
        if name == "GetSecurityDescriptorControl": a[1]._obj.value = 0x9004; a[2]._obj.value = 1; return 1, 0
        if name == "GetSecurityDescriptorLength": return next(C.sizeof(b) for b in self.allocations if C.addressof(b) == a[0].value), 0
        if name == "LocalFree":
            data = next(b for b in self.allocations if C.addressof(b) == a[0].value); self.allocations.remove(data); return None, 0
        if name == "NtSetSecurityObject":
            sd = a[2]._obj; size = C.c_uint16.from_address(sd.dacl + 2).value
            self.obj(a[0])["node"]["acl"] = C.string_at(sd.dacl, size); return 0, 0
        if name == "ReadFile":
            h = self.obj(a[0])
            if "pipe" in h and a[0] == self.stdin_handle:
                raw=h["pipe"]["data"][h["offset"]:h["offset"]+a[2]]
                C.memmove(a[1],bytes(raw),len(raw)); a[3]._obj.value=len(raw); h["offset"]+=len(raw); return 1,0
            if h["node"] is None: a[3]._obj.value = 0; return 0, 109
            raw = h["node"]["data"][h["offset"]:h["offset"] + a[2]]
            C.memmove(a[1], bytes(raw), len(raw)); a[3]._obj.value = len(raw); h["offset"] += len(raw); return 1, 0
        if name == "WriteFile":
            h = self.obj(a[0]); size = a[2] - 1 if self.short_write else a[2]
            if "pipe" in h:
                if self.pipe_before_write: self.pipe_before_write(h)
                if self.pipe_closed_failure: a[3]._obj.value = 0; return 0, 109
                self.pipe_write_facts.append((self.handles[h["pipe"]["read"]]["closed"],
                    any(name == "ResumeThread" for name, _ in self.calls), h["inherit"]))
                raw = C.string_at(a[1], size); h["pipe"]["data"].extend(raw); self.pipe_writes.append(raw)
                a[3]._obj.value = size; return 1, 0
            raw = C.string_at(a[1], size); h["node"]["data"].extend(raw); a[3]._obj.value = size
            if self.after_write: self.after_write(h["node"])
            return 1, 0
        if name == "FlushFileBuffers": return 1, 0
        if name == "DuplicateHandle":
            h = self.obj(a[1]); value = self.handle(h["node"], a[4] if self.duplicate_access is None else self.duplicate_access, bool(a[5])); self.handles[value]["share"] = h["share"]
            self.handles[value]["offset"] = h["offset"]
            a[3]._obj.value = value; return 1, 0
        if name == "NtQueryObject": a[2]._obj[1] = self.obj(a[0])["access"]; a[4]._obj.value = C.sizeof(a[2]._obj); return 0, 0
        if name == "GetHandleInformation": a[1]._obj.value = int(self.obj(a[0])["inherit"]); return 1, 0
        if name == "CloseHandle":
            h=self.obj(a[0]); h["closed"]=True
            if "pipe" in h and a[0]==h["pipe"]["write"]: h["pipe"]["writer_open"]=False
            return 1,0
        if name in ("CreateJobObjectW", "CreateFileW"): return self.handle(inherit=name == "CreateFileW"), 0
        if name == "CreatePipe":
            read, write = self.handle(access=0x120089, inherit=True), self.handle(access=0x120116, inherit=True)
            pipe = {"data": bytearray(), "read": read, "write": write, "writer_open": True}
            self.handles[read]["pipe"] = self.handles[write]["pipe"] = pipe
            a[0]._obj.value, a[1]._obj.value = read, write; return 1, 0
        if name == "SetHandleInformation": self.obj(a[0])["inherit"] = bool(a[2]); return 1, 0
        if name == "SetInformationJobObject": self.limits = C.string_at(a[2], a[3]); return 1, 0
        if name == "QueryInformationJobObject":
            if a[1] == 9: C.memmove(a[2], self.limits, len(self.limits))
            else: a[2]._obj.active, a[2]._obj.total = self.active, 1
            return 1, 0
        if name == "InitializeProcThreadAttributeList":
            if a[0] is None: a[3]._obj.value = 128; return 0, 122
            return 1, 0
        if name == "UpdateProcThreadAttribute": self.attributes[a[2]] = tuple(a[3]); return 1, 0
        if name == "CreateProcessW":
            self.child_snapshot={number:dict(self.obj(number)) for number in self.attributes[n.HANDLE_LIST]}
            a[9]._obj.process, a[9]._obj.thread = self.handle(), self.handle()
            a[9]._obj.pid, a[9]._obj.tid = 123, 456; return 1, 0
        if name == "IsProcessInJob": a[2]._obj.value = 1; return 1, 0
        if name == "QueryFullProcessImageNameW": a[2].value = "X:/inert/python.exe"; a[3]._obj.value = len(a[2].value); return 1, 0
        if name == "GetProcessTimes": a[1]._obj.low = 1; return 1, 0
        if name == "ResumeThread": return 1, 0
        if name == "TerminateJobObject":
            self.active=0
            for table in self.child_tables:
                for handle in table.values(): handle["closed"]=True
            return 1,0
        if name == "WaitForSingleObject": return (0 if self.active == 0 else 258), 0
        if name == "DeleteProcThreadAttributeList": return None, 0
        if name == "GetStdHandle": return self.stdin_handle,0
        if name == "GetFileType": return (3 if "pipe" in self.obj(a[0]) else 1),0
        if name == "GetNamedPipeInfo":
            assert "pipe" in self.obj(a[0]); a[1]._obj.value=1; a[2]._obj.value=0; a[3]._obj.value=4096; a[4]._obj.value=1; return 1,0
        if name == "PeekNamedPipe":
            h=self.obj(a[0]); pipe=h["pipe"]
            if not pipe["writer_open"]: return 0,109
            a[4]._obj.value=len(pipe["data"])-h["offset"]; return 1,0
        if name == "SetFilePointerEx": self.obj(a[0])["offset"]=a[1]; a[2]._obj.value=a[1]; return 1,0
        if name == "GetFinalPathNameByHandleW":
            value="\\\\?\\"+self.obj(a[0])["node"]["path"]; a[1].value=value; return len(value),0
        raise AssertionError("Unexpected native operation: " + name)

    def inherited_child(self):
        assert self.child_snapshot is not None
        child=Kernel(); child.nodes=self.nodes; child.handles={number:dict(row) for number,row in self.child_snapshot.items()}
        child.next=10000; child.stdin_handle=self.attributes[n.HANDLE_LIST][0]; self.child_tables.append(child.handles)
        return child


class SourceLaunchExchangeTests(unittest.TestCase):
    def bound_bootstrap(self, definition=None, native_module=n):
        value = boot(); value.update(schema="windows-original-worker-launch-v3", modelSource=descriptor())
        if definition is None: definition={"modelUpdatedAt": value["modelSource"]["modelUpdatedAt"], "request": {"baseModel": {
            "modelRecordId": value["modelSource"]["modelId"], "localPath": value["modelSource"]["logicalPath"]}}}
        value["modelSource"].update(modelId=definition["request"]["baseModel"]["modelRecordId"],
            logicalPath=definition["request"]["baseModel"]["localPath"],modelUpdatedAt=definition["modelUpdatedAt"])
        raw=json.dumps(definition,separators=(",",":"),ensure_ascii=True).encode("ascii")
        value["definitionByteCount"] = len(raw); value["modelSource"]["definitionDigest"] = "sha256:" + hashlib.sha256(raw).hexdigest()
        kernel, control = Kernel(), Control()
        owner = native_module.OriginalWorker(value, kernel=kernel, executable="X:/inert/python.exe", worker_root=_root)
        owner.definition_bytes = raw; owner.bind_model_graph(value["modelSource"], control, control)
        owner.prepare(lambda: True); owner.start_readers(lambda *_: None)
        return owner, kernel, control

    def test_held_bootstrap_write_blocks_retirement_until_actual_original_io_returns(self):
        owner, kernel, control = self.bound_bootstrap(); entered, finish = Event(), Event()
        def hold(_): entered.set(); finish.wait(2)
        kernel.pipe_before_write = hold
        try:
            self.assertEqual(kernel.pipe_writes, []); self.assertFalse(owner.model_bootstrap.attempted)
            owner.resume(); self.assertTrue(entered.wait(1)); owner.request_stop()
            self.assertFalse(owner.observe_retirement()); self.assertEqual(control.retained, [])
            self.assertTrue(any(row["name"] == "WriteFile" for row in owner.pending))
        finally:
            finish.set()
            for thread in owner.readers: thread.join(1)
        self.assertFalse(any(thread.is_alive() for thread in owner.readers))
        self.assertEqual(owner.model_bootstrap.outcome, "cancelled"); self.assertEqual(len(kernel.pipe_writes), 1)
        self.assertTrue(owner.observe_retirement()); self.assertEqual(control.retained, [descriptor()["maximumCopyBytes"]])

    def test_unknown_bootstrap_write_keeps_native_return_slots_and_never_repeats_or_retires(self):
        owner, kernel, control = self.bound_bootstrap(); kernel.error_after_return = "WriteFile"
        owner.resume()
        for thread in owner.readers: thread.join(1)
        self.assertEqual(owner.model_bootstrap.outcome, "unknown"); self.assertTrue(owner.unknown)
        self.assertEqual(len(kernel.pipe_writes), 1)
        pending = [row for row in owner.pending if row["name"] == "WriteFile"]
        self.assertEqual(len(pending), 1); self.assertTrue(pending[0]["value_returned"])
        self.assertGreater(pending[0]["keep"][-1].value, 0)
        owner.request_stop(); self.assertFalse(owner.observe_retirement()); self.assertFalse(owner.observe_retirement())
        self.assertEqual(len(kernel.pipe_writes), 1); self.assertEqual(control.retained, [])

    def test_known_closed_bootstrap_peer_stops_io_and_keeps_original_disk_charge(self):
        owner, kernel, control = self.bound_bootstrap(); kernel.pipe_closed_failure = True
        owner.resume()
        for thread in owner.readers: thread.join(1)
        self.assertEqual(owner.model_bootstrap.outcome, "failed"); self.assertFalse(owner.unknown)
        self.assertEqual(kernel.pipe_writes, []); owner.request_stop(); self.assertTrue(owner.observe_retirement())
        self.assertEqual(control.retained, [descriptor()["maximumCopyBytes"]])

    def test_successful_bootstrap_write_ignores_stale_last_error(self):
        owner, kernel, control = self.bound_bootstrap(); original = owner.invoke
        def stale_success(name, args, record):
            value, error = original(name, args, record)
            return (value, 123) if name == "WriteFile" and value == 1 else (value, error)
        owner.invoke = stale_success
        try:
            owner.resume()
            for thread in owner.readers: thread.join(1)
            self.assertEqual(owner.model_bootstrap.outcome, "written")
            self.assertFalse(owner.unknown); self.assertFalse(owner.pending)
            self.assertEqual(b"".join(kernel.pipe_writes), b"".join(owner.model_bootstrap.segments))
        finally:
            owner.request_stop()
            for thread in owner.readers: thread.join(1)
        self.assertTrue(owner.observe_retirement())
        self.assertEqual(control.retained, [descriptor()["maximumCopyBytes"]])

    def journey(self, refuse=None, bootstrap=False, corrupt_definition=False):
        value = boot(); value["schema"] = "windows-original-worker-launch-v2"; value["modelSource"] = descriptor()
        definition = {"modelUpdatedAt": value["modelSource"]["modelUpdatedAt"], "request": {"baseModel": {
            "modelRecordId": value["modelSource"]["modelId"], "localPath": value["modelSource"]["logicalPath"]}},
            "synthetic": "é" * 9000, "number": 0.0000001}
        definition_raw = json.dumps(definition, ensure_ascii=False, separators=(",", ":")).encode("utf8")
        if bootstrap:
            value["schema"] = "windows-original-worker-launch-v3"; value["definitionByteCount"] = len(definition_raw)
            value["modelSource"]["definitionDigest"] = "sha256:" + hashlib.sha256(definition_raw).hexdigest()
        value["profile"]["observationMs"] = 200; value["profileDigest"] = n.profile_digest(value["profile"])
        lines, frames, owners, inherited_rights = Queue(), [], [], []
        lines.put((json.dumps(value) + "\n").encode())
        kernel = Kernel()
        class EndObservation(BaseException): pass
        class Source:
            def readline(self, maximum): return lines.get(timeout=2)
        class Sink:
            def write(sink, raw):
                frame = json.loads(raw); frames.append(frame)
                if frame["kind"] == "source-request":
                    if frame["phase"] == "create":
                        inherited_rights.extend(kernel.obj(number)["access"] for number in kernel.attributes[n.HANDLE_LIST][3:])
                    if frame["phase"] == refuse:
                        lines.put(b""); return len(raw)
                    if frame["phase"] == "definition":
                        offset = frame["index"] * n.DEFINITION_CHUNK_BYTES
                        part = definition_raw[offset:offset+n.DEFINITION_CHUNK_BYTES]
                        if corrupt_definition: part = bytes([part[0] ^ 1]) + part[1:]
                        lines.put((json.dumps({"schema": "windows-original-model-definition-v1", "nonce": value["nonce"],
                            "profileDigest": value["profileDigest"], "definitionDigest": frame["definitionDigest"],
                            "sequence": frame["sequence"], "phase": "definition", "index": frame["index"],
                            "totalBytes": len(definition_raw), "final": offset + len(part) == len(definition_raw),
                            "data": n.base64.b64encode(part).decode("ascii")}) + "\n").encode())
                        return len(raw)
                    if frame["phase"] == "retain":
                        self.assertTrue(all(h.closed for h in owners[0].model_graph.owned_handles))
                        self.assertEqual(kernel.active, 0)
                        self.assertFalse(any(thread.is_alive() for thread in owners[0].readers))
                    lines.put((json.dumps({"schema": "windows-original-model-ack-v1", "nonce": value["nonce"],
                        "profileDigest": value["profileDigest"], "definitionDigest": frame["definitionDigest"],
                        "sequence": frame["sequence"], "phase": frame["phase"]}) + "\n").encode())
                action = "resume" if frame["kind"] == "suspended" else "stop" if frame["kind"] == "running" else None
                if action: lines.put((json.dumps({"schema": "windows-original-worker-command-v1", "nonce": value["nonce"],
                    "profileDigest": value["profileDigest"], "action": action}) + "\n").encode())
                if frame["kind"] == "retired": lines.put(b"")
                return len(raw)
            def flush(self): pass
        def factory(raw):
            owner = n.OriginalWorker(raw, kernel=kernel, executable="X:/inert/python.exe", worker_root=_root)
            owners.append(owner); return owner
        actual_sleep = n.time.sleep
        def wait(seconds):
            if any(f["kind"] == "uncertain" for f in frames): raise EndObservation()
            actual_sleep(seconds)
        try:
            # Bound serve's retained-uncertainty loop, including unexpected
            # positive-path defects. No retirement or retry is fabricated.
            with patch.object(n.time, "sleep", side_effect=wait):
                if refuse or corrupt_definition:
                    with self.assertRaises(EndObservation): n.serve(Source(), Sink(), owner_factory=factory)
                else: self.assertEqual(n.serve(Source(), Sink(), owner_factory=factory), 0)
        finally: lines.put(b"")
        return frames, owners[0], kernel, inherited_rights

    def test_bootstrap_collects_exact_multichunk_utf8_definition_before_any_native_effect(self):
        frames, owner, kernel, _ = self.journey(bootstrap=True)
        self.assertEqual([f["phase"] for f in frames[:2]], ["definition", "definition"])
        self.assertEqual([f["index"] for f in frames[:2]], [0, 1])
        self.assertEqual("sha256:" + hashlib.sha256(owner.definition_bytes).hexdigest(), owner.boot["modelSource"]["definitionDigest"])
        self.assertEqual(json.loads(owner.definition_bytes)["synthetic"], "é" * 9000)
        self.assertEqual(frames[-1]["kind"], "retired"); self.assertTrue(owner.model_graph.retired)
        self.assertEqual(sum(name == "CreateProcessW" for name, _ in kernel.calls), 1)
        self.assertTrue(kernel.pipe_writes); self.assertTrue(all(len(part) <= n.CHUNK_BYTES for part in kernel.pipe_writes))
        self.assertTrue(all(fact == (True, True, False) for fact in kernel.pipe_write_facts))
        data = b"".join(kernel.pipe_writes); header_size = struct.unpack_from("<I", data)[0]
        header = json.loads(data[4:4+header_size]); length = struct.unpack_from("<I", data, 4+header_size)[0]
        self.assertEqual(length, len(owner.definition_bytes)); self.assertEqual(data[8+header_size:], owner.definition_bytes)
        self.assertEqual(header["nonce"], owner.boot["nonce"]); self.assertEqual(len(header["files"]), 3)
        self.assertEqual(header["root"]["handle"], kernel.attributes[n.HANDLE_LIST][-1])
        self.assertNotIn(owner.model_bootstrap.handle.slot.value, kernel.attributes[n.HANDLE_LIST])
        self.assertEqual(owner.model_bootstrap.outcome, "written")
        self.assertFalse(owner.model_bootstrap.thread.is_alive())

    def test_changed_bootstrap_definition_never_reaches_native_acquisition_or_dispatch(self):
        frames, owner, kernel, _ = self.journey(bootstrap=True, corrupt_definition=True)
        self.assertTrue(owner.unknown); self.assertEqual(kernel.calls, []); self.assertIsNone(owner.definition_bytes)
        self.assertFalse(owner.model_graph.charged); self.assertNotIn("retired", [f["kind"] for f in frames])

    def test_owned_stdio_binds_actual_copy_seal_inheritance_and_retained_accounting(self):
        frames, owner, kernel, inherited_rights = self.journey()
        phases = [f["phase"] for f in frames if f["kind"] == "source-request"]
        self.assertEqual(phases, ["charge", "allocate", "copy", "copy", "copy", "seal", "create", "dispatch", "retain"])
        self.assertEqual([f["sequence"] for f in frames if f["kind"] == "source-request"], list(range(1, 10)))
        self.assertEqual(frames[-1]["kind"], "retired"); self.assertTrue(owner.model_graph.retired)
        self.assertTrue(all(h.closed for h in owner.handles))
        self.assertIn(owner.model_graph.physical_path, kernel.nodes)
        self.assertEqual(inherited_rights, [0x120089, 0x120089, 0x120089, 0x1200a1])
        self.assertTrue(all(not access & n.MODEL_WRITE_DENIAL for access in inherited_rights))
        for row in descriptor()["files"]:
            copied = kernel.nodes[owner.model_graph.physical_path + "\\" + row["name"]]
            self.assertEqual(hashlib.sha256(copied["data"]).hexdigest(), row["sha256"])
            self.assertEqual(copied["acl"], n.model_acl(kernel.sid, sealed=True))
        self.assertEqual(sum(name == "CreateProcessW" for name, _ in kernel.calls), 1)
        self.assertEqual(sum(name == "ResumeThread" for name, _ in kernel.calls), 1)

    def test_lost_stage_ack_keeps_source_custody_and_never_claims_zero_effect_or_retirement(self):
        for phase in ("charge", "allocate", "copy", "create", "dispatch", "retain"):
            with self.subTest(phase=phase):
                frames, owner, kernel, _ = self.journey(phase)
                self.assertNotIn("retired", [f["kind"] for f in frames]); self.assertTrue(owner.unknown)
                self.assertFalse(owner.model_graph.retired)
                self.assertEqual(sum(f.get("phase") == phase for f in frames), 1)
                if phase == "charge": self.assertEqual(kernel.calls, [])
                if phase in ("charge", "allocate", "copy", "create"):
                    self.assertFalse(any(name == "CreateProcessW" for name, _ in kernel.calls))
                if phase == "dispatch": self.assertFalse(any(name == "ResumeThread" for name, _ in kernel.calls))
                if phase == "retain": self.assertTrue(all(h.closed for h in owner.model_graph.owned_handles))

    def test_foreign_preloaded_or_changed_ack_cannot_authorize_an_original_source_stage(self):
        for mode in ("preloaded", "sequence", "phase", "definition", "missing"):
            owner = n.OriginalWorker({**boot(), "schema": "windows-original-worker-launch-v2", "modelSource": descriptor()}, kernel=Kernel())
            replies, ended, overflow, stopped = Queue(maxsize=1), Event(), Event(), Event()
            expected = {"sequence": 1, "phase": "charge", "definitionDigest": descriptor()["definitionDigest"]}
            if mode == "preloaded": replies.put(expected)
            def frame(kind, **fields):
                row = dict(expected)
                if mode == "sequence": row["sequence"] = 2
                if mode == "phase": row["phase"] = "retain"
                if mode == "definition": row["definitionDigest"] = "sha256:" + "f" * 64
                if mode not in ("preloaded", "missing"): replies.put(row)
            exchange = n.OriginalSourceExchange(owner, frame, replies, ended, overflow, stopped)
            with self.subTest(mode=mode), self.assertRaises(n.LaunchUnavailable): exchange.charge_source_copy(16384)
            self.assertEqual(owner.kernel.calls, [])


@contextmanager
def borrowed_model_view(definition,sealed_request,native_module=n):
    """Actual source/receiver/view code, exclusively in-memory Native replies."""
    owner,kernel,control=SourceLaunchExchangeTests().bound_bootstrap(definition,native_module)
    try:
        owner.resume()
        for thread in owner.readers: thread.join(1)
        if owner.model_bootstrap.outcome!="written": raise AssertionError("Inert original bootstrap writer did not finish")
        child=kernel.inherited_child()
        receiver=native_module.OriginalModelBootstrapReceiver(owner.boot["nonce"],kernel=child)
        lease=receiver.bind(definition)
        with lease.borrow(sealed_request) as view: yield view,owner.model_graph.physical_path
    finally:
        owner.request_stop()
        for thread in owner.readers: thread.join(1)
        if not owner.observe_retirement() or control.retained!=[descriptor()["maximumCopyBytes"]]:
            raise AssertionError("Inert original Model custody did not retire with retained charge")


class TrainingInputCopyTests(unittest.TestCase):
    def fixture(self, media="application/x-ndjson", count=1, native_module=n, method="lora"):
        value = json.loads((Path(__file__).parent/"fixtures/approved_training_staged_input.json").read_text())
        request = value["approvedRequest"]; request["baseModel"]["localPath"] = descriptor()["logicalPath"]
        request["method"] = method
        fmt = n._TRAINING_INPUT_MEDIA[media]
        content, recipe = b'{"instruction":"Say yes","output":"yes"}\n', b'{"synthetic":true}'
        digest = lambda raw: "sha256:"+hashlib.sha256(raw).hexdigest()
        request["datasets"] = [{"artifactId":"input-"+str(i),"splitRole":"train" if i==0 else "validation","format":fmt} for i in range(count)]
        definition = {"requestId":"11111111-1111-4111-8111-111111111111","workspaceId":request["workspaceId"],
            "owner":{"organizationId":"synthetic-org","principalId":"synthetic-actor",
                "clientId":"22222222-2222-4222-8222-222222222222","hostIncarnationId":"33333333-3333-4333-8333-333333333333"},
            "proposalDigest":"sha256:"+"e"*64,
            "request":request,"modelUpdatedAt":descriptor()["modelUpdatedAt"],
            "inputs":[{"artifactId":row["artifactId"],"role":row["splitRole"],"mediaType":media,"digest":digest(content),"sizeBytes":len(content)} for row in request["datasets"]],
            "dataset":{"datasetId":"synthetic-data","versionId":"synthetic-version","versionDigest":"sha256:"+"d"*64,"recipeDigest":digest(recipe)},
            "recipeSizeBytes":len(recipe)}
        owner,parent,model_control=SourceLaunchExchangeTests().bound_bootstrap(definition,native_module)
        owner.resume()
        for thread in owner.readers: thread.join(1)
        self.assertEqual(owner.model_bootstrap.outcome,"written")
        child=parent.inherited_child(); source=native_module.OriginalModelBootstrapReceiver(owner.boot["nonce"],kernel=child)
        lease=source.bind(definition)
        for path in ("X:\\inputs","X:\\inputs\\batch","X:\\private\\inputs"):
            child.node(path,True)
        staged={"payload":copy.deepcopy(request),"recipe":{"path":"X:\\inputs\\batch\\approved-recipe.json","digest":digest(recipe),"sizeBytes":len(recipe)},
            "outputDirectory":"X:\\outputs\\candidate"}
        staged["payload"]["output"]["outputDirectory"]=staged["outputDirectory"]
        for index,row in enumerate(staged["payload"]["datasets"]):
            row["path"]="X:\\inputs\\batch\\"+str(index+1).zfill(4)+"-input-"+str(index)+"."+fmt
            child.node(row["path"],False,content)
        child.node(staged["recipe"]["path"],False,recipe)
        config={"freshParent":"X:\\private\\inputs","freshName":"original-input-copy", "maximumCopyBytes":128*1024,
            "bufferBytes":4096,"preparationMs":30000}
        control=Control()
        def finish_model_only():
            owner.request_stop()
            for thread in owner.readers: thread.join(1)
            self.assertTrue(owner.observe_retirement())
            self.assertEqual(model_control.retained,[descriptor()["maximumCopyBytes"]])
        self.addCleanup(finish_model_only)
        return source,lease,staged,config,control,child,content,recipe

    def test_actual_input_copy_is_complete_hashed_readonly_and_keeps_original_accounting(self):
        source,lease,staged,config,control,kernel,content,recipe=self.fixture()
        before=copy.deepcopy(staged); calls=len(kernel.calls)
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        self.assertEqual(len(kernel.calls),calls); self.assertEqual(control.charges,[])
        graph.prepare(); graph.assert_sealed()
        self.assertEqual(staged,before); self.assertEqual(graph.descriptor["definitionDigest"],source.descriptor["definitionDigest"])
        self.assertEqual([r["name"] for r in graph.records],["0001-input-0.jsonl","approved-recipe.json"])
        self.assertEqual(control.charges,[config["maximumCopyBytes"]]); self.assertEqual(control.retained,[])
        for row,raw,handle in zip(graph.records,(content,recipe),graph.guards):
            node=kernel.nodes[graph.physical_path+"\\"+row["name"]]
            self.assertEqual(bytes(node["data"]),raw); self.assertEqual(node["acl"],n.model_acl(kernel.sid,sealed=True))
            self.assertEqual(kernel.obj(graph.owner.number(handle))["access"],0x120089)
        self.assertEqual(kernel.obj(graph.owner.number(graph.guards[-1]))["access"],0x1200a1)
        self.assertTrue(graph.retire_copy_io()); self.assertTrue(graph.retire_copy_io())
        self.assertTrue(all(h.closed for h in graph.owned_handles)); self.assertEqual(control.retained,[config["maximumCopyBytes"]])
        self.assertIn(graph.physical_path,kernel.nodes)  # Neither deletion nor disk credit.
        self.assertEqual(source.phase,"bound"); self.assertFalse(hasattr(graph,"settle"))
        with self.assertRaises(n.LaunchUnavailable): n.OriginalTrainingInputGraph(lease,staged,config,control,control)

    def test_actual_request_thread_can_copy_and_a_later_thread_can_close_copy_io(self):
        source,lease,staged,config,control,kernel,_,_=self.fixture()
        original_thread=source.owner.thread; outcomes=[]; graphs=[]
        def copy_inputs():
            try:
                graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control); graphs.append(graph)
                graph.prepare(); graph.assert_sealed(); outcomes.append("sealed")
            except BaseException as error: outcomes.append(type(error).__name__)
        worker=Thread(target=copy_inputs); worker.start(); worker.join(3)
        self.assertFalse(worker.is_alive()); self.assertEqual(outcomes,["sealed"])
        self.assertEqual(source.owner.thread,original_thread); self.assertFalse(source.owner.pending)
        def close_inputs():
            try: outcomes.append(graphs[0].retire_copy_io())
            except BaseException as error: outcomes.append(type(error).__name__)
        closer=Thread(target=close_inputs); closer.start(); closer.join(3)
        self.assertFalse(closer.is_alive()); self.assertEqual(outcomes,["sealed",True])
        self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_business_callback_cannot_borrow_the_model_during_input_admission(self):
        source,lease,staged,config,control,kernel,_,_=self.fixture()
        holder={"attempted":False,"entered":False}
        class Admission:
            def assert_current(self):
                if not holder["attempted"]:
                    holder["attempted"]=True; holder["context"]=lease.borrow(source.definition["request"])
                    try: holder["view"]=holder["context"].__enter__(); holder["entered"]=True
                    except n.LaunchUnavailable: pass
                return True
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,Admission())
        try:
            try: graph.prepare()
            except n.LaunchUnavailable: pass
            self.assertFalse(holder["entered"] and bool(control.charges))
            self.assertFalse(holder["entered"])
        finally:
            if holder["entered"]: holder["context"].__exit__(None,None,None)
            graph.retire_copy_io()

    def test_model_only_borrow_remains_unavailable_after_an_input_owner_is_bound(self):
        source,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        for phase in ("bound","io-closed"):
            with self.subTest(phase=phase):
                with self.assertRaises(n.LaunchUnavailable):
                    with lease.borrow(source.definition["request"]): self.fail("No combined input/loader view is implemented yet")
            if phase=="bound": self.assertTrue(graph.retire_copy_io())

    def test_held_source_read_refuses_borrow_and_copy_close_without_waiting_or_effects(self):
        source,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        entered,finish,borrow_done=Event(),Event(),Event(); outcomes=[]; held=[False]
        def hold(name):
            if name=="PeekNamedPipe" and not held[0]:
                held[0]=True; entered.set(); finish.wait(3)
        kernel.after=hold
        def prepare():
            try: graph.prepare(); outcomes.append("sealed")
            except BaseException as error: outcomes.append(type(error).__name__)
        def borrow():
            try:
                with lease.borrow(source.definition["request"]): outcomes.append("unexpected-borrow")
            except n.LaunchUnavailable: outcomes.append("borrow-denied")
            finally: borrow_done.set()
        copier=Thread(target=prepare); borrower=Thread(target=borrow)
        try:
            copier.start(); self.assertTrue(entered.wait(1)); before=len(kernel.calls)
            self.assertTrue(source.owner.pending)
            borrower.start(); self.assertTrue(borrow_done.wait(1))
            self.assertFalse(graph.retire_copy_io()); self.assertEqual(len(kernel.calls),before)
        finally:
            finish.set(); copier.join(3)
            if borrower.ident is not None: borrower.join(3)
        self.assertFalse(copier.is_alive()); self.assertFalse(borrower.is_alive())
        self.assertCountEqual(outcomes,["sealed","borrow-denied"])
        self.assertFalse(source.owner.pending); self.assertFalse(graph.owner.pending)
        self.assertIsNone(n._model_leases[lease].get("input_source_read_active"))
        self.assertIsNone(n._model_leases[lease].get("input_copy_io_active"))
        self.assertTrue(graph.retire_copy_io())

    def test_unknown_source_read_keeps_original_thread_flight_and_return_slots(self):
        source,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        kernel.error_after_return="PeekNamedPipe"; outcomes=[]
        def prepare():
            try: graph.prepare(); outcomes.append("unexpected-seal")
            except n.LaunchUnavailable: outcomes.append("denied")
        worker=Thread(target=prepare); worker.start(); worker.join(3)
        self.assertFalse(worker.is_alive()); self.assertEqual(outcomes,["denied"])
        self.assertTrue(source.owner.unknown); self.assertTrue(source.owner.pending)
        self.assertEqual(source.owner.thread,worker.ident)
        self.assertIsNotNone(n._model_leases[lease].get("input_source_read_active"))
        self.assertTrue(source.owner.pending[-1]["value_returned"])
        self.assertEqual(control.charges,[]); before=len(kernel.calls)
        self.assertFalse(graph.retire_copy_io()); self.assertFalse(graph.retire_copy_io())
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        with self.assertRaises(n.LaunchUnavailable):
            with lease.borrow(source.definition["request"]): self.fail("Unknown original read cannot be borrowed")
        self.assertEqual(len(kernel.calls),before)
        kernel.error_after_return=None

    def test_all_supported_media_and_maximum_input_count_use_the_same_real_copy(self):
        for media in n._TRAINING_INPUT_MEDIA:
            with self.subTest(media=media):
                _,lease,staged,config,control,kernel,_,_=self.fixture(media,16)
                graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control); graph.prepare(); graph.assert_sealed()
                self.assertEqual(len(graph.records),17); self.assertTrue(graph.retire_copy_io())
                self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_foreign_lease_or_changed_closed_metadata_denies_before_any_io_or_charge(self):
        for kind in ("foreign","method","role","format","recipe","recipe-size","extra","directory","extension","alias","output","capacity","boolean","media-shape"):
            with self.subTest(kind=kind):
                _,lease,staged,config,control,kernel,_,_=self.fixture()
                if kind=="foreign": lease=object()
                elif kind=="method": staged["payload"]["method"]="full"
                elif kind=="role": staged["payload"]["datasets"][0]["splitRole"]="validation"
                elif kind=="format": staged["payload"]["datasets"][0]["format"]="csv"
                elif kind=="recipe": staged["recipe"]["digest"]="sha256:"+"a"*64
                elif kind=="recipe-size": staged["recipe"]["sizeBytes"]=True
                elif kind=="extra": staged["nativeReady"]=True
                elif kind=="directory": staged["payload"]["datasets"][0]["path"]="X:\\other\\row.jsonl"
                elif kind=="extension": staged["payload"]["datasets"][0]["path"]="X:\\inputs\\batch\\row.py"
                elif kind=="alias": config["freshName"]="CON.txt"
                elif kind=="output": staged["outputDirectory"]="X:\\outputs\\other"
                elif kind=="capacity": config["maximumCopyBytes"]=1
                elif kind=="boolean": config["bufferBytes"]=True
                elif kind=="media-shape": staged["payload"]["datasets"][0]["format"]={}
                calls=len(kernel.calls)
                with self.assertRaises(n.LaunchUnavailable): n.OriginalTrainingInputGraph(lease,staged,config,control,control)
                self.assertEqual(len(kernel.calls),calls); self.assertEqual(control.charges,[])

    def test_extra_source_entry_changed_bytes_links_and_reparse_points_never_seal(self):
        for kind in ("extra","bytes","link","reparse"):
            with self.subTest(kind=kind):
                _,lease,staged,config,control,kernel,_,_=self.fixture()
                row=kernel.nodes[staged["payload"]["datasets"][0]["path"]]
                if kind=="extra": kernel.node("X:\\inputs\\batch\\extra.py",False,b"untrusted")
                elif kind=="bytes": row["data"][0]=ord("!")
                elif kind=="link": row["links"]=2
                else: row["attributes"]|=0x400
                graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
                with self.assertRaises(n.LaunchUnavailable): graph.prepare()
                self.assertNotEqual(graph.phase,"sealed"); self.assertTrue(graph.retire_copy_io())
                self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_allocated_copy_limit_is_checked_before_destination_creation(self):
        _,lease,staged,config,control,kernel,_,_=self.fixture(); config["maximumCopyBytes"]=8000
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control); offset=len(kernel.calls)
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertNotIn(graph.physical_path,kernel.nodes)
        self.assertFalse(any(name=="WriteFile" for name,_ in kernel.calls[offset:]))
        self.assertTrue(graph.retire_copy_io()); self.assertEqual(control.retained,[8000])

    def test_destination_readback_detects_same_size_tampering(self):
        _,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        kernel.after_write=lambda node: node["data"].__setitem__(0,ord("!"))
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertEqual(graph.phase,"failed"); self.assertTrue(graph.retire_copy_io())
        self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_lost_charge_acknowledgement_does_not_release_or_retry_reservation(self):
        _,lease,staged,config,control,kernel,_,_=self.fixture()
        def charge(amount):
            control.charges.append(amount)
            raise RuntimeError("Synthetic lost reservation acknowledgement")
        control.charge_source_copy=charge
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertTrue(graph.charge_attempted); self.assertFalse(graph.charged)
        self.assertFalse(graph.retire_copy_io()); self.assertFalse(graph.retire_copy_io())
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertEqual(control.charges,[config["maximumCopyBytes"]]); self.assertEqual(control.retained,[])
        self.assertNotIn(graph.physical_path,kernel.nodes)

    def test_input_manifest_cannot_select_the_model_or_launch_protocol(self):
        _,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        before=len(kernel.calls)
        value={**boot(),"schema":"windows-original-worker-launch-v2","modelSource":graph.descriptor}
        with self.assertRaises(n.LaunchUnavailable): n.capture_boot(value)
        original=n.OriginalWorker(boot(),kernel=kernel)
        with self.assertRaises(n.LaunchUnavailable): n.OriginalModelGraph(original,graph.descriptor,control,control)
        self.assertEqual(len(kernel.calls),before); self.assertEqual(control.charges,[])

    def test_admission_loss_is_sticky_and_accounting_survives_withdrawal(self):
        _,lease,staged,config,control,kernel,_,_=self.fixture()
        graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
        kernel.after=lambda name: setattr(control,"current",False) if name=="WriteFile" else None
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        writes=sum(name=="WriteFile" for name,_ in kernel.calls)
        control.current=True
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertEqual(sum(name=="WriteFile" for name,_ in kernel.calls),writes)
        control.current=False
        self.assertTrue(graph.retire_copy_io()); self.assertEqual(control.retained,[config["maximumCopyBytes"]])

    def test_unknown_original_api_or_close_retains_slots_without_repeating_effects(self):
        for kind in ("NtCreateFile","CloseHandle"):
            with self.subTest(kind=kind):
                _,lease,staged,config,control,kernel,_,_=self.fixture()
                graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
                if kind=="CloseHandle": graph.prepare()
                kernel.error_after_return=kind
                if kind=="NtCreateFile":
                    with self.assertRaises(n.LaunchUnavailable): graph.prepare()
                else: self.assertFalse(graph.retire_copy_io())
                self.assertTrue(graph.owner.unknown); self.assertTrue(graph.owner.pending)
                count=len(kernel.calls)
                self.assertFalse(graph.retire_copy_io()); self.assertFalse(graph.retire_copy_io())
                self.assertEqual(len(kernel.calls),count); self.assertEqual(control.retained,[])
                kernel.error_after_return=None

    def test_model_custody_or_business_permission_loss_denies_before_input_charge(self):
        for kind in ("peer","permission","entered"):
            with self.subTest(kind=kind):
                source,lease,staged,config,control,kernel,_,_=self.fixture()
                graph=n.OriginalTrainingInputGraph(lease,staged,config,control,control)
                if kind=="peer": kernel.obj(source.owner.number(source.pipe))["pipe"]["writer_open"]=False
                elif kind=="permission": control.current=False
                else: n._model_leases[lease]["entered"]=True
                with self.assertRaises(n.LaunchUnavailable): graph.prepare()
                self.assertEqual(control.charges,[]); self.assertNotIn(graph.physical_path,kernel.nodes)


class CombinedTrainingInputViewTests(unittest.TestCase):
    def fixture(self, prepare=True, method="lora"):
        from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest
        from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as actual
        case=TrainingInputCopyTests()
        source,lease,staged,config,control,kernel,*_=case.fixture(count=2,native_module=actual,method=method)
        self.addCleanup(case.doCleanups)
        graph=actual.OriginalTrainingInputGraph(lease,staged,config,control,control)
        if prepare: graph.prepare()
        request=TrainModelTaskRequest.model_validate(staged["payload"]).model_dump(mode="json")
        return actual,source,lease,graph,request,staged,control,kernel

    def test_actual_joint_view_uses_protected_inputs_and_preserves_normalized_request(self):
        actual,source,lease,graph,request,staged,control,kernel=self.fixture()
        expected=copy.deepcopy(request); original=copy.deepcopy(staged); source_thread=source.owner.thread; result=[]
        def run():
            try:
                with lease.borrow(request) as view:
                    model,inputs=actual.resolve_original_training_references(view,request)
                    result.append((model,inputs)); self.assertEqual(actual.resolve_original_model_view(view,request),model)
                    self.assertFalse(graph.retire_copy_io()); self.assertTrue(all(not h.closed for h in graph.guards))
                with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            except BaseException as error: result.append(type(error).__name__)
        worker=Thread(target=run); worker.start(); worker.join(3)
        self.assertFalse(worker.is_alive()); self.assertEqual(len(result),1)
        self.assertEqual(result[0],(source.physical_path,tuple(graph.physical_path+"\\"+row["name"] for row in graph.records[:-1])))
        self.assertNotEqual(source.owner.thread,source_thread); self.assertEqual(request,expected); self.assertEqual(staged,original)
        self.assertEqual(source.phase,"spent"); self.assertFalse(graph.retire_copy_io()); self.assertEqual(control.retained,[])
        self.assertEqual(control.charges,[graph.descriptor["maximumCopyBytes"]])

    def test_partial_retired_forged_or_changed_inputs_never_mint_a_view(self):
        for mode in ("partial","retired","forged","changed","scalar-kind"):
            with self.subTest(mode=mode):
                actual,source,lease,graph,request,staged,control,kernel=self.fixture(prepare=mode!="partial")
                if mode=="retired": self.assertTrue(graph.retire_copy_io())
                elif mode=="forged": actual._model_leases[lease]["input_copy_owner"]=object()
                elif mode=="changed": request["datasets"][0]["path"]="X:\\other\\substituted.jsonl"
                elif mode=="scalar-kind": request["commonParameters"]["maxSteps"]=True
                before=len(kernel.calls)
                with self.assertRaises(actual.LaunchUnavailable):
                    with lease.borrow(request): self.fail("Invalid input binding reached a live view")
                self.assertEqual(len(kernel.calls),before); self.assertEqual(source.phase,"bound")
                if mode!="forged": graph.retire_copy_io()

    def test_currentness_loss_stays_lost_and_cross_thread_reads_do_not_touch_native(self):
        actual,source,lease,graph,request,staged,control,kernel=self.fixture()
        with lease.borrow(request) as view:
            outcomes=[]; before=len(kernel.calls)
            def foreign():
                try: actual.resolve_original_training_references(view,request); outcomes.append("unexpected")
                except actual.LaunchUnavailable: outcomes.append("denied")
            other=Thread(target=foreign); other.start(); other.join(2)
            self.assertEqual(outcomes,["denied"]); self.assertEqual(len(kernel.calls),before)
            control.current=False
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            control.current=True; before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            self.assertEqual(len(kernel.calls),before); self.assertFalse(graph.retire_copy_io())

    def test_unknown_input_inspection_retains_original_slots_and_denies_more_calls(self):
        actual,source,lease,graph,request,staged,control,kernel=self.fixture()
        with lease.borrow(request) as view:
            original=graph.owner.invoke
            def lost(name,args,row):
                result=original(name,args,row)
                if name=="GetFileInformationByHandleEx": raise RuntimeError("Synthetic lost input inspection return")
                return result
            graph.owner.invoke=lost
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            self.assertTrue(graph.owner.unknown); self.assertTrue(graph.owner.pending)
            self.assertTrue(graph.owner.pending[-1]["value_returned"]); before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            self.assertFalse(graph.retire_copy_io()); self.assertEqual(len(kernel.calls),before)
        self.assertEqual(control.retained,[])

    def test_fixed_schema_cannot_drop_unknown_or_coerce_invalid_supplied_values(self):
        actual,source,lease,graph,request,staged,control,kernel=self.fixture(prepare=False)
        for mode in ("workspace","top","model","dataset","typed-value"):
            with self.subTest(mode=mode):
                raw=copy.deepcopy(staged)
                if mode=="workspace": raw["payload"]["workspaceId"]="other-workspace"
                elif mode=="top": raw["payload"]["privateOverride"]="unapproved"
                elif mode=="model": raw["payload"]["baseModel"]["nativeReady"]=True
                elif mode=="dataset": raw["payload"]["datasets"][0]["unchecked"]=True
                else: raw["payload"]["trainingTask"]=True
                before=len(kernel.calls)
                with self.assertRaises(actual.LaunchUnavailable): actual._capture_input_loader_request(source.definition,raw)
                self.assertEqual(len(kernel.calls),before); self.assertEqual(control.charges,[])
        self.assertTrue(graph.retire_copy_io())

    def test_observed_model_protection_loss_cannot_revive_the_same_joint_view(self):
        actual,source,lease,graph,request,staged,control,kernel=self.fixture()
        with lease.borrow(request) as view:
            root=kernel.nodes[source.physical_path]; sealed=root["acl"]
            root["acl"]=actual.model_acl(kernel.sid,sealed=False)
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            root["acl"]=sealed; before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable): actual.resolve_original_training_references(view,request)
            self.assertEqual(len(kernel.calls),before)
            self.assertTrue(all(not handle.closed for handle in graph.guards)); self.assertEqual(control.retained,[])


class TrainingOutputCustodyTests(unittest.TestCase):
    def fixture(self, method="lora"):
        case=CombinedTrainingInputViewTests()
        actual,source,lease,inputs,request,staged,input_control,kernel=case.fixture(method=method)
        self.addCleanup(case.doCleanups)
        kernel.node("X:\\private\\outputs", True)
        config={"freshParent":"X:\\private\\outputs","freshName":"candidate-output",
            "maximumCopyBytes":128*1024,"bufferBytes":4096,"preparationMs":30000}
        contents={"tokenizer.json":b'{"synthetic":true}'}
        if method == "full-finetune": contents.update({"config.json":b'{}',"model.safetensors":b"synthetic-weight-container"})
        else: contents.update({"adapter_config.json":b'{}',"adapter_model.safetensors":b"synthetic-adapter-container"})
        files=[{"name":name,"sizeBytes":len(raw)} for name,raw in contents.items()]
        return actual,source,lease,inputs,request,input_control,kernel,config,contents,files,Control()

    def test_actual_native_stream_seals_all_finite_profiles_without_changing_logical_request(self):
        for method in ("lora","qlora","full-finetune"):
            with self.subTest(method=method):
                actual,source,lease,inputs,request,_,kernel,config,contents,files,control=self.fixture(method)
                expected=copy.deepcopy(request)
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    original_files=copy.deepcopy(files); files[0]["sizeBytes"]=999; config["maximumCopyBytes"]=1
                    graph.prepare({name:(raw[:1],raw[1:]) for name,raw in contents.items()}); graph.assert_sealed()
                    self.assertEqual(graph.phase,"sealed"); self.assertEqual(request,expected)
                    self.assertEqual(control.charges,[128*1024]); self.assertEqual(control.retained,[])
                    self.assertEqual(graph.descriptor["files"],tuple(original_files))
                    for row,handle in zip(graph.records,graph.guards):
                        raw=contents[row["name"]]; node=kernel.nodes[graph.physical_path+"\\"+row["name"]]
                        self.assertEqual(bytes(node["data"]),raw); self.assertEqual(row["sha256"],hashlib.sha256(raw).hexdigest())
                        self.assertEqual(node["acl"],actual.model_acl(kernel.sid,sealed=True)); self.assertFalse(handle.closed)
                        self.assertFalse(kernel.foreign_open_allowed(node,2))
                    with self.assertRaises(actual.LaunchUnavailable):
                        actual.OriginalTrainingOutputGraph(view,request,config,original_files,Control(),Control())
                before=len(kernel.calls)
                with self.assertRaises(actual.LaunchUnavailable): graph.assert_sealed()
                self.assertEqual(len(kernel.calls),before); self.assertEqual(graph.phase,"failed")
                self.assertTrue(all(not h.closed for h in graph.guards)); self.assertEqual(control.retained,[])

    def test_forged_changed_expired_and_model_only_views_cannot_bind_output(self):
        for mode in ("forged","changed","expired","model-only"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                if mode=="model-only":
                    case=InheritedModelViewTests(); owner,parent,child=case.fixture(); self.addCleanup(case.doCleanups)
                    # That independent fixture uses the same actual protocol but
                    # no protected input graph, so the real joint-view test below
                    # must refuse before any output charge.
                    actual=n; source=n.OriginalModelBootstrapReceiver(owner.boot["nonce"],kernel=child)
                    definition=json.loads(owner.definition_bytes); lease=source.bind(definition)
                    request=copy.deepcopy(definition["request"])
                with lease.borrow(request) as view:
                    if mode=="forged": candidate=object()
                    else: candidate=view
                    changed=copy.deepcopy(request)
                    if mode=="changed": changed["commonParameters"]["maxSteps"]=999
                    if mode=="expired": continue
                    with self.assertRaises(actual.LaunchUnavailable):
                        actual.OriginalTrainingOutputGraph(candidate,changed,config,files,control,control)
                    self.assertEqual(control.charges,[])
                if mode=="expired":
                    with self.assertRaises(actual.LaunchUnavailable):
                        actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    self.assertEqual(control.charges,[])

    def test_manifest_refuses_executable_paths_ambiguous_names_sizes_and_wrong_profile(self):
        for mode in ("path","pickle","case","duplicate","bool","zero","oversize","missing","profile","extra-key"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                if mode=="path": files[0]["name"]="..\\tokenizer.json"
                elif mode=="pickle": files.append({"name":"pytorch_model.bin","sizeBytes":1})
                elif mode=="case": files[0]["name"]="Tokenizer.json"
                elif mode=="duplicate": files.append(dict(files[0]))
                elif mode=="bool": files[0]["sizeBytes"]=True
                elif mode=="zero": files[0]["sizeBytes"]=0
                elif mode=="oversize": files[0]["sizeBytes"]=config["maximumCopyBytes"]+1
                elif mode=="missing": files=files[1:]
                elif mode=="profile": files.append({"name":"model.safetensors","sizeBytes":1})
                else: files[0]["path"]="X:\\foreign"
                with lease.borrow(request) as view:
                    with self.assertRaises(actual.LaunchUnavailable): actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    self.assertEqual(control.charges,[]); self.assertNotIn(config["freshParent"]+"\\"+config["freshName"],kernel.nodes)

    def test_bad_streams_never_seal_retry_or_refund(self):
        for mode in ("short","extra","empty","wrong-type","large","exception","missing-file"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    streams={name:(raw,) for name,raw in contents.items()}; first=files[0]["name"]; raw=contents[first]
                    if mode=="short": streams[first]=(raw[:-1],)
                    elif mode=="extra": streams[first]=(raw,b"!")
                    elif mode=="empty": streams[first]=(b"",raw)
                    elif mode=="wrong-type": streams[first]=(bytearray(raw),)
                    elif mode=="large": streams[first]=(b"x"*4097,)
                    elif mode=="missing-file": streams.pop(first)
                    else:
                        def broken(): yield raw; raise RuntimeError("synthetic stream failure")
                        streams[first]=broken()
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
                    self.assertEqual(graph.phase,"failed"); before=len(kernel.calls)
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare({name:(raw,) for name,raw in contents.items()})
                    self.assertEqual(len(kernel.calls),before); self.assertEqual(control.retained,[])
                    self.assertFalse(graph.retired)

    def test_allocation_rounding_and_existing_destination_refuse_before_file_writes(self):
        for mode in ("rounding","existing"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                if mode=="rounding": config["maximumCopyBytes"]=8192
                else: kernel.node(config["freshParent"]+"\\"+config["freshName"],True)
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    before=sum(name=="WriteFile" for name,_ in kernel.calls)
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare({name:(raw,) for name,raw in contents.items()})
                    self.assertEqual(sum(name=="WriteFile" for name,_ in kernel.calls),before)
                    self.assertEqual(control.charges,[config["maximumCopyBytes"]]); self.assertEqual(control.retained,[])

    def test_currentness_rechecked_after_reservation_and_stream_callbacks(self):
        for mode in ("reservation","iter","next","eof"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                with lease.borrow(request) as view:
                    if mode=="reservation":
                        def charged(amount): control.charges.append(amount); control.current=False; return True
                        control.charge_source_copy=charged
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    streams={name:(raw,) for name,raw in contents.items()}; first=files[0]["name"]; raw=contents[first]
                    if mode!="reservation":
                        class Stream:
                            def __iter__(self):
                                if mode=="iter": control.current=False
                                self.returned=False; return self
                            def __next__(self):
                                if not self.returned:
                                    self.returned=True
                                    if mode=="next": control.current=False
                                    return raw
                                if mode=="eof": control.current=False
                                raise StopIteration
                        streams[first]=Stream()
                    before=sum(name=="WriteFile" for name,_ in kernel.calls)
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
                    writes=sum(name=="WriteFile" for name,_ in kernel.calls)-before
                    self.assertEqual(writes,1 if mode=="eof" else 0); self.assertEqual(graph.phase,"failed")
                    self.assertEqual(control.retained,[])

    def test_native_unknown_write_preserves_original_slots_and_disallows_further_calls(self):
        actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control); invoke=graph.owner.invoke
            def lost(name,args,row):
                result=invoke(name,args,row)
                if name=="WriteFile": raise RuntimeError("synthetic lost write acknowledgement")
                return result
            graph.owner.invoke=lost
            with self.assertRaises(actual.LaunchUnavailable): graph.prepare({name:(raw,) for name,raw in contents.items()})
            self.assertTrue(graph.owner.unknown); self.assertTrue(graph.owner.pending)
            self.assertTrue(graph.owner.pending[-1]["value_returned"]); before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable): graph.assert_sealed()
            self.assertEqual(len(kernel.calls),before); self.assertEqual(control.retained,[])
            self.assertTrue(any(not h.closed for h in graph.owned_handles))

    def test_reservation_callback_loss_is_fenced_before_charge_creation_write_and_seal(self):
        for stage in ("charge","create","write","seal"):
            with self.subTest(stage=stage):
                actual,_,lease,_,request,input_control,kernel,config,contents,files,control=self.fixture()
                armed=[stage=="charge"]; calls=[0]; lost=[False]; effects=[]
                def reservation_current():
                    if armed[0]:
                        calls[0]+=1
                        # checkpoint('seal') has two own guard boundaries.
                        if stage!="seal" or calls[0]==2:
                            input_control.current=False; lost[0]=True
                    return True
                class Admission:
                    def assert_current(self): return True
                control.assert_current=reservation_current
                original_charge=control.charge_source_copy
                def charge(amount):
                    if lost[0]: effects.append("charge")
                    return original_charge(amount)
                control.charge_source_copy=charge
                invoke=kernel.invoke
                def observed(name,args,row):
                    if lost[0] and (name=="WriteFile" or name=="NtSetSecurityObject"
                            or name=="NtCreateFile" and args[7]==2): effects.append(name)
                    return invoke(name,args,row)
                kernel.invoke=observed
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,Admission())
                    original_open,original_checkpoint=graph.open,graph.checkpoint
                    def open_file(*args,**kwargs):
                        if stage=="create" and kwargs.get("fresh") and kwargs.get("directory"): armed[0]=True
                        return original_open(*args,**kwargs)
                    def checkpoint(phase):
                        if stage=="seal" and phase=="seal": armed[0]=True
                        return original_checkpoint(phase)
                    graph.open,graph.checkpoint=open_file,checkpoint
                    streams={name:(raw,) for name,raw in contents.items()}
                    first=files[0]["name"]; raw=contents[first]
                    if stage=="write":
                        def stream():
                            armed[0]=True; yield raw
                        streams[first]=stream()
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
                    self.assertTrue(lost[0]); self.assertEqual(effects,[])
                    self.assertEqual(graph.phase,"failed"); self.assertEqual(control.retained,[])

    def test_short_write_or_foreign_inventory_cannot_seal(self):
        for mode in ("short-write","extra-file","changed-bytes","changed-link"):
            with self.subTest(mode=mode):
                actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
                with lease.borrow(request) as view:
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    if mode=="short-write": kernel.short_write=True
                    elif mode=="extra-file": kernel.after_write=lambda node: kernel.node(graph.physical_path+"\\foreign.json",False,b"x")
                    elif mode=="changed-bytes": kernel.after_write=lambda node: node["data"].__setitem__(0,ord("!"))
                    else: kernel.after_write=lambda node: node.update(links=2)
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare({name:(raw,) for name,raw in contents.items()})
                    self.assertEqual(graph.phase,"failed"); self.assertEqual(control.retained,[])

    def test_thread_and_reentrant_operations_are_refused_without_another_writer(self):
        actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control); results=[]
            def foreign():
                try: graph.prepare({name:(raw,) for name,raw in contents.items()})
                except actual.LaunchUnavailable: results.append("denied")
            before=len(kernel.calls); thread=Thread(target=foreign); thread.start(); thread.join(2)
            self.assertFalse(thread.is_alive()); self.assertEqual(results,["denied"]); self.assertEqual(len(kernel.calls),before)
            class Stream:
                def __iter__(self):
                    with self_case.assertRaises(actual.LaunchUnavailable): graph.prepare({})
                    return iter((contents[files[0]["name"]],))
            self_case=self; streams={name:(raw,) for name,raw in contents.items()}; streams[files[0]["name"]]=Stream()
            graph.prepare(streams); graph.assert_sealed(); self.assertEqual(control.charges,[128*1024])

    def test_observed_output_protection_loss_is_permanent_even_after_restoration(self):
        actual,_,lease,_,request,_,kernel,config,contents,files,control=self.fixture()
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
            graph.prepare({name:(raw,) for name,raw in contents.items()})
            root=kernel.nodes[graph.physical_path]; acl=root["acl"]; root["acl"]=actual.model_acl(kernel.sid,sealed=False)
            with self.assertRaises(actual.LaunchUnavailable): graph.assert_sealed()
            root["acl"]=acl; before=len(kernel.calls)
            with self.assertRaises(actual.LaunchUnavailable): graph.assert_sealed()
            self.assertEqual(len(kernel.calls),before); self.assertEqual(control.retained,[])


class TrainingTensorStreamTests(unittest.TestCase):
    def plan(self, rows=None, streams=None, maximum=128*1024):
        rows=rows if rows is not None else [{"name":"layer.weight","dtype":"F32","shape":[2]}]
        streams=streams if streams is not None else {"layer.weight":(struct.pack("<ff",1.5,-2.0),)}
        return n.OriginalTrainingTensorStream(rows,streams,maximum_bytes=maximum,chunk_bytes=4096)

    def decode(self, raw):
        length,=struct.unpack_from("<Q",raw)
        self.assertEqual(length%8,0); header=json.loads(raw[8:8+length]); body=raw[8+length:]
        self.assertEqual(header.pop("__metadata__"),{"format":"pt"})
        return header,body

    def test_exact_scalar_empty_and_dense_tensor_values_follow_official_framing(self):
        rows=[{"name":"layer.weight","dtype":"F32","shape":[2]},
            {"name":"scalar","dtype":"I64","shape":[]},{"name":"empty","dtype":"BF16","shape":[0,4]}]
        streams={"layer.weight":(struct.pack("<f",1.5),struct.pack("<f",-2.0)),"scalar":(struct.pack("<q",17),),"empty":()}
        plan=self.plan(rows,streams); expected_size=plan.size_bytes
        rows[0]["shape"][0]=999; streams["scalar"]=(b"changed",)
        raw=b"".join(plan); self.assertEqual(len(raw),expected_size)
        header,body=self.decode(raw)
        self.assertEqual(header,{"layer.weight":{"dtype":"F32","shape":[2],"data_offsets":[0,8]},
            "scalar":{"dtype":"I64","shape":[],"data_offsets":[8,16]},
            "empty":{"dtype":"BF16","shape":[0,4],"data_offsets":[16,16]}})
        self.assertEqual(struct.unpack("<ffq",body),(1.5,-2.0,17)); self.assertEqual(plan.phase,"complete")
        with self.assertRaises(n.LaunchUnavailable): iter(plan)
        self.assertEqual(plan.phase,"complete")

    def test_all_supported_dtype_widths_and_padded_header_match_exact_sizes(self):
        widths={"BOOL":1,"U8":1,"I8":1,"I16":2,"I32":4,"I64":8,"F16":2,"BF16":2,"F32":4,"F64":8}
        rows=[{"name":"tensor_"+name,"dtype":name,"shape":[2,3]} for name in widths]
        data={r["name"]:(bytes([index])*6*widths[r["dtype"]],) for index,r in enumerate(rows)}
        plan=self.plan(rows,data); raw=b"".join(plan); header,body=self.decode(raw); offset=0
        for index,row in enumerate(rows):
            size=6*widths[row["dtype"]]; self.assertEqual(header[row["name"]]["data_offsets"],[offset,offset+size])
            self.assertEqual(body[offset:offset+size],bytes([index])*size); offset+=size
        self.assertEqual(offset,len(body)); self.assertEqual(len(raw),plan.size_bytes)

    def test_plan_refuses_bad_metadata_before_touching_any_supplier(self):
        class Bomb:
            def __iter__(self): raise AssertionError("Declaration refusal must perform no supplier IO")
        for mode in ("duplicate","reserved","name","unicode","dtype","shape","bool","negative","rank","overflow","unknown","foreign-stream","total"):
            with self.subTest(mode=mode):
                rows=[{"name":"x","dtype":"F32","shape":[1]}]; streams={"x":Bomb()}; maximum=128*1024
                if mode=="duplicate": rows.append(dict(rows[0]))
                elif mode=="reserved": rows[0]["name"]="__metadata__"
                elif mode=="name": rows[0]["name"]="../weight"
                elif mode=="unicode": rows[0]["name"]="weight-\u202e"
                elif mode=="dtype": rows[0]["dtype"]="OBJECT"
                elif mode=="shape": rows[0]["shape"]=(1,)
                elif mode=="bool": rows[0]["shape"]=[True]
                elif mode=="negative": rows[0]["shape"]=[-1]
                elif mode=="rank": rows[0]["shape"]=[1]*33
                elif mode=="overflow": rows[0]["shape"]=[maximum,maximum]
                elif mode=="unknown": rows[0]["callback"]=True
                elif mode=="foreign-stream": streams["extra"]=Bomb()
                else: maximum=4
                with self.assertRaises(n.LaunchUnavailable): self.plan(rows,streams,maximum)

    def test_malformed_byte_streams_fail_permanently_without_raw_supplier_errors(self):
        for mode in ("short","extra","empty","wrong-type","large","exception"):
            with self.subTest(mode=mode):
                raw=struct.pack("<ff",1.5,-2.0)
                value={"short":(raw[:-1],),"extra":(raw,b"!"),"empty":(b"",raw),
                    "wrong-type":(bytearray(raw),),"large":(b"x"*4097,)}
                def failed(): yield raw; raise RuntimeError("private supplier details")
                plan=self.plan(streams={"layer.weight":failed() if mode=="exception" else value[mode]})
                with self.assertRaises(n.LaunchUnavailable) as caught: b"".join(plan)
                self.assertNotIn("private",str(caught.exception)); self.assertEqual(plan.phase,"failed")
                with self.assertRaises(n.LaunchUnavailable): iter(plan)

    def test_empty_shapes_check_all_nonzero_strides_before_zero_storage(self):
        maximum=2**53-1
        class Bomb:
            def __iter__(self): raise AssertionError("Overflowing shape must not reach a supplier")
        for shape in ([0,maximum,maximum],[maximum,0,maximum],[maximum,maximum,0]):
            with self.subTest(denied_shape=shape):
                with self.assertRaises(n.LaunchUnavailable):
                    self.plan([{"name":"empty","dtype":"U8","shape":shape}],{"empty":Bomb()},maximum)
        for shape in ([0,2,3],[2048,2048,0],[0,2048,2048]):
            with self.subTest(valid_shape=shape):
                plan=self.plan([{"name":"empty","dtype":"F32","shape":shape}],{"empty":()},65536)
                raw=b"".join(plan); header,body=self.decode(raw)
                self.assertEqual(header["empty"]["shape"],shape)
                self.assertEqual(header["empty"]["data_offsets"],[0,0]); self.assertEqual(body,b"")
                self.assertEqual(len(raw),plan.size_bytes); self.assertEqual(plan.phase,"complete")

    def test_large_tensor_is_lazy_and_each_supplier_chunk_is_forwarded_without_collection(self):
        amount=8*1024*1024; calls=[]; piece=b"z"*4096
        def data():
            for index in range(amount//len(piece)): calls.append(index); yield piece
        plan=self.plan([{"name":"large","dtype":"U8","shape":[amount]}],{"large":data()},amount+4096)
        self.assertEqual(calls,[]); iterator=iter(plan)
        first,header=next(iterator),next(iterator); self.assertEqual(calls,[])
        self.assertEqual(len(first),8); total=len(first)+len(header); digest=hashlib.sha256()
        for chunk in iterator:
            self.assertIs(chunk,piece); self.assertLessEqual(len(chunk),4096); total+=len(chunk); digest.update(chunk)
        self.assertEqual(len(calls),amount//4096); self.assertEqual(total,plan.size_bytes)
        self.assertEqual(digest.hexdigest(),hashlib.sha256(piece*(amount//4096)).hexdigest())
        with self.assertRaises(StopIteration): next(iterator)
        self.assertEqual(plan.phase,"complete")

    def test_large_header_is_emitted_in_bounded_chunks(self):
        rows=[{"name":"layer_"+str(i),"dtype":"U8","shape":[1]} for i in range(250)]
        plan=self.plan(rows,{r["name"]:(b"x",) for r in rows})
        chunks=list(plan); self.assertTrue(all(0<len(c)<=4096 for c in chunks)); raw=b"".join(chunks)
        self.assertEqual(len(raw),plan.size_bytes); header,body=self.decode(raw)
        self.assertEqual(len(header),250); self.assertEqual(body,b"x"*250)

    def test_foreign_thread_and_caught_reentry_cannot_complete_the_same_stream(self):
        for mode in ("thread","iter-reentry","next-reentry"):
            with self.subTest(mode=mode):
                calls=[]; holder={}
                class Source:
                    def __iter__(self): return self
                    def __next__(self):
                        if mode=="iter-reentry":
                            with self_case.assertRaises(n.LaunchUnavailable): iter(holder["plan"])
                        else:
                            with self_case.assertRaises(n.LaunchUnavailable): next(holder["iterator"])
                        calls.append(True); return b"12345678"
                self_case=self
                plan=self.plan(streams={"layer.weight":Source()}); holder["plan"]=plan
                iterator=iter(plan); holder["iterator"]=iterator
                if mode=="thread":
                    result=[]
                    def foreign():
                        try: next(iterator)
                        except n.LaunchUnavailable: result.append("denied")
                    thread=Thread(target=foreign); thread.start(); thread.join(2)
                    self.assertFalse(thread.is_alive()); self.assertEqual(result,["denied"]); self.assertEqual(calls,[])
                else:
                    next(iterator); next(iterator)
                    with self.assertRaises(n.LaunchUnavailable): next(iterator)
                    self.assertEqual(calls,[True])
                self.assertEqual(plan.phase,"failed")

    def test_actual_protected_writer_consumes_framed_tensor_bytes_and_retains_exact_native_graph(self):
        case=TrainingOutputCustodyTests(); self.addCleanup(case.doCleanups)
        actual,_,lease,_,request,_,kernel,config,contents,files,control=case.fixture()
        tensor=actual.OriginalTrainingTensorStream([{"name":"adapter.weight","dtype":"F32","shape":[2]}],
            {"adapter.weight":(struct.pack("<ff",1.5,-2.0),)},maximum_bytes=64*1024,chunk_bytes=4096)
        weight="adapter_model.safetensors"
        for row in files:
            if row["name"]==weight: row["sizeBytes"]=tensor.size_bytes
        streams={name:(raw,) for name,raw in contents.items()}; streams[weight]=tensor
        with lease.borrow(request) as view:
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
            graph.prepare(streams); graph.assert_sealed()
            raw=bytes(kernel.nodes[graph.physical_path+"\\"+weight]["data"]); header,body=self.decode(raw)
            self.assertEqual(header["adapter.weight"],{"dtype":"F32","shape":[2],"data_offsets":[0,8]})
            self.assertEqual(struct.unpack("<ff",body),(1.5,-2.0)); self.assertEqual(tensor.phase,"complete")
            self.assertEqual(graph.phase,"sealed"); self.assertEqual(control.charges,[128*1024]); self.assertEqual(control.retained,[])


class DenseTensorByteAdapterTests(unittest.TestCase):
    def fixture(self):
        case=TrainingOutputCustodyTests(); self.addCleanup(case.doCleanups)
        facts=case.fixture(); actual,source,lease,inputs,request,input_control,kernel,config,contents,files,control=facts
        sdk=ModuleType("torch"); sdk.Size=tuple; sdk.strided=object()
        widths={"bool":1,"uint8":1,"int8":1,"int16":2,"int32":4,"int64":8,"float16":2,"bfloat16":2,"float32":4,"float64":8}
        for name in widths: setattr(sdk,name,object())
        width_of={getattr(sdk,name):width for name,width in widths.items()}
        class Device:
            def __init__(self,kind,index=None): self.type,self.index=kind,index
        class Tensor:
            after=None; copies=[]; bad_copy=None
            def __init__(self,raw,shape,dtype=None,device=None,*,storage=None,offset=0,counter=None,tag="weight"):
                self._storage=bytearray(raw) if storage is None else storage
                self._shape=tuple(shape); self._dtype=sdk.float32 if dtype is None else dtype
                self._device=Device("cpu") if device is None else device; self._offset=offset
                self._counter=[0] if counter is None else counter; self.tag=tag
                self.contiguous=True; self.quantized=False; self.layout_value=sdk.strided; self.negative=False
            @property
            def dtype(self): return self._dtype
            @property
            def shape(self): return self._shape
            @property
            def device(self): return self._device
            @property
            def layout(self): return self.layout_value
            @property
            def _version(self): return self._counter[0]
            @property
            def is_quantized(self): return self.quantized
            def done(self,name,value):
                if Tensor.after: Tensor.after(name,self)
                return value
            def size(self): return self.done("size",self._shape)
            def stride(self):
                if hasattr(self,"reported_stride"): return self.done("stride",self.reported_stride)
                values=[]; unit=1
                for size in reversed(self._shape): values.insert(0,unit); unit*=max(size,1)
                return self.done("stride",tuple(values))
            def storage_offset(self): return self.done("storage_offset",self._offset//width_of[self._dtype])
            def data_ptr(self): return self.done("data_ptr",id(self._storage)+self._offset)
            def element_size(self): return self.done("element_size",width_of[self._dtype])
            def is_contiguous(self): return self.done("is_contiguous",self.contiguous)
            def is_conj(self): return False
            def is_neg(self): return self.negative
            def detach(self): return self.done("detach",self)
            def view(self,shape):
                size=1
                for value in self._shape: size*=value
                dtype=sdk.uint8 if shape is sdk.uint8 else self._dtype
                if shape is sdk.uint8: size*=width_of[self._dtype]
                else: assert shape == -1
                return self.done("view",Tensor(b"",(size,),dtype,self._device,storage=self._storage,
                    offset=self._offset,counter=self._counter,tag=self.tag))
            def narrow(self,dimension,start,length):
                assert dimension==0 and len(self._shape)==1
                return self.done("narrow",Tensor(b"",(length,),self._dtype,self._device,storage=self._storage,
                    offset=self._offset+start*width_of[self._dtype],counter=self._counter,tag=self.tag))
            def to(self,*,device,copy,non_blocking):
                assert device=="cpu" and copy is True and non_blocking is False
                size=self._shape[0]*width_of[self._dtype]; Tensor.copies.append((size,copy,non_blocking,self._device.type))
                value=Tensor(self._storage[self._offset:self._offset+size],self._shape,self._dtype,tag=self.tag)
                if Tensor.bad_copy=="alias": value=self
                elif Tensor.bad_copy=="wide": value._shape=(self._shape[0]+1,)
                elif Tensor.bad_copy=="dtype": value._dtype=sdk.uint8
                return self.done("to",value)
            def numpy(self):
                assert self._dtype is sdk.uint8
                return self.done("numpy",memoryview(self._storage)[self._offset:self._offset+self._shape[0]])
        sdk.Tensor,sdk.device=Tensor,Device
        patcher=patch.dict(sys.modules,{"torch":sdk}); patcher.start(); self.addCleanup(patcher.stop)
        return facts,sdk,Tensor,Device

    def tensor(self,Tensor,sdk,Device,*,device="cpu",count=4,tag="weight"):
        raw=struct.pack("<"+"f"*count,*[float(i) for i in range(count)])
        return Tensor(raw,(count,),sdk.float32,Device(device,0 if device=="cuda" else None),tag=tag),raw

    def test_cpu_and_cuda_sources_use_only_bounded_blocking_copies_and_exact_values(self):
        for device in ("cpu","cuda"):
            with self.subTest(device=device):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
                tensor,raw=self.tensor(Tensor,sdk,Device,device=device,count=2500)
                with lease.borrow(request) as view:
                    selected={"layer.weight":tensor}
                    stream=actual.OriginalTrainingDenseTensorStream(view,request,selected,maximum_bytes=65536,chunk_bytes=4096)
                    self.assertEqual(Tensor.copies,[]); selected.clear()
                    result=b"".join(stream); header,body=TrainingTensorStreamTests().decode(result)
                    self.assertEqual(body,raw); self.assertEqual(header["layer.weight"]["shape"],[2500])
                    self.assertEqual(len(result),stream.size_bytes); self.assertEqual(stream.phase,"complete")
                    self.assertIsNone(stream._sdk_flight)
                    self.assertEqual(sum(row[0] for row in Tensor.copies),len(raw))
                    self.assertTrue(all(size<=4096 and copy and not nonblocking and kind==device
                        for size,copy,nonblocking,kind in Tensor.copies))
                    with self.assertRaises(actual.LaunchUnavailable): iter(stream)

    def test_bfloat16_and_empty_tensor_bytes_need_no_dtype_conversion_or_full_copy(self):
        facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
        tensor=Tensor(b"\x80\x3f\x00\xc0",(2,),sdk.bfloat16)
        empty=Tensor(b"",(2048,0,2048),sdk.float32)
        with lease.borrow(request) as view:
            stream=actual.OriginalTrainingDenseTensorStream(view,request,{"bf16":tensor,"empty":empty},maximum_bytes=65536,chunk_bytes=4096)
            raw=b"".join(stream); header,body=TrainingTensorStreamTests().decode(raw)
            self.assertEqual(body,b"\x80\x3f\x00\xc0"); self.assertEqual(header["bf16"]["dtype"],"BF16")
            self.assertEqual(header["empty"]["data_offsets"],[4,4]); self.assertEqual(Tensor.copies,[(4,True,False,"cpu")])

    def test_unsupported_tensor_or_missing_sdk_denies_before_any_cpu_transfer(self):
        for mode in ("subclass","noncontiguous","quantized","layout","dtype","device","negative","budget","missing-sdk","bad-size"):
            with self.subTest(mode=mode):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
                tensor,_=self.tensor(Tensor,sdk,Device)
                if mode=="subclass":
                    class Foreign(Tensor): pass
                    tensor=Foreign(b"1234",(1,))
                elif mode=="noncontiguous": tensor.contiguous=False
                elif mode=="quantized": tensor.quantized=True
                elif mode=="layout": tensor.layout_value=object()
                elif mode=="dtype": tensor._dtype=object()
                elif mode=="device": tensor._device=Device("mps")
                elif mode=="negative": tensor.negative=True
                elif mode=="missing-sdk": sys.modules.pop("torch")
                elif mode=="bad-size": tensor._shape=object()
                with lease.borrow(request) as view:
                    with self.assertRaises(actual.LaunchUnavailable):
                        actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=4 if mode=="budget" else 65536,chunk_bytes=4096)
                    self.assertEqual(Tensor.copies,[])

    def test_missing_wrong_and_expired_joint_views_refuse_sdk_data(self):
        facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
        tensor,_=self.tensor(Tensor,sdk,Device)
        with self.assertRaises(actual.LaunchUnavailable):
            actual.OriginalTrainingDenseTensorStream(object(),request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
        with lease.borrow(request) as view:
            changed=copy.deepcopy(request); changed["commonParameters"]["maxSteps"]=999
            with self.assertRaises(actual.LaunchUnavailable):
                actual.OriginalTrainingDenseTensorStream(view,changed,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
            stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
        with self.assertRaises(actual.LaunchUnavailable): b"".join(stream)
        self.assertEqual(Tensor.copies,[])

    def test_lost_authority_during_sdk_handoff_prevents_later_transfers_and_native_writes(self):
        for boundary in ("narrow","to","numpy"):
            with self.subTest(boundary=boundary):
                facts,sdk,Tensor,Device=self.fixture()
                actual,_,lease,_,request,input_control,kernel,config,contents,files,control=facts
                tensor,_=self.tensor(Tensor,sdk,Device); lost=[False]; after_loss=[]; invoke=kernel.invoke
                def observed(name,args,row):
                    if lost[0] and name=="WriteFile": after_loss.append(name)
                    return invoke(name,args,row)
                kernel.invoke=observed
                def after(name,value):
                    if name==boundary: input_control.current=False; lost[0]=True
                with lease.borrow(request) as view:
                    stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                    for row in files:
                        if row["name"]=="adapter_model.safetensors": row["sizeBytes"]=stream.size_bytes
                    streams={name:(raw,) for name,raw in contents.items()}; streams["adapter_model.safetensors"]=stream
                    graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                    Tensor.after=after
                    with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
                    self.assertTrue(lost[0]); self.assertEqual(after_loss,[])
                    self.assertEqual(len(Tensor.copies),0 if boundary=="narrow" else 1)
                    self.assertEqual(stream.phase,"failed"); self.assertEqual(graph.phase,"failed"); self.assertEqual(control.retained,[])
                    self.assertEqual(stream._sdk_flight["operation"],boundary)
                    self.assertTrue(stream._sdk_flight["entered"]); self.assertTrue(stream._sdk_flight["returned"])
                    if boundary=="to": self.assertIs(type(stream._sdk_flight["result"]),Tensor)

    def test_mutation_of_an_earlier_tensor_is_rechecked_before_native_output_seals(self):
        facts,sdk,Tensor,Device=self.fixture()
        actual,_,lease,_,request,_,kernel,config,contents,files,control=facts
        first,_=self.tensor(Tensor,sdk,Device,tag="first"); second,_=self.tensor(Tensor,sdk,Device,tag="second")
        with lease.borrow(request) as view:
            stream=actual.OriginalTrainingDenseTensorStream(view,request,{"first":first,"second":second},maximum_bytes=65536,chunk_bytes=4096)
            for row in files:
                if row["name"]=="adapter_model.safetensors": row["sizeBytes"]=stream.size_bytes
            streams={name:(raw,) for name,raw in contents.items()}; streams["adapter_model.safetensors"]=stream
            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
            def changed(name,tensor):
                if name=="numpy" and tensor.tag=="second": first._counter[0]+=1
            Tensor.after=changed
            with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
            self.assertEqual(stream.phase,"failed"); self.assertEqual(graph.phase,"failed")
            self.assertTrue(any(not handle.closed for handle in graph.owned_handles)); self.assertEqual(control.retained,[])

    def test_captured_class_methods_survive_instance_and_module_replacement(self):
        facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
        tensor,expected=self.tensor(Tensor,sdk,Device)
        with lease.borrow(request) as view:
            stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
            def forbidden(*args,**kwargs): raise AssertionError("A replaced SDK method must not be selected")
            tensor.to=forbidden; sdk.Tensor=object
            with patch.object(Tensor,"to",forbidden):
                raw=b"".join(stream)
            _,body=TrainingTensorStreamTests().decode(raw); self.assertEqual(body,expected)

    def test_malformed_cpu_copy_replies_and_reentry_never_complete(self):
        for mode in ("alias","wide","dtype","reentry"):
            with self.subTest(mode=mode):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
                tensor,_=self.tensor(Tensor,sdk,Device)
                with lease.borrow(request) as view:
                    stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                    if mode=="reentry":
                        def reenter(name,value):
                            if name=="narrow":
                                with self.assertRaises(actual.LaunchUnavailable): iter(stream)
                        Tensor.after=reenter
                    else: Tensor.bad_copy=mode
                    with self.assertRaises(actual.LaunchUnavailable): b"".join(stream)
                    self.assertEqual(stream.phase,"failed")

    def test_lost_sdk_return_and_foreign_thread_keep_original_flight_without_retry(self):
        for mode in ("lost-return","thread"):
            with self.subTest(mode=mode):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
                tensor,_=self.tensor(Tensor,sdk,Device)
                with lease.borrow(request) as view:
                    stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                    iterator=iter(stream)
                    if mode=="lost-return":
                        def lost(name,value):
                            if name=="to": raise RuntimeError("private lost SDK return")
                        Tensor.after=lost
                        with self.assertRaises(actual.LaunchUnavailable) as caught: b"".join(iterator)
                        self.assertNotIn("private",str(caught.exception))
                        flight=stream._sdk_flight; self.assertEqual(flight["operation"],"to")
                        self.assertTrue(flight["entered"]); self.assertFalse(flight["returned"])
                        self.assertIs(type(flight["tensor"]),Tensor); self.assertEqual(len(Tensor.copies),1)
                    else:
                        result=[]
                        def foreign():
                            try: next(iterator)
                            except actual.LaunchUnavailable: result.append("denied")
                        thread=Thread(target=foreign); thread.start(); thread.join(2)
                        self.assertFalse(thread.is_alive()); self.assertEqual(result,["denied"]); self.assertEqual(Tensor.copies,[])
                    self.assertEqual(stream.phase,"failed"); copies=len(Tensor.copies)
                    with self.assertRaises(actual.LaunchUnavailable): next(iterator)
                    self.assertEqual(len(Tensor.copies),copies)

    def test_caught_currentness_reentry_cannot_emit_or_write_a_failed_stream(self):
        for native in (False,True):
            with self.subTest(native=native):
                facts,sdk,Tensor,Device=self.fixture()
                actual,_,lease,_,request,input_control,kernel,config,contents,files,control=facts
                tensor,body=self.tensor(Tensor,sdk,Device); armed=[False]; caught=[]; writes=[]
                with lease.borrow(request) as view:
                    stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                    original=stream._framed
                    class ForwardedPlan:
                        size_bytes=original.size_bytes
                        def __iter__(self):
                            inner=iter(original)
                            class ForwardedIterator:
                                def __iter__(self): return self
                                def __next__(self):
                                    raw=next(inner)
                                    if raw==body: armed[0]=True
                                    return raw
                            return ForwardedIterator()
                    stream._framed=ForwardedPlan()
                    def current_value(obj):
                        if obj is input_control and armed[0] and not caught:
                            try: iter(stream)
                            except actual.LaunchUnavailable: caught.append("denied")
                        return obj.__dict__["current"]
                    prop=property(current_value,lambda obj,value:obj.__dict__.__setitem__("current",value))
                    invoke=kernel.invoke
                    def observed(name,args,row):
                        if name=="WriteFile" and caught: writes.append(name)
                        return invoke(name,args,row)
                    kernel.invoke=observed
                    with patch.object(type(input_control),"current",prop,create=True):
                        if native:
                            for row in files:
                                if row["name"]=="adapter_model.safetensors": row["sizeBytes"]=stream.size_bytes
                            streams={name:(raw,) for name,raw in contents.items()}; streams["adapter_model.safetensors"]=stream
                            graph=actual.OriginalTrainingOutputGraph(view,request,config,files,control,control)
                            with self.assertRaises(actual.LaunchUnavailable): graph.prepare(streams)
                            self.assertEqual(writes,[]); self.assertEqual(graph.phase,"failed"); self.assertEqual(control.retained,[])
                        else:
                            iterator=iter(stream); next(iterator); next(iterator)
                            with self.assertRaises(actual.LaunchUnavailable): next(iterator)
                    self.assertEqual(caught,["denied"]); self.assertEqual(stream.phase,"failed")

    def test_returned_flat_and_slice_metadata_are_checked_before_cpu_copy(self):
        for mode in ("flat-dtype","flat-shape","part-size","part-offset","part-dtype","part-device","part-version","part-stride"):
            with self.subTest(mode=mode):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,*_=facts
                tensor,_=self.tensor(Tensor,sdk,Device,count=2500)
                original_view,original_narrow=Tensor.view,Tensor.narrow
                def view(receiver,shape):
                    result=original_view(receiver,shape)
                    if shape==-1:
                        if mode=="flat-dtype": result._dtype=sdk.float64
                        if mode=="flat-shape": result._shape=(2500,1)
                    return result
                def narrow(receiver,dimension,start,length):
                    result=original_narrow(receiver,dimension,start,length)
                    if mode=="part-size": result._shape=(2500,)
                    elif mode=="part-offset": result._offset+=4
                    elif mode=="part-dtype": result._dtype=sdk.float64
                    elif mode=="part-device": result._device=Device("mps")
                    elif mode=="part-version": result._counter=[1]
                    elif mode=="part-stride": result.reported_stride=(2,)
                    return result
                with patch.object(Tensor,"view",view),patch.object(Tensor,"narrow",narrow):
                    with lease.borrow(request) as live:
                        stream=actual.OriginalTrainingDenseTensorStream(live,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                        with self.assertRaises(actual.LaunchUnavailable): b"".join(stream)
                        self.assertEqual(Tensor.copies,[]); self.assertEqual(stream.phase,"failed")

    def test_visible_metadata_and_late_currentness_mutation_deny_before_cpu_copy(self):
        for mode in ("metadata","late-currentness"):
            with self.subTest(mode=mode):
                facts,sdk,Tensor,Device=self.fixture(); actual,_,lease,_,request,input_control,*_=facts
                tensor,_=self.tensor(Tensor,sdk,Device,count=2500); changed=[]; armed=[]
                original_size=Tensor.size
                def size(receiver):
                    result=original_size(receiver)
                    if (mode=="metadata" and receiver._storage is tensor._storage
                            and receiver._shape==(1024,) and not changed):
                        receiver._shape=(2500,); receiver._counter[0]+=1; changed.append(True)
                    return result
                with patch.object(Tensor,"size",size):
                    with lease.borrow(request) as view:
                        stream=actual.OriginalTrainingDenseTensorStream(view,request,{"weight":tensor},maximum_bytes=65536,chunk_bytes=4096)
                        original_sdk=stream._sdk
                        def sdk_call(name,receiver,*args,**kwargs):
                            if mode=="late-currentness" and name=="to" and not armed: armed.append(receiver)
                            return original_sdk(name,receiver,*args,**kwargs)
                        stream._sdk=sdk_call
                        def current(obj):
                            if obj is input_control and armed and not changed:
                                armed[0]._shape=(2500,); armed[0]._counter[0]+=1; changed.append(True)
                            return obj.__dict__["current"]
                        prop=property(current,lambda obj,value:obj.__dict__.__setitem__("current",value))
                        with patch.object(type(input_control),"current",prop,create=True):
                            with self.assertRaises(actual.LaunchUnavailable): b"".join(stream)
                        self.assertEqual(changed,[True]); self.assertEqual(Tensor.copies,[])
                        self.assertEqual(stream.phase,"failed")


class InheritedModelViewTests(unittest.TestCase):
    def fixture(self):
        owner,kernel,control=SourceLaunchExchangeTests().bound_bootstrap()
        owner.resume()
        for thread in owner.readers: thread.join(1)
        self.assertEqual(owner.model_bootstrap.outcome,"written")
        child=kernel.inherited_child()
        def finish():
            owner.request_stop()
            for thread in owner.readers: thread.join(1)
            self.assertTrue(owner.observe_retirement())
            self.assertEqual(control.retained,[descriptor()["maximumCopyBytes"]])
        self.addCleanup(finish)
        return owner,kernel,child

    def test_actual_readonly_bootstrap_mints_one_live_view_and_keeps_the_logical_request(self):
        owner,kernel,child=self.fixture()
        source=n.OriginalModelBootstrapReceiver(owner.boot["nonce"],kernel=child)
        expected=json.loads(owner.definition_bytes); request=copy.deepcopy(expected["request"])
        request.update(parameters={"zero":0,"false":False,"fraction":0.1})
        original=copy.deepcopy(request); lease=source.bind(expected)
        with self.assertRaises(n.LaunchUnavailable): source.bind(expected)
        with self.assertRaises(n.LaunchUnavailable): n.OriginalInheritedModelLease(source)
        with lease.borrow(request) as view:
            self.assertEqual(n.resolve_original_model_view(view,request),owner.model_graph.physical_path)
            changed=copy.deepcopy(request); changed["parameters"]["false"]=0
            with self.assertRaises(n.LaunchUnavailable): n.resolve_original_model_view(view,changed)
            with self.assertRaises(n.LaunchUnavailable): n.resolve_original_model_view(object(),request)
            outcomes=[]
            def foreign_thread():
                try: n.resolve_original_model_view(view,request); outcomes.append("unexpected")
                except n.LaunchUnavailable: outcomes.append("denied")
            thread=n.Thread(target=foreign_thread); thread.start(); thread.join(1); self.assertEqual(outcomes,["denied"])
        self.assertEqual(request,original); self.assertEqual(source.phase,"spent")
        self.assertTrue(all(not handle.closed for handle in source.guards))
        with self.assertRaises(n.LaunchUnavailable): n.resolve_original_model_view(view,request)
        with self.assertRaises(n.LaunchUnavailable):
            with lease.borrow(request): pass
        self.assertFalse(any(name in ("NtCreateFile","WriteFile","NtSetSecurityObject","CreateProcessW","CreateJobObjectW") for name,_ in child.calls))
        self.assertEqual(sum(name=="SetFilePointerEx" for name,_ in child.calls),3)

    def test_forged_receiver_or_view_cannot_supply_a_loader_path(self):
        with self.assertRaises(n.LaunchUnavailable): n.OriginalInheritedModelLease(object())
        forged=n.OriginalModelBootstrapReceiver.__new__(n.OriginalModelBootstrapReceiver)
        forged.phase="bound"
        with self.assertRaises(n.LaunchUnavailable): n.OriginalInheritedModelLease(forged)
        with self.assertRaises(n.LaunchUnavailable): n.resolve_original_model_view(n._OriginalModelView(),{})

    def test_wrong_nonce_or_inherited_access_does_not_close_unverified_foreign_handles(self):
        for mode in ("nonce","access"):
            with self.subTest(mode=mode):
                owner,kernel,child=self.fixture()
                if mode=="access": child.handles[kernel.attributes[n.HANDLE_LIST][3]]["access"]|=2
                with self.assertRaises(n.LaunchUnavailable):
                    n.OriginalModelBootstrapReceiver("e"*64 if mode=="nonce" else owner.boot["nonce"],kernel=child)
                inherited=set(kernel.attributes[n.HANDLE_LIST])
                self.assertFalse(any(name=="CloseHandle" and args[0] in inherited for name,args in child.calls))

    def test_changed_bytes_extra_files_or_protection_deny_before_any_model_view(self):
        for mode in ("bytes","extra","acl","root-name"):
            with self.subTest(mode=mode):
                owner,kernel,child=self.fixture(); root=owner.model_graph.physical_path
                if mode=="bytes": kernel.nodes[root+"\\config.json"]["data"][:]=b"[]"
                if mode=="extra": kernel.node(root+"\\extra.json",False,b"{}")
                if mode=="acl": kernel.nodes[root]["acl"]=n.model_acl(kernel.sid,sealed=False)
                if mode=="root-name": kernel.nodes[root]["path"]+="-changed"
                with self.assertRaises(n.LaunchUnavailable): n.OriginalModelBootstrapReceiver(owner.boot["nonce"],kernel=child)
                self.assertFalse(any(name in ("NtCreateFile","WriteFile","NtSetSecurityObject") for name,_ in child.calls))


class ModelGraphTests(unittest.TestCase):
    def graph(self, value=None):
        kernel, control = Kernel(), Control()
        owner = n.OriginalWorker(boot(), kernel=kernel, executable="X:/inert/python.exe", worker_root=_root)
        graph = n.OriginalModelGraph(owner, value or descriptor(), control, control)
        return graph, kernel, control

    def cache_graph(self):
        value = descriptor()
        original_source, original_parent = value["sourcePath"], value["freshParent"]
        value["sourcePath"] = value["logicalPath"] = "X:\\Users\\Test User\\.cache\\selected"
        value["freshParent"] = "X:\\Users\\Test User\\.local-codex\\training"
        graph, kernel, control = self.graph(value)
        for name in ("X:\\Users", "X:\\Users\\Test User", "X:\\Users\\Test User\\.cache",
                     "X:\\Users\\Test User\\.local-codex"):
            kernel.node(name, True)
        for old, new in ((original_source, value["sourcePath"]), (original_parent, value["freshParent"])):
            for name in list(kernel.nodes):
                if name == old or name.startswith(old + "\\"):
                    node = kernel.nodes.pop(name)
                    node["path"] = new + name[len(old):]
                    kernel.nodes[node["path"]] = node
        return graph, kernel, control

    def test_realistic_cache_names_copy_hash_seal_and_inherit_through_native_parent_handles(self):
        graph, kernel, control = self.cache_graph()
        originals = {row["name"]: bytes(kernel.nodes[graph.descriptor["sourcePath"] + "\\" + row["name"]]["data"])
                     for row in graph.descriptor["files"]}
        graph.prepare()
        self.assertEqual(graph.phase, "sealed")
        inherited = graph.inherited_handles()
        self.assertEqual(len(inherited), 4)
        for name in ("Test User", ".cache", ".local-codex"):
            self.assertIn(name, kernel.opened_names)
        for row in graph.records:
            copied = kernel.nodes[graph.physical_path + "\\" + row["name"]]
            self.assertEqual(bytes(copied["data"]), originals[row["name"]])
            self.assertEqual(copied["acl"], n.model_acl(kernel.sid, sealed=True))
        self.assertEqual(control.charges, [graph.descriptor["maximumCopyBytes"]])
        self.assertFalse(any(name in ("CreateProcessW", "DeleteFileW", "SetFileInformationByHandle") for name, _ in kernel.calls))

    def test_cache_name_support_does_not_follow_reparse_ancestors(self):
        for path in ("X:\\Users\\Test User\\.cache", "X:\\Users\\Test User\\.local-codex"):
            with self.subTest(path=path):
                graph, kernel, _ = self.cache_graph()
                kernel.nodes[path]["attributes"] |= 0x400
                with self.assertRaises(n.LaunchUnavailable): graph.prepare()
                self.assertFalse(graph.attempted)
                self.assertFalse(any(name in ("WriteFile", "CreateProcessW") for name, _ in kernel.calls))

    def test_cache_directory_aliases_devices_and_streams_refuse_before_native_io(self):
        for component in (".", "..", "cache.", "cache ", " CON", "CON", "con.txt", "NUL.data",
                          "COM0", "COM1.log", "LPT9", "CON .txt", "name:stream", "a/b", "bad\tname", "bad\x00name"):
            with self.subTest(component=component):
                value = descriptor()
                value["sourcePath"] = "X:\\models\\" + component + "\\selected"
                with self.assertRaises(n.LaunchUnavailable): self.graph(value)
        for component in ("a\\b", ".", "..", "a/b", "name:stream", "cache ", "cache."):
            with self.assertRaises(n.LaunchUnavailable): n.model_directory_component(component)

    def test_directory_grammar_does_not_expand_manifest_or_fresh_names(self):
        for target in ("fresh", "file"):
            for name in (".cache", "Test User", "model weights.safetensors"):
                with self.subTest(target=target, name=name):
                    value = descriptor()
                    if target == "fresh": value["freshName"] = name
                    else: value["files"][0]["name"] = name
                    with self.assertRaises(n.LaunchUnavailable): self.graph(value)

    def test_fixture_hashes_and_complete_safe_manifest(self):
        graph, kernel, _ = self.graph()
        for row in graph.descriptor["files"]:
            data = bytes(kernel.nodes[graph.descriptor["sourcePath"] + "\\" + row["name"]]["data"])
            self.assertEqual(len(data), row["sizeBytes"]); self.assertEqual(hashlib.sha256(data).hexdigest(), row["sha256"])

    def test_copy_hash_seal_native_readback_and_readonly_inheritance(self):
        graph, kernel, control = self.graph(); originals = {p: bytes(x["data"]) for p, x in kernel.nodes.items()}
        self.assertEqual(kernel.calls, []); graph.prepare(); self.assertEqual(graph.phase, "sealed")
        handles = graph.inherited_handles(); self.assertEqual(len(handles), 4)
        self.assertEqual(control.charges, [descriptor()["maximumCopyBytes"]])
        for h in handles:
            actual = kernel.obj(h.slot.value)
            self.assertTrue(actual["inherit"]); self.assertEqual(actual["access"] & 0xD0156, 0)
            self.assertEqual(actual["node"]["acl"], n.model_acl(kernel.sid, sealed=True))
        self.assertTrue(all(p in kernel.nodes and bytes(kernel.nodes[p]["data"]) == raw for p, raw in originals.items()))
        self.assertFalse(any(name in ("CreateProcessW", "DeleteFileW", "SetFileInformationByHandle") for name, _ in kernel.calls))
        with self.assertRaises(n.LaunchUnavailable): graph.inherited_handles()

    def test_missing_current_authority_or_reservation_denies_before_native_calls(self):
        graph, kernel, control = self.graph(); control.current = False
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertEqual(kernel.calls, []); self.assertEqual(control.charges, []); self.assertFalse(graph.attempted)

    def test_unlisted_source_entry_or_changed_hash_denies_sealed_graph(self):
        for mode in ("extra", "hash", "link", "reparse"):
            with self.subTest(mode=mode):
                graph, kernel, control = self.graph()
                if mode == "extra": kernel.node(descriptor()["sourcePath"] + "\\evil.py", False, b"x")
                if mode == "hash": kernel.nodes[descriptor()["sourcePath"] + "\\config.json"]["data"][:] = b"[]"
                if mode == "link": kernel.nodes[descriptor()["sourcePath"] + "\\config.json"]["links"] = 2
                if mode == "reparse": kernel.nodes[descriptor()["sourcePath"]]["attributes"] |= 0x400
                with self.assertRaises(n.LaunchUnavailable): graph.prepare()
                self.assertNotEqual(graph.phase, "sealed"); self.assertEqual(control.retained, [])
                with self.assertRaises(n.LaunchUnavailable): graph.prepare()

    def test_short_write_and_lost_native_return_keep_original_outputs_and_charge(self):
        for mode in ("short", "unknown"):
            graph, kernel, control = self.graph()
            if mode == "short": kernel.short_write = True
            else: kernel.error_after_return = "NtCreateFile"
            with self.assertRaises(n.LaunchUnavailable): graph.prepare()
            self.assertTrue(graph.charged); self.assertEqual(len(control.charges), 1)
            if mode == "unknown":
                self.assertTrue(graph.owner.unknown); self.assertTrue(graph.owner.pending)
                self.assertTrue(graph.owner.pending[-1]["keep"][0].slot.value)
            with self.assertRaises(n.LaunchUnavailable): graph.inherited_handles()

    def test_authority_loss_during_copy_stops_before_next_write_or_dispatch(self):
        graph, kernel, control = self.graph()
        kernel.after = lambda name: setattr(control, "current", False) if name == "ReadFile" else None
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertFalse(any(name in ("WriteFile", "CreateProcessW", "ResumeThread") for name, _ in kernel.calls))
        self.assertTrue(graph.charged); self.assertTrue(graph.attempted)

    def test_occupied_fresh_namespace_is_not_adopted_or_changed(self):
        graph, kernel, _ = self.graph(); old = kernel.node(graph.physical_path, True)
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertIs(kernel.nodes[graph.physical_path], old); self.assertIsNone(old["acl"])

    def test_allocated_budget_is_checked_before_any_destination_creation_or_write(self):
        value = descriptor(); value["maximumCopyBytes"] = 8000
        graph, kernel, control = self.graph(value)
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertFalse(graph.attempted); self.assertNotIn(graph.physical_path, kernel.nodes)
        self.assertFalse(any(name == "WriteFile" for name, _ in kernel.calls))
        self.assertEqual(control.charges, [8000])

    def test_same_size_destination_tamper_fails_actual_readback(self):
        graph, kernel, _ = self.graph()
        kernel.after_write = lambda node: node["data"].__setitem__(0, ord("!"))
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertNotEqual(graph.phase, "sealed")

    def test_original_controller_seals_before_creation_and_joins_all_handles_and_retained_bytes(self):
        graph, kernel, control = self.graph(); owner = graph.owner
        actual = owner.bind_model_graph(descriptor(), control, control)
        owner.prepare(lambda: True)
        self.assertEqual(actual.phase, "sealed"); self.assertTrue(actual.dispatched)
        inherited = kernel.attributes[n.HANDLE_LIST]
        self.assertEqual(len(inherited), 7); self.assertNotIn(owner.number(owner.job), inherited)
        for number in inherited[3:]:
            self.assertEqual(kernel.obj(number)["access"] & 0xD0156, 0)
        self.assertTrue(any(name == "NtSetSecurityObject" for name, _ in kernel.calls[:next(i for i, (name, _) in enumerate(kernel.calls) if name == "CreateProcessW")]))
        self.assertFalse(actual.retain_after_worker()); self.assertEqual(control.retained, [])
        owner.start_readers(lambda *_: None); owner.resume(); owner.request_stop()
        for reader in owner.readers: reader.join(1)
        self.assertTrue(owner.observe_retirement()); self.assertTrue(owner.observe_retirement())
        self.assertTrue(all(h.closed for h in owner.handles)); self.assertEqual(control.retained, [descriptor()["maximumCopyBytes"]])
        self.assertIn(actual.physical_path, kernel.nodes)  # Retained bytes, NOT deletion.

    def test_stop_during_copy_prevents_process_creation_and_preserves_source_charge(self):
        graph, kernel, control = self.graph(); owner = graph.owner; current = True
        actual = owner.bind_model_graph(descriptor(), control, control)
        def stop(name):
            nonlocal current
            if name == "ReadFile": current = False
        kernel.after = stop
        with self.assertRaises(n.LaunchUnavailable): owner.prepare(lambda: current)
        self.assertFalse(owner.create_attempted); self.assertTrue(actual.attempted)
        self.assertFalse(any(name in ("WriteFile", "CreateProcessW", "ResumeThread") for name, _ in kernel.calls))
        self.assertTrue(actual.charged); self.assertEqual(control.retained, [])

    def test_failed_copy_closes_every_owned_handle_but_does_not_free_or_delete_bytes(self):
        graph, kernel, control = self.graph(); kernel.short_write = True
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertTrue(graph.retain_after_worker())
        self.assertTrue(all(h.closed for h in graph.owned_handles)); self.assertEqual(len(control.retained), 1)
        self.assertIn(graph.physical_path, kernel.nodes)

    def test_unknown_reservation_ack_or_unknown_close_never_claims_retirement(self):
        graph, kernel, control = self.graph()
        def lost(_): raise RuntimeError("synthetic unknown reservation acknowledgement")
        graph.charge = lost
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertTrue(graph.charge_attempted); self.assertFalse(graph.retain_after_worker())
        graph, kernel, control = self.graph(); graph.prepare(); kernel.error_after_return = "CloseHandle"
        self.assertFalse(graph.retain_after_worker()); calls = len(kernel.calls)
        self.assertFalse(graph.retain_after_worker()); self.assertEqual(len(kernel.calls), calls)
        self.assertTrue(graph.owner.unknown); self.assertEqual(control.retained, [])

    def test_granted_duplicate_access_is_checked_and_lost_authority_cannot_be_restored(self):
        graph, kernel, control = self.graph(); graph.prepare(); kernel.duplicate_access = 0x1701ff
        with self.assertRaises(n.LaunchUnavailable): graph.inherited_handles()
        self.assertEqual(graph.phase, "failed")
        graph, kernel, control = self.graph(); graph.prepare(); control.current = False
        with self.assertRaises(n.LaunchUnavailable): graph.assert_sealed()
        control.current = True
        with self.assertRaises(n.LaunchUnavailable): graph.assert_sealed()

    def test_copy_deadline_prevents_later_file_writes_or_app_creation(self):
        graph, kernel, control = self.graph(); instant = [0.0]; graph.owner.clock = lambda: instant[0]
        kernel.after = lambda name: instant.__setitem__(0, 31.0) if name == "WriteFile" else None
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertEqual(sum(name == "WriteFile" for name, _ in kernel.calls), 1)
        self.assertFalse(any(name == "CreateProcessW" for name, _ in kernel.calls)); self.assertTrue(graph.charged)

    def test_serve_arms_stop_and_eof_before_source_preparation(self):
        class EndObservation(BaseException): pass
        for action in (None, "stop"):
            with self.subTest(action=action):
                graph, kernel, control = self.graph(); owner = graph.owner
                owner.bind_model_graph(descriptor(), control, control)
                command_read = Event()
                class Input(io.BytesIO):
                    reads = 0
                    def readline(self, size=-1):
                        self.reads += 1
                        if self.reads > 1: command_read.set()
                        return super().readline(size)
                data = json.dumps(boot()).encode() + b"\n"
                if action:
                    data += json.dumps({"schema": "windows-original-worker-command-v1", "nonce": boot()["nonce"],
                                       "profileDigest": boot()["profileDigest"], "action": action}).encode() + b"\n"
                original_prepare = owner.prepare
                observed = []
                def prepare(current):
                    read = command_read.wait(0.2)
                    # Wait for actual parsed Stop/EOF, not just readline entry.
                    for _ in range(20):
                        if not current(): break
                        Event().wait(0.01)
                    observed.append((read, current() is False))
                    original_prepare(current)
                owner.prepare = prepare
                with patch.object(n.time, "sleep", side_effect=EndObservation), self.assertRaises(EndObservation):
                    n.serve(Input(data), io.BytesIO(), owner_factory=lambda _: owner)
                # These assertions MUST stay outside serve's error handler.
                self.assertEqual(observed, [(True, True)])
                self.assertEqual(control.charges, []); self.assertEqual(kernel.calls, [])

    def test_construction_excludes_foreign_control_and_data_writers_from_atomic_creation(self):
        graph, kernel, _ = self.graph(); observed = []
        def probe(node):
            attempts = {mask: kernel.foreign_open_allowed(node, mask) for mask in (0x40000, 0x80000, 0x100, 0x10, 0x40, 2, 4, 0x10000)}
            observed.append(attempts)
        kernel.after_create = probe; graph.prepare()
        self.assertEqual(len(observed), 4)
        self.assertTrue(all(all(allowed is False for allowed in attempts.values()) for attempts in observed))
        # There are no later mutable-control pathname opens to grandfather.
        for name, args in kernel.calls:
            if name == "NtCreateFile" and args[7] != 2:
                self.assertEqual(args[1] & 0xD0156, 0)

    def test_missing_creator_rights_and_unknown_creator_access_query_deny_before_copy_or_dispatch(self):
        graph, kernel, _ = self.graph(); kernel.creator_access = 0x120089
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertFalse(any(name in ("WriteFile", "CreateProcessW") for name, _ in kernel.calls))
        self.assertTrue(graph.attempted); self.assertTrue(graph.charged)
        graph, kernel, _ = self.graph()
        kernel.after_create = lambda _: setattr(kernel, "error_after_return", "NtQueryObject")
        with self.assertRaises(n.LaunchUnavailable): graph.prepare()
        self.assertTrue(graph.owner.unknown); self.assertEqual(graph.owner.pending[-1]["name"], "NtQueryObject")
        self.assertTrue(graph.owner.pending[-1]["value_returned"])
        self.assertFalse(graph.retain_after_worker())

    def test_closed_or_missing_fields_unsafe_names_and_formats_are_refused_without_io(self):
        for mutate in (lambda v: v.update(ready=True), lambda v: v.pop("maximumCopyBytes"),
                       lambda v: v.update(freshName=".."), lambda v: v.update(sourcePath="\\\\server\\share"),
                       lambda v: v["files"][0].update(name="custom.py"), lambda v: v["files"].append(copy.deepcopy(v["files"][0])),
                       lambda v: v.update(bufferBytes=True), lambda v: v.update(preparationMs=0)):
            value = descriptor(); mutate(value)
            with self.assertRaises(n.LaunchUnavailable): self.graph(value)


if __name__ == "__main__": unittest.main()

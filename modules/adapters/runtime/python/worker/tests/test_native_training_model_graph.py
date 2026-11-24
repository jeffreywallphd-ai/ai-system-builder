"""Actual source-copy ABI code with in-memory Win32 replies; no Native effects."""
import copy
import ctypes as C
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from queue import Queue
import struct
import sys
from threading import Event
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
            if h["node"] is None: a[3]._obj.value = 0; return 0, 109
            raw = h["node"]["data"][h["offset"]:h["offset"] + a[2]]
            C.memmove(a[1], bytes(raw), len(raw)); a[3]._obj.value = len(raw); h["offset"] += len(raw); return 1, 0
        if name == "WriteFile":
            h = self.obj(a[0]); size = a[2] - 1 if self.short_write else a[2]
            raw = C.string_at(a[1], size); h["node"]["data"].extend(raw); a[3]._obj.value = size
            if self.after_write: self.after_write(h["node"])
            return 1, 0
        if name == "FlushFileBuffers": return 1, 0
        if name == "DuplicateHandle":
            h = self.obj(a[1]); value = self.handle(h["node"], a[4] if self.duplicate_access is None else self.duplicate_access, bool(a[5])); self.handles[value]["share"] = h["share"]
            a[3]._obj.value = value; return 1, 0
        if name == "NtQueryObject": a[2]._obj[1] = self.obj(a[0])["access"]; a[4]._obj.value = C.sizeof(a[2]._obj); return 0, 0
        if name == "GetHandleInformation": a[1]._obj.value = int(self.obj(a[0])["inherit"]); return 1, 0
        if name == "CloseHandle": self.obj(a[0])["closed"] = True; return 1, 0
        if name in ("CreateJobObjectW", "CreateFileW"): return self.handle(inherit=name == "CreateFileW"), 0
        if name == "CreatePipe": a[0]._obj.value = self.handle(inherit=True); a[1]._obj.value = self.handle(inherit=True); return 1, 0
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
            a[9]._obj.process, a[9]._obj.thread = self.handle(), self.handle()
            a[9]._obj.pid, a[9]._obj.tid = 123, 456; return 1, 0
        if name == "IsProcessInJob": a[2]._obj.value = 1; return 1, 0
        if name == "QueryFullProcessImageNameW": a[2].value = "X:/inert/python.exe"; a[3]._obj.value = len(a[2].value); return 1, 0
        if name == "GetProcessTimes": a[1]._obj.low = 1; return 1, 0
        if name == "ResumeThread": return 1, 0
        if name == "TerminateJobObject": self.active = 0; return 1, 0
        if name == "WaitForSingleObject": return (0 if self.active == 0 else 258), 0
        if name == "DeleteProcThreadAttributeList": return None, 0
        raise AssertionError("Unexpected native operation: " + name)


class SourceLaunchExchangeTests(unittest.TestCase):
    def journey(self, refuse=None):
        value = boot(); value["schema"] = "windows-original-worker-launch-v2"; value["modelSource"] = descriptor()
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
                if refuse:
                    with self.assertRaises(EndObservation): n.serve(Source(), Sink(), owner_factory=factory)
                else: self.assertEqual(n.serve(Source(), Sink(), owner_factory=factory), 0)
        finally: lines.put(b"")
        return frames, owners[0], kernel, inherited_rights

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

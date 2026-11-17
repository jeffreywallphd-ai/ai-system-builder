"""Explicit, fresh synthetic Windows source capture checks. No model or old tree.

Run only with --native. Requires the current trusted fixed OCR product resource
for the final PDF case; absence fails qualification and never triggers a build.
"""
from __future__ import annotations

import ctypes as c
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid

from modules.adapters.runtime.python.worker.ocr import source_snapshot as s, windows_process
from modules.adapters.runtime.python.worker.ocr.protocol import OcrCancelled, OcrContractError
from modules.adapters.runtime.python.worker.ocr.provider import local_provider
from modules.adapters.runtime.python.worker.ocr.recognition import recognize_pdf_document
from modules.adapters.runtime.python.worker.ocr.windows_api import Windows, need
from modules.adapters.runtime.python.worker.tests.qualification_ocr_windows import ROOT, OCR, directory, digest, fresh_operator, save
from modules.adapters.runtime.python.worker.tests.qualification_ocr_documents import LABELS, fixtures, product_resource_identity

RUNS = ROOT / ".local-codex/ocr-source-v1"
DATA = b"%PDF-1.7 synthetic source identity\n" * 4000
NAME = "0001-synthetic.pdf"
_PROBES = {}


class _ProbeOwner:
    """Retain each extra qualification handle before testing its close."""

    def __init__(self, native, path, access):
        need(not _PROBES, "uncertain-source-probe")
        self.native, self.handle = native, None
        self._attempted_close, self._retired = False, False
        self.valid, self.error = False, None
        _PROBES[id(self)] = self
        # If acquisition raises, its outcome is unknown: retain the owner and
        # refuse further probes. No generic retry or cleanup path is provided.
        self.handle = native.k.CreateFileW(str(path), access, 7, None, 3, 0, None)
        self.error = c.get_last_error()
        self.valid = bool(self.handle and self.handle != c.c_void_p(-1).value)
        if not self.valid:
            self._retired = True  # An invalid returned handle owns no resource.
            del _PROBES[id(self)]

    def close(self):
        if self._retired or self._attempted_close:
            return self._retired
        self._attempted_close = True
        if not self.valid:
            return False  # Unknown acquisition is not proof of no handle.
        try:
            self._retired = bool(self.native.k.CloseHandle(self.handle))
        except BaseException:
            self._retired = False
        if self._retired:
            del _PROBES[id(self)]
        return self._retired


def source_fresh():
    fresh_operator()
    need(not _PROBES and not s._CAPTURE_LOCK.locked(), "source-qualification-ownership-retained")


class ObservedKernel:
    def __init__(self, native, before_read=None):
        self.native, self.before_read = native, before_read
        self.active, self.opened, self.closed = set(), 0, 0

    def __getattr__(self, name):
        return getattr(self.native.k, name)

    def CreateFileW(self, *args):
        handle = self.native.k.CreateFileW(*args)
        if handle and handle != c.c_void_p(-1).value:
            self.active.add(handle)
            self.opened += 1
        return handle

    def ReadFile(self, *args):
        if self.before_read is not None:
            action, self.before_read = self.before_read, None
            action()
        return self.native.k.ReadFile(*args)

    def CloseHandle(self, handle):
        result = self.native.k.CloseHandle(handle)
        if result:
            need(handle in self.active, "source-observer-owned-handle")
            self.active.remove(handle)
            self.closed += 1
        return result


class ObservedWindows:
    def __init__(self, native, before_read=None):
        self.k = ObservedKernel(native, before_read)
        self.inheritable = native.inheritable


class WindowsOcrSourceSnapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        need(os.name == "nt" and Path.cwd() == ROOT, "fixed-windows-qualification-required")
        source_fresh()
        cls.native = Windows()
        directory(RUNS, create=True)
        cls.folder = RUNS / uuid.uuid4().hex
        need(not cls.folder.exists(), "fresh-source-run-required")
        directory(cls.folder, create=True)
        cls.sources = {path.relative_to(ROOT).as_posix(): digest(path) for path in [
            *[OCR / name for name in ("source_snapshot.py", "resource.py", "windows_api.py", "windows_process.py",
                                     "protocol.py", "provider.py", "recognition.py", "wire.py", "native/WindowsOcrHelper.cs")],
            Path(__file__).absolute(),
            ROOT / "modules/adapters/runtime/python/worker/tests/qualification_ocr_documents.py",
            ROOT / "modules/adapters/runtime/python/worker/tests/qualification_ocr_windows.py"]}
        cls.product_identity = product_resource_identity()
        save(cls.folder / "run.json", {"schema_version": "windows-ocr-source-snapshot-qualification-v1",
             "sources": cls.sources, "run_id": cls.folder.name, "synthetic_only": True,
             "models_used": False, "fixed_product_resource": cls.product_identity,
             "product_enabled": False, "application_authorization_qualified": False,
             "parent_qualification": False})
        print(json.dumps({"source_snapshot_run_id": cls.folder.name}), flush=True)

    @classmethod
    def tearDownClass(cls):
        source_fresh()
        need(product_resource_identity() == cls.product_identity, "product-resource-drift")
        need(all(digest(ROOT / name) == value for name, value in cls.sources.items()), "source-drift")

    def setUp(self):
        source_fresh()
        self.observations = []

    def tearDown(self):
        source_fresh()
        save(self.folder / (self._testMethodName + ".json"), {"observations": self.observations,
             "source_cleanup_confirmed": True, "product_enabled": False, "parent_qualification": False})

    def stage(self, data=DATA):
        source_fresh()
        parent = self.folder / ("p-" + uuid.uuid4().hex[:8])
        need(not parent.exists(), "fresh-source-parent-required")
        directory(parent, create=True)
        root = parent / ("ai-system-builder-runtime-" + uuid.uuid4().hex)
        directory(root, create=True)
        with (root / NAME).open("xb") as stream:
            stream.write(data)
        binding = s.OcrSourceBinding(str(root), NAME, "synthetic-artifact", len(data), hashlib.sha256(data).hexdigest())
        return parent, root, binding

    def capture(self, root, binding, *, before_read=None, cancelled=lambda: False):
        observer = ObservedWindows(self.native, before_read)
        try:
            with patch.object(s, "Windows", return_value=observer):
                return s.capture_source(binding, stage_root=str(root), local_path=str(root / NAME),
                                        artifact_id="synthetic-artifact", cancelled=cancelled)
        finally:
            need(not observer.k.active and observer.k.opened == observer.k.closed, "source-handle-retirement")
            self.observations.append({"native_opens": observer.k.opened,
                                      "acknowledged_closes": observer.k.closed})

    def denied_open(self, path, access):
        probe = _ProbeOwner(self.native, path, access)
        if probe.valid:
            need(probe.close(), "unexpected-open-close")
            self.fail("A protected source operation unexpectedly succeeded.")
        self.assertEqual(probe.error, 32)  # Actual sharing violation.

    def denied_rename(self, source):
        try:
            os.rename(source, source.with_name(source.name + "-moved"))
        except OSError as error:
            self.assertEqual(error.winerror, 32)
        else:
            self.fail("A protected source rename unexpectedly succeeded.")

    def test_01_pinned_file_and_ancestor_sharing_controls(self):
        parent, root, binding = self.stage()
        def during_read():
            self.denied_open(root / NAME, 0x40000000)
            self.denied_open(root / NAME, 0x10000)
            self.denied_rename(root / NAME)
            self.denied_rename(root)
            self.denied_rename(parent)
            with (root / NAME).open("rb") as stream:
                self.assertEqual(stream.read(len(DATA) + 1), DATA)
        self.assertEqual(self.capture(root, binding, before_read=during_read), DATA)
        drive_type = self.native.k.GetDriveTypeW(root.anchor)
        self.assertEqual(drive_type, 3)
        # Confirm protection retires: a new writer to this exact fresh fixture is
        # admitted after capture. Do not modify or remove its preserved bytes.
        probe = _ProbeOwner(self.native, root / NAME, 0x40000000)
        need(probe.valid, "source-retired-writer")
        need(probe.close(), "source-retired-writer-close")
        self.observations.append({"denied_sharing_operations": 5, "permitted_read": True,
                                  "writer_admitted_after_retirement": True, "fixed_drive_type": drive_type})

    def test_02_wrong_content_before_capture_is_not_the_authorized_source(self):
        _, root, binding = self.stage()
        replacement = root / "replacement.pdf"
        with replacement.open("xb") as stream:
            stream.write(b"x" * len(DATA))
        os.replace(replacement, root / NAME)
        with self.assertRaises(OcrContractError):
            self.capture(root, binding)
        _, root, binding = self.stage()
        os.rename(root, root.with_name(root.name + "-original"))
        root.mkdir()
        with (root / NAME).open("xb") as stream:
            stream.write(b"y" * len(DATA))
        with self.assertRaises(OcrContractError):
            self.capture(root, binding)
        self.observations.append({"pre_acquisition_wrong_file_denied": True,
                                  "pre_acquisition_wrong_root_content_denied": True})

    def test_03_hardlink_and_junction_paths_are_refused(self):
        import _winapi
        _, root, binding = self.stage()
        os.link(root / NAME, root / "second-link.pdf")
        with self.assertRaises(OcrContractError):
            self.capture(root, binding)
        _, root, binding = self.stage()
        target = root.with_name(root.name + "-target")
        os.rename(root, target)
        _winapi.CreateJunction(str(target), str(root))
        with self.assertRaises(OcrContractError):
            self.capture(root, binding)
        _, root, binding = self.stage()
        os.rename(root / NAME, root / "preserved-original.pdf")
        target = root / "leaf-junction-target"
        target.mkdir()
        _winapi.CreateJunction(str(target), str(root / NAME))
        with self.assertRaises(OcrContractError):
            self.capture(root, binding)
        self.observations.append({"hardlink_denied": True, "root_junction_denied": True,
                                  "leaf_junction_denied": True})

    def test_04_cancellation_does_not_return_bytes_or_retain_clean_leases(self):
        _, root, binding = self.stage()
        with self.assertRaises(OcrCancelled):
            self.capture(root, binding, cancelled=lambda: True)
        cancelled = [False]
        with self.assertRaises(OcrCancelled):
            self.capture(root, binding, before_read=lambda: cancelled.__setitem__(0, True),
                         cancelled=lambda: cancelled[0])
        self.assertEqual(self.capture(root, binding), DATA)
        self.observations.append({"cancel_before_capture": True, "cancel_during_bounded_read": True,
                                  "fresh_capture_after_confirmed_retirement": True})

    def test_05_captured_scanned_pdf_feeds_the_fixed_real_provider(self):
        inputs, tools = fixtures(self.native)
        _, root, binding = self.stage(inputs["pdf"])
        captured = self.capture(root, binding)
        journals = []
        execute = windows_process._execute
        def observed(*args):
            value, journal = execute(*args)
            journals.append(journal)
            save(self.folder / ("recognition-" + str(len(journals)) + ".json"), journal)
            return value, journal
        with patch.object(windows_process, "_execute", side_effect=observed):
            result = recognize_pdf_document(captured, "en-US", local_provider(), lambda: False)
        self.assertEqual(result.source_sha256, binding.sha256)
        self.assertEqual([page.number for page in result.pages], [1, 2, 3, 4, 5])
        self.assertTrue(all(label in " ".join(line.text for line in page.lines)
                            for page, label in zip(result.pages, LABELS)))
        self.assertTrue(journals and all(journal["cleanup_confirmed"] for journal in journals))
        self.observations.append({"captured_source_digest_matches": True, "all_five_pages_match": True,
                                  "native_exchanges": len(journals), "strict_native_cleanup": True,
                                  "fixture_tools": tools})


if __name__ == "__main__":
    if sys.argv[1:] == ["--native"]:
        unittest.main(argv=[sys.argv[0]], verbosity=2, failfast=True)
    else:
        raise SystemExit("Use --native for the fixed local Windows source qualification.")

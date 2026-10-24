"""Explicit synthetic Windows OCR document checks, never ordinary discovery.

Uses installed Pillow/Arial only to create synthetic fixtures. No model, provider
credential, private document, download, product resource or old run is used.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import uuid

from modules.adapters.runtime.python.worker.ocr import provider as adapter, resource, windows_process
from modules.adapters.runtime.python.worker.ocr.protocol import OcrCancelled, OcrRequest
from modules.adapters.runtime.python.worker.ocr.windows_api import Windows, need
from modules.adapters.runtime.python.worker.tests.qualification_ocr_windows import (
    ROOT, OCR, build, directory, digest, fresh_operator, save,
)

RUNS = ROOT / ".local-codex/ocr-document-qualification-v1"
LABELS = ("INVOICE 4826", "ORDER 7259", "TOTAL 3648", "RECEIPT 9152", "REPORT 8374")
# Pillow's 144 dpi PDF fixture has a 500x200 point page. WinRT uses 96 DIPs
# per inch, and the bounded helper renders at scale2 with integer flooring.
# These are rendered-page dimensions, not the embedded image's pixel size.
PDF_RENDER_SIZE = (int(1000 * 96 / 144 * 2), int(400 * 96 / 144 * 2))


def fixtures(native):
    # Fixture tools are not runtime/provider dependencies. Absence is a failed
    # qualification precondition, not a skip or permission to install anything.
    from PIL import Image, ImageDraw, ImageFont
    font_path = Path(native.environment()["SystemRoot"]) / "Fonts/arial.ttf"
    need(font_path.is_file(), "installed-fixture-font-required")
    font = ImageFont.truetype(str(font_path), 64)
    images = []
    for label in LABELS:
        image = Image.new("RGB", (1000, 400), "white")
        ImageDraw.Draw(image).text((60, 140), label, fill="black", font=font)
        images.append(image)
    def encode(image, media, **options):
        stream = io.BytesIO()
        image.save(stream, format=media, **options)
        return stream.getvalue()
    rotated = images[0].transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif()
    exif[274] = 6  # Stored pixels counterclockwise; viewing orientation is upright.
    scanned_pdf = encode(images[0], "PDF", save_all=True, append_images=images[1:], resolution=144)
    result = {"png": encode(images[0], "PNG"), "jpeg": encode(images[1], "JPEG", quality=95),
              "rotated-jpeg": encode(rotated, "JPEG", quality=95, exif=exif),
              "pdf": scanned_pdf, "blank": encode(Image.new("RGB", (1000, 400), "white"), "PNG"),
              "dimension-denial": encode(Image.new("RGB", (4097, 10), "white"), "PNG"),
              "pixel-denial": encode(Image.new("RGB", (3000, 2000), "white"), "PNG")}
    import PIL
    return result, {"pillow_version": PIL.__version__, "font_sha256": digest(font_path)}


class WindowsOcrDocuments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        need(os.name == "nt" and Path.cwd() == ROOT, "fixed-windows-qualification-required")
        fresh_operator()
        cls.native = Windows()
        directory(RUNS, create=True)
        cls.folder = RUNS / uuid.uuid4().hex
        need(not cls.folder.exists(), "fresh-document-run-required")
        directory(cls.folder, create=True)
        cls.bundle = cls.folder / "helper"
        cls.sources = {str(path.relative_to(ROOT)): digest(path) for path in [
            *[OCR / name for name in ("provider.py", "protocol.py", "wire.py", "resource.py",
                                     "windows_api.py", "windows_process.py", "native/WindowsOcrHelper.cs")],
            Path(__file__).absolute(),
            ROOT / "modules/adapters/runtime/python/worker/tests/qualification_ocr_windows.py"]}
        build(cls.bundle, OCR / "native/WindowsOcrHelper.cs", cls.native)
        cls.inputs, tools = fixtures(cls.native)
        need(all(digest(ROOT / name) == value for name, value in cls.sources.items()), "source-drift")
        save(cls.folder / "run.json", {"schema_version": "windows-ocr-document-qualification-v1",
             "sources": cls.sources, "fixture_tools": tools,
             "fixture_sha256": {name: hashlib.sha256(raw).hexdigest() for name, raw in cls.inputs.items()},
             "run_id": cls.folder.name, "synthetic_only": True, "models_used": False,
             "product_enabled": False, "parent_qualification": False})

    @classmethod
    def tearDownClass(cls):
        fresh_operator()
        need(all(digest(ROOT / name) == value for name, value in cls.sources.items()), "source-drift")

    def setUp(self):
        fresh_operator()
        self.journals = []
        execute = windows_process._execute
        def observed(frame, cancelled):
            result, journal = execute(frame, cancelled)
            self.journals.append(journal)
            save(self.folder / (self._testMethodName + "-" + str(len(self.journals)) + ".json"), journal)
            return result, journal
        self.resource_patch = patch.object(windows_process, "open_resource",
                                          side_effect=lambda native: resource._open_bundle(native, self.bundle))
        self.execute_patch = patch.object(windows_process, "_execute", side_effect=observed)
        self.resource_patch.start()
        self.execute_patch.start()
        self.addCleanup(self.resource_patch.stop)
        self.addCleanup(self.execute_patch.stop)
        self.reader = adapter.local_provider()

    def tearDown(self):
        for journal in self.journals:
            self.assertTrue(journal["cleanup_confirmed"], journal)
            self.assertTrue(journal["all_handles_closed"])
            if journal["accounting"] is not None:
                self.assertEqual(journal["accounting"]["active"], 0)
            self.assertEqual(journal["observed_bytes"]["stderr"], 0)
        fresh_operator()

    def recognize(self, key, media, pages=(1,), language="en-US", cancelled=lambda: False):
        request = OcrRequest(self.inputs[key], media, pages, language)
        start = len(self.journals)
        result = self.reader.recognize(request, cancelled)
        self.assertEqual(result.source_sha256, request.source_sha256)
        self.assertEqual(tuple(page.number for page in result.pages), pages)
        self.assertEqual((result.provider, result.version, result.language), ("windows", "1", language))
        self.assertTrue(all(journal["passed"] for journal in self.journals[start:]))
        return result

    def assert_text(self, page, expected, size=(1000, 400)):
        text = " ".join(line.text for line in page.lines)
        self.assertTrue(expected in text, "Synthetic OCR text did not match the expected label.")
        self.assertTrue(page.lines)
        self.assertEqual((page.width, page.height), size)
        for line in page.lines:
            self.assertGreater(line.width, 0)
            self.assertGreater(line.height, 0)
            self.assertLessEqual(line.left + line.width, page.width)
            self.assertLessEqual(line.top + line.height, page.height)

    def test_01_installed_canonical_and_absent_languages(self):
        self.assertTrue(self.reader.readiness("en-US", lambda: False).available)
        self.assertEqual(self.reader.readiness("zz-ZZ", lambda: False).reason, "language-unavailable")
        self.assertEqual(self.reader.readiness("en-us", lambda: False).reason, "language-unavailable")

    def test_02_png_text_geometry_and_blank(self):
        self.assert_text(self.recognize("png", "image/png").pages[0], LABELS[0])
        self.assertEqual(self.recognize("blank", "image/png").pages[0].lines, ())

    def test_03_jpeg_text_and_geometry(self):
        self.assert_text(self.recognize("jpeg", "image/jpeg").pages[0], LABELS[1])

    def test_04_exif_rotated_jpeg_matches_viewed_page(self):
        self.assert_text(self.recognize("rotated-jpeg", "image/jpeg").pages[0], LABELS[0])

    def test_05_scanned_pdf_preserves_selected_original_pages(self):
        result = self.recognize("pdf", "application/pdf", (2, 5))
        self.assertEqual(result.source_page_count, 5)
        self.assert_text(result.pages[0], LABELS[1], PDF_RENDER_SIZE)
        self.assert_text(result.pages[1], LABELS[4], PDF_RENDER_SIZE)

    def test_06_malformed_size_pixel_and_page_denials_retire(self):
        cases = [(b"not a private source image", "image/png", (1,)),
                 (self.inputs["dimension-denial"], "image/png", (1,)),
                 (self.inputs["pixel-denial"], "image/png", (1,)),
                 (self.inputs["pdf"], "application/pdf", (6,)),
                 (self.inputs["png"], "image/jpeg", (1,))]
        for source, media, pages in cases:
            with self.subTest(media=media, pages=pages), self.assertRaises(windows_process.OcrProcessError):
                self.reader.recognize(OcrRequest(source, media, pages, "en-US"), lambda: False)

    def test_07_cancellation_before_launch_and_during_recognition(self):
        with self.assertRaises(OcrCancelled):
            self.recognize("png", "image/png", cancelled=lambda: True)
        # Readiness completes first. The callback then cancels only after the
        # recognition owner has resumed its newly created process.
        calls = []
        def during():
            if len(self.journals) == 2:  # Prior pre-launch denial plus ready exchange.
                calls.append(True)
                return len(calls) > 1
            return False
        with self.assertRaises(OcrCancelled):
            self.recognize("pdf", "application/pdf", (1, 2, 3, 4, 5), cancelled=during)
        self.assertTrue(self.journals[-1]["assigned_at_creation"])
        self.assertTrue(self.journals[-1]["resumed_after_membership"])
        self.assertTrue(self.journals[-1]["forced"])
        self.assertEqual(self.journals[-1]["reason"], "cancelled")
        self.assert_text(self.recognize("png", "image/png").pages[0], LABELS[0])


if __name__ == "__main__":
    if sys.argv[1:] != ["--native"]:
        raise SystemExit("Use --native for the fixed synthetic Windows OCR document qualification.")
    unittest.main(argv=[sys.argv[0]], verbosity=2, failfast=True)

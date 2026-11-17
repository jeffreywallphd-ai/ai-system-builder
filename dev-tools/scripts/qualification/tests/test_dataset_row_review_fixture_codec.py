"""Real model-free Parquet checks for the finite composed-UI golden data.

These calls qualify the codec function only, not a sidecar, model, OCR engine,
native process lifecycle or the TypeScript registry's real worker wiring.
"""
from __future__ import annotations

import base64
from contextlib import contextmanager
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest

import pyarrow as pa
import pyarrow.parquet as pq

from modules.adapters.runtime.python.worker.models import ReviewDatasetRequest
from modules.adapters.runtime.python.worker.tasks.review_dataset import review_dataset

FIXTURE = Path(__file__).parent / "fixtures/dataset-row-review.parquet.json"


def fixtures():
    raw = FIXTURE.read_bytes()
    if len(raw) > 128 * 1024:
        raise AssertionError("Golden fixture exceeds its declared bound.")
    value = json.loads(raw)
    assert value["schema_version"] == "dataset-row-review-fixture-v1"
    assert set(value["variants"]) == {"source", "edited", "rejected", "edited-rejected"}
    for variant in value["variants"].values():
        content = base64.b64decode(variant["base64"], validate=True)
        assert 0 < len(content) == variant["sizeBytes"] < 65536
        assert hashlib.sha256(content).hexdigest() == variant["sha256"]
        assert 0 < len(variant["rows"]) <= 64
    return value


@contextmanager
def owned_stage():
    parent = Path(tempfile.gettempdir()).resolve()
    root = Path(tempfile.mkdtemp(prefix="dataset-fixture-codec-", dir=parent)).resolve()
    identity = (root.stat().st_dev, root.stat().st_ino)
    assert root.parent == parent and not root.is_symlink()
    try:
        yield root
    finally:
        assert root.resolve().parent == parent and not root.is_symlink()
        assert (root.stat().st_dev, root.stat().st_ino) == identity
        for child in root.iterdir():
            assert child.name in {"input.parquet", "reviewed.parquet"}
            assert child.is_file() and not child.is_symlink()
            assert child.stat().st_nlink == 1 and child.stat().st_size < 65536
            child.unlink()
        root.rmdir()


def request(root, operation, **fields):
    return ReviewDatasetRequest(
        operation=operation,
        inputPath=str(root / "input.parquet"),
        runtime={"runtimeWorkingDirectory": str(root)},
        **fields,
    )


class DatasetRowReviewFixtureCodecTests(unittest.TestCase):
    def test_real_reader_matches_every_typed_golden_row_and_page_fingerprint(self):
        for name, variant in fixtures()["variants"].items():
            with self.subTest(variant=name), owned_stage() as root:
                content = base64.b64decode(variant["base64"], validate=True)
                parquet = pq.ParquetFile(BytesIO(content))
                self.assertEqual(parquet.metadata.num_rows, len(variant["rows"]))
                self.assertEqual(str(parquet.schema_arrow), variant["schema"])
                self.assertEqual(parquet.read().to_pylist(), variant["rows"])
                (root / "input.parquet").write_bytes(content)
                actual = [review_dataset(request(root, "read", page=index, pageSize=10))
                          for index in range(len(variant["pages"]))]
                self.assertEqual(actual, variant["pages"])

    def test_real_replacements_and_rejections_preserve_schema_and_expected_rows(self):
        fixture = fixtures()
        for source, operation, target in [
            ("source", "replace", "edited"),
            ("source", "reject", "rejected"),
            ("edited", "reject", "edited-rejected"),
        ]:
            with self.subTest(source=source, operation=operation), owned_stage() as root:
                before, after = fixture["variants"][source], fixture["variants"][target]
                content = base64.b64decode(before["base64"], validate=True)
                (root / "input.parquet").write_bytes(content)
                response = review_dataset(request(
                    root, operation, rowIndex=0,
                    rowFingerprint=before["pages"][0]["rows"][0]["rowFingerprint"],
                    **({"replacementRow": fixture["editedRow"]} if operation == "replace" else {}),
                ))
                self.assertEqual(response["totalRows"], len(after["rows"]))
                result = pq.read_table(root / "reviewed.parquet")
                self.assertEqual(result.to_pylist(), after["rows"])
                self.assertEqual(str(result.schema), after["schema"])
                self.assertEqual((root / "input.parquet").read_bytes(), content)

    def test_stale_and_schema_invalid_edits_create_no_output_and_preserve_input(self):
        fixture = fixtures()
        source = fixture["variants"]["source"]
        content = base64.b64decode(source["base64"], validate=True)
        for fault in ["stale", "schema"]:
            with self.subTest(fault=fault), owned_stage() as root:
                (root / "input.parquet").write_bytes(content)
                row = {**fixture["editedRow"], **({"priority": "invalid integer"} if fault == "schema" else {})}
                with self.assertRaisesRegex(RuntimeError, "reviewed row changed" if fault == "stale" else "columns and value types"):
                    review_dataset(request(
                        root, "replace", rowIndex=0,
                        rowFingerprint="sha256:" + "0" * 64 if fault == "stale" else source["pages"][0]["rows"][0]["rowFingerprint"],
                        replacementRow=row,
                    ))
                self.assertFalse((root / "reviewed.parquet").exists())
                self.assertEqual((root / "input.parquet").read_bytes(), content)

    def test_real_codec_refuses_rejection_of_the_only_row(self):
        with owned_stage() as root:
            pq.write_table(pa.Table.from_pylist([fixtures()["variants"]["source"]["rows"][0]]), root / "input.parquet")
            before = (root / "input.parquet").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "only remaining row"):
                review_dataset(request(root, "reject"))
            self.assertFalse((root / "reviewed.parquet").exists())
            self.assertEqual((root / "input.parquet").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ModuleNotFoundError:
    pa = None
    pq = None

from modules.adapters.runtime.python.worker.models import ReviewDatasetRequest
from modules.adapters.runtime.python.worker.tasks.review_dataset import _bounded_text
from modules.adapters.runtime.python.worker.tasks.review_dataset import _read_page, _fingerprint, _MAX_INPUT_BYTES

if pa is not None:
    from modules.adapters.runtime.python.worker.tasks.review_dataset import review_dataset
else:
    review_dataset = None


class ReviewDatasetBoundsTests(unittest.TestCase):
    def test_bounds_utf8_row_preview_text_to_the_remaining_budget(self) -> None:
        budget = [16]
        preview = _bounded_text("source text " * 20, budget)
        self.assertLessEqual(len(preview.encode("utf-8")), 16)
        self.assertEqual(budget[0], 0)


@unittest.skipIf(pa is None, "pyarrow is not installed in this test environment")
class ReviewDatasetTests(unittest.TestCase):
    def test_footer_selects_only_overlapping_groups_and_converts_only_page_slices(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "input.parquet"
            table = pa.table({"value": [f"item {index}" for index in range(100)]})
            pq.write_table(table, source, row_group_size=10)
            actual = pq.ParquetFile(source)

            class Batch:
                def __init__(self, batch, converted):
                    self.batch = batch
                    self.num_rows = batch.num_rows
                    self.converted = converted

                def to_pylist(self):
                    raise AssertionError("Unbounded or preceding batch conversion")

                def slice(self, start, length):
                    self.converted.append(length)
                    return self.batch.slice(start, length)

            class Traced:
                metadata = actual.metadata

                def __init__(self):
                    self.groups = []
                    self.converted = []

                def iter_batches(self, **options):
                    self.groups.append(options.get("row_groups"))
                    for batch in actual.iter_batches(**options):
                        yield Batch(batch, self.converted)

            traced = Traced()
            page = _read_page(traced, 100, 9, 10)
            self.assertEqual(traced.groups, [[9]])
            self.assertEqual(sum(traced.converted), 10)
            self.assertEqual([r["rowIndex"] for r in page["rows"]], list(range(90, 100)))
            self.assertEqual(page["rows"][0]["rowFingerprint"], _fingerprint({"value": "item 90"}))
            crossing = Traced()
            self.assertEqual([r["rowIndex"] for r in _read_page(crossing, 100, 1, 25)["rows"]], list(range(25, 50)))
            self.assertEqual(crossing.groups, [[2, 3, 4]])
            self.assertEqual(sum(crossing.converted), 25)
            outside = Traced()
            self.assertEqual(_read_page(outside, 100, 10, 10)["rows"], [])
            self.assertEqual(outside.groups, [])
            actual.close()

    def test_skips_preceding_batches_inside_one_group_without_python_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "input.parquet"
            pq.write_table(pa.table({"value": list(range(200))}), source)
            result = _read_page(pq.ParquetFile(source), 200, 9, 10)
            self.assertEqual([r["values"]["value"] for r in result["rows"]], list(range(90, 100)))

    def test_denies_oversized_source_before_parquet_parse_and_recovers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            with source.open("wb") as stream:
                stream.truncate(_MAX_INPUT_BYTES + 1)
            request = ReviewDatasetRequest(operation="read", inputPath=str(source), page=0, pageSize=10, runtime={"runtimeWorkingDirectory":str(root)})
            with patch("pyarrow.parquet.ParquetFile", side_effect=AssertionError("must not parse")) as parse:
                with self.assertRaisesRegex(RuntimeError, "bounded non-empty"):
                    review_dataset(request)
                parse.assert_not_called()
            pq.write_table(pa.table({"value":["Recovered"]}),source)
            self.assertEqual(review_dataset(request)["rows"][0]["values"]["value"], "Recovered")

    def test_reads_a_bounded_page_with_fingerprints(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(
                pa.table({"instruction": [f"item {index}" for index in range(12)]}),
                source,
            )
            result = review_dataset(
                ReviewDatasetRequest(
                    operation="read",
                    inputPath=str(source),
                    page=1,
                    pageSize=10,
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            self.assertEqual(result["totalRows"], 12)
            self.assertEqual([row["rowIndex"] for row in result["rows"]], [10, 11])
            self.assertRegex(result["rows"][0]["rowFingerprint"], r"^sha256:[a-f0-9]{64}$")
            self.assertTrue(result["rows"][0]["editable"])

    def test_marks_truncated_rows_read_only_to_prevent_lossy_edits(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(pa.table({"value": ["x" * 40_000]}), source)
            result = review_dataset(
                ReviewDatasetRequest(
                    operation="read",
                    inputPath=str(source),
                    page=0,
                    pageSize=10,
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            self.assertFalse(result["rows"][0]["editable"])
            self.assertIn("truncated", result["rows"][0]["values"]["value"])

    def test_rejects_exact_reviewed_row_and_preserves_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(pa.table({"value": ["keep", "reject", "keep too"]}), source)
            page = review_dataset(
                ReviewDatasetRequest(
                    operation="read",
                    inputPath=str(source),
                    page=0,
                    pageSize=10,
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            rejected = review_dataset(
                ReviewDatasetRequest(
                    operation="reject",
                    inputPath=str(source),
                    outputHandle="reviewed.parquet",
                    rowIndex=1,
                    rowFingerprint=page["rows"][1]["rowFingerprint"],
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            self.assertEqual(rejected["totalRows"], 2)
            self.assertEqual(
                pq.read_table(root / "reviewed.parquet").column("value").to_pylist(),
                ["keep", "keep too"],
            )

    def test_replaces_exact_reviewed_row_and_preserves_schema_and_row_count(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(
                pa.table({"value": ["keep", "edit"], "score": [1, 2]}),
                source,
            )
            page = review_dataset(
                ReviewDatasetRequest(
                    operation="read",
                    inputPath=str(source),
                    page=0,
                    pageSize=10,
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            edited = review_dataset(
                ReviewDatasetRequest(
                    operation="replace",
                    inputPath=str(source),
                    outputHandle="reviewed.parquet",
                    rowIndex=1,
                    rowFingerprint=page["rows"][1]["rowFingerprint"],
                    replacementRow={"value": "edited", "score": 3},
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            table = pq.read_table(root / "reviewed.parquet")
            self.assertEqual(edited["totalRows"], 2)
            self.assertEqual(table.schema, pq.read_table(source).schema)
            self.assertEqual(table.to_pylist(), [
                {"value": "keep", "score": 1},
                {"value": "edited", "score": 3},
            ])

    def test_denies_incompatible_replacement_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(pa.table({"value": ["one"], "score": [1]}), source)
            page = review_dataset(
                ReviewDatasetRequest(
                    operation="read",
                    inputPath=str(source),
                    page=0,
                    pageSize=10,
                    runtime={"runtimeWorkingDirectory": str(root)},
                )
            )
            with self.assertRaisesRegex(RuntimeError, "columns"):
                review_dataset(
                    ReviewDatasetRequest(
                        operation="replace",
                        inputPath=str(source),
                        outputHandle="reviewed.parquet",
                        rowIndex=0,
                        rowFingerprint=page["rows"][0]["rowFingerprint"],
                        replacementRow={"value": "edited"},
                        runtime={"runtimeWorkingDirectory": str(root)},
                    )
                )
            self.assertFalse((root / "reviewed.parquet").exists())

    def test_denies_stale_row_fingerprint_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "input.parquet"
            pq.write_table(pa.table({"value": ["one", "two"]}), source)
            with self.assertRaisesRegex(RuntimeError, "changed"):
                review_dataset(
                    ReviewDatasetRequest(
                        operation="reject",
                        inputPath=str(source),
                        outputHandle="reviewed.parquet",
                        rowIndex=0,
                        rowFingerprint="sha256:" + ("f" * 64),
                        runtime={"runtimeWorkingDirectory": str(root)},
                    )
                )
            self.assertFalse((root / "reviewed.parquet").exists())

    def test_denies_input_outside_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with tempfile.TemporaryDirectory() as outside:
                root = Path(temporary)
                source = Path(outside) / "input.parquet"
                pq.write_table(pa.table({"value": ["one", "two"]}), source)
                with self.assertRaisesRegex(RuntimeError, "outside"):
                    review_dataset(
                        ReviewDatasetRequest(
                            operation="read",
                            inputPath=str(source),
                            runtime={"runtimeWorkingDirectory": str(root)},
                        )
                    )


if __name__ == "__main__":
    unittest.main()

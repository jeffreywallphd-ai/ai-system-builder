from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import pyarrow as pa

from modules.adapters.runtime.python.worker.tasks import context_artifact_operation as task


class BoundedContextValidationTests(unittest.TestCase):
    def fixture(self, mutate=None, count=513):
        digest = "sha256:" + "a" * 64
        schema = pa.schema([
            pa.field("id", pa.string(), nullable=False),
            pa.field("ordinal", pa.int64(), nullable=False),
            pa.field("text", pa.string(), nullable=False),
            pa.field("citation_json", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), 2), nullable=False),
        ])
        rows = [{"id": f"chunk-{i}", "ordinal": i, "text": f"Synthetic passage {i}", "citation_json": json.dumps({"sourceArtifactId": "fixture", "sourceDigest": digest, "chunkIndex": i}), "vector": [1.0, 0.0]} for i in range(513)]
        if mutate:
            mutate(rows[-1])
        arrow = pa.Table.from_pylist(rows, schema=schema)
        measured = {"closed": 0, "batches": [], "limit": None}

        class Reader:
            def __iter__(self):
                for batch in arrow.to_batches(max_chunksize=256):
                    measured["batches"].append(batch.num_rows)
                    yield batch

            def close(self):
                measured["closed"] += 1

        class Table:
            schema = arrow.schema

            def count_rows(self):
                return count

            def search(self):
                return self

            def limit(self, limit):
                measured["limit"] = limit
                return self

            def to_batches(self, batch_size):
                self_test.assertEqual(batch_size, 256)
                return Reader()

            def to_arrow(self):
                raise AssertionError("Full-table materialization is forbidden.")

        self_test = self
        database = SimpleNamespace(list_tables=lambda: SimpleNamespace(tables=["chunks"], page_token=None), open_table=lambda _name: Table())
        native = SimpleNamespace(connect=lambda _path: database)
        manifest = {"embedding": {"dimensions": 2}, "sources": [{"artifactId": "fixture", "digest": digest, "chunkCount": 513}], "manualEntries": []}
        return native, manifest, measured

    def test_scans_all_vectors_in_bounded_batches_without_python_vector_graph(self):
        native, manifest, measured = self.fixture()
        with patch.object(task, "_load_lancedb_modules", return_value=(native, pa)):
            _database, _table, rows, dimensions = task._validated_rag_table(Path("fixture"), manifest)
        self.assertEqual(len(rows), 513)
        self.assertEqual(dimensions, 2)
        self.assertTrue(all("vector" not in row for row in rows))
        self.assertEqual(measured, {"closed": 1, "batches": [256, 256, 1], "limit": 514})

    def test_late_vector_and_metadata_corruption_is_denied_before_results(self):
        mutations = [lambda row: row.update(vector=[float("nan"), 0.0]), lambda row: row.update(vector=[float("inf"), 0.0]), lambda row: row.update(vector=[None, 0.0]), lambda row: row.update(vector=None), lambda row: row.update(id="chunk-0"), lambda row: row.update(ordinal=0), lambda row: row.update(text=None), lambda row: row.update(citation_json=json.dumps({"sourceArtifactId": "foreign", "sourceDigest": "sha256:" + "a" * 64, "chunkIndex": 0}))]
        for mutate in mutations:
            with self.subTest(mutation=mutations.index(mutate)):
                native, manifest, measured = self.fixture(mutate)
                with patch.object(task, "_load_lancedb_modules", return_value=(native, pa)), self.assertRaises(ValueError):
                    task._validated_rag_table(Path("fixture"), manifest)
                self.assertEqual(measured["closed"], 1)
                self.assertEqual(measured["batches"], [256, 256, 1])

    def test_cancellation_interrupts_validation_and_closes_reader(self):
        native, manifest, measured = self.fixture()
        calls = 0

        def cancelled():
            nonlocal calls
            calls += 1
            if calls > 300:
                raise task.ContextArtifactOperationCancellationRequested("cancelled")

        with patch.object(task, "_load_lancedb_modules", return_value=(native, pa)), self.assertRaises(task.ContextArtifactOperationCancellationRequested):
            task._validated_rag_table(Path("fixture"), manifest, cancelled)
        self.assertEqual(measured["closed"], 1)
        self.assertLessEqual(len(measured["batches"]), 2)


if __name__ == "__main__":
    unittest.main()

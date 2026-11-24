"""Protocol, corruption, alias and bounded-allocation behavior; no runtime/model."""
import copy
import hashlib
import json
import math
from pathlib import Path
import struct
import time
import tracemalloc
import unittest
from unittest import mock

from test_roadmap import roadmap

codec = roadmap.storage_codec()
VECTORS = Path(__file__).parent / "fixtures/roadmap-storage-vectors.json"


def rehash(value):
    value["contentSha256"] = hashlib.sha256(codec.canonical({"nodes": value["nodes"], "root": value["root"]}).encode("ascii")).hexdigest()
    return codec.canonical(value).encode("ascii")


class StorageCodecTests(unittest.TestCase):
    def test_typed_values_and_protocol_vectors_roundtrip(self):
        vectors = json.loads(VECTORS.read_text(encoding="utf8"))
        self.assertEqual(vectors["schema_version"], "roadmap-storage-vectors-v1")
        self.assertGreaterEqual(len(vectors["cases"]), 6)
        for vector in vectors["cases"]:
            with self.subTest(vector=vector["id"]):
                expected = json.loads(vector["logical_json"])
                actual = codec.read_record_bytes(vector["encoded_ascii"].encode("ascii"))
                self.assertEqual(roadmap.fingerprint(actual), roadmap.fingerprint(expected))
                self.assertEqual(codec.encode_record(expected), vector["encoded_ascii"])
        values = codec.read_record_bytes(codec.encode_record({"x": [1, 1.0, -0.0, 2**80, 5e-324]}).encode())["x"]
        self.assertIs(type(values[0]), int); self.assertIs(type(values[1]), float)
        self.assertEqual(struct.pack(">d", values[2]), bytes.fromhex("8000000000000000"))
        self.assertEqual(values[3], 2**80); self.assertEqual(values[4], 5e-324)

    def test_repeated_values_are_independent_and_input_is_unchanged(self):
        shared = {"items": [1, 2]}; value = {"left": shared, "right": shared}
        before = codec.canonical(value)
        actual = codec.read_record_bytes(codec.encode_record(value).encode())
        actual["left"]["items"].append(3)
        self.assertEqual(actual["right"]["items"], [1, 2]); self.assertEqual(codec.canonical(value), before)
        self.assertIsNot(actual["left"], actual["right"])

    def test_legacy_and_crlf_physical_records_keep_their_values(self):
        value = {"simple": [1, None, True]}
        self.assertEqual(codec.read_record_bytes(json.dumps(value).encode()), value)
        encoded = codec.encode_record(value)
        self.assertEqual(codec.read_record_bytes(encoded.replace("\n", "\r\n").encode()), value)
        for raw in (b" " * (1048576 + 1), b"\xef\xbb\xbf{}", b"{\xff}"):
            with self.assertRaises(codec.StorageError): codec.read_record_bytes(raw)

    def test_duplicate_keys_noncanonical_bytes_unknown_version_and_hash_are_refused(self):
        valid = codec.encode_record({"a": [1, 2]}).encode()
        duplicate = valid.replace(b'{"contentSha256":', b'{"storageVersion":"roadmap-record-tree-v1","contentSha256":', 1)
        version = json.loads(valid); version["storageVersion"] = "unknown"
        bad_hash = json.loads(valid); bad_hash["contentSha256"] = "0" * 64
        for raw in (duplicate, b" " + valid, valid + b"\n", codec.canonical(version).encode(), codec.canonical(bad_hash).encode(), b'{"a":1,"a":2}'):
            with self.subTest(raw_size=len(raw)), self.assertRaises(codec.StorageError): codec.read_record_bytes(raw)

    def test_graph_corruption_is_refused_even_when_the_untrusted_hash_is_recomputed(self):
        valid = json.loads(codec.encode_record({"x": [1, 2], "y": {"z": True}}))
        for change in ("forward", "root-array", "duplicate-node", "unused", "extra-field", "raw-number", "bool-index"):
            value = copy.deepcopy(valid)
            root = value["nodes"][-1]
            if change == "forward": root["value"][0][1] = ["ref", len(value["nodes"]) - 1]
            elif change == "root-array": root.update(kind="array", value=[])
            elif change == "duplicate-node": value["nodes"].insert(0, copy.deepcopy(value["nodes"][0])); value["root"][1] += 1
            elif change == "unused": root["value"] = []
            elif change == "extra-field": root["unknown"] = True
            elif change == "raw-number": root["value"][0][1] = 1
            else: value["root"][1] = True
            with self.subTest(change=change), self.assertRaises(codec.StorageError): codec.read_record_bytes(rehash(value))

    def test_invalid_numeric_atoms_never_reconstruct(self):
        valid = json.loads(codec.encode_record({"value": 1}))
        for atom in (["integer", "-0"], ["integer", "01"], ["integer", "1\n"], ["integer", "1" * 4301],
                     ["float", "7ff0000000000000"], ["float", "7ff8000000000000"], ["float", "0000000000000000\n"]):
            value = copy.deepcopy(valid); value["nodes"][-1]["value"][0][1] = atom
            with self.subTest(atom_tag=atom[0]), mock.patch.object(codec, "reconstruct", side_effect=AssertionError("No reconstruction")), self.assertRaises(codec.StorageError):
                codec.read_record_bytes(rehash(value))

    def test_weighted_expansion_depth_and_cycles_are_refused_before_allocation(self):
        tree = []
        for _ in range(18): tree = [tree, tree]
        with self.assertRaises(codec.StorageError): codec.encode_record({"tree": tree})
        nodes = [{"kind": "array", "value": []}]
        for index in range(1, 20): nodes.append({"kind": "array", "value": [["ref", index - 1], ["ref", index - 1]]})
        nodes.append({"kind": "object", "value": [["tree", ["ref", len(nodes) - 1]]]})
        value = {"storageVersion": codec.VERSION, "contentSha256": "0" * 64, "root": ["ref", len(nodes) - 1], "nodes": nodes}
        with mock.patch.object(codec, "reconstruct", side_effect=AssertionError("No reconstruction")), self.assertRaises(codec.StorageError):
            codec.read_record_bytes(rehash(value))
        deep = {}
        for _ in range(65): deep = {"child": deep}
        with self.assertRaises(codec.StorageError): codec.encode_record(deep)
        cycle = {}; cycle["self"] = cycle
        with self.assertRaises(codec.StorageError): codec.encode_record(cycle)

    def test_nonfinite_unsupported_and_unpublishable_input_is_refused(self):
        for value in ({"v": math.inf}, {"v": math.nan}, {"v": object()}, {1: "not a JSON key"}, {"v": "x" * 3000}):
            with self.subTest(value_kind=type(value).__name__), self.assertRaises(codec.StorageError):
                codec.encode_record(value, maximum=1000)

    def test_bounded_container_ceiling_has_measured_python_allocation_overhead(self):
        tree = []
        for _ in range(17): tree = [tree, tree]
        raw = codec.encode_record({"tree": tree}).encode()
        self.assertLess(len(raw), 10000)
        self.assertEqual(codec.preflight(json.loads(raw))[1], codec.MAX_CONTAINERS)
        tracemalloc.start(); started = time.monotonic()
        try:
            value = codec.read_record_bytes(raw)
            _, peak = tracemalloc.get_traced_memory()
        finally: tracemalloc.stop()
        self.assertIsInstance(value["tree"], list)
        print(json.dumps({"measurement": "bounded-roadmap-container-ceiling", "expanded_containers": codec.MAX_CONTAINERS,
                          "encoded_bytes": len(raw), "python_tracked_peak_bytes": peak,
                          "elapsed_ms": round((time.monotonic() - started) * 1000, 3), "scope": "Python tracked allocations, not process RSS"}))


if __name__ == "__main__": unittest.main()

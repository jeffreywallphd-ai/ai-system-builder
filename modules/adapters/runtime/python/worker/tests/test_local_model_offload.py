from __future__ import annotations

import json
import os
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import local_model_offload as offload


CONFIG = {
    "model_type": "qwen2", "hidden_size": 8, "intermediate_size": 16,
    "num_hidden_layers": 2, "num_attention_heads": 2, "num_key_value_heads": 1,
    "vocab_size": 32, "max_position_embeddings": 4096,
}
TOKENIZER = {"model": {"type": "BPE", "vocab": {"synthetic": 0}, "merges": []}, "added_tokens": []}


def write_weights(path, header=None, payload=b"\0" * 16):
    if header is None:
        header = {"model.embed_tokens.weight": {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]}}
    body = header if isinstance(header, bytes) else json.dumps(header).encode()
    path.write_bytes(len(body).to_bytes(8, "little") + body + payload)


class OffloadInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).absolute()
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps(CONFIG), encoding="utf-8")
        self.weights = self.root / "model.safetensors"
        write_weights(self.weights)
        (self.root / "tokenizer.json").write_text(json.dumps(TOKENIZER), encoding="utf-8")
        (self.root / "tokenizer_config.json").write_text("{}", encoding="utf-8")

    def test_safe_inventory_is_bound_without_loading_a_model(self):
        inventory = offload.inspect_local_model(self.root)
        self.assertEqual(inventory.tensors[0].elements, 4)
        self.assertEqual(inventory.tensors[0].shape, (2, 2))
        self.assertEqual(len(inventory.source_digest), 64)
        self.assertEqual(len(inventory.bindings), 4)
        inventory.verify_unchanged()

    def test_same_size_weight_mutation_is_detected_by_hash(self):
        inventory = offload.inspect_local_model(self.root)
        body = self.weights.read_bytes()
        self.weights.write_bytes(body[:-1] + b"x")
        with self.assertRaises(offload.OffloadAdmissionError):
            inventory.verify_unchanged()

    def test_supplier_adapter_discovery_and_variant_inputs_deny_before_loading(self):
        for name in ("adapter_config.json", "ADAPTER_CONFIG.JSON", "adapter_model.safetensors",
                     "adapter_model.safetensors.index.json", "adapter_model-00001-of-00002.safetensors",
                     "adapter_model.fp16.safetensors", "adapter_model.bin"):
            with self.subTest(name=name):
                target = self.root / name
                target.write_text('{"base_model_name_or_path":"unadmitted-local-model"}', encoding="utf-8")
                try:
                    with self.assertRaises(offload.OffloadAdmissionError):
                        offload.inspect_local_model(self.root)
                finally:
                    target.unlink()

    def test_adapter_added_after_inventory_invalidates_before_supplier_loading(self):
        inventory = offload.inspect_local_model(self.root)
        (self.root / "adapter_config.json").write_text("{}", encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError):
            inventory.verify_unchanged()

    def test_configuration_mutation_is_detected(self):
        inventory = offload.inspect_local_model(self.root)
        self.config.write_text(json.dumps({**CONFIG, "hidden_size": 16}), encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError):
            inventory.verify_unchanged()

    def test_config_change_between_parse_and_hash_denies(self):
        original = offload._hash
        def mutate(path, deadline):
            if path == self.config:
                path.write_text(json.dumps({**CONFIG, "hidden_size": 16}), encoding="utf-8")
            return original(path, deadline)
        with patch.object(offload, "_hash", side_effect=mutate):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.inspect_local_model(self.root)


    def test_unsupported_model_and_unbounded_configs_deny(self):
        for changes in ({"model_type": "custom"}, {"auto_map": {"AutoConfig": "custom.Model"}},
                        {"quantization_config": {"bits": 4}}, {"hidden_size": True},
                        {"num_hidden_layers": 129}, {"vocab_size": 0}, {"hidden_size": 7}):
            with self.subTest(changes=changes):
                self.config.write_text(json.dumps({**CONFIG, **changes}), encoding="utf-8")
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_same_size_restamped_config_drift_denies(self):
        original = offload._hash
        def mutate(path, deadline):
            if path == self.config:
                observed = path.stat()
                path.write_bytes(path.read_bytes().replace(b'"hidden_size": 8', b'"hidden_size": 6'))
                os.utime(path, ns=(observed.st_atime_ns, observed.st_mtime_ns))
            return original(path, deadline)
        with patch.object(offload, "_hash", side_effect=mutate):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.inspect_local_model(self.root)

    def test_config_consumers_cannot_mutate_admitted_inventory(self):
        inventory = offload.inspect_local_model(self.root)
        inventory.config["head_dim"] = 2**40
        self.assertNotIn("head_dim", inventory.config)
        inventory.verify_unchanged()

    def test_allocation_overrides_and_nonfinite_rope_deny_before_torch(self):
        for changes in ({"head_dim": 2**40}, {"partial_rotary_factor": 2**40},
                        {"head_dim": True}, {"partial_rotary_factor": True},
                        {"rope_scaling": {"factor": 1e40}}, {"rope_theta": float("inf")},
                        {"use_sliding_window": "false"}, {"sliding_window": 2**40},
                        {"tie_word_embeddings": "false"}, {"unknown_allocation_field": 1},
                        {"rope_theta": 10**400}, {"pad_token_id": [1]},
                        {"bos_token_id": [1]}, {"eos_token_id": [None]}, {"eos_token_id": []}):
            with self.subTest(changes=changes):
                self.config.write_text(json.dumps({**CONFIG, **changes}), encoding="utf-8")
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_header_requires_utf8_and_string_metadata(self):
        valid = {"weight": {"dtype": "F32", "shape": [4], "data_offsets": [0, 16]}}
        for header in (json.dumps(valid).encode("utf-16"), {**valid, "__metadata__": 42},
                       {**valid, "__metadata__": {"format": 42}}):
            with self.subTest(header=header):
                write_weights(self.weights, header)
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_duplicate_keys_nonfinite_and_nondict_config_deny(self):
        for body in (b'{"model_type":"qwen2","model_type":"custom"}', b'{"x":NaN}', b'{"x":Infinity}', b'[]', b'{'):
            with self.subTest(body=body):
                self.config.write_bytes(body)
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_pickle_weight_presence_is_denied_even_if_unused(self):
        (self.root / "unused.bin").write_bytes(b"synthetic")
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.inspect_local_model(self.root)

    def test_relative_and_traversal_root_deny(self):
        for path in (Path("relative"), self.root / ".." / self.root.name):
            with self.subTest(path=path):
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(path)

    def test_sharded_inventory_requires_exact_index_coverage(self):
        shard = self.root / "model-00001-of-00001.safetensors"
        self.weights.rename(shard)
        index = self.root / "model.safetensors.index.json"
        index.write_text(json.dumps({"weight_map": {"model.embed_tokens.weight": shard.name}}), encoding="utf-8")
        self.assertEqual(len(offload.inspect_local_model(self.root).bindings), 5)
        for mapping in ({"model.embed_tokens.weight": "../model.safetensors"},
                        {"unknown.weight": shard.name}, {"model.embed_tokens.weight": "missing.safetensors"}):
            with self.subTest(mapping=mapping):
                index.write_text(json.dumps({"weight_map": mapping}), encoding="utf-8")
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_malformed_tensor_shapes_dtypes_and_offsets_deny(self):
        valid = {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]}
        for changes in ({"dtype": "custom"}, {"shape": [True, 2]}, {"shape": [-1]},
                        {"shape": [2**24, 2**24]}, {"data_offsets": [1, 17]},
                        {"data_offsets": [0, 8]}, {"extra": 1}, {"data_offsets": [False, 16]}):
            with self.subTest(changes=changes):
                write_weights(self.weights, {"model.weight": {**valid, **changes}})
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.inspect_local_model(self.root)

    def test_holes_overlaps_and_trailing_payload_deny(self):
        for offsets, payload in (([4, 20], b"\0" * 20), ([0, 16], b"\0" * 20)):
            write_weights(self.weights, {"weight": {"dtype": "F32", "shape": [4], "data_offsets": offsets}}, payload)
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.inspect_local_model(self.root)
        write_weights(self.weights, {name: {"dtype": "F32", "shape": [4], "data_offsets": [0, 16]} for name in ("a", "b")})
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.inspect_local_model(self.root)

    def test_duplicate_tensor_name_and_oversized_header_deny(self):
        write_weights(self.weights, b'{"x":{},"x":{}}')
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.inspect_local_model(self.root)
        self.weights.write_bytes((offload.MAX_HEADER_BYTES + 1).to_bytes(8, "little") + b"x")
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.inspect_local_model(self.root)

    def test_linked_weight_is_denied_without_opening_it(self):
        from types import SimpleNamespace
        # Exercise the real guard; synthetic observations do not qualify native races.
        for observation in (SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0),
                            SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=0x400)):
            with self.subTest(observation=observation), patch.object(Path, "lstat", return_value=observation), patch.object(Path, "open") as opened:
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload._regular(self.weights)
                opened.assert_not_called()

    def test_inspection_deadline_and_aggregate_byte_limit_deny(self):
        with patch.object(offload, "MAX_INSPECTION_SECONDS", -1):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.inspect_local_model(self.root)
        with patch.object(offload, "MAX_MODEL_BYTES", self.weights.stat().st_size + 1):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.inspect_local_model(self.root)

    def test_errors_do_not_expose_paths_or_configuration(self):
        self.config.write_text("synthetic-private-config", encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError) as caught:
            offload.inspect_local_model(self.root)
        self.assertNotIn(str(self.root), str(caught.exception))
        self.assertNotIn("private", str(caught.exception))

    def test_added_checkpoint_selection_and_tokenizer_drift_deny(self):
        inventory = offload.inspect_local_model(self.root)
        added = self.root / "model.safetensors.index.json"
        added.write_text("{}", encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError):
            inventory.verify_unchanged()
        added.unlink()
        (self.root / "tokenizer.json").write_text('{"changed":true}', encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError):
            inventory.verify_unchanged()


class OffloadPlacementTests(unittest.TestCase):
    def test_ram_refinement_moves_tied_and_unsplit_placements_together(self):
        sizes = {"embed.weight": 40, "head.weight": 40, "layer.a": 10, "layer.b": 10, "next.weight": 20}
        before = {"embed": "cpu", "head": "cpu", "layer.a": "cpu", "layer.b": "cpu", "next": "cpu"}
        groups = (("embed.weight", "head.weight"),)
        unsplit = (("layer.a", "layer.b"),)
        after = offload.fit_cpu_residency(before, sizes, maximum_bytes=30, tied_groups=groups, unsplit_groups=unsplit)
        self.assertEqual(after, {"embed": "disk", "head": "disk", "layer.a": "disk", "layer.b": "disk", "next": "cpu"})
        self.assertEqual(set(before.values()), {"cpu"})
        self.assertEqual(offload.validate_device_map(after, sizes, device="cpu", tied_groups=groups, unsplit_groups=unsplit), (20, 0))

    def test_ram_refinement_cannot_make_all_disk_or_change_cuda_execution(self):
        after = offload.fit_cpu_residency({"": "cpu"}, {"weight": 40}, maximum_bytes=0, tied_groups=(), unsplit_groups=())
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.validate_device_map(after, {"weight": 40}, device="cpu", tied_groups=(), unsplit_groups=())
        cuda = offload.fit_cpu_residency({"cuda": 0, "cpu": "cpu"}, {"cuda.weight": 40, "cpu.weight": 20}, maximum_bytes=0, tied_groups=(), unsplit_groups=())
        self.assertEqual(cuda, {"cuda": 0, "cpu": "disk"})
        for limit in (-1, True, offload.CPU_WEIGHT_LIMIT + 1):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.fit_cpu_residency({"": "cpu"}, {"weight": 40}, maximum_bytes=limit, tied_groups=(), unsplit_groups=())

    def test_cpu_map_keeps_ties_and_decoder_layer_together(self):
        sizes = {"model.embed.weight": 32, "lm_head.weight": 32, "model.layers.0.q.weight": 16, "model.layers.0.v.weight": 16}
        self.assertEqual(offload.validate_device_map(
            {"model.embed": "cpu", "lm_head": "cpu", "model.layers": "disk"}, sizes,
            device="cpu", tied_groups=(("model.embed.weight", "lm_head.weight"),),
            unsplit_groups=(("model.layers.0.q.weight", "model.layers.0.v.weight"),)), (32, 0))

    def test_all_disk_missing_unsupported_and_oversized_maps_deny(self):
        for device_map, sizes, device in (
            ({"": "disk"}, {"a": 1}, "cpu"),
            ({"a": "cpu"}, {"a": 1, "b": 1}, "cpu"),
            ({"": 1}, {"a": 1}, "cuda"),
            ({"": 0}, {"a": 1}, "cpu"),
            ({"": "cpu"}, {"a": 1}, "cuda"),
            ({"": "cpu"}, {"a": offload.CPU_WEIGHT_LIMIT + 1}, "cpu"),
            ({"": "meta"}, {"a": 1}, "cpu"),
            ({"": False}, {"a": 1}, "cuda"),
            ({"": "cpu", "unused": "disk"}, {"a": 1}, "cpu"),
        ):
            with self.subTest(device_map=device_map, device=device):
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.validate_device_map(device_map, sizes, device=device, tied_groups=(), unsplit_groups=())

    def test_split_ties_or_decoder_layers_deny(self):
        for tied in (True, False):
            # Same invariant is applied to ties and atomic decoder layers.
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.validate_device_map({"a": "cpu", "b": "disk"}, {"a": 16, "b": 16}, device="cpu", tied_groups=(("a", "b"),) if tied else (), unsplit_groups=() if tied else (("a", "b"),))

    def resource_args(self):
        return dict(dtype_bytes=2, device="cpu", cpu_weight_bytes=100, cuda_weight_bytes=0,
                    largest_layer_bytes=100, largest_source_tensor_bytes=100, largest_target_tensor_bytes=100, largest_conversion_source_bytes=0, available_cpu_bytes=8 * 1024**3,
                    available_cuda_bytes=0, available_disk_bytes=1024**3, staging_reservation_bytes=1024)

    def test_resource_plan_separates_runtime_kv_scratch_from_weights(self):
        plan = offload.plan_resources(CONFIG, **self.resource_args())
        expected_kv = 2 * 2 * 2560 * 1 * 4 * 2
        self.assertEqual(plan.kv_bytes, expected_kv)
        self.assertGreater(plan.prefill_scratch_bytes, 0)
        self.assertEqual(plan.cpu_required_bytes, 200 + 1024**3 + 2 * expected_kv + plan.prefill_scratch_bytes)
        self.assertEqual(plan.cuda_required_bytes, 0)

    def test_unknown_insufficient_overflow_and_invalid_resource_facts_deny(self):
        for changes in ({"available_cpu_bytes": 0}, {"available_cuda_bytes": None},
                        {"available_disk_bytes": 1024}, {"available_cpu_bytes": True},
                        {"cpu_weight_bytes": offload.CPU_WEIGHT_LIMIT + 1},
                        {"largest_layer_bytes": offload.CPU_WEIGHT_LIMIT + 1},
                        {"staging_reservation_bytes": offload.STAGING_LIMIT + 1},
                        {"dtype_bytes": 8}, {"device": "auto"}, {"cuda_weight_bytes": 1}):
            with self.subTest(changes=changes):
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.plan_resources(CONFIG, **{**self.resource_args(), **changes})

    def test_cuda_reserves_execution_memory_on_the_selected_device(self):
        args = {**self.resource_args(), "device": "cuda", "available_cuda_bytes": 8 * 1024**3, "cuda_weight_bytes": 1024**3}
        plan = offload.plan_resources(CONFIG, **args)
        self.assertGreater(plan.cuda_required_bytes, plan.cuda_weight_bytes + plan.largest_layer_bytes)
        self.assertEqual(plan.cpu_required_bytes, 1024**3 + 300)
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.plan_resources(CONFIG, **{**args, "available_cuda_bytes": plan.cuda_required_bytes - 1})

    def test_source_width_and_conversion_transient_are_admitted_before_loading(self):
        args = {**self.resource_args(), "device": "cuda", "available_cuda_bytes": 8 * 1024**3,
                "largest_layer_bytes": 1024**3, "largest_source_tensor_bytes": 2 * 1024**3,
                "largest_target_tensor_bytes": 1024**3, "cuda_weight_bytes": 1024**3}
        plan = offload.plan_resources(CONFIG, **args)
        self.assertEqual(plan.loading_transient_bytes, 3 * 1024**3)
        self.assertEqual(plan.cpu_required_bytes, 100 + 4 * 1024**3)
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.plan_resources(CONFIG, **{**args, "available_cpu_bytes": 3 * 1024**3})

    def test_disk_execution_reserves_source_dtype_conversion_on_cpu_and_cuda(self):
        for source, target, width in ((400, 200, 2), (200, 400, 4), (200, 200, 2)):
            for device in ("cpu", "cuda"):
                args = {**self.resource_args(), "device": device, "dtype_bytes": width,
                        "available_cuda_bytes": 8 * 1024**3, "largest_layer_bytes": target,
                        "largest_source_tensor_bytes": source, "largest_target_tensor_bytes": target,
                        "largest_conversion_source_bytes": source}
                plan = offload.plan_resources(CONFIG, **args)
                self.assertEqual(plan.conversion_transient_bytes, source)
                key = "available_cpu_bytes" if device == "cpu" else "available_cuda_bytes"
                required = plan.cpu_required_bytes if device == "cpu" else plan.cuda_required_bytes
                with self.subTest(source=source, target=target, device=device), self.assertRaises(offload.OffloadAdmissionError):
                    offload.plan_resources(CONFIG, **{**args, key: required - 1})
                offload.plan_resources(CONFIG, **{**args, key: required})


class OwnedOffloadLeaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).absolute()

    def test_exclusive_slot_lasts_until_confirmed_release(self):
        lease = offload.OwnedOffloadLease(self.root, 1024)
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.OwnedOffloadLease(self.root, 1024)
        lease.seal()
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.cleanup(model_released=False)
        self.assertTrue(lease.path.exists())
        lease.cleanup(model_released=True)
        self.assertTrue(lease.released)
        lease.cleanup(model_released=True)
        second = offload.OwnedOffloadLease(self.root, 1024)
        second.seal()
        second.cleanup(model_released=True)

    def test_safe_index_cleanup_preserves_model_and_siblings(self):
        model = self.root / "original.safetensors"
        model.write_bytes(b"synthetic-model")
        sibling = self.root / "user-file"
        sibling.write_bytes(b"untouched")
        lease = offload.OwnedOffloadLease(self.root, 1024)
        (lease.path / "index.json").write_text("{}", encoding="utf-8")
        lease.seal()
        lease.cleanup(model_released=True)
        self.assertEqual(model.read_bytes(), b"synthetic-model")
        self.assertEqual(sibling.read_bytes(), b"untouched")

    def test_unsealed_changed_foreign_or_oversized_contents_are_retained(self):
        for kind in ("unsealed", "changed", "foreign", "oversized"):
            with self.subTest(kind=kind), TemporaryDirectory(dir=self.root) as temporary:
                lease = offload.OwnedOffloadLease(Path(temporary), 1024)
                if kind == "oversized":
                    (lease.path / "index.json").write_bytes(b"x" * 1024)
                    with self.assertRaises(offload.OffloadAdmissionError):
                        lease.seal()
                elif kind != "unsealed":
                    lease.seal()
                    (lease.path / ("owner" if kind == "changed" else "foreign")).write_bytes(b"changed")
                with self.assertRaises(offload.OffloadAdmissionError):
                    lease.cleanup(model_released=True)
                self.assertTrue(lease.path.exists())
                self.assertFalse(lease.released)

    def test_cleanup_failure_keeps_ownership_and_allows_confirmed_retry(self):
        lease = offload.OwnedOffloadLease(self.root, 1024)
        index = lease.path / "index.json"
        index.write_text("{}", encoding="utf-8")
        lease.seal()
        original = Path.unlink
        def fail(path, *args, **kwargs):
            if path == index:
                raise PermissionError("synthetic")
            return original(path, *args, **kwargs)
        with patch.object(Path, "unlink", new=fail):
            with self.assertRaises(offload.OffloadAdmissionError):
                lease.cleanup(model_released=True)
        self.assertFalse(lease.released)
        lease.cleanup(model_released=True)
        self.assertTrue(lease.released)



    def test_cleanup_retries_after_index_and_owner_removal_without_adoption(self):
        for failure in ("owner", "directory"):
            with self.subTest(failure=failure), TemporaryDirectory(dir=self.root) as temporary:
                lease = offload.OwnedOffloadLease(Path(temporary), 1024)
                (lease.path / "index.json").write_text("{}", encoding="utf-8")
                lease.seal()
                unlink, rmdir = Path.unlink, Path.rmdir
                def fail_unlink(path, *args, **kwargs):
                    if failure == "owner" and path == lease.path / "owner":
                        raise PermissionError("synthetic")
                    return unlink(path, *args, **kwargs)
                def fail_rmdir(path, *args, **kwargs):
                    if failure == "directory" and path == lease.path:
                        raise PermissionError("synthetic")
                    return rmdir(path, *args, **kwargs)
                with patch.object(Path, "unlink", new=fail_unlink), patch.object(Path, "rmdir", new=fail_rmdir):
                    with self.assertRaises(offload.OffloadAdmissionError):
                        lease.cleanup(model_released=True)
                self.assertIn("index.json", lease._removed)
                self.assertEqual("owner" in lease._removed, failure == "directory")
                lease.seal()  # Retry verifies remaining owned objects; it cannot reset the seal.
                lease.cleanup(model_released=True)
                self.assertTrue(lease.released)

    def test_recreated_already_removed_file_cannot_be_adopted_on_retry(self):
        lease = offload.OwnedOffloadLease(self.root, 1024)
        index = lease.path / "index.json"
        index.write_text("{}", encoding="utf-8")
        lease.seal()
        original = Path.unlink
        def fail_owner(path, *args, **kwargs):
            if path == lease.path / "owner":
                raise PermissionError("synthetic")
            return original(path, *args, **kwargs)
        with patch.object(Path, "unlink", new=fail_owner):
            with self.assertRaises(offload.OffloadAdmissionError):
                lease.cleanup(model_released=True)
        index.write_text("foreign", encoding="utf-8")
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.seal()
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.cleanup(model_released=True)
        self.assertEqual(index.read_text(encoding="utf-8"), "foreign")


if __name__ == "__main__":
    unittest.main()

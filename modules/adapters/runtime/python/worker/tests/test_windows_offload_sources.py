"""Synthetic inventory records only: no files, Windows APIs or model imports."""
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import pickle
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import local_model_offload as m
from modules.adapters.runtime.python.worker.tasks import windows_offload_sources as s

CONFIG = {'model_type': 'qwen2', 'hidden_size': 8, 'intermediate_size': 16,
          'num_hidden_layers': 2, 'num_attention_heads': 2, 'num_key_value_heads': 1,
          'vocab_size': 32, 'max_position_embeddings': 4096}


def digest(rows):
    return hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()


def inventory():
    config = json.dumps(CONFIG).encode()
    rows = (('config.json', len(config), hashlib.sha256(config).hexdigest()),
            ('model.safetensors', 128, '1' * 64),
            ('tokenizer.json', 2, '2' * 64), ('tokenizer_config.json', 2, '3' * 64))
    return m.LocalModelInventory(Path('C:/synthetic-model-input') if os.name == 'nt'
        else Path('/synthetic-model-input'), config,
        (m.TensorInventoryEntry('layer.weight', 'model.safetensors', 'F32', (2, 2), 4),),
        rows, digest(rows), tuple(sorted(row[0] for row in rows)))


def with_rows(original, rows, **kwargs):
    return replace(original, bindings=rows, source_digest=digest(rows), **kwargs)


class OriginalInventoryBindingTests(unittest.TestCase):
    def deny(self, value):
        with self.assertRaises(m.OffloadAdmissionError) as failure:
            s.capture_original_model_inventory(value)
        self.assertEqual(str(failure.exception), str(m.OffloadAdmissionError()))

    def test_same_original_is_checked_without_any_input_or_native_io(self):
        original = inventory()
        with patch.object(Path, 'open', side_effect=AssertionError('unexpected IO')), \
             patch.object(Path, 'stat', side_effect=AssertionError('unexpected IO')), \
             patch.object(Path, 'lstat', side_effect=AssertionError('unexpected IO')), \
             patch.object(Path, 'resolve', side_effect=AssertionError('unexpected IO')), \
             patch.object(m, 'inspect_local_model', side_effect=AssertionError('inspection forbidden')), \
             patch.object(m.LocalModelInventory, 'verify_unchanged', side_effect=AssertionError('file IO forbidden')):
            binding = s.capture_original_model_inventory(original)
            self.assertIsNone(binding.assert_original(original))
            self.assertIsNone(binding.assert_original(original))
        self.assertNotIn(str(original.root), repr(binding))
        self.assertNotIn(original.source_digest, repr(binding))

    def test_manually_constructed_records_are_not_inspector_or_file_proof(self):
        # These hashes describe no existing file. Admission proves structure only.
        value = inventory()
        self.assertIsNone(s.capture_original_model_inventory(value).assert_original(value))
        self.assertEqual(m.STAGING_LIMIT, 12 * 1024**3)
        self.assertEqual(m.MAX_MODEL_BYTES, 20 * 1024**3)

    def test_capture_and_checks_cannot_import_a_model_or_native_provider(self):
        value = inventory()
        with patch('builtins.__import__', side_effect=AssertionError('runtime import forbidden')):
            binding = s.capture_original_model_inventory(value)
            self.assertIsNone(binding.assert_original(value))

    def test_inert_binding_exposes_no_file_budget_or_native_lease_operation(self):
        binding = s.capture_original_model_inventory(inventory())
        for name in ('open', 'read', 'borrow', 'reserve', 'assert_protected', 'current_guarded_context'):
            self.assertFalse(hasattr(binding, name))

    def test_foreign_equal_inventory_is_not_the_original(self):
        original = inventory(); foreign = replace(original)
        with self.assertRaises(m.OffloadAdmissionError):
            s.capture_original_model_inventory(original).assert_original(foreign)

    def test_copy_deepcopy_and_pickle_cannot_transfer_a_binding(self):
        binding = s.capture_original_model_inventory(inventory())
        for operation in (copy.copy, copy.deepcopy, pickle.dumps):
            with self.subTest(operation=operation.__name__), self.assertRaises(m.OffloadAdmissionError):
                operation(binding)

    def test_raw_copied_slots_keep_the_wrong_origin(self):
        original = inventory(); binding = s.capture_original_model_inventory(original)
        copied = object.__new__(s._OriginalInventoryBinding)
        for slot in s._OriginalInventoryBinding.__slots__:
            name = '_OriginalInventoryBinding' + slot
            object.__setattr__(copied, name, getattr(binding, name))
        with self.assertRaises(m.OffloadAdmissionError):copied.assert_original(original)

    def test_every_original_field_replacement_is_denied(self):
        for name, value in [('root', Path('/different-input').absolute()),
                            ('_config_bytes', b'{}'), ('tensors', ()), ('bindings', ()),
                            ('source_digest', 'a' * 64), ('directory_names', ())]:
            original = inventory(); binding = s.capture_original_model_inventory(original)
            object.__setattr__(original, name, value)
            with self.subTest(field=name), self.assertRaises(m.OffloadAdmissionError):
                binding.assert_original(original)

    def test_tensor_fact_mutation_cannot_rewrite_the_captured_snapshot(self):
        original = inventory(); binding = s.capture_original_model_inventory(original)
        object.__setattr__(original.tensors[0], 'shape', (1, 4))
        with self.assertRaises(m.OffloadAdmissionError):binding.assert_original(original)

    def test_construction_drift_does_not_return_an_inconsistent_binding(self):
        original = inventory();actual = s._facts;calls = []
        def drift(value):
            facts = actual(value);calls.append(True)
            if len(calls) == 1:object.__setattr__(value, 'source_digest', 'a' * 64)
            return facts
        with patch.object(s, '_facts', side_effect=drift):self.deny(original)

    def test_private_snapshot_and_field_reference_substitution_denies(self):
        for field in ('__facts', '__fields'):
            original = inventory(); binding = s.capture_original_model_inventory(original)
            old = getattr(binding, '_OriginalInventoryBinding' + field)
            object.__setattr__(binding, '_OriginalInventoryBinding' + field, tuple(list(old)))
            with self.subTest(field=field), self.assertRaises(m.OffloadAdmissionError):
                binding.assert_original(original)

    def test_missing_foreign_subclass_and_extra_inventory_fields_deny(self):
        class Foreign(m.LocalModelInventory):pass
        for candidate in (None, {}, object(), Foreign(**vars(inventory()))):self.deny(candidate)
        candidate = inventory(); object.__setattr__(candidate, 'extra', True); self.deny(candidate)

    def test_root_requires_the_original_concrete_absolute_path_shape(self):
        for root in ('C:/private-root', Path('relative-model'), Path('/root/../model'), None):
            self.deny(replace(inventory(), root=root))

    def test_unsafe_root_and_long_root_deny(self):
        base = 'C:/' if os.name == 'nt' else '/'
        for tail in ('private\nvalue', 'name.', 'name ', 'a' * 2050):
            self.deny(replace(inventory(), root=Path(base + tail)))

    def test_nonbuiltin_containers_are_denied_without_callbacks(self):
        calls = []
        class UntrustedTuple(tuple):
            def __iter__(self):calls.append('iter');return super().__iter__()
            def __len__(self):calls.append('len');return super().__len__()
        for field in ('tensors', 'bindings', 'directory_names'):
            candidate = inventory(); object.__setattr__(candidate, field, UntrustedTuple(getattr(candidate, field)))
            calls.clear(); self.deny(candidate); self.assertEqual(calls, [])

    def test_nonstring_dictionary_keys_deny_before_equality_callbacks(self):
        calls = []
        class UntrustedKey:
            def __hash__(self):calls.append('hash');return 42
            def __eq__(self, other):calls.append('equal');return False
        candidate = inventory(); fields = vars(candidate).copy();fields.pop('root');fields[UntrustedKey()] = None
        object.__setattr__(candidate, '__dict__', fields);calls.clear();self.deny(candidate);self.assertEqual(calls, [])

    def test_config_requires_exact_bounded_bytes(self):
        for body in (b'', '{}', bytearray(b'{}'), b'x' * (m.MAX_CONFIG_BYTES + 1), b'not-json'):
            self.deny(replace(inventory(), _config_bytes=body))

    def test_unsafe_or_nonfinite_config_denies_even_with_matching_config_hash(self):
        for patch_config in ({'auto_map': {'AutoConfig': 'untrusted'}}, {'model_type': 'custom'},
                             {'hidden_size': True}, {'rope_theta': float('inf')}):
            original = inventory();body = json.dumps({**CONFIG, **patch_config}).encode()
            rows = (('config.json', len(body), hashlib.sha256(body).hexdigest()),) + original.bindings[1:]
            self.deny(with_rows(original, rows, _config_bytes=body))

    def test_config_size_or_hash_cannot_disagree_with_retained_bytes(self):
        original = inventory()
        for row in (('config.json', 1, original.bindings[0][2]),
                    ('config.json', len(original._config_bytes), 'a' * 64)):
            self.deny(with_rows(original, (row,) + original.bindings[1:]))

    def test_binding_count_is_bounded_before_walking_rows(self):
        for rows in ((), inventory().bindings[:3], (None,) * (m.MAX_SHARDS + 11)):
            self.deny(replace(inventory(), bindings=rows))

    def test_binding_row_types_sizes_and_hashes_are_exact(self):
        original = inventory()
        for row in (['model.safetensors', 128, '1' * 64], ('model.safetensors',),
                    ('model.safetensors', True, '1' * 64), ('model.safetensors', 0, '1' * 64),
                    ('model.safetensors', m.MAX_MODEL_BYTES + 1, '1' * 64),
                    ('model.safetensors', 128, 'G' * 64), ('model.safetensors', 128, 'short')):
            self.deny(with_rows(original, (original.bindings[0], row) + original.bindings[2:]))

    def test_source_budget_does_not_reuse_or_credit_the_staging_budget(self):
        original = inventory();size = m.STAGING_LIMIT + 128
        rows = (original.bindings[0], ('model.safetensors', size, '1' * 64)) + original.bindings[2:]
        tensor = replace(original.tensors[0], shape=(2**24, 192), elements=2**24 * 192)
        value = with_rows(original, rows, tensors=(tensor,))
        self.assertIsNone(s.capture_original_model_inventory(value).assert_original(value))
        rows = (original.bindings[0], ('model.safetensors', m.MAX_MODEL_BYTES, '1' * 64)) + original.bindings[2:]
        self.deny(with_rows(original, rows))

    def test_canonical_binding_order_duplicates_and_missing_files_deny(self):
        original = inventory()
        for rows in (original.bindings[::-1], original.bindings + original.bindings[-1:],
                     original.bindings[:-1] + (('unknown.json', 2, '4' * 64),)):
            self.deny(with_rows(original, rows))

    def test_directory_names_are_bounded_sorted_and_case_unique(self):
        original = inventory()
        for names in ((), original.directory_names[::-1], original.directory_names + ('config.json',),
                      tuple(sorted((*original.directory_names, 'CONFIG.JSON'))),
                      ('a',) * (m.MAX_TENSORS + 1), (None,)):
            self.deny(replace(original, directory_names=names))

    def test_discovery_metadata_and_unsafe_names_deny(self):
        original = inventory()
        for name in ('adapter_config.json', 'ADAPTER_MODEL.safetensors', 'pytorch_model.bin',
                     '../private', 'a/b', 'a\\b', 'x:stream', 'name.', 'a' * 256):
            self.deny(replace(original, directory_names=tuple(sorted((*original.directory_names, name)))))

    def test_known_optional_files_and_all_weight_files_must_be_bound(self):
        original = inventory()
        for name in ('generation_config.json', 'model-00002.safetensors', 'model.safetensors.index.json'):
            self.deny(replace(original, directory_names=tuple(sorted((*original.directory_names, name)))))

    def test_optional_tokenizer_metadata_can_be_structurally_bound(self):
        original = inventory();row = ('generation_config.json', 2, '4' * 64)
        rows = original.bindings[:2] + (row,) + original.bindings[2:]
        value = with_rows(original, rows, directory_names=tuple(sorted((*original.directory_names, row[0]))))
        self.assertIsNone(s.capture_original_model_inventory(value).assert_original(value))

    def test_tokenizer_and_index_record_sizes_are_bounded(self):
        original = inventory()
        for index, maximum in ((2, 32 * 1024**2), (3, 8 * 1024**2)):
            rows = list(original.bindings);name, _, file_digest = rows[index];rows[index] = (name, maximum + 1, file_digest)
            self.deny(with_rows(original, tuple(rows)))

    def test_source_digest_is_exact_and_order_bound(self):
        for value in (None, True, 'x' * 64, 'a' * 63, 'a' * 64):
            self.deny(replace(inventory(), source_digest=value))

    def test_tensor_record_count_and_type_are_bounded(self):
        for tensors in ((), (None,), (inventory().tensors[0],) * (m.MAX_TENSORS + 1)):
            self.deny(replace(inventory(), tensors=tensors))

    def test_tensor_name_shard_dtype_shape_and_count_deny(self):
        original = inventory();tensor = original.tensors[0]
        for change in ({'name': '../private'}, {'shard': 'missing.safetensors'}, {'dtype': 'custom'},
                       {'shape': [2, 2]}, {'shape': (True, 2)}, {'shape': (2**24 + 1,)},
                       {'shape': (2,) * 9}, {'elements': True}, {'elements': 5}):
            self.deny(replace(original, tensors=(replace(tensor, **change),)))
        self.deny(replace(original, tensors=(tensor, tensor)))

    def test_tensor_element_product_is_bounded_without_allocating_weights(self):
        original = inventory();tensor = replace(original.tensors[0], shape=(2**24, 2**24), elements=2**48)
        self.deny(replace(original, tensors=(tensor,)))

    def test_single_tensor_payload_cannot_exceed_its_shard(self):
        original = inventory();tensor = replace(original.tensors[0], shape=(1024,), elements=1024)
        self.deny(replace(original, tensors=(tensor,)))

    def test_combined_tensor_payload_cannot_exceed_its_shard(self):
        original = inventory();tensor = replace(original.tensors[0], shape=(4, 4), elements=16)
        self.deny(replace(original, tensors=(tensor, replace(tensor, name='other.weight'))))

    def test_shard_remainder_cannot_be_an_unbounded_header(self):
        original = inventory();rows = list(original.bindings)
        # The known payload is16 bytes; header bytes must still fit the source cap.
        rows[1] = ('model.safetensors', 16 + 8 + m.MAX_HEADER_BYTES + 1, '1' * 64)
        self.deny(with_rows(original, tuple(rows)))

    def test_indexed_shards_are_ordered_and_covered(self):
        original = inventory();first, second = 'model-00001.safetensors', 'model-00002.safetensors'
        rows = (original.bindings[0], ('model.safetensors.index.json', 100, '4' * 64),
                (first, 128, '5' * 64), (second, 128, '6' * 64)) + original.bindings[2:]
        tensors = (replace(original.tensors[0], shard=first),
                   replace(original.tensors[0], name='other.weight', shard=second))
        value = with_rows(original, rows, tensors=tensors, directory_names=tuple(sorted(row[0] for row in rows)))
        self.assertIsNone(s.capture_original_model_inventory(value).assert_original(value))
        self.deny(replace(value, tensors=tensors[:1]))
        oversized = rows[:1] + ((rows[1][0], m.MAX_HEADER_BYTES + 1, rows[1][2]),) + rows[2:]
        self.deny(with_rows(value, oversized))


if __name__ == '__main__':unittest.main()

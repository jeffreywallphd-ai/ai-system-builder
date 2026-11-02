"""Synthetic inventory records only: no files, Windows APIs or model imports."""
import copy
import ctypes as C
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import pickle
import struct
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


class FakeFunction:
    def __init__(self, owner, name):self.owner,self.name = owner,name
    def __call__(self,*args):return self.owner.call(self.name,args)


class FakeSourceNative:
    """Memory-only ABI replies; no OS handle, real deadline or model evidence."""
    def __init__(self):
        self.payloads = {'config.json':json.dumps(CONFIG).encode(),
            'model.safetensors':b'x'*128,'tokenizer.json':b'{}','tokenizer_config.json':b'{}'}
        self.functions = {name:FakeFunction(self,name) for name in (
            'NtCreateFile','NtCreateEvent','NtReadFile','CloseHandle','ResetEvent',
            'GetFileInformationByHandleEx','GetVolumeInformationByHandleW','GetDriveTypeW',
            'DeviceIoControl','WaitForSingleObject','CancelIoEx','GetOverlappedResult')}
        self.handles,self.guards,self.calls = {},{},[]
        self.next_handle = 100
        self.fault = None
        self.pending_read = False
        self.native_error = 997
        self.open_access = []
        self.dll_calls = []

    def __getattr__(self,name):return self.functions[name]
    def load(self,name,**kwargs):
        self.dll_calls.append((name,kwargs))
        return self
    def value(self):
        original = inventory()
        rows = tuple((name,len(self.payloads[name]),hashlib.sha256(self.payloads[name]).hexdigest())
                     for name,_,_ in original.bindings)
        return with_rows(original,rows)
    def pointer(self,pointer,kind):return C.cast(pointer,C.POINTER(kind)).contents
    def call(self,name,args):
        self.calls.append((name,args))
        if self.fault:self.fault(name,args)
        if name in ('NtCreateFile','NtCreateEvent'):
            self.next_handle += 1
            self.pointer(args[0],C.c_void_p).value = self.next_handle
            if name == 'NtCreateFile':
                attrs = self.pointer(args[2],s.w._Attributes)
                text = attrs.name.contents
                leaf = C.wstring_at(text.buffer,text.length//2)
                directory = bool(args[8]&1)
                self.handles[self.next_handle] = (leaf,directory)
                io = self.pointer(args[3],s.w._Io);io.status,io.information = 0,1
                self.open_access.append((args[1],args[6],args[7],args[8]))
            else:self.handles[self.next_handle] = ('event',False)
            return 0
        if name == 'GetDriveTypeW':return 3
        if name == 'GetVolumeInformationByHandleW':
            self.pointer(args[5],C.c_uint32).value = 8
            args[6].value = 'NTFS'
            return 1
        if name == 'GetFileInformationByHandleEx':
            handle,kind,pointer,_ = args
            leaf,directory = self.handles[handle]
            size = 0 if directory else len(self.payloads[leaf])
            if kind == 9:
                data = C.cast(pointer,C.POINTER(C.c_uint32))
                data[0],data[1] = (0x10 if directory else 0x80),0
            elif kind == 18:
                C.memmove(pointer,(1).to_bytes(8,'little')+handle.to_bytes(16,'little'),24)
            elif kind == 1:
                data = self.pointer(pointer,s.w._Standard)
                data.allocated,data.size,data.links,data.delete_pending,data.directory = size,size,1,0,0
            elif kind == 7:
                raw = struct.pack('<IIqq',0,14,size,size)+'::$DATA'.encode('utf-16-le')
                C.memmove(pointer,raw,len(raw))
            else:raise AssertionError('unexpected metadata class')
            return 1
        if name == 'DeviceIoControl':
            ov = self.pointer(args[7],s.w._Overlapped)
            self.guards[ov.event] = (args[0],ov,False)
            C.set_last_error(self.native_error)
            return 0
        if name == 'ResetEvent':return 1
        if name == 'WaitForSingleObject':
            if args[0] in self.guards:return 0 if self.guards[args[0]][2] else 258
            return 0
        if name == 'NtReadFile':
            handle,event,_,_,pointer,buffer,length,offset,_ = args
            start = self.pointer(offset,C.c_int64).value
            data = self.payloads[self.handles[handle][0]][start:start+length]
            C.memmove(buffer,data,len(data))
            io = self.pointer(pointer,s.w._Io)
            io.status,io.information = (0x103 if self.pending_read else 0),len(data)
            return 0x103 if self.pending_read else 0
        if name == 'CancelIoEx':
            ov = self.pointer(args[1],s.w._Overlapped)
            handle,original,_ = self.guards[ov.event]
            original.internal = 0xc0000120
            self.guards[ov.event] = (handle,original,True)
            return 1
        if name == 'GetOverlappedResult':
            self.pointer(args[2],C.c_uint32).value = 0
            C.set_last_error(995)
            return 0
        if name == 'CloseHandle':return 1
        raise AssertionError('unexpected native call')


class FakeSourcePort(s._SourceExecutionPort):
    """Synthetic counts qualify predicates only; NOT a production reservation."""
    def __init__(self):
        self.reply = self.plan = self.owner = None
        self.counts = [0,0]
        self.mode = None
        self.hook = None
        self.saved_invoke = None
    def assert_bound(self,owner):
        if self.owner is None:self.owner = owner
        if owner is not self.owner:raise m.OffloadAdmissionError()
    def reserve_initial(self,owner,plan):
        self.plan = plan
        self.reply = s._SourceReservation(self,owner,plan,object())
        return self.reply
    def assert_reserved(self,owner,reservation,plan):
        if reservation is not self.reply or plan is not self.plan or owner is not self.owner:
            raise m.OffloadAdmissionError()
    def reserve_check(self,owner,reservation,calls):
        if self.counts[0]+calls > s.execution._MAX_CALLS:raise m.OffloadAdmissionError()
    def execute(self,owner,kind,invoke):
        self.saved_invoke = invoke
        if self.mode == 'skip-operation':return None
        result = invoke()
        if self.mode == 'double-operation':invoke()
        if self.mode == 'wrong-operation-result':return object()
        return result
    def invoke_native(self,owner,reservation,record,invoke):
        if self.mode == 'skip-native':return None
        self.counts[bool(record.terminal)] += 1
        if self.counts[0] > s.execution._MAX_CALLS or self.counts[1] > s.execution._TERMINAL_CALLS:
            raise m.OffloadAdmissionError()
        result = invoke()
        if self.hook:self.hook(record)
        if self.mode == 'double-native':invoke()
        if self.mode == 'wrong-native-result':return object()
        return result


@unittest.skipUnless(os.name == 'nt' and struct.calcsize('P') == 8,'Win64 source ABI layout')
class OriginalSourceOwnerTests(unittest.TestCase):
    def setUp(self):
        self.native,self.port = FakeSourceNative(),FakeSourcePort()
        self.loader = patch.object(C,'WinDLL',side_effect=self.native.load)
        self.loader.start();self.addCleanup(self.loader.stop)
        # Tests own only their synthetic registry entries.
        self.owners = []
        self.addCleanup(self.release_test_entries)
    def release_test_entries(self):
        for owner in self.owners:
            s._SOURCE_CUSTODY.pop(id(owner),None)
            s._SOURCE_RETIREMENTS.pop(id(owner),None)
    def owner(self,**kwargs):
        value = s._OriginalModelSources(self.native.value(),_execution=self.port,**kwargs)
        self.owners.append(value)
        return value
    def denied(self,operation):
        with self.assertRaises(m.OffloadAdmissionError) as failure:operation()
        self.assertEqual(str(failure.exception),str(m.OffloadAdmissionError()))

    def test_constructor_is_inert_and_missing_producer_denies_before_api(self):
        owner = s._OriginalModelSources(self.native.value())
        self.denied(owner.prepare)
        self.assertFalse(self.native.dll_calls or self.native.calls)
        self.assertNotIn(id(owner),s._SOURCE_CUSTODY)

    def test_positive_exact_bytes_and_unused_retirement(self):
        owner = self.owner();self.assertIsNone(owner.prepare())
        self.assertEqual(self.port.counts[0],owner._plan.prepare_calls)
        self.assertEqual(len(owner._handles),owner._plan.handle_slots)
        self.assertIsNone(owner.assert_bound())
        self.assertEqual(self.port.counts[0],owner._plan.prepare_calls+owner._plan.live_check_calls)
        self.assertIsNone(owner.retire_unused())
        self.assertEqual(self.port.counts[1],owner._plan.unused_close_calls)
        self.assertTrue(owner._retired)
        self.assertNotIn(id(owner),s._SOURCE_CUSTODY)
        self.assertIn(id(owner),s._SOURCE_RETIREMENTS)
        self.assertTrue(all(row.closed for row in owner._handles))
        self.denied(owner.prepare)
        self.denied(owner.retire_unused)
        for name in ('borrow','current_guarded_context','release_capacity','create_directory','delete','protect'):
            self.assertFalse(hasattr(owner,name))

    def test_system_dll_loading_and_readonly_async_open_flags(self):
        owner = self.owner();owner.prepare()
        self.assertEqual([row[0] for row in self.native.dll_calls],['kernel32.dll','ntdll.dll'])
        self.assertTrue(all(row[1] == {'use_last_error':True,'winmode':0x800} for row in self.native.dll_calls))
        for access,share,disposition,options in self.native.open_access:
            self.assertEqual((access,share,disposition),(0x100081,1,1))
            self.assertEqual(options&0x30,0)  # Neither synchronous option.
            self.assertEqual(options&0x200000,0x200000)
        self.assertEqual(len(owner._api.n.NtReadFile.argtypes),9)
        self.assertIs(owner._api.n.NtReadFile.restype,C.c_int32)
        self.assertFalse(hasattr(s._WindowsSourceApi,'delete'))

    def test_graph_rounds_each_file_and_terminal_capacity_denies_deep_paths(self):
        owner = self.owner()
        self.assertEqual(owner._plan.reads,4)
        self.assertLess(sum(row[1] for row in owner._inventory.bindings),s._READ_BYTES)
        deep = replace(self.native.value(),root=Path('C:/'+('/'.join(['level']*45))))
        self.denied(lambda:s._OriginalModelSources(deep,_execution=self.port))
        self.assertFalse(self.native.dll_calls)

    def test_reservation_must_be_original_and_acknowledged_before_api(self):
        self.port.reserve_initial = lambda owner,plan:object()
        owner = self.owner();self.denied(owner.prepare)
        self.assertFalse(self.native.dll_calls)
        self.assertTrue(owner._uncertain)

    def test_reservation_rejection_cannot_load_dlls(self):
        self.port.assert_reserved = lambda *args:(_ for _ in ()).throw(m.OffloadAdmissionError())
        owner = self.owner();self.denied(owner.prepare)
        self.assertFalse(self.native.dll_calls)

    def test_operation_skip_double_and_wrong_result_are_fenced(self):
        for mode in ('skip-operation','double-operation','wrong-operation-result'):
            with self.subTest(mode=mode):
                self.port = FakeSourcePort();self.port.mode = mode
                owner = self.owner();self.denied(owner.prepare)
                self.assertTrue(owner._uncertain)
                self.assertIn(id(owner),s._SOURCE_CUSTODY)

    def test_native_skip_double_and_wrong_result_are_fenced(self):
        for mode in ('skip-native','double-native','wrong-native-result'):
            with self.subTest(mode=mode):
                self.port = FakeSourcePort();self.port.mode = mode
                owner = self.owner();self.denied(owner.prepare)
                self.assertTrue(owner._uncertain)
                self.assertIsNotNone(owner._pending)
                self.assertIn(id(owner),s._SOURCE_CUSTODY)

    def test_late_operation_callback_cannot_repeat_effects(self):
        owner = self.owner();owner.prepare();before = len(self.native.calls)
        self.denied(self.port.saved_invoke)
        self.assertEqual(len(self.native.calls),before)
        self.assertTrue(owner._uncertain)

    def test_hash_mismatch_retains_exact_original_graph(self):
        owner = self.owner()
        self.native.payloads['model.safetensors'] = b'y'*128
        self.denied(owner.prepare)
        self.assertTrue(owner._reads[-1].completed)
        self.assertIs(s._SOURCE_CUSTODY[id(owner)].buffer,owner._buffer)
        self.denied(owner.retire_unused)
        self.assertFalse(any(name == 'CloseHandle' for name,_ in self.native.calls))

    def test_pending_original_read_is_not_completed_by_signaled_event(self):
        self.native.pending_read = True
        owner = self.owner();self.denied(owner.prepare)
        request = owner._reads[-1]
        self.assertFalse(request.completed)
        self.assertIs(request.buffer,owner._buffer)
        self.assertEqual(request.io.status,0x103)
        self.denied(owner.retire_unused)
        self.assertFalse(any(name in ('CloseHandle','CancelIoEx') for name,_ in self.native.calls))

    def test_pending_status_can_finish_only_with_original_iosb_and_exact_bytes(self):
        self.native.pending_read = True
        def finish(record):
            if record.function is self.native.functions['NtReadFile']:
                self.native.pointer(record.args[4],s.w._Io).status = 0
        self.port.hook = finish
        owner = self.owner();owner.prepare()
        self.assertTrue(all(row.completed for row in owner._reads))

    def test_short_read_and_original_offset_drift_are_denied(self):
        for short in (True,False):
            self.port = FakeSourcePort()
            def damage(record):
                if record.function is self.native.functions['NtReadFile']:
                    if short:self.native.pointer(record.args[4],s.w._Io).information -= 1
                    else:self.native.pointer(record.args[7],C.c_int64).value += 1
            self.port.hook = damage
            owner = self.owner();self.denied(owner.prepare)
            self.assertFalse(owner._reads[-1].completed)

    def test_native_error_is_captured_before_producer_changes_last_error(self):
        self.native.native_error = 5
        self.port.hook = lambda record:C.set_last_error(997)
        owner = self.owner();self.denied(owner.prepare)
        self.assertEqual(owner._pending.error,5)

    def test_partial_acquisition_slot_survives_interrupt_and_no_retry(self):
        def interrupt(record):
            if record.function is self.native.functions['NtCreateFile']:raise KeyboardInterrupt()
        self.port.hook = interrupt
        owner = self.owner()
        with self.assertRaises(KeyboardInterrupt):owner.prepare()
        original = s._SOURCE_CUSTODY[id(owner)].refs[5][0]
        self.assertIsNotNone(original.original_slot.value)
        self.assertIsNotNone(owner._pending)
        before = len(self.native.calls);self.denied(owner.prepare)
        self.assertEqual(before,len(self.native.calls))

    def test_replaced_handle_collection_or_slot_cannot_close_originals(self):
        for collection in (True,False):
            self.port = FakeSourcePort();owner = self.owner();owner.prepare()
            original = s._SOURCE_CUSTODY[id(owner)].refs[5]
            if collection:owner._handles = list(owner._handles)
            else:owner._handles[0].slot = C.c_void_p(owner._handles[0].installed)
            self.denied(owner.retire_unused)
            self.assertIs(s._SOURCE_CUSTODY[id(owner)].refs[5],original)
        self.assertFalse(any(name == 'CloseHandle' for name,_ in self.native.calls))

    def test_final_close_bookkeeping_failure_retains_retirement_graph(self):
        owner = self.owner();owner.prepare()
        def damage(record):
            if record.function is self.native.functions['CloseHandle']:raise m.OffloadAdmissionError()
        self.port.hook = damage
        self.denied(owner.retire_unused)
        self.assertTrue(owner._uncertain)
        graph = s._SOURCE_RETIREMENTS[id(owner)]
        self.assertIs(graph[0],s._SOURCE_CUSTODY[id(owner)])
        self.assertTrue(any(row.close_started for row in graph[3]))
        self.denied(owner.retire_unused)

    def test_copy_and_serialization_do_not_transfer_owner(self):
        owner = self.owner()
        for operation in (copy.copy,copy.deepcopy,pickle.dumps):self.denied(lambda:operation(owner))
        self.assertNotIn(str(owner._inventory.root),repr(owner))

    def test_multiple_reads_share_buffer_only_after_original_completion(self):
        self.native.payloads['model.safetensors'] = b'z'*(s._READ_BYTES+128)
        original = self.native.value()
        tensor = replace(original.tensors[0],shape=((s._READ_BYTES+16)//4,),elements=(s._READ_BYTES+16)//4)
        value = replace(original,tensors=(tensor,))
        owner = s._OriginalModelSources(value,_execution=self.port)
        self.owners.append(owner);owner.prepare()
        self.assertEqual(owner._plan.reads,5)
        self.assertEqual(self.port.counts[0],owner._plan.prepare_calls)
        self.assertEqual(len({id(row.buffer) for row in owner._reads}),1)
        self.assertEqual(len({id(row.event) for row in owner._reads}),1)
        self.assertEqual(len({id(row.io) for row in owner._reads}),5)
        self.assertTrue(all(row.completed for row in owner._reads))
        self.assertEqual([row.offset.value for row in owner._reads if row.handle is owner._files[1][0]],[0,s._READ_BYTES])
        owner.retire_unused()

    def test_swapped_output_value_during_producer_bookkeeping_is_denied(self):
        def damage(record):
            if record.function is self.native.functions['NtCreateFile']:record.output.value += 1
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        self.assertEqual(owner._calls[-1].output_value+1,owner._handles[-1].original_slot.value)
        self.assertIsNone(owner._handles[-1].installed)

    def test_both_handle_slot_fields_cannot_replace_original_custody(self):
        def damage(record):
            if record.function is self.native.functions['NtCreateFile']:
                handle = record.keep[0]
                handle.slot = handle.original_slot = C.c_void_p(record.output_value)
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        original = s._SOURCE_CUSTODY[id(owner)].handle_origins[0][1]
        self.assertIs(original,owner._calls[-1].output)
        self.assertIsNot(original,owner._handles[0].slot)

    def test_plan_mutation_is_rejected_before_further_native_calls(self):
        owner = self.owner();owner.prepare();before = len(self.native.calls)
        object.__setattr__(owner._plan,'unused_close_calls',1)
        self.denied(owner.retire_unused)
        self.assertEqual(before,len(self.native.calls))

    def test_metadata_reparse_links_alt_stream_and_identity_drift_deny(self):
        for kind in (9,1,7,18):
            with self.subTest(kind=kind):
                self.port = FakeSourcePort()
                def damage(record):
                    if record.function is self.native.functions['GetFileInformationByHandleEx'] and record.args[1] == kind:
                        if kind == 9:
                            C.cast(record.args[2],C.POINTER(C.c_uint32))[0] |= 0x400
                        elif kind == 1:self.native.pointer(record.args[2],s.w._Standard).links = 2
                        elif kind == 7:self.native.pointer(record.args[2],C.c_uint32).value = 40
                        else:C.memset(record.args[2],0,24)
                self.port.hook = damage
                owner = self.owner();self.denied(owner.prepare)
                self.assertTrue(owner._uncertain)

    def test_read_guard_is_advisory_and_break_denies_hash(self):
        def damage(record):
            if record.function is self.native.functions['DeviceIoControl']:
                for event,(handle,ov,_) in list(self.native.guards.items()):self.native.guards[event] = (handle,ov,True)
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        self.assertFalse(owner._reads)
        self.assertEqual(owner._guards[0].incoming.level,1)

    def test_cancel_request_without_original_guard_completion_cannot_close(self):
        owner = self.owner();owner.prepare()
        def damage(record):
            if record.function is self.native.functions['CancelIoEx']:
                for event,(handle,ov,_) in list(self.native.guards.items()):self.native.guards[event] = (handle,ov,False)
        self.port.hook = damage
        self.denied(owner.retire_unused)
        self.assertFalse(any(name == 'CloseHandle' for name,_ in self.native.calls))

    def test_wrong_guard_terminal_status_keeps_event_and_irp(self):
        owner = self.owner();owner.prepare()
        def damage(record):
            if record.function is self.native.functions['GetOverlappedResult']:
                self.native.pointer(record.args[1],s.w._Overlapped).internal = 0
        self.port.hook = damage
        self.denied(owner.retire_unused)
        self.assertFalse(any(name == 'CloseHandle' for name,_ in self.native.calls))
        self.assertIs(s._SOURCE_RETIREMENTS[id(owner)][4][0],owner._guards[0])

    def test_check_reservation_denial_precedes_new_native_calls(self):
        owner = self.owner();owner.prepare();before = len(self.native.calls)
        self.port.reserve_check = lambda *args:(_ for _ in ()).throw(m.OffloadAdmissionError())
        self.denied(owner.assert_bound)
        self.assertEqual(before,len(self.native.calls))

    def test_replaced_native_prototype_is_denied(self):
        owner = self.owner();owner.prepare();before = len(self.native.calls)
        owner._api.n.NtReadFile.argtypes = []
        self.denied(owner.assert_bound)
        self.assertEqual(before,len(self.native.calls))

    def test_interrupted_read_keeps_original_buffer_and_iosb(self):
        def interrupt(record):
            if record.function is self.native.functions['NtReadFile']:raise KeyboardInterrupt()
        self.port.hook = interrupt
        owner = self.owner()
        with self.assertRaises(KeyboardInterrupt):owner.prepare()
        request = owner._reads[-1]
        self.assertTrue(request.issued)
        self.assertFalse(request.completed)
        self.assertIs(owner._pending.keep[0],request)
        self.assertIs(request.buffer,s._SOURCE_CUSTODY[id(owner)].buffer)
        self.denied(owner.retire_unused)

    def test_in_place_clear_cannot_drop_pending_read_or_native_call_custody(self):
        self.native.pending_read = True
        captured = []
        def damage(record):
            if record.function is self.native.functions['NtReadFile']:
                captured.append(record)
                owner._reads.clear();owner._calls.clear()
                self.native.pointer(record.args[7],C.c_int64).value += 1
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        custody = s._SOURCE_CUSTODY[id(owner)]
        self.assertEqual(len(getattr(custody,'read_origins',())),1)
        request = custody.read_origins[0]
        self.assertIs(request,captured[0].keep[0])
        self.assertIs(request.io,captured[0].args[4]._obj)
        self.assertIs(request.buffer,custody.buffer)
        self.assertIn(captured[0],custody.call_origins)
        self.assertIs(owner._pending,captured[0])
        self.assertFalse(request.completed)
        self.assertTrue(owner._uncertain)
        self.denied(owner.retire_unused)

    def test_in_place_clear_keeps_original_acquisition_guard_and_operation(self):
        for field,function in (('_handles','NtCreateFile'),('_guards','DeviceIoControl'),('_operations','NtCreateFile')):
            with self.subTest(field=field):
                self.port = FakeSourcePort()
                def damage(record):
                    if record.function is self.native.functions[function]:getattr(owner,field).clear()
                self.port.hook = damage
                owner = self.owner();self.denied(owner.prepare)
                custody = s._SOURCE_CUSTODY[id(owner)]
                self.assertTrue(custody.operation_origins and custody.call_origins and custody.handle_origins)
                if field == '_guards':self.assertTrue(custody.guard_origins)
                self.assertIsNotNone(owner._pending)
                self.denied(owner.retire_unused)

    def test_in_place_call_reordering_is_denied(self):
        def damage(record):
            if record.function is self.native.functions['GetDriveTypeW']:owner._calls.reverse()
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        custody = s._SOURCE_CUSTODY[id(owner)]
        self.assertIs(custody.call_origins[-1],owner._pending)
        self.assertTrue(owner._uncertain)

    def test_reentered_operation_cannot_continue_native_dispatch(self):
        def damage(record):
            try:owner.assert_bound()
            except m.OffloadAdmissionError:pass
        self.port.hook = damage
        owner = self.owner();self.denied(owner.prepare)
        self.assertTrue(owner._uncertain)
        self.assertEqual(len(self.native.dll_calls),1)
        self.assertFalse(self.native.calls)


if __name__ == '__main__':unittest.main()

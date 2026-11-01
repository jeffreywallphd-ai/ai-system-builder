"""Fake-only supplier and lease regressions; no model libraries are imported.

Reuse the fake loader class and explicit library-free limit/alias methods.
Native and Accelerate methods stay in controlled modules and are not collected
here. Actual tiny-model compatibility stays explicit.
"""
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tests import test_bounded_model_loader as fixtures
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tasks import offload_recovery
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError


class GenerationBoundaryTests(unittest.TestCase):
    """Explicit reuse of the five committed, library-free limit checks."""
    fake_model = fixtures.GenerationBoundsTests.fake_model
    test_capability_requires_the_reviewed_supplier_versions_without_importing_models = fixtures.GenerationBoundsTests.test_capability_requires_the_reviewed_supplier_versions_without_importing_models
    test_full_prompt_and_token_boundary_is_inclusive = fixtures.GenerationBoundsTests.test_full_prompt_and_token_boundary_is_inclusive
    test_batch_prompt_generation_and_configuration_expansion_deny = fixtures.GenerationBoundsTests.test_batch_prompt_generation_and_configuration_expansion_deny
    test_named_last_token_logits_capability_is_required = fixtures.GenerationBoundsTests.test_named_last_token_logits_capability_is_required
    test_unsupported_profile_combinations_deny_before_framework_import = fixtures.GenerationBoundsTests.test_unsupported_profile_combinations_deny_before_framework_import


class SafeAliasBoundaryTests(unittest.TestCase):
    """Select only pure cases; the native-capable class is not a base class."""
    setUp = fixtures.SafeDiskAliasTests.setUp
    bind = fixtures.SafeDiskAliasTests.bind
    test_missing_tied_head_gets_a_separate_exact_canonical_safe_reference = fixtures.SafeDiskAliasTests.test_missing_tied_head_gets_a_separate_exact_canonical_safe_reference
    test_source_path_weight_dtype_coverage_and_supplier_shape_denials = fixtures.SafeDiskAliasTests.test_source_path_weight_dtype_coverage_and_supplier_shape_denials
    test_split_group_or_noncanonical_serialized_alias_denies = fixtures.SafeDiskAliasTests.test_split_group_or_noncanonical_serialized_alias_denies
    test_separately_serialized_tied_head_is_not_replaced_by_an_alias = fixtures.SafeDiskAliasTests.test_separately_serialized_tied_head_is_not_replaced_by_an_alias
    test_loaded_shape_precision_and_parameter_name_drift_deny = fixtures.SafeDiskAliasTests.test_loaded_shape_precision_and_parameter_name_drift_deny


class SupplierBoundaryTests(fixtures.PinnedLoaderBoundaryTests):
    def close_bundle(self,bundle):
        bundle.model=None;bundle.tokenizer=None
        loader.release_offload_lease(bundle.lease,bundle.model_references)
        self.assertTrue(bundle.lease.released)

    def test_safe_weight_supplier_is_not_given_a_directory_destination(self):
        bundle=self.load()
        try:
            self.assertNotIn('offload_folder',self.calls[-1][1],
                             'The admitted safe-file supplier must not be asked to create a directory.')
            self.assertTrue(self.calls[-1][1]['use_safetensors'])
            self.assertFalse(self.calls[-1][1]['offload_state_dict'])
        finally:self.close_bundle(bundle)

    def test_positive_owner_staging_and_seal_are_retained_without_a_supplier_destination(self):
        bundle=self.load()
        try:
            self.assertGreater(bundle.lease.reservation,0)
            self.assertTrue(bundle.lease.path.is_dir())
            self.assertEqual({p.name for p in bundle.lease.path.iterdir()},{'owner'})
            self.assertIsNotNone(bundle.lease._sealed)
            bundle.lease.seal()  # Idempotent verification, not new ownership.
        finally:self.close_bundle(bundle)
        self.assertFalse((self.cache/'.aisb-offload-v1'/'active').exists())
        self.assertTrue((self.root/'model.safetensors').is_file())

    def test_guarded_readiness_remains_required_before_source_or_supplier_effects(self):
        context=offload_recovery.current_guarded_context()
        with patch.object(loader,'inspect_local_model',side_effect=AssertionError('No input inspection')), \
             patch.object(loader,'OwnedOffloadLease',side_effect=AssertionError('No lease')):
            with self.assertRaises(OffloadAdmissionError):
                loader.load_bounded_local_model(fixtures.model_config(),{'max_new_tokens':256},reference=self.root,
                    cache_root=self.cache,read_memory=lambda:SimpleNamespace(available_bytes=8*1024**3),
                    read_cuda_memory=lambda:0,_recovery=context)
        self.assertFalse(self.calls)
        self.assertFalse((self.cache/'.aisb-offload-v1').exists())


class InMemoryIndexBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.root=Path('synthetic-no-io-model').absolute()
        self.source='model.embed_tokens.weight';self.alias='lm_head.weight'
        self.inventory=SimpleNamespace(root=self.root,tensors=(SimpleNamespace(name=self.source,
            shard='model.safetensors',shape=(2,2),dtype='F32'),))
        self.index={self.source:{'safetensors_file':str(self.root/'model.safetensors'),
            'weight_name':self.source,'dtype':'float32'}}

    def bind(self,index):
        return loader._bind_safe_disk_aliases((None,[],[],[],index,[]),self.inventory,
            tied_groups=((self.source,self.alias),),device_map={'model.embed_tokens':'disk','lm_head':'disk'},dtype='float32')

    def test_verified_original_safe_index_and_tied_alias_are_in_memory_without_file_effects(self):
        with patch.object(Path,'mkdir',side_effect=AssertionError('No directory request')), \
             patch.object(Path,'open',side_effect=AssertionError('No file request')):
            bound=self.bind(self.index)[4]
        self.assertEqual(bound[self.alias],self.index[self.source]);self.assertIsNot(bound[self.alias],bound[self.source])
        self.assertNotIn(self.alias,self.index)

    def test_missing_or_noncanonical_disk_index_denies_without_folder_or_unsafe_fallback(self):
        cases=[None,{}, {self.source:{**self.index[self.source],'safetensors_file':str(self.root/'other.safetensors')}},
               {self.source:{**self.index[self.source],'dtype':'float16'}},
               {self.source:{**self.index[self.source],'weight_name':self.alias}}]
        for index in cases:
            with self.subTest(index=index),patch.object(Path,'mkdir',side_effect=AssertionError('No fallback directory')), \
                 patch.object(Path,'open',side_effect=AssertionError('No fallback file')):
                with self.assertRaises(OffloadAdmissionError):self.bind(index)


if __name__=='__main__':unittest.main()

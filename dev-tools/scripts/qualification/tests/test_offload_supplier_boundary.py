"""Model-free supplier and lease regressions; no model libraries are imported.

Reuse the fake loader class and explicit library-free limit/alias methods.
Native and Accelerate methods stay in controlled modules and are not collected
here. Actual tiny-model compatibility stays explicit.
"""
from pathlib import Path
from tempfile import gettempdir, mkdtemp
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.tests import test_bounded_model_loader as fixtures
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tasks import offload_recovery
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError, OwnedOffloadLease


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
            self.assertTrue(self.calls[-1][1]['weights_only'])
            self.assertTrue(all(p.endswith('.safetensors') for p in self.calls[-1][1]['checkpoint_files']))
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

    def _assert_interrupted_load_retains_original_owner(self, stage, error_type):
        error = error_type('synthetic interruption')
        created = []
        original_lease = loader.OwnedOffloadLease
        def lease(*args, **kwargs):
            value = original_lease(*args, **kwargs)
            created.append(value)
            return value
        supplier = self.modules['transformers'].Qwen2ForCausalLM
        if stage == 'constructor':
            original = supplier._from_config
            target, name = supplier, '_from_config'
            def interrupted(cls, *args, **kwargs):
                self.holders.append(original.__func__(cls, *args, **kwargs))
                raise error
        elif stage == 'weights':
            target, name = supplier, '_load_pretrained_model'
            def interrupted(model, *args, **kwargs):
                self.holders.append(model)
                raise error
        elif stage == 'dispatch':
            target, name = self.modules['accelerate'], 'dispatch_model'
            def interrupted(model, **kwargs):
                self.holders.append(model)
                raise error
        elif stage == 'subclass':
            target, name = supplier, '__init_subclass__'
            def interrupted(cls, **kwargs):
                raise error
        elif stage == 'bundle':
            target, name = loader, 'BoundedModelBundle'
            def interrupted(model, *args, **kwargs):
                self.holders.append(model)
                raise error
        else:
            self.assertEqual(stage, 'seal')
            target, name = original_lease, 'seal'
            def interrupted(*args, **kwargs):
                raise error
        injected = (patch.object(target, name, new=classmethod(interrupted))
                    if stage in ('constructor', 'subclass')
                    else patch.object(target, name, side_effect=interrupted))
        with patch.object(loader, 'OwnedOffloadLease', side_effect=lease), injected:
            with self.assertRaises(error_type) as caught:
                self.load()
        self.assertIs(caught.exception, error)
        self.assertEqual(len(created), 1)
        self.assertEqual(len(loader._RETAINED_LEASES), 1)
        retained, references = loader._RETAINED_LEASES[0]
        self.assertIs(retained, created[0])
        self.assertEqual(bool(references), stage != 'subclass')
        self.assertFalse(retained.released)
        self.assertTrue(retained.path.is_dir())
        self.assertEqual(self.default_dtype, 'float64')
        with patch.object(loader, 'inspect_local_model', side_effect=AssertionError('No fresh admission')):
            with self.assertRaises(OffloadAdmissionError):
                self.load()
        if self.holders:
            with self.assertRaises(OffloadAdmissionError):
                loader.retry_retained_offload_cleanup()
            self.assertIs(loader._RETAINED_LEASES[0][0], retained)
            self.assertIs(loader._RETAINED_LEASES[0][1], references)
        # Release only the synthetic model and traceback owned by this fixture.
        # A supplier interruption is never itself cleanup or native-exit proof.
        self.holders.clear()
        error.__traceback__ = None
        loader.retry_retained_offload_cleanup()
        self.assertTrue(retained.released)
        self.assertFalse(loader._RETAINED_LEASES)
        self.assertFalse(retained.path.exists())
        self.assertTrue((self.root / 'model.safetensors').is_file())

    def test_constructor_interrupt_retains_original_lease_and_restores_shared_dtype(self):
        self._assert_interrupted_load_retains_original_owner('constructor', KeyboardInterrupt)

    def test_weight_loading_exit_retains_original_lease_and_live_model(self):
        self._assert_interrupted_load_retains_original_owner('weights', SystemExit)

    def test_dispatch_interrupt_retains_original_lease_and_live_model(self):
        self._assert_interrupted_load_retains_original_owner('dispatch', KeyboardInterrupt)

    def test_final_seal_exit_retains_original_lease_without_automatic_teardown(self):
        self._assert_interrupted_load_retains_original_owner('seal', SystemExit)

    def test_supplier_subclass_interrupt_retains_lease_before_a_model_exists(self):
        self._assert_interrupted_load_retains_original_owner('subclass', KeyboardInterrupt)

    def test_bundle_handoff_exit_retains_original_lease_and_live_model(self):
        self._assert_interrupted_load_retains_original_owner('bundle', SystemExit)

    def test_completed_owned_cleanup_retry_changes_only_retained_bookkeeping(self):
        bundle = self.load()
        bundle.model = None
        bundle.tokenizer = None
        error = KeyboardInterrupt('synthetic bookkeeping interruption')
        with patch.object(loader, '_forget_offload_lease', side_effect=error), \
             self.assertRaises(KeyboardInterrupt) as caught:
            loader.release_offload_lease(bundle.lease, bundle.model_references)
        self.assertIs(caught.exception, error)
        self.assertTrue(bundle.lease.released)
        self.assertFalse(bundle.lease.path.exists())
        self.assertIs(loader._RETAINED_LEASES[0][0], bundle.lease)
        self.assertIs(loader._RETAINED_LEASES[0][1], bundle.model_references)
        with patch.object(bundle.lease, 'seal', side_effect=AssertionError('No repeated seal')), \
             patch.object(bundle.lease, 'cleanup', side_effect=AssertionError('No repeated cleanup')):
            loader.retry_retained_offload_cleanup()
        self.assertFalse(loader._RETAINED_LEASES)
        self.assertTrue((self.root / 'model.safetensors').is_file())


class CleanupCustodyBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.retained = patch.object(loader, '_RETAINED_LEASES', [])
        self.retained.start()
        self.addCleanup(self.retained.stop)
        self.references = []
        parent = Path(gettempdir()).resolve(strict=True)
        root = Path(mkdtemp(prefix="offload-custody-", dir=parent))
        created = root.lstat()
        self.lease = None

        def retire_fixture():
            current = root.lstat()
            self.assertEqual(root.parent, parent)
            self.assertEqual(root.resolve(strict=True), root)
            self.assertEqual((current.st_dev, current.st_ino), (created.st_dev, created.st_ino))
            self.assertNotEqual(created.st_ino, 0)
            if self.lease is not None:
                # The injected acknowledgement did not remove this synthetic slot.
                self.lease.released = False
                OwnedOffloadLease.seal(self.lease)
                OwnedOffloadLease.cleanup(self.lease, model_released=True)
                namespace = self.lease.root
                identity = namespace.lstat()
                self.assertEqual(namespace.parent, root)
                self.assertEqual(namespace.resolve(strict=True), namespace)
                self.assertEqual((identity.st_dev, identity.st_ino), self.lease._root_identity)
                namespace.rmdir()
            root.rmdir()

        self.addCleanup(retire_fixture)
        self.lease = OwnedOffloadLease(root, 1024)
        self.lease.seal = Mock()
        self.lease.cleanup = Mock()

    def test_gc_interrupt_retains_exact_owner_before_any_cleanup_effect(self):
        for error in (KeyboardInterrupt(), SystemExit(), RuntimeError('synthetic failure')):
            with self.subTest(error=type(error).__name__), \
                 patch.object(loader.gc, 'collect', side_effect=error), \
                 self.assertRaises(type(error)) as caught:
                loader.release_offload_lease(self.lease, self.references)
            self.assertIs(caught.exception, error)
            self.assertEqual(len(loader._RETAINED_LEASES), 1)
            self.assertIs(loader._RETAINED_LEASES[0][0], self.lease)
            self.assertIs(loader._RETAINED_LEASES[0][1], self.references)
            self.lease.seal.assert_not_called()
            self.lease.cleanup.assert_not_called()

    def test_seal_and_cleanup_failures_retain_without_duplicate_or_foreign_removal(self):
        foreign = object()
        foreign_references = []
        loader._RETAINED_LEASES.append((foreign, foreign_references))
        for stage in ('seal', 'cleanup'):
            for error in (KeyboardInterrupt(), SystemExit(), RuntimeError('synthetic failure'), OffloadAdmissionError()):
                with self.subTest(stage=stage, error=type(error).__name__):
                    loader._RETAINED_LEASES[:] = [(foreign, foreign_references)]
                    self.lease.seal.side_effect = None
                    self.lease.cleanup.side_effect = None
                    getattr(self.lease, stage).side_effect = error
                    with patch.object(loader.gc, 'collect'), self.assertRaises(type(error)) as caught:
                        loader.release_offload_lease(self.lease, self.references)
                    self.assertIs(caught.exception, error)
                    self.assertEqual(len(loader._RETAINED_LEASES), 2)
                    self.assertIs(loader._RETAINED_LEASES[0][0], foreign)
                    self.assertIs(loader._RETAINED_LEASES[0][1], foreign_references)
                    self.assertIs(loader._RETAINED_LEASES[1][0], self.lease)
                    self.assertIs(loader._RETAINED_LEASES[1][1], self.references)
        self.lease.seal.side_effect = None
        self.lease.cleanup.side_effect = lambda **kwargs: setattr(self.lease, 'released', True)
        with patch.object(loader.gc, 'collect'):
            loader.release_offload_lease(self.lease, self.references)
        self.assertEqual(len(loader._RETAINED_LEASES), 1)
        self.assertIs(loader._RETAINED_LEASES[0][0], foreign)
        self.assertIs(loader._RETAINED_LEASES[0][1], foreign_references)
        self.lease.cleanup.assert_called_with(model_released=True)

    def test_silent_cleanup_without_exact_released_acknowledgement_retains_custody(self):
        for state in (False, None, 0, 1, 'true', object()):
            with self.subTest(state=type(state).__name__), patch.object(loader.gc, 'collect'):
                self.lease.released = state
                with self.assertRaises(OffloadAdmissionError):
                    loader.release_offload_lease(self.lease, self.references)
                self.assertEqual(len(loader._RETAINED_LEASES), 1)
                self.assertIs(loader._RETAINED_LEASES[0][0], self.lease)
                self.assertIs(loader._RETAINED_LEASES[0][1], self.references)
                self.assertIs(self.lease.released, state)
        self.lease.released = True
        loader.retry_retained_offload_cleanup()
        self.assertFalse(loader._RETAINED_LEASES)

    def test_replaced_reference_collection_denies_before_gc_or_file_effects(self):
        loader._RETAINED_LEASES.append((self.lease, self.references))
        with patch.object(loader.gc, 'collect') as collect, self.assertRaises(OffloadAdmissionError):
            loader.release_offload_lease(self.lease, list(self.references))
        collect.assert_not_called()
        self.lease.seal.assert_not_called()
        self.lease.cleanup.assert_not_called()
        self.assertIs(loader._RETAINED_LEASES[0][1], self.references)

    def test_interrupted_post_cleanup_bookkeeping_retries_without_file_effects(self):
        error = KeyboardInterrupt('synthetic bookkeeping interruption')
        self.lease.cleanup.side_effect = lambda **kwargs: setattr(self.lease, 'released', True)
        with patch.object(loader.gc, 'collect'), \
             patch.object(loader, '_forget_offload_lease', side_effect=error), \
             self.assertRaises(KeyboardInterrupt) as caught:
            loader.release_offload_lease(self.lease, self.references)
        self.assertIs(caught.exception, error)
        self.assertTrue(self.lease.released)
        self.assertIs(loader._RETAINED_LEASES[0][0], self.lease)
        self.lease.seal.reset_mock()
        self.lease.cleanup.reset_mock()
        with patch.object(loader.gc, 'collect') as collect:
            loader.retry_retained_offload_cleanup()
        self.assertFalse(loader._RETAINED_LEASES)
        collect.assert_not_called()
        self.lease.seal.assert_not_called()
        self.lease.cleanup.assert_not_called()

    def test_reference_inspection_failure_retains_owner_and_denies_cleanup(self):
        for error in (KeyboardInterrupt(), SystemExit(), RuntimeError('synthetic reference failure')):
            self.references[:] = [Mock(side_effect=error)]
            with self.subTest(error=type(error).__name__), patch.object(loader.gc, 'collect'), \
                 self.assertRaises(type(error)) as caught:
                loader.release_offload_lease(self.lease, self.references)
            self.assertIs(caught.exception, error)
            self.assertEqual(len(loader._RETAINED_LEASES), 1)
            self.assertIs(loader._RETAINED_LEASES[0][0], self.lease)
            self.assertIs(loader._RETAINED_LEASES[0][1], self.references)
            self.lease.seal.assert_not_called()
            self.lease.cleanup.assert_not_called()


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

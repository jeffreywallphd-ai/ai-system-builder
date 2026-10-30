"""Model-free real-consumer tests; synthetic ports supply no native evidence."""
from pathlib import Path
import copy
import gc
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import weakref

from modules.adapters.runtime.python.worker.tasks import local_model_offload as offload
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tasks import local_text_generation as generation
from modules.adapters.runtime.python.worker.tasks import offload_recovery as recovery


class SyntheticNativeBackend(recovery._NativeOffloadBackend):
    """An explicitly new test domain. This never implements Windows protection."""
    def __init__(self, root):
        self.root = root
        self.steps = []
        self.fail = None
        self.unknown_retained = False
        self.worker_exited = False
        self.owner = None

    def step(self, name):
        self.steps.append(name)
        if self.fail == name:
            raise RuntimeError("synthetic private native failure")

    def assert_ready(self):
        self.step("ready")
        if self.unknown_retained:
            raise offload.OffloadAdmissionError()

    def reserve_staging(self, root, reservation):
        self.step("reserve-durable")
        if root != self.root or not 0 < reservation <= offload.STAGING_LIMIT:
            raise offload.OffloadAdmissionError()

    def create_staging(self):
        self.step("create")
        self.path = self.root / ".aisb-offload-v1" / "new-synthetic-leaf"
        self.path.mkdir(parents=True)
        (self.path / "index.json").write_bytes(b"{}")
        return self.path

    def seal_staging(self): self.step("seal-and-protect")
    def assert_sealed(self): self.step("check-sealed")
    def release_references(self): self.step("references-released")

    def retire_owned_worker(self):
        self.step("observe-exit-readers-close")
        if not self.worker_exited:
            raise offload.OffloadAdmissionError()
        (self.path / "index.json").unlink()
        self.path.rmdir()
        self.step("retire-durable-charge")


class GuardedLeaseTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).absolute()
        self.backend = SyntheticNativeBackend(self.root)
        self.owner = recovery._GuardedOffloadOwner(self.backend)
        self.context = self.owner.worker_context

    def lease(self):
        return offload.OwnedOffloadLease(self.root, 1024, _recovery=self.context)

    def test_real_lease_reserves_before_writes_and_parent_retires_after_reference_release(self):
        lease = self.lease()
        self.assertLess(self.backend.steps.index("reserve-durable"), self.backend.steps.index("create"))
        lease.seal()
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.cleanup(model_released=False)
        self.assertNotIn("references-released", self.backend.steps)
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.cleanup(model_released=True)
        self.assertFalse(lease.released)
        self.assertTrue(lease.path.exists())
        with self.assertRaises(offload.OffloadAdmissionError):
            lease.cleanup(model_released=True)
        self.assertEqual(self.backend.steps.count("references-released"), 1)
        self.assertNotIn("observe-exit-readers-close", self.backend.steps)
        self.assertFalse(hasattr(self.context, "retire_owned_worker"))
        self.backend.worker_exited = True
        self.owner.retire_owned_worker()
        lease.cleanup(model_released=True)
        self.assertTrue(lease.released)
        self.assertFalse(lease.path.exists())
        self.assertLess(self.backend.steps.index("references-released"), self.backend.steps.index("observe-exit-readers-close"))
        self.assertLess(self.backend.steps.index("observe-exit-readers-close"), self.backend.steps.index("retire-durable-charge"))
        with self.assertRaises(offload.OffloadAdmissionError):
            self.lease()

    def test_unknown_retained_full_budget_denies_before_staging_and_cannot_reset_with_another_root(self):
        self.backend.unknown_retained = True
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        self.assertEqual(self.backend.steps, ["ready"])
        self.assertFalse((self.root / ".aisb-offload-v1").exists())
        self.backend.unknown_retained = False
        with self.assertRaises(offload.OffloadAdmissionError):
            offload.OwnedOffloadLease(self.root / "different", 1024, _recovery=self.context)
        self.assertEqual(self.backend.steps, ["ready"])

    def test_failed_constructor_pins_backend_and_live_owner_before_dispatch(self):
        self.backend.fail = "create"
        owner_ref = weakref.ref(self.owner)
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        steps = list(self.backend.steps)
        self.owner = self.context = None
        gc.collect()
        retained = owner_ref()
        self.assertIsNotNone(retained)
        self.assertIs(retained._backend, self.backend)
        self.assertIsNotNone(retained._lease)
        with self.assertRaises(offload.OffloadAdmissionError): retained.worker_context.check_ready()
        self.assertEqual(self.backend.steps, steps)

    def test_callback_interruption_retains_owner_and_never_repeats_unknown_effect(self):
        self.backend.create_staging = Mock(side_effect=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt): self.lease()
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        self.backend.create_staging.assert_called_once()

    def test_constructor_failure_after_fresh_creation_keeps_backend_custody_without_ordinary_cleanup(self):
        create = self.backend.create_staging
        def create_then_fail():
            create()
            raise RuntimeError("synthetic lost creation acknowledgement")
        self.backend.create_staging = create_then_fail
        with patch.object(Path, "unlink") as unlink:
            with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        unlink.assert_not_called()
        self.assertTrue(self.backend.path.exists())
        self.assertIs(recovery._RETAINED_OWNERS[id(self.owner)], self.owner)
        self.assertIsNone(self.owner._lease.path)
        prior = list(self.backend.steps)
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        self.assertEqual(self.backend.steps, prior)

    def test_failure_or_bad_ack_at_every_transition_retains_charge_and_denies_retry(self):
        for operation in ("reserve-durable", "create", "seal-and-protect", "check-sealed", "references-released", "observe-exit-readers-close", "retire-durable-charge"):
            with self.subTest(operation=operation), TemporaryDirectory(dir=self.root) as directory:
                backend = SyntheticNativeBackend(Path(directory))
                owner = recovery._GuardedOffloadOwner(backend)
                backend.fail = operation
                with self.assertRaises(offload.OffloadAdmissionError):
                    lease = offload.OwnedOffloadLease(backend.root, 1024, _recovery=owner.worker_context)
                    lease.seal()
                    lease.assert_guarded_reusable(owner.worker_context)
                    try: lease.cleanup(model_released=True)
                    except offload.OffloadAdmissionError:
                        if operation == "references-released": raise
                    backend.worker_exited = True
                    owner.retire_owned_worker()
                prior = list(backend.steps)
                with self.assertRaises(offload.OffloadAdmissionError): owner.worker_context.check_ready()
                self.assertEqual(backend.steps, prior)

    def test_bool_or_json_ack_and_parent_flag_are_never_native_authority(self):
        for value in (True, False, {"native": True}):
            with self.subTest(value=value):
                backend = SyntheticNativeBackend(self.root)
                backend.reserve_staging = Mock(return_value=value)
                owner = recovery._GuardedOffloadOwner(backend)
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.OwnedOffloadLease(self.root, 1024, _recovery=owner.worker_context)
                self.assertNotIn("create", backend.steps)
        with self.assertRaises(TypeError): self.owner.retire_owned_worker(parent=True)

    def test_reentrant_backend_cannot_hide_an_uncertain_inner_call(self):
        def reenter():
            try: self.context.check_ready()
            except offload.OffloadAdmissionError: pass
        self.backend.assert_ready = reenter
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        self.assertFalse(self.backend.steps)

    def test_missing_or_forged_context_denies_before_any_filesystem_operation(self):
        for value in (None, {}, {"native_proof": True}, object(), recovery.current_guarded_context()):
            with self.subTest(kind=type(value).__name__), patch.object(Path, "lstat", side_effect=AssertionError("unexpected IO")), patch.object(Path, "mkdir", side_effect=AssertionError("unexpected write")):
                with self.assertRaises(offload.OffloadAdmissionError):
                    offload.OwnedOffloadLease(self.root, 1024, _recovery=value)

    def test_copied_noncanonical_and_uninitialized_contexts_deny_every_method_before_callbacks(self):
        for value in (copy.copy(self.context), recovery.GuardedOffloadContext(self.owner), object.__new__(recovery.GuardedOffloadContext)):
            for action in (lambda: recovery.require_guarded_context(value), lambda: recovery.require_fresh_guarded_context(value), value.check_ready, value.check_load_ready, value.retain_failure, lambda: value.new_lease(self.root, 1024)):
                with self.subTest(action=action), self.assertRaises(offload.OffloadAdmissionError): action()
        self.assertEqual(self.backend.steps, [])
        self.assertEqual(self.owner._phase, "idle")
        self.context.check_ready()
        self.assertEqual(self.backend.steps, ["ready"])

    def test_canonical_context_cannot_be_replaced_through_parent_property(self):
        with self.assertRaises(AttributeError): self.owner.worker_context = copy.copy(self.context)
        self.assertIs(self.owner.worker_context, self.context)

    def test_copied_parent_cannot_issue_or_repeat_native_retirement(self):
        lease = self.lease(); lease.seal()
        with self.assertRaises(offload.OffloadAdmissionError): lease.cleanup(model_released=True)
        copied = copy.copy(self.owner)
        self.backend.worker_exited = True
        with self.assertRaises(offload.OffloadAdmissionError): copied.retire_owned_worker()
        self.assertNotIn("observe-exit-readers-close", self.backend.steps)
        self.owner.retire_owned_worker()
        with self.assertRaises(offload.OffloadAdmissionError): copied.retire_owned_worker()
        self.assertEqual(self.backend.steps.count("observe-exit-readers-close"), 1)
        lease.cleanup(model_released=True)
        self.assertTrue(lease.released)

    def test_bounds_and_one_live_lease_refuse_before_new_effects(self):
        for value in (0, True, -1, offload.STAGING_LIMIT + 1):
            with self.assertRaises(offload.OffloadAdmissionError):
                offload.OwnedOffloadLease(self.root, value, _recovery=self.context)
        self.assertFalse(self.backend.steps)
        self.lease()
        steps = list(self.backend.steps)
        with self.assertRaises(offload.OffloadAdmissionError): self.lease()
        self.assertNotIn("create", self.backend.steps[len(steps):])

    def test_retained_registry_saturation_denies_before_backend_without_eviction(self):
        with patch.object(recovery, "MAX_RETAINED_OWNERS", len(recovery._RETAINED_OWNERS)):
            before = dict(recovery._RETAINED_OWNERS)
            with self.assertRaises(offload.OffloadAdmissionError): self.lease()
            self.assertFalse(self.backend.steps)
            self.assertEqual(recovery._RETAINED_OWNERS, before)

    def test_unconfirmed_worker_exit_retains_files_and_cannot_turn_retry_into_a_pass(self):
        lease = self.lease(); lease.seal()
        with self.assertRaises(offload.OffloadAdmissionError): lease.cleanup(model_released=True)
        with self.assertRaises(offload.OffloadAdmissionError): self.owner.retire_owned_worker()
        self.backend.worker_exited = True
        prior = list(self.backend.steps)
        with self.assertRaises(offload.OffloadAdmissionError): self.owner.retire_owned_worker()
        with self.assertRaises(offload.OffloadAdmissionError): lease.cleanup(model_released=True)
        self.assertFalse(lease.released); self.assertTrue(lease.path.exists())
        self.assertEqual(self.backend.steps, prior)

    def test_bad_private_leaf_and_failure_message_do_not_gain_ordinary_cleanup(self):
        self.backend.create_staging = Mock(return_value=self.root.parent / "foreign")
        with patch.object(Path, "unlink") as unlink:
            with self.assertRaises(offload.OffloadAdmissionError) as caught: self.lease()
        unlink.assert_not_called()
        self.assertNotIn(str(self.root), str(caught.exception))
        self.assertNotIn("synthetic private", str(caught.exception))


class GuardedConsumerTests(unittest.TestCase):
    def test_real_pinned_loader_holds_guarded_lease_until_parent_retirement_without_model_library(self):
        from modules.adapters.runtime.python.worker.tests import test_bounded_model_loader as boundary
        fixture = boundary.PinnedLoaderBoundaryTests()
        with patch.object(loader, "_RETAINED_LEASES", []):
            fixture.setUp()
            try:
                backend = SyntheticNativeBackend(fixture.cache)
                owner = recovery._GuardedOffloadOwner(backend)
                with patch.dict(sys.modules, fixture.modules), patch.object(loader, "offload_runtime_available", return_value=True):
                    bundle = loader.load_bounded_local_model(boundary.model_config(), {"max_new_tokens": 8}, reference=fixture.root, cache_root=fixture.cache, read_memory=lambda: SimpleNamespace(available_bytes=8 * 1024**3), read_cuda_memory=lambda: 0, _recovery=owner.worker_context)
                self.assertEqual(fixture.calls[0][1]["offload_folder"], str(bundle.lease.path))
                self.assertIn("seal-and-protect", backend.steps)
                with patch.object(loader, "validate_offload_config") as validate:
                    with self.assertRaises(offload.OffloadAdmissionError):
                        loader.load_bounded_local_model(boundary.model_config(), {"max_new_tokens": 8}, reference=fixture.root, cache_root=fixture.cache, read_memory=Mock(), read_cuda_memory=Mock(), _recovery=owner.worker_context)
                    validate.assert_not_called()
                original = (fixture.root / "model.safetensors").read_bytes()
                bundle.model = bundle.tokenizer = None
                with self.assertRaises(offload.OffloadAdmissionError):
                    loader.release_offload_lease(bundle.lease, bundle.model_references)
                self.assertEqual(len(loader._RETAINED_LEASES), 1)
                self.assertFalse(bundle.lease.released)
                backend.worker_exited = True; owner.retire_owned_worker()
                loader.retry_retained_offload_cleanup()
                self.assertTrue(bundle.lease.released)
                self.assertFalse(loader._RETAINED_LEASES)
                self.assertEqual((fixture.root / "model.safetensors").read_bytes(), original)
            finally:
                fixture.doCleanups()

    def test_supplier_interruption_fences_the_real_loader_context_before_another_import_or_plan(self):
        from modules.adapters.runtime.python.worker.tests import test_bounded_model_loader as boundary
        fixture = boundary.PinnedLoaderBoundaryTests()
        with patch.object(loader, "_RETAINED_LEASES", []):
            fixture.setUp()
            try:
                backend = SyntheticNativeBackend(fixture.cache)
                owner = recovery._GuardedOffloadOwner(backend)
                arguments = dict(reference=fixture.root, cache_root=fixture.cache, read_memory=lambda: SimpleNamespace(available_bytes=8 * 1024**3), read_cuda_memory=lambda: 0, _recovery=owner.worker_context)
                fake_model = fixture.modules["transformers"].Qwen2ForCausalLM
                with patch.dict(sys.modules, fixture.modules), patch.object(loader, "offload_runtime_available", return_value=True), patch.object(fake_model, "from_pretrained", side_effect=KeyboardInterrupt()):
                    with self.assertRaises(KeyboardInterrupt):
                        loader.load_bounded_local_model(boundary.model_config(), {"max_new_tokens": 8}, **arguments)
                with self.assertRaises(offload.OffloadAdmissionError): owner.worker_context.check_ready()
                with patch.object(loader, "validate_offload_config") as validate:
                    with self.assertRaises(offload.OffloadAdmissionError):
                        loader.load_bounded_local_model(boundary.model_config(), {"max_new_tokens": 8}, **arguments)
                    validate.assert_not_called()
                self.assertNotIn("references-released", backend.steps)
                self.assertNotIn("retire-durable-charge", backend.steps)
            finally:
                fixture.doCleanups()

    def test_loader_and_actual_generator_deny_missing_native_context_before_model_or_path_inspection(self):
        config = SimpleNamespace()
        with patch.object(loader, "validate_offload_config") as validate, patch.object(loader, "inspect_local_model") as inspect, patch.object(generation, "_resolve_huggingface_cache_root") as cache, patch.object(generation, "_validate_huggingface_snapshot_path") as snapshot:
            for value in (None, {"admitted": True}, recovery.current_guarded_context()):
                with self.subTest(kind=type(value).__name__):
                    with self.assertRaises(offload.OffloadAdmissionError):
                        loader.load_bounded_local_model(config, {}, reference=Path("unused"), cache_root=Path("unused"), read_memory=Mock(), read_cuda_memory=Mock(), _recovery=value)
                    with self.assertRaises(offload.OffloadAdmissionError):
                        generation.BoundedOffloadGenerator(config, {}, _recovery=value)
            for probe in (validate, inspect, cache, snapshot): probe.assert_not_called()

    def test_actual_factory_never_routes_explicit_guarded_request_to_standard_or_ordinary_cache(self):
        config = SimpleNamespace(model=SimpleNamespace(memoryMode="offload-v1"))
        with patch.object(generation, "_generator_cache_key") as key, patch.object(generation, "BoundedOffloadGenerator") as constructor:
            for mode in ("offload-v1", "standard"):
                config.model.memoryMode = mode
                with self.assertRaises(generation.GenerationInsufficientResourcesError):
                    generation.get_or_create_local_text_generator(config, allow_offload=True, _offload_recovery=recovery.current_guarded_context())
            key.assert_not_called(); constructor.assert_not_called()

    def test_retired_or_uncertain_context_denies_request_view_and_forward_before_source_or_model(self):
        owner = object.__new__(generation.BoundedOffloadGenerator)
        owner._owner = owner; owner._closed = False; owner._poisoned = False
        owner._recovery_context = recovery.current_guarded_context()
        owner._bundle = SimpleNamespace(lease=SimpleNamespace(assert_guarded_reusable=Mock()))
        with patch.object(generation, "validate_generation_limits") as limits:
            for action in (lambda: owner.for_request({}), lambda: owner.assert_reusable(), lambda: owner._generate_new_tokens_text(None, None)):
                with self.assertRaises(offload.OffloadAdmissionError): action()
            limits.assert_not_called()
        owner._bundle.lease.assert_guarded_reusable.assert_not_called()

    def test_actual_cache_never_aliases_guarded_contexts_or_an_ordinary_owner(self):
        with TemporaryDirectory() as directory:
            first = recovery._GuardedOffloadOwner(SyntheticNativeBackend(Path(directory))).worker_context
            second = recovery._GuardedOffloadOwner(SyntheticNativeBackend(Path(directory))).worker_context
            config = SimpleNamespace(model=SimpleNamespace(memoryMode="offload-v1"))
            cached = object.__new__(generation.BoundedOffloadGenerator)
            cached._owner = cached; cached._closed = False; cached._poisoned = False
            cached.assert_reusable = Mock()
            cached._bundle = SimpleNamespace(lease=SimpleNamespace(assert_guarded_reusable=Mock()))
            key = tuple(range(8))
            for original, requested in ((offload.ORDINARY_OFFLOAD, first), (first, second), (first, offload.ORDINARY_OFFLOAD)):
                cached._recovery_context = original
                with self.subTest(same_context=False), patch.object(generation, "_generator_cache_key", return_value=key), patch.object(generation, "_resolve_generation_params", return_value={}), patch.object(generation, "validate_offload_config"), patch.dict(generation._GENERATOR_CACHE, {(*key, "digest"): cached}, clear=True):
                    with self.assertRaises(generation.GenerationInsufficientResourcesError):
                        generation.get_or_create_local_text_generator(config, allow_offload=True, _offload_recovery=requested)
            cached.assert_reusable.assert_not_called()
            cached._recovery_context = first
            with patch.object(generation, "_generator_cache_key", return_value=key), patch.object(generation, "_resolve_generation_params", return_value={"max_new_tokens": 8}), patch.object(generation, "validate_offload_config"), patch.dict(generation._GENERATOR_CACHE, {(*key, "digest"): cached}, clear=True):
                view = generation.get_or_create_local_text_generator(config, allow_offload=True, _offload_recovery=first)
            self.assertIs(view._owner, cached)
            cached.assert_reusable.assert_called_once()
            cached._bundle.lease.assert_guarded_reusable.assert_called_once_with(first)

    def test_ordinary_lease_and_cached_standard_generator_keep_their_existing_path(self):
        with TemporaryDirectory() as directory:
            lease = offload.OwnedOffloadLease(Path(directory).absolute(), 1024)
            lease.seal(); lease.cleanup(model_released=True)
            self.assertTrue(lease.released)
        expected = object()
        config = SimpleNamespace(model=SimpleNamespace(memoryMode="standard"))
        with patch.object(generation, "_generator_cache_key", return_value=("ordinary-standard",)), patch.dict(generation._GENERATOR_CACHE, {("ordinary-standard",): expected}, clear=True):
            self.assertIs(generation.get_or_create_local_text_generator(config), expected)


if __name__ == "__main__": unittest.main()

"""Model-free boundary tests; no downloads, weights, native recovery or inference."""
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import shutil
import uuid
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from contextlib import contextmanager, nullcontext
from unittest.mock import Mock, patch

MODULE = Path(__file__).resolve().parents[1] / "run_standalone_model_tests.py"
spec = importlib.util.spec_from_file_location("standalone_model_tests", MODULE)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class StandaloneModelTests(unittest.TestCase):
    def test_failure_log_retains_source_locations_but_no_exception_text_or_locals(self):
        try:
            runner.classification_outcome([NS(), NS()], ['billing','support'], 'billing')
        except ValueError as error:
            result = runner.failure_log(error, 'case-contract')
        self.assertEqual(result['error_type'], 'ValueError')
        self.assertEqual(result['stage'], 'case-contract')
        self.assertTrue(any(f['function']=='classification_outcome' for f in result['source_frames']))
        for frame in result['source_frames']:
            self.assertFalse(Path(frame['file']).is_absolute())
            self.assertGreater(frame['line'], 0)
        self.assertNotIn('Unbounded result', json.dumps(result))
        self.assertNotIn('billing', json.dumps(result))
        self.assertLessEqual(len(result['source_frames']), 8)
        with self.assertRaises(ValueError): runner.failure_log(ValueError('secret'), 'secret-stage')
        outer=ValueError('private wrapper'); cause=MemoryError('private payload')
        outer.__cause__=cause;cause.__cause__=outer
        nested=runner.failure_log(outer,'operator-admission')
        self.assertEqual(nested['cause_types'],['MemoryError'])
        self.assertNotIn('private',json.dumps(nested))

    def test_invalid_accepted_output_is_counted_without_persisting_private_values(self):
        labels = ['billing', 'support']
        invalid = [{'label':'private-output'}, {'label':['billing']}, {'label':'billing','private':'raw'}, None]
        for fields in invalid:
            with self.subTest(fields=fields):
                result = runner.classification_outcome([NS(structured_fields=fields)], labels, 'billing')
                self.assertEqual(result, {'accepted':True,'correct':False,'invalid_accepted':True,'status':'invalid-accepted'})
                self.assertNotIn('private', json.dumps(result))
        good = runner.classification_outcome([NS(structured_fields={'label':'support'})], labels, 'support')
        self.assertTrue(good['correct']); self.assertFalse(good['invalid_accepted'])
        self.assertFalse(runner.classification_outcome([], labels, 'support')['accepted'])
        with self.assertRaises(ValueError): runner.classification_outcome([NS(), NS()], labels, 'support')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.plan = {"bindings": {"source": "source." + "a" * 64}, "model_profile": "qwen05-float32",
                     "model": "Qwen/Qwen2.5-0.5B-Instruct", "revision": runner.original.MODEL_PROFILES["qwen05-float32"]["revision"],
                     "precision": "float32", "manifest": "unused", "devices": ["cpu"], "modes": ["unchecked", "constrained"], "repeats": 1}

    def test_evidence_is_atomic_bounded_and_rejects_redirects_and_path_escape(self):
        runner.save(self.folder, "summary.json", {"status": "running"})
        runner.save(self.folder, "summary.json", {"status": "failed"})
        self.assertEqual(json.loads((self.folder / "summary.json").read_text())["status"], "failed")
        self.assertEqual([p.name for p in self.folder.iterdir()], ["summary.json"])
        for name in ("../outside.json", "evil.txt", "C:/external.json"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                runner.save(self.folder, name, {})
        with self.assertRaises(ValueError):
            runner.save(self.folder, "large.json", {"value": "x" * (2 * 1024**2)})
        real_lstat = Path.lstat
        def redirected(path):
            if path == self.folder:
                return NS(st_mode=0o040700, st_file_attributes=0x400)
            return real_lstat(path)
        with patch.object(Path, "lstat", redirected), self.assertRaises(ValueError):
            runner.save(self.folder, "blocked.json", {})
        self.assertFalse((self.folder / "blocked.json").exists())

    def test_sink_keeps_only_finite_numeric_resource_events_and_bounds_output(self):
        report = {}
        sink = runner.SafeRuntimeSink(report)
        sink.write('secret-token prompt raw model text\n')
        sink.write(json.dumps({"event": "runtime.generation_model.resources_insufficient", "requiredMemoryBytes": 4930000000,
                               "availableMemoryBytes": 3900000000, "secret": "must-not-survive", "raw": "/private/path"}) + "\n")
        sink.write(json.dumps({"event": "runtime.generation_model.resources_insufficient", "requiredMemoryBytes": "private-value"}) + "\n")
        encoded = json.dumps(report)
        for secret in ("secret-token", "must-not-survive", "private-value", "/private/path"):
            self.assertNotIn(secret, encoded)
        self.assertEqual(report["resource_events"][0]["availableMemoryBytes"], 3900000000)
        sink.write("x" * (1024**2 + 1))
        self.assertTrue(report["diagnostic_overflow"])

    def test_preflight_failure_is_persisted_without_raw_exception_or_model_execution(self):
        with patch.object(runner, "ROOT", self.folder), patch.object(runner.sys, "argv", [str(MODULE)]), \
                patch.object(runner, "make_plan", side_effect=ValueError("private token /path")), \
                patch.object(runner, "run_matrix") as execute, patch("sys.stdout", io.StringIO()):
            self.assertEqual(runner.main(), 1)
        evidence = list(self.folder.rglob("summary.json"))
        self.assertEqual(len(evidence), 1)
        self.assertIn("preflight-failed", evidence[0].read_text())
        saved=json.loads(evidence[0].read_text())
        self.assertEqual(saved['failure_log']['stage'],'operator-planning')
        self.assertEqual(saved['failure_log']['error_type'],'ValueError')
        self.assertEqual(saved['failure_log']['source_frames'],[])  # Outside the isolated test root.
        self.assertNotIn("private token", evidence[0].read_text())
        execute.assert_not_called()

    def test_plan_only_never_starts_a_child(self):
        for arguments in ([], ["--run", "--plan-only"]):
            with self.subTest(arguments=arguments), patch.object(runner, "ROOT", self.folder), \
                    patch.object(runner.sys, "argv", [str(MODULE), *arguments]), \
                    patch.object(runner, "make_plan", return_value=self.plan), patch.object(runner, "run_matrix") as execute, \
                    patch.object(runner, "slot", side_effect=AssertionError("plan only must not enter a slot")), \
                    patch("sys.stdout", io.StringIO()):
                self.assertEqual(runner.main(), 0)
            execute.assert_not_called()
        for evidence in self.folder.rglob("summary.json"):
            self.assertEqual(json.loads(evidence.read_text())["status"], "planned-not-executed")

    def test_execution_denies_busy_coordinator_or_worker_before_matrix(self):
        for kind in ('coordinator', 'worker'):
            with self.subTest(kind=kind), runner.slot(kind), patch.object(runner, "ROOT", self.folder), \
                    patch.object(runner.sys, "argv", [str(MODULE), "--run"]), \
                    patch.object(runner, "make_plan", return_value=self.plan), \
                    patch.object(runner, "run_matrix") as execute, patch("sys.stdout", io.StringIO()):
                self.assertEqual(runner.main(), 1)
            execute.assert_not_called()
        for file in self.folder.rglob('summary.json'):
            report = json.loads(file.read_text())
            self.assertEqual(report['status'], 'admission-busy')
            self.assertFalse(report['qualification_complete'])
            self.assertEqual(report['failure_log']['stage'], 'operator-admission')
            self.assertIn('Do not delete lock files', report['next_step'])

    def test_execution_holds_coordinator_and_releases_worker_preflight_before_matrix(self):
        held = []
        @contextmanager
        def guard(kind):
            held.append(kind)
            try:
                yield
            finally:
                self.assertEqual(held.pop(), kind)
        def execute(*_args):
            self.assertEqual(held, ['coordinator'])
            raise RuntimeError('fixture execution failure')
        with patch.object(runner, "ROOT", self.folder), patch.object(runner.sys, "argv", [str(MODULE), "--run"]), \
                patch.object(runner, "make_plan", return_value=self.plan), patch.object(runner, 'slot', side_effect=guard), \
                patch.object(runner, "run_matrix", side_effect=execute), patch("sys.stdout", io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'fixture execution failure'):
                runner.main()
        self.assertEqual(held, [])

    def test_child_worker_slot_follows_native_handshake_and_covers_complete_measurement(self):
        held = []
        output, stream = io.StringIO(), io.StringIO('run\n')
        @contextmanager
        def guard(kind):
            self.assertEqual(json.loads(output.getvalue())['kind'], 'ready')
            self.assertEqual(stream.tell(), 4)
            self.assertEqual(kind, 'worker')
            held.append(kind)
            try:
                yield
            finally:
                held.pop()
        with patch.object(runner.sys, 'stdin', stream), patch.object(runner.sys, 'stdout', output), \
                patch.object(runner.owned, 'rss', return_value=100), patch.object(runner, 'slot', side_effect=guard), \
                patch.object(runner, 'child_with_slot', side_effect=lambda *args: self.assertEqual(held, ['worker'])) as measure:
            runner.child(NS(), self.folder)
        measure.assert_called_once()
        self.assertEqual(held, [])

    def test_busy_child_slot_denies_before_plan_or_model_work(self):
        with runner.slot('worker'), patch.object(runner.sys, 'stdin', io.StringIO('run\n')), \
                patch.object(runner.sys, 'stdout', io.StringIO()) as output, \
                patch.object(runner.owned, 'rss', return_value=100), patch.object(runner, 'child_with_slot') as measure:
            with self.assertRaises(runner.QualificationBusy):
                runner.child(NS(), self.folder)
        measure.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['kind'], 'ready')

    def test_child_worker_slot_releases_on_failure_without_result(self):
        with patch.object(runner.sys, 'stdin', io.StringIO('run\n')), \
                patch.object(runner.sys, 'stdout', io.StringIO()) as output, patch.object(runner.owned, 'rss', return_value=100), \
                patch.object(runner, 'child_with_slot', side_effect=ValueError('fixture failure')):
            with self.assertRaises(ValueError):
                runner.child(NS(), self.folder)
        with runner.slot('worker'):
            pass
        self.assertEqual(json.loads(output.getvalue())['kind'], 'ready')

    def test_bundle_dispatch_does_not_take_an_extra_outer_slot(self):
        bundle = NS(main=Mock(return_value=0))
        with patch.dict(sys.modules, {'run_model_blocker_tests': bundle}), \
                patch.object(runner.sys, 'argv', [str(MODULE), '--all-blocked', '--plan-only']), \
                patch.object(runner, 'slot', side_effect=AssertionError('bundle owns admission')):
            self.assertEqual(runner.main(), 0)
        bundle.main.assert_called_once_with(['--plan-only'])

    @unittest.skipUnless(os.name == 'nt', 'Windows owned native process observation')
    def test_actual_diagnostic_child_busy_denial_is_natively_observed(self):
        parent = runner.safe_directory(runner.ROOT / runner.OUTPUT, create=True)
        folder = parent / uuid.uuid4().hex
        folder.mkdir()
        cohort = folder / 'cpu-unchecked-1'
        cohort.mkdir()
        try:
            with runner.slot('worker'), patch.object(runner.owned, 'SCRIPT', MODULE), \
                    patch.dict(os.environ, {'AISB_STANDALONE_RUN_ID': folder.name}), \
                    self.assertRaises(RuntimeError) as caught:
                runner.owned.run_child(NS(samples=8, model_manifest='no-model'), cohort, 1,
                    'measure', 'candidate', 'cpu', 'timing', 'unchecked', execution_seconds=1200)
            lifecycle = caught.exception.owned_child_failure
            self.assertEqual(lifecycle['native_exit_code'], 1)
            self.assertTrue(lifecycle['native_exit_confirmed'])
            self.assertEqual(lifecycle['model_cleanup_status'], 'not-observed')
            self.assertFalse((cohort / 'cohort.json').exists())
            self.assertFalse((folder / 'plan.json').exists())
        finally:
            # Only the newly created disposable fixture; never a model/stage path.
            self.assertEqual(folder.resolve().parent, parent.resolve())
            self.assertFalse(folder.is_symlink())
            shutil.rmtree(folder)

    def test_current_binding_detects_changed_shared_lock_source(self):
        lock_digest = ['a'*64]
        def digest(path):
            if path.name == 'installed_generation_holdout.json':
                return runner.CORPUS_SHA256
            if path.name == 'model_qualification_lock.py':
                return lock_digest[0]
            return 'b'*64
        source = NS(returncode=0, stdout='source.'+'c'*64)
        with patch.object(runner.owned, 'sha256_file', side_effect=digest), \
                patch.object(runner.subprocess, 'run', return_value=source):
            initial = runner.bindings()
            lock_digest[0] = 'd'*64
            changed = runner.bindings()
        self.assertEqual(initial['qualification_lock_sha256'], 'a'*64)
        self.assertEqual(changed['qualification_lock_sha256'], 'd'*64)
        self.assertNotEqual(initial, changed)

    def test_duplicate_cohorts_rejected_before_model_inspection(self):
        with patch.object(runner, "find_manifest") as inspect, self.assertRaises(ValueError):
            runner.make_plan(NS(devices=["cpu", "cpu"], modes=["constrained"]))
        inspect.assert_not_called()

    def test_new_cpu_cooperative_cutoff_is_fixed_without_changing_default(self):
        self.assertTrue(runner.stop_before_case(0,[28],clock=lambda:1100))
        self.assertFalse(runner.stop_before_case(0,[28],clock=lambda:1100,cutoff_seconds=2160))
        self.assertTrue(runner.stop_before_case(0,[28],clock=lambda:2140,cutoff_seconds=2160))
        for invalid in (True,0,2161,3600):
            with self.assertRaises(ValueError):runner.stop_before_case(0,[],cutoff_seconds=invalid)

    def test_child_handshake_precedes_plan_and_rejects_drift_before_inference(self):
        runner.save(self.folder, "plan.json", self.plan)
        cohort = self.folder / "cpu-unchecked-1"
        cohort.mkdir()
        args = NS(device="cpu", profile="unchecked", count=1, model_manifest="unused")
        output = io.StringIO()
        with patch.object(runner, "ROOT", self.folder), patch.object(runner.original, "ROOT", self.folder), patch.object(runner.owned, "rss", return_value=123), \
                patch.object(runner.sys, "stdin", io.StringIO("run\n")), patch.object(runner.sys, "stdout", output), \
                patch.dict(os.environ, {"AISB_STANDALONE_PLAN_SHA256": runner.owned.sha256_file(self.folder / "plan.json")}), \
                patch.object(runner, "slot", return_value=nullcontext()), \
                patch.object(runner, "bindings", return_value={"source": "changed"}), patch.object(runner, "measure") as measure:
            with self.assertRaises(ValueError):
                runner.child(args, cohort)
        self.assertEqual(json.loads(output.getvalue())["kind"], "ready")
        measure.assert_not_called()

    def test_supervision_failure_continues_next_cohort_and_retains_exact_exit(self):
        runner.save(self.folder, "plan.json", self.plan)
        args = NS(repeats=1, devices=["cpu"], modes=["unchecked", "constrained"])
        error = RuntimeError("private failure text")
        error.owned_child_failure = {"reason": "native-exit-failed", "native_exit_code": 23, "native_exit_confirmed": True,
                                     "model_cleanup_status": "not-observed"}
        def supervise(_args, folder, *_a, **_kw):
            with patch.object(runner, "failure", wraps=runner.failure):
                runner.owned.finish_owned_child(None, [], None, [], ["secret raw error"], folder, None)
            if folder.name == "cpu-unchecked-1":
                runner.save(folder, "cohort.json", {"status": "running", "phases": {
                    "first": {"cases": [{"correct": True, "accepted": True, "seconds": 2.5}]},
                    "warm": {"cases": []}}})
                raise error
            runner.save(folder, "cohort.json", {"status": "denied-memory", "phases": {}, "cleanup_passed": True})
            return {"physical_exit_code": 0}
        with patch.object(runner.owned, "finish_owned_child", return_value={}) as finish, \
                patch.object(runner, "bindings", return_value=self.plan["bindings"]), patch.object(runner.original, "verified_model"), \
                patch.object(runner.owned, "SCRIPT"), patch.object(runner.owned, "run_child", side_effect=supervise) as run, \
                patch.dict(os.environ, {}, clear=False), patch("sys.stdout", io.StringIO()):
            self.assertEqual(runner.run_matrix(args, self.folder, self.plan), 1)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(finish.call_args.args[4], [])
        result = json.loads((self.folder / "summary.json").read_text())
        self.assertEqual(result["status"], "incomplete-see-cohorts")
        self.assertEqual(result["cohorts"][0]["lifecycle"]["native_exit_code"], 23)
        self.assertFalse(result["qualification_complete"])
        self.assertEqual(result["cohorts"][0]["status"], "failed-supervision")
        self.assertEqual(result["cohorts"][0]["progress"]["first"], {
            "recorded_cases": 1, "expected_cases": 24, "complete": False,
            "correct": 1, "accepted": 1, "case_seconds": 2.5})
        self.assertNotIn("cleanup_passed", result["cohorts"][0])
        self.assertNotIn("private failure text", json.dumps(result))
        self.assertNotIn("secret raw error", json.dumps(result))
        self.assertEqual(result["cohorts"][0]["suppressed_stderr_characters"], 16)
        index = json.loads((self.folder / "evidence-index.json").read_text())
        self.assertEqual(index["files"]["summary.json"], runner.owned.sha256_file(self.folder / "summary.json"))

    def test_interrupt_preserves_partial_evidence_and_stops_new_children(self):
        runner.save(self.folder, "plan.json", self.plan)
        args = NS(repeats=1, devices=["cpu"], modes=["unchecked", "constrained"])
        with patch.object(runner, "bindings", return_value=self.plan["bindings"]), patch.object(runner.owned, "SCRIPT"), \
                patch.object(runner.owned, "run_child", side_effect=KeyboardInterrupt) as execute, \
                patch.dict(os.environ, {}, clear=False), patch("sys.stdout", io.StringIO()):
            self.assertEqual(runner.run_matrix(args, self.folder, self.plan), 1)
        self.assertEqual(execute.call_count, 1)
        result = json.loads((self.folder / "summary.json").read_text())
        self.assertEqual(result["status"], "interrupted")
        self.assertEqual(result["cohorts"][0]["status"], "interrupted")
        self.assertTrue((self.folder / "evidence-index.json").is_file())

    def test_unconfirmed_exit_stops_matrix_without_claiming_model_cleanup(self):
        runner.save(self.folder, "plan.json", self.plan)
        args = NS(repeats=1, devices=["cpu"], modes=["unchecked", "constrained"])
        with patch.object(runner, "bindings", return_value=self.plan["bindings"]), patch.object(runner.owned, "SCRIPT"), \
                patch.object(runner.owned, "run_child", side_effect=runner.owned.UnconfirmedChildExit(1234)) as execute, \
                patch.dict(os.environ, {}, clear=False), patch("sys.stdout", io.StringIO()):
            self.assertEqual(runner.run_matrix(args, self.folder, self.plan), 1)
        self.assertEqual(execute.call_count, 1)
        result = json.loads((self.folder / "summary.json").read_text())
        self.assertIn("cleanup_pending", result["cohorts"][0])
        self.assertNotIn("cleanup_passed", result["cohorts"][0])

    def test_standard_measurement_records_both_phases_without_raw_text_or_offload(self):
        corpus = runner.original.heldout_plan()
        active_hook = []
        class Embedding:
            weight = NS(device="cpu")
            def register_forward_pre_hook(self, hook):
                active_hook.append(hook)
                return NS(remove=Mock(side_effect=lambda: active_hook.remove(hook)))
        class Tensor:
            def __init__(self, length):
                self.shape = (1, length)
            def __getitem__(self, _key):
                return NS(item=lambda: 99)
        class Model:
            dtype = "torch.float32"
            config = NS(_attn_implementation="sdpa")
            generation_config = NS(to_dict=lambda: {"use_cache": True}, eos_token_id=99)
            def register_forward_pre_hook(self, hook):
                self.before = hook
                return NS(remove=Mock())
            def register_forward_hook(self, hook):
                self.after = hook
                return NS(remove=Mock())
            def get_input_embeddings(self):
                return Embedding()
            def generate(self, **_kwargs):
                self.before(self, [])
                self.after(self, [], None)
                return Tensor(5)
        class Generator:
            def __init__(self):
                self._generation_params = corpus["effective_sampling"]
                self._model = Model()
            def generate_text(self):
                self._model.generate(input_ids=Tensor(3), max_new_tokens=192)
                return "raw private model output must not survive"
        generator = Generator()
        runtime = NS(_GENERATOR_CACHE={}, _RESOLVED_MODEL_REFERENCES={}, TransformersChatGenerator=Generator,
                     get_or_create_local_text_generator=Mock(return_value=generator), unload_generation_models=Mock())
        generation = NS(build_task_structured_output_schema=lambda *_: {}, build_task_structured_output_example=lambda *_: {},
                        _parse_task_structured_output=Mock(), GenerationOutputValidationError=type("GenerationOutputValidationError", (ValueError,), {}),
                        ConstrainedJsonDecoderError=type("ConstrainedJsonDecoderError", (ValueError,), {}))
        def generate(chunks, config, *_a, **_kw):
            index = chunks[0][1]
            active_hook[0](Embedding(), [NS(device="cpu")])
            generator.generate_text()
            return [NS(structured_fields={"label": corpus["heldout"][index]["label"]})]
        generation.generate_task_examples_for_chunks = generate
        fake_torch = NS(load=Mock(), set_num_threads=Mock(), get_num_threads=lambda: 4,
                        manual_seed=Mock(), version=NS(cuda=None), nn=NS(Embedding=Embedding))
        config = NS(model_validate=lambda value: value)
        production = (generation, runtime, config, lambda *a: a, lambda **kw: NS(**kw), NS(_RETAINED_LEASES=[]))
        args = NS(device="cpu", profile="constrained", count=1)
        with patch.dict(sys.modules, {"torch": fake_torch}), patch.object(runner, "production", return_value=production), \
                patch.object(runner.original, "verified_model", return_value=self.folder), \
                patch.object(runner.importlib.metadata, "version", return_value="test"), \
                patch.dict(os.environ, {}, clear=False), patch.object(socket.socket, "connect"), patch.object(socket.socket, "connect_ex"), \
                patch.object(socket, "create_connection"):
            runner.measure(args, self.folder, self.plan)
        result = json.loads((self.folder / "cohort.json").read_text())
        self.assertEqual(result["status"], "measured")
        self.assertTrue(result["cleanup_passed"])
        for phase in ("first", "warm"):
            self.assertEqual(result["phases"][phase]["correct"], 24)
            self.assertEqual(result["phases"][phase]["generator_invocations"], 24)
            observation = result["phases"][phase]["cases"][0]["generation_observations"][0]
            self.assertEqual(observation["input_tokens"], 3)
            self.assertEqual(observation["generated_tokens"], 2)
            self.assertEqual(observation["termination"], "eos")
            self.assertEqual(observation["forward_calls"], 1)
            self.assertEqual(observation["forward_timing_kind"], "cpu-wall")
        passed_config = runtime.get_or_create_local_text_generator.call_args.args[0]
        self.assertEqual(passed_config["model"]["memoryMode"], "standard")
        self.assertEqual(passed_config["model"]["memoryOverflowPolicy"], "none")
        self.assertNotIn("raw private model output", json.dumps(result))
        self.assertNotIn(corpus["prompt"], json.dumps(result))
        self.assertFalse(result["qualification_complete"])

        self.assertTrue(result["runtime_vram_floor_observed"])
        self.assertTrue(result["generator_cache_empty"])
        self.assertTrue(result["retained_leases_empty"])
        self.assertEqual(result["remaining_allocated_vram_bytes"], 0)
        self.assertGreater(result["model_delivery_seconds"], 0)
        self.assertGreaterEqual(result["whole_delivery_seconds"], result["model_delivery_seconds"])
        self.assertEqual(result["actual_precision"], "torch.float32")
        self.assertEqual(result["tensor_placement_mismatch_count"], 0)

        # Exercise the complete loop, not just its scoring helper: one invalid
        # product return per phase must leave all48 observations and cleanup.
        valid_generate = generation.generate_task_examples_for_chunks
        def invalid_once(chunks, *a, **kw):
            result = valid_generate(chunks, *a, **kw)
            if chunks[0][1] == 0:
                result[0].structured_fields = {'label':'private-invalid-label','private':'must not survive'}
            return result
        generation.generate_task_examples_for_chunks = invalid_once
        invalid_folder = self.folder / 'invalid-output'
        invalid_folder.mkdir()
        with patch.dict(sys.modules, {"torch": fake_torch}), patch.object(runner, "production", return_value=production), \
                patch.object(runner.original, "verified_model", return_value=self.folder), \
                patch.object(runner.importlib.metadata, "version", return_value="test"), \
                patch.dict(os.environ, {}, clear=False), patch.object(socket.socket, "connect"), patch.object(socket.socket, "connect_ex"), \
                patch.object(socket, "create_connection"):
            runner.measure(args, invalid_folder, self.plan)
        invalid_result = json.loads((invalid_folder / 'cohort.json').read_text())
        self.assertEqual(invalid_result['status'], 'measured')
        self.assertTrue(invalid_result['cleanup_passed'])
        for phase in ('first','warm'):
            self.assertEqual(len(invalid_result['phases'][phase]['cases']), 24)
            self.assertEqual(invalid_result['phases'][phase]['invalid_accepted'], 1)
            self.assertEqual(invalid_result['phases'][phase]['correct'], 23)
        self.assertNotIn('private-invalid-label', json.dumps(invalid_result))
        self.assertNotIn('must not survive', json.dumps(invalid_result))
        generation.generate_task_examples_for_chunks = valid_generate

        # Smaller diagnostics and cooperative stops still unload normally,
        # retain the missing warm work, and never become a qualification pass.
        limited = self.folder / "limited"
        limited.mkdir()
        with patch.dict(sys.modules, {"torch": fake_torch}), patch.object(runner, "production", return_value=production), \
                patch.object(runner.original, "verified_model", return_value=self.folder), \
                patch.object(runner.importlib.metadata, "version", return_value="test"), \
                patch.dict(os.environ, {}, clear=False), patch.object(socket.socket, "connect"), patch.object(socket.socket, "connect_ex"), \
                patch.object(socket, "create_connection"), patch.object(runner, "stop_before_case", side_effect=[False, True]):
            runner.measure(args, limited, self.plan | {"diagnostic_case_limit": 1})
        result = json.loads((limited / "cohort.json").read_text())
        self.assertEqual(result["status"], "incomplete-budget-stop")
        self.assertTrue(result["cleanup_passed"])
        self.assertEqual(result["progress"]["first"]["recorded_cases"], 1)
        self.assertEqual(result["progress"]["warm"]["recorded_cases"], 0)
        self.assertFalse(result["progress"]["warm"]["complete"])
        self.assertIsNone(result["phases"]["warm"]["accuracy"])

        before_inference = self.folder / "before-inference"
        before_inference.mkdir()
        with patch.dict(sys.modules, {"torch": fake_torch}), patch.object(runner, "production", return_value=production), \
                patch.object(runner.original, "verified_model", return_value=self.folder), \
                patch.object(runner.importlib.metadata, "version", return_value="test"), \
                patch.dict(os.environ, {}, clear=False), patch.object(socket.socket, "connect"), patch.object(socket.socket, "connect_ex"), \
                patch.object(socket, "create_connection"), patch.object(runner, "stop_before_case", return_value=True):
            runner.measure(args, before_inference, self.plan)
        result = json.loads((before_inference / "cohort.json").read_text())
        self.assertEqual(result["status"], "incomplete-budget-stop")
        self.assertFalse(result["placement_observed"])
        self.assertTrue(result["cleanup_passed"])
        self.assertEqual(result["progress"]["first"]["recorded_cases"], 0)
        self.assertEqual(result["progress"]["warm"]["recorded_cases"], 0)
        self.assertFalse(result["qualification_complete"])

        # The same production seam must preserve an actual memory denial and
        # cleanup, without silently switching to offload or weakening admission.
        denied = self.folder / "denied"
        denied.mkdir()
        MemoryDenied = type("GenerationInsufficientResourcesError", (RuntimeError,), {})
        def deny_memory(_config):
            print(json.dumps({"event": "runtime.generation_model.resources_insufficient", "requiredMemoryBytes": 4930000000,
                              "availableMemoryBytes": 3900000000, "raw": "must not survive"}))
            raise MemoryDenied("private raw exception")
        runtime.get_or_create_local_text_generator.side_effect = deny_memory
        with patch.dict(sys.modules, {"torch": fake_torch}), patch.object(runner, "production", return_value=production), \
                patch.object(runner.original, "verified_model", return_value=self.folder), \
                patch.object(runner.importlib.metadata, "version", return_value="test"), \
                patch.dict(os.environ, {}, clear=False), patch.object(socket.socket, "connect"), patch.object(socket.socket, "connect_ex"), \
                patch.object(socket, "create_connection"):
            runner.measure(args, denied, self.plan)
        result = json.loads((denied / "cohort.json").read_text())
        self.assertEqual(result["status"], "denied-memory")
        self.assertTrue(result["cleanup_passed"])
        self.assertEqual(result["resource_events"][0]["requiredMemoryBytes"], 4930000000)
        self.assertNotIn("private raw exception", json.dumps(result))

    def test_cooperative_budget_stops_before_another_case_without_changing_watchdog(self):
        self.assertFalse(runner.stop_before_case(0, [28], clock=lambda: 1000))
        self.assertTrue(runner.stop_before_case(0, [28], clock=lambda: 1040))
        self.assertTrue(runner.stop_before_case(0, [], clock=lambda: 1080))
        self.assertFalse(runner.stop_before_case(0, [], clock=lambda: 0))

    def test_progress_rejects_non_numeric_and_unbounded_child_values(self):
        for seconds in ("private-model-text", float("nan"), float("inf"), -1, 1201):
            with self.subTest(seconds=seconds), self.assertRaises(ValueError):
                runner.phase_progress({"first": {"cases": [{"seconds": seconds}]}})
        with self.assertRaises(ValueError):
            runner.phase_progress({"first": {"cases": [{"seconds": 1}] * 25}})

    def test_token_observation_restores_hooks_and_preserves_generation_arguments(self):
        class Tensor:
            shape = (1, 5)
            def __getitem__(self, _key):
                return NS(item=lambda: 7)
        handles = [NS(remove=Mock()), NS(remove=Mock())]
        original = Mock(return_value=Tensor())
        model = NS(generate=original, generation_config=NS(eos_token_id=[99]),
            register_forward_pre_hook=Mock(return_value=handles[0]),
            register_forward_hook=Mock(return_value=handles[1]))
        observer = runner.GenerationObservation(NS(_model=model), lambda: None, "cuda")
        observer.begin()
        ids = NS(shape=(1, 3))
        output = model.generate(input_ids=ids, max_new_tokens=2, use_cache=True)
        original.assert_called_once_with(input_ids=ids, max_new_tokens=2, use_cache=True)
        self.assertEqual(output.shape, (1, 5))
        self.assertEqual(observer.current["termination"], "max-output")
        self.assertEqual(observer.current["forward_timing_kind"], "cuda-host-dispatch")
        self.assertNotIn("token_ids", json.dumps(observer.current))
        observer.close()
        self.assertIs(model.generate, original)
        for handle in handles:
            handle.remove.assert_called_once()

    def test_constrained_model_output_identity_and_eos_are_preserved(self):
        class Tensor:
            shape = (1, 5)
            def __getitem__(self, _key):
                return NS(item=lambda: 99)
        for output in (NS(sequences=Tensor()), {"sequences": Tensor()}):
            with self.subTest(output_type=type(output).__name__):
                original = Mock(return_value=output)
                model = NS(generate=original, generation_config=NS(eos_token_id=[99]),
                    register_forward_pre_hook=Mock(return_value=NS(remove=Mock())),
                    register_forward_hook=Mock(return_value=NS(remove=Mock())))
                observer = runner.GenerationObservation(NS(_model=model), lambda: None, "cpu")
                observer.begin()
                ids = NS(shape=(1, 3))
                self.assertIs(model.generate(input_ids=ids, max_new_tokens=192, return_dict_in_generate=True), output)
                original.assert_called_once_with(input_ids=ids, max_new_tokens=192, return_dict_in_generate=True)
                self.assertEqual(observer.current["termination"], "eos")
                self.assertEqual(observer.current["generated_tokens"], 2)
                observer.close()
                self.assertIs(model.generate, original)

    def test_observer_exception_and_partial_install_restore_the_model(self):
        first, second = NS(remove=Mock()), NS(remove=Mock())
        original = Mock(side_effect=RuntimeError("private model text"))
        model = NS(generate=original, generation_config=NS(eos_token_id=99),
            register_forward_pre_hook=Mock(return_value=first), register_forward_hook=Mock(return_value=second))
        observer = runner.GenerationObservation(NS(_model=model), lambda: None, "cpu")
        observer.begin()
        with self.assertRaises(RuntimeError):
            model.generate(input_ids=NS(shape=(1, 3)), max_new_tokens=192)
        self.assertIn("generate_seconds", observer.current)
        self.assertNotIn("private model text", json.dumps(observer.current))
        observer.close()
        self.assertIs(model.generate, original)
        first.remove.assert_called_once()
        second.remove.assert_called_once()
        first.remove.reset_mock()
        model.register_forward_hook.side_effect = RuntimeError("install failed")
        with self.assertRaises(RuntimeError):
            runner.GenerationObservation(NS(_model=model), lambda: None, "cpu")
        first.remove.assert_called_once()
        self.assertIs(model.generate, original)

    def test_diagnostic_selection_is_declared_and_does_not_relax_safety(self):
        args = NS(devices=["cpu"], modes=["unchecked"], model_manifest="existing", model_profile="qwen15-bfloat16",
                  repeats=1, case_limit=6)
        with patch.object(runner.original, "verified_model"), patch.object(runner, "bindings", return_value={}):
            plan = runner.make_plan(args)
        self.assertEqual(plan["diagnostic_case_limit"], 6)
        self.assertEqual(plan["cases_per_phase"], 6)
        self.assertEqual(plan["corpus_cases_per_phase"], 24)
        self.assertEqual(plan["phases"], ["first", "warm"])
        self.assertEqual(plan["deadline_seconds_per_cohort"], 1200)
        self.assertEqual(plan["rss_safety_ceiling_bytes"], 4 * 1024**3)
        self.assertEqual(plan["memory_mode"], "standard")
        self.assertFalse(plan["qualification_complete"])


if __name__ == "__main__":
    unittest.main()

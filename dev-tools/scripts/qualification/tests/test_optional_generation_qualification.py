import copy
import io
import os
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import weakref
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import Mock

MODULE = Path(__file__).resolve().parents[1] / "run_optional_generation_qualification.py"
spec = importlib.util.spec_from_file_location("optional_generation_qualification", MODULE)
qualification = importlib.util.module_from_spec(spec); spec.loader.exec_module(qualification)


class OptionalGenerationQualificationTests(unittest.TestCase):
    def setUp(self):
        self.plan = qualification.fixed_plan(".local-codex/model-qualification/qwen-" + "a" * 36 + "/acquisition.json")

    def test_plan_reports_missing_guarded_native_protection_without_granting_recovery(self):
        recovery=self.plan['guarded_restart']
        self.assertEqual(recovery['reason'],'native-staging-protection-not-implemented')
        self.assertFalse(recovery['admitted']);self.assertFalse(recovery['old_slot_accessed']);self.assertFalse(recovery['qualification_complete'])
        self.assertEqual(recovery['maximum_staging_bytes'],12*1024**3)
        self.assertIn('>=23of24',self.plan['optional_acceptance']['standard_denied_exception'])

    def test_native_identity_ack_precedes_even_a_failing_plan_preflight(self):
        output=io.StringIO()
        with patch.object(qualification.sys,"stdout",output),patch.object(qualification.sys,"stdin",io.StringIO("observe\n")), \
                patch.object(qualification,"directory",return_value=Path("unused")), \
                patch.object(qualification,"fixed_plan",side_effect=ValueError("private preflight failure")), \
                patch.object(qualification.original,"verified_model") as model, \
                patch.object(qualification,"staging_observation") as stage:
            with self.assertRaisesRegex(ValueError,"preflight"):
                qualification.measure(SimpleNamespace(model_manifest="unused",run_id="a"*32),Path("unused"))
        lines=[json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([line["kind"] for line in lines],["identity"])
        self.assertIs(type(lines[0]["pid"]),int)
        model.assert_not_called();stage.assert_not_called()

    def test_real_main_dispatch_observes_before_plan_and_directory_admission(self):
        for failed in ("plan","directory"):
            with self.subTest(preflight=failed):
                output=io.StringIO();events=[]
                def directory(path):
                    events.append("directory")
                    self.assertEqual(json.loads(output.getvalue().splitlines()[0])["kind"],"identity")
                    if failed=="directory":raise ValueError("private directory denial")
                    return path
                def plan(_manifest):events.append("plan");raise ValueError("private plan denial")
                with patch.object(qualification.sys,"argv",[str(MODULE),"--child","measure","--run-id","a"*32,"--model-manifest","unused"]), \
                        patch.object(qualification.sys,"stdout",output),patch.object(qualification.sys,"stdin",io.StringIO("observe\n")), \
                        patch.object(qualification,"directory",side_effect=directory),patch.object(qualification,"fixed_plan",side_effect=plan), \
                        patch.object(qualification.original,"verified_model") as model,patch.object(qualification,"staging_observation") as stage,self.assertRaisesRegex(ValueError,"denial"):
                    qualification.main()
                self.assertEqual(events,["directory","plan"] if failed=="plan" else ["directory"])
                self.assertEqual([json.loads(line)["kind"] for line in output.getvalue().splitlines()],["identity"])
                model.assert_not_called();stage.assert_not_called()

    @unittest.skipUnless(os.name=="nt","Actual Windows optional-entry native observer")
    def test_actual_optional_entry_rejects_missing_owned_output_after_native_ack(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/uuid.uuid4().hex;folder.mkdir()
            self.assertFalse((qualification.NAMESPACE/folder.name).exists())
            with patch.object(qualification.owned,"_UNCONFIRMED_CHILD",None),patch.object(qualification.owned,"SCRIPT",MODULE),self.assertRaises(Exception) as raised:
                qualification.owned.run_child(SimpleNamespace(samples=1,model_manifest="unused-no-model"),folder,1,"measure",profile="unchecked",execution_seconds=1200,early_identity=True)
            evidence=raised.exception.owned_child_failure
            self.assertTrue(evidence["native_exit_confirmed"])
            self.assertEqual(evidence["native_exit_code"],1)
            self.assertFalse(evidence["termination_requested"])
            self.assertEqual(evidence["model_cleanup_status"],"not-observed")

    def test_parent_preserves_bounded_supervision_failure_without_private_exception_text(self):
        evidence={"reason":"execution-deadline","launcher_pid":123,"launcher_exit_code":23,"native_exit_code":23,"native_exit_confirmed":True,"readers_stopped":True,"termination_requested":True,"shutdown_failure_types":[],"model_cleanup_status":"not-observed"}
        error=RuntimeError("private failure body");error.owned_child_failure=evidence
        with tempfile.TemporaryDirectory() as temporary:
            namespace=Path(temporary)/"qualification"
            with patch.object(qualification,"NAMESPACE",namespace),patch.object(qualification.sys,"argv",[str(MODULE),"--model-manifest",".local-codex/model-qualification/qwen-"+"a"*36+"/acquisition.json"]), \
                    patch.object(qualification.original,"verified_model"),patch.object(qualification,"schema_identity",return_value="c"*64), \
                    patch.object(qualification.owned,"source_identity",return_value="source."+"a"*64),patch.object(qualification.owned,"run_child",side_effect=error) as run,patch.object(qualification.sys,"stdout",io.StringIO()):
                self.assertEqual(qualification.main(),1)
            reports=list(namespace.glob("*/report.json"));self.assertEqual(len(reports),1)
            report=json.loads(reports[0].read_text());self.assertFalse(report["qualification_complete"])
            for cohort in report["cohorts"]:
                for pair in cohort["pairs"]:
                    for variant in ("baseline","candidate"):
                        self.assertEqual(pair[variant]["supervision_failure"],evidence)
            self.assertNotIn("private failure",json.dumps(report))
            self.assertTrue(all(call.kwargs["early_identity"] is True for call in run.call_args_list))

    def measured(self):
        return {"status": "measured", "cleanup_passed": True, "physical_exit_code": 0, "source_stable": True,
                "cleanup_errors": [], "stage_observation_error_count": 0, "monitor_stopped": True, "generator_cache_empty": True,
                "runtime_vram_floor_observed": True, "runtime_allocated_vram_floor_bytes": 0, "runtime_reserved_vram_floor_bytes": 0,
                "remaining_allocated_vram_bytes": 0, "remaining_reserved_vram_bytes": 0,
                "peak_rss_bytes": 1024**3, "stage_peak_bytes": 32, "stage_final_bytes": 0, "staging_absence_confirmed": True,
                "resources": {"cpu_weight_bytes": 100, "cuda_weight_bytes": 0}, "accepted_per_minute": 10,
                "phase_memory": {phase: {"start_rss_bytes": 100, "peak_rss_bytes": 200, "end_rss_bytes": 100} for phase in qualification.MEMORY_PHASES},
                "phases": {phase: {"cases": [{"id": row["id"], "correct": True, "invalid_accepted": False} for row in self.plan["heldout"]]} for phase in ("first", "warm")}}

    def test_parent_source_drift_stops_before_launch_or_semantic_result_handling(self):
        source = "source." + "a" * 64
        for drift_after_child in (False, True):
            with self.subTest(after_child=drift_after_child), tempfile.TemporaryDirectory() as temporary:
                namespace = Path(temporary) / "qualification"
                observations = [source, source, "source." + "b" * 64] if drift_after_child else [source, "source." + "b" * 64]
                with patch.object(qualification, "NAMESPACE", namespace), \
                        patch.object(qualification.sys, "argv", [str(MODULE), "--model-manifest", ".local-codex/model-qualification/qwen-" + "a" * 36 + "/acquisition.json"]), \
                        patch.object(qualification.original, "verified_model"), \
                        patch.object(qualification, "schema_identity", return_value="c" * 64), \
                        patch.object(qualification.owned, "source_identity", side_effect=observations), \
                        patch.object(qualification.owned, "run_child", return_value={}) as launch:
                    with self.assertRaises(SystemExit):
                        qualification.main()
                    self.assertEqual(launch.call_count, int(drift_after_child))
                reports = list(namespace.glob("*/report.json"))
                self.assertEqual(len(reports), 1)
                result = json.loads(reports[0].read_text())
                self.assertEqual(result["status"], "aborted-source-drift")
                self.assertIs(result["qualification_complete"], False)

    def compare(self, before, after, profile="qwen05-float32", device="cpu"):
        return qualification.compare_pair(before, after, self.plan, model_profile=profile, device=device)

    def test_original_fixture_precision_and_population_are_fixed_without_baseline_substitution(self):
        self.assertEqual(len(self.plan["heldout"]), 24)
        self.assertEqual(self.plan["precision"], "float32")
        self.assertNotIn("absolute_quality_floor", self.plan)
        self.assertEqual(self.plan["historical_original_gates_not_applied"]["absolute_quality_floor"], .95)
        self.assertIn("no improvement threshold", self.plan["optional_acceptance"]["throughput"])
        bigger = qualification.fixed_plan(".local-codex/model-qualification/qwen15-" + "a" * 36 + "/acquisition.json")
        self.assertEqual(bigger["heldout"], self.plan["heldout"])
        self.assertEqual(bigger["precision"], "bfloat16")
        with patch.object(qualification.owned, "sha256_file", return_value="changed"):
            with self.assertRaisesRegex(ValueError, "fixture changed"):
                qualification.fixed_plan(".local-codex/model-qualification/qwen-" + "a" * 36 + "/acquisition.json")
        for value in ("../outside", "C:/outside", ".local-codex/model-qualification/custom/acquisition.json"):
            with self.assertRaises(ValueError): qualification.profile_for_manifest(value)

    def test_matched_small_model_requires_zero_correct_cases_lost_and_no_invalid_acceptance(self):
        before = self.measured(); after = self.measured()
        # A narrow model's matched result is not a retroactive95percent pass.
        for report in (before, after):
            for phase in report["phases"].values():
                for row in phase["cases"][4:]: row["correct"] = False
        self.assertTrue(self.compare(before, after)["passed"])
        after["phases"]["warm"]["cases"][0]["correct"] = False
        self.assertFalse(self.compare(before, after)["passed"])
        after = copy.deepcopy(before); after["phases"]["first"]["cases"][0]["invalid_accepted"] = True
        self.assertFalse(self.compare(before, after)["passed"])
        after = copy.deepcopy(before)
        before["phases"]["warm"]["cases"][0]["invalid_accepted"] = True
        rejected = self.compare(before, after)
        self.assertFalse(rejected["passed"])
        self.assertEqual(rejected["phases"][1]["baseline_invalid_accepted"], 1)
        self.assertEqual(rejected["phases"][1]["invalid_accepted"], 0)

    def test_denied_standard_cpu_is_only_a_declared_15b_unpaired_quality_floor(self):
        denied = self.measured(); denied.update(status="denied", phases={}, accepted_per_minute=0)
        candidate = self.measured()
        for entry in candidate["phases"].values(): entry["cases"][-1]["correct"] = False
        result = self.compare(denied, candidate, "qwen15-bfloat16")
        self.assertTrue(result["passed"]); self.assertIsNone(result["delivery_ratio"])
        self.assertIsNone(result["phases"][0]["baseline_correct_lost"])
        self.assertFalse(self.compare(denied, candidate)["passed"])
        self.assertFalse(self.compare(denied, candidate, "qwen15-bfloat16", "cuda")["passed"])
        candidate["phases"]["warm"]["cases"][-2]["correct"] = False
        self.assertFalse(self.compare(denied, candidate, "qwen15-bfloat16")["passed"])

    def test_failure_resource_drift_missing_cases_and_unconfirmed_cleanup_cannot_pass(self):
        for key, value in (("status", "denied"), ("cleanup_passed", False), ("physical_exit_code", 7),
                           ("source_stable", False), ("peak_rss_bytes", qualification.RSS_LIMIT + 1),
                           ("peak_rss_bytes", True), ("stage_peak_bytes", 12 * 1024**3 + 1),
                           ("stage_final_bytes", 32), ("staging_absence_confirmed", False), ("diagnostic_overflow", True)):
            after = self.measured(); after[key] = value
            with self.subTest(key=key, value=value): self.assertFalse(self.compare(self.measured(), after)["passed"])
        after = self.measured(); after["phases"]["warm"]["cases"].pop()
        self.assertFalse(self.compare(self.measured(), after)["passed"])

    def test_operationally_broken_or_zero_useful_output_pairs_cannot_qualify(self):
        before = self.measured(); after = self.measured()
        after["phases"]["first"]["cases"][0]["operational_errors"] = 1
        self.assertFalse(self.compare(before, after)["passed"])
        before["phases"]["first"]["cases"][0]["correct"] = False
        after["phases"]["first"]["cases"][0]["correct"] = False
        self.assertFalse(self.compare(before, after)["passed"])
        for report in (before, after):
            for phase in report["phases"].values():
                for row in phase["cases"]: row.update(correct=False, operational_errors=0)
        self.assertFalse(self.compare(before, after)["passed"])
        before = self.measured(); before["diagnostic_overflow"] = True
        self.assertFalse(self.compare(before, self.measured())["passed"])
        after = self.measured(); after["resources"]["cpu_weight_bytes"] = 1024**3 + 1
        self.assertFalse(self.compare(self.measured(), after)["passed"])

    def test_only_expected_regular_staging_is_observed_and_no_cleanup_is_attempted(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary).absolute(); path = cache / ".aisb-offload-v1/active"
            self.assertEqual(qualification.staging_observation(path), (0, True))
            path.mkdir(parents=True); (path / "owner").write_bytes(b"a" * 32)
            self.assertEqual(qualification.staging_observation(path), (32, False))
            (path / "foreign").write_bytes(b"preserved")
            with self.assertRaises(ValueError): qualification.staging_observation(path)
            self.assertEqual((path / "foreign").read_bytes(), b"preserved")

    def test_exclusive_output_and_redirected_ancestors_are_denied(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).absolute(); folder = root / "run"
            qualification.directory(folder, exclusive=True)
            with self.assertRaises(FileExistsError): qualification.directory(folder, exclusive=True)
            qualification.write_json(folder, "test.json", {"value": 1}, exclusive=True)
            self.assertEqual(json.loads((folder / "test.json").read_text()), {"value": 1})
            with self.assertRaises(FileExistsError): qualification.write_json(folder, "test.json", {}, exclusive=True)

    def test_child_semantic_fields_and_effective_settings_must_match_the_frozen_protocol(self):
        protocol = {"operator_sha256": "operator", "device": "cpu", "mode": "constrained", "replicate": 1,
                    "variant": "candidate", "schema_sha256": "schema"}
        result = {**self.measured(), "operator_sha256": "operator", "protocol_sha256": "protocol", "model_profile": "qwen05-float32",
                  "precision": "float32", "device": "cpu", "mode": "constrained", "replicate": 1, "variant": "candidate",
                  "memory_mode": "offload-v1", "schema_sha256": "schema", "configured_generation_params": self.plan["generation_params"],
                  "effective_sampling": self.plan["effective_sampling"]}
        qualification.validate_child_result(result, protocol, self.plan, "qwen05-float32", "protocol")
        for key in ("operator_sha256", "protocol_sha256", "model_profile", "precision", "device", "mode", "replicate", "variant", "memory_mode", "schema_sha256", "configured_generation_params", "effective_sampling"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                qualification.validate_child_result({**result, key: "substituted"}, protocol, self.plan, "qwen05-float32", "protocol")

    def test_memory_phase_evidence_must_be_complete_bounded_and_truthfully_labeled(self):
        report = {"phase_memory": {phase: {"peak_rss_bytes": 0} for phase in qualification.MEMORY_PHASES}}
        qualification.memory_tick(report, "load", 100)
        qualification.memory_tick(report, "load", 50)
        self.assertEqual(report["phase_memory"]["load"]["peak_rss_bytes"], 100)
        for phase, value in (("unknown", 100), ("load", True), ("load", -1)):
            with self.assertRaises(ValueError): qualification.memory_tick(report, phase, value)
        for phase in qualification.MEMORY_PHASES:
            candidate = self.measured(); candidate["phase_memory"].pop(phase)
            self.assertFalse(self.compare(self.measured(), candidate)["passed"])

    def test_observation_failure_cannot_skip_unload_or_independent_cleanup_stages(self):
        names = ("phase", "restore-generator", "restore-parser", "remove-hook", "drop-view", "unload", "collect", "accelerator", "stop-monitor", "stage", "rss")
        for failed in ("phase", "restore-generator", "remove-hook", "accelerator", "rss"):
            actions = {name: Mock() for name in names}
            actions[failed].side_effect = OSError("synthetic unavailable observation")
            report = {}
            qualification.cleanup_steps(report, actions)
            for action in actions.values(): action.assert_called_once()
            self.assertEqual(report["cleanup_errors"], [{"stage": failed, "error_class": "OSError"}])

    def test_cuda_common_floor_initializes_matmul_and_releases_tensors_before_readback(self):
        events = []; tensors = []
        class Tensor:
            def __init__(self):
                tensors.append(weakref.ref(self))
            def __matmul__(self, other):
                events.append("matmul")
                return Tensor()
        def zeros(shape, *, dtype, device):
            self.assertEqual((shape, dtype, device), ((16, 16), "float32", "cuda"))
            events.append("zeros")
            return Tensor()
        def empty_cache():
            self.assertTrue(all(reference() is None for reference in tensors))
            events.append("empty-cache")
        def read(name, value):
            events.append(name)
            return value
        torch = SimpleNamespace(float32="float32", zeros=zeros, cuda=SimpleNamespace(
            synchronize=lambda: events.append("synchronize"), empty_cache=empty_cache,
            memory_allocated=lambda: read("allocated", 8), memory_reserved=lambda: read("reserved", 16)))
        self.assertEqual(qualification.initialize_cuda_runtime_floor(torch), (8, 16))
        self.assertEqual(events, ["zeros", "matmul", "synchronize", "empty-cache", "allocated", "reserved"])

    def test_cleanup_requires_actual_strict_floor_and_error_observations(self):
        report = self.measured()
        self.assertTrue(qualification.cleanup_observations_pass(report))
        invalid = {"stage_observation_error_count": [1, False, None], "runtime_vram_floor_observed": [False, None],
                   "runtime_allocated_vram_floor_bytes": [True, -1, None], "runtime_reserved_vram_floor_bytes": [False, -1, None],
                   "remaining_allocated_vram_bytes": [1, False, None], "remaining_reserved_vram_bytes": [1, False, None],
                   "stage_final_bytes": [False, 1], "generator_cache_empty": [False], "monitor_stopped": [False],
                   "cleanup_errors": [[{"stage": "stage", "error_class": "OSError"}], None]}
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    candidate = {**report, key: value}
                    self.assertFalse(qualification.cleanup_observations_pass(candidate))
                    self.assertFalse(self.compare(report, candidate)["passed"])
        for field in ("runtime_allocated_vram_floor_bytes", "runtime_reserved_vram_floor_bytes", "stage_observation_error_count"):
            candidate = dict(report); candidate.pop(field)
            self.assertFalse(self.compare(report, candidate)["passed"])
        for variant in ("standard", "optional"):
            candidate = {**report, "physical_exit_code": False}
            before, after = (candidate, report) if variant == "standard" else (report, candidate)
            self.assertFalse(self.compare(before, after)["passed"])
        cuda = {**report, "runtime_allocated_vram_floor_bytes": 8, "runtime_reserved_vram_floor_bytes": 16,
                "remaining_allocated_vram_bytes": 8, "remaining_reserved_vram_bytes": 16}
        self.assertTrue(qualification.cleanup_observations_pass(cuda))
        self.assertFalse(qualification.cleanup_observations_pass({**cuda, "runtime_reserved_vram_floor_bytes": 4}))

    def test_cleanup_drains_admitted_stage_probe_and_fences_all_later_file_probes(self):
        report = {"stage_peak_bytes": 0, "phase_memory": {phase: {"peak_rss_bytes": 0} for phase in qualification.MEMORY_PHASES}}
        admitted = threading.Event(); release = threading.Event(); closed = threading.Event()
        calls = []
        def stage():
            calls.append("probe"); admitted.set()
            if not release.wait(2): raise RuntimeError("test probe timeout")
            return 32, False
        sampler = qualification.PhaseSampler(report, lambda: 100, stage)
        probe = threading.Thread(target=sampler.sample)
        probe.start(); self.assertTrue(admitted.wait(2))
        def close():
            sampler.fence_cleanup(); closed.set()
        closer = threading.Thread(target=close); closer.start()
        try:
            self.assertFalse(closed.wait(.02))
        finally:
            release.set(); probe.join(2); closer.join(2)
        self.assertTrue(closed.is_set())
        sampler.sample(); sampler.sample()
        self.assertEqual(calls, ["probe"])
        self.assertEqual(report["phase_memory"]["cleanup"]["peak_rss_bytes"], 100)


if __name__ == "__main__": unittest.main()

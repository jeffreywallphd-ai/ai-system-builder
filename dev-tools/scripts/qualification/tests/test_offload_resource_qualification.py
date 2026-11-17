"""Fixed resource entry tests. No model/native worker or archived output."""
import importlib.util
import builtins
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "run_offload_resource_qualification.py"
spec = importlib.util.spec_from_file_location("offload_resource_test_subject", SCRIPT)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class OffloadResourceEntryTests(unittest.TestCase):
    def test_fixed_current_entry_reports_pending_without_model_process_or_staging_effects(self):
        for args, code in ((["--plan"], 0), ([], 3)):
            output = io.StringIO()
            with self.subTest(args=args), patch("subprocess.Popen", side_effect=AssertionError("unexpected process")), patch.object(Path, "open", side_effect=AssertionError("unexpected content read")), patch.object(Path, "mkdir", side_effect=AssertionError("unexpected directory")), patch("sys.stdout", output):
                self.assertEqual(subject.main(args), code)
            value = json.loads(output.getvalue())
            self.assertEqual(value["status"], "pending-native-protection")
            self.assertEqual(value["quality_status"], "outside-this-resource-run")
            self.assertEqual(value["quality_record"], "docs/operations/model-software-quality-qualification.json")
            self.assertEqual(value["recovery_readiness"]["unproven_retained_budget_charge_bytes"], 12 * 1024**3)
            for key in ("qualification_complete", "quality_tests_executed", "resource_tests_executed", "model_or_worker_started", "old_staging_accessed", "new_staging_created", "parent_qualification_granted"):
                self.assertIs(value[key], False)

    def test_unexpected_gate_failure_does_not_fall_back_to_a_native_run_or_accuracy(self):
        output = io.StringIO()
        with patch.object(subject, "guarded_restart_readiness", side_effect=ValueError("synthetic private gate detail")), patch.object(subject, "require_guarded_context") as gate, patch("sys.stdout", output):
            self.assertEqual(subject.main(["--plan"]), 2)
        gate.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())["status"], "request-refused")
        self.assertNotIn("private", output.getvalue())

    def test_no_cli_root_budget_model_process_proof_or_force_option(self):
        for option in ("--root", "--budget", "--model", "--pid", "--native-proof", "--force", "--run"):
            output = io.StringIO()
            with self.subTest(option=option), patch.object(subject, "current_resource_plan") as plan, patch("sys.stdout", output):
                self.assertEqual(subject.main([option, "synthetic-private-value"]), 2)
            plan.assert_not_called()
            self.assertNotIn("synthetic-private-value", output.getvalue())

    def test_even_a_future_ready_context_does_not_automatically_authorize_model_execution(self):
        output = io.StringIO()
        with patch.object(subject, "require_guarded_context", return_value=object()), patch("subprocess.Popen", side_effect=AssertionError("unexpected launch")), patch("sys.stdout", output):
            self.assertEqual(subject.main([]), 3)
        value = json.loads(output.getvalue())
        self.assertEqual(value["status"], "pending-resource-execution")
        self.assertFalse(value["resource_tests_executed"])

    def test_cold_entry_import_has_no_historical_accuracy_or_framework_dependency(self):
        original = builtins.__import__
        forbidden = {"run_model_blocker_tests", "run_standard_generation_qualification", "run_standalone_model_tests", "run_trained_context_qualification", "run_installed_generation_qualification", "model_quality_fixtures", "torch", "transformers", "accelerate"}
        def checked(name, *args, **kwargs):
            if name.split(".")[0] in forbidden:
                raise AssertionError("Forbidden historical/framework import")
            return original(name, *args, **kwargs)
        cold_spec = importlib.util.spec_from_file_location("cold_offload_resource_subject", SCRIPT)
        cold = importlib.util.module_from_spec(cold_spec)
        with patch("builtins.__import__", side_effect=checked): cold_spec.loader.exec_module(cold)


if __name__ == "__main__": unittest.main()

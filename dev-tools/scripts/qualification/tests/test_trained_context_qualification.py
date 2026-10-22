import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

MODULE = Path(__file__).resolve().parents[1] / "run_trained_context_qualification.py"
spec = importlib.util.spec_from_file_location("trained_context_qualification", MODULE)
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class TrainedContextQualificationTests(unittest.TestCase):
    def setUp(self):
        latch = patch.object(qualification, "_UNCONFIRMED_CHILD", None)
        latch.start()
        self.addCleanup(latch.stop)

    def test_fixed_heldout_labels_are_complete_and_distractors_do_not_add_relevant_duplicates(self):
        rows = list(qualification.rows(1000))
        self.assertEqual(len(rows), 1000)
        self.assertEqual(len({row["chunkIndex"] for row in rows}), 1000)
        for index, (_query, answer) in enumerate(qualification.TOPICS):
            self.assertEqual(sum(row["text"] == answer for row in rows), 5)
            expected = {f"artifact.fixture:row:{row['chunkIndex']}" for row in rows if row["text"] == answer}
            self.assertEqual(qualification.relevant_ids(index), expected)
        with self.assertRaises(ValueError): list(qualification.rows(999))
        with self.assertRaises(ValueError): qualification.relevant_ids(-1)

    def test_model_input_refuses_external_path_and_unknown_revision(self):
        for invalid in ["../outside/acquisition.json", "C:/outside/acquisition.json", ".local-codex/model-qualification/minilm-../acquisition.json"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                qualification.verified_model(invalid)
        with tempfile.TemporaryDirectory() as directory, patch.object(qualification, "ROOT", Path(directory)):
            model = Path(directory)/".local-codex/model-qualification"/("minilm-"+"a"*36)
            model.mkdir(parents=True)
            (model/"acquisition.json").write_text('{"model":"foreign/model","revision":"unknown","status":"verified"}')
            with self.assertRaisesRegex(ValueError,"identity"):
                qualification.verified_model(str((model/"acquisition.json").relative_to(directory)).replace("\\","/"))

    def test_memory_profile_cannot_be_claimed_without_actual_windows_enforcement(self):
        import windows_qualification_memory as memory
        with self.assertRaisesRegex(RuntimeError,"not enforced"):
            memory.memory_profile_evidence()
        with patch.object(memory.sys,"platform","unsupported"), self.assertRaisesRegex(RuntimeError,"unavailable"):
            memory.constrain_current_process()

    def fake_process(self, exit_confirmed=True):
        process = SimpleNamespace(pid=43210, returncode=None, stdin=Mock(), stdout=Mock(), stderr=Mock(), kill=Mock())
        process.poll = lambda: process.returncode
        def wait(timeout):
            if not exit_confirmed:
                raise subprocess.TimeoutExpired("owned-fixture", timeout)
            process.returncode = 0
            return 0
        process.wait = Mock(side_effect=wait)
        return process

    def test_termination_errors_do_not_skip_confirmation_or_replace_workload_failure(self):
        for stop in (OSError("private termination detail"), subprocess.TimeoutExpired("owned-fixture", 10), SimpleNamespace(returncode=1)):
            with self.subTest(stop_type=type(stop).__name__), tempfile.TemporaryDirectory() as directory:
                process = self.fake_process()
                with patch.object(qualification.subprocess, "run") as terminate, patch.object(qualification, "physical_exit_code", return_value=0):
                    if isinstance(stop, Exception):
                        terminate.side_effect = stop
                        process.kill.side_effect = stop
                    else:
                        terminate.return_value = stop
                    with self.assertRaisesRegex(ValueError, "original workload"):
                        try:
                            raise ValueError("original workload")
                        finally:
                            qualification.finish_owned_child(process, [], None, [], [], Path(directory), sys.exc_info()[1])
                process.wait.assert_called_once_with(timeout=10)
                self.assertIsNone(qualification._UNCONFIRMED_CHILD)
                for stream in (process.stdin, process.stdout, process.stderr):
                    stream.close.assert_called_once()

    def test_unconfirmed_exit_latches_all_later_launches_and_does_not_close_blocked_pipes(self):
        for stop_fails in (False, True):
            with self.subTest(stop_fails=stop_fails), tempfile.TemporaryDirectory() as directory, patch.object(qualification, "_UNCONFIRMED_CHILD", None):
                process = self.fake_process(exit_confirmed=False)
                reader = Mock()
                reader.is_alive.return_value = True
                with patch.object(qualification.subprocess, "run") as terminate, patch.object(qualification, "physical_exit_code", return_value=None):
                    if stop_fails:
                        terminate.side_effect = subprocess.TimeoutExpired("owned-fixture", 10)
                        process.kill.side_effect = OSError("private failure")
                    else:
                        terminate.return_value = SimpleNamespace(returncode=0)
                    with self.assertRaises(qualification.UnconfirmedChildExit) as raised:
                        qualification.finish_owned_child(process, [reader], None, [], [], Path(directory), ValueError("private source"))
                process.wait.assert_called_once_with(timeout=10)
                reader.join.assert_called_once_with(timeout=2)
                self.assertEqual(raised.exception.evidence["workload_failure_type"], "ValueError")
                self.assertNotIn("private", json.dumps(raised.exception.evidence))
                for stream in (process.stdin, process.stdout, process.stderr):
                    stream.close.assert_not_called()
                with patch.object(qualification.subprocess, "Popen") as launch, self.assertRaises(qualification.UnconfirmedChildExit):
                    qualification.run_child(SimpleNamespace(samples=30, model_manifest="unused"), Path(directory), 1000, "prepare")
                launch.assert_not_called()

    def test_live_native_descendant_prevents_confirmation_after_launcher_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.fake_process()
            observer = Mock()
            observer.is_alive.return_value = True
            with patch.object(qualification.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(qualification, "physical_exit_code", return_value=None), self.assertRaises(qualification.UnconfirmedChildExit):
                qualification.finish_owned_child(process, [], observer, [], [], Path(directory), None)
            self.assertEqual(process.returncode, 0)
            self.assertIsNotNone(qualification._UNCONFIRMED_CHILD)

    def test_reader_join_failure_cannot_escape_the_fatal_cleanup_latch(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.fake_process()
            reader = Mock()
            reader.join.side_effect = RuntimeError("thread not started")
            reader.is_alive.return_value = False
            with patch.object(qualification.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(qualification, "physical_exit_code", return_value=0), self.assertRaises(qualification.UnconfirmedChildExit) as raised:
                qualification.finish_owned_child(process, [reader], None, [], [], Path(directory), None)
            self.assertIn("ReaderJoinUnavailable", raised.exception.evidence["cleanup_failure_types"])
            self.assertIsNotNone(qualification._UNCONFIRMED_CHILD)
            process.stdout.close.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Native Windows observer admission")
    def test_native_observer_failure_refuses_work_handshake(self):
        with tempfile.TemporaryDirectory() as directory:
            process = self.fake_process()
            process.stdout = io.StringIO(json.dumps({"kind":"ready", "pid":43211, "parent_pid":43210, "rss_bytes":1024}) + "\n")
            process.stderr = io.StringIO("")
            with patch.object(qualification.subprocess, "Popen", return_value=process), patch.object(qualification.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(qualification, "observe", side_effect=ValueError("observer unavailable")), self.assertRaises(qualification.UnconfirmedChildExit):
                qualification.run_child(SimpleNamespace(samples=30, model_manifest="unused"), Path(directory), 1000, "prepare")
            process.stdin.write.assert_not_called()
            self.assertIsNotNone(qualification._UNCONFIRMED_CHILD)

    def test_ready_identity_rejects_boolean_out_of_range_and_foreign_pids(self):
        for pid, parent in ((True,43210), (43211,True), (0,43210), (2**32,43210), (43211,43212)):
            with self.subTest(pid=pid,parent=parent), tempfile.TemporaryDirectory() as directory:
                process = self.fake_process()
                process.stdout = io.StringIO(json.dumps({"kind":"ready", "pid":pid, "parent_pid":parent, "rss_bytes":1024}) + "\n")
                process.stderr = io.StringIO("")
                with patch.object(qualification.subprocess, "Popen", return_value=process), patch.object(qualification, "finish_owned_child"), patch.object(qualification, "observe") as observe, self.assertRaisesRegex(ValueError, "identity failed"):
                    qualification.run_child(SimpleNamespace(samples=30, model_manifest="unused"), Path(directory), 1000, "prepare")
                observe.assert_not_called()
                process.stdin.write.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Native Windows exit readback")
    def test_native_readback_requires_completed_observer_and_integer_exit(self):
        observer = Mock()
        for alive, values, expected in ((True,[0],None), (False,[],None), (False,[None],None), (False,[True],None), (False,[-1],None), (False,[2**32],None), (False,[0],0), (False,[7],7)):
            with self.subTest(alive=alive,values=values):
                observer.is_alive.return_value = alive
                self.assertEqual(qualification.physical_exit_code(self.fake_process(), observer, values), expected)
        observer.join.side_effect = RuntimeError("observer not started")
        self.assertIsNone(qualification.physical_exit_code(self.fake_process(), observer, [0]))

    def test_every_matrix_failure_handler_aborts_and_preserves_partial_report(self):
        for prior_successes in (0, 1, 2):
            with self.subTest(prior_successes=prior_successes), tempfile.TemporaryDirectory() as directory:
                failure = qualification.UnconfirmedChildExit(43210, ValueError("private detail"), ["TimeoutExpired"])
                with patch.object(qualification, "ROOT", Path(directory)), patch.object(qualification, "verified_model"), patch.object(qualification, "source_identity", return_value="source.fixture"), patch.object(qualification.sys, "argv", ["qualification", "--model-manifest", "unused", "--samples", "8", "--chunks", "1000"]), patch.object(qualification, "run_child", side_effect=[{}] * prior_successes + [failure]) as run, self.assertRaises(SystemExit) as stopped:
                    qualification.main()
                self.assertEqual(stopped.exception.code, 1)
                self.assertEqual(run.call_count, prior_successes + 1)
                reports = list((Path(directory) / ".local-codex/trained-context").glob("*/report.json"))
                self.assertEqual(len(reports), 1)
                report = json.loads(reports[0].read_text())
                self.assertEqual(report["status"], "aborted-unconfirmed-child-exit")
                self.assertFalse(report["qualification_complete"])
                self.assertEqual(report["cleanup_pending"], failure.evidence)
                self.assertNotIn("private detail", json.dumps(report))

    def test_actual_owned_handshake_exit_and_followup_after_workload_failure(self):
        # A harmless protocol fixture proves native observation, not model quality.
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            fixture = folder / "owned-worker.py"
            fixture.write_text('import json,os,sys\nprint(json.dumps({"kind":"ready","pid":os.getpid(),"parent_pid":os.getppid(),"rss_bytes":1024}),flush=True)\nif sys.stdin.readline().strip()!="run": raise SystemExit(3)\n' + 'raise SystemExit(7)\n', encoding="utf8")
            args = SimpleNamespace(samples=8, model_manifest="unused-no-model")
            with patch.object(qualification, "SCRIPT", fixture), self.assertRaisesRegex(RuntimeError, "qualification failed"):
                qualification.run_child(args, folder, 1000, "prepare")
            self.assertIsNone(qualification._UNCONFIRMED_CHILD)
            fixture.write_text(fixture.read_text().replace('raise SystemExit(7)', 'print(json.dumps({"kind":"result","corpus":{}}),flush=True)'), encoding="utf8")
            with patch.object(qualification, "SCRIPT", fixture):
                result = qualification.run_child(args, folder, 1000, "prepare")
            self.assertEqual(result["physical_exit_code"], 0)
            self.assertIsNone(qualification._UNCONFIRMED_CHILD)


if __name__ == "__main__": unittest.main()

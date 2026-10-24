"""Portable denial evidence; native cases require explicit controlled opt-in."""
from pathlib import Path
import contextlib
import ctypes
import importlib.util
import io
import os
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/"owned_command_job.py"
spec=importlib.util.spec_from_file_location("owned_command_job_under_test",SOURCE)
job=importlib.util.module_from_spec(spec);sys.modules[spec.name]=job;spec.loader.exec_module(job)


class PortableNativePolicyTests(unittest.TestCase):
    def setUp(self):
        self.pending=dict(job._PENDING);self.live=dict(job._LIVE)

    def tearDown(self):
        # Restore only injected test objects; production has no reset API.
        job._PENDING.clear();job._PENDING.update(self.pending)
        job._LIVE.clear();job._LIVE.update(self.live)

    def fake_owned(self):
        native=SimpleNamespace(k=SimpleNamespace(CloseHandle=lambda handle:True))
        with patch.object(job,"_validate_intent"),patch.object(job,"_Win",return_value=native):
            return job._OwnedJob(SimpleNamespace(seconds=.01),SOURCE.parent)

    def test_zero_shutdown_oracle_is_strict_about_count_and_type(self):
        self.assertTrue(job.strict_shutdown_codes([0,0],2))
        for values,count in (([97],1),([23],1),([False],1),([0.0],1),([],0),([0],True),([0],2)):
            with self.subTest(values=values,count=count):self.assertFalse(job.strict_shutdown_codes(values,count))

    def test_cli_has_no_command_pid_path_or_qualify_route(self):
        for values in (("--command","whoami"),("--pid","42"),("--cwd","C:/"),("--qualify",)):
            with self.subTest(values=values),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):job._parser().parse_args(values)

    def test_unknown_fixture_is_denied_before_native_or_directory_work(self):
        with self.assertRaises(job.NativeFailure):job._fixture_intent("../other",Path("unowned"))

    def test_unknown_host_phase_is_denied_before_native_work(self):
        with self.assertRaises(job.NativeFailure):job._reviewed_host_intent("shell",candidate=Path("none"),node_executable=Path("none"),node_sha256="",run=Path("none"),folder=Path("none"),reviewed_file_hashes={},environment={},environment_sha256="",review_digest="")

    def test_unissued_intent_cannot_reach_native_creation(self):
        with self.assertRaises(job.NativeFailure):job._validate_intent(object(),Path("none"))

    def test_pending_exact_owner_blocks_successor_without_reset_api(self):
        previous=dict(job._PENDING);owner=object()
        try:
            job._retain_pending(owner)
            self.assertIs(job._PENDING[id(owner)],owner)
            with self.assertRaises(job.NativeFailure):job._assert_no_pending()
            self.assertFalse(hasattr(job,"clear_pending"))
        finally:job._PENDING.clear();job._PENDING.update(previous)

    def test_failed_close_stays_in_exact_owned_handle_ledger(self):
        class Kernel:
            def CloseHandle(self,handle):return False
        class Native:k=Kernel()
        owned=object.__new__(job._OwnedJob);owned.n=Native();owned.owned={"job":123};owned.cleanup_errors=[]
        self.assertFalse(owned.close("job"))
        self.assertEqual(owned.owned,{"job":123});self.assertEqual(owned.cleanup_errors,["close-job:NativeFailure"])
        self.assertIs(job._PENDING[id(owned)],owned)

    def test_explicit_inherited_list_excludes_job_root_read_and_port_handles(self):
        owned=object.__new__(job._OwnedJob)
        owned.owned={"stdin":11,"stdout-write":12,"stderr-write":13,"stdout-read":14,"stderr-read":15,"job":16,"completion-port":17,"root":18}
        self.assertEqual(owned._inherited_stdio_handles(),(11,12,13))

    def test_redirected_fixture_parent_is_denied(self):
        root=SOURCE.parent.resolve()
        with self.assertRaises(job.NativeFailure):job._regular_directory(root.parent,root)

    def test_owner_is_registered_before_native_initialization_and_failure_stays_pending(self):
        def fail():
            self.assertEqual(len(job._LIVE),1)
            raise OSError("injected native adapter failure")
        with patch.object(job,"_validate_intent"),patch.object(job,"_Win",side_effect=fail):
            with self.assertRaises(OSError):job._OwnedJob(object(),SOURCE.parent)
        self.assertEqual(len(job._PENDING),1)
        with patch.object(job,"_validate_intent"),patch.object(job,"_Win") as native:
            with self.assertRaises(job.NativeFailure):job._OwnedJob(object(),SOURCE.parent)
            native.assert_not_called()

    def test_partial_prepare_failure_retains_exact_job_and_blocks_new_launch(self):
        owned=self.fake_owned()
        def fail_prepare():
            owned.job=123;owned.owned["job"]=123
            raise OSError("injected prepare failure")
        with patch.object(owned,"prepare",side_effect=fail_prepare),patch.object(owned,"accounting",side_effect=OSError("injected readback")):
            result=owned.run()
        self.assertFalse(result["command_passed"]);self.assertFalse(result["cleanup_confirmed"])
        self.assertEqual(owned.owned,{"job":123});self.assertIs(job._PENDING[id(owned)],owned)
        with self.assertRaises(job.NativeFailure):job._assert_no_pending()

    def test_raised_native_close_keeps_handle_and_other_closes_continue(self):
        owned=self.fake_owned();owned.owned={"stdout-read":11,"stderr-read":12}
        calls=[]
        def close(handle):
            calls.append(handle)
            if handle==11:raise OSError("injected CloseHandle")
            return True
        owned.n.k.CloseHandle=close
        result=owned.finish()
        self.assertEqual(calls,[11,12]);self.assertEqual(owned.owned,{"stdout-read":11})
        self.assertFalse(result["cleanup_confirmed"]);self.assertIs(job._PENDING[id(owned)],owned)

    def test_injected_pipe_read_failure_is_not_success_or_cleanup_proof(self):
        owned=self.fake_owned();owned.process=SimpleNamespace(process=55);owned.job=54
        owned.owned={"job":54,"root":55,"stdout-read":56}
        owned.n.k.ReadFile=lambda *args:(_ for _ in ()).throw(OSError("injected read"))
        with patch.object(Path,"open",return_value=io.BytesIO()):owned._drain("stdout",56)
        self.assertTrue(owned.pipe_error.is_set());self.assertFalse(owned.log_state["stdout"]["complete"])
        owned.threads=[SimpleNamespace(join=lambda timeout:None,is_alive=lambda:False)]
        owned.n.exit_code=lambda *args:0;owned.n.inheritable=lambda handle:False
        with patch.object(owned,"accounting",return_value={"total":1,"active":0,"terminated":1}),patch.object(owned,"poll_events"),patch.object(owned,"limits",return_value=SimpleNamespace(peak_process=0,peak_job=0)):
            result=owned.finish()
        self.assertFalse(result["cleanup_confirmed"]);self.assertIn("stdout-read",owned.owned)
        self.assertIs(job._PENDING[id(owned)],owned)

    def test_finished_owner_returns_isolated_cached_result_without_native_reentry(self):
        owned=self.fake_owned();first=owned.finish()
        self.assertTrue(first["cleanup_confirmed"]);self.assertNotIn(id(owned),job._LIVE)
        with patch.object(owned,"accounting",side_effect=AssertionError("stale native call")),patch.object(owned,"close",side_effect=AssertionError("stale close")):
            second=owned.finish();second["cleanup_errors"].append("caller mutation")
            self.assertEqual(owned.finish(),first)
            for operation in (owned.prepare,owned.resume,owned.run):
                with self.assertRaises(job.NativeFailure):operation()

    def test_pending_uncertainty_denies_prepared_resume_before_native_query(self):
        owned=self.fake_owned();owned.phase="prepared";job._retain_pending(owned)
        with patch.object(owned,"limits",side_effect=AssertionError("native read after pending")):
            with self.assertRaises(job.NativeFailure):owned.resume()

    def test_protocol_tail_has_a_deadline_even_when_pipe_never_reaches_eof(self):
        native=SimpleNamespace(k=SimpleNamespace(PeekNamedPipe=lambda *args:1))
        with patch.dict(sys.modules,{"msvcrt":SimpleNamespace(get_osfhandle=lambda descriptor:123)}),patch.object(job,"_Win",return_value=native),patch.object(job.time,"monotonic",side_effect=[0,2]),patch.object(job.time,"sleep"):
            with self.assertRaisesRegex(job.NativeFailure,"fixed-tail-timeout"):
                job.bounded_eof(SimpleNamespace(fileno=lambda:0),1,4096)

    def observer_fixture(self,*,stream_error=False,detach_error=False,native_close_error=False):
        events=[]
        class Stream:
            closed=False
            def __init__(self,name):self.name=name
            def close(self):
                events.append("stream-"+self.name)
                if stream_error and self.name=="stdin":raise OSError("injected stream close")
                self.closed=True
        class Handle:
            def Detach(self):
                events.append("detach")
                if detach_error:raise OSError("injected Detach")
                return 99
        process=SimpleNamespace(stdin=Stream("stdin"),stdout=Stream("stdout"),stderr=Stream("stderr"),_handle=Handle(),returncode=71,poll=lambda:71)
        def close(handle):
            events.append(handle)
            if native_close_error:raise OSError("injected observer close")
            return True
        observer={"process":process,"copied":[88],"guardian_raw":None,"launch_attempted":True}
        job._register_owner(observer)
        return observer,SimpleNamespace(k=SimpleNamespace(CloseHandle=close)),events

    def test_observer_stream_close_exception_does_not_skip_other_exact_resources(self):
        observer,native,events=self.observer_fixture(stream_error=True)
        self.assertFalse(job._cleanup_observer(observer,native))
        self.assertIn("stream-stderr",events);self.assertIn(88,events);self.assertIn(99,events)
        self.assertIs(job._PENDING[id(observer)],observer)
        self.assertFalse(observer["process"].stdin.closed)

    def test_observer_detach_exception_retains_popen_and_closes_other_handles(self):
        observer,native,events=self.observer_fixture(detach_error=True)
        self.assertFalse(job._cleanup_observer(observer,native));self.assertIn(88,events)
        self.assertIsNotNone(observer["process"]._handle);self.assertIs(job._PENDING[id(observer)],observer)

    def test_observer_native_close_exception_retains_raw_and_duplicate_handles(self):
        observer,native,events=self.observer_fixture(native_close_error=True)
        self.assertFalse(job._cleanup_observer(observer,native))
        self.assertEqual(observer["copied"],[88]);self.assertEqual(observer["guardian_raw"],99)
        count=len(events);self.assertFalse(job._cleanup_observer(observer,native));self.assertEqual(len(events),count)
        self.assertIs(job._PENDING[id(observer)],observer)

    def test_observer_success_is_terminal_and_does_not_detach_retired_handle_again(self):
        observer,native,events=self.observer_fixture()
        self.assertTrue(job._cleanup_observer(observer,native));count=len(events)
        self.assertTrue(job._cleanup_observer(observer,native));self.assertEqual(len(events),count)
        self.assertNotIn(id(observer),job._LIVE)

    def test_unobserved_popen_outcome_is_pending_before_any_successor(self):
        observer={"process":None,"copied":[],"guardian_raw":None,"launch_attempted":True}
        job._register_owner(observer)
        self.assertFalse(job._cleanup_observer(observer,None));self.assertIs(job._PENDING[id(observer)],observer)
        with self.assertRaises(job.NativeFailure):job._register_owner(object())

    def test_native_limits_are_finite_and_exclude_breakaway(self):
        self.assertEqual(job.PROCESS_BYTES,1024**3);self.assertEqual(job.JOB_BYTES,2*1024**3);self.assertEqual(job.MEMBERS,32)
        self.assertEqual(job.LIMIT_FLAGS,0x2308)
        self.assertEqual(job.LIMIT_FLAGS & (0x800|0x1000),0)

    def test_atomic_creation_uses_detached_pipe_only_flags_and_explicit_attributes(self):
        calls={"attributes":[]};inherited=set();next_pipe=iter(((11,12),(13,14)))
        def pipe(read,write,*args):
            read._obj.value,write._obj.value=next(next_pipe);inherited.add(write._obj.value)
            return 1
        def initialize(storage,count,flags,size):
            size._obj.value=128
            return int(storage is not None)
        def attribute(storage,flags,name,value,size,*args):
            calls["attributes"].append((name,tuple(value._obj)))
            return 1
        def create(*args):
            calls["flags"]=args[5];calls["inherit"]=args[4]
            return 0  # Stop at the boundary; no native command is launched.
        native=SimpleNamespace(k=SimpleNamespace(CreateJobObjectW=lambda *args:1,SetInformationJobObject=lambda *args:1,CreateIoCompletionPort=lambda *args:2,CreatePipe=pipe,SetHandleInformation=lambda *args:1,CreateFileW=lambda *args:30,InitializeProcThreadAttributeList=initialize,UpdateProcThreadAttribute=attribute,CreateProcessW=create,DeleteProcThreadAttributeList=lambda *args:None),inheritable=lambda handle:handle in inherited or handle==30)
        intent=SimpleNamespace(argv=("fixed-python","-I"),environment={},cwd=SOURCE.parent)
        with patch.object(job,"_validate_intent"),patch.object(job,"_Win",return_value=native),patch.object(job.c,"get_last_error",return_value=122,create=True):
            owned=job._OwnedJob(intent,SOURCE.parent)
            with patch.object(owned,"limits"),self.assertRaisesRegex(job.NativeFailure,"atomic-process-create"):owned.prepare()
        self.assertEqual(calls["flags"],0x80000|0x4|0x400|0x8)
        self.assertEqual(calls["flags"] & (0x08000000|0x01000000|0x10),0)
        self.assertIs(calls["inherit"],True)
        self.assertEqual(calls["attributes"],[(job.JOB_LIST_ATTRIBUTE,(1,)),(job.HANDLE_LIST_ATTRIBUTE,(30,12,14))])

    def test_fixed_leaf_uses_detached_without_breakaway_or_no_window(self):
        with patch.object(job.subprocess,"Popen",return_value=SimpleNamespace(_handle=55)) as popen,patch.object(job,"_Win",return_value=SimpleNamespace(identity=lambda handle:{"pid":42,"creation_ticks":43})),patch.object(job.time,"sleep"),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(job.fixture("timeout"),97)
        self.assertEqual(popen.call_args.kwargs["creationflags"],0x8)
        self.assertTrue(popen.call_args.kwargs["close_fds"])

    def test_fixed_guardian_uses_detached_and_unknown_launch_stays_pending(self):
        with patch.object(job,"_Win",return_value=object()),patch.object(job.subprocess,"Popen",side_effect=OSError("injected pre-launch denial")) as popen:
            with self.assertRaises(job.NativeFailure):job.crash_case("before-resume")
        self.assertEqual(popen.call_args.kwargs["creationflags"],0x8)
        self.assertTrue(popen.call_args.kwargs["close_fds"])
        self.assertEqual(len(job._PENDING),1)

    def test_detached_revision_family_does_not_reuse_old_failed_fences(self):
        self.assertEqual(job._SELFTEST_RUNS,job._REPO/".local-codex/native-detached-command-selftests-v2")
        self.assertNotEqual(job._SELFTEST_RUNS,job._REPO/".local-codex/native-command-selftests")

    def test_protocol_reader_uses_polling_not_daemon_thread(self):
        # The callable owns no asynchronous reader whose stream could be closed
        # under an unknown blocked read; native pipe drains are tracked separately.
        self.assertNotIn("Thread",job.bounded_line.__code__.co_names)
        self.assertIn("PeekNamedPipe",job.bounded_line.__code__.co_names)

    def test_import_does_not_create_pending_jobs_or_launch_processes(self):
        self.assertEqual(job._PENDING,{})
        self.assertEqual(job._LIVE,{})
        self.assertFalse(hasattr(job,"run_command"));self.assertFalse(hasattr(job,"terminate_pid"))


class ControlledWindowsNativeTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("AISB_RUN_FIXED_NATIVE_QUALIFICATION")=="1" and os.name=="nt" and ctypes.sizeof(ctypes.c_void_p)==8,"pending physical Windows qualification; explicit model-free native opt-in required")
    def test_actual_seven_native_lifecycle_cases(self):
        result=job.run_native_selftests()
        self.assertTrue(result["passed"]);self.assertEqual(result["expected_native_cases"],7)
        self.assertEqual(len(result["cases"]),7);self.assertTrue(all(item["passed"] for item in result["cases"]))
        self.assertFalse(result["portable_pass_claimed"])


if __name__=="__main__":unittest.main()

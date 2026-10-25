"""Portable denial evidence; native cases require explicit controlled opt-in."""
from pathlib import Path
import contextlib
import ctypes
import importlib.util
import hashlib
import io
import json
import os
import sys
import tempfile
import builtins
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/"owned_command_job.py"
spec=importlib.util.spec_from_file_location("owned_command_job_under_test",SOURCE)
job=importlib.util.module_from_spec(spec);sys.modules[spec.name]=job;spec.loader.exec_module(job)


class PortableNativePolicyTests(unittest.TestCase):
    def setUp(self):
        self.pending=dict(job._PENDING);self.live=dict(job._LIVE);self.issued=dict(job._ISSUED)

    def tearDown(self):
        # Restore only injected test objects; production has no reset API.
        job._PENDING.clear();job._PENDING.update(self.pending)
        job._LIVE.clear();job._LIVE.update(self.live)
        job._ISSUED.clear();job._ISSUED.update(self.issued)

    def issued_intent(self,phase):
        return job._remember(job._Intent(phase,(),SOURCE.parent,{},.01,SOURCE.parent,{},{}))

    def fake_owned(self):
        native=SimpleNamespace(k=SimpleNamespace(CloseHandle=lambda handle:True))
        with patch.object(job,"_validate_intent"),patch.object(job,"_Win",return_value=native):
            return job._OwnedJob(self.issued_intent("fixture:stdio"),SOURCE.parent)

    def test_job_memory_profiles_are_fixed_and_require_an_issued_identity(self):
        for phase in ("package", "fixture:stdio", "fixture:failure", "fixture:hold", "ocr-runtime-import"):
            self.assertEqual(job._job_memory_limit(self.issued_intent(phase)),2*1024**3)
        for phase in ("ui", "fixture:ui-budget"):
            self.assertEqual(job._job_memory_limit(self.issued_intent(phase)),3*1024**3)
        for phase in ("shell", "ui:custom", "fixture:unknown", None, True):
            with self.subTest(phase=phase),self.assertRaises(job.NativeFailure):
                job._job_memory_limit(self.issued_intent(phase))
        unissued=job._Intent("ui",(),SOURCE.parent,{},.01,SOURCE.parent,{},{})
        with self.assertRaises(job.NativeFailure):job._job_memory_limit(unissued)

    def test_approved_ocr_limits_are_fixed_and_standard_and_legacy_limits_stay_separate(self):
        for phase in ("package","ui","ocr-runtime-import","ocr-runtime-import-v2","fixture:ui-budget","fixture:ocr-budget"):
            for scenario in (None,"dataset-profile","ocr-documents"):
                with self.subTest(phase=phase,scenario=scenario):
                    env={} if scenario is None else {"PYTHON_RUNTIME_QUALIFICATION_SCENARIO":scenario}
                    intent=job._remember(job._Intent(phase,(),SOURCE.parent,env,.01,SOURCE.parent,{},{}))
                    is_ocr=phase in ("ocr-runtime-import-v2","fixture:ocr-budget") or phase in ("package","ui") and scenario=="ocr-documents"
                    expected=(2,4) if is_ocr else (1,3 if phase in ("ui","fixture:ui-budget") else 2)
                    self.assertEqual(job._memory_limits(intent),tuple(value*1024**3 for value in expected))
        forged=job._Intent("ocr-runtime-import-v2",(),SOURCE.parent,{},.01,SOURCE.parent,{},{})
        with self.assertRaises(job.NativeFailure):job._process_memory_limit(forged)

    def test_direct_runtime_factory_pins_base_venv_context_and_rejects_selectors_or_stale_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();runtime=root/".local-codex/ocr-cached-runtime-v1/venv"
            python=runtime/"Scripts/python.exe";python.parent.mkdir(parents=True);python.write_bytes(b"fixed redirector fixture")
            base=root/"base/python.exe";base.parent.mkdir();base.write_bytes(b"fixed direct base fixture")
            config=runtime/"pyvenv.cfg";config.write_text("home = "+str(base.parent)+"\n",encoding="utf8")
            runs=root/".local-codex/native-ocr-runtime-import-v2/runs";run=runs/("a"*32);folder=run/"runtime-import"
            for name in ("t","h"):(folder/name).mkdir(parents=True)
            with patch.object(job,"_REPO",root),patch.object(job,"_OCR_IMPORT_V2_RUNS",runs), \
                    patch.object(job,"_OCR_IMPORT_RUNS",root/".local-codex/native-ocr-runtime-import-v1/runs"), \
                    patch.object(job,"_OCR_IMPORT_PYTHON_SHA",job._digest(python)), \
                    patch.object(job,"_OCR_IMPORT_CONFIG_SHA",job._digest(config)), \
                    patch.object(job,"_OCR_IMPORT_BASE_SHA",job._digest(base)), \
                    patch.object(job.sys,"_base_executable",str(base)), \
                    patch.dict(os.environ,{"SystemRoot":str(root/"Windows"),"SECRET_TOKEN":"never-forward"},clear=True), \
                    patch.object(job,"_Win") as native:
                args=dict(run=run,folder=folder,review_digest="b"*64)
                intent=job._reviewed_ocr_runtime_import_intent_v2(**args)
                self.assertEqual(intent.argv,(str(base),"-I","-B","-c",job._OCR_IMPORT_SCRIPT_V2))
                self.assertNotIn("-S",intent.argv);self.assertEqual(intent.seconds,20)
                self.assertEqual(job._memory_limits(intent),(2*1024**3,4*1024**3))
                self.assertEqual(intent.environment["__PYVENV_LAUNCHER__"],str(python))
                self.assertEqual(intent.environment["AISB_OCR_EXPECTED_PREFIX"],str(runtime))
                self.assertEqual(intent.environment["AISB_OCR_EXPECTED_BASE"],str(base))
                for secret in ("SECRET_TOKEN","APPDATA","LOCALAPPDATA","PYTHONPATH"):
                    self.assertNotIn(secret,intent.environment)
                self.assertEqual(set(intent.consumer_hashes),{str(python),str(config),str(base)})
                for selector in ("command","environment","process_bytes","python_executable"):
                    with self.subTest(selector=selector),self.assertRaises(TypeError):
                        job._reviewed_ocr_runtime_import_intent_v2(**args,**{selector:"arbitrary"})
                with self.assertRaises(job.NativeFailure):job._reviewed_ocr_runtime_import_intent_v2(**{**args,"folder":run/"wrong"})
                (folder/"03-final.json").write_bytes(b"old-result")
                with self.assertRaises(job.NativeFailure):job._reviewed_ocr_runtime_import_intent_v2(**args)
                self.assertEqual((folder/"03-final.json").read_bytes(),b"old-result")
                (folder/"03-final.json").unlink()
                # The earlier consumer writes runs/FENCED.json, not just its parent.
                for fence_root in (job._OCR_IMPORT_RUNS,job._OCR_IMPORT_V2_RUNS,job._OCR_IMPORT_RUNS.parent,job._OCR_IMPORT_V2_RUNS.parent):
                    fence_root.mkdir(parents=True,exist_ok=True)
                    fence=fence_root/"FENCED.json";fence.write_bytes(b"uncertain diagnostic owner")
                    with self.subTest(fence_root=fence_root),self.assertRaises(job.NativeFailure):
                        job._reviewed_ocr_runtime_import_intent_v2(**args)
                    self.assertEqual(fence.read_bytes(),b"uncertain diagnostic owner");fence.unlink()
                original_config=config.read_bytes()
                config.write_text("home = "+str(root/"wrong-base")+"\n",encoding="utf8")
                with patch.object(job,"_OCR_IMPORT_CONFIG_SHA",job._digest(config)),self.assertRaises(job.NativeFailure):
                    job._reviewed_ocr_runtime_import_intent_v2(**args)
                config.write_bytes(original_config)
                base.write_bytes(b"changed base")
                with self.assertRaises(job.NativeFailure):job._reviewed_ocr_runtime_import_intent_v2(**args)
                native.assert_not_called()

    def test_new_family_refuses_an_uncertain_prior_family_without_changing_its_fence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();family=root/"old-family";family.mkdir()
            fence=family/"FENCED.json";fence.write_bytes(b"preserved prior uncertainty")
            with patch.object(job,"_REPO",root):
                with self.assertRaises(job.NativeFailure):job._prior_family_clear(family)
                self.assertEqual(fence.read_bytes(),b"preserved prior uncertainty")
                job._prior_family_clear(root/"absent-family")
                self.assertFalse((root/"absent-family").exists())

    def test_runtime_import_factory_has_no_caller_command_environment_or_budget(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();runtime=root/".local-codex/ocr-cached-runtime-v1/venv"
            (runtime/"Scripts").mkdir(parents=True)
            python=runtime/"Scripts/python.exe";python.write_bytes(b"synthetic-executable-not-run")
            config=runtime/"pyvenv.cfg";config.write_bytes(b"synthetic-config")
            family=root/".local-codex/native-ocr-runtime-import-v1/runs"
            run=family/("1"*32);folder=run/"runtime-import"
            (folder/"t").mkdir(parents=True);(folder/"h").mkdir()
            with patch.object(job,"_REPO",root),patch.object(job,"_OCR_IMPORT_RUNS",family), \
                    patch.object(job,"_OCR_IMPORT_PYTHON_SHA",job._digest(python)), \
                    patch.object(job,"_OCR_IMPORT_CONFIG_SHA",job._digest(config)), \
                    patch.dict(os.environ,{"SystemRoot":str(root/"Windows"),"SECRET_TOKEN":"never-forward"},clear=True):
                intent=job._reviewed_ocr_runtime_import_intent(run=run,folder=folder,review_digest="a"*64)
                self.assertEqual(intent.argv,(str(python),"-c",job._OCR_IMPORT_SCRIPT))
                self.assertEqual(intent.cwd,folder);self.assertEqual(intent.seconds,20)
                self.assertEqual(job._job_memory_limit(intent),2*1024**3)
                self.assertNotIn("SECRET_TOKEN",intent.environment)
                self.assertEqual(intent.environment["HOME"],str(folder/"h"))
                self.assertEqual(intent.environment["PIP_NO_INDEX"],"1")
                with self.assertRaises(TypeError):
                    job._reviewed_ocr_runtime_import_intent(run=run,folder=folder,review_digest="a"*64,command="arbitrary")
                with self.assertRaises(job.NativeFailure):
                    job._reviewed_ocr_runtime_import_intent(run=run,folder=run/"other",review_digest="a"*64)
                (folder/"01-before-import.json").write_bytes(b"old-result")
                with self.assertRaises(job.NativeFailure):
                    job._reviewed_ocr_runtime_import_intent(run=run,folder=folder,review_digest="a"*64)
                self.assertEqual((folder/"01-before-import.json").read_bytes(),b"old-result")
                python.write_bytes(b"changed-runtime")
                with self.assertRaises(job.NativeFailure):
                    job._reviewed_ocr_runtime_import_intent(run=run,folder=folder,review_digest="a"*64)

    def drain_bytes(self,phase,chunks,maximum=8*1024**2,stream_name="stdout"):
        with tempfile.TemporaryDirectory() as temporary:
            owned=self.fake_owned();owned.folder=Path(temporary)
            owned.intent=self.issued_intent(phase)
            iterator=iter(chunks)
            def read(handle,buffer,capacity,count,overlapped):
                try:chunk=next(iterator)
                except StopIteration:return 0
                self.assertLessEqual(len(chunk),capacity)
                ctypes.memmove(buffer,chunk,len(chunk))
                ctypes.cast(count,ctypes.POINTER(ctypes.c_uint32)).contents.value=len(chunk)
                return 1
            owned.n.k.ReadFile=read
            with patch.object(job.c,"get_last_error",return_value=109,create=True),patch.object(job,"LOG_CAP",maximum):
                owned._drain(stream_name,123)
            # Remove only this injected fake owner; no real native handles exist.
            job._LIVE.pop(id(owned),None)
            return (owned,(owned.folder/(stream_name+".log")).read_bytes())

    def test_runtime_import_discards_supplier_bytes_and_first_line_before_retention(self):
        private=b"supplier exception /private/path token=secret\n"
        for phase in ("ocr-runtime-import","ocr-runtime-import-v2"):
            with self.subTest(phase=phase):
                owned,saved=self.drain_bytes(phase,[private,b"more private bytes"])
                self.assertEqual(saved,b"");self.assertTrue(owned.first.empty())
                self.assertEqual(owned.log_state["stdout"]["observed_bytes"],len(private)+18)
                self.assertEqual(owned.log_state["stdout"]["bytes"],0)
                self.assertEqual(owned.log_state["stdout"]["sha256"],hashlib.sha256(b"").hexdigest())
                self.assertTrue(owned.log_state["stdout"]["raw_content_discarded"])
                self.assertFalse(owned.pipe_error.is_set())
                error_owner,error_saved=self.drain_bytes(phase,[private],stream_name="stderr")
                self.assertEqual(error_saved,b"");self.assertTrue(error_owner.first.empty())
                self.assertEqual(error_owner.log_state["stderr"]["observed_bytes"],len(private))
                self.assertTrue(error_owner.log_state["stderr"]["raw_content_discarded"])
        normal,normal_saved=self.drain_bytes("fixture:stdio",[b"fixed-line\n"])
        self.assertEqual(normal_saved,b"fixed-line\n")
        self.assertEqual(normal.first.get_nowait(),b"fixed-line")
        self.assertNotIn("raw_content_discarded",normal.log_state["stdout"])

    def test_runtime_import_discard_does_not_disable_observed_byte_overflow(self):
        for phase in ("ocr-runtime-import","ocr-runtime-import-v2"):
            with self.subTest(phase=phase):
                owned,saved=self.drain_bytes(phase,[b"123456789"],maximum=8)
                self.assertEqual(saved,b"");self.assertTrue(owned.overflow.is_set())
                self.assertEqual(owned.log_state["stdout"]["observed_bytes"],9)
                self.assertTrue(owned.log_state["stdout"]["complete"])

    def test_runtime_import_facts_distinguish_import_and_accelerator_failures_without_messages(self):
        original_import=builtins.__import__
        for failure in (None,"import","accelerator-check"):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as temporary:
                def available():
                    if failure=="accelerator-check":raise RuntimeError("private supplier message")
                    return False
                torch=SimpleNamespace(cuda=SimpleNamespace(is_available=available))
                def imported(name,*args,**kwargs):
                    if name=="torch":
                        if failure=="import":raise ImportError("private supplier message")
                        return torch
                    return original_import(name,*args,**kwargs)
                before=Path.cwd()
                try:
                    os.chdir(temporary)
                    with patch.object(builtins,"__import__",side_effect=imported):
                        if failure is None:exec(compile(job._OCR_IMPORT_SCRIPT,"<fixed-diagnostic>","exec"),{})
                        else:
                            with self.assertRaises(SystemExit) as exit:
                                exec(compile(job._OCR_IMPORT_SCRIPT,"<fixed-diagnostic>","exec"),{})
                            self.assertEqual(exit.exception.code,1)
                    files=sorted(Path(temporary).glob("*.json"))
                    self.assertEqual(len(files),2 if failure=="import" else 3)
                    self.assertTrue(all(file.stat().st_size<=1024 for file in files))
                    self.assertTrue(all(b"private supplier" not in file.read_bytes() for file in files))
                    final=json.loads(Path("03-final.json").read_bytes())
                    self.assertEqual(final["success"],failure is None)
                    self.assertEqual(final["imported"],failure!="import")
                    self.assertEqual(final["failure_stage"],failure)
                    self.assertEqual(final["pid"],os.getpid())
                finally:os.chdir(before)

    def execute_direct_import_fixture(self,identity_change=None,failure=None):
        original_import=builtins.__import__;torch_imports=[]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();prefix=root/"venv";base=root/"base/python.exe"
            flags=SimpleNamespace(isolated=1,no_user_site=1,dont_write_bytecode=1,no_site=0)
            python=SimpleNamespace(executable=str(prefix/"Scripts/python.exe"),prefix=str(prefix),exec_prefix=str(prefix),
                _base_executable=str(base),base_prefix=str(base.parent),base_exec_prefix=str(base.parent),flags=flags)
            attributes={"executable":"executable","prefix":"prefix","exec_prefix":"exec_prefix", "base_executable":"_base_executable","base_prefix":"base_prefix","base_exec_prefix":"base_exec_prefix"}
            if identity_change in attributes:setattr(python,attributes[identity_change],str(root/"wrong"))
            if identity_change in ("isolated","no_user_site","bytecode_disabled","site_enabled"):
                attribute={"bytecode_disabled":"dont_write_bytecode","site_enabled":"no_site"}.get(identity_change,identity_change)
                setattr(flags,attribute,1 if attribute=="no_site" else 0)
            metadata=SimpleNamespace(version=lambda name:"0" if identity_change=="guidance_distribution" else "1.9.1",
                distribution=lambda name:SimpleNamespace(locate_file=lambda item:prefix/"Lib/site-packages"))
            def available():
                if failure=="accelerator-check":raise RuntimeError("private supplier message")
                return False
            def imported(name,*args,**kwargs):
                if name=="sys":return python
                if name=="importlib":return SimpleNamespace(metadata=metadata)
                if name=="torch":
                    torch_imports.append(name)
                    if failure=="import":raise ImportError("private supplier message")
                    return SimpleNamespace(cuda=SimpleNamespace(is_available=available))
                return original_import(name,*args,**kwargs)
            before=Path.cwd()
            try:
                os.chdir(root)
                with patch.dict(os.environ,{"AISB_OCR_EXPECTED_PREFIX":str(prefix),"AISB_OCR_EXPECTED_BASE":str(base)}), \
                        patch.object(builtins,"__import__",side_effect=imported):
                    if identity_change or failure:
                        with self.assertRaises(SystemExit) as stopped:exec(compile(job._OCR_IMPORT_SCRIPT_V2,"<fixed-direct-diagnostic>","exec"),{})
                        self.assertEqual(stopped.exception.code,1)
                    else:exec(compile(job._OCR_IMPORT_SCRIPT_V2,"<fixed-direct-diagnostic>","exec"),{})
                files=sorted(root.glob("*.json"));self.assertLessEqual(len(files),3)
                for file in files:
                    self.assertLessEqual(file.stat().st_size,1024)
                    self.assertNotIn(b"private supplier",file.read_bytes())
                    self.assertNotIn(str(root).encode(),file.read_bytes())
                facts={file.name:json.loads(file.read_bytes()) for file in files}
            finally:os.chdir(before)
        return facts,torch_imports

    def test_direct_probe_denies_each_wrong_runtime_identity_before_torch_import(self):
        for field in ("executable","prefix","exec_prefix","base_executable","base_prefix","base_exec_prefix",
                      "isolated","no_user_site","bytecode_disabled","site_enabled","guidance_distribution"):
            with self.subTest(field=field):
                facts,imports=self.execute_direct_import_fixture(identity_change=field)
                self.assertEqual(imports,[])
                self.assertEqual(set(facts),{"01-before-import.json","03-final.json"})
                identity=facts["01-before-import.json"]["identity"]
                self.assertFalse(identity[field]);self.assertTrue(all(type(value) is bool for value in identity.values()))
                final=facts["03-final.json"]
                self.assertFalse(final["success"]);self.assertFalse(final["imported"])
                self.assertEqual(final["failure_stage"],"runtime-identity")
                self.assertEqual(final["error_type"],"RuntimeIdentityMismatch")

    def test_direct_probe_records_typed_import_and_query_outcomes_with_its_own_pid(self):
        for failure in (None,"import","accelerator-check"):
            with self.subTest(failure=failure):
                facts,imports=self.execute_direct_import_fixture(failure=failure)
                self.assertEqual(imports,["torch"])
                self.assertTrue(all(facts["01-before-import.json"]["identity"].values()))
                self.assertEqual(len(facts),2 if failure=="import" else 3)
                for value in facts.values():
                    self.assertEqual(value["schema_version"],"ocr-runtime-import-fact-v2")
                    self.assertEqual(value["pid"],os.getpid());self.assertEqual(value["parent_pid"],os.getppid())
                final=facts["03-final.json"]
                self.assertEqual(final["success"],failure is None)
                self.assertEqual(final["imported"],failure!="import")
                self.assertEqual(final["failure_stage"],failure)
                self.assertIs(final["accelerator_available"],False if failure is None else None)

    def test_ocr_readback_refuses_standard_limits_partial_increases_and_guard_drift(self):
        for process,aggregate,flags,members,passes in (
            (2,4,job.LIMIT_FLAGS,32,True),(1,4,job.LIMIT_FLAGS,32,False),(2,3,job.LIMIT_FLAGS,32,False),
            (3,4,job.LIMIT_FLAGS,32,False),(2,5,job.LIMIT_FLAGS,32,False),
            (2,4,job.LIMIT_FLAGS & ~job.KILL_CLOSE,32,False),(2,4,job.LIMIT_FLAGS,33,False)):
            with self.subTest(process=process,aggregate=aggregate,flags=flags,members=members):
                def query(handle,kind,pointer,size,returned):
                    value=ctypes.cast(pointer,ctypes.POINTER(job.Limits)).contents
                    value.basic.flags=flags;value.basic.active_limit=members
                    value.process_memory=process*1024**3;value.job_memory=aggregate*1024**3
                    return 1
                owned=object.__new__(job._OwnedJob);owned.job=123;owned.owned={"job":123}
                owned.intent=self.issued_intent("ocr-runtime-import-v2")
                owned.n=SimpleNamespace(k=SimpleNamespace(QueryInformationJobObject=query))
                if passes:self.assertEqual(owned.limits().job_memory,4*1024**3)
                else:
                    with self.assertRaises(job.NativeFailure):owned.limits()

    def test_job_limit_readback_rejects_a_different_profile_or_other_ceiling(self):
        for phase,reported,flags,members,process_bytes,passes in (
            ("ui",3*1024**3,job.LIMIT_FLAGS,32,1024**3,True),
            ("fixture:ui-budget",3*1024**3,job.LIMIT_FLAGS,32,1024**3,True),
            ("package",2*1024**3,job.LIMIT_FLAGS,32,1024**3,True),
            ("ui",2*1024**3,job.LIMIT_FLAGS,32,1024**3,False),
            ("package",3*1024**3,job.LIMIT_FLAGS,32,1024**3,False),
            ("fixture:stdio",3*1024**3,job.LIMIT_FLAGS,32,1024**3,False),
            ("ui",3*1024**3,job.LIMIT_FLAGS,33,1024**3,False),
            ("ui",3*1024**3,job.LIMIT_FLAGS,32,2*1024**3,False),
            ("ui",3*1024**3,job.LIMIT_FLAGS & ~job.KILL_CLOSE,32,1024**3,False),
        ):
            with self.subTest(phase=phase,reported=reported,passes=passes):
                def query(handle,kind,pointer,size,returned):
                    value=ctypes.cast(pointer,ctypes.POINTER(job.Limits)).contents
                    value.basic.flags=flags;value.basic.active_limit=members
                    value.process_memory=process_bytes;value.job_memory=reported
                    return 1
                owned=object.__new__(job._OwnedJob);owned.job=123;owned.owned={"job":123}
                owned.intent=self.issued_intent(phase)
                owned.n=SimpleNamespace(k=SimpleNamespace(QueryInformationJobObject=query))
                if passes:self.assertEqual(owned.limits().job_memory,reported)
                else:
                    with self.assertRaises(job.NativeFailure):owned.limits()

    def test_cli_cannot_select_a_numeric_memory_budget(self):
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):
            job._parser().parse_args(["--native-selftest","--job-bytes",str(4*1024**3)])

    def completion_source(self,rows,repeat=False):
        iterator=iter(rows)
        def read(port,message,key,detail,timeout):
            self.assertEqual((port,timeout),(55,0))
            try:kind,pid=rows[0] if repeat else next(iterator)
            except StopIteration:return 0
            ctypes.cast(message,ctypes.POINTER(ctypes.c_uint32)).contents.value=kind
            ctypes.cast(key,ctypes.POINTER(ctypes.c_size_t)).contents.value=job.COMPLETION_KEY
            ctypes.cast(detail,ctypes.POINTER(ctypes.c_void_p)).contents.value=pid
            return 1
        return read

    def test_limit_notifications_retain_only_advisory_numbers_without_opening_processes(self):
        owned=self.fake_owned();owned.owned["completion-port"]=55
        owned.n.k.GetQueuedCompletionStatus=self.completion_source([(6,41),(3,42),(9,43),(10,44)])
        with patch.object(job.c,"get_last_error",return_value=258,create=True):owned.poll_events()
        self.assertEqual(owned.events,[6,3,9,10])
        self.assertEqual(owned.limit_messages,[3,9,10])
        self.assertEqual(owned.limit_notifications,[{"message":3,"reported_pid":None},{"message":9,"reported_pid":43},{"message":10,"reported_pid":44}])
        self.assertFalse(hasattr(owned.n.k,"OpenProcess"))

    def test_limit_notification_pid_is_null_unless_a_positive_uint32_is_reported(self):
        owned=self.fake_owned();owned.owned["completion-port"]=55
        owned.n.k.GetQueuedCompletionStatus=self.completion_source([(9,None),(9,0),(9,0x100000000),(10,0xffffffff)])
        with patch.object(job.c,"get_last_error",return_value=258,create=True):owned.poll_events()
        self.assertEqual([row["reported_pid"] for row in owned.limit_notifications],[None,None,None,0xffffffff])
        self.assertEqual(owned.limit_messages,[9,9,9,10])

    def test_limit_notification_collection_keeps_existing_poll_and_total_event_bounds(self):
        owned=self.fake_owned();owned.owned["completion-port"]=55
        owned.n.k.GetQueuedCompletionStatus=self.completion_source([(9,43)],repeat=True)
        owned.poll_events()
        self.assertEqual(len(owned.events),128);self.assertEqual(len(owned.limit_notifications),128)
        owned.events.extend([6]*(4096-len(owned.events)))
        owned.poll_events()
        self.assertTrue(owned.event_overflow)
        self.assertEqual(len(owned.events),4096);self.assertEqual(len(owned.limit_notifications),128)

    def test_root_number_survives_handle_retirement_but_is_not_process_identity(self):
        owned=self.fake_owned();owned.process=SimpleNamespace(process=56,pid=1234);owned.job=54
        owned.owned={"job":54,"root":56}
        owned.threads=[SimpleNamespace(join=lambda timeout:None,is_alive=lambda:False)]
        owned.n.exit_code=lambda *args:0;owned.n.inheritable=lambda handle:False
        owned.limit_messages=[9];owned.limit_notifications=[{"message":9,"reported_pid":1234}]
        with patch.object(owned,"accounting",return_value={"total":1,"active":0,"terminated":0}),patch.object(owned,"poll_events"),patch.object(owned,"limits",return_value=SimpleNamespace(peak_process=0,peak_job=0)):
            result=owned.finish("observed-native-limit-hit")
        self.assertTrue(result["cleanup_confirmed"]);self.assertIsNone(owned.process)
        self.assertEqual(result["created_root_pid"],1234);self.assertFalse(result["reported_pids_are_process_identity"])
        result["observed_limit_notifications"][0]["reported_pid"]=9999
        self.assertEqual(owned.finish()["observed_limit_notifications"],[{"message":9,"reported_pid":1234}])
        self.assertEqual(owned.finish()["reason"],"observed-native-limit-hit")

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

    def test_host_scenarios_keep_exact_commands_and_select_only_the_approved_ocr_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();candidate=root/".local-codex/q/abc123ef/c"
            helpers=candidate/".local-codex/native-fixed-host-operator/v1";helpers.mkdir(parents=True)
            run=candidate/".local-codex/native-fixed-host-operator/runs"/("a"*32)
            node=root/"node.exe";node.write_bytes(b"synthetic identity only; never executed")
            hashes={}
            for name in job._CONSUMER_FILES:
                (helpers/name).write_bytes(b"synthetic reviewed helper identity")
                hashes[name]=job._digest(helpers/name)
            for folder in (run/"package",run/"ui",candidate.parent/"t",candidate.parent/"h"):
                folder.mkdir(parents=True,exist_ok=True)
            env={"NODE_OPTIONS":"", "AISB_LOCAL_DESKTOP_UI_RUN":str(run),
                 "HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","PIP_NO_INDEX":"1",
                 "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD":"1", "TEMP":str(candidate.parent/"t"),
                 "TMP":str(candidate.parent/"t"),"HOME":str(candidate.parent/"h"),"USERPROFILE":str(candidate.parent/"h")}
            with patch.object(job,"_REPO",root):
                for scenario in ("dataset-profile","ocr-documents","ocr-document","ocr-documents --command", ""):
                    for phase in ("package","ui"):
                        with self.subTest(scenario=scenario,phase=phase):
                            values={**env,"PYTHON_RUNTIME_QUALIFICATION_SCENARIO":scenario}
                            kwargs=dict(candidate=candidate,node_executable=node,node_sha256=job._digest(node),run=run,
                                folder=run/phase,reviewed_file_hashes=hashes,environment=values,
                                environment_sha256=hashlib.sha256(json.dumps(values,sort_keys=True,separators=(",",":")).encode()).hexdigest(),review_digest="b"*64)
                            if scenario not in ("dataset-profile","ocr-documents"):
                                with self.assertRaises(job.NativeFailure):job._reviewed_host_intent(phase,**kwargs)
                            else:
                                intent=job._reviewed_host_intent(phase,**kwargs)
                                expected=(str(node),str(helpers/"offline-package.mjs")) if phase=="package" else (
                                    str(node),str(candidate/"node_modules/@playwright/test/cli.js"),"test","--config",str(helpers/"playwright.config.mjs"),"--project=thin-chrome","--project=packaged-desktop")
                                self.assertEqual(intent.argv,expected)
                                expected=(2,4) if scenario=="ocr-documents" else (1,2 if phase=="package" else 3)
                                self.assertEqual(job._memory_limits(intent),tuple(value*1024**3 for value in expected))
                                self.assertEqual(job.PROCESS_BYTES,1024**3);self.assertEqual(job.MEMBERS,32)

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
        intent=job._remember(job._Intent("fixture:stdio",("fixed-python","-I"),SOURCE.parent,{},.01,SOURCE.parent,{},{}))
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

    def test_ocr_revision_uses_a_new_family_and_keeps_the_previous_fence_guard(self):
        self.assertEqual(job._SELFTEST_RUNS,job._REPO/".local-codex/native-ocr-budget-command-selftests-v4")
        self.assertEqual(job._PREVIOUS_SELFTEST_RUNS,job._REPO/".local-codex/native-ui-budget-command-selftests-v3")
        self.assertNotEqual(job._SELFTEST_RUNS,job._REPO/".local-codex/native-command-selftests")
        self.assertNotEqual(job._SELFTEST_RUNS,job._REPO/".local-codex/native-detached-command-selftests-v2")

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
    def test_actual_nine_native_lifecycle_and_standard_ocr_budget_cases(self):
        result=job.run_native_selftests()
        self.assertTrue(result["passed"]);self.assertEqual(result["expected_native_cases"],9)
        self.assertEqual(len(result["cases"]),9);self.assertTrue(all(item["passed"] for item in result["cases"]))
        self.assertEqual(result["limits"],{"process_bytes":1024**3,"job_bytes":2*1024**3,"ui_job_bytes":3*1024**3,"ocr_process_bytes":2*1024**3,"ocr_job_bytes":4*1024**3,"active_limit":32})
        self.assertFalse(result["portable_pass_claimed"])


if __name__=="__main__":unittest.main()

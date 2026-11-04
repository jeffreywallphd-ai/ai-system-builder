"""Synthetic original-handle watchdog tests; no process or Native qualification."""
import importlib.util
import contextlib
import io
import json
import hashlib
from pathlib import Path
import subprocess
import sys
from threading import Event, Thread
from types import SimpleNamespace
import time
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'windows_offload_source_session_fixture.py'
SPEC=importlib.util.spec_from_file_location('source_session_fixture_subject',SCRIPT)
subject=importlib.util.module_from_spec(SPEC);sys.modules[SPEC.name]=subject;SPEC.loader.exec_module(subject)


class InputAndEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.area=tempfile.TemporaryDirectory(prefix='source-fixture-')
        self.addCleanup(self.area.cleanup)
        self.root=Path(self.area.name)

    def test_fixed_inputs_match_the_actual_model_inspector_without_loading_a_model(self):
        from modules.adapters.runtime.python.worker.tasks import local_model_offload as model
        manifest=subject._synthetic_source_inputs(self.root)
        inventory=model.inspect_local_model(self.root/'inputs')
        self.assertEqual({row[0]for row in inventory.bindings},set(manifest))
        for name,size,digest in inventory.bindings:
            self.assertEqual((size,digest),(manifest[name]['bytes'],manifest[name]['sha256']))
        subject._cleanup_exact_inputs(self.root,manifest)
        self.assertFalse((self.root/'inputs').exists())

    def test_actual_parent_launcher_uses_detached_fixed_form_and_retains_prelaunch_failure(self):
        runtime=self.root/'fixed-python.exe';runs=self.root/'runs'
        source=SimpleNamespace(io=SimpleNamespace(_runtime_image=lambda:(runtime,'a'*64)),
            _source_bootstrap=lambda *args,**kwargs:'fixed-reviewed-bootstrap')
        class Event:
            def __init__(self):self.handle=111;self.closed=self.close_started=False
        output=io.StringIO()
        with patch.object(subject,'_entry_environment',lambda:None), \
             patch.object(subject,'_load_runtime_sources',return_value=(source,self.root,{'fixed.py':'b'*64})), \
             patch.object(subject,'_OriginalDispatchEvent',Event), \
             patch.object(subject,'_ParentFenceApi',return_value=SimpleNamespace(terminate=lambda *args:None)), \
             patch.object(subject,'_COLLECTION_OWNERS',[]),patch.object(subject,'ROOT',self.root), \
             patch.object(subject,'RUNS',runs), \
             patch.object(subject.uuid,'uuid4',return_value=SimpleNamespace(hex='a'*32)), \
             patch.object(subject.subprocess,'STARTUPINFO',return_value=SimpleNamespace(),create=True), \
             patch.object(subject.subprocess,'Popen',side_effect=RuntimeError('stop before process'))as launch, \
             contextlib.redirect_stdout(output):
            self.assertEqual(subject.run_native(),9)
        args,kwargs=launch.call_args
        self.assertEqual(args[0],[str(runtime),'-I','-S','-B','-c','fixed-reviewed-bootstrap'])
        self.assertEqual(kwargs['creationflags'],0x8)
        self.assertEqual(kwargs['startupinfo'].lpAttributeList,{'handle_list':[111]})
        self.assertTrue(kwargs['close_fds']);self.assertEqual(kwargs['stdin'],subprocess.DEVNULL)
        self.assertEqual((kwargs['stdout'],kwargs['stderr']),(subprocess.PIPE,subprocess.PIPE))
        self.assertNotIn('shell',kwargs)
        summary=json.loads((runs/('a'*32)/'summary.json').read_bytes())
        self.assertEqual(summary['status'],'failed');self.assertEqual(summary['failure_stage'],'parent-launch')
        self.assertFalse(summary['owned_inputs_removed']);self.assertIsNone(summary['exit_code'])
        self.assertIs(summary['parent_qualification_granted'],False)
        self.assertEqual(json.loads(output.getvalue())['status'],'failed')

    def test_changed_input_or_unexpected_file_prevents_all_cleanup(self):
        manifest=subject._synthetic_source_inputs(self.root)
        path=self.root/'inputs/config.json'
        original=path.read_bytes();path.write_bytes(original+b' ')
        with self.assertRaises(subject.SourceSessionFixtureError):subject._cleanup_exact_inputs(self.root,manifest)
        self.assertEqual({p.name for p in path.parent.iterdir()},set(manifest))
        extra=path.parent/'unexpected.json';extra.write_bytes(b'{}')
        with self.assertRaises(subject.SourceSessionFixtureError):subject._cleanup_exact_inputs(self.root,manifest)
        self.assertTrue(extra.exists());self.assertTrue(all((path.parent/n).exists()for n in manifest))

    def test_bounded_regular_input_refuses_empty_oversized_directory_and_identity_drift(self):
        path=self.root/'source.py';path.write_bytes(b'pass\n')
        self.assertEqual(subject._regular_bytes(path,5),b'pass\n')
        for value,limit in ((path,4),(self.root,5)):
            with self.assertRaises(subject.SourceSessionFixtureError):subject._regular_bytes(value,limit)
        path.write_bytes(b'')
        with self.assertRaises(subject.SourceSessionFixtureError):subject._regular_bytes(path,5)
        path.write_bytes(b'pass\n')
        before=path.stat();changed=SimpleNamespace(st_dev=before.st_dev,st_ino=before.st_ino,
                                                  st_size=before.st_size,st_mtime_ns=before.st_mtime_ns+1)
        with patch.object(subject.os,'fstat',return_value=changed):
            with self.assertRaises(subject.SourceSessionFixtureError):subject._regular_bytes(path,5)

    def test_json_refuses_duplicate_nonfinite_nonobject_and_oversized_reports(self):
        self.assertEqual(subject._json_object(b'{"state":"ready"}'),{'state':'ready'})
        for raw in (b'{"a":1,"a":2}',b'{"a":NaN}',b'[]',b'',b' '*4097):
            with self.subTest(raw=raw[:30]),self.assertRaises((subject.SourceSessionFixtureError,ValueError)):
                subject._json_object(raw)

    def test_only_complete_bound_parent_report_is_accepted(self):
        digest='b'*64
        value={'schema_version':'owned-source-parent-result-v1','status':'passed','source_digest':digest,
               'native_calls':12,'terminal_calls':4,
               **dict.fromkeys(('child_exit_confirmed','job_active_zero','source_retired',
                                'original_handles_closed','timer_callbacks_retired'),True),
               **dict.fromkeys(('model_started','borrower_started','production_composed',
                                'parent_qualification_granted'),False)}
        self.assertEqual(subject._validate_parent_report(value,digest),value)
        for key in value:
            wrong={**value,key:None}
            with self.subTest(key=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_parent_report(wrong,digest)
        for key in ('native_calls','terminal_calls'):
            with self.subTest(boolean=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_parent_report({**value,key:True},digest)
        with self.assertRaises(subject.SourceSessionFixtureError):
            subject._validate_parent_report({**value,'extra':'untrusted'},digest)

    def denial_report(self):
        from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session as source
        manifest=subject._synthetic_source_inputs(self.root)
        denial={'schema_version':'source-native-denial-v1','phase':'prepare-source',
                'control_code':0x90240,'requested_level':1,'native_return':0,'win32_error':801,
                'target_identity_sha256':'a'*64,'source_call_count':75}
        mapping={'schema_version':'source-shared-write-view-v1','target_identity_sha256':'a'*64,
                 'content_sha256':manifest['model.safetensors']['sha256'],
                 'size':manifest['model.safetensors']['bytes'],
                 **dict.fromkeys(('writer_closed_before_child','view_held_through_child_exit',
                                  'view_unmapped','section_and_ancestors_closed'),True)}
        value={'schema_version':'owned-source-parent-denial-v1','status':'denied',
               'source_digest':'b'*64,'native_calls':100,'terminal_calls':20,
               'child_exit_code':9,'denial':denial,'mapping':mapping,
               **dict.fromkeys(('child_exit_confirmed','job_active_zero','source_released_by_owned_exit',
                                'original_handles_closed','timer_callbacks_retired'),True),
               **dict.fromkeys(('source_retired_unused','model_started','borrower_started',
                                'production_composed','parent_qualification_granted'),False)}
        return source,manifest,value

    def test_expected_denial_requires_all_retirement_and_exact_manifest_observations(self):
        source,manifest,value=self.denial_report()
        self.assertEqual(subject._validate_denial_report(value,'b'*64,manifest,source),value)
        with self.assertRaises(subject.SourceSessionFixtureError):subject._validate_parent_report(value,'b'*64)
        for key in value:
            with self.subTest(key=key),self.assertRaises((subject.SourceSessionFixtureError,source.OffloadAdmissionError)):
                subject._validate_denial_report({**value,key:None},'b'*64,manifest,source)
        for key in value['mapping']:
            wrong={**value,'mapping':{**value['mapping'],key:None}}
            with self.subTest(mapping=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_denial_report(wrong,'b'*64,manifest,source)
        for key in ('native_calls','terminal_calls','child_exit_code'):
            with self.subTest(boolean=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_denial_report({**value,key:True},'b'*64,manifest,source)

    def test_other_target_hash_size_or_generic_failure_is_not_expected_denial(self):
        source,manifest,value=self.denial_report()
        for key,replacement in (('target_identity_sha256','c'*64),('content_sha256','c'*64),
                                ('size',True),('size',4097)):
            with self.subTest(key=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_denial_report({**value,'mapping':{**value['mapping'],key:replacement}},
                                                'b'*64,manifest,source)
        for key,replacement in (('status','failed'),('child_exit_code',0),('source_retired_unused',True)):
            with self.subTest(key=key),self.assertRaises(subject.SourceSessionFixtureError):
                subject._validate_denial_report({**value,key:replacement},'b'*64,manifest,source)

    def test_entry_selects_only_two_closed_native_cases(self):
        flags=SimpleNamespace(isolated=1,no_site=1)
        for argument,expected in (('--native',None),('--native-shared-write-denial','shared-write-map-denial')):
            with patch.object(subject,'__name__','_standalone_source_session_qualification'), \
                 patch.object(subject,'_NATIVE_ENTRY',subject._ENTRY_TOKEN), \
                 patch.object(subject.sys,'flags',flags),patch.object(subject.sys,'dont_write_bytecode',True), \
                 patch.object(subject.sys,'prefix',subject.sys.base_prefix), \
                 patch.object(subject.sys,'argv',[str(subject.ENTRY),argument]):
                self.assertEqual(subject._entry_environment(),expected)

    def test_stream_capture_retains_bounded_bytes_and_aborts_overflow_or_failure(self):
        abort=[];capture=subject._StreamCapture(io.BytesIO(b'fixed report'),lambda:abort.append(True))
        capture.start()
        capture.join();self.assertEqual(bytes(capture.data),b'fixed report');self.assertEqual(abort,[])
        self.assertEqual(capture.digest.hexdigest(),hashlib.sha256(b'fixed report').hexdigest())
        capture=subject._StreamCapture(io.BytesIO(b'x'*65537),lambda:abort.append(True))
        capture.start()
        capture.thread.join(2)
        with self.assertRaises(subject.SourceSessionFixtureError):capture.join()
        self.assertLessEqual(len(capture.data),65536);self.assertEqual(abort,[True])
        class Broken:
            def read(self,_size):raise OSError('synthetic confidential error')
        capture=subject._StreamCapture(Broken(),lambda:abort.append(True));capture.start();capture.thread.join(2)
        with self.assertRaises(subject.SourceSessionFixtureError):capture.join()
        self.assertEqual(abort,[True,True]);self.assertEqual(capture.data,b'')

    def test_capture_is_retained_before_start_and_failed_start_is_truthful(self):
        capture=subject._StreamCapture(io.BytesIO(b'fixed'),lambda:None)
        self.assertFalse(capture.started);self.assertFalse(capture.thread.is_alive())
        with patch.object(capture.thread,'start',side_effect=RuntimeError('synthetic')):
            with self.assertRaises(RuntimeError):capture.start()
        self.assertTrue(capture.start_attempted and capture.failed);self.assertFalse(capture.started)
        with self.assertRaises(subject.SourceSessionFixtureError):capture.start()
        with self.assertRaises(subject.SourceSessionFixtureError):capture.join()

    def test_partial_cleanup_records_exact_deleted_names(self):
        manifest=subject._synthetic_source_inputs(self.root);removed=[]
        original=Path.unlink
        def unlink(path,*args,**kwargs):
            if path.name=='tokenizer.json':raise OSError('synthetic interruption')
            return original(path,*args,**kwargs)
        with patch.object(Path,'unlink',unlink),self.assertRaises(OSError):
            subject._cleanup_exact_inputs(self.root,manifest,removed)
        self.assertEqual(removed,['config.json']);self.assertFalse((self.root/'inputs/config.json').exists())
        self.assertTrue((self.root/'inputs/tokenizer.json').exists())

    def test_collection_keeps_original_launch_escape_if_fence_construction_fails(self):
        calls=[]
        api=SimpleNamespace(terminate=lambda number,code:calls.append((number,code)))
        process=object.__new__(subprocess.Popen)
        process._child_created=False;process.pid=123;process._handle=111
        with patch.object(subject,'_entry_environment',lambda:None), \
             patch.object(subject,'_ParentFenceApi',return_value=api), \
             patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(self.root);owner.retain_launch(process)
            self.assertIs(owner.process,process)
            owner.fence=object.__new__(subject._OriginalParentFence)
            process._handle=222
            owner.abort();owner.abort()
            self.assertEqual(calls,[(111,9)])

    def test_collection_refuses_foreign_fence_data_without_an_original_launch(self):
        calls=[]
        api=SimpleNamespace(terminate=lambda number,code:calls.append(('emergency',number,code)))
        with patch.object(subject,'_entry_environment',lambda:None), \
             patch.object(subject,'_ParentFenceApi',return_value=api), \
             patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(self.root)
            owner.fence=SimpleNamespace(_bound_facts=(None,)*6+(lambda:calls.append('fence'),None,None,None))
            with self.assertRaises(subject.SourceSessionFixtureError):owner.delegate_fence(owner.fence)
            owner.abort()
            self.assertEqual(calls,[])

    def test_runtime_loader_checks_every_fixed_buffer_before_and_after_inert_compilation(self):
        prefix='_aisb_source_qualification_inputs'
        self.assertFalse(any(name==prefix or name.startswith(prefix+'.')for name in sys.modules))
        original=subject._regular_bytes;reads=[]
        def read(path,maximum):reads.append(path.name);return original(path,maximum)
        try:
            with patch.object(subject,'_regular_bytes',side_effect=read):module,folder,hashes=subject._load_runtime_sources()
            self.assertEqual(len(hashes),10);self.assertEqual(reads,list(hashes)*2)
            self.assertEqual(module._NATIVE_OWNERS,{})
            self.assertIsNone(module._PARENT);self.assertIsNone(module._ENTRY_CONTEXT)
            with self.assertRaises(module.OffloadAdmissionError):module._entry()
        finally:
            for name in list(sys.modules):
                if name==prefix or name.startswith(prefix+'.'):sys.modules.pop(name)

    def test_runtime_loader_rejects_a_source_change_after_compilation(self):
        prefix='_aisb_source_qualification_inputs';original=subject._regular_bytes;count=0
        def read(path,maximum):
            nonlocal count
            count+=1;raw=original(path,maximum)
            return raw+b'\n# synthetic changed source\n'if count==11 else raw
        try:
            with patch.object(subject,'_regular_bytes',side_effect=read),self.assertRaises(subject.SourceSessionFixtureError):
                subject._load_runtime_sources()
        finally:
            for name in list(sys.modules):
                if name==prefix or name.startswith(prefix+'.'):sys.modules.pop(name)


class FenceTests(unittest.TestCase):
    def setUp(self):
        self.entered,self.release=Event(),Event();self.calls=[];self.wait_result=0
        self.wait_error=self.kill_error=None;self.code=0;self.delay_timeout=False
        self.late_wait=self.late_query=False
        self.now=time.monotonic_ns()
        self.process=object.__new__(subprocess.Popen)
        self.process._child_created=False;self.process.pid=123;self.process._handle=111
        outer=self
        class FakeApi:
            def wait(self,number,timeout):
                outer.calls.append(('wait',number,timeout));outer.entered.set()
                if not outer.release.wait(2):raise AssertionError('Synthetic wait not released')
                if outer.wait_error:raise outer.wait_error
                if outer.delay_timeout:
                    outer.delay_timeout=False;outer.now=outer.fence.deadline;return 258
                if outer.late_wait:outer.now=outer.fence.deadline+1
                return outer.wait_result
            def terminate(self,number,code):
                outer.calls.append(('terminate',number,code))
                if outer.kill_error:raise outer.kill_error
            def exit_code(self,number):
                outer.calls.append(('exit',number))
                if outer.late_query:outer.now=outer.fence.deadline+1
                return outer.code
        for scope in (patch.object(subject,'_entry_environment',lambda:None),
                      patch.object(subject,'_ParentFenceApi',FakeApi),
                      patch.object(subject,'time',SimpleNamespace(monotonic_ns=lambda:self.now))):
            scope.start();self.addCleanup(scope.stop)
        self.fence=None;self.addCleanup(self.finish)

    def finish(self):
        self.release.set()
        if self.fence and self.fence.thread:self.fence.thread.join(3)

    def arm(self):
        self.now=time.monotonic_ns()
        self.fence=subject._OriginalParentFence(self.process,self.now+10*10**9)
        self.fence.arm();self.assertTrue(self.entered.wait(1));return self.fence

    def failed_capture(self, raw):
        from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session as source
        self.code=9;fence=self.arm();self.release.set();fence.thread.join(2)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()
        captures=[]
        for payload in (raw,b''):
            capture=subject._StreamCapture(io.BytesIO(payload),lambda:None)
            capture.start();capture.join();captures.append(capture)
        return SimpleNamespace(fence=fence,captures=captures),source

    @staticmethod
    def failure_body():
        return {'schema_version':'owned-source-parent-failure-v1','status':'failed',
                'failure_stage':'source-operation','diagnostic':{
                    'schema_version':'source-failure-diagnostic-v1','actor':'parent',
                    'phase':'source-exchange','error_kind':'admission','api':'read-file',
                    'returned':True,'result_class':'zero','win32_error':109},
                'child_diagnostic':None,'parent_qualification_granted':False}

    def test_nonzero_original_exit_keeps_only_closed_failure_without_qualifying_it(self):
        body=self.failure_body();owner,source=self.failed_capture(json.dumps(body).encode())
        self.assertEqual(subject._retain_parent_failure(owner,source),body)
        self.assertEqual(owner.fence.code,9)
        with self.assertRaises(subject.SourceSessionFixtureError):owner.fence.join_observed()
        self.assertFalse(owner.fence.kill_started)

    def test_versioned_ntstatus_detail_remains_failed_without_cleanup_authority(self):
        body=self.failure_body();body['child_diagnostic']={
            'schema_version':'source-failure-diagnostic-v2','actor':'child',
            'phase':'attribute-denial','error_kind':'admission','api':'open-file',
            'returned':True,'result_class':'nonzero','win32_error':0,'ntstatus':0xc0000043}
        owner,source=self.failed_capture(json.dumps(body).encode())
        self.assertEqual(subject._retain_parent_failure(owner,source),body)
        self.assertEqual(owner.fence.code,9)
        self.assertIs(body['parent_qualification_granted'],False)
        with self.assertRaises(subject.SourceSessionFixtureError):owner.fence.join_observed()

    def test_status_for_wrong_api_is_rejected_without_raw_failure_fallback(self):
        body=self.failure_body();body['diagnostic'].update(
            schema_version='source-failure-diagnostic-v2',ntstatus=0xc0000043)
        owner,source=self.failed_capture(json.dumps(body).encode())
        self.assertIsNone(subject._retain_parent_failure(owner,source))

    def test_mutable_exit_flags_cannot_replace_original_exit_for_diagnostic_collection(self):
        body=self.failure_body();owner,source=self.failed_capture(json.dumps(body).encode())
        owner.fence._bound_facts=(*owner.fence._bound_facts[:9],lambda:None)
        self.assertIsNone(subject._retain_parent_failure(owner,source))

    def test_malformed_or_uncertain_capture_is_omitted_without_raw_fallback(self):
        owner,source=self.failed_capture(b'{"raw":"private C:/sensitive"}')
        self.assertIsNone(subject._retain_parent_failure(owner,source))
        body=self.failure_body();body['diagnostic']['win32_error']=True
        owner.captures[0].data[:]=json.dumps(body).encode()
        owner.captures[0].bytes=len(owner.captures[0].data)
        self.assertIsNone(subject._retain_parent_failure(owner,source))
        body=self.failure_body();owner.captures[0].data[:]=json.dumps(body).encode()
        owner.captures[0].bytes=len(owner.captures[0].data);owner.captures[1].failed=True
        self.assertIsNone(subject._retain_parent_failure(owner,source))

    def test_default_imported_entry_denies_before_api_construction(self):
        with patch.object(subject,'_entry_environment',side_effect=subject.SourceSessionFixtureError('entry')), \
             patch.object(subject,'_ParentFenceApi',side_effect=AssertionError('No API construction')) as api:
            with self.assertRaises(subject.SourceSessionFixtureError):
                subject._OriginalParentFence(self.process,time.monotonic_ns()+10**9)
        api.assert_not_called();self.assertEqual(self.calls,[])

    def test_delegation_is_irreversible_after_fence_escape_despite_rebound_observations(self):
        with patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(Path('synthetic'))
            owner.retain_launch(self.process)
            fence=self.fence=subject._OriginalParentFence(self.process,self.now+10**9)
            owner.fence=fence;owner.delegate_fence(fence);fence.arm()
            original_abort=fence._bound_facts[6]
            original_abort()
            foreign=[]
            owner.fence=SimpleNamespace(_bound_facts=(None,)*6+(lambda:foreign.append(True),None,None,None))
            fence._bound_facts=owner.fence._bound_facts
            self.process._handle=222
            owner.launch_escape=None
            owner.abort();owner.abort()
            self.assertEqual(foreign,[])
            self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])
            self.release.set();fence.thread.join(2)
            with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_emergency_abort_consumption_prevents_later_delegation_or_launch_replacement(self):
        with patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(Path('synthetic'));owner.retain_launch(self.process)
            owner.abort()
            fence=self.fence=subject._OriginalParentFence(self.process,self.now+10**9)
            with self.assertRaises(subject.SourceSessionFixtureError):owner.delegate_fence(fence)
            owner.process=None
            with self.assertRaises(subject.SourceSessionFixtureError):owner.retain_launch(self.process)
            owner.abort()
            self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])

    def test_concurrent_collector_failures_share_one_original_fence_escape(self):
        with patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(Path('synthetic'));owner.retain_launch(self.process)
            fence=self.fence=subject._OriginalParentFence(self.process,self.now+10**9)
            owner.fence=fence;owner.delegate_fence(fence);fence.arm()
            threads=[Thread(target=owner.abort)for _ in range(2)]
            for thread in threads:thread.start()
            for thread in threads:thread.join(2);self.assertFalse(thread.is_alive())
            self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])
            self.release.set();fence.thread.join(2)
            with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_already_armed_or_other_original_process_cannot_receive_delegation(self):
        with patch.object(subject,'_COLLECTION_OWNERS',[]):
            owner=subject._CollectionOwner(Path('synthetic'));owner.retain_launch(self.process)
            fence=self.arm()
            with self.assertRaises(subject.SourceSessionFixtureError):owner.delegate_fence(fence)
            self.release.set();fence.thread.join(2)
            other=object.__new__(subprocess.Popen)
            other._child_created=False;other.pid=124;other._handle=222
            other_fence=subject._OriginalParentFence(other,self.now+10**9)
            with self.assertRaises(subject.SourceSessionFixtureError):owner.delegate_fence(other_fence)
            self.assertFalse(any(row[0]=='terminate'for row in self.calls))

    def test_original_wait_stays_active_until_actual_exit_observation(self):
        fence=self.arm();fence.assert_dispatch_allowed()
        self.assertFalse(fence.exit_observed);self.assertEqual(self.calls[0][0:2],('wait',111))
        self.release.set();fence.join_observed()
        self.assertTrue(fence.exit_observed)
        self.assertFalse(fence.kill_started)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.assert_dispatch_allowed()
        with self.assertRaises(subject.SourceSessionFixtureError):fence.arm()

    def test_rebound_observation_cannot_redirect_the_committed_wait_or_query(self):
        fence=self.arm();self.process._handle=222
        with self.assertRaises(subject.SourceSessionFixtureError):fence.assert_dispatch_allowed()
        self.release.set();fence.thread.join(2)
        self.assertEqual([row[1]for row in self.calls],[111,111])
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_expiry_kills_only_original_handle_once_and_never_qualifies(self):
        self.delay_timeout=True;fence=self.arm();self.release.set();fence.thread.join(2)
        self.assertTrue(fence.expired and fence.kill_started and fence.exit_observed)
        self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])
        fence._terminate_original_once()
        self.assertEqual(len([row for row in self.calls if row[0]=='terminate']),1)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_rebound_binding_cannot_redirect_watchdog_abort(self):
        self.delay_timeout=True;fence=self.arm()
        fence.original=(*fence.original[:2],222,*fence.original[3:])
        self.process._handle=222;fence.number=222
        self.release.set();fence.thread.join(2)
        self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])
        self.assertTrue(fence.expired)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_resetting_termination_observation_does_not_refund_the_escape(self):
        self.delay_timeout=True;fence=self.arm();self.release.set();fence.thread.join(2)
        fence.kill_started=False
        fence._terminate_original_once()
        self.assertEqual(len([row for row in self.calls if row[0]=='terminate']),1)

    def test_resetting_abort_display_cannot_qualify_a_later_zero_exit(self):
        fence=self.arm();fence._terminate_original_once();fence.kill_started=False
        with self.assertRaises(subject.SourceSessionFixtureError):fence.assert_dispatch_allowed()
        self.release.set();fence.thread.join(2)
        self.assertTrue(fence.exit_observed);self.assertEqual(fence.code,0)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_wait_failure_attempts_original_escape_but_supplies_no_exit_proof(self):
        self.wait_error=OSError('synthetic');fence=self.arm();self.release.set();fence.thread.join(2)
        self.assertTrue(fence.failed and fence.kill_started)
        self.assertFalse(fence.exit_observed)
        self.assertEqual([row for row in self.calls if row[0]=='terminate'],[('terminate',111,9)])
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_failed_termination_is_not_retried_and_keeps_uncertainty(self):
        self.delay_timeout=True;self.kill_error=OSError('synthetic')
        fence=self.arm();self.release.set();fence.thread.join(2)
        self.assertTrue(fence.failed and fence.kill_started)
        self.assertFalse(fence.exit_observed)
        self.assertEqual(len([row for row in self.calls if row[0]=='terminate']),1)
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_active_or_nonzero_exit_is_not_success(self):
        for code in (259,2):
            with self.subTest(code=code):
                self.entered.clear();self.release.clear();self.calls.clear();self.code=code
                fence=self.arm();self.release.set();fence.thread.join(2)
                with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_nonzero_known_exit_cannot_be_rewritten_as_a_pass(self):
        self.code=2;fence=self.arm();self.release.set();fence.thread.join(2)
        self.assertEqual(fence.code,2);self.assertTrue(fence.exit_observed)
        fence.code=0
        with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()

    def test_late_actual_exit_is_retained_but_cannot_qualify_after_flag_reset(self):
        for stage in ('wait','query'):
            with self.subTest(stage=stage):
                self.entered.clear();self.release.clear();self.calls.clear()
                self.late_wait=stage=='wait';self.late_query=stage=='query'
                fence=self.arm();self.release.set();fence.thread.join(2)
                self.assertTrue(fence.exit_observed and fence.expired)
                self.assertEqual(fence.code,0)
                fence.expired=False
                with self.assertRaises(subject.SourceSessionFixtureError):fence.join_observed()


if __name__=='__main__':unittest.main()

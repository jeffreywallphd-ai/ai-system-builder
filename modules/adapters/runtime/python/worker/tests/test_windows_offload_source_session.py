"""Source-only wire regressions. No Native, model or filesystem authority."""
import json
import copy
import ctypes as C
import struct
from types import SimpleNamespace
from pathlib import Path
from threading import Event, Thread, get_ident
import tempfile
import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as io
from modules.adapters.runtime.python.worker.tasks import windows_offload_native_session as native
from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session as source
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError


class ReadyPublicationTests(unittest.TestCase):
    def test_paused_writer_does_not_publish_empty_or_partial_ready_file(self):
        with tempfile.TemporaryDirectory(prefix='source-ready-')as area:
            root=Path(area);created,release=Event(),Event();failures=[];raw=b'{"ready":true}'
            original=Path.open
            class Paused:
                def __enter__(self):return self
                def __exit__(self,*args):self.stream.close()
                def write(self,value):
                    created.set()
                    if not release.wait(2):raise AssertionError('Synthetic writer not released')
                    return self.stream.write(value)
                def flush(self):return self.stream.flush()
            def open_file(path,*args,**kwargs):
                stream=original(path,*args,**kwargs)
                if path.name=='ready.pending':
                    paused=Paused();paused.stream=stream;return paused
                return stream
            def publish():
                try:source._publish_ready(root,raw)
                except BaseException as error:failures.append(type(error).__name__)
            with patch.object(Path,'open',open_file):
                thread=Thread(target=publish);thread.start()
                try:
                    self.assertTrue(created.wait(1));self.assertTrue((root/'ready.pending').exists())
                    self.assertFalse((root/'ready.json').exists())
                finally:release.set();thread.join(3)
            self.assertFalse(thread.is_alive());self.assertEqual(failures,[])
            self.assertEqual((root/'ready.json').read_bytes(),raw)
            self.assertFalse((root/'ready.pending').exists())

    def test_existing_ready_or_pending_record_is_never_overwritten(self):
        for name in ('ready.json','ready.pending'):
            with self.subTest(name=name),tempfile.TemporaryDirectory(prefix='source-ready-')as area:
                root=Path(area);(root/name).write_bytes(b'original')
                with self.assertRaises((OffloadAdmissionError,FileExistsError)):
                    source._publish_ready(root,b'{"ready":true}')
                self.assertEqual((root/name).read_bytes(),b'original')


class ParentJourneyTests(unittest.TestCase):
    """Actual parent sequencing and framing with a synthetic transport peer."""
    def setUp(self):
        entry=object.__new__(source._OriginalSourceEntry)
        entry.role=source._PARENT_ROLE;entry.nonce='a'*32;entry.digest='b'*64;entry.case=None
        entry.deadline=time.monotonic_ns()+120*10**9;entry.run_root=Path('C:/synthetic/source-session')
        parent=object.__new__(source._OriginalSourceParent)
        for scope in (patch.object(source,'_ENTRY_CONTEXT',entry),patch.object(source,'_PARENT',parent),
                      patch.object(source._OriginalSourceEntry,'assert_original',lambda entry:None)):
            scope.start();self.addCleanup(scope.stop)
        source._OriginalSourceParent.__init__(parent,entry)
        self.parent=parent;self.events=[];self.pending=bytearray();self.corrupt_reply=False
        self.fail_finish=False;self.fail_mapping_retirement=False;self.denial_reply=None
        outer=self
        timer=SimpleNamespace(phase='pending')
        def retire_timer():outer.events.append('timer-retired');timer.phase='retired'
        timer.retire=retire_timer;self.api=SimpleNamespace(timer=timer)
        def construct(owner):self.assertIs(owner,parent);owner.api=self.api;self.events.append('native-created')
        def launch(owner,request):
            self.events.append('child-launched');owner.source_digest=entry.digest
            owner.channels.update({'request-write':object(),'response-read':object()})
        def write(owner,handle,raw):
            self.assertIs(handle,owner.channels['request-write'])
            size=struct.unpack('<I',raw[:4])[0];self.assertEqual(size,len(raw)-4)
            value=source._message(source._decode(raw[4:]),entry.nonce,entry.digest,entry.deadline)
            self.events.append(value['op'])
            reply={**value,'body':{'state':source._STATES[value['seq']]}}
            if self.denial_reply is not None:reply['body']=self.denial_reply
            if self.corrupt_reply:reply['deadline_ns']+=1
            self.pending.extend(source._frame(reply))
        def read(owner,handle,size):
            self.assertIs(handle,owner.channels['response-read']);self.assertGreaterEqual(len(self.pending),size)
            value=bytes(self.pending[:size]);del self.pending[:size];return value
        def retire_child(owner,*,expected_exit=0):
            self.events.append('actual-child-exit-and-job-zero')
            if self.fail_finish:raise OffloadAdmissionError()
            owner.observed_child_exit=expected_exit
        def mapper_init(mapper,owner):
            self.assertIs(owner,parent);self.events.append('writer-closed-and-view-held')
        def mapper_retire(mapper):
            self.assertEqual(parent.observed_child_exit,9)
            self.events.append('view-and-section-retired')
            if self.fail_mapping_retirement:raise OffloadAdmissionError()
        for scope in (patch.object(source,'_SourceNative',construct),
                      patch.object(source._OriginalSourceParent,'_launch',launch),
                      patch.object(source._OriginalSourceParent,'_close_outer_dispatch',lambda owner:None),
                      patch.object(source._OriginalSourceParent,'_write_bytes',write),
                      patch.object(source._OriginalSourceParent,'_read_bytes',read),
                      patch.object(source._OriginalSourceParent,'_retire_child',retire_child),
                      patch.object(source._SourceMappedDenial,'__init__',mapper_init),
                      patch.object(source._SourceMappedDenial,'retire_after_child',mapper_retire)):
            scope.start();self.addCleanup(scope.stop)

    def test_complete_sequence_uses_one_deadline_then_child_exit_before_timer_retirement(self):
        parent=self.parent;deadline=parent.deadline
        for action in (parent.prepare,parent.check,parent.retire_unused,parent.finish):
            self.assertIsNone(action());self.assertEqual(parent.deadline,deadline)
        self.assertTrue(parent.retired);self.assertEqual(parent.state,'source-finished')
        self.assertEqual(self.events,['native-created','child-launched',*source._OPERATIONS.values(),
                                     'actual-child-exit-and-job-zero','timer-retired'])
        self.assertEqual(len(parent.requests),4);self.assertEqual(self.pending,b'')
        with self.assertRaises(OffloadAdmissionError):parent.prepare()

    def test_out_of_order_or_replayed_operation_cannot_launch_again(self):
        with self.assertRaises(OffloadAdmissionError):self.parent.check()
        self.assertEqual(self.events,[])
        self.parent.prepare();events=list(self.events)
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertEqual(self.events,events)

    def test_wrong_reply_fences_the_session_without_retirement(self):
        self.corrupt_reply=True
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        with self.assertRaises(OffloadAdmissionError):self.parent.check()
        self.assertNotIn('timer-retired',self.events)

    def test_unconfirmed_child_exit_cannot_retire_parent_timer_or_grant_completion(self):
        self.parent.prepare();self.parent.check();self.parent.retire_unused();self.fail_finish=True
        with self.assertRaises(OffloadAdmissionError):self.parent.finish()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        self.assertEqual(self.api.timer.phase,'pending');self.assertNotIn('timer-retired',self.events)

    def test_expired_original_deadline_prevents_first_native_acquisition(self):
        clock=SimpleNamespace(monotonic_ns=lambda:self.parent.deadline+1)
        with patch.object(source,'time',clock),self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertEqual(self.events,[]);self.assertIsNone(self.parent.api)

    def test_fixed_denial_waits_for_child_before_timer_and_is_not_prepared(self):
        self.parent.entry.case=source._MAP_DENIAL_CASE
        self.denial_reply={'error':'source-session-unavailable','source_retired':False,
                           'denial':SourceProtocolTests.denial()}
        self.parent.prepare()
        self.assertTrue(self.parent.retired);self.assertEqual(self.parent.state,'source-denied')
        self.assertEqual(self.parent.observed_child_exit,9)
        self.assertEqual(self.events,['native-created','writer-closed-and-view-held',
                                     'child-launched','prepare-source',
                                     'actual-child-exit-and-job-zero',
                                     'view-and-section-retired','timer-retired'])
        with self.assertRaises(OffloadAdmissionError):self.parent.check()

    def test_denial_data_without_actual_child_retirement_cannot_pass(self):
        self.parent.entry.case=source._MAP_DENIAL_CASE;self.fail_finish=True
        self.denial_reply={'error':'source-session-unavailable','source_retired':False,
                           'denial':SourceProtocolTests.denial()}
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        self.assertIsNone(self.parent.observed_child_exit)
        self.assertNotIn('timer-retired',self.events)

    def test_unexpected_success_is_not_an_expected_denial(self):
        self.parent.entry.case=source._MAP_DENIAL_CASE
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertFalse(self.parent.retired)
        self.assertNotIn('actual-child-exit-and-job-zero',self.events)

    def test_uncertain_mapping_retirement_does_not_retire_timer_or_report_success(self):
        self.parent.entry.case=source._MAP_DENIAL_CASE;self.fail_mapping_retirement=True
        self.denial_reply={'error':'source-session-unavailable','source_retired':False,
                           'denial':SourceProtocolTests.denial()}
        with self.assertRaises(OffloadAdmissionError):self.parent.prepare()
        self.assertTrue(self.parent.failed);self.assertFalse(self.parent.retired)
        self.assertNotIn('timer-retired',self.events)


class SourceMapperTests(unittest.TestCase):
    """Actual mapper, shared rows and retirement; all DLL replies are fake."""
    def setUp(self):
        self.effects=[];self.next_number=200;self.kinds={};self.fail=None
        self.bad_region=None;self.bad_identity=False;self.wrong_exit=False
        self.on_return=None;self.code_buffer=None
        self.data=C.create_string_buffer(b'tiny-model-fixture')
        outer=self
        class Function:
            def __init__(self,name):self.name=name;self.argtypes=[];self.restype=None
            def __call__(self,*args):
                outer.effects.append((self.name,args))
                value=outer.reply(self.name,args)
                if outer.on_return:outer.on_return(self.name,args,value)
                return value
        class Dll:
            def __init__(self,name,**kwargs):
                self._name=name;self._handle=1 if name=='kernel32.dll'else 2
                names=('NtCreateFile',)if name=='ntdll.dll'else (
                    'GetFileInformationByHandleEx','CreateFileMappingW','MapViewOfFile',
                    'VirtualQuery','UnmapViewOfFile','CloseHandle','WaitForMultipleObjects',
                    'GetExitCodeProcess','QueryInformationJobObject')
                for name in names:setattr(self,name,Function(name))
        self.Dll=Dll;k=Dll('kernel32.dll')
        entry=object.__new__(source._OriginalSourceEntry)
        entry.role=source._PARENT_ROLE;entry.nonce='a'*32;entry.case=source._MAP_DENIAL_CASE
        entry.deadline=time.monotonic_ns()+120*10**9
        entry.run_root=Path('C:/synthetic/source-session')
        parent=object.__new__(source._OriginalSourceParent)
        for scope in (patch.object(source,'_ENTRY_CONTEXT',entry),patch.object(source,'_PARENT',parent),
                      patch.object(source._OriginalSourceEntry,'assert_original',lambda e:None),
                      patch.dict(source._NATIVE_OWNERS,{},clear=True),
                      patch.dict(source._FAILURE_STATES,{},clear=True),
                      patch.dict(source._MAPPER_OWNERS,{},clear=True),
                      patch.dict(source._MAPPER_RETURNS,{},clear=True),
                      patch.dict(source._MAPPER_RESOURCES,{},clear=True),
                      patch.dict(source._MAPPER_PREPARED,{},clear=True),
                      patch.dict(source._MAPPER_CLOSED,{},clear=True),
                      patch.dict(source._PARENT_RETIREMENTS,{},clear=True),
                      patch.object(C,'WinDLL',Dll,create=True),
                      patch.object(C,'get_last_error',return_value=0,create=True)):
            scope.start();self.addCleanup(scope.stop)
        source._OriginalSourceParent.__init__(parent,entry)
        request=source._SourceRequest(parent,0);parent.requests.append(request);parent.current=request
        api=object.__new__(source._SourceNative);api._SourceNative__origin=api
        parent.api=api;api.owner=parent;api.role=source._PARENT_ROLE
        api.deadline_ns=api._deadline_origin=parent.deadline
        api.calls,api.buffers=parent.calls,parent.buffers;api.pending=None;api.uncertain=False
        api.initializing=False;api.dll=api.dll_facts=None;api.k=k
        api.engine_calls=api._engine_calls_origin={}
        ptr,u32,i32=C.c_void_p,C.c_uint32,C.c_int32
        api.function_bindings=tuple((getattr(k,name),args,result)for name,args,result in (
            ('CloseHandle',(ptr,),i32),
            ('WaitForMultipleObjects',(u32,C.POINTER(ptr),i32,u32),u32),
            ('GetExitCodeProcess',(ptr,C.POINTER(u32)),i32),
            ('QueryInformationJobObject',(ptr,i32,ptr,u32,C.POINTER(u32)),i32)))
        for fn,args,result in api.function_bindings:fn.argtypes=list(args);fn.restype=result
        api.rows=api._rows_origin=object.__new__(source._RuntimeSourceRows)
        source._NATIVE_OWNERS[id(api)]=(api,api.rows,parent,source._PARENT_ROLE)
        source._RuntimeSourceRows.__init__(api.rows,api,source._PARENT_ROLE)
        api.rows.api_bindings=api.rows.api_origin=api.function_bindings
        api.engine_normal=api.rows.reserve('engine-normal',1024,0)
        api.engine_final=api.rows.reserve('engine-final',0,61)
        api.escapes=tuple(api.rows.reserve(name,0,1)for name in ('own-exit','deadline-exit','park'))
        api.timer=SimpleNamespace(phase='pending')
        self.parent,self.api=parent,api

    def reply(self,name,args):
        if name=='NtCreateFile':
            self.next_number+=1;args[0]._obj.value=self.next_number
            self.kinds[self.next_number]='ancestor'if args[8]&1 else 'writer'
            args[3]._obj.status=0;args[3]._obj.information=1
            return -1 if self.fail==name else 0
        if self.fail==name:return 0
        if name=='GetFileInformationByHandleEx':
            number,kind,data,_size=args;data=data._obj
            if kind==9:data[0]=0x10 if self.kinds[number]=='ancestor'else 0
            elif kind==18:
                raw=(b'\0'*24 if self.bad_identity else b'volume01'+number.to_bytes(16,'little'))
                for index,value in enumerate(raw):data[index]=value
            elif kind==1:
                data.size=len(self.data.raw);data.allocated=4096;data.links=1
        elif name=='CreateFileMappingW':self.next_number+=1;return self.next_number
        elif name=='MapViewOfFile':return C.addressof(self.data)
        elif name=='VirtualQuery':
            data=args[1]._obj
            data.base=data.allocation_base=C.addressof(self.data)
            data.allocation_protect=data.protect=4;data.state=0x1000;data.kind=0x40000
            data.region_size=4096
            if self.bad_region:setattr(data,*self.bad_region)
            return C.sizeof(data)
        elif name=='GetExitCodeProcess':
            self.code_buffer=args[1]._obj;self.code_buffer.value=0 if self.wrong_exit else 9
        elif name=='QueryInformationJobObject':args[2]._obj.active=0;args[2]._obj.total=1
        elif name=='WaitForMultipleObjects':return 0
        return 1

    def mapper(self):
        mapper=object.__new__(source._SourceMappedDenial)
        self.parent.mapper=mapper;self.parent.buffers.append(mapper)
        source._SourceMappedDenial.__init__(mapper,self.parent)
        return mapper

    def child_exit(self,mapper):
        parent=self.parent
        for name in ('process','primary_thread','job'):
            handle=source._SourceHandle(parent,name);parent.handles.append(handle)
            self.next_number+=1;handle.slot.value=self.next_number;handle.acknowledge()
            setattr(parent,name,handle)
        parent.denial={**SourceProtocolTests.denial(),'target_identity_sha256':mapper.identity}
        parent.finishing=True
        parent._retire_child(expected_exit=9)

    def test_section_only_setup_then_actual_original_exit_and_explicit_teardown(self):
        mapper=self.mapper();writer=mapper.prepared_facts[5]
        self.assertTrue(writer.closed);self.assertFalse(mapper.prepared_facts[-1].closed)
        self.assertEqual(mapper.content,source.hashlib.sha256(self.data.raw).hexdigest())
        self.assertIs(self.api.rows.api_bindings,self.api.function_bindings)
        self.assertEqual(len(self.api.rows.reservations),5)
        self.child_exit(mapper);mapper.retire_after_child()
        self.assertTrue(mapper.retired);self.assertTrue(all(v.closed for v in mapper.resources))
        report=mapper.report();self.assertTrue(report['writer_closed_before_child'])
        self.assertEqual(report['size'],len(self.data.raw))
        names=[v[0]for v in self.effects]
        self.assertLess(names.index('CloseHandle'),names.index('WaitForMultipleObjects'))
        self.assertLess(names.index('QueryInformationJobObject'),names.index('UnmapViewOfFile'))
        self.assertLess(sum(row.terminal for row in self.api.rows.order),61)
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()

    def test_memory_view_validation_rejects_private_copy_bad_protection_or_short_span(self):
        for field,value in (('kind',0x20000),('protect',2),('allocation_protect',8),
                            ('region_size',1),('base',1),('state',0x2000)):
            with self.subTest(field=field):
                # Each subcase gets fresh original custody and rows.
                case=SourceMapperTests('runTest');case.setUp()
                try:
                    case.bad_region=(field,value)
                    with self.assertRaises(OffloadAdmissionError):case.mapper()
                    self.assertFalse(case.parent.mapper.prepared)
                    self.assertFalse(any(n=='CloseHandle'for n,_ in case.effects))
                    self.assertTrue(case.parent.mapper.resources[-1].acquire['known'][3])
                finally:case.doCleanups()

    def test_partial_open_return_survives_failure_and_cannot_be_retried(self):
        self.fail='NtCreateFile'
        with self.assertRaises(OffloadAdmissionError):self.mapper()
        mapper=self.parent.mapper;resource=mapper.resources[0]
        self.assertEqual(resource.acquire['known'][3],resource.slot.value)
        self.assertIs(source._MAPPER_OWNERS[id(self.parent)][1],mapper)
        effects=len(self.effects)
        with self.assertRaises(OffloadAdmissionError):source._SourceMappedDenial.__init__(mapper,self.parent)
        self.assertEqual(len(self.effects),effects);self.assertTrue(self.api.uncertain)

    def test_failed_writer_close_keeps_section_and_view_and_never_prepares(self):
        self.fail='CloseHandle'
        with self.assertRaises(OffloadAdmissionError):self.mapper()
        mapper=self.parent.mapper
        self.assertFalse(mapper.prepared);self.assertEqual(len(mapper.resources),len(mapper.parts)+3)
        self.assertFalse(mapper.resources[-1].closed);self.assertFalse(mapper.resources[-2].closed)
        self.assertEqual([n for n,_ in self.effects].count('CloseHandle'),1)

    def test_denial_data_or_mutable_exit_flag_does_not_authorize_unmap(self):
        mapper=self.mapper();self.parent.observed_child_exit=9;self.parent.finishing=True
        self.parent.denial=SourceProtocolTests.denial()
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()
        self.assertNotIn('UnmapViewOfFile',[n for n,_ in self.effects])

    def test_wrong_original_exit_or_mapped_identity_keeps_view_owned(self):
        mapper=self.mapper();self.wrong_exit=True
        with self.assertRaises(OffloadAdmissionError):self.child_exit(mapper)
        self.assertNotIn('UnmapViewOfFile',[n for n,_ in self.effects])
        self.assertNotIn(id(self.parent),source._PARENT_RETIREMENTS)

    def test_identity_mismatch_after_confirmed_exit_keeps_mapping(self):
        mapper=self.mapper();self.child_exit(mapper)
        self.parent.denial['target_identity_sha256']='f'*64
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()
        self.assertNotIn('UnmapViewOfFile',[n for n,_ in self.effects])

    def test_uncertain_unmap_is_not_a_cleanup_ack_and_cannot_retry(self):
        mapper=self.mapper();self.child_exit(mapper);self.fail='UnmapViewOfFile'
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()
        self.assertFalse(mapper.retired);self.assertFalse(mapper.resources[-1].closed)
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()
        self.assertEqual([n for n,_ in self.effects].count('UnmapViewOfFile'),1)

    def test_copy_thread_rebound_slot_and_call_observation_have_no_authority(self):
        mapper=self.mapper();effects=len(self.effects)
        with self.assertRaises(OffloadAdmissionError):copy.copy(mapper).live()
        errors=[]
        def other():
            try:mapper.live()
            except BaseException as error:errors.append(type(error))
        thread=Thread(target=other);thread.start();thread.join(2)
        self.assertEqual(errors,[OffloadAdmissionError])
        view=mapper.resources[-1];number=view.slot.value;view.slot=C.c_void_p(number)
        with self.assertRaises(OffloadAdmissionError):view.number()
        view.slot=view.original[2]
        call=view.acquire;call['known']=(number+1,0,get_ident(),number+1)
        with self.assertRaises(OffloadAdmissionError):view.number()
        self.assertEqual(len(self.effects),effects)

    def test_complete_budget_refuses_before_any_mapping_dll_acquisition(self):
        for directories in (0,True,25):
            with self.assertRaises(OffloadAdmissionError):source._mapper_fit(self.api,directories)
        # Pure calculation sees only42 free final rows, below24+3+16.
        for row in self.api.engine_final.rows[:19]:row.binding=('occupied',)
        with self.assertRaises(OffloadAdmissionError):source._mapper_fit(self.api,24)
        self.assertEqual(self.effects,[])

    def test_return_custody_survives_pre_return_original_observation_clear(self):
        def corrupt(name,args,value):
            if name=='CreateFileMappingW':self.parent.mapper.original[5].clear()
        self.on_return=corrupt
        with self.assertRaises(OffloadAdmissionError):self.mapper()
        mapper=self.parent.mapper;resource=mapper.resources[-1]
        call=resource.acquire;retained=source._MAPPER_RETURNS[id(call)]
        known=retained[2][1]()
        self.assertEqual(known[3],resource.slot.value)
        self.assertGreater(known[3],0)
        row=next(row for row in self.api.rows.order if row.binding[4][2] is call)
        self.assertEqual(row.completion[1],known[0]);self.assertFalse(row.payload['acknowledged'])
        self.assertTrue(self.api.uncertain)

    def test_return_custody_survives_pre_return_mapper_dll_alias_drift(self):
        for name in ('CreateFileMappingW','MapViewOfFile'):
            with self.subTest(function=name):
                case=SourceMapperTests('runTest');case.setUp();returned=[]
                try:
                    def corrupt(actual,args,value):
                        if actual==name:
                            returned.append(value);case.parent.mapper.dll=None
                    case.on_return=corrupt
                    with self.assertRaises(OffloadAdmissionError):case.mapper()
                    mapper=case.parent.mapper;resource=mapper.resources[-1];call=resource.acquire
                    known=source._MAPPER_RETURNS[id(call)][2][1]()
                    self.assertEqual(known[0],returned[0]);self.assertEqual(known[3],resource.slot.value)
                    self.assertGreater(known[3],0)
                    row=next(row for row in case.api.rows.order if row.binding[4][2]is call)
                    self.assertEqual(row.completion[1],known[0]);self.assertFalse(row.payload['acknowledged'])
                    self.assertTrue(case.api.uncertain);self.assertFalse(mapper.prepared)
                finally:case.doCleanups()

    def test_retired_report_refuses_copied_or_rebound_mapper_and_close_graph(self):
        mapper=self.mapper();self.child_exit(mapper);mapper.retire_after_child()
        self.assertTrue(mapper.report()['view_unmapped'])
        with self.assertRaises(OffloadAdmissionError):copy.copy(mapper).report()
        mapper.parent=SimpleNamespace()
        with self.assertRaises(OffloadAdmissionError):mapper.report()
        mapper.parent=self.parent
        resource=mapper.resources[0];closed=resource.close;resource.close=None
        with self.assertRaises(OffloadAdmissionError):mapper.report()
        resource.close=closed
        self.assertTrue(mapper.report()['section_and_ancestors_closed'])

    def test_original_graph_cannot_lose_ancestor_by_mutating_both_observations(self):
        mapper=self.mapper();self.child_exit(mapper)
        original=source._MAPPER_RESOURCES[id(mapper)][0][0]
        mapper.resources.remove(original)
        facts=mapper.prepared_facts
        mapper.prepared_facts=(*facts[:4],facts[4][1:],*facts[5:])
        with self.assertRaises(OffloadAdmissionError):mapper.retire_after_child()
        self.assertFalse(original.closed)
        self.assertNotIn('UnmapViewOfFile',[name for name,_ in self.effects])

    def test_later_query_cannot_rewrite_the_prior_native_exit_output(self):
        mapper=self.mapper();self.wrong_exit=True
        def corrupt(name,args,value):
            if name=='QueryInformationJobObject':self.code_buffer.value=9
        self.on_return=corrupt
        with self.assertRaises(OffloadAdmissionError):self.child_exit(mapper)
        self.assertNotIn(id(self.parent),source._PARENT_RETIREMENTS)
        self.assertFalse(mapper.retirement_started)

    def test_metadata_or_mapping_failures_keep_partial_original_resources(self):
        for name in ('GetFileInformationByHandleEx','CreateFileMappingW','MapViewOfFile','VirtualQuery'):
            with self.subTest(name=name):
                case=SourceMapperTests('runTest');case.setUp()
                try:
                    case.fail=name
                    with self.assertRaises(OffloadAdmissionError):case.mapper()
                    self.assertFalse(case.parent.mapper.prepared)
                    self.assertTrue(case.api.uncertain)
                    self.assertTrue(case.parent.mapper.resources)
                    self.assertNotIn('UnmapViewOfFile',[n for n,_ in case.effects])
                finally:case.doCleanups()


class SourceProtocolTests(unittest.TestCase):
    nonce = 'a' * 32
    digest = 'b' * 64
    deadline = 123456789

    @staticmethod
    def denial():
        return {'schema_version':'source-native-denial-v1','phase':'prepare-source',
                'control_code':0x90240,
                'requested_level':1,'native_return':0,'win32_error':801,
                'target_identity_sha256':'c'*64,'source_call_count':75}

    def request(self, sequence=0):
        return {'v': 2, 'nonce': self.nonce, 'seq': sequence,
                'op': source._OPERATIONS[sequence],
                'body': {'model_root': 'C:\\models\\fixed'} if sequence == 0 else {},
                'source_digest': self.digest, 'deadline_ns': self.deadline}

    def admit(self, value, **kwargs):
        return source._message(value, self.nonce, self.digest, self.deadline, **kwargs)

    def test_qualification_denial_is_separate_from_old_success_and_error_wire(self):
        value={**self.request(),'body':{'error':'source-session-unavailable',
               'source_retired':False,'denial':self.denial()}}
        self.assertIs(source._denial_message(value,self.nonce,self.digest,self.deadline),value)
        with self.assertRaises(OffloadAdmissionError):self.admit(value,response=True)
        generic={**value,'body':{'error':'source-session-unavailable','source_retired':False}}
        self.assertIs(self.admit(generic,response=True),generic)
        with self.assertRaises(OffloadAdmissionError):source._denial_message(generic,self.nonce,self.digest,self.deadline)

    def test_bootstrap_adds_only_literal_case_and_preserves_old_six_field_form(self):
        folder=Path(source.__file__).absolute().parent
        run=Path(source.__file__).absolute().parents[6]/'.local-codex/windows-offload-source-session-native-v1'/('c'*32)
        hashes=dict.fromkeys(source._SOURCE_NAMES,'a'*64)
        args=(folder,hashes,self.nonce,self.deadline,('C:\\fixed\\python.exe','b'*64),str(run))
        old=source._source_bootstrap(*args,handles=(111,))
        new=source._source_bootstrap(*args,handles=(111,),case=source._MAP_DENIAL_CASE)
        self.assertNotIn(source._MAP_DENIAL_CASE,old)
        self.assertIn(source._MAP_DENIAL_CASE,new)
        compile(old,'synthetic-source-bootstrap','exec');compile(new,'synthetic-source-bootstrap','exec')
        for case in ('other',True,{},'--native'):
            with self.assertRaises(OffloadAdmissionError):source._source_bootstrap(*args,handles=(111,),case=case)

    def test_denial_witness_refuses_generic_errors_boolean_numbers_and_other_frontiers(self):
        changes={'schema_version':['other',None],'phase':['check-source'],
                 'native_function':['CreateFileW'],'control_code':[True,0],
                 'requested_level':[True,7],'native_return':[False,1],
                 'win32_error':[True,32,300,997],'target_identity_sha256':['x'*64,'a'*63],
                 'source_call_count':[True,0,16321]}
        for name,values in changes.items():
            for replacement in values:
                with self.subTest(field=name,value=replacement):
                    value=self.denial();value[name]=replacement
                    with self.assertRaises(OffloadAdmissionError):source._denial_witness(value)
        for name in self.denial():
            value=self.denial();value.pop(name)
            with self.subTest(missing=name),self.assertRaises(OffloadAdmissionError):source._denial_witness(value)
        value=self.denial();value['source_retired']=True
        with self.assertRaises(OffloadAdmissionError):source._denial_witness(value)

    def test_denial_refuses_replay_renewed_deadline_and_retirement_claim(self):
        value={**self.request(),'body':{'error':'source-session-unavailable',
               'source_retired':False,'denial':self.denial()}}
        for name,replacement in [('nonce','d'*32),('source_digest','d'*64),
                                  ('deadline_ns',self.deadline+1),('seq',True)]:
            bad={**value,name:replacement}
            with self.subTest(field=name),self.assertRaises(OffloadAdmissionError):source._denial_message(bad,self.nonce,self.digest,self.deadline)
        bad={**value,'body':{**value['body'],'source_retired':True}}
        with self.assertRaises(OffloadAdmissionError):source._denial_message(bad,self.nonce,self.digest,self.deadline)

    def test_fixed_sequence_frames_and_original_message_identity(self):
        state = 'new'
        for sequence in range(4):
            value = self.request(sequence)
            self.assertIs(self.admit(value), value)
            framed = source._frame(value)
            self.assertEqual(struct.unpack('<I', framed[:4])[0], len(framed) - 4)
            self.assertEqual(self.admit(source._decode(framed[4:])), value)
            state = source._edge(state, sequence)
            reply = {**value, 'body': {'state': state}}
            self.assertIs(self.admit(reply, response=True), reply)
        self.assertEqual(state, 'source-finished')

    def test_common_mechanisms_alone_deny_before_any_effect(self):
        effects=[];api=native._NativePrimitives();session=native._SessionMechanics()
        actions=(lambda:api.acquire('unused',lambda:effects.append('called')),
                 lambda:api.close(object()),lambda:api.wait((),1),
                 lambda:session._channel('unused'),lambda:session._flags(None,True),
                 lambda:session._job_readback(),lambda:session._launch(None))
        for index,action in enumerate(actions):
            with self.subTest(index=index),self.assertRaises(OffloadAdmissionError):action()
        self.assertEqual(effects,[])

    def test_io_and_source_protocols_cannot_select_each_others_operations(self):
        for sequence in range(4):
            with self.subTest(sequence=sequence):
                with self.assertRaises(OffloadAdmissionError):
                    io._message(self.request(sequence), self.nonce, self.digest)
                legacy = {'v': 1, 'nonce': self.nonce, 'seq': sequence,
                          'op': io._OPERATIONS[sequence],
                          'body': {'cache_root': 'C:\\models\\fixed'} if sequence == 0 else {},
                          'source_digest': self.digest, 'deadline_ns': self.deadline}
                self.assertIs(io._message(legacy, self.nonce, self.digest), legacy)
                with self.assertRaises(OffloadAdmissionError):self.admit(legacy)

    def test_frozen_facts_refuse_renewed_deadline_boolean_and_unknown_fields(self):
        bad = {'v': [1, True, '2'], 'nonce': ['c' * 32, None],
               'seq': [True, -1, 4, '0'], 'op': ['initialize', 'finish-source'],
               'source_digest': ['c' * 64, None],
               'deadline_ns': [True, 0, self.deadline - 1, self.deadline + 1],
               'body': [None, [], {}, {'model_root': 'C:\\models\\fixed', 'callback': 'x'}]}
        for name, values in bad.items():
            for replacement in values:
                with self.subTest(field=name, kind=type(replacement).__name__):
                    value = self.request();value[name] = replacement
                    with self.assertRaises(OffloadAdmissionError):self.admit(value)
        for name in self.request():
            value = self.request();value.pop(name)
            with self.subTest(missing=name), self.assertRaises(OffloadAdmissionError):self.admit(value)
        value = self.request();value['callback'] = 'untrusted'
        with self.assertRaises(OffloadAdmissionError):self.admit(value)

    def test_model_root_is_canonical_bounded_and_contains_no_device_components(self):
        for root in ('relative', 'C:/models/fixed', 'C:\\models\\..\\fixed',
                     '\\\\server\\share\\model', '\\\\?\\C:\\models',
                     'C:\\models\\CON', 'C:\\models\\nul.json', 'C:\\models\\aUx.bin',
                     'C:\\models\\COM9', 'C:\\models\\LPT1.log', 'C:\\models\\NUL .txt',
                     'C:\\models\\COM\u00b9', 'C:\\models\\bad.', 'C:\\models\\bad ',
                     'C:\\models\\a:b', 'C:\\models\\a\x00b', 'C:\\' + 'x' * 2050,
                     None, True):
            value = self.request();value['body']['model_root'] = root
            with self.subTest(kind=type(root).__name__), self.assertRaises(OffloadAdmissionError):
                self.admit(value)

    def test_later_operations_accept_no_root_replacement_or_serialized_authority(self):
        for sequence in (1, 2, 3):
            for body in ({'model_root': 'C:\\other'}, {'retirement_proof': True},
                         {'reservation': 'copied'}, {'native_handle': 23}):
                value = self.request(sequence);value['body'] = body
                with self.subTest(sequence=sequence, keys=tuple(body)), self.assertRaises(OffloadAdmissionError):
                    self.admit(value)

    def test_reply_fields_are_exact_and_failure_never_advances_the_state_machine(self):
        value = self.request()
        for retired in (False, True):
            failure = {**value, 'body': {'error': 'source-session-unavailable', 'source_retired': retired}}
            self.assertIs(self.admit(failure, response=True), failure)
            with self.assertRaises(OffloadAdmissionError):source._edge('new', 1)
        for body in ({'state': 'source-retired'}, {'state': 'source-prepared', 'proof': True},
                     {'error': 'private-path', 'source_retired': False},
                     {'error': 'source-session-unavailable', 'source_retired': 1}, {}):
            with self.subTest(keys=tuple(body)), self.assertRaises(OffloadAdmissionError):
                self.admit({**value, 'body': body}, response=True)

    def test_no_skipped_repeated_boolean_or_after_finish_transition(self):
        states = ('new', *source._STATES.values(), None)
        valid = {('new', 0), ('source-prepared', 1), ('source-checked', 2), ('source-retired', 3)}
        for state in states:
            for sequence in (True, -1, 0, 1, 2, 3, 4):
                if type(sequence) is int and (state, sequence) in valid:continue
                with self.subTest(state=state, sequence=sequence), self.assertRaises(OffloadAdmissionError):
                    source._edge(state, sequence)

    def test_duplicate_json_nonfinite_deep_and_oversized_inputs_are_refused(self):
        good = json.dumps(self.request())
        duplicate = good[:-1] + ', "deadline_ns": 123456789}'
        for raw in (duplicate.encode(), b'{"v":NaN}', b'{"v":Infinity}',
                    b'[' + b'{}' + b']', b'x' * 4097,
                    b'{"body":{"a":{"b":{"c":{"d":0}}}}}'):
            with self.subTest(size=len(raw)), self.assertRaises(OffloadAdmissionError):
                self.admit(source._decode(raw))


class SourceFrameTests(unittest.TestCase):
    def actor(self, chunk=3, payload=b'functional-builder', count=None):
        effects=[];written=bytearray();position=0
        class Actor(source._SourceFrameIo):
            def __init__(self):self.buffers=[];self.live=True
            def _live(self):
                if not self.live:raise OffloadAdmissionError()
        actor=Actor()
        def write(handle,data,size,actual,_overlapped):
            self.assertEqual(handle,11)
            amount=min(chunk,size) if count is None else count
            actual._obj.value=amount;effects.append(('write',size))
            if 0<amount<=size:written.extend(C.string_at(data,amount))
            return 1
        def read(handle,data,size,actual,_overlapped):
            nonlocal position
            self.assertEqual(handle,11)
            amount=min(chunk,size,len(payload)-position) if count is None else count
            actual._obj.value=amount;effects.append(('read',size))
            if 0<amount<=size:
                C.memmove(data,payload[position:position+amount],amount);position+=amount
            return 1
        class Api:
            k=SimpleNamespace(WriteFile=write,ReadFile=read)
            def call(self,function,*args,keep):
                # Synthetic only: actual Native admission is not exercised.
                self_test.assertEqual(len(keep),3)
                return function(*args)
        self_test=self;actor.api=Api()
        return actor,SimpleNamespace(value=11),effects,written

    def test_base_has_no_transfer_authority(self):
        base=source._SourceFrameIo()
        for action in (lambda:base._write_bytes(None,b'a'),lambda:base._read_bytes(None,1)):
            with self.assertRaises(OffloadAdmissionError):action()

    def test_partial_transfers_preserve_exact_order_and_bytes(self):
        payload=b'functional-builder'
        actor,handle,effects,written=self.actor(payload=payload)
        self.assertIsNone(actor._write_bytes(handle,payload));self.assertEqual(bytes(written),payload)
        self.assertEqual(actor._read_bytes(handle,len(payload)),payload)
        self.assertEqual([row[1]for row in effects[:6]],[18,15,12,9,6,3])

    def test_fragmentation_cannot_make_a_thirty_third_call(self):
        for direction in ('read','write'):
            actor,handle,effects,_written=self.actor(chunk=1,payload=b'x'*33)
            with self.subTest(direction=direction),self.assertRaises(OffloadAdmissionError):
                actor._write_bytes(handle,b'x'*33) if direction=='write'else actor._read_bytes(handle,33)
            self.assertEqual(len(effects),32)
            # The original actor retains every output buffer after refusal.
            self.assertEqual(len(actor.buffers),33)

    def test_zero_overrun_and_oversized_frames_refuse_without_retry(self):
        for count in (0,5):
            for direction in ('read','write'):
                actor,handle,effects,_written=self.actor(count=count)
                with self.subTest(count=count,direction=direction),self.assertRaises(OffloadAdmissionError):
                    actor._write_bytes(handle,b'abcd') if direction=='write'else actor._read_bytes(handle,4)
                self.assertEqual(len(effects),1)
        actor,handle,effects,_written=self.actor()
        for action in (lambda:actor._write_bytes(handle,b'x'*4101),
                       lambda:actor._read_bytes(handle,4097),lambda:actor._read_bytes(handle,True)):
            with self.assertRaises(OffloadAdmissionError):action()
        self.assertEqual(effects,[])


class FailureDiagnosticTests(unittest.TestCase):
    def setUp(self):
        scope=patch.dict(source._FAILURE_STATES,{},clear=True)
        scope.start();self.addCleanup(scope.stop)
        self.owner=object.__new__(source._OriginalSourceParent)
        self.owner.entry=SimpleNamespace(case=source._MAP_DENIAL_CASE)
        self.owner.child_diagnostic=None
        source._init_failure_state(self.owner,'parent')

    def diagnostic(self):
        source._failure_phase(self.owner,'mapper-prepare')
        source._failure_native(self.owner,'create-section',True,987654321,5)
        return source._read_failure(self.owner,OffloadAdmissionError())

    def test_pointer_return_is_only_a_class_and_exception_display_is_never_used(self):
        class Sensitive(Exception):
            def __str__(self):raise AssertionError('secret display hook')
            def __repr__(self):raise AssertionError('secret display hook')
        self.diagnostic()
        value=source._read_failure(self.owner,Sensitive('private C:/secret/model'))
        self.assertEqual(value['api'],'create-section')
        self.assertEqual(value['result_class'],'nonzero');self.assertEqual(value['win32_error'],5)
        self.assertEqual(value['error_kind'],'other')
        text=json.dumps(value);self.assertNotIn('987654321',text);self.assertNotIn('private',text)
        self.assertEqual(len(value),9)

    def test_hostile_exception_metaclass_cannot_run_classification_hooks(self):
        calls=[]
        class Meta(type):
            def __hash__(cls):calls.append('hash');raise AssertionError('sensitive hook')
            def __eq__(cls,other):calls.append('equal');raise AssertionError('sensitive hook')
        class Sensitive(Exception,metaclass=Meta):
            def __str__(self):calls.append('string');raise AssertionError('sensitive hook')
            def __repr__(self):calls.append('repr');raise AssertionError('sensitive hook')
        value=source._read_failure(self.owner,Sensitive('private content'))
        self.assertEqual(calls,[])
        self.assertEqual(value['error_kind'],'other')

    def test_unknown_extra_boolean_and_inconsistent_fields_are_refused(self):
        value=self.diagnostic()
        for key in value:
            wrong={**value,key:object()}
            with self.subTest(key=key),self.assertRaises(OffloadAdmissionError):source._failure_diagnostic(wrong)
        for key,item in (('api','private C:/secret'),('phase','arbitrary'),('win32_error',True),
                         ('returned',1),('win32_error',2**32),('returned',False)):
            with self.subTest(key=key,value=item),self.assertRaises(OffloadAdmissionError):
                source._failure_diagnostic({**value,key:item})
        with self.assertRaises(OffloadAdmissionError):source._failure_diagnostic({**value,'extra':'private'})
        for fields in ({'api':None},{'result_class':None},{'returned':None}):
            with self.subTest(fields=fields),self.assertRaises(OffloadAdmissionError):
                source._failure_diagnostic({**value,**fields})

    def test_inflight_fact_has_no_result_or_error_and_does_not_change_old_snapshot(self):
        old=self.diagnostic();source._failure_native(self.owner,'map-view')
        current=source._read_failure(self.owner,TypeError())
        self.assertIs(current['returned'],False);self.assertIsNone(current['result_class'])
        self.assertIsNone(current['win32_error']);self.assertEqual(old['win32_error'],5)
        self.assertEqual(current['error_kind'],'type')

    def test_normal_failure_bytes_remain_exact_and_negative_bytes_are_closed(self):
        value=self.diagnostic()
        negative=source._parent_failure_bytes(self.owner,ValueError('sensitive'))
        parsed=source._parent_failure(json.loads(negative))
        self.assertEqual(parsed['diagnostic']['phase'],'mapper-prepare')
        self.assertIs(parsed['parent_qualification_granted'],False)
        self.assertNotIn(b'sensitive',negative);self.assertLessEqual(len(negative),4096)
        self.owner.entry.case=None
        self.assertEqual(source._parent_failure_bytes(self.owner,RuntimeError('sensitive')),
            b'{"schema_version":"owned-source-parent-result-v1","status":"failed","failure_stage":"source-operation","parent_qualification_granted":false}\n')
        self.assertEqual(value['actor'],'parent')

    def test_unqualified_child_error_keeps_header_checks_and_cannot_be_denial(self):
        diagnostic={**self.diagnostic(),'actor':'child'}
        value={'v':2,'nonce':'a'*32,'source_digest':'b'*64,'deadline_ns':123456789,
               'seq':0,'op':'prepare-source','body':{'error':'source-session-unavailable',
               'source_retired':False,'diagnostic':diagnostic}}
        self.assertEqual(source._failure_message(value,'a'*32,'b'*64,123456789),diagnostic)
        with self.assertRaises(OffloadAdmissionError):source._denial_message(value,'a'*32,'b'*64,123456789)
        for key,item in (('nonce','c'*32),('deadline_ns',123456790),('seq',1)):
            with self.subTest(key=key),self.assertRaises(OffloadAdmissionError):
                source._failure_message({**value,key:item},'a'*32,'b'*64,123456789)
        with self.assertRaises(OffloadAdmissionError):
            source._failure_message({**value,'seq':1,'op':'check-source'},'a'*32,'b'*64,123456789)

    def test_parent_retains_unqualified_reply_but_still_rejects_it(self):
        diagnostic={**self.diagnostic(),'actor':'child'}
        reply={'v':2,'nonce':'a'*32,'source_digest':'b'*64,'deadline_ns':123456789,
               'seq':0,'op':'prepare-source','body':{'error':'source-session-unavailable',
               'source_retired':False,'diagnostic':diagnostic}}
        writes=[]
        actor=SimpleNamespace(entry=SimpleNamespace(case=source._MAP_DENIAL_CASE,
            run_root=Path('C:/synthetic/source-session')),nonce='a'*32,source_digest='b'*64,
            deadline=123456789,channels={'request-write':object(),'response-read':object()},
            child_diagnostic=None,denial=None,_write_bytes=lambda handle,raw:writes.append(raw))
        request=SimpleNamespace(seq=0,op='prepare-source')
        def attempt(value):
            raw=source._frame(value);parts=iter((raw[:4],raw[4:]))
            actor._read_bytes=lambda handle,size:next(parts)
            with self.assertRaises(OffloadAdmissionError):
                source._OriginalSourceParent._exchange_source(actor,request)
        attempt(reply)
        self.assertEqual(actor.child_diagnostic,diagnostic);self.assertIsNone(actor.denial)
        self.assertEqual(len(writes),1)
        actor.child_diagnostic=None
        attempt({**reply,'body':{'state':'source-prepared'}})
        self.assertIsNone(actor.child_diagnostic);self.assertIsNone(actor.denial)
        self.assertEqual(len(writes),2)


class NtStatusFailureDiagnosticTests(unittest.TestCase):
    def setUp(self):
        FailureDiagnosticTests.setUp(self)

    def observed(self, value, *, api='open-file', returned=True):
        source._failure_native(self.owner,api,returned,value,0)
        return source._read_failure(self.owner,OffloadAdmissionError())

    def test_known_signed_nt_status_is_retained_separately_from_win32_error(self):
        for native,expected in ((-1073741757,0xc0000043),(-2147483648,0x80000000),
                                (0,0),(259,259),(2147483647,2147483647)):
            with self.subTest(native=native):
                value=self.observed(native)
                self.assertEqual(value['schema_version'],'source-failure-diagnostic-v2')
                self.assertEqual(value['ntstatus'],expected)
                self.assertEqual(value['win32_error'],0)
                self.assertEqual(len(value),9)

    def test_no_status_from_other_api_inflight_bool_overflow_or_opaque_return(self):
        class Opaque:
            def __int__(self):raise AssertionError('conversion hook')
            def __str__(self):raise AssertionError('display hook')
        for api,returned,native in (
                ('close-handle',True,-1073741757),('read-file',True,-1073741757),
                ('unknown',True,-1073741757),('open-file',False,-1073741757),
                ('open-file',True,True),('open-file',True,2**31),
                ('open-file',True,-2**31-1),('open-file',True,None),('open-file',True,Opaque())):
            with self.subTest(api=api,returned=returned,kind=type(native).__name__):
                self.assertIsNone(self.observed(native,api=api,returned=returned)['ntstatus'])

    def test_closed_versions_reject_status_confusion_and_keep_legacy_reader(self):
        value=self.observed(-1073741757)
        legacy={k:v for k,v in value.items()if k!='ntstatus'}
        legacy['schema_version']='source-failure-diagnostic-v1'
        self.assertEqual(source._failure_diagnostic(legacy),legacy)
        for changes in ({'ntstatus':True},{'ntstatus':-1},{'ntstatus':2**32},
                        {'api':'read-file'},{'returned':False},{'result_class':'zero'},
                        {'schema_version':'source-failure-diagnostic-v1'},
                        {'schema_version':'source-failure-diagnostic-v3'}, {'extra':0}):
            with self.subTest(fields=tuple(changes)),self.assertRaises(OffloadAdmissionError):
                source._failure_diagnostic({**value,**changes})
        missing={k:v for k,v in value.items()if k!='ntstatus'}
        with self.assertRaises(OffloadAdmissionError):source._failure_diagnostic(missing)

    def test_status_snapshot_does_not_change_when_next_call_is_inflight(self):
        old=self.observed(-1073741757)
        source._failure_native(self.owner,'read-file')
        current=source._read_failure(self.owner,OffloadAdmissionError())
        self.assertEqual(old['ntstatus'],0xc0000043)
        self.assertIsNone(current['ntstatus'])

    def test_only_closed_child_v2_frame_extends_the_shared_eight_field_bound(self):
        diagnostic={**self.observed(-1073741757),'actor':'child'}
        value={'v':2,'nonce':'a'*32,'source_digest':'b'*64,'deadline_ns':123456789,
               'seq':0,'op':'prepare-source','body':{'error':'source-session-unavailable',
               'source_retired':False,'diagnostic':diagnostic}}
        encode=lambda v:json.dumps(v,separators=(',',':')).encode()
        raw=encode(value)
        with self.assertRaises(OffloadAdmissionError):source.io._decode(raw)
        self.assertEqual(source._decode(raw),value)
        source._failure_message(source._decode(raw),'a'*32,'b'*64,123456789)
        for changed in (
                {**value,'extra':None},
                {**value,'body':{**value['body'],'extra':None}},
                {**value,'body':{**value['body'],'source_retired':True}},
                {**value,'body':{**value['body'],'diagnostic':{**diagnostic,'extra':0}}},
                {**value,'body':{**value['body'],'diagnostic':{**diagnostic,'actor':'parent'}}},
                {**value,'body':{str(i):i for i in range(9)}}):
            with self.subTest(body_keys=tuple(changed['body'])),self.assertRaises(OffloadAdmissionError):
                source._decode(encode(changed))
        duplicate=raw.replace(b'"ntstatus":3221225539',b'"ntstatus":3221225539,"ntstatus":0')
        self.assertNotEqual(duplicate,raw)
        with self.assertRaises(OffloadAdmissionError):source._decode(duplicate)
        with self.assertRaises(OffloadAdmissionError):source._decode(b'x'*4097)


if __name__ == '__main__':unittest.main()

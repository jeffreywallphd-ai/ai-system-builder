"""Synthetic Source Native/timer producer tests. No process or Windows proof."""
import copy
import ctypes as C
import json
import tempfile
from threading import Thread, get_ident
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session as source
from modules.adapters.runtime.python.worker.tasks import windows_offload_source_session_child as child_module
from modules.adapters.runtime.python.worker.tasks import windows_offload_sources as sources
from pathlib import Path
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError


class ChildJourneyTests(unittest.TestCase):
    """Actual child admission and sequencing; Native calls are fixed fakes."""
    def setUp(self):
        entry=object.__new__(source._OriginalSourceEntry)
        entry.role=source._CHILD_ROLE;entry.nonce='a'*32;entry.digest='b'*64;entry.case=None
        entry.deadline=time.monotonic_ns()+120*10**9;entry.run_root=Path('C:/synthetic/source-session')
        entry.handles=(101,102,103,104)
        child=object.__new__(child_module._OriginalSourceChild);self.events=[];outer=self
        class Handle:
            def __init__(self,owner,name):self.owner,self.name,self.slot=owner,name,C.c_void_p()
            def acknowledge(self):pass
            @property
            def value(self):return self.slot.value
        class Api:
            def __init__(self,owner):
                owner.api=self;self.process=-1;self.timer=SimpleNamespace(phase='pending')
                self.k=SimpleNamespace(**{name:name for name in ('GetHandleInformation','GetFileType',
                    'IsProcessInJob','QueryInformationJobObject','SetEvent')})
            def call(self,function,*args,**kwargs):
                outer.events.append(function)
                if function=='GetHandleInformation':args[1]._obj.value=1
                elif function=='GetFileType':return 3
                elif function=='IsProcessInJob':args[2]._obj.value=1
                elif function=='QueryInformationJobObject':
                    limits=args[2]._obj;limits.basic.flags=0x2308;limits.basic.active_process_limit=1
                    limits.process_memory_limit=limits.job_memory_limit=512*1024**2
                return 1
            def wait(self,*args):outer.events.append('dispatch-wait');return 0
        for scope in (patch.object(source,'_ENTRY_CONTEXT',entry),patch.object(child_module,'_CHILD',child),
                      patch.object(source._OriginalSourceEntry,'assert_original',lambda entry:None),
                      patch.object(source,'_SourceNative',Api),patch.object(source,'_SourceHandle',Handle)):
            scope.start();self.addCleanup(scope.stop)
        child_module._OriginalSourceChild.__init__(child,entry)
        self.child=child;self.entry=entry
        def prepare(owner,root):
            self.events.append('inspect-and-prepare')
            self.assertEqual(root,str(entry.run_root/'inputs'))
            value=SimpleNamespace(_retired=False,_uncertain=False,_pending=None,_handles=[],_guards=[])
            value.assert_bound=lambda:self.events.append('source-check')
            def retire():self.events.append('source-unused-retirement');value._retired=True
            value.retire_unused=retire;owner.source=value
        self.original_prepare=child_module._OriginalSourceChild._prepare_source
        scope=patch.object(child_module._OriginalSourceChild,'_prepare_source',prepare)
        scope.start();self.addCleanup(scope.stop)

    def message(self,sequence):
        return {'v':2,'nonce':self.entry.nonce,'source_digest':self.entry.digest,
                'deadline_ns':self.entry.deadline,'seq':sequence,'op':source._OPERATIONS[sequence],
                'body':{'model_root':str(self.entry.run_root/'inputs')}if sequence==0 else {}}

    def step(self,sequence):
        reply=self.child.execute(self.message(sequence));self.child.current=None;return reply

    def test_job_and_channel_checks_precede_dispatch_and_fixed_source_sequence(self):
        self.assertTrue(self.child.job_bound and self.child.dispatched)
        self.assertLess(self.events.index('QueryInformationJobObject'),self.events.index('SetEvent'))
        self.assertEqual(self.events[-1],'dispatch-wait')
        for sequence in range(4):
            reply=self.step(sequence)
            self.assertEqual(reply['body'],{'state':source._STATES[sequence]})
        self.assertTrue(self.child.source_retired);self.assertEqual(len(self.child.requests),4)
        self.assertEqual(self.events[-3:],['inspect-and-prepare','source-check','source-unused-retirement'])

    def test_missing_source_retirement_prevents_finish(self):
        self.step(0);self.step(1);self.step(2);self.child.source._retired=False
        with self.assertRaises(OffloadAdmissionError):self.step(3)
        self.assertTrue(self.child.failed);self.assertNotEqual(self.child.state,'source-finished')

    def test_unretired_guard_or_remaining_source_custody_prevents_retirement_claim(self):
        self.step(0);self.step(1);self.child.source._guards=[SimpleNamespace(retired=False)]
        with self.assertRaises(OffloadAdmissionError):self.step(2)
        self.assertTrue(self.child.failed);self.assertFalse(self.child.source_retired)

    def test_root_replacement_is_denied_before_any_inventory_inspection(self):
        wrong=self.message(0);wrong['body']['model_root']='C:\\unexpected'
        with patch.object(child_module._OriginalSourceChild,'_prepare_source',self.original_prepare), \
             patch.object(child_module.model,'inspect_local_model',side_effect=AssertionError('No inspection'))as inspector:
            with self.assertRaises(OffloadAdmissionError):self.child.execute(wrong)
        inspector.assert_not_called()
        self.assertTrue(self.child.failed);self.assertIsNone(self.child.source)

    def test_replay_and_renewed_deadline_are_denied_before_source_check(self):
        wrong=self.message(0);wrong['deadline_ns']+=1
        with self.assertRaises(OffloadAdmissionError):self.child.execute(wrong)
        self.assertEqual(self.child.requests,[]);self.assertIsNone(self.child.source)
        self.step(0)
        with self.assertRaises(OffloadAdmissionError):self.step(0)
        self.assertNotIn('source-check',self.events)

    def test_original_inventory_is_constructed_inside_child_before_original_source(self):
        with tempfile.TemporaryDirectory(prefix='source-child-inventory-')as area:
            self.entry.run_root=Path(area);root=Path(area)/'inputs';root.mkdir()
            header=json.dumps({'layer.weight':{'dtype':'F32','shape':[2],'data_offsets':[0,8]}}).encode()
            for name,raw in {'config.json':b'{"model_type":"qwen2","hidden_size":8,"intermediate_size":16,"num_hidden_layers":2,"num_attention_heads":2,"num_key_value_heads":1,"vocab_size":32,"max_position_embeddings":4096}',
                'tokenizer.json':b'{"model":{"type":"BPE","vocab":{"a":0},"merges":[]}}',
                'tokenizer_config.json':b'{}','model.safetensors':len(header).to_bytes(8,'little')+header+b'\0'*8}.items():
                (root/name).write_bytes(raw)
            class Port(sources._SourceExecutionPort):
                def __init__(self,child,owner):self.child,self.owner=child,owner
                def assert_bound(self,*args):raise AssertionError('No Source execution in inventory test')
                assert_reserved=execute=invoke_native=reserve_check=reserve_initial=assert_bound
            inspect=child_module.model.inspect_local_model
            with patch.object(child_module,'_SourceExecution',Port), \
                 patch.object(sources._OriginalModelSources,'prepare',return_value=None)as prepare, \
                 patch.object(child_module.model,'inspect_local_model',wraps=inspect)as inspector:
                self.original_prepare(self.child,str(root))
            inspector.assert_called_once_with(root);prepare.assert_called_once_with()
            self.assertIs(type(self.child.source),sources._OriginalModelSources)
            self.assertIs(self.child.source._inventory,self.child.inventory)
            self.assertIs(self.child.source_port.owner,self.child.source)
            self.assertIs(self.child.source._execution,self.child.source_port)

    def test_expired_deadline_and_cross_thread_request_cannot_prepare(self):
        clock=SimpleNamespace(monotonic_ns=lambda:self.child.deadline+1)
        with patch.object(source,'time',clock),self.assertRaises(OffloadAdmissionError):self.step(0)
        errors=[]
        def other():
            try:self.step(0)
            except BaseException as error:errors.append(type(error))
        thread=Thread(target=other);thread.start();thread.join(2)
        self.assertEqual(errors,[OffloadAdmissionError]);self.assertNotIn('inspect-and-prepare',self.events)


class NativeTimerTests(unittest.TestCase):
    def setUp(self):
        self.error=0;self.effects=[];self.next=100;self.delete_mode='true';self.wait_result=0
        self.owner=SimpleNamespace(api=None,calls=[],buffers=[],handles=[],handle_bindings={},
                                   deadline=time.monotonic_ns()+120*10**9,thread=get_ident(),finishing=False)
        owner=self.owner;outer=self
        class Function:
            def __init__(self,name,body):self.name,self.body=name,body;self.argtypes=[];self.restype=C.c_int32
            def __call__(self,*args):outer.effects.append(self.name);return self.body(*args)
        def handle(*args):self.next+=1;return self.next
        def create(out,queue,callback,context,due,period,flags):
            self.assertIsNone(queue);self.assertIsNone(context);self.assertEqual((period,flags),(0,8))
            self.next+=1;out._obj.value=self.next;return 1
        def delete(queue,number,event):
            if self.delete_mode=='false':self.error=5;return 0
            if self.delete_mode=='pending':self.error=997;return 0
            return 1
        self.functions=[Function('event',handle),Function('create-timer',create),Function('delete-timer',delete),
                        Function('wait',lambda *args:self.wait_result),Function('close',lambda *args:1)]
        k=SimpleNamespace(**dict(zip(('CreateEventW','CreateTimerQueueTimer','DeleteTimerQueueTimer',
                                     'WaitForMultipleObjects','CloseHandle'),self.functions)))
        api=object.__new__(source._SourceNative);api._SourceNative__origin=api
        api.owner=owner;owner.api=api;api.role=source._CHILD_ROLE
        api.deadline_ns=api._deadline_origin=owner.deadline
        api.calls,api.buffers=owner.calls,owner.buffers;api.pending=None;api.uncertain=False;api.initializing=True
        api.dll=api.dll_facts=None;api.engine_calls=api._engine_calls_origin={}
        api.function_bindings=tuple((fn,(),fn.restype)for fn in self.functions)
        api.rows=api._rows_origin=object.__new__(source._RuntimeSourceRows)
        def role(value):
            if value is not owner:raise OffloadAdmissionError()
            return source._CHILD_ROLE
        for scope in (patch.dict(source._NATIVE_OWNERS,{},clear=True),
                      patch.object(source,'_original_actor',side_effect=role),
                      patch.object(C,'get_last_error',side_effect=lambda:self.error,create=True)):
            scope.start();self.addCleanup(scope.stop)
        source._NATIVE_OWNERS[id(api)]=(api,api.rows,owner,source._CHILD_ROLE)
        source._RuntimeSourceRows.__init__(api.rows,api,source._CHILD_ROLE)
        api.rows.api_bindings=api.rows.api_origin=api.function_bindings
        api.engine_normal=api.rows.reserve('engine-normal',1024,0)
        api.engine_final=api.rows.reserve('engine-final',0,13)
        api.escapes=tuple(api.rows.reserve(name,0,1)for name in ('own-exit','deadline-exit','park'))
        api.k=k;api.timer_callback=lambda fn:fn;self.api=api
        def live(initializing):
            if get_ident()!=owner.thread:raise OffloadAdmissionError()
            if not initializing:
                phase=api.timer.phase
                if phase!='pending'and not(owner.finishing and phase in ('completion-won','retired')):
                    raise OffloadAdmissionError()
        owner._native_live=live

    def timer(self):
        timer=source._SourceLifetimeTimer(self.api);self.api.initializing=False;return timer

    def test_original_timer_cannot_be_reinitialized_and_a_copy_has_no_authority(self):
        timer=self.timer();self.assertEqual(timer.phase,'pending')
        self.assertEqual(timer.deadline,self.owner.deadline)
        effects=len(self.effects)
        with self.assertRaises(OffloadAdmissionError):source._SourceLifetimeTimer.__init__(timer,self.api)
        clone=copy.copy(timer)
        with self.assertRaises(OffloadAdmissionError):clone._assert_original()
        self.assertEqual(len(self.effects),effects)

    def test_completed_delete_wait_and_original_event_close_are_all_required(self):
        timer=self.timer();self.owner.finishing=True;timer.retire()
        self.assertEqual(timer.phase,'retired');self.assertTrue(timer.event.closed)
        self.assertEqual(self.effects[-3:],['delete-timer','wait','close'])
        effects=len(self.effects)
        with self.assertRaises(OffloadAdmissionError):timer.retire()
        self.assertEqual(len(self.effects),effects)

    def test_pending_deletion_is_completed_by_wait_before_event_close(self):
        self.delete_mode='pending';timer=self.timer();self.owner.finishing=True;timer.retire()
        self.assertEqual(timer.phase,'retired');self.assertEqual(self.effects[-3:],['delete-timer','wait','close'])

    def test_delete_refusal_does_not_close_or_retry_the_timer(self):
        self.delete_mode='false';timer=self.timer();self.owner.finishing=True
        with self.assertRaises(OffloadAdmissionError):timer.retire()
        self.assertEqual(timer.phase,'completion-won');self.assertFalse(timer.event.closed)
        self.assertNotIn('wait',self.effects);self.assertNotIn('close',self.effects)
        with self.assertRaises(OffloadAdmissionError):timer.retire()
        self.assertEqual(self.effects.count('delete-timer'),1)

    def test_unconfirmed_callback_retirement_keeps_original_event_and_slot(self):
        self.wait_result=258;timer=self.timer();self.owner.finishing=True
        slot,callback,event=timer.slot,timer.callback,timer.event
        with self.assertRaises(OffloadAdmissionError):timer.retire()
        self.assertEqual(timer.phase,'completion-won');self.assertFalse(event.closed)
        self.assertIs(timer.slot,slot);self.assertIs(timer.callback,callback);self.assertIs(timer.event,event)
        self.assertNotIn('close',self.effects)

    def test_rebound_numeric_timer_handle_refuses_before_cancellation(self):
        timer=self.timer();self.owner.finishing=True
        timer.number+=1;timer.slot.value=timer.number
        effects=len(self.effects)
        with self.assertRaises(OffloadAdmissionError):timer.retire()
        self.assertEqual(len(self.effects),effects)

    def test_original_engine_and_source_close_share_the_same_terminal_tail(self):
        timer=self.timer()
        ticket=self.api.rows.reserve('source-unused-close',0,48)
        self.assertEqual(len(ticket.rows),48)
        with self.assertRaises(source.ledger.SourceLedgerError):self.api.rows.reserve('extra',0,1)
        self.assertIs(timer.api.rows,self.api.rows)

    def test_only_the_original_live_timer_callback_can_request_owned_expiry(self):
        timer=self.timer();clone=copy.copy(timer)
        with patch.object(self.api,'escape_exit')as escape:
            clone._expired(None,1)
            self.assertFalse(self.api.uncertain);escape.assert_not_called()
            clock=SimpleNamespace(monotonic_ns=lambda:timer.cutoff)
            with patch.object(source,'time',clock):timer._expired(None,1)
            self.assertEqual(timer.phase,'expired');self.assertTrue(self.api.uncertain)
            escape.assert_called_once_with(2,deadline=True)

    def test_retired_callback_cannot_reopen_the_source_lifetime(self):
        timer=self.timer();self.owner.finishing=True;timer.retire()
        with patch.object(self.api,'escape_exit')as escape:
            timer._expired(None,1)
        self.assertEqual(timer.phase,'retired');self.assertFalse(self.api.uncertain)
        escape.assert_not_called()
        with self.assertRaises(AttributeError):timer.phase='pending'

    def test_foreign_thread_cannot_issue_native_work_on_the_source_actor(self):
        self.timer();effects=len(self.effects);calls=len(self.api.calls);results=[]
        def foreign():
            try:self.api.call(self.api.k.CreateEventW,None,1,0,None)
            except OffloadAdmissionError:results.append('denied')
        thread=Thread(target=foreign);thread.start();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(results,['denied'])
        self.assertEqual(len(self.effects),effects);self.assertEqual(len(self.api.calls),calls)

    def test_rebound_engine_diagnostic_table_cannot_mislabel_original_native_call(self):
        with patch.dict(source._FAILURE_STATES,{},clear=True):
            self.owner.entry=SimpleNamespace(case=source._MAP_DENIAL_CASE)
            source._init_failure_state(self.owner,'child')
            function=self.api.k.CloseHandle
            table=((self.api.k,'CloseHandle',function,tuple(function.argtypes),function.restype),)
            self.api.diagnostic_bindings=table
            source._bind_failure_api(self.owner,self.api,table)
            self.api.call(function,111)
            self.assertEqual(source._read_failure(self.owner,OffloadAdmissionError())['api'],'close-handle')
            self.api.diagnostic_bindings=((self.api.k,'DeviceIoControl',function,table[0][3],table[0][4]),)
            self.api.call(function,111)
            self.assertEqual(source._read_failure(self.owner,OffloadAdmissionError())['api'],'unknown')
            with self.assertRaises(OffloadAdmissionError):
                source._bind_failure_api(self.owner,self.api,self.api.diagnostic_bindings)


class SourcePortReservationTests(unittest.TestCase):
    def setUp(self):
        NativeTimerTests.setUp(self)
        child=object.__new__(child_module._OriginalSourceChild)
        child.__dict__.update(self.owner.__dict__)
        self.api.owner=child
        source._NATIVE_OWNERS[id(self.api)]=(self.api,self.api.rows,child,source._CHILD_ROLE)
        self.child=child
        owner=object.__new__(sources._OriginalModelSources)
        owner._origin=owner;owner._factory=sources._WindowsSourceApi
        child.source=owner;child.current={'seq':0}
        def live(value):
            if value is not child or get_ident()!=child.thread:raise OffloadAdmissionError()
        def actor(value):live(value);return source._CHILD_ROLE
        for scope in (patch.object(child_module,'_CHILD',child),
                      patch.dict(source._FAILURE_STATES,{},clear=True),
                      patch.object(child_module._OriginalSourceChild,'_live',live),
                      patch.object(source,'_original_actor',side_effect=actor)):
            scope.start();self.addCleanup(scope.stop)
        port=child_module._SourceExecution(child,owner)
        child.source_port=owner._execution=port
        owner._plan=sources._SourceGraphPlan(4,4,4,100,13,120,24,25,4*1024**2)
        self.port,self.source=port,owner

    def reserve(self):
        ticket=[]
        self.assertIsNone(self.port.execute(self.source,'prepare',
            lambda:ticket.append(self.port.reserve_initial(self.source,self.source._plan))))
        return ticket[0]

    def test_original_source_and_engine_reservations_share_the_physical_table(self):
        ticket=self.reserve();arena=self.api.rows
        self.assertIs(ticket.native.arena,arena);self.assertIs(self.port.arena,arena)
        self.assertEqual(len(ticket.native.normal.rows),144)
        self.assertEqual(len(ticket.native.terminal.rows),25)
        self.assertEqual(sum(row.terminal and row.reservation is not None for row in arena.rows),41)
        self.assertEqual(sum(not row.terminal and row.reservation is not None for row in arena.rows),1168)
        arena.reserve('remaining-terminal',0,23)
        with self.assertRaises(source.ledger.SourceLedgerError):arena.reserve('extra-terminal',0,1)
        self.assertEqual(self.effects,[])  # Reservation precedes any DLL/API creation.

    def test_one_check_cannot_refill_the_original_reservation(self):
        ticket=self.reserve();rows=ticket.native.normal.rows
        self.child.current={'seq':1}
        action=lambda:self.port.reserve_check(self.source,ticket,24)
        self.port.execute(self.source,'check',action)
        with self.assertRaises(OffloadAdmissionError):self.port.execute(self.source,'check',action)
        self.assertTrue(self.port.failed);self.assertIs(ticket.native.normal.rows,rows)
        self.assertEqual(self.effects,[])

    def test_copied_port_or_ticket_cannot_authorize_source_work(self):
        ticket=self.reserve();clone=copy.copy(self.port)
        with self.assertRaises(OffloadAdmissionError):clone.assert_bound(self.source)
        with self.assertRaises(OffloadAdmissionError):copy.copy(ticket)
        self.assertEqual(self.effects,[])

    def test_failed_original_callback_fences_port_and_retains_reserved_rows(self):
        ticket=self.reserve();self.child.current={'seq':1}
        def fail():raise RuntimeError('synthetic')
        with self.assertRaises(RuntimeError):self.port.execute(self.source,'check',fail)
        self.assertTrue(self.port.failed)
        with self.assertRaises(OffloadAdmissionError):self.port.assert_bound(self.source)
        self.assertIs(self.port.ticket,ticket)
        self.assertTrue(all(row.reservation is ticket.native.normal for row in ticket.native.normal.rows))

    def test_port_cannot_reinitialize_its_original_identity_custody(self):
        ticket=self.reserve();original=self.port.original;custody=self.port.identity_custody
        with self.assertRaises(OffloadAdmissionError):
            child_module._SourceExecution.__init__(self.port,self.child,self.source)
        self.assertIs(self.port.original,original);self.assertIs(self.port.identity_custody,custody)
        self.assertIs(self.port.ticket,ticket);self.assertEqual(self.effects,[])


class OriginalSourceDenialTests(unittest.TestCase):
    """Actual Source prepare and producer with memory-only Windows replies."""
    def setUp(self):
        SourcePortReservationTests.setUp(self)
        from modules.adapters.runtime.python.worker.tests.test_windows_offload_sources import FakeSourceNative
        self.native=FakeSourceNative();native=self.native
        self.last_error=0
        class Dll:
            def __init__(self,name,**kwargs):self._name=name;self._handle=1 if name=='kernel32.dll'else 2
            def __getattr__(self,name):return native.functions[name]
        def set_error(value):self.last_error=value
        for scope in (patch.object(C,'WinDLL',Dll,create=True),
                      patch.object(C,'set_last_error',side_effect=set_error,create=True),
                      patch.object(C,'get_last_error',side_effect=lambda:self.last_error,create=True)):
            scope.start();self.addCleanup(scope.stop)
        self.child.entry=SimpleNamespace(case=source._MAP_DENIAL_CASE)
        source._init_failure_state(self.child, 'child')
        self.child.requests=[self.child.current]
        sources._OriginalModelSources.__init__(self.source,self.native.value(),_execution=self.port)
        def fault(name,args):
            if name=='DeviceIoControl':
                leaf=native.handles[args[0]][0]
                native.native_error=801 if leaf=='model.safetensors'else 997
        native.fault=fault
        self.addCleanup(lambda:sources._SOURCE_CUSTODY.pop(id(self.source),None))
        self.addCleanup(lambda:sources._SOURCE_RETIREMENTS.pop(id(self.source),None))

    def denied(self):
        with self.assertRaises(OffloadAdmissionError):self.source.prepare()
        self.assertTrue(self.port.failed);self.assertTrue(self.source._uncertain)
        self.assertFalse(self.api.uncertain)
        return self.child._original_source_denial()

    def test_witness_is_from_actual_prepared_guard_and_original_physical_completion(self):
        witness=self.denied()
        self.assertEqual(witness['win32_error'],801)
        self.assertEqual(witness['source_call_count'],len(self.source._calls))
        target=self.source._guards[-1].handle.installed
        raw=(1).to_bytes(8,'little')+target.to_bytes(16,'little')
        self.assertEqual(witness['target_identity_sha256'],source.hashlib.sha256(raw).hexdigest())
        self.assertFalse(self.source._pending.acknowledged)
        row=self.child._source_call_return(self.source._pending)
        self.assertEqual(row.completion[1:3],(0,801));self.assertTrue(row.payload['acknowledged'])
        effects=len(self.native.calls)
        self.assertEqual(self.child._original_source_denial(),witness)
        self.assertEqual(len(self.native.calls),effects)

    def test_wrong_error_or_generic_source_failure_has_no_witness(self):
        self.native.fault=lambda name,args:setattr(self.native,'native_error',32)if name=='DeviceIoControl'else None
        with self.assertRaises(OffloadAdmissionError):self.source.prepare()
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()

    def test_mutated_identity_buffer_cannot_rewrite_the_original_return(self):
        self.denied();handle=self.source._guards[-1].handle.installed
        record=next(record for record in reversed(self.source._calls)
                    if len(record.args)==4 and record.args[:2]==(handle,18))
        row=self.child._source_call_return(record)
        original=self.port.identity_custody[1](record,row)
        record.keep[1][0]^=1
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()
        self.assertEqual(self.port.identity_custody[1](record,row),original)

    def test_return_observation_or_original_operation_drift_is_not_denial_proof(self):
        self.denied();record=self.source._pending;row=self.child._source_call_return(record)
        row.payload['os_error']=32
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()
        row.payload['os_error']=801;self.source._op.finished=True
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()

    def test_wrong_case_rebound_function_or_guard_level_does_not_qualify(self):
        self.denied();self.child.entry.case=None
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()
        self.child.entry.case=source._MAP_DENIAL_CASE
        guard=self.source._guards[-1];guard.incoming.level=7
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()
        guard.incoming.level=1
        self.source._api.k.DeviceIoControl=lambda *args:0
        with self.assertRaises(OffloadAdmissionError):self.child._original_source_denial()


    def execute_denial(self, *, wrong_error=False, write_fails=False):
        self.child.current=None;self.child.requests=[];self.child.state='new';self.child.failed=False
        self.child.nonce='a'*32;self.child.entry.digest='b'*64
        message={'v':2,'nonce':self.child.nonce,'source_digest':self.child.entry.digest,
                 'deadline_ns':self.child.deadline,'seq':0,'op':'prepare-source',
                 'body':{'model_root':'C:\\synthetic'}}
        if wrong_error:
            self.native.fault=lambda name,args:setattr(self.native,'native_error',32)if name=='DeviceIoControl'else None
        frames=[];self.child.channels={'response':object()}
        def write(owner,handle,raw):
            frames.append(raw)
            if write_fails:raise OffloadAdmissionError()
        with patch.object(child_module._OriginalSourceChild,'_prepare_source',lambda owner,root:self.source.prepare()), \
             patch.object(child_module._OriginalSourceChild,'_write_bytes',write):
            with self.assertRaises(OffloadAdmissionError):self.child.execute(message)
        self.assertTrue(self.child.failed);self.assertFalse(self.source._retired)
        self.assertEqual(len(frames),1)
        return source._decode(frames[0][4:])

    def test_actual_source_execute_sends_expected_denial_once(self):
        reply=self.execute_denial()
        source._denial_message(reply,'a'*32,'b'*64,self.child.deadline)
        self.assertNotIn('diagnostic',reply['body'])

    def test_actual_wrong_native_error_is_only_unqualified_diagnostic(self):
        reply=self.execute_denial(wrong_error=True)
        diagnostic=source._failure_message(reply,'a'*32,'b'*64,self.child.deadline)
        self.assertEqual(diagnostic['phase'],'attribute-denial')
        self.assertEqual(diagnostic['api'],'read-oplock');self.assertEqual(diagnostic['win32_error'],32)
        self.assertEqual(diagnostic['result_class'],'zero')
        with self.assertRaises(OffloadAdmissionError):source._denial_message(reply,'a'*32,'b'*64,self.child.deadline)

    def test_started_denial_reply_is_not_retried_as_a_diagnostic(self):
        reply=self.execute_denial(write_fails=True)
        self.assertIn('denial',reply['body']);self.assertNotIn('diagnostic',reply['body'])


if __name__=='__main__':unittest.main()

"""Fixed synthetic source checks; declarations/import never execute Native IO."""
import ctypes as C
import hashlib
import json
import os
import re
import stat
import struct
from threading import get_ident
import time

SCHEMA='windows-offload-sources-native-v2'
CASES=('deadline-control','source-read-close','source-hash-denied',
       'source-reader-mapping-and-write-denial')
MAX_CALLS=4096
READ_BYTES=8*1024**2
VIEW_BYTES=65536
_READER_FLAGS=('reader_identity_confirmed','writer_sharing_denied','private_view_changed',
               'source_bytes_unchanged','reader_graph_retired')
_READER_COUNTS=('reader_reserved_normal','reader_native_calls','reader_terminal_calls',
                'reader_closed_objects','private_view_bytes','private_view_commit_bytes')
_FLAGS=('timer_configured','shared_rows_reserved','source_prepared','exact_hashes_confirmed',
        'source_reads_completed','source_guards_retired','source_handles_closed',
        'source_retired','hash_denial_observed','original_custody_retained',
        'late_reuse_refused','no_source_replay','model_started','production_composed',
        'disk_credit_granted','parent_qualification_granted')+_READER_FLAGS
_COUNTS=('source_files','source_ancestors','source_reads','source_native_calls',
         'source_terminal_calls','source_closed_handles','source_reserved_normal',
         'source_reserved_terminal','engine_reserved_normal','engine_reserved_terminal')+_READER_COUNTS
_FIELDS=frozenset(('schema_version','case','source_digest','outcome','elapsed_ns',
                  'failure_stage',*_FLAGS,*_COUNTS))
_FAILURES=frozenset(('source-operation','source-case','source-report','source-context',
    'source-owner','source-reservation','source-callback','source-data','source-outcome',
    'reader-origin','reader-operation','reader-output','reader-view','reader-retirement'))


class SourceFixtureError(RuntimeError):
    def __init__(self,stage):
        self.stage=stage if type(stage)is str and stage in _FAILURES else 'source-operation'
        super().__init__('The isolated original-source check did not complete.')


def need(value,stage):
    if not value:raise SourceFixtureError(stage)


def base_report(case,source,started):
    return {'schema_version':SCHEMA,'case':case,'source_digest':source,'outcome':'observed',
        'elapsed_ns':max(1,time.monotonic_ns()-started),'failure_stage':'none',
        **{n:False for n in _FLAGS},**{n:0 for n in _COUNTS}}


def validate_child_report(value,case,source):
    need(type(value)is dict and set(value)==_FIELDS and case in CASES
         and value['case']==case and value['schema_version']==SCHEMA
         and type(source)is str and re.fullmatch('[a-f0-9]{64}',source)
         and value['source_digest']==source,'source-report')
    need(all(type(value[n])is bool for n in _FLAGS)
         and all(type(value[n])is int and 0<=value[n]<=
                 (VIEW_BYTES if n in ('private_view_bytes','private_view_commit_bytes')else MAX_CALLS)
                 for n in _COUNTS)
         and type(value['elapsed_ns'])is int and 0<value['elapsed_ns']<=120*10**9
         and value['failure_stage']=='none' and value['timer_configured']is True
         and not any(value[n]for n in ('model_started','production_composed',
             'disk_credit_granted','parent_qualification_granted')),'source-report')
    if case=='deadline-control':
        need(value['outcome']=='armed' and not any(value[n]for n in _COUNTS)
             and not any(value[n]for n in _FLAGS if n!='timer_configured'),'source-outcome')
    else:
        need(value['outcome']=='observed' and value['shared_rows_reserved']
             and value['source_files']==4 and value['source_reads']==5
             and 1<=value['source_ancestors']<=27
             and value['source_reserved_normal']>0
             and value['source_reserved_normal']==6*value['source_ancestors']+126
             and value['source_reserved_terminal']==value['source_ancestors']+21
             and value['engine_reserved_normal']==256 and value['engine_reserved_terminal']==16
             and value['source_reserved_terminal']+value['engine_reserved_terminal']<=64
             and value['late_reuse_refused'] and value['no_source_replay'],'source-outcome')
        if case in ('source-read-close',CASES[3]):
            need(all(value[n]for n in ('source_prepared','exact_hashes_confirmed',
                'source_reads_completed','source_guards_retired','source_handles_closed','source_retired'))
                and not value['hash_denial_observed'] and not value['original_custody_retained']
                and value['source_native_calls']==7*value['source_ancestors']+147
                and value['source_terminal_calls']==value['source_reserved_terminal']
                and value['source_closed_handles']==value['source_ancestors']+9,'source-outcome')
        else:
            need(value['hash_denial_observed'] and value['original_custody_retained']
                and value['source_native_calls']==4*value['source_ancestors']+76
                and value['source_terminal_calls']==value['source_closed_handles']==0
                and not any(value[n]for n in ('source_prepared','exact_hashes_confirmed',
                    'source_guards_retired','source_handles_closed','source_retired')),'source-outcome')
    if case==CASES[3]:
        need(all(value[n]for n in _READER_FLAGS)
             and tuple(value[n]for n in _READER_COUNTS)==(16,12,3,3,VIEW_BYTES,VIEW_BYTES),
             'source-outcome')
    else:
        need(not any(value[n]for n in _READER_FLAGS+_READER_COUNTS),'source-outcome')
    return dict(value)


def failure_diagnostics(value):
    if type(value)is not dict:return {}
    result={n:value[n]for n in _COUNTS if type(value.get(n))is int and 0<=value[n]<=
            (VIEW_BYTES if n in ('private_view_bytes','private_view_commit_bytes')else MAX_CALLS)}
    result.update({n:value[n]for n in _FLAGS if type(value.get(n))is bool})
    if type(value.get('failure_stage'))is str and value['failure_stage']in _FAILURES:
        result['component_failure_stage']=value['failure_stage']
    return result


class _Allocation:
    def __init__(self,arena,source,plan):
        self.origin,self.arena,self.source,self.plan=self,arena,source,plan
        self.normal=self.terminal=None
        self.original=None
    def __repr__(self):return '<original source diagnostic allocation>'
    def __copy__(self):raise SourceFixtureError('source-reservation')
    def __deepcopy__(self,memo):raise SourceFixtureError('source-reservation')
    def __reduce_ex__(self,protocol):raise SourceFixtureError('source-reservation')
    def check(self,arena,source,plan):
        need(type(self)is _Allocation and self.origin is self and self.arena is arena
             and self.source is source and self.plan is plan
             and type(self.original)is tuple and len(self.original)==5
             and all(a is b for a,b in zip((arena,source,plan,self.normal,self.terminal),self.original)),
             'source-reservation')
        arena.assert_reserved(self.normal);arena.assert_reserved(self.terminal)


def _source_execution(engine,native,source_module,source,hashes):
    """Only the fixed owned SOURCE diagnostic can compose this private port."""
    need(type(native)is engine._Native and engine._profile_for(native)is engine._SOURCE_PROFILE
         and type(native.source_slots)is engine._SourceSlots,'source-context')
    native.source_slots.assert_child_ready(hashes)
    s=source_module
    class SourceExecution(s._SourceExecutionPort):
        def __init__(self):
            self.origin=self;self.source=source;self.native=native;self.arena=native.source_slots
            self.module=s;self.hashes=hashes;self.hash_facts=tuple(sorted(hashes.items()))
            self.thread=get_ident();self.busy=self.failed=False;self.kind=None
            self.plan=self.ticket=None;self.check_used=False;self.bootstraps=[]
            self.original=(source,native,self.arena,s,hashes,self.thread)
            native.buffers.append(self)
        def assert_bound(self,owner):
            need(type(self)is SourceExecution and self.origin is self
                 and type(self.original)is tuple and len(self.original)==6
                 and all(a is b for a,b in zip((self.source,self.native,self.arena,
                    self.module,self.hashes,self.thread),self.original))
                 and owner is self.source and type(owner)is s._OriginalModelSources
                 and owner._origin is owner and owner._execution is self
                 and owner._factory is s._WindowsSourceApi and get_ident()==self.thread
                 and not self.failed and tuple(sorted(hashes.items()))==self.hash_facts,'source-owner')
            self.arena.assert_child_ready(hashes)  # Pure original predicates only.
        def reserve_initial(self,owner,plan):
            self.assert_bound(owner)
            need(self.busy and self.kind=='prepare' and self.ticket is None
                 and type(plan)is s._SourceGraphPlan and owner._plan is plan,'source-reservation')
            allocation=_Allocation(self.arena,owner,plan);native.buffers.append(allocation)
            # One future selected live check and all unused closes share this
            # actor's real rows. Engine final/escape/safety already own16 tail rows.
            allocation.normal=self.arena.reserve('source-normal',plan.prepare_calls+plan.live_check_calls,0)
            allocation.terminal=self.arena.reserve('source-close',0,plan.unused_close_calls)
            allocation.original=(self.arena,owner,plan,allocation.normal,allocation.terminal)
            need(plan.buffer_bytes+104*1024**2<=512*1024**2,'source-reservation')
            self.plan=plan
            self.ticket=s._SourceReservation(self,owner,plan,allocation)
            return self.ticket
        def assert_reserved(self,owner,reservation,plan):
            self.assert_bound(owner)
            need(reservation is self.ticket and plan is self.plan,'source-reservation')
            reservation.assert_original(self,owner,plan)
            reservation.native.check(self.arena,owner,plan)
        def reserve_check(self,owner,reservation,calls):
            self.assert_reserved(owner,reservation,self.plan)
            need(self.busy and self.kind=='check' and not self.check_used
                 and type(calls)is int and calls==self.plan.live_check_calls,'source-reservation')
            remaining=sum(row.binding is None for row in reservation.native.normal.rows)
            need(remaining>=calls,'source-reservation');self.check_used=True
        def execute(self,owner,kind,invoke):
            self.assert_bound(owner)
            need(not self.busy and kind in ('prepare','check','retire-unused')and callable(invoke),'source-callback')
            self.busy,self.kind=True,kind
            try:
                result=invoke()
                self.assert_bound(owner)
                self.busy,self.kind=False,None
                return result
            except BaseException:
                self.failed=True  # Original engine terminal intents remain owned.
                raise
        def invoke_native(self,owner,reservation,record,invoke):
            self.assert_reserved(owner,reservation,self.plan)
            need(self.busy and type(record)is s._SourceNativeCall and owner._pending is record
                 and callable(invoke) and get_ident()==self.thread,'source-callback')
            record.assert_original(owner)
            allocation=reservation.native
            terminal=record.terminal
            need(type(terminal)is bool and terminal is (self.kind=='retire-unused'),'source-callback')
            variant,library='scalar',None
            if record.function is C.WinDLL:
                need(self.kind=='prepare' and len(self.bootstraps)<2
                     and record.args==(('kernel32.dll',)if not self.bootstraps else ('ntdll.dll',)),
                     'source-callback')
                variant,library='system-library',record.args[0]
            else:
                need(len(self.bootstraps)==2 and type(owner._api)is s._WindowsSourceApi,'source-callback')
                owner._api._assert_original()
                need(any(row[2]is record.function for row in owner._api._functions),'source-callback')
            row=self.arena.begin(allocation.terminal if terminal else allocation.normal,
                'source-native',record.function,record.args,(owner,record,invoke,self),
                terminal=terminal,variant=variant,library=library,source_record=record)
            try:
                value=invoke()
                record.assert_original(owner)
                need(record.started and record.returned and record.thread==self.thread
                     and value is record.value,'source-callback')
                self.arena.returned(row,value,record.error)  # Original immediate error.
                self.arena.acknowledge(row)  # Invocation only, NOT IO retirement.
                if variant=='system-library':self.bootstraps.append(value)
                return value
            except BaseException:
                if record.returned and row.completion is None:
                    try:self.arena.returned(row,record.value,record.error)
                    except BaseException:pass
                self.arena.fenced=native.uncertain=True
                raise
    return SourceExecution()


def _assert_hash_denial(source,s,port):
    """Recognize only the fixed completed config/model hash-rejection frontier.

    An access error, incomplete IO, invalid result or setup denial is a failed
    case. Uncertainty by itself never qualifies the intended changed-file test.
    All predicates inspect retained originals; this adds no Native/file query.
    """
    source._retain().check()
    need(source._uncertain and not source._retired and port.failed
         and not port.native.uncertain and port.native.pending is None
         and port.ticket is source._reservation
         and type(source._api)is s._WindowsSourceApi
         and source._acquiring is source._closing is source._pending is None
         and source._op.started and not source._op.finished
         and len(source._calls)==4*source._plan.ancestors+76
         and len(source._handles)==source._plan.handle_slots
         and type(source._files)is tuple and len(source._files)==4
         and len(source._guards)==4 and len(source._reads)==3,'source-outcome')
    source._api._assert_original()
    for call in source._calls:
        call.assert_original(source)
        need(call.started and call.returned and call.acknowledged and not call.terminal
             and (call.valid(call.value)or(type(call.value)is int and call.value==0
                  and call.error in call.false_errors))
             and (call.expected_error is None or call.error==call.expected_error),'source-outcome')
    expected=((source._files[0][0],0,source._files[0][4]),
              (source._files[1][0],0,READ_BYTES),
              (source._files[1][0],READ_BYTES,128))
    for read,(handle,offset,size)in zip(source._reads,expected):
        read.assert_original()
        need(read.handle is handle and read.issued and read.completed
             and read.offset.value==offset and read.size==size
             and read.io.status in (None,0) and read.io.information==size,'source-outcome')
    for guard in source._guards:
        guard.assert_original()
        need(not guard.retirement_started and not guard.retired,'source-outcome')
    last=source._calls[-1];guard=source._files[1][2]
    need(last.function is source._api.k.WaitForSingleObject
         and last.args==(guard.event.installed,0) and last.keep==(guard,)
         and last.value==258,'source-outcome')
    rows=tuple(row for row in port.arena.order if row.binding[8]is not None)
    need(len(rows)==len(source._calls),'source-outcome')
    for row,call in zip(rows,source._calls):
        port.arena.member(row)
        need(row.binding[8]is call and row.completion is port.arena.completions[row.index]
             and row.completion[1]is call.value and row.completion[2]==call.error
             and row.payload['acknowledged']is True,'source-outcome')


class _ReaderOutput:
    """Original output intent retained before any handle/view acquisition."""
    def __init__(self,graph,kind):
        self.graph,self.kind,self.origin=graph,kind,self
        self.slot=C.c_void_p();self.generation=object()
        self.original=(graph,kind,self.slot,self.generation)
        self.row=self.completion=None
        self.closing=self.retired=False
    def check(self,graph):
        need(type(self)is _ReaderOutput and self.origin is self and self.graph is graph
             and type(self.original)is tuple and len(self.original)==4
             and all(a is b for a,b in zip((graph,self.kind,self.slot,self.generation),self.original))
             and type(self.slot)is C.c_void_p and type(self.closing)is bool
             and type(self.retired)is bool,'reader-output')
        if self.row is not None:
            graph.arena.member(self.row)
            need(self.row.binding[4]==(graph,self) and self.row in graph.records,'reader-output')
            if self.completion is not None:
                need(self.completion is self.row.completion
                     and self.completion is graph.arena.completions[self.row.index]
                     and self.slot.value==self.completion[1],'reader-output')


class _ReaderGraph:
    """Fixed diagnostic only; no caller function, handle, pointer or path API.

    Twelve normal calls debit the original16-row ticket. Three ordered terminal
    calls use the engine's existing safety4, bound before Source/DLL acquisition.
    Known returns remain in physical rows even when validation cannot ACK them.
    """
    _NORMAL=('guard-before','reader-open','reader-flags','reader-type','reader-attributes',
             'reader-identity','reader-size','writer-denied','section-create','section-flags',
             'view-create','guard-after')
    _TERMINAL=('view-unmap','section-close','reader-close')
    def __init__(self,engine,native,s,source,port,hashes):
        need(type(native)is engine._Native and engine._profile_for(native)is engine._SOURCE_PROFILE
             and native.source_case==CASES[3] and native.source_reader is None
             and type(source)is s._OriginalModelSources and source._execution is port
             and port.source is source and port.ticket is None and source._api is None,
             'reader-origin')
        self.origin,self.engine,self.native,self.s,self.source,self.port,self.hashes=self,engine,native,s,source,port,hashes
        self.arena=native.source_slots;self.thread=get_ident()
        self.records=self.record_origin=();self.failed=self.retired=self.changed=False
        self.bound=None;self.normal=None;self.safety=native.source_safety
        self.reader,self.writer,self.section,self.view=(_ReaderOutput(self,k)for k in ('reader','writer','section','view'))
        self.flags=C.c_uint32();self.attributes=(C.c_uint32*2)()
        self.identity=(C.c_ubyte*24)();self.size=C.c_int64();self.section_flags=C.c_uint32()
        # Retain the partial original graph BEFORE reservation/acquisition.
        native.buffers.append(self);native.source_reader=self
        self.arena.assert_child_ready(hashes);self.arena.assert_reserved(self.safety)
        need(self.safety.purpose=='engine-safety' and len(self.safety.rows)==4
             and all(r.terminal and r.binding is None for r in self.safety.rows)
             and source._plan.buffer_bytes+105*1024**2+VIEW_BYTES<=512*1024**2,'source-reservation')
        self.normal=self.arena.reserve('reader-normal',16,0)
        self.functions=tuple((name,getattr(native.k,name))for name in (
            'WaitForSingleObject','CreateFileW','GetHandleInformation','GetFileType',
            'GetFileInformationByHandleEx','GetFileSizeEx','CreateFileMappingW',
            'MapViewOfFile','UnmapViewOfFile','CloseHandle'))
        need(all(any(fn is original for original in native.source_functions)for _,fn in self.functions),
             'reader-origin')
        self.original=(engine,native,s,source,port,hashes,self.arena,self.thread,self.normal,
            self.safety,self.reader,self.writer,self.section,self.view,self.flags,self.attributes,
            self.identity,self.size,self.section_flags,self.functions)
    def __repr__(self):return '<fixed original reader diagnostic>'
    def __copy__(self):raise SourceFixtureError('reader-origin')
    def __deepcopy__(self,memo):raise SourceFixtureError('reader-origin')
    def __reduce_ex__(self,protocol):raise SourceFixtureError('reader-origin')
    def check(self):
        need(type(self)is _ReaderGraph and self.origin is self
             and type(self.original)is tuple and len(self.original)==20
             and all(a is b for a,b in zip((self.engine,self.native,self.s,self.source,self.port,
                 self.hashes,self.arena,self.thread,self.normal,self.safety,self.reader,self.writer,
                 self.section,self.view,self.flags,self.attributes,self.identity,self.size,
                 self.section_flags,self.functions),self.original))
             and self.native.source_reader is self and any(v is self for v in self.native.buffers)
             and self.native.source_safety is self.safety and get_ident()==self.thread
             and self.native.source_case==CASES[3] and not self.failed
             and type(self.records)is tuple and self.records is self.record_origin,'reader-origin')
        self.arena.assert_child_ready(self.hashes)
        self.arena.assert_reserved(self.normal);self.arena.assert_reserved(self.safety)
        self.port.assert_bound(self.source)
        for name,function in self.functions:
            need(getattr(self.native.k,name)is function,'reader-origin')
        for node in (self.reader,self.writer,self.section,self.view):node.check(self)
        if self.bound is not None:
            custody,files,file,api,reservation=self.bound
            need(self.s._SOURCE_CUSTODY.get(id(self.source))is custody and self.source._files is files
                 and files[1]is file and self.source._api is api and self.source._reservation is reservation
                 and not self.source._retired and not self.source._uncertain,'reader-origin')
            custody.check();api._assert_original();file[0].assert_original(self.source);file[2].assert_original()
            need(file[3]=='model.safetensors' and not file[0].close_started
                 and not file[2].retirement_started and not file[2].retired,'reader-origin')
        for i,row in enumerate(self.records):
            self.arena.member(row)
            label=(self._NORMAL+self._TERMINAL)[i]
            need(row.binding is self.arena.bindings[row.index]
                 and row.payload is self.arena.payloads[row.index]
                 and row.binding[1]=='reader-'+label and row.binding[5]==self.thread
                 and row.binding[0]is(self.normal if i<12 else self.safety)
                 and row.payload['function']is row.binding[2]
                 and row.payload['args']is row.binding[3]
                 and row.payload['stage']==row.binding[1],'reader-origin')
            completion=self.arena.completions[row.index]
            need(row.completion is completion,'reader-origin')
            if completion is not None:
                need(type(completion)is tuple and len(completion)==4
                     and completion[0]is row.binding and completion[3]==self.thread
                     and row.payload['returned']is True
                     and row.payload['result']is completion[1]
                     and row.payload['os_error']==completion[2]
                     and(row.payload['acknowledged']is True or
                         (i==len(self.records)-1 and self.native.pending is row.payload
                          and row.payload['acknowledged']is False)),'reader-origin')
    def bind_source(self):
        self.check()
        need(self.bound is None and not self.records and self.source._files is not None
             and len(self.source._files)==4 and not self.port.busy,'reader-origin')
        self.bound=(self.source._retain(),self.source._files,self.source._files[1],
                    self.source._api,self.source._reservation)
        self.check()
    def _arguments(self,label):
        k=self.native.k;file=self.bound[2];reader=self.reader.slot.value
        path=str(self.source._inventory.root/'model.safetensors')
        if label.startswith('guard-'):return k.WaitForSingleObject,(file[2].event.installed,0),None
        if label=='reader-open':return k.CreateFileW,(path,0x80000000,1,None,3,0x00200080,None),self.reader
        if label=='reader-flags':return k.GetHandleInformation,(reader,C.byref(self.flags)),None
        if label=='reader-type':return k.GetFileType,(reader,),None
        if label=='reader-attributes':return k.GetFileInformationByHandleEx,(reader,9,C.byref(self.attributes),8),None
        if label=='reader-identity':return k.GetFileInformationByHandleEx,(reader,18,C.byref(self.identity),24),None
        if label=='reader-size':return k.GetFileSizeEx,(reader,C.byref(self.size)),None
        if label=='writer-denied':return k.CreateFileW,(path,0x40000000,7,None,3,0x00200080,None),self.writer
        if label=='section-create':return k.CreateFileMappingW,(reader,None,0x08,0,0,None),self.section
        if label=='section-flags':return k.GetHandleInformation,(self.section.slot.value,C.byref(self.section_flags)),None
        if label=='view-create':return k.MapViewOfFile,(self.section.slot.value,0x01,0,0,VIEW_BYTES),self.view
        if label=='view-unmap':return k.UnmapViewOfFile,(self.view.slot.value,),self.view
        if label=='section-close':return k.CloseHandle,(self.section.slot.value,),self.section
        if label=='reader-close':return k.CloseHandle,(reader,),self.reader
        raise SourceFixtureError('reader-operation')
    def _valid(self,label,value,error):
        if label.startswith('guard-'):return type(value)is int and value==258
        if label in ('reader-open','section-create','view-create'):
            return type(value)is int and 0<value<C.c_void_p(-1).value
        if label=='writer-denied':return type(value)is int and value==C.c_void_p(-1).value and error==32
        if label=='reader-type':return type(value)is int and value==1
        if not(type(value)is int and value!=0):return False
        if label in ('reader-flags','section-flags'):
            return(self.flags if label=='reader-flags'else self.section_flags).value==0
        if label=='reader-attributes':return not self.attributes[0]&(0x10|0x400|0x200|0x800|0x4000|0x1000)and self.attributes[1]==0
        if label=='reader-identity':return bytes(self.identity)==self.bound[2][1][0]
        if label=='reader-size':return self.size.value==self.bound[2][4] and self.size.value>=VIEW_BYTES
        return label in self._TERMINAL
    def _step(self,label):
        self.check()
        need(self.bound is not None and not self.retired and not self.port.busy
             and label in self._NORMAL+self._TERMINAL
             and len(self.records)<15 and (self._NORMAL+self._TERMINAL)[len(self.records)]==label
             and (label not in ('guard-after',*self._TERMINAL)or self.changed),'reader-operation')
        function,args,node=self._arguments(label);terminal=label in self._TERMINAL
        if terminal:
            need(node.completion is not None and not node.closing and not node.retired,'reader-retirement')
            node.closing=True
        row=self.arena.begin(self.safety if terminal else self.normal,'reader-'+label,function,args,
            (self,node),terminal=terminal)
        self.records=self.record_origin=self.records+(row,)
        if node is not None and not terminal:
            need(node.row is None,'reader-output');node.row=row
        try:
            value=function(*args);error=C.get_last_error()&0xffffffff
            # Physical completion commits before checking mutable graph or ACK.
            try:self.arena.returned(row,value,error)
            finally:
                if node is not None and not terminal and self.arena.completions[row.index]is not None:
                    node.completion=self.arena.completions[row.index];node.slot.value=node.completion[1]
            self.check();need(self._valid(label,value,error),'reader-operation')
            self.arena.acknowledge(row)
            if terminal:node.retired=True
            if label=='reader-close':self.retired=True
        except BaseException:
            self.failed=self.arena.fenced=self.native.uncertain=self.source._uncertain=self.port.failed=True
            raise
    def _view_address(self):
        self.check();node=self.view;row=node.row
        need(self.bound is not None and not self.retired and not node.closing and not node.retired
             and len(self.records)==11 and row is self.records[10]
             and row.binding[2]is self.native.k.MapViewOfFile
             and row.binding[3]==(self.section.slot.value,0x01,0,0,VIEW_BYTES)
             and row.payload['acknowledged']is True and node.completion is row.completion
             and self.section.row.payload['acknowledged']is True
             and self.reader.row.payload['acknowledged']is True
             and not self.section.closing and not self.reader.closing,'reader-view')
        pointer=node.slot.value
        need(type(pointer)is int and 0<pointer<=C.c_void_p(-1).value-VIEW_BYTES
             and pointer==row.completion[1] and 0<=112<VIEW_BYTES,'reader-view')
        return pointer+112
    def private_copy(self):
        # Revalidate original completion/identity/range before EACH dereference.
        need(not self.changed,'reader-view')
        need(C.c_ubyte.from_address(self._view_address()).value==0,'reader-view')
        C.c_ubyte.from_address(self._view_address()).value=1
        need(C.c_ubyte.from_address(self._view_address()).value==1,'reader-view')
        self.changed=True
    def exercise(self):
        try:
            self.bind_source()
            for label in self._NORMAL[:-1]:self._step(label)
            self.private_copy();self._step('guard-after')
            for label in self._TERMINAL:self._step(label)
            self.check()
            need(self.retired and all(n.retired for n in (self.view,self.section,self.reader))
                 and len(self.records)==15 and all(r.payload['acknowledged']for r in self.records),
                 'reader-retirement')
        except BaseException:
            self.failed=self.arena.fenced=self.native.uncertain=self.source._uncertain=self.port.failed=True
            raise


def _fresh_facts(path,directory=False):
    info=path.lstat()
    need((stat.S_ISDIR(info.st_mode)if directory else stat.S_ISREG(info.st_mode))
         and not path.is_symlink() and not getattr(info,'st_file_attributes',0)&0x400
         and(directory or info.st_nlink==1),'source-data')
    return(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def _verify_fresh_inputs(inventory,original):
    """Four exact fresh leaves only; never enumerate or follow unknown trees."""
    root,files=original
    need(_fresh_facts(inventory.root,True)==root,'source-data')
    need(type(files)is tuple and len(files)==len(inventory.bindings)==4,'source-data')
    for (name,size,digest),(original_name,facts)in zip(inventory.bindings,files):
        need(name==original_name and name in ('config.json','model.safetensors','tokenizer.json','tokenizer_config.json'),
             'source-data')
        path=inventory.root/name
        need(_fresh_facts(path)==facts and facts[2]==size,'source-data')
        actual=hashlib.sha256();count=0
        with path.open('rb')as stream:
            opened=os.fstat(stream.fileno())
            need((opened.st_dev,opened.st_ino,opened.st_size,opened.st_mtime_ns,opened.st_ctime_ns)==facts,'source-data')
            while count<size:
                block=stream.read(min(1024**2,size-count))
                need(bool(block),'source-data');count+=len(block);actual.update(block)
            need(stream.read(1)==b'' and actual.hexdigest()==digest,'source-data')
            after=os.fstat(stream.fileno())
            need((after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)==facts,'source-data')
        need(_fresh_facts(path)==facts and _fresh_facts(inventory.root,True)==root,'source-data')


def _synthetic_inputs(engine,folder,profile,model):
    """Exclusive fixed fresh inputs only; called by the reviewed Native actor."""
    root=folder/'inputs';engine._fresh_directory(root,profile)
    config={'model_type':'qwen2','hidden_size':8,'intermediate_size':16,
        'num_hidden_layers':2,'num_attention_heads':2,'num_key_value_heads':1,
        'vocab_size':32,'max_position_embeddings':4096}
    payloads={'config.json':json.dumps(config).encode(),
              'tokenizer.json':b'{}','tokenizer_config.json':b'{}'}
    count=(READ_BYTES+16)//4
    header=json.dumps({'layer.weight':{'dtype':'F32','shape':[count],
                      'data_offsets':[0,count*4]}},separators=(',',':')).encode()
    need(len(header)<=104,'source-data')
    prefix=struct.pack('<Q',104)+header+b' '*(104-len(header))
    total=READ_BYTES+128
    hashes={}
    for name,data in payloads.items():
        with(root/name).open('xb')as stream:need(stream.write(data)==len(data),'source-data')
        hashes[name]=(len(data),hashlib.sha256(data).hexdigest())
    digest=hashlib.sha256();digest.update(prefix)
    with(root/'model.safetensors').open('xb')as stream:
        need(stream.write(prefix)==len(prefix),'source-data')
        remaining=count*4;zero=b'\0'*(1024**2)
        while remaining:
            part=zero[:min(len(zero),remaining)]
            need(stream.write(part)==len(part),'source-data');digest.update(part);remaining-=len(part)
    hashes['model.safetensors']=(total,digest.hexdigest())
    rows=tuple((name,*hashes[name])for name in ('config.json','model.safetensors','tokenizer.json','tokenizer_config.json'))
    inventory=model.LocalModelInventory(root,payloads['config.json'],
        (model.TensorInventoryEntry('layer.weight','model.safetensors','F32',(count,),count),),
        rows,hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(),tuple(sorted(hashes)))
    fresh=(_fresh_facts(root,True),tuple((name,_fresh_facts(root/name))for name,_,_ in rows))
    return inventory,fresh


def exercise(engine,native,case,hashes,folder,value):
    need(case in CASES[1:]and engine._profile_for(native)is engine._SOURCE_PROFILE,'source-case')
    engine._child_readback(native)
    need(engine._all_hashes(native)==hashes,'source-context')
    modules=engine._private_core_package(hashes,engine._SOURCE_PROFILE)
    s,m=modules['windows_offload_sources'],modules['local_model_offload']
    inventory,fresh=_synthetic_inputs(engine,folder,engine._SOURCE_PROFILE,m)
    source=object.__new__(s._OriginalModelSources);native.buffers.append(source)
    port=_source_execution(engine,native,s,source,hashes)
    s._OriginalModelSources.__init__(source,inventory,_execution=port)
    reader=_ReaderGraph(engine,native,s,source,port,hashes)if case==CASES[3]else None
    if case=='source-hash-denied':
        # Change only the newly created fixed fixture before read-only admission.
        with(inventory.root/'model.safetensors').open('r+b')as stream:
            stream.seek(112);need(stream.write(b'\1')==1,'source-data')
    plan=source._plan
    value.update(source_files=plan.files,source_ancestors=plan.ancestors,source_reads=plan.reads,
        engine_reserved_normal=256,engine_reserved_terminal=16)
    if case in ('source-read-close',CASES[3]):
        source.prepare()
        if reader is not None:
            reader.exercise();_verify_fresh_inputs(inventory,fresh)
            value.update(reader_identity_confirmed=True,writer_sharing_denied=True,
                private_view_changed=True,source_bytes_unchanged=True,reader_graph_retired=True,
                reader_reserved_normal=len(reader.normal.rows),
                reader_native_calls=sum(not row.terminal for row in reader.records),
                reader_terminal_calls=sum(row.terminal for row in reader.records),
                reader_closed_objects=sum(node.retired for node in (reader.view,reader.section,reader.reader)),
                private_view_bytes=VIEW_BYTES,private_view_commit_bytes=VIEW_BYTES)
        source.assert_bound()
        value.update(source_prepared=True,exact_hashes_confirmed=True,
                     source_reads_completed=all(row.completed for row in source._reads))
        source.retire_unused()
        value.update(source_guards_retired=all(row.retired for row in source._guards),
            source_handles_closed=all(row.closed for row in source._handles),source_retired=source._retired)
    else:
        try:source.prepare()
        except m.OffloadAdmissionError:pass
        else:raise SourceFixtureError('source-outcome')
        _assert_hash_denial(source,s,port)
        value.update(hash_denial_observed=True,
            original_custody_retained=getattr(s._SOURCE_CUSTODY.get(id(source)),'owner',None)is source)
    need(port.ticket is not None,'source-reservation')
    value.update(shared_rows_reserved=True,
        source_reserved_normal=len(port.ticket.native.normal.rows),
        source_reserved_terminal=len(port.ticket.native.terminal.rows),
        source_native_calls=len(source._calls),source_terminal_calls=sum(row.terminal for row in source._calls),
        source_closed_handles=sum(row.closed for row in source._handles))
    before=(len(source._calls),len(native.calls))
    try:source.prepare()
    except m.OffloadAdmissionError:pass
    else:raise SourceFixtureError('source-outcome')
    need(before==(len(source._calls),len(native.calls)),'source-outcome')
    value.update(late_reuse_refused=True,no_source_replay=True)
    engine._child_readback(native)
    need(engine._all_hashes(native)==hashes,'source-context')

"""Fixed synthetic source checks; declarations/import never execute Native IO."""
import ctypes as C
import hashlib
import json
import re
import struct
from threading import get_ident
import time

SCHEMA='windows-offload-sources-native-v1'
CASES=('deadline-control','source-read-close','source-hash-denied')
MAX_CALLS=4096
READ_BYTES=8*1024**2
_FLAGS=('timer_configured','shared_rows_reserved','source_prepared','exact_hashes_confirmed',
        'source_reads_completed','source_guards_retired','source_handles_closed',
        'source_retired','hash_denial_observed','original_custody_retained',
        'late_reuse_refused','no_source_replay','model_started','production_composed',
        'disk_credit_granted','parent_qualification_granted')
_COUNTS=('source_files','source_ancestors','source_reads','source_native_calls',
         'source_terminal_calls','source_closed_handles','source_reserved_normal',
         'source_reserved_terminal','engine_reserved_normal','engine_reserved_terminal')
_FIELDS=frozenset(('schema_version','case','source_digest','outcome','elapsed_ns',
                  'failure_stage',*_FLAGS,*_COUNTS))
_FAILURES=frozenset(('source-operation','source-case','source-report','source-context',
    'source-owner','source-reservation','source-callback','source-data','source-outcome'))


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
         and all(type(value[n])is int and 0<=value[n]<=MAX_CALLS for n in _COUNTS)
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
        if case=='source-read-close':
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
    return dict(value)


def failure_diagnostics(value):
    if type(value)is not dict:return {}
    result={n:value[n]for n in _COUNTS if type(value.get(n))is int and 0<=value[n]<=MAX_CALLS}
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
    return inventory


def exercise(engine,native,case,hashes,folder,value):
    need(case in CASES[1:]and engine._profile_for(native)is engine._SOURCE_PROFILE,'source-case')
    engine._child_readback(native)
    need(engine._all_hashes(native)==hashes,'source-context')
    modules=engine._private_core_package(hashes,engine._SOURCE_PROFILE)
    s,m=modules['windows_offload_sources'],modules['local_model_offload']
    inventory=_synthetic_inputs(engine,folder,engine._SOURCE_PROFILE,m)
    source=object.__new__(s._OriginalModelSources);native.buffers.append(source)
    port=_source_execution(engine,native,s,source,hashes)
    s._OriginalModelSources.__init__(source,inventory,_execution=port)
    if case=='source-hash-denied':
        # Change only the newly created fixed fixture before read-only admission.
        with(inventory.root/'model.safetensors').open('r+b')as stream:
            stream.seek(112);need(stream.write(b'\1')==1,'source-data')
    plan=source._plan
    value.update(source_files=plan.files,source_ancestors=plan.ancestors,source_reads=plan.reads,
        engine_reserved_normal=256,engine_reserved_terminal=16)
    if case=='source-read-close':
        source.prepare();source.assert_bound()
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

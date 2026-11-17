"""Closed fault controls for a fresh model-free owned reader, never production.

Import and pure oracles do no native work. Only the fixed standalone engine can
call collect. SuspendThread is confined to the new inert child's original thread;
it is not runtime synchronization or a public fault/cancellation command.
"""
import ctypes as C
from pathlib import Path
from threading import Thread, get_ident
import time
import types

CASES = ('stalled-response-cancellation', 'owned-child-exit-during-response')
_MAX_FAULT_CALLS = 7


class ReadSessionFixtureError(RuntimeError):
    def __init__(self, stage):
        self.stage = stage
        super().__init__('The owned Windows read-session check did not complete.')


def require(value, stage):
    if not value: raise ReadSessionFixtureError(stage)


def validate_case(value, case):
    """Strict data oracle; JSON is never native execution/retirement authority."""
    fields = {'case', 'accepted', 'child_membership_and_limits', 'suspend_previous_count',
              'original_read_intent', 'caller_failed_and_exited', 'caller_frontier_published',
              'read_result', 'read_error', 'read_success_acknowledged', 'cancel_result',
              'cancel_error', 'child_stop_acknowledged', 'controller_exit', 'reaper_exit',
              'child_exit', 'job_active', 'job_total', 'owned_handles', 'closed_handles',
              'original_rows_settled', 'terminal_rows_acknowledged', 'terminal_final_proof',
              'failed_request_preserved', 'core_retired', 'replayed_native_dispatches',
              'model_started', 'disk_credit_granted', 'parent_qualification_granted'}
    require(type(value) is dict and set(value) == fields and type(case) is str
            and case in CASES and value['case'] == case, 'case-fields')
    yes = ('accepted', 'child_membership_and_limits', 'original_read_intent',
           'caller_failed_and_exited', 'caller_frontier_published', 'original_rows_settled',
           'terminal_rows_acknowledged', 'terminal_final_proof', 'failed_request_preserved')
    no = ('read_success_acknowledged', 'core_retired', 'model_started',
          'disk_credit_granted', 'parent_qualification_granted')
    require(all(value[n] is True for n in yes) and all(value[n] is False for n in no), 'case-proof')
    for name, expected in (('suspend_previous_count', 0), ('read_result', 0), ('controller_exit', 9),
                           ('reaper_exit', 0), ('job_active', 0), ('job_total', 1),
                           ('owned_handles', 15), ('closed_handles', 15), ('replayed_native_dispatches', 0)):
        require(type(value[name]) is int and value[name] == expected, 'case-count')
    require(type(value['child_exit']) is int and value['child_exit'] == 9, 'case-child-exit')
    require(type(value['read_error']) is int, 'case-read-error')
    if case == CASES[0]:
        require(type(value['cancel_result']) is int and value['cancel_result'] != 0
                and type(value['cancel_error']) is int and 0 <= value['cancel_error'] < 2**32
                and value['read_error'] == 995 and value['child_stop_acknowledged'] is False,
                'case-cancellation')
    else:
        require(value['cancel_result'] is value['cancel_error'] is None and value['read_error'] == 109
                and value['child_stop_acknowledged'] is True, 'case-child-stop')
    return dict(value)


def _read_intent(x, owner, request):
    """Return one exact unfinished controller response read; no timing proof."""
    x._WindowsOffloadIoSession.origin(owner)
    with owner._state_lock, owner.ledger.lock:
        require(type(request) is x._Request and owner.active is request
                and type(request.seq) is int and request.seq == 1
                and request.started is True and request.returned is False and request.published is False
                and request.consumed is False and request.expired is False and owner.uncertain is False,
                'pending-request')
        request.origin(owner);found=[]
        for row in owner.ledger.normal[:owner.ledger.used]:
            require(type(row) is x._Call,'read-intent-row')
            owner.ledger.member(row)
            b=owner.ledger.bindings[row.index]
            if b is None: continue
            require(type(b) is tuple and len(b) == 10, 'read-intent-binding')
            if b[0] is not owner.api.k.ReadFile or b[5] is not request: continue
            require(type(b) is tuple and len(b) == 10 and b[4] is owner.api
                    and type(b[6]) is str and b[6] == 'operation' and type(b[9]) is int
                    and b[9] == owner.controller_ident and type(b[1]) is tuple and len(b[1]) == 5
                    and type(b[3]) is tuple and len(b[3]) == 3
                    and row.payload is b and row.function is b[0] and row.args is b[1]
                    and row.keep is b[3] and row.valid is b[2] and row.committed is True
                    and row.integrity_lost is False and type(row.returned) is bool, 'read-intent-binding')
            if row.returned: continue
            h=owner.channels['response-read'];x._known_handle(owner,h)
            require(type(row.started) is bool and row.acknowledged is False and row.completion is None
                    and owner.ledger.completions[row.index] is None and row.result is row.error is None
                    and len(b[3]) == 3 and b[3][0] is h and b[1][0] == h._number
                    and b[1][2] == 4 and b[1][-1] is None, 'read-intent-pending')
            if not row.started:
                require(row.native_thread is None,'read-intent-pending')
                continue  # Canonical committed-before-claim frontier, no IO proof.
            require(type(row.native_thread) is int and row.native_thread == owner.controller_ident,
                    'read-intent-pending')
            found.append(row)
        require(len(found) == 1, 'read-intent-count')
        return found[0]


class _FaultControl:
    """At most seven exact original-generation diagnostic actions; no retries."""
    def __init__(self, x, base, native, owner, case):
        require(type(case) is str and case in CASES and type(owner) is x._WindowsOffloadIoSession
                and type(native) is base._Native and native.profile is base._EXECUTION_PROFILE, 'fault-owner')
        x._WindowsOffloadIoSession.origin(owner);base._Native.origin(native)
        require(owner.launch_complete and owner.state == 'initialized' and owner.active is None
                and not owner.busy and not owner.uncertain and not owner.stop_requested
                and len(owner.handles) == len(owner._handle_bindings) == 13
                and len(owner.requests) == 1 and owner.requests[0].consumed
                and all(e[3] is True for e in owner._effect_exits.values()), 'fault-admission')
        self.__origin=self;self.x=x;self.base=base;self.native=native;self.owner=owner;self.case=case
        self.api=owner.api
        self._case=case
        self._identity=(x,base,native,owner,self.api,get_ident())
        self.thread=get_ident();self.handles=tuple(owner.handles)
        self.generations=tuple(x._known_handle(owner,h) for h in self.handles)
        self.close_states=tuple((h.close_started,h.closed,h.close_record) for h in self.handles)
        for h in (owner.process,owner.job,owner.primary_thread,owner.controller,
                  owner.completion_event,owner.channels['ready'],owner.channels['response-read']):
            h.value  # Other retained originals can have genuine close proof.
        require(owner.primary_thread._number == owner.process_info.thread
                and owner.process._number == owner.process_info.process, 'fault-process-generation')
        self.library=native.k;fn=self.library.SuspendThread;fn.argtypes=[x._PTR];fn.restype=x._U32
        self.functions=tuple((n,getattr(self.library,n)) for n in
            ('IsProcessInJob','QueryInformationJobObject','WaitForSingleObject','GetProcessId',
             'SuspendThread','SetEvent','TerminateJobObject'))
        self._functions=self.functions
        self.inside=x._I32();self.limits=x._ExtendedLimits()
        self.outputs=(self.inside,self.limits);self._outputs=self.outputs
        self.rows=[];self.bindings=[];self.completions=[];self.used=[]
        self._rows=();self._issued=();self._completed=()
        self.request=self.read_row=self.binding=None;self._read_proof=None
        self.caller=None;self.caller_result={};self.suspended=False
        native.buffers.extend((self,self.inside,self.limits))

    def origin(self):
        require(type(self) is _FaultControl and getattr(self,'_FaultControl__origin',None) is self
                and type(self._identity) is tuple and len(self._identity) == 6
                and type(self.x) is types.ModuleType and self.x is self._identity[0]
                and type(self.base) is types.ModuleType and self.base is self._identity[1]
                and self.native is self._identity[2] and type(self.native) is self.base._Native
                and self.owner is self._identity[3] and type(self.owner) is self.x._WindowsOffloadIoSession
                and self.api is self._identity[4] and type(self.api) is self.x._Native
                and type(self.thread) is type(self._identity[5]) is int
                and self.thread == self._identity[5] == get_ident()
                and type(self.functions) is tuple and len(self.functions) == 7 and self.functions is self._functions
                and type(self.case) is type(self._case) is str and self.case == self._case and self.case in CASES
                and type(self.outputs) is tuple and len(self.outputs) == 2
                and self.outputs is self._outputs and self.inside is self.outputs[0]
                and self.limits is self.outputs[1], 'fault-origin')
        self.x._WindowsOffloadIoSession.origin(self.owner)
        self.base._Native.origin(self.native);self.native.live()
        require(self.library is self.native.k and self.owner.api is self.api, 'fault-api')
        self.x._Native.origin(self.api)
        require(type(self.handles) is tuple and type(self.generations) is tuple
                and type(self.close_states) is tuple
                and len(self.handles) == len(self.generations) == len(self.close_states) == 13
                and type(self.owner.handles) is list and len(self.owner.handles) == 13
                and all(a is b for a,b in zip(self.owner.handles,self.handles)) and self.owner.terminal is None,
                'fault-handle-set')
        for h,g,state in zip(self.handles,self.generations,self.close_states):
            require(type(state) is tuple and len(state) == 3 and type(state[0]) is type(state[1]) is bool
                    and self.x._known_handle(self.owner,h) is g and h.close_started is state[0]
                    and h.closed is state[1] and h.close_record is state[2],
                    'fault-generation')
        for entry in self.functions:
            require(type(entry) is tuple and len(entry) == 2 and type(entry[0]) is str,'fault-function')
            name,fn=entry;require(getattr(self.library,name) is fn,'fault-function')
        require(type(self.rows) is type(self.bindings) is type(self.completions) is type(self.used) is list
                and type(self._rows) is type(self._issued) is type(self._completed) is tuple
                and len(self.rows) == len(self.bindings) == len(self.completions) == len(self.used)
                == len(self._rows) == len(self._issued) == len(self._completed)
                and len(self.rows) <= _MAX_FAULT_CALLS, 'fault-ledger')
        for i,(row,b,completion,label) in enumerate(zip(self.rows,self.bindings,self.completions,self.used)):
            require(type(row) is dict and row is self._rows[i] and len(row) == 12
                    and all(type(k) is str for k in row)
                    and set(row) == {'binding','completion','label','function','args','keep','generations',
                                    'started','returned','result','error','acknowledged'}
                    and type(b) is tuple and len(b) == 6 and b is self._issued[i]
                    and type(b[0]) is type(label) is type(row['label']) is str
                    and type(b[2]) is tuple and type(b[3]) is tuple
                    and b[4] is self.generations and type(b[5]) is int
                    and row['binding'] is b and b[0] == label
                    and row['label'] == label and row['function'] is b[1] and row['args'] is b[2]
                    and row['keep'] is b[3] and row['generations'] is b[4] and b[5] == self.thread,
                    'fault-intent-binding')
            require(type(row['started']) is type(row['returned']) is type(row['acknowledged']) is bool
                    and completion is self._completed[i], 'fault-state-binding')
            if completion is not None:
                require(type(completion) is tuple and len(completion) == 3
                        and row['completion'] is completion and completion[0] is b
                        and type(completion[1]) is type(completion[2]) is int
                        and -2**31 <= completion[1] < 2**32 and 0 <= completion[2] < 2**32
                        and type(row['result']) is int and row['result'] == completion[1]
                        and type(row['error']) is int and row['error'] == completion[2]
                        and row['started'] is True and row['returned'] is True,
                        'fault-completion-binding')
            else:
                require(row['completion'] is None and row['returned'] is False
                        and row['result'] is row['error'] is None and row['acknowledged'] is False,
                        'fault-completion-missing')

    def capture_read(self, request, row):
        self.origin()
        require(self._read_proof is None and self.request is self.read_row is self.binding is None
                and self.suspended and self.used == ['membership','limits','ready','process-id','suspend'],
                'read-capture-once')
        require(_read_intent(self.x,self.owner,request) is row,'read-capture-original')
        binding=self.owner.ledger.bindings[row.index]
        self._read_proof=(request,row,binding)
        self.request,self.read_row,self.binding=self._read_proof

    def issue(self, label):
        self.origin();o=self.owner;x=self.x
        order=('membership','limits','ready','process-id','suspend','wake-caller')
        if self.case == CASES[1]: order += ('stop-child',)
        require(all(r['acknowledged'] for r in self.rows) and type(label) is str and len(self.used) < len(order)
                and label == order[len(self.used)] and len(self.rows) < _MAX_FAULT_CALLS,
                'fault-order')
        functions=dict(self.functions)
        if label == 'membership':
            fn=functions['IsProcessInJob'];args=(o.process.value,o.job.value,C.byref(self.inside));keep=(o.process,o.job,self.inside)
        elif label == 'limits':
            fn=functions['QueryInformationJobObject'];args=(o.job.value,9,C.byref(self.limits),C.sizeof(self.limits),None);keep=(o.job,self.limits)
        elif label == 'ready':fn=functions['WaitForSingleObject'];args=(o.channels['ready'].value,0);keep=(o.channels['ready'],)
        elif label == 'process-id':fn=functions['GetProcessId'];args=(o.process.value,);keep=(o.process,)
        elif label == 'suspend':
            require(self.inside.value == 1 and self.limits.basic.flags == 0x2308
                    and self.limits.basic.active_process_limit == 1
                    and self.limits.process_memory_limit == self.limits.job_memory_limit == x._MEMORY_BYTES,
                    'fault-child-limits')
            fn=functions['SuspendThread'];args=(o.primary_thread.value,);keep=(o.primary_thread,)
        else:
            require(self.request is not None and self.read_row is not None and self.binding is not None
                    and type(self._read_proof) is tuple and len(self._read_proof) == 3
                    and self.request is self._read_proof[0] and self.read_row is self._read_proof[1]
                    and self.binding is self._read_proof[2]
                    and self.read_row.payload is self.binding and o.active is self.request
                    and o.uncertain and o.stop_requested and self.request.expired
                    and not self.request.consumed and self.suspended, 'fault-fenced-read')
            if label == 'wake-caller':fn=functions['SetEvent'];args=(o.completion_event.value,);keep=(o.completion_event,)
            else:
                require(self.caller is not None and not self.caller.is_alive()
                        and self.caller_result == {'failed':True}
                        and o._effect_exits[id(self.request)][3] is True, 'fault-caller-exit')
                fn=functions['TerminateJobObject'];args=(o.job.value,9);keep=(o.job,)
        # Retain exact role, function, arguments, original generations and output
        # objects before foreign execution. A failed/interrupted issue is spent.
        binding=(label,fn,args,keep,self.generations,self.thread)
        row={'binding':binding,'completion':None,'label':label,'function':fn,'args':args,'keep':keep,'generations':self.generations,
             'started':False,'returned':False,'result':None,'error':None,'acknowledged':False}
        self.rows.append(row);self.bindings.append(binding);self.completions.append(None);self.used.append(label)
        self._rows+=(row,);self._issued+=(binding,);self._completed+=(None,)
        self.origin();row['started']=True
        result=fn(*args);error=C.get_last_error()
        row.update(returned=True,result=result,error=error)
        completion=(binding,result,error);self.completions[-1]=completion;row['completion']=completion
        self._completed=(*self._completed[:-1],completion)
        self.origin()
        require(type(result) is int and type(error) is int and 0 <= error < 2**32, 'fault-return')
        if label in ('ready','suspend'):require(result == 0,'fault-zero-result')
        elif label == 'process-id':require(result == o.process_info.pid,'fault-process-id')
        else:require(result != 0,'fault-boolean-result')
        if label == 'membership':require(self.inside.value == 1,'fault-membership')
        if label == 'suspend':self.suspended=True
        row['acknowledged']=True
        return result


def _wait_for_read(control):
    o=control.owner;x=control.x
    while True:
        control.native.live()
        with o._state_lock:
            request=o.active
            require(not o.uncertain and not o.stop_requested and control.caller.is_alive(), 'caller-lost')
            if request is not None and request.seq == 1 and request.started:
                try:row=_read_intent(x,o,request)
                except ReadSessionFixtureError as error:
                    if error.stage != 'read-intent-count':raise
                else:return request,row
        time.sleep(.005)


def _observe(control):
    x=control.x;o=control.owner;request=control.request;row=control.read_row
    require(o.retire_failed() is None,'retirement-return')
    t=o.terminal
    require(type(t) is x._TerminalRetirement and t.owner is o and t.has_final_proof()
            and t.body_done and not t.failed and o.session_retired and o.terminal_retired
            and o.state == 'failed-retired' and o.active is None and not o.busy
            and not o.uncertain and o.stop_requested and not x._OWNERS, 'retirement-proof')
    completion=o.ledger.settled(row,o.api)
    require(completion[0] is control.binding and row is control.read_row,'original-read-completion')
    for old in t.original_rows:o.ledger._assert_completed_physical(old,o.api)
    for old in t.calls:o.ledger.settled(old,o.api);require(old.acknowledged,'terminal-row')
    require(all(h.closed and h.close_started for h in o.handles),'all-handles-closed')
    cancel=t.used.get('cancel-io')
    if cancel is None:cancel_result=cancel_error=None
    else:_,cancel_result,cancel_error,_=o.ledger.settled(cancel,o.api)
    def scalars(label):
        r=t.used[label];v=o.ledger.settled(r,o.api)
        require(r.acknowledged and v[0][5] is t,'terminal-output-binding')
        raw=o.ledger._retained_return(r,o.api).outputs
        if label=='job-empty':
            output=x._Accounting.from_buffer_copy(raw[0]);return output.active,output.total
        require(type(raw)is tuple and len(raw)==1 and type(raw[0])is int,'terminal-output-facts')
        return raw[0]
    before=(o.ledger.used,o.ledger.terminal_used,len(o.handles))
    require(o.retire_failed() is None and before == (o.ledger.used,o.ledger.terminal_used,len(o.handles)),
            'retirement-replay')
    value={'case':control.case,'accepted':True,'child_membership_and_limits':True,
           'suspend_previous_count':control.rows[4]['result'],'original_read_intent':True,
           'caller_failed_and_exited':control.caller_result == {'failed':True} and not control.caller.is_alive(),
           'caller_frontier_published':o._effect_exits[id(request)][3] is True,
           'read_result':completion[1],'read_error':completion[2],'read_success_acknowledged':row.acknowledged,
           'cancel_result':cancel_result,'cancel_error':cancel_error,
           'child_stop_acknowledged':control.case == CASES[1] and control.rows[-1]['acknowledged'],
           'controller_exit':scalars('controller-code'),'reaper_exit':scalars('reaper-code'),
           'child_exit':scalars('process-code'),'job_active':scalars('job-empty')[0],
           'job_total':scalars('job-empty')[1],'owned_handles':len(o.handles),
           'closed_handles':sum(h.closed for h in o.handles),'original_rows_settled':True,
           'terminal_rows_acknowledged':True,'terminal_final_proof':True,
           'failed_request_preserved':request.expired and not request.consumed and not request.published,
           'core_retired':o.core_retired,'replayed_native_dispatches':0,'model_started':False,
           'disk_credit_granted':False,'parent_qualification_granted':False}
    return validate_case(value,control.case)


def failure_diagnostics(control):
    """Bounded observations only; partial fields never constitute a proof."""
    require(type(control) is _FaultControl and getattr(control,'_FaultControl__origin',None) is control,
            'diagnostic-owner')
    x=control.x
    def call(row):
        if type(row) is not x._Call:return None
        result={n:getattr(row,n) if type(getattr(row,n)) is bool else None
                for n in ('started','returned','acknowledged')}
        for n in ('result','error'):
            v=getattr(row,n);result[n]=v if type(v) is int and -2**31 <= v < 2**32 else None
        return result
    value={'original_read':call(control.read_row),'cancel':None,'terminal_final_proof':False,
           'controller_exit':None,'reaper_exit':None,'child_exit':None,'job_active':None,'job_total':None}
    t=control.owner.terminal
    if type(t) is x._TerminalRetirement and getattr(t,'owner',None) is control.owner:
        value['terminal_final_proof']=x._TerminalRetirement.has_final_proof(t)
        used=getattr(t,'used',None)
        if type(used) is dict:value['cancel']=call(used.get('cancel-io'))
        outputs=getattr(t,'query_outputs',None)
        if type(outputs) is tuple and len(outputs) == 4 and outputs is getattr(t,'_canonical_outputs',None):
            for name,output in zip(('controller_exit','child_exit','reaper_exit'),outputs[:3]):
                if type(output) is x._U32:value[name]=output.value
            if type(outputs[3]) is x._Accounting:
                value['job_active']=outputs[3].active;value['job_total']=outputs[3].total
    return value


def _retire_failed_startup(x,owner,native):
    """Consume only a known failed startup; no replay or qualification pass."""
    require(type(owner)is x._WindowsOffloadIoSession and not owner.launch_complete
            and owner.uncertain and owner.stop_requested and not owner.session_retired,
            'startup-failure-state')
    native.live()  # The qualifier's original outer containment must remain live.
    require(owner.retire_failed()is None,'startup-retirement-return')
    terminal=owner.terminal
    require(type(terminal)is x._TerminalRetirement and terminal.owner is owner
            and terminal.has_final_proof()and terminal.body_done and not terminal.failed
            and owner.session_retired and owner.terminal_retired and all(h.closed for h in owner.handles),
            'startup-retirement-proof')
    return {'attempted':True,'retired':True,'owned_handles':len(owner.handles),
            'closed_handles':sum(h.closed for h in owner.handles),'parent_qualification_granted':False}


def collect(native, base, hashes, folder, rows):
    """Fixed engine only. Own all test graphs through self-exit, including errors."""
    require(type(native) is base._Native and native.profile is base._EXECUTION_PROFILE
            and base.__name__ == '_standalone_windows_read_session_engine'
            and type(rows) is list and not rows, 'standalone-engine')
    profile=base._EXECUTION_PROFILE
    modules=base._private_core_package(hashes,profile);x=modules['windows_offload_execution']
    retained=[];native.buffers.extend((modules,retained,rows))
    for case in CASES:
        native.live();cache=folder/case;base._fresh_directory(cache,profile)
        o=x._WindowsOffloadIoSession(str(cache));retained.append(o)
        phase='prepare';control=None
        row={'case':case,'accepted':False,'failure_stage':phase};rows.append(row)
        try:
            require(o.prepare() is None,'prepare')
            require(o.source_hashes == {Path(n).name:hashes[n] for n in profile.task_files}, 'runtime-source-binding')
            control=_FaultControl(x,base,native,o,case)
            for label in ('membership','limits','ready','process-id','suspend'):control.issue(label)
            def bind():
                try:o.bind_read()
                except x.OffloadAdmissionError:control.caller_result['failed']=True
                except BaseException:control.caller_result['unexpected']=True
                else:control.caller_result['succeeded']=True
            # Closure is not reused until actual thread exit. Unknown ownership
            # stays held in native.buffers until the fixed timer/self-exit.
            control.caller=Thread(target=bind,daemon=False);native.buffers.append((control,control.caller,bind))
            phase='pending-response';control.caller.start()
            request,read_row=_wait_for_read(control);control.capture_read(request,read_row)
            phase='fenced-caller';o._fence();control.issue('wake-caller')
            while control.caller.is_alive():native.live();control.caller.join(.01)
            require(control.caller_result == {'failed':True}
                    and o._effect_exits[id(control.request)][3] is True,'caller-exit')
            if case == CASES[1]:
                phase='owned-child-stop';control.issue('stop-child')
                # Require the real original read completion before retirement;
                # never call this broken-pipe result a cancellation success.
                while not control.read_row.returned:native.live();time.sleep(.005)
                o.ledger.settled(control.read_row,o.api)
            phase='terminal-retirement';value=_observe(control)
            require(list(cache.iterdir()) == [],'fresh-cache-unchanged')
            row.clear();row.update(value)
        except BaseException as error:
            row['failure_stage']=error.stage if type(error) is ReadSessionFixtureError else phase
            if phase=='prepare'and control is None and not o.launch_complete:
                try:row['startup_retirement']=_retire_failed_startup(x,o,native)
                except BaseException:
                    row['startup_retirement']={'attempted':True,'retired':False,
                                               'parent_qualification_granted':False}
            if control is not None:
                row['fault_diagnostics']=[{'label':r['label'],'started':r['started'],'returned':r['returned'],
                    'acknowledged':r['acknowledged'],'result':r['result'],'error':r['error']} for r in control.rows]
                row['retirement_diagnostics']=failure_diagnostics(control)
            # Do not resume, close, release, retry, advance or free uncertain
            # original graphs. The standalone engine owns final self-exit.
            return False
    return True

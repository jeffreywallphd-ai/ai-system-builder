"""Fixed owned Source child. No ordinary CLI, model, borrower or staging role."""
import ctypes as C
from pathlib import Path
import struct
from threading import get_ident

from . import windows_offload_source_session as x
from . import windows_offload_sources as sources
from . import local_model_offload as model
from . import windows_offload_native_session as native

_BOOTSTRAP = None
_CHILD = None


class _Allocation:
    def __init__(self, arena, source, plan):
        self.origin, self.arena, self.source, self.plan = self, arena, source, plan
        self.normal = self.terminal = self.original = None

    def assert_original(self, arena, source, plan):
        x._need(type(self) is _Allocation and self.origin is self
                and type(self.original) is tuple and len(self.original) == 5
                and all(a is b for a, b in zip(
                    (arena, source, plan, self.normal, self.terminal), self.original))
                and self.arena is arena and self.source is source and self.plan is plan)
        arena.assert_reserved(self.normal)
        arena.assert_reserved(self.terminal)

    def __copy__(self):raise model.OffloadAdmissionError()
    def __deepcopy__(self, memo):raise model.OffloadAdmissionError()
    def __reduce_ex__(self, protocol):raise model.OffloadAdmissionError()


class _SourceExecution(sources._SourceExecutionPort):
    """Concrete original Source producer in the one actual owned child actor."""
    def __init__(self, child, source):
        x._need(type(self) is _SourceExecution and type(child) is _OriginalSourceChild
                and _CHILD is child and child.source is source
                and type(source) is sources._OriginalModelSources
                and type(child.api) is x._SourceNative
                and child.api.role is x._CHILD_ROLE)
        child._live()
        self.origin, self.child, self.source = self, child, source
        self.api, self.arena = child.api, child.api.rows
        self.thread = get_ident()
        self.busy = self.failed = self.check_used = False
        self.kind = self.plan = self.ticket = None
        self.bootstraps = []
        self.original = (child, source, self.api, self.arena, self.thread, self.bootstraps)
        child.buffers.append(self)

    def assert_bound(self, owner):
        x._need(type(self) is _SourceExecution and self.origin is self
                and type(self.original) is tuple and len(self.original) == 6
                and all(a is b for a, b in zip(
                    (self.child, self.source, self.api, self.arena, self.thread, self.bootstraps), self.original))
                and _CHILD is self.child and self.child.source is owner is self.source
                and self.child.source_port is self and self.child.api is self.api
                and type(owner) is sources._OriginalModelSources and owner._origin is owner
                and owner._execution is self and owner._factory is sources._WindowsSourceApi
                and self.api.rows is self.arena and not self.failed and get_ident() == self.thread)
        self.child._live()
        self.api.live()

    def reserve_initial(self, owner, plan):
        self.assert_bound(owner)
        x._need(self.busy and self.kind == 'prepare' and self.ticket is None
                and type(plan) is sources._SourceGraphPlan and owner._plan is plan)
        allocation = _Allocation(self.arena, owner, plan)
        self.child.buffers.append(allocation)
        # Engine1024 normal and16 terminal already debit these same rows.
        allocation.normal = self.arena.reserve('source-normal', plan.prepare_calls + plan.live_check_calls, 0)
        allocation.terminal = self.arena.reserve('source-close', 0, plan.unused_close_calls)
        allocation.original = (self.arena, owner, plan, allocation.normal, allocation.terminal)
        x._need(plan.buffer_bytes + 104 * 1024**2 <= 512 * 1024**2)
        self.plan = plan
        self.ticket = sources._SourceReservation(self, owner, plan, allocation)
        return self.ticket

    def assert_reserved(self, owner, reservation, plan):
        self.assert_bound(owner)
        x._need(reservation is self.ticket and plan is self.plan)
        reservation.assert_original(self, owner, plan)
        reservation.native.assert_original(self.arena, owner, plan)

    def reserve_check(self, owner, reservation, calls):
        self.assert_reserved(owner, reservation, self.plan)
        x._need(self.busy and self.kind == 'check' and not self.check_used
                and type(calls) is int and calls == self.plan.live_check_calls)
        remaining = sum(row.binding is None for row in reservation.native.normal.rows)
        x._need(remaining >= calls)
        self.check_used = True

    def execute(self, owner, kind, invoke):
        self.assert_bound(owner)
        expected = {0: 'prepare', 1: 'check', 2: 'retire-unused'}
        x._need(not self.busy and self.child.current is not None
                and expected.get(self.child.current['seq']) == kind and callable(invoke))
        self.busy, self.kind = True, kind
        try:
            result = invoke()
            self.assert_bound(owner)
            self.busy, self.kind = False, None
            return result
        except BaseException:
            self.failed = True
            raise

    def invoke_native(self, owner, reservation, record, invoke):
        self.assert_reserved(owner, reservation, self.plan)
        x._need(self.busy and type(record) is sources._SourceNativeCall
                and owner._pending is record and callable(invoke) and get_ident() == self.thread)
        record.assert_original(owner)
        terminal = record.terminal
        x._need(type(terminal) is bool and terminal is (self.kind == 'retire-unused'))
        variant, library = 'scalar', None
        if record.function is C.WinDLL:
            x._need(self.kind == 'prepare' and len(self.bootstraps) < 2
                    and record.args == (('kernel32.dll',) if not self.bootstraps else ('ntdll.dll',)))
            variant, library = 'system-library', record.args[0]
        else:
            x._need(len(self.bootstraps) == 2 and type(owner._api) is sources._WindowsSourceApi)
            owner._api._assert_original()
            x._need(any(row[2] is record.function for row in owner._api._functions))
        allocation = reservation.native
        arena = self.arena
        row = arena.begin(allocation.terminal if terminal else allocation.normal,
                           'source-native', record.function, record.args, (owner, record, invoke, self),
                           terminal=terminal, variant=variant, library=library, source_record=record)
        try:
            value = invoke()
            record.assert_original(owner)
            x._need(record.started and record.returned and record.thread == self.thread
                    and value is record.value)
            arena.returned(row, value, record.error)
            arena.acknowledge(row)
            if variant == 'system-library':
                self.bootstraps.append(value)
            return value
        except BaseException:
            if record.returned and row.completion is None:
                try:arena.returned(row, record.value, record.error)
                except BaseException:pass
            arena.fenced = self.api.uncertain = True
            raise


class _OriginalSourceChild(x._SourceFrameIo):
    def __init__(self, entry):
        x._need(type(self) is _OriginalSourceChild and _CHILD is self
                and not hasattr(self, '_OriginalSourceChild__origin')
                and type(entry) is x._OriginalSourceEntry and x._ENTRY_CONTEXT is entry)
        entry.assert_original()
        x._need(entry.role is x._CHILD_ROLE)
        self.__origin, self.entry = self, entry
        self.nonce, self.deadline, self.thread = entry.nonce, entry.deadline, get_ident()
        self.api = self.current = self.source = self.source_port = self.inventory = None
        self.buffers, self.calls, self.handles, self.requests = [], [], [], []
        self.handle_bindings, self.channels = {}, {}
        self.state = 'new'
        self.failed = self.finishing = self.source_retired = False
        self.bootstrapping = True
        self.job_bound = self.dispatched = False
        self.original = (entry, self.nonce, self.deadline, self.thread, self.buffers,
                         self.calls, self.handles, self.requests, self.handle_bindings, self.channels)
        x._SourceNative(self)
        api = self.api
        for name, number in zip(('request', 'response', 'ready', 'dispatch'), entry.handles):
            handle = x._SourceHandle(self, name)
            self.handles.append(handle)
            handle.slot.value = number
            handle.acknowledge()
            self.channels[name] = handle
            flags = C.c_uint32()
            self.buffers.append(flags)
            api.call(api.k.GetHandleInformation, handle.value, C.byref(flags), keep=(handle, flags))
            x._need(flags.value & 1 == 1)
            if name in ('request', 'response'):
                x._need(api.call(api.k.GetFileType, handle.value, keep=(handle,)) == 3)
        inside, limits = C.c_int32(), native._ExtendedLimits()
        self.buffers.extend((inside, limits))
        api.call(api.k.IsProcessInJob, api.process, None, C.byref(inside), keep=(inside,))
        api.call(api.k.QueryInformationJobObject, None, 9, C.byref(limits), C.sizeof(limits), None, keep=(limits,))
        x._need(inside.value == 1 and limits.basic.flags == 0x2308
                and limits.basic.active_process_limit == 1
                and limits.process_memory_limit == limits.job_memory_limit == 512 * 1024**2)
        self.job_bound = True
        api.call(api.k.SetEvent, self.channels['ready'].value, keep=(self.channels['ready'],))
        x._need(api.wait((self.channels['dispatch'],), self.deadline) == 0)
        self.dispatched = True
        self.bootstrapping = False
        self._live()

    def origin(self):
        x._need(type(self) is _OriginalSourceChild and self.__origin is self and _CHILD is self
                and self.entry is x._ENTRY_CONTEXT and type(self.original) is tuple and len(self.original) == 10
                and all(a is b for a, b in zip(
                    (self.entry, self.nonce, self.deadline, self.thread, self.buffers,
                     self.calls, self.handles, self.requests, self.handle_bindings, self.channels), self.original)))
        self.entry.assert_original()

    def _live(self):
        self.origin()
        x._need(get_ident() == self.thread and not self.failed
                and 0 < self.deadline - x.time.monotonic_ns() <= x.io._BUDGET_NS)
        if not self.bootstrapping:
            x._need(self.job_bound and self.dispatched)

    def _native_live(self, initializing):
        self._live()
        if not initializing:
            phase = self.api.timer.phase
            x._need(phase == 'pending' or self.finishing and phase in ('completion-won', 'retired'))

    _assert_runtime_image = x._OriginalSourceParent._assert_runtime_image

    def _prepare_source(self, root):
        x._need(self.source is self.source_port is self.inventory is None
                and root == str(self.entry.run_root / 'inputs'))
        # The original inspector result is created here, never deserialized.
        self.inventory = model.inspect_local_model(Path(root))
        self.source = object.__new__(sources._OriginalModelSources)
        self.buffers.append(self.source)
        self.source_port = _SourceExecution(self, self.source)
        sources._OriginalModelSources.__init__(self.source, self.inventory, _execution=self.source_port)
        x._need(self.source.prepare() is None)

    def execute(self, message):
        self._live()
        x._need(self.current is None)
        x._message(message, self.nonce, self.entry.digest, self.deadline)
        sequence = message['seq']
        next_state = x._edge(self.state, sequence)
        x._need(sequence == len(self.requests))
        self.requests.append(message)
        self.current = message
        try:
            if sequence == 0:
                self._prepare_source(message['body']['model_root'])
            elif sequence == 1:
                x._need(self.source.assert_bound() is None)
            elif sequence == 2:
                x._need(self.source.retire_unused() is None
                        and self.source._retired and not self.source._uncertain
                        and id(self.source) not in sources._SOURCE_CUSTODY
                        and all(handle.closed for handle in self.source._handles)
                        and all(guard.retired for guard in self.source._guards))
                self.source_retired = True
            else:
                x._need(self.source_retired and self.source._retired and not self.source._uncertain
                        and self.source._pending is None)
            self._live()
            self.state = next_state
            return {**message, 'body': {'state': next_state}}
        except BaseException:
            self.failed = True
            raise

    def run(self):
        for sequence in range(4):
            size = struct.unpack('<I', self._read_bytes(self.channels['request'], 4))[0]
            x._need(0 < size <= x._FRAME_BYTES)
            message = x._decode(self._read_bytes(self.channels['request'], size))
            x._need(message.get('seq') == sequence)
            reply = self.execute(message)
            self._write_bytes(self.channels['response'], x._frame(reply))
            if sequence == 3:
                self.finishing = True
                for handle in self.channels.values():
                    self.api.close(handle)
                    handle.assert_closed(self.api)
                self.api.timer.retire()
                for handle in self.handles:
                    handle.assert_closed(self.api)
                self.api.escape_exit(0)
                x._need(False)
            self.current = None


def _entry():
    global _CHILD
    x._private_environment()
    x._need(__name__ == x._PRIVATE_PACKAGE + '.windows_offload_source_session_child'
            and _CHILD is None and x._ENTRY_CONTEXT is None)
    entry = x._OriginalSourceEntry(x._CHILD_ROLE, _BOOTSTRAP)
    x._ENTRY_CONTEXT = entry
    _CHILD = object.__new__(_OriginalSourceChild)
    try:
        _OriginalSourceChild.__init__(_CHILD, entry)
        _CHILD.run()
    except BaseException:
        api = getattr(_CHILD, 'api', None)
        if type(api) is x._SourceNative and hasattr(api, 'k'):
            try:api.escape_exit(9)
            except BaseException:x._terminal_halt_without_calls()
        raise SystemExit(9)

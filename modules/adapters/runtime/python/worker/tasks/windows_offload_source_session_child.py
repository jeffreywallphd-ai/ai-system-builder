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


_SHARING_STATES = {}
_SHARING_INPUTS = {}


class _SharingProbe:
    """Four precharged, negative-only calls in the original child arena.

    The read-only probe is intentionally retained until the original child exits.
    No CloseHandle, source-retirement or disk-accounting credit is produced here.
    """
    def __init__(self, port, owner):
        x._need(type(port) is _SourceExecution and port.source is owner
                and port.child.entry.case == x._SHARING_DENIAL_CASE
                and id(port) not in _SHARING_STATES)
        self.origin, self.port, self.owner = self, port, owner
        self.arena, self.thread = port.arena, get_ident()
        self.ticket = self.arena.reserve('source-sharing-probe', 4, 0)
        self.record = self.snapshot = None
        self.slot = C.c_void_p()
        self.buffers, self.calls = [], []
        self.complete = False
        entries = ()
        def retain(item, row):
            nonlocal entries
            x._need(len(entries) < 4)
            entries += ((item, row),)
        def original_entries():return entries
        self.custody = (retain, original_entries)
        self.original = (port, owner, self.arena, self.thread, self.ticket,
                         self.slot, self.buffers, self.calls, self.custody)
        _SHARING_STATES[id(port)] = (port, self, self.original)
        port.child.buffers.append(self)

    def live(self):
        port, owner = self.port, self.owner
        saved = _SHARING_STATES.get(id(port))
        x._need(type(self) is _SharingProbe and self.origin is self
                and type(saved) is tuple and len(saved) == 3
                and saved[0] is port and saved[1] is self and saved[2] is self.original
                and type(self.original) is tuple and len(self.original) == 9
                and all(a is b for a, b in zip(
                    (port, owner, self.arena, self.thread, self.ticket,
                     self.slot, self.buffers, self.calls, self.custody), self.original))
                and len(self.calls) == len(self.custody[1]())
                and all(a is b[0] for a, b in zip(self.calls, self.custody[1]()))
                and get_ident() == self.thread and port.child.entry.case == x._SHARING_DENIAL_CASE)
        saved_input = _SHARING_INPUTS.get(id(self))
        if saved_input is None:
            x._need(self.record is None and self.snapshot is None)
        else:
            x._need(type(saved_input) is tuple and len(saved_input) == 3
                    and saved_input[0] is self and saved_input[1] is self.record
                    and saved_input[2] is self.snapshot)
        port.assert_bound(owner)
        self.arena.assert_reserved(self.ticket)

    def bind(self, record):
        self.live()
        owner, port = self.owner, self.port
        record.assert_original(owner)
        args, keep = record.args, record.keep
        x._need(self.record is None and not self.calls and not self.complete
                and type(args) is tuple and len(args) == 11 and type(keep) is tuple and len(keep) == 6
                and record.function is owner._api.n.NtCreateFile and record.terminal is False
                and not record.started and owner._pending is record and self.arena.owner.pending is None)
        handle, text, string, attrs, status, parent = keep
        x._need(type(handle) is sources._SourceHandle and handle is owner._acquiring
                and type(text) is C.c_wchar * len('model.safetensors\0')
                and text.value == 'model.safetensors' and type(string) is x.core._Unicode
                and type(attrs) is x.core._Attributes and type(status) is x.core._Io
                and type(parent) is sources._SourceHandle)
        parent.assert_original(owner)
        handle.assert_original(owner)
        for argument, buffer in ((args[0], handle.original_slot), (args[2], attrs), (args[3], status)):
            sources._source_output_pointer(argument, buffer)
        x._need(record.output is handle.original_slot and handle.original_slot.value is None
                and args[1:] == (0x100081, args[2], args[3], None, 0x80, 1, 1, 0x200040, None, 0)
                and (string.length, string.maximum, string.buffer) ==
                    (len('model.safetensors'.encode('utf-16-le')), C.sizeof(text), C.addressof(text))
                and attrs.length == C.sizeof(attrs) and attrs.root == parent.installed
                and C.cast(attrs.name, C.c_void_p).value == C.addressof(string)
                and attrs.flags == 0x40 and attrs.security is attrs.quality is None)
        parent_call = parent.acquire_call
        parent_call.assert_original(owner)
        physical, typed, known, _ = sources._source_call_custody(owner).original_call_return(parent_call)
        x._need(parent_call.acknowledged and known and type(physical) is tuple
                and physical[0] == 0 and physical[1] == parent.installed
                and type(typed) is tuple and len(typed) == 2
                and type(typed[0]) is x.core._Io)
        parent_io = x.core._Io.from_buffer_copy(typed[1])
        x._need(parent_io.status in (None, 0) and parent_io.information == 1)
        frozen = (record.binding, owner._op, record.function, args, keep,
                  parent, parent.original_generation, parent_call, physical, typed)
        buffers = (text, string, attrs, status, handle.original_slot)
        content = tuple(C.string_at(C.addressof(value), C.sizeof(value)) for value in buffers)
        function_rows = owner._api._origin[3]

        def revalidate(*, dispatch=False):
            self.live()
            record.assert_original(owner)
            x._need(record.binding is frozen[0] and owner._op is frozen[1]
                    and owner._op.started is True and owner._op.finished is False
                    and owner._op.thread == get_ident() == self.thread
                    and record.function is frozen[2] and record.args is frozen[3] and record.keep is frozen[4]
                    and owner._pending is record and type(dispatch) is bool and record.started is dispatch
                    and (not dispatch or self.complete and record.thread == self.thread and not record.returned)
                    and parent.original_generation is frozen[6] and parent.acquire_call is frozen[7]
                    and sources._source_call_custody(owner).original_call_return(parent_call)[:2] == frozen[8:]
                    and owner._api._origin[3] is function_rows)
            parent.assert_original(owner)
            handle.assert_original(owner)
            for argument, buffer in ((args[0], handle.original_slot), (args[2], attrs), (args[3], status)):
                sources._source_output_pointer(argument, buffer)
            x._need(all(C.string_at(C.addressof(value), C.sizeof(value)) == saved
                        for value, saved in zip(buffers, content)))
            owner._api._assert_original()
        self.record, self.snapshot = record, (frozen, buffers, content, revalidate)
        _SHARING_INPUTS[id(self)] = (self, record, self.snapshot)
        revalidate()
        return parent.installed

    def call(self, function, args, buffer, *, indirect=False, inputs=()):
        self.live()
        checker = _SHARING_INPUTS[id(self)][2][3]
        checker()
        stage = len(self.calls)
        slot, thread = self.original[5], self.original[3]
        x._need(type(args) is tuple and stage < 4 and self.arena.owner.pending is None
                and type(indirect) is bool and indirect is (stage == 0))
        if stage == 0:
            x._need(function is self.owner._api.n.NtCreateFile and len(args) == 11
                    and type(buffer) is x.core._Io and len(inputs) == 3
                    and type(inputs[0]) is C.c_wchar * len('model.safetensors\0')
                    and type(inputs[1]) is x.core._Unicode and type(inputs[2]) is x.core._Attributes
                    and args[1:] == (0x100081,args[2],args[3],None,0x80,3,1,0x200040,None,0)
                    and all(type(args[i]) is int for i in (1,5,6,7,8,10))
                    and inputs[0].value == 'model.safetensors'
                    and inputs[1].buffer == C.addressof(inputs[0])
                    and inputs[1].length == len('model.safetensors'.encode('utf-16-le'))
                    and inputs[1].maximum == C.sizeof(inputs[0])
                    and inputs[2].root == self.snapshot[0][5].installed
                    and inputs[2].length == C.sizeof(inputs[2]) and inputs[2].flags == 0x40
                    and inputs[2].security is inputs[2].quality is None
                    and C.cast(inputs[2].name,C.c_void_p).value == C.addressof(inputs[1]))
            sources._source_output_pointer(args[2],inputs[2])
        else:
            kind,layout = ((9,C.c_uint32 * 2),(18,C.c_ubyte * 24),(1,x.core._Standard))[stage-1]
            x._need(function is self.owner._api.k.GetFileInformationByHandleEx and len(args) == 4
                    and not inputs and type(buffer) is layout and type(args[0]) is int
                    and args[0] == slot.value and type(args[1]) is int and args[1] == kind
                    and type(args[3]) is int and args[3] == C.sizeof(buffer))
        address,size = C.addressof(buffer),C.sizeof(buffer)
        x._need(size <= 40)
        x._need(type(inputs) is tuple)
        input_bytes = tuple(C.string_at(C.addressof(value), C.sizeof(value)) for value in inputs)
        pointer = args[3] if indirect else args[2]
        sources._source_output_pointer(pointer, buffer)
        if indirect:sources._source_output_pointer(args[0], self.slot)
        slot_before = slot.value
        getter, setter = C.get_last_error, C.set_last_error
        physical = typed = known = None
        def read():return physical, typed, known
        # This closure and its original allocated output survive getter failure.
        item = (function, args, buffer, read)
        self.calls.append(item)
        row = self.arena.begin(self.ticket, 'source-sharing-probe', function, args,
                               (self, item, buffer, read))
        self.custody[0](item, row)
        def unchanged():
            checker()
            sources._source_output_pointer(pointer, buffer)
            if indirect:sources._source_output_pointer(args[0], self.slot)
            x._need(all(C.string_at(C.addressof(value), C.sizeof(value)) == saved
                        for value, saved in zip(inputs, input_bytes)))
        try:
            setter(0)
            unchanged()
            x._need(slot.value == slot_before)
            value = function(*args)
            physical = (value, slot.value if indirect else None, thread)
            typed = C.string_at(address, size)
            error = getter()
            known = (value, error, thread)
            self.arena.returned(row, value, error)
            unchanged()
            x._need(type(value) is int and (value == 0 if indirect else value != 0)
                    and type(error) is int and 0 <= error <= 0xffffffff
                    and C.addressof(buffer) == address and C.sizeof(buffer) == size
                    and C.string_at(address,size) == typed
                    and (self.slot.value == slot_before if not indirect else self.slot.value == physical[1]
                         and type(physical[1]) is int and 0 < physical[1] < C.c_void_p(-1).value))
            self.arena.acknowledge(row)
            checker()
            return type(buffer).from_buffer_copy(typed)
        except BaseException:
            self.arena.fenced = self.port.api.uncertain = True
            raise

    def run(self, record):
        root = self.bind(record)
        text = C.create_unicode_buffer('model.safetensors')
        string = x.core._Unicode(len('model.safetensors'.encode('utf-16-le')),
                                  C.sizeof(text), C.cast(text, C.c_void_p))
        attrs = x.core._Attributes(C.sizeof(x.core._Attributes), root, C.pointer(string), 0x40, None, None)
        io = x.core._Io()
        self.buffers.extend((text, string, attrs, io))
        args = (C.byref(self.slot), 0x100081, C.byref(attrs), C.byref(io), None,
                0x80, 3, 1, 0x200040, None, 0)
        io = self.call(record.function, args, io, indirect=True, inputs=(text, string, attrs))
        x._need(io.status in (None, 0) and io.information == 1)
        number = self.slot.value
        for kind, buffer in ((9, (C.c_uint32 * 2)()), (18, (C.c_ubyte * 24)()), (1, x.core._Standard())):
            self.buffers.append(buffer)
            result = self.call(self.owner._api.k.GetFileInformationByHandleEx,
                               (number, kind, C.byref(buffer), C.sizeof(buffer)), buffer)
            if kind == 9:
                x._need(not result[0] & (0x10 | 0x400 | 0x200 | 0x800 | 0x4000 | 0x1000) and result[1] == 0)
            elif kind == 18:
                raw = bytes(result)
                x._need(any(raw[:8]) and any(raw[8:]))
            else:
                x._need(0 < result.size <= 4096 and 0 <= result.allocated <= 65536
                        and result.links == 1 and not result.directory and not result.delete_pending)
        self.live()
        checker = _SHARING_INPUTS[id(self)][2][3]
        checker()
        self.complete = True
        record._bind_input_guard(self.owner, lambda: checker(dispatch=True))

    def identity(self, record):
        # Pure read after Source admission has failed. Never call live(), renew
        # a reservation, query an object, close a handle or claim retirement.
        port, owner, arena = self.port, self.owner, self.arena
        x._need(_SHARING_STATES.get(id(port)) == (port, self, self.original)
                and record is self.record and self.complete and len(self.calls) == 4
                and self.custody is self.original[8] and len(self.custody[1]()) == 4
                and all(a is b[0] for a, b in zip(self.calls, self.custody[1]()))
                and self.slot is self.original[5] and self.slot.value == self.calls[0][3]()[0][1])
        for index, (item, row) in enumerate(self.custody[1]()):
            function, args, buffer, read = item
            arena.physical_member(row)
            physical, typed, known = read()
            x._need(row.binding is arena.bindings[row.index] and row.binding[0] is self.ticket
                    and row.binding[1] == 'source-sharing-probe' and row.binding[2] is function
                    and row.binding[3] is args and row.binding[4] == (self, item, buffer, read)
                    and row.binding[5] == self.thread == get_ident()
                    and row.completion is arena.completions[row.index]
                    and row.completion == (row.binding, known[0], known[1], known[2])
                    and physical[0] is known[0] and physical[2] == known[2]
                    and row.payload is arena.payloads[row.index] and row.payload['acknowledged'] is True
                    and C.string_at(C.addressof(buffer),C.sizeof(buffer)) == typed)
            x._need((function is owner._api.n.NtCreateFile and len(args) == 11
                     and args[1] == 0x100081 and args[6:9] == (3, 1, 0x200040)) if index == 0 else
                    (function is owner._api.k.GetFileInformationByHandleEx and args[0] == self.slot.value
                     and args[1] == (9, 18, 1)[index - 1]))
        raw = self.calls[2][3]()[1]
        x._need(type(raw) is bytes and len(raw) == 24)
        return raw



class _SourceExecution(sources._SourceExecutionPort):
    """Concrete original Source producer in the one actual owned child actor."""
    def __init__(self, child, source):
        x._need(type(self) is _SourceExecution and type(child) is _OriginalSourceChild
                and not hasattr(self, 'origin')
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
        identities = ()

        def retain_identity(record, row, raw):
            nonlocal identities
            x._need(type(raw) is bytes and len(raw) == 24 and len(identities) < 16320
                    and not any(a is record or b is row for a, b, _ in identities))
            identities += ((record, row, raw),)

        def original_identity(record, row):
            found = [raw for a, b, raw in identities if a is record and b is row]
            x._need(len(found) == 1)
            return found[0]

        # Immutable copies of known Native identity output survive mutation of
        # the C buffers and of subsequently inspectable observation fields.
        self.identity_custody = (retain_identity, original_identity)
        self.original = (child, source, self.api, self.arena, self.thread,
                         self.bootstraps, self.identity_custody)
        child.buffers.append(self)

    def assert_bound(self, owner):
        x._need(type(self) is _SourceExecution and self.origin is self
                and type(self.original) is tuple and len(self.original) == 7
                and all(a is b for a, b in zip(
                    (self.child, self.source, self.api, self.arena, self.thread,
                     self.bootstraps, self.identity_custody), self.original))
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
        if self.child.entry.case == x._SHARING_DENIAL_CASE:
            x._need(plan.buffer_bytes + 104 * 1024**2 + 16384 <= 512 * 1024**2)
            _SharingProbe(self, owner)
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
        if self.child.entry.case == x._SHARING_DENIAL_CASE and variant == 'scalar' and record.function is owner._api.n.NtCreateFile:
            x._need(len(record.keep) == 6 and type(record.keep[1])._type_ is C.c_wchar)
            if record.keep[1].value == 'model.safetensors':
                retained = _SHARING_STATES.get(id(self))
                x._need(type(retained) is tuple and retained[0] is self)
                retained[1].run(record)
        row = arena.begin(allocation.terminal if terminal else allocation.normal,
                           'source-native', record.function, record.args, (owner, record, invoke, self),
                           terminal=terminal, variant=variant, library=library, source_record=record)
        functions = () if variant == 'system-library' else owner._api._origin[3]
        label = x._failure_api(record.function, functions)
        x._failure_native(self.child, label)
        try:
            value = invoke()
            record.assert_original(owner)
            x._need(record.started and record.returned and record.thread == self.thread
                    and value is record.value)
            arena.returned(row, value, record.error)
            x._failure_native(self.child, label, True, value, record.error)
            arena.acknowledge(row)
            if variant == 'system-library':
                self.bootstraps.append(value)
            elif (record.function is owner._api.k.GetFileInformationByHandleEx
                  and len(record.args) == 4 and record.args[1] == 18
                  and type(value) is int and value != 0):
                x._need(record.args[3] == 24 and len(record.keep) == 2
                        and type(record.keep[1]) is C.c_ubyte * 24
                        and getattr(record.args[2], '_obj', None) is record.keep[1])
                self.identity_custody[0](record, row, bytes(record.original_typed(owner, record.keep[1])))
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
        x._init_failure_state(self, 'child')
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

    def _source_call_return(self, record):
        """Read an original physical completion; never invoke or renew it."""
        source, port, arena = self.source, self.source_port, self.api.rows
        x._need(type(record) is sources._SourceNativeCall)
        record.assert_original(source)
        arena.origin_bound()
        found = [row for row in arena.order
                 if type(row.binding) is tuple and len(row.binding) == 9
                 and row.binding[8] is record]
        x._need(len(found) == 1)
        row = found[0]
        arena.physical_member(row)
        binding, completion, payload = arena.bindings[row.index], arena.completions[row.index], arena.payloads[row.index]
        x._need(binding is row.binding and binding[0] is port.ticket.native.normal
                and binding[1] == 'source-native' and binding[2] is record.function
                and binding[3] is record.args and type(binding[4]) is tuple
                and len(binding[4]) == 4 and binding[4][0] is source
                and binding[4][1] is record and binding[4][3] is port
                and binding[5] == get_ident() == self.thread
                and binding[6:] == ('scalar', None, record)
                and type(completion) is tuple and len(completion) == 4
                and completion is row.completion and completion[0] is binding
                and completion[1] is record.value and completion[2] == record.error
                and completion[3] == self.thread and type(payload) is dict
                and payload is row.payload and payload['function'] is binding[2]
                and payload['args'] is binding[3] and payload['returned'] is True
                and payload['acknowledged'] is True and payload['result'] is completion[1]
                and payload['os_error'] == completion[2])
        return row

    def _original_source_denial(self):
        """Attribute the one documented denial before marking this actor failed."""
        self._live()
        source, port = self.source, self.source_port
        x._need(self.entry.case == x._MAP_DENIAL_CASE
                and self.current is self.requests[0] and self.current['seq'] == 0
                and type(source) is sources._OriginalModelSources
                and type(port) is _SourceExecution and port.origin is port
                and type(port.original) is tuple and len(port.original) == 7
                and all(a is b for a, b in zip(
                    (self, source, self.api, self.api.rows, port.thread,
                     port.bootstraps, port.identity_custody), port.original))
                and port.thread == self.thread == get_ident()
                and port.failed is True and port.kind == 'prepare' and source._execution is port
                and source._uncertain is True and source._busy is True
                and source._retired is False and source._terminal is False)
        custody = sources._SOURCE_CUSTODY.get(id(source))
        x._need(type(custody) is sources._SourceCustody and custody.owner is source)
        custody.check()
        x._need(type(source._api) is sources._WindowsSourceApi
                and source._reservation is port.ticket and source._plan is port.plan
                and len(port.bootstraps) == 2
                and port.bootstraps[0] is source._api.k and port.bootstraps[1] is source._api.n)
        source._api._assert_original()
        port.ticket.assert_original(port, source, port.plan)
        port.ticket.native.assert_original(self.api.rows, source, port.plan)
        operation = source._op
        x._need(type(operation) is x.core._ExecutionCall
                and operation is source._operations[-1] is custody.operation_origins[-1]
                and operation.started is True and operation.finished is False
                and operation.thread == self.thread)
        record = source._pending
        x._need(record is source._calls[-1] and record.started is True
                and record.returned is True and record.acknowledged is False
                and record.thread == self.thread and record.terminal is False
                and type(record.value) is int and record.value == 0
                and type(record.error) is int and record.error == 801
                and record.expected_error == 997
                and record.function is source._api.k.DeviceIoControl)
        self._source_call_return(record)
        guard = source._guards[-1]
        x._need(type(guard) is sources._SourceGuard and guard is custody.guard_origins[-1])
        guard.assert_original()
        guard.handle.assert_original(source)
        x._need(len(record.args) == 8 and record.args[0] == guard.handle.installed
                and record.args[1] == 0x90240
                and getattr(record.args[2], '_obj', None) is guard.incoming
                and record.args[3] == C.sizeof(guard.incoming)
                and getattr(record.args[4], '_obj', None) is guard.outgoing
                and record.args[5] == C.sizeof(guard.outgoing) and record.args[6] is None
                and getattr(record.args[7], '_obj', None) is guard.overlapped
                and record.keep == (guard,))
        identities = [call for call in source._calls[:-1]
                      if call.function is source._api.k.GetFileInformationByHandleEx
                      and len(call.args) == 4 and call.args[0] == guard.handle.installed
                      and call.args[1] == 18]
        x._need(identities)
        identity = identities[-1]
        x._need(identity.acknowledged is True and identity.returned is True
                and type(identity.value) is int and identity.value != 0
                and identity.args[3] == 24 and len(identity.keep) == 2
                and identity.keep[0] is guard.handle
                and type(identity.keep[1]) is C.c_ubyte * 24
                and getattr(identity.args[2], '_obj', None) is identity.keep[1])
        row = self._source_call_return(identity)
        original = port.identity_custody[1](identity, row)
        x._need(bytes(identity.keep[1]) == original and any(original[:8]) and any(original[8:]))
        return x._denial_witness({
            'schema_version': 'source-native-denial-v1', 'phase': 'prepare-source',
            'control_code': 0x90240,
            'requested_level': 1, 'native_return': 0, 'win32_error': 801,
            'target_identity_sha256': x.hashlib.sha256(original).hexdigest(),
            'source_call_count': len(source._calls)})


    def _original_sharing_denial(self):
        """Pure original-frontier proof, with no query after failed admission."""
        self._live()
        owner, port = self.source, self.source_port
        x._need(self.entry.case == x._SHARING_DENIAL_CASE and self.current is self.requests[0]
                and self.current['seq'] == 0 and type(owner) is sources._OriginalModelSources
                and type(port) is _SourceExecution and port.source is owner and port.child is self
                and owner._execution is port and port.thread == get_ident() == self.thread
                and port.failed is True and port.kind == 'prepare' and owner._uncertain is True
                and owner._busy is True and owner._retired is False and owner._terminal is False)
        custody = sources._source_call_custody(owner)
        custody.check()
        owner._api._assert_original()
        operation, record = owner._op, owner._pending
        x._need(operation is owner._operations[-1] is custody.operation_origins[-1]
                and operation.started is True and operation.finished is False and operation.thread == self.thread
                and record is owner._calls[-1] and record.started is True and record.returned is True
                and record.acknowledged is False and record.thread == self.thread and record.terminal is False
                and record.function is owner._api.n.NtCreateFile and record.expected_error is None)
        physical, typed, known, error = custody.original_call_return(record)
        x._need(known and type(physical) is tuple and len(physical) == 3
                and type(physical[0]) is int and physical[0] == -1073741757
                and physical[0] is record.value and physical[1] is record.output_value is None
                and physical[2] == self.thread and record.error == error and typed == ())
        row = self._source_call_return(record)
        saved = _SHARING_STATES.get(id(port))
        x._need(type(saved) is tuple and len(saved) == 3 and saved[0] is port)
        probe = saved[1]
        x._need(type(probe) is _SharingProbe and saved[2] is probe.original
                and _SHARING_INPUTS.get(id(probe)) == (probe, record, probe.snapshot))
        original_id = probe.identity(record)
        original = probe.snapshot[0]
        x._need(record.binding is original[0] and operation is original[1] and record.function is original[2]
                and record.args is original[3] and record.keep is original[4]
                and record.keep[5] is original[5] and record.keep[5].original_generation is original[6]
                and record.keep[5].acquire_call is original[7])
        # Only immutable inputs must survive failed output publication.
        for buffer, content in zip(probe.snapshot[1][:3], probe.snapshot[2][:3]):
            x._need(C.string_at(C.addressof(buffer), C.sizeof(buffer)) == content)
        order = self.api.rows.order
        x._need(len(order) >= 5 and order[-1] is row
                and all(a is b[1] for a, b in zip(order[-5:-1], probe.custody[1]())))
        return x._sharing_denial_witness({
            'schema_version': 'source-native-sharing-denial-v1', 'phase': 'prepare-source',
            'desired_access': record.args[1], 'share_access': record.args[6],
            'native_status': physical[0] & 0xffffffff,
            'target_identity_sha256': x.hashlib.sha256(original_id).hexdigest(),
            'source_call_count': len(owner._calls), 'probe_call_count': len(probe.calls)})

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
                x._failure_phase(self, 'prepare-source')
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
        except BaseException as original_error:
            if self.entry.case in x._NEGATIVE_CASES and sequence == 0:
                # A failed prepare keeps its uncertain custody. Only emit
                # original-call observations; the parent still must observe
                # this exact child's exit before reporting the expected case.
                reply_started = False
                try:
                    x._failure_phase(self, 'attribute-denial')
                    denial = (self._original_sharing_denial() if self.entry.case == x._SHARING_DENIAL_CASE
                              else self._original_source_denial())
                    reply = {**message, 'body': {'error': 'source-session-unavailable',
                             'source_retired': False, 'denial': denial}}
                    reader = x._sharing_denial_message if self.entry.case == x._SHARING_DENIAL_CASE else x._denial_message
                    reader(reply, self.nonce, self.entry.digest, self.deadline)
                    x._failure_phase(self, 'write-denial')
                    reply_started = True
                    self._write_bytes(self.channels['response'], x._frame(reply))
                except BaseException as diagnostic_error:
                    # A separate informational error cannot qualify the denial.
                    # Existing actor/budget guards still own response dispatch.
                    try:
                        if reply_started:raise original_error
                        diagnostic = x._read_failure(self, diagnostic_error)
                        if diagnostic is None:raise original_error
                        reply = {**message, 'body': {'error': 'source-session-unavailable',
                                 'source_retired': False, 'diagnostic': diagnostic}}
                        x._failure_message(reply, self.nonce, self.entry.digest, self.deadline)
                        x._failure_phase(self, 'write-diagnostic')
                        self._write_bytes(self.channels['response'], x._frame(reply))
                    except BaseException:
                        pass  # Uncertain actors cannot bypass their guards to log.
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

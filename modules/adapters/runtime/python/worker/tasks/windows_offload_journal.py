"""Private fresh accounting component; no production domain is selected.

Record bytes are data, not native authority. The real shared domain, stable
mutation fence and finite owner are mandatory. Constructors/default composition
perform no I/O. Existing accounting names are never opened or recovered here.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import ctypes as C
import hashlib
import struct
from threading import RLock, get_ident
import uuid

from .local_model_offload import OffloadAdmissionError, STAGING_LIMIT
from .windows_offload_backend import _ProtectedJournalPort
from . import windows_offload_core as w

FRAME_BYTES = 512
PHASES = ('genesis', 'reserved', 'sealed', 'references-released', 'credited')
CAPACITY_BYTES = FRAME_BYTES * len(PHASES)
JOURNAL_CHARGE = 128 * 1024
_NAMESPACE = '.aisb-offload-accounting-v1'
_FILE = 'ledger.bin'
_HEADER = struct.Struct('<8sBBH16s24sQQQ32s')
_MAGIC, _ZERO = b'AISBJF01', b'\0' * 32
_OWNERS, _OWNERS_LOCK = {}, RLock()
_MAX_OWNERS, _MAX_CALLS = 64, 4096


def _need(value):
    if not value:
        raise OffloadAdmissionError()


def _number(value, maximum=STAGING_LIMIT):
    _need(type(value) is int and 0 <= value <= maximum)
    return value


@dataclass(frozen=True, slots=True)
class _FrameData:
    phase: str
    generation: bytes
    root_identity: bytes
    other_charge: int
    reservation: int
    journal_charge: int
    previous_digest: bytes


def _encode_frame(value):
    _need(type(value) is _FrameData and type(value.phase) is str and value.phase in PHASES)
    _need(type(value.generation) is bytes and len(value.generation) == 16 and any(value.generation))
    _need(type(value.root_identity) is bytes and len(value.root_identity) == 24 and any(value.root_identity))
    _need(type(value.previous_digest) is bytes and len(value.previous_digest) == 32)
    sequence = PHASES.index(value.phase)
    for number in (value.other_charge, value.reservation, value.journal_charge): _number(number)
    _need(value.journal_charge == JOURNAL_CHARGE)
    _need((sequence == 0 and value.reservation == 0 and value.previous_digest == _ZERO)
          or (sequence > 0 and value.reservation > 0 and any(value.previous_digest)))
    # Even a credit frame retains the original admitted reservation, never a
    # newly invented zero balance. Only a live owner may apply its credit.
    _need(value.other_charge + value.journal_charge + value.reservation <= STAGING_LIMIT)
    header = _HEADER.pack(_MAGIC, 1, sequence, 0, value.generation,
                          value.root_identity, value.other_charge,
                          value.reservation, value.journal_charge, value.previous_digest)
    body = header + b'\0' * (FRAME_BYTES - 32 - len(header))
    return body + hashlib.sha256(body).digest()


def _decode_frame(raw):
    _need(type(raw) is bytes and len(raw) == FRAME_BYTES)
    _need(hashlib.sha256(raw[:-32]).digest() == raw[-32:] and not any(raw[_HEADER.size:-32]))
    magic, version, sequence, flags, generation, identity, other, reserved, overhead, previous = _HEADER.unpack_from(raw)
    _need(magic == _MAGIC and version == 1 and flags == 0 and 0 <= sequence < len(PHASES))
    value = _FrameData(PHASES[sequence], generation, identity, other, reserved, overhead, previous)
    _need(_encode_frame(value) == raw)
    return value


def _validate_prefix(raw, *, generation, root_identity, reservation, other_charge):
    """Strict bounded data validation; no reopening, repair or release proof."""
    _need(type(raw) is bytes and 0 < len(raw) <= CAPACITY_BYTES and len(raw) % FRAME_BYTES == 0)
    _need(type(generation) is bytes and len(generation) == 16 and any(generation))
    _need(type(root_identity) is bytes and len(root_identity) == 24 and any(root_identity))
    _number(reservation); _need(reservation > 0 or len(raw) == FRAME_BYTES); _number(other_charge)
    previous = _ZERO
    for sequence, offset in enumerate(range(0, len(raw), FRAME_BYTES)):
        chunk = raw[offset:offset + FRAME_BYTES]; value = _decode_frame(chunk)
        _need(value.phase == PHASES[sequence] and value.generation == generation
              and value.root_identity == root_identity and value.other_charge == other_charge
              and value.previous_digest == previous
              and value.reservation == (0 if sequence == 0 else reservation))
        previous = chunk[-32:]
    return len(raw) // FRAME_BYTES


@dataclass(frozen=True, slots=True)
class _ChargeView:
    """Arithmetic observations only, returned by a separate trusted live owner."""
    other_charge: int


class _JournalDomainPort(ABC):
    """Trusted shared domain/fence; no real producer is supplied by this module.

    It owns all live/unknown charges across roots/processes and an exclusive
    first-slice journal lease. Unknown historical ownership consumes12GiB and
    prevents even bootstrap writes. A stable native mutation fence must remain
    held throughout journal writes; before/after metadata checks alone are not
    that fence. Every callback needs finite native custody of its own. Neither
    parsed frames, fresh names nor the returned numeric view establish authority.
    """
    @abstractmethod
    def assert_bound(self, journal, binding): raise NotImplementedError
    @abstractmethod
    def reserve_journal(self, journal, amount): raise NotImplementedError
    @abstractmethod
    def assert_charge(self, journal, stage_amount): raise NotImplementedError
    @abstractmethod
    def assert_mutation_fence(self, journal): raise NotImplementedError
    @abstractmethod
    def reserve_staging(self, journal, amount): raise NotImplementedError
    @abstractmethod
    def mark_sealed(self, journal): raise NotImplementedError
    @abstractmethod
    def mark_references_released(self, journal): raise NotImplementedError
    @abstractmethod
    def credit_retirement(self, journal, witness): raise NotImplementedError
    @abstractmethod
    def retain_failure(self, journal):
        """Pure in-process pin/freeze only: no IO, cleanup or credit."""
        raise NotImplementedError


class _Call:
    def __init__(self):
        self.started = self.finished = False
        self.thread = self.result = None


class _Irp:
    def __init__(self, handle, event, data, offset):
        self.handle, self.event, self.data, self.offset = handle, event, data, C.c_int64(offset)
        self.io = w._Io()
        self.issued = self.completed = False


class _FsSize(C.Structure):
    _fields_ = [('total', C.c_int64), ('available', C.c_int64),
                ('sectors', C.c_uint32), ('sector_bytes', C.c_uint32)]


class _WindowsJournalApi(w._WindowsApi):
    """Real typed native calls, with journal-owned Core-compatible primitives."""
    def __new__(cls, owner):
        value = super().__new__(cls)
        _need(owner._constructing_api is None)
        owner._constructing_api = value  # Before WinDLL construction/acquisition.
        return value

    def __init__(self, owner):
        super().__init__(owner)
        signatures = [
            (self.k, 'DuplicateHandle', [w._PTR, w._PTR, w._PTR, C.POINTER(w._PTR), w._U32, w._I32, w._U32], w._I32),
            (self.k, 'FlushFileBuffers', [w._PTR], w._I32),
            (self.n, 'NtQueryVolumeInformationFile', [w._PTR, C.POINTER(w._Io), w._PTR, w._U32, w._I32], w._I32),
        ]
        io_args = [w._PTR, w._PTR, w._PTR, w._PTR, C.POINTER(w._Io), w._PTR, w._U32, C.POINTER(C.c_int64), w._PTR]
        signatures += [(self.n, name, io_args, w._I32) for name in ('NtReadFile', 'NtWriteFile')]
        for library, name, args, result in signatures:
            function = getattr(library, name); function.argtypes, function.restype = args, result
        self.anchor = self.namespace = self.file = self.protected = None
        self.allocation = None

    def duplicate_anchor(self, source, expected_identity):
        target = self.handle()
        self.call(self.k.DuplicateHandle, self.k.GetCurrentProcess(), source.value,
                  self.k.GetCurrentProcess(), C.byref(target.slot), 0, 0, 2,
                  keep=(source, target, expected_identity))
        self.kind(target, True)
        _need(self.identity(target) == expected_identity)
        self.anchor = target, expected_identity

    def _allocation_bound(self):
        io, size = w._Io(), _FsSize()
        self.call(self.n.NtQueryVolumeInformationFile, self.anchor[0].value, C.byref(io),
                  C.byref(size), C.sizeof(size), 3,
                  valid=lambda status: type(status) is int and status == 0,
                  keep=(self.anchor, io, size))
        _need(io.status is None and io.information == C.sizeof(size)
              and 0 < size.available <= size.total and size.sectors > 0
              and size.sector_bytes in (512, 1024, 2048, 4096))
        cluster = size.sectors * size.sector_bytes
        _need(0 < cluster <= 65536 and cluster & (cluster - 1) == 0)
        allocation = ((CAPACITY_BYTES + cluster - 1) // cluster) * cluster
        _need(CAPACITY_BYTES + allocation <= JOURNAL_CHARGE
              and size.available * cluster >= JOURNAL_CHARGE)
        return allocation

    def prepare(self):
        _need(self.anchor is not None and self.namespace is None and self.file is None)
        self.allocation = self._allocation_bound()
        self.namespace = self.create_directory(self.anchor[0], _NAMESPACE)
        acl = self._private_acl(); security = self._descriptor(acl)
        handle, text, io = self.handle(), C.create_unicode_buffer(_FILE), w._Io()
        name = w._Unicode(len(_FILE.encode('utf-16-le')), C.sizeof(text), C.cast(text, w._PTR))
        attributes = w._Attributes(C.sizeof(w._Attributes), self.namespace[0].value,
                                   C.pointer(name), 0x40, C.cast(C.byref(security[1]), w._PTR), None)
        allocation = C.c_int64(self.allocation)
        self.call(self.n.NtCreateFile, C.byref(handle.slot), 0x17019f, C.byref(attributes), C.byref(io),
                  C.byref(allocation), 0x80, 0, 2, 0x200000 | 0x40 | 2, None, 0,
                  valid=lambda status: type(status) is int and status == 0,
                  keep=(handle, text, name, attributes, io, security, allocation))
        _need(io.information == 2)
        self.kind(handle, False)
        _need(self.permissions(handle) == (acl, w._PRIVATE_CONTROL))
        self.file = handle, self.identity(handle), acl
        self.protected = (self.protect(self.namespace[0], (self.namespace[2], w._PRIVATE_CONTROL)),
                          self.protect(handle, (acl, w._PRIVATE_CONTROL)))
        # This is the same held writer/file object. A separate required domain
        # fence covers mutable namespace/security growth; no directory RH watch
        # is claimed to survive our own size/timestamp updates.
        self.guard(handle)
        self.check(0)

    def check(self, expected_size):
        _need(type(expected_size) is int and 0 <= expected_size <= CAPACITY_BYTES
              and self.anchor is not None and self.namespace is not None
              and self.file is not None and self.protected is not None)
        _need(len(self.owner._guards) == 1)
        self.check_guard(self.owner._guards[0])
        _need(self.identity(self.anchor[0]) == self.anchor[1])
        for index, item in enumerate((self.namespace, self.file)):
            self.kind(item[0], index == 0)
            _need(self.identity(item[0]) == item[1] and self.permissions(item[0]) == self.protected[index])
        rows = []
        for row in self.entries(self.namespace[0]):
            if row[0] in ('.', '..'):
                identity = self.namespace[1] if row[0] == '.' else self.anchor[1]
                _need(row[4] and row[2] == 0 and row[1] == identity[8:])
            else:
                rows.append(row)
        _need(len(rows) == 1 and rows[0][0] == _FILE and rows[0][1] == self.file[1][8:]
              and not rows[0][4])
        identity, size, allocated = self.file_facts(self.file[0])
        _need(identity == self.file[1] and size == expected_size
              and rows[0][2:4] == (size, allocated)
              and 0 <= allocated <= self.allocation and size + allocated <= JOURNAL_CHARGE)
        self.check_guard(self.owner._guards[0])

    def _io(self, data, offset, *, writing):
        _need(type(data) is bytes and 0 < len(data) <= CAPACITY_BYTES
              and type(offset) is int and 0 <= offset <= CAPACITY_BYTES - len(data))
        event = self.handle()
        self.call(self.n.NtCreateEvent, C.byref(event.slot), 0x100002, None, 0, 0,
                  valid=lambda status: type(status) is int and status == 0, keep=(event,))
        buffer = C.create_string_buffer(data, len(data))
        irp = _Irp(self.file[0], event, buffer, offset)
        self.owner._irps.append(irp)  # Before the async output/status can escape.
        irp.issued = True
        function = self.n.NtWriteFile if writing else self.n.NtReadFile
        self.call(function, irp.handle.value, event.value, None, None, C.byref(irp.io),
                  buffer, len(data), C.byref(irp.offset), None,
                  valid=lambda status: type(status) is int and status in (0, 0x103), keep=(irp, function))
        self.call(self.k.WaitForSingleObject, event.value, 1500,
                  valid=lambda status: type(status) is int and status == 0, keep=(irp,))
        _need(irp.io.status is None and irp.io.information == len(data))
        irp.completed = True
        self.close(event)
        # Only terminal IO and acknowledged close release transient custody.
        # Failed/pending requests retain their exact buffers and event instead.
        _need(irp.completed and event.close_started and event.closed
              and self.owner._pending is None and self.owner._retiring_io is None)
        self.owner._retiring_io = irp  # Retain through interrupted bookkeeping.
        self.owner._irps.remove(irp)
        self.owner._handles.remove(event)
        self.owner._retiring_io = None
        return bytes(buffer)

    def write(self, raw, offset):
        _need(self._io(raw, offset, writing=True) == raw)

    def flush(self):
        self.call(self.k.FlushFileBuffers, self.file[0].value, keep=(self.file,))

    def read(self, size):
        _need(type(size) is int and 0 < size <= CAPACITY_BYTES)
        return self._io(b'\0' * size, 0, writing=False)

    def retire(self):
        _need(self.owner._retiring_io is None)
        _need(all(irp.issued and irp.completed and irp.event.closed for irp in self.owner._irps))
        for guard in self.owner._guards: self.retire_guard(guard)
        for handle in reversed(self.owner._handles):
            if not handle.closed: self.close(handle)
        _need(not self.owner._allocations and all(handle.closed for handle in self.owner._handles))
        # Deliberately retain the accounting namespace/file and journal charge.
        # A later process may not infer a zero domain from absent history.


class WindowsProtectedJournal(_ProtectedJournalPort, w._JournalAnchorReceiver):
    """One fresh journal, with real API and unavailable mandatory producers.

    Only trusted private composition can provide a live domain. There is no
    fresh/reset/zero argument, serialized proof, caller path or implicit native
    owner. Tests may explicitly inject synthetic ports; they supply no native
    admission or production qualification.
    """
    def __init__(self, core, domain=None, *, _api_factory=_WindowsJournalApi):
        _need(type(core) is w.WindowsOffloadCore and callable(_api_factory)
              and (domain is None or isinstance(domain, _JournalDomainPort)))
        self.__origin, self.__core, self.__domain = self, core, domain
        self._core, self._domain = core, domain
        self._binding = core._journal_accounting_binding()
        self._factory, self._api, self._constructing_api = _api_factory, None, None
        self._lock = RLock()
        self._handles, self._guards, self._allocations, self._irps, self._calls = [], [], [], [], []
        self._dispatch = self._pending = self._request_thread = self._native_thread = None
        self._retiring_io = None
        self._busy = self._uncertain = self._domain_failure_started = self._credit_started = False
        self._phase, self._history, self._pending_frame = 'new', b'', None
        self._generation, self._root_identity = uuid.uuid4().bytes, None
        self._other_charge = self._reservation = 0
        self._native_call_count = 0

    def _assert_origin(self):
        _need(type(self) is WindowsProtectedJournal
              and getattr(self, '_WindowsProtectedJournal__origin', None) is self
              and self._core is self.__core and self._domain is self.__domain
              and self._binding is self._core._accounting)
        self._core._assert_origin()
        _need(self._api is None or getattr(self._api, 'owner', None) is self)

    def _retain(self):
        self._assert_origin()
        with _OWNERS_LOCK:
            _need(id(self) in _OWNERS or len(_OWNERS) < _MAX_OWNERS)
            _OWNERS[id(self)] = self

    def _fail(self):
        self._uncertain = True
        try: self._binding._retain_failure()
        except BaseException: pass  # Journal already retains the exact Core.
        if self._domain is not None and not self._domain_failure_started:
            self._domain_failure_started = True
            try: self._domain.retain_failure(self)
            except BaseException: pass  # Never retry unknown bookkeeping.

    def _ack(self, function, *args):
        _need(function(*args) is None and not self._uncertain)

    def _require_dependencies(self):
        self._assert_origin()
        _need(isinstance(self._domain, _JournalDomainPort)
              and isinstance(self._core._execution, w._NativeExecutionPort)
              and not self._uncertain)

    def prepare(self):
        """Explicit native bootstrap; unknown/full usage refuses before writes."""
        self._require_dependencies()
        self._retain()
        try:
            _need(self._phase == 'new')
            self._binding._settled_core()
            _need(not self._core._retired)
            self._request_thread, self._phase = get_ident(), 'preparing'
            self._ack(self._domain.assert_bound, self, self._binding)
            view = self._domain.reserve_journal(self, JOURNAL_CHARGE)
            _need(type(view) is _ChargeView)
            self._other_charge = _number(view.other_charge)
            _need(self._other_charge + JOURNAL_CHARGE <= STAGING_LIMIT)
            self._binding.borrow_anchor(self)
            def bootstrap():
                self._domain_bound()
                self._ack(self._domain.assert_mutation_fence, self)
                self._ack(self._api.prepare)
                self._write_frame('genesis')
                self._phase = 'genesis'
            self._run(bootstrap)
        except BaseException as error:
            self._fail()
            if isinstance(error, Exception): raise OffloadAdmissionError() from None
            raise

    def _accept_core_anchor(self, binding, handle, identity):
        self._assert_origin()
        _need(binding is self._binding and self._phase == 'preparing'
              and self._api is None and self._dispatch is None and not self._uncertain)
        binding.assert_borrow_callback(self)
        call = _Call(); self._calls.append(call)
        call.started, call.thread = True, get_ident()
        self._native_thread, self._dispatch = call.thread, call
        self._native_call_count = 0
        self._root_identity = identity
        self._api = self._factory(self)
        self._ack(self._api.duplicate_anchor, handle, identity)
        _need(not self._uncertain and self._pending is None)
        binding.assert_borrow_callback(self)
        call.result, call.finished = None, True
        self._dispatch = None
        self._calls.remove(call)

    def _native_call(self, function, args, valid, keep):
        self._retain()
        call = self._dispatch
        try:
            _need(type(call) is _Call and call.started and not call.finished
                  and call.thread == get_ident() == self._native_thread
                  and self._pending is None and not self._uncertain
                  and self._native_call_count < _MAX_CALLS)
            self._native_call_count += 1
            self._pending = (function, args, valid, keep)
            result = function(*args)
            _need(valid(result) and not self._uncertain)
            self._pending = None
            return result
        except BaseException:
            self._fail()
            raise

    def _run(self, operation, *, retired=False):
        self._require_dependencies()
        self._retain()
        try:
            _need(self._request_thread == get_ident())
            with self._lock:
                _need(not self._busy and not self._uncertain and self._dispatch is None)
                self._busy = True
                self._native_call_count = 0  # Per settled operation, not lifetime.
            call = _Call(); self._calls.append(call)
            def invoke():
                try:
                    with self._lock:
                        self._assert_origin()
                        _need(not call.started and not self._uncertain
                              and get_ident() == self._native_thread)
                        call.started, call.thread = True, get_ident()
                        self._dispatch = call
                    result = operation()
                    _need(not self._uncertain and self._pending is None)
                    call.result, call.finished = result, True
                    return result
                except BaseException:
                    self._fail()
                    raise
            result = self._binding.execute(self, invoke, retired=retired)
            with self._lock:
                _need(call.started and call.finished and result is call.result
                      and not self._uncertain and self._pending is None)
                self._dispatch = None
                self._busy = False
                self._calls.remove(call)
            return result
        except BaseException as error:
            self._fail()
            if isinstance(error, Exception): raise OffloadAdmissionError() from None
            raise

    def _domain_bound(self):
        self._ack(self._domain.assert_bound, self, self._binding)
        self._ack(self._domain.assert_charge, self, self._reservation)

    def _read_current(self):
        self._domain_bound()
        self._ack(self._domain.assert_mutation_fence, self)
        self._ack(self._api.check, len(self._history))
        raw = self._api.read(len(self._history))
        _need(type(raw) is bytes and raw == self._history)
        self._ack(self._api.check, len(self._history))
        self._domain_bound()
        self._ack(self._domain.assert_mutation_fence, self)

    def _write_frame(self, phase):
        _need(phase in PHASES and PHASES.index(phase) * FRAME_BYTES == len(self._history))
        self._domain_bound()
        self._ack(self._domain.assert_mutation_fence, self)
        frame = _encode_frame(_FrameData(phase, self._generation, self._root_identity,
                              self._other_charge, self._reservation, JOURNAL_CHARGE,
                              self._history[-32:] if self._history else _ZERO))
        expected = self._history + frame
        self._pending_frame = frame, expected  # Before any possibly partial write.
        self._ack(self._api.check, len(self._history))
        self._ack(self._api.write, frame, len(self._history))
        self._ack(self._api.flush)
        self._ack(self._api.check, len(expected))
        raw = self._api.read(len(expected))
        _need(type(raw) is bytes and raw == expected)
        _need(_validate_prefix(expected, generation=self._generation, root_identity=self._root_identity,
                               reservation=self._reservation, other_charge=self._other_charge)
              == PHASES.index(phase) + 1)
        self._ack(self._api.check, len(expected))
        self._domain_bound()
        self._ack(self._domain.assert_mutation_fence, self)
        self._history, self._pending_frame = expected, None

    def assert_bound(self, core):
        _need(core is self._core and self._phase in PHASES[:-1])
        self._run(self._read_current)

    def reserve(self, core, amount):
        _need(core is self._core and type(amount) is int and 0 < amount <= STAGING_LIMIT)
        def reserve():
            _need(self._phase == 'genesis' and self._reservation == 0
                  and self._other_charge + JOURNAL_CHARGE + amount <= STAGING_LIMIT)
            self._reservation = amount  # Retain intended charge before callback.
            self._ack(self._domain.reserve_staging, self, amount)
            self._write_frame('reserved')
            self._phase = 'reserved'
        return self._run(reserve)

    def assert_reserved(self, core, amount):
        _need(core is self._core and type(amount) is int and amount == self._reservation)
        def check():
            _need(self._phase == 'reserved')
            self._read_current()
        return self._run(check)

    def seal(self, core):
        self._require_dependencies()
        self._retain()
        _need(core is self._core and self._phase == 'reserved')
        # Keep Core and journal dispatches separate; no nested execution owner.
        try:
            core.assert_sealed()
            def seal():
                _need(self._phase == 'reserved')
                self._write_frame('sealed')
                self._ack(self._domain.mark_sealed, self)
                self._phase = 'sealed'
            return self._run(seal)
        except BaseException as error:
            self._fail()
            if isinstance(error, Exception): raise OffloadAdmissionError() from None
            raise

    def assert_sealed(self, core):
        _need(core is self._core)
        def check():
            _need(self._phase == 'sealed')
            self._read_current()
        return self._run(check)

    def references_released(self, core):
        _need(core is self._core)
        def references():
            _need(self._phase == 'sealed')
            self._write_frame('references-released')
            self._ack(self._domain.mark_references_released, self)
            self._phase = 'references-released'
        return self._run(references)

    def _assert_credit_facts(self, domain, witness):
        self._assert_origin()
        call = self._dispatch
        _need(domain is self._domain and not self._uncertain
              and self._credit_started and self._busy
              and type(call) is _Call and call.started and not call.finished
              and call.thread == get_ident() == self._native_thread
              and self._phase == 'references-released' and self._pending is None
              and self._retiring_io is None
              and len(self._history) == CAPACITY_BYTES and self._pending_frame is None
              and all(irp.completed and irp.event.closed for irp in self._irps)
              and all(guard['retired'] is True for guard in self._guards)
              and not self._allocations and all(h.closed for h in self._handles))
        self._binding.assert_retired_witness(self, self._core, witness)
        _need(_decode_frame(self._history[-FRAME_BYTES:]).phase == 'credited')

    def credit_retirement(self, core):
        self._assert_origin()  # Invalid copies cannot poison the real owner.
        _need(core is self._core)
        def credit():
            _need(self._phase == 'references-released' and not self._credit_started)
            self._credit_started = True
            witness = self._binding.retired_witness(self, core)
            self._write_frame('credited')
            self._ack(self._api.retire)
            self._assert_credit_facts(self._domain, witness)
            self._ack(self._domain.credit_retirement, self, witness)
            self._phase = 'credited'
        try:
            result = self._run(credit, retired=True)
            with _OWNERS_LOCK: _OWNERS.pop(id(self), None)
            return result
        except BaseException as error:
            self._fail()
            if isinstance(error, Exception): raise OffloadAdmissionError() from None
            raise

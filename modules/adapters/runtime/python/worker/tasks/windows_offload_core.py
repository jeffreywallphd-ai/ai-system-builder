"""Private fresh-only Windows staging implementation, not recovery admission.

Construction has no I/O. Trusted composition must explicitly prepare a known
cache binding, provide protected accounting and own the standalone writer. The
current production factory does none of these. Existing namespaces are refused.
Native execution is separate from the ordinary synthetic API tests.
"""
from __future__ import annotations

import ctypes as C
from abc import ABC, abstractmethod
import os
from pathlib import Path
import re
import struct
from threading import RLock, get_ident
from types import MethodType
import uuid

from .local_model_offload import OffloadAdmissionError, STAGING_LIMIT

_CUSTODY = {}
_READ_RETIREMENTS = {}
_CUSTODY_LOCK = RLock()
_MAX_OWNERS = 64
_MAX_DEPTH = 128
_MAX_PAGES = 4
_PAGE_BYTES = 65536
_WAIT_MS = 1500
_ACL_CONTROL = 0x150c
_PRIVATE_CONTROL = 0x1004
_WRITE_MASK = 0xD0156
_OWNER_RIGHTS = b'\x01\x01\0\0\0\0\0\x03\x04\0\0\0'
_MAX_PROTECTIONS = 3  # Core's two fixed objects; Journal adds its owned parent.
_MAX_DIRECTORY_CREATIONS = 2
_WORLD = b'\x01\x01\0\0\0\0\0\x01\0\0\0\0'
_LEAF = re.compile(r'[A-Za-z0-9_. -]{1,255}')
_DIRECTORY_ROW = struct.Struct('<II6qIIII16s')
_U16, _U32, _I32, _PTR = C.c_uint16, C.c_uint32, C.c_int32, C.c_void_p


def _require(value):
    if not value:
        raise OffloadAdmissionError()


def _name(value):
    _require(type(value) is str and _LEAF.fullmatch(value) and value not in ('.', '..')
             and value[-1] not in '. ')
    return value


def _acl(acl, *, deny=False):
    _require(type(acl) is bytes and 8 <= len(acl) <= 65535)
    revision, zero, size, count, zero2 = struct.unpack('<BBHHH', acl[:8])
    _require(revision in (2, 4) and size == len(acl) and zero == zero2 == 0)
    cursor = 8
    for _ in range(count):
        _require(cursor + 4 <= size)
        kind, flags, length = struct.unpack_from('<BBH', acl, cursor)
        _require(kind in (0, 1) and flags == 0 and length >= 16 and cursor + length <= size)
        cursor += length
    _require(cursor == size)
    if not deny:
        return acl
    _private_sid(acl)
    deny_ace = struct.pack('<BBHI', 1, 0, 20, _WRITE_MASK) + _WORLD
    owner_ace = struct.pack('<BBHI', 0, 0, 20, 0x20000) + _OWNER_RIGHTS
    extra = deny_ace + owner_ace
    _require(size + len(extra) <= 65535 and count + 2 <= 65535)
    return struct.pack('<BBHHH', revision, 0, size + len(extra), count + 2, 0) + extra + acl[8:]


def _sid(raw):
    _require(type(raw) is bytes and 8 <= len(raw) <= 68
             and raw[0] == 1 and raw[1] <= 15 and len(raw) == 8 + 4 * raw[1])
    return raw


def _private_sid(acl):
    _require(type(acl) is bytes and 24 <= len(acl) <= 84)
    revision, zero, size, count, zero2 = struct.unpack('<BBHHH', acl[:8])
    kind, flags, length, rights = struct.unpack_from('<BBHI', acl, 8)
    _require(revision == 2 and zero == zero2 == 0 and count == 1 and size == len(acl)
             and kind == flags == 0 and length == len(acl) - 8 and rights == 0x1701ff)
    return _sid(acl[16:])


def _directory_page(raw):
    """Strict bounded native metadata parser. Names never enter public output."""
    _require(type(raw) is bytes and len(raw) == _PAGE_BYTES)
    result, seen, offset = [], set(), 0
    for _ in range(32):
        _require(offset % 8 == 0 and offset + _DIRECTORY_ROW.size <= len(raw))
        row = _DIRECTORY_ROW.unpack_from(raw, offset)
        following, size, allocated, attrs, length, ea, identity = row[0], row[6], row[7], row[8], row[9], row[10], row[12]
        _require(0 < length <= 510 and length % 2 == 0 and offset + _DIRECTORY_ROW.size + length <= len(raw))
        _require(0 <= size <= STAGING_LIMIT and 0 <= allocated <= STAGING_LIMIT and any(identity))
        _require(not attrs & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000 | 0x40 | 0x10000) and ea == 0)
        try:
            name = raw[offset + _DIRECTORY_ROW.size:offset + _DIRECTORY_ROW.size + length].decode('utf-16-le')
        except UnicodeError:
            raise OffloadAdmissionError() from None
        _require(name in ('.', '..') or _name(name))
        _require(name.casefold() not in seen)
        seen.add(name.casefold())
        if name in ('.', '..'):
            _require(attrs & 0x10 and size == 0)
        result.append((name, identity, size, allocated, bool(attrs & 0x10)))
        if following == 0:
            return tuple(result)
        _require(following % 8 == 0 and following >= _DIRECTORY_ROW.size + length
                 and offset + following + _DIRECTORY_ROW.size <= len(raw))
        offset += following
    raise OffloadAdmissionError()


class _Unicode(C.Structure):
    _fields_ = [('length', _U16), ('maximum', _U16), ('buffer', _PTR)]


class _Attributes(C.Structure):
    _fields_ = [('length', _U32), ('root', _PTR), ('name', C.POINTER(_Unicode)),
                ('flags', _U32), ('security', _PTR), ('quality', _PTR)]


class _Io(C.Structure):
    _fields_ = [('status', _PTR), ('information', C.c_size_t)]


class _Descriptor(C.Structure):
    _fields_ = [('revision', C.c_ubyte), ('zero', C.c_ubyte), ('control', _U16),
                ('owner', _PTR), ('group', _PTR), ('sacl', _PTR), ('dacl', _PTR)]


class _Overlapped(C.Structure):
    _fields_ = [('internal', C.c_size_t), ('high', C.c_size_t), ('offset', _U32),
                ('offset_high', _U32), ('event', _PTR)]


class _OplockIn(C.Structure):
    _fields_ = [('version', _U16), ('length', _U16), ('level', _U32), ('flags', _U32)]


class _OplockOut(C.Structure):
    _fields_ = [('version', _U16), ('length', _U16), ('original', _U32), ('new', _U32),
                ('flags', _U32), ('access', _U32), ('share', _U16)]


class _Standard(C.Structure):
    _fields_ = [('allocated', C.c_int64), ('size', C.c_int64), ('links', _U32),
                ('delete_pending', C.c_ubyte), ('directory', C.c_ubyte)]


class _Handle:
    def __init__(self):
        self.slot = _PTR()
        self.close_started = self.closed = self.delete_started = False

    @property
    def value(self):
        _require(not self.closed and self.slot.value not in (None, C.c_void_p(-1).value))
        return self.slot.value


class _NativeExecutionPort(ABC):
    """Trusted finite dispatcher; no production producer is supplied here.

    A producer retains its exact thread/process, callbacks and in-flight native
    buffers before dispatch. A finite deadline returns only acknowledged results;
    timeout/unknown completion retains custody and permanently denies reuse. It
    must never terminate the shared worker or report a requested stop as exit.
    """
    @abstractmethod
    def assert_bound(self, core): raise NotImplementedError
    @abstractmethod
    def execute(self, core, operation): raise NotImplementedError


class _ExecutionCall:
    def __init__(self):
        self.started = self.finished = False
        self.thread = self.value = None


class _NativeCallOutcome:
    """One passive callable outcome; never Native completion or release proof."""
    __slots__ = ('__origin', '__owner', '__api', '__dispatch', '__thread',
                 '__function', '__args', '__valid', '__keep', '__error_reader',
                 '__registered', '__pending',
                 '__value', '__error', '__started', '__value_known',
                 '__error_returned', '__error_known', '__acknowledged', '__failed',
                 '__weakref__')

    def __init__(self, owner, dispatch, function, args, valid, keep):
        _require(not hasattr(self, '_NativeCallOutcome__origin'))
        self.__origin, self.__owner, self.__api = self, owner, owner._api
        self.__dispatch, self.__thread = dispatch, get_ident()
        self.__function, self.__args, self.__valid, self.__keep = function, args, valid, keep
        self.__registered = owner._assert_native_outcome_current
        self.__pending = (function, args, valid, keep)
        self.__error_reader = getattr(C, 'get_last_error', None)
        self.__value = self.__error = None
        self.__started = self.__value_known = self.__error_returned = False
        self.__error_known = self.__acknowledged = self.__failed = False
        _require(callable(self.__error_reader))  # No invented error on unsupported hosts.

    def __repr__(self):
        return '<native-call-outcome>'

    def __copy__(self):
        raise TypeError('Native call outcomes cannot be copied')

    def __deepcopy__(self, memo):
        raise TypeError('Native call outcomes cannot be copied')

    def __reduce_ex__(self, protocol):
        raise TypeError('Native call outcomes cannot be serialized')

    @property
    def owner(self): return self.__owner
    @property
    def function(self): return self.__function
    @property
    def args(self): return self.__args
    @property
    def keep(self): return self.__keep
    @property
    def pending(self): return self.__pending
    @property
    def value(self): return self.__value
    @property
    def error(self): return self.__error
    @property
    def value_known(self): return self.__value_known
    @property
    def error_returned(self): return self.__error_returned
    @property
    def error_known(self): return self.__error_known
    @property
    def acknowledged(self): return self.__acknowledged
    @property
    def failed(self): return self.__failed

    def fail(self, owner):
        # A copied owner cannot poison the original owner's retained result.
        if self.__origin is self and self.__owner is owner:
            self.__failed = True

    def assert_current(self, owner, dispatch):
        _require(self.__origin is self and self.__owner is owner
                 and self.__api is owner._api and self.__dispatch is dispatch is owner._dispatch
                 and self.__pending is owner._pending
                 and dispatch is not None
                 and dispatch.started is True and dispatch.finished is False
                 and dispatch.thread == self.__thread
                 and self.__thread == get_ident() and not self.__failed)
        self.__registered(self)

    def assert_settled(self, owner):
        _require(self.__origin is self and self.__owner is owner
                 and self.__acknowledged and not self.__failed)

    def invoke(self):
        _require(self.__origin is self and not self.__started and not self.__failed)
        self.assert_current(self.__owner, self.__owner._dispatch)
        self.__started = True
        self.__value = self.__function(*self.__args)
        self.__value_known = True  # Before the reader or any caller validation.
        self.__error = self.__error_reader()
        self.__error_returned = True  # Retain even malformed opaque results first.
        _require(type(self.__error) is int and 0 <= self.__error <= 0xffffffff)
        self.__error_known = True
        return self.__value

    def validate(self):
        _require(self.__value_known and self.__error_known and not self.__failed)
        _require(self.__valid(self.__value))

    def acknowledge(self, owner, dispatch):
        self.assert_current(owner, dispatch)
        _require(self.__value_known and self.__error_known and not self.__acknowledged)
        self.__acknowledged = True


class _JournalAnchorReceiver(ABC):
    """Private accounting consumer; its native custody stays outside Core."""
    @abstractmethod
    def _accept_core_anchor(self, binding, handle, identity):
        raise NotImplementedError


class _JournalRetirementWitness:
    """Origin-bound observation, never a serialized release certificate."""
    __slots__ = ('__origin', '__binding')

    def __init__(self, binding):
        self.__origin, self.__binding = self, binding

    def _assert_origin(self, binding):
        _require(type(self) is _JournalRetirementWitness
                 and self.__origin is self and self.__binding is binding)


class _JournalCoreBinding:
    """One independent journal may borrow the prepared anchor exactly once.

    The receiver duplicates into its own retained native output slot during the
    Core dispatch. It must not put journal handles/buffers into Core collections.
    Later journal execution uses the same trusted finite owner with its own
    callback custody, including after Core's handles have actually retired.
    """
    def __init__(self, core):
        self.__origin, self._core = self, core
        self._receiver = self._borrowing_thread = None
        self._borrow_started = self._borrowed = self._uncertain = False
        self._witness = _JournalRetirementWitness(self)

    def _assert_origin(self):
        _require(type(self) is _JournalCoreBinding
                 and getattr(self, '_JournalCoreBinding__origin', None) is self)
        self._core._assert_origin()
        _require(self._core._accounting is self and not self._uncertain
                 and not self._core._uncertain)
        self._witness._assert_origin(self)

    def _retain_failure(self):
        # A valid dispatched binding keeps both objects reachable. Copied
        # bindings fail origin checks before this method can affect the owner.
        self._uncertain = True
        self._core.retain_failure()

    def _settled_core(self):
        self._assert_origin()
        core = self._core
        _require(core._api is not None and core._chain and not core._busy
                 and core._dispatch is None and not core._execution_calls)

    def borrow_anchor(self, receiver):
        self._assert_origin()
        _require(isinstance(receiver, _JournalAnchorReceiver)
                 and self._core._retired is False and self._core._uncertain is False)
        if self._borrow_started:
            self._retain_failure()
            raise OffloadAdmissionError()
        self._receiver, self._borrow_started = receiver, True
        self._core._retain()  # Pin the receiver/binding before any callback.
        try:
            def borrow():
                self._assert_origin()
                _require(not self._core._retired)
                self._core._check_bound()
                handle, identity = self._core._chain[-1]
                self._borrowing_thread = get_ident()
                _require(receiver._accept_core_anchor(self, handle, identity) is None)
                self.assert_borrow_callback(receiver)
                self._borrowing_thread = None
            self._core._run(borrow)
            self._settled_core()
            self._borrowed = True
        except BaseException as error:
            self._retain_failure()
            if isinstance(error, Exception):
                raise OffloadAdmissionError() from None
            raise

    def assert_borrow_callback(self, receiver):
        self._assert_origin()
        core = self._core
        call = core._dispatch
        _require(receiver is self._receiver and self._borrow_started and not self._borrowed
                 and self._borrowing_thread == get_ident() and core._busy
                 and type(call) is _ExecutionCall and call.started and not call.finished
                 and call.thread == get_ident() and core._pending is None
                 and not core._retired)

    def assert_consumer(self, receiver, core, *, retired=False):
        self._settled_core()
        _require(type(retired) is bool and receiver is self._receiver
                 and core is self._core and self._borrowed
                 and self._borrowing_thread is None
                 and (retired or not core._retired))

    def execute(self, receiver, operation, *, retired=False):
        """Private dispatch only; receiver must validate its own exact callback."""
        self.assert_consumer(receiver, self._core, retired=retired)
        _require(callable(operation) and isinstance(self._core._execution, _NativeExecutionPort))
        owner = self._core._execution
        _require(owner.assert_bound(self._core) is None)
        result = owner.execute(self._core, operation)
        _require(owner.assert_bound(self._core) is None)
        self.assert_consumer(receiver, self._core, retired=retired)
        return result

    def retired_witness(self, receiver, core):
        self.assert_consumer(receiver, core, retired=True)
        _require(core._retired and type(core._retirement_kind) is str
                 and core._retirement_kind == 'staging' and not core._allocations
                 and all(handle.closed for handle in core._handles))
        return self._witness

    def assert_retired_witness(self, receiver, core, witness):
        _require(witness is self.retired_witness(receiver, core))
        witness._assert_origin(self)


class _ReadBindingRetirement:
    """Captured custody for one unused read-chain close, never a credit proof."""
    def __init__(self, core):
        self.core, self.api, self.factory = core, core._api, core._factory
        self.execution, self.binding = core._execution, core._accounting
        self.root, self.chain, self.handles = core.cache_root, core._chain, core._handles
        self.guards, self.allocations = core._guards, core._allocations
        self.calls = core._execution_calls
        self.call = self.thread = None
        self.request_thread = get_ident()
        self.closed = 0
        self._released = False
        _require(type(self.chain) is tuple and 1 <= len(self.chain) <= _MAX_DEPTH
                 and type(self.handles) is list and len(self.handles) == len(self.chain)
                 and type(self.guards) is list and not self.guards
                 and type(self.allocations) is list and not self.allocations
                 and type(self.calls) is list and not self.calls
                 and core._busy is False and core._dispatch is None
                 and core._read_retirement is None)
        entries = []
        for position, row in enumerate(self.chain):
            _require(type(row) is tuple and len(row) == 2)
            handle, identity = row
            _require(type(handle) is _Handle and self.handles[position] is handle
                     and type(handle.slot) is _PTR
                     and type(identity) is bytes and len(identity) == 24
                     and any(identity[:8]) and any(identity[8:]))
            number = handle.slot.value
            _require(type(number) is int and 0 < number < C.c_void_p(-1).value
                     and all(old[1] is not handle and old[3] != number for old in entries))
            entries.append((row, handle, handle.slot, number, identity))
        self.entries = tuple(entries)

    @property
    def released(self):
        return self._released is True

    def check(self, phase):
        core = self.core
        core._assert_origin()
        _require(_CUSTODY.get(id(core)) is core and _READ_RETIREMENTS.get(id(core)) is self
                 and self._released is False and core._read_retirement is self
                 and core._api is self.api and core._factory is self.factory
                 and core._execution is self.execution and core._accounting is self.binding
                 and core.cache_root is self.root and core._chain is self.chain
                 and core._handles is self.handles and len(self.handles) == len(self.entries)
                 and core._guards is self.guards and not self.guards
                 and core._allocations is self.allocations and not self.allocations
                 and core._execution_calls is self.calls and core._pending is None
                 and core._uncertain is False)
        binding = self.binding
        _require(type(binding) is _JournalCoreBinding and binding._core is core)
        binding._assert_origin()
        _require(binding._receiver is None and binding._borrow_started is False
                 and binding._borrowed is False and binding._borrowing_thread is None
                 and binding._uncertain is False
                 and core._namespace is None and core._stage is None and core._index is None
                 and core._reservation is None and core._protected is None and core._sealed is None)
        for position, (row, handle, slot, number, _) in enumerate(self.entries):
            closed = position >= len(self.entries) - self.closed
            _require(self.chain[position] is row and self.handles[position] is handle
                     and handle.slot is slot and slot.value == number
                     and handle.closed is closed and handle.close_started is closed
                     and handle.delete_started is False)
        call = self.call
        _require(type(call) is _ExecutionCall
                 and call.thread == self.thread == self.request_thread == get_ident()
                 and call.started is True and call.value is None)
        if phase == 'dispatch':
            _require(core._retired is False and core._retirement_kind is None
                     and core._busy is True and core._dispatch is call
                     and len(self.calls) == 1 and self.calls[0] is call
                     and call.finished is False)
        else:
            _require(phase in ('acknowledged', 'published') and self.closed == len(self.entries)
                     and core._retired is True and core._busy is False
                     and core._dispatch is None and not self.calls and call.finished is True)
            expected = None if phase == 'acknowledged' else 'read-binding'
            _require(core._retirement_kind is None if expected is None else
                     type(core._retirement_kind) is str and core._retirement_kind == expected)

    def retire(self):
        _require(self.call is None and self.thread is None and self.closed == 0)
        self.call, self.thread = self.core._dispatch, get_ident()
        self.check('dispatch')
        # Validate the entire chain before closing even its first handle.
        for _, handle, _, _, identity in self.entries:
            observed = self.api.identity(handle)
            self.check('dispatch')
            _require(type(observed) is bytes and observed == identity)
        for _, handle, _, _, identity in reversed(self.entries):
            # A closed handle is never queried or dispatched again.
            observed = self.api.identity(handle)
            self.check('dispatch')
            _require(type(observed) is bytes and observed == identity)
            _require(self.api.close(handle) is None
                     and handle.close_started is True and handle.closed is True)
            self.closed += 1
            self.check('dispatch')
        self.core._retired = True

    def release(self):
        self.check('published')
        core = self.core
        with _CUSTODY_LOCK:
            try:
                _require(_READ_RETIREMENTS.get(id(core)) is self
                         and _CUSTODY.get(id(core)) is core and self.released is False)
                _require(_CUSTODY.pop(id(core)) is core)
                _require(_READ_RETIREMENTS.pop(id(core)) is self)
                # This is the release commit. Later caller interruption cannot
                # resurrect a completed owner or invent unknown native work.
                self._released = True
            except BaseException:
                if not self.released:
                    # Restore the reserved slot before another admission can
                    # observe it as free, including an interrupted dict pop.
                    core._uncertain = True
                    core._read_retirement = self
                    _CUSTODY[id(core)] = core
                    _READ_RETIREMENTS[id(core)] = self
                raise


class _DirectoryCreation:
    """Original exclusive creation, never a private-ACL lookalike or path proof."""
    def __init__(self, api, parent, name):
        _require(type(parent) is _Handle and type(parent.slot) is _PTR
                 and type(api.owner._handles) is list
                 and all(type(h) is _Handle for h in api.owner._handles)
                 and parent in api.owner._handles
                 and parent.closed is False and parent.close_started is False
                 and parent.delete_started is False)
        self.origin, self.api, self.owner, self.thread = self, api, api.owner, get_ident()
        self.generation, self.handles = api._construction_generation, api.owner._handles
        self.parent, self.parent_slot, self.parent_number = parent, parent.slot, parent.value
        self.name = _name(name)
        self.handle = self.slot = self.number = self.original = self.principal = self.identity = None
        self.completed = False

    def assert_origin(self, api):
        _require(type(self) is _DirectoryCreation)
        _require(type(self.thread) is int and type(self.generation) is object
                 and type(self.handles) is list and all(type(h) is _Handle for h in self.handles)
                 and type(self.parent) is _Handle and type(self.parent_slot) is _PTR
                 and type(self.parent_number) is int and self.parent_number > 0
                 and type(self.parent.closed) is bool and type(self.parent.close_started) is bool
                 and type(self.parent.delete_started) is bool and type(self.name) is str
                 and type(self.completed) is bool)
        _require(self.origin is self and self.api is api and self.owner is api.owner
                 and self.owner._api is api and self.thread == get_ident()
                 and self.generation is api._construction_generation
                 and self.handles is self.owner._handles
                 and self.handles.count(self.parent) == 1
                 and self.parent.slot is self.parent_slot and self.parent_slot.value == self.parent_number
                 and self.parent.value == self.parent_number
                 and self.parent.closed is self.parent.close_started is self.parent.delete_started is False)
        _name(self.name)
        if self.handle is not None:
            _require(type(self.handle) is _Handle and type(self.slot) is _PTR
                     and type(self.number) is int and self.number > 0
                     and type(self.handle.closed) is bool and type(self.handle.close_started) is bool
                     and type(self.handle.delete_started) is bool
                     and self.handles.count(self.handle) == 1 and self.handle.slot is self.slot
                     and self.slot.value == self.number and self.handle.value == self.number
                     and self.handle.closed is self.handle.close_started is self.handle.delete_started is False)
        else:
            _require(self.slot is self.number is None and self.completed is False)
        if self.completed:
            _require(type(self.original) is tuple and len(self.original) == 2
                     and type(self.original[0]) is bytes and type(self.original[1]) is int
                     and type(self.principal) is bytes and type(self.identity) is bytes
                     and len(self.identity) == 24 and any(self.identity[:8]) and any(self.identity[8:])
                     and self.original[1] == _PRIVATE_CONTROL
                     and self.principal == _private_sid(self.original[0]))


class _Protection:
    """Original native seal attempt; no serialized or caller-issued authority."""
    def __init__(self, api, handle, original):
        _require(type(handle) is _Handle and type(handle.slot) is _PTR
                 and handle in api.owner._handles and not handle.close_started
                 and not handle.closed and not handle.delete_started)
        self.origin, self.api, self.owner, self.thread = self, api, api.owner, get_ident()
        self.handles, self.handle, self.slot, self.number = api.owner._handles, handle, handle.slot, handle.value
        self.original, self.principal = original, _private_sid(original[0])
        self.expected = (_acl(original[0], deny=True), _PRIVATE_CONTROL)
        self.identity, self.completed = None, False

    def assert_origin(self, api):
        _require(type(self) is _Protection)
        # Shape checks precede equality, iteration, property access and any
        # Native observation. A substituted field cannot provide a callback.
        _require(type(self.handle) is _Handle and type(self.slot) is _PTR
                 and type(self.thread) is int and type(self.number) is int and self.number > 0
                 and type(self.handles) is list and all(type(h) is _Handle for h in self.handles)
                 and type(self.handle.closed) is bool and type(self.handle.close_started) is bool
                 and type(self.handle.delete_started) is bool
                 and type(self.completed) is bool and type(self.principal) is bytes
                 and type(self.original) is tuple and len(self.original) == 2
                 and type(self.original[1]) is int
                 and type(self.expected) is tuple and len(self.expected) == 2
                 and type(self.expected[0]) is bytes and type(self.expected[1]) is int
                 and (self.identity is None or (type(self.identity) is bytes
                      and len(self.identity) == 24 and any(self.identity[:8]) and any(self.identity[8:])))
                 and (not self.completed or self.identity is not None))
        _require(self.origin is self and self.api is api
                 and self.owner is api.owner and self.owner._api is api
                 and self.thread == get_ident() and self.handles is self.owner._handles
                 and self.handles.count(self.handle) == 1 and self.handle.slot is self.slot
                 and self.slot.value == self.number and self.handle.value == self.number
                 and not self.handle.close_started and not self.handle.delete_started)
        _require(self.original[1] == _PRIVATE_CONTROL
                 and self.principal == _private_sid(self.original[0])
                 and self.expected == (_acl(self.original[0], deny=True), _PRIVATE_CONTROL))


class _DefaultApiConstruction:
    """Passive default-Core custody, not Native execution or release authority."""
    __slots__ = ('__origin', '__core', '__api', '__factory', '__call', '__thread',
                 '__execution', '__loader', '__libraries', '__returned', '__next', '__phase', '__inflight')

    def __init__(self, core, api, factory, call):
        self.__origin, self.__core, self.__api = self, core, api
        self.__factory, self.__call, self.__thread = factory, call, get_ident()
        self.__execution, self.__loader = core._execution, getattr(C, 'WinDLL', None)
        self.__libraries, self.__returned = [None]*3, [False]*3
        self.__next, self.__phase, self.__inflight = 0, 'registered', False

    def __repr__(self):return '<retained default Windows API construction>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self, memo):raise OffloadAdmissionError()
    def __reduce_ex__(self, protocol):raise OffloadAdmissionError()

    @property
    def api(self):return self.__api
    @property
    def loader(self):return self.__loader
    @property
    def libraries(self):return tuple(value for value, returned in zip(self.__libraries,self.__returned) if returned)
    @property
    def phase(self):return self.__phase

    def _check(self, api, owner):
        _require(type(self) is _DefaultApiConstruction and self.__origin is self
                 and api is self.__api and owner is self.__core
                 and get_ident() == self.__thread
                 and getattr(api, '_default_core_construction', None) is self)
        owner._assert_default_api_construction(self, api, self.__factory,
                                               self.__call, self.__thread, self.__execution)

    def begin(self, api, owner):
        self._check(api,owner)
        _require(self.__phase == 'registered' and self.__next == 0 and self.__inflight is False
                 and callable(self.__loader) and C.WinDLL is self.__loader)
        self.__phase = 'constructing'

    def _observations(self, next_slot):
        _require(self.__api.owner is self.__core)
        for index, name in enumerate(('k','a','n')):
            expected = self.__libraries[index] if index < next_slot else None
            _require(getattr(self.__api,name) is expected)

    def load(self, slot):
        self._check(self.__api,self.__core)
        _require(self.__phase == 'constructing' and type(slot) is int
                 and 0 <= slot < 3 and slot == self.__next
                 and self.__inflight is False and C.WinDLL is self.__loader)
        self._observations(slot)
        try:
            self.__inflight = True  # Nested denial cannot clear the original call's latch.
            value = self.__loader(('kernel32','advapi32','ntdll')[slot], use_last_error=True)
            # Preallocated slots retain the actual return before any observer
            # readback or k/a/n assignment. A failed call grants no cleanup.
            self.__libraries[slot] = value
            self.__returned[slot] = True
            _require(type(value) is self.__loader)
            self._check(self.__api,self.__core)
            self._observations(slot)
            _require(C.WinDLL is self.__loader)
            self.__next += 1
            self.__inflight = False
            return value
        except BaseException:
            self.fail()
            raise

    def complete(self, api, owner):
        self._check(api,owner)
        _require(self.__phase == 'constructing' and self.__next == 3 and self.__inflight is False
                 and all(value is True for value in self.__returned))
        self._observations(3)
        self.__phase = 'complete'

    def fail(self):
        # Terminal custody precedes observer bookkeeping, which may itself fail.
        self.__phase = 'failed'
        try:self.__core._uncertain = True
        except BaseException:pass


class _WindowsApi:
    """Narrow actual OS implementation; Core retains every call and output slot."""
    def _constructor_library_loader(self):
        """Pure closed-producer selection; existing custom factories use None."""
        return None

    def __init__(self, owner):
        _require(os.name == 'nt' and struct.calcsize('P') == 8)
        construction = getattr(self, '_default_core_construction', None)
        if construction is not None:
            _require(type(construction) is _DefaultApiConstruction)
            construction.begin(self,owner)
        else:
            # Raw/custom subclass and Journal consumers keep their existing
            # construction contracts. An unregistered exact default API on a
            # canonical Core cannot enter that legacy route.
            _require(not (type(self) is _WindowsApi and type(owner) is WindowsOffloadCore))
        selected=None if construction is not None else self._constructor_library_loader()
        _require(selected is None or callable(selected))
        def library(slot):
            if construction is not None:return construction.load(slot)
            if selected is not None:return selected(slot)
            return C.WinDLL(('kernel32','advapi32','ntdll')[slot], use_last_error=True)
        self.owner = owner
        self._protection_origin = self
        self._protections = []
        self._protection_rows = self._protections
        self._construction_origin = self
        self._construction_generation = self._construction_generation_origin = object()
        self._directory_creations = []
        self._directory_creation_rows = self._directory_creations
        if construction is not None:self.k = self.a = self.n = None
        self.k = library(0)
        self.a = library(1)
        self.n = library(2)
        signatures = [
            (self.n, 'NtCreateFile', [C.POINTER(_PTR), _U32, C.POINTER(_Attributes), C.POINTER(_Io), _PTR, _U32, _U32, _U32, _U32, _PTR, _U32], _I32),
            (self.n, 'NtCreateEvent', [C.POINTER(_PTR), _U32, _PTR, _I32, C.c_ubyte], _I32),
            (self.n, 'NtSetSecurityObject', [_PTR, _U32, _PTR], _I32),
            (self.k, 'CloseHandle', [_PTR], _I32),
            (self.k, 'GetFileInformationByHandleEx', [_PTR, _I32, _PTR, _U32], _I32),
            (self.k, 'GetVolumeInformationByHandleW', [_PTR, C.c_wchar_p, _U32, _PTR, _PTR, C.POINTER(_U32), C.c_wchar_p, _U32], _I32),
            (self.k, 'SetFileInformationByHandle', [_PTR, _I32, _PTR, _U32], _I32),
            (self.k, 'DeviceIoControl', [_PTR, _U32, _PTR, _U32, _PTR, _U32, _PTR, C.POINTER(_Overlapped)], _I32),
            (self.k, 'WaitForSingleObject', [_PTR, _U32], _U32),
            (self.k, 'CancelIoEx', [_PTR, C.POINTER(_Overlapped)], _I32),
            (self.k, 'GetOverlappedResult', [_PTR, C.POINTER(_Overlapped), C.POINTER(_U32), _I32], _I32),
            (self.k, 'LocalFree', [_PTR], _PTR),
            (self.k, 'GetCurrentProcess', [], _PTR),
            (self.k, 'GetDriveTypeW', [C.c_wchar_p], _U32),
            (self.a, 'OpenProcessToken', [_PTR, _U32, C.POINTER(_PTR)], _I32),
            (self.a, 'GetTokenInformation', [_PTR, _I32, _PTR, _U32, C.POINTER(_U32)], _I32),
            (self.a, 'IsValidSid', [_PTR], _I32),
            (self.a, 'GetSecurityInfo', [_PTR, _I32, _U32, _PTR, _PTR, C.POINTER(_PTR), _PTR, C.POINTER(_PTR)], _U32),
            (self.a, 'GetSecurityDescriptorControl', [_PTR, C.POINTER(_U16), C.POINTER(_U32)], _I32),
            (self.a, 'GetSecurityDescriptorLength', [_PTR], _U32),
            (self.a, 'SetSecurityDescriptorOwner', [_PTR, _PTR, _I32], _I32),
            (self.a, 'InitializeSecurityDescriptor', [_PTR, _U32], _I32),
            (self.a, 'SetSecurityDescriptorDacl', [_PTR, _I32, _PTR, _I32], _I32),
            (self.a, 'SetSecurityDescriptorControl', [_PTR, _U16, _U16], _I32),
            (self.a, 'IsValidSecurityDescriptor', [_PTR], _I32),
            (self.a, 'IsValidAcl', [_PTR], _I32),
        ]
        for library, name, args, result in signatures:
            call = getattr(library, name)
            call.argtypes, call.restype = args, result

    def call(self, function, *args, valid=lambda value: type(value) is int and value != 0, keep=()):
        _require(self.owner._api is self)
        return self.owner._native_call(function, args, valid, keep)

    def handle(self):
        value = _Handle()
        self.owner._handles.append(value)  # Output slot is owned before dispatch.
        return value

    def close(self, handle):
        _require(type(handle) is _Handle and handle in self.owner._handles)
        if handle.closed:
            return
        _require(not handle.close_started)
        value = handle.value
        handle.close_started = True
        self.call(self.k.CloseHandle, value, keep=(handle,))
        handle.closed = True

    def open(self, parent, name, access, *, create=False, directory=True, share=3, security=None):
        _require(type(create) is bool and type(directory) is bool)
        if parent is None:
            _require(type(name) is str and re.fullmatch(r'\\\?\?\\[A-Za-z]:\\', name))
        else:
            _name(name)
        handle = self.handle()
        text = C.create_unicode_buffer(name)
        string = _Unicode(len(name.encode('utf-16-le')), C.sizeof(text), C.cast(text, _PTR))
        attributes = _Attributes(C.sizeof(_Attributes), parent.value if parent else None, C.pointer(string), 0x40, None, None)
        if security is not None:
            attributes.security = C.cast(C.byref(security[1]), _PTR)
        io = _Io()
        self.call(self.n.NtCreateFile, C.byref(handle.slot), access, C.byref(attributes), C.byref(io), None, 0x80, share,
                  2 if create else 1, 0x200000 | (1 if directory else 0x40), None, 0,
                  valid=lambda status: type(status) is int and status == 0,
                  keep=(handle, text, string, attributes, io, security))
        _require(io.information == (2 if create else 1))
        self.kind(handle, directory)
        return handle

    def kind(self, handle, directory):
        value = (_U32 * 2)()
        self.call(self.k.GetFileInformationByHandleEx, handle.value, 9, C.byref(value), C.sizeof(value), keep=(handle, value))
        _require(bool(value[0] & 0x10) is directory and not value[0] & (0x400 | 0x200 | 0x800 | 0x4000 | 0x1000))

    def identity(self, handle):
        value = (C.c_ubyte * 24)()
        self.call(self.k.GetFileInformationByHandleEx, handle.value, 18, C.byref(value), C.sizeof(value), keep=(handle, value))
        result = bytes(value)
        _require(any(result[:8]) and any(result[8:]))
        return result

    def prepare(self, path):
        _require(re.fullmatch(r'[A-Za-z]:\\', path.anchor) and 1 <= len(path.parts) <= _MAX_DEPTH)
        self.call(self.k.GetDriveTypeW, path.anchor, valid=lambda kind: type(kind) is int and kind == 3)
        access = 0x20000 | 0x80 | 0x20
        chain = [self.open(None, '\\??\\' + path.anchor, access)]
        filesystem, flags = C.create_unicode_buffer(32), _U32()
        self.call(self.k.GetVolumeInformationByHandleW, chain[0].value, None, 0, None, None, C.byref(flags), filesystem, 32, keep=(filesystem, flags))
        _require(filesystem.value == 'NTFS' and flags.value & 8)
        for part in path.parts[1:]:
            chain.append(self.open(chain[-1], part, access))
        return tuple((handle, self.identity(handle)) for handle in chain)

    def _descriptor(self, acl, *, principal=None):
        value, descriptor = C.create_string_buffer(_acl(acl)), _Descriptor()
        sid = C.create_string_buffer(_sid(principal)) if principal is not None else None
        self.call(self.a.IsValidAcl, value, keep=(value, sid))
        self.call(self.a.InitializeSecurityDescriptor, C.byref(descriptor), 1, keep=(descriptor, sid))
        self.call(self.a.SetSecurityDescriptorDacl, C.byref(descriptor), 1, value, 0, keep=(value, descriptor, sid))
        self.call(self.a.SetSecurityDescriptorControl, C.byref(descriptor), 0x1500, 0x1000, keep=(value, descriptor, sid))
        if sid is not None:
            self.call(self.a.IsValidSid, sid, keep=(sid, descriptor))
            self.call(self.a.SetSecurityDescriptorOwner, C.byref(descriptor), sid, 0, keep=(value, descriptor, sid))
        self.call(self.a.IsValidSecurityDescriptor, C.byref(descriptor), keep=(value, descriptor, sid))
        return value, descriptor, sid

    def _private_acl(self):
        token = self.handle()
        self.call(self.a.OpenProcessToken, self.k.GetCurrentProcess(), 8, C.byref(token.slot), keep=(token,))
        size = _U32()
        self.call(self.a.GetTokenInformation, token.value, 1, None, 0, C.byref(size),
                  valid=lambda ok: not ok and C.get_last_error() == 122, keep=(token, size))
        _require(16 <= size.value <= 4096)
        data = C.create_string_buffer(size.value)
        capacity = size.value
        self.call(self.a.GetTokenInformation, token.value, 1, data, capacity, C.byref(size), keep=(token, data, size))
        sid = _PTR.from_buffer(data).value
        _require(16 <= size.value <= capacity and sid is not None and C.addressof(data) <= sid <= C.addressof(data) + size.value - 8)
        header = C.string_at(sid, 8)
        length = 8 + 4 * header[1]
        _require(header[0] == 1 and header[1] <= 15 and sid + length <= C.addressof(data) + size.value)
        self.call(self.a.IsValidSid, sid, keep=(data,))
        body = C.string_at(sid, length)
        self.close(token)
        ace = struct.pack('<BBHI', 0, 0, 8 + length, 0x1701ff) + body
        return struct.pack('<BBHHH', 2, 0, 8 + len(ace), 1, 0) + ace

    def create_directory(self, parent, name):
        _WindowsApi._construction_state(self)
        _require(len(self._directory_creations) < _MAX_DIRECTORY_CREATIONS)
        row = _DirectoryCreation(self, parent, name)
        self._directory_creations.append(row)  # Before descriptor/open acquisition.
        acl = self._private_acl()
        principal = _private_sid(acl)
        descriptor = self._descriptor(acl, principal=principal)
        # Canonical exclusive open validates FILE_CREATED, not an overridden callback.
        handle = _WindowsApi.open(self, parent, name, 0x700a1, create=True, share=0, security=descriptor)
        row.handle, row.slot, row.number = handle, handle.slot, handle.value
        _DirectoryCreation.assert_origin(row, self)
        _require(row.number != row.parent_number)
        for other in self._directory_creations:
            _require(type(other) is _DirectoryCreation)
            _DirectoryCreation.assert_origin(other, self)
            _require(other is row or (other.completed is True and other.number != row.number))
        _require(self.security(handle) == (acl, _PRIVATE_CONTROL, principal))
        identity = self.identity(handle)
        _require(type(identity) is bytes and len(identity) == 24 and any(identity[:8]) and any(identity[8:]))
        _require(all(other is row or other.identity != identity for other in self._directory_creations))
        row.original, row.principal, row.identity = (acl, _PRIVATE_CONTROL), principal, identity
        row.completed = True
        _DirectoryCreation.assert_origin(row, self)
        return handle, identity, acl

    def _construction_state(self):
        _require(getattr(self, '_construction_origin', None) is self and self.owner._api is self
                 and type(self._directory_creations) is list
                 and self._directory_creations is self._directory_creation_rows
                 and len(self._directory_creations) <= _MAX_DIRECTORY_CREATIONS
                 and type(self._construction_generation) is object
                 and self._construction_generation is self._construction_generation_origin)
        for row in self._directory_creations:
            _require(type(row) is _DirectoryCreation)
            _DirectoryCreation.assert_origin(row, self)
            _require(row.completed is True)

    def directory_creation(self, handle):
        _WindowsApi._construction_state(self)
        rows = [row for row in self._directory_creations if row.handle is handle]
        _require(len(rows) == 1)
        _DirectoryCreation.assert_origin(rows[0], self)
        return rows[0]

    def security(self, handle):
        acl, principal, descriptor, control, revision = _PTR(), _PTR(), _PTR(), _U16(), _U32()
        allocation = (descriptor, acl, principal)
        self.owner._allocations.append(allocation)
        self.call(self.a.GetSecurityInfo, handle.value, 1, 5, C.byref(principal), None,
                  C.byref(acl), None, C.byref(descriptor),
                  valid=lambda code: type(code) is int and code == 0,
                  keep=(handle, acl, principal, descriptor, control, revision))
        _require(acl.value and principal.value and descriptor.value)
        self.call(self.a.IsValidSecurityDescriptor, descriptor, keep=(allocation,))
        self.call(self.a.GetSecurityDescriptorControl, descriptor, C.byref(control), C.byref(revision),
                  keep=(allocation, control, revision))
        _require(revision.value == 1 and control.value & 0x8000)
        length = self.call(self.a.GetSecurityDescriptorLength, descriptor,
                           valid=lambda size: type(size) is int and 20 <= size <= 131072,
                           keep=(allocation,))
        base, end = descriptor.value, descriptor.value + length
        _require(base <= acl.value <= end - 8 and base <= principal.value <= end - 8)
        size = _U16.from_address(acl.value + 2).value
        header = C.string_at(principal, 8)
        sid_length = 8 + 4 * header[1]
        _require(8 <= size <= 65535 and acl.value + size <= end
                 and header[0] == 1 and header[1] <= 15 and principal.value + sid_length <= end)
        self.call(self.a.IsValidAcl, acl, keep=(allocation,))
        self.call(self.a.IsValidSid, principal, keep=(allocation,))
        result = _acl(C.string_at(acl, size)), control.value & _ACL_CONTROL, _sid(C.string_at(principal, sid_length))
        self.call(self.k.LocalFree, descriptor, valid=lambda result: result is None, keep=(allocation,))
        self.owner._allocations.remove(allocation)
        return result

    def permissions(self, handle):
        return self.security(handle)[:2]

    def _protection_state(self):
        _require(getattr(self, '_protection_origin', None) is self
                 and self.owner._api is self and type(self._protections) is list
                 and self._protections is self._protection_rows
                 and len(self._protections) <= _MAX_PROTECTIONS)
        for row in self._protections:
            _require(type(row) is _Protection)
            _Protection.assert_origin(row, self)
            _require(row.completed)

    def protect(self, handle, original):
        self._protection_state()
        _require(type(original) is tuple and len(original) == 2 and original[1] == _PRIVATE_CONTROL
                 and len(self._protections) < _MAX_PROTECTIONS
                 and not any(r.handle is handle or r.number == handle.value for r in self._protections))
        row = _Protection(self, handle, original)
        self._protections.append(row)  # Before query/set or any partial native result.
        _Protection.assert_origin(row, self)
        _require(self.security(handle) == (*original, row.principal))
        row.identity = self.identity(handle)
        buffers = self._descriptor(row.expected[0])
        self.call(self.n.NtSetSecurityObject, handle.value, 4, C.byref(buffers[1]),
                  valid=lambda status: type(status) is int and status == 0, keep=(handle, buffers, row))
        _Protection.assert_origin(row, self)
        _require(self.security(handle) == (*row.expected, row.principal)
                 and self.identity(handle) == row.identity)
        row.completed = True
        self.assert_protected(handle, row.expected)
        return row.expected

    def assert_protected(self, handle, expected):
        self._protection_state()
        rows = [r for r in self._protections if r.handle is handle]
        _require(len(rows) == 1)
        row = rows[0]; _Protection.assert_origin(row, self)
        _require(row.completed and row.expected == expected and row.identity is not None
                 and self.security(handle) == (*expected, row.principal)
                 and self.identity(handle) == row.identity)
        _Protection.assert_origin(row, self)

    def entries(self, handle):
        rows, seen = [], set()
        for page in range(_MAX_PAGES):
            data = (C.c_uint64 * (_PAGE_BYTES // 8))()
            error = _U32()
            def query():
                C.set_last_error(0)
                ok = self.k.GetFileInformationByHandleEx(handle.value, 20 if page == 0 else 19, C.byref(data), _PAGE_BYTES)
                error.value = C.get_last_error()
                return ok
            ok = self.call(query, valid=lambda ok: bool(ok) or error.value == 18, keep=(handle, data, error))
            if not ok:
                _require(not any(bytes(data)))
                return tuple(rows)
            for row in _directory_page(bytes(data)):
                _require(row[0].casefold() not in seen)
                seen.add(row[0].casefold())
                rows.append(row)
                _require(len(rows) <= 32)
        raise OffloadAdmissionError()

    def file_facts(self, handle):
        self.kind(handle, False)
        facts = _Standard()
        self.call(self.k.GetFileInformationByHandleEx, handle.value, 1, C.byref(facts), C.sizeof(facts), keep=(handle, facts))
        _require(0 <= facts.size <= STAGING_LIMIT and 0 <= facts.allocated <= STAGING_LIMIT
                 and facts.links == 1 and not facts.directory and not facts.delete_pending)
        data = (C.c_uint64 * (4096 // 8))()
        self.call(self.k.GetFileInformationByHandleEx, handle.value, 7, C.byref(data), C.sizeof(data), keep=(handle, data))
        raw = bytes(data)
        following, length, size, allocated = struct.unpack_from('<IIqq', raw)
        _require(following == 0 and length == 14 and raw[24:38] == '::$DATA'.encode('utf-16-le')
                 and size == facts.size and allocated == facts.allocated)
        return self.identity(handle), facts.size, facts.allocated

    def open_index(self, stage):
        return self.open(stage, 'index.json', 0x30081, directory=False, share=1)

    def guard(self, handle):
        event = self.handle()
        self.call(self.n.NtCreateEvent, C.byref(event.slot), 0x100002, None, 0, 0,
                  valid=lambda status: type(status) is int and status == 0, keep=(event,))
        overlapped = _Overlapped()
        overlapped.event = event.value
        incoming, outgoing = _OplockIn(1, C.sizeof(_OplockIn), 3, 1), _OplockOut()
        guard = {'handle': handle, 'event': event, 'overlapped': overlapped, 'input': incoming,
                 'output': outgoing, 'retirement_started': False, 'retired': False}
        self.owner._guards.append(guard)
        self.call(self.k.DeviceIoControl, handle.value, 0x90240, C.byref(incoming), C.sizeof(incoming),
                  C.byref(outgoing), C.sizeof(outgoing), None, C.byref(overlapped),
                  valid=lambda ok: not ok and C.get_last_error() == 997, keep=(guard,))
        self.check_guard(guard)
        return guard

    def check_guard(self, guard):
        _require(not guard['retirement_started'])
        self.call(self.k.WaitForSingleObject, guard['event'].value, 0,
                  valid=lambda state: type(state) is int and state == 258, keep=(guard,))

    def retire_guard(self, guard):
        _require(not guard['retirement_started'])
        guard['retirement_started'] = True
        handle, event, overlapped = guard['handle'], guard['event'], guard['overlapped']
        self.call(self.k.CancelIoEx, handle.value, C.byref(overlapped),
                  valid=lambda ok: bool(ok) or C.get_last_error() == 1168, keep=(guard,))
        self.call(self.k.WaitForSingleObject, event.value, _WAIT_MS, valid=lambda state: type(state) is int and state == 0, keep=(guard,))
        transferred = _U32()
        self.call(self.k.GetOverlappedResult, handle.value, C.byref(overlapped), C.byref(transferred), 0,
                  valid=lambda ok: type(ok) is int and ok == 0 and C.get_last_error() == 995
                  and int(overlapped.internal) & 0xffffffff == 0xc0000120,
                  keep=(guard, transferred))
        self.close(event)
        guard['retired'] = True

    def delete(self, handle):
        _require(not handle.delete_started and not handle.closed)
        handle.delete_started = True
        disposition = _I32(1)
        self.call(self.k.SetFileInformationByHandle, handle.value, 4, C.byref(disposition), C.sizeof(disposition), keep=(handle, disposition))


class WindowsOffloadCore:
    """One fresh namespace/leaf. This object is not a serializable permission."""
    def __init__(self, cache_root, *, _api_factory=_WindowsApi, _execution=None):
        _require(type(cache_root) is type(Path()) and cache_root.is_absolute() and '..' not in cache_root.parts)
        _require(_execution is None or isinstance(_execution, _NativeExecutionPort))
        self.__origin = self
        self.cache_root = cache_root
        self._factory, self._api = _api_factory, None
        self.__factory = _api_factory
        self.__api_construction = None
        self._constructing_api = None
        self._execution = _execution
        self._execution_calls = []
        self._dispatch = None
        self._lock = RLock()
        self._busy = self._uncertain = self._retired = False
        self._retirement_kind = None
        self._read_retirement = None
        self._pending = None
        self.__native_outcome = None
        self._handles, self._guards, self._chain = [], [], ()
        self._allocations = []
        self._namespace = self._stage = self._index = None
        self._protected = self._sealed = None
        self._reservation = None
        self._leaf = uuid.uuid4().hex
        self._accounting = _JournalCoreBinding(self)

    def _journal_accounting_binding(self):
        """Effect-free private identity; preparation still needs actual owners."""
        self._assert_origin()
        self._accounting._assert_origin()
        return self._accounting

    def _assert_default_api_construction(self, record, api, factory, call, thread, execution):
        _require(self._api is None)  # Refuse a published observer before reading it.
        self._assert_origin()
        _require(self.__factory is factory is _WindowsApi and self._factory is factory
                 and self.__api_construction is record and self._constructing_api is api
                 and self._api is None and self._execution is execution
                 and isinstance(execution,_NativeExecutionPort)
                 and self._busy is True and self._uncertain is False and self._retired is False
                 and type(call) is _ExecutionCall and self._dispatch is call
                 and call.started is True and call.finished is False
                 and call.thread == thread == get_ident()
                 and type(self._execution_calls) is list and self._execution_calls
                 and self._execution_calls[-1] is call)

    def _construct_default_api(self):
        _require(self.__factory is self._factory is _WindowsApi
                 and self.__api_construction is None and self._constructing_api is None)
        api = object.__new__(_WindowsApi)
        record = _DefaultApiConstruction(self,api,self.__factory,self._dispatch)
        self.__api_construction = record  # Core was retained before this callback.
        try:
            api._default_core_construction = record
            self._constructing_api = api
            _require(_WindowsApi.__init__(api,self) is None)
            record.complete(api,self)
            self._api = api
        except BaseException:
            record.fail()  # Uses original references before fallible observers.
            raise

    def _assert_origin(self):
        _require(type(self) is WindowsOffloadCore and getattr(self, '_WindowsOffloadCore__origin', None) is self)
        _require(self._api is None or getattr(self._api, 'owner', None) is self)

    def _retain(self):
        self._assert_origin()
        with _CUSTODY_LOCK:
            _require(id(self) in _CUSTODY or len(_CUSTODY) < _MAX_OWNERS)
            _CUSTODY[id(self)] = self

    def retain_failure(self):
        self._retain_native_outcome_failure()
        self._retain()
        self._uncertain = True

    def _retain_native_outcome_failure(self):
        if self.__origin is self and self.__native_outcome is not None:
            self.__native_outcome.fail(self)

    def _assert_native_outcome_settled(self):
        if self.__native_outcome is not None:
            self.__native_outcome.assert_settled(self)

    def _assert_native_outcome_current(self, outcome):
        _require(self.__origin is self and self.__native_outcome is outcome
                 and self._busy is True and not self._uncertain and not self._retired)
        self._assert_origin()

    def _native_call(self, function, args, valid, keep):
        try:
            self._retain()
            call = self._dispatch
            _require(type(call) is _ExecutionCall and call.started
                     and not call.finished and call.thread == get_ident())
            _require(self._pending is None and not self._uncertain)
            self._assert_native_outcome_settled()
            outcome = _NativeCallOutcome(self, call, function, args, valid, keep)
            self.__native_outcome = outcome
            pending = outcome.pending
            self._pending = pending
            value = outcome.invoke()
            self._assert_origin()
            outcome.assert_current(self, self._dispatch)
            _require(self.__native_outcome is outcome and self._pending is pending and not self._uncertain)
            outcome.validate()
            self._assert_origin()
            outcome.assert_current(self, self._dispatch)
            _require(self.__native_outcome is outcome and self._pending is pending and not self._uncertain)
            outcome.acknowledge(self, call)
            self._pending = None
            return value
        except BaseException:
            self._retain_native_outcome_failure()
            self.retain_failure()
            raise

    def _run(self, function):
        self._assert_origin()
        self._assert_native_outcome_settled()
        _require(isinstance(self._execution, _NativeExecutionPort)
                 and self._retired is False and self._uncertain is False)
        self._retain()  # Before lock entry and every callback/acquisition.
        try:
            with self._lock:
                _require(not self._uncertain and not self._retired and not self._busy)
                retirement = _READ_RETIREMENTS.get(id(self))
                if retirement is not None:
                    _require(type(function) is MethodType and function.__self__ is retirement
                             and function.__func__ is _ReadBindingRetirement.retire
                             and self._read_retirement is retirement)
                self._busy = True
            call = _ExecutionCall()
            self._execution_calls.append(call)
            _require(self._execution.assert_bound(self) is None and not self._uncertain)
            def invoke():
                try:
                    with self._lock:
                        self._assert_origin()
                        _require(not call.started and not self._uncertain and not self._retired)
                        call.started, call.thread = True, get_ident()
                        self._dispatch = call
                    value = function()
                    _require(not self._uncertain)
                    self._assert_native_outcome_settled()
                    call.value, call.finished = value, True
                    return value
                except BaseException:
                    self.retain_failure()
                    raise
            result = self._execution.execute(self, invoke)
            with self._lock:
                _require(call.started and call.finished and result is call.value and not self._uncertain)
                self._assert_native_outcome_settled()
                self._dispatch = None
                self._busy = False
                self._execution_calls.remove(call)
            return result
        except BaseException as error:
            self.retain_failure()
            if isinstance(error, Exception):
                raise OffloadAdmissionError() from None
            raise

    def prepare_fresh_binding(self):
        """Explicit private native read-handle preparation; never a passive read."""
        def prepare():
            _require(self._api is None and not self._chain)
            if self.__factory is _WindowsApi:self._construct_default_api()
            else:self._api = self._factory(self)  # Preserve custom __new__/factory hooks.
            self._chain = self._api.prepare(self.cache_root)
            _require(type(self._chain) is tuple and 1 <= len(self._chain) <= _MAX_DEPTH)
            self._check_bound()
        return self._run(prepare)

    def _check_bound(self):
        _require(self._api is not None and self._chain)
        for handle, identity in self._chain:
            _require(type(identity) is bytes and len(identity) == 24 and self._api.identity(handle) == identity)

    def assert_bound(self):
        return self._run(self._check_bound)

    def _retire_unused_read_binding(self):
        """Close only an unused, never-shared read chain; no staging credit."""
        self._assert_origin()  # Invalid copies cannot poison another owner.
        _require(self._api is not None and isinstance(self._execution, _NativeExecutionPort)
                 and type(self._accounting) is _JournalCoreBinding
                 and self._accounting._core is self
                 and self._retired is False and self._uncertain is False)
        self._accounting._assert_origin()
        retirement = None
        admitted = False
        try:
            with self._lock:
                _require(self._retired is False and self._uncertain is False)
                with _CUSTODY_LOCK:
                    # Closing an existing prepared binding never creates a new
                    # custody admission, even after a rejected/retired retry.
                    _require(_CUSTODY.get(id(self)) is self)
                    admitted = True
                    try:
                        _require(id(self) not in _READ_RETIREMENTS
                                 and len(_READ_RETIREMENTS) < _MAX_OWNERS)
                        retirement = _ReadBindingRetirement(self)
                        self._read_retirement = retirement
                        _READ_RETIREMENTS[id(self)] = retirement
                    except BaseException:
                        self._uncertain = True
                        _CUSTODY[id(self)] = self
                        if retirement is not None:
                            self._read_retirement = retirement
                            _READ_RETIREMENTS[id(self)] = retirement
                        raise
            _require(self._run(retirement.retire) is None)
            retirement.check('acknowledged')
            self._retirement_kind = 'read-binding'
            retirement.check('published')
            retirement.release()
        except BaseException as error:
            if admitted and not (retirement is not None and retirement.released):
                # Only a genuine admitted, uncommitted operation can retain its
                # reserved slot. The snapshot survives swapped Core fields.
                self._uncertain = True
                with _CUSTODY_LOCK:
                    _CUSTODY[id(self)] = self
                    if retirement is not None:
                        self._read_retirement = retirement
                        _READ_RETIREMENTS[id(self)] = retirement
            if isinstance(error, Exception):
                raise OffloadAdmissionError() from None
            raise

    def create_staging(self, reservation):
        def create():
            self._check_bound()
            _require(self._namespace is None and type(reservation) is int and 0 < reservation <= STAGING_LIMIT)
            self._reservation = reservation
            self._namespace = self._api.create_directory(self._chain[-1][0], '.aisb-offload-v1')
            self._stage = self._api.create_directory(self._namespace[0], self._leaf)
            self._check_directories()
            return self.cache_root / '.aisb-offload-v1' / self._leaf
        return self._run(create)

    def _check_directories(self):
        self._check_bound()
        for position, value in enumerate((self._namespace, self._stage)):
            _require(type(value) is tuple and len(value) == 3 and type(value[1]) is bytes and len(value[1]) == 24)
            handle, identity, acl = value
            _require(self._api.identity(handle) == identity)
            self._api.kind(handle, True)
            expected = self._protected[position] if self._protected else (acl, _PRIVATE_CONTROL)
            _require(self._api.permissions(handle) == expected)
            if self._protected is not None:
                self._api.assert_protected(handle, expected)

    def _inventory(self):
        namespace, stage = self._namespace, self._stage
        def actual(handle, identity, parent):
            result = {}
            for row in self._api.entries(handle):
                name, file_id, size, allocated, directory = row
                if name in ('.', '..'):
                    _require(directory and size == 0 and file_id == (identity if name == '.' else parent)[8:])
                else:
                    _require(name not in result)
                    result[name] = row
            return result
        root_rows = actual(namespace[0], namespace[1], self._chain[-1][1])
        _require(set(root_rows) == {self._leaf})
        row = root_rows[self._leaf]
        _require(row[1] == stage[1][8:] and row[2] == 0 and row[4])
        rows = actual(stage[0], stage[1], namespace[1])
        _require(set(rows).issubset({'index.json'}))
        if self._index is None:
            _require(not rows)
        else:
            facts = self._api.file_facts(self._index)
            _require(set(rows) == {'index.json'} and facts[0][:8] == stage[1][:8])
            row = rows['index.json']
            _require(not row[4] and row[1] == facts[0][8:] and row[2:4] == facts[1:])
            _require(sum(facts[1:]) <= self._reservation)
        return root_rows, rows

    def seal_staging(self):
        def seal():
            _require(self._stage is not None and self._sealed is None and self._protected is None)
            self._check_directories()
            rows = self._api.entries(self._stage[0])
            names = {row[0] for row in rows if row[0] not in ('.', '..')}
            _require(names.issubset({'index.json'}))
            if names:
                self._index = self._api.open_index(self._stage[0])
            self._inventory()
            # Only these two exclusive, newly FILE_CREATED private objects.
            # Inherited/non-private descriptors are refused before this setter.
            stage_protection = self._api.protect(self._stage[0], (self._stage[2], _PRIVATE_CONTROL))
            namespace_protection = self._api.protect(self._namespace[0], (self._namespace[2], _PRIVATE_CONTROL))
            self._protected = namespace_protection, stage_protection
            if self._index is not None:
                self._api.guard(self._index)
            self._api.guard(self._stage[0])
            self._api.guard(self._namespace[0])
            first = self._snapshot()
            _require(first == self._snapshot())
            self._sealed = first
        return self._run(seal)

    def _snapshot(self):
        _require(len(self._guards) == (3 if self._index is not None else 2))
        for guard in self._guards:
            self._api.check_guard(guard)
        self._check_directories()
        value = self._inventory()
        for guard in self._guards:
            self._api.check_guard(guard)
        return value

    def assert_sealed(self):
        def check():
            _require(self._sealed is not None and self._snapshot() == self._sealed)
        return self._run(check)

    def retire_fresh_staging(self):
        """Parent backend calls only after its exact owned-worker retirement."""
        def retire():
            _require(self._sealed is not None and self._snapshot() == self._sealed)
            # No recursive/path cleanup or restoration of an unknown old tree.
            # Each fixed disposition targets the held original file object.
            for guard in self._guards:
                self._api.retire_guard(guard)
            self._check_directories()
            _require(self._inventory() == self._sealed)
            if self._index is not None:
                self._api.delete(self._index)
                self._api.close(self._index)
            for value in (self._stage, self._namespace):
                self._api.delete(value[0])
                self._api.close(value[0])
            for handle, _ in reversed(self._chain):
                self._api.close(handle)
            _require(not self._allocations and all(handle.closed for handle in self._handles))
            self._retirement_kind = 'staging'
            self._retired = True
            with _CUSTODY_LOCK:
                _CUSTODY.pop(id(self), None)
        return self._run(retire)

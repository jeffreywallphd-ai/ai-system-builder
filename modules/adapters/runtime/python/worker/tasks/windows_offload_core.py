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
_WRITE_MASK = 0x156
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
    ace = struct.pack('<BBHI', 1, 0, 20, _WRITE_MASK) + _WORLD
    _require(size + len(ace) <= 65535 and count < 65535)
    return struct.pack('<BBHHH', revision, 0, size + len(ace), count + 1, 0) + ace + acl[8:]


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


class _WindowsApi:
    """Narrow actual OS implementation; Core retains every call and output slot."""
    def __init__(self, owner):
        _require(os.name == 'nt' and struct.calcsize('P') == 8)
        self.owner = owner
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.a = C.WinDLL('advapi32', use_last_error=True)
        self.n = C.WinDLL('ntdll', use_last_error=True)
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

    def _descriptor(self, acl):
        value, descriptor = C.create_string_buffer(_acl(acl)), _Descriptor()
        self.call(self.a.IsValidAcl, value, keep=(value,))
        self.call(self.a.InitializeSecurityDescriptor, C.byref(descriptor), 1, keep=(descriptor,))
        self.call(self.a.SetSecurityDescriptorDacl, C.byref(descriptor), 1, value, 0, keep=(value, descriptor))
        self.call(self.a.SetSecurityDescriptorControl, C.byref(descriptor), 0x1500, 0x1000, keep=(value, descriptor))
        self.call(self.a.IsValidSecurityDescriptor, C.byref(descriptor), keep=(value, descriptor))
        return value, descriptor

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
        acl = self._private_acl()
        descriptor = self._descriptor(acl)
        handle = self.open(parent, name, 0x700a1, create=True, share=0, security=descriptor)
        _require(self.permissions(handle) == (acl, _PRIVATE_CONTROL))
        return handle, self.identity(handle), acl

    def permissions(self, handle):
        acl, descriptor, control, revision = _PTR(), _PTR(), _U16(), _U32()
        allocation = (descriptor, acl)
        self.owner._allocations.append(allocation)
        self.call(self.a.GetSecurityInfo, handle.value, 1, 4, None, None, C.byref(acl), None, C.byref(descriptor),
                  valid=lambda code: type(code) is int and code == 0, keep=(handle, acl, descriptor, control, revision))
        _require(acl.value and descriptor.value)
        self.call(self.a.IsValidAcl, acl, keep=(descriptor, acl))
        size = _U16.from_address(acl.value + 2).value
        _require(8 <= size <= 65535)
        self.call(self.a.GetSecurityDescriptorControl, descriptor, C.byref(control), C.byref(revision), keep=(descriptor, control, revision))
        result = C.string_at(acl, size), control.value & _ACL_CONTROL
        # LocalFree is one attempt. The pending call retains this exact pointer.
        self.call(self.k.LocalFree, descriptor, valid=lambda result: result is None, keep=(descriptor, acl))
        self.owner._allocations.remove(allocation)
        return result

    def protect(self, handle, original):
        _require(type(original) is tuple and len(original) == 2 and original[1] == _PRIVATE_CONTROL)
        _require(self.permissions(handle) == original)
        replacement = _acl(original[0], deny=True)
        buffers = self._descriptor(replacement)
        self.call(self.n.NtSetSecurityObject, handle.value, 4, C.byref(buffers[1]),
                  valid=lambda status: type(status) is int and status == 0, keep=(handle, buffers))
        _require(self.permissions(handle) == (replacement, _PRIVATE_CONTROL))
        return replacement, _PRIVATE_CONTROL

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
        self._execution = _execution
        self._execution_calls = []
        self._dispatch = None
        self._lock = RLock()
        self._busy = self._uncertain = self._retired = False
        self._retirement_kind = None
        self._read_retirement = None
        self._pending = None
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

    def _assert_origin(self):
        _require(type(self) is WindowsOffloadCore and getattr(self, '_WindowsOffloadCore__origin', None) is self)
        _require(self._api is None or getattr(self._api, 'owner', None) is self)

    def _retain(self):
        self._assert_origin()
        with _CUSTODY_LOCK:
            _require(id(self) in _CUSTODY or len(_CUSTODY) < _MAX_OWNERS)
            _CUSTODY[id(self)] = self

    def retain_failure(self):
        self._retain()
        self._uncertain = True

    def _native_call(self, function, args, valid, keep):
        self._retain()
        _require(type(self._dispatch) is _ExecutionCall and self._dispatch.started
                 and not self._dispatch.finished and self._dispatch.thread == get_ident())
        _require(self._pending is None and not self._uncertain)
        self._pending = (function, args, valid, keep)
        try:
            value = function(*args)
            _require(valid(value) and not self._uncertain)
            self._pending = None
            return value
        except BaseException:
            self.retain_failure()
            raise

    def _run(self, function):
        self._assert_origin()
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
                    call.value, call.finished = value, True
                    return value
                except BaseException:
                    self.retain_failure()
                    raise
            result = self._execution.execute(self, invoke)
            with self._lock:
                _require(call.started and call.finished and result is call.value and not self._uncertain)
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
            self._api = self._factory(self)
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
            self._protected = tuple(self._api.protect(value[0], (value[2], _PRIVATE_CONTROL)) for value in (self._namespace, self._stage))
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

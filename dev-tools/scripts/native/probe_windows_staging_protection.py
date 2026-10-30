"""Model-free Windows directory protection diagnostic; never restart authority.

Default/--plan is effect-free. --self-test has no caller path, ACL, command or PID.
It uses only fresh, handle-created empty fixtures beneath artifacts/tmp. It never
opens retained offload data. Microsoft FSCTL_REQUEST_OPLOCK / SetSecurityInfo are
the initial research references; directory content notifications alone are advisory.
+DACL changes use single-object NtSetSecurityObject, without Win32 propagation.
"""
from __future__ import annotations

import argparse
import ctypes as C
import json
import os
from pathlib import Path
import re
import struct
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = 'windows-staging-protection-probe-v1'
CASES = ('oplock-only', 'permissions-only', 'combined')
WRITE_MASK = 0x156  # Add file/subdirectory, write EA/attributes, delete child.
ACL_CONTROL_MASK = 0x150c
OPLOCK_READ = 0x00000001
OPLOCK_HANDLE = 0x00000002  # Windows SDK winioctl.h; WRITE is 0x4.
OPLOCK_RH = OPLOCK_READ | OPLOCK_HANDLE
WAIT_MS = 1500
MAX_ANCESTORS = 128
_RETAINED = []  # Keep buffers/handles alive if native completion is unconfirmed.
NATIVE_SECONDS = 30
REPORT_SECONDS = 5
FIXTURE_PROFILE = 'fresh-protected-current-user-v1'
PRIVATE_CONTROL = 0x1004
PRIVATE_ACCESS = 0x001701ff  # File rights + delete/read-control/write-DAC/sync.
U16, U32, I32, PTR = C.c_uint16, C.c_uint32, C.c_int32, C.c_void_p


class ProbeError(Exception):
    def __init__(self, stage, code=0, *, state=None, frame=None):
        if not re.fullmatch('[a-z][a-z0-9-]{0,63}', stage): stage = 'invalid-stage'
        self.stage = stage
        self.code = code if type(code) is int and 0 <= code <= 0xffffffff else 0
        self.state=None
        if type(state) is dict and set(state)=={'acl_equal','expected_dacl_control','actual_dacl_control'} and type(state['acl_equal']) is bool and all(type(state[k]) is int and 0 <= state[k] <= 65535 for k in ['expected_dacl_control','actual_dacl_control']):
            self.state=state.copy()
        self.frame=None
        if type(frame) is dict and set(frame)=={'structure_version','structure_length','original_level','new_level','flags','transferred_bytes','native_status'} and all(type(v) is int and 0 <= v <= 0xffffffff for v in frame.values()):
            self.frame=frame.copy()
        self.secondary=[]
        super().__init__('The directory protection diagnostic did not complete.')


def require(value, stage, code=0):
    if not value: raise ProbeError(stage, code)


def failure_detail(error,phase):
    row={'phase':phase,'stage':error.stage,'native_code':error.code}
    if error.state is not None:row['permission_state']=error.state.copy()
    if error.frame is not None:row['oplock_state']=error.frame.copy()
    return row


def retire_reference(value):
    for i, current in enumerate(_RETAINED):
        if current is value:
            del _RETAINED[i]
            return
    raise ProbeError('native-reference-unavailable')


class UnicodeString(C.Structure):
    _fields_ = [('length', U16), ('maximum', U16), ('buffer', PTR)]


class ObjectAttributes(C.Structure):
    _fields_ = [('length', U32), ('root', PTR), ('name', C.POINTER(UnicodeString)),
                ('attributes', U32), ('security', PTR), ('quality', PTR)]


class IoStatus(C.Structure):
    _fields_ = [('status', PTR), ('information', C.c_size_t)]


class Overlapped(C.Structure):
    _fields_ = [('internal', C.c_size_t), ('internal_high', C.c_size_t),
                ('offset', U32), ('offset_high', U32), ('event', PTR)]


class SecurityDescriptor(C.Structure):
    _fields_ = [('revision',C.c_ubyte),('zero',C.c_ubyte),('control',U16),
                ('owner',PTR),('group',PTR),('sacl',PTR),('dacl',PTR)]


class TokenUser(C.Structure):
    _fields_=[('sid',PTR),('attributes',U32)]


class OplockInput(C.Structure):
    _fields_ = [('version', U16), ('length', U16), ('level', U32), ('flags', U32)]


class OplockOutput(C.Structure):
    _fields_ = [('version', U16), ('length', U16), ('original', U32),
                ('new', U32), ('flags', U32), ('access', U32), ('share', U16)]


def deny_writes(acl, sid):
    """Prepend one non-inheriting deny ACE; preserve every original ACL byte."""
    require(type(acl) is bytes and 8 <= len(acl) <= 65535, 'acl-size')
    revision, zero, size, count, zero2 = struct.unpack('<BBHHH', acl[:8])
    require(revision in (2, 4) and size == len(acl) and count < 65535, 'acl-header')
    require(type(sid) is bytes and len(sid) == 12 and sid == b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00', 'world-sid')
    ace = struct.pack('<BBHI', 1, 0, 8 + len(sid), WRITE_MASK) + sid
    require(size + len(ace) <= 65535, 'acl-capacity')
    return struct.pack('<BBHHH', revision, zero, size + len(ace), count + 1, zero2) + ace + acl[8:]


def private_acl(sid):
    require(type(sid) is bytes and 8 <= len(sid) <= 68 and sid[0] == 1 and sid[1] <= 15 and len(sid)==8+4*sid[1],'private-sid')
    ace=struct.pack('<BBHI',0,0,8+len(sid),PRIVATE_ACCESS)+sid
    return struct.pack('<BBHHH',2,0,8+len(ace),1,0)+ace


def plan():
    return {'schema': SCHEMA, 'status': 'plan-only', 'cases': list(CASES),
            'fixture_profile':FIXTURE_PROFILE,'inherited_acl_round_trip_qualified':False,
            'fixture': 'Fresh handle-created synthetic NTFS directories only.',
            'native_effects': False, 'retained_data_accessed': False,
            'restart_admitted': False, 'parent_qualification': False,
            'model_or_worker_started': False,
            'limits': 'Directory primitive only; tree, mappings, protected journal and crash lifetime remain unqualified.'}


class Windows:
    def __init__(self):
        require(os.name == 'nt' and struct.calcsize('P') == 8, 'platform')
        self.uncertain = False
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.a = C.WinDLL('advapi32', use_last_error=True)
        self.n = C.WinDLL('ntdll', use_last_error=True)
        signatures = [
            (self.k, 'CreateFileW', [C.c_wchar_p,U32,U32,PTR,U32,U32,PTR], PTR),
            (self.k, 'CloseHandle', [PTR], I32),
            (self.k, 'GetFileInformationByHandleEx', [PTR,I32,PTR,U32], I32),
            (self.k, 'GetVolumeInformationByHandleW', [PTR,C.c_wchar_p,U32,PTR,PTR,PTR,C.c_wchar_p,U32], I32),
            (self.k, 'SetFileInformationByHandle', [PTR,I32,PTR,U32], I32),
            (self.k, 'CreateEventW', [PTR,I32,I32,C.c_wchar_p], PTR),
            (self.k, 'WaitForSingleObject', [PTR,U32], U32),
            (self.k, 'DeviceIoControl', [PTR,U32,PTR,U32,PTR,U32,PTR,C.POINTER(Overlapped)], I32),
            (self.k, 'CancelIoEx', [PTR,C.POINTER(Overlapped)], I32),
            (self.k, 'GetOverlappedResult', [PTR,C.POINTER(Overlapped),C.POINTER(U32),I32], I32),
            (self.k, 'LocalFree', [PTR], PTR),
            (self.k, 'GetCurrentProcess', [], PTR),
            (self.a, 'OpenProcessToken', [PTR,U32,C.POINTER(PTR)], I32),
            (self.a, 'GetTokenInformation', [PTR,I32,PTR,U32,C.POINTER(U32)], I32),
            (self.a, 'IsValidSid', [PTR], I32),
            (self.a, 'GetSecurityInfo', [PTR,I32,U32,PTR,PTR,C.POINTER(PTR),PTR,C.POINTER(PTR)], U32),
            (self.a, 'GetSecurityDescriptorControl', [PTR,C.POINTER(U16),C.POINTER(U32)], I32),
            (self.a, 'InitializeSecurityDescriptor', [PTR,U32], I32),
            (self.a, 'SetSecurityDescriptorDacl', [PTR,I32,PTR,I32], I32),
            (self.a, 'SetSecurityDescriptorControl', [PTR,U16,U16], I32),
            (self.a, 'IsValidSecurityDescriptor', [PTR], I32),
            (self.n, 'NtSetSecurityObject', [PTR,U32,PTR], I32),
            (self.a, 'IsValidAcl', [PTR], I32),
            (self.n, 'NtCreateFile', [C.POINTER(PTR),U32,C.POINTER(ObjectAttributes),C.POINTER(IoStatus),PTR,U32,U32,U32,U32,PTR,U32], I32),
        ]
        for library, name, args, result in signatures:
            function = getattr(library, name); function.argtypes = args; function.restype = result

    def close(self, handle):
        require(bool(self.k.CloseHandle(handle)), 'handle-close', C.get_last_error())

    def directory(self, handle):
        attributes = (U32 * 2)()
        require(self.k.GetFileInformationByHandleEx(handle, 9, C.byref(attributes), C.sizeof(attributes)), 'directory-facts', C.get_last_error())
        require(attributes[0] & 0x10 and not attributes[0] & 0x400, 'redirected-directory')

    def identity(self, handle):
        value=(C.c_ubyte * 24)()  # FILE_ID_INFO: volume serial + 128-bit file ID.
        require(self.k.GetFileInformationByHandleEx(handle,18,C.byref(value),C.sizeof(value)), 'file-identity', C.get_last_error())
        raw=bytes(value)
        require(any(raw[:8]) and any(raw[8:]),'file-identity-unavailable')
        return raw

    def relative(self, parent, name, access, *, create=False, directory=True, share=7, initial_security=None):
        require(type(name) is str and re.fullmatch('[a-zA-Z0-9_. -]{1,255}', name) and name not in ('.','..') and name[-1] not in '. ', 'child-name')
        text = C.create_unicode_buffer(name)
        us = UnicodeString(len(name.encode('utf-16-le')), (len(name)+1)*2, C.cast(text,PTR))
        attrs = ObjectAttributes(C.sizeof(ObjectAttributes), parent, C.pointer(us), 0x40, None, None)
        if initial_security is not None:
            require(create and directory and type(initial_security) is tuple and len(initial_security)==2 and type(initial_security[1]) is SecurityDescriptor,'creation-security')
            attrs.security=C.cast(C.byref(initial_security[1]),PTR)
        io = IoStatus(); result = PTR()
        buffers=(self,text,us,attrs,io,result,initial_security)
        _RETAINED.append(buffers)  # Before issue, including interrupted construction.
        try:
            status = self.n.NtCreateFile(C.byref(result), access, C.byref(attrs), C.byref(io), None, 0x80, share, 2 if create else 1, 0x200000 | (1 if directory else 0x40), None, 0)
        except BaseException:
            self.uncertain=True
            raise
        if status > 0:
            self.uncertain=True
            raise ProbeError('native-open-completion-unconfirmed',status)
        retire_reference(buffers)
        if status < 0: raise ProbeError('native-create' if create else 'native-open', status & 0xffffffff)
        try:
            require(io.information == (2 if create else 1), 'exclusive-create' if create else 'open-disposition')
            if directory: self.directory(result.value)
            return result.value
        except BaseException:
            self.close(result.value); raise

    def ancestors(self):
        """Hold the real drive-to-fixed-namespace directory chain, no traversal."""
        path = ROOT / 'artifacts/tmp'
        require(path.is_absolute() and re.fullmatch(r'[A-Za-z]:\\', path.anchor) is not None and 1 <= len(path.parts) <= MAX_ANCESTORS, 'fixed-namespace')
        access = 0x20000 | 0x80 | 0x20  # READ_CONTROL, READ_ATTRIBUTES, TRAVERSE.
        handles = []
        try:
            drive = self.k.CreateFileW('\\\\?\\' + path.anchor, access, 3, None, 3, 0x42200000, None)
            require(drive not in (None,C.c_void_p(-1).value), 'drive-open', C.get_last_error())
            handles.append(drive); self.directory(drive)
            fs = C.create_unicode_buffer(32); flags=U32()
            require(self.k.GetVolumeInformationByHandleW(drive,None,0,None,None,C.byref(flags),fs,32) and fs.value == 'NTFS' and flags.value & 8, 'ntfs-required', C.get_last_error())
            for part in path.parts[1:]:
                child = self.relative(handles[-1], part, access, share=3)
                # Ancestors deny delete sharing; all fixture effects use handles.
                handles.append(child)
            return handles
        except BaseException:
            if self.uncertain:_RETAINED.append(handles)
            else:
                for handle in reversed(handles): self.close(handle)
            raise

    def permissions(self, handle):
        acl, descriptor = PTR(), PTR()
        result = self.a.GetSecurityInfo(handle,1,4,None,None,C.byref(acl),None,C.byref(descriptor))
        require(result == 0, 'read-permissions', result)
        try:
            require(descriptor.value and acl.value, 'read-permissions')
            require(self.a.IsValidAcl(acl), 'original-acl')
            size = U16.from_address(acl.value+2).value
            require(8 <= size <= 65535, 'original-acl-size')
            control, revision = U16(), U32()
            require(self.a.GetSecurityDescriptorControl(descriptor,C.byref(control),C.byref(revision)), 'permission-control', C.get_last_error())
            return C.string_at(acl,size), control.value & ACL_CONTROL_MASK
        finally:
            if descriptor.value:require(not self.k.LocalFree(descriptor), 'security-buffer-release')

    def set_permissions(self, handle, acl, control):
        # Direct single-object operation; SetSecurityInfo recursively propagates
        # inheritable ACEs and must not be used on this fixture boundary.
        require(type(control) is int and control & 4 and not control & ~ACL_CONTROL_MASK,'dacl-control')
        require(not control & 0x100,'dacl-propagation-denied')
        require(type(acl) is bytes and 8 <= len(acl) <= 65535,'replacement-acl-size')
        value=C.create_string_buffer(acl);descriptor=SecurityDescriptor()
        require(self.a.IsValidAcl(value),'replacement-acl')
        require(self.a.InitializeSecurityDescriptor(C.byref(descriptor),1),'descriptor-initialize',C.get_last_error())
        require(self.a.SetSecurityDescriptorDacl(C.byref(descriptor),1,value,bool(control & 8)),'descriptor-dacl',C.get_last_error())
        require(self.a.SetSecurityDescriptorControl(C.byref(descriptor),0x1500,control & 0x1500),'descriptor-control',C.get_last_error())
        require(self.a.IsValidSecurityDescriptor(C.byref(descriptor)),'replacement-descriptor')
        buffers=(self,value,descriptor)
        _RETAINED.append(buffers)
        try:result=self.n.NtSetSecurityObject(handle,4,C.byref(descriptor))
        except BaseException:
            self.uncertain=True
            raise
        if result > 0:
            self.uncertain=True
            raise ProbeError('security-completion-unconfirmed',result)
        retire_reference(buffers)
        require(result == 0,'set-permissions',result & 0xffffffff)

    def current_user_sid(self):
        token=PTR()
        require(self.a.OpenProcessToken(self.k.GetCurrentProcess(),8,C.byref(token)),'own-token-query',C.get_last_error())
        try:
            size=U32()
            ok=self.a.GetTokenInformation(token,1,None,0,C.byref(size))
            require(not ok and C.get_last_error()==122 and C.sizeof(TokenUser)<=size.value<=4096,'own-token-size',C.get_last_error())
            buffer=C.create_string_buffer(size.value);capacity=size.value
            require(self.a.GetTokenInformation(token,1,buffer,capacity,C.byref(size)),'own-token-user',C.get_last_error())
            require(C.sizeof(TokenUser)<=size.value<=capacity,'own-token-bound')
            sid=C.cast(buffer,C.POINTER(TokenUser)).contents.sid
            begin=C.addressof(buffer);end=begin+size.value
            require(sid is not None and begin <= sid <= end-8,'own-token-sid-bound')
            header=C.string_at(sid,8);length=8+4*header[1]
            require(header[0]==1 and header[1]<=15 and sid+length<=end,'own-token-sid-length')
            require(self.a.IsValidSid(sid),'own-token-sid')
            return C.string_at(sid,length)
        finally:self.close(token.value)

    def private_root(self,parent,name):
        acl=private_acl(self.current_user_sid());value=C.create_string_buffer(acl);descriptor=SecurityDescriptor()
        require(self.a.IsValidAcl(value),'private-acl')
        require(self.a.InitializeSecurityDescriptor(C.byref(descriptor),1),'private-descriptor',C.get_last_error())
        require(self.a.SetSecurityDescriptorDacl(C.byref(descriptor),1,value,False),'private-dacl',C.get_last_error())
        require(self.a.SetSecurityDescriptorControl(C.byref(descriptor),0x1500,0x1000),'private-control',C.get_last_error())
        require(self.a.IsValidSecurityDescriptor(C.byref(descriptor)),'private-descriptor-valid')
        handle=self.relative(parent,name,0x10000 | 0x40000 | 0x20000 | 0x80 | 0x21,create=True,initial_security=(value,descriptor))
        return handle,acl

    def delete_owned(self, handle):
        value=I32(1)
        require(self.k.SetFileInformationByHandle(handle,4,C.byref(value),C.sizeof(value)), 'owned-empty-cleanup', C.get_last_error())


class Oplock:
    def __init__(self, native, handle):
        self.native=native; self.handle=handle; self.finished=False
        self.event=native.k.CreateEventW(None,1,0,None)
        require(self.event, 'event-create', C.get_last_error())
        self.overlapped=Overlapped();self.overlapped.event=self.event
        self.input=OplockInput(1,C.sizeof(OplockInput),OPLOCK_RH,1)
        self.output=OplockOutput()
        _RETAINED.append(self)
        try:
            ok=native.k.DeviceIoControl(handle,0x00090240,C.byref(self.input),C.sizeof(self.input),C.byref(self.output),C.sizeof(self.output),None,C.byref(self.overlapped))
            error=C.get_last_error()
        except BaseException:
            native.uncertain=True
            raise
        if ok or error != 997:
            native.close(self.event); self.event=None
            retire_reference(self)
            raise ProbeError('oplock-not-granted',error)

    def broken(self):
        return self.native.k.WaitForSingleObject(self.event,0) == 0

    def security_break(self):
        self.completed_break()
        if not (self.output.original == OPLOCK_RH and self.output.new == OPLOCK_READ and self.output.flags & 1 and not self.output.flags & ~3):
            raise ProbeError('security-break-transition',frame=self.frame())
        return True

    def advisory_break(self):
        self.completed_break()
        # Cache-state acknowledgment can be reported even though directory
        # content changes proceed. run_case must prove child creation separately.
        if not (self.output.original == OPLOCK_RH and self.output.new == 0 and not self.output.flags & ~3):
            raise ProbeError('advisory-break-transition',frame=self.frame())
        return True

    def frame(self):
        return {'structure_version':int(self.output.version),'structure_length':int(self.output.length),
                'original_level':int(self.output.original),'new_level':int(self.output.new),
                'flags':int(self.output.flags),'transferred_bytes':getattr(self,'transferred',0),
                'native_status':int(self.overlapped.internal)&0xffffffff}

    def completed_break(self):
        require(self.broken(),'security-break-missing')
        transferred=U32()
        ok=self.native.k.GetOverlappedResult(self.handle,C.byref(self.overlapped),C.byref(transferred),0)
        self.transferred=transferred.value
        if not (ok and self.overlapped.internal == 0):raise ProbeError('security-break-completion',C.get_last_error(),frame=self.frame())
        if not (transferred.value == C.sizeof(self.output) and self.output.version == 1 and self.output.length == C.sizeof(self.output)):
            raise ProbeError('security-break-frame',frame=self.frame())

    def release(self):
        if self.finished:return
        k=self.native.k
        canceled=k.CancelIoEx(self.handle,C.byref(self.overlapped));error=C.get_last_error()
        require(canceled or error == 1168,'oplock-cancel',error)
        if k.WaitForSingleObject(self.event,WAIT_MS) != 0:
            raise ProbeError('oplock-completion-unconfirmed')
        transferred=U32();ok=k.GetOverlappedResult(self.handle,C.byref(self.overlapped),C.byref(transferred),0);error=C.get_last_error()
        require(ok or error == 995,'oplock-completion',error)
        self.native.close(self.handle);self.handle=None
        self.native.close(self.event);self.event=None;self.finished=True
        retire_reference(self)


class Fixture:
    def __init__(self, native):
        self.n=native;self.parents=[];self.root=None;self.mutator=None;self.lock=None
        self.original=None;self.mutated=False;self.uncertain=False;self.id=uuid.uuid4().hex
        try:
            self.parents=native.ancestors()
            # FILE_CREATE must return FILE_CREATED. Never open/adopt a collision.
            self.root,created_acl=native.private_root(self.parents[-1],self.id)
            self.identity=native.identity(self.root)
            self.original=native.permissions(self.root)
            self.assert_permissions((created_acl,PRIVATE_CONTROL),'creation-profile-unavailable')
            self.mutator=native.relative(self.parents[-1],self.id,0x40000 | 0x20000 | 0x80)
            require(native.identity(self.mutator)==self.identity,'mutator-identity-mismatch')
        except BaseException as failure:
            primary=failure if isinstance(failure,ProbeError) else ProbeError('constructor-interrupted-or-error')
            try:
                if not self.cleanup():
                    primary.secondary.append(failure_detail(ProbeError('constructor-cleanup-unconfirmed'),'constructor-cleanup'))
            except BaseException as cleanup:
                secondary=cleanup if isinstance(cleanup,ProbeError) else ProbeError('constructor-cleanup-error')
                primary.secondary.append(failure_detail(secondary,'constructor-cleanup'))
            raise primary from None

    def protect(self):
        acl,control=self.original
        sid=b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00'
        expected=(deny_writes(acl,sid),control | 0x1000)
        self.mutated=True  # Before any potentially interrupted native update.
        self.n.set_permissions(self.root,*expected)
        self.assert_permissions(expected,'permission-protection-mismatch')

    def assert_permissions(self,expected,stage):
        actual=self.n.permissions(self.root)
        if actual!=expected:
            raise ProbeError(stage,state={'acl_equal':actual[0]==expected[0],
                                         'expected_dacl_control':expected[1],
                                         'actual_dacl_control':actual[1]})

    def guard(self):
        handle=self.n.relative(self.parents[-1],self.id,0x20000 | 0x80 | 1)
        try:
            require(self.n.identity(handle)==self.identity,'guard-identity-mismatch')
            self.lock=Oplock(self.n,handle)
        except BaseException:self.n.close(handle);raise

    def child_allowed(self):
        try:handle=self.n.relative(self.root,'synthetic-child',0x10000 | 0x2,create=True,directory=False)
        except ProbeError as error:
            if error.code == 0xc0000022:return False
            raise
        try:self.n.delete_owned(handle)
        finally:self.n.close(handle)
        return True

    def cleanup(self):
        if self.uncertain or self.n.uncertain:
            _RETAINED.append(self);return False
        try:
            if self.lock:self.lock.release()
            if self.root:
                if self.original:
                    if self.mutated:self.n.set_permissions(self.root,*self.original)
                    self.assert_permissions(self.original,'permission-restoration-mismatch')
                if self.mutator:self.n.close(self.mutator);self.mutator=None
                self.n.delete_owned(self.root)
                self.n.close(self.root);self.root=None
            for handle in reversed(self.parents):self.n.close(handle)
            self.parents=[]
            return True
        except BaseException:
            self.uncertain=True;_RETAINED.append(self);raise


def record_failure(facts,error,phase):
    facts['status']='failed'
    row=failure_detail(error,phase)
    if 'failure_stage' in facts:
        facts.setdefault('additional_failures',[]).append(row)
    else:
        facts.update(failure_stage=error.stage,native_code=error.code,failure_phase=phase)
        if error.state is not None:facts['permission_state']=error.state
        if error.frame is not None:facts['oplock_state']=error.frame
    if error.secondary:facts.setdefault('additional_failures',[]).extend(error.secondary)


def run_case(native, name):
    require(name in CASES, 'case')
    fixture=Fixture(native);worker=None;worker_reference=None;entered=threading.Event();done=threading.Event();result={};facts={'case':name,'fixture_id':fixture.id}
    try:
        if name != 'oplock-only':fixture.protect()
        if name != 'permissions-only':fixture.guard()
        if name == 'oplock-only':
            facts['child_creation_allowed']=fixture.child_allowed()
            facts['advisory_break_observed']=fixture.lock.broken()
            require(facts['child_creation_allowed'] and facts['advisory_break_observed'],'advisory-control')
            facts['break_validated']=fixture.lock.advisory_break()
            facts['advisory_acknowledgment_reported']=bool(fixture.lock.output.flags & 1)
            facts['oplock_state']=fixture.lock.frame()
        else:
            facts['child_creation_denied']=not fixture.child_allowed()
            require(facts['child_creation_denied'],'write-denial-control')
            if name == 'combined':
                facts['guard_broken_before_security_change']=fixture.lock.broken()
                require(not facts['guard_broken_before_security_change'],'guard-already-broken')
            def mutation():
                try:
                    entered.set()
                    native.set_permissions(fixture.mutator,*fixture.original);result['completed']=True
                except ProbeError as error:result['error']={'stage':error.stage,'native_code':error.code}
                except Exception:result['error']={'stage':'internal-diagnostic-error','native_code':0}
                finally:done.set()
            worker=threading.Thread(target=mutation,daemon=True)
            worker_reference=(worker,fixture,native,entered,done,result)
            _RETAINED.append(worker_reference)  # Before start, including interruption.
            fixture.mutated=True
            worker.start()
            require(entered.wait(WAIT_MS/1000),'security-change-thread-start-unconfirmed')
            if name == 'combined':
                facts['security_change_waited']=not done.wait(WAIT_MS/1000)
                facts['break_observed']=fixture.lock.broken()
                facts['acknowledgment_required']=bool(fixture.lock.output.flags & 1)
                facts['break_validated']=fixture.lock.security_break()
                facts['oplock_state']=fixture.lock.frame()
                fixture.lock.release()
            require(done.wait(WAIT_MS/1000),'security-change-completion-unconfirmed')
            worker.join(WAIT_MS/1000);require(not worker.is_alive(),'thread-exit-unconfirmed')
            require(result.get('completed') is True,'security-change-failed',result.get('error',{}).get('native_code',0))
            facts['security_change_completed']=True
            if name == 'combined':facts['completed_after_guard_release']=True
            if name == 'combined':require(facts['security_change_waited'] and facts['break_observed'] and facts['acknowledgment_required'],'security-barrier-not-established')
        facts['status']='observed'
    except ProbeError as error:
        record_failure(facts,error,'observation')
    finally:
        if fixture.lock and not fixture.lock.finished:
            try:fixture.lock.release()
            except ProbeError as error:
                fixture.uncertain=True;record_failure(facts,error,'guard-release')
        if worker:
            worker.join(WAIT_MS/1000)
            if worker.is_alive():
                fixture.uncertain=True;record_failure(facts,ProbeError('thread-exit-unconfirmed'),'thread-exit')
            elif worker_reference:
                retire_reference(worker_reference)
        try:facts['cleanup_confirmed']=fixture.cleanup()
        except ProbeError as error:
            facts['cleanup_confirmed']=False;record_failure(facts,error,'cleanup')
    return facts


def self_test():
    retained_before=len(_RETAINED)
    value=plan();value.update(status='evidence-collected-review-required',cases=[])
    try:
        native=Windows()
        for name in CASES:
            value['native_effects']=True
            row=run_case(native,name);value['cases'].append(row)
            if not row.get('cleanup_confirmed'):break
    except ProbeError as error:
        value.update(status='failed',failure_stage=error.stage,native_code=error.code)
        if error.state is not None:value['permission_state']=error.state
        if error.frame is not None:value['oplock_state']=error.frame
        if error.secondary:value['additional_failures']=error.secondary.copy()
    except BaseException:value.update(status='failed',failure_stage='interrupted-or-internal-error',native_code=0,cleanup_confirmed=False)
    value['unconfirmed_native_lifetime']=len(_RETAINED)>retained_before
    value['all_cases_observed']=len(value['cases'])==len(CASES) and all(r.get('status')=='observed' and r.get('cleanup_confirmed') is True for r in value['cases'])
    return value


class ProbeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2,'Invalid directory protection probe options. Use --help.\n')


def failed_report(stage):
    value=plan()
    value.update(status='failed',failure_stage=stage,native_effects=True,
                 cleanup_confirmed=False,unconfirmed_native_lifetime=True,
                 all_cases_observed=False,cases=[])
    return value


def encode_report(value):
    text=json.dumps(value,sort_keys=True)+'\n'
    if len(text.encode('utf-8'))>8192:
        text=json.dumps(failed_report('report-size'),sort_keys=True)+'\n'
    return text


class DiagnosticOwner:
    """Only this standalone diagnostic process; no PID/process-management API.

    A fixed watchdog starts before effects. Unknown native users force own-process
    exit without Python object finalization. No app/runtime imports this owner.
    """
    def __init__(self):
        self.stopped=threading.Event();self.lock=threading.Lock();self.claimed=False
        self.stopping=False;self.report_done=threading.Event()
        self.watchdog=threading.Thread(target=self.expire,daemon=True)

    def start(self):self.watchdog.start()

    def claim_report(self):
        with self.lock:
            if self.claimed:return False
            self.claimed=True
            return True

    def expire(self):
        if self.stopped.wait(NATIVE_SECONDS):return
        with self.lock:
            if self.stopping or self.claimed:return
            self.claimed=True
        self.abort_claimed(failed_report('native-deadline'))

    def abort(self,value):
        if not self.claim_report():
            # The other writer owns the sole bounded report. Never finalize live
            # native buffers while it publishes or append a second JSON object.
            self.report_done.wait(REPORT_SECONDS+1)
            os._exit(2)
        self.abort_claimed(value)

    def abort_claimed(self,value):
        try:
            timer=threading.Timer(REPORT_SECONDS,os._exit,args=(2,));timer.daemon=True;timer.start()
            value={**value,'cleanup_confirmed':False,'unconfirmed_native_lifetime':True,'all_cases_observed':False}
            sys.stdout.write(encode_report(value));sys.stdout.flush()
        finally:
            self.report_done.set();os._exit(2)

    def finish(self,value):
        if value.get('unconfirmed_native_lifetime') is True:self.abort(value)
        with self.lock:
            already_claimed=self.claimed
            if not already_claimed:
                self.stopping=True;self.stopped.set()
        if already_claimed:self.abort(failed_report('report-ownership'))
        self.watchdog.join(WAIT_MS/1000)
        if self.watchdog.is_alive():self.abort(failed_report('watchdog-exit-unconfirmed'))
        if not self.claim_report():self.abort(failed_report('report-ownership'))
        # Native/worker users and the watchdog are now confirmed retired. Bound
        # the final stdout write as well; an incomplete publication cannot exit0.
        timer=threading.Timer(REPORT_SECONDS,os._exit,args=(2,));timer.daemon=True;timer.start()
        text=encode_report(value)
        try:
            sys.stdout.write(text);sys.stdout.flush()
            self.report_done.set()
        except BaseException:
            os._exit(2)
        finally:
            timer.cancel();timer.join(WAIT_MS/1000)
        if timer.is_alive():os._exit(2)
        return 0 if json.loads(text).get('all_cases_observed') is True else 2


def main(argv=None):
    parser=ProbeParser(prog='windows-staging-protection-probe',description=__doc__)
    options=parser.add_mutually_exclusive_group()
    options.add_argument('--plan',action='store_true')
    options.add_argument('--self-test',action='store_true')
    args=parser.parse_args(argv)
    if not args.self_test:
        print(json.dumps(plan(),sort_keys=True))
        return 0
    owner=DiagnosticOwner()
    try:
        owner.start()
        return owner.finish(self_test())
    except BaseException:
        owner.abort(failed_report('interrupted-or-internal-error'))


if __name__=='__main__':raise SystemExit(main())

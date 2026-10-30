"""Fixed model-free file/mapping admission diagnostic, never restart authority.

Default/--plan is effect-free. --self-test creates only new private synthetic
4096-byte files. No caller path, PID, command, size or protection override exists.
"""
from __future__ import annotations
import argparse
import ctypes as C
import importlib.util
import json
from pathlib import Path
import threading

_source=Path(__file__).with_name('probe_windows_staging_protection.py')
_spec=importlib.util.spec_from_file_location('_owned_folder_probe',_source)
p=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(p)

SCHEMA='windows-file-protection-probe-v1'
PROFILE='fresh-protected-current-user-file-v1'
SIZE=4096
CASES=('preopened-writer-denied','writable-section-denied','writable-view-denied','readonly-reader-and-security-barrier')
SHARING=0xc0000043
ACCESS_DENIED=0xc0000022


def plan():
    return {'schema':SCHEMA,'status':'plan-only','fixture_profile':PROFILE,'cases':list(CASES),
            'maximum_file_bytes':SIZE,'native_effects':False,'retained_data_accessed':False,
            'model_or_worker_started':False,'restart_admitted':False,'parent_qualification':False,
            'inherited_acl_round_trip_qualified':False,
            'limits':'New private unnamed-stream fixtures only; full tree/streams, journal, process/crash and actual offload remain unqualified.'}


def failed_report(stage):
    value=plan();value.update(status='failed',failure_stage=stage,cases=[],native_effects=True,
                            cleanup_confirmed=False,unconfirmed_native_lifetime=True,all_cases_observed=False)
    return value


def encode(value):
    text=json.dumps(value,sort_keys=True)+'\n'
    return text if len(text.encode())<=8192 else json.dumps(failed_report('report-size'),sort_keys=True)+'\n'


class Owner(p.DiagnosticOwner):
    def failure_report(self,stage):return failed_report(stage)
    def encode(self,value):return encode(value)


class StandardInfo(C.Structure):
    _fields_=[('allocation',C.c_int64),('size',C.c_int64),('links',p.U32),
              ('delete_pending',C.c_ubyte),('directory',C.c_ubyte)]


class Windows(p.Windows):
    def __init__(self):
        super().__init__()
        for name,args,result in [
            ('CreateFileMappingW',[p.PTR,p.PTR,p.U32,p.U32,p.U32,C.c_wchar_p],p.PTR),
            ('MapViewOfFile',[p.PTR,p.U32,p.U32,p.U32,C.c_size_t],p.PTR),
            ('UnmapViewOfFile',[p.PTR],p.I32),
        ]:
            function=getattr(self.k,name);function.argtypes=args;function.restype=result

    def regular(self,handle,size):
        attributes=(p.U32*2)();facts=StandardInfo()
        p.require(self.k.GetFileInformationByHandleEx(handle,9,C.byref(attributes),C.sizeof(attributes)),'file-attributes',C.get_last_error())
        p.require(not attributes[0] & (0x10|0x400),'file-kind')
        p.require(self.k.GetFileInformationByHandleEx(handle,1,C.byref(facts),C.sizeof(facts)),'file-size',C.get_last_error())
        p.require(facts.size==size and facts.links==1 and not facts.directory and not facts.delete_pending,'file-shape')


class Mapping:
    def __init__(self,native,handle,*,writable,view):
        p.require(type(writable) is bool and type(view) is bool,'mapping-kind')
        self.n=native;self.section=None;self.address=None;self.writable=writable;self.uncertain=False;self.closed=False
        p._RETAINED.append(self)  # Before calls, including interrupted construction.
        try:
            self.section=native.k.CreateFileMappingW(handle,None,4 if writable else 2,0,SIZE,None)
            p.require(self.section,'mapping-create',C.get_last_error())
            if view:
                self.address=native.k.MapViewOfFile(self.section,2 if writable else 4,0,0,SIZE)
                p.require(self.address,'mapping-view',C.get_last_error())
        except BaseException:
            self.uncertain=True;native.uncertain=True;raise

    def write_marker(self):
        p.require(self.writable and self.address and not self.closed and not self.uncertain,'mapping-write-state')
        C.c_ubyte.from_address(self.address).value=0x51
        p.require(C.c_ubyte.from_address(self.address).value==0x51,'mapping-marker')

    def read_zero(self):
        p.require(not self.writable and self.address and not self.closed and not self.uncertain,'mapping-read-state')
        p.require(C.c_ubyte.from_address(self.address).value==0,'mapping-reader')

    def close(self):
        if self.closed:return
        p.require(not self.uncertain,'mapping-lifetime-unconfirmed')
        try:
            if self.address:
                p.require(self.n.k.UnmapViewOfFile(self.address),'mapping-unmap',C.get_last_error());self.address=None
            if self.section:self.n.close(self.section);self.section=None
            self.closed=True;p.retire_reference(self)
        except BaseException:
            self.uncertain=True;self.n.uncertain=True;raise


class Fixture:
    def __init__(self,native):
        self.n=native;self.directory=None;self.creator=None;self.meta=None;self.pending_meta=None;self.guard=None;self.pending_guard=None
        self.initial=None;self.mutated=False;self.maps=[];self.uncertain=False
        try:
            self.directory=p.Fixture(native);self.id=self.directory.id
            self.creator,acl=native.private_file(self.directory.root,'probe.bin')
            self.identity=native.identity(self.creator);native.regular(self.creator,0)
            self.initial=native.permissions(self.creator)
            self.assert_permissions(self.creator,(acl,p.PRIVATE_CONTROL),'file-creation-profile')
            initialize=Mapping(native,self.creator,writable=True,view=False);self.maps.append(initialize)
            initialize.close();self.maps=[];native.regular(self.creator,SIZE)
            self.pending_meta=native.relative(self.directory.root,'probe.bin',0x70080,directory=False)
            p.require(native.identity(self.pending_meta)==self.identity,'file-recovery-identity')
            native.regular(self.pending_meta,SIZE)
            self.meta=self.pending_meta;self.pending_meta=None
        except BaseException as error:
            primary=error if isinstance(error,p.ProbeError) else p.ProbeError('file-constructor-interrupted')
            try:
                if not self.cleanup():primary.secondary.append(p.failure_detail(p.ProbeError('file-constructor-cleanup-unconfirmed'),'constructor-cleanup'))
            except BaseException as cleanup:
                safe=cleanup if isinstance(cleanup,p.ProbeError) else p.ProbeError('file-constructor-cleanup-error')
                primary.secondary.append(p.failure_detail(safe,'constructor-cleanup'))
            raise primary from None

    def assert_permissions(self,handle,expected,stage):
        actual=self.n.permissions(handle)
        if actual!=expected:
            raise p.ProbeError(stage,state={'acl_equal':actual[0]==expected[0],
                                          'expected_dacl_control':expected[1],'actual_dacl_control':actual[1]})

    def protect(self):
        acl,control=self.initial
        expected=(p.deny_writes(acl,b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00'),control)
        self.mutated=True;self.n.set_permissions(self.meta,*expected)
        self.assert_permissions(self.meta,expected,'file-protection-mismatch')

    def map(self,*,writable,view):
        handle=self.creator if writable else self.guard.handle
        value=Mapping(self.n,handle,writable=writable,view=view);self.maps.append(value);return value

    def close_creator(self):
        if self.creator:self.n.close(self.creator);self.creator=None

    def admit(self):
        try:self.pending_guard=self.n.relative(self.directory.root,'probe.bin',0x20081,directory=False,share=5)
        except p.ProbeError as error:
            if error.stage=='native-open' and error.code==SHARING:return {'denied':True,'phase':'open','native_code':error.code}
            raise
        try:
            p.require(self.n.identity(self.pending_guard)==self.identity,'file-guard-identity')
            self.n.regular(self.pending_guard,SIZE)
            self.guard=p.Oplock(self.n,self.pending_guard);self.pending_guard=None
            return {'denied':False}
        except p.ProbeError as error:
            if self.n.uncertain:raise
            self.n.close(self.pending_guard);self.pending_guard=None
            if (error.stage=='oplock-not-granted' and error.code==801 and error.frame
                and error.frame['structure_version']==1 and error.frame['structure_length']==24
                and error.frame['flags'] & 4 and not error.frame['flags'] & ~7
                and error.frame['native_status']==0x8000002e):
                return {'denied':True,'phase':'oplock','native_code':error.code,'oplock_state':error.frame}
            raise

    def new_writer_denied(self):
        try:handle=self.n.relative(self.directory.root,'probe.bin',2,directory=False)
        except p.ProbeError as error:
            if error.stage=='native-open' and error.code in (SHARING,ACCESS_DENIED):return True
            raise
        self.n.close(handle);return False

    def cleanup(self):
        if self.uncertain or self.n.uncertain:
            p._RETAINED.append(self);return False
        try:
            for mapping in reversed(self.maps):mapping.close()
            self.maps=[]
            if self.guard:self.guard.release()
            if self.pending_guard:self.n.close(self.pending_guard);self.pending_guard=None
            if self.pending_meta:self.n.close(self.pending_meta);self.pending_meta=None
            handle=self.meta or self.creator
            if handle:
                if self.initial:
                    if self.mutated:self.n.set_permissions(handle,*self.initial)
                    self.assert_permissions(handle,self.initial,'file-restoration-mismatch')
                if self.creator and self.creator!=handle:self.close_creator()
                self.n.delete_owned(handle);self.n.close(handle)
                self.meta=None;self.creator=None
            if self.directory:p.require(self.directory.cleanup(),'directory-cleanup-unconfirmed')
            return True
        except BaseException:
            self.uncertain=True;p._RETAINED.append(self);raise


def run_case(native,name):
    p.require(name in CASES,'file-case')
    fixture=Fixture(native);facts={'case':name,'fixture_id':fixture.id};worker=None;reference=None;entered=threading.Event();done=threading.Event();result={}
    try:
        mapping=None
        if name in ('writable-section-denied','writable-view-denied'):
            mapping=fixture.map(writable=True,view=name=='writable-view-denied')
        fixture.protect()
        if name!='preopened-writer-denied':fixture.close_creator()
        if mapping and name=='writable-view-denied':mapping.write_marker();facts['existing_view_still_writable']=True
        admission=fixture.admit();facts['admission']=admission
        if name!='readonly-reader-and-security-barrier':
            p.require(admission['denied'],'unsafe-file-admission')
            facts['writer_handle_closed']=fixture.creator is None
            facts['writable_section_held']=mapping is not None
            facts['writable_view_held']=bool(mapping and mapping.address)
        else:
            p.require(not admission['denied'],'safe-file-not-admitted')
            reader=fixture.map(writable=False,view=True);reader.read_zero();facts['readonly_reader_ok']=True
            facts['new_writer_denied']=fixture.new_writer_denied();p.require(facts['new_writer_denied'],'file-new-writer')
            p.require(not fixture.guard.broken(),'file-guard-prebroken')
            def mutation():
                try:
                    entered.set();native.set_permissions(fixture.meta,*fixture.initial);result['completed']=True
                except p.ProbeError as error:result['error']=error.code
                except BaseException:result['error']=0
                finally:done.set()
            worker=threading.Thread(target=mutation,daemon=True);reference=(worker,fixture,native,entered,done,result)
            p._RETAINED.append(reference);fixture.mutated=True;worker.start()
            p.require(entered.wait(p.WAIT_MS/1000),'file-thread-start')
            facts['security_change_waited']=not done.wait(p.WAIT_MS/1000)
            facts['security_break_validated']=fixture.guard.security_break();facts['oplock_state']=fixture.guard.frame()
            fixture.guard.release()
            p.require(done.wait(p.WAIT_MS/1000),'file-security-completion');worker.join(p.WAIT_MS/1000)
            p.require(not worker.is_alive() and result.get('completed') is True,'file-thread-exit',result.get('error',0))
            p.require(facts['security_change_waited'],'file-security-barrier')
            facts['completed_after_guard_release']=True
        facts['status']='observed'
    except p.ProbeError as error:p.record_failure(facts,error,'observation')
    finally:
        if fixture.guard and not fixture.guard.finished:
            try:fixture.guard.release()
            except p.ProbeError as error:fixture.uncertain=True;p.record_failure(facts,error,'guard-release')
        if worker:
            worker.join(p.WAIT_MS/1000)
            if worker.is_alive():fixture.uncertain=True;p.record_failure(facts,p.ProbeError('file-thread-exit-unconfirmed'),'thread-exit')
            elif reference:p.retire_reference(reference)
        try:facts['cleanup_confirmed']=fixture.cleanup()
        except p.ProbeError as error:facts['cleanup_confirmed']=False;p.record_failure(facts,error,'cleanup')
    return facts


def self_test():
    before=len(p._RETAINED);value=plan();value.update(status='evidence-collected-review-required',cases=[])
    try:
        native=Windows()
        for name in CASES:
            value['native_effects']=True;row=run_case(native,name);value['cases'].append(row)
            if not row.get('cleanup_confirmed'):break
    except p.ProbeError as error:
        value.update(status='failed',failure_stage=error.stage,native_code=error.code)
        if error.state is not None:value['permission_state']=error.state
        if error.frame is not None:value['oplock_state']=error.frame
        if error.secondary:value['additional_failures']=error.secondary.copy()
    except BaseException:value.update(status='failed',failure_stage='file-interrupted-or-internal-error',native_code=0,cleanup_confirmed=False)
    value['unconfirmed_native_lifetime']=len(p._RETAINED)>before
    value['all_cases_observed']=len(value['cases'])==len(CASES) and all(r.get('status')=='observed' and r.get('cleanup_confirmed') is True for r in value['cases'])
    return value


def main(argv=None):
    parser=p.ProbeParser(prog='windows-file-protection-probe',description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--self-test',action='store_true')
    args=parser.parse_args(argv)
    if not args.self_test:print(json.dumps(plan(),sort_keys=True));return 0
    owner=Owner()
    try:owner.start();return owner.finish(self_test())
    except BaseException:owner.abort(failed_report('file-interrupted-or-internal-error'))


if __name__=='__main__':raise SystemExit(main())

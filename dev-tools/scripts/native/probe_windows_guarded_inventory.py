"""Fixed fresh-folder inventory controls; never a staging or quota capability."""
from __future__ import annotations
from collections import namedtuple
import ctypes as C
import importlib.util
import json
from pathlib import Path
import struct

_spec=importlib.util.spec_from_file_location('_inventory_file_probe',Path(__file__).with_name('probe_windows_file_protection.py'))
f=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(f);p=f.p
SCHEMA='windows-guarded-inventory-probe-v1'
CASES=('guarded-file-inventory','unexpected-owned-entry-denied')
PAGE_BYTES=65536
MAX_PAGES=4
MAX_ENTRIES=32
METADATA_BYTE_LIMIT=12*1024**3
HEADER=struct.Struct('<II6qIIII16s')
Entry=namedtuple('Entry','name identity logical allocated directory')


def page_entries(raw):
    p.require(type(raw) is bytes and len(raw)==PAGE_BYTES,'inventory-buffer')
    offset=0;result=[];seen=set()
    for _ in range(MAX_ENTRIES):
        p.require(offset%8==0 and offset+HEADER.size<=len(raw),'inventory-record-offset')
        row=HEADER.unpack_from(raw,offset)
        following,logical,allocated,attributes,length,ea,identity=row[0],row[6],row[7],row[8],row[9],row[10],row[12]
        p.require(0<length<=510 and length%2==0 and offset+HEADER.size+length<=len(raw),'inventory-name-length')
        p.require(0<=logical<=METADATA_BYTE_LIMIT and 0<=allocated<=METADATA_BYTE_LIMIT,'inventory-byte-bounds')
        p.require(not attributes&(0x400|0x200|0x800|0x4000|0x1000|0x40|0x10000),'inventory-unsupported-attributes')
        p.require(ea==0,'inventory-extended-attributes')
        p.require(any(identity),'inventory-id-unavailable')
        # ReparsePointTag is undefined without FILE_ATTRIBUTE_REPARSE_POINT.
        try:name=raw[offset+HEADER.size:offset+HEADER.size+length].decode('utf-16-le')
        except UnicodeError:raise p.ProbeError('inventory-name-encoding') from None
        p.require(name and not any(ord(c)<32 or c in '<>:"/\\|?*' for c in name) and (name in ('.','..') or name[-1] not in '. '),'inventory-leaf')
        p.require(name.casefold() not in seen,'inventory-duplicate-name');seen.add(name.casefold())
        if name in ('.','..'):p.require(bool(attributes&0x10) and logical==0,'inventory-dot-entry')
        result.append(Entry(name,identity,logical,allocated,bool(attributes&0x10)))
        if following==0:return tuple(result)
        p.require(following%8==0 and following>=HEADER.size+length and offset+following+HEADER.size<=len(raw),'inventory-next-offset')
        offset+=following
    raise p.ProbeError('inventory-entry-limit')


class Windows(f.Windows):
    def entries(self,handle):
        p.require(type(handle) is int and 0<handle<2**64-1,'inventory-handle')
        result=[];seen=set()
        for page in range(MAX_PAGES):
            buffer=(C.c_uint64*(PAGE_BYTES//8))();reference=(self,buffer);p._RETAINED.append(reference)
            try:
                C.set_last_error(0)
                ok=self.k.GetFileInformationByHandleEx(handle,20 if page==0 else 19,C.byref(buffer),PAGE_BYTES);error=C.get_last_error()
            except BaseException:self.uncertain=True;raise
            if not ok and error in (996,997):self.uncertain=True;raise p.ProbeError('inventory-query-unconfirmed',error)
            p.retire_reference(reference);raw=bytes(buffer)
            if not ok and error==18:
                p.require(not any(raw),'inventory-ambiguous-end');return tuple(result)
            p.require(ok,'inventory-query',error)
            for entry in page_entries(raw):
                p.require(entry.name.casefold() not in seen,'inventory-duplicate-name');seen.add(entry.name.casefold());result.append(entry)
                p.require(len(result)<=MAX_ENTRIES,'inventory-entry-limit')
        raise p.ProbeError('inventory-page-limit')


def exact_inventory(entries,expected,root_identity,parent_identity):
    """Internal comparison only; a result is never a protection capability."""
    p.require(type(entries) is tuple and len(entries)<=MAX_ENTRIES and type(expected) is dict,'inventory-comparison')
    p.require(all(type(v) is bytes and len(v)==24 for v in (root_identity,parent_identity)),'inventory-parent-identity')
    actual={};seen=set()
    for entry in entries:
        p.require(type(entry) is Entry and entry.name.casefold() not in seen,'inventory-comparison');seen.add(entry.name.casefold())
        if entry.name in ('.','..'):
            wanted=root_identity if entry.name=='.' else parent_identity
            p.require(entry.directory and entry.logical==0 and entry.identity==wanted[8:],'inventory-dot-identity');continue
        p.require(not entry.directory and entry.identity not in {v.identity for v in actual.values()},'inventory-entry-kind')
        actual[entry.name]=entry
    p.require(set(actual)==set(expected),'inventory-unexpected-entry')
    for name,(identity,size) in expected.items():
        p.require(type(identity) is bytes and len(identity)==24 and identity[:8]==root_identity[:8] and type(size) is int and 0<=size<=METADATA_BYTE_LIMIT,'inventory-expected-shape')
        entry=actual[name];p.require(entry.identity==identity[8:] and entry.logical==size,'inventory-entry-mismatch')
    logical=sum(v.logical for v in actual.values());allocated=sum(v.allocated for v in actual.values())
    p.require(logical<=METADATA_BYTE_LIMIT and allocated<=METADATA_BYTE_LIMIT,'inventory-byte-bounds')
    return {'files':len(actual),'logical_bytes':logical,'allocation_bytes':allocated}


class EmptyOwnedFile:
    """One exact additional empty FILE_CREATED object; no path parameter."""
    assert_permissions=f.Fixture.assert_permissions
    protect=f.Fixture.protect

    def __init__(self,native,parent):
        self.n=native;self.parent=parent;self.creator=None;self.meta=None;self.identity=None;self.initial=None;self.mutated=False
        self.guard=None;self.pending_guard=None;self.guard_request_started=False;self.uncertain=False;self.finished=False
        self.create_started=False;self.create_acknowledged=False;p._RETAINED.append(self)
        try:
            self.create_started=True;self.creator,acl=native.private_file(parent,'unexpected.bin');self.create_acknowledged=True
            self.identity=native.identity(self.creator);native.regular(self.creator,0);self.initial=native.permissions(self.creator)
            self.assert_permissions(self.creator,(acl,p.PRIVATE_CONTROL),'extra-creation-profile')
            self.meta=native.relative(parent,'unexpected.bin',0x70080,directory=False);p.require(native.identity(self.meta)==self.identity,'extra-recovery-identity')
            native.close(self.creator);self.creator=None
        except BaseException:
            # An interrupted creation/return or partial identity is not no-file proof.
            self.uncertain=True;native.uncertain=True;raise

    def owned_content(self):
        handle=self.meta or self.creator
        p.require(self.create_acknowledged and self.identity and handle and self.n.identity(handle)==self.identity,'extra-owned-identity')
        self.n.regular(handle,0);streams=self.n.streams(handle)
        p.require(not streams or streams=={f.DEFAULT_STREAM:(0,0)},'extra-owned-streams')

    def admit(self):
        p.require(self.guard is None and self.pending_guard is None,'extra-guard-state');self.owned_content()
        self.pending_guard=self.n.relative(self.parent,'unexpected.bin',0x20081,directory=False,share=5)
        try:
            p.require(self.n.identity(self.pending_guard)==self.identity,'extra-guard-identity');self.n.regular(self.pending_guard,0)
            self.guard_request_started=True;self.guard=p.Oplock(self.n,self.pending_guard)
            expected=self.initial
            if self.mutated:expected=(p.deny_writes(expected[0],b'\x01\x01\x00\x00\x00\x00\x00\x01\x00\x00\x00\x00'),expected[1])
            self.assert_permissions(self.meta,expected,'extra-guard-permissions');self.owned_content();p.require(not self.guard.broken(),'extra-guard-prebroken')
        except BaseException as error:
            rejected=self.guard is None and self.guard_request_started and isinstance(error,p.OplockNotGranted)
            if self.guard is None:
                if self.guard_request_started and not rejected:self.uncertain=True;self.n.uncertain=True
                if not self.uncertain and not self.n.uncertain:
                    try:self.n.close(self.pending_guard);self.pending_guard=None;self.guard_request_started=False
                    except BaseException:self.uncertain=True;self.n.uncertain=True;raise
            raise

    def cleanup(self):
        if self.finished:return True
        if self.uncertain or self.n.uncertain or self.guard_request_started and self.guard is None:return False
        try:
            if self.guard:self.guard.release();self.pending_guard=None
            elif self.pending_guard:self.n.close(self.pending_guard);self.pending_guard=None
            self.owned_content()
            handle=self.meta or self.creator
            if self.mutated:self.n.set_permissions(handle,*self.initial)
            self.assert_permissions(handle,self.initial,'extra-restoration')
            self.n.delete_owned(handle);self.n.close(handle);self.meta=None;self.creator=None
            self.finished=True;p.retire_reference(self);return True
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise


class Fixture:
    def __init__(self,native,extra):
        p.require(type(extra) is bool,'inventory-fixture-kind')
        self.n=native;self.file=None;self.extra=None;self.uncertain=False;self.finished=False;p._RETAINED.append(self)
        try:
            self.file=f.Fixture(native)
            if extra:self.extra=EmptyOwnedFile(native,self.file.directory.root)
        except BaseException:self.uncertain=True;native.uncertain=True;raise

    def prepare(self):
        self.file.close_creator();self.file.protect()
        if self.extra:self.extra.protect()
        self.file.directory.protect();self.file.directory.guard()
        p.require(self.file.admit().get('denied') is False,'inventory-file-admission')
        if self.extra:self.extra.admit()

    def live_guards(self):
        p.require(not self.uncertain and not self.n.uncertain,'inventory-lifetime')
        p.require(not self.file.directory.lock.broken() and not self.file.guard.broken(),'inventory-guard-break')
        if self.extra:p.require(not self.extra.guard.broken(),'inventory-guard-break')

    def fresh(self):
        try:
            self.live_guards()
            self.file.owned_content()
            if self.extra:self.extra.owned_content()
            self.live_guards()  # Metadata reads cannot hide the final guard break.
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def scan(self):
        try:
            self.fresh();directory=self.file.directory
            p.require(self.n.identity(directory.lock.handle)==directory.identity,'inventory-root-identity')
            root=directory.identity;parent=self.n.identity(directory.parents[-1]);known={'probe.bin':(self.file.identity,f.SIZE)}
            if self.extra:known['unexpected.bin']=(self.extra.identity,0)
            rows=self.n.entries(directory.lock.handle)
            value=exact_inventory(rows,known,root,parent)
            self.fresh();return rows,value,root,parent
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def cleanup(self):
        if self.finished:return True
        if self.uncertain or self.n.uncertain:return False
        try:
            # Deleting a child while its parent oplock is live can self-deadlock.
            # Retain finished guard objects so existing cleanup stays idempotent.
            if self.extra and self.extra.guard:self.extra.guard.release()
            if self.file and self.file.guard:self.file.guard.release()
            if self.file and self.file.directory.lock:self.file.directory.lock.release()
            if self.extra:p.require(self.extra.cleanup(),'inventory-extra-cleanup')
            if self.file:p.require(self.file.cleanup(),'inventory-file-cleanup')
            self.finished=True;p.retire_reference(self);return True
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise


def plan():
    return {'schema':SCHEMA,'status':'plan-only','cases':list(CASES),'native_effects':False,
            'maximum_fixture_data_bytes':f.SIZE,'maximum_metadata_page_bytes':PAGE_BYTES,'maximum_pages_per_scan':MAX_PAGES,'maximum_entries':MAX_ENTRIES,
            'retained_data_accessed':False,'model_or_worker_started':False,'restart_admitted':False,'parent_qualification':False,
            'recursive_tree_qualified':False,'protected_journal_qualified':False,'guardian_crash_qualified':False,
            'limits':'Fresh flat fixture metadata only; not whole physical disk usage, recursive/inherited tree protection, durable accounting, crash ordering or actual offload.'}


def failed_report(stage):
    value=plan();value.update(status='failed',failure_stage=stage,native_effects=True,cases=[],cleanup_confirmed=False,unconfirmed_native_lifetime=True,all_cases_observed=False);return value


def encode(value):
    data=json.dumps(value,sort_keys=True)+'\n'
    return data if len(data.encode())<=8192 else json.dumps(failed_report('report-size'),sort_keys=True)+'\n'


class Owner(p.DiagnosticOwner):
    def failure_report(self,stage):return failed_report(stage)
    def encode(self,value):return encode(value)


def run_case(native,name):
    p.require(name in CASES,'inventory-case');fixture=Fixture(native,name==CASES[1]);facts={'case':name}
    try:
        fixture.prepare();one,first,root,parent=fixture.scan();two,second,root2,parent2=fixture.scan()
        if one!=two or first!=second or root!=root2 or parent!=parent2:
            fixture.uncertain=True;native.uncertain=True;raise p.ProbeError('inventory-changed')
        facts.update(two_complete_guarded_scans=True,known_fixture_files=first['files'],logical_data_bytes=first['logical_bytes'],allocation_metadata_bytes=first['allocation_bytes'])
        if name==CASES[1]:
            try:exact_inventory(two,{'probe.bin':(fixture.file.identity,f.SIZE)},root,parent)
            except p.ProbeError as error:p.require(error.stage=='inventory-unexpected-entry','inventory-denial-stage');facts['unexpected_owned_entry_denied']=True
            else:raise p.ProbeError('inventory-denial-missed')
        else:p.require(first['files']==1 and first['logical_bytes']==f.SIZE,'inventory-positive-shape')
        facts['status']='observed'
    except p.ProbeError as error:p.record_failure(facts,error,'observation')
    finally:
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
    except p.ProbeError as error:value.update(status='failed',failure_stage=error.stage,native_code=error.code)
    except BaseException:value.update(status='failed',failure_stage='inventory-interrupted-or-internal-error',native_code=0)
    value['unconfirmed_native_lifetime']=len(p._RETAINED)>before
    value['all_cases_observed']=len(value['cases'])==len(CASES) and all(row.get('status')=='observed' and row.get('cleanup_confirmed') is True for row in value['cases'])
    return value


def main(argv=None):
    parser=p.ProbeParser(prog='windows-guarded-inventory-probe',description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--self-test',action='store_true');args=parser.parse_args(argv)
    if not args.self_test:print(json.dumps(plan(),sort_keys=True));return 0
    owner=Owner()
    try:owner.start();return owner.finish(self_test())
    except BaseException:owner.abort(failed_report('inventory-interrupted-or-internal-error'))


if __name__=='__main__':raise SystemExit(main())

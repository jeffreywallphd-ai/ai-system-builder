"""Fixed two-level new-fixture guard composition, never general tree authority."""
from __future__ import annotations
from collections import namedtuple
import ctypes as C
import importlib.util
import json
from pathlib import Path

_spec=importlib.util.spec_from_file_location('_tree_inventory',Path(__file__).with_name('probe_windows_guarded_inventory.py'))
i=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(i);p=i.p;f=i.f
SCHEMA='windows-guarded-tree-probe-v1'
CASES=('two-level-guarded-inventory','cross-directory-identity-mismatch-denied')
GUARD_ROLES=('root','nested','data','root-extra','nested-extra')
CHECKPOINTS=('not-started','prepare-close','prepare-permissions','prepare-root-guard','prepare-nested-guard','prepare-data-guard','prepare-root-extra-guard','prepare-nested-extra-guard','scan-start','scan-identities','scan-root-listing','scan-nested-listing','scan-comparison','scan-final-metadata')
Snapshot=namedtuple('Snapshot','root_rows nested_rows root_identity nested_identity parent_identity files directories logical allocated')


class Windows(i.Windows):
    def close(self,handle):
        try:super().close(handle)
        except BaseException:self.uncertain=True;raise


class NestedDirectory(p.Fixture):
    """Own new child handles; the parent reference is explicitly borrowed."""
    def __init__(self,native,parent):
        p.require(isinstance(parent,p.Fixture) and parent.n is native and parent.root and not parent.uncertain and not native.uncertain,'nested-parent')
        self.n=native;self.parent=parent;self.parent_identity=parent.identity;self.parents=[parent.root]
        self.root=None;self.mutator=None;self.lock=None;self.pending_guard=None;self.guard_request_started=False
        self.original=None;self.mutated=False;self.uncertain=False;self.finished=False;self.id='nested';self.identity=None
        self.create_started=False;self.create_acknowledged=False;p._RETAINED.append(self)
        try:
            p.require(native.identity(parent.root)==self.parent_identity,'nested-parent-identity')
            self.create_started=True;self.root,acl=native.private_root(parent.root,self.id);self.create_acknowledged=True
            p.require(type(self.root) is int and 0<self.root<2**64-1 and self.root!=parent.root,'nested-new-handle')
            self.identity=native.identity(self.root);self.original=native.permissions(self.root)
            self.assert_permissions((acl,p.PRIVATE_CONTROL),'nested-creation-profile')
            self.mutator=native.relative(parent.root,self.id,0x60080)
            p.require(type(self.mutator) is int and 0<self.mutator<2**64-1 and self.mutator not in (self.root,parent.root),'nested-new-handle')
            p.require(native.identity(self.mutator)==self.identity,'nested-mutator-identity')
        except BaseException:self.uncertain=True;native.uncertain=True;raise

    def cleanup(self):
        if self.finished:return True
        if self.uncertain or self.n.uncertain or self.guard_request_started and self.lock is None:return False
        try:
            p.require(self.create_acknowledged and self.identity and self.root,'nested-creation-unconfirmed')
            p.require(self.parent.root==self.parents[0] and self.n.identity(self.parent.root)==self.parent_identity,'nested-parent-identity')
            p.require(self.n.identity(self.root)==self.identity,'nested-cleanup-identity');self.n.directory(self.root)
            if self.lock:self.lock.release();self.pending_guard=None
            elif self.pending_guard:self.n.close(self.pending_guard);self.pending_guard=None
            if self.mutated:self.n.set_permissions(self.root,*self.original)
            self.assert_permissions(self.original,'nested-restoration')
            if self.mutator:self.n.close(self.mutator);self.mutator=None
            self.n.delete_owned(self.root);self.n.close(self.root);self.root=None
            # Never call the base cleanup: its parents list owns its ancestors.
            self.parents=[];self.finished=True;p.retire_reference(self);return True
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise


def directory_inventory(rows,files,directories,root,parent):
    p.require(type(rows) is tuple and len(rows)<=i.MAX_ENTRIES and type(directories) is dict,'tree-directory-shape')
    actual={};file_rows=[];names=set()
    for entry in rows:
        p.require(type(entry) is i.Entry and entry.name.casefold() not in names,'tree-duplicate-entry');names.add(entry.name.casefold())
        if entry.directory and entry.name not in ('.','..'):actual[entry.name]=entry
        else:file_rows.append(entry)
    p.require(set(actual)==set(directories),'tree-unexpected-directory')
    for name,identity in directories.items():
        p.require(type(identity) is bytes and len(identity)==24 and identity[:8]==root[:8],'tree-directory-identity')
        p.require(actual[name].identity==identity[8:] and actual[name].logical==0,'tree-directory-identity')
    value=i.exact_inventory(tuple(file_rows),files,root,parent)
    return {**value,'directories':len(actual)}


class Fixture:
    def __init__(self,native):
        self.n=native;self.flat=None;self.nested=None;self.nested_file=None;self.uncertain=False;self.finished=False;self.checkpoint='not-started';p._RETAINED.append(self)
        try:
            self.flat=i.Fixture(native,True)
            self.nested=NestedDirectory(native,self.flat.file.directory)
            self.nested_file=i.EmptyOwnedFile(native,self.nested.root)
        except BaseException:self.uncertain=True;native.uncertain=True;raise

    def prepare(self):
        try:
            self.checkpoint='prepare-close';self.flat.file.close_creator()
            self.checkpoint='prepare-permissions';self.flat.file.protect();self.flat.extra.protect();self.nested_file.protect();self.nested.protect();self.flat.file.directory.protect()
            self.checkpoint='prepare-root-guard';self.flat.file.directory.guard();self.acquired_guards(1)
            self.checkpoint='prepare-nested-guard';self.nested.guard();self.acquired_guards(2)
            self.checkpoint='prepare-data-guard';p.require(self.flat.file.admit().get('denied') is False,'tree-file-admission');self.acquired_guards(3)
            self.checkpoint='prepare-root-extra-guard';self.flat.extra.admit();self.acquired_guards(4)
            self.checkpoint='prepare-nested-extra-guard';self.nested_file.admit();self.acquired_guards(5)
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def guards(self):
        return (self.flat.file.directory.lock,self.nested.lock,self.flat.file.guard,self.flat.extra.guard,self.nested_file.guard)

    def acquired_guards(self,count):
        p.require(type(count) is int and 1<=count<=5,'tree-guard-count')
        objects=(self,self.flat,self.flat.file,self.flat.file.directory,self.flat.extra,self.nested,self.nested_file)
        p.require(not self.n.uncertain and not any(value.uncertain for value in objects),'tree-lifetime')
        for role,guard in zip(GUARD_ROLES[:count],self.guards()[:count]):
            p.require(guard is not None and not guard.broken(),'tree-guard-break-'+role)

    def live_guards(self):
        self.acquired_guards(5)

    def fresh(self):
        try:
            self.live_guards();self.flat.file.owned_content();self.flat.extra.owned_content();self.nested_file.owned_content();self.live_guards()
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def scan(self):
        try:
            self.checkpoint='scan-start';self.fresh();root=self.flat.file.directory
            self.checkpoint='scan-identities'
            p.require(self.n.identity(root.lock.handle)==root.identity and self.n.identity(self.nested.lock.handle)==self.nested.identity,'tree-root-identity')
            identities=(root.identity,self.nested.identity,self.flat.file.identity,self.flat.extra.identity,self.nested_file.identity)
            p.require(all(type(value) is bytes and len(value)==24 and value[:8]==root.identity[:8] for value in identities) and len(set(identities))==5,'tree-object-alias')
            parent=self.n.identity(root.parents[-1]);self.checkpoint='scan-root-listing';root_rows=self.n.entries(root.lock.handle)
            self.checkpoint='scan-nested-listing';nested_rows=self.n.entries(self.nested.lock.handle)
            self.checkpoint='scan-comparison'
            first=directory_inventory(root_rows,{'probe.bin':(self.flat.file.identity,f.SIZE),'unexpected.bin':(self.flat.extra.identity,0)},{'nested':self.nested.identity},root.identity,parent)
            second=directory_inventory(nested_rows,{'unexpected.bin':(self.nested_file.identity,0)},{},self.nested.identity,root.identity)
            self.checkpoint='scan-final-metadata';self.fresh();files=first['files']+second['files'];directories=1+first['directories']+second['directories'];logical=first['logical_bytes']+second['logical_bytes'];allocated=first['allocation_bytes']+second['allocation_bytes']
            p.require(files==3 and directories==2 and logical==f.SIZE and allocated<=i.METADATA_BYTE_LIMIT,'tree-observation-shape')
            return Snapshot(root_rows,nested_rows,root.identity,self.nested.identity,parent,files,directories,logical,allocated)
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def cleanup(self):
        if self.finished:return True
        if self.uncertain or self.n.uncertain:return False
        try:
            files=[self.nested_file,self.flat.extra if self.flat else None,self.flat.file if self.flat else None]
            for value in files:
                if value and value.guard:value.guard.release()
            if self.nested and self.nested.lock:self.nested.lock.release()
            if self.flat and self.flat.file.directory.lock:self.flat.file.directory.lock.release()
            if self.nested_file:p.require(self.nested_file.cleanup(),'tree-nested-file-cleanup')
            if self.nested:p.require(self.nested.cleanup(),'tree-nested-directory-cleanup')
            if self.flat:
                p.require(self.n.identity(self.flat.file.directory.root)==self.flat.file.directory.identity,'tree-borrowed-parent-lost')
                p.require(self.flat.cleanup(),'tree-flat-cleanup')
            self.finished=True;p.retire_reference(self);return True
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise


def plan():
    return {'schema':SCHEMA,'status':'plan-only','cases':list(CASES),'native_effects':False,
            'maximum_directories':2,'maximum_files':3,'maximum_fixture_data_bytes':f.SIZE,'maximum_depth':2,
            'retained_data_accessed':False,'model_or_worker_started':False,'restart_admitted':False,'parent_qualification':False,
            'general_tree_protection_qualified':False,'inherited_acl_qualified':False,'protected_journal_qualified':False,'guardian_crash_qualified':False,
            'limits':'Fixed two-level fresh fixture only; not arbitrary recursive/existing trees, whole physical disk accounting, protected journal, guardian ordering or actual offload.'}


def failed_report(stage):
    value=plan();value.update(status='failed',failure_stage=stage,native_effects=True,cases=[],cleanup_confirmed=False,unconfirmed_native_lifetime=True,all_cases_observed=False);return value


def encode(value):
    data=json.dumps(value,sort_keys=True)+'\n'
    return data if len(data.encode())<=8192 else json.dumps(failed_report('report-size'),sort_keys=True)+'\n'


class Owner(p.DiagnosticOwner):
    def failure_report(self,stage):return failed_report(stage)
    def encode(self,value):return encode(value)


def run_case(native,name):
    p.require(name in CASES,'tree-case');fixture=Fixture(native);facts={'case':name}
    try:
        fixture.prepare();first=fixture.scan();second=fixture.scan()
        if first!=second:fixture.uncertain=True;native.uncertain=True;raise p.ProbeError('tree-inventory-changed')
        facts.update(two_complete_guarded_tree_scans=True,known_files=second.files,known_directories=second.directories,logical_data_bytes=second.logical,allocation_metadata_bytes=second.allocated)
        if name==CASES[1]:
            try:directory_inventory(second.nested_rows,{'unexpected.bin':(fixture.flat.extra.identity,0)},{},second.nested_identity,second.root_identity)
            except p.ProbeError as error:p.require(error.stage=='inventory-entry-mismatch','tree-denial-stage');facts['cross_directory_identity_mismatch_denied']=True;facts['denial_kind']='parent-specific-metadata-comparison'
            else:raise p.ProbeError('tree-denial-missed')
        facts['status']='observed'
    except p.ProbeError as error:
        p.record_failure(facts,error,'observation');step=getattr(fixture,'checkpoint','not-started');facts['guard_checkpoint']=step if step in CHECKPOINTS else 'not-started'
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
    except BaseException:value.update(status='failed',failure_stage='tree-interrupted-or-internal-error',native_code=0)
    value['unconfirmed_native_lifetime']=len(p._RETAINED)>before
    value['all_cases_observed']=len(value['cases'])==len(CASES) and all(row.get('status')=='observed' and row.get('cleanup_confirmed') is True for row in value['cases'])
    return value


def main(argv=None):
    parser=p.ProbeParser(prog='windows-guarded-tree-probe',description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--self-test',action='store_true');args=parser.parse_args(argv)
    if not args.self_test:print(json.dumps(plan(),sort_keys=True));return 0
    owner=Owner()
    try:owner.start();return owner.finish(self_test())
    except BaseException:owner.abort(failed_report('tree-interrupted-or-internal-error'))


if __name__=='__main__':raise SystemExit(main())

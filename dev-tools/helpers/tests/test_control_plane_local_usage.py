"""Synthetic exact-session files and real storage/Work boundaries; no model calls."""
from __future__ import annotations
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import usage, usage_local as local
from control_plane.contracts import ControlError
from control_plane.work import Work

PARENT = '01a00000-0000-7000-8000-000000000001'
CHILD = '01a00000-0000-7000-8000-000000000002'
T0 = '2026-11-24T10:00:00Z'
T1 = '2026-11-24T10:01:00Z'
T2 = '2026-11-24T10:02:00Z'
T3 = '2026-11-24T10:03:00Z'


class LocalUsageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='ln-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.home = self.root/'s'
        self.home.mkdir()
        self.destination = self.root/'destination'; self.destination.mkdir()
        self.real_repository = local._repository
        def repository(path):
            if Path(path).resolve() not in {self.root, self.destination}: raise ControlError('local-capture.workspace','Fixed refusal.',{},[])
            return 'a'*64, self.root
        self.addCleanup(patch.stopall)
        patch.object(local, '_repository', side_effect=repository).start()
        # Never mutate native empty Windows Git environment values.
        patch.object(local.os, 'environ', {**os.environ, 'CODEX_HOME':str(self.home)}).start()
        self.paths = {}
        self.source(PARENT)

    def write_line(self, identity, row, *, raw=False):
        with self.paths[identity].open('ab') as stream:
            stream.write(row if raw else (json.dumps(row,separators=(',',':'))+'\n').encode())

    def source(self, identity, parent=None):
        created=datetime.fromtimestamp((uuid.UUID(identity).int>>80)/1000,timezone.utc)
        folder=self.home/'sessions'/created.strftime('%Y/%m/%d');folder.mkdir(parents=True,exist_ok=True)
        path=folder/('rollout-'+created.strftime('%Y-%m-%dT%H-%M-%S')+'-'+identity+'.jsonl')
        self.paths[identity]=path
        path.write_bytes(b'')
        self.write_line(identity,{'timestamp':T0,'type':'session_meta','payload':{'id':identity,'cwd':str(self.root),
                        'parent_thread_id':parent,'base_instructions':{'text':'private-header-never-output'}}})

    def counts(self, inp=100, out=20, cached=10, reasoning=5):
        return {'input_tokens':inp,'output_tokens':out,'cached_input_tokens':cached,'reasoning_output_tokens':reasoning,
                'cache_write_input_tokens':0,'total_tokens':inp+out}

    def record(self, identity=PARENT, at=T0, counts=None, record_id=None):
        value=counts or self.counts()
        return {'timestamp':at,'type':'token_usage_record','payload':{'thread_id':identity,'turn_id':'synthetic-turn',
                'session_id':PARENT,'root_turn_id':'synthetic-root-turn','response_id':record_id or 'synthetic-response-'+at.replace(':',''),
                'usage':self.counts(10,2,1,1),'turn_token_usage':copy.deepcopy(value),'thread_token_usage':copy.deepcopy(value)}}

    def enable(self,*identities,**kwargs):
        return local.enable(self.root,thread_ids=list(identities or (PARENT,)),at=T3,**kwargs)

    def poll(self,at=T3): return local.poll(self.root,at=at)
    def state(self,root=None): return ((root or self.root)/usage.BASE/'state.json').read_bytes()
    def measured(self,root=None): return usage.summary(root or self.root)['known_own_subtotal']['measured']

    def test_baseline_then_fresh_own_deltas_ignore_inherited_context_and_shared_session_id(self):
        self.source(CHILD,PARENT)
        for identity in (PARENT,CHILD): self.write_line(identity,self.record(identity))
        # Copied parent history in child must never replace child's own baseline.
        self.write_line(CHILD,self.record(PARENT,T1,self.counts(9999,999,999,99)))
        result=self.enable(PARENT,CHILD)
        self.assertEqual(result['state'],'baseline-only');self.assertFalse(result['live_capture'])
        self.assertIsNone(self.measured()['input_tokens'])
        for identity in (PARENT,CHILD): self.write_line(identity,self.record(identity,T2,self.counts(150,30,20,8)))
        result=self.poll()
        self.assertTrue(result['live_capture']);self.assertEqual(result['recent_actual_threads'],2)
        self.assertEqual(self.measured(),dict(zip(usage.METRICS,(100,20,20,6))))
        self.assertEqual(result['unreported_agents'],'unknown')
        self.assertEqual(usage.summary(self.root)['missing_reported_parents'],0)

    def test_duplicate_counter_snapshots_do_not_add_observations_or_revive_stale_data(self):
        self.write_line(PARENT,self.record());self.enable()
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)));self.poll()
        before=self.state()
        self.write_line(PARENT,self.record(at=T2,counts=self.counts(150,30,20,8)))
        result=self.poll('2026-11-24T11:00:00Z')
        self.assertEqual(result['state'],'stale-actual-events');self.assertFalse(result['live_capture'])
        self.assertEqual(result['observations_accepted'],0);self.assertEqual(self.state(),before)

    def test_decrease_is_fail_closed_and_explicit_epoch_starts_unowned_history_baseline(self):
        self.write_line(PARENT,self.record());self.enable()
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)));self.poll()
        before=self.state()
        self.write_line(PARENT,self.record(at=T2,counts=self.counts(5,1,0,0)))
        self.assertEqual(self.poll()['state'],'unavailable');self.assertEqual(self.state(),before)
        result=self.enable(counter_epoch='reset-two')
        self.assertEqual(result['state'],'baseline-only');self.assertEqual(self.measured()['input_tokens'],50)
        self.write_line(PARENT,self.record(at=T3,counts=self.counts(15,3,1,1)));self.poll()
        self.assertEqual(self.measured()['input_tokens'],60)
        self.assertEqual(local.session_start(self.root,session=PARENT,at=T3)['state'],'recent-actual-events')
        before=self.state()
        self.enable(counter_epoch='initial')
        self.assertEqual(self.state(),before)

    def test_incomplete_append_is_not_decoded_and_completed_append_counts_once(self):
        self.write_line(PARENT,self.record());self.enable()
        payload=(json.dumps(self.record(at=T1,counts=self.counts(150,30,20,8)),separators=(',',':'))+'\n').encode()
        self.write_line(PARENT,payload[:len(payload)//2],raw=True)
        before=self.state();result=self.poll()
        self.assertEqual(result['partial_append_threads'],1);self.assertEqual(self.state(),before)
        self.write_line(PARENT,payload[len(payload)//2:],raw=True)
        self.assertTrue(self.poll()['live_capture']);self.assertEqual(self.measured()['input_tokens'],50)
        before=self.state();self.poll();self.assertEqual(self.state(),before)

    def test_message_tool_quota_and_nested_counter_strings_never_enter_decoder_or_output(self):
        self.write_line(PARENT,self.record());self.enable()
        hostile='private-tool-payload '+json.dumps(self.record())
        self.write_line(PARENT,{'timestamp':T1,'type':'response_item','payload':{'type':'message','text':hostile}})
        self.write_line(PARENT,{'timestamp':T1,'type':'event_msg','payload':{'type':'token_count','info':None,'rate_limits':{'private-quota':99}}})
        real_decode=local._decode;decoded=[]
        def guarded(raw):
            self.assertNotIn(b'private-tool-payload',raw);self.assertNotIn(b'private-quota',raw)
            decoded.append(raw);return real_decode(raw)
        with patch.object(local,'_decode',side_effect=guarded): result=self.poll()
        public=json.dumps(result)+self.state().decode()
        for text in ('private-header-never-output','private-tool-payload','private-quota',PARENT): self.assertNotIn(text,public)
        self.assertFalse(result['live_capture']);self.assertIsNone(self.measured()['input_tokens'])

    def test_source_replacement_requires_explicit_epoch_and_does_not_adopt_foreign_header(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        path=self.paths[PARENT];replacement=path.with_suffix('.replacement')
        replacement.write_bytes(path.read_bytes());os.replace(replacement,path)
        self.assertEqual(self.poll()['reason_code'],'local-capture.source-replaced');self.assertEqual(self.state(),before)
        self.assertEqual(self.enable(counter_epoch='replacement-two')['state'],'baseline-only')
        header={'timestamp':T0,'type':'session_meta','payload':{'id':CHILD,'cwd':str(self.root)}}
        path.write_text(json.dumps(header)+'\n',encoding='utf-8')
        self.assertEqual(self.poll()['reason_code'],'local-capture.identity')

    def test_wrong_workspace_unknown_header_ancestry_and_no_counter_source_stay_unknown(self):
        self.assertEqual(self.enable()['state'],'adapter-ready');self.assertFalse((self.root/usage.BASE).exists())
        self.paths[PARENT].write_text(json.dumps({'timestamp':T0,'type':'session_meta','payload':{'id':PARENT,'cwd':'/'}})+'\n')
        self.assertEqual(self.poll()['reason_code'],'local-capture.workspace')
        self.source(PARENT,CHILD)
        self.assertEqual(self.poll()['reason_code'],'local-capture.source-replaced')

    def test_invalid_counters_future_time_unknown_fields_and_subset_deltas_preserve_state(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state();valid_bytes=self.paths[PARENT].read_bytes()
        for mutate in [lambda r:r['payload']['thread_token_usage'].update(input_tokens=True),
                       lambda r:r['payload']['thread_token_usage'].update(input_tokens=-1),
                       lambda r:r['payload']['thread_token_usage'].update(input_tokens=1.5),
                       lambda r:r['payload']['thread_token_usage'].update(total_tokens=999),
                       lambda r:r['payload']['thread_token_usage'].update(cached_input_tokens=151),
                       lambda r:r['payload'].update(prompt='private-rejected-content'),
                       lambda r:r.update(timestamp='2027-11-24T00:00:00Z')]:
            self.paths[PARENT].write_bytes(valid_bytes)
            row=self.record(at=T1,counts=self.counts(150,30,20,8));mutate(row);self.write_line(PARENT,row)
            result=self.poll();self.assertEqual(result['state'],'unavailable');self.assertEqual(self.state(),before)
            self.assertNotIn('private-rejected-content',json.dumps(result))
        self.paths[PARENT].write_bytes(valid_bytes)
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(110,30,30,8)))
        self.assertEqual(self.poll()['state'],'unavailable');self.assertEqual(self.state(),before)

    def test_fixed_tail_cap_handles_large_inert_rows_without_reading_full_file(self):
        self.write_line(PARENT,self.record());self.enable()
        self.write_line(PARENT,{'timestamp':T1,'type':'response_item','payload':{'text':'private-large-row'+'x'*(2*local.MAX_TAIL)}})
        self.write_line(PARENT,self.record(at=T2,counts=self.counts(150,30,20,8)))
        result=self.poll()
        self.assertTrue(result['bounded_tail_only']);self.assertTrue(result['live_capture'])
        self.assertEqual(self.measured()['input_tokens'],50)
        self.assertLess((self.root/usage.BASE/'state.json').stat().st_size,20000)

    def test_header_directory_binding_limits_links_and_ambiguous_filename_refuse(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        with patch.object(local,'MAX_DIRECTORY',0): self.assertEqual(self.poll()['reason_code'],'local-capture.directory-cap')
        with patch.object(local,'MAX_HEADER',1): self.assertEqual(self.poll()['reason_code'],'local-capture.header-cap')
        with patch.object(Path,'is_symlink',return_value=True): self.assertEqual(self.poll()['state'],'unavailable')
        duplicate=self.paths[PARENT].with_suffix('.jsonl.zst')
        duplicate.write_bytes(self.paths[PARENT].read_bytes())
        self.assertEqual(self.poll()['reason_code'],'local-capture.source-selection');self.assertEqual(self.state(),before)

    def test_usage_destination_is_explicit_same_repository_and_does_not_create_work_records(self):
        self.write_line(PARENT,self.record());self.enable(destination=str(self.destination))
        self.assertFalse((self.root/usage.BASE).exists())
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)));self.poll()
        self.assertEqual(self.measured(self.destination)['input_tokens'],50)
        self.assertFalse((self.destination/'.local-codex/control-plane/records.json').exists())
        before=self.state(self.destination)
        with self.assertRaises(ControlError): self.enable(destination=str(self.root/'foreign-repository'))
        self.assertEqual(self.state(self.destination),before)

    def test_atomic_capacity_and_time_failure_never_claim_live_or_advance_counters(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)))
        for manager in (patch.object(usage,'MAX_BYTES',len(before)+1),
                        patch('control_plane.storage.os.replace',side_effect=OSError('private-path')),
                        patch.object(local,'MAX_SECONDS',-1)):
            with manager: result=self.poll()
            self.assertFalse(result['live_capture']);self.assertTrue(result['work_may_continue'])
            self.assertEqual(self.state(),before);self.assertNotIn('private-path',json.dumps(result))

    def test_unconfigured_boundaries_do_no_host_lookup_and_telemetry_exception_cannot_fail_work(self):
        with patch.object(local,'_source_path',side_effect=AssertionError('must not inspect host')):
            self.assertIsNone(local.configured_boundary(self.root))
        fake=type('Owner',(),{'root':self.root})()
        with patch.object(local,'configured_boundary',side_effect=RuntimeError('private-exception')):
            result=Work._usage_boundary(fake,{'work_id':'inert-work','status':'complete'})
        self.assertEqual(result['status'],'complete');self.assertFalse(result['token_capture']['live_capture'])
        self.assertNotIn('private-exception',json.dumps(result))

    def test_session_start_preserves_configured_epoch_and_cli_failure_is_nonblocking(self):
        self.write_line(PARENT,self.record());self.enable(counter_epoch='deliberate-epoch')
        self.assertEqual(local.session_start(self.root,session=PARENT,at=T3)['state'],'baseline-only')
        config=json.loads((self.root/local.CONFIG).read_text(encoding='utf-8'))
        self.assertEqual(config['threads'][0]['counter_epoch'],'deliberate-epoch')
        script=Path(__file__).resolve().parents[1]/'development_control_plane.py'
        result=subprocess.run([sys.executable,'-B',str(script),'--repo',str(self.root),'usage','session-start','--session','invalid-id'],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertTrue(json.loads(result.stdout)['data']['work_may_continue'])

    def test_real_git_repository_identity_accepts_worktrees_and_refuses_other_repository(self):
        first=self.root/'real-first';second=self.root/'real-second';first.mkdir();second.mkdir()
        for folder in (first,second):
            result=subprocess.run(['git','init','-q'],cwd=folder,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
        one=self.real_repository(first)[0];two=self.real_repository(second)[0]
        self.assertNotEqual(one,two)
        self.assertEqual(self.real_repository(first)[0],one)
        (first/'fixture.txt').write_text('inert fixture\n',encoding='utf-8')
        for command in (['git','add','.'],['git','-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],
                        ['git','worktree','add','--detach',str(self.root/'w')]):
            result=subprocess.run(command,cwd=first,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(self.real_repository(self.root/'w')[0],one)

    def test_actual_work_start_verify_complete_capture_to_usage_destination_without_rerouting_work(self):
        self.root=self.root/'r';self.root.mkdir()
        for name,text in {'AGENTS.md':'Fixture contributor entry\n','.gitignore':'.local-codex/\n',
                          'docs/result.md':'initial\n','dev-tools/scripts/docs/check-doc-drift.mjs':
                          'import fs from "node:fs";process.exit(fs.readFileSync("docs/result.md","utf8").startsWith("completed")?0:1);\n'}.items():
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf-8')
        for arguments in (['init','-q'],['add','.'],['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']):
            result=subprocess.run(['git',*arguments],cwd=self.root,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
        self.source(PARENT);self.write_line(PARENT,self.record());self.enable(destination=str(self.destination))
        spec={'schema_version':'development-work-v1','work_id':'local-boundary-fixture','kind':'lightweight','title':'Fixture result',
              'authority_ref':'synthetic-test','outcome':{'problem':'Initial result','success':'Completed result','quality':'Bounded',
              'internal_rationale':'Inert fixture'},'write_scope':['docs/result.md'],
              'acceptance':[{'id':'result','description':'Completed','check_ids':['documentation']}]}
        stamp=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        self.write_line(PARENT,self.record(at=stamp,counts=self.counts(150,30,20,8)))
        owner=Work(self.root);started=owner.start(spec,'fixture-author');claim=started['claim']['claim_id']
        self.assertTrue(started['token_capture']['live_capture'])
        (self.root/'docs/result.md').write_text('completed\n',encoding='utf-8')
        self.write_line(PARENT,self.record(at=stamp,counts=self.counts(200,40,30,11)))
        receipt=owner.verify('local-boundary-fixture','fixture-author',claim)
        self.assertEqual(receipt['qualification'],'passed');self.assertTrue(receipt['token_capture']['live_capture'])
        owner.review({'schema_version':'technical-review-v1','work_id':'local-boundary-fixture','invocation_id':'fixture-reviewer',
                      'assurance':'operator-attested','disposition':'accepted','receipt_digest':receipt['receipt_digest'],
                      'findings':[],'closures':[],'reviewed_criteria':['result']})
        self.write_line(PARENT,self.record(at=stamp,counts=self.counts(250,50,40,14)))
        completed=owner.complete('local-boundary-fixture','fixture-author',claim)
        self.assertEqual(completed['status'],'complete');self.assertTrue(completed['token_capture']['live_capture'])
        self.assertEqual(self.measured(self.destination)['input_tokens'],150)
        self.assertEqual(owner.records.load()['work_items']['local-boundary-fixture']['status'],'complete')
        self.assertFalse((self.root/usage.BASE).exists())
        self.assertEqual({path.name for path in (self.destination/'.local-codex/control-plane').iterdir()},{'usage'})

    def test_concurrent_selected_startup_preserves_union_without_unbounded_config_history(self):
        self.source(CHILD,PARENT)
        for identity in (PARENT,CHILD): self.write_line(identity,self.record(identity))
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda identity:local.enable(self.root,thread_ids=[identity],at=T3),(PARENT,CHILD)))
        self.assertTrue(all(result['state']=='baseline-only' for result in results))
        config=json.loads((self.root/local.CONFIG).read_text(encoding='utf-8'))
        self.assertEqual({row['thread_id'] for row in config['threads']},{PARENT,CHILD})
        self.assertLess((self.root/local.CONFIG).stat().st_size,local.usage_capture.MAX_CONFIG_BYTES)
        self.assertEqual({path.name for path in (self.root/local.CONFIG).parent.iterdir()},{'local.json','local.lock'})

    def test_concurrent_capture_uses_actual_import_receipt_and_counts_consumption_once(self):
        self.write_line(PARENT,self.record());self.enable()
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)))
        with ThreadPoolExecutor(max_workers=2) as executor: results=list(executor.map(lambda _:self.poll(),(0,1)))
        self.assertEqual(sum(result.get('observations_accepted',0) for result in results),1)
        self.assertEqual(self.measured()['input_tokens'],50)

    def test_untrusted_network_workspace_is_refused_before_resolution_or_git(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        header={'timestamp':T0,'type':'session_meta','payload':{'id':PARENT,'cwd':'//untrusted.invalid/private-share'}}
        self.paths[PARENT].write_text(json.dumps(header)+'\n',encoding='utf-8')
        real_resolve=Path.resolve
        def guarded(path,*args,**kwargs):
            self.assertFalse(str(path).startswith(('\\\\','//')),'network path must not resolve')
            return real_resolve(path,*args,**kwargs)
        with patch.object(Path,'resolve',guarded): result=self.poll()
        self.assertEqual(result['reason_code'],'local-capture.workspace')
        self.assertEqual(self.state(),before)

    def test_truncated_source_and_oversized_configuration_preserve_known_state(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        self.paths[PARENT].write_bytes(b'{}\n')
        self.assertEqual(self.poll()['state'],'unavailable');self.assertEqual(self.state(),before)
        (self.root/local.CONFIG).write_text('x'*(local.usage_capture.MAX_CONFIG_BYTES+1),encoding='utf-8')
        self.assertEqual(self.poll()['state'],'unavailable');self.assertEqual(self.state(),before)

    def test_static_hardlinked_lock_cannot_write_into_foreign_empty_file(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        lock=(self.root/local.CONFIG).parent/'local.lock';lock.unlink()
        foreign=self.root/'foreign-empty.bin';foreign.write_bytes(b'')
        os.link(foreign,lock)
        result=local.session_start(self.root,session=PARENT,at=T3)
        self.assertEqual(result['state'],'unavailable')
        self.assertEqual(foreign.read_bytes(),b'')
        self.assertEqual(self.state(),before)

    def test_hardlinked_configuration_cannot_supply_counters_and_lock_size_is_bounded(self):
        self.write_line(PARENT,self.record());self.enable();before=self.state()
        config=self.root/local.CONFIG;alias=self.root/'config-alias.json';os.link(config,alias)
        self.write_line(PARENT,self.record(at=T1,counts=self.counts(150,30,20,8)))
        self.assertEqual(self.poll()['state'],'unavailable');self.assertEqual(self.state(),before)
        alias.unlink()
        lock=config.parent/'local.lock';lock.write_bytes(b'oversized-lock')
        self.assertEqual(local.session_start(self.root,session=PARENT,at=T3)['state'],'unavailable')
        self.assertEqual(self.state(),before)


if __name__=='__main__': unittest.main()

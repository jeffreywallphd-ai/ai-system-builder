"""Reviewed offline bundle: all open blockers accounted for, no native/offload bypass."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_standard_generation_qualification as standard
from model_qualification_lock import QualificationBusy, slot

ROOT = standard.ROOT
OUTPUT = '.local-codex/model-blocker-tests'
REGISTRY = 'dev-tools/config/model-blocker-qualification.json'
PROFILES = ['qwen15-bfloat16', 'qwen05-float32']
ROUTES = {'standard-comparison','partial-standard-output','blocked-native-offload',
          'blocked-native-security','blocked-advanced-provider','separate-security-dependency'}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def read(path, maximum=8*1024**2):
    path = standard.original.checked_path(Path(path).relative_to(ROOT).as_posix())
    if not 0 < path.stat().st_size <= maximum: raise ValueError('Evidence/input byte bound exceeded.')
    return json.loads(path.read_text(encoding='utf-8'))


def save(folder, name, value): standard.diagnostics.save(folder, name, value)


def folder_for(run_id):
    if not re.fullmatch(r'[a-f0-9]{32}', run_id or ''): raise ValueError('Invalid bundle identity.')
    return standard.diagnostics.safe_directory(ROOT / OUTPUT / run_id)


def registry():
    value = read(ROOT / REGISTRY, 64*1024)
    if (set(value) != {'schema_version','host_profile','models','owners'}
            or value['schema_version'] != 'model-blocker-coverage-v1'
            or value['host_profile'] != 'windows-lightweight-v1' or value['models'] != PROFILES
            or not isinstance(value['owners'], list) or not 1 <= len(value['owners']) <= 24):
        raise ValueError('Unknown blocker registry.')
    seen = set()
    for owner in value['owners']:
        if (set(owner) != {'id','coverage','criteria','pending'}
                or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', owner['id']) or owner['id'] in seen
                or owner['coverage'] not in ROUTES or not isinstance(owner['criteria'], list)
                or len(owner['criteria']) > 64
                or (not owner['criteria'] and owner['coverage'] != 'separate-security-dependency')
                or len(set(owner['criteria'])) != len(owner['criteria'])
                or any(not re.fullmatch(r'[a-z0-9-]+/[a-z0-9-]+', ref) for ref in owner['criteria'])
                or not isinstance(owner['pending'], str) or not 1 <= len(owner['pending']) <= 2048):
            raise ValueError('Invalid or duplicate registry owner.')
        seen.add(owner['id'])
    return value


def folded_history():
    # Reuse the control plane's complete handoff admission, not stale statuses
    # or a second interpretation of the retired roadmap's historical blocker.
    sys.path.insert(0, str(ROOT / 'dev-tools/helpers'))
    from control_plane.supporting_work import _consolidation
    document = read(ROOT/'docs/operations/roadmap-supporting-work.json')
    result = []
    for successor in document['successors']:
        if successor.get('consolidation_path'):
            _consolidation(ROOT, successor)
            result.append({'source':successor['roadmap_id'],'owner':successor['successor_roadmap_id'],
                'consolidation_sha256':standard.owned.sha256_file(ROOT/successor['consolidation_path'])})
    if len({r['source'] for r in result}) != len(result): raise ValueError('Duplicate handoff.')
    return result


def inventory(config):
    """Read only canonical public metadata, never model staging or provider state."""
    if config != registry():
        raise ValueError('Use the exact canonical qualification registry.')
    declared = {owner['id'] for owner in config['owners']}
    folded = folded_history()
    states = {}
    for path in sorted((ROOT / '.implementation-roadmaps').glob('*/state.json')):
        state = read(path)
        if (path.parent.name not in {r['source'] for r in folded}
                and (path.parent.name in declared or state['status'] not in ('completed','complete','final-approved')
                     and any(b['status']=='open' for b in state['blockers']))):
            states[path.parent.name] = state
    if set(states) != {o['id'] for o in config['owners']}:
        raise ValueError('Unmapped or changed open roadmap owner; update coverage before execution.')
    result = []
    for owner in config['owners']:
        state = states[owner['id']]
        if type(state['status']) is not str or state['status'] not in {
                'discovery','decision-options','decision-approval','roadmap-drafting','roadmap-review',
                'approval-required','ready','executing','implementation-complete-qualification-pending',
                'roadmap-ready-to-close','blocked','completed','complete','final-approved'}:
            raise ValueError('Unknown recorded roadmap status.')
        refs = []
        for ref in owner['criteria']:
            increment_id, criterion_id = ref.split('/')
            increment = next((i for i in state['increments'] if i['id']==increment_id), None)
            criterion = next((c for c in increment['acceptanceCriteria'] if c['id']==criterion_id), None) if increment else None
            if criterion is None: raise ValueError('Missing canonical criterion.')
            if type(criterion.get('qualification')) is not str or criterion['qualification'] not in ('local','controlled-environment'):
                raise ValueError('Unknown canonical qualification type.')
            refs.append({'increment_id':increment_id, 'criterion_id':criterion_id,
                'increment_status':increment['status'], 'description':criterion['description'], 'qualification':criterion['qualification']})
        completed = state['status'] in ('completed','complete','final-approved')
        if completed and (any(b['status']=='open' for b in state['blockers'])
                or any(i['status'] not in ('completed','complete','final-approved') for i in state['increments'])
                or any(type(i.get('pendingCriteria')) is not list or i['pendingCriteria'] for i in state['increments'])):
            raise ValueError('Completed owner metadata is contradictory.')
        if not completed and refs and not any(ref['increment_status'] not in ('completed','complete','final-approved') for ref in refs):
            raise ValueError('Registered qualification targets are already complete.')
        blockers = [{k:b[k] for k in ('id','kind','summary','requiredAction')} for b in state['blockers'] if b['status']=='open']
        if not completed and not refs and not blockers:
            raise ValueError('Issue-only security coverage requires an unresolved issue.')
        # A resolved issue never qualifies a pending technical criterion. The
        # legacy field name stays compatible; human-only labels live in the UI.
        if len(blockers) > 24: raise ValueError('Blocker count exceeded.')
        result.append({'roadmap_id':owner['id'], 'roadmap_status':state['status'], 'coverage':owner['coverage'],
            'criteria':refs, 'blockers':blockers, 'remaining_prerequisites':owner['pending'],
            'completed_history':completed, 'parent_qualification':'not-asserted' if completed else 'pending',
            'folded_history':[r for r in folded if r['owner']==owner['id']]})
    return result


def bindings(config):
    return {'runtime':standard.identity(), 'bundle_operator_sha256':standard.owned.sha256_file(Path(__file__)),
            'registry_sha256':standard.owned.sha256_file(ROOT / REGISTRY), 'inventory_digest':digest(inventory(config)),
            'validated_handoffs':folded_history()}


def remaining_selection(bundle_id, profile):
    """Select unresolved current candidates from reviewed, immutable evidence.

    Old passes are scheduling references, never current-source qualification.
    No model, provider, process or retained-stage operation occurs here.
    """
    assessment = read(ROOT/'docs/operations/model-blocker-evidence-assessment.json')
    if bundle_id != assessment['bundle_id'] or profile not in PROFILES:
        raise ValueError('Use the independently assessed evidence bundle.')
    folder = folder_for(bundle_id)
    if standard.owned.sha256_file(folder/'evidence-index.json') != assessment['bundle_index_sha256']:
        raise ValueError('Archived bundle index changed.')
    index = read(folder/'evidence-index.json')
    if set(index['files']) != {'plan.json','summary.json','coverage.json','execution.json'}:
        raise ValueError('Archived bundle index incomplete.')
    for name, sha in index['files'].items():
        if standard.owned.sha256_file(folder/name) != sha: raise ValueError('Archived bundle bytes changed.')
    plan, summary = read(folder/'plan.json'), read(folder/'summary.json')
    if (standard.owned.sha256_file(folder/'plan.json') != assessment['plan_sha256']
            or standard.owned.sha256_file(folder/'summary.json') != assessment['summary_sha256']
            or plan['bindings']['runtime']['source'] != assessment['source_identity']
            or summary['status'] != 'evidence-collected-review-required'
            or [p['profile'] for p in plan['profiles']] != PROFILES):
        raise ValueError('Unreviewed archived source or collection.')
    entry = next(p for p in plan['profiles'] if p['profile']==profile)
    attested = next(p for p in assessment['profiles'] if p['profile']==profile)
    sub = standard.run_folder(entry['run_id'])
    if (entry['run_id'] != attested['run_id'] or entry['plan_sha256'] != attested['plan_sha256']
            or standard.owned.sha256_file(sub/'plan.json') != entry['plan_sha256']
            or standard.owned.sha256_file(sub/'report.json') != attested['report_sha256']
            or standard.owned.sha256_file(sub/'evidence-index.json') != attested['evidence_index_sha256']):
        raise ValueError('Archived model bindings changed.')
    old, report, subindex = read(sub/'plan.json'), read(sub/'report.json'), read(sub/'evidence-index.json')
    rows = standard.read_measurements(sub, report['measurements'])
    names = {f'{d}-{m}-{n}-{v}' for d in standard.DEVICES for m in standard.MODES for n in (1,2,3) for v in standard.VARIANTS}
    expected_files = {'plan.json','execution.json','report.json'} | {r['directory']+'/cohort.json' for r in rows}
    if (len(rows)!=24 or {r['directory'] for r in rows}!=names or set(subindex['files']) != expected_files
            or old['bindings'] != plan['bindings']['runtime'] or report['bindings'] != old['bindings']
            or report['plan_sha256'] != entry['plan_sha256'] or report.get('source_stable') is not True):
        raise ValueError('Archived matrix incomplete or unbound.')
    for name, sha in subindex['files'].items():
        path = standard.original.checked_path((sub/name).relative_to(ROOT).as_posix())
        if standard.owned.sha256_file(path) != sha: raise ValueError('Archived model evidence changed.')
    selected, passed = [], []
    for row in rows:
        value, observed = row['measurement'], row['observation']
        if (type(observed.get('physical_exit_code')) is not int or observed['physical_exit_code']!=0
                or row.get('source_stable') is not True or type(row['replicate']) is not int
                or value.get('bindings') != old['bindings'] or value.get('model_profile') != profile
                or value.get('status') != row['status']
                or any(value.get(k) is not True for k in ('cleanup_passed','generator_cache_empty','retained_leases_empty'))):
            raise ValueError('Archived lifecycle or identity unconfirmed.')
        if row['variant'] != 'candidate': continue
        accepted = False
        if row['status']=='measured':
            replayed = standard.replay_measurement(value,old,'candidate',row['device'],row['replicate'],row['mode'])
            limits = standard.checked_host_limits(old)
            accepted = (all(p['correct']>=22 and p['invalid_accepted']==0 for p in replayed['phases'].values())
                and type(observed.get('peak_rss_bytes')) is int and 0<observed['peak_rss_bytes']<=standard.RSS_LIMIT
                and replayed['model_delivery_seconds']<=limits['primary_delivery_budget_seconds'][row['device']]
                and value['peak_reserved_vram_bytes']<=limits['reserved_vram_budget_bytes'][row['device']])
        (passed if accepted else selected).append(row['directory'])
    return {'schema_version':'remaining-model-selection-v1','reference_bundle':bundle_id,
        'reference_index_sha256':assessment['bundle_index_sha256'], 'quality_floor':22,
        'selected_cohorts':sorted(selected),'previously_accepted_cohorts':sorted(passed),
        'historical_baselines':'reference-only-not-executed',
        'scope':'Only unresolved current candidates. Historical passes are not transferred; paired regression/native/offload/host/provider gaps remain.'}


def plan_bundle(remaining_from=None):
    config = registry(); authority = inventory(config); bound = bindings(config)
    folder = standard.diagnostics.safe_directory(ROOT / OUTPUT, create=True) / uuid.uuid4().hex
    folder.mkdir(exist_ok=False)
    save(folder, 'summary.json', {'status':'planning', 'qualification_complete':False})
    plans = []
    try:
        for profile in PROFILES:
            if remaining_from:
                prepared = standard.plan_experiment(profile, config['host_profile'], remaining_selection(remaining_from,profile))
            else:
                prepared = standard.plan_experiment(profile, config['host_profile'])
            plans.append({'profile':profile, 'run_id':prepared['run_id'], 'plan_sha256':prepared['plan_sha256']})
        if bindings(config) != bound: raise ValueError('Source or roadmap inventory changed while planning.')
        plan = {'schema_version':'model-blocker-bundle-v1', 'created_at':standard.diagnostics.now(),
                'bindings':bound, 'host_profile':config['host_profile'], 'inventory':authority, 'profiles':plans,
                'scope':'Fixed exposed classification comparisons only; other blockers explicitly pending. No parent completion.'}
        if remaining_from:
            plan['remaining_from'] = remaining_from
            plan['scope'] = 'Only unresolved current-model evidence; reviewed prior passes and historical baselines are not executed or transferred. Other blockers remain pending.'
        save(folder, 'plan.json', plan)
        save(folder, 'coverage.json', {'schema_version':'model-blocker-coverage-report-v1','owners':authority,'qualification_complete':False})
        save(folder, 'summary.json', {'status':'planned-not-executed','qualification_complete':False,'profiles':plans})
    except BaseException as error:
        save(folder, 'summary.json', {'status':'preflight-failed','qualification_complete':False,'error_type':standard.diagnostics.failure(error),
            'failure_log':standard.diagnostics.failure_log(error,'operator-planning')})
        print(f'Evidence: {folder / "summary.json"}', flush=True)
        raise
    result = {'run_id':folder.name, 'plan_sha256':standard.owned.sha256_file(folder/'plan.json'),
              'evidence':str(folder/'summary.json')}
    print(json.dumps(result), flush=True)
    return result


class AttemptedBundle(ValueError):
    """The immutable attempt must be preserved; use an explicit fresh restart."""


def load_bundle(folder, approved_sha, *, template=False):
    if not re.fullmatch(r'[a-f0-9]{64}', approved_sha or '') or standard.owned.sha256_file(folder/'plan.json') != approved_sha:
        raise ValueError('Exact reviewed bundle digest required.')
    plan = read(folder/'plan.json', 256*1024); config = registry()
    required = {'schema_version','created_at','bindings','host_profile','inventory','profiles','scope'}
    if (not required <= set(plan) or set(plan)-required-{'restart_of','remaining_from'}
            or plan['schema_version'] != 'model-blocker-bundle-v1' or plan['host_profile'] != config['host_profile']
            or plan['bindings'] != bindings(config) or plan['inventory'] != inventory(config)
            or [p['profile'] for p in plan['profiles']] != PROFILES
            or len({p['run_id'] for p in plan['profiles']}) != len(PROFILES)):
        raise ValueError('Bundle source, inventory or model protocol changed.')
    if 'restart_of' in plan:
        origin = plan['restart_of']
        if (not isinstance(origin, dict) or set(origin) != {'run_id','plan_sha256'}
                or not re.fullmatch(r'[a-f0-9]{32}', origin['run_id']) or origin['run_id'] == folder.name
                or not re.fullmatch(r'[a-f0-9]{64}', origin['plan_sha256'])):
            raise ValueError('Invalid restart lineage.')
        origin_path = folder_for(origin['run_id'])/'plan.json'
        if standard.owned.sha256_file(origin_path) != origin['plan_sha256']:
            raise ValueError('Restart lineage changed.')
    if read(folder/'coverage.json') != {'schema_version':'model-blocker-coverage-report-v1','owners':plan['inventory'],'qualification_complete':False}:
        raise ValueError('Bundle coverage changed.')
    if not template and ((folder/'execution.json').exists() or read(folder/'summary.json').get('status') != 'planned-not-executed'):
        raise AttemptedBundle('Preserve the old attempt; use explicit restart.')
    for entry in plan['profiles']:
        if set(entry) != {'profile','run_id','plan_sha256'}: raise ValueError('Unknown model-plan entry.')
        subfolder = standard.run_folder(entry['run_id']); subplan = standard.load_plan(subfolder)
        if (standard.owned.sha256_file(subfolder/'plan.json') != entry['plan_sha256']
                or subplan['model_profile'] != entry['profile'] or subplan.get('host_profile') != config['host_profile']
                or subplan['bindings'] != plan['bindings']['runtime']):
            raise ValueError('Substituted model plan.')
        selection = subplan.get('remaining_selection')
        if ('remaining_from' in plan) != (selection is not None) or selection is not None and selection != remaining_selection(plan['remaining_from'],entry['profile']):
            raise ValueError('Remaining-only selection changed.')
        if not template and (read(subfolder/'report.json')['status'] != 'planned-not-executed' or (subfolder/'execution.json').exists()):
            raise AttemptedBundle('A model plan was already attempted; preserve it.')
    return plan


def restart_bundle(folder, approved_sha):
    """One fresh trial of the reviewed protocol; never resume or edit old evidence."""
    template = load_bundle(folder, approved_sha, template=True)
    prepared = plan_bundle(template['remaining_from']) if 'remaining_from' in template else plan_bundle()
    fresh_folder = folder_for(prepared['run_id'])
    fresh = load_bundle(fresh_folder, prepared['plan_sha256'])
    fields = {'schema_version','bindings','host_profile','inventory','scope','remaining_from'}
    if any(fresh.get(k) != template.get(k) for k in fields):
        raise ValueError('Restart changed the reviewed bundle protocol.')
    for old, new in zip(template['profiles'], fresh['profiles'], strict=True):
        before = standard.load_plan(standard.run_folder(old['run_id']))
        after = standard.load_plan(standard.run_folder(new['run_id']))
        if old['profile'] != new['profile'] or {k:v for k,v in before.items() if k != 'created_at'} != {k:v for k,v in after.items() if k != 'created_at'}:
            raise ValueError('Restart changed the reviewed model protocol.')
    fresh['restart_of'] = {'run_id':folder.name, 'plan_sha256':approved_sha}
    save(fresh_folder, 'plan.json', fresh)
    new_sha = standard.owned.sha256_file(fresh_folder/'plan.json')
    load_bundle(fresh_folder, new_sha)
    print(json.dumps({'status':'fresh-restart','template':folder.name,'run_id':fresh_folder.name,
        'plan_sha256':new_sha,'evidence':str(fresh_folder/'summary.json')}), flush=True)
    return fresh_folder, new_sha


def inspect_result(entry):
    folder = standard.run_folder(entry['run_id']); plan = standard.load_plan(folder)
    report = read(folder/'report.json'); index = read(folder/'evidence-index.json')
    rows = standard.read_measurements(folder, report['measurements'])
    expected = {'plan.json','execution.json','report.json'} | {r['directory']+'/cohort.json' for r in rows if r.get('measurement_sha256')}
    if set(index['files']) != expected: raise ValueError('Incomplete or unexpected model evidence index.')
    for name, value in index['files'].items():
        if standard.owned.sha256_file(standard.original.checked_path((folder/name).relative_to(ROOT).as_posix())) != value:
            raise ValueError('Changed model evidence.')
    if (report['bindings'] != plan['bindings'] or report['plan_sha256'] != entry['plan_sha256']
            or report.get('source_stable') is not True):
        raise ValueError('Incomplete or unbound model matrix; stop successors.')
    expected_rows = {(d,m,n,v) for d in standard.DEVICES for m in standard.MODES for n in (1,2,3) for v in standard.VARIANTS}
    if 'remaining_selection' in plan:
        expected_rows = {(d,m,n,v) for d,m,n,v in expected_rows if f'{d}-{m}-{n}-{v}' in plan['remaining_selection']['selected_cohorts']}
    if len(rows) != len(expected_rows): raise ValueError('Wrong selected cohort count.')
    if {(r['device'],r['mode'],r['replicate'],r['variant']) for r in rows} != expected_rows:
        raise ValueError('Missing or duplicate cohort.')
    outcomes = []
    for row in rows:
        value = row.get('measurement', {}); observation = row.get('observation', {})
        expected_identity = {'bindings':plan['bindings'], 'model_profile':plan['model_profile'],
            'model':plan['model'], 'revision':plan['revision'], 'precision':plan['precision'], 'memory_mode':'standard',
            **{k:row[k] for k in ('device','mode','variant','replicate')}, 'plan_sha256':entry['plan_sha256']}
        if (type(observation.get('physical_exit_code')) is not int or observation['physical_exit_code'] != 0
                or row.get('source_stable') is not True or row['status'] != value.get('status')
                or type(row['replicate']) is not int or any(value.get(k)!=v for k,v in expected_identity.items())
                or type(observation.get('peak_rss_bytes')) is not int or not 0 < observation['peak_rss_bytes'] <= standard.RSS_LIMIT
                or any(value.get(k) is not True for k in ('cleanup_passed','generator_cache_empty','retained_leases_empty'))):
            raise ValueError('Native exit/model cleanup unobserved; stop successors.')
        outcome = {k:row[k] for k in ('device','mode','variant','replicate','status')}
        outcome.update(native_exit_code=0, cleanup_passed=True, measurement_sha256=row['measurement_sha256'])
        if row['status'] == 'denied-memory':
            # Public finite evidence only. CUDA capacity is not interchangeable
            # with CPU RAM; never suggest pagefile/overflow as a free-RAM fix.
            events = value.get('resource_events', [])
            if not isinstance(events, list) or len(events) > 64:
                raise ValueError('Invalid memory-denial observations.')
            required_key = 'requiredMemoryBytes' if row['device'] == 'cpu' else 'requiredAcceleratorMemoryBytes'
            available_key = 'availableMemoryBytes' if row['device'] == 'cpu' else 'availableAcceleratorMemoryBytes'
            deficits = []
            for event in events:
                if not isinstance(event, dict): raise ValueError('Invalid memory-denial event.')
                required, available = event.get(required_key), event.get(available_key)
                if type(required) is int and type(available) is int and 0 <= available < required < 2**63:
                    deficits.append({'required_bytes':required, 'available_bytes':available, 'shortfall_bytes':required-available})
            outcome['memory_denial'] = {'device':row['device'], 'observed':bool(deficits),
                'maximum_shortfall_bytes':max((d['shortfall_bytes'] for d in deficits), default=None)}
        if row['status']=='measured':
            checked = standard.replay_measurement(value, plan, row['variant'], row['device'], row['replicate'], row['mode'])
            limits = standard.checked_host_limits(plan)
            rss = observation.get('peak_rss_bytes')
            if type(rss) is not int or not 0 < rss <= standard.RSS_LIMIT: raise ValueError('RSS evidence invalid.')
            outcome.update(first_correct=checked['phases']['first']['correct'], warm_correct=checked['phases']['warm']['correct'],
                primary_delivery_seconds=checked['model_delivery_seconds'], peak_rss_bytes=rss,
                automatic_label_fixture_floor_met=all(p['correct']>=23 for p in checked['phases'].values()),
                user_accepted_absolute_floor_met=all(p['correct']>=22 and p['invalid_accepted']==0 for p in checked['phases'].values()),
                invalid_accepted_count=sum(p['invalid_accepted'] for p in checked['phases'].values()),
                host_budget_met=checked['model_delivery_seconds']<=limits['primary_delivery_budget_seconds'][row['device']]
                    and value['peak_reserved_vram_bytes']<=limits['reserved_vram_budget_bytes'][row['device']])
        outcomes.append(outcome)
    comparisons = [standard.assess_pairs([r for r in rows if r['device']==d and r['mode']==m], plan,d,m) for d in plan['devices'] for m in standard.MODES]
    if comparisons != report['comparisons']: raise ValueError('Model comparison differs from replay.')
    qualified = all(c['measurement_complete'] and c['quality_passed'] for c in comparisons) and any(c['throughput_target_met'] for c in comparisons)
    if (type(report.get('qualification_complete')) is not bool or report['qualification_complete'] != qualified
            or report['status'] != ('qualified-fixed-task-profile' if qualified else 'not-qualified-see-cohorts')):
        raise ValueError('Model qualification claim differs from replay.')
    return {'profile':entry['profile'], 'run_id':entry['run_id'], 'status':report['status'],
        'report_sha256':standard.owned.sha256_file(folder/'report.json'), 'evidence_index_sha256':standard.owned.sha256_file(folder/'evidence-index.json'),
        'comparison_profile_qualified':report['qualification_complete'], 'protocol_version':plan['schema_version'],
        'historical_protocol_qualified':False, 'host_limits':plan['host_limits'],
        'comparisons':comparisons, 'cohorts':outcomes, 'safe_for_successor':True,
        'scope':'Resource targets and fixture scores are separate; no general capability or parent pass.'}


def remaining_diagnosis(profiles):
    """Summarize already verified rows; no process or old-stage inspection."""
    cohorts = [c for p in profiles for c in p['cohorts']]
    shortages = [c['memory_denial']['maximum_shortfall_bytes'] for c in cohorts
                 if c.get('memory_denial', {}).get('device') == 'cpu'
                 and c['memory_denial']['observed']]
    return {'schema_version':'model-blocker-diagnosis-v1',
        'memory_denied_cohorts':sum(c['status']=='denied-memory' for c in cohorts),
        'cpu_maximum_observed_ram_shortfall_bytes':max(shortages, default=None),
        'candidate_absolute_quality_failures':sum(c['variant']=='candidate' and c['status']=='measured'
            and not c['user_accepted_absolute_floor_met'] for c in cohorts),
        'invalid_accepted_outputs':sum(c.get('invalid_accepted_count', 0) for c in cohorts),
        'next_actions':['collect-only-unresolved-cohorts', 'preserve-native-offload-and-provider-prerequisites'],
        'scope':'Observed deficits are past free physical RAM, not installed RAM, a pagefile recommendation, or permission to weaken admission.22of24 is a separate user-accepted check; legacy protocol gates and parent qualification remain separate.'}


def execute_bundle(folder, approved_sha):
    if os.name != 'nt': raise ValueError('Reviewed Windows host required.')
    plan = load_bundle(folder, approved_sha)
    with (folder/'execution.json').open('x', encoding='utf-8') as intent:
        json.dump({'started_at':standard.diagnostics.now(),'approved_plan_sha256':approved_sha}, intent)
        intent.flush(); os.fsync(intent.fileno())
    report = {'schema_version':'model-blocker-summary-v1','status':'running','qualification_complete':False,
        'plan_sha256':approved_sha,'bindings':plan['bindings'],'profiles':[],
        'coverage':plan['inventory'],'started_at':standard.diagnostics.now(), 'remaining_blockers':sum(len(o['blockers']) for o in plan['inventory'])}
    save(folder,'summary.json',report)
    code = 1
    try:
        for entry in plan['profiles']:
            if bindings(registry()) != plan['bindings']: raise ValueError('Source or inventory drift; stop scheduling.')
            print(f"Starting {entry['profile']}: exact reviewed cohorts, CPU first, then CUDA.", flush=True)
            result_code = standard.execute(standard.run_folder(entry['run_id']), entry['plan_sha256'])
            raw = read(standard.run_folder(entry['run_id'])/'report.json')
            if result_code == 2 or raw['status'] not in ('qualified-fixed-task-profile','not-qualified-see-cohorts'):
                report['profiles'].append({'profile':entry['profile'],'run_id':entry['run_id'],'status':raw['status'],'safe_for_successor':False})
                raise ValueError('Aborted or unknown native/model state; no successor permitted.')
            report['profiles'].append(inspect_result(entry)); save(folder,'summary.json',report)
        if bindings(registry()) != plan['bindings']: raise ValueError('Source changed at completion.')
        report['diagnosis'] = remaining_diagnosis(report['profiles'])
        report['status']='evidence-collected-review-required'; code=0
    except BaseException as error:
        report.update(status='halted-pending-evidence', error_type=standard.diagnostics.failure(error),
            failure_log=standard.diagnostics.failure_log(error,'operator-execution'))
    finally:
        report['finished_at']=standard.diagnostics.now(); save(folder,'summary.json',report)
        save(folder,'evidence-index.json',{'schema_version':'model-blocker-evidence-v1',
            'files':{name:standard.owned.sha256_file(folder/name) for name in ('plan.json','summary.json','coverage.json','execution.json')}})
        print(f'Evidence: {folder / "summary.json"}', flush=True)
        print('Collection status: '+report['status']+'. All owning roadmap qualification remains pending review.', flush=True)
    return code


def _legacy_quality_main(argv=None):
    """Historical protocol compatibility; the current CLI never dispatches here."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true'); parser.add_argument('--plan-only',action='store_true')
    parser.add_argument('--approved-run'); parser.add_argument('--plan-sha256')
    parser.add_argument('--remaining-from', help='Plan only unresolved candidates from the exact independently assessed bundle.')
    parser.add_argument('--restart', action='store_true', help='Start one fresh same-protocol attempt; preserve previous evidence.')
    args=parser.parse_args(argv)
    if args.plan_only or not args.run:
        if args.approved_run or args.plan_sha256 or args.restart: parser.error('Planning and executing an approved bundle are separate operations.')
        if not args.remaining_from: parser.error('Specify --remaining-from with the independently assessed bundle; new full-matrix plans are not offered.')
        plan_bundle(args.remaining_from)
        return 0
    if args.remaining_from: parser.error('RemainingFrom is frozen during planning, not selected during execution.')
    if not args.approved_run or not args.plan_sha256:
        parser.error('First prepare --all-blocked --plan-only and obtain review; execution requires --approved-run and --plan-sha256.')
    folder = folder_for(args.approved_run)
    try:
        with slot('coordinator'):
            # A surviving child owns this independent slot even if its parent died.
            with slot('worker'): pass
            if args.restart:
                folder, sha = restart_bundle(folder, args.plan_sha256)
            else:
                sha = args.plan_sha256
            return execute_bundle(folder, sha)
    except AttemptedBundle:
        print(json.dumps({'status':'operator-refused','reason_code':'bundle-already-attempted',
            'next_action':'Preserve this evidence. Use --restart for one fresh same-source trial; never delete execution records.',
            'evidence':str(folder/'summary.json')}), flush=True)
        return 1
    except QualificationBusy:
        print(json.dumps({'status':'operator-refused','reason_code':'standard-test-still-running',
            'next_action':'Wait for the existing owned test to exit, then retry. No process was terminated.'}), flush=True)
        return 1
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({'status':'operator-refused','reason_code':'source-plan-or-evidence-changed',
            'error_type':standard.diagnostics.failure(error),
            'failure_log':standard.diagnostics.failure_log(error,'operator-admission'),
            'next_action':'Keep the saved evidence and request a fresh reviewed current-source plan.'}), flush=True)
        return 1


def _closed_quality_bytes():
    path=standard.original.checked_path('docs/operations/model-software-quality-qualification.json')
    with path.open('rb') as stream:return stream.read(65537)


def closed_quality_history():
    """Read accepted metadata only. Never inspect/rescore the archived cohorts."""
    body=_closed_quality_bytes()
    if type(body) is not bytes or not 0<len(body)<=65536:raise ValueError('Quality policy byte bound.')
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError('Duplicate policy key.')
            result[key]=value
        return result
    def invalid(_value):raise ValueError('Invalid policy number.')
    def finite(value):
        number=float(value)
        if not math.isfinite(number):raise ValueError('Invalid policy number.')
        return number
    value=json.loads(body.decode('utf-8'),object_pairs_hook=unique,parse_constant=invalid,parse_float=finite)
    if (type(value) is not dict or value.get('schema_version')!='model-software-quality-qualification-v1'
            or value.get('status')!='completed' or value.get('qualification')!='passed'
            or value.get('authority_ref')!='user-explicit-30percent-small-80percent-larger-software-quality-and-close-model-quality-tests'):
        raise ValueError('Closed quality policy required.')
    expected={'qwen05-float32':(30,'Qwen/Qwen2.5-0.5B-Instruct'),
              'qwen15-bfloat16':(80,'Qwen/Qwen2.5-1.5B-Instruct')}
    requirements=value['requirements'];evidence=value['evidence'];profiles=value['profiles']
    if (type(requirements) is not dict or type(evidence) is not dict or type(profiles) is not list or len(profiles)!=2
            or requirements.get('changes_to_production_safety_guards') is not False):
        raise ValueError('Invalid closed quality policy.')
    def hexadecimal(item,length):
        if type(item) is not str or not re.fullmatch('[a-f0-9]{'+str(length)+'}',item):raise ValueError('Invalid accepted reference.')
        return item
    bundle=hexadecimal(evidence['bundle'],32)
    for name in ('plan_sha256','summary_sha256','index_sha256'):hexadecimal(evidence[name],64)
    result={};policy_sha=hashlib.sha256(body).hexdigest()
    for profile in profiles:
        if type(profile) is not dict or profile.get('profile') not in expected or profile['profile'] in result:
            raise ValueError('Unknown or duplicate accepted profile.')
        name=profile['profile'];floor,model=expected[name];declared=requirements[name+'_minimum_accuracy_percent']
        if (type(declared) is not int or declared!=floor or type(profile.get('required_accuracy_percent')) is not int
                or profile['required_accuracy_percent']!=floor or profile.get('model')!=model or profile.get('memory_mode')!='standard'
                or profile.get('quality_test_status')!='completed' or profile.get('quality_qualification')!='passed'
                or type(profile.get('integer_minimum_correct_per24')) is not int
                or profile['integer_minimum_correct_per24']!=(floor*24+99)//100):
            raise ValueError('Accepted profile differs from closed policy.')
        result[name]={'profile':name,'required_accuracy_percent':floor,'qualification':'completed-reference-only',
            'memory_mode':'standard','model_revision':hexadecimal(profile['revision'],40),
            'run_id':hexadecimal(profile['run_id'],32),'plan_sha256':hexadecimal(profile['plan_sha256'],64),
            'report_sha256':hexadecimal(profile['report_sha256'],64),'evidence_index_sha256':hexadecimal(profile['evidence_index_sha256'],64),
            'policy_sha256':policy_sha,'accepted_bundle_id':bundle,'accepted_bundle_index_sha256':evidence['index_sha256']}
    return [result[name] for name in PROFILES]


class SchedulingParser(argparse.ArgumentParser):
    def error(self,_message):self.exit(2,'Invalid model-test scheduling options. Use --help.\n')


def main(argv=None):
    """Current all-blocked entry: closed quality is history, never new work."""
    parser=SchedulingParser(prog='model-test-scheduling',description='Report accepted model quality and remaining technical work without loading models.')
    parser.add_argument('--run',action='store_true');parser.add_argument('--plan-only',action='store_true')
    parser.add_argument('--approved-run');parser.add_argument('--plan-sha256')
    parser.add_argument('--remaining-from',help='Historical bundle reference; accepted quality is not collected again.')
    parser.add_argument('--restart',action='store_true',help='Compatibility option; closed quality tests are not restarted.')
    args=parser.parse_args(argv)
    if ((args.approved_run is None)!=(args.plan_sha256 is None)
            or args.approved_run is not None and not re.fullmatch('[a-f0-9]{32}',args.approved_run)
            or args.plan_sha256 is not None and not re.fullmatch('[a-f0-9]{64}',args.plan_sha256)
            or args.remaining_from is not None and not re.fullmatch('[a-f0-9]{32}',args.remaining_from)
            or args.restart and args.approved_run is None):parser.error('Invalid historical selector.')
    report={'schema_version':'current-model-work-v1','qualification_complete':False,'model_started':False,
            'native_effects':False,'scheduled_quality_cohorts':[],'evidence_directory_created':False,
            'resource_qualification':'pending-not-asserted','parent_qualification':'not-asserted'}
    try:
        history=closed_quality_history();rows=inventory(registry())
        owners=[{'roadmap_id':row['roadmap_id'],'recorded_status':row['roadmap_status'],
            'classification':'completed-history' if row['completed_history'] else 'technical-work-pending',
            'criterion_refs':[r['increment_id']+'/'+r['criterion_id'] for r in row['criteria']]} for row in rows]
        report.update(status='quality-closed-no-collection',accepted_quality_history=history,owners=owners,
            message='Accepted model quality stays closed. No quality tests were started.',
            next_action='The agent must finish native recovery and separate resource, delivery and cleanup checks. These remain pending.')
        if len(json.dumps(report,allow_nan=False).encode())>65536:raise ValueError('Current work report exceeded its bound.')
    except Exception:
        report.update(status='metadata-unavailable-no-collection',
            message='The agent must repair the test status records. No model tests were started.')
        # Do not disclose partial, contradictory or unbounded metadata.
        report.pop('accepted_quality_history',None);report.pop('owners',None);report.pop('next_action',None)
        print(json.dumps(report,allow_nan=False,sort_keys=True),flush=True);return 1
    print(json.dumps(report,allow_nan=False,sort_keys=True),flush=True);return 0


if __name__=='__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'status':'operator-refused','error_type':standard.diagnostics.failure(error),
            'failure_log':standard.diagnostics.failure_log(error,'operator-admission')}),flush=True)
        raise SystemExit(1) from None

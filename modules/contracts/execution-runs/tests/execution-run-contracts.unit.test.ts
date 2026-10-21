import { describe, expect, it } from '../../../testing/node-test';
import { normalizeExecutionRunId, normalizeExecutionAttemptId, normalizeExecutionRunStatus, normalizeExecutionAttemptStatus, normalizeExecutionApprovalStatus, normalizeExecutionRuntimeReferenceStatus, normalizeExecutionCancellationStatus, normalizeExecutionRetryStatus, normalizeExecutionRunRecord } from '..';
import * as records from '../execution-run-normalization';

const at = '2026-01-01T00:00:00.000Z';
const scoped = {workspaceId:'ws-1',executionRunId:'run-1'};
const history = {blockers:[],diagnostics:[],provenance:[]};
const run = {id:'run-1',workspaceId:'ws-1',sourceExecutionPlanId:'plan-1',status:'running',attemptIds:[],eventIds:[],resultIds:[],...history,createdAt:at,updatedAt:at};
const fixtures: [((value: unknown) => unknown), any][] = [
 [records.normalizeExecutionRunRecord,run],
 [records.normalizeExecutionAttemptRecord,{...scoped,...history,id:'attempt-1',attemptNumber:1,status:'started',runtimeReferenceId:'runtime-1',createdAt:at,updatedAt:at}],
 [records.normalizeExecutionEventRecord,{...scoped,blockers:[],diagnostics:[],id:'event-1',conversationSessionId:'session-1',conversationTurnId:'turn-1',kind:'run-created',category:'lifecycle',message:'Created',at}],
 [records.normalizeExecutionResultRecord,{...scoped,...history,id:'result-1',kind:'artifact-reference',status:'recorded',outputReferenceId:'output-1',summary:'Ready',conversationTurnId:'turn-1',createdAt:at}],
 [records.normalizeExecutionApprovalRecord,{...scoped,...history,id:'approval-1',sourceExecutionPlanId:'plan-1',approvalKind:'execution-run-start',approvalStatus:'pending',label:'Review',createdAt:at,updatedAt:at}],
 [records.normalizeExecutionRuntimeReferenceRecord,{workspaceId:'ws-1',blockers:[],diagnostics:[],id:'runtime-1',sourceExecutionPlanAdapterReferenceId:'adapter-1',sourceRuntimeReadinessBindingId:'readiness-1',runtimeKind:'local',capabilityKind:'text-generation',status:'supported',label:'Local'}],
 [records.normalizeExecutionCancellationRequestRecord,{...scoped,diagnostics:[],provenance:[],id:'cancel-1',executionAttemptId:'attempt-1',status:'completed',requestedAt:at,acknowledgedAt:at,completedAt:at}],
 [records.normalizeExecutionRetryRequestRecord,{workspaceId:'ws-1',diagnostics:[],provenance:[],id:'retry-1',originalExecutionRunId:'run-1',originalExecutionAttemptId:'attempt-1',resultingExecutionRunId:'run-2',resultingExecutionAttemptId:'attempt-2',status:'completed',requestedAt:at,completedAt:at,rejectedAt:at}],
];

describe('execution-run contracts',()=>{
 it('normalizes ids and statuses',()=>{expect(normalizeExecutionRunId('run-1')).toBe('run-1'); expect(normalizeExecutionAttemptId('att-1')).toBe('att-1'); expect(normalizeExecutionRunStatus('running')).toBe('running'); expect(normalizeExecutionAttemptStatus('started')).toBe('started'); expect(normalizeExecutionApprovalStatus('granted')).toBe('granted'); expect(normalizeExecutionRuntimeReferenceStatus('supported')).toBe('supported'); expect(normalizeExecutionCancellationStatus('requested')).toBe('requested'); expect(normalizeExecutionRetryStatus('accepted')).toBe('accepted');});
 it('rejects unsafe ids',()=>{expect(()=>normalizeExecutionRunId(' ../x ')).toThrow('ExecutionRunId must be a safe non-empty identifier.'); expect(()=>normalizeExecutionRunId('https://x')).toThrow('ExecutionRunId must be a safe non-empty identifier.');});
 it('normalizes run record and rejects unsafe metadata payload patterns',()=>{expect(()=>normalizeExecutionRunRecord({id:'run-1',workspaceId:'ws-1',sourceExecutionPlanId:'plan-1',status:'running',attemptIds:[],eventIds:[],resultIds:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'})).not.toThrow();});
});

describe('strict passive execution records',()=>{
 it('roundtrips every declared record family including lifecycle and conversation references',()=>{
  for(const [normalize,value] of fixtures) expect(normalize(value)).toEqual(value);
 });
 it('rejects unknown top-level fields, provenance fields, getters and non-record prototypes without coercion',()=>{
  let calls=0;
  for(const [normalize,value] of fixtures){
   expect(()=>normalize({...value,providerPayload:'private'})).toThrow();
   expect(()=>normalize(Object.assign(Object.create({inherited:true}),value))).toThrow();
   const accessor={...value};Object.defineProperty(accessor,'id',{enumerable:true,get(){calls++;return'value';}});
   expect(()=>normalize(accessor)).toThrow();
   expect(()=>normalize({...value,id:{toString(){calls++;return'run-1';}}})).toThrow();
  }
  expect(calls).toBe(0);
  for(const provenance of [[{kind:'invented',at}],[{kind:'execution-run-created',at,rawPayload:'private'}],[{kind:'execution-run-created',at:'2026-02-30T00:00:00.000Z'}]])
   expect(()=>records.normalizeExecutionRunRecord({...run,provenance})).toThrow();
 });
 it('rejects supplied malformed arrays and bounded-resource attacks but preserves absent legacy arrays',()=>{
  for(const field of ['attemptIds','eventIds','resultIds','blockers','diagnostics','provenance']){
   for(const value of [null,{},'invalid',[undefined],new Array(2),new Array(1025).fill('id')])
    expect(()=>records.normalizeExecutionRunRecord({...run,[field]:value})).toThrow();
  }
  const missing={...run} as any;delete missing.blockers;delete missing.diagnostics;delete missing.provenance;
  expect(records.normalizeExecutionRunRecord(missing).blockers).toEqual([]);
  const cycle:any={kind:'execution-run-created',at};cycle.actorId=cycle;
  expect(()=>records.normalizeExecutionRunRecord({...run,provenance:[cycle]})).toThrow();
  expect(()=>records.normalizeExecutionRunRecord({...run,eventIds:new Array(600).fill('x'.repeat(1000))})).toThrow();
 });
 it('requires primitive IDs, finite bounded progress, actual flags and positive safe attempt numbers',()=>{
  for(const id of [undefined,null,1,true,{}])expect(()=>records.normalizeExecutionRunRecord({...run,id})).toThrow();
  for(const percentage of [NaN,Infinity,-1,101,'50'])expect(()=>records.normalizeExecutionProgressSummary({phase:'generating-response',label:'Generating',at,terminal:false,percentage})).toThrow();
  for(const terminal of ['false',0,null,undefined])expect(()=>records.normalizeExecutionProgressSummary({phase:'finished',label:'Finished',at,terminal})).toThrow();
  expect(records.normalizeExecutionProgressSummary({phase:'generating-response',label:'Generating',at,terminal:false,percentage:0}).percentage).toBe(0);
  for(const attemptNumber of [0,-1,1.5,'1',NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>records.normalizeExecutionAttemptRecord({...fixtures[1][1],attemptNumber})).toThrow();
  expect(()=>records.normalizeExecutionRunRecord({...run,approvalStatus:'invented'})).toThrow();
 });
 it('rejects unsafe nested diagnostic data and strict command extras without exposing rejected values',()=>{
  for(const diagnostics of [[{code:'run.failed',message:'C: private',severity:'error'}],[{code:'run.failed',message:'Failed',severity:'fatal'}],[{code:'run.failed',message:'Failed',severity:'error',payload:'private'}]])
   expect(()=>records.normalizeExecutionRunRecord({...run,diagnostics})).toThrow();
  expect(()=>records.normalizeReadExecutionRunCommand({...scoped,executionRunId:undefined})).toThrow();
  expect(()=>records.normalizeListExecutionRunsCommand({workspaceId:'ws-1',command:'private'})).toThrow();
  expect(()=>records.normalizeExecutionResultRecord({...fixtures[3][1],outputReference:'private'})).toThrow();
 });
 it('rejects actual credential representations in diagnostics, blockers and nested persisted records',()=>{
  for(const prefix of ['ghp_','gho_','github_pat_','sk-proj-','sk-','sk_','hf_','xoxb-']){
   const message=prefix+'syntheticvalue'.repeat(3);
   const diagnostic={code:'run.failed',severity:'error',message};
   expect(()=>records.normalizeExecutionDiagnostic(diagnostic)).toThrow();
   expect(()=>records.normalizeExecutionBlocker({code:'run.failed',message})).toThrow();
   expect(()=>records.normalizeExecutionRunRecord({...run,diagnostics:[diagnostic]})).toThrow();
  }
 });
});

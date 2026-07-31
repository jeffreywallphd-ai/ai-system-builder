import { createWorkspaceId } from '../workspace';
import type { ExecutionPlanRecord } from './execution-plan-record';
import type { ExecutionStep } from './execution-plan-step';
import type { ExecutionDependency } from './execution-plan-dependency';
import type { ExecutionInput, ExecutionOutput } from './execution-plan-input-output';
import type { ExecutionAdapterReference } from './execution-plan-adapter-reference';
import type { ExecutionSafetyGate } from './execution-plan-safety-gate';
import type { ExecutionResourceEstimate } from './execution-plan-resource-estimate';
import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
import type { ExecutionPlanProvenanceEntry } from './execution-plan-provenance';
import { normalizeExecutionPlanStatus, normalizeExecutionStepKind, normalizeExecutionStepStatus } from './execution-plan-status';
import { normalizeExecutionDependencyKind, normalizeExecutionDependencyStatus } from './execution-plan-dependency';
import { normalizeExecutionInputKind, normalizeExecutionInputOutputStatus, normalizeExecutionOutputKind } from './execution-plan-input-output';
import { normalizeExecutionAdapterReferenceKind, normalizeExecutionAdapterReferenceStatus } from './execution-plan-adapter-reference';
import { normalizeExecutionSafetyGateKind, normalizeExecutionSafetyGateStatus } from './execution-plan-safety-gate';
import { normalizeExecutionComputeEstimateCategory, normalizeExecutionDurationEstimateCategory, normalizeExecutionStorageEstimateCategory } from './execution-plan-resource-estimate';
import { normalizeExecutionBlockerId, normalizeExecutionDependencyId, normalizeExecutionDiagnosticId, normalizeExecutionAdapterReferenceId, normalizeExecutionInputId, normalizeExecutionOutputId, normalizeExecutionPlanId, normalizeExecutionResourceEstimateId, normalizeExecutionSafetyGateId, normalizeExecutionStepId, normalizeProviderAdapterReferenceId } from './execution-plan-identity';
import type { CreateExecutionPlanCommand, ReadExecutionPlanCommand, ListExecutionPlansCommand, ArchiveExecutionPlanCommand, RefreshExecutionPlanCommand, PrepareExecutionStepsCommand, PrepareExecutionDependenciesCommand, PrepareExecutionInputsCommand, PrepareExecutionOutputsCommand, ValidateExecutionPlanCommand, PreviewExecutionPlanCommand } from './execution-plan-commands';

const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNSAFE=/(?:https?:\/\/|signed\s*url|[a-zA-Z]:[\\/]|(?:^|\s)(?:\.|~)?\/|\b(?:token|secret|password|credential|api[_-]?key|private[_-]?key|stack\s*trace|command|shell|workflow|graph|payload|prompt|base64|blob|env)\b|[A-Za-z0-9+\/=]{80,})/i;
const CODE=/^[a-z0-9]+(?:[.-][a-z0-9]+){1,7}$/;
const txt=(v:string,f:string,required=true)=>{const t=v.trim(); if(!t&&required) throw new Error(`${f} is invalid.`); if(t&&UNSAFE.test(t)) throw new Error(`${f} is invalid.`); return t||undefined;};
const ts=(v:string,f:string)=>{const t=v.trim(); if(!ISO.test(t)) throw new Error(`${f} is invalid.`); return t;};
const code=(v:string,f:string)=>{const t=v.trim().toLowerCase(); if(!CODE.test(t)||UNSAFE.test(t)) throw new Error(`${f} is invalid.`); return t;};
const ref=(v:string,f:string)=>txt(v,f,true)!;
const EXECUTION_PLAN_RECORD_KEYS = new Set([
  'id',
  'workspaceId',
  'sourceCompositionPlanId',
  'sourceRuntimeReadinessBindingId',
  'sourceReadinessStatus',
  'status',
  'steps',
  'dependencies',
  'inputs',
  'outputs',
  'adapterReferences',
  'safetyGates',
  'blockers',
  'diagnostics',
  'resourceEstimates',
  'provenance',
  'createdAt',
  'updatedAt',
  'archivedAt',
]);

export const normalizeExecutionDiagnostic=(d:ExecutionDiagnostic):ExecutionDiagnostic=>({ ...d, ...(d.diagnosticId?{diagnosticId:normalizeExecutionDiagnosticId(d.diagnosticId as string)}:{}), code: code(d.code,'Diagnostic code'), message: txt(d.message,'Diagnostic message')!, severity:d.severity, ...(d.targetReferenceId?{targetReferenceId:txt(d.targetReferenceId,'Diagnostic target')}:{}), ...(d.targetReferenceKind?{targetReferenceKind:txt(d.targetReferenceKind,'Diagnostic target kind')}:{}),});
export const normalizeExecutionBlocker=(b:ExecutionBlocker):ExecutionBlocker=>({ ...b, ...(b.blockerId?{blockerId:normalizeExecutionBlockerId(b.blockerId as string)}:{}), code: code(b.code,'Blocker code'), message: txt(b.message,'Blocker message')!, ...(b.targetReferenceId?{targetReferenceId:txt(b.targetReferenceId,'Blocker target')}:{}), ...(b.targetReferenceKind?{targetReferenceKind:txt(b.targetReferenceKind,'Blocker target kind')}:{}),});
const diag=(x:ExecutionDiagnostic[])=>x.map(normalizeExecutionDiagnostic); const block=(x:ExecutionBlocker[])=>x.map(normalizeExecutionBlocker);
export const normalizeExecutionStep=(s:ExecutionStep):ExecutionStep=>({...s,id:normalizeExecutionStepId(s.id as string),sourceCompositionPlanId:ref(s.sourceCompositionPlanId,'sourceCompositionPlanId'),...(s.sourceNodeId?{sourceNodeId:txt(s.sourceNodeId,'sourceNodeId')}:{}),...(s.sourceRelationshipId?{sourceRelationshipId:txt(s.sourceRelationshipId,'sourceRelationshipId')}:{}),...(s.planId?{planId:normalizeExecutionPlanId(s.planId as string)}:{}),kind:normalizeExecutionStepKind(s.kind),status:normalizeExecutionStepStatus(s.status),label:txt(s.label,'step label')!,...(s.summary?{summary:txt(s.summary,'step summary')}:{}),requiredAdapterReferenceIds:s.requiredAdapterReferenceIds.map((x)=>normalizeExecutionAdapterReferenceId(x as string)),inputIds:s.inputIds.map((x)=>normalizeExecutionInputId(x as string)),outputIds:s.outputIds.map((x)=>normalizeExecutionOutputId(x as string)),dependencyIds:s.dependencyIds.map((x)=>normalizeExecutionDependencyId(x as string)),safetyGateIds:s.safetyGateIds.map((x)=>normalizeExecutionSafetyGateId(x as string)),...(s.resourceEstimateId?{resourceEstimateId:normalizeExecutionResourceEstimateId(s.resourceEstimateId as string)}:{}),blockers:block(s.blockers),diagnostics:diag(s.diagnostics)});
export const normalizeExecutionDependency=(d:ExecutionDependency):ExecutionDependency=>({...d,id:normalizeExecutionDependencyId(d.id as string),kind:normalizeExecutionDependencyKind(d.kind),status:normalizeExecutionDependencyStatus(d.status),...(d.sourceStepId?{sourceStepId:normalizeExecutionStepId(d.sourceStepId as string)}:{}),...(d.targetStepId?{targetStepId:normalizeExecutionStepId(d.targetStepId as string)}:{}),...(d.adapterReferenceId?{adapterReferenceId:normalizeExecutionAdapterReferenceId(d.adapterReferenceId as string)}:{}),...(d.safetyGateId?{safetyGateId:normalizeExecutionSafetyGateId(d.safetyGateId as string)}:{}),...(d.inputId?{inputId:normalizeExecutionInputId(d.inputId as string)}:{}),...(d.outputId?{outputId:normalizeExecutionOutputId(d.outputId as string)}:{}),...(d.summary?{summary:txt(d.summary,'dependency summary')}:{}),blockers:block(d.blockers),diagnostics:diag(d.diagnostics)});
export const normalizeExecutionInput=(i:ExecutionInput):ExecutionInput=>({...i,id:normalizeExecutionInputId(i.id as string),stepId:normalizeExecutionStepId(i.stepId as string),kind:normalizeExecutionInputKind(i.kind),status:normalizeExecutionInputOutputStatus(i.status),label:txt(i.label,'input label')!,...(i.summary?{summary:txt(i.summary,'input summary')}:{}),sourceReferenceKind:txt(i.sourceReferenceKind,'sourceReferenceKind')!,...(i.sourceReferenceId?{sourceReferenceId:txt(i.sourceReferenceId,'sourceReferenceId')}:{}),required:Boolean(i.required),blockers:block(i.blockers),diagnostics:diag(i.diagnostics)});
export const normalizeExecutionOutput=(o:ExecutionOutput):ExecutionOutput=>({...o,id:normalizeExecutionOutputId(o.id as string),stepId:normalizeExecutionStepId(o.stepId as string),kind:normalizeExecutionOutputKind(o.kind),status:normalizeExecutionInputOutputStatus(o.status),label:txt(o.label,'output label')!,...(o.summary?{summary:txt(o.summary,'output summary')}:{}),destinationReferenceKind:txt(o.destinationReferenceKind,'destinationReferenceKind')!,...(o.destinationReferenceId?{destinationReferenceId:txt(o.destinationReferenceId,'destinationReferenceId')}:{}),required:Boolean(o.required),blockers:block(o.blockers),diagnostics:diag(o.diagnostics)});
export const normalizeExecutionAdapterReference=(a:ExecutionAdapterReference):ExecutionAdapterReference=>({...a,id:normalizeExecutionAdapterReferenceId(a.id as string),kind:normalizeExecutionAdapterReferenceKind(a.kind),status:normalizeExecutionAdapterReferenceStatus(a.status),...(a.providerReferenceId?{providerReferenceId:normalizeProviderAdapterReferenceId(a.providerReferenceId as string)}:{}),...(a.providerKind?{providerKind:txt(a.providerKind,'providerKind')}:{}),...(a.capabilityKind?{capabilityKind:txt(a.capabilityKind,'capabilityKind')}:{}),sourceRuntimeReadinessBindingId:txt(a.sourceRuntimeReadinessBindingId,'sourceRuntimeReadinessBindingId')!,...(a.sourceRuntimeBindingId?{sourceRuntimeBindingId:txt(a.sourceRuntimeBindingId,'sourceRuntimeBindingId')}:{}),label:txt(a.label,'adapter label')!,...(a.summary?{summary:txt(a.summary,'adapter summary')}:{}),blockers:block(a.blockers),diagnostics:diag(a.diagnostics)});
export const normalizeExecutionSafetyGate=(g:ExecutionSafetyGate):ExecutionSafetyGate=>({...g,id:normalizeExecutionSafetyGateId(g.id as string),kind:normalizeExecutionSafetyGateKind(g.kind),status:normalizeExecutionSafetyGateStatus(g.status),label:txt(g.label,'safety gate label')!,...(g.summary?{summary:txt(g.summary,'safety gate summary')}:{}),...(g.stepId?{stepId:normalizeExecutionStepId(g.stepId as string)}:{}),...(g.inputId?{inputId:normalizeExecutionInputId(g.inputId as string)}:{}),...(g.outputId?{outputId:normalizeExecutionOutputId(g.outputId as string)}:{}),...(g.adapterReferenceId?{adapterReferenceId:normalizeExecutionAdapterReferenceId(g.adapterReferenceId as string)}:{}),blockers:block(g.blockers),diagnostics:diag(g.diagnostics)});
export const normalizeExecutionResourceEstimate=(r:ExecutionResourceEstimate):ExecutionResourceEstimate=>({...r,id:normalizeExecutionResourceEstimateId(r.id as string),compute:normalizeExecutionComputeEstimateCategory(r.compute),storage:normalizeExecutionStorageEstimateCategory(r.storage),duration:normalizeExecutionDurationEstimateCategory(r.duration),...(r.summary?{summary:txt(r.summary,'resource summary')}:{}),});
export const normalizeExecutionPlanProvenanceEntry=(p:ExecutionPlanProvenanceEntry):ExecutionPlanProvenanceEntry=>({...p,at:ts(p.at,'provenance at'),...(p.workspaceId?{workspaceId:createWorkspaceId(p.workspaceId)}:{}),...(p.executionPlanId?{executionPlanId:normalizeExecutionPlanId(p.executionPlanId as string)}:{}),...(p.runtimeReadinessBindingId?{runtimeReadinessBindingId:txt(p.runtimeReadinessBindingId,'runtimeReadinessBindingId')}:{}),...(p.compositionPlanId?{compositionPlanId:txt(p.compositionPlanId,'compositionPlanId')}:{}),...(p.stepId?{stepId:normalizeExecutionStepId(p.stepId as string)}:{}),...(p.inputId?{inputId:normalizeExecutionInputId(p.inputId as string)}:{}),...(p.outputId?{outputId:normalizeExecutionOutputId(p.outputId as string)}:{}),...(p.adapterReferenceId?{adapterReferenceId:normalizeExecutionAdapterReferenceId(p.adapterReferenceId as string)}:{}),...(p.safetyGateId?{safetyGateId:normalizeExecutionSafetyGateId(p.safetyGateId as string)}:{}),...(p.actorId?{actorId:txt(p.actorId,'actorId')}:{}),});
export function normalizeExecutionPlanRecord(input: ExecutionPlanRecord): ExecutionPlanRecord { for (const key of Object.keys(input as unknown as Record<string, unknown>)) { if (!EXECUTION_PLAN_RECORD_KEYS.has(key)) throw new Error('Execution plan record contains an unsupported field.'); } return {...input,id:normalizeExecutionPlanId(input.id as string),workspaceId:createWorkspaceId(input.workspaceId),sourceCompositionPlanId:txt(input.sourceCompositionPlanId,'sourceCompositionPlanId')!,sourceRuntimeReadinessBindingId:txt(input.sourceRuntimeReadinessBindingId,'sourceRuntimeReadinessBindingId')!,sourceReadinessStatus:txt(input.sourceReadinessStatus,'sourceReadinessStatus')!,status:normalizeExecutionPlanStatus(input.status),steps:input.steps.map(normalizeExecutionStep),dependencies:input.dependencies.map(normalizeExecutionDependency),inputs:input.inputs.map(normalizeExecutionInput),outputs:input.outputs.map(normalizeExecutionOutput),adapterReferences:input.adapterReferences.map(normalizeExecutionAdapterReference),safetyGates:input.safetyGates.map(normalizeExecutionSafetyGate),blockers:block(input.blockers),diagnostics:diag(input.diagnostics),resourceEstimates:input.resourceEstimates.map(normalizeExecutionResourceEstimate),provenance:input.provenance.map(normalizeExecutionPlanProvenanceEntry),createdAt:ts(input.createdAt,'createdAt'),updatedAt:ts(input.updatedAt,'updatedAt'),...(input.archivedAt?{archivedAt:ts(input.archivedAt,'archivedAt')}:{}),}; }

const ws=<T extends {workspaceId:string}>(v:T)=>({...v,workspaceId:createWorkspaceId(v.workspaceId)});
export const normalizeCreateExecutionPlanCommand=(v:CreateExecutionPlanCommand)=>({...ws(v),runtimeReadinessBindingId:txt(v.runtimeReadinessBindingId,'runtimeReadinessBindingId')!,...(v.compositionPlanId?{compositionPlanId:txt(v.compositionPlanId,'compositionPlanId')}:{}),});
export const normalizeReadExecutionPlanCommand=(v:ReadExecutionPlanCommand)=>({...ws(v),executionPlanId:normalizeExecutionPlanId(v.executionPlanId)});
export const normalizeListExecutionPlansCommand=(v:ListExecutionPlansCommand)=>ws(v);
export const normalizeArchiveExecutionPlanCommand=(v:ArchiveExecutionPlanCommand)=>({...ws(v),executionPlanId:normalizeExecutionPlanId(v.executionPlanId)});
const withPlan=<T extends {workspaceId:string;executionPlanId:string}>(v:T)=>({...ws(v),executionPlanId:normalizeExecutionPlanId(v.executionPlanId)});
export const normalizeRefreshExecutionPlanCommand=(v:RefreshExecutionPlanCommand)=>({...withPlan(v),runtimeReadinessBindingId:txt(v.runtimeReadinessBindingId,'runtimeReadinessBindingId')!});
export const normalizePrepareExecutionStepsCommand=(v:PrepareExecutionStepsCommand)=>({...withPlan(v),runtimeReadinessBindingId:txt(v.runtimeReadinessBindingId,'runtimeReadinessBindingId')!});
export const normalizePrepareExecutionDependenciesCommand=(v:PrepareExecutionDependenciesCommand)=>withPlan(v);
export const normalizePrepareExecutionInputsCommand=(v:PrepareExecutionInputsCommand)=>withPlan(v);
export const normalizePrepareExecutionOutputsCommand=(v:PrepareExecutionOutputsCommand)=>withPlan(v);
export const normalizeValidateExecutionPlanCommand=(v:ValidateExecutionPlanCommand)=>withPlan(v);
export const normalizePreviewExecutionPlanCommand=(v:PreviewExecutionPlanCommand)=>withPlan(v);

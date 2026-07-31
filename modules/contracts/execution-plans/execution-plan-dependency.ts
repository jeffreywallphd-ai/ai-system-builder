import type { ExecutionDependencyId, ExecutionInputId, ExecutionOutputId, ExecutionStepId, ExecutionAdapterReferenceId, ExecutionSafetyGateId } from './execution-plan-identity';
import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
const kinds=["step-after-step","input-required","output-required","provider-required","safety-gate-required","manual-review-required","artifact-required"] as const;
const statuses=["planned","satisfied-by-plan","missing","blocked","stale","invalid"] as const;
export type ExecutionDependencyKind=typeof kinds[number]; export type ExecutionDependencyStatus=typeof statuses[number];
export interface ExecutionDependency { id: ExecutionDependencyId; kind: ExecutionDependencyKind; status: ExecutionDependencyStatus; sourceStepId?: ExecutionStepId; targetStepId?: ExecutionStepId; inputId?: ExecutionInputId; outputId?: ExecutionOutputId; adapterReferenceId?: ExecutionAdapterReferenceId; safetyGateId?: ExecutionSafetyGateId; label: string; summary?: string; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; }
export const isExecutionDependencyKind=(v:string):v is ExecutionDependencyKind=>(kinds as readonly string[]).includes(v);
export const normalizeExecutionDependencyKind=(v:string):ExecutionDependencyKind=>{const n=v.trim().toLowerCase(); if(isExecutionDependencyKind(n)) return n; throw new Error('ExecutionDependencyKind is invalid.');};
export const isExecutionDependencyStatus=(v:string):v is ExecutionDependencyStatus=>(statuses as readonly string[]).includes(v);
export const normalizeExecutionDependencyStatus=(v:string):ExecutionDependencyStatus=>{const n=v.trim().toLowerCase(); if(isExecutionDependencyStatus(n)) return n; throw new Error('ExecutionDependencyStatus is invalid.');};

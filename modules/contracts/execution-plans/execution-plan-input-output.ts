import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
import type { ExecutionInputId, ExecutionOutputId, ExecutionStepId } from './execution-plan-identity';
const inputKinds=['asset-reference','artifact-reference','workspace-data','user-provided','provider-configuration-reference','runtime-readiness-reference','manual-review-input','unknown'] as const;
const outputKinds=['artifact','workspace-record','asset-candidate','report','preview','diagnostic-summary','manual-review-output','unknown'] as const;
const statuses=['planned','available','missing','needs-review','blocked','stale','invalid'] as const;
export type ExecutionInputKind=typeof inputKinds[number]; export type ExecutionOutputKind=typeof outputKinds[number]; export type ExecutionInputOutputStatus=typeof statuses[number];
export interface ExecutionInput { id: ExecutionInputId; stepId: ExecutionStepId; kind: ExecutionInputKind; status: ExecutionInputOutputStatus; label: string; summary?: string; sourceReferenceKind: string; sourceReferenceId?: string; required: boolean; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; }
export interface ExecutionOutput { id: ExecutionOutputId; stepId: ExecutionStepId; kind: ExecutionOutputKind; status: ExecutionInputOutputStatus; label: string; summary?: string; destinationReferenceKind: string; destinationReferenceId?: string; required: boolean; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; }
export const isExecutionInputKind=(v:string):v is ExecutionInputKind=>(inputKinds as readonly string[]).includes(v);
export const normalizeExecutionInputKind=(v:string):ExecutionInputKind=>{const n=v.trim().toLowerCase(); if(isExecutionInputKind(n)) return n; throw new Error('ExecutionInputKind is invalid.');};
export const isExecutionOutputKind=(v:string):v is ExecutionOutputKind=>(outputKinds as readonly string[]).includes(v);
export const normalizeExecutionOutputKind=(v:string):ExecutionOutputKind=>{const n=v.trim().toLowerCase(); if(isExecutionOutputKind(n)) return n; throw new Error('ExecutionOutputKind is invalid.');};
export const isExecutionInputOutputStatus=(v:string):v is ExecutionInputOutputStatus=>(statuses as readonly string[]).includes(v);
export const normalizeExecutionInputOutputStatus=(v:string):ExecutionInputOutputStatus=>{const n=v.trim().toLowerCase(); if(isExecutionInputOutputStatus(n)) return n; throw new Error('ExecutionInputOutputStatus is invalid.');};

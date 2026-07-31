import type { ExecutionAdapterReferenceId, ProviderAdapterReferenceId } from './execution-plan-identity';
import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
const kinds=['runtime-readiness-binding','selected-runtime-binding','provider-capability','provider-adapter','storage-adapter','artifact-adapter','model-adapter','comfyui-adapter','api-adapter','manual-adapter','deferred-adapter'] as const;
const statuses=['planned','available-by-readiness','needs-setup','missing','blocked','unsupported','stale','invalid','deferred'] as const;
export type ExecutionAdapterReferenceKind=typeof kinds[number]; export type ExecutionAdapterReferenceStatus=typeof statuses[number];
export interface ExecutionAdapterReference { id: ExecutionAdapterReferenceId; kind: ExecutionAdapterReferenceKind; status: ExecutionAdapterReferenceStatus; providerReferenceId?: ProviderAdapterReferenceId; providerKind?: string; capabilityKind?: string; sourceRuntimeReadinessBindingId: string; sourceRuntimeBindingId?: string; label: string; summary?: string; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; }
export const isExecutionAdapterReferenceKind=(v:string):v is ExecutionAdapterReferenceKind=>(kinds as readonly string[]).includes(v);
export const normalizeExecutionAdapterReferenceKind=(v:string):ExecutionAdapterReferenceKind=>{const n=v.trim().toLowerCase(); if(isExecutionAdapterReferenceKind(n)) return n; throw new Error('ExecutionAdapterReferenceKind invalid.');};
export const isExecutionAdapterReferenceStatus=(v:string):v is ExecutionAdapterReferenceStatus=>(statuses as readonly string[]).includes(v);
export const normalizeExecutionAdapterReferenceStatus=(v:string):ExecutionAdapterReferenceStatus=>{const n=v.trim().toLowerCase(); if(isExecutionAdapterReferenceStatus(n)) return n; throw new Error('ExecutionAdapterReferenceStatus invalid.');};

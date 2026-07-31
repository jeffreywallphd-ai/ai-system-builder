import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
import type { ExecutionAdapterReferenceId, ExecutionInputId, ExecutionOutputId, ExecutionSafetyGateId, ExecutionStepId } from './execution-plan-identity';
const kinds=['required-input-available','output-destination-planned','provider-setup-selected','storage-destination-safe','no-unresolved-blockers','user-review-required','policy-review-required','resource-estimate-review','execution-preview-reviewed','access-material-not-embedded','unsafe-details-redacted','runnable-material-deferred'] as const;
const statuses=['planned','passed-by-plan','needs-review','blocked','failed','deferred','not-applicable'] as const;
export type ExecutionSafetyGateKind=typeof kinds[number]; export type ExecutionSafetyGateStatus=typeof statuses[number];
export interface ExecutionSafetyGate { id: ExecutionSafetyGateId; kind: ExecutionSafetyGateKind; status: ExecutionSafetyGateStatus; label: string; summary?: string; stepId?: ExecutionStepId; inputId?: ExecutionInputId; outputId?: ExecutionOutputId; adapterReferenceId?: ExecutionAdapterReferenceId; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; }
export const isExecutionSafetyGateKind=(v:string):v is ExecutionSafetyGateKind=>(kinds as readonly string[]).includes(v);
export const normalizeExecutionSafetyGateKind=(v:string):ExecutionSafetyGateKind=>{const n=v.trim().toLowerCase(); if(isExecutionSafetyGateKind(n)) return n; throw new Error('ExecutionSafetyGateKind invalid.');};
export const isExecutionSafetyGateStatus=(v:string):v is ExecutionSafetyGateStatus=>(statuses as readonly string[]).includes(v);
export const normalizeExecutionSafetyGateStatus=(v:string):ExecutionSafetyGateStatus=>{const n=v.trim().toLowerCase(); if(isExecutionSafetyGateStatus(n)) return n; throw new Error('ExecutionSafetyGateStatus invalid.');};

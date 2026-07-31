const executionPlanStatuses = ["draft","preparing","ready-for-review","needs-setup","missing-inputs","missing-outputs","provider-setup-required","safety-review-required","blocked","stale","invalid","archived"] as const;
const executionStepStatuses = ["planned","needs-input","needs-output","needs-provider-setup","needs-review","blocked","stale","invalid","deferred"] as const;
const executionStepKinds = ["prepare-input","transform-data","generate-image","generate-text","embed-content","store-artifact","read-artifact","call-api","compose-output","validate-output","manual-review","safety-check","provider-setup-check","runtime-setup-check"] as const;
export type ExecutionPlanStatus = typeof executionPlanStatuses[number]; export type ExecutionStepStatus = typeof executionStepStatuses[number]; export type ExecutionStepKind = typeof executionStepKinds[number];
function normalizeEnum<T extends readonly string[]>(value: string, supported: T, label: string): T[number] { const normalized=value.trim().toLowerCase(); if((supported as readonly string[]).includes(normalized)) return normalized as T[number]; throw new Error(`${label} is invalid or unsupported for non-executing planning.`);} 
export const isExecutionPlanStatus=(v:string):v is ExecutionPlanStatus=>(executionPlanStatuses as readonly string[]).includes(v);
export const normalizeExecutionPlanStatus=(v:string):ExecutionPlanStatus=>normalizeEnum(v,executionPlanStatuses,"ExecutionPlanStatus");
export const isExecutionStepStatus=(v:string):v is ExecutionStepStatus=>(executionStepStatuses as readonly string[]).includes(v);
export const normalizeExecutionStepStatus=(v:string):ExecutionStepStatus=>normalizeEnum(v,executionStepStatuses,"ExecutionStepStatus");
export const isExecutionStepKind=(v:string):v is ExecutionStepKind=>(executionStepKinds as readonly string[]).includes(v);
export const normalizeExecutionStepKind=(v:string):ExecutionStepKind=>normalizeEnum(v,executionStepKinds,"ExecutionStepKind");

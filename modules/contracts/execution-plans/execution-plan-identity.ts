const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SECRET_PATTERN = /(token|secret|apikey|api[-_]?key|private[-_]?key|signature|signed|credential)/i;

export type ExecutionPlanId = string & { readonly __executionPlanIdBrand: unique symbol };
export type ExecutionPlanCandidateId = string & { readonly __executionPlanCandidateIdBrand: unique symbol };
export type ExecutionStepId = string & { readonly __executionStepIdBrand: unique symbol };
export type ExecutionStepGroupId = string & { readonly __executionStepGroupIdBrand: unique symbol };
export type ExecutionDependencyId = string & { readonly __executionDependencyIdBrand: unique symbol };
export type ExecutionInputId = string & { readonly __executionInputIdBrand: unique symbol };
export type ExecutionOutputId = string & { readonly __executionOutputIdBrand: unique symbol };
export type ExecutionArtifactReferenceId = string & { readonly __executionArtifactReferenceIdBrand: unique symbol };
export type ExecutionAdapterReferenceId = string & { readonly __executionAdapterReferenceIdBrand: unique symbol };
export type ProviderAdapterReferenceId = string & { readonly __providerAdapterReferenceIdBrand: unique symbol };
export type ExecutionSafetyGateId = string & { readonly __executionSafetyGateIdBrand: unique symbol };
export type ExecutionDiagnosticId = string & { readonly __executionDiagnosticIdBrand: unique symbol };
export type ExecutionBlockerId = string & { readonly __executionBlockerIdBrand: unique symbol };
export type ExecutionOperationId = string & { readonly __executionOperationIdBrand: unique symbol };
export type ExecutionResourceEstimateId = string & { readonly __executionResourceEstimateIdBrand: unique symbol };

function isSafeId(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) return false;
  if (!ID_PATTERN.test(value)) return false;
  if (value.includes("..") || value.includes("\\") || value.includes("/") || value.includes("$")) return false;
  if (/^https?:\/\//i.test(value) || /^[a-zA-Z]:[\\/]/.test(value)) return false;
  if (/[%&;|<>`]/.test(value)) return false;
  if (/[^\x20-\x7E]/.test(value)) return false;
  if (SECRET_PATTERN.test(value)) return false;
  return true;
}

function invalidIdError(label: string): Error {
  return new Error(`${label} must be a safe non-empty identifier.`);
}

function normalizeBrandedId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (!isSafeId(normalized)) throw invalidIdError(label);
  return normalized as T;
}

export const isExecutionPlanId = (value: string): value is ExecutionPlanId => isSafeId(value);
export const normalizeExecutionPlanId = (value: string): ExecutionPlanId => normalizeBrandedId(value, "ExecutionPlanId");
export const isExecutionStepId = (value: string): value is ExecutionStepId => isSafeId(value);
export const normalizeExecutionStepId = (value: string): ExecutionStepId => normalizeBrandedId(value, "ExecutionStepId");
export const isExecutionDependencyId = (value: string): value is ExecutionDependencyId => isSafeId(value);
export const normalizeExecutionDependencyId = (value: string): ExecutionDependencyId => normalizeBrandedId(value, "ExecutionDependencyId");
export const isExecutionInputId = (value: string): value is ExecutionInputId => isSafeId(value);
export const normalizeExecutionInputId = (value: string): ExecutionInputId => normalizeBrandedId(value, "ExecutionInputId");
export const isExecutionOutputId = (value: string): value is ExecutionOutputId => isSafeId(value);
export const normalizeExecutionOutputId = (value: string): ExecutionOutputId => normalizeBrandedId(value, "ExecutionOutputId");
export const isExecutionAdapterReferenceId = (value: string): value is ExecutionAdapterReferenceId => isSafeId(value);
export const normalizeExecutionAdapterReferenceId = (value: string): ExecutionAdapterReferenceId => normalizeBrandedId(value, "ExecutionAdapterReferenceId");
export const isExecutionSafetyGateId = (value: string): value is ExecutionSafetyGateId => isSafeId(value);
export const normalizeExecutionSafetyGateId = (value: string): ExecutionSafetyGateId => normalizeBrandedId(value, "ExecutionSafetyGateId");

export const normalizeExecutionPlanCandidateId = (value: string): ExecutionPlanCandidateId => normalizeBrandedId(value, "ExecutionPlanCandidateId");
export const normalizeExecutionStepGroupId = (value: string): ExecutionStepGroupId => normalizeBrandedId(value, "ExecutionStepGroupId");
export const normalizeExecutionArtifactReferenceId = (value: string): ExecutionArtifactReferenceId => normalizeBrandedId(value, "ExecutionArtifactReferenceId");
export const normalizeProviderAdapterReferenceId = (value: string): ProviderAdapterReferenceId => normalizeBrandedId(value, "ProviderAdapterReferenceId");
export const normalizeExecutionDiagnosticId = (value: string): ExecutionDiagnosticId => normalizeBrandedId(value, "ExecutionDiagnosticId");
export const normalizeExecutionBlockerId = (value: string): ExecutionBlockerId => normalizeBrandedId(value, "ExecutionBlockerId");
export const normalizeExecutionOperationId = (value: string): ExecutionOperationId => normalizeBrandedId(value, "ExecutionOperationId");
export const normalizeExecutionResourceEstimateId = (value: string): ExecutionResourceEstimateId => normalizeBrandedId(value, "ExecutionResourceEstimateId");

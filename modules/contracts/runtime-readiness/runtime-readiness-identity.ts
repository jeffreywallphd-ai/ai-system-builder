export const RUNTIME_READINESS_ID_MAX_LENGTH = 96;

export type RuntimeReadinessBindingId = string & { readonly __runtimeReadinessBindingIdBrand: unique symbol };
export type RuntimeReadinessCheckId = string & { readonly __runtimeReadinessCheckIdBrand: unique symbol };
export type RuntimeRequirementId = string & { readonly __runtimeRequirementIdBrand: unique symbol };
export type RuntimeCapabilityId = string & { readonly __runtimeCapabilityIdBrand: unique symbol };
export type RuntimeProviderId = string & { readonly __runtimeProviderIdBrand: unique symbol };
export type RuntimeProviderCandidateId = string & { readonly __runtimeProviderCandidateIdBrand: unique symbol };
export type RuntimeBindingCandidateId = string & { readonly __runtimeBindingCandidateIdBrand: unique symbol };
export type RuntimeBindingId = string & { readonly __runtimeBindingIdBrand: unique symbol };
export type RuntimeInventorySourceId = string & { readonly __runtimeInventorySourceIdBrand: unique symbol };
export type RuntimeReadinessDiagnosticId = string & { readonly __runtimeReadinessDiagnosticIdBrand: unique symbol };
export type RuntimeReadinessBlockerId = string & { readonly __runtimeReadinessBlockerIdBrand: unique symbol };
export type RuntimeReadinessOperationId = string & { readonly __runtimeReadinessOperationIdBrand: unique symbol };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SHELL_PATTERN = /[;&|`$<>*?()[\]{}'"!#~]/;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DRIVE_PATTERN = /^[a-zA-Z]:/;
const TOKEN_PATTERN = /(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|token|secret|api[_-]?key|private[_-]?key)/i;

function isSafeIdentifier(input: unknown): input is string { if (typeof input !== "string") return false; const n = input.trim(); return n.length > 0 && n.length <= RUNTIME_READINESS_ID_MAX_LENGTH && n === input && ID_PATTERN.test(n) && !n.includes("/") && !n.includes("\\") && !n.includes("..") && !URL_PATTERN.test(n) && !DRIVE_PATTERN.test(n) && !CONTROL_PATTERN.test(n) && !SHELL_PATTERN.test(n) && !TOKEN_PATTERN.test(n); }
function normalizeIdentifier(input: string, label: string): string { const n = input.trim(); if (!isSafeIdentifier(n)) { const e = new Error(`${label} must be a non-empty, trimmed, safe identifier.`); e.stack = undefined; throw e; } return n; }

const mk = <T extends string>(input: string, label: string) => normalizeIdentifier(input, label) as T;
export const isRuntimeReadinessBindingId = (input: unknown): input is RuntimeReadinessBindingId => isSafeIdentifier(input);
export const isRuntimeReadinessCheckId = (input: unknown): input is RuntimeReadinessCheckId => isSafeIdentifier(input);
export const isRuntimeRequirementId = (input: unknown): input is RuntimeRequirementId => isSafeIdentifier(input);
export const isRuntimeCapabilityId = (input: unknown): input is RuntimeCapabilityId => isSafeIdentifier(input);
export const isRuntimeProviderId = (input: unknown): input is RuntimeProviderId => isSafeIdentifier(input);
export const isRuntimeProviderCandidateId = (input: unknown): input is RuntimeProviderCandidateId => isSafeIdentifier(input);
export const isRuntimeBindingCandidateId = (input: unknown): input is RuntimeBindingCandidateId => isSafeIdentifier(input);
export const isRuntimeBindingId = (input: unknown): input is RuntimeBindingId => isSafeIdentifier(input);
export const isRuntimeInventorySourceId = (input: unknown): input is RuntimeInventorySourceId => isSafeIdentifier(input);

export const normalizeRuntimeReadinessBindingId = (input: string) => mk<RuntimeReadinessBindingId>(input, "Runtime readiness binding id");
export const normalizeRuntimeReadinessCheckId = (input: string) => mk<RuntimeReadinessCheckId>(input, "Runtime readiness check id");
export const normalizeRuntimeRequirementId = (input: string) => mk<RuntimeRequirementId>(input, "Runtime requirement id");
export const normalizeRuntimeCapabilityId = (input: string) => mk<RuntimeCapabilityId>(input, "Runtime capability id");
export const normalizeRuntimeProviderId = (input: string) => mk<RuntimeProviderId>(input, "Runtime provider id");
export const normalizeRuntimeProviderCandidateId = (input: string) => mk<RuntimeProviderCandidateId>(input, "Runtime provider candidate id");
export const normalizeRuntimeBindingCandidateId = (input: string) => mk<RuntimeBindingCandidateId>(input, "Runtime binding candidate id");
export const normalizeRuntimeBindingId = (input: string) => mk<RuntimeBindingId>(input, "Runtime binding id");
export const normalizeRuntimeInventorySourceId = (input: string) => mk<RuntimeInventorySourceId>(input, "Runtime inventory source id");
export const normalizeRuntimeReadinessDiagnosticId = (input: string) => mk<RuntimeReadinessDiagnosticId>(input, "Runtime readiness diagnostic id");
export const normalizeRuntimeReadinessBlockerId = (input: string) => mk<RuntimeReadinessBlockerId>(input, "Runtime readiness blocker id");
export const normalizeRuntimeReadinessOperationId = (input: string) => mk<RuntimeReadinessOperationId>(input, "Runtime readiness operation id");

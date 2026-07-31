export const ASSET_COMPOSITION_ID_MAX_LENGTH = 96;
export type AssetCompositionPlanId = string & { readonly __assetCompositionPlanIdBrand: unique symbol };
export type AssetCompositionNodeId = string & { readonly __assetCompositionNodeIdBrand: unique symbol };
export type AssetCompositionRelationshipId = string & { readonly __assetCompositionRelationshipIdBrand: unique symbol };
export type AssetCompositionOperationId = string & { readonly __assetCompositionOperationIdBrand: unique symbol };
export type AssetCompositionDiagnosticId = string & { readonly __assetCompositionDiagnosticIdBrand: unique symbol };
export type AssetCompositionBlockerId = string & { readonly __assetCompositionBlockerIdBrand: unique symbol };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SHELL_PATTERN = /[;&|`$<>*?()[\]{}'"!#~]/;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DRIVE_PATTERN = /^[a-zA-Z]:/;
const TOKEN_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|secret[_-]?|token[_-]?|api[_-]?key)/i;

function isSafeIdentifier(input: unknown): input is string { if (typeof input !== "string") return false; const n = input.trim(); return n.length>0 && n.length<=ASSET_COMPOSITION_ID_MAX_LENGTH && n===input && ID_PATTERN.test(n) && !n.includes("/") && !n.includes("\\") && !n.includes("..") && !n.startsWith(".") && !URL_PATTERN.test(n) && !DRIVE_PATTERN.test(n) && !TOKEN_PATTERN.test(n) && !CONTROL_PATTERN.test(n) && !SHELL_PATTERN.test(n); }
function normalizeIdentifier(input: string, label: string): string { const n = input.trim(); if (!isSafeIdentifier(n)) { const e = new Error(`${label} must be a non-empty, trimmed, safe identifier.`); e.stack=undefined; throw e; } return n; }

export const isAssetCompositionPlanId = (input: unknown): input is AssetCompositionPlanId => isSafeIdentifier(input);
export const isAssetCompositionNodeId = (input: unknown): input is AssetCompositionNodeId => isSafeIdentifier(input);
export const isAssetCompositionRelationshipId = (input: unknown): input is AssetCompositionRelationshipId => isSafeIdentifier(input);
export const isAssetCompositionOperationId = (input: unknown): input is AssetCompositionOperationId => isSafeIdentifier(input);

export const normalizeAssetCompositionPlanId = (input: string): AssetCompositionPlanId => normalizeIdentifier(input, "Asset composition plan id") as AssetCompositionPlanId;
export const normalizeAssetCompositionNodeId = (input: string): AssetCompositionNodeId => normalizeIdentifier(input, "Asset composition node id") as AssetCompositionNodeId;
export const normalizeAssetCompositionRelationshipId = (input: string): AssetCompositionRelationshipId => normalizeIdentifier(input, "Asset composition relationship id") as AssetCompositionRelationshipId;
export const normalizeAssetCompositionOperationId = (input: string): AssetCompositionOperationId => normalizeIdentifier(input, "Asset composition operation id") as AssetCompositionOperationId;
export const normalizeAssetCompositionDiagnosticId = (input: string): AssetCompositionDiagnosticId => normalizeIdentifier(input, "Asset composition diagnostic id") as AssetCompositionDiagnosticId;
export const normalizeAssetCompositionBlockerId = (input: string): AssetCompositionBlockerId => normalizeIdentifier(input, "Asset composition blocker id") as AssetCompositionBlockerId;

export const EFFECTIVE_ASSET_PROJECTION_ID_MAX_LENGTH = 96;

export type EffectiveAssetProjectionId = string & { readonly __effectiveAssetProjectionIdBrand: unique symbol };
export type EffectiveAssetProjectionRevisionId = string & { readonly __effectiveAssetProjectionRevisionIdBrand: unique symbol };
export type EffectiveAssetProjectionSnapshotId = string & { readonly __effectiveAssetProjectionSnapshotIdBrand: unique symbol };
export type EffectiveAssetProjectionOperationId = string & { readonly __effectiveAssetProjectionOperationIdBrand: unique symbol };
export type EffectiveAssetProjectionDiagnosticId = string & { readonly __effectiveAssetProjectionDiagnosticIdBrand: unique symbol };
export type EffectiveAssetProjectionBlockerId = string & { readonly __effectiveAssetProjectionBlockerIdBrand: unique symbol };

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SHELL_PATTERN = /[;&|`$<>*?()[\]{}'"!#~]/;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DRIVE_PATTERN = /^[a-zA-Z]:/;
const TOKEN_PATTERN = /^(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|secret[_-]?|token[_-]?|api[_-]?key)/i;

function isSafeIdentifier(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const normalized = input.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= EFFECTIVE_ASSET_PROJECTION_ID_MAX_LENGTH &&
    normalized === input &&
    ID_PATTERN.test(normalized) &&
    !normalized.includes("/") &&
    !normalized.includes("\\") &&
    !normalized.includes("..") &&
    !normalized.startsWith(".") &&
    !URL_PATTERN.test(normalized) &&
    !DRIVE_PATTERN.test(normalized) &&
    !TOKEN_PATTERN.test(normalized) &&
    !CONTROL_PATTERN.test(normalized) &&
    !SHELL_PATTERN.test(normalized)
  );
}

function normalizeIdentifier(input: string, label: string): string {
  const normalized = input.trim();
  if (!isSafeIdentifier(normalized)) {
    const error = new Error(`${label} must be a non-empty, trimmed, safe identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized;
}

export function isEffectiveAssetProjectionId(input: unknown): input is EffectiveAssetProjectionId {
  return isSafeIdentifier(input);
}

export const normalizeEffectiveAssetProjectionId = (input: string): EffectiveAssetProjectionId =>
  normalizeIdentifier(input, "Effective asset projection id") as EffectiveAssetProjectionId;
export const normalizeEffectiveAssetProjectionRevisionId = (input: string): EffectiveAssetProjectionRevisionId =>
  normalizeIdentifier(input, "Effective asset projection revision id") as EffectiveAssetProjectionRevisionId;
export const normalizeEffectiveAssetProjectionSnapshotId = (input: string): EffectiveAssetProjectionSnapshotId =>
  normalizeIdentifier(input, "Effective asset projection snapshot id") as EffectiveAssetProjectionSnapshotId;
export const normalizeEffectiveAssetProjectionOperationId = (input: string): EffectiveAssetProjectionOperationId =>
  normalizeIdentifier(input, "Effective asset projection operation id") as EffectiveAssetProjectionOperationId;
export const normalizeEffectiveAssetProjectionDiagnosticId = (input: string): EffectiveAssetProjectionDiagnosticId =>
  normalizeIdentifier(input, "Effective asset projection diagnostic id") as EffectiveAssetProjectionDiagnosticId;
export const normalizeEffectiveAssetProjectionBlockerId = (input: string): EffectiveAssetProjectionBlockerId =>
  normalizeIdentifier(input, "Effective asset projection blocker id") as EffectiveAssetProjectionBlockerId;

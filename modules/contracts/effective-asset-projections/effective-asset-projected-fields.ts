export const SAFE_EFFECTIVE_ASSET_PROJECTED_FIELDS = ["display-name", "summary", "description", "tags", "classification", "source-label", "revision-label", "status-label", "readiness-state", "safe-metadata"] as const;
export type SafeEffectiveAssetProjectedField = (typeof SAFE_EFFECTIVE_ASSET_PROJECTED_FIELDS)[number];
export type SafeEffectiveAssetMetadata = string | number | boolean | null | SafeEffectiveAssetMetadata[] | { [key: string]: SafeEffectiveAssetMetadata };
export type SafeEffectiveAssetProjectedFieldValue = string | string[] | SafeEffectiveAssetMetadata;
export type SafeEffectiveAssetProjectedFieldPatch = Partial<Record<SafeEffectiveAssetProjectedField, SafeEffectiveAssetProjectedFieldValue>>;
import { copyBoundedPassiveData, hasKnownPassiveCredential, normalizePassiveMetadata, readStrictPassiveRecord } from '../shared';

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const UNSAFE_STRING_PATTERN = /(?:\.{2}|[a-zA-Z]:\\|\/(?:tmp|var|home|users|etc)\/|storageRoot|signedUrl|providerPayload|prompt\s*[:=]|workflow\s*\{|token|secret|api[_-]?key|password|stack\s*trace|\b(?:cmd|bash|sh|powershell|zsh)\b|process\.env|base64|blob|data:[^\s,]+;base64|[;&|`$<>]|\\\\)/i;

function isSafeProjectedString(input: unknown): input is string {
  if (typeof input !== "string") {
    return false;
  }
  const normalized = input.trim();
  return normalized.length > 0 && normalized === input && normalized.length <= 2048 &&
    !hasKnownPassiveCredential(normalized) && !/[\u0000-\u001f\u007f]/.test(normalized) &&
    !/(?:[a-z][a-z0-9+.-]*:\/\/|(?:^|[\s("'=:\[])(?:[\\/]|~[\\/]|\.\.?[\\/]|[a-z]:))/i.test(normalized) &&
    !UNSAFE_STRING_PATTERN.test(normalized);
}

function safeMeta(value: unknown): value is SafeEffectiveAssetMetadata {
  if (value === null) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return isSafeProjectedString(value);
  if (Array.isArray(value)) return value.every((entry) => safeMeta(entry));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
      return KEY_PATTERN.test(key) && !UNSAFE_STRING_PATTERN.test(key) && safeMeta(entry);
    });
  }
  return false;
}

export const isSafeEffectiveAssetProjectedField = (v: unknown): v is SafeEffectiveAssetProjectedField =>
  typeof v === "string" && SAFE_EFFECTIVE_ASSET_PROJECTED_FIELDS.includes(v.trim().toLowerCase() as SafeEffectiveAssetProjectedField);

export function assertSafeEffectiveAssetProjectedField(v: string): asserts v is SafeEffectiveAssetProjectedField {
  if (!isSafeEffectiveAssetProjectedField(v)) throw new Error("Effective projected field is unsafe or unsupported.");
}

export const normalizeSafeEffectiveAssetProjectedField = (v: string): SafeEffectiveAssetProjectedField => {
  if (typeof v !== 'string') throw new Error("Effective projected field is unsafe or unsupported.");
  const normalized = v.trim().toLowerCase();
  assertSafeEffectiveAssetProjectedField(normalized);
  return normalized;
};

export function normalizeSafeEffectiveAssetProjectedFieldPatch(v: unknown): SafeEffectiveAssetProjectedFieldPatch {
  const out: SafeEffectiveAssetProjectedFieldPatch = {};
  const copy = copyBoundedPassiveData(v);
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error("Effective projected fields are invalid.");
  const fields = readStrictPassiveRecord(copy, Object.keys(copy));
  for (const [key, value] of Object.entries(fields)) {
    const normalizedKey = normalizeSafeEffectiveAssetProjectedField(key);
    if (Object.prototype.hasOwnProperty.call(out, normalizedKey)) throw new Error("Effective projected fields contain duplicate names.");
    if (normalizedKey === "safe-metadata") {
      out[normalizedKey] = normalizeSafeEffectiveAssetMetadata(value);
      continue;
    }
    if (typeof value === "string") {
      if (!isSafeProjectedString(value)) throw new Error("Effective projected field string value is unsafe.");
      out[normalizedKey] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => isSafeProjectedString(entry))) {
      out[normalizedKey] = value;
      continue;
    }
    throw new Error("Effective projected field value is invalid.");
  }
  return out;
}

export function normalizeSafeEffectiveAssetMetadata(value: unknown): SafeEffectiveAssetMetadata {
  const result = normalizePassiveMetadata({value}, {allowArrays:true})!.value as SafeEffectiveAssetMetadata;
  if (!safeMeta(result)) throw new Error("Effective projected safe-metadata is unsafe.");
  return result;
}

export function normalizeSafeEffectiveAssetMetadataRecord(value: unknown): Record<string, SafeEffectiveAssetMetadata> {
  const record = normalizePassiveMetadata(value, {allowArrays:true});
  if (!record) throw new Error("Effective projected safe-metadata record is invalid.");
  return normalizeSafeEffectiveAssetMetadata(record) as Record<string, SafeEffectiveAssetMetadata>;
}

export function normalizeSafeEffectiveAssetLabel(value: string, field: "sourceLabel" | "targetLabel"): string {
  if (!isSafeProjectedString(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

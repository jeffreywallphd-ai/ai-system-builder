export const SAFE_EFFECTIVE_ASSET_PROJECTED_FIELDS = ["display-name", "summary", "description", "tags", "classification", "source-label", "revision-label", "status-label", "readiness-state", "safe-metadata"] as const;
export type SafeEffectiveAssetProjectedField = (typeof SAFE_EFFECTIVE_ASSET_PROJECTED_FIELDS)[number];
export type SafeEffectiveAssetMetadata = string | number | boolean | null | SafeEffectiveAssetMetadata[] | { [key: string]: SafeEffectiveAssetMetadata };
export type SafeEffectiveAssetProjectedFieldValue = string | string[] | SafeEffectiveAssetMetadata;
export type SafeEffectiveAssetProjectedFieldPatch = Partial<Record<SafeEffectiveAssetProjectedField, SafeEffectiveAssetProjectedFieldValue>>;

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const UNSAFE_STRING_PATTERN = /(?:\.{2}|[a-zA-Z]:\\|\/(?:tmp|var|home|users|etc)\/|storageRoot|signedUrl|providerPayload|prompt\s*[:=]|workflow\s*\{|token|secret|api[_-]?key|password|stack\s*trace|\b(?:cmd|bash|sh|powershell|zsh)\b|process\.env|base64|blob|data:[^\s,]+;base64|[;&|`$<>]|\\\\)/i;

function isSafeProjectedString(input: unknown): input is string {
  if (typeof input !== "string") {
    return false;
  }
  const normalized = input.trim();
  return normalized.length > 0 && normalized === input && !UNSAFE_STRING_PATTERN.test(normalized);
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
  const normalized = v.trim().toLowerCase();
  assertSafeEffectiveAssetProjectedField(normalized);
  return normalized;
};

export function normalizeSafeEffectiveAssetProjectedFieldPatch(v: SafeEffectiveAssetProjectedFieldPatch): SafeEffectiveAssetProjectedFieldPatch {
  const out: SafeEffectiveAssetProjectedFieldPatch = {};
  for (const [key, value] of Object.entries(v)) {
    const normalizedKey = normalizeSafeEffectiveAssetProjectedField(key);
    if (normalizedKey === "safe-metadata") {
      if (!safeMeta(value)) throw new Error("Effective projected safe-metadata is unsafe.");
      out[normalizedKey] = value;
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

export function normalizeSafeEffectiveAssetLabel(value: string, field: "sourceLabel" | "targetLabel"): string {
  if (!isSafeProjectedString(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

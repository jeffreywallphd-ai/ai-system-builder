import type { AssetJsonObject, AssetJsonValue, AssetMetadata } from "../../../contracts/asset";

const FORBIDDEN_ASSET_METADATA_KEY_PATTERN =
  /(token|secret|password|credential|authorization|auth|api[_-]?key|apikey|requestid|taskid|promptid|prompt|negativeprompt|workflow|storagerootdirectory|runtimerootdirectory|localpath|filesystempath|filepath|path|cache|hf[_-]?home|huggingface|signedurl|presignedurl|accessurl|downloadurl|dataurl|bytes|blob|contentbase64|base64|raw|payload|command|stack|env)/i;
const LOCAL_FILESYSTEM_PATH_VALUE_PATTERN = /(^~\/|^\.\.?\/|^\/(?:tmp|var|home|users|etc|private|opt|usr|mnt|volumes)(?:\/|$)|^[a-z]:[\\/]|\\(?:Users|Temp)\\|\/(?:tmp|temp)\/|[\\/]\.cache[\\/]huggingface(?:[\\/]|$)|[\\/]huggingface[\\/]hub(?:[\\/]|$))/i;
const AUTH_BEARING_VALUE_PATTERN = /(bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|api\s+key|apikey)\s*[=:]|\bapi[_-]?key\b|\bapikey\b|(?:token|password|secret)\s*[=:]|\b(?:token|password|secret|auth)\b|authorization\s*:)/i;
const DATA_BASE64_VALUE_PATTERN = /^data:[^,;]+;base64,/i;
const LONG_BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/]{80,}={0,2}$/;
const RAW_PROVIDER_OR_EXCEPTION_VALUE_PATTERN = /\b(?:raw\s+)?(?:provider\s+payloads?|metadata\s+payloads?|exception\s+message|raw\s+exception|stack\s+trace|command|base64|bytes?|blobs?|process\.env|hf_home|huggingface_home|transformers_cache)\b/i;
const SIGNED_OR_QUERY_URL_VALUE_PATTERN = /^https?:\/\/\S+\?(?:\S*?(?:x-amz-signature|x-goog-signature|signature|sig|token|access_token|auth|expires|X-Amz-Signature)=\S+|\S{24,})/i;
const PROVIDER_OR_TOKEN_URL_VALUE_PATTERN = /^(?:hf|huggingface|s3|gs|file):\/\/\S+/i;
const PROMPT_OR_WORKFLOW_VALUE_PATTERN = /^(?:prompt|negative[-_ ]?prompt|workflowjson|workflow[-_ ]?json)(?:\b|[-_:])/i;

export function isUnsafeAssetMetadataKey(key: string): boolean {
  return FORBIDDEN_ASSET_METADATA_KEY_PATTERN.test(key);
}

export function isUnsafeAssetMetadataString(value: string): boolean {
  const trimmed = value.trim();
  return (
    LOCAL_FILESYSTEM_PATH_VALUE_PATTERN.test(trimmed) ||
    AUTH_BEARING_VALUE_PATTERN.test(trimmed) ||
    DATA_BASE64_VALUE_PATTERN.test(trimmed) ||
    LONG_BASE64_VALUE_PATTERN.test(trimmed) ||
    RAW_PROVIDER_OR_EXCEPTION_VALUE_PATTERN.test(trimmed) ||
    SIGNED_OR_QUERY_URL_VALUE_PATTERN.test(trimmed) ||
    PROVIDER_OR_TOKEN_URL_VALUE_PATTERN.test(trimmed) ||
    PROMPT_OR_WORKFLOW_VALUE_PATTERN.test(trimmed)
  );
}

export function sanitizeAssetStringValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return isUnsafeAssetMetadataString(trimmed) ? undefined : trimmed;
}

export function sanitizeAssetJsonValue(value: unknown): AssetJsonValue | undefined {
  return sanitizeAssetJsonValueInternal(value, new WeakSet<object>());
}

export function sanitizeAssetMetadata(value: Record<string, unknown> | AssetMetadata | undefined): AssetMetadata | undefined {
  const sanitized = sanitizeAssetJsonValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return undefined;
  if (Object.keys(sanitized).length === 0) return undefined;
  return sanitized as AssetMetadata;
}

export function sanitizeAssetViewValue<T>(value: T): T {
  return sanitizeAssetJsonValue(value) as unknown as T;
}

function sanitizeAssetJsonValueInternal(value: unknown, seen: WeakSet<object>): AssetJsonValue | undefined {
  if (value === null || typeof value === "boolean") return value as AssetJsonValue;
  if (typeof value === "string") return sanitizeAssetStringValue(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const entries = value
      .map((entry) => sanitizeAssetJsonValueInternal(entry, seen))
      .filter((entry): entry is AssetJsonValue => typeof entry !== "undefined");
    seen.delete(value);
    return entries;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isUnsafeAssetMetadataKey(key))
      .map(([key, entry]) => [key, sanitizeAssetJsonValueInternal(entry, seen)] as const)
      .filter((entry): entry is readonly [string, AssetJsonValue] => typeof entry[1] !== "undefined");
    seen.delete(value);
    return Object.fromEntries(entries) as AssetJsonObject;
  }
  return undefined;
}

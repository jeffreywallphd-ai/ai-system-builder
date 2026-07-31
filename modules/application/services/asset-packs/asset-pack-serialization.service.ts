import type { AssetPackManifest } from "../../../contracts/asset";
import {
  isAssetPackId,
  isAssetPackVersion,
  isAssetReferenceKind,
} from "../../../contracts/asset";
import {
  isUnsafeAssetMetadataKey,
  isUnsafeAssetMetadataString,
} from "../asset/asset-safe-metadata";

export interface AssetPackSerializationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: readonly string[];
}

export type AssetPackManifestParseResult =
  | { readonly ok: true; readonly manifest: AssetPackManifest }
  | {
      readonly ok: false;
      readonly issues: readonly AssetPackSerializationIssue[];
    };

const UNSAFE_PAYLOAD_KEY_PATTERN =
  /^(?:token|secret|password|credential|authorization|auth|authHeader|apiKey|api_key|apikey|bearerToken|signedUrl|presignedUrl|accessUrl|downloadUrl|dataUrl|localPath|filesystemPath|filePath|cachePath|storagePath|runtimePath|providerPayload|rawProviderPayload|rawPayload|workflowJson|promptText|executionCode|resourceContent|resourceBytes|contentBase64|bytes|blob|base64|commandLine|stackTrace|envValue)$/i;
const LOCAL_PATH_PATTERN =
  /(^~\/|^\.\.?\/|^\/(?:tmp|var|home|users|etc|private|opt|usr|mnt|volumes)(?:\/|$)|^[a-z]:[\\/]|\\(?:Users|Temp)\\|\/(?:tmp|temp)\/|[\\/]\.cache[\\/]huggingface(?:[\\/]|$)|[\\/]huggingface[\\/]hub(?:[\\/]|$))/i;
const AUTH_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|api\s+key|apikey)\s*[=:]|\bapi[_-]?key\b|\bapikey\b|(?:token|password|secret)\s*[=:]|\b(?:token|password|secret|auth)\b|authorization\s*:)/i;
const DATA_OR_BASE64_PATTERN =
  /(^data:[^,;]+;base64,|^[A-Za-z0-9+/]{80,}={0,2}$)/i;
const SIGNED_URL_PATTERN =
  /^https?:\/\/\S+\?(?:\S*?(?:x-amz-signature|x-goog-signature|signature|sig|token|access_token|auth|expires|X-Amz-Signature)=\S+|\S{24,})/i;
const PROVIDER_URL_PATTERN = /^(?:hf|huggingface|s3|gs|file):\/\/\S+/i;
const RAW_PAYLOAD_TEXT_PATTERN =
  /\b(?:raw\s+)?(?:provider\s+payload|workflow\s+json|prompt\s+text|resource\s+bytes|resource\s+content|stack\s+trace|command\s+line|process\.env|base64|blob|bytes)\b/i;

export function serializeAssetPackManifest(
  manifest: AssetPackManifest,
): string {
  return stableStringify(normalizeAssetPackManifestForSerialization(manifest));
}

export function parseAssetPackManifestJson(
  input: string,
): AssetPackManifestParseResult {
  try {
    const parsed = JSON.parse(input) as unknown;
    const issues = validateParsedManifestShape(parsed);
    if (issues.length > 0) return { ok: false, issues };
    return {
      ok: true,
      manifest: normalizeAssetPackManifestForSerialization(
        parsed as AssetPackManifest,
      ),
    };
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "asset-pack-serialization.invalid-json",
          message: "Asset pack manifest JSON could not be parsed.",
        },
      ],
    };
  }
}

export function normalizeAssetPackManifestForSerialization(
  manifest: AssetPackManifest,
): AssetPackManifest {
  return normalizeJsonValue(manifest) as AssetPackManifest;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value), null, 2);
}

function validateParsedManifestShape(
  value: unknown,
): AssetPackSerializationIssue[] {
  const issues: AssetPackSerializationIssue[] = [];

  if (!isPlainRecord(value)) {
    return [
      {
        code: "asset-pack-serialization.invalid-root",
        message: "Asset pack manifest root must be an object.",
        path: ["manifest"],
      },
    ];
  }

  if (!hasText(value.schemaVersion)) {
    issues.push(issue("missing-schema-version", "Manifest schema version is required.", [
      "schemaVersion",
    ]));
  }
  if (!hasText(value.packId) || !isAssetPackId(value.packId)) {
    issues.push(issue("missing-pack-id", "Manifest pack ID is required and must be safe.", [
      "packId",
    ]));
  }
  if (!hasText(value.version) || !isAssetPackVersion(value.version)) {
    issues.push(issue("missing-version", "Manifest version is required and must be semver-like.", [
      "version",
    ]));
  }
  if (!hasText(value.sourceKind)) {
    issues.push(issue("missing-source-kind", "Manifest source kind is required.", [
      "sourceKind",
    ]));
  }
  if (!hasText(value.sourceLayer)) {
    issues.push(issue("missing-source-layer", "Manifest source layer is required.", [
      "sourceLayer",
    ]));
  }
  if (!Array.isArray(value.assets)) {
    issues.push(issue("invalid-assets", "Manifest assets must be an array.", [
      "assets",
    ]));
  }
  if (
    value.overrideRules !== undefined &&
    !Array.isArray(value.overrideRules)
  ) {
    issues.push(
      issue("invalid-override-rules", "Manifest override rules must be an array.", [
        "overrideRules",
      ]),
    );
  }

  if (Array.isArray(value.assets)) {
    value.assets.forEach((entry, index) => {
      if (!isPlainRecord(entry)) {
        issues.push(issue("invalid-asset-entry", "Asset entry must be an object.", [
          "assets",
          String(index),
        ]));
        return;
      }
      const ref = entry.definitionRef;
      if (!isPlainRecord(ref) || !isAssetReferenceKind(String(ref.kind ?? ""))) {
        issues.push(issue("invalid-definition-ref", "Asset entry definition reference is invalid.", [
          "assets",
          String(index),
          "definitionRef",
        ]));
      }
    });
  }

  collectUnsafeIssues(value, ["manifest"], issues);
  return issues;
}

function collectUnsafeIssues(
  value: unknown,
  path: readonly string[],
  issues: AssetPackSerializationIssue[],
  seen = new WeakSet<object>(),
): void {
  if (typeof value === "string" && isUnsafeString(value, path)) {
    issues.push(issue("unsafe-value", "Manifest contains an unsafe value.", path));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectUnsafeIssues(entry, [...path, String(index)], issues, seen),
    );
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = [...path, key];
    if (
      UNSAFE_PAYLOAD_KEY_PATTERN.test(key) ||
      (path.includes("metadata") && isUnsafeAssetMetadataKey(key))
    ) {
      issues.push(
        issue("unsafe-key", "Manifest contains an unsafe payload key.", entryPath),
      );
      continue;
    }
    collectUnsafeIssues(entry, entryPath, issues, seen);
  }
}

function normalizeJsonValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const normalized = value
      .map((entry) => normalizeJsonValue(entry, seen))
      .filter((entry) => typeof entry !== "undefined");
    seen.delete(value);
    return normalized;
  }
  if (isPlainRecord(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, normalizeJsonValue(entry, seen)] as const)
      .filter((entry): entry is readonly [string, unknown] => {
        return typeof entry[1] !== "undefined";
      })
      .sort(([left], [right]) => left.localeCompare(right));
    seen.delete(value);
    return Object.fromEntries(entries);
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUnsafeString(value: string, path: readonly string[]): boolean {
  const trimmed = value.trim();
  return (
    (path.includes("metadata") && isUnsafeAssetMetadataString(trimmed)) ||
    LOCAL_PATH_PATTERN.test(trimmed) ||
    AUTH_VALUE_PATTERN.test(trimmed) ||
    DATA_OR_BASE64_PATTERN.test(trimmed) ||
    SIGNED_URL_PATTERN.test(trimmed) ||
    PROVIDER_URL_PATTERN.test(trimmed) ||
    (path.includes("metadata") && RAW_PAYLOAD_TEXT_PATTERN.test(trimmed))
  );
}

function issue(
  code: string,
  message: string,
  path?: readonly string[],
): AssetPackSerializationIssue {
  return {
    code: `asset-pack-serialization.${code}`,
    message,
    ...(path ? { path } : {}),
  };
}

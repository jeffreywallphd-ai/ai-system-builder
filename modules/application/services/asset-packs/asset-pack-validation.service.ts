import type {
  AssetDefinition,
  AssetMetadata,
  AssetPackAssetEntry,
  AssetPackDependency,
  AssetPackManifest,
  AssetPackOverrideRule,
  AssetReference,
  AssetValidationIssue,
  AssetValidationSummaryStatus,
} from "../../../contracts/asset";
import {
  ASSET_PACK_OVERRIDE_CONFLICT_POLICIES,
  ASSET_PACK_OVERRIDE_SCOPES,
  ASSET_PACK_SOURCE_KINDS,
  ASSET_PACK_TRUST_STATUSES,
  ASSET_SOURCE_LAYERS,
  isAssetPackId,
  isAssetPackVersion,
  isAssetReferenceKind,
} from "../../../contracts/asset";
import {
  isUnsafeAssetMetadataKey,
  isUnsafeAssetMetadataString,
} from "../asset/asset-safe-metadata";
import { validateAssetDefinition } from "../asset/validate-asset-definition.service";

export interface AssetPackValidationResult {
  readonly status: AssetValidationSummaryStatus;
  readonly issues: readonly AssetValidationIssue[];
}

const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .:_()/-]{0,119}$/;
const SAFE_CATEGORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SAFE_ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,159}$/;
const SAFE_VERSION_RANGE_PATTERN = /^[~^<>=*0-9A-Za-z .|,-]+$/;
const FORBIDDEN_TEXT_PATTERN =
  /\b(?:install|activate|disable|marketplace|package manager|registry publish|renderer implementation|renderer file|resource bytes|workflow json|provider payload|raw payload|signed url|token|secret|password|api key|prompt text|resource content|execution code|runtime execution|local path|filesystem path)\b/i;
const UNSAFE_FIELD_KEY_PATTERN =
  /^(?:token|secret|password|apiKey|api_key|authorization|authHeader|bearerToken|signedUrl|presignedUrl|accessUrl|downloadUrl|dataUrl|localPath|filesystemPath|filePath|cachePath|storagePath|runtimePath|providerRef|sourceRef|providerPayload|rawProviderPayload|rawPayload|workflowJson|promptText|executionCode|resourceContent|resourceBytes|contentBase64|base64)$/i;
const UNSAFE_VALUE_CONTEXT_KEY_PATTERN =
  /(?:^|\.)(?:packId|entryId|ruleId|definitionId|schemaId|fingerprint|checksum|versionRange|reason|sourceRef|providerRef|path|url|token|secret|password|payload|content|bytes|base64|workflowJson|promptText|executionCode)$/i;
const EXPLANATORY_CONTEXT_KEY_PATTERN =
  /^(?:description|purpose|limitations|safetyNotes|antiPatterns|configurationGuidance|compositionGuidance|validationGuidance|accessibilityGuidance|examples|commonMistakes|developerFacingSummary|userFacingSummary|inputSummary|outputSummary|summary|details|whyAvoid|saferAlternative|expectedOutcome|message|helpText)$/i;
const LOCAL_FILESYSTEM_PATH_VALUE_PATTERN =
  /(^~\/|^\.\.?\/|^\/(?:tmp|var|home|users|etc|private|opt|usr|mnt|volumes)(?:\/|$)|^[a-z]:[\\/]|\\(?:Users|Temp)\\|\/(?:tmp|temp)\/|[\\/]\.cache[\\/]huggingface(?:[\\/]|$)|[\\/]huggingface[\\/]hub(?:[\\/]|$))/i;
const AUTH_BEARING_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|api\s+key|apikey)\s*[=:]|(?:token|password|secret)\s*[=:]|authorization\s*:)/i;
const DATA_BASE64_VALUE_PATTERN = /^data:[^,;]+;base64,/i;
const LONG_BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/]{80,}={0,2}$/;
const SIGNED_OR_QUERY_URL_VALUE_PATTERN =
  /^https?:\/\/\S+\?(?:\S*?(?:x-amz-signature|x-goog-signature|signature|sig|token|access_token|auth|expires|X-Amz-Signature)=\S+|\S{24,})/i;
const PROVIDER_OR_TOKEN_URL_VALUE_PATTERN = /^(?:hf|huggingface|s3|gs|file):\/\/\S+/i;

export function validateAssetPackManifest(
  manifest: AssetPackManifest,
): AssetPackValidationResult {
  const issues: AssetValidationIssue[] = [];

  validateHeader(manifest, issues);
  validateCompatibility(manifest, issues);
  validateDependencies(manifest.dependencies, issues);
  validateCategories(manifest.categories, issues);
  validateEntries(manifest.assets, issues);
  validateOverrideRules(manifest.overrideRules, issues);
  validateSafeObject(manifest.metadata, issues, ["metadata"]);
  validateNoForbiddenValues(manifest, issues, ["manifest"]);
  validateJsonSerializable(manifest, issues);

  return {
    status: deriveStatus(issues),
    issues,
  };
}

export function validateAssetPackAssetEntry(
  entry: AssetPackAssetEntry,
  path: readonly string[] = ["assets", "0"],
): readonly AssetValidationIssue[] {
  const issues: AssetValidationIssue[] = [];
  validateEntry(entry, issues, path);
  return issues;
}

function validateHeader(
  manifest: AssetPackManifest,
  issues: AssetValidationIssue[],
): void {
  if (!hasText(manifest.schemaVersion)) {
    addIssue(issues, "error", "identity", "Asset pack schema version is required.", [
      "schemaVersion",
    ]);
  }
  if (!hasText(manifest.packId) || !isAssetPackId(String(manifest.packId))) {
    addIssue(issues, "error", "identity", "Asset pack ID must be present and safe.", [
      "packId",
    ]);
  }
  if (!hasText(manifest.version) || !isAssetPackVersion(String(manifest.version))) {
    addIssue(issues, "error", "identity", "Asset pack version must be semver-like.", [
      "version",
    ]);
  }
  if (!hasText(manifest.displayName) || !SAFE_LABEL_PATTERN.test(manifest.displayName)) {
    addIssue(issues, "error", "identity", "Asset pack display name must be present and safe.", [
      "displayName",
    ]);
  }
  if (!ASSET_PACK_SOURCE_KINDS.includes(manifest.sourceKind)) {
    addIssue(issues, "error", "provenance", "Asset pack source kind is not allowed.", [
      "sourceKind",
    ]);
  }
  if (!ASSET_SOURCE_LAYERS.includes(manifest.sourceLayer)) {
    addIssue(issues, "error", "provenance", "Asset pack source layer is not allowed.", [
      "sourceLayer",
    ]);
  }
  if (!ASSET_PACK_TRUST_STATUSES.includes(manifest.trustStatus)) {
    addIssue(issues, "error", "provenance", "Asset pack trust status is not allowed.", [
      "trustStatus",
    ]);
  }
}

function validateCompatibility(
  manifest: AssetPackManifest,
  issues: AssetValidationIssue[],
): void {
  const compatibility = manifest.compatibility;
  if (!compatibility) return;
  if (!hasText(compatibility.schemaVersion)) {
    addIssue(issues, "error", "identity", "Compatibility schema version is required.", [
      "compatibility",
      "schemaVersion",
    ]);
  }
  validateSafeObject(compatibility.metadata, issues, ["compatibility", "metadata"]);
  validateNoForbiddenValues(compatibility, issues, ["compatibility"]);
}

function validateDependencies(
  dependencies: readonly AssetPackDependency[] | undefined,
  issues: AssetValidationIssue[],
): void {
  dependencies?.forEach((dependency, index) => {
    const path = ["dependencies", String(index)];
    if (!isAssetPackId(String(dependency.packId ?? ""))) {
      addIssue(issues, "error", "identity", "Dependency pack ID must be safe.", [
        ...path,
        "packId",
      ]);
    }
    if (!hasText(dependency.versionRange) || !SAFE_VERSION_RANGE_PATTERN.test(dependency.versionRange)) {
      addIssue(issues, "error", "identity", "Dependency version range must be declarative and safe.", [
        ...path,
        "versionRange",
      ]);
    }
    if (dependency.reason && isUnsafeText(dependency.reason)) {
      addIssue(issues, "error", "security", "Dependency reason contains unsafe text.", [
        ...path,
        "reason",
      ]);
    }
    validateSafeObject(dependency.metadata, issues, [...path, "metadata"]);
  });
}

function validateCategories(
  categories: readonly string[] | undefined,
  issues: AssetValidationIssue[],
): void {
  const ids = new Set<string>();
  categories?.forEach((categoryId, index) => {
    const path = ["categories", String(index)];
    if (!SAFE_CATEGORY_ID_PATTERN.test(String(categoryId))) {
      addIssue(issues, "error", "identity", "Category ID must be a safe string.", path);
    }
    if (ids.has(categoryId)) {
      addIssue(issues, "error", "identity", "Category IDs must be unique.", path);
    }
    ids.add(categoryId);
  });
}

function validateEntries(
  entries: readonly AssetPackAssetEntry[],
  issues: AssetValidationIssue[],
): void {
  const entryIds = new Set<string>();
  const definitionRefs = new Set<string>();

  entries.forEach((entry, index) => {
    const path = ["assets", String(index)];
    validateEntry(entry, issues, path);
    if (entryIds.has(entry.entryId)) {
      addIssue(issues, "error", "identity", "Asset pack entry IDs must be unique.", [
        ...path,
        "entryId",
      ]);
    }
    entryIds.add(entry.entryId);

    const refKey = referenceKey(entry.definitionRef);
    if (definitionRefs.has(refKey)) {
      addIssue(issues, "error", "identity", "Asset pack definition refs must be unique within a pack.", [
        ...path,
        "definitionRef",
      ]);
    }
    definitionRefs.add(refKey);
  });
}

function validateEntry(
  entry: AssetPackAssetEntry,
  issues: AssetValidationIssue[],
  path: readonly string[],
): void {
  if (!SAFE_ENTRY_ID_PATTERN.test(String(entry.entryId ?? ""))) {
    addIssue(issues, "error", "identity", "Asset pack entry ID must be stable and safe.", [
      ...path,
      "entryId",
    ]);
  }
  validateReference(entry.definitionRef, issues, [...path, "definitionRef"]);
  if (!SAFE_CATEGORY_ID_PATTERN.test(String(entry.category ?? ""))) {
    addIssue(issues, "error", "identity", "Asset pack entry category must be safe.", [
      ...path,
      "category",
    ]);
  }
  if (!ASSET_SOURCE_LAYERS.includes(entry.sourceLayer)) {
    addIssue(issues, "error", "provenance", "Asset pack entry source layer is not allowed.", [
      ...path,
      "sourceLayer",
    ]);
  }
  if (!hasText(entry.fingerprint) || isUnsafeText(entry.fingerprint)) {
    addIssue(issues, "error", "identity", "Asset pack entry fingerprint must be present and safe.", [
      ...path,
      "fingerprint",
    ]);
  }
  validateDefinitionRefMatchesDefinition(entry.definition, entry.definitionRef, issues, path);
  validateSafeObject(entry.metadata, issues, [...path, "metadata"]);
  validateNoForbiddenValues(entry, issues, path);

  for (const issue of validateAssetDefinition(entry.definition).issues) {
    issues.push({
      ...issue,
      path: [...path, "definition", ...(issue.path ?? [])],
    });
  }
}

function validateDefinitionRefMatchesDefinition(
  definition: AssetDefinition,
  definitionRef: AssetReference,
  issues: AssetValidationIssue[],
  path: readonly string[],
): void {
  if (definitionRef.id !== definition.definitionId) {
    addIssue(issues, "error", "identity", "Entry definitionRef ID must match the full definition ID.", [
      ...path,
      "definitionRef",
      "id",
    ]);
  }
  if (
    definitionRef.kind === "asset-definition-version" &&
    definitionRef.version !== definition.version
  ) {
    addIssue(issues, "error", "identity", "Entry definitionRef version must match the full definition version.", [
      ...path,
      "definitionRef",
      "version",
    ]);
  }
}

function validateOverrideRules(
  rules: readonly AssetPackOverrideRule[] | undefined,
  issues: AssetValidationIssue[],
): void {
  const ruleIds = new Set<string>();
  rules?.forEach((rule, index) => {
    const path = ["overrideRules", String(index)];
    if (!SAFE_ENTRY_ID_PATTERN.test(String(rule.ruleId ?? ""))) {
      addIssue(issues, "error", "identity", "Override rule ID must be stable and safe.", [
        ...path,
        "ruleId",
      ]);
    }
    if (ruleIds.has(rule.ruleId)) {
      addIssue(issues, "error", "identity", "Override rule IDs must be unique.", [
        ...path,
        "ruleId",
      ]);
    }
    ruleIds.add(rule.ruleId);
    validateReference(rule.targetRef, issues, [...path, "targetRef"]);
    validateReference(rule.replacementRef, issues, [...path, "replacementRef"]);
    if (referenceKey(rule.targetRef) === referenceKey(rule.replacementRef)) {
      addIssue(issues, "error", "composition", "Override rules must point from a target ref to a distinct replacement ref.", path);
    }
    if (!ASSET_PACK_OVERRIDE_SCOPES.includes(rule.scope)) {
      addIssue(issues, "error", "composition", "Override rule scope is not allowed.", [
        ...path,
        "scope",
      ]);
    }
    if (!ASSET_SOURCE_LAYERS.includes(rule.sourceLayer)) {
      addIssue(issues, "error", "provenance", "Override rule source layer is not allowed.", [
        ...path,
        "sourceLayer",
      ]);
    }
    if (!ASSET_PACK_OVERRIDE_CONFLICT_POLICIES.includes(rule.conflictPolicy)) {
      addIssue(issues, "error", "composition", "Override rule conflict policy is not allowed.", [
        ...path,
        "conflictPolicy",
      ]);
    }
    if (rule.conflictPolicy === "disabled" || rule.enabled === false) {
      addIssue(issues, "warning", "composition", "Disabled override rules are declarative but will not participate in future resolution.", path);
    }
    if (rule.reason && isUnsafeText(rule.reason)) {
      addIssue(issues, "error", "security", "Override rule reason contains unsafe text.", [
        ...path,
        "reason",
      ]);
    }
    validateSafeObject(rule.metadata, issues, [...path, "metadata"]);
    validateNoForbiddenValues(rule, issues, path);
  });
}

function validateReference(
  assetReference: AssetReference,
  issues: AssetValidationIssue[],
  path: readonly string[],
): void {
  if (!isAssetReferenceKind(String(assetReference.kind ?? ""))) {
    addIssue(issues, "error", "identity", "Asset reference kind is not allowed.", [
      ...path,
      "kind",
    ]);
  }
  if (!hasText(assetReference.id) || isUnsafeText(String(assetReference.id))) {
    addIssue(issues, "error", "identity", "Asset reference ID must be present and safe.", [
      ...path,
      "id",
    ]);
  }
  validateSafeObject(assetReference.metadata, issues, [...path, "metadata"]);
}

function validateSafeObject(
  value: AssetMetadata | undefined,
  issues: AssetValidationIssue[],
  path: readonly string[],
): void {
  if (!value) return;
  walk(value, path, (current, currentPath) => {
    if (typeof current.key === "string" && isUnsafeAssetMetadataKey(current.key)) {
      addIssue(issues, "error", "security", "Metadata key is unsafe for asset pack manifests.", currentPath);
    }
    if (typeof current.value === "string" && isUnsafeText(current.value)) {
      addIssue(issues, "error", "security", "Metadata value is unsafe for asset pack manifests.", currentPath);
    }
  });
}

function validateNoForbiddenValues(
  value: unknown,
  issues: AssetValidationIssue[],
  path: readonly string[],
): void {
  walk(value, path, (current, currentPath) => {
    if (typeof current.key === "string" && isUnsafeManifestFieldKey(current.key)) {
      addIssue(issues, "error", "security", "Asset pack manifest contains an unsafe payload field.", currentPath);
      return;
    }
    if (typeof current.value !== "string") return;
    if (isExplanatoryContextPath(currentPath)) {
      if (isActualUnsafePayloadString(current.value)) {
        addIssue(issues, "error", "security", "Asset pack manifest contains an unsafe value.", currentPath);
      }
      return;
    }
    if (
      isUnsafeValueContextPath(currentPath) &&
      (isUnsafeText(current.value) || isActualUnsafePayloadString(current.value))
    ) {
      addIssue(issues, "error", "security", "Asset pack manifest contains an unsafe value.", currentPath);
      return;
    }
    if (isActualUnsafePayloadString(current.value)) {
      addIssue(issues, "error", "security", "Asset pack manifest contains an unsafe value.", currentPath);
    }
  });
}

function validateJsonSerializable(value: unknown, issues: AssetValidationIssue[]): void {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || JSON.parse(serialized) === undefined) {
      addIssue(issues, "error", "security", "Asset pack manifest must be JSON-serializable.", [
        "manifest",
      ]);
    }
  } catch {
    addIssue(issues, "error", "security", "Asset pack manifest must be JSON-serializable.", [
      "manifest",
    ]);
  }
}

function walk(
  value: unknown,
  path: readonly string[],
  callback: (
    current: { readonly key?: string; readonly value: unknown },
    path: readonly string[],
  ) => void,
  seen = new WeakSet<object>(),
): void {
  callback({ value }, path);
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, [...path, String(index)], callback, seen));
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    callback({ key, value: entry }, [...path, key]);
    walk(entry, [...path, key], callback, seen);
  });
}

function isUnsafeText(value: string): boolean {
  return isUnsafeAssetMetadataString(value) || FORBIDDEN_TEXT_PATTERN.test(value);
}

function isUnsafeManifestFieldKey(key: string): boolean {
  return UNSAFE_FIELD_KEY_PATTERN.test(key);
}

function isExplanatoryContextPath(path: readonly string[]): boolean {
  if (path.includes("metadata")) return false;
  if (path.some((part) => isUnsafeManifestFieldKey(part))) return false;
  return path.some((part) => EXPLANATORY_CONTEXT_KEY_PATTERN.test(part));
}

function isUnsafeValueContextPath(path: readonly string[]): boolean {
  if (path.includes("metadata")) return true;
  return UNSAFE_VALUE_CONTEXT_KEY_PATTERN.test(path.join("."));
}

function isActualUnsafePayloadString(value: string): boolean {
  const trimmed = value.trim();
  return (
    LOCAL_FILESYSTEM_PATH_VALUE_PATTERN.test(trimmed) ||
    AUTH_BEARING_VALUE_PATTERN.test(trimmed) ||
    DATA_BASE64_VALUE_PATTERN.test(trimmed) ||
    LONG_BASE64_VALUE_PATTERN.test(trimmed) ||
    SIGNED_OR_QUERY_URL_VALUE_PATTERN.test(trimmed) ||
    PROVIDER_OR_TOKEN_URL_VALUE_PATTERN.test(trimmed)
  );
}

function referenceKey(reference: AssetReference): string {
  return `${reference.kind}:${reference.id}:${reference.version ?? ""}`;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function addIssue(
  issues: AssetValidationIssue[],
  severity: AssetValidationIssue["severity"],
  category: AssetValidationIssue["category"],
  message: string,
  path: readonly string[],
): void {
  issues.push({ severity, category, message, path });
}

function deriveStatus(
  issues: readonly AssetValidationIssue[],
): AssetValidationSummaryStatus {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "valid-with-warnings";
  return "valid";
}

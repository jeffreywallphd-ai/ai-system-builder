import {
  normalizeAssetId,
  normalizeAssetReferenceKind,
  normalizeAssetVersion,
  type AssetMetadata,
  type AssetReference,
} from "../asset";
import {
  normalizeAssetImplementationArtifactDescriptor,
  normalizeAssetImplementationBackingResourceRole,
  normalizeAssetImplementationDraftId,
  normalizeAssetImplementationReleaseId,
  normalizeAssetSourceSnapshotId,
  normalizeSha256Digest,
  type AssetImplementationArtifactDescriptor,
} from "../asset-implementation";
import { ASSET_STUDIO_LIMITS } from "../asset-studio";
import { createWorkspaceId } from "../workspace";
import {
  ASSET_AUTHORING_DIAGNOSTIC_CODES,
  type AssetAuthoringDiagnostic,
} from "./asset-authoring-diagnostics";
import { normalizeSafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import type { SafeAssetEditableFieldPatch } from "./asset-authoring-editable-fields";
import { normalizeAssetCustomizationId } from "./asset-authoring-identity";
import {
  ASSET_CUSTOMIZATION_TARGET_SOURCE_KINDS,
  type AssetCustomizationTargetSourceKind,
} from "./asset-authoring-models";
import type { AssetAuthoringNormalizationResult } from "./asset-authoring-normalization";
import {
  ASSET_CUSTOMIZATION_PROTECTED_FIELDS,
  ASSET_DERIVED_CUSTOMIZATION_STATUSES,
  type AssetCustomizationProtectedField,
  type AssetCustomizationSourceFileChange,
  type AssetCustomizationSourceOverlayV1,
  type AssetCustomizationSourceOverlayDescriptor,
  type AssetDerivedCustomizationBaseIdentity,
  type AssetDerivedCustomizationDraftRecord,
  type AssetDerivedCustomizationSemanticPatch,
  type AssetDerivedCustomizationProvenance,
  type AssetDerivedCustomizationPublication,
  type AssetDerivedCustomizationReview,
  type AssetDerivedCustomizationStatus,
} from "./asset-derived-customization";

const ALLOWED_SOURCE_FILE = /\.(?:ts|tsx|json|css|md)$/i;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
  /\b(?:sk|ghp|github_pat|hf)_[A-Za-z0-9_-]{16,}\b/,
];
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const DERIVED_SEMANTIC_STRUCTURAL_FIELDS = [
  "configuration-schema",
  "default-configuration",
  "ports",
  "ai-context",
  "requirements",
  "composition-rules",
  "dependencies",
] as const;
const STRUCTURAL_SEMANTIC_LIMIT = 256_000;
const UNSAFE_STRUCTURAL_KEY =
  /(?:raw)?path|storageRoot|storage-root|bytes?|blob|base64|providerPayload|provider-payload|token|secret|apiKey|api-key|stack|command|environment|\benv\b/i;

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}

function safeText(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > maximum ||
    !SAFE_TEXT.test(value) ||
    SECRET_PATTERNS.some((pattern) => pattern.test(value))
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = safeText(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function positiveRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function boundedCount(value: unknown, label: string, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(value);
}

function sameReference(left: AssetReference, right: AssetReference): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version
  );
}

export function normalizeExactAssetDefinitionReference(
  value: AssetReference,
): AssetReference {
  const record = asObject(value, "Asset definition reference");
  assertKeys(
    record,
    ["kind", "id", "version", "label", "metadata"],
    "Asset definition reference",
  );
  const kind = normalizeAssetReferenceKind(String(record.kind ?? ""));
  if (kind !== "asset-definition-version") {
    throw new Error(
      "Derived customization requires an exact asset-definition-version reference.",
    );
  }
  if (record.version === undefined) {
    throw new Error(
      "Derived customization requires an exact asset definition version.",
    );
  }
  return {
    kind,
    id: normalizeAssetId(safeText(record.id, "Asset definition id", 160)),
    version: normalizeAssetVersion(
      safeText(record.version, "Asset definition version", 80),
    ),
  };
}

function normalizeSourceArtifact(
  value: AssetImplementationArtifactDescriptor,
  label: string,
): AssetImplementationArtifactDescriptor {
  const record = asObject(value, label);
  assertKeys(
    record,
    ["artifactId", "kind", "digest", "mediaType", "sizeBytes"],
    label,
  );
  const artifact = normalizeAssetImplementationArtifactDescriptor(value);
  if (artifact.kind !== "source" || artifact.sizeBytes < 1) {
    throw new Error(`${label} must identify non-empty source content.`);
  }
  return artifact;
}

export function normalizeAssetDerivedCustomizationBaseIdentity(
  value: AssetDerivedCustomizationBaseIdentity,
): AssetDerivedCustomizationBaseIdentity {
  const record = asObject(value, "Derived customization base");
  assertKeys(
    record,
    [
      "definitionRef",
      "implementationReleaseId",
      "sourceSnapshotId",
      "sourceArtifact",
    ],
    "Derived customization base",
  );
  return {
    definitionRef: normalizeExactAssetDefinitionReference(value.definitionRef),
    implementationReleaseId: normalizeAssetImplementationReleaseId(
      value.implementationReleaseId,
    ),
    sourceSnapshotId: normalizeAssetSourceSnapshotId(value.sourceSnapshotId),
    sourceArtifact: normalizeSourceArtifact(
      value.sourceArtifact,
      "Base source artifact",
    ),
  };
}

export function normalizeAssetDerivedCustomizationStatus(
  value: string,
): AssetDerivedCustomizationStatus {
  const normalized = value
    .trim()
    .toLowerCase() as AssetDerivedCustomizationStatus;
  if (!ASSET_DERIVED_CUSTOMIZATION_STATUSES.includes(normalized)) {
    throw new Error("Derived customization status is unsupported.");
  }
  return normalized;
}

function assertBoundedStructuralSemanticValue(value: unknown): void {
  const seen = new Set<object>();
  let serializedCharacters = 0;
  const visit = (current: unknown, depth: number): void => {
    if (depth > 24) throw new Error("Semantic patch structure is too deep.");
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "number"
    ) {
      if (typeof current === "number" && !Number.isFinite(current)) {
        throw new Error("Semantic patch value is invalid.");
      }
      serializedCharacters += String(current).length;
      return;
    }
    if (typeof current === "string") {
      if (
        current.includes("\0") ||
        SECRET_PATTERNS.some((pattern) => pattern.test(current))
      ) {
        throw new Error("Semantic patch value is invalid.");
      }
      serializedCharacters += current.length;
      return;
    }
    if (!current || typeof current !== "object") {
      throw new Error("Semantic patch value is invalid.");
    }
    if (seen.has(current)) throw new Error("Semantic patch value is cyclic.");
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 512) {
        throw new Error("Semantic patch collection is too large.");
      }
      current.forEach((entry) => visit(entry, depth + 1));
    } else {
      const entries = Object.entries(current as Record<string, unknown>);
      if (entries.length > 256) {
        throw new Error("Semantic patch object is too large.");
      }
      for (const [key, entry] of entries) {
        if (UNSAFE_STRUCTURAL_KEY.test(key)) {
          throw new Error("Semantic patch contains an unsafe field.");
        }
        serializedCharacters += key.length;
        visit(entry, depth + 1);
      }
    }
    seen.delete(current);
    if (serializedCharacters > STRUCTURAL_SEMANTIC_LIMIT) {
      throw new Error("Semantic patch exceeds the aggregate limit.");
    }
  };
  visit(value, 0);
}

export function normalizeAssetDerivedCustomizationSemanticPatch(
  value: AssetDerivedCustomizationSemanticPatch,
): AssetDerivedCustomizationSemanticPatch {
  const record = asObject(value, "Derived customization semantic patch");
  const structural = new Set<string>(DERIVED_SEMANTIC_STRUCTURAL_FIELDS);
  const safeValues: Record<string, unknown> = {};
  const normalized: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(record)) {
    if (structural.has(field)) {
      assertBoundedStructuralSemanticValue(fieldValue);
      normalized[field] = fieldValue;
    } else {
      safeValues[field] = fieldValue;
    }
  }
  Object.assign(
    normalized,
    normalizeSafeAssetEditableFieldPatch(
      safeValues as SafeAssetEditableFieldPatch,
    ),
  );
  return normalized as AssetDerivedCustomizationSemanticPatch;
}

export function normalizeAssetCustomizationProtectedField(
  value: string,
): AssetCustomizationProtectedField {
  const normalized = value
    .trim()
    .toLowerCase() as AssetCustomizationProtectedField;
  if (!ASSET_CUSTOMIZATION_PROTECTED_FIELDS.includes(normalized)) {
    throw new Error("Customization protected field is unsupported.");
  }
  return normalized;
}

function normalizeSourceKind(
  value: AssetCustomizationTargetSourceKind,
): AssetCustomizationTargetSourceKind {
  if (!ASSET_CUSTOMIZATION_TARGET_SOURCE_KINDS.includes(value)) {
    throw new Error("Customization source kind is unsupported.");
  }
  return value;
}

function normalizeSourcePath(value: unknown): string {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error("Source file path is invalid.");
  }
  const path = value.replace(/\\/g, "/");
  if (
    !path ||
    path.length > 240 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\0") ||
    !ALLOWED_SOURCE_FILE.test(path)
  ) {
    throw new Error("Source file path is invalid.");
  }
  const segments = path.split("/");
  if (
    !segments.every(
      (segment) =>
        SAFE_PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..",
    ) ||
    segments.some((segment) =>
      ["node_modules", ".git", ".env"].includes(segment.toLowerCase()),
    )
  ) {
    throw new Error("Source file path is invalid.");
  }
  return path;
}

export function normalizeAssetCustomizationSourceChanges(
  value: readonly AssetCustomizationSourceFileChange[],
): readonly AssetCustomizationSourceFileChange[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > ASSET_STUDIO_LIMITS.maxFiles
  ) {
    throw new Error("Source overlay change count is invalid.");
  }

  const seen = new Set<string>();
  const normalized: AssetCustomizationSourceFileChange[] = [];
  let totalCharacters = 0;

  for (const change of value) {
    const record = asObject(change, "Source overlay change");
    const operation = record.operation;
    if (operation !== "upsert" && operation !== "delete") {
      throw new Error("Source overlay operation is unsupported.");
    }
    assertKeys(
      record,
      operation === "upsert"
        ? ["operation", "path", "role", "mediaType", "content"]
        : ["operation", "path"],
      "Source overlay change",
    );
    const path = normalizeSourcePath(record.path);
    const folded = path.toLowerCase();
    if (seen.has(folded)) {
      throw new Error("Source overlay paths must be unique.");
    }
    seen.add(folded);

    if (operation === "delete") {
      normalized.push({ operation, path });
      continue;
    }

    if (
      (record.mediaType !== undefined &&
        (typeof record.mediaType !== "string" ||
          record.mediaType !== record.mediaType.trim() ||
          !record.mediaType.includes("/") ||
          record.mediaType.length > 120)) ||
      typeof record.content !== "string" ||
      record.content.length > ASSET_STUDIO_LIMITS.maxFileCharacters ||
      record.content.includes("\0") ||
      SECRET_PATTERNS.some((pattern) => pattern.test(String(record.content)))
    ) {
      throw new Error("Source overlay content is invalid.");
    }
    totalCharacters += record.content.length;
    if (totalCharacters > ASSET_STUDIO_LIMITS.maxTotalSourceCharacters) {
      throw new Error("Source overlay content exceeds the aggregate limit.");
    }
    normalized.push({
      operation,
      path,
      role: normalizeAssetImplementationBackingResourceRole(
        String(record.role ?? (/\.css$/i.test(path) ? "frontend-style" : "other")),
      ),
      mediaType:
        typeof record.mediaType === "string"
          ? record.mediaType
          : /\.css$/i.test(path)
            ? "text/css"
            : /\.json$/i.test(path)
              ? "application/json"
              : "text/typescript",
      content: record.content,
    });
  }

  return normalized;
}

export function normalizeAssetCustomizationSourceOverlay(
  value: AssetCustomizationSourceOverlayV1,
): AssetCustomizationSourceOverlayV1 {
  const record = asObject(value, "Source overlay");
  assertKeys(record, ["formatVersion", "changes"], "Source overlay");
  if (value.formatVersion !== "1.0") {
    throw new Error("Source overlay format is unsupported.");
  }
  return {
    formatVersion: "1.0",
    changes: normalizeAssetCustomizationSourceChanges(value.changes),
  };
}

export function createAssetCustomizationSourceOverlayDescriptor(
  artifactValue: AssetImplementationArtifactDescriptor,
  changesValue: readonly AssetCustomizationSourceFileChange[],
): AssetCustomizationSourceOverlayDescriptor {
  const artifact = normalizeSourceArtifact(
    artifactValue,
    "Source overlay artifact",
  );
  const changes = normalizeAssetCustomizationSourceChanges(changesValue);
  const upsertCount = changes.filter(
    (change) => change.operation === "upsert",
  ).length;
  const deleteCount = changes.length - upsertCount;
  const totalCharacters = changes.reduce(
    (total, change) =>
      total + (change.operation === "upsert" ? change.content.length : 0),
    0,
  );
  return {
    artifact,
    changeCount: changes.length,
    upsertCount,
    deleteCount,
    totalCharacters,
  };
}

export function normalizeAssetCustomizationSourceOverlayDescriptor(
  value: AssetCustomizationSourceOverlayDescriptor,
): AssetCustomizationSourceOverlayDescriptor {
  const record = asObject(value, "Source overlay descriptor");
  assertKeys(
    record,
    [
      "artifact",
      "changeCount",
      "upsertCount",
      "deleteCount",
      "totalCharacters",
    ],
    "Source overlay descriptor",
  );
  const changeCount = boundedCount(
    value.changeCount,
    "Source overlay change count",
    ASSET_STUDIO_LIMITS.maxFiles,
  );
  const upsertCount = boundedCount(
    value.upsertCount,
    "Source overlay upsert count",
    ASSET_STUDIO_LIMITS.maxFiles,
  );
  const deleteCount = boundedCount(
    value.deleteCount,
    "Source overlay delete count",
    ASSET_STUDIO_LIMITS.maxFiles,
  );
  const totalCharacters = boundedCount(
    value.totalCharacters,
    "Source overlay character count",
    ASSET_STUDIO_LIMITS.maxTotalSourceCharacters,
  );
  if (changeCount < 1 || changeCount !== upsertCount + deleteCount) {
    throw new Error("Source overlay counts are inconsistent.");
  }
  return {
    artifact: normalizeSourceArtifact(
      value.artifact,
      "Source overlay artifact",
    ),
    changeCount,
    upsertCount,
    deleteCount,
    totalCharacters,
  };
}

function normalizeProvenance(
  value: AssetDerivedCustomizationProvenance,
  base: AssetDerivedCustomizationBaseIdentity,
): AssetDerivedCustomizationProvenance {
  const record = asObject(value, "Derived customization provenance");
  assertKeys(
    record,
    [
      "kind",
      "sourceKind",
      "baseDefinitionRef",
      "baseImplementationReleaseId",
      "baseSourceSnapshotId",
      "derivedAt",
      "derivedBy",
    ],
    "Derived customization provenance",
  );
  if (value.kind !== "layered-derived-customization") {
    throw new Error("Derived customization provenance kind is invalid.");
  }
  const normalized: AssetDerivedCustomizationProvenance = {
    kind: value.kind,
    sourceKind: normalizeSourceKind(value.sourceKind),
    baseDefinitionRef: normalizeExactAssetDefinitionReference(
      value.baseDefinitionRef,
    ),
    baseImplementationReleaseId: normalizeAssetImplementationReleaseId(
      value.baseImplementationReleaseId,
    ),
    baseSourceSnapshotId: normalizeAssetSourceSnapshotId(
      value.baseSourceSnapshotId,
    ),
    derivedAt: timestamp(value.derivedAt, "Derived at"),
    derivedBy: safeText(value.derivedBy, "Derived by", 160),
  };
  if (
    !sameReference(normalized.baseDefinitionRef, base.definitionRef) ||
    normalized.baseImplementationReleaseId !== base.implementationReleaseId ||
    normalized.baseSourceSnapshotId !== base.sourceSnapshotId
  ) {
    throw new Error(
      "Derived customization provenance does not match its base.",
    );
  }
  return normalized;
}

function normalizeDiagnostic(
  value: AssetAuthoringDiagnostic,
): AssetAuthoringDiagnostic {
  const record = asObject(value, "Asset authoring diagnostic");
  assertKeys(
    record,
    ["severity", "code", "message", "safeDetails"],
    "Asset authoring diagnostic",
  );
  if (
    value.severity !== "info" &&
    value.severity !== "warning" &&
    value.severity !== "error"
  ) {
    throw new Error("Asset authoring diagnostic severity is invalid.");
  }
  if (!ASSET_AUTHORING_DIAGNOSTIC_CODES.includes(value.code)) {
    throw new Error("Asset authoring diagnostic code is invalid.");
  }
  const safeDetails =
    value.safeDetails === undefined
      ? undefined
      : (normalizeSafeAssetEditableFieldPatch({
          "safe-metadata": value.safeDetails,
        })["safe-metadata"] as AssetMetadata);
  return {
    severity: value.severity,
    code: value.code,
    message: safeText(value.message, "Asset authoring diagnostic message"),
    ...(safeDetails === undefined ? {} : { safeDetails }),
  };
}

function normalizeReview(
  value: AssetDerivedCustomizationReview,
  base: AssetDerivedCustomizationBaseIdentity,
  overlay: AssetCustomizationSourceOverlayDescriptor | undefined,
  revision: number,
): AssetDerivedCustomizationReview {
  const record = asObject(value, "Derived customization review");
  assertKeys(
    record,
    [
      "implementationDraftId",
      "sourceSnapshotId",
      "sourceArtifact",
      "semanticPatchDigest",
      "sourceOverlayDigest",
      "materializedFromRevision",
      "materializedAt",
      "materializedBy",
    ],
    "Derived customization review",
  );
  const sourceSnapshotId = normalizeAssetSourceSnapshotId(
    value.sourceSnapshotId,
  );
  const materializedFromRevision = positiveRevision(
    value.materializedFromRevision,
    "Materialized revision",
  );
  if (
    sourceSnapshotId === base.sourceSnapshotId ||
    materializedFromRevision > revision
  ) {
    throw new Error("Derived customization review is stale or not distinct.");
  }
  const sourceOverlayDigest =
    value.sourceOverlayDigest === undefined
      ? undefined
      : normalizeSha256Digest(value.sourceOverlayDigest);
  if (
    (overlay === undefined && sourceOverlayDigest !== undefined) ||
    (overlay !== undefined && sourceOverlayDigest !== overlay.artifact.digest)
  ) {
    throw new Error("Derived customization review overlay digest is invalid.");
  }
  return {
    implementationDraftId: normalizeAssetImplementationDraftId(
      value.implementationDraftId,
    ),
    sourceSnapshotId,
    sourceArtifact: normalizeSourceArtifact(
      value.sourceArtifact,
      "Materialized source artifact",
    ),
    semanticPatchDigest: normalizeSha256Digest(value.semanticPatchDigest),
    ...(sourceOverlayDigest === undefined ? {} : { sourceOverlayDigest }),
    materializedFromRevision,
    materializedAt: timestamp(value.materializedAt, "Materialized at"),
    materializedBy: safeText(value.materializedBy, "Materialized by", 160),
  };
}

function normalizePublication(
  value: AssetDerivedCustomizationPublication,
  base: AssetDerivedCustomizationBaseIdentity,
  review: AssetDerivedCustomizationReview,
): AssetDerivedCustomizationPublication {
  const record = asObject(value, "Derived customization publication");
  assertKeys(
    record,
    [
      "definitionRef",
      "implementationDraftId",
      "sourceSnapshotId",
      "publishedAt",
      "publishedBy",
    ],
    "Derived customization publication",
  );
  const definitionRef = normalizeExactAssetDefinitionReference(
    value.definitionRef,
  );
  const implementationDraftId = normalizeAssetImplementationDraftId(
    value.implementationDraftId,
  );
  const sourceSnapshotId = normalizeAssetSourceSnapshotId(
    value.sourceSnapshotId,
  );
  if (
    sameReference(definitionRef, base.definitionRef) ||
    sourceSnapshotId !== review.sourceSnapshotId ||
    implementationDraftId !== review.implementationDraftId
  ) {
    throw new Error(
      "Published customization must be a distinct reviewed asset lineage.",
    );
  }
  return {
    definitionRef,
    implementationDraftId,
    sourceSnapshotId,
    publishedAt: timestamp(value.publishedAt, "Published at"),
    publishedBy: safeText(value.publishedBy, "Published by", 160),
  };
}

export function normalizeAssetDerivedCustomizationDraftRecord(
  value: AssetDerivedCustomizationDraftRecord,
): AssetDerivedCustomizationDraftRecord {
  const record = asObject(value, "Derived customization draft");
  assertKeys(
    record,
    [
      "customizationId",
      "workspaceId",
      "base",
      "derivedDefinitionRef",
      "semanticPatch",
      "sourceOverlay",
      "status",
      "revision",
      "provenance",
      "review",
      "publication",
      "createdAt",
      "updatedAt",
      "createdBy",
      "diagnostics",
    ],
    "Derived customization draft",
  );
  const workspaceId = createWorkspaceId(value.workspaceId);
  const base = normalizeAssetDerivedCustomizationBaseIdentity(value.base);
  const derivedDefinitionRef = normalizeExactAssetDefinitionReference(
    value.derivedDefinitionRef,
  );
  if (sameReference(derivedDefinitionRef, base.definitionRef)) {
    throw new Error("Derived definition identity must differ from its base.");
  }
  const semanticPatch = normalizeAssetDerivedCustomizationSemanticPatch(
    value.semanticPatch,
  );
  const sourceOverlay =
    value.sourceOverlay === undefined
      ? undefined
      : normalizeAssetCustomizationSourceOverlayDescriptor(value.sourceOverlay);
  if (Object.keys(semanticPatch).length === 0 && sourceOverlay === undefined) {
    throw new Error("Derived customization must contain at least one change.");
  }
  const status = normalizeAssetDerivedCustomizationStatus(value.status);
  const revision = positiveRevision(value.revision, "Customization revision");
  const provenance = normalizeProvenance(value.provenance, base);
  const createdAt = timestamp(value.createdAt, "Created at");
  const updatedAt = timestamp(value.updatedAt, "Updated at");
  const createdBy = safeText(value.createdBy, "Created by", 160);
  if (
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    provenance.derivedAt !== createdAt ||
    provenance.derivedBy !== createdBy
  ) {
    throw new Error(
      "Derived customization creation provenance is inconsistent.",
    );
  }

  const review =
    value.review === undefined
      ? undefined
      : normalizeReview(value.review, base, sourceOverlay, revision);
  if (
    (status === "reviewed" || status === "published") &&
    review === undefined
  ) {
    throw new Error("Reviewed customization status requires review evidence.");
  }
  if (
    review !== undefined &&
    ((status === "reviewed" && review.materializedFromRevision !== revision) ||
      (status === "published" &&
        review.materializedFromRevision !== revision - 1) ||
      review.materializedFromRevision > revision)
  ) {
    throw new Error("Derived customization review is stale.");
  }
  if (
    (status === "draft" || status === "ready-for-review") &&
    review !== undefined
  ) {
    throw new Error(
      "Unreviewed customization status cannot retain review evidence.",
    );
  }

  const publication =
    value.publication === undefined
      ? undefined
      : review === undefined
        ? (() => {
            throw new Error(
              "Derived customization publication requires review evidence.",
            );
          })()
        : normalizePublication(value.publication, base, review);
  if (
    (status === "published" && publication === undefined) ||
    (status !== "published" && publication !== undefined)
  ) {
    throw new Error(
      "Derived customization publication status is inconsistent.",
    );
  }
  if (
    publication !== undefined &&
    !sameReference(publication.definitionRef, derivedDefinitionRef)
  ) {
    throw new Error("Published definition does not match the proposed identity.");
  }

  return {
    customizationId: normalizeAssetCustomizationId(value.customizationId),
    workspaceId,
    base,
    derivedDefinitionRef,
    semanticPatch,
    ...(sourceOverlay === undefined ? {} : { sourceOverlay }),
    status,
    revision,
    provenance,
    ...(review === undefined ? {} : { review }),
    ...(publication === undefined ? {} : { publication }),
    createdAt,
    updatedAt,
    createdBy,
    ...(value.diagnostics === undefined
      ? {}
      : { diagnostics: value.diagnostics.map(normalizeDiagnostic) }),
  };
}

export function tryNormalizeAssetDerivedCustomizationDraftRecord(
  value: AssetDerivedCustomizationDraftRecord,
): AssetAuthoringNormalizationResult<AssetDerivedCustomizationDraftRecord> {
  try {
    return {
      ok: true,
      value: normalizeAssetDerivedCustomizationDraftRecord(value),
    };
  } catch {
    return {
      ok: false,
      code: "asset-authoring.derived-customization.invalid",
    };
  }
}

import {
  createOrganizationId,
  type OrganizationId,
} from "../organization";
import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../storage";
import { createWorkspaceId, type WorkspaceId } from "../workspace";
import {
  normalizeDatasetId,
  normalizeDatasetVersionId,
  normalizeDatasetVersionPublicationId,
  type DatasetId,
  type DatasetVersionId,
  type DatasetVersionPublicationId,
} from "./dataset-version-id";

export type DatasetVersionDigest = `sha256:${string}`;
export type DatasetVersionArtifactRole =
  | "dataset"
  | "train"
  | "validation"
  | "test"
  | "report"
  | "quarantine"
  | "recipe"
  | "dataset-card"
  | "croissant";

export interface DatasetVersionArtifact {
  readonly role: DatasetVersionArtifactRole;
  readonly artifactKey: StorageArtifactKey;
  readonly digest: DatasetVersionDigest;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly rowCount?: number;
}

export interface DatasetVersionSource {
  /** Stable catalog id used to reselect the same user-facing input. */
  readonly sourceArtifactId?: string;
  readonly artifactKey: StorageArtifactKey;
  readonly digest: DatasetVersionDigest;
  readonly mediaType: string;
}

export interface DatasetVersionRecipeLineage {
  readonly artifactKey: StorageArtifactKey;
  readonly digest: DatasetVersionDigest;
  readonly implementationId: string;
  readonly implementationVersion: string;
}

export interface DatasetVersionSplitLineage {
  readonly strategy: string;
  readonly seed: number;
  readonly groupField?: string;
}

export interface DatasetVersionQualityLineage {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyFingerprint: DatasetVersionDigest;
  readonly reportFingerprint: DatasetVersionDigest;
}

export interface DatasetVersionLineage {
  readonly sources: readonly DatasetVersionSource[];
  readonly recipe: DatasetVersionRecipeLineage;
  readonly split?: DatasetVersionSplitLineage;
  readonly quality: DatasetVersionQualityLineage;
  readonly parentVersionId?: DatasetVersionId;
}

export interface DatasetVersionComparison {
  readonly fromVersionId: DatasetVersionId;
  readonly toVersionId: DatasetVersionId;
  readonly identical: boolean;
  readonly rowDelta: number;
  readonly sources: { readonly added: number; readonly removed: number; readonly changed: number };
  readonly changedArtifactRoles: readonly string[];
  readonly recipeChanged: boolean;
  readonly qualityPolicyChanged: boolean;
  readonly documentationChanged: boolean;
}

export interface DatasetVersionReproduction {
  readonly versionId: DatasetVersionId;
  readonly sourceArtifactIds: readonly string[];
  readonly recipeSnapshot: Readonly<Record<string, unknown>>;
  readonly lineage: DatasetVersionLineage;
}

export interface DatasetVersionDocumentation {
  readonly name: string;
  readonly summary: string;
  readonly intendedUses: readonly string[];
  readonly limitations: readonly string[];
  readonly license?: string;
  readonly languages?: readonly string[];
  readonly citation?: string;
}

/**
 * A complete, immutable dataset version. Artifact content remains in artifact
 * storage and is bound here by exact SHA-256 digest.
 */
export interface DatasetVersionRecord {
  readonly schemaVersion: "1.0";
  readonly versionId: DatasetVersionId;
  readonly datasetId: DatasetId;
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly versionDigest: DatasetVersionDigest;
  readonly artifacts: readonly DatasetVersionArtifact[];
  readonly lineage: DatasetVersionLineage;
  readonly documentation: DatasetVersionDocumentation;
  readonly totalRows: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type DatasetPublicationVisibility = "private" | "protected" | "public";

/** Append-only evidence of one successful external publication. */
export interface DatasetVersionPublicationRecord {
  readonly schemaVersion: "1.0";
  readonly publicationId: DatasetVersionPublicationId;
  readonly versionId: DatasetVersionId;
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly provider: "hugging-face";
  readonly repositoryId: string;
  readonly revision: string;
  readonly visibility: DatasetPublicationVisibility;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

const ARTIFACT_ROLES: readonly DatasetVersionArtifactRole[] = [
  "dataset",
  "train",
  "validation",
  "test",
  "report",
  "quarantine",
  "recipe",
  "dataset-card",
  "croissant",
];
const PUBLICATION_VISIBILITIES: readonly DatasetPublicationVisibility[] = [
  "private",
  "protected",
  "public",
];
const MAX_TEXT_LENGTH = 4_000;
const MAX_LIST_ITEMS = 100;

export function normalizeDatasetVersionDigest(
  value: string,
): DatasetVersionDigest {
  const normalized = normalizeText(value, "Dataset version digest", 71).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("Dataset version digest must be a SHA-256 digest.");
  }
  return normalized as DatasetVersionDigest;
}

export function normalizeDatasetVersionRecord(
  value: DatasetVersionRecord,
): DatasetVersionRecord {
  if (value.schemaVersion !== "1.0") {
    throw new Error("Dataset version schema version is unsupported.");
  }
  const artifacts = normalizeBoundedList(
    value.artifacts,
    "Dataset version artifacts",
    normalizeDatasetVersionArtifact,
  );
  if (artifacts.length === 0 || !artifacts.some((item) => item.role === "dataset")) {
    throw new Error("Dataset version artifacts must include the complete dataset.");
  }
  assertUnique(
    artifacts.map((item) => `${item.role}:${item.artifactKey}`),
    "Dataset version artifact roles and keys",
  );
  return {
    schemaVersion: "1.0",
    versionId: normalizeDatasetVersionId(value.versionId),
    datasetId: normalizeDatasetId(value.datasetId),
    ...(value.organizationId
      ? { organizationId: createOrganizationId(value.organizationId) }
      : {}),
    workspaceId: createWorkspaceId(value.workspaceId),
    versionDigest: normalizeDatasetVersionDigest(value.versionDigest),
    artifacts,
    lineage: normalizeDatasetVersionLineage(value.lineage),
    documentation: normalizeDatasetVersionDocumentation(value.documentation),
    totalRows: normalizeCount(value.totalRows, "Dataset version total rows"),
    createdAt: normalizeTimestamp(value.createdAt, "Dataset version created at"),
    createdBy: normalizeText(value.createdBy, "Dataset version creator", 256),
  };
}

export function normalizeDatasetVersionPublicationRecord(
  value: DatasetVersionPublicationRecord,
): DatasetVersionPublicationRecord {
  if (value.schemaVersion !== "1.0") {
    throw new Error("Dataset publication schema version is unsupported.");
  }
  if (value.provider !== "hugging-face") {
    throw new Error("Dataset publication provider is unsupported.");
  }
  if (!PUBLICATION_VISIBILITIES.includes(value.visibility)) {
    throw new Error("Dataset publication visibility is unsupported.");
  }
  return {
    schemaVersion: "1.0",
    publicationId: normalizeDatasetVersionPublicationId(value.publicationId),
    versionId: normalizeDatasetVersionId(value.versionId),
    ...(value.organizationId
      ? { organizationId: createOrganizationId(value.organizationId) }
      : {}),
    workspaceId: createWorkspaceId(value.workspaceId),
    provider: "hugging-face",
    repositoryId: normalizeRepositoryId(value.repositoryId),
    revision: normalizeText(value.revision, "Dataset publication revision", 256),
    visibility: value.visibility,
    publishedAt: normalizeTimestamp(value.publishedAt, "Dataset publication time"),
    publishedBy: normalizeText(value.publishedBy, "Dataset publisher", 256),
  };
}

function normalizeDatasetVersionArtifact(
  value: DatasetVersionArtifact,
): DatasetVersionArtifact {
  if (!ARTIFACT_ROLES.includes(value.role)) {
    throw new Error("Dataset version artifact role is unsupported.");
  }
  return {
    role: value.role,
    artifactKey: normalizeStorageArtifactKey(value.artifactKey),
    digest: normalizeDatasetVersionDigest(value.digest),
    mediaType: normalizeMediaType(value.mediaType),
    sizeBytes: normalizeCount(value.sizeBytes, "Dataset version artifact size"),
    ...(value.rowCount === undefined
      ? {}
      : { rowCount: normalizeCount(value.rowCount, "Dataset version artifact rows") }),
  };
}

function normalizeDatasetVersionLineage(
  value: DatasetVersionLineage,
): DatasetVersionLineage {
  const sources = normalizeBoundedList(
    value.sources,
    "Dataset version sources",
    (source) => ({
      ...(source.sourceArtifactId
        ? {
            sourceArtifactId: normalizeText(
              source.sourceArtifactId,
              "Dataset source artifact id",
              512,
            ),
          }
        : {}),
      artifactKey: normalizeStorageArtifactKey(source.artifactKey),
      digest: normalizeDatasetVersionDigest(source.digest),
      mediaType: normalizeMediaType(source.mediaType),
    }),
  );
  if (sources.length === 0) {
    throw new Error("Dataset version lineage must include at least one source.");
  }
  assertUnique(
    sources.map((source) => `${source.artifactKey}:${source.digest}`),
    "Dataset version sources",
  );
  return {
    sources,
    recipe: {
      artifactKey: normalizeStorageArtifactKey(value.recipe.artifactKey),
      digest: normalizeDatasetVersionDigest(value.recipe.digest),
      implementationId: normalizeText(
        value.recipe.implementationId,
        "Dataset recipe implementation id",
        256,
      ),
      implementationVersion: normalizeText(
        value.recipe.implementationVersion,
        "Dataset recipe implementation version",
        128,
      ),
    },
    ...(value.split
      ? {
          split: {
            strategy: normalizeText(value.split.strategy, "Dataset split strategy", 128),
            seed: normalizeInteger(value.split.seed, "Dataset split seed"),
            ...(value.split.groupField
              ? {
                  groupField: normalizeText(
                    value.split.groupField,
                    "Dataset split group field",
                    256,
                  ),
                }
              : {}),
          },
        }
      : {}),
    quality: {
      policyId: normalizeText(value.quality.policyId, "Dataset quality policy id", 256),
      policyVersion: normalizeText(
        value.quality.policyVersion,
        "Dataset quality policy version",
        128,
      ),
      policyFingerprint: normalizeDatasetVersionDigest(
        value.quality.policyFingerprint,
      ),
      reportFingerprint: normalizeDatasetVersionDigest(
        value.quality.reportFingerprint,
      ),
    },
    ...(value.parentVersionId
      ? { parentVersionId: normalizeDatasetVersionId(value.parentVersionId) }
      : {}),
  };
}

function normalizeDatasetVersionDocumentation(
  value: DatasetVersionDocumentation,
): DatasetVersionDocumentation {
  return {
    name: normalizeText(value.name, "Dataset name", 256),
    summary: normalizeText(value.summary, "Dataset summary", MAX_TEXT_LENGTH),
    intendedUses: normalizeTextList(value.intendedUses, "Dataset intended uses"),
    limitations: normalizeTextList(value.limitations, "Dataset limitations"),
    ...(value.license
      ? { license: normalizeText(value.license, "Dataset license", 256) }
      : {}),
    ...(value.languages
      ? { languages: normalizeTextList(value.languages, "Dataset languages", 64) }
      : {}),
    ...(value.citation
      ? { citation: normalizeText(value.citation, "Dataset citation", MAX_TEXT_LENGTH) }
      : {}),
  };
}

function normalizeTextList(
  values: readonly string[],
  label: string,
  itemLength = 1_000,
): readonly string[] {
  return normalizeBoundedList(values, label, (value) =>
    normalizeText(value, label, itemLength),
  );
}

function normalizeBoundedList<T, R>(
  values: readonly T[],
  label: string,
  normalize: (value: T) => R,
): readonly R[] {
  if (!Array.isArray(values) || values.length > MAX_LIST_ITEMS) {
    throw new Error(`${label} must contain at most ${MAX_LIST_ITEMS} items.`);
  }
  return values.map(normalize);
}

function normalizeText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must contain between 1 and ${maximum} safe characters.`);
  }
  return normalized;
}

function normalizeMediaType(value: string): string {
  const normalized = normalizeText(value, "Dataset artifact media type", 256).toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;[ -~]+)?$/.test(normalized)) {
    throw new Error("Dataset artifact media type is invalid.");
  }
  return normalized;
}

function normalizeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}

function normalizeTimestamp(value: string, label: string): string {
  const normalized = normalizeText(value, label, 64);
  const date = new Date(normalized);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== normalized) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return normalized;
}

function normalizeRepositoryId(value: string): string {
  const normalized = normalizeText(value, "Dataset repository id", 256);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(normalized) || normalized.includes("..")) {
    throw new Error("Dataset repository id must use the namespace/name format.");
  }
  return normalized;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

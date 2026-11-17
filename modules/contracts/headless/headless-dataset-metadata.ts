import { normalizeDatasetId, normalizeDatasetVersionId, normalizeDatasetVersionDigest,
  type DatasetId, type DatasetVersionId, type DatasetVersionComparison, type DatasetVersionRecord } from "../dataset";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import type { HEADLESS_CONTRACT_VERSION, HeadlessHostIncarnationId } from "./headless-read-request";

export const HEADLESS_DATASET_VERSION_READ_LIMIT = 16;
type Target = {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId};
export type HeadlessDatasetVersionsRequest = {readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.dataset-versions"; readonly input: Target & {
    readonly datasetId: DatasetId; readonly versionIds: readonly DatasetVersionId[];
  }};
export type HeadlessDatasetComparisonRequest = {readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.compare-dataset-versions"; readonly input: Target & {
    readonly fromVersionId: DatasetVersionId; readonly toVersionId: DatasetVersionId;
  }};
export type HeadlessDatasetMetadataRequest = HeadlessDatasetVersionsRequest | HeadlessDatasetComparisonRequest;
export interface HeadlessDatasetVersionSummary {
  readonly versionId: DatasetVersionId;
  readonly versionDigest: DatasetVersionRecord["versionDigest"];
  readonly createdAt: string;
  readonly totalRows: number;
  readonly sourceCount: number;
  readonly artifactCount: number;
  readonly parentVersionId: DatasetVersionId | null;
  readonly splitSeed: number | null;
  readonly recipeDigest: DatasetVersionRecord["versionDigest"];
  readonly quality: Pick<DatasetVersionRecord["lineage"]["quality"], "policyFingerprint" | "reportFingerprint">;
  readonly splits: readonly {readonly role: "train" | "validation" | "test"; readonly rowCount: number | null}[];
}
export interface HeadlessDatasetVersionBatch {
  readonly workspaceId: WorkspaceId;
  readonly datasetId: DatasetId;
  readonly versions: readonly HeadlessDatasetVersionSummary[];
}

const roles = ["dataset", "train", "validation", "test", "report", "quarantine", "recipe", "dataset-card", "croissant"] as const;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function id<T extends string>(value: unknown, normalize: (value: string) => T): T {
  if (typeof value !== "string" || hasKnownPassiveCredential(value) || normalize(value) !== value) throw new Error("Invalid dataset reference.");
  return normalize(value);
}
function digest(value: unknown): DatasetVersionRecord["versionDigest"] {
  if (typeof value !== "string" || normalizeDatasetVersionDigest(value) !== value) throw new Error("Invalid dataset digest.");
  return normalizeDatasetVersionDigest(value);
}

/** Only call after the owning use case verifies the record's organization and workspace. */
export function projectHeadlessDatasetVersion(record: DatasetVersionRecord): HeadlessDatasetVersionSummary {
  const splits = (["train", "validation", "test"] as const).map(role => {
    const artifacts = record.artifacts.filter(item => item.role === role);
    const rowCount = artifacts.length && artifacts.every(item => item.rowCount !== undefined)
      ? artifacts.reduce((sum, item) => sum + item.rowCount!, 0) : null;
    return {role, rowCount};
  });
  return {versionId: record.versionId, versionDigest: record.versionDigest, createdAt: record.createdAt,
    totalRows: record.totalRows, sourceCount: record.lineage.sources.length, artifactCount: record.artifacts.length,
    parentVersionId: record.lineage.parentVersionId ?? null, splitSeed: record.lineage.split?.seed ?? null,
    recipeDigest: record.lineage.recipe.digest,
    quality: {policyFingerprint: record.lineage.quality.policyFingerprint, reportFingerprint: record.lineage.quality.reportFingerprint}, splits};
}

export function readHeadlessDatasetVersionBatch(value: unknown, target: HeadlessDatasetVersionsRequest["input"]): HeadlessDatasetVersionBatch | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "datasetId", "versions"]);
    if (!isWorkspaceId(raw.workspaceId) || raw.workspaceId !== target.workspaceId ||
        id(raw.datasetId, normalizeDatasetId) !== target.datasetId || !Array.isArray(raw.versions) ||
        target.versionIds.length < 1 || target.versionIds.length > HEADLESS_DATASET_VERSION_READ_LIMIT ||
        new Set(target.versionIds).size !== target.versionIds.length || raw.versions.length !== target.versionIds.length) return;
    const versions: HeadlessDatasetVersionSummary[] = raw.versions.map(entry => {
      const item = readStrictPassiveRecord(entry, ["versionId", "versionDigest", "createdAt", "totalRows", "sourceCount", "artifactCount",
        "parentVersionId", "splitSeed", "recipeDigest", "quality", "splits"]);
      const versionId = id(item.versionId, normalizeDatasetVersionId);
      if (typeof item.createdAt !== "string" || new Date(item.createdAt).toISOString() !== item.createdAt ||
          !count(item.totalRows) || !count(item.sourceCount) || item.sourceCount > 100 ||
          !count(item.artifactCount) || item.artifactCount < 1 || item.artifactCount > 100 ||
          (item.splitSeed !== null && (typeof item.splitSeed !== "number" || !Number.isSafeInteger(item.splitSeed))) ||
          !Array.isArray(item.splits) || item.splits.length !== 3) throw new Error("Invalid dataset summary.");
      const quality = readStrictPassiveRecord(item.quality, ["policyFingerprint", "reportFingerprint"]);
      const totalRows = item.totalRows;
      const splits = item.splits.map((entry, index) => {
        const split = readStrictPassiveRecord(entry, ["role", "rowCount"]);
        const role = (["train", "validation", "test"] as const)[index];
        if (split.role !== role || (split.rowCount !== null && (!count(split.rowCount) || split.rowCount > totalRows)))
          throw new Error("Invalid dataset split.");
        return {role, rowCount: split.rowCount as number | null};
      });
      if (splits.reduce((sum, split) => sum + (split.rowCount ?? 0), 0) > totalRows)
        throw new Error("Invalid dataset split total.");
      return {versionId, versionDigest: digest(item.versionDigest), createdAt: item.createdAt, totalRows: item.totalRows,
        sourceCount: item.sourceCount, artifactCount: item.artifactCount,
        parentVersionId: item.parentVersionId === null ? null : id(item.parentVersionId, normalizeDatasetVersionId),
        splitSeed: item.splitSeed as number | null, recipeDigest: digest(item.recipeDigest),
        quality: {policyFingerprint: digest(quality.policyFingerprint), reportFingerprint: digest(quality.reportFingerprint)}, splits};
    });
    if (versions.some((item, index) => item.versionId !== target.versionIds[index])) return;
    return {workspaceId: target.workspaceId, datasetId: target.datasetId, versions};
  } catch { return undefined; }
}

export function readHeadlessDatasetComparison(value: unknown, target: HeadlessDatasetComparisonRequest["input"]): DatasetVersionComparison | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["fromVersionId", "toVersionId", "identical", "rowDelta", "sources",
      "changedArtifactRoles", "recipeChanged", "qualityPolicyChanged", "documentationChanged"]);
    if (id(raw.fromVersionId, normalizeDatasetVersionId) !== target.fromVersionId || id(raw.toVersionId, normalizeDatasetVersionId) !== target.toVersionId ||
        typeof raw.identical !== "boolean" || typeof raw.rowDelta !== "number" || !Number.isSafeInteger(raw.rowDelta) ||
        typeof raw.recipeChanged !== "boolean" || typeof raw.qualityPolicyChanged !== "boolean" || typeof raw.documentationChanged !== "boolean" ||
        !Array.isArray(raw.changedArtifactRoles) || raw.changedArtifactRoles.length > roles.length ||
        new Set(raw.changedArtifactRoles).size !== raw.changedArtifactRoles.length ||
        raw.changedArtifactRoles.some(role => !roles.some(allowed => allowed === role))) return;
    const sources = readStrictPassiveRecord(raw.sources, ["added", "removed", "changed"]);
    if (!count(sources.added) || !count(sources.removed) || !count(sources.changed) ||
        sources.added > 100 || sources.removed > 100 || sources.changed > 100 ||
        sources.added + sources.changed > 100 || sources.removed + sources.changed > 100) return;
    if (target.fromVersionId === target.toVersionId && (!raw.identical || raw.rowDelta !== 0 ||
        sources.added !== 0 || sources.removed !== 0 || sources.changed !== 0 || raw.changedArtifactRoles.length ||
        raw.recipeChanged || raw.qualityPolicyChanged || raw.documentationChanged)) return;
    return {fromVersionId: target.fromVersionId, toVersionId: target.toVersionId, identical: raw.identical, rowDelta: raw.rowDelta,
      sources: {added: sources.added, removed: sources.removed, changed: sources.changed}, changedArtifactRoles: raw.changedArtifactRoles as string[],
      recipeChanged: raw.recipeChanged, qualityPolicyChanged: raw.qualityPolicyChanged, documentationChanged: raw.documentationChanged};
  } catch { return undefined; }
}

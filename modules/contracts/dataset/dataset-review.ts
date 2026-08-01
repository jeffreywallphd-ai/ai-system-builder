import type { StorageArtifactKey } from "../storage";
import type { DatasetId, DatasetVersionId } from "./dataset-version-id";
import type { DatasetVersionRecord } from "./dataset-version";

export const DATASET_REVIEW_PAGE_SIZES = [10, 25, 50] as const;
export type DatasetReviewPageSize = (typeof DATASET_REVIEW_PAGE_SIZES)[number];

export interface DatasetReviewVersionOption {
  readonly versionId?: DatasetVersionId;
  readonly label: string;
  readonly artifactKey: StorageArtifactKey;
  readonly createdAt?: string;
  readonly totalRows?: number;
  readonly latest: boolean;
}

export interface DatasetReviewDatasetGroup {
  readonly groupId: string;
  readonly datasetId?: DatasetId;
  readonly name: string;
  readonly versions: readonly DatasetReviewVersionOption[];
}

export interface DatasetReviewRow {
  readonly rowIndex: number;
  readonly rowFingerprint: `sha256:${string}`;
  readonly values: Readonly<Record<string, unknown>>;
  readonly editable?: boolean;
}

export interface DatasetReviewPage {
  readonly artifactKey: StorageArtifactKey;
  readonly versionId?: DatasetVersionId;
  readonly page: number;
  readonly pageSize: DatasetReviewPageSize;
  readonly totalRows: number;
  readonly rows: readonly DatasetReviewRow[];
}

export interface DatasetReviewRowRejectionResult {
  readonly version: DatasetVersionRecord;
  readonly versionLabel: string;
  readonly rejectedRowIndex: number;
}

export interface DatasetReviewRowEditResult {
  readonly version: DatasetVersionRecord;
  readonly versionLabel: string;
  readonly editedRowIndex: number;
}

export interface DatasetVersionDisplayEntry {
  readonly version: DatasetVersionRecord;
  readonly label: string;
  readonly latest: boolean;
}

export interface DatasetVersionDisplayGroup {
  readonly datasetId: DatasetId;
  readonly name: string;
  readonly versions: readonly DatasetVersionDisplayEntry[];
}

export function groupDatasetVersionsForDisplay(
  versions: readonly DatasetVersionRecord[],
): readonly DatasetVersionDisplayGroup[] {
  const byDataset = new Map<string, DatasetVersionRecord[]>();
  for (const version of versions) {
    const key = String(version.datasetId);
    const group = byDataset.get(key) ?? [];
    group.push(version);
    byDataset.set(key, group);
  }
  return [...byDataset.entries()]
    .map(([datasetId, group]) => {
      const labels = labelDatasetVersionGroup(group);
      const newest = [...group].sort(compareNewestFirst)[0];
      return {
        datasetId: datasetId as DatasetId,
        name: newest?.documentation.name ?? datasetId,
        versions: [...group].sort(compareNewestFirst).map((version) => ({
          version,
          label: labels.get(String(version.versionId)) ?? "1.0",
          latest: version.versionId === newest?.versionId,
        })),
      };
    })
    .sort((left, right) => {
      const leftDate = left.versions[0]?.version.createdAt ?? "";
      const rightDate = right.versions[0]?.version.createdAt ?? "";
      return (
        rightDate.localeCompare(leftDate) || left.name.localeCompare(right.name)
      );
    });
}

export function labelDatasetVersionGroup(
  versions: readonly DatasetVersionRecord[],
): ReadonlyMap<string, string> {
  const byId = new Map(
    versions.map((version) => [String(version.versionId), version]),
  );
  const roots = versions
    .filter((version) => {
      const parent = version.lineage.parentVersionId;
      return !parent || !byId.has(String(parent));
    })
    .sort(compareOldestFirst);
  const rootFor = (version: DatasetVersionRecord): DatasetVersionRecord => {
    let current = version;
    const seen = new Set<string>();
    while (current.lineage.parentVersionId) {
      const currentId = String(current.versionId);
      if (seen.has(currentId)) break;
      seen.add(currentId);
      const parent = byId.get(String(current.lineage.parentVersionId));
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const result = new Map<string, string>();
  roots.forEach((root, rootIndex) => {
    const family = versions
      .filter((version) => rootFor(version).versionId === root.versionId)
      .sort((left, right) => {
        if (left.versionId === root.versionId) return -1;
        if (right.versionId === root.versionId) return 1;
        return compareOldestFirst(left, right);
      });
    family.forEach((version, familyIndex) => {
      result.set(String(version.versionId), `${rootIndex + 1}.${familyIndex}`);
    });
  });
  return result;
}

function compareOldestFirst(
  left: DatasetVersionRecord,
  right: DatasetVersionRecord,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    String(left.versionId).localeCompare(String(right.versionId))
  );
}

function compareNewestFirst(
  left: DatasetVersionRecord,
  right: DatasetVersionRecord,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    String(right.versionId).localeCompare(String(left.versionId))
  );
}

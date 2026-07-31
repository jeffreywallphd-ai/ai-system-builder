import type {
  EffectiveAssetProjectionRepositoryPort,
  EffectiveAssetProjectionSnapshotRepositoryPort,
} from "../../../application/ports/effective-asset-projections";
import {
  normalizeEffectiveAssetProjectionId,
  normalizeEffectiveAssetProjectionRecord,
  normalizeEffectiveAssetProjectionSnapshotRecord,
  type EffectiveAssetProjectionRecord,
  type EffectiveAssetProjectionSnapshotRecord,
} from "../../../contracts/effective-asset-projections";
import {
  pageRecords,
  textValuesMatch,
} from "../user-library/local-user-library-repository-helpers";
import {
  LocalEffectiveAssetProjectionRecordStore,
  type LocalEffectiveAssetProjectionRecordStoreOptions,
} from "./local-effective-asset-projection-record-store";
const sort = (
  a: { updatedAt: string; projectionId: string },
  b: { updatedAt: string; projectionId: string },
) =>
  b.updatedAt.localeCompare(a.updatedAt) ||
  a.projectionId.localeCompare(b.projectionId);
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
export function createLocalEffectiveAssetProjectionRepositoryAdapter(
  o: LocalEffectiveAssetProjectionRecordStoreOptions,
): EffectiveAssetProjectionRepositoryPort {
  const s = new LocalEffectiveAssetProjectionRecordStore(o);
  return {
    async saveEffectiveAssetProjectionRecord(r) {
      const x = normalizeEffectiveAssetProjectionRecord(r);
      await s.mutateCollection<EffectiveAssetProjectionRecord, void>(
        "projections",
        (current) => ({
          records: [
            ...current
              .map(normalizeEffectiveAssetProjectionRecord)
              .filter(
                (v) =>
                  !(
                    v.projectionId === x.projectionId &&
                    v.targetWorkspaceId === x.targetWorkspaceId
                  ),
              ),
            x,
          ].sort(sort),
          result: undefined,
        }),
      );
      return x;
    },
    async updateEffectiveAssetProjectionRecord(r) {
      return this.saveEffectiveAssetProjectionRecord(r);
    },
    async readEffectiveAssetProjectionRecord(ws, id) {
      return (
        await s.readCollection<EffectiveAssetProjectionRecord>("projections")
      )
        .map(normalizeEffectiveAssetProjectionRecord)
        .find((x) => x.targetWorkspaceId === ws && x.projectionId === id);
    },
    async readEffectiveAssetProjectionRecordByEffectiveAssetReference(ws, ref) {
      return (
        await s.readCollection<EffectiveAssetProjectionRecord>("projections")
      )
        .map(normalizeEffectiveAssetProjectionRecord)
        .find(
          (x) =>
            x.targetWorkspaceId === ws &&
            x.effectiveAssetReference.kind === ref.kind &&
            x.effectiveAssetReference.id === ref.id &&
            x.effectiveAssetReference.version === ref.version,
        );
    },
    async listEffectiveAssetProjectionRecords(q) {
      const f = (
        await s.readCollection<EffectiveAssetProjectionRecord>("projections")
      )
        .map(normalizeEffectiveAssetProjectionRecord)
        .filter(
          (x) =>
            x.targetWorkspaceId === q.targetWorkspaceId &&
            (!q.status || x.status === q.status) &&
            (!q.sourceKind || x.sourceKind === q.sourceKind) &&
            (!q.policy || x.policy === q.policy) &&
            (!q.hasBlockers || x.blockers.length > 0) &&
            (!q.staleOnly ||
              x.status === "stale" ||
              Boolean(x.invalidatedAt)) &&
            (!q.sourceAssetReference ||
              (x.sourceAssetReference?.id === q.sourceAssetReference.id &&
                x.sourceAssetReference?.version ===
                  q.sourceAssetReference.version)) &&
            (!q.effectiveAssetReference ||
              (x.effectiveAssetReference.id === q.effectiveAssetReference.id &&
                x.effectiveAssetReference.version ===
                  q.effectiveAssetReference.version)) &&
            textValuesMatch(
              [
                x.effectiveAssetReference.label,
                text(x.projectedFields["display-name"]),
                text(x.projectedFields.summary),
              ],
              q.text,
            ),
        );
      const p = pageRecords(f.sort(sort), q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
    async listBlockedConflictedOrStaleEffectiveAssetProjectionRecords(ws) {
      return (
        await this.listEffectiveAssetProjectionRecords({
          targetWorkspaceId: ws,
        })
      ).records.filter(
        (x) =>
          x.blockers.length > 0 ||
          x.status === "conflicted" ||
          x.status === "stale" ||
          Boolean(x.invalidatedAt),
      );
    },
  };
}
export function createLocalEffectiveAssetProjectionSnapshotRepositoryAdapter(
  o: LocalEffectiveAssetProjectionRecordStoreOptions,
): EffectiveAssetProjectionSnapshotRepositoryPort {
  const s = new LocalEffectiveAssetProjectionRecordStore(o);
  return {
    async saveEffectiveAssetProjectionSnapshotRecord(r) {
      const x = normalizeEffectiveAssetProjectionSnapshotRecord(r);
      await s.mutateCollection<EffectiveAssetProjectionSnapshotRecord, void>(
        "snapshots",
        (current) => ({
          records: [
            ...current
              .map(normalizeEffectiveAssetProjectionSnapshotRecord)
              .filter(
                (v) =>
                  !(
                    v.projectionSnapshotId === x.projectionSnapshotId &&
                    v.targetWorkspaceId === x.targetWorkspaceId
                  ),
              ),
            x,
          ].sort(sort),
          result: undefined,
        }),
      );
      return x;
    },
    async readEffectiveAssetProjectionSnapshotRecord(ws, id) {
      return (
        await s.readCollection<EffectiveAssetProjectionSnapshotRecord>(
          "snapshots",
        )
      )
        .map(normalizeEffectiveAssetProjectionSnapshotRecord)
        .find(
          (x) => x.targetWorkspaceId === ws && x.projectionSnapshotId === id,
        );
    },
    async listEffectiveAssetProjectionSnapshotRecords(q) {
      const projectionId = q.projectionId
        ? normalizeEffectiveAssetProjectionId(q.projectionId)
        : undefined;
      const f = (
        await s.readCollection<EffectiveAssetProjectionSnapshotRecord>(
          "snapshots",
        )
      )
        .map(normalizeEffectiveAssetProjectionSnapshotRecord)
        .filter(
          (x) =>
            x.targetWorkspaceId === q.targetWorkspaceId &&
            (!projectionId || x.projectionId === projectionId),
        )
        .sort(sort);
      const p = pageRecords(f, q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
    async findLatestEffectiveAssetProjectionSnapshotRecord(ws, pid) {
      return (
        await this.listEffectiveAssetProjectionSnapshotRecords({
          targetWorkspaceId: ws,
          projectionId: pid,
          limit: 1,
        })
      ).records[0];
    },
  };
}

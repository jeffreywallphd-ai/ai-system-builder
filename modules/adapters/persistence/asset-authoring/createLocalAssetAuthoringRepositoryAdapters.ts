import type {
  AssetDraftRepositoryPort,
  AssetOverrideRepositoryPort,
  AssetRevisionRepositoryPort,
  AuthoredAssetRepositoryPort,
} from "../../../application/ports/asset-authoring";
import {
  normalizeAssetOverrideRecord,
  normalizeAuthoredAssetDraftRecord,
  normalizeAuthoredAssetRecord,
  normalizeAuthoredAssetRevisionRecord,
  type AssetOverrideRecord,
  type AuthoredAssetDraftRecord,
  type AuthoredAssetRecord,
  type AuthoredAssetRevisionRecord,
} from "../../../contracts/asset-authoring";
import {
  LocalAssetAuthoringRecordStore,
  type LocalAssetAuthoringRecordStoreOptions,
} from "./local-asset-authoring-record-store";
import { pageRecords } from "../user-library/local-user-library-repository-helpers";
const sort = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);
export function createLocalAuthoredAssetRepositoryAdapter(
  o: LocalAssetAuthoringRecordStoreOptions,
): AuthoredAssetRepositoryPort {
  const s = new LocalAssetAuthoringRecordStore(o);
  return {
    async saveAuthoredAssetRecord(r) {
      const x = normalizeAuthoredAssetRecord(r);
      await s.mutateCollection<AuthoredAssetRecord, void>("authoredAssets", (records) => ({
        records: [...records.filter((v) => v.authoredAssetId !== x.authoredAssetId), x].sort(sort),
        result: undefined,
      }));
      return x;
    },
    async updateAuthoredAssetRecord(r) {
      return this.saveAuthoredAssetRecord(r);
    },
    async readAuthoredAssetRecordById(id) {
      return (await s.readCollection<AuthoredAssetRecord>("authoredAssets"))
        .map(normalizeAuthoredAssetRecord)
        .find((x) => x.authoredAssetId === id);
    },
    async readAuthoredAssetRecordByWorkspace(ws, id) {
      return (await s.readCollection<AuthoredAssetRecord>("authoredAssets"))
        .map(normalizeAuthoredAssetRecord)
        .find((x) => x.workspaceId === ws && x.authoredAssetId === id);
    },
    async listAuthoredAssetRecords(q) {
      const f = (await s.readCollection<AuthoredAssetRecord>("authoredAssets"))
        .map(normalizeAuthoredAssetRecord)
        .filter(
          (x) =>
            x.workspaceId === q.workspaceId &&
            (!q.status || x.status === q.status),
        );
      const p = pageRecords(f.sort(sort), q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
    async findAuthoredAssetByBaseReference(ws, base) {
      return (await s.readCollection<AuthoredAssetRecord>("authoredAssets"))
        .map(normalizeAuthoredAssetRecord)
        .find(
          (x) =>
            x.workspaceId === ws &&
            x.assetReference.id === base.id &&
            x.assetReference.version === base.version,
        );
    },
  };
}
export function createLocalAssetDraftRepositoryAdapter(
  o: LocalAssetAuthoringRecordStoreOptions,
): AssetDraftRepositoryPort {
  const s = new LocalAssetAuthoringRecordStore(o);
  return {
    async saveAssetDraftRecord(r) {
      const x = normalizeAuthoredAssetDraftRecord(r);
      await s.mutateCollection<AuthoredAssetDraftRecord, void>("drafts", (records) => ({
        records: [...records.filter((v) => v.draftId !== x.draftId), x].sort(sort),
        result: undefined,
      }));
      return x;
    },
    async updateAssetDraftRecord(r) {
      return this.saveAssetDraftRecord(r);
    },
    async readAssetDraftRecord(ws, id) {
      return (await s.readCollection<AuthoredAssetDraftRecord>("drafts"))
        .map(normalizeAuthoredAssetDraftRecord)
        .find((x) => x.targetWorkspaceId === ws && x.draftId === id);
    },
    async listAssetDraftRecords(q) {
      const f = (await s.readCollection<AuthoredAssetDraftRecord>("drafts"))
        .map(normalizeAuthoredAssetDraftRecord)
        .filter(
          (x) =>
            x.targetWorkspaceId === q.workspaceId &&
            (!q.status || x.status === q.status),
        );
      const p = pageRecords(f.sort(sort), q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
  };
}
export function createLocalAssetRevisionRepositoryAdapter(
  o: LocalAssetAuthoringRecordStoreOptions,
): AssetRevisionRepositoryPort {
  const s = new LocalAssetAuthoringRecordStore(o);
  return {
    async saveAssetRevisionRecord(r) {
      const x = normalizeAuthoredAssetRevisionRecord(r);
      await s.mutateCollection<AuthoredAssetRevisionRecord, void>("revisions", (records) => ({
        records: [...records.filter(
          (v) =>
            !(
              v.authoredAssetId === x.authoredAssetId &&
              v.revisionId === x.revisionId
            ),
        ), x].sort(sort),
        result: undefined,
      }));
      return x;
    },
    async readAssetRevisionRecord(ws, aid, rid) {
      return (await s.readCollection<AuthoredAssetRevisionRecord>("revisions"))
        .map(normalizeAuthoredAssetRevisionRecord)
        .find(
          (x) =>
            x.workspaceId === ws &&
            x.authoredAssetId === aid &&
            x.revisionId === rid,
        );
    },
    async listAssetRevisionRecords(q) {
      const f = (
        await s.readCollection<AuthoredAssetRevisionRecord>("revisions")
      )
        .map(normalizeAuthoredAssetRevisionRecord)
        .filter(
          (x) =>
            x.workspaceId === q.workspaceId &&
            x.authoredAssetId === q.authoredAssetId &&
            (!q.status || x.status === q.status),
        );
      const p = pageRecords(f.sort(sort), q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
    async findLatestPublishedAssetRevision(ws, aid) {
      return (await s.readCollection<AuthoredAssetRevisionRecord>("revisions"))
        .map(normalizeAuthoredAssetRevisionRecord)
        .filter(
          (x) =>
            x.workspaceId === ws &&
            x.authoredAssetId === aid &&
            x.status === "published",
        )
        .sort(sort)[0];
    },
  };
}
export function createLocalAssetOverrideRepositoryAdapter(
  o: LocalAssetAuthoringRecordStoreOptions,
): AssetOverrideRepositoryPort {
  const s = new LocalAssetAuthoringRecordStore(o);
  return {
    async saveAssetOverrideRecord(r) {
      const x = normalizeAssetOverrideRecord(r);
      await s.mutateCollection<AssetOverrideRecord, void>("overrides", (records) => ({
        records: [...records.filter((v) => v.overrideId !== x.overrideId), x].sort(sort),
        result: undefined,
      }));
      return x;
    },
    async updateAssetOverrideRecord(r) {
      return this.saveAssetOverrideRecord(r);
    },
    async readAssetOverrideRecord(ws, id) {
      return (await s.readCollection<AssetOverrideRecord>("overrides"))
        .map(normalizeAssetOverrideRecord)
        .find((x) => x.targetWorkspaceId === ws && x.overrideId === id);
    },
    async listAssetOverrideRecords(q) {
      const f = (await s.readCollection<AssetOverrideRecord>("overrides"))
        .map(normalizeAssetOverrideRecord)
        .filter(
          (x) =>
            x.targetWorkspaceId === q.targetWorkspaceId &&
            (!q.status || x.status === q.status) &&
            (!q.conflictStatus || x.conflictStatus === q.conflictStatus),
        );
      const p = pageRecords(f.sort(sort), q.limit, q.cursor);
      return { records: p.records, nextCursor: p.nextCursor };
    },
    async findActiveOverrideForTarget(ws, ref) {
      return (await s.readCollection<AssetOverrideRecord>("overrides"))
        .map(normalizeAssetOverrideRecord)
        .find(
          (x) =>
            x.targetWorkspaceId === ws &&
            x.status === "active" &&
            x.customizationTarget.effectiveAssetReference.id === ref.id &&
            x.customizationTarget.effectiveAssetReference.version ===
              ref.version,
        );
    },
    async listConflictedOverridesByWorkspace(ws) {
      return (await s.readCollection<AssetOverrideRecord>("overrides"))
        .map(normalizeAssetOverrideRecord)
        .filter(
          (x) =>
            x.targetWorkspaceId === ws &&
            (x.conflictStatus === "open" || x.status === "conflicted"),
        )
        .sort(sort);
    },
  };
}

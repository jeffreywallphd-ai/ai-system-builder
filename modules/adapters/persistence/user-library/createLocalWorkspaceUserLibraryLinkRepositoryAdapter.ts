import type { WorkspaceUserLibraryLinkAssetListQuery, WorkspaceUserLibraryLinkFindExistingQuery, WorkspaceUserLibraryLinkListQuery, WorkspaceUserLibraryLinkRepositoryPort } from "../../../application/ports/user-library";
import { createWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { UserLibraryLinkId, WorkspaceUserLibraryLinkRecord } from "../../../contracts/user-library";
import { createUserLibraryLinkId, normalizeWorkspaceUserLibraryLinkRecord } from "../../../contracts/user-library";
import { cloneJson, LocalUserLibraryRecordStore, type LocalUserLibraryRecordStoreOptions } from "./local-user-library-record-store";
import { pageRecords, replaceRecord, textValuesMatch, upsertRecord, userLibraryAssetReferenceEquals } from "./local-user-library-repository-helpers";

export function createLocalWorkspaceUserLibraryLinkRepositoryAdapter(options: LocalUserLibraryRecordStoreOptions): WorkspaceUserLibraryLinkRepositoryPort {
  const store = new LocalUserLibraryRecordStore(options);
  return {
    async saveWorkspaceUserLibraryLinkRecord(record) { const validRecord = normalizeWorkspaceUserLibraryLinkRecord(record); await store.mutateCollection("workspaceLinks", (links) => ({ records: sortLinks(upsertRecord(links, validRecord, linkStorageKey)), result: undefined })); return cloneJson(validRecord); },
    async updateWorkspaceUserLibraryLinkRecord(record) { const validRecord = normalizeWorkspaceUserLibraryLinkRecord(record); await store.mutateCollection("workspaceLinks", (links) => ({ records: sortLinks(replaceRecord(links, validRecord, linkStorageKey, "Workspace user-library link record does not exist.")), result: undefined })); return cloneJson(validRecord); },
    async readWorkspaceUserLibraryLinkRecord(targetWorkspaceId: WorkspaceId, linkId: UserLibraryLinkId) {
      const safeWorkspaceId = createWorkspaceId(targetWorkspaceId); const safeLinkId = createUserLibraryLinkId(linkId);
      const match = (await store.readCollection("workspaceLinks")).map(normalizeWorkspaceUserLibraryLinkRecord).find((l) => l.targetWorkspaceId === safeWorkspaceId && l.linkId === safeLinkId);
      return match ? cloneJson(match) : undefined;
    },
    async listWorkspaceUserLibraryLinkRecords(query: WorkspaceUserLibraryLinkListQuery) {
      const safeWorkspaceId = createWorkspaceId(query.targetWorkspaceId);
      const links = sortLinks((await store.readCollection("workspaceLinks")).map(normalizeWorkspaceUserLibraryLinkRecord).filter((l)=>matchesWorkspaceLink(l,{...query,targetWorkspaceId:safeWorkspaceId})));
      const page = pageRecords(links, query.limit, query.cursor); return { links: page.records, nextCursor: page.nextCursor };
    },
    async listWorkspaceUserLibraryLinkRecordsByAsset(query: WorkspaceUserLibraryLinkAssetListQuery) {
      const safeWorkspaceId = createWorkspaceId(query.targetWorkspaceId);
      const links = sortLinks((await store.readCollection("workspaceLinks")).map(normalizeWorkspaceUserLibraryLinkRecord).filter((l)=>matchesAssetLink(l,{...query,targetWorkspaceId:safeWorkspaceId})));
      const page = pageRecords(links, query.limit, query.cursor); return { links: page.records, nextCursor: page.nextCursor };
    },
    async findWorkspaceUserLibraryLinkRecord(query: WorkspaceUserLibraryLinkFindExistingQuery) {
      const safeWorkspaceId = createWorkspaceId(query.targetWorkspaceId);
      const links = sortLinks((await store.readCollection("workspaceLinks")).map(normalizeWorkspaceUserLibraryLinkRecord).filter((l)=>matchesWorkspaceLink(l,{...query,targetWorkspaceId:safeWorkspaceId})));
      return links[0] ? cloneJson(links[0]) : undefined;
    },
    async archiveWorkspaceUserLibraryLinkRecord(targetWorkspaceId: WorkspaceId, linkId: UserLibraryLinkId, archivedAt: string) {
      const existing = await this.readWorkspaceUserLibraryLinkRecord(targetWorkspaceId, linkId); if (!existing) return undefined;
      return this.updateWorkspaceUserLibraryLinkRecord({ ...existing, status: "archived", updatedAt: archivedAt });
    },
  };
}
function matchesWorkspaceLink(link: WorkspaceUserLibraryLinkRecord, query: WorkspaceUserLibraryLinkListQuery | WorkspaceUserLibraryLinkFindExistingQuery): boolean { if (link.targetWorkspaceId !== query.targetWorkspaceId) return false; const status = "status" in query ? query.status : undefined; const text = "text" in query ? query.text : undefined; if (status && link.status !== status) return false; if (query.propagationPolicy && link.propagationPolicy !== query.propagationPolicy) return false; if (query.userLibraryAssetReference && !userLibraryAssetReferenceEquals(link.userLibraryAssetReference, query.userLibraryAssetReference)) return false; return textValuesMatch([String(link.linkId), String(link.userLibraryAssetReference.assetId), link.userLibraryAssetReference.label, link.displayLabel], text); }
function matchesAssetLink(link: WorkspaceUserLibraryLinkRecord, query: WorkspaceUserLibraryLinkAssetListQuery): boolean { if (link.targetWorkspaceId !== query.targetWorkspaceId) return false; if (query.status && link.status !== query.status) return false; return userLibraryAssetReferenceEquals(link.userLibraryAssetReference, query.userLibraryAssetReference); }
function sortLinks(records: readonly WorkspaceUserLibraryLinkRecord[]): WorkspaceUserLibraryLinkRecord[] { return [...records].sort((a,b)=>String(a.targetWorkspaceId).localeCompare(String(b.targetWorkspaceId)) || b.updatedAt.localeCompare(a.updatedAt) || String(a.linkId).localeCompare(String(b.linkId))); }
function linkStorageKey(record: WorkspaceUserLibraryLinkRecord): string { return `${record.targetWorkspaceId}::${record.linkId}`; }

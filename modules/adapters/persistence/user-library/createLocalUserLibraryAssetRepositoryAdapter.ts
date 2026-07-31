import type { UserLibraryAssetListQuery, UserLibraryAssetRepositoryPort, UserLibraryAssetSourceIdentityQuery } from "../../../application/ports/user-library";
import type { UserLibraryAssetId, UserLibraryAssetRecord, UserLibraryAssetReference, UserLibraryAssetVersion } from "../../../contracts/user-library";
import { createUserLibraryAssetId, createUserLibraryAssetVersion, normalizeUserLibraryAssetRecord } from "../../../contracts/user-library";
import { cloneJson, LocalUserLibraryRecordStore, type LocalUserLibraryRecordStoreOptions } from "./local-user-library-record-store";
import { assetReferenceEquals, pageRecords, replaceRecord, textValuesMatch, upsertRecord } from "./local-user-library-repository-helpers";

export function createLocalUserLibraryAssetRepositoryAdapter(options: LocalUserLibraryRecordStoreOptions): UserLibraryAssetRepositoryPort {
  const store = new LocalUserLibraryRecordStore(options);

  return {
    async saveUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord> {
      const validRecord = normalizeUserLibraryAssetRecord(record);
      await store.mutateCollection("assets", (assets) => ({
        records: sortAssets(upsertRecord(assets, validRecord, assetStorageKey)),
        result: undefined,
      }));
      return cloneJson(validRecord);
    },
    async updateUserLibraryAssetRecord(record: UserLibraryAssetRecord): Promise<UserLibraryAssetRecord> {
      const validRecord = normalizeUserLibraryAssetRecord(record);
      await store.mutateCollection("assets", (assets) => ({
        records: sortAssets(replaceRecord(assets, validRecord, assetStorageKey, "User-library asset record does not exist.")),
        result: undefined,
      }));
      return cloneJson(validRecord);
    },
    async readUserLibraryAssetRecord(reference: UserLibraryAssetReference): Promise<UserLibraryAssetRecord | undefined> {
      return this.readUserLibraryAssetRecordById(reference.assetId, reference.version);
    },
    async readUserLibraryAssetRecordById(assetId: UserLibraryAssetId, version?: UserLibraryAssetVersion): Promise<UserLibraryAssetRecord | undefined> {
      const safeAssetId = createUserLibraryAssetId(assetId);
      const safeVersion = version ? createUserLibraryAssetVersion(version) : undefined;
      const assets = await store.readCollection("assets");
      const candidates = assets.filter((asset) => asset.userLibraryAssetId === safeAssetId).map(normalizeUserLibraryAssetRecord);
      const match = safeVersion ? candidates.find((asset) => asset.version === safeVersion) : sortAssets(candidates)[0];
      return match ? cloneJson(match) : undefined;
    },
    async listUserLibraryAssetRecords(query: UserLibraryAssetListQuery = {}) {
      const assets = sortAssets((await store.readCollection("assets")).map(normalizeUserLibraryAssetRecord).filter((asset) => matchesAsset(asset, query)));
      const page = pageRecords(assets, query.limit, query.cursor);
      return { assets: page.records, nextCursor: page.nextCursor };
    },
    async findUserLibraryAssetRecordBySource(query: UserLibraryAssetSourceIdentityQuery): Promise<UserLibraryAssetRecord | undefined> {
      const assets = sortAssets((await store.readCollection("assets")).map(normalizeUserLibraryAssetRecord).filter((asset) => matchesSourceIdentity(asset, query)));
      return assets[0] ? cloneJson(assets[0]) : undefined;
    },
    async archiveUserLibraryAssetRecord(reference: UserLibraryAssetReference, archivedAt: string): Promise<UserLibraryAssetRecord | undefined> {
      const existing = await this.readUserLibraryAssetRecord(reference);
      if (!existing) return undefined;
      return this.updateUserLibraryAssetRecord({ ...existing, status: "archived", updatedAt: archivedAt });
    },
  };
}

function matchesAsset(asset: UserLibraryAssetRecord, query: UserLibraryAssetListQuery): boolean { /* unchanged */
  if (query.status && asset.status !== query.status) return false;
  if (query.sourceWorkspaceId && asset.sourceWorkspaceId !== query.sourceWorkspaceId) return false;
  if (query.sourceAssetReference && !assetReferenceEquals(asset.sourceAssetReference, query.sourceAssetReference)) return false;
  if (query.sourceKind && asset.provenance.sourceKind !== query.sourceKind) return false;
  return textValuesMatch([String(asset.userLibraryAssetId), String(asset.version), asset.displayName, asset.summary, asset.description, asset.assetReference.label, asset.sourceAssetReference.label], query.text);
}
function matchesSourceIdentity(asset: UserLibraryAssetRecord, query: UserLibraryAssetSourceIdentityQuery): boolean {
  if (query.sourceWorkspaceId && asset.sourceWorkspaceId !== query.sourceWorkspaceId) return false;
  if (!assetReferenceEquals(asset.sourceAssetReference, query.sourceAssetReference)) return false;
  return (asset.sourceAssetVersion ?? "") === (query.sourceAssetVersion ?? "");
}
function sortAssets(records: readonly UserLibraryAssetRecord[]): UserLibraryAssetRecord[] {
  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || assetStorageKey(left).localeCompare(assetStorageKey(right)));
}
function assetStorageKey(record: UserLibraryAssetRecord): string { return `${record.userLibraryAssetId}@${record.version}`; }

import type {
  AssetImplementationBinding,
  AssetImplementationBindingId,
  AssetImplementationBuild,
  AssetImplementationBuildId,
  AssetImplementationDraft,
  AssetImplementationDraftId,
  AssetImplementationRelease,
  AssetImplementationReleaseId,
  AssetImplementationRevocation,
  AssetSourceSnapshot,
  AssetSourceSnapshotId,
} from "../../../contracts/asset-implementation";
import {
  normalizeAssetImplementationBinding,
  normalizeAssetImplementationBuild,
  normalizeAssetImplementationDraft,
  normalizeAssetImplementationRelease,
  normalizeAssetImplementationRevocation,
  normalizeAssetSourceSnapshot,
} from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { AssetImplementationRepositoryPort } from "../../../application/ports/asset-implementation";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const NAMESPACES = {
  drafts: "asset-implementation/drafts",
  snapshots: "asset-implementation/source-snapshots",
  builds: "asset-implementation/builds",
  releases: "asset-implementation/releases",
  bindings: "asset-implementation/bindings",
  revocations: "asset-implementation/revocations",
} as const;

export function createStructuredAssetImplementationRepository(
  documents: StructuredDocumentStore,
): AssetImplementationRepositoryPort {
  return {
    createDraft: (draft) =>
      writeImmutable(
        documents,
        NAMESPACES.drafts,
        String(draft.draftId),
        normalizeAssetImplementationDraft(draft),
      ),
    async readDraft(workspaceId, draftId) {
      return readScoped(
        documents,
        NAMESPACES.drafts,
        String(draftId),
        workspaceId,
        normalizeAssetImplementationDraft,
      );
    },
    updateDraft: (draft, expectedRevision) =>
      updateRevisioned(
        documents,
        NAMESPACES.drafts,
        String(draft.draftId),
        normalizeAssetImplementationDraft(draft),
        expectedRevision,
      ),
    saveSourceSnapshot: (snapshot) =>
      writeImmutable(
        documents,
        NAMESPACES.snapshots,
        String(snapshot.snapshotId),
        normalizeAssetSourceSnapshot(snapshot),
      ),
    async readSourceSnapshot(workspaceId, snapshotId) {
      return readScoped(
        documents,
        NAMESPACES.snapshots,
        String(snapshotId),
        workspaceId,
        normalizeAssetSourceSnapshot,
      );
    },
    saveBuild: (build) =>
      writeImmutable(
        documents,
        NAMESPACES.builds,
        String(build.buildId),
        normalizeAssetImplementationBuild(build),
      ),
    async readBuild(workspaceId, buildId) {
      return readScoped(
        documents,
        NAMESPACES.builds,
        String(buildId),
        workspaceId,
        normalizeAssetImplementationBuild,
      );
    },
    saveRelease: (release) =>
      writeImmutable(
        documents,
        NAMESPACES.releases,
        String(release.releaseId),
        normalizeAssetImplementationRelease(release),
      ),
    async readRelease(releaseId, workspaceId) {
      const document = await documents.readDocument<AssetImplementationRelease>(
        NAMESPACES.releases,
        String(releaseId),
      );
      if (!document) return undefined;
      const release = normalizeAssetImplementationRelease(document.value);
      return !release.workspaceId || release.workspaceId === workspaceId
        ? cloneStructuredJson(release)
        : undefined;
    },
    async listReleases(workspaceId) {
      const records = await documents.listDocuments<AssetImplementationRelease>(
        NAMESPACES.releases,
      );
      return records
        .map((item) => normalizeAssetImplementationRelease(item.value))
        .filter(
          (release) =>
            !release.workspaceId || release.workspaceId === workspaceId,
        )
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .map(cloneStructuredJson);
    },
    createBinding: (binding) =>
      writeImmutable(
        documents,
        NAMESPACES.bindings,
        String(binding.bindingId),
        normalizeAssetImplementationBinding(binding),
      ),
    async readBinding(bindingId, workspaceId) {
      const document = await documents.readDocument<AssetImplementationBinding>(
        NAMESPACES.bindings,
        String(bindingId),
      );
      if (!document) return undefined;
      const binding = normalizeAssetImplementationBinding(document.value);
      return !binding.workspaceId || binding.workspaceId === workspaceId
        ? cloneStructuredJson(binding)
        : undefined;
    },
    updateBinding: (binding, expectedRevision) =>
      updateRevisioned(
        documents,
        NAMESPACES.bindings,
        String(binding.bindingId),
        normalizeAssetImplementationBinding(binding),
        expectedRevision,
      ),
    async listBindings(workspaceId) {
      const records = await documents.listDocuments<AssetImplementationBinding>(
        NAMESPACES.bindings,
      );
      return records
        .map((item) => normalizeAssetImplementationBinding(item.value))
        .filter(
          (binding) =>
            !binding.workspaceId || binding.workspaceId === workspaceId,
        )
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            String(a.bindingId).localeCompare(String(b.bindingId)),
        )
        .map(cloneStructuredJson);
    },
    saveRevocation: (revocation) =>
      writeImmutable(
        documents,
        NAMESPACES.revocations,
        String(revocation.revocationId),
        normalizeAssetImplementationRevocation(revocation),
      ),
    async listRevocations(releaseIds) {
      const filter = releaseIds ? new Set(releaseIds) : undefined;
      const records =
        await documents.listDocuments<AssetImplementationRevocation>(
          NAMESPACES.revocations,
        );
      return records
        .map((item) => normalizeAssetImplementationRevocation(item.value))
        .filter((revocation) => !filter || filter.has(revocation.releaseId))
        .sort((a, b) => b.revokedAt.localeCompare(a.revokedAt))
        .map(cloneStructuredJson);
    },
  };
}

async function readScoped<T extends { workspaceId: WorkspaceId }>(
  documents: StructuredDocumentStore,
  namespace: string,
  key: string,
  workspaceId: WorkspaceId,
  normalize: (value: T) => T,
): Promise<T | undefined> {
  const document = await documents.readDocument<T>(namespace, key);
  if (!document) return undefined;
  const value = normalize(document.value);
  return value.workspaceId === workspaceId
    ? cloneStructuredJson(value)
    : undefined;
}

async function writeImmutable<T>(
  documents: StructuredDocumentStore,
  namespace: string,
  key: string,
  value: T,
): Promise<T> {
  const safe = cloneStructuredJson(value);
  const existing = await documents.readDocument<T>(namespace, key);
  if (existing) {
    if (JSON.stringify(existing.value) === JSON.stringify(safe))
      return cloneStructuredJson(safe);
    throw new StructuredDocumentConflictError(namespace, key, 0);
  }
  await documents.writeDocument(namespace, key, safe, { expectedRevision: 0 });
  return cloneStructuredJson(safe);
}

async function updateRevisioned<T extends { revision: number }>(
  documents: StructuredDocumentStore,
  namespace: string,
  key: string,
  value: T,
  expectedDomainRevision: number,
): Promise<T> {
  return documents.runInTransaction(async (transaction) => {
    const current = await transaction.readDocument<T>(namespace, key);
    if (
      !current ||
      current.value.revision !== expectedDomainRevision ||
      value.revision !== expectedDomainRevision + 1
    ) {
      throw new StructuredDocumentConflictError(
        namespace,
        key,
        expectedDomainRevision,
      );
    }
    await transaction.writeDocument(
      namespace,
      key,
      cloneStructuredJson(value),
      { expectedRevision: current.revision },
    );
    return cloneStructuredJson(value);
  });
}

export type {
  AssetImplementationBindingId,
  AssetImplementationBuildId,
  AssetImplementationDraftId,
  AssetImplementationReleaseId,
  AssetSourceSnapshotId,
};

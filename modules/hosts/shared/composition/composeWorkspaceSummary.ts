import { isArtifactBrowserVisible, isUploadedBrowserArtifact } from "../../../contracts/artifact";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import type { SystemBuilderRepositoryPort } from "../../../application/ports/system-builder";
import type { SystemBuildRepositoryPort } from "../../../application/ports/system-build";
import type { ModelRegistryPort } from "../../../application/ports/model";
import type { ArtifactCatalogReadPort } from "../../../application/ports/artifact-catalog";
import type { AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import { ReadWorkspaceSummaryUseCase } from "../../../application/use-cases/workspace";

export function composeWorkspaceSummary(dependencies: {
  readonly workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly systems?: Pick<SystemBuilderRepositoryPort, "listRecords">;
  readonly builds?: Pick<SystemBuildRepositoryPort, "readReleaseSummary">;
  readonly models?: Pick<ModelRegistryPort, "readModelSummary">;
  readonly artifacts?: ArtifactCatalogReadPort;
  readonly countDatasets?: (workspaceId: WorkspaceId) => Promise<number>;
  readonly assetSources: readonly {readPublishedAssetReferences?: (workspaceId: WorkspaceId) => Promise<readonly AssetReference[]>}[];
}): ReadWorkspaceSummaryUseCase {
  return new ReadWorkspaceSummaryUseCase({
    workspaceRepository: dependencies.workspaceRepository,
    authorization: dependencies.authorization,
    projections: {
      async systems(workspaceId) {
        if (!dependencies.systems || !dependencies.builds?.readReleaseSummary) throw new Error("Summary unavailable.");
        const [records, releases] = await Promise.all([dependencies.systems.listRecords(workspaceId, false), dependencies.builds.readReleaseSummary(workspaceId)]);
        const publishedIds = new Set(releases.publishedSystemIds);
        const active = records.filter(record => record.targetWorkspaceId === workspaceId && record.status !== "archived");
        const published = active.filter(record => publishedIds.has(record.systemId)).length;
        return {systemsComposed: active.length, systemsPublished: published, systemsUnpublished: active.length - published, assetsUsed: releases.assetsUsed};
      },
      async models(workspaceId) {
        if (!dependencies.models?.readModelSummary) throw new Error("Summary unavailable.");
        return dependencies.models.readModelSummary(workspaceId);
      },
      async datasets(workspaceId) {
        if (!dependencies.countDatasets) throw new Error("Summary unavailable.");
        return {datasetsCreated: await dependencies.countDatasets(workspaceId)};
      },
      async assets(workspaceId) {
        if (dependencies.assetSources.length !== 4 || dependencies.assetSources.some(source => !source.readPublishedAssetReferences)) throw new Error("Summary unavailable.");
        const lists = await Promise.all(dependencies.assetSources.map(source => source.readPublishedAssetReferences!(workspaceId)));
        const ids = new Set(lists.flat().map(ref => `${ref.id}@${ref.version ?? "current"}`));
        return {customAssets: ids.size};
      },
      async artifacts(workspaceId) {
        if (!dependencies.artifacts) throw new Error("Summary unavailable.");
        const result = await dependencies.artifacts.browseArtifactCatalogRecords({workspaceId});
        if (!result.ok) throw new Error("Summary unavailable.");
        const records = result.value.records.filter(record => record.workspaceId === workspaceId);
        const visible = records.filter(isArtifactBrowserVisible);
        const uploaded = visible.filter(isUploadedBrowserArtifact).length;
        return {
          artifactsUploaded: uploaded,
          imagesGenerated: records.filter(record => record.artifactFamily === "image" && (record.sourceKind === "generated" || record.storageKey.includes("/generated/images/"))).length,
          ragDatabases: visible.filter(record => record.mediaType === "application/vnd.ai-system-builder.rag-database+lancedb+zip").length,
          markdownContextPacks: visible.filter(record => record.mediaType === "application/vnd.ai-system-builder.markdown-context-pack+zip").length,
        };
      },
    },
  });
}

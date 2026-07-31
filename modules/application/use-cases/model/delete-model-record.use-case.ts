import {
  normalizeDeleteModelRecordRequest,
  type DeleteModelRecordRequest,
  type DeleteModelRecordResult,
} from "../../../contracts/model";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { ArtifactCatalogDeletePort } from "../../ports/artifact-catalog";
import type { ModelRegistryPort } from "../../ports/model";

export class DeleteModelRecordUseCase {
  public constructor(
    private readonly dependencies: { modelRegistry: ModelRegistryPort; artifactCatalogDeletePort?: ArtifactCatalogDeletePort },
  ) {}

  public async execute(request: DeleteModelRecordRequest): Promise<DeleteModelRecordResult> {
    const normalizedRequest = normalizeDeleteModelRecordRequest(request);

    if (!isWorkspaceId(normalizedRequest.workspaceId)) {
      throw new Error("workspaceId must be provided for workspace-scoped model operations.");
    }

    const current = await this.dependencies.modelRegistry.getModelRecord(normalizedRequest.workspaceId, normalizedRequest.modelRecordId);
    const deletedBackingArtifactIds: string[] = [];

    if (normalizedRequest.deleteBackingArtifacts && current?.backingArtifactIds?.length) {
      for (const storageKey of current.backingArtifactIds) {
        if (this.dependencies.artifactCatalogDeletePort) {
          await this.dependencies.artifactCatalogDeletePort.deleteArtifactCatalogRecord({ storageKey });
        }
        deletedBackingArtifactIds.push(storageKey);
      }
    }

    await this.dependencies.modelRegistry.deleteModelRecord(normalizedRequest);

    return {
      deletedModelRecordId: normalizedRequest.modelRecordId,
      deletedRegistryRecord: true,
      deletedLocalFiles: false,
      deletedBackingArtifactIds,
    };
  }
}

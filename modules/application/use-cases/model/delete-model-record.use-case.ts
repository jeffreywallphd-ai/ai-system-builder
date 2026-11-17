import {
  normalizeDeleteModelRecordRequest,
  type DeleteModelRecordRequest,
  type DeleteModelRecordResult,
} from "../../../contracts/model";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { ArtifactCatalogDeletePort } from "../../ports/artifact-catalog";
import {
  ModelLocalFileEffectsUnavailableError,
  type ModelLocalFilesDeletePort,
  type ModelRegistryPort,
} from "../../ports/model";

export class ModelBackingArtifactCleanupUnavailableError extends Error {
  public readonly code = "unavailable";

  public constructor() {
    super("The model record was kept because cleanup of its related artifact records could not be confirmed.");
    this.name = "ModelBackingArtifactCleanupUnavailableError";
  }
}

export class DeleteModelRecordUseCase {
  public constructor(
    private readonly dependencies: {
      modelRegistry: ModelRegistryPort;
      artifactCatalogDeletePort?: ArtifactCatalogDeletePort;
      modelLocalFilesDeletePort?: ModelLocalFilesDeletePort;
    },
  ) {}

  public async execute(request: DeleteModelRecordRequest): Promise<DeleteModelRecordResult> {
    const normalizedRequest = normalizeDeleteModelRecordRequest(request);

    if (!isWorkspaceId(normalizedRequest.workspaceId)) {
      throw new Error("workspaceId must be provided for workspace-scoped model operations.");
    }

    const current = await this.dependencies.modelRegistry.getModelRecord(normalizedRequest.workspaceId, normalizedRequest.modelRecordId);
    const backingArtifactIds = normalizedRequest.deleteBackingArtifacts ? current?.backingArtifactIds ?? [] : [];
    const catalogDelete = this.dependencies.artifactCatalogDeletePort;
    if (backingArtifactIds.length > 0 && !catalogDelete) {
      throw new ModelBackingArtifactCleanupUnavailableError();
    }

    const deletedBackingArtifactIds: string[] = [];
    let deletedLocalFiles = false;

    if (normalizedRequest.deleteLocalFiles) {
      const fileEffects = this.dependencies.modelLocalFilesDeletePort;
      if (!current?.localPath || !fileEffects) {
        throw new ModelLocalFileEffectsUnavailableError();
      }
      const result = await fileEffects.deleteLocalModelFiles({
        workspaceId: normalizedRequest.workspaceId,
        modelRecordId: normalizedRequest.modelRecordId,
      });
      if (result?.deleted !== true) {
        throw new ModelLocalFileEffectsUnavailableError();
      }
      deletedLocalFiles = true;
    }

    if (catalogDelete) {
      try {
        for (const storageKey of backingArtifactIds) {
          const result = await catalogDelete.deleteArtifactCatalogRecord({ storageKey });
          const deleted = result?.ok === true ? result.value?.deleted : undefined;
          if (typeof deleted !== "boolean") {
            throw new ModelBackingArtifactCleanupUnavailableError();
          }
          if (deleted) deletedBackingArtifactIds.push(storageKey);
        }
      } catch {
        throw new ModelBackingArtifactCleanupUnavailableError();
      }
    }

    await this.dependencies.modelRegistry.deleteModelRecord(normalizedRequest);

    return {
      deletedModelRecordId: normalizedRequest.modelRecordId,
      deletedRegistryRecord: true,
      deletedLocalFiles,
      deletedBackingArtifactIds,
    };
  }
}

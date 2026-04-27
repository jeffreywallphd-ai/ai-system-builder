import { createContractError } from "../../contracts/shared";
import {
  createStoreArtifactInRepoFailureResult,
  createStoreArtifactInRepoRequest,
} from "../../contracts/storage";
import type { ArtifactRepoStoragePort } from "../ports/storage";
import type {
  ArtifactRepoStorageCommandContext,
  StoreArtifactInRepoCommand,
} from "./artifact-repo-storage.use-case-ports";

export interface StoreArtifactInRepoUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
}

export class StoreArtifactInRepoUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;

  public constructor(dependencies: StoreArtifactInRepoUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
  }

  public async execute(
    command: StoreArtifactInRepoCommand,
    context: ArtifactRepoStorageCommandContext = {},
  ) {
    if (command.content.byteLength === 0) {
      return createStoreArtifactInRepoFailureResult(
        createContractError("validation", "content must contain at least one byte."),
        context,
      );
    }

    try {
      return await this.artifactRepoStorage.storeArtifactInRepo(
        createStoreArtifactInRepoRequest(command.content, {
          target: command.target,
          mediaType: command.mediaType,
          metadata: command.metadata,
          overwrite: command.overwrite,
        }),
        context,
      );
    } catch (error) {
      return createStoreArtifactInRepoFailureResult(
        createContractError("internal", "Unexpected artifact-repo store failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

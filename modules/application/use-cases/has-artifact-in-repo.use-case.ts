import { createContractError } from "../../contracts/shared";
import {
  createHasArtifactInRepoFailureResult,
  createHasArtifactInRepoRequest,
} from "../../contracts/storage";
import type { ArtifactRepoStoragePort } from "../ports/storage";
import type {
  ArtifactRepoStorageCommandContext,
  HasArtifactInRepoCommand,
} from "./artifact-repo-storage.use-case-ports";

export interface HasArtifactInRepoUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
}

export class HasArtifactInRepoUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;

  public constructor(dependencies: HasArtifactInRepoUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
  }

  public async execute(
    command: HasArtifactInRepoCommand,
    context: ArtifactRepoStorageCommandContext = {},
  ) {
    try {
      return await this.artifactRepoStorage.hasArtifactInRepo(
        createHasArtifactInRepoRequest(command.target),
        context,
      );
    } catch (error) {
      return createHasArtifactInRepoFailureResult(
        createContractError("internal", "Unexpected artifact-repo lookup failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

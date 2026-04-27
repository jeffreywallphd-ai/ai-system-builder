import { createContractError } from "../../contracts/shared";
import {
  createRetrieveArtifactFromRepoFailureResult,
  createRetrieveArtifactFromRepoRequest,
} from "../../contracts/storage";
import type { ArtifactRepoStoragePort } from "../ports/storage";
import type {
  ArtifactRepoStorageCommandContext,
  RetrieveArtifactFromRepoCommand,
} from "./artifact-repo-storage.use-case-ports";

export interface RetrieveArtifactFromRepoUseCaseDependencies {
  artifactRepoStorage: ArtifactRepoStoragePort;
}

export class RetrieveArtifactFromRepoUseCase {
  private readonly artifactRepoStorage: ArtifactRepoStoragePort;

  public constructor(dependencies: RetrieveArtifactFromRepoUseCaseDependencies) {
    this.artifactRepoStorage = dependencies.artifactRepoStorage;
  }

  public async execute(
    command: RetrieveArtifactFromRepoCommand,
    context: ArtifactRepoStorageCommandContext = {},
  ) {
    try {
      return await this.artifactRepoStorage.retrieveArtifactFromRepo(
        createRetrieveArtifactFromRepoRequest(command.target),
        context,
      );
    } catch (error) {
      return createRetrieveArtifactFromRepoFailureResult(
        createContractError("internal", "Unexpected artifact-repo retrieval failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

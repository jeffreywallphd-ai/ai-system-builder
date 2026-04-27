import {
  createContractError,
  createFailureResult,
} from "../../contracts/shared";
import type { ArtifactBrowserUnregisteredPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserUnregisteredCommandContext,
  DeleteUnregisteredArtifactCommand,
  DeleteUnregisteredArtifactUseCaseResult,
} from "./artifact-browser-unregistered.types";

export interface DeleteUnregisteredArtifactUseCaseDependencies {
  artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;
}

export class DeleteUnregisteredArtifactUseCase {
  private readonly artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;

  public constructor(dependencies: DeleteUnregisteredArtifactUseCaseDependencies) {
    this.artifactBrowserUnregistered = dependencies.artifactBrowserUnregistered;
  }

  public async execute(
    command: DeleteUnregisteredArtifactCommand,
    context: ArtifactBrowserUnregisteredCommandContext = {},
  ): Promise<DeleteUnregisteredArtifactUseCaseResult> {
    if (typeof command.storageKey !== "string" || command.storageKey.trim().length === 0) {
      return createFailureResult(
        createContractError("validation", "storageKey must be a non-empty string."),
        context,
      );
    }

    return this.artifactBrowserUnregistered.deleteUnregisteredArtifact(
      { storageKey: command.storageKey },
      context,
    );
  }
}

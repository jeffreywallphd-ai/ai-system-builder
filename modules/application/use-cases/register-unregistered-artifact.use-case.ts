import {
  createContractError,
  createFailureResult,
} from "../../contracts/shared";
import type { ArtifactBrowserUnregisteredPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserUnregisteredCommandContext,
  RegisterUnregisteredArtifactCommand,
  RegisterUnregisteredArtifactUseCaseResult,
} from "./artifact-browser-unregistered.types";

export interface RegisterUnregisteredArtifactUseCaseDependencies {
  artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;
}

export class RegisterUnregisteredArtifactUseCase {
  private readonly artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;

  public constructor(dependencies: RegisterUnregisteredArtifactUseCaseDependencies) {
    this.artifactBrowserUnregistered = dependencies.artifactBrowserUnregistered;
  }

  public async execute(
    command: RegisterUnregisteredArtifactCommand,
    context: ArtifactBrowserUnregisteredCommandContext = {},
  ): Promise<RegisterUnregisteredArtifactUseCaseResult> {
    if (typeof command.storageKey !== "string" || command.storageKey.trim().length === 0) {
      return createFailureResult(
        createContractError("validation", "storageKey must be a non-empty string."),
        context,
      );
    }

    return this.artifactBrowserUnregistered.registerUnregisteredArtifact(
      { storageKey: command.storageKey },
      context,
    );
  }
}

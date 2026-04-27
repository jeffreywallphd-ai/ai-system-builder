import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../contracts/shared";
import {
  normalizeUnregisteredArtifactBrowseSuccessValue,
} from "../../contracts/artifact-browser";
import type { ArtifactBrowserUnregisteredPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserUnregisteredCommandContext,
  BrowseUnregisteredArtifactsUseCaseResult,
} from "./artifact-browser-unregistered.types";

export interface BrowseUnregisteredArtifactsUseCaseDependencies {
  artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;
}

export class BrowseUnregisteredArtifactsUseCase {
  private readonly artifactBrowserUnregistered: ArtifactBrowserUnregisteredPort;

  public constructor(dependencies: BrowseUnregisteredArtifactsUseCaseDependencies) {
    this.artifactBrowserUnregistered = dependencies.artifactBrowserUnregistered;
  }

  public async execute(
    context: ArtifactBrowserUnregisteredCommandContext = {},
  ): Promise<BrowseUnregisteredArtifactsUseCaseResult> {
    try {
      const result = await this.artifactBrowserUnregistered.browseUnregisteredArtifacts(context);
      if (!result.ok) {
        return result;
      }

      return createSuccessResult(
        normalizeUnregisteredArtifactBrowseSuccessValue(result.value),
        context,
      );
    } catch (error) {
      return createFailureResult(
        createContractError("internal", "Unexpected unregistered artifact browse failure.", {
          details: { reason: error instanceof Error ? error.message : String(error) },
        }),
        context,
      );
    }
  }
}

import { normalizeArtifactBrowseSuccessValue } from "../../contracts/artifact-browser";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../contracts/shared";
import type { ArtifactBrowserMetadataReadPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserCommandContext,
  BrowseArtifactsCommand,
  BrowseArtifactsUseCaseResult,
} from "./artifact-browser-read.types";

export interface BrowseArtifactsUseCaseDependencies {
  artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
}

export class BrowseArtifactsUseCase {
  private readonly artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;

  public constructor(dependencies: BrowseArtifactsUseCaseDependencies) {
    this.artifactBrowserMetadataRead = dependencies.artifactBrowserMetadataRead;
  }

  public async execute(
    command: BrowseArtifactsCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<BrowseArtifactsUseCaseResult> {
    try {
      const result = await this.artifactBrowserMetadataRead.browseArtifacts(
        {
          artifactFamily: command.artifactFamily,
        },
        context,
      );

      if (!result.ok) {
        return result;
      }

      return createSuccessResult(normalizeArtifactBrowseSuccessValue(result.value), context);
    } catch (error) {
      return createFailureResult(
        createContractError("internal", "Unexpected artifact browse failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

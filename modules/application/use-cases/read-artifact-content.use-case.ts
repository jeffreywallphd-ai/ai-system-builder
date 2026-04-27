import {
  normalizeArtifactBrowserLocator,
  normalizeArtifactContentReadSuccessValue,
} from "../../contracts/artifact-browser";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../contracts/shared";
import type { ArtifactBrowserContentReadPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserCommandContext,
  ReadArtifactContentCommand,
  ReadArtifactContentUseCaseResult,
} from "./artifact-browser-read.types";

export interface ReadArtifactContentUseCaseDependencies {
  artifactBrowserContentRead: ArtifactBrowserContentReadPort;
}

export class ReadArtifactContentUseCase {
  private readonly artifactBrowserContentRead: ArtifactBrowserContentReadPort;

  public constructor(dependencies: ReadArtifactContentUseCaseDependencies) {
    this.artifactBrowserContentRead = dependencies.artifactBrowserContentRead;
  }

  public async execute(
    command: ReadArtifactContentCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<ReadArtifactContentUseCaseResult> {
    let locator;

    try {
      locator = normalizeArtifactBrowserLocator(command.locator);
    } catch (error) {
      return createFailureResult(
        createContractError("validation", "locator.storageKey must be a non-empty string.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }

    try {
      const result = await this.artifactBrowserContentRead.readArtifactContent(
        {
          locator,
        },
        context,
      );

      if (!result.ok) {
        return result;
      }

      return createSuccessResult(normalizeArtifactContentReadSuccessValue(result.value), context);
    } catch (error) {
      return createFailureResult(
        createContractError("internal", "Unexpected artifact content read failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

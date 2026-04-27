import {
  normalizeArtifactBrowserLocator,
  normalizeArtifactReadSuccessValue,
} from "../../contracts/artifact-browser";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractErrorDetails,
} from "../../contracts/shared";
import type { StorageObjectMetadata } from "../../contracts/storage";
import type { ArtifactBrowserMetadataReadPort } from "../ports/artifact-browser";
import type {
  ArtifactBrowserCommandContext,
  ReadArtifactDetailCommand,
  ReadArtifactDetailUseCaseResult,
} from "./artifact-browser-read.types";

export interface ReadArtifactDetailUseCaseDependencies {
  artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
}

export class ReadArtifactDetailUseCase {
  private readonly artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;

  public constructor(dependencies: ReadArtifactDetailUseCaseDependencies) {
    this.artifactBrowserMetadataRead = dependencies.artifactBrowserMetadataRead;
  }

  public async execute<TMetadata extends StorageObjectMetadata = StorageObjectMetadata>(
    command: ReadArtifactDetailCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<ReadArtifactDetailUseCaseResult<ContractErrorDetails, TMetadata>> {
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
      const result = await this.artifactBrowserMetadataRead.readArtifactDetail<TMetadata>(
        {
          locator,
        },
        context,
      );

      if (!result.ok) {
        return result;
      }

      return createSuccessResult(normalizeArtifactReadSuccessValue(result.value), context);
    } catch (error) {
      return createFailureResult(
        createContractError("internal", "Unexpected artifact detail read failure.", {
          details: {
            reason: error instanceof Error ? error.message : String(error),
          },
        }),
        context,
      );
    }
  }
}

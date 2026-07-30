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
import { resolveArtifactWorkspaceContext } from "./artifact-workspace-context";
import type { WorkspaceRepository } from "../ports/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../ports/security";

export interface ReadArtifactDetailUseCaseDependencies {
  artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
  workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

export class ReadArtifactDetailUseCase {
  private readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  private readonly artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
  private readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;

  public constructor(dependencies: ReadArtifactDetailUseCaseDependencies) {
    this.artifactBrowserMetadataRead = dependencies.artifactBrowserMetadataRead;
    this.workspaceRepository = dependencies.workspaceRepository;
    this.workspaceAuthorization = dependencies.workspaceAuthorization;
  }

  public async execute<TMetadata extends StorageObjectMetadata = StorageObjectMetadata>(
    command: ReadArtifactDetailCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<ReadArtifactDetailUseCaseResult<ContractErrorDetails, TMetadata>> {
    const workspaceContext = await resolveArtifactWorkspaceContext(context, this.workspaceRepository, this.workspaceAuthorization ? {
      port: this.workspaceAuthorization,
      operation: "artifact.detail.read",
      requiredScopes: ["artifact:read"],
    } : undefined);
    if (!workspaceContext.ok) {
      return workspaceContext;
    }

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

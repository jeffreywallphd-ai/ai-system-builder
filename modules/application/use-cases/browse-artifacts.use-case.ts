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
import { resolveArtifactWorkspaceContext } from "./artifact-workspace-context";
import type { WorkspaceRepository } from "../ports/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../ports/security";

export interface BrowseArtifactsUseCaseDependencies {
  artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
  workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

export class BrowseArtifactsUseCase {
  private readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  private readonly artifactBrowserMetadataRead: ArtifactBrowserMetadataReadPort;
  private readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;

  public constructor(dependencies: BrowseArtifactsUseCaseDependencies) {
    this.artifactBrowserMetadataRead = dependencies.artifactBrowserMetadataRead;
    this.workspaceRepository = dependencies.workspaceRepository;
    this.workspaceAuthorization = dependencies.workspaceAuthorization;
  }

  public async execute(
    command: BrowseArtifactsCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<BrowseArtifactsUseCaseResult> {
    const workspaceContext = await resolveArtifactWorkspaceContext(context, this.workspaceRepository, this.workspaceAuthorization ? {
      port: this.workspaceAuthorization,
      operation: "artifact.browse",
      requiredScopes: ["artifact:read"],
    } : undefined);
    if (!workspaceContext.ok) {
      return workspaceContext;
    }

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

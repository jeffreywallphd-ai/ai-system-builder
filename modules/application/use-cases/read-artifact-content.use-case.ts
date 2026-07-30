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
import { resolveArtifactWorkspaceContext } from "./artifact-workspace-context";
import type { WorkspaceRepository } from "../ports/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../ports/security";

export interface ReadArtifactContentUseCaseDependencies {
  artifactBrowserContentRead: ArtifactBrowserContentReadPort;
  workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
}

export class ReadArtifactContentUseCase {
  private readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  private readonly artifactBrowserContentRead: ArtifactBrowserContentReadPort;
  private readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;

  public constructor(dependencies: ReadArtifactContentUseCaseDependencies) {
    this.artifactBrowserContentRead = dependencies.artifactBrowserContentRead;
    this.workspaceRepository = dependencies.workspaceRepository;
    this.workspaceAuthorization = dependencies.workspaceAuthorization;
  }

  public async execute(
    command: ReadArtifactContentCommand,
    context: ArtifactBrowserCommandContext = {},
  ): Promise<ReadArtifactContentUseCaseResult> {
    const workspaceContext = await resolveArtifactWorkspaceContext(context, this.workspaceRepository, this.workspaceAuthorization ? {
      port: this.workspaceAuthorization,
      operation: "artifact.content.read",
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

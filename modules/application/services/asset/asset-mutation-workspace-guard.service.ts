import type {
  AssetMutationCommandBase,
  AssetMutationDiagnostic,
  AssetMutationFailure,
} from "../../../contracts/asset";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";

/** Resolves persisted workspace ownership before any mutation source read or side effect. */
export class AssetMutationWorkspaceGuardService {
  public constructor(private readonly dependencies: {
    readonly workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
    readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  }) {}

  public async authorize(
    command: AssetMutationCommandBase,
  ): Promise<AssetMutationFailure | undefined> {
    if (!isWorkspaceId(command.workspaceId)) {
      return failure(command, "validation", "A valid workspace id is required for asset mutations.",
        "asset-mutation-workspace-required");
    }
    const workspace = await this.dependencies.workspaceRepository.readWorkspace(command.workspaceId);
    if (!workspace) {
      return failure(command, "not-found", "Workspace was not found for asset mutation.",
        "asset-mutation-workspace-not-found");
    }
    if (workspace.status !== "active") {
      return failure(command, "unavailable", "Workspace is unavailable for asset mutation.",
        "asset-mutation-workspace-unavailable");
    }
    if (this.dependencies.workspaceAuthorization) {
      try {
        await this.dependencies.workspaceAuthorization.authorizeWorkspaceOperation({
          workspace,
          operation: command.operation,
          requiredScopes: ["asset:write"],
        });
      } catch {
        return failure(command, "permission", "Workspace access is forbidden.",
          "asset-mutation-workspace-forbidden");
      }
    }
    return undefined;
  }
}

function failure(
  command: AssetMutationCommandBase,
  code: AssetMutationFailure["code"],
  message: string,
  diagnosticCode: string,
): AssetMutationFailure {
  const diagnostics: readonly AssetMutationDiagnostic[] = [{
    severity: "error",
    code: diagnosticCode,
    message,
  }];
  return { code, message, operation: command.operation, diagnostics };
}

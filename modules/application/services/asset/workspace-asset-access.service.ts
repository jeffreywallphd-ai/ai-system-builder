import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";

export class WorkspaceAssetAccessService implements WorkspaceAssetAccessPort {
  constructor(private readonly dependencies: {
    workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
    workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  }) {}

  async authorize(workspaceId: Parameters<WorkspaceAssetAccessPort["authorize"]>[0], operation: string, scope: "asset:read" | "asset:write"): Promise<void> {
    try {
      if (!isWorkspaceId(workspaceId) || !this.dependencies.workspaceAuthorization) throw new Error();
      const workspace = await this.dependencies.workspaceRepository.readWorkspace(workspaceId);
      if (!workspace || workspace.workspaceId !== workspaceId || workspace.status !== "active") throw new Error();
      await this.dependencies.workspaceAuthorization.authorizeWorkspaceOperation({workspace, operation, requiredScopes: [scope]});
    } catch {
      throw new Error("Workspace asset access is unavailable or forbidden.");
    }
  }
}

import { isWorkspaceId } from "../../../contracts/workspace";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";

/** Accepted host-owned tasks, never caller-supplied ownership or labels. */
export class ImageGenerationTaskAuthorityService {
  private readonly tasks = new Map<string, { workspaceId: string; organizationId?: string; accepted: boolean }>();
  public constructor(private readonly dependencies: {
    workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
    workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
    organizationContextProvider?: OrganizationRequestContextProviderPort;
  }) {}

  public async reserve(requestId: string, workspaceId: string): Promise<{ accept(): void; release(): void }> {
    const organizationId = await this.authorizeWorkspace(workspaceId, "write");
    if (this.tasks.size >= 1024 || this.tasks.has(requestId)) throw new Error("Image task ownership capacity is unavailable.");
    const task = { workspaceId, organizationId, accepted: false };
    this.tasks.set(requestId, task);
    return {
      accept: () => { task.accepted = true; },
      release: () => { if (!task.accepted && this.tasks.get(requestId) === task) this.tasks.delete(requestId); },
    };
  }
  public async assertOwned(requestId: string, workspaceId: string | undefined, operation: "read" | "write"): Promise<void> {
    const organizationId = await this.authorizeWorkspace(workspaceId, operation);
    const owned = this.tasks.get(requestId);
    if (!owned?.accepted || owned.workspaceId !== workspaceId || owned.organizationId !== organizationId) throw new Error("Image generation task was not found in this workspace.");
  }
  private async authorizeWorkspace(workspaceId: string | undefined, operation: "read" | "write"): Promise<string | undefined> {
    try {
      if (!isWorkspaceId(workspaceId) || !this.dependencies.workspaceAuthorization) throw new Error();
      const context = this.dependencies.organizationContextProvider?.getCurrentOrganizationContext();
      if (this.dependencies.organizationContextProvider && !context) throw new Error();
      const workspace = await this.dependencies.workspaceRepository.readWorkspace(workspaceId);
      if (!workspace || workspace.workspaceId !== workspaceId || workspace.status !== "active") throw new Error();
      await this.dependencies.workspaceAuthorization.authorizeWorkspaceOperation({ workspace, operation: `image-generation.${operation}`, requiredScopes: [`image-generation:${operation}`] });
      return context?.organizationId;
    } catch { throw new Error("Workspace image access is unavailable or forbidden."); }
  }
}

import { createSecurityApplicationError, type AuthContext } from "../../../contracts/security";
import type { WorkspaceRecord } from "../../../contracts/workspace";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type {
  WorkspaceOperationAuthorizationPort,
  WorkspaceOperationAuthorizationRequest,
} from "../../ports/security";
import type { AuthorizeOperationService } from "./authorize-operation.service";

export class AuthorizeWorkspaceOperationService
  implements WorkspaceOperationAuthorizationPort {
  public constructor(private readonly dependencies: {
    readonly organizationContext: OrganizationRequestContextProviderPort;
    readonly authorizer: Pick<AuthorizeOperationService, "execute">;
  }) {}

  public async authorizeWorkspaceOperation(
    request: WorkspaceOperationAuthorizationRequest,
  ): Promise<void> {
    const current = this.dependencies.organizationContext.getCurrentOrganizationContext();
    if (!current) {
      throw createSecurityApplicationError(
        "security.forbidden",
        "Managed workspace authorization context is required.",
      );
    }

    await this.dependencies.authorizer.execute({
      authContext: authContextFor(current.principalId),
      organizationId: current.organizationId,
      requestId: current.requestId,
      correlationId: current.correlationId,
      operation: request.operation,
      requiredScopes: [...request.requiredScopes],
      resource: workspaceResource(request.workspace),
    });
  }
}

function authContextFor(principalId: string): AuthContext {
  return {
    authenticated: true,
    authMethod: "external",
    principal: {
      principalId,
      kind: "user",
      roles: [],
      scopes: [],
    },
  };
}

function workspaceResource(workspace: WorkspaceRecord) {
  return {
    kind: "workspace",
    id: workspace.workspaceId,
    workspaceId: workspace.workspaceId,
    organizationId: workspace.organizationId,
    requiresOrganizationOwnership: true,
  } as const;
}

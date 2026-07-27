import {
  createSecurityApplicationError,
  type AuthContext,
} from "../../../contracts/security";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { AuthorizeOperationService } from "./authorize-operation.service";

export class AuthorizeProviderRepositoryCreationService {
  public constructor(private readonly dependencies: {
    readonly organizationContext: OrganizationRequestContextProviderPort;
    readonly authorizer: Pick<AuthorizeOperationService, "execute">;
  }) {}

  public async authorize(request: {
    readonly provider: string;
    readonly repository: string;
    readonly visibility: "private" | "public";
  }): Promise<void> {
    const current = this.dependencies.organizationContext.getCurrentOrganizationContext();
    if (!current) {
      throw createSecurityApplicationError(
        "security.forbidden",
        "Managed provider repository authorization context is required.",
      );
    }
    await this.dependencies.authorizer.execute({
      authContext: authContextFor(current.principalId),
      organizationId: current.organizationId,
      requestId: current.requestId,
      correlationId: current.correlationId,
      operation: "provider-repository.create",
      requiredScopes: ["provider-repository:create"],
      requiredOrganizationRoles: ["owner", "admin", "operator"],
      resource: {
        kind: "provider-repository",
        id: `${request.provider}:${request.repository}`,
        organizationId: current.organizationId,
        requiresOrganizationOwnership: true,
      },
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


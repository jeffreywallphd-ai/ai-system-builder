import type { ApplicationSettingKey } from "../../../contracts/settings";
import {
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
  SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY,
} from "../../../contracts/settings";
import {
  createSecurityApplicationError,
  type AuthContext,
} from "../../../contracts/security";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { ApplicationSettingAuthorizationPort } from "../../ports/settings";
import type { AuthorizeOperationService } from "./authorize-operation.service";

const ADMINISTRATOR_ONLY_SETTINGS = new Set<ApplicationSettingKey>([
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
  SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY,
]);

export class AuthorizeApplicationSettingMutationService
  implements ApplicationSettingAuthorizationPort {
  public constructor(private readonly dependencies: {
    readonly organizationContext: OrganizationRequestContextProviderPort;
    readonly authorizer: Pick<AuthorizeOperationService, "execute">;
  }) {}

  public async authorizeSettingMutation(request: {
    readonly key: ApplicationSettingKey;
    readonly operation: "update" | "clear";
  }): Promise<void> {
    const current = this.dependencies.organizationContext.getCurrentOrganizationContext();
    if (!current) {
      throw createSecurityApplicationError(
        "security.forbidden",
        "Managed application-setting authorization context is required.",
      );
    }
    await this.dependencies.authorizer.execute({
      authContext: authContextFor(current.principalId),
      organizationId: current.organizationId,
      requestId: current.requestId,
      correlationId: current.correlationId,
      operation: `application-setting.${request.operation}`,
      requiredScopes: ["settings:write"],
      requiredOrganizationRoles: ADMINISTRATOR_ONLY_SETTINGS.has(request.key)
        ? ["owner", "admin"]
        : ["owner", "admin", "operator"],
      resource: {
        kind: "application-setting",
        id: request.key,
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


import type { ApplicationSettingKey } from "../../../contracts/settings";
import {
  createSecurityApplicationError,
  type AuthContext,
  type ProviderCredentialProvider,
  type ProviderCredentialStatus,
  type SecurityScope,
} from "../../../contracts/security";
import type { ApplicationSecretsPort } from "../../ports/settings";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { ProviderCredentialStorePort } from "../../ports/security";
import type { AuthorizeOperationService } from "./authorize-operation.service";

const HUGGING_FACE_SETTING_KEY = "huggingface.token";

export class ManageOrganizationProviderCredentialService {
  public constructor(private readonly dependencies: {
    readonly organizationContext: OrganizationRequestContextProviderPort;
    readonly authorizer: Pick<AuthorizeOperationService, "execute">;
    readonly credentials: ProviderCredentialStorePort;
    readonly now?: () => string;
  }) {}

  public async getStatus(
    provider: ProviderCredentialProvider,
  ): Promise<ProviderCredentialStatus> {
    const context = await this.authorize(provider, "provider-credential:read", "read");
    const record = await this.dependencies.credentials.readProviderCredential({
      organizationId: context.organizationId,
      provider,
    });
    return record ? {
      configured: true,
      maskedToken: maskSecret(record.secret),
    } : { configured: false };
  }

  public async setCredential(
    provider: ProviderCredentialProvider,
    secret: string,
  ): Promise<ProviderCredentialStatus> {
    const normalized = normalizeSecret(secret, provider);
    const context = await this.authorize(provider, "provider-credential:write", "write");
    await this.dependencies.credentials.writeProviderCredential({
      organizationId: context.organizationId,
      provider,
      secret: normalized,
      updatedAt: this.dependencies.now?.() ?? new Date().toISOString(),
    });
    return { configured: true, maskedToken: maskSecret(normalized) };
  }

  public async clearCredential(
    provider: ProviderCredentialProvider,
  ): Promise<ProviderCredentialStatus> {
    const context = await this.authorize(provider, "provider-credential:write", "delete");
    await this.dependencies.credentials.deleteProviderCredential({
      organizationId: context.organizationId,
      provider,
    });
    return { configured: false };
  }

  /** Internal use only: the raw secret must never cross a transport boundary. */
  public async resolveCredentialForUse(
    provider: ProviderCredentialProvider,
  ): Promise<string | undefined> {
    const context = await this.authorize(provider, "provider-credential:use", "use");
    return (
      await this.dependencies.credentials.readProviderCredential({
        organizationId: context.organizationId,
        provider,
      })
    )?.secret;
  }

  private async authorize(
    provider: ProviderCredentialProvider,
    requiredScope: SecurityScope,
    action: string,
  ) {
    const current = this.dependencies.organizationContext.getCurrentOrganizationContext();
    if (!current) {
      throw createSecurityApplicationError(
        "security.forbidden",
        "Managed provider credential context is required.",
      );
    }
    await this.dependencies.authorizer.execute({
      authContext: authContextFor(current.principalId),
      organizationId: current.organizationId,
      requestId: current.requestId,
      correlationId: current.correlationId,
      operation: `provider-credential.${provider}.${action}`,
      requiredScopes: [requiredScope],
      resource: {
        kind: "provider-credential",
        id: provider,
        organizationId: current.organizationId,
        requiresOrganizationOwnership: true,
      },
    });
    return current;
  }
}

export function createProviderCredentialApplicationSecretsAdapter(
  credentials: Pick<
    ManageOrganizationProviderCredentialService,
    "getStatus" | "setCredential" | "clearCredential" | "resolveCredentialForUse"
  >,
): ApplicationSecretsPort {
  return {
    async setSecret(key, value) {
      await credentials.setCredential(providerForSetting(key), value);
    },
    async getSecret(key) {
      return credentials.resolveCredentialForUse(providerForSetting(key));
    },
    async clearSecret(key) {
      await credentials.clearCredential(providerForSetting(key));
    },
    async hasSecret(key) {
      return (await credentials.getStatus(providerForSetting(key))).configured;
    },
  };
}

function providerForSetting(key: ApplicationSettingKey): ProviderCredentialProvider {
  if (key !== HUGGING_FACE_SETTING_KEY) {
    throw new Error(`Unsupported managed secret setting "${key}".`);
  }
  return "huggingface";
}

function normalizeSecret(value: string, provider: ProviderCredentialProvider): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${provider} credential must be a non-empty string.`);
  }
  return normalized;
}

function maskSecret(value: string): string {
  const normalized = value.trim();
  return normalized.length <= 4 ? "****" : `****${normalized.slice(-4)}`;
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


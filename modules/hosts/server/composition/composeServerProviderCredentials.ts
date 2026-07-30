import { dirname, join } from "node:path";

import type { ApplicationSecretsPort } from "../../../application/ports/settings";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { AuthorizeOperationService } from "../../../application/services/security";
import {
  createProviderCredentialApplicationSecretsAdapter,
  ManageOrganizationProviderCredentialService,
} from "../../../application/services/security";
import { createFilesystemOrganizationProviderCredentialStoreAdapter } from "../../../adapters/security/credentials";
import { createOrganizationId } from "../../../contracts/organization";
import type { ProviderCredentialStatus } from "../../../contracts/security";
import {
  createHuggingFaceTokenConfigStore,
} from "../../shared/huggingFaceTokenConfigStore";

export interface ServerProviderCredentialComposition {
  readonly applicationSecrets: ApplicationSecretsPort;
  readonly getHuggingFaceTokenStatus: () => Promise<ProviderCredentialStatus>;
  readonly setHuggingFaceToken: (token: string) => Promise<ProviderCredentialStatus>;
  readonly clearHuggingFaceToken: () => Promise<ProviderCredentialStatus>;
  readonly resolveHuggingFaceTokenForUse: () => Promise<string | undefined>;
  readonly waitForMigration: () => Promise<void>;
}

export function composeServerProviderCredentials(options: {
  readonly organizationContext?: OrganizationRequestContextProviderPort;
  readonly organizationAuthorizer?: Pick<AuthorizeOperationService, "execute">;
  readonly credentialRootDirectory?: string;
  readonly legacyTokenFilePath: string;
  readonly legacyFallbackToken?: string;
  readonly migrationOrganizationId?: string;
  readonly now?: () => string;
  readonly onMigration?: (event: {
    readonly provider: "huggingface";
    readonly organizationId: string;
  }) => void;
}): ServerProviderCredentialComposition {
  const managed = options.organizationContext && options.organizationAuthorizer;
  if (!managed) {
    return composeDeploymentLocalCredentials(options);
  }

  const store = createFilesystemOrganizationProviderCredentialStoreAdapter(
    options.credentialRootDirectory ??
      join(dirname(options.legacyTokenFilePath), "provider-credentials"),
  );
  const service = new ManageOrganizationProviderCredentialService({
    organizationContext: options.organizationContext,
    authorizer: options.organizationAuthorizer,
    credentials: store,
    now: options.now,
  });
  const migrationOrganizationId = options.migrationOrganizationId?.trim()
    ? createOrganizationId(options.migrationOrganizationId)
    : undefined;
  const migration = migrateLegacyCredentialIfExplicitlyAssigned({
    store,
    legacyTokenFilePath: options.legacyTokenFilePath,
    legacyFallbackToken: options.legacyFallbackToken,
    migrationOrganizationId,
    now: options.now,
    onMigration: options.onMigration,
  });
  // Keep startup failures observable to the first credential operation without
  // allowing a rejected eager migration promise to become unhandled.
  void migration.catch(() => undefined);
  const guarded = {
    async getStatus() {
      await migration;
      return service.getStatus("huggingface");
    },
    async setCredential(_provider: "huggingface", token: string) {
      await migration;
      return service.setCredential("huggingface", token);
    },
    async clearCredential() {
      await migration;
      return service.clearCredential("huggingface");
    },
    async resolveCredentialForUse() {
      await migration;
      return service.resolveCredentialForUse("huggingface");
    },
  };

  return {
    applicationSecrets: createProviderCredentialApplicationSecretsAdapter(guarded),
    getHuggingFaceTokenStatus: () => guarded.getStatus(),
    setHuggingFaceToken: (token) => guarded.setCredential("huggingface", token),
    clearHuggingFaceToken: () => guarded.clearCredential(),
    resolveHuggingFaceTokenForUse: () => guarded.resolveCredentialForUse(),
    waitForMigration: () => migration,
  };
}

function composeDeploymentLocalCredentials(options: {
  readonly legacyTokenFilePath: string;
  readonly legacyFallbackToken?: string;
}): ServerProviderCredentialComposition {
  const store = createHuggingFaceTokenConfigStore({
    filePath: options.legacyTokenFilePath,
    fallbackToken: options.legacyFallbackToken,
  });
  const applicationSecrets: ApplicationSecretsPort = {
    async setSecret(key, value) {
      assertHuggingFaceSetting(key);
      store.setToken(value);
    },
    async getSecret(key) {
      assertHuggingFaceSetting(key);
      return store.getToken();
    },
    async clearSecret(key) {
      assertHuggingFaceSetting(key);
      store.clearToken();
    },
    async hasSecret(key) {
      assertHuggingFaceSetting(key);
      return store.getStatus().configured;
    },
  };

  return {
    applicationSecrets,
    getHuggingFaceTokenStatus: async () => store.getStatus(),
    setHuggingFaceToken: async (token) => store.setToken(token),
    clearHuggingFaceToken: async () => store.clearToken(),
    resolveHuggingFaceTokenForUse: async () => store.getToken(),
    waitForMigration: async () => undefined,
  };
}

async function migrateLegacyCredentialIfExplicitlyAssigned(options: {
  readonly store: ReturnType<typeof createFilesystemOrganizationProviderCredentialStoreAdapter>;
  readonly legacyTokenFilePath: string;
  readonly legacyFallbackToken?: string;
  readonly migrationOrganizationId?: ReturnType<typeof createOrganizationId>;
  readonly now?: () => string;
  readonly onMigration?: (event: {
    readonly provider: "huggingface";
    readonly organizationId: string;
  }) => void;
}): Promise<void> {
  const organizationId = options.migrationOrganizationId;
  if (!organizationId) return;
  const existing = await options.store.readProviderCredential({
    organizationId,
    provider: "huggingface",
  });
  if (existing) return;

  const legacy = createHuggingFaceTokenConfigStore({
    filePath: options.legacyTokenFilePath,
    fallbackToken: options.legacyFallbackToken,
  });
  const token = legacy.getToken();
  if (!token) return;

  await options.store.writeProviderCredential({
    organizationId,
    provider: "huggingface",
    secret: token,
    updatedAt: options.now?.() ?? new Date().toISOString(),
  });
  legacy.clearToken();
  options.onMigration?.({ provider: "huggingface", organizationId });
}

function assertHuggingFaceSetting(key: string): void {
  if (key !== "huggingface.token") {
    throw new Error(`Unsupported deployment-local secret setting "${key}".`);
  }
}

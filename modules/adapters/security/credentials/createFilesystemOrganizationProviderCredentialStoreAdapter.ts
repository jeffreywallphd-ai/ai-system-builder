import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ProviderCredentialStorePort } from "../../../application/ports/security";
import {
  createOrganizationId,
  type OrganizationId,
} from "../../../contracts/organization";
import {
  PROVIDER_CREDENTIAL_PROVIDERS,
  type ProviderCredentialProvider,
  type ProviderCredentialRecord,
} from "../../../contracts/security";

interface PersistedProviderCredential {
  organizationId: string;
  provider: string;
  secret: string;
  updatedAt: string;
}

export function createFilesystemOrganizationProviderCredentialStoreAdapter(
  rootDirectory: string,
): ProviderCredentialStorePort {
  return {
    async readProviderCredential(request) {
      const filePath = credentialPath(rootDirectory, request.organizationId, request.provider);
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<PersistedProviderCredential>;
        if (
          parsed.organizationId !== request.organizationId ||
          parsed.provider !== request.provider ||
          typeof parsed.secret !== "string" ||
          parsed.secret.trim().length === 0 ||
          typeof parsed.updatedAt !== "string"
        ) {
          throw new Error("Provider credential file is invalid or belongs to another organization.");
        }
        return {
          organizationId: request.organizationId,
          provider: request.provider,
          secret: parsed.secret,
          updatedAt: parsed.updatedAt,
        };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },

    async writeProviderCredential(record) {
      validateRecord(record);
      const filePath = credentialPath(rootDirectory, record.organizationId, record.provider);
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await bestEffortChmod(directory, 0o700);
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(record), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        await bestEffortChmod(temporaryPath, 0o600);
        await rename(temporaryPath, filePath);
        await bestEffortChmod(filePath, 0o600);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },

    async deleteProviderCredential(request) {
      await rm(credentialPath(rootDirectory, request.organizationId, request.provider), {
        force: true,
      });
    },
  };
}

function credentialPath(
  rootDirectory: string,
  organizationId: OrganizationId,
  provider: ProviderCredentialProvider,
): string {
  createOrganizationId(organizationId);
  if (!PROVIDER_CREDENTIAL_PROVIDERS.includes(provider)) {
    throw new Error("Unsupported provider credential type.");
  }
  return join(rootDirectory, organizationId, `${provider}.json`);
}

function validateRecord(record: ProviderCredentialRecord): void {
  createOrganizationId(record.organizationId);
  if (!PROVIDER_CREDENTIAL_PROVIDERS.includes(record.provider)) {
    throw new Error("Unsupported provider credential type.");
  }
  if (!record.secret.trim()) {
    throw new Error("Provider credential secret must be non-empty.");
  }
  if (!record.updatedAt.trim()) {
    throw new Error("Provider credential updatedAt must be non-empty.");
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function bestEffortChmod(path: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(path, mode);
}


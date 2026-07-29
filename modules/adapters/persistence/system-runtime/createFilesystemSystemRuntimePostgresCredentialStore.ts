import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import type {
  SystemRuntimePostgresCredential,
  SystemRuntimePostgresCredentialStore,
} from "./system-runtime-postgres-credential-store";

export function createFilesystemSystemRuntimePostgresCredentialStore(
  rootDirectory: string,
): SystemRuntimePostgresCredentialStore {
  const root = path.resolve(rootDirectory, "runtime-database-credentials");
  return {
    async read(runtimeInstanceId) {
      const normalizedId = normalizeSystemRuntimeInstanceId(runtimeInstanceId);
      try {
        const value = JSON.parse(
          await readFile(credentialPath(root, normalizedId), "utf8"),
        ) as Partial<SystemRuntimePostgresCredential>;
        if (
          value.runtimeInstanceId !== normalizedId ||
          value.dataBindingId !== `postgres:${normalizedId}` ||
          typeof value.connectionString !== "string" ||
          !value.connectionString.trim() ||
          typeof value.updatedAt !== "string" ||
          !value.updatedAt.trim()
        ) {
          throw new Error("Runtime database credential is invalid.");
        }
        return {
          runtimeInstanceId: normalizedId,
          dataBindingId: normalizeSystemRuntimeDataBindingId(
            value.dataBindingId,
          ),
          connectionString: value.connectionString,
          updatedAt: value.updatedAt,
        };
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async write(credential) {
      const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
        credential.runtimeInstanceId,
      );
      const dataBindingId = normalizeSystemRuntimeDataBindingId(
        credential.dataBindingId,
      );
      if (dataBindingId !== `postgres:${runtimeInstanceId}`) {
        throw new Error("Runtime database credential binding is invalid.");
      }
      const filePath = credentialPath(root, runtimeInstanceId);
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await bestEffortChmod(path.dirname(filePath), 0o700);
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(
          temporaryPath,
          JSON.stringify({ ...credential, runtimeInstanceId, dataBindingId }),
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
        await bestEffortChmod(temporaryPath, 0o600);
        await rename(temporaryPath, filePath);
        await bestEffortChmod(filePath, 0o600);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async delete(runtimeInstanceId) {
      await rm(
        credentialPath(
          root,
          normalizeSystemRuntimeInstanceId(runtimeInstanceId),
        ),
        { force: true },
      );
    },
  };
}

function credentialPath(
  root: string,
  runtimeInstanceId: SystemRuntimeInstanceId,
): string {
  return path.join(root, `${runtimeInstanceId}.json`);
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT",
  );
}

async function bestEffortChmod(filePath: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(filePath, mode);
}

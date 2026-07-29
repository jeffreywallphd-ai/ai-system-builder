import type { SystemRuntimeDatabaseLifecyclePort } from "../../../ports/system-deployment";
import type { SystemRuntimeStructuredDataSessionProvider } from "../../../../adapters/persistence/system-runtime";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import {
  normalizeSystemRuntimeDataBindingId,
  type SystemRuntimeDatabaseBackup,
} from "../../../../contracts/system-deployment";

export function createRuntimeDatabaseTestAdapter():
  SystemRuntimeDatabaseLifecyclePort & SystemRuntimeStructuredDataSessionProvider {
  const documents = createInMemoryStructuredDocumentStore(
    () => "2026-07-29T00:00:00.000Z",
  );
  return {
    async provision(request) {
      return {
        dataBindingId: normalizeSystemRuntimeDataBindingId(
          `sqlite:${request.runtimeInstanceId}`,
        ),
        databaseEngine: "sqlite",
      };
    },
    async open() {
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async migrate() {
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async close() {},
    async retain() {},
    async createBackup(instance): Promise<SystemRuntimeDatabaseBackup> {
      return {
        backupId: "backup-test",
        runtimeInstanceId: instance.runtimeInstanceId,
        createdAt: "2026-07-29T00:00:00.000Z",
        verified: true,
      };
    },
    async restoreBackup() {
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async deleteRetained() {},
    async acquire(instance) {
      return {
        runtimeInstanceId: instance.runtimeInstanceId,
        documents,
        health: { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 },
      };
    },
    async release() {},
  };
}

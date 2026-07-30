import type {
  SystemRuntimeDatabaseLifecyclePort,
  ProvisionSystemRuntimeDatabaseRequest,
} from "../../../../modules/application/ports/system-deployment";
import { createInMemoryStructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import type { SystemRuntimeStructuredDataSessionProvider } from "../../../../modules/adapters/persistence/system-runtime";
import {
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeDatabaseBackup,
  type SystemRuntimeDatabaseHealth,
  type SystemRuntimeInstance,
  type SystemRuntimeInstanceId,
} from "../../../../modules/contracts/system-deployment";

type QualificationRuntimeDatabaseAdapter = SystemRuntimeDatabaseLifecyclePort &
  SystemRuntimeStructuredDataSessionProvider & {
    closeAll(): Promise<void>;
  };

interface QualificationRuntimeRecord {
  readonly request: ProvisionSystemRuntimeDatabaseRequest;
  readonly dataBindingId: ReturnType<
    typeof normalizeSystemRuntimeDataBindingId
  >;
  readonly documents: ReturnType<typeof createInMemoryStructuredDocumentStore>;
}

const HEALTHY: SystemRuntimeDatabaseHealth = {
  healthy: true,
  schemaVersion: 0,
  expectedSchemaVersion: 0,
};

/**
 * Qualification-only runtime data plane for the Node 20 thin-client host.
 * Production server composition rejects this explicit seam and continues to
 * require its managed PostgreSQL runtime adapter.
 */
export function createVisualComposerQualificationRuntimeDatabase(
  now: () => string = () => new Date().toISOString(),
): QualificationRuntimeDatabaseAdapter {
  const records = new Map<
    SystemRuntimeInstanceId,
    QualificationRuntimeRecord
  >();

  const readExact = (instance: SystemRuntimeInstance) => {
    const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
      instance.runtimeInstanceId,
    );
    const record = records.get(runtimeInstanceId);
    if (
      !record ||
      instance.databaseEngine !== "sqlite" ||
      record.dataBindingId !== instance.dataBindingId ||
      record.request.organizationId !== instance.organizationId ||
      record.request.workspaceId !== instance.workspaceId
    ) {
      throw safeQualificationRuntimeError(
        "qualification-runtime.binding-mismatch",
        "The qualification runtime database binding is invalid.",
      );
    }
    return record;
  };

  const adapter: QualificationRuntimeDatabaseAdapter = {
    async provision(request) {
      const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
        request.runtimeInstanceId,
      );
      const existing = records.get(runtimeInstanceId);
      if (existing) {
        if (
          existing.request.organizationId !== request.organizationId ||
          existing.request.workspaceId !== request.workspaceId
        ) {
          throw safeQualificationRuntimeError(
            "qualification-runtime.provision-conflict",
            "The qualification runtime database identity conflicts.",
          );
        }
        return {
          dataBindingId: existing.dataBindingId,
          databaseEngine: "sqlite" as const,
        };
      }
      const dataBindingId = normalizeSystemRuntimeDataBindingId(
        `sqlite:${runtimeInstanceId}`,
      );
      records.set(runtimeInstanceId, {
        request: { ...request, runtimeInstanceId },
        dataBindingId,
        documents: createInMemoryStructuredDocumentStore(now),
      });
      return { dataBindingId, databaseEngine: "sqlite" as const };
    },
    async open(instance) {
      readExact(instance);
      return HEALTHY;
    },
    async migrate(instance) {
      readExact(instance);
      return HEALTHY;
    },
    async close(instance) {
      readExact(instance);
    },
    async retain(instance) {
      readExact(instance);
    },
    async createBackup(instance): Promise<SystemRuntimeDatabaseBackup> {
      readExact(instance);
      throw safeQualificationRuntimeError(
        "qualification-runtime.backup-unsupported",
        "Qualification runtime database backups are unavailable.",
      );
    },
    async restoreBackup(instance) {
      readExact(instance);
      throw safeQualificationRuntimeError(
        "qualification-runtime.restore-unsupported",
        "Qualification runtime database restores are unavailable.",
      );
    },
    async deleteRetained(instance, confirmation) {
      readExact(instance);
      if (
        confirmation.runtimeInstanceId !== instance.runtimeInstanceId ||
        confirmation.confirmation !== "delete-retained-runtime-data"
      ) {
        throw safeQualificationRuntimeError(
          "qualification-runtime.delete-confirmation",
          "Exact qualification runtime deletion confirmation is required.",
        );
      }
      records.delete(instance.runtimeInstanceId);
    },
    async acquire(instance) {
      const record = readExact(instance);
      return {
        runtimeInstanceId: instance.runtimeInstanceId,
        documents: record.documents,
        health: HEALTHY,
      };
    },
    async release(runtimeInstanceId) {
      normalizeSystemRuntimeInstanceId(runtimeInstanceId);
    },
    async closeAll() {
      records.clear();
    },
  };

  return adapter;
}

function safeQualificationRuntimeError(
  code: string,
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "VisualComposerQualificationRuntimeError";
  error.code = code;
  error.stack = undefined;
  return error;
}

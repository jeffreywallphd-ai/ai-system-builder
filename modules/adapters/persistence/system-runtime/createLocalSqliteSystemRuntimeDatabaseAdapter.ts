import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";
import path from "node:path";

import type {
  SystemRuntimeDatabaseLifecyclePort,
  ProvisionSystemRuntimeDatabaseRequest,
} from "../../../application/ports/system-deployment";
import {
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeDatabaseBackup,
  type SystemRuntimeDatabaseHealth,
  type SystemRuntimeInstance,
  type SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import {
  LOCAL_SQLITE_SCHEMA_VERSION,
  openLocalSqliteDatabase,
  restoreLocalSqliteDatabase,
  type OpenedLocalSqliteDatabase,
} from "../sqlite/sqlite-database";
import { resolveLocalSqliteDatabasePolicy } from "../sqlite/local-sqlite-database-policy";
import type {
  SystemRuntimeStructuredDataSession,
  SystemRuntimeStructuredDataSessionProvider,
} from "./system-runtime-structured-data-session";

const SAFE_BACKUP_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;

export interface CreateLocalSqliteSystemRuntimeDatabaseAdapterOptions {
  readonly dataRootDirectory: string;
  readonly maximumOpenDatabases?: number;
  readonly now?: () => string;
  readonly generateBackupId?: () => string;
}

export type LocalSqliteSystemRuntimeDatabaseAdapter =
  SystemRuntimeDatabaseLifecyclePort &
    SystemRuntimeStructuredDataSessionProvider & {
      closeAll(): Promise<void>;
    };

export function createLocalSqliteSystemRuntimeDatabaseAdapter(
  options: CreateLocalSqliteSystemRuntimeDatabaseAdapterOptions,
): LocalSqliteSystemRuntimeDatabaseAdapter {
  const root = path.resolve(options.dataRootDirectory, "runtime-data", "instances");
  const maximumOpenDatabases = normalizeMaximumOpen(
    options.maximumOpenDatabases ?? 8,
  );
  const now = options.now ?? (() => new Date().toISOString());
  const generateBackupId =
    options.generateBackupId ?? (() => `backup-${randomUUID()}`);
  const openDatabases = new Map<SystemRuntimeInstanceId, OpenedLocalSqliteDatabase>();

  const assertBinding = (instance: SystemRuntimeInstance) => {
    const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
      instance.runtimeInstanceId,
    );
    if (
      instance.databaseEngine !== "sqlite" ||
      instance.dataBindingId !== bindingId(runtimeInstanceId)
    ) {
      throw safeAdapterError(
        "runtime-database.binding-mismatch",
        "The runtime database binding is invalid.",
      );
    }
    return runtimeInstanceId;
  };

  const openExact = async (
    instance: SystemRuntimeInstance,
  ): Promise<OpenedLocalSqliteDatabase> => {
    const runtimeInstanceId = assertBinding(instance);
    const current = openDatabases.get(runtimeInstanceId);
    if (current) return current;
    if (openDatabases.size >= maximumOpenDatabases) {
      throw safeAdapterError(
        "runtime-database.connection-limit",
        "The runtime database connection limit has been reached.",
      );
    }
    const policy = policyFor(root, runtimeInstanceId);
    if (!(await exists(policy.databaseFilePath))) {
      throw safeAdapterError(
        "runtime-database.missing",
        "The provisioned runtime database is unavailable.",
      );
    }
    const opened = await openLocalSqliteDatabase({ policy, now });
    openDatabases.set(runtimeInstanceId, opened);
    return opened;
  };

  const adapter: LocalSqliteSystemRuntimeDatabaseAdapter = {
    async provision(request: ProvisionSystemRuntimeDatabaseRequest) {
      const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
        request.runtimeInstanceId,
      );
      const policy = policyFor(root, runtimeInstanceId);
      const opened = await openLocalSqliteDatabase({ policy, now });
      try {
        const health = opened.checkHealth();
        if (!health.healthy) {
          throw safeAdapterError(
            "runtime-database.provision-health",
            "The runtime database could not be initialized safely.",
          );
        }
      } finally {
        opened.close();
      }
      return {
        dataBindingId: bindingId(runtimeInstanceId),
        databaseEngine: "sqlite" as const,
      };
    },
    async open(instance) {
      return mapHealth((await openExact(instance)).checkHealth());
    },
    async migrate(instance) {
      const runtimeInstanceId = assertBinding(instance);
      await adapter.release(runtimeInstanceId);
      const policy = policyFor(root, runtimeInstanceId);
      if (!(await exists(policy.databaseFilePath))) {
        throw safeAdapterError(
          "runtime-database.missing",
          "The provisioned runtime database is unavailable.",
        );
      }
      const opened = await openLocalSqliteDatabase({ policy, now });
      try {
        return mapHealth(opened.checkHealth());
      } finally {
        opened.close();
      }
    },
    async close(instance) {
      await adapter.release(assertBinding(instance));
    },
    async retain(instance) {
      const runtimeInstanceId = assertBinding(instance);
      await adapter.release(runtimeInstanceId);
      if (!(await exists(policyFor(root, runtimeInstanceId).databaseFilePath))) {
        throw safeAdapterError(
          "runtime-database.missing",
          "The retained runtime database is unavailable.",
        );
      }
    },
    async createBackup(instance): Promise<SystemRuntimeDatabaseBackup> {
      const runtimeInstanceId = assertBinding(instance);
      const alreadyOpen = openDatabases.has(runtimeInstanceId);
      const opened = await openExact(instance);
      const backupId = normalizeBackupId(generateBackupId());
      const location = locations(root, runtimeInstanceId);
      const destination = contained(
        location.instanceDirectory,
        path.join(location.backupDirectory, `${backupId}.sqlite3`),
      );
      try {
        await opened.createBackup(destination);
      } finally {
        if (!alreadyOpen) await adapter.release(runtimeInstanceId);
      }
      return {
        backupId,
        runtimeInstanceId,
        createdAt: now(),
        verified: true,
      };
    },
    async restoreBackup(instance, backupId) {
      const runtimeInstanceId = assertBinding(instance);
      await adapter.release(runtimeInstanceId);
      const location = locations(root, runtimeInstanceId);
      const normalizedBackupId = normalizeBackupId(backupId);
      const backupPath = contained(
        location.instanceDirectory,
        path.join(location.backupDirectory, `${normalizedBackupId}.sqlite3`),
      );
      if (!(await exists(backupPath))) {
        throw safeAdapterError(
          "runtime-database.backup-missing",
          "The selected runtime database backup is unavailable.",
        );
      }
      await restoreLocalSqliteDatabase({
        backupPath,
        databasePath: location.databaseFilePath,
      });
      const opened = await openLocalSqliteDatabase({
        policy: policyFor(root, runtimeInstanceId),
        now,
      });
      try {
        return mapHealth(opened.checkHealth());
      } finally {
        opened.close();
      }
    },
    async deleteRetained(instance, confirmation) {
      const runtimeInstanceId = assertBinding(instance);
      if (
        confirmation.runtimeInstanceId !== runtimeInstanceId ||
        confirmation.confirmation !== "delete-retained-runtime-data"
      ) {
        throw safeAdapterError(
          "runtime-database.delete-confirmation",
          "Exact runtime database deletion confirmation is required.",
        );
      }
      await adapter.release(runtimeInstanceId);
      const location = locations(root, runtimeInstanceId);
      await rm(location.instanceDirectory, { recursive: true, force: true });
    },
    async acquire(instance): Promise<SystemRuntimeStructuredDataSession> {
      const runtimeInstanceId = assertBinding(instance);
      const opened = await openExact(instance);
      const health = mapHealth(opened.checkHealth());
      if (!health.healthy) {
        throw safeAdapterError(
          "runtime-database.not-ready",
          "The runtime database is not ready.",
        );
      }
      return {
        runtimeInstanceId,
        documents: opened.documents,
        health,
      };
    },
    async release(runtimeInstanceId) {
      const normalized = normalizeSystemRuntimeInstanceId(runtimeInstanceId);
      const opened = openDatabases.get(normalized);
      if (!opened) return;
      opened.close();
      openDatabases.delete(normalized);
    },
    async closeAll() {
      const ids = [...openDatabases.keys()];
      for (const runtimeInstanceId of ids) {
        await adapter.release(runtimeInstanceId);
      }
    },
  };
  return adapter;
}

export function resolveLocalSystemRuntimeDatabaseLocation(
  dataRootDirectory: string,
  runtimeInstanceId: SystemRuntimeInstanceId,
) {
  return locations(
    path.resolve(dataRootDirectory, "runtime-data", "instances"),
    normalizeSystemRuntimeInstanceId(runtimeInstanceId),
  );
}

function policyFor(root: string, runtimeInstanceId: SystemRuntimeInstanceId) {
  const location = locations(root, runtimeInstanceId);
  return resolveLocalSqliteDatabasePolicy({
    dataRootDirectory: location.instanceDirectory,
    databaseFileName: "runtime.sqlite3",
  });
}

function locations(root: string, runtimeInstanceId: SystemRuntimeInstanceId) {
  const instanceDirectory = contained(root, path.join(root, runtimeInstanceId));
  const persistenceDirectory = contained(
    instanceDirectory,
    path.join(instanceDirectory, "persistence"),
  );
  return {
    instanceDirectory,
    databaseFilePath: contained(
      instanceDirectory,
      path.join(persistenceDirectory, "runtime.sqlite3"),
    ),
    backupDirectory: contained(
      instanceDirectory,
      path.join(instanceDirectory, "backups"),
    ),
  };
}

function contained(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return resolvedCandidate;
  }
  throw safeAdapterError(
    "runtime-database.path-containment",
    "The runtime database location is invalid.",
  );
}

function bindingId(runtimeInstanceId: SystemRuntimeInstanceId) {
  return normalizeSystemRuntimeDataBindingId(`sqlite:${runtimeInstanceId}`);
}

function normalizeBackupId(value: string): string {
  const normalized = value.trim();
  if (
    !SAFE_BACKUP_ID.test(normalized) ||
    normalized.includes("..") ||
    /[\\/]/.test(normalized)
  ) {
    throw safeAdapterError(
      "runtime-database.backup-id",
      "The runtime database backup id is invalid.",
    );
  }
  return normalized;
}

function normalizeMaximumOpen(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new Error("maximumOpenDatabases must be an integer from 1 through 64.");
  }
  return value;
}

function mapHealth(
  health: ReturnType<OpenedLocalSqliteDatabase["checkHealth"]>,
): SystemRuntimeDatabaseHealth {
  return {
    healthy: health.healthy,
    schemaVersion: health.schemaVersion,
    expectedSchemaVersion: health.expectedSchemaVersion,
    ...(!health.healthy
      ? { diagnosticCode: "runtime-database.health-check-failed" }
      : {}),
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeAdapterError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "SystemRuntimeDatabaseAdapterError";
  error.code = code;
  error.stack = undefined;
  return error;
}

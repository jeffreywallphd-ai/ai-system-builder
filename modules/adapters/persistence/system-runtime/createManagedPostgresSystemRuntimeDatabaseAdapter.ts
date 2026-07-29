import { createHash, randomBytes } from "node:crypto";

import type {
  ProvisionSystemRuntimeDatabaseRequest,
  SystemRuntimeDatabaseLifecyclePort,
} from "../../../application/ports/system-deployment";
import {
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeDatabaseBackup,
  type SystemRuntimeInstance,
  type SystemRuntimeInstanceId,
} from "../../../contracts/system-deployment";
import {
  openPostgresDatabase,
  type OpenedPostgresDatabase,
} from "../postgres/postgres-database";
import {
  createPostgresPool,
  resolvePostgresPoolConfig,
  type PostgresPoolLike,
  type ResolvedPostgresPoolConfig,
} from "../postgres/client/createPostgresPool";
import type {
  SystemRuntimeStructuredDataSession,
  SystemRuntimeStructuredDataSessionProvider,
} from "./system-runtime-structured-data-session";
import type { SystemRuntimePostgresCredentialStore } from "./system-runtime-postgres-credential-store";

export interface ManagedSystemRuntimeDatabaseRecoveryPort {
  createBackup(request: {
    readonly runtimeInstanceId: SystemRuntimeInstanceId;
    readonly databaseName: string;
  }): Promise<{ backupId: string; verified: boolean }>;
  restoreBackup(request: {
    readonly runtimeInstanceId: SystemRuntimeInstanceId;
    readonly databaseName: string;
    readonly backupId: string;
  }): Promise<void>;
}

export interface CreateManagedPostgresSystemRuntimeDatabaseAdapterOptions {
  readonly provisioningConfig: ResolvedPostgresPoolConfig;
  readonly credentials: SystemRuntimePostgresCredentialStore;
  readonly recovery?: ManagedSystemRuntimeDatabaseRecoveryPort;
  readonly maximumOpenDatabases?: number;
  readonly runtimePoolMaximum?: number;
  readonly now?: () => string;
  readonly generatePassword?: () => string;
  readonly createPool?: (config: ResolvedPostgresPoolConfig) => PostgresPoolLike;
  readonly openDatabase?: typeof openPostgresDatabase;
}

export type ManagedPostgresSystemRuntimeDatabaseAdapter =
  SystemRuntimeDatabaseLifecyclePort &
    SystemRuntimeStructuredDataSessionProvider & {
      closeAll(): Promise<void>;
    };

export function createManagedPostgresSystemRuntimeDatabaseAdapter(
  options: CreateManagedPostgresSystemRuntimeDatabaseAdapterOptions,
): ManagedPostgresSystemRuntimeDatabaseAdapter {
  const maximumOpenDatabases = boundedInteger(
    options.maximumOpenDatabases ?? 32,
    1,
    128,
    "maximumOpenDatabases",
  );
  const runtimePoolMaximum = boundedInteger(
    options.runtimePoolMaximum ?? 4,
    1,
    16,
    "runtimePoolMaximum",
  );
  const now = options.now ?? (() => new Date().toISOString());
  const generatePassword =
    options.generatePassword ?? (() => randomBytes(32).toString("base64url"));
  const createPool = options.createPool ?? createPostgresPool;
  const openDatabase = options.openDatabase ?? openPostgresDatabase;
  const openDatabases = new Map<SystemRuntimeInstanceId, OpenedPostgresDatabase>();

  const assertBinding = (instance: SystemRuntimeInstance) => {
    const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
      instance.runtimeInstanceId,
    );
    if (
      instance.databaseEngine !== "postgres" ||
      instance.dataBindingId !== bindingId(runtimeInstanceId)
    ) {
      throw safeAdapterError(
        "runtime-database.binding-mismatch",
        "The runtime database binding is invalid.",
      );
    }
    return runtimeInstanceId;
  };

  const openExact = async (instance: SystemRuntimeInstance) => {
    const runtimeInstanceId = assertBinding(instance);
    const existing = openDatabases.get(runtimeInstanceId);
    if (existing) return existing;
    if (openDatabases.size >= maximumOpenDatabases) {
      throw safeAdapterError(
        "runtime-database.connection-limit",
        "The runtime database connection limit has been reached.",
      );
    }
    const credential = await options.credentials.read(runtimeInstanceId);
    if (
      !credential ||
      credential.dataBindingId !== instance.dataBindingId ||
      databaseNameFromUrl(credential.connectionString) !==
        names(runtimeInstanceId).database
    ) {
      throw safeAdapterError(
        "runtime-database.credential-missing",
        "The runtime database credential is unavailable.",
      );
    }
    const config = resolvePostgresPoolConfig({
      DATABASE_URL: credential.connectionString,
      POSTGRES_SSL_MODE: options.provisioningConfig.sslMode,
      POSTGRES_SSL_CA_PEM: options.provisioningConfig.sslCaPem,
      POSTGRES_POOL_MAX: String(runtimePoolMaximum),
      POSTGRES_CONNECTION_TIMEOUT_MS: String(
        options.provisioningConfig.connectionTimeoutMs,
      ),
      POSTGRES_IDLE_TIMEOUT_MS: String(options.provisioningConfig.idleTimeoutMs),
      POSTGRES_STATEMENT_TIMEOUT_MS: String(
        options.provisioningConfig.statementTimeoutMs,
      ),
      POSTGRES_APPLICATION_NAME: "ai-system-builder-system-runtime",
    });
    const opened = await openDatabase({
      config,
      migrate: false,
      now,
    });
    openDatabases.set(runtimeInstanceId, opened);
    return opened;
  };

  const adapter: ManagedPostgresSystemRuntimeDatabaseAdapter = {
    async provision(request: ProvisionSystemRuntimeDatabaseRequest) {
      const runtimeInstanceId = normalizeSystemRuntimeInstanceId(
        request.runtimeInstanceId,
      );
      const selected = names(runtimeInstanceId);
      const existing = await options.credentials.read(runtimeInstanceId);
      const password =
        existing?.connectionString &&
        databaseNameFromUrl(existing.connectionString) === selected.database
          ? new URL(existing.connectionString).password
          : normalizePassword(generatePassword());
      const administrator = createPool(options.provisioningConfig);
      try {
        const role = await administrator.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
          [selected.role],
        );
        if (!role.rows[0]?.exists) {
          await administrator.query(
            `CREATE ROLE ${quoteIdentifier(selected.role)} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
          );
        } else if (!existing) {
          await administrator.query(
            `ALTER ROLE ${quoteIdentifier(selected.role)} PASSWORD ${quoteLiteral(password)}`,
          );
        }
        await administrator.query(
          `ALTER ROLE ${quoteIdentifier(selected.role)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
        );
        const database = await administrator.query<{ exists: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
          [selected.database],
        );
        if (!database.rows[0]?.exists) {
          await administrator.query(
            `CREATE DATABASE ${quoteIdentifier(selected.database)}`,
          );
        }
        await administrator.query(
          `REVOKE CONNECT ON DATABASE ${quoteIdentifier(selected.database)} FROM PUBLIC`,
        );
        await administrator.query(
          `GRANT CONNECT ON DATABASE ${quoteIdentifier(selected.database)} TO ${quoteIdentifier(selected.role)}`,
        );
      } finally {
        await administrator.end();
      }

      const provisionerConfig = withDatabase(
        options.provisioningConfig,
        selected.database,
        "ai-system-builder-runtime-provisioner",
      );
      const provisionerPool = createPool(provisionerConfig);
      const provisioned = await openDatabase({
        config: provisionerConfig,
        pool: provisionerPool,
        now,
      });
      try {
        await provisionerPool.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
        await provisionerPool.query(
          `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(selected.role)}`,
        );
        await provisionerPool.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(selected.role)}`,
        );
        await provisionerPool.query(
          `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(selected.role)}`,
        );
        await provisionerPool.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdentifier(selected.role)}`,
        );
        await provisionerPool.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdentifier(selected.role)}`,
        );
      } finally {
        await provisioned.close();
      }

      const connectionString = runtimeConnectionString(
        options.provisioningConfig.connectionString,
        selected.database,
        selected.role,
        password,
      );
      await options.credentials.write({
        runtimeInstanceId,
        dataBindingId: bindingId(runtimeInstanceId),
        connectionString,
        updatedAt: now(),
      });
      return {
        dataBindingId: bindingId(runtimeInstanceId),
        databaseEngine: "postgres" as const,
      };
    },
    async open(instance) {
      return mapHealth(await (await openExact(instance)).checkHealth());
    },
    async migrate(instance) {
      const runtimeInstanceId = assertBinding(instance);
      await adapter.release(runtimeInstanceId);
      const migrationConfig = withDatabase(
        options.provisioningConfig,
        names(runtimeInstanceId).database,
        "ai-system-builder-runtime-migration",
      );
      const migrationPool = createPool(migrationConfig);
      const opened = await openDatabase({
        config: migrationConfig,
        pool: migrationPool,
        now,
      });
      try {
        return mapHealth(await opened.checkHealth());
      } finally {
        await opened.close();
      }
    },
    async close(instance) {
      await adapter.release(assertBinding(instance));
    },
    async retain(instance) {
      const runtimeInstanceId = assertBinding(instance);
      await adapter.release(runtimeInstanceId);
      if (!(await options.credentials.read(runtimeInstanceId))) {
        throw safeAdapterError(
          "runtime-database.credential-missing",
          "The retained runtime database credential is unavailable.",
        );
      }
    },
    async createBackup(instance): Promise<SystemRuntimeDatabaseBackup> {
      const runtimeInstanceId = assertBinding(instance);
      if (!options.recovery) {
        throw safeAdapterError(
          "runtime-database.recovery-unavailable",
          "Managed runtime database recovery is not configured.",
        );
      }
      const result = await options.recovery.createBackup({
        runtimeInstanceId,
        databaseName: names(runtimeInstanceId).database,
      });
      return {
        backupId: result.backupId,
        runtimeInstanceId,
        createdAt: now(),
        verified: result.verified,
      };
    },
    async restoreBackup(instance, backupId) {
      const runtimeInstanceId = assertBinding(instance);
      if (!options.recovery) {
        throw safeAdapterError(
          "runtime-database.recovery-unavailable",
          "Managed runtime database recovery is not configured.",
        );
      }
      await adapter.release(runtimeInstanceId);
      await options.recovery.restoreBackup({
        runtimeInstanceId,
        databaseName: names(runtimeInstanceId).database,
        backupId,
      });
      const opened = await openExact(instance);
      const health = mapHealth(await opened.checkHealth());
      await adapter.release(runtimeInstanceId);
      return health;
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
      const selected = names(runtimeInstanceId);
      const administrator = createPool(options.provisioningConfig);
      try {
        await administrator.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(selected.database)} WITH (FORCE)`,
        );
        await administrator.query(
          `DROP ROLE IF EXISTS ${quoteIdentifier(selected.role)}`,
        );
      } finally {
        await administrator.end();
      }
      await options.credentials.delete(runtimeInstanceId);
    },
    async acquire(instance): Promise<SystemRuntimeStructuredDataSession> {
      const runtimeInstanceId = assertBinding(instance);
      const opened = await openExact(instance);
      const health = mapHealth(await opened.checkHealth());
      if (!health.healthy) {
        throw safeAdapterError(
          "runtime-database.not-ready",
          "The runtime database is not ready.",
        );
      }
      return { runtimeInstanceId, documents: opened.documents, health };
    },
    async release(runtimeInstanceId) {
      const normalized = normalizeSystemRuntimeInstanceId(runtimeInstanceId);
      const opened = openDatabases.get(normalized);
      if (!opened) return;
      await opened.close();
      openDatabases.delete(normalized);
    },
    async closeAll() {
      for (const runtimeInstanceId of [...openDatabases.keys()]) {
        await adapter.release(runtimeInstanceId);
      }
    },
  };
  return adapter;
}

export function deriveManagedSystemRuntimeDatabaseNames(
  runtimeInstanceId: SystemRuntimeInstanceId,
) {
  return names(normalizeSystemRuntimeInstanceId(runtimeInstanceId));
}

function names(runtimeInstanceId: SystemRuntimeInstanceId) {
  const suffix = createHash("sha256")
    .update(runtimeInstanceId, "utf8")
    .digest("hex")
    .slice(0, 24);
  return {
    database: `aisb_runtime_${suffix}`,
    role: `aisb_runtime_role_${suffix}`,
  };
}

function bindingId(runtimeInstanceId: SystemRuntimeInstanceId) {
  return normalizeSystemRuntimeDataBindingId(`postgres:${runtimeInstanceId}`);
}

function runtimeConnectionString(
  source: string,
  database: string,
  username: string,
  password: string,
): string {
  const url = new URL(source);
  url.username = username;
  url.password = password;
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function withDatabase(
  config: ResolvedPostgresPoolConfig,
  database: string,
  applicationName: string,
): ResolvedPostgresPoolConfig {
  const url = new URL(config.connectionString);
  url.pathname = `/${database}`;
  return { ...config, connectionString: url.toString(), applicationName };
}

function databaseNameFromUrl(connectionString: string): string {
  return decodeURIComponent(
    new URL(connectionString).pathname.replace(/^\/+/, ""),
  );
}

function normalizePassword(value: string): string {
  if (!/^[a-zA-Z0-9_-]{32,160}$/.test(value)) {
    throw new Error("Generated runtime database password is invalid.");
  }
  return value;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error("Derived PostgreSQL identifier is invalid.");
  }
  return `"${value}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function mapHealth(
  health: Awaited<ReturnType<OpenedPostgresDatabase["checkHealth"]>>,
) {
  return {
    healthy: health.healthy,
    schemaVersion: health.schemaVersion,
    expectedSchemaVersion: health.expectedSchemaVersion,
    ...(!health.healthy
      ? { diagnosticCode: "runtime-database.health-check-failed" }
      : {}),
  };
}

function safeAdapterError(
  code: string,
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "SystemRuntimeDatabaseAdapterError";
  error.code = code;
  error.stack = undefined;
  return error;
}

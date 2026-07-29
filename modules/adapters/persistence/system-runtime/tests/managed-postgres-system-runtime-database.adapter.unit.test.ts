import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../shared";
import type {
  PostgresPoolLike,
  ResolvedPostgresPoolConfig,
} from "../../postgres/client/createPostgresPool";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstance,
} from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createManagedPostgresSystemRuntimeDatabaseAdapter,
  deriveManagedSystemRuntimeDatabaseNames,
} from "../createManagedPostgresSystemRuntimeDatabaseAdapter";
import type {
  SystemRuntimePostgresCredential,
  SystemRuntimePostgresCredentialStore,
} from "../system-runtime-postgres-credential-store";

const now = () => "2026-07-29T15:00:00.000Z";
const provisioningConfig: ResolvedPostgresPoolConfig = {
  connectionString: "postgresql://provisioner:secret@database.example/control",
  sslMode: "verify-full",
  maxConnections: 4,
  connectionTimeoutMs: 1_000,
  idleTimeoutMs: 5_000,
  statementTimeoutMs: 5_000,
  applicationName: "runtime-provisioner-test",
};

function instance(id: string): SystemRuntimeInstance {
  const runtimeInstanceId = normalizeSystemRuntimeInstanceId(id);
  return {
    runtimeInstanceId,
    dataBindingId: normalizeSystemRuntimeDataBindingId(
      `postgres:${runtimeInstanceId}`,
    ),
    databaseEngine: "postgres",
    organizationId: createOrganizationId("org-runtime"),
    workspaceId: createWorkspaceId("workspace-runtime"),
    deploymentId: normalizeSystemDeploymentId(`deployment-${id}`),
    releaseId: normalizeSystemReleaseId("release-runtime"),
    status: "allocated",
    revision: 0,
    createdAt: now(),
    updatedAt: now(),
  };
}

function createCredentialStore() {
  const values = new Map<string, SystemRuntimePostgresCredential>();
  const store: SystemRuntimePostgresCredentialStore = {
    async read(runtimeInstanceId) {
      return values.get(runtimeInstanceId);
    },
    async write(value) {
      values.set(value.runtimeInstanceId, value);
    },
    async delete(runtimeInstanceId) {
      values.delete(runtimeInstanceId);
    },
  };
  return { store, values };
}

test("managed provisioner derives non-semantic names and separates runtime credentials", async () => {
  const credentials = createCredentialStore();
  const queries: Array<{ applicationName: string; text: string }> = [];
  const openCalls: Array<{
    applicationName: string;
    migrate: boolean | undefined;
    connectionString: string;
  }> = [];
  const createPool = (config: ResolvedPostgresPoolConfig): PostgresPoolLike =>
    ({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      async query(text: string) {
        queries.push({ applicationName: config.applicationName, text });
        if (text.includes("pg_roles")) {
          return { rows: [{ exists: false }], rowCount: 1 } as never;
        }
        if (text.includes("pg_database")) {
          return { rows: [{ exists: false }], rowCount: 1 } as never;
        }
        return { rows: [], rowCount: 0 } as never;
      },
      async connect() {
        throw new Error("The injected openDatabase owns test startup.");
      },
      async end() {},
    }) as PostgresPoolLike;
  const adapter = createManagedPostgresSystemRuntimeDatabaseAdapter({
    provisioningConfig,
    credentials: credentials.store,
    createPool,
    generatePassword: () => "A".repeat(40),
    now,
    async openDatabase(options) {
      openCalls.push({
        applicationName: options.config.applicationName,
        migrate: options.migrate,
        connectionString: options.config.connectionString,
      });
      return {
        documents: createInMemoryStructuredDocumentStore(now),
        async checkHealth() {
          return {
            healthy: true,
            schemaVersion: 2,
            expectedSchemaVersion: 2,
            queryLatencyMs: 1,
            pool: {
              total: 1,
              idle: 1,
              waiting: 0,
              idleClientErrorCount: 0,
            },
          };
        },
        async close() {},
      };
    },
  });

  const first = instance("runtime-postgres-a");
  const second = instance("runtime-postgres-b");
  await adapter.provision(first);
  await adapter.provision(second);

  const firstNames = deriveManagedSystemRuntimeDatabaseNames(
    first.runtimeInstanceId,
  );
  const secondNames = deriveManagedSystemRuntimeDatabaseNames(
    second.runtimeInstanceId,
  );
  assert.notEqual(firstNames.database, secondNames.database);
  assert.notEqual(firstNames.role, secondNames.role);
  assert.doesNotMatch(firstNames.database, /runtime-postgres/);
  assert.match(
    queries.map((entry) => entry.text).join("\n"),
    /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/,
  );
  assert.match(
    queries.map((entry) => entry.text).join("\n"),
    /REVOKE CONNECT ON DATABASE/,
  );
  assert.equal(
    new URL(credentials.values.get(first.runtimeInstanceId)!.connectionString)
      .pathname,
    `/${firstNames.database}`,
  );

  await adapter.acquire(first);
  const runtimeOpen = openCalls[openCalls.length - 1]!;
  assert.equal(runtimeOpen.migrate, false);
  assert.equal(
    new URL(runtimeOpen.connectionString).username,
    firstNames.role,
  );
  assert.notEqual(
    new URL(runtimeOpen.connectionString).username,
    new URL(provisioningConfig.connectionString).username,
  );
  await adapter.release(first.runtimeInstanceId);
  assert.equal((await adapter.migrate(first)).healthy, true);
  const migrationOpen = openCalls[openCalls.length - 1]!;
  assert.equal(migrationOpen.migrate, undefined);
  assert.equal(
    migrationOpen.applicationName,
    "ai-system-builder-runtime-migration",
  );
});

test("managed runtime denies mismatched bindings and unavailable recovery", async () => {
  const credentials = createCredentialStore();
  const adapter = createManagedPostgresSystemRuntimeDatabaseAdapter({
    provisioningConfig,
    credentials: credentials.store,
    createPool: () =>
      ({
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        async query() {
          return { rows: [], rowCount: 0 } as never;
        },
        async connect() {
          throw new Error("unused");
        },
        async end() {},
      }) as PostgresPoolLike,
  });
  const selected = instance("runtime-postgres-denial");
  await assert.rejects(
    () =>
      adapter.open({
        ...selected,
        dataBindingId: normalizeSystemRuntimeDataBindingId(
          "postgres:runtime-postgres-foreign",
        ),
      }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-database.binding-mismatch",
  );
  await assert.rejects(
    () => adapter.createBackup(selected),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-database.recovery-unavailable",
  );
});

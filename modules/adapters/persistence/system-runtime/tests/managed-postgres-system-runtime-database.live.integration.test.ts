import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstance,
  type SystemRuntimeInstanceId,
} from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createPostgresPool,
  resolvePostgresPoolConfig,
} from "../../postgres/client/createPostgresPool";
import { createManagedPostgresSystemRuntimeDatabaseAdapter } from "../createManagedPostgresSystemRuntimeDatabaseAdapter";
import type {
  SystemRuntimePostgresCredential,
  SystemRuntimePostgresCredentialStore,
} from "../system-runtime-postgres-credential-store";

const liveDatabaseUrl = process.env.TEST_POSTGRES_URL?.trim();

test(
  "managed PostgreSQL runtime databases enforce physical and least-privilege isolation",
  { skip: !liveDatabaseUrl },
  async () => {
    const provisioningConfig = resolvePostgresPoolConfig({
      DATABASE_URL: liveDatabaseUrl,
      POSTGRES_SSL_MODE: process.env.TEST_POSTGRES_SSL_MODE ?? "disable",
      POSTGRES_APPLICATION_NAME: "ai-system-builder-runtime-qualification",
    });
    const credentials = createInMemoryCredentialStore();
    const databases = createManagedPostgresSystemRuntimeDatabaseAdapter({
      provisioningConfig,
      credentials,
      runtimePoolMaximum: 2,
      maximumOpenDatabases: 2,
    });
    const firstId = normalizeSystemRuntimeInstanceId(
      `system-runtime-instance.${randomUUID()}`,
    );
    const secondId = normalizeSystemRuntimeInstanceId(
      `system-runtime-instance.${randomUUID()}`,
    );
    const organizationId = createOrganizationId(`org-${randomUUID()}`);
    const workspaceId = createWorkspaceId(`workspace-${randomUUID()}`);
    const firstProvisioned = await databases.provision({
      runtimeInstanceId: firstId,
      organizationId,
      workspaceId,
    });
    const secondProvisioned = await databases.provision({
      runtimeInstanceId: secondId,
      organizationId,
      workspaceId,
    });
    const first = runtimeInstance(
      firstId,
      firstProvisioned.dataBindingId,
      organizationId,
      workspaceId,
    );
    const second = runtimeInstance(
      secondId,
      secondProvisioned.dataBindingId,
      organizationId,
      workspaceId,
    );

    try {
      const firstSession = await databases.acquire(first);
      const secondSession = await databases.acquire(second);
      const namespace = `runtime-qualification-${randomUUID()}`;
      const firstDocuments = firstSession.documents.forOrganization(organizationId);
      const secondDocuments = secondSession.documents.forOrganization(organizationId);
      await firstDocuments.writeDocument(namespace, "shared", {
        runtime: "first",
      });
      await secondDocuments.writeDocument(namespace, "shared", {
        runtime: "second",
      });
      assert.equal(
        (
          await firstDocuments.readDocument<{ runtime: string }>(
            namespace,
            "shared",
          )
        )?.value.runtime,
        "first",
      );
      assert.equal(
        (
          await secondDocuments.readDocument<{ runtime: string }>(
            namespace,
            "shared",
          )
        )?.value.runtime,
        "second",
      );
      await databases.release(firstId);
      await databases.release(secondId);
      assert.equal((await databases.migrate(first)).healthy, true);
      const migratedSession = await databases.acquire(first);
      assert.equal(
        (
          await migratedSession.documents
            .forOrganization(organizationId)
            .readDocument<{ runtime: string }>(namespace, "shared")
        )?.value.runtime,
        "first",
      );
      await databases.release(firstId);

      const firstCredential = await credentials.read(firstId);
      const secondCredential = await credentials.read(secondId);
      assert.ok(firstCredential);
      assert.ok(secondCredential);
      assert.notEqual(
        new URL(firstCredential.connectionString).username,
        new URL(provisioningConfig.connectionString).username,
      );
      assert.notEqual(
        new URL(firstCredential.connectionString).username,
        new URL(secondCredential.connectionString).username,
      );

      const foreignDatabaseUrl = new URL(firstCredential.connectionString);
      foreignDatabaseUrl.pathname = new URL(
        secondCredential.connectionString,
      ).pathname;
      await assert.rejects(
        () => queryAsRuntime(foreignDatabaseUrl.toString(), "SELECT 1"),
        (error: unknown) => postgresCode(error) === "42501",
      );
      for (const statement of [
        `CREATE DATABASE forbidden_${randomUUID().replaceAll("-", "")}`,
        `CREATE ROLE forbidden_${randomUUID().replaceAll("-", "")}`,
        `CREATE TABLE forbidden_${randomUUID().replaceAll("-", "")} (id integer)`,
      ]) {
        await assert.rejects(
          () => queryAsRuntime(firstCredential.connectionString, statement),
          (error: unknown) => postgresCode(error) === "42501",
        );
      }
    } finally {
      await databases.closeAll();
      await databases.deleteRetained(first, {
        runtimeInstanceId: firstId,
        confirmation: "delete-retained-runtime-data",
      });
      await databases.deleteRetained(second, {
        runtimeInstanceId: secondId,
        confirmation: "delete-retained-runtime-data",
      });
    }
  },
);

function runtimeInstance(
  runtimeInstanceId: SystemRuntimeInstanceId,
  dataBindingId: SystemRuntimeInstance["dataBindingId"],
  organizationId: SystemRuntimeInstance["organizationId"],
  workspaceId: SystemRuntimeInstance["workspaceId"],
): SystemRuntimeInstance {
  const suffix = runtimeInstanceId.slice(-24);
  return {
    runtimeInstanceId,
    dataBindingId,
    databaseEngine: "postgres",
    organizationId,
    workspaceId,
    deploymentId: normalizeSystemDeploymentId(`deployment-${suffix}`),
    releaseId: normalizeSystemReleaseId(`release-${suffix}`),
    status: "active",
    revision: 1,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  };
}

function createInMemoryCredentialStore(): SystemRuntimePostgresCredentialStore {
  const values = new Map<SystemRuntimeInstanceId, SystemRuntimePostgresCredential>();
  return {
    async read(runtimeInstanceId) {
      return values.get(runtimeInstanceId);
    },
    async write(credential) {
      values.set(credential.runtimeInstanceId, credential);
    },
    async delete(runtimeInstanceId) {
      values.delete(runtimeInstanceId);
    },
  };
}

async function queryAsRuntime(
  connectionString: string,
  statement: string,
): Promise<void> {
  const pool = createPostgresPool(
    resolvePostgresPoolConfig({
      DATABASE_URL: connectionString,
      POSTGRES_SSL_MODE: process.env.TEST_POSTGRES_SSL_MODE ?? "disable",
      POSTGRES_POOL_MAX: "1",
      POSTGRES_CONNECTION_TIMEOUT_MS: "2000",
      POSTGRES_STATEMENT_TIMEOUT_MS: "2000",
      POSTGRES_APPLICATION_NAME: "ai-system-builder-runtime-denial-test",
    }),
  );
  try {
    await pool.query(statement);
  } finally {
    await pool.end();
  }
}

function postgresCode(error: unknown): string | undefined {
  return error && typeof error === "object"
    ? (error as { code?: string }).code
    : undefined;
}

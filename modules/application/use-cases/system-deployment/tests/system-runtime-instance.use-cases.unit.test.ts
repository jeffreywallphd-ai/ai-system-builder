import assert from "node:assert/strict";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemRuntimeInstanceRepository } from "../../../../adapters/persistence/system-deployment";
import type { SystemRuntimeDatabaseLifecyclePort } from "../../../ports/system-deployment";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstance,
} from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemRuntimeInstanceLifecycleService } from "../system-runtime-instance.use-cases";

const now = () => "2026-07-29T14:00:00.000Z";
const organizationId = createOrganizationId("org-runtime-a");
const workspaceId = createWorkspaceId("workspace-runtime-a");
const deploymentId = normalizeSystemDeploymentId("deployment-runtime-a");
const releaseId = normalizeSystemReleaseId("release-runtime-a");
const runtimeInstanceId = normalizeSystemRuntimeInstanceId("runtime-instance-a");

function createHarness() {
  const documents = createInMemoryStructuredDocumentStore(now);
  const repository = createStructuredSystemRuntimeInstanceRepository(documents);
  const calls = {
    provision: 0,
    open: 0,
    migrate: 0,
    close: 0,
    retain: 0,
    delete: 0,
  };
  const databases: SystemRuntimeDatabaseLifecyclePort = {
    async provision(request) {
      calls.provision += 1;
      return {
        dataBindingId: normalizeSystemRuntimeDataBindingId(
          `sqlite:${request.runtimeInstanceId}`,
        ),
        databaseEngine: "sqlite",
      };
    },
    async open() {
      calls.open += 1;
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async migrate() {
      calls.migrate += 1;
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async close() {
      calls.close += 1;
    },
    async retain() {
      calls.retain += 1;
    },
    async createBackup(instance) {
      return {
        backupId: "backup-1",
        runtimeInstanceId: instance.runtimeInstanceId,
        createdAt: now(),
        verified: true,
      };
    },
    async restoreBackup() {
      return { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 };
    },
    async deleteRetained() {
      calls.delete += 1;
    },
  };
  return {
    repository,
    databases,
    calls,
    service: new SystemRuntimeInstanceLifecycleService({
      repository,
      databases,
      now,
    }),
  };
}

test("runtime instance identifiers reject paths and traversal", () => {
  assert.throws(
    () => normalizeSystemRuntimeInstanceId("../foreign"),
    /opaque identifier/,
  );
  assert.throws(
    () => normalizeSystemRuntimeInstanceId("folder\\foreign"),
    /opaque identifier/,
  );
  assert.throws(
    () => normalizeSystemRuntimeDataBindingId("sqlite/foreign"),
    /opaque identifier/,
  );
});

test("allocation is idempotent for one deployment and never reuses a different identity", async () => {
  const h = createHarness();
  const request = {
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId,
    releaseId,
  };
  const first = await h.service.allocate(request);
  const second = await h.service.allocate(request);
  assert.equal(first.runtimeInstanceId, runtimeInstanceId);
  assert.equal(second.runtimeInstanceId, runtimeInstanceId);
  assert.equal(h.calls.provision, 1);
  await assert.rejects(
    () =>
      h.service.allocate({
        ...request,
        runtimeInstanceId: normalizeSystemRuntimeInstanceId(
          "runtime-instance-b",
        ),
      }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-instance.allocation-conflict",
  );
});

test("lifecycle opens, stops, retains, and requires exact destructive confirmation", async () => {
  const h = createHarness();
  const allocated = await h.service.allocate({
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId,
    releaseId,
  });
  const active = await h.service.activate(allocated);
  const stopped = await h.service.stop(active);
  const retained = await h.service.retain(stopped);
  assert.deepEqual(
    [active.status, stopped.status, retained.status],
    ["active", "stopped", "retained"],
  );
  await assert.rejects(
    () =>
      h.service.deleteRetained(retained, {
        runtimeInstanceId:
          normalizeSystemRuntimeInstanceId("runtime-instance-b"),
        confirmation: "delete-retained-runtime-data",
      }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-instance.delete-confirmation",
  );
  const deleted = await h.service.deleteRetained(retained, {
    runtimeInstanceId,
    confirmation: "delete-retained-runtime-data",
  });
  assert.equal(deleted.status, "deleted");
  assert.equal(h.calls.delete, 1);
});

test("a stopped compatible upgrade retains one database and binds the new deployment explicitly", async () => {
  const h = createHarness();
  const allocated = await h.service.allocate({
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId,
    releaseId,
  });
  const stopped = await h.service.stop(await h.service.activate(allocated));
  const nextDeploymentId = normalizeSystemDeploymentId("deployment-runtime-b");
  const nextReleaseId = normalizeSystemReleaseId("release-runtime-b");
  const migrated = await h.service.migrate(stopped, {
    deploymentId: nextDeploymentId,
    releaseId: nextReleaseId,
  });
  assert.equal(migrated.runtimeInstanceId, runtimeInstanceId);
  assert.equal(migrated.dataBindingId, allocated.dataBindingId);
  assert.equal(migrated.deploymentBindings?.length, 2);
  assert.equal(h.calls.migrate, 1);
  assert.equal(
    (
      await h.repository.readRuntimeInstanceByDeployment(
        organizationId,
        workspaceId,
        nextDeploymentId,
      )
    )?.runtimeInstanceId,
    runtimeInstanceId,
  );
  await assert.rejects(
    () =>
      h.service.migrate(awaitedActive(migrated), {
        deploymentId: normalizeSystemDeploymentId("deployment-runtime-c"),
        releaseId: normalizeSystemReleaseId("release-runtime-c"),
      }),
    (error: unknown) =>
      (error as { code?: string }).code === "runtime-instance.migration-conflict",
  );
});

function awaitedActive(instance: SystemRuntimeInstance): SystemRuntimeInstance {
  return { ...instance, status: "active" };
}

test("restore is denied while active and adapter failures remain sanitized", async () => {
  const h = createHarness();
  const allocated = await h.service.allocate({
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId,
    releaseId,
  });
  const active = await h.service.activate(allocated);
  await assert.rejects(
    () => h.service.restore(active, "backup-1"),
    (error: unknown) =>
      (error as { code?: string }).code ===
        "runtime-instance.restore-active" && !(error as Error).stack,
  );
  const failing = new SystemRuntimeInstanceLifecycleService({
    repository: h.repository,
    databases: {
      ...h.databases,
      async open() {
        throw new Error("private runtime path and secret");
      },
    },
    now,
  });
  await assert.rejects(
    () => failing.activate(allocated),
    (error: unknown) => {
      const safe = error as Error & { code?: string };
      return (
        safe.code === "runtime-instance.open-failed" &&
        !safe.message.includes("private") &&
        !safe.stack
      );
    },
  );
  const stopped = await h.service.stop(active);
  const migrationFailure = new SystemRuntimeInstanceLifecycleService({
    repository: h.repository,
    databases: {
      ...h.databases,
      async migrate() {
        throw new Error("private provisioner credential and database name");
      },
    },
    now,
  });
  await assert.rejects(
    () =>
      migrationFailure.migrate(stopped, {
        deploymentId: normalizeSystemDeploymentId("deployment-runtime-failed"),
        releaseId: normalizeSystemReleaseId("release-runtime-failed"),
      }),
    (error: unknown) => {
      const safe = error as Error & { code?: string };
      return (
        safe.code === "runtime-instance.migration-failed" &&
        !safe.message.includes("credential") &&
        !safe.stack
      );
    },
  );
});

test("control-plane repository isolates organizations and enforces revisions", async () => {
  const h = createHarness();
  const created = await h.service.allocate({
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId,
    releaseId,
  });
  assert.equal(
    await h.repository.readRuntimeInstance(
      createOrganizationId("org-runtime-b"),
      workspaceId,
      runtimeInstanceId,
    ),
    undefined,
  );
  const invalidRevision: SystemRuntimeInstance = {
    ...created,
    status: "stopped",
    revision: 4,
  };
  await assert.rejects(() =>
    h.repository.updateRuntimeInstance(invalidRevision, 0),
  );
});

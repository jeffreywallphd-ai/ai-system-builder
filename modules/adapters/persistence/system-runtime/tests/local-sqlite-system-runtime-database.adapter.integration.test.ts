import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import electronPath from "electron";

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
  createLocalSqliteSystemRuntimeDatabaseAdapter,
  resolveLocalSystemRuntimeDatabaseLocation,
} from "../createLocalSqliteSystemRuntimeDatabaseAdapter";

const now = () => "2026-07-29T14:30:00.000Z";

const isElectronNode = typeof process.versions.electron === "string";

function instance(id: string): SystemRuntimeInstance {
  const runtimeInstanceId = normalizeSystemRuntimeInstanceId(id);
  return {
    runtimeInstanceId,
    dataBindingId: normalizeSystemRuntimeDataBindingId(
      `sqlite:${runtimeInstanceId}`,
    ),
    databaseEngine: "sqlite",
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

if (!isElectronNode) {
  test("Electron qualifies dedicated SQLite system runtime databases", () => {
    const result = spawnSync(
      electronPath,
      [
        "--import",
        "tsx",
        "--test",
        path.resolve(
          "modules/adapters/persistence/system-runtime/tests/local-sqlite-system-runtime-database.adapter.integration.test.ts",
        ),
      ],
      {
        cwd: path.resolve("."),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
} else {
test("dedicated SQLite runtime databases isolate records and survive reopen", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aisb-runtime-db-"));
  const adapter = createLocalSqliteSystemRuntimeDatabaseAdapter({
    dataRootDirectory: root,
    now,
    generateBackupId: () => "backup-a",
  });
  const first = instance("runtime-a");
  const second = instance("runtime-b");
  try {
    await adapter.provision(first);
    await adapter.provision(second);
    const firstSession = await adapter.acquire(first);
    const secondSession = await adapter.acquire(second);
    await firstSession.documents.writeDocument("conversation/test", "shared", {
      owner: "first",
    });
    await secondSession.documents.writeDocument("conversation/test", "shared", {
      owner: "second",
    });
    assert.equal(
      (
        await firstSession.documents.readDocument<{ owner: string }>(
          "conversation/test",
          "shared",
        )
      )?.value.owner,
      "first",
    );
    assert.equal(
      (
        await secondSession.documents.readDocument<{ owner: string }>(
          "conversation/test",
          "shared",
        )
      )?.value.owner,
      "second",
    );
    await adapter.close(first);
    assert.equal((await adapter.migrate(first)).healthy, true);
    const reopened = await adapter.acquire(first);
    assert.equal(
      (
        await reopened.documents.readDocument<{ owner: string }>(
          "conversation/test",
          "shared",
        )
      )?.value.owner,
      "first",
    );
  } finally {
    await adapter.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("ordinary open refuses a missing provisioned database instead of creating a substitute", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aisb-runtime-missing-"));
  const adapter = createLocalSqliteSystemRuntimeDatabaseAdapter({
    dataRootDirectory: root,
    now,
  });
  const selected = instance("runtime-missing");
  try {
    await adapter.provision(selected);
    const location = resolveLocalSystemRuntimeDatabaseLocation(
      root,
      selected.runtimeInstanceId,
    );
    await unlink(location.databaseFilePath);
    await assert.rejects(
      () => adapter.open(selected),
      (error: unknown) =>
        (error as { code?: string }).code === "runtime-database.missing",
    );
    await assert.rejects(
      () => adapter.migrate(selected),
      (error: unknown) =>
        (error as { code?: string }).code === "runtime-database.missing",
    );
  } finally {
    await adapter.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("SQLite runtime adapter bounds open databases and rejects foreign bindings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aisb-runtime-bound-"));
  const adapter = createLocalSqliteSystemRuntimeDatabaseAdapter({
    dataRootDirectory: root,
    maximumOpenDatabases: 1,
    now,
  });
  const first = instance("runtime-bound-a");
  const second = instance("runtime-bound-b");
  try {
    await adapter.provision(first);
    await adapter.provision(second);
    await adapter.acquire(first);
    await assert.rejects(
      () => adapter.acquire(second),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "runtime-database.connection-limit",
    );
    await assert.rejects(
      () =>
        adapter.open({
          ...first,
          dataBindingId: second.dataBindingId,
        }),
      (error: unknown) =>
        (error as { code?: string }).code ===
        "runtime-database.binding-mismatch",
    );
  } finally {
    await adapter.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});

test("backup restore and retained deletion remain exact-instance operations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aisb-runtime-recovery-"));
  const adapter = createLocalSqliteSystemRuntimeDatabaseAdapter({
    dataRootDirectory: root,
    now,
    generateBackupId: () => "backup-recovery",
  });
  const selected = instance("runtime-recovery");
  try {
    await adapter.provision(selected);
    const session = await adapter.acquire(selected);
    await session.documents.writeDocument("conversation/test", "record", {
      version: 1,
    });
    const backup = await adapter.createBackup(selected);
    await session.documents.writeDocument("conversation/test", "record", {
      version: 2,
    });
    await adapter.close(selected);
    const health = await adapter.restoreBackup(selected, backup.backupId);
    assert.equal(health.healthy, true);
    const restored = await adapter.acquire(selected);
    assert.equal(
      (
        await restored.documents.readDocument<{ version: number }>(
          "conversation/test",
          "record",
        )
      )?.value.version,
      1,
    );
    await adapter.retain(selected);
    await assert.rejects(() =>
      adapter.deleteRetained(selected, {
        runtimeInstanceId: normalizeSystemRuntimeInstanceId("runtime-foreign"),
        confirmation: "delete-retained-runtime-data",
      }),
    );
    await adapter.deleteRetained(selected, {
      runtimeInstanceId: selected.runtimeInstanceId,
      confirmation: "delete-retained-runtime-data",
    });
    await assert.rejects(() => adapter.open(selected));
  } finally {
    await adapter.closeAll();
    await rm(root, { recursive: true, force: true });
  }
});
}

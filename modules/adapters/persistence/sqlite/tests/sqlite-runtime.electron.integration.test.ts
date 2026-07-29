import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import electronPath from "electron";

import { LOCAL_SQLITE_MIGRATION_0001, LOCAL_SQLITE_MIGRATION_0002 } from "../sqlite-database";

test("the checked-in SQLite migration matches the runtime migration", async () => {
  const migrationPath = path.resolve("migrations", "sqlite", "0001-create-structured-document-store.sql");
  const checkedIn = await readFile(migrationPath, "utf8");
  assert.equal(normalizeSql(checkedIn), normalizeSql(LOCAL_SQLITE_MIGRATION_0001));
});

test("the checked-in organization SQLite migration matches the runtime migration", async () => {
  const migrationPath = path.resolve("migrations", "sqlite", "0002-create-organization-document-store.sql");
  const checkedIn = await readFile(migrationPath, "utf8");
  assert.equal(normalizeSql(checkedIn), normalizeSql(LOCAL_SQLITE_MIGRATION_0002));
});

test("Electron's production runtime executes SQLite migrations, transactions, health, backup, and restore", async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "ai-system-builder-sqlite-runtime-"));
  try {
    const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
    const fixture = path.resolve(
      "modules",
      "adapters",
      "persistence",
      "sqlite",
      "tests",
      "sqlite-runtime.fixture.ts",
    );
    const result = spawnSync(electronPath, [tsxCli, fixture, rootDirectory], {
      cwd: path.resolve("."),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout) as {
      health: { healthy: boolean; schemaVersion: number };
      backup: { pages: number };
      secondRevision: number;
      restoredValue: number;
      rolledBackPresent: boolean;
      workspaceDisplayName: string;
      workspaceJsonWritten: boolean;
      organizationWorkspaceStatus: string;
      organizationWorkspaceDisplayName: string;
      organizationWorkspaceCount: number;
      organizationWorkspaceActivationCount: number;
      organizationWorkspaceSelectionId: string;
      organizationAOwner: string;
      organizationBOwner: string;
      platformOwner: string;
      systemDataRevision: number;
      systemDataTitle: string;
      systemDataAuditCount: number;
      systemDataConflict: boolean;
      systemBuildConformance: {
        buildCount: number;
        releaseCount: number;
        staleConflict: boolean;
        immutableReleaseConflict: boolean;
        workspaceIsolation: boolean;
        rollbackSafe: boolean;
        restartSafe: boolean;
        newestVersionNumber: number;
      };
      systemDeploymentConformance: {
        currentConflict: boolean;
        retainedDeploymentCount: number;
        retainedRunCount: number;
        restartSafe: boolean;
        workspaceIsolation: boolean;
      };
    };
    assert.equal(output.health.healthy, true);
    assert.equal(output.health.schemaVersion, 2);
    assert.ok(output.backup.pages > 0);
    assert.equal(output.secondRevision, 2);
    assert.equal(output.restoredValue, 2);
    assert.equal(output.systemDataRevision, 2);
    assert.equal(output.systemDataTitle, "SQLite updated");
    assert.equal(output.systemDataAuditCount, 2);
    assert.equal(output.systemDataConflict, true);
    assert.deepEqual(output.systemBuildConformance, {
      ...output.systemBuildConformance,
      buildCount: 36,
      releaseCount: 1,
      staleConflict: true,
      immutableReleaseConflict: true,
      workspaceIsolation: true,
      rollbackSafe: true,
      restartSafe: true,
      newestVersionNumber: 36,
    });
    assert.deepEqual(output.systemDeploymentConformance, {
      currentConflict: true,
      retainedDeploymentCount: 2,
      retainedRunCount: 1,
      restartSafe: true,
      workspaceIsolation: true,
    });
    assert.equal(output.rolledBackPresent, false);
    assert.equal(output.workspaceDisplayName, "SQLite workspace");
    assert.equal(output.workspaceJsonWritten, false);
    assert.equal(output.organizationWorkspaceStatus, "created");
    assert.equal(output.organizationWorkspaceDisplayName, "Jeff's Systems");
    assert.equal(output.organizationWorkspaceCount, 1);
    assert.equal(output.organizationWorkspaceActivationCount, 1);
    assert.match(output.organizationWorkspaceSelectionId, /^workspace\./);
    assert.equal(output.organizationAOwner, "a");
    assert.equal(output.organizationBOwner, "b");
    assert.equal(output.platformOwner, "platform");
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("operator CLI reports health, creates a backup, and requires explicit restore confirmation", async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "ai-system-builder-sqlite-cli-"));
  const backupPath = path.join(rootDirectory, "backups", "operator.sqlite3");
  const exportPath = path.join(rootDirectory, "exports", "operator.ndjson");
  const cli = path.resolve("dev-tools", "scripts", "persistence", "run-sqlite-maintenance.mjs");
  try {
    const seed = spawnSync(electronPath, [
      path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
      path.resolve("modules", "adapters", "persistence", "sqlite", "tests", "sqlite-runtime.fixture.ts"),
      rootDirectory,
    ], {
      cwd: path.resolve("."), env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);

    const health = spawnSync(process.execPath, [cli, "health", "--data-root", rootDirectory], {
      cwd: path.resolve("."), encoding: "utf8", timeout: 30_000,
    });
    assert.equal(health.status, 0, health.stderr || health.stdout);
    assert.equal((JSON.parse(health.stdout) as { healthy: boolean }).healthy, true);

    const legacyInventory = spawnSync(process.execPath, [
      cli, "legacy-inventory", "--data-root", rootDirectory, "--namespaces", "tests",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });
    assert.equal(legacyInventory.status, 0, legacyInventory.stderr || legacyInventory.stdout);
    const inventory = JSON.parse(legacyInventory.stdout) as { totalDocumentCount: number; fingerprint: string };
    assert.ok(inventory.totalDocumentCount > 0);
    assert.match(inventory.fingerprint, /^sha256:[a-f0-9]{64}$/);

    const backup = spawnSync(process.execPath, [cli, "backup", "--data-root", rootDirectory, "--destination", backupPath], {
      cwd: path.resolve("."), encoding: "utf8", timeout: 30_000,
    });
    assert.equal(backup.status, 0, backup.stderr || backup.stdout);

    const portableExport = spawnSync(process.execPath, [cli, "export", "--data-root", rootDirectory, "--destination", exportPath], {
      cwd: path.resolve("."), encoding: "utf8", timeout: 30_000,
    });
    assert.equal(portableExport.status, 0, portableExport.stderr || portableExport.stdout);
    const exportedLines = (await readFile(exportPath, "utf8")).trim().split("\n");
    assert.equal((JSON.parse(exportedLines[0]!) as { kind: string }).kind, "ai-system-builder-structured-data-export");

    const unconfirmedRestore = spawnSync(process.execPath, [cli, "restore", "--data-root", rootDirectory, "--backup", backupPath], {
      cwd: path.resolve("."), encoding: "utf8", timeout: 30_000,
    });
    assert.equal(unconfirmedRestore.status, 1);
    assert.match(unconfirmedRestore.stderr, /--confirm-replace/);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

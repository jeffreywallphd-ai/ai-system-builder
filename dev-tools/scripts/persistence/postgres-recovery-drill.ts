#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  exportStructuredData,
  writeStructuredDataExport,
  type StructuredDataExport,
} from "../../../modules/adapters/persistence/migration";
import {
  openPostgresDatabase,
  resolvePostgresPoolConfig,
} from "../../../modules/adapters/persistence/postgres";
import {
  compareRecoveryExports,
  resolvePostgresRecoveryDrillConfig,
} from "./postgres-recovery-drill-core";

const DRILL_NAMESPACE = "qualification-recovery-drill";
const CONTAINER_DUMP_PATH = "/tmp/ai-system-builder-recovery.dump";

class RecoveryDrillStageError extends Error {
  constructor(readonly stage: string) {
    super(`PostgreSQL recovery drill failed during ${stage}.`);
    this.name = "RecoveryDrillStageError";
    this.stack = undefined;
  }
}

async function runDocker(
  stage: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.resume();
    child.once("error", () => reject(new RecoveryDrillStageError(stage)));
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new RecoveryDrillStageError(stage));
    });
  });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function seedAndExport(
  databaseUrl: string,
  sslMode: string,
): Promise<StructuredDataExport> {
  const database = await openPostgresDatabase({
    config: resolvePostgresPoolConfig({
      DATABASE_URL: databaseUrl,
      POSTGRES_SSL_MODE: sslMode,
      POSTGRES_APPLICATION_NAME: "ai-system-builder-recovery-drill",
    }),
  });
  try {
    await database.documents.writeDocument(DRILL_NAMESPACE, "marker.json", {
      drill: "postgres-custom-format",
      expectedAfterRestore: true,
    });
    await database.documents.writeDocument(DRILL_NAMESPACE, "nested.json", {
      records: [
        { id: "alpha", workspaceId: "workspace-recovery-a" },
        { id: "beta", workspaceId: "workspace-recovery-b" },
      ],
    });
    return exportStructuredData(
      database.documents,
      () => "2026-07-16T00:00:00.000Z",
    );
  } finally {
    await database.close();
  }
}

async function exportAndVerify(
  databaseUrl: string,
  sslMode: string,
): Promise<StructuredDataExport> {
  const database = await openPostgresDatabase({
    config: resolvePostgresPoolConfig({
      DATABASE_URL: databaseUrl,
      POSTGRES_SSL_MODE: sslMode,
      POSTGRES_APPLICATION_NAME: "ai-system-builder-recovery-verification",
    }),
  });
  try {
    const health = await database.checkHealth();
    if (!health.healthy)
      throw new RecoveryDrillStageError(
        "restored database health verification",
      );
    const marker = await database.documents.readDocument<{
      expectedAfterRestore?: boolean;
    }>(DRILL_NAMESPACE, "marker.json");
    if (marker?.value.expectedAfterRestore !== true) {
      throw new RecoveryDrillStageError("restored marker verification");
    }
    return exportStructuredData(
      database.documents,
      () => "2026-07-16T00:00:00.000Z",
    );
  } finally {
    await database.close();
  }
}

export async function runPostgresRecoveryDrill(): Promise<void> {
  const startedAt = new Date();
  const config = resolvePostgresRecoveryDrillConfig(process.env);
  await mkdir(config.evidenceDirectory, { recursive: true });
  const dumpPath = join(config.evidenceDirectory, "postgres-recovery.dump");
  const evidencePath = join(config.evidenceDirectory, "recovery-evidence.json");
  const baselinePath = join(config.evidenceDirectory, "baseline.ndjson");
  const restoredPath = join(config.evidenceDirectory, "restored.ndjson");
  let stage = "seed and baseline export";
  try {
    const baseline = await seedAndExport(config.databaseUrl, config.sslMode);
    await writeStructuredDataExport(baselinePath, baseline);

    stage = "custom-format backup";
    await runDocker(stage, [
      "exec",
      config.container,
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-acl",
      `--username=${config.databaseUser}`,
      `--dbname=${config.database}`,
      `--file=${CONTAINER_DUMP_PATH}`,
    ]);
    await runDocker("backup archive inspection", [
      "exec",
      config.container,
      "pg_restore",
      "--list",
      CONTAINER_DUMP_PATH,
    ]);
    await runDocker("backup archive retention", [
      "cp",
      `${config.container}:${CONTAINER_DUMP_PATH}`,
      dumpPath,
    ]);
    const backupSha256 = createHash("sha256")
      .update(await readFile(dumpPath))
      .digest("hex");

    stage = "source database destruction";
    const recoveryStartedAt = Date.now();
    await runDocker(stage, [
      "exec",
      config.container,
      "dropdb",
      "--force",
      `--username=${config.databaseUser}`,
      config.database,
    ]);
    await runDocker("empty restore target creation", [
      "exec",
      config.container,
      "createdb",
      `--username=${config.databaseUser}`,
      `--owner=${config.databaseUser}`,
      "--template=template0",
      config.database,
    ]);
    await runDocker("custom-format restore", [
      "exec",
      config.container,
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      `--username=${config.databaseUser}`,
      `--dbname=${config.database}`,
      CONTAINER_DUMP_PATH,
    ]);

    stage = "restored application verification";
    const restored = await exportAndVerify(config.databaseUrl, config.sslMode);
    const comparison = compareRecoveryExports(baseline, restored);
    await writeStructuredDataExport(restoredPath, restored);
    const completedAt = new Date();
    await writeJsonAtomic(evidencePath, {
      kind: "ai-system-builder-postgres-recovery-evidence",
      schemaVersion: 1,
      status: "passed",
      destructiveRestore: true,
      backupFormat: "postgres-custom",
      sourceDatabaseRecreated: true,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      measuredRecoveryTimeMs: Date.now() - recoveryStartedAt,
      backupSha256,
      ...comparison,
    });
    process.stdout.write(
      `${JSON.stringify({ operation: "postgres-recovery-drill", status: "passed", ...comparison })}\n`,
    );
  } catch (error) {
    const completedAt = new Date();
    await writeJsonAtomic(evidencePath, {
      kind: "ai-system-builder-postgres-recovery-evidence",
      schemaVersion: 1,
      status: "failed",
      failedStage:
        error instanceof RecoveryDrillStageError ? error.stage : stage,
      destructiveRestore:
        stage !== "seed and baseline export" &&
        stage !== "custom-format backup",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });
    throw new RecoveryDrillStageError(stage);
  } finally {
    await runDocker("temporary backup cleanup", [
      "exec",
      config.container,
      "rm",
      "-f",
      CONTAINER_DUMP_PATH,
    ]).catch(() => undefined);
  }
}

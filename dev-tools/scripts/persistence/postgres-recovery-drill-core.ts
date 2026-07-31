import { resolve } from "node:path";

import type { StructuredDataExport } from "../../../modules/adapters/persistence/migration";

export interface PostgresRecoveryDrillConfig {
  readonly container: string;
  readonly database: string;
  readonly databaseUser: string;
  readonly databaseUrl: string;
  readonly sslMode: string;
  readonly evidenceDirectory: string;
}

export interface RecoveryExportComparison {
  readonly documentCount: number;
  readonly structuredDataSha256: string;
}

const SAFE_DOCKER_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

export function resolvePostgresRecoveryDrillConfig(
  env: NodeJS.ProcessEnv,
): PostgresRecoveryDrillConfig {
  const container = env.RECOVERY_POSTGRES_CONTAINER?.trim();
  const database = env.RECOVERY_POSTGRES_DATABASE?.trim();
  const databaseUser = env.RECOVERY_POSTGRES_USER?.trim();
  const databaseUrl = env.TEST_POSTGRES_URL?.trim();
  const sslMode = env.TEST_POSTGRES_SSL_MODE?.trim() || "disable";
  if (!container || !SAFE_DOCKER_REFERENCE.test(container)) {
    throw new Error(
      "RECOVERY_POSTGRES_CONTAINER must be a safe Docker container id or name.",
    );
  }
  if (!database || !SAFE_POSTGRES_IDENTIFIER.test(database)) {
    throw new Error(
      "RECOVERY_POSTGRES_DATABASE must be a safe PostgreSQL identifier.",
    );
  }
  if (!databaseUser || !SAFE_POSTGRES_IDENTIFIER.test(databaseUser)) {
    throw new Error(
      "RECOVERY_POSTGRES_USER must be a safe PostgreSQL identifier.",
    );
  }
  if (!databaseUrl) {
    throw new Error("TEST_POSTGRES_URL is required for recovery verification.");
  }
  return {
    container,
    database,
    databaseUser,
    databaseUrl,
    sslMode,
    evidenceDirectory: resolve(
      env.RECOVERY_EVIDENCE_DIRECTORY?.trim() ||
        "artifacts/qualification/postgres-recovery",
    ),
  };
}

export function compareRecoveryExports(
  baseline: StructuredDataExport,
  restored: StructuredDataExport,
): RecoveryExportComparison {
  if (baseline.manifest.documentCount !== restored.manifest.documentCount) {
    throw new Error(
      "Restored structured-data document count does not match the backup baseline.",
    );
  }
  if (baseline.manifest.sha256 !== restored.manifest.sha256) {
    throw new Error(
      "Restored structured-data digest does not match the backup baseline.",
    );
  }
  return {
    documentCount: restored.manifest.documentCount,
    structuredDataSha256: restored.manifest.sha256,
  };
}

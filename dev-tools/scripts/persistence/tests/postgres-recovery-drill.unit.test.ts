import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredDataExport } from "../../../../modules/adapters/persistence/migration";
import {
  compareRecoveryExports,
  resolvePostgresRecoveryDrillConfig,
} from "../postgres-recovery-drill-core";

function exported(
  documentCount = 2,
  sha256 = "a".repeat(64),
): StructuredDataExport {
  return {
    manifest: {
      kind: "ai-system-builder-structured-data-export",
      schemaVersion: 1,
      exportedAt: "2026-07-16T00:00:00.000Z",
      documentCount,
      sha256,
    },
    documents: [],
  };
}

test("recovery drill configuration rejects unsafe command identifiers", () => {
  const baseline = {
    RECOVERY_POSTGRES_CONTAINER: "postgres-service",
    RECOVERY_POSTGRES_DATABASE: "qualification_database",
    RECOVERY_POSTGRES_USER: "qualification_user",
    TEST_POSTGRES_URL: "postgresql://redacted",
  };
  assert.doesNotThrow(() => resolvePostgresRecoveryDrillConfig(baseline));
  for (const override of [
    { RECOVERY_POSTGRES_CONTAINER: "postgres; whoami" },
    { RECOVERY_POSTGRES_DATABASE: "qualification --force" },
    { RECOVERY_POSTGRES_USER: "qualification/user" },
  ]) {
    assert.throws(() =>
      resolvePostgresRecoveryDrillConfig({ ...baseline, ...override }),
    );
  }
});

test("recovery comparison requires both document count and canonical digest", () => {
  assert.deepEqual(compareRecoveryExports(exported(), exported()), {
    documentCount: 2,
    structuredDataSha256: "a".repeat(64),
  });
  assert.throws(() => compareRecoveryExports(exported(), exported(3)), /count/);
  assert.throws(
    () => compareRecoveryExports(exported(), exported(2, "b".repeat(64))),
    /digest/,
  );
});

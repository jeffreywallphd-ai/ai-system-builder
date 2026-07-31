import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assessAssetSystemQualification,
  readAssetSystemQualificationConfig,
  validateAssetSystemQualificationConfig,
} from "../asset-system-qualification-core.mjs";
import {
  runAssetSystemPerformanceQualification,
  validateAssetSystemPerformanceReport,
} from "../asset-system-performance-core.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const config = readAssetSystemQualificationConfig(
  path.resolve(repoRoot, "dev-tools/config/asset-system-qualification.json"),
);
const digest = `sha256:${"a".repeat(64)}`;

test("asset/system qualification manifest covers every required compatibility, budget, control, and profile row", () => {
  assert.doesNotThrow(() => validateAssetSystemQualificationConfig(config));
  assert.equal(config.compatibilityMatrix.length, 8);
  assert.equal(config.performanceBudgets.length, 6);
  assert.equal(config.admissionControls.length, 5);
  assert.equal(config.qualificationProfiles.length, 5);
  assert.ok(
    config.qualificationProfiles.every((profile) =>
      profile.requiredEvidence.includes("asset-experience-automated"),
    ),
  );
});

test("qualification assessment never converts missing or failed controlled evidence into a pass", () => {
  const incomplete = assessAssetSystemQualification(config, {
    schemaVersion: 1,
    profile: "local-windows",
    sourceRevision: "revision-abc",
    productDigest: digest,
    recordedAt: "2026-07-17T00:00:00.000Z",
    checks: [
      {
        id: "repository-gates",
        status: "passed",
        evidenceId: "evidence.repository-gates",
        evidenceDigest: digest,
      },
    ],
  });
  assert.equal(incomplete.status, "incomplete");
  assert.ok(incomplete.required.some((item) => item.status === "not-run"));

  const failed = assessAssetSystemQualification(config, {
    schemaVersion: 1,
    profile: "local-windows",
    sourceRevision: "revision-abc",
    productDigest: digest,
    recordedAt: "2026-07-17T00:00:00.000Z",
    checks: [{ id: "security-manual", status: "failed" }],
  });
  assert.equal(failed.status, "failed");
});

test("qualification manifest rejects missing rows and non-positive admission limits", () => {
  assert.throws(
    () =>
      validateAssetSystemQualificationConfig({
        ...config,
        compatibilityMatrix: config.compatibilityMatrix.slice(1),
        admissionControls: config.admissionControls.map((item) =>
          item.id === "build"
            ? { ...item, limits: { maximumInstances: 0 } }
            : item,
        ),
      }),
    /qualification configuration is invalid/,
  );
});

test("performance qualification measures every budget and emits a sanitized p95 report", async () => {
  let clock = 0;
  const report = await runAssetSystemPerformanceQualification({
    config,
    environmentId: "local-windows-node24",
    sourceRevision: "revision-abc",
    recordedAt: "2026-07-17T00:00:00.000Z",
    iterations: 20,
    warmupIterations: 1,
    now: () => {
      clock += 10;
      return clock;
    },
    probes: Object.fromEntries(
      config.performanceBudgets.map((budget) => [
        budget.operation,
        async () => {},
      ]),
    ),
  });
  assert.equal(report.status, "passed");
  assert.equal(report.operations.length, 6);
  assert.ok(
    report.operations.every(
      (operation) =>
        operation.sampleCount === 20 &&
        operation.observedP95Milliseconds === 10 &&
        !("samples" in operation),
    ),
  );
  assert.doesNotThrow(() =>
    validateAssetSystemPerformanceReport(config, report),
  );
});

test("qualification rejects forged or over-budget performance passes", () => {
  assert.throws(
    () =>
      assessAssetSystemQualification(config, {
        schemaVersion: 1,
        profile: "local-windows",
        sourceRevision: "revision-abc",
        productDigest: digest,
        recordedAt: "2026-07-17T00:00:00.000Z",
        checks: [
          {
            id: "performance",
            status: "passed",
            evidenceId: "evidence.performance",
            evidenceDigest: digest,
          },
        ],
      }),
    /Performance qualification report envelope is invalid/,
  );
  const overBudget = {
    schemaVersion: 1,
    environmentId: "local-windows-node24",
    sourceRevision: "revision-abc",
    recordedAt: "2026-07-17T00:00:00.000Z",
    status: "passed",
    operations: config.performanceBudgets.map((budget) => ({
      operation: budget.operation,
      workload: budget.workload,
      percentile: budget.percentile,
      sampleCount: 20,
      observedP95Milliseconds: budget.maximumMilliseconds + 1,
      maximumMilliseconds: budget.maximumMilliseconds,
      status: "passed",
    })),
  };
  assert.throws(
    () => validateAssetSystemPerformanceReport(config, overBudget),
    /operation is invalid/,
  );
});

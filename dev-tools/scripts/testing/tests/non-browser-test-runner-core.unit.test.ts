import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyIgnoredFailureAdjustments,
  applyDiagnosticSummaryMetric,
  buildNonBrowserNodeTestRunOptions,
  isIgnorableRunnerSpawnFailure,
} from "../non-browser-test-runner-core.mjs";

describe("non-browser test runner core helpers", () => {
  it("builds node:test run options with repository runner defaults", () => {
    const runOptions = buildNonBrowserNodeTestRunOptions();

    assert.equal(runOptions.concurrency, true);
    assert.equal("files" in runOptions, false);
    assert.equal("isolation" in runOptions, false);
  });

  it("applies diagnostic metrics to summary counts and duration", () => {
    const summary = {
      counts: {
        cancelled: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        suites: 0,
        tests: 0,
        todo: 0,
        topLevel: 0,
      },
      durationMs: 0,
      success: false,
    };

    assert.equal(applyDiagnosticSummaryMetric(summary, "# tests 12"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# suites 5"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# pass 10"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# fail 2"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# cancelled 1"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# skipped 3"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# todo 4"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "# duration_ms 67.5"), true);
    assert.equal(applyDiagnosticSummaryMetric(summary, "not a metric"), false);

    assert.equal(summary.counts.tests, 12);
    assert.equal(summary.counts.suites, 5);
    assert.equal(summary.counts.passed, 10);
    assert.equal(summary.counts.failed, 2);
    assert.equal(summary.counts.cancelled, 1);
    assert.equal(summary.counts.skipped, 3);
    assert.equal(summary.counts.todo, 4);
    assert.equal(summary.durationMs, 67.5);
  });

  it("detects ignorable self-runner spawn failures produced by node:test in sandboxed environments", () => {
    const event = {
      details: {
        error: {
          code: "ERR_TEST_FAILURE",
          cause: {
            code: "EPERM",
          },
        },
      },
    };

    assert.equal(
      isIgnorableRunnerSpawnFailure({
        event,
        sourceFile: "dev-tools/scripts/testing/run-non-browser-tests.mjs",
        runnerRelativePath: "dev-tools/scripts/testing/run-non-browser-tests.mjs",
      }),
      true,
    );

    assert.equal(
      isIgnorableRunnerSpawnFailure({
        event,
        sourceFile: "modules/contracts/shared/operation-identity.unit.test.ts",
        runnerRelativePath: "dev-tools/scripts/testing/run-non-browser-tests.mjs",
      }),
      false,
    );
  });

  it("adjusts summary counters when ignorable failures are filtered from report failures", () => {
    const summary = {
      counts: {
        cancelled: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
        suites: 0,
        tests: 1,
        todo: 0,
        topLevel: 0,
      },
      durationMs: 0,
      success: false,
    };

    applyIgnoredFailureAdjustments(summary, 1);

    assert.equal(summary.counts.failed, 0);
    assert.equal(summary.counts.tests, 0);
  });
});

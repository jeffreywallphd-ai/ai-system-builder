import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyIgnoredFailureAdjustments,
  applyDiagnosticSummaryMetric,
  buildNonBrowserNodeTestRunOptions,
  classifyTestFileSuite,
  createNonBrowserAssetModule,
  createTestTimingTracker,
  formatNonBrowserFailureSummary,
  isVitestOwnedTestSource,
  isIgnorableRunnerSpawnFailure,
  isNonBrowserAssetSource,
  parseTestSuiteArgument,
  shouldIncludeTestFileForSuite,
} from "../non-browser-test-runner-core.mjs";

describe("non-browser test runner core helpers", () => {
  it("creates inert ESM modules only for supported visual test assets", () => {
    assert.equal(isNonBrowserAssetSource("assets/branding/logo.svg"), true);
    assert.equal(isNonBrowserAssetSource("assets/page-art.PNG"), true);
    assert.equal(isNonBrowserAssetSource("assets/private.txt"), false);
    assert.equal(
      createNonBrowserAssetModule("assets/branding/logo.svg"),
      'export default "logo.svg";\n',
    );
    assert.throws(
      () => createNonBrowserAssetModule("assets/private.txt"),
      /Unsupported non-browser test asset source/,
    );
  });

  it("builds node:test run options with repository runner defaults", () => {
    const files = ["C:/repo/test-a.mjs", "C:/repo/test-b.mjs"];
    const runOptions = buildNonBrowserNodeTestRunOptions({
      files,
      cwd: "C:/repo",
    });

    assert.equal(runOptions.cwd, "C:/repo");
    assert.deepEqual(runOptions.files, files);
    assert.notEqual(runOptions.files, files);
    assert.equal(runOptions.isolation, "none");
    assert.equal("concurrency" in runOptions, false);
  });

  it("classifies standard, end-to-end, and explicitly marked AI tests", () => {
    assert.equal(classifyTestFileSuite("feature.unit.test.ts"), "standard");
    assert.equal(classifyTestFileSuite("feature.ui.test.tsx"), "standard");
    assert.equal(classifyTestFileSuite("feature.integration.test.ts"), "e2e");
    assert.equal(classifyTestFileSuite("feature.e2e.test.tsx"), "e2e");
    assert.equal(
      classifyTestFileSuite("legacy.unit.test.ts", "// @test-duration long"),
      "e2e",
    );
    assert.equal(
      classifyTestFileSuite("model.integration.test.ts", "// @test-suite ai"),
      "ai",
    );
    assert.equal(
      shouldIncludeTestFileForSuite({
        sourcePath: "feature.e2e.test.ts",
        suite: "standard",
      }),
      false,
    );
    assert.equal(
      shouldIncludeTestFileForSuite({
        sourcePath: "feature.e2e.test.ts",
        suite: "e2e",
      }),
      true,
    );
    assert.equal(
      shouldIncludeTestFileForSuite({
        sourcePath: "model.unit.test.ts",
        sourceText: "// @test-suite ai",
        suite: "standardande2e",
      }),
      false,
    );
    assert.equal(
      shouldIncludeTestFileForSuite({
        sourcePath: "model.unit.test.ts",
        sourceText: "// @test-suite ai",
        suite: "all",
      }),
      true,
    );
  });

  it("parses supported suite arguments and keeps Vitest-owned files out of the Node runner", () => {
    assert.equal(parseTestSuiteArgument(["--suite=standard"]), "standard");
    assert.equal(parseTestSuiteArgument([], "e2e"), "e2e");
    assert.equal(parseTestSuiteArgument(["--suite=ai"]), "ai");
    assert.equal(
      parseTestSuiteArgument(["--suite=standardande2e"]),
      "standardande2e",
    );
    assert.equal(parseTestSuiteArgument(["--suite=all"]), "all");
    assert.throws(
      () => parseTestSuiteArgument(["--suite=unknown"]),
      /Unsupported test suite/,
    );
    assert.equal(isVitestOwnedTestSource('import { it } from "vitest";'), true);
    assert.equal(isVitestOwnedTestSource("import { it } from 'vitest';"), true);
    assert.equal(
      isVitestOwnedTestSource('import { it } from "node:test";'),
      false,
    );
  });

  it("reports the slowest top-level files and test events", () => {
    const tracker = createTestTimingTracker({ limit: 2 });
    tracker.record({
      file: "a.test.ts",
      name: "suite a",
      nesting: 0,
      durationMs: 40,
      status: "passed",
    });
    tracker.record({
      file: "a.test.ts",
      name: "case a",
      nesting: 1,
      durationMs: 35,
      status: "passed",
    });
    tracker.record({
      file: "b.test.ts",
      name: "case b",
      nesting: 0,
      durationMs: 80,
      status: "passed",
    });
    const snapshot = tracker.snapshot();
    assert.deepEqual(
      snapshot.slowestFiles.map((entry) => entry.file),
      ["b.test.ts", "a.test.ts"],
    );
    assert.deepEqual(
      snapshot.slowestTests.map((entry) => entry.name),
      ["case b", "suite a"],
    );
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
    assert.equal(
      applyDiagnosticSummaryMetric(summary, "# duration_ms 67.5"),
      true,
    );
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
        runnerRelativePath:
          "dev-tools/scripts/testing/run-non-browser-tests.mjs",
      }),
      true,
    );

    assert.equal(
      isIgnorableRunnerSpawnFailure({
        event,
        sourceFile: "modules/contracts/shared/operation-identity.unit.test.ts",
        runnerRelativePath:
          "dev-tools/scripts/testing/run-non-browser-tests.mjs",
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

  it("formats startup and assertion failures for CI console diagnostics", () => {
    const output = formatNonBrowserFailureSummary({
      startupError: {
        name: "Error",
        message: "Discovery failed.",
      },
      failures: [
        {
          name: "preserves the contract",
          file: "modules/example/tests/example.unit.test.ts",
          line: 12,
          column: 4,
          details: {
            error: {
              name: "AssertionError",
              message: "Expected values to be equal.",
            },
          },
        },
      ],
    });

    assert.match(output, /Non-browser test runner startup failed:/);
    assert.match(output, /Error: Discovery failed\./);
    assert.match(output, /Non-browser test failures \(1\):/);
    assert.match(
      output,
      /preserves the contract \(modules\/example\/tests\/example\.unit\.test\.ts:12:4\)/,
    );
    assert.match(output, /AssertionError: Expected values to be equal\./);
  });

  it("emits no CI diagnostic summary for a passing report", () => {
    assert.equal(formatNonBrowserFailureSummary({ failures: [] }), "");
  });
});

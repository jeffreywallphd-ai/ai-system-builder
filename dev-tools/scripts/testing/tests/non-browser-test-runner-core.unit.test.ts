import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  applyDiagnosticSummaryMetric,
  buildNonBrowserNodeTestRunOptions,
  classifyTestFileSuite,
  createNonBrowserAssetModule,
  createTestTimingTracker,
  formatNonBrowserFailureSummary,
  isVitestOwnedTestSource,
  isSuccessfulNonBrowserRun,
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
    assert.equal(runOptions.isolation, "process");
    assert.equal(runOptions.concurrency, 4);
  });

  it("executes files with separate globals and retains one/all denied child spawns", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "runner-isolation-"));
    try {
      for (const [file, marker] of [
        ["a.test.mjs", "one"],
        ["b.test.mjs", "two"],
      ]) {
        writeFileSync(
          path.join(directory, file),
          `import {test} from 'node:test'; import assert from 'node:assert/strict'; globalThis.marker=${JSON.stringify(marker)}; test('owns its global',()=>assert.equal(globalThis.marker,${JSON.stringify(marker)}));`,
        );
      }
      const core = new URL(
        "../non-browser-test-runner-core.mjs",
        import.meta.url,
      ).href;
      writeFileSync(
        path.join(directory, "observe.cjs"),
        `
const cp=require('node:child_process'), path=require('node:path');
const mode=process.argv[2], original=cp.spawn;
let denied=0;
cp.spawn=function(...args) {
  if(mode==='all' || mode==='one' && args[1].includes(path.join(__dirname,'b.test.mjs'))) {
    denied++; const error=new Error('Synthetic bounded spawn denial'); error.code='EPERM'; throw error;
  }
  return original.apply(this,args);
};
(async()=>{
  const core=await import(${JSON.stringify(core)}), {run}=await import('node:test');
  const summary={counts:{failed:0,cancelled:0,passed:0}}, failures=[];
  for await(const item of run(core.buildNonBrowserNodeTestRunOptions({files:['a.test.mjs','b.test.mjs'].map(f=>path.join(__dirname,f)),cwd:process.cwd()}))) {
    if(item.type==='test:diagnostic') core.applyDiagnosticSummaryMetric(summary,item.data.message);
    if(item.type==='test:fail') failures.push({code:item.data.details?.error?.cause?.code});
  }
  console.log(JSON.stringify({denied,failures,counts:summary.counts,qualified:core.isSuccessfulNonBrowserRun({summary,failures,discoveredCount:2})}));
})().catch(()=>{process.exitCode=2;});`,
      );
      for (const mode of ["none", "one", "all"]) {
        const environment = { ...process.env };
        delete environment.NODE_TEST_CONTEXT;
        const result = spawnSync(
          process.execPath,
          [path.join(directory, "observe.cjs"), mode],
          {
            cwd: process.cwd(),
            env: environment,
            encoding: "utf8",
            timeout: 15000,
            maxBuffer: 65536,
          },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stderr);
        const observed = JSON.parse(result.stdout.trim());
        assert.equal(
          observed.qualified,
          mode === "none",
          JSON.stringify(observed),
        );
        assert.equal(
          observed.denied,
          mode === "all" ? 2 : mode === "one" ? 1 : 0,
        );
        assert.equal(
          observed.counts.passed,
          mode === "all" ? 0 : mode === "one" ? 1 : 2,
        );
        assert.equal(observed.failures.length, observed.denied);
        assert.ok(
          observed.failures.every((failure) => failure.code === "EPERM"),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

  it("never qualifies unexecuted, cancelled, failed or all-skipped discovered work", () => {
    const summary = { counts: { failed: 0, cancelled: 0, passed: 1 } };
    assert.equal(
      isSuccessfulNonBrowserRun({ summary, failures: [], discoveredCount: 1 }),
      true,
    );
    for (const counts of [
      { failed: 1, cancelled: 0, passed: 1 },
      { failed: 0, cancelled: 1, passed: 1 },
      { failed: 0, cancelled: 0, passed: 0 },
    ]) {
      assert.equal(
        isSuccessfulNonBrowserRun({
          summary: { counts },
          failures: [],
          discoveredCount: 1,
        }),
        false,
      );
    }
    const denied = {
      file: "dev-tools/scripts/testing/run-non-browser-tests.mjs",
      details: {
        error: { code: "ERR_TEST_FAILURE", cause: { code: "EPERM" } },
      },
    };
    assert.equal(
      isSuccessfulNonBrowserRun({
        summary,
        failures: [denied],
        discoveredCount: 2,
      }),
      false,
    );
    assert.equal(
      isSuccessfulNonBrowserRun({ summary, failures: [], discoveredCount: 0 }),
      false,
    );
    assert.equal(
      isSuccessfulNonBrowserRun({
        summary: { counts: { failed: 0, cancelled: 0, passed: 0 } },
        failures: [],
        discoveredCount: 0,
        delegatedEmpty: true,
      }),
      true,
    );
  });

  it("routes actual imports without interpreting fixture strings or comments as framework ownership", () => {
    for (const source of [
      "// import { it } from 'vitest';",
      `const fixture = 'import { it } from "vitest"';`,
      "const fixture = `from 'vitest'`;",
      "import type { Test } from 'vitest';",
    ]) {
      assert.equal(isVitestOwnedTestSource(source), false, source);
    }
    assert.equal(isVitestOwnedTestSource("import {it}\nfrom 'vitest';"), true);
    assert.equal(isVitestOwnedTestSource("export {it} from 'vitest';"), true);
    assert.equal(isVitestOwnedTestSource("await import('vitest');"), true);
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

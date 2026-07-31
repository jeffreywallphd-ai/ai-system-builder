#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { parseTestSuiteArgument } from "./non-browser-test-runner-core.mjs";

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runnerDirectory, "../../..");
const suite = parseTestSuiteArgument(process.argv.slice(2), "standard");
const suitesToRun =
  suite === "all"
    ? ["standard", "e2e", "ai"]
    : suite === "standardande2e"
      ? ["standard", "e2e"]
      : [suite];
const runners = [
  {
    id: "node",
    path: path.join(runnerDirectory, "run-non-browser-tests.mjs"),
  },
  {
    id: "vitest",
    path: path.join(runnerDirectory, "run-vitest-tests.mjs"),
  },
  {
    id: "python-ai",
    path: path.join(runnerDirectory, "run-python-ai-tests.mjs"),
    suites: new Set(["ai"]),
  },
];
const results = [];

for (const selectedSuite of suitesToRun) {
  for (const runner of runners) {
    if (runner.suites && runner.suites.has(selectedSuite) === false) {
      continue;
    }
    const startedAt = performance.now();
    const result = spawnSync(
      process.execPath,
      [...process.execArgv, runner.path, `--suite=${selectedSuite}`],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    const durationMs = performance.now() - startedAt;
    results.push({
      runner: runner.id,
      suite: selectedSuite,
      status: result.status === 0 ? "passed" : "failed",
      exitCode: result.status ?? 1,
      durationMs,
      error: result.error?.message,
    });
  }
}

const reportRelativePath =
  suite === "all"
    ? "artifacts/test-reports/test-suite-report.json"
    : `artifacts/test-reports/test-${suite}-suite-report.json`;
const reportPath = path.resolve(repositoryRoot, reportRelativePath);
const didFail = results.some((result) => result.exitCode !== 0);
const report = {
  generatedAt: new Date().toISOString(),
  suite,
  status: didFail ? "failed" : "passed",
  results,
};

mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Test ${suite} suite: ${report.status}.`);
for (const result of results) {
  console.log(
    `  ${result.suite}/${result.runner}: ${result.status} (${Math.round(result.durationMs)} ms)`,
  );
}
console.log(`Suite report: ${reportRelativePath}`);
process.exitCode = didFail ? 1 : 0;

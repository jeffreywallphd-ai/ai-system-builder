#!/usr/bin/env node

import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isVitestOwnedTestSource,
  parseTestSuiteArgument,
  shouldIncludeTestFileForSuite,
} from "./non-browser-test-runner-core.mjs";
import { prepareVitestReport, runExactVitest } from "./vitest-exact-runner.mjs";

const runnerDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runnerDirectory, "../../..");
const suite = parseTestSuiteArgument(process.argv.slice(2));
const discoveryRoots = ["modules", "apps"];
const validTestFilePattern = /\.test\.[cm]?[jt]sx?$/i;
const ignoredDirectories = new Set([
  ".git",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const reportRelativePath =
  suite === "all"
    ? "artifacts/test-reports/vitest-test-report.json"
    : `artifacts/test-reports/vitest-${suite}-test-report.json`;
const discoveredFiles = [];

const toPosixPath = (value) => value.split(path.sep).join("/");

const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!entry.isFile() || !validTestFilePattern.test(entry.name)) {
      continue;
    }

    const sourceText = readFileSync(absolutePath, "utf8");
    const sourcePath = toPosixPath(path.relative(repositoryRoot, absolutePath));
    if (
      isVitestOwnedTestSource(sourceText) &&
      shouldIncludeTestFileForSuite({ sourcePath, sourceText, suite })
    ) {
      discoveredFiles.push(sourcePath);
    }
  }
};

for (const discoveryRoot of discoveryRoots) {
  const absoluteRoot = path.join(repositoryRoot, discoveryRoot);
  if (statSync(absoluteRoot).isDirectory()) {
    walk(absoluteRoot);
  }
}

discoveredFiles.sort((left, right) => left.localeCompare(right));
const reportPath = prepareVitestReport(repositoryRoot, reportRelativePath);
if (discoveredFiles.length === 0) {
  const delegated = suite === "ai";
  const report = {
    suite, success: delegated, discoveredFiles: [],
    selection: { status: delegated ? "empty-delegated" : "empty", expectedFiles: 0, collectedFiles: 0 },
    numTotalTestSuites: 0, numPassedTestSuites: 0, numFailedTestSuites: 0,
    numTotalTests: 0, numPassedTests: 0, numFailedTests: 0,
    testResults: [], slowestFiles: [], slowestTests: [],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  if (suite !== "ai") {
    console.error(`No Vitest-owned ${suite} test files were discovered.`);
    process.exitCode = 1;
  } else {
    console.log(
      "No explicitly marked Vitest AI tests were discovered; continuing with the controlled Python AI tests.",
    );
    console.log(`Timing report: ${reportRelativePath}`);
    process.exitCode = 0;
  }
} else {
  let result = { exitCode: 1 };
  try {
    result = await runExactVitest({ root: repositoryRoot, files: discoveredFiles, reportRelativePath });
  } catch (error) {
    console.error(
      `Vitest ${suite} execution did not qualify: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    if (!result.selection || result.selection.status === "unavailable") {
      throw new Error("No current validated Vitest report is available.");
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const slowestFiles = report.testResults
      .map((testResult) => ({
        file: toPosixPath(path.relative(repositoryRoot, testResult.name)),
        durationMs: Math.max(0, testResult.endTime - testResult.startTime),
      }))
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 10);
    const slowestTests = report.testResults
      .flatMap((testResult) =>
        testResult.assertionResults.map((assertion) => ({
          file: toPosixPath(path.relative(repositoryRoot, testResult.name)),
          name: assertion.fullName,
          durationMs: assertion.duration ?? 0,
        })),
      )
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 10);

    report.suite = suite;
    report.selection = result.selection ?? { status: "unavailable" };
    report.success = report.success === true && result.exitCode === 0;
    report.discoveredFiles = discoveredFiles;
    report.slowestFiles = slowestFiles;
    report.slowestTests = slowestTests;
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    );

    console.log(
      `Vitest ${suite}: ${report.numPassedTests}/${report.numTotalTests} tests passed.`,
    );
    for (const timing of slowestFiles.slice(0, 5)) {
      console.log(`  ${Math.round(timing.durationMs)} ms  ${timing.file}`);
    }
    console.log(`Timing report: ${reportRelativePath}`);
  } catch (error) {
    result.exitCode = 1;
    console.error(
      `Vitest ${suite} report could not be summarized: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  process.exitCode = result.exitCode;
}

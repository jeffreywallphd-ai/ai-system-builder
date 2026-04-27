#!/usr/bin/env node

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { run } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  applyIgnoredFailureAdjustments,
  applyDiagnosticSummaryMetric,
  buildNonBrowserNodeTestRunOptions,
  isIgnorableRunnerSpawnFailure,
} from "./non-browser-test-runner-core.mjs";

const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(runnerDir, "../../..");

const reportRelativePath = "artifacts/test-reports/non-browser-test-report.json";
const reportPath = path.resolve(repoRoot, reportRelativePath);
const runtimeRoot = path.resolve(repoRoot, "artifacts/test-runtime/non-browser");
const runnerRelativePath = "dev-tools/scripts/testing/run-non-browser-tests.mjs";

const discoveryRoots = [
  "modules",
  "apps/server",
  "apps/desktop",
  "apps/thin-client",
  "dev-tools/scripts/testing",
];
const validTestFilePattern = /\.test\.[cm]?[jt]sx?$/i;
const browserOnlyTestPattern = /\.(ui|e2e)\.test\.[cm]?[jt]sx?$/i;
const browserAppPathPattern = /^(apps\/desktop\/src\/renderer\/|apps\/thin-client\/src\/)/i;
const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const transpileEligiblePattern = /\.[cm]?[jt]sx?$/i;
const declarationFilePattern = /\.d\.[cm]?ts$/i;

const discoveredRuntimeTestFiles = [];
const discoveredSourceTestFiles = [];
const runtimeToSourceFile = new Map();

const report = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  reportPath: reportRelativePath,
  status: "failed",
  exitCode: 1,
  configuredDiscoveryRoots: discoveryRoots,
  discoveredFileCount: 0,
  discoveredFiles: [],
  summary: {
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
  },
  failures: [],
  startupError: null,
};

const writeReport = () => {
  report.discoveredFiles = [...new Set(discoveredSourceTestFiles)].sort();
  report.discoveredFileCount = report.discoveredFiles.length;

  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
};

const normalizeToPosixPath = (value) => value.split(path.sep).join("/");
const pathExists = (targetPath) => {
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
};

const isFilePath = (targetPath) => {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
};

const isDirectoryPath = (targetPath) => {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const mapOutputExtension = (sourcePath) => {
  if (sourcePath.endsWith(".mts")) {
    return sourcePath.slice(0, -4) + ".mjs";
  }

  if (sourcePath.endsWith(".cts")) {
    return sourcePath.slice(0, -4) + ".cjs";
  }

  if (sourcePath.endsWith(".tsx")) {
    return sourcePath.slice(0, -4) + ".js";
  }

  if (sourcePath.endsWith(".ts")) {
    return sourcePath.slice(0, -3) + ".js";
  }

  return sourcePath;
};

const serializeError = (value) => {
  if (!value || typeof value !== "object") {
    return {
      name: "Error",
      message: String(value),
      stack: undefined,
      code: undefined,
      cause: undefined,
    };
  }

  const maybeError = value;
  const cause = maybeError.cause;

  return {
    name: typeof maybeError.name === "string" ? maybeError.name : "Error",
    message: typeof maybeError.message === "string" ? maybeError.message : String(value),
    stack: typeof maybeError.stack === "string" ? maybeError.stack : undefined,
    code: typeof maybeError.code === "string" ? maybeError.code : undefined,
    cause:
      cause && typeof cause === "object"
        ? {
            name: typeof cause.name === "string" ? cause.name : undefined,
            message: typeof cause.message === "string" ? cause.message : String(cause),
            stack: typeof cause.stack === "string" ? cause.stack : undefined,
            code: typeof cause.code === "string" ? cause.code : undefined,
          }
        : cause,
  };
};

const writeRuntimeOutput = (runtimeAbsolutePath, sourceText) => {
  mkdirSync(path.dirname(runtimeAbsolutePath), { recursive: true });
  writeFileSync(runtimeAbsolutePath, sourceText, "utf8");
};

const resolveRuntimeSpecifier = (specifier, runtimeAbsolutePath) => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return specifier;
  }

  const canonicalSpecifier = specifier.endsWith("/") ? specifier.slice(0, -1) : specifier;
  const runtimeDir = path.dirname(runtimeAbsolutePath);
  const resolvedBase = path.resolve(runtimeDir, canonicalSpecifier);
  const specifierExtension = path.extname(canonicalSpecifier).toLowerCase();

  if (specifierExtension === ".js" || specifierExtension === ".mjs" || specifierExtension === ".cjs") {
    return canonicalSpecifier;
  }

  if (isFilePath(resolvedBase)) {
    if (
      specifierExtension === ".json" ||
      specifierExtension === ".node" ||
      specifierExtension === ".js" ||
      specifierExtension === ".mjs" ||
      specifierExtension === ".cjs"
    ) {
      return canonicalSpecifier;
    }
  }

  if (pathExists(`${resolvedBase}.js`)) {
    return `${canonicalSpecifier}.js`;
  }

  if (pathExists(`${resolvedBase}.mjs`)) {
    return `${canonicalSpecifier}.mjs`;
  }

  if (pathExists(`${resolvedBase}.cjs`)) {
    return `${canonicalSpecifier}.cjs`;
  }

  if (isDirectoryPath(resolvedBase) && pathExists(path.join(resolvedBase, "index.js"))) {
    return `${canonicalSpecifier}/index.js`;
  }

  if (isDirectoryPath(resolvedBase) && pathExists(path.join(resolvedBase, "index.mjs"))) {
    return `${canonicalSpecifier}/index.mjs`;
  }

  if (isDirectoryPath(resolvedBase) && pathExists(path.join(resolvedBase, "index.cjs"))) {
    return `${canonicalSpecifier}/index.cjs`;
  }

  return canonicalSpecifier;
};

const rewriteRuntimeImportsInFile = (runtimeAbsolutePath) => {
  const sourceText = readFileSync(runtimeAbsolutePath, "utf8");

  const rewrittenFromImports = sourceText.replace(
    /(from\s+)(["'])(\.[^"'()]+)\2/g,
    (match, prefix, quote, specifier) => {
      const resolvedSpecifier = resolveRuntimeSpecifier(specifier, runtimeAbsolutePath);
      return `${prefix}${quote}${resolvedSpecifier}${quote}`;
    },
  );

  const rewrittenDynamicImports = rewrittenFromImports.replace(
    /(import\(\s*)(["'])(\.[^"'()]+)\2(\s*\))/g,
    (match, prefix, quote, specifier, suffix) => {
      const resolvedSpecifier = resolveRuntimeSpecifier(specifier, runtimeAbsolutePath);
      return `${prefix}${quote}${resolvedSpecifier}${quote}${suffix}`;
    },
  );

  const rewrittenDirectoryShorthand = rewrittenDynamicImports
    .replace(/(from\s+["'])\.\.(["'])/g, "$1../index.js$2")
    .replace(/(from\s+["'])\.\.\/(["'])/g, "$1../index.js$2")
    .replace(/(from\s+["'])\.(["'])/g, "$1./index.js$2")
    .replace(/(from\s+["'])\.\/(["'])/g, "$1./index.js$2")
    .replace(/(import\(\s*["'])\.\.(["']\s*\))/g, "$1../index.js$2")
    .replace(/(import\(\s*["'])\.\.\/(["']\s*\))/g, "$1../index.js$2")
    .replace(/(import\(\s*["'])\.(["']\s*\))/g, "$1./index.js$2")
    .replace(/(import\(\s*["'])\.\/(["']\s*\))/g, "$1./index.js$2");

  if (rewrittenDirectoryShorthand !== sourceText) {
    writeFileSync(runtimeAbsolutePath, rewrittenDirectoryShorthand, "utf8");
  }
};

const rewriteRuntimeImports = (startPath) => {
  const entries = readdirSync(startPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      rewriteRuntimeImports(absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    if (extension !== "" && !/\.(?:mjs|cjs|js)$/i.test(entry.name)) {
      continue;
    }

    rewriteRuntimeImportsInFile(absolutePath);
  }
};

const transpileToRuntimeFile = (sourceAbsolutePath, runtimeAbsolutePath) => {
  const sourceText = readFileSync(sourceAbsolutePath, "utf8");
  let transpileResult;

  try {
    transpileResult = ts.transpileModule(sourceText, {
      fileName: sourceAbsolutePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        sourceMap: false,
        inlineSourceMap: false,
        declaration: false,
        declarationMap: false,
        newLine: ts.NewLineKind.LineFeed,
      },
    });
  } catch (error) {
    const details = serializeError(error);
    throw new Error(`Failed to transpile ${normalizeToPosixPath(path.relative(repoRoot, sourceAbsolutePath))}: ${details.message}`);
  }

  writeRuntimeOutput(runtimeAbsolutePath, transpileResult.outputText);
};

const copyToRuntimeFile = (sourceAbsolutePath, runtimeAbsolutePath) => {
  const sourceText = readFileSync(sourceAbsolutePath, "utf8");
  writeRuntimeOutput(runtimeAbsolutePath, sourceText);
};

const walkAndBuildRuntime = (startPath) => {
  const entries = readdirSync(startPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      walkAndBuildRuntime(absolutePath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativeSourcePath = path.relative(repoRoot, absolutePath);
    const normalizedSourcePath = normalizeToPosixPath(relativeSourcePath);
    const relativeRuntimePath = mapOutputExtension(relativeSourcePath);
    const runtimeAbsolutePath = path.resolve(runtimeRoot, relativeRuntimePath);

    if (transpileEligiblePattern.test(entry.name) && !declarationFilePattern.test(entry.name)) {
      transpileToRuntimeFile(absolutePath, runtimeAbsolutePath);
    } else if (
      (entry.name.endsWith(".json") && entry.name !== "package.json") ||
      entry.name.endsWith(".node")
    ) {
      copyToRuntimeFile(absolutePath, runtimeAbsolutePath);
    } else {
      continue;
    }

    runtimeToSourceFile.set(path.resolve(runtimeAbsolutePath), normalizedSourcePath);

    if (
      validTestFilePattern.test(entry.name) &&
      !browserOnlyTestPattern.test(entry.name) &&
      !browserAppPathPattern.test(normalizedSourcePath)
    ) {
      discoveredSourceTestFiles.push(normalizedSourcePath);
      discoveredRuntimeTestFiles.push(path.resolve(runtimeAbsolutePath));
    }
  }
};

const discoverAndPrepareRuntime = () => {
  rmSync(runtimeRoot, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
    "utf8",
  );

  for (const discoveryRoot of discoveryRoots) {
    const absoluteRoot = path.join(repoRoot, discoveryRoot);

    let exists = false;
    try {
      exists = statSync(absoluteRoot).isDirectory();
    } catch {
      exists = false;
    }

    if (!exists) {
      continue;
    }

    walkAndBuildRuntime(absoluteRoot);
  }

  discoveredRuntimeTestFiles.sort((left, right) => left.localeCompare(right));
  discoveredSourceTestFiles.sort((left, right) => left.localeCompare(right));
  rewriteRuntimeImports(runtimeRoot);
};

const resolveSourcePath = (maybeRuntimeFile) => {
  if (typeof maybeRuntimeFile !== "string" || maybeRuntimeFile.length === 0) {
    return maybeRuntimeFile;
  }

  const normalized = path.resolve(maybeRuntimeFile);
  const sourcePath = runtimeToSourceFile.get(normalized);
  return sourcePath ?? normalizeToPosixPath(path.relative(repoRoot, maybeRuntimeFile));
};

try {
  discoverAndPrepareRuntime();
  let ignoredRunnerSpawnFailures = 0;

  if (discoveredRuntimeTestFiles.length === 0) {
    throw new Error("No non-browser test files were discovered.");
  }

  for (const runtimeTestFile of discoveredRuntimeTestFiles) {
    await import(pathToFileURL(runtimeTestFile).href);
  }

  const testsStream = run(buildNonBrowserNodeTestRunOptions());

  for await (const streamEvent of testsStream) {
    const eventType = streamEvent?.type;
    const event = streamEvent?.data ?? streamEvent;

    if (eventType === "test:diagnostic") {
      const didApply = applyDiagnosticSummaryMetric(report.summary, event?.message);
      if (didApply) {
        continue;
      }
    }

    if (eventType === "test:fail") {
      const sourceFile = resolveSourcePath(event.file);
      if (
        isIgnorableRunnerSpawnFailure({
          event,
          sourceFile,
          runnerRelativePath,
        })
      ) {
        ignoredRunnerSpawnFailures += 1;
        continue;
      }

      report.failures.push({
        name: event.name,
        file: sourceFile,
        line: event.line,
        column: event.column,
        nesting: event.nesting,
        testNumber: event.testNumber,
        details: {
          durationMs: event.details?.duration_ms,
          type: event.details?.type,
          error: serializeError(event.details?.error),
        },
      });
      continue;
    }
  }

  applyIgnoredFailureAdjustments(report.summary, ignoredRunnerSpawnFailures);
  report.summary.success = report.failures.length === 0;
  const didFail = report.summary.success === false;
  report.status = didFail ? "failed" : "passed";
  report.exitCode = didFail ? 1 : 0;
  process.exitCode = report.exitCode;
} catch (error) {
  report.exitCode = 1;
  process.exitCode = 1;
  report.startupError = serializeError(error);

  if(
    report.summary.counts.tests === 0 &&
    report.summary.counts.suites === 0 &&
    report.failures.length === 0
  ) {
    report.status = "startup-failed";
  } else {
    report.status = "failed";
  }
} finally {
  writeReport();
  console.log("Review test report for failure details: artifacts/test-reports/non-browser-test-report.json");
}

const metricPattern =
  /^(?:\W+)?\s*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+(.+)$/;

const supportedTestSuites = new Set(["all", "short", "long"]);
const longRunningTestFilePattern =
  /\.(?:e2e|integration)\.test\.[cm]?[jt]sx?$/i;
const longRunningTestMarkerPattern = /^\s*\/\/\s*@test-duration\s+long\s*$/m;
const vitestImportPattern = /\bfrom\s+["']vitest["']/m;
const nonBrowserAssetSourcePattern = /\.(?:png|svg)$/i;

export const isVitestOwnedTestSource = (sourceText) =>
  vitestImportPattern.test(sourceText);

export const isNonBrowserAssetSource = (sourcePath) =>
  typeof sourcePath === "string" &&
  nonBrowserAssetSourcePattern.test(sourcePath);

export const createNonBrowserAssetModule = (sourcePath) => {
  if (!isNonBrowserAssetSource(sourcePath)) {
    throw new Error("Unsupported non-browser test asset source.");
  }
  const fileName = sourcePath.split(/[\\/]/).at(-1);
  return `export default ${JSON.stringify(fileName)};\n`;
};

export const classifyTestFileDuration = (sourcePath, sourceText = "") =>
  longRunningTestFilePattern.test(sourcePath) ||
  longRunningTestMarkerPattern.test(sourceText)
    ? "long"
    : "short";

export const shouldIncludeTestFileForSuite = ({
  sourcePath,
  sourceText,
  suite,
}) =>
  suite === "all" || classifyTestFileDuration(sourcePath, sourceText) === suite;

export const parseTestSuiteArgument = (args, fallback = "all") => {
  const explicitArgument = args.find((argument) =>
    argument.startsWith("--suite="),
  );
  const suite = explicitArgument
    ? explicitArgument.slice("--suite=".length)
    : fallback;
  if (supportedTestSuites.has(suite) === false) {
    throw new Error("Unsupported test suite. Expected short, long, or all.");
  }
  return suite;
};

export const createTestTimingTracker = ({ limit = 20 } = {}) => {
  const fileDurations = new Map();
  const testDurations = [];

  return {
    record({ file, name, nesting, durationMs, status }) {
      if (
        typeof file !== "string" ||
        !Number.isFinite(durationMs) ||
        durationMs < 0
      ) {
        return;
      }
      const normalizedNesting = Number.isFinite(nesting) ? nesting : 0;
      testDurations.push({
        file,
        name,
        durationMs,
        nesting: normalizedNesting,
        status,
      });
      if (normalizedNesting === 0) {
        fileDurations.set(file, (fileDurations.get(file) ?? 0) + durationMs);
      }
    },
    snapshot() {
      const slowestFiles = [...fileDurations.entries()]
        .map(([file, durationMs]) => ({ file, durationMs }))
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, limit);
      const slowestTests = [...testDurations]
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, limit);
      return { slowestFiles, slowestTests };
    },
  };
};

export const buildNonBrowserNodeTestRunOptions = ({ files, cwd }) => ({
  cwd,
  files: [...files],
  isolation: "none",
});

const formatSerializedError = (error) => {
  if (!error || typeof error !== "object") {
    return "Unknown error";
  }

  if (typeof error.stack === "string" && error.stack.trim().length > 0) {
    return error.stack.trim();
  }

  const name =
    typeof error.name === "string" && error.name.length > 0
      ? error.name
      : "Error";
  const message =
    typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "No error message was provided.";
  return `${name}: ${message}`;
};

export const formatNonBrowserFailureSummary = ({
  failures = [],
  startupError = null,
} = {}) => {
  const lines = [];

  if (startupError) {
    lines.push("Non-browser test runner startup failed:");
    lines.push(formatSerializedError(startupError));
  }

  if (failures.length > 0) {
    lines.push(`Non-browser test failures (${failures.length}):`);
    for (const failure of failures) {
      const name =
        typeof failure?.name === "string" && failure.name.length > 0
          ? failure.name
          : "Unnamed test";
      const file =
        typeof failure?.file === "string" && failure.file.length > 0
          ? failure.file
          : "";
      const position = [failure?.line, failure?.column]
        .filter(Number.isFinite)
        .join(":");
      const location = file ? `${file}${position ? `:${position}` : ""}` : "";
      lines.push(`- ${name}${location ? ` (${location})` : ""}`);
      lines.push(formatSerializedError(failure?.details?.error));
    }
  }

  return lines.join("\n");
};

export const applyDiagnosticSummaryMetric = (summary, diagnosticMessage) => {
  const message =
    typeof diagnosticMessage === "string" ? diagnosticMessage.trim() : "";
  const match = metricPattern.exec(message);

  if (!match) {
    return false;
  }

  const [, metricName, rawValue] = match;
  const numericValue = Number(rawValue);

  switch (metricName) {
    case "tests":
      summary.counts.tests = numericValue;
      return true;
    case "suites":
      summary.counts.suites = numericValue;
      return true;
    case "pass":
      summary.counts.passed = numericValue;
      return true;
    case "fail":
      summary.counts.failed = numericValue;
      return true;
    case "cancelled":
      summary.counts.cancelled = numericValue;
      return true;
    case "skipped":
      summary.counts.skipped = numericValue;
      return true;
    case "todo":
      summary.counts.todo = numericValue;
      return true;
    case "duration_ms":
      summary.durationMs = numericValue;
      return true;
    default:
      return false;
  }
};

export const isIgnorableRunnerSpawnFailure = ({
  event,
  sourceFile,
  runnerRelativePath,
}) => {
  if (!event || typeof event !== "object") {
    return false;
  }

  const file = typeof sourceFile === "string" ? sourceFile : "";
  const errorCode = event.details?.error?.code;
  const causeCode = event.details?.error?.cause?.code;

  return (
    file === runnerRelativePath &&
    errorCode === "ERR_TEST_FAILURE" &&
    causeCode === "EPERM"
  );
};

export const applyIgnoredFailureAdjustments = (
  summary,
  ignoredFailureCount,
) => {
  if (!Number.isFinite(ignoredFailureCount) || ignoredFailureCount <= 0) {
    return;
  }

  summary.counts.failed = Math.max(
    0,
    summary.counts.failed - ignoredFailureCount,
  );
  summary.counts.tests = Math.max(
    0,
    summary.counts.tests - ignoredFailureCount,
  );
};

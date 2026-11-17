import { lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";

function inspectIfPresent(target) {
  try { return lstatSync(target); } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function prepareVitestReport(root, relative) {
  if (!/^artifacts\/test-reports\/[a-z0-9-]+\.json$/.test(relative)) {
    throw new Error("Invalid test report location.");
  }
  let directory = realpathSync(root);
  for (const component of ["artifacts", "test-reports"]) {
    directory = path.join(directory, component);
    if (!inspectIfPresent(directory)) mkdirSync(directory, { mode: 0o700 });
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(realpathSync(directory)) !== directory) {
      throw new Error("Unsafe test report directory.");
    }
  }
  const target = path.join(directory, path.basename(relative));
  const previous = inspectIfPresent(target);
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink()) throw new Error("Unsafe previous test report.");
    unlinkSync(target);
  }
  return target;
}

export function exactVitestFiles(root, files) {
  const resolvedRoot = realpathSync(root);
  if (!Array.isArray(files) || files.length < 1 || files.length > 1000 ||
      new Set(files).size !== files.length) throw new Error("Invalid exact test selection.");
  return files.map((file) => {
    if (typeof file !== "string" || !/^(?:modules|apps)\//.test(file) ||
        file.split("/").some((part) => !part || part === "." || part === "..") ||
        /[\\:\u0000-\u001f*?{}\[\]!()]/.test(file) || !/\.test\.[cm]?[jt]sx?$/.test(file)) {
      throw new Error("Invalid exact test selection.");
    }
    const target = path.resolve(resolvedRoot, file);
    if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink() ||
        path.resolve(realpathSync(target)) !== target) throw new Error("Unsafe test source.");
    return target;
  }).sort();
}

// Positional Vitest CLI paths are substring filters. Reuse the focused adapter's
// exact include and collection checks; never search saved worktree copies.
export async function runExactVitest({ root, files, reportRelativePath }) {
  const expected = exactVitestFiles(root, files);
  const reportPath = prepareVitestReport(root, reportRelativePath);
  const { startVitest } = await import("vitest/node");
  const context = await startVitest("test", [], {
    root, config: false, watch: false, run: true, include: files, exclude: [],
    environment: "jsdom", maxWorkers: 1, passWithNoTests: false,
    reporters: ["json"], outputFile: reportPath,
  });
  if (!context) return { exitCode: 1, selection: { status: "unavailable" } };
  try {
    const collected = context.state.getFiles();
    const actual = collected.map((file) => path.resolve(file.filepath)).sort();
    const unhandledErrors = context.state.getUnhandledErrors().length;
    const reportInfo = lstatSync(reportPath);
    if (!reportInfo.isFile() || reportInfo.isSymbolicLink() || reportInfo.size > 16 * 1024 * 1024) {
      throw new Error("Unavailable bounded test report.");
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const matched = JSON.stringify(actual) === JSON.stringify(expected);
    const reported = report.testResults.map((file) => path.resolve(file.name)).sort();
    const reportMatched = JSON.stringify(reported) === JSON.stringify(expected);
    const passed = matched && collected.every((file) => ["pass", "skip"].includes(file.result?.state)) &&
      unhandledErrors === 0 && report.success === true && report.numFailedTests === 0 &&
      reportMatched && Number.isSafeInteger(report.numPassedTests) && report.numPassedTests > 0 && !process.exitCode;
    return {
      exitCode: passed ? 0 : 1,
      selection: { status: matched && reportMatched ? "exact" : "mismatch", expectedFiles: expected.length,
        collectedFiles: actual.length, reportedFiles: reported.length, maxWorkers: 1, unhandledErrors },
    };
  } finally {
    await context.close();
  }
}

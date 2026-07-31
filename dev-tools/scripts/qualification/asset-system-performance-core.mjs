import { performance } from "node:perf_hooks";

const SAFE_ID = /^[a-z0-9][a-z0-9.-]{1,159}$/;
const MINIMUM_SAMPLES = 20;
const MAXIMUM_SAMPLES = 10_000;
const MAXIMUM_OBSERVED_MILLISECONDS = 3_600_000;

export async function runAssetSystemPerformanceQualification({
  config,
  environmentId,
  sourceRevision,
  probes,
  iterations = 30,
  warmupIterations = 5,
  recordedAt = new Date().toISOString(),
  now = () => performance.now(),
}) {
  if (
    !SAFE_ID.test(String(environmentId ?? "")) ||
    !SAFE_ID.test(String(sourceRevision ?? "")) ||
    !Number.isInteger(iterations) ||
    iterations < MINIMUM_SAMPLES ||
    iterations > MAXIMUM_SAMPLES ||
    !Number.isInteger(warmupIterations) ||
    warmupIterations < 0 ||
    warmupIterations > 100 ||
    !probes ||
    typeof probes !== "object"
  )
    throw new Error("Performance qualification runner options are invalid.");

  const operations = [];
  for (const budget of config.performanceBudgets) {
    const probe = probes[budget.operation];
    if (typeof probe !== "function")
      throw new Error(`Performance probe '${budget.operation}' is missing.`);
    for (let index = 0; index < warmupIterations; index += 1) await probe();
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
      const started = now();
      await probe();
      const duration = now() - started;
      if (
        !Number.isFinite(duration) ||
        duration < 0 ||
        duration > MAXIMUM_OBSERVED_MILLISECONDS
      )
        throw new Error(
          `Performance probe '${budget.operation}' produced an invalid duration.`,
        );
      samples.push(duration);
    }
    const observedP95Milliseconds = roundMilliseconds(
      nearestRankPercentile(samples, budget.percentile),
    );
    operations.push({
      operation: budget.operation,
      workload: budget.workload,
      percentile: budget.percentile,
      sampleCount: samples.length,
      observedP95Milliseconds,
      maximumMilliseconds: budget.maximumMilliseconds,
      status:
        observedP95Milliseconds <= budget.maximumMilliseconds
          ? "passed"
          : "failed",
    });
  }
  const report = {
    schemaVersion: 1,
    environmentId,
    sourceRevision,
    recordedAt,
    status: operations.every((item) => item.status === "passed")
      ? "passed"
      : "failed",
    operations,
  };
  validateAssetSystemPerformanceReport(config, report);
  return report;
}

export function validateAssetSystemPerformanceReport(config, report) {
  if (
    report?.schemaVersion !== 1 ||
    !SAFE_ID.test(String(report?.environmentId ?? "")) ||
    !SAFE_ID.test(String(report?.sourceRevision ?? "")) ||
    Number.isNaN(Date.parse(String(report?.recordedAt ?? ""))) ||
    !["passed", "failed"].includes(report?.status) ||
    !Array.isArray(report?.operations)
  )
    throw new Error("Performance qualification report envelope is invalid.");
  const budgets = new Map(
    config.performanceBudgets.map((budget) => [budget.operation, budget]),
  );
  const seen = new Set();
  for (const operation of report.operations) {
    const budget = budgets.get(operation?.operation);
    const expectedStatus =
      Number.isFinite(operation?.observedP95Milliseconds) && budget
        ? operation.observedP95Milliseconds <= budget.maximumMilliseconds
          ? "passed"
          : "failed"
        : undefined;
    if (
      !budget ||
      seen.has(operation.operation) ||
      operation.workload !== budget.workload ||
      operation.percentile !== budget.percentile ||
      !Number.isInteger(operation.sampleCount) ||
      operation.sampleCount < MINIMUM_SAMPLES ||
      operation.sampleCount > MAXIMUM_SAMPLES ||
      !Number.isFinite(operation.observedP95Milliseconds) ||
      operation.observedP95Milliseconds < 0 ||
      operation.observedP95Milliseconds > MAXIMUM_OBSERVED_MILLISECONDS ||
      operation.maximumMilliseconds !== budget.maximumMilliseconds ||
      operation.status !== expectedStatus
    )
      throw new Error("Performance qualification operation is invalid.");
    seen.add(operation.operation);
  }
  if (
    seen.size !== budgets.size ||
    [...budgets.keys()].some((operation) => !seen.has(operation)) ||
    report.status !==
      (report.operations.every((operation) => operation.status === "passed")
        ? "passed"
        : "failed")
  )
    throw new Error("Performance qualification report is incomplete.");
  return report;
}

function nearestRankPercentile(samples, percentile) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)];
}

const roundMilliseconds = (value) => Math.round(value * 1_000) / 1_000;

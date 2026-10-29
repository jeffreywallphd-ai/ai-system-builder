import {types as nodeTypes} from "node:util";

/** Internal test-run facts only. Never serialize the caught failure values. */
export interface QualificationEvidenceReport {
  status: string;
  failureStage?: string;
  finalizationStage?: "evidence-attach" | "evidence-save";
}

/** Attempt final publication once, with one bounded failed-write recovery. */
export async function finalizeQualificationEvidence(
  report: QualificationEvidenceReport,
  primaryFailures: readonly unknown[],
  save: () => Promise<void>,
  attach: () => Promise<unknown>,
  successfulStatus: "passed" | "diagnostic-passed" = "passed",
): Promise<void> {
  if (successfulStatus !== "passed" && successfulStatus !== "diagnostic-passed") {
    throw new Error("Unsupported qualification success status.");
  }
  const failures = [...primaryFailures];
  if (report.status !== successfulStatus && failures.length === 0) {
    failures.push(new Error("Qualification did not complete."));
  }
  if (failures.length) {
    report.status = "failed";
    report.failureStage ??= "journey";
  }
  const failed = (stage: "evidence-attach" | "evidence-save", error: unknown) => {
    failures.push(error);
    report.status = "failed";
    report.failureStage ??= stage;
    report.finalizationStage = stage;
  };
  // An attachment failure must change the status before final persistence.
  try { await attach(); } catch (error) { failed("evidence-attach", error); }
  try { await save(); } catch (error) {
    failed("evidence-save", error);
    // The caller retains its existing exclusive-create/ownership policy. A
    // refused or unavailable file cannot be overwritten to manufacture proof.
    try { await save(); } catch (retryError) { failures.push(retryError); }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Qualification or evidence publication failed.");
  }
}

const safeErrorNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "AggregateError", "AssertionError", "TimeoutError"]);
const nativeErrorNames = new Map<object, string>([
  [Error.prototype, "Error"], [TypeError.prototype, "TypeError"], [RangeError.prototype, "RangeError"],
  [ReferenceError.prototype, "ReferenceError"], [SyntaxError.prototype, "SyntaxError"], [AggregateError.prototype, "AggregateError"],
]);
export function isQualificationFailureType(value: unknown): value is string {
  return value === "Unknown" || typeof value === "string" && safeErrorNames.has(value);
}

export type OwnedCleanupFailureStage = "admission" | "app-close" | "main-exit" | "observer-close" | "worker-exit" | "worker-list";
const ownedCleanupFailureStages = new Set<unknown>(["admission", "app-close", "main-exit", "observer-close", "worker-exit", "worker-list"]);
export function isOwnedCleanupFailureStage(value: unknown): value is OwnedCleanupFailureStage {
  return ownedCleanupFailureStages.has(value);
}

/** Fixed labels only; do not read exception messages, getters or proxy traps. */
export function safeQualificationFailureType(value: unknown): string {
  if (nodeTypes.isProxy(value) || !nodeTypes.isNativeError(value)) return "Unknown";
  const name = Object.getOwnPropertyDescriptor(value, "name");
  if (name) return "value" in name && typeof name.value === "string" && safeErrorNames.has(name.value) ? name.value : "Unknown";
  return nativeErrorNames.get(Object.getPrototypeOf(value)) ?? "Error";
}

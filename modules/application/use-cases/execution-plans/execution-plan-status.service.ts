import type { ExecutionPlanStatus } from "../../../contracts/execution-plans";
import type { RuntimeReadinessStatus } from "../../../contracts/runtime-readiness";

export class ExecutionPlanStatusService {
  public calculate(args: { readinessStatus: RuntimeReadinessStatus; hasStaleSource: boolean; hasBlockers: boolean; hasMissingInputs: boolean; hasMissingOutputs: boolean; hasMissingAdapters: boolean; requiresSafetyReview?: boolean; isInvalid?: boolean; }): ExecutionPlanStatus {
    if (args.isInvalid) return "invalid";
    if (args.readinessStatus !== "ready-for-setup") return "needs-setup";
    if (args.hasStaleSource) return "stale";
    if (args.hasMissingInputs) return "missing-inputs";
    if (args.hasMissingOutputs) return "missing-outputs";
    if (args.hasMissingAdapters) return "provider-setup-required";
    if (args.hasBlockers) return "blocked";
    if (args.requiresSafetyReview) return "safety-review-required";
    return "ready-for-review";
  }
}

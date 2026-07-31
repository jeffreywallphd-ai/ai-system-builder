import { createExecutionPlanFailure, type ExecutionPlanFailureKind } from "../../../contracts/execution-plans";

export const executionPlanFailure = (failureKind: ExecutionPlanFailureKind, code: string) =>
  createExecutionPlanFailure(failureKind, [{ code, severity: "error", message: "Sanitized execution-plan diagnostic." }]);

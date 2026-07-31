import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";
import type { ExecutionPlanListQuery, ExecutionPlanRepositoryPort } from "..";

describe("execution plan repository port", () => {
  it("exports family barrel and explicit workspace-scoped signatures", () => {
    expectTypeOf<keyof ExecutionPlanRepositoryPort>().toEqualTypeOf<
      "saveExecutionPlan" | "updateExecutionPlan" | "getExecutionPlanById" | "listExecutionPlans" | "archiveExecutionPlan"
    >();
    expectTypeOf<Parameters<ExecutionPlanRepositoryPort["getExecutionPlanById"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<ExecutionPlanListQuery>().toExtend<{ workspaceId: string }>();
    expect(({} as Partial<ExecutionPlanListQuery>).workspaceId).toBeUndefined();
  });

  it("keeps list query filters safe", () => {
    expectTypeOf<ExecutionPlanListQuery>().not.toExtend<{ promptText?: string; workflowJson?: string; commandLine?: string; secret?: string; env?: string; path?: string; storageRoot?: string; base64?: string }>();
  });
});

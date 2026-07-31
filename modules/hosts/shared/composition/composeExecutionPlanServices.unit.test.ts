import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeExecutionPlanServices } from "./composeExecutionPlanServices";

describe("composeExecutionPlanServices", () => {
  it("creates execution plan use cases and read model", () => {
    const repository = {} as any;
    const services = composeExecutionPlanServices({
      executionPlanRepository: repository,
      runtimeReadinessBindingRepository: {} as any,
      compositionPlanRepository: {} as any,
      now: () => "2026-05-21T00:00:00.000Z",
    });

    assert.ok(services.createPlan);
    assert.ok(services.validatePlan);
    assert.ok(services.readModel);
  });
});

import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { TaskType } from "../../../../contracts/runtime";
import type { PowerSuspensionBlockerPort } from "../../../ports/desktop";
import { TaskPowerLifecycleService } from "../task-power-lifecycle.service";

function createPowerSuspensionMock(): PowerSuspensionBlockerPort {
  let seq = 0;
  return {
    startBlocker: testDouble.fn(async () => ({ blockerId: `b-${++seq}`, active: true })),
    stopBlocker: testDouble.fn(async (blockerId) => ({ blockerId, active: false })),
    listBlockers: testDouble.fn(async () => []),
  };
}

describe("TaskPowerLifecycleService", () => {
  it("startTask creates blocker", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.DATASET_PREPARATION);
    expect(power.startBlocker).toHaveBeenCalledTimes(1);
  });

  it("completeTask stops blocker", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await service.completeTask("r1", "failed");
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
  });

  it("repeated completeTask is safe", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await service.completeTask("r1", "succeeded");
    await service.completeTask("r1", "succeeded");
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
  });

  it("multiple tasks tracked independently", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await service.startTask("r2", TaskType.DATASET_PREPARATION);
    await service.completeTask("r1", "cancelled");
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
    await service.completeTask("r2", "failed");
    expect(power.stopBlocker).toHaveBeenCalledTimes(2);
  });

  it("startTask overwrites stale mapping safely", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
    expect(power.startBlocker).toHaveBeenCalledTimes(2);
  });

  it("start failure does not break task", async () => {
    const power = createPowerSuspensionMock();
    power.startBlocker = testDouble.fn(async () => { throw new Error("boom"); });
    const service = new TaskPowerLifecycleService(power);
    await expect(service.startTask("r1", TaskType.MODEL_TRAINING)).resolves.toBeUndefined();
  });

  it("stop failure does not throw", async () => {
    const power = createPowerSuspensionMock();
    power.stopBlocker = testDouble.fn(async () => { throw new Error("boom"); });
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await expect(service.completeTask("r1", "unknown")).resolves.toBeUndefined();
    await expect(service.completeTask("r1", "unknown")).resolves.toBeUndefined();
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
  });

  it("starting same request id completes old blocker before starting replacement", async () => {
    const power = createPowerSuspensionMock();
    const service = new TaskPowerLifecycleService(power);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    await service.startTask("r1", TaskType.MODEL_TRAINING);
    expect(power.stopBlocker).toHaveBeenCalledTimes(1);
    expect(power.startBlocker).toHaveBeenCalledTimes(2);
  });
});

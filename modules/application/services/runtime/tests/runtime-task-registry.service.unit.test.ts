import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { TaskType, type RuntimeTaskRecord, type RuntimeTaskStatusRecord } from "../../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../ports/runtime";
import type { TaskPowerLifecyclePort } from "../task-power-lifecycle.service";
import { RuntimeTaskRegistryService } from "../runtime-task-registry.service";

function createRegistryPortMock(): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn(async () => ({ requestId: "r-1" })),
    getTaskStatus: testDouble.fn(async (): Promise<RuntimeTaskRecord> => ({
      requestId: "r-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "succeeded",
      concurrencyClass: "gpu-exclusive",
    })),
    cancelTask: testDouble.fn(async () => ({ requestId: "r-1", status: "cancelled", cancelled: true })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
  };
}

function createLifecycleMock(): TaskPowerLifecyclePort {
  return {
    startTask: testDouble.fn(async () => undefined),
    completeTask: testDouble.fn(async () => undefined),
  };
}

describe("RuntimeTaskRegistryService", () => {
  it("delegates start and attaches power lifecycle", async () => {
    const registry = createRegistryPortMock();
    const lifecycle = createLifecycleMock();
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    const result = await service.startAndAttachLifecycle({
      taskType: TaskType.MODEL_TRAINING,
      concurrencyClass: "gpu-exclusive",
      payload: { run: true },
    });

    expect(result.requestId).toBe("r-1");
    expect(registry.startTask).toHaveBeenCalledTimes(1);
    expect(lifecycle.startTask).toHaveBeenCalledTimes(1);
  });

  it("safeCancel swallows port failures", async () => {
    const registry = createRegistryPortMock();
    registry.cancelTask = testDouble.fn(async () => { throw new Error("boom"); });
    const lifecycle = createLifecycleMock();
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    await expect(service.safeCancel("r-1")).resolves.toBeUndefined();
  });

  it("readTaskAndCompleteLifecycleIfTerminal swallows lifecycle failures", async () => {
    const registry = createRegistryPortMock();
    const lifecycle = createLifecycleMock();
    lifecycle.completeTask = testDouble.fn(async () => { throw new Error("boom"); });
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    const record = await service.readTaskAndCompleteLifecycleIfTerminal("r-1");
    expect(record.status).toBe("succeeded");
  });

  it("calls onTerminal when read result is terminal", async () => {
    const registry = createRegistryPortMock();
    const lifecycle = createLifecycleMock();
    const onTerminal = testDouble.fn(async () => undefined);
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    await service.readTaskAndCompleteLifecycleIfTerminal("r-1", { onTerminal });
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it("does not call onTerminal when read result is non-terminal", async () => {
    const registry = createRegistryPortMock();
    registry.getTaskStatus = testDouble.fn(async (): Promise<RuntimeTaskRecord> => ({
      requestId: "r-1",
      taskType: TaskType.MODEL_TRAINING,
      status: "running",
      concurrencyClass: "gpu-exclusive",
    }));
    const lifecycle = createLifecycleMock();
    const onTerminal = testDouble.fn(async () => undefined);
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    await service.readTaskAndCompleteLifecycleIfTerminal("r-1", { onTerminal });
    expect(onTerminal).toHaveBeenCalledTimes(0);
  });

  it("swallows onTerminal hook failures during terminal reads", async () => {
    const registry = createRegistryPortMock();
    const lifecycle = createLifecycleMock();
    const onTerminal = testDouble.fn(async () => { throw new Error("boom"); });
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    const result = await service.readTaskAndCompleteLifecycleIfTerminal("r-1", { onTerminal });
    expect(result).toMatchObject({
      requestId: "r-1",
      status: "succeeded",
    });
  });

  it("returns not-found status records without calling terminal task hooks", async () => {
    const registry = createRegistryPortMock();
    registry.getTaskStatus = testDouble.fn(async (): Promise<RuntimeTaskStatusRecord> => ({
      recordType: "not-found",
      requestId: "missing-request",
      status: "unknown",
      concurrencyClass: "unknown",
      error: {
        code: "not-found",
        message: "Runtime task was not found.",
        retryable: false,
      },
    }));
    const lifecycle = createLifecycleMock();
    const onTerminal = testDouble.fn(async () => undefined);
    const service = new RuntimeTaskRegistryService(registry, lifecycle);

    const result = await service.readTaskAndCompleteLifecycleIfTerminal("missing-request", { onTerminal });

    expect(result).toMatchObject({ recordType: "not-found", requestId: "missing-request", status: "unknown" });
    expect(lifecycle.completeTask).toHaveBeenCalledWith("missing-request", "unknown");
    expect(onTerminal).toHaveBeenCalledTimes(0);
  });
});

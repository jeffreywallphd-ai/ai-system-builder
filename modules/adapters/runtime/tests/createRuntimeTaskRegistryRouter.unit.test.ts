import { describe, expect, it, testDouble } from "../../../testing/node-test";
import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import { TaskType, type RuntimeTaskListRequest, type RuntimeTaskListResult } from "../../../contracts/runtime";
import { createRuntimeTaskRegistryRouter } from "../createRuntimeTaskRegistryRouter";

function createRegistryStub(
  listTasks: RuntimeTaskRegistryPort["listTasks"],
): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn<RuntimeTaskRegistryPort["startTask"]>(),
    getTaskStatus: testDouble.fn<RuntimeTaskRegistryPort["getTaskStatus"]>(),
    cancelTask: testDouble.fn<RuntimeTaskRegistryPort["cancelTask"]>(),
    listTasks,
  };
}

describe("createRuntimeTaskRegistryRouter", () => {
  it("routes plural task-type list filters to only the matching task registries", async () => {
    const imageListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>()
      .mockResolvedValue({ tasks: [] });
    const pythonListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>()
      .mockResolvedValue({ tasks: [] });
    const router = createRuntimeTaskRegistryRouter({
      image: createRegistryStub(imageListTasks),
      python: createRegistryStub(pythonListTasks),
    });

    await router.listTasks({
      taskTypes: [TaskType.IMAGE_GENERATION, TaskType.MODEL_TRAINING],
      statuses: ["running"],
    });

    expect(imageListTasks).toHaveBeenCalledWith({
      taskTypes: [TaskType.IMAGE_GENERATION],
      statuses: ["running"],
    });
    expect(pythonListTasks).toHaveBeenCalledWith({
      taskTypes: [TaskType.MODEL_TRAINING],
      statuses: ["running"],
    });
  });

  it("does not call unrelated registries for single-family task-type list filters", async () => {
    const imageListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>()
      .mockResolvedValue({ tasks: [] });
    const pythonListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>()
      .mockResolvedValue({ tasks: [] });
    const router = createRuntimeTaskRegistryRouter({
      image: createRegistryStub(imageListTasks),
      python: createRegistryStub(pythonListTasks),
    });

    await router.listTasks({ taskTypes: [TaskType.MODEL_VALIDATION] });

    expect(imageListTasks).toHaveBeenCalledTimes(0);
    expect(pythonListTasks).toHaveBeenCalledWith({ taskTypes: [TaskType.MODEL_VALIDATION] });
  });
});

import { describe, expect, it, testDouble } from "../../../testing/node-test";
import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import { TaskType, type RuntimeTaskListRequest, type RuntimeTaskListResult, type RuntimeTaskRecord, type RuntimeTaskStatusRecord } from "../../../contracts/runtime";
import { createWorkspaceId } from "../../../contracts/workspace";
import { createRuntimeTaskRegistryRouter } from "../createRuntimeTaskRegistryRouter";

const workspaceId = createWorkspaceId("workspace.a");

function createRegistryStub(overrides: Partial<RuntimeTaskRegistryPort> = {}): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn(async (request) => ({ requestId: request.requestId ?? `${request.taskType}-1`, status: "queued" })),
    getTaskStatus: testDouble.fn(async (requestId) => ({ recordType: "not-found", requestId, status: "unknown", concurrencyClass: "unknown", error: { code: "runtime_task_not_found", message: "missing", retryable: false } } as RuntimeTaskStatusRecord)),
    cancelTask: testDouble.fn(async (requestId) => ({ requestId, cancelled: false, status: "unknown", message: "Runtime task was not found in this task registry delegate." })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
    ...overrides,
  };
}

describe("createRuntimeTaskRegistryRouter", () => {
  it("startTask records task correlation for successful starts", async () => {
    const image = createRegistryStub({ startTask: testDouble.fn(async () => ({ requestId: "img-1", status: "queued" })) });
    const python = createRegistryStub();
    const router = createRuntimeTaskRegistryRouter({ image, python });

    await router.startTask({ workspaceId, taskType: TaskType.IMAGE_GENERATION, payload: { prompt: "cat" } });
    await router.getTaskStatus("img-1");

    expect(image.getTaskStatus).toHaveBeenCalledWith("img-1");
    expect(python.getTaskStatus).not.toHaveBeenCalled();
  });

  it("getTaskStatus uses known correlation when available", async () => {
    const image = createRegistryStub();
    const python = createRegistryStub({
      startTask: testDouble.fn(async () => ({ requestId: "train-1", status: "running" })),
      getTaskStatus: testDouble.fn(async (requestId) => ({ requestId, taskType: TaskType.MODEL_TRAINING, status: "running", concurrencyClass: "unknown" })),
    });
    const router = createRuntimeTaskRegistryRouter({ image, python });

    await router.startTask({ workspaceId, taskType: TaskType.MODEL_TRAINING, payload: {} });
    const record = await router.getTaskStatus("train-1");

    expect(record).toMatchObject({ requestId: "train-1", taskType: TaskType.MODEL_TRAINING, status: "running" });
    expect(image.getTaskStatus).not.toHaveBeenCalled();
    expect(python.getTaskStatus).toHaveBeenCalledWith("train-1");
  });

  it("getTaskStatus queries delegates when correlation is missing and records recovered correlation", async () => {
    const image = createRegistryStub();
    const python = createRegistryStub({
      getTaskStatus: testDouble.fn(async (requestId) => ({ requestId, taskType: TaskType.DATASET_PREPARATION, status: "running", concurrencyClass: "unknown" })),
    });
    const router = createRuntimeTaskRegistryRouter({ image, python });

    const record = await router.getTaskStatus("lost-correlation");
    await router.getTaskStatus("lost-correlation");

    expect(record).toMatchObject({ requestId: "lost-correlation", taskType: TaskType.DATASET_PREPARATION, status: "running" });
    expect(image.getTaskStatus).toHaveBeenCalledTimes(1);
    expect(python.getTaskStatus).toHaveBeenCalledTimes(2);
  });

  it("unknown request IDs return explicit not-found status instead of synthetic success", async () => {
    const router = createRuntimeTaskRegistryRouter({ image: createRegistryStub(), python: createRegistryStub() });
    const record = await router.getTaskStatus("missing");
    expect(record).toMatchObject({
      recordType: "not-found",
      requestId: "missing",
      status: "unknown",
      error: { code: "runtime_task_not_found" },
    });
    expect("taskType" in record).toBe(false);
  });

  it("cancelTask uses known correlation when available", async () => {
    const image = createRegistryStub({ startTask: testDouble.fn(async () => ({ requestId: "img-cancel", status: "queued" })), cancelTask: testDouble.fn(async (requestId) => ({ requestId, cancelled: true, status: "cancelled" })) });
    const python = createRegistryStub();
    const router = createRuntimeTaskRegistryRouter({ image, python });

    await router.startTask({ workspaceId, taskType: TaskType.IMAGE_GENERATION, payload: {} });
    const result = await router.cancelTask("img-cancel");

    expect(result).toEqual({ requestId: "img-cancel", cancelled: true, status: "cancelled" });
    expect(image.cancelTask).toHaveBeenCalledWith("img-cancel");
    expect(python.cancelTask).not.toHaveBeenCalled();
  });

  it("cancelTask handles unknown request IDs predictably", async () => {
    const router = createRuntimeTaskRegistryRouter({ image: createRegistryStub(), python: createRegistryStub() });
    const result = await router.cancelTask("missing");
    expect(result).toMatchObject({ requestId: "missing", cancelled: false, status: "unknown" });
  });

  it("routes plural task-type list filters to only the matching task registries", async () => {
    const imageListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>().mockResolvedValue({ tasks: [] });
    const pythonListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>().mockResolvedValue({ tasks: [] });
    const router = createRuntimeTaskRegistryRouter({ image: createRegistryStub({ listTasks: imageListTasks }), python: createRegistryStub({ listTasks: pythonListTasks }) });

    await router.listTasks({ workspaceId, taskTypes: [TaskType.IMAGE_GENERATION, TaskType.MODEL_TRAINING], statuses: ["running"] });

    expect(imageListTasks).toHaveBeenCalledWith({ workspaceId, taskTypes: [TaskType.IMAGE_GENERATION], statuses: ["running"] });
    expect(pythonListTasks).toHaveBeenCalledWith({ workspaceId, taskTypes: [TaskType.MODEL_TRAINING], statuses: ["running"] });
  });

  it("does not call unrelated registries for single-family task-type list filters", async () => {
    const imageListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>().mockResolvedValue({ tasks: [] });
    const pythonListTasks = testDouble.fn<(request: RuntimeTaskListRequest) => Promise<RuntimeTaskListResult>>().mockResolvedValue({ tasks: [] });
    const router = createRuntimeTaskRegistryRouter({ image: createRegistryStub({ listTasks: imageListTasks }), python: createRegistryStub({ listTasks: pythonListTasks }) });

    await router.listTasks({ workspaceId, taskTypes: [TaskType.MODEL_VALIDATION] });

    expect(imageListTasks).toHaveBeenCalledTimes(0);
    expect(pythonListTasks).toHaveBeenCalledWith({ workspaceId, taskTypes: [TaskType.MODEL_VALIDATION] });
  });

  it("listTasks aggregates supported delegates and preserves unsupported metadata", async () => {
    const router = createRuntimeTaskRegistryRouter({
      image: createRegistryStub({ listTasks: testDouble.fn(async () => ({ tasks: [{ requestId: "img-1", workspaceId, taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "gpu-exclusive" }] })) }),
      python: createRegistryStub({ listTasks: testDouble.fn(async () => ({ tasks: [], unsupportedTaskTypes: [TaskType.MODEL_TRAINING], warnings: [{ code: "python_runtime_task_listing_unsupported", message: "unsupported", taskTypes: [TaskType.MODEL_TRAINING] }] })) }),
    });

    const result = await router.listTasks({ workspaceId });

    expect(result.tasks.map((task) => task.requestId)).toEqual(["img-1"]);
    expect(result.unsupportedTaskTypes).toEqual([TaskType.MODEL_TRAINING]);
    expect(result.warnings?.[0]).toMatchObject({ code: "python_runtime_task_listing_unsupported" });
  });

  it("listTasks does not fail the whole call when one delegate throws", async () => {
    const router = createRuntimeTaskRegistryRouter({
      image: createRegistryStub({ listTasks: testDouble.fn(async () => ({ tasks: [{ requestId: "img-1", workspaceId, taskType: TaskType.IMAGE_GENERATION, status: "running", concurrencyClass: "gpu-exclusive" }] })) }),
      python: createRegistryStub({ listTasks: testDouble.fn(async () => { throw new Error("not supported at /tmp/secret TOKEN=abc C:\\cache"); }) }),
    });

    const result = await router.listTasks({ workspaceId, taskTypes: [TaskType.IMAGE_GENERATION, TaskType.MODEL_TRAINING] });

    expect(result.tasks.length).toBe(1);
    expect(result.unsupportedTaskTypes).toEqual([TaskType.MODEL_TRAINING]);
    expect(result.warnings?.[0]).toMatchObject({
      code: "runtime_task_list_delegate_failed",
      taskTypes: [TaskType.MODEL_TRAINING],
      details: {
        failureKind: "delegate-list-failed",
        delegate: "python",
        requestedTaskTypes: [TaskType.MODEL_TRAINING],
      },
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toContain("/tmp/secret");
    expect(payload).not.toContain("TOKEN=abc");
    expect(payload).not.toContain("C:\\cache");
  });

  it("task status list and cancel paths do not call delegate start functions", async () => {
    const image = createRegistryStub();
    const python = createRegistryStub();
    const router = createRuntimeTaskRegistryRouter({ image, python });

    await router.getTaskStatus("missing");
    await router.cancelTask("missing");
    await router.listTasks({ workspaceId });

    expect(image.startTask).not.toHaveBeenCalled();
    expect(python.startTask).not.toHaveBeenCalled();
  });
});

import { createWorkspaceId } from "../../../../contracts/workspace";
import { TaskType, type RuntimeTaskRecord } from "../../../../contracts/runtime";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import type { ModelRegistryPort } from "../../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../../ports/runtime";
import { ModelDownloadTasksUseCase } from "../model-download-tasks.use-case";
import { OwnedTaskReconcilerService } from "../../../services/runtime/owned-task-reconciler.service";

describe("ModelDownloadTasksUseCase", () => {
  const workspaceId = createWorkspaceId("workspace.downloads");
  for (const status of ["succeeded", "failed", "cancelled"] as const) it(`observes download ${status} without a renderer or automatic registration`, async () => {
    const reconciler = new OwnedTaskReconcilerService();
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture(reconciler);
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status }); await reconciler.reconcileNow();
    expect(reconciler.status.pending).toBe(0); expect(completion.readCompletedModelDownload).not.toHaveBeenCalled(); expect(registerDownloadedModel).not.toHaveBeenCalled();
  });

  it("starts a short-lived registry task with a safe model payload", async () => {
    const { useCase, registry } = createFixture();
    const result = await useCase.start({
      workspaceId,
      provider: "huggingface",
      modelId: " org/model ",
      displayName: " Model ",
    });

    expect(result.activity).toMatchObject({ requestId: "download-1", workspaceId, modelId: "org/model", displayName: "Model", status: "queued" });
    expect(registry.startTask).toHaveBeenCalledWith({
      workspaceId,
      taskType: TaskType.MODEL_DOWNLOAD,
      concurrencyClass: "io",
      payload: { provider: "transformers", modelId: "org/model", inferenceMode: undefined, taskTags: undefined, artifactForm: undefined },
    });
  });

  it("projects authoritative progress without details or private payload data", async () => {
    const { useCase, setTask } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "running", progress: { message: "Downloading", current: 25, total: 100, percent: 25, unit: "bytes", details: { token: "secret", path: "C:\\private" } }, data: { modelHandle: "private/handle" } });

    const result = await useCase.read({ workspaceId, requestId: "download-1" });

    expect(result.activity.progress).toEqual({ message: "Downloading", current: 25, total: 100, percent: 25, unit: "bytes" });
    expect(JSON.stringify(result)).not.toContain("modelHandle");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps reads pure and registers exactly once through explicit authorized completion", async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model", displayName: "Model" });
    setTask({ status: "succeeded", completedAt: "2026-07-29T12:01:00.000Z" });

    const [first, second] = await Promise.all([
      useCase.read({ workspaceId, requestId: "download-1" }),
      useCase.read({ workspaceId, requestId: "download-1" }),
    ]);

    expect(first.activity.status).toBe("succeeded");
    expect(second.activity.model).toBeUndefined();
    await useCase.list({ workspaceId, includeCompleted: true });
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(0);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(0);
    await Promise.all([
      useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true }),
      useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true }),
    ]);
    const completed = await useCase.read({ workspaceId, requestId: "download-1" });
    expect(completed.activity.model?.modelRecordId).toBe("registered-model");
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel.mock.calls[0]?.[0]?.localPath).toBe("C:\\cache\\org-model");
    expect(JSON.stringify(first.activity)).not.toContain("C:\\cache");
  });

  it("denies cross-workspace reads before touching the registry", async () => {
    const { useCase, registry } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    const otherWorkspace = createWorkspaceId("workspace.other");

    await expect(useCase.read({ workspaceId: otherWorkspace, requestId: "download-1" })).rejects.toThrow("not found in this workspace");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
  });

  for (const patch of [
    { requestId: "download-other" },
    { workspaceId: createWorkspaceId("workspace.other") },
    { taskType: TaskType.MODEL_TRAINING },
  ]) it(`rejects substituted task identity before completion effects: ${Object.keys(patch)[0]}`, async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "succeeded", ...patch });
    await expect(useCase.read({ workspaceId, requestId: "download-1" })).rejects.toThrow("not found in this workspace");
    await expect(useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true })).rejects.toThrow("not found in this workspace");
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ requestId: "download-1", workspaceId, taskType: TaskType.MODEL_DOWNLOAD });
    await useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true });
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
  });

  it("filters substituted task types from owned download lists", async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ taskType: TaskType.MODEL_TRAINING, status: "succeeded" });
    expect((await useCase.list({ workspaceId, includeCompleted: true })).activities).toEqual([]);
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ taskType: TaskType.MODEL_DOWNLOAD });
    expect((await useCase.list({ workspaceId, includeCompleted: true })).activities.length).toBe(1);
  });

  it("never confirms a cancellation acknowledgement for another task", async () => {
    const { useCase, setTask, registry, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ requestId: "download-other", status: "cancelled" });
    await expect(useCase.cancel({ workspaceId, requestId: "download-1" })).rejects.toThrow("cancellation could not be confirmed");
    expect(registry.cancelTask).toHaveBeenCalledWith("download-1");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ requestId: "download-1" });
    expect((await useCase.cancel({ workspaceId, requestId: "download-1" })).cancelled).toBe(true);
  });

  it("redacts runtime failure paths and secret-like values", async () => {
    const { useCase, setTask } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "failed", error: { code: "download_failed", message: "token=hidden at C:\\private\\model" } });
    const result = await useCase.read({ workspaceId, requestId: "download-1" });
    expect(result.activity.error?.message).toContain("token=[redacted]");
    expect(result.activity.error?.message).toContain("[local path]");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("C:\\private");
  });
});

function createFixture(taskReconciler?: OwnedTaskReconcilerService) {
  const workspaceId = createWorkspaceId("workspace.downloads");
  let task: RuntimeTaskRecord = {
    requestId: "download-1",
    workspaceId,
    taskType: TaskType.MODEL_DOWNLOAD,
    status: "queued",
    concurrencyClass: "io",
  };
  const registry: RuntimeTaskRegistryPort = {
    startTask: testDouble.fn(async () => ({ requestId: "download-1", status: "queued" })),
    getTaskStatus: testDouble.fn(async () => task),
    cancelTask: testDouble.fn(async () => ({ requestId: task.requestId, cancelled: true, status: "cancelled" })),
    listTasks: testDouble.fn(async () => ({ tasks: [task] })),
  };
  const completion = {
    readCompletedModelDownload: testDouble.fn(async () => ({
      provider: "transformers" as const,
      modelId: "org/model",
      downloaded: true,
      fromCache: false,
      localPath: "C:\\cache\\org-model",
    })),
  };
  const registerDownloadedModel = testDouble.fn<ModelRegistryPort["registerDownloadedModel"]>(async (request) => ({
    model: {
      workspaceId: request.workspaceId,
      modelRecordId: "registered-model",
      displayName: request.displayName,
      source: "huggingface",
      lifecycleStatus: "downloaded",
      artifactForm: request.artifactForm,
      provider: request.provider,
      modelId: request.modelId,
      localPath: request.localPath,
      createdAt: "2026-07-29T12:01:00.000Z",
    },
  }));
  const modelRegistry = {
    registerDownloadedModel,
  } as unknown as ModelRegistryPort;
  return {
    useCase: new ModelDownloadTasksUseCase({ taskReconciler, runtimeTaskRegistry: registry, modelDownloadCompletion: completion, modelRegistry, now: () => "2026-07-29T12:00:00.000Z" }),
    registry,
    completion,
    registerDownloadedModel,
    setTask(patch: Partial<RuntimeTaskRecord>) { task = { ...task, ...patch }; },
  };
}


it("rejects missing write authority and changed execution identity before runtime or registration", async () => {
  const { useCase, registry, setTask, registerDownloadedModel } = createFixture();
  const workspaceId = createWorkspaceId("workspace.downloads");
  const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
  await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, owner);
  setTask({ status: "succeeded" });
  for (const other of [{ ...owner, modelWriteAuthorized: false }, { ...owner, organizationId: "org.b" }, { ...owner, principalId: "person.b" }, undefined]) {
    await expect(useCase.complete({ workspaceId, requestId: "download-1" }, other)).rejects.toThrow();
  }
  expect(registry.getTaskStatus).toHaveBeenCalledTimes(0);
  expect(registerDownloadedModel).toHaveBeenCalledTimes(0);
  await expect(useCase.read({ workspaceId, requestId: "download-1" }, { organizationId: "org.b", principalId: "person.a" })).rejects.toThrow();
  expect(registry.getTaskStatus).toHaveBeenCalledTimes(0);
});

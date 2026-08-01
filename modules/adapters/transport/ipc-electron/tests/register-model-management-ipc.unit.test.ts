import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { RuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import { createRuntimeCapabilityStatus } from "../../../../contracts/runtime";

import {
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_FOLDER_REVEAL_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_START_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_CANCEL_REQUEST_CHANNEL,
  DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_CANCEL_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_DISCARD_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL,
  createDesktopModelBrowseRequest,
  createDesktopModelTrainRequest,
  createDesktopModelTrainStatusRequest,
  createDesktopModelTrainCancelRequest,
  createDesktopModelTrainSaveRequest,
  createDesktopModelTrainDiscardRequest,
  createDesktopModelPublishRequest,
  createDesktopModelDownloadListRequest,
  createDesktopModelFolderRevealRequest,
} from "../../../../contracts/ipc";
import {
  createBrowseModelsIpcHandler,
  createListModelsIpcHandler,
  createReadModelTrainingStatusIpcHandler,
  createCancelModelTrainingIpcHandler,
  createSaveModelTrainingIpcHandler,
  createDiscardModelTrainingIpcHandler,
  createTrainModelIpcHandler,
  createPublishModelIpcHandler,
  createListModelDownloadsIpcHandler,
  createRevealModelInFolderIpcHandler,
  registerModelManagementIpc,
} from "../model/registerModelManagementIpc";

describe("registerModelManagementIpc", () => {
  it("registers all model management channels", () => {
    const channels: string[] = [];
    registerModelManagementIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      browseModelsUseCase: { execute: testDouble.fn() },
      getModelDetailsUseCase: { execute: testDouble.fn() },
      listModelsUseCase: { execute: testDouble.fn() },
      saveModelReferenceUseCase: { execute: testDouble.fn() },
      downloadModelUseCase: { execute: testDouble.fn() },
      updateModelRecordUseCase: { execute: testDouble.fn() },
      deleteModelRecordUseCase: { execute: testDouble.fn() },
      revealModelInFolderUseCase: { execute: testDouble.fn() },
      trainModelUseCase: { execute: testDouble.fn(), read: testDouble.fn(), cancel: testDouble.fn(), save: testDouble.fn(), discard: testDouble.fn() },
      validateModelUseCase: { execute: testDouble.fn() },
      publishModelUseCase: { execute: testDouble.fn() },
    });

    expect(channels).toEqual([
      DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_FOLDER_REVEAL_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_CANCEL_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_SAVE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_DISCARD_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value,
    ]);
  });

  it("maps browse handler to use case", async () => {
    const execute = testDouble.fn().mockResolvedValue({ models: [] });
    const handler = createBrowseModelsIpcHandler({ execute });
    const response = await handler({}, createDesktopModelBrowseRequest({ provider: "huggingface", query: "mistral" }));

    expect(execute).toHaveBeenCalledWith({ provider: "huggingface", query: "mistral" });
    expect(response.ok).toBe(true);
  });

  it("sanitizes handler internal errors in failure envelopes", async () => {
    const handler = createBrowseModelsIpcHandler({
      execute: testDouble.fn(async () => {
        throw new Error("browse failed at /tmp/secret\nstack trace");
      }),
    });

    const response = await handler({}, createDesktopModelBrowseRequest(
      { provider: "huggingface", query: "demo" },
      { requestId: "req-model-browse", correlationId: "corr-model-browse" },
    ));

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL.value,
      requestId: "req-model-browse",
      correlationId: "corr-model-browse",
      error: { code: "internal", message: "Model management request failed." },
    });
    expect(JSON.stringify(response)).not.toContain("/tmp/secret");
    expect(JSON.stringify(response)).not.toContain("stack trace");
  });

  it("registers and maps model-download lifecycle channels", async () => {
    const channels: string[] = [];
    const tasks = { start: testDouble.fn(), read: testDouble.fn(), list: testDouble.fn(async () => ({ activities: [] })), cancel: testDouble.fn() };
    registerModelManagementIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      browseModelsUseCase: { execute: testDouble.fn() }, getModelDetailsUseCase: { execute: testDouble.fn() }, listModelsUseCase: { execute: testDouble.fn() }, saveModelReferenceUseCase: { execute: testDouble.fn() }, downloadModelUseCase: { execute: testDouble.fn() }, modelDownloadTasksUseCase: tasks, updateModelRecordUseCase: { execute: testDouble.fn() }, deleteModelRecordUseCase: { execute: testDouble.fn() }, revealModelInFolderUseCase: { execute: testDouble.fn() }, trainModelUseCase: { execute: testDouble.fn(), read: testDouble.fn(), cancel: testDouble.fn(), save: testDouble.fn(), discard: testDouble.fn() }, validateModelUseCase: { execute: testDouble.fn() }, publishModelUseCase: { execute: testDouble.fn() },
    });
    expect(channels).toContain(DESKTOP_MODEL_DOWNLOAD_START_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_MODEL_DOWNLOAD_READ_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_MODEL_DOWNLOAD_LIST_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_MODEL_DOWNLOAD_CANCEL_REQUEST_CHANNEL.value);
    const handler = createListModelDownloadsIpcHandler(tasks);
    const response = await handler({}, createDesktopModelDownloadListRequest({ workspaceId: 'workspace-a' as never, includeCompleted: true }));
    expect(response.ok).toBe(true);
    expect(tasks.list).toHaveBeenCalled();
  });

  it("maps the folder reveal request without exposing a local path", async () => {
    const execute = testDouble.fn(async () => ({ modelRecordId: "model-1", revealed: true as const }));
    const handler = createRevealModelInFolderIpcHandler({ execute });

    const response = await handler({}, createDesktopModelFolderRevealRequest({
      workspaceId: "workspace-a" as never,
      modelRecordId: "model-1",
    }));

    expect(execute).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "model-1" });
    expect(response).toMatchObject({ ok: true, value: { modelRecordId: "model-1", revealed: true } });
    expect(JSON.stringify(response)).not.toContain("localPath");
  });

  it("reports model-list failures without changing the sanitized response", async () => {
    const failure = Object.assign(new Error("C:\\private\\models.json"), {
      code: "SQLITE_BUSY",
    });
    const reporter = testDouble.fn(async () => undefined);
    const handler = createListModelsIpcHandler(
      {
        execute: testDouble.fn(async () => {
          throw failure;
        }),
      },
      reporter,
    );

    const response = await handler(
      {},
      {
        payload: {},
        operation: "model.list",
        channel: DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value,
        requestId: "req-model-list",
      } as never,
    );

    expect(reporter).toHaveBeenCalledWith("listModels.execute", failure);
    expect(response).toMatchObject({
      ok: false,
      error: { code: "internal", message: "Model management request failed." },
    });
    expect(JSON.stringify(response)).not.toContain("private");
  });

  it("maps train handler to use case", async () => {
  const execute = testDouble.fn().mockResolvedValue({ runId: "run-1", status: "succeeded" });
  const handler = createTrainModelIpcHandler({ execute });
  const response = await handler({}, createDesktopModelTrainRequest({
    baseModel: { modelRecordId: "base-1" },
    datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
    method: "lora",
    commonParameters: {},
    output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } } },
  }));

  expect(execute).toHaveBeenCalled();
  expect(response.ok).toBe(true);
});

it("maps train status handler to use case read", async () => {
  const read = testDouble.fn().mockResolvedValue({
    runId: "run-1",
    status: "running",
    progress: { epoch: 0, totalEpochs: 1, batch: 0, totalBatches: 59 },
  });
  const handler = createReadModelTrainingStatusIpcHandler({ read });
  const response = await handler({}, createDesktopModelTrainStatusRequest({
    runId: "run-1",
    workspaceId: "workspace-a" as never,
  }));

  expect(read).toHaveBeenCalledWith("run-1", "workspace-a");
  expect(response.ok).toBe(true);
});

it("maps train cancellation to the workspace-scoped use case", async () => {
  const cancel = testDouble.fn().mockResolvedValue({
    runId: "run-1",
    status: "cancelled",
  });
  const handler = createCancelModelTrainingIpcHandler({ cancel });
  const response = await handler(
    {},
    createDesktopModelTrainCancelRequest({
      runId: "run-1",
      workspaceId: "workspace-a" as never,
    }),
  );

  expect(cancel).toHaveBeenCalledWith("run-1", "workspace-a");
  expect(response).toMatchObject({
    ok: true,
    value: { runId: "run-1", status: "cancelled" },
  });
});

it("maps trained-model save and discard reviews to the active workspace", async () => {
  const save = testDouble.fn().mockResolvedValue({ runId: "run-1", status: "succeeded" });
  const discard = testDouble.fn().mockResolvedValue({ runId: "run-2", status: "cancelled" });
  const saveResponse = await createSaveModelTrainingIpcHandler({ save })(
    {},
    createDesktopModelTrainSaveRequest({ runId: "run-1", workspaceId: "workspace-a" as never }),
  );
  const discardResponse = await createDiscardModelTrainingIpcHandler({ discard })(
    {},
    createDesktopModelTrainDiscardRequest({ runId: "run-2", workspaceId: "workspace-a" as never }),
  );

  expect(save).toHaveBeenCalledWith("run-1", "workspace-a");
  expect(discard).toHaveBeenCalledWith("run-2", "workspace-a");
  expect(saveResponse.ok).toBe(true);
  expect(discardResponse.ok).toBe(true);
});

it("reports model-training start failures without exposing details in the response", async () => {
  const failure = new Error(
    "Failed to install datasets at C:\\private\\python-runtime",
  );
  const reporter = testDouble.fn(async () => undefined);
  const handler = createTrainModelIpcHandler(
    {
      execute: testDouble.fn(async () => {
        throw failure;
      }),
    },
    reporter,
  );

  const response = await handler({}, createDesktopModelTrainRequest({
    baseModel: { modelRecordId: "base-1" },
    datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
    method: "lora",
    commonParameters: {},
    output: {
      outputModelName: "demo-adapter",
      destination: { local: { enabled: true } },
    },
  }));

  expect(reporter).toHaveBeenCalledWith("trainModel.execute", failure);
  expect(response).toMatchObject({
    ok: false,
    error: { code: "internal", message: "Model management request failed." },
  });
  expect(JSON.stringify(response)).not.toContain("private");
  expect(JSON.stringify(response)).not.toContain("datasets");
});

it("reports model-training status failures without changing the sanitized response", async () => {
  const failure = new Error("runtime status failed at C:\\private\\task.json");
  const reporter = testDouble.fn(async () => undefined);
  const handler = createReadModelTrainingStatusIpcHandler(
    {
      read: testDouble.fn(async () => {
        throw failure;
      }),
    },
    reporter,
  );

  const response = await handler(
    {},
    createDesktopModelTrainStatusRequest({
      runId: "run-1",
      workspaceId: "workspace-a" as never,
    }),
  );

  expect(reporter).toHaveBeenCalledWith("trainModel.read", failure);
  expect(response).toMatchObject({
    ok: false,
    error: { code: "internal", message: "Model management request failed." },
  });
  expect(JSON.stringify(response)).not.toContain("private");
});

it("maps model runtime capability unavailable errors to sanitized IPC unavailable responses", async () => {
  const unavailable = new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({
    capabilityId: "model-training",
    status: "failed",
    summary: "Model training runtime failed readiness checks.",
    reason: { code: "runtime.python.failed", message: "trace /tmp/secret", category: "startup", retryable: true },
    recommendedActions: ["retry", "view-logs"],
  }));
  const handler = createTrainModelIpcHandler({ execute: testDouble.fn(async () => { throw unavailable; }) });
  const response = await handler({}, createDesktopModelTrainRequest({
    baseModel: { modelRecordId: "base-1" },
    datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
    method: "lora",
    commonParameters: {},
    output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } } },
  }, { requestId: "req-train", correlationId: "corr-train" }));

  expect(response).toMatchObject({
    ok: false,
    channel: DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL.value,
    requestId: "req-train",
    correlationId: "corr-train",
    error: { code: "unavailable", message: "Required runtime capability is not ready.", details: { capabilityId: "model-training", status: "failed" } },
  });
  expect(JSON.stringify(response)).not.toContain("/tmp/secret");
});


it("maps publish handler runtime unavailable failures to sanitized IPC unavailable responses", async () => {
  const unavailable = new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({
    capabilityId: "model-publishing",
    status: "unavailable",
    summary: "Model publishing runtime execution is not implemented on this host.",
    reason: {
      code: "runtime.model-publishing.not-implemented",
      message: "internal detail /tmp/secret TOKEN=abc",
      category: "unavailable",
      retryable: false,
    },
    recommendedActions: ["configure"],
  }));
  const handler = createPublishModelIpcHandler({ execute: testDouble.fn(async () => { throw unavailable; }) });

  const response = await handler({}, createDesktopModelPublishRequest(
    { modelRecordId: "m1", repository: "owner/repo" },
    { requestId: "req-publish", correlationId: "corr-publish" },
  ));

  expect(response).toMatchObject({
    ok: false,
    channel: DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL.value,
    requestId: "req-publish",
    correlationId: "corr-publish",
    error: {
      code: "unavailable",
      message: "Required runtime capability is not ready.",
      details: {
        capabilityId: "model-publishing",
        status: "unavailable",
        reason: { code: "runtime.model-publishing.not-implemented", category: "unavailable" },
      },
    },
  });
  const payload = JSON.stringify(response);
  expect(payload).not.toContain("/tmp/secret");
  expect(payload).not.toContain("TOKEN=abc");
});

it("maps publish handler internal implementation failures to sanitized IPC internal responses", async () => {
  const handler = createPublishModelIpcHandler({
    execute: testDouble.fn(async () => {
      throw new Error("model publishing runtime task is not implemented at /tmp/runtime TOKEN=abc");
    }),
  });

  const response = await handler({}, createDesktopModelPublishRequest(
    { modelRecordId: "m1", repository: "owner/repo" },
    { requestId: "req-publish-internal", correlationId: "corr-publish-internal" },
  ));

  expect(response).toMatchObject({
    ok: false,
    channel: DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL.value,
    requestId: "req-publish-internal",
    correlationId: "corr-publish-internal",
    error: { code: "internal", message: "Model management request failed." },
  });
  const payload = JSON.stringify(response);
  expect(payload).not.toContain("model publishing runtime task is not implemented");
  expect(payload).not.toContain("/tmp/runtime");
  expect(payload).not.toContain("TOKEN=abc");
});
});

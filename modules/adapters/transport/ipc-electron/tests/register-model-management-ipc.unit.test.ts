import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
  createDesktopModelBrowseRequest,
  createDesktopModelTrainRequest,
  createDesktopModelTrainStatusRequest,
} from "../../../../contracts/ipc";
import {
  createBrowseModelsIpcHandler,
  createReadModelTrainingStatusIpcHandler,
  createTrainModelIpcHandler,
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
      trainModelUseCase: { execute: testDouble.fn(), read: testDouble.fn() },
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
      DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
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

  it("maps handler errors to failure envelope", async () => {
    const handler = createBrowseModelsIpcHandler({
      execute: testDouble.fn(async () => {
        throw new Error("browse failed");
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
      error: { code: "internal", message: "browse failed" },
    });
  });
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
  const response = await handler({}, createDesktopModelTrainStatusRequest({ runId: "run-1" }));

  expect(read).toHaveBeenCalledWith("run-1");
  expect(response.ok).toBe(true);
});

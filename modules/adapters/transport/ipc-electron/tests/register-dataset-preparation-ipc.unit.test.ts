import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL, createDesktopPrepareTrainingDatasetStartRequest, createDesktopPrepareTrainingDatasetTaskReadRequest, createDesktopPrepareTrainingDatasetTaskCancelRequest } from "../../../../contracts/ipc";
import type { RuntimeTaskRecord } from "../../../../contracts/runtime";
import { TaskType } from "../../../../contracts/runtime";
import { createDesktopPrepareTrainingDatasetStartIpcHandler, createDesktopPrepareTrainingDatasetTaskReadIpcHandler, createDesktopPrepareTrainingDatasetTaskCancelIpcHandler, registerDatasetPreparationIpc } from "../dataset-preparation/registerDatasetPreparationIpc";

describe("registerDatasetPreparationIpc", () => {
  it("maps running read status", async () => {
    const runtimeTaskRecord: RuntimeTaskRecord = {
      requestId: "r1",
      taskType: TaskType.DATASET_PREPARATION,
      status: "running",
      concurrencyClass: "unknown",
      progress: { current: 1, total: 3 },
    };
    const readPrepareTrainingDataset = testDouble.fn().mockResolvedValue({ ok: true, value: runtimeTaskRecord });
    const handler = createDesktopPrepareTrainingDatasetTaskReadIpcHandler({ startPrepareTrainingDataset: testDouble.fn(), readPrepareTrainingDataset });
    const response = await handler({}, createDesktopPrepareTrainingDatasetTaskReadRequest({ requestId: "r1", boundary: { host: "desktop", source: "x" } }));
    expect(response.ok).toBe(true); expect((response as any).value.result).toBeUndefined(); expect((response as any).value.progress.processed).toBe(1);
  });

  it("maps succeeded read status with materialized result", async () => {
    const readPrepareTrainingDataset = testDouble.fn().mockResolvedValue({ ok: true, value: { requestId: "r1", taskType: "prepare-training-dataset", status: "succeeded", result: { outputs: {}, provenance: { sourceArtifactIds: [], recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 1, chunkOverlap: 0 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "m" } } }, split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" }, generationModelId: "m", summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } }, summary: { sourceDocumentCount: 1, normalizedDocumentCount: 1, skippedDocumentCount: 0, chunkCount: 1, generatedExampleCount: 1, datasetRowCount: 1, trainRowCount: 1, testRowCount: 0 } } } });
    const handler = createDesktopPrepareTrainingDatasetTaskReadIpcHandler({ startPrepareTrainingDataset: testDouble.fn(), readPrepareTrainingDataset });
    const response = await handler({}, createDesktopPrepareTrainingDatasetTaskReadRequest({ requestId: "r1", boundary: { host: "desktop", source: "x" } }));
    expect((response as any).value.status).toBe("succeeded"); expect((response as any).value.result).toBeDefined();
  });

  it("maps failed and unknown read statuses", async () => {
    let call = 0;
    const readPrepareTrainingDataset = testDouble.fn(async () => {
      call += 1;
      return call === 1
        ? { ok: true as const, value: { requestId: "r1", taskType: TaskType.DATASET_PREPARATION, status: "failed" as const, concurrencyClass: "unknown" as const, error: { code: "runtime", message: "boom" } } }
        : { ok: true as const, value: { requestId: "r1", taskType: TaskType.DATASET_PREPARATION, status: "unknown" as const, concurrencyClass: "unknown" as const, message: "not found" } };
    });
    const handler = createDesktopPrepareTrainingDatasetTaskReadIpcHandler({ startPrepareTrainingDataset: testDouble.fn(), readPrepareTrainingDataset });
    const failed = await handler({}, createDesktopPrepareTrainingDatasetTaskReadRequest({ requestId: "r1", boundary: { host: "desktop", source: "x" } }));
    const unknown = await handler({}, createDesktopPrepareTrainingDatasetTaskReadRequest({ requestId: "r1", boundary: { host: "desktop", source: "x" } }));
    expect((failed as any).value.error.message).toBe("boom"); expect((unknown as any).value.status).toBe("unknown");
  });

  it("maps runtime task failures without assuming optional error/message fields exist", async () => {
    const readPrepareTrainingDataset = testDouble.fn().mockResolvedValue({
      ok: true,
      value: {
        requestId: "r1",
        taskType: TaskType.DATASET_PREPARATION,
        status: "failed",
        concurrencyClass: "unknown",
        completedAt: "2026-04-29T12:00:00.000Z",
      },
    });
    const handler = createDesktopPrepareTrainingDatasetTaskReadIpcHandler({ startPrepareTrainingDataset: testDouble.fn(), readPrepareTrainingDataset });
    const response = await handler({}, createDesktopPrepareTrainingDatasetTaskReadRequest({ requestId: "r1", boundary: { host: "desktop", source: "x" } }));

    expect((response as any).value.status).toBe("failed");
    expect((response as any).value.error.message).toBe("Dataset preparation task failed.");
    expect((response as any).value.completedAt).toBe("2026-04-29T12:00:00.000Z");
  });

  it("registers start/read/cancel channels", () => {
    const channels: string[] = []; registerDatasetPreparationIpc({ ipcMain: { handle: testDouble.fn((c: string) => channels.push(c)) }, prepareTrainingDatasetUseCase: { startPrepareTrainingDataset: testDouble.fn(), readPrepareTrainingDataset: testDouble.fn(), cancelPrepareTrainingDataset: testDouble.fn() } });
    expect(channels).toEqual([DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value, DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value, DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL.value]);
  });
});

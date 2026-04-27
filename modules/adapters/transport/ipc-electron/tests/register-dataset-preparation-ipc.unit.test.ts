import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL,
  createDesktopPrepareTrainingDatasetRequest,
} from "../../../../contracts/ipc";
import { createContractError } from "../../../../contracts/shared";
import {
  createDesktopPrepareTrainingDatasetIpcHandler,
  registerDatasetPreparationIpc,
  type PrepareTrainingDatasetFromArtifactsUseCasePort,
} from "../dataset-preparation/registerDatasetPreparationIpc";

describe("registerDatasetPreparationIpc", () => {
  it("maps request payload/context to use case and returns success envelope", async () => {
    const execute = testDouble.fn<PrepareTrainingDatasetFromArtifactsUseCasePort["execute"]>().mockResolvedValue({
      ok: true,
      value: {
        outputs: {
          local: {
            dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 20 } },
          },
        },
        provenance: {
          sourceArtifactIds: ["artifact-1"],
          recipe: {
            normalization: { targetFormat: "markdown" },
            chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
            generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
          },
          split: { trainRatio: 0.8, testRatio: 0.2 },
          output: { format: "jsonl" },
          generationModelId: "Qwen/Qwen2.5-1.5B-Instruct",
          summary: {
            sourceDocumentCount: 1,
            normalizedDocumentCount: 1,
            skippedDocumentCount: 0,
            chunkCount: 2,
            generatedExampleCount: 10,
            datasetRowCount: 10,
            trainRowCount: 10,
            testRowCount: 0,
          },
        },
        summary: {
          sourceDocumentCount: 1,
          normalizedDocumentCount: 1,
          skippedDocumentCount: 0,
          chunkCount: 2,
          generatedExampleCount: 10,
          datasetRowCount: 10,
          trainRowCount: 10,
          testRowCount: 0,
        },
      },
      requestId: "req-1",
      correlationId: "corr-1",
    });

    const handler = createDesktopPrepareTrainingDatasetIpcHandler({ execute });
    const response = await handler({}, createDesktopPrepareTrainingDatasetRequest({
      command: {
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
          generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
        },
        split: { trainRatio: 0.8, testRatio: 0.2 },
        output: { format: "jsonl" },
      },
      boundary: { host: "desktop", source: "desktop.renderer.dataset-preparation" },
    }, { requestId: "req-1", correlationId: "corr-1" }));

    expect(execute).toHaveBeenCalled();
    expect(response.ok).toBe(true);
  });

  it("maps use case failures to ipc failure envelopes", async () => {
    const handler = createDesktopPrepareTrainingDatasetIpcHandler({
      execute: testDouble.fn<PrepareTrainingDatasetFromArtifactsUseCasePort["execute"]>().mockResolvedValue({
        ok: false,
        error: createContractError("validation", "bad input"),
      }),
    });

    const response = await handler({}, createDesktopPrepareTrainingDatasetRequest({
      command: {
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
          generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
        },
        split: { trainRatio: 0.8, testRatio: 0.2 },
        output: { format: "jsonl" },
      },
      boundary: { host: "desktop", source: "desktop.renderer.dataset-preparation" },
    }));

    expect(response.ok).toBe(false);
  });

  it("registers the dataset preparation channel", () => {
    const channels: string[] = [];
    registerDatasetPreparationIpc({
      ipcMain: {
        handle: testDouble.fn((channel: string) => {
          channels.push(channel);
        }),
      },
      prepareTrainingDatasetFromArtifactsUseCase: {
        execute: testDouble.fn(),
      },
    });

    expect(channels).toEqual([DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL.value]);
  });
});

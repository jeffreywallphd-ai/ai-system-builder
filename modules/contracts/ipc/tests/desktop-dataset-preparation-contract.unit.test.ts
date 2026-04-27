import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL,
  createDesktopPrepareTrainingDatasetRequest,
  createDesktopPrepareTrainingDatasetSuccessResponse,
} from "..";

describe("desktop dataset preparation ipc contract", () => {
  it("defines operation/channel identities", () => {
    expect(DESKTOP_DATASET_PREPARE_TRAINING_OPERATION).toBe("artifact.prepare-training-dataset");
    expect(DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL.value).toBe("ipc.artifact.prepare-training-dataset.request");
    expect(DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL.value).toBe("ipc.artifact.prepare-training-dataset.response");
  });

  it("creates normalized request and success envelopes", () => {
    const request = createDesktopPrepareTrainingDatasetRequest({
      command: {
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
          generation: {
            mode: "qa",
            model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
            promptTemplate: "Prompt: {{text}}",
          },
        },
        split: { trainRatio: 0.8, testRatio: 0.2, seed: 7 },
        output: { format: "jsonl" },
      },
      boundary: {
        host: "desktop",
        source: " desktop.renderer.dataset-preparation ",
      },
    });

    expect(request.payload.boundary.source).toBe("desktop.renderer.dataset-preparation");

    const response = createDesktopPrepareTrainingDatasetSuccessResponse({
      outputs: {
        local: {
          dataset: {
            sourceKind: "runtime",
            storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 20 },
          },
        },
      },
      provenance: {
        sourceArtifactIds: ["artifact-1"],
        recipe: request.payload.command.recipe,
        split: request.payload.command.split,
        output: request.payload.command.output,
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
      warnings: [{ code: "skipped_document", message: "Skipped one unsupported artifact." }],
    });

    expect(response.ok).toBe(true);
    expect(response.value.result.outputs.local?.dataset.storage.key).toBe("stored-dataset");
    expect(response.value.result.summary.datasetRowCount).toBe(10);
  });
});

import { describe, expect, it } from "../../../modules/testing/node-test";

import { resolveLatestDatasetPreparationChunkProgress } from "../src/renderer/features/dataset-preparation/hooks/modelDownloadProgress";

describe("dataset preparation model progress regressions", () => {
  it("uses requestId to ignore unrelated chunk progress events", () => {
    const progress = resolveLatestDatasetPreparationChunkProgress(
      {
        logs: [
          {
            timestamp: "2026-04-28T14:00:00.000Z",
            level: "info",
            message: JSON.stringify({
              event: "runtime.dataset_preparation.generation.progress",
              requestId: "other-request",
              processedChunkCount: 9,
              totalChunkCount: 10,
            }),
          },
          {
            timestamp: "2026-04-28T14:00:01.000Z",
            level: "info",
            message: JSON.stringify({
              event: "runtime.dataset_preparation.generation.progress",
              requestId: "request-1",
              processedChunkCount: 2,
              totalChunkCount: 10,
            }),
          },
        ],
      },
      { requestId: "request-1" },
    );

    expect(progress).toEqual({
      processedChunkCount: 2,
      totalChunkCount: 10,
      message: "Processing chunk 3/10...",
    });
  });
});

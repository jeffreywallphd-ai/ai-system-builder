import { describe, expect, it } from "vitest";

import {
  classifyRecoveredDatasetPreparationCompletion,
  identifyMatchingDatasetPreparationTask,
} from "../hooks/datasetPreparationRecovery";

function createSnapshot(input: { activeTaskCount: number; logs: string[] }) {
  return {
    activeTaskCount: input.activeTaskCount,
    logs: input.logs.map((message, index) => ({
      timestamp: new Date(Date.now() + index * 1_000).toISOString(),
      level: "info" as const,
      message,
    })),
  };
}

describe("datasetPreparationRecovery", () => {
  it("ignores unrelated active tasks", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 1,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.task.started", requestId: "other-request" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match, { withinGracePeriod: true })).toBe("waiting-for-matching-task");
    expect(classifyRecoveredDatasetPreparationCompletion(match, { withinGracePeriod: false })).toBe("unrelated-runtime-task");
  });

  it("detects matching active task", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 1,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.generation.progress", requestId: "request-1" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match)).toBe("still-running");
  });

  it("classifies matching succeeded task", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 0,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.task.succeeded", requestId: "request-1" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match)).toBe("succeeded");
  });

  it("classifies matching failed task", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 0,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.task.failed", requestId: "request-1", status: "failed" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match)).toBe("failed");
  });

  it("classifies matching cancelled task", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 0,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.task.cancelled", requestId: "request-1", status: "cancelled" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match)).toBe("stopped");
  });

  it("classifies observed-but-not-terminal task as unknown when no longer active", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 0,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.generation.progress", requestId: "request-1" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match)).toBe("still-running");
  });

  it("classifies observed non-terminal diagnostics as unknown when grace has expired", () => {
    const match = identifyMatchingDatasetPreparationTask(
      createSnapshot({
        activeTaskCount: 0,
        logs: [JSON.stringify({ event: "runtime.dataset_preparation.generation.chunk_failed", requestId: "request-1" })],
      }),
      { requestId: "request-1" },
    );

    expect(classifyRecoveredDatasetPreparationCompletion(match, { withinGracePeriod: false })).toBe("unknown");
  });
});

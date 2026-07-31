import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParquetDatasetReviewPort } from "../../../application/ports/dataset-review";
import type { DatasetReviewRow } from "../../../contracts/dataset";
import type { WorkspaceId } from "../../../contracts/workspace";
import { TaskType } from "../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "./pythonRuntimeTaskTimeoutPolicy";

const INITIAL_POLL_INTERVAL_MS = 50;
const MAXIMUM_POLL_INTERVAL_MS = 1_000;

export function createPythonParquetDatasetReviewAdapter(
  runtimeTaskRegistry: RuntimeTaskRegistryPort,
): ParquetDatasetReviewPort {
  return {
    async readPage(input) {
      const result = await runReviewTask(
        runtimeTaskRegistry,
        input.workspaceId,
        input.content,
        {
          operation: "read",
          page: input.page,
          pageSize: input.pageSize,
        },
      );
      const totalRows = validCount(result.totalRows, "Dataset row count");
      if (!Array.isArray(result.rows)) {
        throw new Error("Dataset review returned invalid rows.");
      }
      const rows = result.rows.map(validateRow);
      return { totalRows, rows };
    },
    async rejectRow(input) {
      const result = await runReviewTask(
        runtimeTaskRegistry,
        input.workspaceId,
        input.content,
        {
          operation: "reject",
          rowIndex: input.rowIndex,
          rowFingerprint: input.rowFingerprint,
        },
      );
      const totalRows = validCount(result.totalRows, "Dataset row count");
      if (!(result.outputContent instanceof Uint8Array)) {
        throw new Error("Dataset review did not produce a revised dataset.");
      }
      return { content: result.outputContent, totalRows };
    },
    async replaceRow(input) {
      const result = await runReviewTask(
        runtimeTaskRegistry,
        input.workspaceId,
        input.content,
        {
          operation: "replace",
          rowIndex: input.rowIndex,
          rowFingerprint: input.rowFingerprint,
          replacementRow: input.values,
        },
      );
      const totalRows = validCount(result.totalRows, "Dataset row count");
      if (!(result.outputContent instanceof Uint8Array)) {
        throw new Error("Dataset review did not produce a revised dataset.");
      }
      return { content: result.outputContent, totalRows };
    },
  };
}

async function runReviewTask(
  registry: RuntimeTaskRegistryPort,
  workspaceId: WorkspaceId,
  content: Uint8Array,
  operation: Record<string, unknown>,
): Promise<Record<string, unknown> & { outputContent?: Uint8Array }> {
  if (!(content instanceof Uint8Array) || content.byteLength === 0) {
    throw new Error("Dataset review requires a non-empty Parquet artifact.");
  }
  const workingDirectory = await mkdtemp(
    join(tmpdir(), "ai-system-builder-dataset-review-"),
  );
  const inputPath = join(workingDirectory, "input.parquet");
  const outputHandle = "reviewed.parquet";
  const requestId = randomUUID();
  try {
    await writeFile(inputPath, content, { flag: "wx" });
    await registry.startTask({
      requestId,
      workspaceId,
      taskType: TaskType.DATASET_REVIEW,
      payload: {
        ...operation,
        inputPath,
        outputHandle,
        runtime: { runtimeWorkingDirectory: workingDirectory },
      },
      metadata: { operation: "dataset-review" },
    });
    const deadline = Date.now() + PYTHON_RUNTIME_TASK_TIMEOUTS.datasetReview;
    let pollInterval = INITIAL_POLL_INTERVAL_MS;
    while (Date.now() < deadline) {
      const status = await registry.getTaskStatus(requestId);
      if (status.status === "succeeded") {
        const data =
          "data" in status && isRecord(status.data) ? status.data : {};
        if (
          operation.operation === "reject" ||
          operation.operation === "replace"
        ) {
          const outputPath = join(workingDirectory, outputHandle);
          return {
            ...data,
            outputContent: new Uint8Array(await readFile(outputPath)),
          };
        }
        return data;
      }
      if (
        status.status === "failed" ||
        status.status === "cancelled" ||
        status.status === "unknown"
      ) {
        const message =
          "error" in status && status.error?.message
            ? status.error.message
            : "Dataset review could not be completed.";
        throw new Error(message);
      }
      await delay(pollInterval);
      pollInterval = Math.min(pollInterval * 2, MAXIMUM_POLL_INTERVAL_MS);
    }
    await registry.cancelTask(requestId);
    throw new Error("Dataset review timed out.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function validateRow(value: unknown): DatasetReviewRow {
  if (!isRecord(value))
    throw new Error("Dataset review returned an invalid row.");
  const rowIndex = validCount(value.rowIndex, "Dataset row index");
  const rowFingerprint =
    typeof value.rowFingerprint === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(value.rowFingerprint)
      ? (value.rowFingerprint as `sha256:${string}`)
      : undefined;
  if (!rowFingerprint || !isRecord(value.values)) {
    throw new Error("Dataset review returned an invalid row.");
  }
  return {
    rowIndex,
    rowFingerprint,
    values: value.values,
    editable: value.editable === true,
  };
}

function validCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

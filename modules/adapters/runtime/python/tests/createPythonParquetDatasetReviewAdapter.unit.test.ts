import { describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createPythonParquetDatasetReviewAdapter } from "../createPythonParquetDatasetReviewAdapter";

describe("python parquet dataset review adapter", () => {
  it("binds row reads to the authorized workspace runtime task", async () => {
    const workspaceId = createWorkspaceId("workspace-review");
    const startTask = vi.fn(async () => ({
      requestId: "review-task",
      status: "queued" as const,
    }));
    const adapter = createPythonParquetDatasetReviewAdapter({
      startTask,
      getTaskStatus: vi.fn(async () => ({
        requestId: "review-task",
        workspaceId,
        taskType: "dataset-review" as never,
        status: "succeeded" as const,
        concurrencyClass: "unknown" as const,
        data: {
          totalRows: 1,
          rows: [
            {
              rowIndex: 0,
              rowFingerprint: `sha256:${"a".repeat(64)}`,
              values: { instruction: "Answer accurately." },
              editable: true,
            },
          ],
        },
      })),
      cancelTask: vi.fn(),
      listTasks: vi.fn(),
    });

    const result = await adapter.readPage({
      workspaceId,
      content: new Uint8Array([80, 65, 82, 49]),
      page: 0,
      pageSize: 10,
    });

    expect(result.totalRows).toBe(1);
    expect(result.rows[0]?.editable).toBe(true);
    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        taskType: "dataset-review",
      }),
    );
  });

  it("sends bounded replacement values and returns revised Parquet bytes", async () => {
    const workspaceId = createWorkspaceId("workspace-review");
    const fingerprint = `sha256:${"a".repeat(64)}` as const;
    const startTask = vi.fn(async (request: any) => {
      await writeFile(
        join(
          request.payload.runtime.runtimeWorkingDirectory,
          request.payload.outputHandle,
        ),
        new Uint8Array([80, 65, 82, 49, 1]),
      );
      return { requestId: request.requestId, status: "queued" as const };
    });
    const adapter = createPythonParquetDatasetReviewAdapter({
      startTask,
      getTaskStatus: vi.fn(async (requestId) => ({
        requestId,
        workspaceId,
        taskType: "dataset-review" as never,
        status: "succeeded" as const,
        concurrencyClass: "unknown" as const,
        data: { totalRows: 1, outputHandle: "reviewed.parquet" },
      })),
      cancelTask: vi.fn(),
      listTasks: vi.fn(),
    });

    const result = await adapter.replaceRow({
      workspaceId,
      content: new Uint8Array([80, 65, 82, 49]),
      rowIndex: 0,
      rowFingerprint: fingerprint,
      values: { instruction: "Answer clearly." },
    });

    expect(result.totalRows).toBe(1);
    expect(result.content).toEqual(new Uint8Array([80, 65, 82, 49, 1]));
    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        payload: expect.objectContaining({
          operation: "replace",
          rowIndex: 0,
          rowFingerprint: fingerprint,
          replacementRow: { instruction: "Answer clearly." },
        }),
      }),
    );
  });
});

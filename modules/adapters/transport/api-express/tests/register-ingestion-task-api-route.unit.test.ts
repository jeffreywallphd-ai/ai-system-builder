import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { INGESTION_TASK_RECOMMENDED_CHUNK_BYTES } from "../../../../contracts/ingestion";
import { registerIngestionTaskApiRoute } from "../ingestion-task/registerIngestionTaskApiRoute";

describe("registerIngestionTaskApiRoute", () => {
  it("forwards canonical commands with workspace and tracing context", async () => {
    let handler: ((request: any, response: any) => Promise<void>) | undefined;
    const app = { post: testDouble.fn((_path: string, value: typeof handler) => { handler = value; }) };
    const executeCommand = testDouble.fn().mockResolvedValue({ ok: true, value: { kind: "tasks", tasks: [] } });
    registerIngestionTaskApiRoute({ app, ingestionTasks: { executeCommand } });
    const json = testDouble.fn();
    const status = testDouble.fn().mockReturnValue({ json });

    await handler?.({
      body: { workspaceId: "workspace-a", command: { action: "list" } },
      headers: { "x-request-id": "req-api-1", "x-correlation-id": "corr-api-1" },
    }, { status, json });

    expect(executeCommand).toHaveBeenCalledWith(
      { action: "list" },
      { requestId: "req-api-1", correlationId: "corr-api-1", workspaceId: "workspace-a" },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, operation: "ingestion.task-execute" });
  });

  it("rejects oversized JSON chunks before calling the acquisition service", async () => {
    let handler: ((request: any, response: any) => Promise<void>) | undefined;
    const app = { post: testDouble.fn((_path: string, value: typeof handler) => { handler = value; }) };
    const executeCommand = testDouble.fn();
    registerIngestionTaskApiRoute({ app, ingestionTasks: { executeCommand } });
    const json = testDouble.fn();
    const status = testDouble.fn().mockReturnValue({ json });

    await handler?.({
      body: {
        workspaceId: "workspace-a",
        command: {
          action: "append-chunk",
          taskId: "task-a",
          fileId: "file-a",
          chunkIndex: 0,
          expectedOffset: 0,
          bytes: new Uint8Array(INGESTION_TASK_RECOMMENDED_CHUNK_BYTES + 1),
          sha256: "a".repeat(64),
        },
      },
      headers: {},
    }, { status, json });

    expect(executeCommand).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});

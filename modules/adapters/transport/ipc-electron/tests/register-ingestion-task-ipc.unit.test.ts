import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL,
  createDesktopIngestionTaskExecuteRequest,
} from "../../../../contracts/ipc";
import { createDesktopIngestionTaskIpcHandler, registerIngestionTaskIpc } from "../ingestion-task/registerIngestionTaskIpc";

describe("registerIngestionTaskIpc", () => {
  it("forwards canonical commands with workspace and tracing context", async () => {
    const executeCommand = testDouble.fn().mockResolvedValue({
      ok: true,
      value: { kind: "cleanup", cleanedTaskIds: [] },
      requestId: "req-ingestion-1",
      correlationId: "corr-ingestion-1",
    });
    const handler = createDesktopIngestionTaskIpcHandler({
      senderTrust: { isTrustedSender: () => true },
      ingestionTasks: { executeCommand },
    });

    const response = await handler({}, createDesktopIngestionTaskExecuteRequest({
      command: { action: "list" },
      boundary: {
        host: "desktop",
        source: "desktop.renderer.data-management",
        workspaceId: "workspace-a",
      },
    }, { requestId: "req-ingestion-1", correlationId: "corr-ingestion-1" }));

    expect(executeCommand).toHaveBeenCalledWith(
      { action: "list" },
      { requestId: "req-ingestion-1", correlationId: "corr-ingestion-1", workspaceId: "workspace-a" },
    );
    expect(response).toMatchObject({ ok: true, operation: "ingestion.task-execute" });
  });

  it("fails closed for untrusted senders", async () => {
    const executeCommand = testDouble.fn();
    const handler = createDesktopIngestionTaskIpcHandler({
      senderTrust: { isTrustedSender: () => false },
      ingestionTasks: { executeCommand },
    });

    const response = await handler({}, createDesktopIngestionTaskExecuteRequest({
      command: { action: "list" },
      boundary: { host: "desktop", source: "desktop.renderer.data-management", workspaceId: "workspace-a" },
    }));

    expect(executeCommand).not.toHaveBeenCalled();
    expect(response).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("registers the canonical execute channel", () => {
    const handle = testDouble.fn();
    registerIngestionTaskIpc({
      ipcMain: { handle },
      senderTrust: { isTrustedSender: () => true },
      ingestionTasks: { executeCommand: testDouble.fn() },
    });

    expect(handle.mock.calls[0]?.[0]).toBe(DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL.value);
  });
});

import { describe, expect, it, testDouble } from "../../../../../modules/testing/node-test";
import { DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL, createDesktopIngestionTaskExecuteSuccessResponse } from "../../../../../modules/contracts/ipc";
import { createDesktopPreloadApi } from "../exposedApi";

describe("desktop preload ingestion task bridge", () => {
  it("creates a workspace-scoped canonical request and validates the response envelope", async () => {
    const invoke = testDouble.fn().mockResolvedValue(createDesktopIngestionTaskExecuteSuccessResponse({ kind: "tasks", tasks: [] }));
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await expect(api.executeIngestionTask({ workspaceId: "workspace-a", command: { action: "list" } }, { requestId: "req-1" })).resolves.toMatchObject({ ok: true, value: { kind: "tasks" } });
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_INGESTION_TASK_EXECUTE_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ requestId: "req-1", payload: { command: { action: "list" }, boundary: { host: "desktop", source: "desktop.renderer.data-management", workspaceId: "workspace-a" } } });
  });
});

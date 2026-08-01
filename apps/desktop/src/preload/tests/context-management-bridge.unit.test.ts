import { expect, it, testDouble } from "../../../../../modules/testing/node-test";
import {
  DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL,
  createDesktopContextManagementExecuteSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import { createDesktopPreloadApi } from "../exposedApi";

it("exposes Context Management through only its typed IPC request channel", async () => {
  const invoke = testDouble
    .fn<(channel: string, request?: unknown) => Promise<unknown>>()
    .mockResolvedValue(
      createDesktopContextManagementExecuteSuccessResponse({
        action: "browser-list",
        items: [],
      }),
    );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
  const result = await api.executeContextManagement({
    workspaceId: "workspace-a",
    command: { action: "browser-list" },
  });
  expect(result.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(
    DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL.value,
  );
  expect(invoke.mock.calls[0]?.[1]).toMatchObject({
    payload: {
      command: { action: "browser-list" },
      boundary: { workspaceId: "workspace-a" },
    },
  });
});

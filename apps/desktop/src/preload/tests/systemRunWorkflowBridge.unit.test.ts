import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../modules/testing/node-test";
import {
  DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS,
  createIpcSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import {
  createDesktopPreloadApi,
  type IpcRendererInvokePort,
} from "../exposedApi";

describe("desktop system run workflow preload bridge", () => {
  it("maps list, prepare, and invoke to their dedicated channels", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>(
      async (channel) => {
        const descriptor = Object.values(
          DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS,
        ).find((candidate) => candidate.request.value === channel)!;
        return createIpcSuccessResponse(descriptor.response, {});
      },
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const source = {
      kind: "approved-release" as const,
      sourceId: "release-1",
      sourceDigest: `sha256:${"a".repeat(64)}`,
      label: "Release 1",
    };
    await api.listSystemRunWorkflowProfiles({
      workspaceId: "workspace-1",
    });
    await api.prepareSystemRunWorkflow({
      workspaceId: "workspace-1",
      profileId: "builtin.workflow.deployment@1.0.0",
      source,
    });
    await api.invokeSystemRunWorkflow({
      workspaceId: "workspace-1",
      profileId: "builtin.workflow.deployment@1.0.0",
      source,
      actionId: "refresh",
      operationId: "operation-1",
      values: {},
    });
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS.listProfiles.request.value,
      DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS.prepare.request.value,
      DESKTOP_SYSTEM_RUN_WORKFLOW_CHANNELS.invoke.request.value,
    ]);
  });
});

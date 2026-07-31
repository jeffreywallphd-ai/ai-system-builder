import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import {
  DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL,
  createDesktopDatasetVersionPublishRequest,
} from "../../../../contracts/ipc";
import { registerDatasetVersionIpc } from "../dataset-version/registerDatasetVersionIpc";

describe("dataset version desktop IPC", () => {
  it("registers four bounded channels and forwards public confirmation with workspace context", async () => {
    const handlers = new Map<string, any>();
    const publish = testDouble.fn(async (_command: any, context: any) => ({ ok: true, value: { publication: { publicationId: "publication-1", visibility: "public" } }, ...context }));
    registerDatasetVersionIpc({ ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) }, listDatasetVersionsUseCase: { execute: testDouble.fn() }, compareDatasetVersionsUseCase: { execute: testDouble.fn() }, readDatasetVersionReproductionUseCase: { execute: testDouble.fn() }, publishDatasetVersionUseCase: { execute: publish } } as any);
    expect([...handlers.keys()]).toEqual([DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL.value, DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL.value, DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL.value, DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value]);
    const request = createDesktopDatasetVersionPublishRequest({ versionId: "version-1", repositoryId: "owner/data", visibility: "public", publicAccessConfirmed: true, boundary: { host: "desktop", source: "test", workspaceId: "workspace-a" } });
    const response = await handlers.get(DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value)({}, request);
    expect(response.ok).toBe(true);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ versionId: "version-1", confirmation: { approved: true, visibility: "public", publicAccessConfirmed: true } }), expect.objectContaining({ workspaceId: "workspace-a" }));
  });
});

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import {
  DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL,
  DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL,
  createDesktopDatasetReviewEditRequest,
  createDesktopDatasetVersionPublishRequest,
} from "../../../../contracts/ipc";
import { registerDatasetVersionIpc } from "../dataset-version/registerDatasetVersionIpc";

describe("dataset version desktop IPC", () => {
  it("registers bounded version and review channels and forwards public confirmation with workspace context", async () => {
    const handlers = new Map<string, any>();
    const publish = testDouble.fn(async (_command: any, context: any) => ({
      ok: true,
      value: {
        publication: { publicationId: "publication-1", visibility: "public" },
      },
      ...context,
    }));
    registerDatasetVersionIpc({
      ipcMain: {
        handle: (channel: string, handler: any) =>
          handlers.set(channel, handler),
      },
      listDatasetVersionsUseCase: { execute: testDouble.fn() },
      compareDatasetVersionsUseCase: { execute: testDouble.fn() },
      readDatasetVersionReproductionUseCase: { execute: testDouble.fn() },
      publishDatasetVersionUseCase: { execute: publish },
    } as any);
    expect([...handlers.keys()]).toEqual([
      DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value,
    ]);
    const request = createDesktopDatasetVersionPublishRequest({
      versionId: "version-1",
      repositoryId: "owner/data",
      visibility: "public",
      publicAccessConfirmed: true,
      boundary: { host: "desktop", source: "test", workspaceId: "workspace-a" },
    });
    const response = await handlers.get(
      DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value,
    )({}, request);
    expect(response.ok).toBe(true);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: "version-1",
        confirmation: {
          approved: true,
          visibility: "public",
          publicAccessConfirmed: true,
        },
      }),
      expect.objectContaining({ workspaceId: "workspace-a" }),
    );
  });

  it("forwards an exact row edit through the workspace-bound channel", async () => {
    const handlers = new Map<string, any>();
    const edit = testDouble.fn(async () => ({
      version: { versionId: "dataset:child" },
      versionLabel: "1.1",
      editedRowIndex: 0,
    }));
    registerDatasetVersionIpc({
      ipcMain: {
        handle: (channel: string, handler: any) =>
          handlers.set(channel, handler),
      },
      listDatasetVersionsUseCase: { execute: testDouble.fn() },
      compareDatasetVersionsUseCase: { execute: testDouble.fn() },
      readDatasetVersionReproductionUseCase: { execute: testDouble.fn() },
      publishDatasetVersionUseCase: { execute: testDouble.fn() },
      listDatasetReviewTargetsUseCase: { execute: testDouble.fn() },
      readDatasetReviewPageUseCase: { execute: testDouble.fn() },
      rejectDatasetReviewRowUseCase: { execute: testDouble.fn() },
      editDatasetReviewRowUseCase: { execute: edit },
    } as any);
    const fingerprint = `sha256:${"a".repeat(64)}` as const;
    const request = createDesktopDatasetReviewEditRequest({
      artifactKey: "datasets/train.parquet",
      rowIndex: 0,
      rowFingerprint: fingerprint,
      values: { instruction: "Answer clearly." },
      boundary: {
        host: "desktop",
        source: "test",
        workspaceId: "workspace-a",
      },
    });
    const response = await handlers.get(
      DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL.value,
    )({}, request);
    expect(response.ok).toBe(true);
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-a",
        artifactKey: "datasets/train.parquet",
        rowFingerprint: fingerprint,
        values: { instruction: "Answer clearly." },
      }),
      expect.objectContaining({ workspaceId: "workspace-a" }),
    );
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";

import { createDesktopModelsClient } from "../api/desktopModelsClient";

describe("desktop models client", () => {
  afterEach(() => {
    delete window.desktopApi;
  });

  it("delegates model browse/details/save/list/delete through preload bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn(),
      getArtifactUploadPolicy: vi.fn(),
      browseArtifacts: vi.fn(),
      readArtifactDetail: vi.fn(),
      readArtifactContentDescriptor: vi.fn(),
      readArtifactViewerMedia: vi.fn(),
      publishArtifactToRepo: vi.fn(),
      verifyPublishedArtifactBacking: vi.fn(),
      registerArtifactFromRepo: vi.fn(),
      localizeArtifactFromRepo: vi.fn(),
      browseModels: vi.fn().mockResolvedValue({ ok: true, value: { models: [{ provider: "huggingface", modelId: "org/model", displayName: "Model" }] } }),
      getModelDetails: vi.fn().mockResolvedValue({ ok: true, value: { model: { provider: "huggingface", modelId: "org/model", displayName: "Model" } } }),
      listModels: vi.fn().mockResolvedValue({ ok: true, value: { models: [{ modelRecordId: "m-list", displayName: "Listed", localPath: "/models/org/model", validationReportPath: "/reports/model.json" }] } }),
      saveModelReference: vi.fn().mockResolvedValue({
        ok: true,
        value: { model: { modelRecordId: "m1", displayName: "Model", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", modelId: "org/model", createdAt: "2026-04-27T00:00:00.000Z" } },
      }),
      downloadModel: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          model: { modelRecordId: "m2", displayName: "Model", source: "huggingface", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", modelId: "org/model", localPath: "/models/org/model", createdAt: "2026-04-27T00:00:00.000Z" },
          download: { provider: "transformers", modelId: "org/model", downloaded: true, fromCache: false, localPath: "/models/org/model" },
        },
      }),
      startModelDownload: vi.fn().mockResolvedValue({ ok: true, value: { activity: { requestId: "download-1", workspaceId: "workspace-a", modelId: "org/model", displayName: "Model", status: "queued" } } }),
      readModelDownload: vi.fn().mockResolvedValue({ ok: true, value: { activity: { requestId: "download-1", workspaceId: "workspace-a", modelId: "org/model", displayName: "Model", status: "succeeded", model: { modelRecordId: "m2", displayName: "Model", source: "huggingface", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", modelId: "org/model", localPath: "/models/org/model", createdAt: "2026-04-27T00:00:00.000Z" } } } }),
      listModelDownloads: vi.fn().mockResolvedValue({ ok: true, value: { activities: [] } }),
      cancelModelDownload: vi.fn().mockResolvedValue({ ok: true, value: { activity: { requestId: "download-1", workspaceId: "workspace-a", modelId: "org/model", displayName: "Model", status: "cancelled" }, cancelled: true } }),
      updateModelRecord: vi.fn().mockResolvedValue({
        ok: true,
        value: { model: { modelRecordId: "m1", displayName: "Model", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", modelId: "org/model", createdAt: "2026-04-27T00:00:00.000Z" } },
      }),
      deleteModelRecord: vi.fn().mockResolvedValue({
        ok: true,
        value: { deletedModelRecordId: "m1", deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] },
      }),
      revealModelInFolder: vi.fn().mockResolvedValue({
        ok: true,
        value: { modelRecordId: "m1", revealed: true },
      }),
      trainModel: vi.fn().mockResolvedValue({ ok: true, value: { runId: "run-1", status: "succeeded" } }),
      readModelTrainingStatus: vi.fn().mockResolvedValue({ ok: true, value: { runId: "run-1", status: "running", progress: { batch: 1, totalBatches: 59 } } }),
      validateModel: vi.fn().mockResolvedValue({ ok: true, value: { modelRecordId: "m1", status: "valid" } }),
      publishModel: vi.fn().mockResolvedValue({ ok: true, value: { modelRecordId: "m1", published: true, provider: "huggingface", repository: "owner/repo" } }),
    } as never;

    const client = createDesktopModelsClient();
    await client.browseModels({ provider: "huggingface", query: "org/model" });
    await client.getModelDetails({ provider: "huggingface", modelId: "org/model" });
    const listed = await client.listModels();
    await client.saveModelReference({ workspaceId: "workspace-a", modelId: "org/model", displayName: "Model" });
    const download = await client.downloadModel({ workspaceId: "workspace-a", modelId: "org/model", displayName: "Model" });
    await client.startModelDownload({ workspaceId: "workspace-a", modelId: "org/model", displayName: "Model" });
    await client.readModelDownload({ workspaceId: "workspace-a", requestId: "download-1" });
    await client.listModelDownloads({ workspaceId: "workspace-a", includeCompleted: true });
    await client.cancelModelDownload({ workspaceId: "workspace-a", requestId: "download-1" });
    expect(JSON.stringify({ listed, download })).not.toContain("/models/org/model");
    expect("localPath" in download.model).toBe(false);
    expect("localPath" in download.download).toBe(false);
    expect(listed[0]).toMatchObject({
      localFilesAvailable: true,
      validationReportAvailable: true,
    });
    expect("localPath" in listed[0]).toBe(false);
    expect("validationReportPath" in listed[0]).toBe(false);
    await client.updateModelRecord({ modelRecordId: "m1", patch: { validationStatus: "valid" } });
    await client.deleteModelRecord({ workspaceId: "workspace-a", modelRecordId: "m1" });
    await client.revealModelInFolder({ workspaceId: "workspace-a", modelRecordId: "m1" });
    await client.trainModel({
      baseModel: { modelRecordId: "m1" },
      datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
      method: "lora",
      commonParameters: {},
      output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } } },
    });
    await client.readModelTrainingStatus({ runId: "run-1" });
    await client.validateModel({ workspaceId: "workspace-a", modelRecordId: "m1" });
    await client.publishModel({ workspaceId: "workspace-a", modelRecordId: "m1", repository: "owner/repo" });

    const desktopApi = window.desktopApi as any;
    expect(desktopApi.browseModels).toHaveBeenCalled();
    expect(desktopApi.getModelDetails).toHaveBeenCalledWith({ provider: "huggingface", modelId: "org/model" });
    expect(desktopApi.saveModelReference).toHaveBeenCalledWith(expect.objectContaining({ provider: "huggingface", modelId: "org/model" }));
    expect(desktopApi.downloadModel).not.toHaveBeenCalled();
    expect(desktopApi.readModelDownload).toHaveBeenCalledWith({ workspaceId: "workspace-a", requestId: "download-1" });
    expect(desktopApi.startModelDownload).toHaveBeenCalledWith(expect.objectContaining({ provider: "huggingface", modelId: "org/model" }));
    expect(desktopApi.listModelDownloads).toHaveBeenCalledWith({ workspaceId: "workspace-a", includeCompleted: true });
    expect(desktopApi.deleteModelRecord).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "m1" });
    expect(desktopApi.revealModelInFolder).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "m1" });
    expect(desktopApi.trainModel).toHaveBeenCalled();
    expect(desktopApi.readModelTrainingStatus).toHaveBeenCalledWith({ runId: "run-1" });
    expect(desktopApi.validateModel).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "m1" });
    expect(desktopApi.publishModel).toHaveBeenCalledWith({ workspaceId: "workspace-a", modelRecordId: "m1", repository: "owner/repo" });
  });
});

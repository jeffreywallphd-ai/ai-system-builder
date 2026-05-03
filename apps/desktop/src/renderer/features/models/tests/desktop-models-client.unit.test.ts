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
      listModels: vi.fn().mockResolvedValue({ ok: true, value: { models: [] } }),
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
      updateModelRecord: vi.fn().mockResolvedValue({
        ok: true,
        value: { model: { modelRecordId: "m1", displayName: "Model", source: "huggingface", lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", modelId: "org/model", createdAt: "2026-04-27T00:00:00.000Z" } },
      }),
      deleteModelRecord: vi.fn().mockResolvedValue({
        ok: true,
        value: { deletedModelRecordId: "m1", deletedRegistryRecord: true, deletedLocalFiles: false, deletedBackingArtifactIds: [] },
      }),
      trainModel: vi.fn().mockResolvedValue({ ok: true, value: { runId: "run-1", status: "succeeded" } }),
      readModelTrainingStatus: vi.fn().mockResolvedValue({ ok: true, value: { runId: "run-1", status: "running", progress: { batch: 1, totalBatches: 59 } } }),
      validateModel: vi.fn().mockResolvedValue({ ok: true, value: { modelRecordId: "m1", status: "valid" } }),
      publishModel: vi.fn().mockResolvedValue({ ok: true, value: { modelRecordId: "m1", published: true, provider: "huggingface", repository: "owner/repo" } }),
    } as never;

    const client = createDesktopModelsClient();
    await client.browseModels({ provider: "huggingface", query: "org/model" });
    await client.getModelDetails({ provider: "huggingface", modelId: "org/model" });
    await client.listModels();
    await client.saveModelReference({ modelId: "org/model", displayName: "Model" });
    await client.downloadModel({ modelId: "org/model", displayName: "Model" });
    await client.updateModelRecord({ modelRecordId: "m1", patch: { validationStatus: "valid" } });
    await client.deleteModelRecord({ modelRecordId: "m1" });
    await client.trainModel({
      baseModel: { modelRecordId: "m1" },
      datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
      method: "lora",
      commonParameters: {},
      output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } } },
    });
    await client.readModelTrainingStatus({ runId: "run-1" });
    await client.validateModel({ modelRecordId: "m1" });
    await client.publishModel({ modelRecordId: "m1", repository: "owner/repo" });

    expect(window.desktopApi.browseModels).toHaveBeenCalled();
    expect(window.desktopApi.getModelDetails).toHaveBeenCalledWith({ provider: "huggingface", modelId: "org/model" });
    expect(window.desktopApi.saveModelReference).toHaveBeenCalledWith(expect.objectContaining({ provider: "huggingface", modelId: "org/model" }));
    expect(window.desktopApi.downloadModel).toHaveBeenCalledWith(expect.objectContaining({ provider: "huggingface", modelId: "org/model" }));
    expect(window.desktopApi.deleteModelRecord).toHaveBeenCalledWith({ modelRecordId: "m1" });
    expect(window.desktopApi.trainModel).toHaveBeenCalled();
    expect(window.desktopApi.readModelTrainingStatus).toHaveBeenCalledWith({ runId: "run-1" });
    expect(window.desktopApi.validateModel).toHaveBeenCalled();
    expect(window.desktopApi.publishModel).toHaveBeenCalled();
  });
});

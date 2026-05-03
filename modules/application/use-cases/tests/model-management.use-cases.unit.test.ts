import { describe, expect, it, testDouble } from "../../../testing/node-test";

import type { ArtifactCatalogDeletePort } from "../../ports/artifact-catalog";
import type { ModelRegistryPort } from "../../ports/model";
import {
  DeleteModelRecordUseCase,
  DownloadModelUseCase,
  RegisterDownloadedModelUseCase,
  RegisterGeneratedModelUseCase,
  SaveModelReferenceUseCase,
  UpdateModelRecordUseCase,
} from "../model";

describe("model management use cases", () => {
  it("saves a remote Hugging Face reference as a model asset", async () => {
    const saveModelReference = testDouble.fn<ModelRegistryPort["saveModelReference"]>(async (request) => ({
      model: {
        modelRecordId: "model-1",
        displayName: request.displayName ?? request.modelId,
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: "full-model",
        provider: request.provider,
        modelId: request.modelId,
        inferenceMode: request.inferenceMode,
        taskTags: request.taskTags,
        createdAt: "2026-04-27T00:00:00.000Z",
        metadata: request.metadata,
      },
    }));

    const useCase = new SaveModelReferenceUseCase({
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => undefined,
        saveModelReference,
        registerDownloadedModel: async () => { throw new Error("not used"); },
        registerGeneratedModel: async () => { throw new Error("not used"); },
        updateModelRecord: async () => { throw new Error("not used"); },
        deleteModelRecord: async () => { throw new Error("not used"); },
      },
    });

    const result = await useCase.execute({
      provider: "huggingface",
      modelId: " openai/demo-model ",
      displayName: " Demo Model ",
      inferenceMode: "causal",
      taskTags: ["text-generation"],
      metadata: { likes: 123 },
    });

    const saveCall = saveModelReference.mock.calls[0]?.[0];
    expect(saveCall?.provider).toBe("huggingface");
    expect(saveCall?.modelId).toBe("openai/demo-model");
    expect(saveCall?.displayName).toBe("Demo Model");
    expect(result.model.lifecycleStatus).toBe("saved-reference");
  });

  it("requires downloaded models to have local path or backing artifacts", async () => {
    const useCase = new RegisterDownloadedModelUseCase({
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => undefined,
        saveModelReference: async () => { throw new Error("not used"); },
        registerDownloadedModel: async () => { throw new Error("not used"); },
        registerGeneratedModel: async () => { throw new Error("not used"); },
        updateModelRecord: async () => { throw new Error("not used"); },
        deleteModelRecord: async () => { throw new Error("not used"); },
      },
    });

    await expect(useCase.execute({
      displayName: "Downloaded",
      source: "local",
      provider: "huggingface",
      artifactForm: "full-model",
    })).rejects.toThrow("requires localPath or backingArtifactIds");
  });

  it("downloads a remote Hugging Face model and registers the local cache path", async () => {
    const registerDownloadedModel = testDouble.fn<ModelRegistryPort["registerDownloadedModel"]>(async (request) => ({
      model: {
        modelRecordId: "downloaded-1",
        displayName: request.displayName,
        source: "huggingface",
        lifecycleStatus: "downloaded",
        artifactForm: request.artifactForm,
        provider: request.provider,
        modelId: request.modelId,
        localPath: request.localPath,
        createdAt: "2026-04-27T00:00:00.000Z",
        metadata: request.metadata,
      },
    }));
    const ensureModelDownloaded = testDouble.fn(async () => ({
      provider: "transformers" as const,
      modelId: "org/demo-model",
      downloaded: true,
      fromCache: false,
      localPath: "/models/org/demo-model",
    }));
    const useCase = new DownloadModelUseCase({
      modelDownloader: { ensureModelDownloaded },
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => undefined,
        saveModelReference: async () => { throw new Error("not used"); },
        registerDownloadedModel,
        registerGeneratedModel: async () => { throw new Error("not used"); },
        updateModelRecord: async () => { throw new Error("not used"); },
        deleteModelRecord: async () => { throw new Error("not used"); },
      },
    });

    const result = await useCase.execute({
      provider: "huggingface",
      modelId: " org/demo-model ",
      displayName: " Demo Model ",
      inferenceMode: "causal",
      taskTags: ["text-generation"],
      metadata: { likes: 10 },
    });

    expect(ensureModelDownloaded).toHaveBeenCalledWith({ provider: "transformers", modelId: "org/demo-model" });
    const registerCall = registerDownloadedModel.mock.calls[0]?.[0];
    expect(registerCall?.displayName).toBe("Demo Model");
    expect(registerCall?.source).toBe("huggingface");
    expect(registerCall?.provider).toBe("huggingface");
    expect(registerCall?.modelId).toBe("org/demo-model");
    expect(registerCall?.localPath).toBe("/models/org/demo-model");
    expect(result.model.lifecycleStatus).toBe("downloaded");
    expect(result.download.localPath).toBe("/models/org/demo-model");
  });

  it("registers generated adapter models with run/base linkage", async () => {
    const registerGeneratedModel = testDouble.fn<ModelRegistryPort["registerGeneratedModel"]>(async (request) => ({
      model: {
        modelRecordId: "generated-1",
        displayName: request.displayName,
        source: "generated",
        lifecycleStatus: "generated",
        artifactForm: request.artifactForm,
        provider: request.provider ?? "unknown",
        createdAt: "2026-04-27T00:00:00.000Z",
        generatedFromRunId: request.generatedFromRunId,
        baseModelId: request.baseModelId,
        adapterOfModelId: request.adapterOfModelId,
        localPath: request.localPath,
      },
    }));

    const useCase = new RegisterGeneratedModelUseCase({
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => undefined,
        saveModelReference: async () => { throw new Error("not used"); },
        registerDownloadedModel: async () => { throw new Error("not used"); },
        registerGeneratedModel,
        updateModelRecord: async () => { throw new Error("not used"); },
        deleteModelRecord: async () => { throw new Error("not used"); },
      },
    });

    const result = await useCase.execute({
      displayName: "Adapter Output",
      artifactForm: "adapter",
      localPath: "/models/adapter",
      generatedFromRunId: "run-42",
      baseModelId: "base-1",
      adapterOfModelId: "base-1",
    });

    const generatedCall = registerGeneratedModel.mock.calls[0]?.[0];
    expect(generatedCall?.generatedFromRunId).toBe("run-42");
    expect(result.model.baseModelId).toBe("base-1");
  });

  it("updates validation status and report path", async () => {
    const updateModelRecord = testDouble.fn<ModelRegistryPort["updateModelRecord"]>(async (request) => ({
      model: {
        modelRecordId: request.modelRecordId,
        displayName: "Demo",
        source: "generated",
        lifecycleStatus: "validated",
        artifactForm: "full-model",
        provider: "huggingface",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T01:00:00.000Z",
        validationStatus: request.patch.validationStatus,
        validationReportPath: request.patch.validationReportPath,
      },
    }));

    const useCase = new UpdateModelRecordUseCase({
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => undefined,
        saveModelReference: async () => { throw new Error("not used"); },
        registerDownloadedModel: async () => { throw new Error("not used"); },
        registerGeneratedModel: async () => { throw new Error("not used"); },
        updateModelRecord,
        deleteModelRecord: async () => { throw new Error("not used"); },
      },
    });

    const result = await useCase.execute({
      modelRecordId: "model-1",
      patch: {
        validationStatus: "valid",
        validationReportPath: "/reports/model-1.json",
      },
    });

    expect(result.model.validationStatus).toBe("valid");
    expect(result.model.validationReportPath).toBe("/reports/model-1.json");
  });

  it("deletes registry records without deleting backing artifacts unless explicitly requested", async () => {
    const deleteArtifactCatalogRecord = testDouble.fn<ArtifactCatalogDeletePort["deleteArtifactCatalogRecord"]>(async () => ({
      ok: true,
      value: { deleted: true },
    }));
    const deleteModelRecord = testDouble.fn<ModelRegistryPort["deleteModelRecord"]>(async (request) => ({
      deletedModelRecordId: request.modelRecordId,
      deletedRegistryRecord: true,
      deletedLocalFiles: false,
      deletedBackingArtifactIds: [],
    }));

    const useCase = new DeleteModelRecordUseCase({
      modelRegistry: {
        listModels: async () => ({ models: [] }),
        getModelRecord: async () => ({
          modelRecordId: "model-1",
          displayName: "Model 1",
        source: "generated",
        lifecycleStatus: "generated",
        artifactForm: "adapter",
        provider: "unknown",
          createdAt: "2026-04-27T00:00:00.000Z",
          backingArtifactIds: ["art-1"],
        }),
        saveModelReference: async () => { throw new Error("not used"); },
        registerDownloadedModel: async () => { throw new Error("not used"); },
        registerGeneratedModel: async () => { throw new Error("not used"); },
        updateModelRecord: async () => { throw new Error("not used"); },
        deleteModelRecord,
      },
      artifactCatalogDeletePort: { deleteArtifactCatalogRecord },
    });

    await useCase.execute({ modelRecordId: "model-1" });
    expect(deleteArtifactCatalogRecord).not.toHaveBeenCalled();

    const withArtifacts = await useCase.execute({ modelRecordId: "model-1", deleteBackingArtifacts: true });
    expect(deleteArtifactCatalogRecord).toHaveBeenCalledTimes(1);
    expect(withArtifacts.deletedBackingArtifactIds).toEqual(["art-1"]);
  });
});

import { describe, expect, expectTypeOf, it } from "../../testing/node-test";

import type { LocalModelConfig } from "../runtime";
import {
  DEFAULT_BROWSE_MODELS_LIMIT,
  MAX_BROWSE_MODELS_LIMIT,
  MAX_LIST_MODELS_LIMIT,
  MODEL_BROWSE_PROVIDERS,
  MODEL_INFERENCE_MODES,
  MODEL_TRAINING_METHODS,
  MODEL_TRAINING_STATUSES,
  MODEL_VALIDATION_STATUSES,
  normalizeBrowseModelsRequest,
  normalizeBrowseModelsResult,
  normalizeDeleteModelRecordRequest,
  normalizeListModelsRequest,
  normalizeModelDetails,
  normalizeModelInferenceMode,
  normalizeModelInventoryRecord,
  normalizeModelValidationSummary,
  normalizeRegisterDownloadedModelRequest,
  normalizeRegisterGeneratedModelRequest,
  recommendModelInferenceMode,
  type BrowseModelsResult,
  type ModelInferenceMode,
  type ModelInventoryRecord,
  type RegisterDownloadedModelRequest,
  type ModelTrainingRequest,
  type ModelTrainingResult,
} from ".";

describe("model contracts", () => {
  it("defines browse providers and inference modes", () => {
    expect(MODEL_BROWSE_PROVIDERS).toEqual(["huggingface", "unknown"]);
    expect(MODEL_INFERENCE_MODES).toEqual(["text2text", "causal", "chat", "text-to-image"]);
    expect(normalizeModelInferenceMode(" chat ")).toBe("chat");
    expectTypeOf<ModelInferenceMode>().toExtend<Exclude<NonNullable<LocalModelConfig["inferenceMode"]>, "auto">>();
  });

  it("normalizes browse request and result shapes", () => {
    const request = normalizeBrowseModelsRequest({
      provider: "huggingface",
      query: " mistral ",
      taskTags: ["summarization", " chat "],
      authorOrOrg: " mistralai ",
      limit: 25,
      cursor: " next ",
      sort: "downloads",
      direction: "desc",
    });

    expect(request).toEqual({
      provider: "huggingface",
      query: "mistral",
      taskTags: ["summarization", "chat"],
      authorOrOrg: "mistralai",
      limit: 25,
      cursor: "next",
      sort: "downloads",
      direction: "desc",
    });

    const result: BrowseModelsResult = normalizeBrowseModelsResult({
      models: [{
        provider: "huggingface",
        modelId: " mistralai/Mistral-7B-Instruct-v0.2 ",
        displayName: " Mistral 7B Instruct ",
        taskTags: ["text-generation", "chat"],
        inferenceMode: "causal",
      }],
      nextCursor: " page-2 ",
    });

    expect(result.models[0]).toMatchObject({
      modelId: "mistralai/Mistral-7B-Instruct-v0.2",
      displayName: "Mistral 7B Instruct",
      taskTags: ["text-generation", "chat"],
      inferenceMode: "causal",
    });
    expect(result.nextCursor).toBe("page-2");
  });

  it("normalizes invalid browse limits to defaults and max", () => {
    expect(normalizeBrowseModelsRequest({ provider: "huggingface", limit: 0 }).limit).toBe(DEFAULT_BROWSE_MODELS_LIMIT);
    expect(normalizeBrowseModelsRequest({ provider: "huggingface", limit: -5 }).limit).toBe(DEFAULT_BROWSE_MODELS_LIMIT);
    expect(normalizeBrowseModelsRequest({ provider: "huggingface", limit: 12.9 }).limit).toBe(DEFAULT_BROWSE_MODELS_LIMIT);
    expect(normalizeBrowseModelsRequest({ provider: "huggingface", limit: 5000 }).limit).toBe(MAX_BROWSE_MODELS_LIMIT);
    expect(normalizeBrowseModelsRequest({ provider: "huggingface" }).limit).toBe(DEFAULT_BROWSE_MODELS_LIMIT);
  });

  it("recommends inference mode from known pipeline/task tags", () => {
    expect(recommendModelInferenceMode({ pipelineTag: "text2text-generation" })).toBe("text2text");
    expect(recommendModelInferenceMode({ taskTags: ["summarization"] })).toBe("text2text");
    expect(recommendModelInferenceMode({ taskTags: ["question-answering"] })).toBe("text2text");
    expect(recommendModelInferenceMode({ pipelineTag: "text-generation" })).toBe("causal");
    expect(recommendModelInferenceMode({ pipelineTag: "chat" })).toBe("chat");
    expect(recommendModelInferenceMode({ pipelineTag: "text-to-image" })).toBe("text-to-image");
    expect(recommendModelInferenceMode({ pipelineTag: "unknown-task" })).toBeUndefined();
  });

  it("normalizes model details files and preserves siblings compatibility", () => {
    const model = normalizeModelDetails({
      provider: "huggingface",
      modelId: "openai/demo-model",
      displayName: "Demo Model",
      files: [{ path: " model.safetensors ", sizeBytes: 1234, blobId: " abc ", lfs: true }],
    });

    expect(model.files).toEqual([{ path: "model.safetensors", sizeBytes: 1234, blobId: "abc", lfs: true }]);
    expect(model.siblings).toEqual(["model.safetensors"]);
  });

  it("normalizes inventory records with model vocabulary types", () => {
    const record: ModelInventoryRecord = normalizeModelInventoryRecord({
      modelRecordId: " model-001 ",
      displayName: " Mistral 7B Instruct ",
      source: "huggingface",
      lifecycleStatus: "downloaded",
      artifactForm: "full-model",
      provider: "huggingface",
      modelId: " mistralai/Mistral-7B-Instruct-v0.2 ",
      createdAt: " 2026-04-27T00:00:00.000Z ",
      taskTags: ["text-generation", "chat"],
      inferenceMode: "causal",
      serializationFormat: "safetensors",
      validationStatus: "valid",
    });

    expect(record).toMatchObject({
      modelRecordId: "model-001",
      displayName: "Mistral 7B Instruct",
      modelId: "mistralai/Mistral-7B-Instruct-v0.2",
      taskTags: ["text-generation", "chat"],
      inferenceMode: "causal",
      serializationFormat: "safetensors",
      validationStatus: "valid",
    });
  });

  it("supports model training request/result and validation report shapes", () => {
    const request: ModelTrainingRequest = {
      baseModel: {
        provider: "huggingface",
        modelId: "mistralai/Mistral-7B-Instruct-v0.2",
        inferenceMode: "causal",
      },
      datasets: [{ artifactId: "artifact-001", splitRole: "train", format: "jsonl" }],
      method: "qlora",
      commonParameters: {
        numEpochs: 3,
        batchSize: 2,
        learningRate: 0.0002,
      },
      advancedParameters: {
        gradientAccumulationSteps: 8,
        mixedPrecision: "bf16",
        lora: { rank: 16, alpha: 32, dropout: 0.05 },
        quantization: { loadIn4Bit: true, bnb4BitQuantType: "nf4" },
      },
      output: {
        outputModelName: "mistral-7b-instruct-qlora-demo",
        destination: {
          local: { enabled: true },
          huggingFace: { enabled: false, provider: "huggingface" },
        },
      },
      validation: { enabled: true, expectedLoRA: true },
    };

    const result: ModelTrainingResult = {
      runId: "run-001",
      status: "queued",
      warnings: ["pending scheduler assignment"],
    };

    expect(request.method).toBe("qlora");
    expect(result.status).toBe("queued");
    expect(MODEL_TRAINING_METHODS).toEqual(["lora", "qlora", "full-finetune"]);
    expect(MODEL_TRAINING_STATUSES).toEqual(["queued", "running", "succeeded", "failed", "cancelled"]);

    const validation = normalizeModelValidationSummary({
      status: "warning",
      serializationFormat: "sharded-safetensors",
      shardCount: 4,
      warnings: [" missing tokenizer config "],
    });

    expect(validation).toEqual({
      status: "warning",
      checkedAt: undefined,
      reportPath: undefined,
      expectedLoRA: undefined,
      expectedRecurrentAdditions: undefined,
      detectedLoRA: undefined,
      detectedRecurrentAdditions: undefined,
      serializationFormat: "sharded-safetensors",
      shardCount: 4,
      warnings: ["missing tokenizer config"],
      errors: undefined,
    });
    expect(MODEL_VALIDATION_STATUSES).toEqual(["unknown", "valid", "invalid", "warning"]);
  });

  it("supports inventory backing artifact links and generated/adapter lineage fields", () => {
    const generated = normalizeModelInventoryRecord({
      modelRecordId: "gen-1",
      displayName: "Generated Adapter",
      source: "generated",
      lifecycleStatus: "generated",
      artifactForm: "adapter",
      provider: "huggingface",
      createdAt: "2026-04-27T00:00:00.000Z",
      baseModelId: "base-1",
      adapterOfModelId: "base-1",
      generatedFromRunId: "run-77",
      backingArtifactIds: [" artifact/a ", "artifact/b"],
      primaryArtifactId: " artifact/a ",
    });

    expect(generated.backingArtifactIds).toEqual(["artifact/a", "artifact/b"]);
    expect(generated.primaryArtifactId).toBe("artifact/a");
    expect(generated.generatedFromRunId).toBe("run-77");
    expect(generated.baseModelId).toBe("base-1");
    expect(generated.adapterOfModelId).toBe("base-1");
  });

  it("normalizes published summary metadata without mutating local identity fields", () => {
    const record = normalizeModelInventoryRecord({
      modelRecordId: "model-1",
      displayName: "Generated Adapter",
      source: "generated",
      lifecycleStatus: "generated",
      artifactForm: "adapter",
      provider: "unknown",
      modelId: "local/generated-id",
      createdAt: "2026-04-27T00:00:00.000Z",
      published: {
        provider: "huggingface",
        repository: " owner/repo ",
        revision: " main ",
        url: " https://huggingface.co/owner/repo ",
        publishedAt: " 2026-04-27T00:05:00.000Z ",
      },
    });

    expect(record.source).toBe("generated");
    expect(record.modelId).toBe("local/generated-id");
    expect(record.published).toEqual({
      provider: "huggingface",
      repository: "owner/repo",
      revision: "main",
      url: "https://huggingface.co/owner/repo",
      publishedAt: "2026-04-27T00:05:00.000Z",
    });
  });

  it("normalizes list/delete model-management operation requests", () => {
    const list = normalizeListModelsRequest({
      source: "generated",
      lifecycleStatus: "generated",
      artifactForm: "adapter",
      search: " demo ",
      limit: 999,
      includeDiscovered: false,
    });

    expect(list.limit).toBe(MAX_LIST_MODELS_LIMIT);
    expect(list.search).toBe("demo");
    expect(list.includeDiscovered).toBe(false);

    const del = normalizeDeleteModelRecordRequest({
      modelRecordId: " model-1 ",
      deleteLocalFiles: true,
      deleteBackingArtifacts: false,
    });

    expect(del).toEqual({
      modelRecordId: "model-1",
      deleteLocalFiles: true,
      deleteBackingArtifacts: false,
    });
  });

  it("preserves validation metadata when registering downloaded and generated models", () => {
    const downloaded: RegisterDownloadedModelRequest = {
      displayName: " Downloaded Model ",
      source: "huggingface",
      provider: "huggingface",
      localPath: " C:/models/downloaded ",
      artifactForm: "full-model",
      validationStatus: "warning",
      validationReportPath: " reports/downloaded.md ",
    };

    expect(normalizeRegisterDownloadedModelRequest(downloaded)).toMatchObject({
      displayName: "Downloaded Model",
      validationStatus: "warning",
      validationReportPath: "reports/downloaded.md",
    });

    expect(normalizeRegisterGeneratedModelRequest({
      displayName: " Generated Adapter ",
      provider: "huggingface",
      localPath: " C:/models/generated ",
      artifactForm: "adapter",
      baseModelId: " base-model ",
      validationStatus: "valid",
      validationReportPath: " reports/generated.md ",
    })).toMatchObject({
      displayName: "Generated Adapter",
      validationStatus: "valid",
      validationReportPath: "reports/generated.md",
    });
  });

});

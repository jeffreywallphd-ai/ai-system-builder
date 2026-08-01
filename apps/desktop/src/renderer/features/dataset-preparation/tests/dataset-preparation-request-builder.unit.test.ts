import { describe, expect, it } from "vitest";

import { buildDatasetPreparationRequest } from "../hooks/datasetPreparationRequestBuilder";

describe("datasetPreparationRequestBuilder", () => {
  it("includes optional numeric values when provided", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      advancedPreset: "generate-examples",
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "text2text",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "support-tickets-2026",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: 20,
        maxExamplesPerChunk: 4,
        batchSize: 4,
        generationTemperature: 0.3,
        generationTopP: 0.95,
        generationMaxNewTokens: 256,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: 1234,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "text2text",
        source: "global",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.generation.model).toMatchObject({
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-7B-Instruct",
      inferenceMode: "chat",
      device: "auto",
      torchDtype: "auto",
      memoryOverflowPolicy: "limited",
    });
    expect(request.recipe.task).toMatchObject({
      taskType: "llm-instruction",
      textInputMode: "generate",
      promptStyle: "instruction-response",
    });
    expect(request.recipe.generation.promptTemplate).toContain(
      "instruction-tuning",
    );
    expect(request.recipe.generation.structuredOutput).toMatchObject({
      constrainedDecoding: false,
      visualShape: {
        schemaVersion: "1",
        taskType: "llm-instruction",
      },
    });
    expect(request.recipe.chunking.maxChunkCount).toBe(20);
    expect(request.recipe.generation.maxExamplesPerChunk).toBe(4);
    expect(request.recipe.generation.batchSize).toBe(4);
    expect(request.recipe.generation.generationParams).toEqual({
      temperature: 0.3,
      topP: 0.95,
      maxNewTokens: 256,
    });
    expect(request.split.seed).toBe(1234);
    expect(request.split).toMatchObject({ trainRatio: 0.8, testRatio: 0.2 });
    expect(request.output.naming).toEqual({
      baseName: "support-tickets-2026",
    });
    expect(request.advanced).toMatchObject({
      preset: "generate-examples",
      content: { strategy: "semantic", ocrEnabled: false },
      semantic: { enabled: true, embeddingAlgorithm: "hashed-token-v1" },
      synthetic: { enabled: true, candidatesPerChunk: 2, requireReview: true },
    });
  });

  it("omits optional numeric values when undefined", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "text2text",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: undefined,
        batchSize: undefined,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "text2text",
        source: "global",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.chunking.maxChunkCount).toBeUndefined();
    expect(request.recipe.generation.maxExamplesPerChunk).toBeUndefined();
    expect(request.recipe.generation.batchSize).toBeUndefined();
    expect(request.recipe.generation.generationParams).toEqual({
      temperature: undefined,
      topP: undefined,
      maxNewTokens: undefined,
    });
    expect(request.split.seed).toBeUndefined();
    expect(request.advanced).toBeUndefined();
  });

  it("builds task-specific recipe settings", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-classification",
      labelSet: "billing, support, bug",
      multiLabel: true,
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "text2text",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: undefined,
        batchSize: undefined,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "text2text",
        source: "global",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.task).toEqual({
      taskType: "llm-classification",
      textInputMode: "generate",
      textField: "text",
      labelField: "label",
      labelSet: ["billing", "support", "bug"],
      multiLabel: true,
    });
  });

  it("includes causal inferenceMode", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "Qwen/Qwen2.5-1.5B-Instruct",
      modelInferenceMode: "causal",
      modelDevice: "cuda",
      modelTorchDtype: "float16",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: 4,
        batchSize: 4,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "text2text",
        source: "global",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.generation.model.inferenceMode).toBe("causal");
  });

  it("includes auto inferenceMode so the runtime can resolve model architecture", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "Qwen/Qwen3-1.7B",
      modelInferenceMode: "auto",
      modelDevice: "auto",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: 4,
        batchSize: 4,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "auto",
        source: "builtin",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.generation.model.inferenceMode).toBe("auto");
  });

  it("falls back to resolved default inference mode when input inference mode is invalid", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "Qwen/Qwen2.5-1.5B-Instruct",
      modelInferenceMode: "" as never,
      modelDevice: "cuda",
      modelTorchDtype: "float16",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: 4,
        batchSize: 4,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "text2text",
        source: "global",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.generation.model.inferenceMode).toBe("text2text");
  });

  it("prefixes default namespace and normalizes backslash repository separators", () => {
    const withNameOnly = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "auto",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: false,
      huggingFaceDestinationEnabled: true,
      huggingFaceRepository: "AISysBuilderTest",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      defaultHuggingFaceNamespace: "OpenFinAL",
      parsed: {
        chunkSize: 1000,
        chunkOverlap: 200,
        maxChunkCount: undefined,
        maxExamplesPerChunk: 4,
        batchSize: 4,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        testRatio: 0.2,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "auto",
        source: "builtin",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(withNameOnly.output.destinations.huggingFace?.repository).toBe(
      "OpenFinAL/AISysBuilderTest",
    );
    const withBackslashes = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "auto",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: false,
      huggingFaceDestinationEnabled: true,
      huggingFaceRepository: "OpenFinAL\\AISysBuilderTest",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: withNameOnly.split,
      resolvedDefault: {
        provider: "transformers",
        modelId: "google/flan-t5-base",
        inferenceMode: "auto",
        source: "builtin",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(withBackslashes.output.destinations.huggingFace?.repository).toBe(
      "OpenFinAL/AISysBuilderTest",
    );
  });

  it("serializes only topic-aware controls for adaptive document preparation", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["document-1"],
      preparation: {
        schemaVersion: "1",
        inputIntent: "create-from-source-material",
        method: "topic-aware",
        sourceKinds: ["document"],
        generationMode: "task-examples",
      },
      taskType: "llm-instruction",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "local/model",
      modelInferenceMode: "auto",
      modelDevice: "auto",
      modelTorchDtype: "auto",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        chunkSize: undefined,
        chunkOverlap: undefined,
        maxChunkCount: undefined,
        maxTokensPerChunk: 480,
        topicBoundarySensitivity: 0.3,
        maxSourceSpans: 8_000,
        similarityThreshold: 0.86,
        maxExamplesPerChunk: 3,
        batchSize: 4,
        generationTemperature: 0.2,
        generationTopP: 0.9,
        generationMaxNewTokens: 256,
        trainRatio: 0.8,
        validationRatio: 0.1,
        testRatio: 0.1,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "fallback/model",
        inferenceMode: "auto",
        source: "builtin",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.chunking).toBeUndefined();
    expect(request.recipe.normalization).toBeDefined();
    expect(request.recipe.generation?.maxExamplesPerChunk).toBeUndefined();
    expect(request.advanced).toMatchObject({
      preset: "topic-aware",
      content: {
        strategy: "semantic",
        maxTokensPerChunk: 480,
        semanticBoundaryThreshold: 0.3,
        maxSourceSpans: 8_000,
      },
      semantic: { similarityThreshold: 0.86 },
      synthetic: { candidatesPerChunk: 3 },
    });
  });

  it("omits document and model settings for one existing dataset", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["dataset-1"],
      preparation: {
        schemaVersion: "1",
        inputIntent: "use-existing-dataset",
        method: "validate-and-split",
        sourceKinds: ["structured"],
        generationMode: "none",
      },
      taskType: "llm-classification",
      labelSet: "billing, support",
      unsupportedDocumentPolicy: "",
      normalizationMode: "",
      preserveDocumentBoundaries: true,
      modelId: "",
      modelInferenceMode: "auto",
      modelDevice: "",
      modelTorchDtype: "",
      failurePolicy: "skip",
      shuffle: true,
      outputFormat: "parquet",
      outputBaseName: "",
      localDestinationEnabled: true,
      huggingFaceDestinationEnabled: false,
      huggingFaceRepository: "",
      huggingFaceRevision: "",
      huggingFacePathPrefix: "",
      parsed: {
        maxChunkCount: undefined,
        maxExamplesPerChunk: undefined,
        batchSize: undefined,
        generationTemperature: undefined,
        generationTopP: undefined,
        generationMaxNewTokens: undefined,
        trainRatio: 0.8,
        validationRatio: 0.1,
        testRatio: 0.1,
        seed: undefined,
      },
      resolvedDefault: {
        provider: "transformers",
        modelId: "fallback/model",
        inferenceMode: "auto",
        source: "builtin",
        device: "auto",
        torchDtype: "auto",
      },
    });

    expect(request.recipe.normalization).toBeUndefined();
    expect(request.recipe.chunking).toBeUndefined();
    expect(request.recipe.generation).toBeUndefined();
    expect(request.advanced).toBeUndefined();
    expect(request.recipe.task.textInputMode).toBe("provided");
  });
});

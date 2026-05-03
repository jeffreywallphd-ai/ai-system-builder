import { describe, expect, it } from "vitest";

import { buildDatasetPreparationRequest } from "../hooks/datasetPreparationRequestBuilder";

describe("datasetPreparationRequestBuilder", () => {
  it("includes optional numeric values when provided", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
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
      modelId: "google/flan-t5-base",
      inferenceMode: "text2text",
      device: "auto",
      torchDtype: "auto",
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
  });

  it("omits optional numeric values when undefined", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
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
  });

  it("includes causal inferenceMode", () => {
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
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

    expect(withNameOnly.output.destinations.huggingFace?.repository).toBe("OpenFinAL/AISysBuilderTest");
    const withBackslashes = buildDatasetPreparationRequest({
      selectedArtifactIds: ["artifact-1"],
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

    expect(withBackslashes.output.destinations.huggingFace?.repository).toBe("OpenFinAL/AISysBuilderTest");
  });
});

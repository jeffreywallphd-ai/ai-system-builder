import { describe, expect, it } from "vitest";

import { validateAndParseDatasetPreparationInputs } from "../hooks/datasetPreparationRequestValidation";

function createValidInput() {
  return {
    selectedArtifactIds: ["artifact-1"],
    taskType: "llm-instruction" as const,
    chunkSize: "1000",
    chunkOverlap: "200",
    maxChunkCount: "",
    modelId: "",
    maxExamplesPerChunk: "4",
    batchSize: "4",
    generationTemperature: "",
    generationTopP: "",
    generationMaxNewTokens: "",
    trainRatio: "0.8",
    testRatio: "0.2",
    seed: "",
    localDestinationEnabled: true,
    huggingFaceDestinationEnabled: false,
    huggingFaceRepository: "",
  };
}

describe("datasetPreparationRequestValidation", () => {
  it("returns parsed values for valid input", () => {
    expect(
      validateAndParseDatasetPreparationInputs(createValidInput()),
    ).toEqual({
      ok: true,
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
        validationRatio: 0,
        testRatio: 0.2,
        seed: undefined,
      },
    });
  });

  it("returns error for invalid input", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        chunkSize: "0",
      }),
    ).toEqual({
      ok: false,
      error: "Chunk size must be a positive integer.",
    });
  });

  it("returns a friendly repository-name message when default namespace is configured", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        huggingFaceDestinationEnabled: true,
        defaultHuggingFaceNamespace: "OpenFinAL",
      }),
    ).toEqual({
      ok: false,
      error:
        "Dataset repository name is required when Hugging Face publishing is enabled.",
    });
  });

  it("rejects backslash repository separators", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        huggingFaceDestinationEnabled: true,
        defaultHuggingFaceNamespace: "OpenFinAL",
        huggingFaceRepository: "OpenFinAL\\AISysBuilderTest",
      }),
    ).toEqual({
      ok: false,
      error:
        "Dataset repository name cannot include backslashes. Use only the repository name (for example: my-dataset).",
    });
  });

  it("allows first-tier task profiles that are executable in dataset preparation", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        taskType: "vision-detection",
      }).ok,
    ).toBe(true);
  });

  it("validates only semantic controls for topic-aware preparation", () => {
    const result = validateAndParseDatasetPreparationInputs({
      ...createValidInput(),
      preparation: {
        schemaVersion: "1",
        inputIntent: "create-from-source-material",
        method: "topic-aware",
        sourceKinds: ["document"],
        generationMode: "task-examples",
      },
      chunkSize: "not used",
      chunkOverlap: "not used",
      maxTokensPerChunk: "480",
      topicBoundarySensitivity: "0.3",
      maxSourceSpans: "8000",
      similarityThreshold: "0.86",
    });

    expect(result).toMatchObject({
      ok: true,
      parsed: {
        chunkSize: undefined,
        chunkOverlap: undefined,
        maxTokensPerChunk: 480,
        topicBoundarySensitivity: 0.3,
        maxSourceSpans: 8000,
        similarityThreshold: 0.86,
      },
    });
  });

  it("rejects an invalid topic sensitivity without consulting overlap", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        preparation: {
          schemaVersion: "1",
          inputIntent: "create-from-source-material",
          method: "topic-aware",
          sourceKinds: ["document"],
          generationMode: "task-examples",
        },
        chunkOverlap: "not used",
        maxTokensPerChunk: "320",
        topicBoundarySensitivity: "1.2",
        maxSourceSpans: "10000",
        similarityThreshold: "0.9",
      }),
    ).toEqual({
      ok: false,
      error: "Topic change sensitivity must be between 0 and 1.",
    });
  });

  it("does not require document controls for an existing dataset", () => {
    expect(
      validateAndParseDatasetPreparationInputs({
        ...createValidInput(),
        preparation: {
          schemaVersion: "1",
          inputIntent: "use-existing-dataset",
          method: "validate-and-split",
          sourceKinds: ["structured"],
          generationMode: "none",
        },
        chunkSize: "",
        chunkOverlap: "",
      }).ok,
    ).toBe(true);
  });
});

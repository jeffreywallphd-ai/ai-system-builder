import { describe, expect, it } from "vitest";

import { validateAndParseDatasetPreparationInputs } from "../hooks/datasetPreparationRequestValidation";

function createValidInput() {
  return {
    selectedArtifactIds: ["artifact-1"],
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
    expect(validateAndParseDatasetPreparationInputs(createValidInput())).toEqual({
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
        testRatio: 0.2,
        seed: undefined,
      },
    });
  });

  it("returns error for invalid input", () => {
    expect(validateAndParseDatasetPreparationInputs({ ...createValidInput(), chunkSize: "0" })).toEqual({
      ok: false,
      error: "Chunk size must be a positive integer.",
    });
  });
});

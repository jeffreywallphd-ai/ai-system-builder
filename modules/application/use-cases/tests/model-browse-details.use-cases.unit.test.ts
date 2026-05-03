import { describe, expect, it, testDouble } from "../../../testing/node-test";

import type { ModelBrowsePort, ModelDetailsPort } from "../../ports/model";
import { BrowseModelsUseCase, GetModelDetailsUseCase } from "../model";

describe("model browse/details use cases", () => {
  it("delegates browse models to configured provider and normalizes request/result", async () => {
    const browseModels = testDouble.fn<ModelBrowsePort["browseModels"]>(async (request) => ({
      models: [{
        provider: "huggingface",
        modelId: " openai/demo-model ",
        displayName: " Demo Model ",
        inferenceMode: "causal",
      }],
      nextCursor: " page-2 ",
    }));

    const useCase = new BrowseModelsUseCase({
      providers: {
        huggingface: { browseModels },
      },
    });

    const result = await useCase.execute({
      provider: "huggingface",
      query: " demo ",
      limit: 1000,
    });

    expect(browseModels).toHaveBeenCalledWith({
      provider: "huggingface",
      query: "demo",
      taskTags: undefined,
      authorOrOrg: undefined,
      limit: 100,
      cursor: undefined,
      sort: undefined,
      direction: undefined,
    });
    expect(result.models[0]?.modelId).toBe("openai/demo-model");
    expect(result.nextCursor).toBe("page-2");
  });

  it("delegates get details to configured provider and normalizes result", async () => {
    const getModelDetails = testDouble.fn<ModelDetailsPort["getModelDetails"]>(async () => ({
      model: {
        provider: "huggingface",
        modelId: " openai/demo-model ",
        displayName: " Demo Model ",
        files: [{ path: " model.safetensors " }],
      },
    }));

    const useCase = new GetModelDetailsUseCase({
      providers: {
        huggingface: { getModelDetails },
      },
    });

    const result = await useCase.execute({ provider: "huggingface", modelId: " openai/demo-model " });

    expect(getModelDetails).toHaveBeenCalledWith({ provider: "huggingface", modelId: "openai/demo-model" });
    expect(result.model.modelId).toBe("openai/demo-model");
    expect(result.model.files).toEqual([{ path: "model.safetensors", sizeBytes: undefined, blobId: undefined, lfs: undefined }]);
  });

  it("fails clearly when provider is unsupported", async () => {
    const useCase = new BrowseModelsUseCase({ providers: {} });

    await expect(useCase.execute({ provider: "huggingface", query: "demo" })).rejects.toThrow(
      'Model browse provider "huggingface" is not supported by this use case.',
    );
  });
});

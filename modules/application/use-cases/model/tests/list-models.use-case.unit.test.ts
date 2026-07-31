import { describe, expect, it, vi } from "../../../../testing/node-test";

import { ListModelsUseCase } from "../list-models.use-case";

describe("ListModelsUseCase", () => {
  it("classifies registry failures without disclosing the underlying message", async () => {
    const useCase = new ListModelsUseCase({
      modelRegistry: {
        listModels: vi.fn(async () => {
          throw new Error("private path C:\\models\\registry.json");
        }),
      } as never,
    });

    let failure: unknown;
    try {
      await useCase.execute({ workspaceId: "workspace-a" as never });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "ListModelsExecutionStageError",
      code: "MODEL_LIST_REGISTRY_FAILED",
      message: "The model list operation failed at a bounded execution stage.",
    });
  });
});

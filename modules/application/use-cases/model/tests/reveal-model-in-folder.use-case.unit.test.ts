import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { RevealModelInFolderUseCase } from "../reveal-model-in-folder.use-case";

describe("RevealModelInFolderUseCase", () => {
  it("resolves a workspace-owned model and reveals its stored location without returning it", async () => {
    const getModelRecord = testDouble.fn(async () => ({
      modelRecordId: "model-1",
      displayName: "Local model",
      source: "local" as const,
      lifecycleStatus: "downloaded" as const,
      artifactForm: "full-model" as const,
      provider: "huggingface" as const,
      localPath: "C:\\models\\model-1",
      createdAt: "2026-07-31T00:00:00.000Z",
    }));
    const revealPath = testDouble.fn(async () => undefined);
    const useCase = new RevealModelInFolderUseCase({
      modelRegistry: { getModelRecord },
      modelLocationRevealer: { revealPath },
    });

    const result = await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "model-1",
    });

    expect(getModelRecord).toHaveBeenCalledWith("workspace-a", "model-1");
    expect(revealPath).toHaveBeenCalledWith("C:\\models\\model-1");
    expect(result).toEqual({ modelRecordId: "model-1", revealed: true });
    expect(JSON.stringify(result)).not.toContain("C:\\models");
  });

  it("fails closed when the record has no local location", async () => {
    const revealPath = testDouble.fn(async () => undefined);
    const useCase = new RevealModelInFolderUseCase({
      modelRegistry: { getModelRecord: testDouble.fn(async () => undefined) },
      modelLocationRevealer: { revealPath },
    });

    let failure: unknown;
    try {
      await useCase.execute({
        workspaceId: "workspace-a" as never,
        modelRecordId: "missing",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "not-found" });
    expect(revealPath).not.toHaveBeenCalled();
  });

  it("sanitizes host reveal failures", async () => {
    const useCase = new RevealModelInFolderUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn(async () => ({
          modelRecordId: "model-1",
          displayName: "Local model",
          source: "local" as const,
          lifecycleStatus: "downloaded" as const,
          artifactForm: "full-model" as const,
          provider: "huggingface" as const,
          localPath: "C:\\private\\model-1",
          createdAt: "2026-07-31T00:00:00.000Z",
        })),
      },
      modelLocationRevealer: {
        revealPath: testDouble.fn(async () => {
          throw new Error("shell failed at C:\\private\\model-1");
        }),
      },
    });

    let failure: unknown;
    try {
      await useCase.execute({
        workspaceId: "workspace-a" as never,
        modelRecordId: "model-1",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "unavailable",
      message: "The model folder could not be opened.",
    });
  });
});

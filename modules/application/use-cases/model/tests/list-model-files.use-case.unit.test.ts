import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ListModelFilesError, ListModelFilesUseCase } from "../list-model-files.use-case";

describe("ListModelFilesUseCase", () => {
  it("lists path-free file descriptors for a workspace-owned local model", async () => {
    const listFiles = testDouble.fn(async () => ({
      files: [{ relativePath: "config.json", sizeBytes: 42 }],
      truncated: false,
    }));
    const useCase = new ListModelFilesUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn(async () => ({
          modelRecordId: "model-1",
          displayName: "Model 1",
          source: "huggingface",
          lifecycleStatus: "downloaded",
          artifactForm: "full-model",
          provider: "huggingface",
          localPath: "C:\\models\\model-1",
          createdAt: "2026-07-31T00:00:00.000Z",
        })),
      },
      modelFileLister: { listFiles },
    });

    const result = await useCase.execute({
      workspaceId: createWorkspaceId("workspace-1"),
      modelRecordId: "model-1",
    });

    expect(listFiles).toHaveBeenCalledWith("C:\\models\\model-1");
    expect(result).toEqual({
      modelRecordId: "model-1",
      files: [{ relativePath: "config.json", sizeBytes: 42 }],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("C:\\models");
  });

  it("fails closed when the record has no local model path", async () => {
    const useCase = new ListModelFilesUseCase({
      modelRegistry: { getModelRecord: testDouble.fn(async () => undefined) },
      modelFileLister: { listFiles: testDouble.fn() },
    });

    let failure: unknown;
    try {
      await useCase.execute({
        workspaceId: createWorkspaceId("workspace-1"),
        modelRecordId: "model-1",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure instanceof ListModelFilesError).toBe(true);
  });
});

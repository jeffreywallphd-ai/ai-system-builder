import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { ImportHuggingFaceFilesUseCase } from "../import-huggingface-files.use-case";

describe("ImportHuggingFaceFilesUseCase", () => {
  it("lists selected repositories and registers each discovered file", async () => {
    const browseFiles = {
      execute: testDouble.fn(async () => ({
        ok: true,
        value: {
          repository: "openai/demo",
          revision: "main",
          files: [
            { repository: "openai/demo", revision: "main", path: "data/train.parquet" },
            { repository: "openai/demo", revision: "main", path: "images/cat.png" },
          ],
        },
      })),
    };
    const registerArtifact = {
      execute: testDouble.fn(async (command: { target: { path: string } }) => command.target.path.endsWith(".png")
        ? {
          ok: false,
          error: { code: "not-found", message: "Remote artifact was not found." },
        }
        : {
          ok: true,
          value: {
            artifactId: "artifacts/20260418000000-import001",
            backing: {
              role: "imported-source",
              target: {
                provider: "huggingface",
                repository: "openai/demo",
                path: command.target.path,
                revision: "main",
                locator: `openai/demo/${command.target.path}`,
              },
              verification: { exists: true, verifiedAt: "2026-04-18T00:00:00.000Z" },
            },
          },
        }),
    };
    const logging = { log: testDouble.fn(async () => undefined) };
    const useCase = new ImportHuggingFaceFilesUseCase({
      browseFiles,
      registerArtifact,
      logging,
      now: () => "2026-04-18T00:00:00.000Z",
    });

    const result = await useCase.execute({
      repositories: [{ repository: "openai/demo", revision: "main" }],
    }, { requestId: "request-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected import to succeed with partial file results.");
    }
    expect(browseFiles.execute).toHaveBeenCalledWith(
      { repository: "openai/demo", revision: "main" },
      { requestId: "request-1" },
    );
    expect(registerArtifact.execute).toHaveBeenCalledTimes(2);
    expect(result.value.summary).toEqual({ attempted: 2, succeeded: 1, failed: 1 });
    expect(result.value.repositories[0]?.status).toBe("partial");
    expect(result.value.repositories[0]?.files[0]?.artifactId).toBe("artifacts/20260418000000-import001");
    expect(result.value.repositories[0]?.files[1]?.status).toBe("failed");
  });
});

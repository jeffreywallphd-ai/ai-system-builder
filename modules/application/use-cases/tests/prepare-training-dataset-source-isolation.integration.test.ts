import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../adapters/storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter";
import { createRetrieveArtifactRequest } from "../../../contracts/storage";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../prepare-training-dataset-from-artifacts.use-case";

test("same logical remote source id in two workspaces localizes into distinct immutable objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "ds-"));
  const staged: string[] = [];
  try {
    const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: root });
    const bindings: any[] = [];
    const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
      storage,
      storageBindings: {
        async readArtifactStorageBindings(request: any) { return { ok: true, value: { bindings: [{ workspaceId: request.workspaceId,
          artifactId: "same-source", role: "imported-source", backing: { kind: "artifact-repo", provider: "huggingface", locator: "owner/source", target: { provider: "huggingface", repository: "owner/source", path: "source.md", revision: "fixed" } } }] } }; },
        async upsertArtifactStorageBinding(request: any) { bindings.push(request.binding); return { ok: true, value: request }; },
        async deleteArtifactStorageBindings() { return { ok: true, value: { deleted: true } }; },
      } as any,
      artifactRepoStorage: { async retrieveArtifactFromRepo(_request: any, context: any) {
        return { ok: true, value: { descriptor: { mediaType: "text/markdown" }, content: Buffer.from(context.workspaceId) } };
      } } as any,
      runtimeTaskRegistry: { async startTask(request: any) { staged.push(request.payload.runtime.runtimeWorkingDirectory); return { requestId: `task-${staged.length}`, accepted: true, status: "queued" }; } } as any,
      taskPowerLifecycle: { async startTask() {}, async completeTask() {} },
    });
    const command = { sourceArtifactIds: ["same-source"], recipe: { normalization: { targetFormat: "markdown" },
      chunking: { strategy: "character", chunkSize: 16, chunkOverlap: 0 }, generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic" } } },
      split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" } } as any;
    for (const workspaceId of ["workspace-a", "workspace-b"]) {
      const result = await useCase.startPrepareTrainingDataset(command, { workspaceId });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(bindings.length, 2);
    assert.notEqual(bindings[0].backing.locator, bindings[1].backing.locator);
    for (const binding of bindings) {
      const result = await storage.retrieveArtifact(createRetrieveArtifactRequest(binding.backing.locator), { workspaceId: binding.workspaceId });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(Buffer.from(result.value.content as Uint8Array).toString(), binding.workspaceId);
    }
  } finally {
    for (const directory of staged) { assert.ok(directory.startsWith(join(tmpdir(), "ai-system-builder-runtime-"))); await rm(directory, { recursive: true, force: true }); }
    await rm(root, { recursive: true, force: true });
  }
});

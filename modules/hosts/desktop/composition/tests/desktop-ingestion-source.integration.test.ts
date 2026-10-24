import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createFilesystemArtifactObjectStorageAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../adapters/storage/filesystem";
import { PrepareTrainingDatasetFromArtifactsUseCase } from "../../../../application/use-cases/prepare-training-dataset-from-artifacts.use-case";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createRetrieveArtifactRequest } from "../../../../contracts/storage";
import { composeDesktopIngestionFeature } from "../composeDesktopIngestionFeature";

test("composed desktop Add data produces a primary source that Dataset Preparation can stage", async () => {
  const temporaryParent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temporaryParent, "desktop-owned-source-"));
  const allocatedRoot = await realpath(root);
  const staged: string[] = [];
  const organizationId = createOrganizationId("organization-a");
  const workspaceId = createWorkspaceId("workspace-a");
  const now = "2026-10-22T11:00:00.000Z";
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: root });
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: root, documents });
  const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: root, documents });
  const context = { workspaceId, organizationId, principalId: "principal-a" };
  const feature = composeDesktopIngestionFeature({ storageRootDirectory: root, artifacts: { storage }, documents,
    remoteArtifacts: { registerArtifactFromRepoUseCase: { execute: async () => { throw new Error("Unexpected provider I/O"); } } },
    organizationContextProvider: { getCurrentOrganizationContext: () => ({ organizationId, principalId: "principal-a" }) },
    workspaceRepository: { readWorkspace: async () => ({ workspaceId, organizationId, displayName: "A", status: "active", createdAt: now, updatedAt: now }) }, now: () => now });
  try {
    const bytes = Buffer.from("# Synthetic source\nSolar panels convert light into electrical energy.\n");
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const created = await feature.ingestionTasks.executeCommand({ action: "create-files", files: [{ fileName: "energy.md", mediaType: "text/markdown", sizeBytes: bytes.length }] }, context);
    assert.ok(created.ok && created.value.kind === "task");
    const task = created.value.task;
    const file = task.files[0]!;
    const appended = await feature.ingestionTasks.executeCommand({ action: "append-chunk", taskId: task.taskId, fileId: file.fileId,
      chunkIndex: 0, expectedOffset: 0, bytes, sha256 }, context);
    assert.equal(appended.ok, true);
    const finalized = await feature.ingestionTasks.executeCommand({ action: "finalize-file", taskId: task.taskId, fileId: file.fileId, sha256 }, context);
    assert.ok(finalized.ok && finalized.value.kind === "task");
    assert.equal(finalized.value.task.status, "succeeded");
    const output = finalized.value.task.files[0]!.output!;
    assert.match(output.key, /^workspaces\/workspace-a\/artifacts\/files\/ingestion\/[a-f0-9]{32}$/);
    const origin = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: output.key }, context);
    assert.ok(origin.ok);
    assert.deepEqual(origin.value.bindings.map(b => ({ role: b.role, backing: b.backing })), [{ role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: output.key, revision: undefined } }]);
    assert.equal((await storage.retrieveArtifact(createRetrieveArtifactRequest(output.key), context)).ok, true);
    assert.deepEqual(await readFile(path.join(root, output.key)), bytes);
    await assert.rejects(readFile(path.join(root, "organizations", organizationId, output.key)), { code: "ENOENT" });
    const preparation = new PrepareTrainingDatasetFromArtifactsUseCase({ storage, storageBindings: bindings, artifactCatalog: catalog,
      artifactRepoStorage: { retrieveArtifactFromRepo: async () => { throw new Error("Unexpected localization"); } } as never,
      runtimeTaskRegistry: { async startTask(request: any) {
        const runtime = request.payload;
        const directory = await realpath(runtime.runtime.runtimeWorkingDirectory);
        assert.equal(path.dirname(directory), temporaryParent);
        assert.ok(path.basename(directory).startsWith("ai-system-builder-runtime-"));
        staged.push(directory);
        assert.equal(runtime.sourceInputs.length, 1);
        assert.equal(runtime.sourceInputs[0].artifactId, output.key);
        assert.deepEqual(await readFile(runtime.sourceInputs[0].localPath), bytes);
        return { requestId: "synthetic-preparation", accepted: true, status: "queued" };
      } } as never,
      taskPowerLifecycle: { async startTask() {}, async completeTask() {} },
    });
    const result = await preparation.startPrepareTrainingDataset({ sourceArtifactIds: [output.key], recipe: {
      normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 128, chunkOverlap: 0 },
      generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic-fixture" } } },
      split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" } } as never, context);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(staged.length, 1);
    assert.doesNotMatch(JSON.stringify(finalized), /desktop-owned-source|[A-Z]:\\/);
    const foreign = await preparation.startPrepareTrainingDataset({ sourceArtifactIds: [output.key], recipe: {
      normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 128, chunkOverlap: 0 },
      generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic-fixture" } } },
      split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" } } as never, { ...context, workspaceId: "workspace-b" });
    assert.equal(foreign.ok, false);
    assert.equal(staged.length, 1);
  } finally {
    feature.dispose();
    for (const directory of staged) {
      assert.equal(await realpath(directory), directory);
      assert.equal(path.dirname(directory), temporaryParent);
      assert.ok(path.basename(directory).startsWith("ai-system-builder-runtime-"));
      await rm(directory, { recursive: true, force: true });
    }
    const cleanupRoot = await realpath(root);
    assert.equal(cleanupRoot, allocatedRoot);
    assert.equal(path.dirname(cleanupRoot), temporaryParent);
    assert.ok(path.basename(cleanupRoot).startsWith("desktop-owned-source-"));
    await rm(cleanupRoot, { recursive: true, force: true });
  }
});

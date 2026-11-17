import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createExpressOrganizationContextScope } from "../../../../transport/api-express/security";
import { createInMemoryStructuredDocumentStore, createOrganizationContextStructuredDocumentStore } from "../../../../persistence/shared";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../artifact-catalog";
import { PrepareTrainingDatasetFromArtifactsUseCase, type PrepareTrainingDatasetFromArtifactsCommand } from "../../../../../application/use-cases/prepare-training-dataset-from-artifacts.use-case";
import { createOrganizationId } from "../../../../../contracts/organization";
import type { PrepareTrainingDatasetRequest, StartRuntimeTaskRequest } from "../../../../../contracts/runtime";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import {
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
} from "../../../../../contracts/storage";
import { createFilesystemArtifactObjectStorageAdapter } from "..";

test("filesystem object storage keeps one logical key in separate organization prefixes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "organization-object-storage-"));
  const contexts = createExpressOrganizationContextScope();
  const storage = createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: root,
    organizationContextProvider: contexts,
  });
  const orgA = createOrganizationId("org-a");
  const orgB = createOrganizationId("org-b");
  const key = "workspaces/workspace-a/artifacts/files/shared.txt";
  try {
    const missingContext = await storage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([0]), { descriptor: { key } }),
    );
    assert.equal(missingContext.ok, false);
    await contexts.runWithOrganizationContext(
      { organizationId: orgA, principalId: "principal-a" },
      async () => {
        const result = await storage.storeArtifact(
          createStoreArtifactRequest(new Uint8Array([65]), { descriptor: { key } }),
        );
        assert.equal(result.ok, true);
      },
    );
    await contexts.runWithOrganizationContext(
      { organizationId: orgB, principalId: "principal-b" },
      async () => {
        const missing = await storage.retrieveArtifact(createRetrieveArtifactRequest(key));
        assert.equal(missing.ok, false);
        await storage.storeArtifact(
          createStoreArtifactRequest(new Uint8Array([66]), { descriptor: { key } }),
        );
      },
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(root, "organizations", orgA, key))),
      new Uint8Array([65]),
    );
    assert.deepEqual(
      new Uint8Array(await readFile(path.join(root, "organizations", orgB, key))),
      new Uint8Array([66]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dataset staging keeps identical workspace and source IDs separate across organizations", { timeout: 20_000 }, async (t) => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, "dataset-organization-source-"));
  const owner = await lstat(root);
  const staging = path.join(root, "staging");
  const contexts = createExpressOrganizationContextScope();
  const documents = createOrganizationContextStructuredDocumentStore(createInMemoryStructuredDocumentStore(), contexts);
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: root, documents });
  const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: root, documents });
  const storage = createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: root, organizationContextProvider: contexts, artifactBindingWrite: bindings, artifactCatalogAppend: catalog,
  });
  const workspaceId = createWorkspaceId("workspace-a");
  const first = { organizationId: createOrganizationId("org-a"), principalId: "principal-a", workspaceId };
  const second = { organizationId: createOrganizationId("org-b"), principalId: "principal-b", workspaceId };
  const sharedId = "shared-source";
  const firstOnlyId = "first-organization-source";
  const sharedKey = `workspaces/${workspaceId}/artifacts/files/same.md`;
  const expected = new Map([[first.organizationId, "Synthetic first source."], [second.organizationId, "Synthetic second source."]]);
  const stages = new Set<string>();
  const staged = new Map<string, string>();
  const storageReads = t.mock.method(storage, "retrieveArtifact");
  const unexpectedEffect = t.mock.fn(async () => { throw new Error("Unexpected external effect"); });
  const startTask = t.mock.fn(async (request: StartRuntimeTaskRequest) => {
    const payload = request.payload as PrepareTrainingDatasetRequest;
    const directory = payload.runtime?.runtimeWorkingDirectory;
    assert.ok(directory);
    assert.equal(path.dirname(directory), staging);
    assert.ok(path.basename(directory).startsWith("ai-system-builder-runtime-"));
    assert.equal(await realpath(directory), directory);
    stages.add(directory);
    const organization = contexts.getCurrentOrganizationContext()?.organizationId;
    assert.ok(organization);
    assert.equal(request.metadata?.organizationId, organization);
    assert.equal(payload.workspaceId, workspaceId);
    assert.equal(payload.sourceInputs.length, 1);
    const input = payload.sourceInputs[0]!;
    assert.equal(path.dirname(input.localPath), directory);
    assert.equal(await realpath(input.localPath), input.localPath);
    staged.set(organization, await readFile(input.localPath, "utf8"));
    return { requestId: `dataset-${organization}`, status: "queued" as const };
  });
  const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
    storage, storageBindings: bindings, artifactCatalog: catalog,
    artifactRepoStorage: { retrieveArtifactFromRepo: unexpectedEffect, storeArtifactInRepo: unexpectedEffect, hasArtifactInRepo: unexpectedEffect },
    runtimeTaskRegistry: { startTask, getTaskStatus: unexpectedEffect, cancelTask: unexpectedEffect, listTasks: unexpectedEffect },
    taskPowerLifecycle: { async startTask() {}, async completeTask() {} },
  });
  function start(sourceArtifactId: string, organization: typeof first) {
    const command: PrepareTrainingDatasetFromArtifactsCommand = {
      sourceArtifactIds: [sourceArtifactId],
      recipe: { normalization: { targetFormat: "markdown" }, chunking: { strategy: "character", chunkSize: 16, chunkOverlap: 0 },
        generation: { mode: "qa", model: { provider: "transformers", modelId: "synthetic" } } },
      split: { trainRatio: 0.8, testRatio: 0.2 }, output: { format: "jsonl" },
    };
    return contexts.runWithOrganizationContext(organization, () => useCase.startPrepareTrainingDataset(command, organization));
  }
  async function seed(organization: typeof first, artifactId: string, key: string, content: string) {
    await contexts.runWithOrganizationContext(organization, async () => {
      const result = await storage.storeArtifact(createStoreArtifactRequest(Buffer.from(content), {
        descriptor: { key, mediaType: "text/markdown", metadata: { originalName: "source.md" } }, overwrite: false,
      }), organization);
      assert.ok(result.ok);
      assert.equal(result.value.key, key);
      const binding = await bindings.upsertArtifactStorageBinding({ binding: { artifactId, workspaceId, role: "primary",
        backing: { kind: "artifact-object", provider: "local-filesystem", locator: key } } }, organization);
      assert.ok(binding.ok);
    });
  }
  // Node's per-file test process isolates these temporary environment settings.
  const originalTemp = new Map(["TMPDIR", "TMP", "TEMP"].map(name => [name, process.env[name]]));
  try {
    await mkdir(staging);
    await seed(first, sharedId, sharedKey, expected.get(first.organizationId)!);
    await seed(second, sharedId, sharedKey, expected.get(second.organizationId)!);
    await seed(first, firstOnlyId, `workspaces/${workspaceId}/artifacts/files/first.md`, "Synthetic private source.");
    for (const name of originalTemp.keys()) process.env[name] = staging;
    const denied = await start(firstOnlyId, second);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, "not-found");
    assert.equal(storageReads.mock.callCount(), 0);
    assert.equal(startTask.mock.callCount(), 0);
    assert.equal(unexpectedEffect.mock.callCount(), 0);
    assert.deepEqual(await readdir(staging), []);
    const [firstStart, secondStart] = await Promise.allSettled([start(sharedId, first), start(sharedId, second)]);
    assert.equal(firstStart.status, "fulfilled");
    assert.equal(secondStart.status, "fulfilled");
    const resultA = firstStart.value;
    const resultB = secondStart.value;
    assert.ok(resultA.ok && resultB.ok);
    assert.notEqual(resultA.value.requestId, resultB.value.requestId);
    assert.equal(stages.size, 2);
    assert.deepEqual(staged, expected);
    assert.equal(storageReads.mock.callCount(), 2);
    assert.equal(startTask.mock.callCount(), 2);
    assert.equal(unexpectedEffect.mock.callCount(), 0);
  } finally {
    for (const [name, value] of originalTemp) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const current = await lstat(root);
    assert.ok(current.isDirectory() && !current.isSymbolicLink());
    assert.equal(current.dev, owner.dev);
    assert.equal(current.ino, owner.ino);
    assert.equal(await realpath(root), root);
    await rm(root, { recursive: true, force: true });
  }
});

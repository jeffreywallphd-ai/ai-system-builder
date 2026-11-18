import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve, isAbsolute } from "node:path";
import {tmpdir} from "node:os";
import {ContextBrowserUseCases} from "../../../../../application/use-cases/context-management/context-browser.use-cases";
import {createOrganizationId} from "../../../../../contracts/organization";
import {createRetrieveArtifactRequest} from "../../../../../contracts/storage";
import {createFilesystemArtifactObjectStorageAdapter} from "../../../../storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter";
import {createFilesystemContextResultByteStorageAdapter} from "../../../../storage/filesystem/artifact-store/createFilesystemContextResultByteStorageAdapter";
import {createLocalArtifactCatalogPersistenceAdapter} from "../../../../storage/filesystem/artifact-catalog/createLocalArtifactCatalogAdapter";
import {createLocalArtifactStorageBindingAdapter} from "../../../../storage/filesystem/artifact-catalog/createLocalArtifactStorageBindingAdapter";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../persistence/sqlite";
import { OwnedTaskReconcilerService } from "../../../../../application/services/runtime/owned-task-reconciler.service";

import {
  CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
} from "../../../../../contracts/context-management";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { TaskType } from "../../../../../contracts/runtime";
import { createPythonContextArtifactRuntimeAdapter } from "../createPythonContextArtifactRuntimeAdapter";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../../pythonRuntimeTaskTimeoutPolicy";

function digest(content: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function registryFor(result: Record<string, unknown>) {
  let request: any;
  const registry: any = {
    startTask: testDouble.fn(async (value: any) => {
      request = value;
      return { requestId: value.requestId, status: "queued" };
    }),
    getTaskStatus: testDouble.fn(async () => ({
      requestId: request.requestId,
      taskType: TaskType.CONTEXT_RETRIEVAL,
      workspaceId: request.workspaceId,
      status: "succeeded",
      concurrencyClass: "cpu-heavy",
      data: result,
    })),
    cancelTask: testDouble.fn(),
    listTasks: testDouble.fn(),
  };
  return { registry, request: () => request };
}

describe("createPythonContextArtifactRuntimeAdapter", () => {
  it("stages exact bytes and maps a checked source inspection through the retrieval task family", async () => {
    const content = new TextEncoder().encode("source text");
    const test = registryFor({
      operation: "inspect-source",
      inspection: {
        artifactId: "artifact.source",
        digest: digest(content),
        mediaType: "text/plain",
        originalName: "source.txt",
        sizeBytes: content.byteLength,
        ready: false,
        sourceKind: "document",
        format: "text",
        textFields: [],
        alreadyChunked: false,
        chunkCount: 1,
        checks: {
          status: "blocked",
          checkedChunkCount: 1,
          issueCounts: {
            exactDuplicate: 0,
            fuzzyDuplicate: 0,
            textTooShort: 1,
            textTooLong: 0,
            languageNotAllowed: 0,
            languageUncertain: 0,
            sensitivePersonalData: 0,
            secretLikeContent: 0,
            licenseMetadataMissing: 0,
            consentMetadataMissing: 0,
          },
          checkedSurfaces: ["text length and language"],
          limitations: ["Automated checks remain bounded."],
        },
      },
    });
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry, new OwnedTaskReconcilerService());
    const result = await adapter.inspectSource({
      workspaceId: createWorkspaceId("workspace.context"),
      artifactId: "artifact.source",
      content,
      mediaType: "text/plain",
      originalName: "source.txt",
      digest: digest(content),
      chunking: {
        strategy: "fixed-length",
        chunkCharacters: 256,
        overlapCharacters: 0,
      },
    });
    expect(result.alreadyChunked).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.checks?.status).toBe("blocked");
    expect(test.request()).toMatchObject({
      taskType: TaskType.CONTEXT_RETRIEVAL,
      payload: {
        operation: "inspect-source",
        artifactId: "artifact.source",
        digest: digest(content),
      },
    });
  });

  it("validates bounded artifact detail and retrieval matches", async () => {
    const content = new TextEncoder().encode("sqlite bytes");
    const manifest = {
      schemaVersion: "1",
      kind: "rag-database",
      name: "Release",
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
      createdAt: "2026-08-01T00:00:00.000Z",
      sources: [
        {
          artifactId: "artifact.source",
          digest: "sha256:" + "1".repeat(64),
          mediaType: "text/plain",
          sizeBytes: 10,
          chunkCount: 1,
          chunkingMode: "extracted",
        },
      ],
      manualEntries: [],
      chunking: {
        strategy: "fixed-length",
        chunkCharacters: 256,
        overlapCharacters: 0,
      },
      embedding: {
        provider: "transformers",
        modelId: "local/test-model",
        dimensions: 2,
      },
    };
    const detailRegistry = registryFor({
      operation: "inspect-artifact",
      inspection: {
        manifest,
        chunkCount: 1,
        packageEntries: [],
        topics: [],
      },
    });
    const detailAdapter = createPythonContextArtifactRuntimeAdapter(
      detailRegistry.registry,
      new OwnedTaskReconcilerService(),
    );
    const detail = await detailAdapter.inspectArtifact({
      workspaceId: createWorkspaceId("workspace.context"),
      artifactId: "artifact.rag",
      content,
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
      digest: digest(content),
    });
    expect(detail.manifest.name).toBe("Release");

    const queryRegistry = registryFor({
      operation: "query",
      matches: [
        {
          id: "chunk-0",
          excerpt: "bounded excerpt",
          score: 0.8,
          citation: {
            sourceArtifactId: "artifact.source",
            sourceDigest: "sha256:" + "1".repeat(64),
            chunkIndex: 0,
          },
        },
      ],
    });
    const queryAdapter = createPythonContextArtifactRuntimeAdapter(
      queryRegistry.registry,
      new OwnedTaskReconcilerService(),
    );
    const matches = await queryAdapter.query({
      workspaceId: createWorkspaceId("workspace.context"),
      artifactId: "artifact.rag",
      content,
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
      digest: digest(content),
      query: "release",
      maximumResults: 3,
      embeddingDevice: "cuda",
    });
    expect(matches[0]).toMatchObject({
      score: 0.8,
      citation: { chunkIndex: 0 },
    });
    expect(queryRegistry.registry.startTask).toHaveBeenCalledWith(expect.objectContaining({payload: expect.objectContaining({embeddingDevice: "cuda"})}));
  });

  it("rejects substituted bytes before starting a runtime task", async () => {
    const content = new TextEncoder().encode("sqlite bytes");
    const test = registryFor({});
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry, new OwnedTaskReconcilerService());
    await expect(
      adapter.inspectArtifact({
        workspaceId: createWorkspaceId("workspace.context"),
        artifactId: "artifact.rag",
        content,
        mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
        digest: "sha256:" + "0".repeat(64),
      }),
    ).rejects.toThrow("do not match");
    expect(test.registry.startTask).toHaveBeenCalledTimes(0);
  });

  it("rejects a no-summary pack manifest that claims a model", async () => {
    const content = new TextEncoder().encode("context pack bytes");
    const manifest = {
      schemaVersion: "1",
      kind: "markdown-context-pack",
      name: "Release pack",
      mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
      createdAt: "2026-08-01T00:00:00.000Z",
      sources: [
        {
          artifactId: "artifact.source",
          digest: "sha256:" + "1".repeat(64),
          mediaType: "text/plain",
          sizeBytes: 10,
          chunkCount: 1,
          chunkingMode: "extracted",
        },
      ],
      manualEntries: [],
      chunking: {
        strategy: "topic-aware",
        chunkCharacters: 1200,
        overlapCharacters: 0,
        maximumTokensPerChunk: 320,
        topicBoundarySensitivity: 0.22,
      },
      contextPack: {
        inputMode: "source-materials",
        method: "none",
        cleaningPreset: "standard",
        modelId: "local/unexpected-model",
      },
    };
    const test = registryFor({
      operation: "inspect-artifact",
      inspection: {
        manifest,
        chunkCount: 1,
        packageEntries: [
          "manifest.json",
          "README.md",
          "topics.md",
          "sources.md",
        ],
        topics: [],
      },
    });
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry, new OwnedTaskReconcilerService());

    await expect(
      adapter.inspectArtifact({
        workspaceId: createWorkspaceId("workspace.context"),
        artifactId: "artifact.pack",
        content,
        mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
        digest: digest(content),
      }),
    ).rejects.toThrow("model settings");
  });
});

function operationFixture() {
  const test = registryFor({ operation: "query", matches: [] });
  const owner = new OwnedTaskReconcilerService();
  owner.stopObservation();
  const content = new TextEncoder().encode("synthetic saved Context bytes");
  const input = {
    workspaceId: createWorkspaceId("workspace.context"), artifactId: "artifact.rag",
    content, digest: digest(content), mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
    query: "synthetic query", maximumResults: 3,
  };
  const adapter = createPythonContextArtifactRuntimeAdapter(test.registry, owner);
  const path = () => test.request().payload.localPath as string;
  return { ...test, owner, content, input, adapter, path };
}

describe("Context artifact operation ownership", () => {
  it("writes the private original bytes when the caller changes its view during staging", async () => {
    const test = operationFixture();
    const expected = new Uint8Array(test.content);
    const start = test.registry.startTask;
    test.registry.startTask = async (request: any) => {
      expect(new Uint8Array(await fs.readFile(request.payload.localPath))).toEqual(expected);
      expect(request.payload.sizeBytes).toBe(expected.byteLength);
      return start(request);
    };
    const operation = test.adapter.query(test.input);
    test.content.fill(0);
    await expect(operation).resolves.toEqual([]);
    expect(test.owner.status.pending).toBe(0);
    await expect(fs.access(test.path())).rejects.toThrow();
  });

  it("uses intrinsic byte length and copying rather than caller overrides", async () => {
    const test = operationFixture();
    const size = test.content.byteLength;
    Object.defineProperty(test.content, "byteLength", { value: 0 });
    Object.defineProperty(test.content, Symbol.iterator, { value: () => { throw new Error("Do not iterate caller bytes"); } });
    await expect(test.adapter.query(test.input)).resolves.toEqual([]);
    expect(test.request().payload.sizeBytes).toBe(size);
    expect(test.owner.status.pending).toBe(0);
  });

  it("does not allocate or dispatch after owner shutdown or capacity denial", async () => {
    const stopped = operationFixture();
    stopped.owner.stopAccepting();
    await expect(stopped.adapter.query(stopped.input)).rejects.toThrow("lifecycle is unavailable");
    expect(stopped.registry.startTask).toHaveBeenCalledTimes(0);
    const full = operationFixture();
    const leases = Array.from({ length: 256 }, () => full.owner.reserve());
    try {
      await expect(full.adapter.query(full.input)).rejects.toThrow("lifecycle is unavailable");
      expect(full.registry.startTask).toHaveBeenCalledTimes(0);
      expect(full.owner.status.pending).toBe(256);
    } finally { for (const lease of leases) lease.release(); }
  });

  it("rechecks shutdown after asynchronous staging and before dispatch", async () => {
    const test = operationFixture();
    const operation = test.adapter.query(test.input);
    test.owner.stopAccepting();
    await expect(operation).rejects.toThrow("could not be completed");
    expect(test.registry.startTask).toHaveBeenCalledTimes(0);
    expect(test.owner.status.pending).toBe(0);
  });

  for (const mode of ["lost", "wrong-id", "invalid-status"] as const) {
    it(`retains a ${mode} start without polling, cancelling or adopting an unacknowledged task`, async (t) => {
      const test = operationFixture();
      t.after(async () => { await test.owner.settleAfterRuntimeStop(["python"]); });
      const start = test.registry.startTask;
      test.registry.startTask = async (request: any) => {
        await start(request);
        if (mode === "lost") throw new Error("private runtime detail must not escape");
        return { requestId: mode === "wrong-id" ? "unrelated-task" : request.requestId, status: mode === "invalid-status" ? "succeeded" : "queued" };
      };
      await expect(test.adapter.query(test.input)).rejects.toThrow("Context artifact operation could not be completed.");
      expect(test.owner.status.pending).toBe(1);
      await fs.access(test.path());
      await test.owner.reconcileNow();
      await test.owner.cancelAndReconcile();
      await test.owner.settleAfterRuntimeStop(["image"]);
      expect(test.registry.getTaskStatus).toHaveBeenCalledTimes(0);
      expect(test.registry.cancelTask).toHaveBeenCalledTimes(0);
      await fs.access(test.path());
      await test.owner.settleAfterRuntimeStop(["python"]);
      expect(test.owner.status.pending).toBe(0);
      await expect(fs.access(test.path())).rejects.toThrow();
    });
  }

  for (const mode of ["lost", "wrong-id", "wrong-workspace", "missing-workspace", "wrong-type", "unknown", "malformed"] as const) {
    it(`retains an accepted operation after ${mode} status until exact terminal evidence`, async (t) => {
      const test = operationFixture();
      t.after(async () => { await test.owner.settleAfterRuntimeStop(["python"]); });
      const read = test.registry.getTaskStatus;
      test.registry.getTaskStatus = testDouble.fn(async () => {
        if (mode === "lost") throw new Error("private query and runtime path");
        if (mode === "malformed") return null;
        const status = await read();
        if (mode === "wrong-id") return { ...status, requestId: "other-task" };
        if (mode === "wrong-workspace") return { ...status, workspaceId: "workspace.other" };
        if (mode === "missing-workspace") return { ...status, workspaceId: undefined };
        if (mode === "wrong-type") return { ...status, taskType: TaskType.MODEL_DOWNLOAD };
        return { requestId: status.requestId, recordType: "not-found", status: "unknown" };
      });
      await expect(test.adapter.query(test.input)).rejects.toThrow("Context artifact operation could not be completed.");
      await test.owner.reconcileNow();
      expect(test.owner.status.pending).toBe(1);
      await fs.access(test.path());
      test.registry.getTaskStatus = read;
      await test.owner.reconcileNow();
      expect(test.owner.status.pending).toBe(0);
      await expect(fs.access(test.path())).rejects.toThrow();
    });
  }

  it("sanitizes a confirmed failed result and releases its finished inputs", async () => {
    const test = operationFixture();
    const read = test.registry.getTaskStatus;
    test.registry.getTaskStatus = async () => ({ ...await read(), status: "failed", error: { message: "private source and worker path" } });
    await assert.rejects(test.adapter.query(test.input), { message: "Context artifact operation could not be completed." });
    expect(test.owner.status.pending).toBe(0);
    await expect(fs.access(test.path())).rejects.toThrow();
  });

  it("retains a pre-dispatch cleanup failure without reading or cancelling a task", async (t) => {
    const test = operationFixture();
    const remove = fs.rm;
    let directory = "";
    let failures = 1;
    const writeMock = t.mock.method(fs, "writeFile", async (path: any) => {
      directory = dirname(String(path));
      throw new Error("private filesystem detail");
    });
    const removeMock = t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
      if (failures-- > 0) throw new Error("synthetic removal failure");
      return remove(...args);
    });
    syncBuiltinESMExports();
    t.after(async () => {
      writeMock.mock.restore(); removeMock.mock.restore(); syncBuiltinESMExports();
      await test.owner.settleAfterRuntimeStop(["python"]);
    });
    await assert.rejects(test.adapter.query(test.input), { message: "Context artifact operation could not be completed." });
    expect(test.owner.status.pending).toBe(1);
    await fs.access(directory);
    await test.owner.reconcileNow();
    expect(test.owner.status.pending).toBe(0);
    expect(test.registry.startTask).toHaveBeenCalledTimes(0);
    expect(test.registry.getTaskStatus).toHaveBeenCalledTimes(0);
    expect(test.registry.cancelTask).toHaveBeenCalledTimes(0);
    await expect(fs.access(directory)).rejects.toThrow();
  });

  for (const cancelMode of ["lost", "acknowledged"] as const) {
    it(`retains timed-out inputs after ${cancelMode} cancellation until actual worker stop`, async (t) => {
      const test = operationFixture();
      t.after(async () => { await test.owner.settleAfterRuntimeStop(["python"]); });
      t.mock.timers.enable({ apis: ["Date"], now: 0 });
      const read = test.registry.getTaskStatus;
      test.registry.getTaskStatus = async () => {
        t.mock.timers.setTime(PYTHON_RUNTIME_TASK_TIMEOUTS.contextRetrieval + 1);
        return { ...await read(), status: "running" };
      };
      test.registry.cancelTask = testDouble.fn(async (requestId: string) => {
        if (cancelMode === "lost") throw new Error("private cancellation failure");
        return { requestId, status: "cancelled", cancelled: true };
      });
      await expect(test.adapter.query(test.input)).rejects.toThrow("Context artifact operation timed out.");
      expect(test.registry.cancelTask).toHaveBeenCalledTimes(1);
      expect(test.owner.status.pending).toBe(1);
      await test.owner.reconcileNow();
      await fs.access(test.path());
      await test.owner.settleAfterRuntimeStop(["python"]);
      expect(test.owner.status.pending).toBe(0);
      await expect(fs.access(test.path())).rejects.toThrow();
    });
  }

  it("keeps a finished directory owned when removal fails and retries without redispatch", async (t) => {
    const test = operationFixture();
    const remove = fs.rm;
    let failures = 1;
    const mocked = t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
      if (failures-- > 0) throw new Error("synthetic cleanup failure");
      return remove(...args);
    });
    syncBuiltinESMExports();
    t.after(async () => {
      mocked.mock.restore(); syncBuiltinESMExports();
      await test.owner.settleAfterRuntimeStop(["python"]);
    });
    await expect(test.adapter.query(test.input)).resolves.toEqual([]);
    expect(mocked.mock.callCount()).toBe(1);
    expect(test.owner.status.pending).toBe(1);
    await fs.access(test.path());
    const polls = test.registry.getTaskStatus.mock.calls.length;
    await test.owner.reconcileNow();
    expect(test.owner.status.pending).toBe(0);
    expect(test.registry.startTask).toHaveBeenCalledTimes(1);
    expect(test.registry.getTaskStatus).toHaveBeenCalledTimes(polls);
    await expect(fs.access(dirname(test.path()))).rejects.toThrow();
  });
});

function admittedQueryFixture(t: {after: (fn: () => Promise<void>) => void}) {
  const input = {workspaceId: createWorkspaceId("workspace.query"), artifactId: "artifact.rag", content: new TextEncoder().encode("synthetic archive"),
    mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE, digest: "", query: "release policy", maximumResults: 3, embeddingDevice: "cpu" as const};
  input.digest = digest(input.content);
  const control = {current: true, issue: "issued" as "issued" | "denied" | "unconfirmed", accept: true,
    start: "accepted", ack: {} as Record<string, unknown>, status: {} as Record<string, unknown>, revokeAfterAccept: false,
    matches: [] as Record<string, unknown>[]};
  const events: string[] = [];
  let request: any;
  const registry: any = {
    startTask: testDouble.fn(async () => {assert.fail("Admitted querying must never use ordinary preparation.");}),
    startTaskWithoutInstalling: testDouble.fn(async (value: any) => {
      events.push("start"); request = value;
      assert.equal(digest(await fs.readFile(value.payload.localPath)), value.payload.digest, "Staged bytes must match the approved private snapshot.");
      if (control.start === "lost") throw new Error("private worker failure");
      if (control.start !== "accepted") return {kind: control.start};
      return {kind: "accepted", value: {requestId: value.requestId, status: "queued", ...control.ack}};
    }),
    getTaskStatus: testDouble.fn(async () => {
      events.push("status");
      return {requestId: request.requestId, workspaceId: request.workspaceId, taskType: TaskType.CONTEXT_RETRIEVAL,
        status: "succeeded", concurrencyClass: "cpu-heavy", data: {operation: "query", matches: control.matches}, ...control.status};
    }),
    cancelTask: testDouble.fn(), listTasks: testDouble.fn(),
  };
  const admission = {taskId: randomUUID(), workspaceId: input.workspaceId, artifactId: input.artifactId,
    artifactDigest: input.digest, queryDigest: digest(new TextEncoder().encode(input.query)), maximumResults: input.maximumResults,
    embeddingDevice: "cpu" as const, embeddingModel: {modelId: "synthetic/embedding", localModelReference: join(process.cwd(), ".local-codex", "synthetic-model")},
    isCurrent: () => control.current, stillAllowed: async () => control.current,
    issue: async () => {events.push("issue"); return control.issue;},
    accept: async (_id: string) => {events.push("accept"); if (control.revokeAfterAccept) control.current = false; return control.accept;}};
  const owner = new OwnedTaskReconcilerService(); owner.stopObservation();
  t.after(async () => {
    await owner.settleAfterRuntimeStop(["python"]);
    expect(registry.startTask).not.toHaveBeenCalled();
    expect(registry.listTasks).not.toHaveBeenCalled();
  });
  const adapter = createPythonContextArtifactRuntimeAdapter(registry, owner);
  return {input, admission, control, events, registry, owner, adapter, request: () => request};
}

describe("admitted installed-model Context queries", () => {
  it("queries bytes published by the real filesystem adapters without inventing optional descriptor MIME", async t => {
    const runtime = admittedQueryFixture(t), parent = resolve(process.env.TEMP ?? tmpdir()), prefix = join(parent, "context-owner-filesystem-");
    const root = await fs.mkdtemp(prefix);
    let database: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
    try {
      database = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: root})});
      const context = {organizationId: createOrganizationId("org.context-fixture"), principalId: "principal.synthetic", workspaceId: runtime.input.workspaceId};
      const provider = {getCurrentOrganizationContext: () => context};
      const bytes = createFilesystemContextResultByteStorageAdapter({rootDirectory: root, organizationContextProvider: provider});
      const storage = createFilesystemArtifactObjectStorageAdapter({rootDirectory: root, organizationContextProvider: provider});
      const documents = database.documents.forOrganization(context.organizationId);
      const catalog = createLocalArtifactCatalogPersistenceAdapter({rootDirectory: root, documents});
      const bindings = createLocalArtifactStorageBindingAdapter({rootDirectory: root, documents});
      const publicationId = randomUUID().replaceAll("-", ""), artifactId = `workspaces/${context.workspaceId}/artifacts/context/${publicationId}`;
      const published = await bytes.publishResult({publicationId, mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
        expectedSizeBytes: runtime.input.content.byteLength, expectedSha256: runtime.input.digest,
        content: (async function* () {yield runtime.input.content;})()}, context);
      assert.equal(published.ok, true);
      assert.equal((await catalog.createArtifactCatalogRecordIfAbsent({record: {workspaceId: context.workspaceId, storageKey: artifactId,
        artifactFamily: "binary", sourceKind: "generated", mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE, sizeBytes: runtime.input.content.byteLength,
        checksum: {algorithm: "sha256", value: runtime.input.digest.slice(7)}}}, context)).ok, true);
      assert.equal((await bindings.createArtifactStorageBindingIfAbsent({binding: {workspaceId: context.workspaceId, artifactId, role: "primary",
        backing: {kind: "artifact-object", provider: "local-filesystem", locator: artifactId}}}, context)).ok, true);
      const retrieved = await storage.retrieveArtifact(createRetrieveArtifactRequest(artifactId), context);
      assert.equal(retrieved.ok, true); if (!retrieved.ok) return;
      assert.equal(retrieved.value.descriptor.mediaType, undefined, "The real reader legitimately omits MIME.");
      const app = new ContextBrowserUseCases({catalog, storageBindings: bindings, storage, runtime: runtime.adapter,
        embeddingModels: {async resolveExistingModel() {return {localModelReference: runtime.admission.embeddingModel.localModelReference};}},
        isAcceptingQueries: () => {runtime.owner.assertAccepting(); return true;},
        generation: {async start() {throw new Error("Generation cannot run.");}}, deleteArtifact: {async execute() {throw new Error("Deletion cannot run.");}}});
      const proof = {taskId: runtime.admission.taskId, ...context, artifactId, artifactDigest: runtime.input.digest,
        artifactSizeBytes: runtime.input.content.byteLength, queryDigest: runtime.admission.queryDigest, maximumResults: 3, embeddingDevice: "cpu" as const,
        embeddingModel: {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", modelId: "synthetic/embedding", recordDigest: "sha256:" + "b".repeat(64)},
        sources: [{artifactId: "source/synthetic", digest: "sha256:" + "a".repeat(64)}], isCurrent: () => true, stillAllowed: async () => true,
        issue: async () => "issued" as const, accept: async (id: string) => id === runtime.admission.taskId};
      assert.deepEqual(await app.startAdmittedContextQuery({artifactId, query: runtime.input.query, maximumResults: 3, embeddingDevice: "cpu"}, context, proof),
        {kind: "accepted", taskId: proof.taskId});
      let result = await app.readAdmittedContextQueryTask(proof.taskId, context);
      for (let count = 0; result?.state === "running" && count < 100; count++) {
        await new Promise(resolve => setTimeout(resolve, 5)); result = await app.readAdmittedContextQueryTask(proof.taskId, context);
      }
      assert.deepEqual(result, {taskId: proof.taskId, state: "succeeded", matches: [], cleanupPending: false});
      expect(runtime.registry.startTask).not.toHaveBeenCalled();
    } finally {
      await database?.close();
      assert.ok(isAbsolute(root) && dirname(root) === parent && root.startsWith(prefix));
      await fs.rm(root, {recursive: true, force: true});
    }
  });

  it("notifies only the copied exact cleanup observer after terminal custody retires", async t => {
    const test = admittedQueryFixture(t), retired: string[] = [], taskId = test.admission.taskId;
    Object.assign(test.admission, {cleanupRetired: (id: string) => {retired.push(id); test.events.push("retired");}});
    let resume!: () => void, entered!: () => void, first = true;
    const gate = new Promise<void>(resolve => {resume = resolve;}), ready = new Promise<void>(resolve => {entered = resolve;});
    test.admission.stillAllowed = async () => {if (first) {first = false; entered(); await gate;} return true;};
    const running = test.adapter.queryAdmitted!(test.input, test.admission); await ready;
    Object.assign(test.admission, {cleanupRetired: () => {assert.fail("Replaced observer cannot see this attempt.");}});
    resume(); assert.deepEqual(await running, {kind: "succeeded", matches: [], cleanupPending: false});
    assert.deepEqual(retired, [taskId]); assert.deepEqual(test.events, ["issue", "start", "accept", "status", "retired"]);
    await test.owner.reconcileNow(); await test.owner.settleAfterRuntimeStop(["python"]);
    assert.deepEqual(retired, [taskId]);
  });

  it("uncertain issuance sends no cleanup proof until the existing owned stop retires custody", async t => {
    const test = admittedQueryFixture(t), retired: string[] = [];
    test.control.issue = "unconfirmed";
    Object.assign(test.admission, {cleanupRetired: (id: string) => {retired.push(id);}});
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: true});
    assert.deepEqual(retired, []); await test.owner.reconcileNow(); assert.deepEqual(retired, []);
    expect(test.registry.getTaskStatus).not.toHaveBeenCalled();
    await test.owner.settleAfterRuntimeStop(["python"]);
    assert.deepEqual(retired, [test.admission.taskId]);
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: false});
  });

  it("bad cleanup callbacks deny admission and observer exceptions cannot undo proven retirement", async t => {
    const invalid = admittedQueryFixture(t);
    Object.assign(invalid.admission, {cleanupRetired: "not executable"});
    assert.deepEqual(await invalid.adapter.queryAdmitted!(invalid.input, invalid.admission), {kind: "not-started"});
    expect(invalid.registry.startTaskWithoutInstalling).not.toHaveBeenCalled();
    const valid = admittedQueryFixture(t); let observed = 0;
    Object.assign(valid.admission, {cleanupRetired: () => {observed++; throw new Error("private observer exception");}});
    assert.deepEqual(await valid.adapter.queryAdmitted!(valid.input, valid.admission), {kind: "succeeded", matches: [], cleanupPending: false});
    assert.equal(observed, 1); assert.equal(valid.owner.status.pending, 0);
    const rejected = admittedQueryFixture(t);
    Object.assign(rejected.admission, {cleanupRetired: async () => {throw new Error("private rejected observer");}});
    assert.deepEqual(await rejected.adapter.queryAdmitted!(rejected.input, rejected.admission), {kind: "succeeded", matches: [], cleanupPending: false});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejected.owner.status.pending, 0);
  });

  it("uses a copied exact model/query/byte snapshot and acknowledges the owning task before observing results", async t => {
    const test = admittedQueryFixture(t), bytes = Uint8Array.from(test.input.content), taskId = test.admission.taskId;
    const model = test.admission.embeddingModel.localModelReference;
    let enter!: () => void, resume!: () => void, first = true;
    const entered = new Promise<void>(resolve => {enter = resolve;});
    test.admission.stillAllowed = async () => {if (first) {first = false; enter(); await new Promise<void>(resolve => {resume = resolve;});} return true;};
    const running = test.adapter.queryAdmitted!(test.input, test.admission); await entered;
    test.input.content.fill(0); test.input.query = "substituted"; test.input.maximumResults = 20;
    test.admission.taskId = randomUUID(); test.admission.embeddingModel.localModelReference = join(process.cwd(), "changed");
    test.admission.issue = async () => {assert.fail("A replaced callback cannot authorize this attempt.");};
    resume();
    assert.deepEqual(await running, {kind: "succeeded", matches: [], cleanupPending: false});
    const request = test.request();
    assert.equal(request.requestId, taskId); assert.equal(request.payload.query, "release policy");
    assert.equal(request.concurrencyClass, "cpu-heavy");
    assert.equal(request.payload.maximumResults, 3); assert.equal(request.payload.digest, digest(bytes));
    assert.deepEqual(request.payload.approvedEmbedding, {provider: "transformers", modelId: "synthetic/embedding",
      localModelReference: model, batchSize: 1, device: "cpu"});
    assert.deepEqual(test.events, ["issue", "start", "accept", "status"]);
    expect(test.registry.startTask).not.toHaveBeenCalled();
    await assert.rejects(fs.access(request.payload.localPath));
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: false});
    expect(test.registry.startTaskWithoutInstalling).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed scope, model, query, data and accessor descriptors before any issue or dispatch", async t => {
    let accessorReads = 0;
    for (const mutate of [
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.artifactDigest = "sha256:" + "f".repeat(64);},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.queryDigest = "sha256:" + "f".repeat(64);},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.maximumResults = 4;},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.artifactId = "artifact.foreign";},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.workspaceId = createWorkspaceId("workspace.foreign");},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.admission.embeddingModel.localModelReference = "relative/model";},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.input.content.fill(0);},
      (test: ReturnType<typeof admittedQueryFixture>) => {test.input.query = "\ud800";},
      (test: ReturnType<typeof admittedQueryFixture>) => {Object.defineProperty(test.input, "query", {enumerable: true, get() {accessorReads++; return "release policy";}});},
      (test: ReturnType<typeof admittedQueryFixture>) => {const issue = test.admission.issue; Object.defineProperty(test.admission, "issue", {enumerable: true, get() {accessorReads++; return issue;}});},
      (test: ReturnType<typeof admittedQueryFixture>) => {const model = test.admission.embeddingModel.localModelReference; Object.defineProperty(test.admission.embeddingModel, "localModelReference", {enumerable: true, get() {accessorReads++; return model;}});},
    ]) {
      const test = admittedQueryFixture(t); mutate(test);
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "not-started"});
      assert.deepEqual(test.events, []); assert.equal(test.owner.status.pending, 0);
      expect(test.registry.startTask).not.toHaveBeenCalled();
      assert.equal(accessorReads, 0);
    }
  });

  it("keeps an explicit CUDA query GPU-exclusive without selecting an automatic fallback", async t => {
    const test = admittedQueryFixture(t);
    Object.assign(test.input, {embeddingDevice: "cuda"}); Object.assign(test.admission, {embeddingDevice: "cuda"});
    assert.equal((await test.adapter.queryAdmitted!(test.input, test.admission)).kind, "succeeded");
    assert.equal(test.request().concurrencyClass, "gpu-exclusive");
    assert.equal(test.request().payload.approvedEmbedding.device, "cuda");
    expect(test.registry.startTask).not.toHaveBeenCalled();
  });

  it("missing installed-only support, pre-issue denial and post-issue revoke never fall back or dispatch", async t => {
    for (const scenario of ["unsupported", "denied", "revoked"]) {
      const test = admittedQueryFixture(t);
      if (scenario === "unsupported") delete test.registry.startTaskWithoutInstalling;
      if (scenario === "denied") test.control.issue = "denied";
      if (scenario === "revoked") test.admission.issue = async () => {test.control.current = false; return "issued";};
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "not-started"});
      assert.equal(test.request(), undefined); assert.equal(test.owner.status.pending, 0);
      expect(test.registry.startTask).not.toHaveBeenCalled();
    }
  });

  it("unknown issue stays retained without dispatch, status adoption or same-capability retry", async t => {
    for (const throws of [false, true]) {
      const test = admittedQueryFixture(t); test.control.issue = "unconfirmed";
      if (throws) test.admission.issue = async () => {throw new Error("private issue failure");};
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: true});
      assert.equal(test.owner.status.pending, 1); assert.equal(test.request(), undefined);
      await test.owner.reconcileNow(); expect(test.registry.getTaskStatus).not.toHaveBeenCalled();
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: true});
      await test.owner.settleAfterRuntimeStop(["python"]);
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: false});
    }
  });

  it("rechecks permission after directory allocation before writing any query input", async t => {
    const test = admittedQueryFixture(t), allocate = fs.mkdtemp;
    let hasDirectory = false;
    const allocated = t.mock.method(fs, "mkdtemp", async (...args: any[]) => {
      const directory = await Reflect.apply(allocate, fs, args); hasDirectory = true; return directory;
    });
    test.admission.stillAllowed = async () => {if (hasDirectory) {await Promise.resolve(); test.control.current = false;} return true;};
    const written = t.mock.method(fs, "writeFile", async () => {assert.fail("Revoked permission cannot write staged input.");});
    syncBuiltinESMExports();
    t.after(async () => {allocated.mock.restore(); written.mock.restore(); syncBuiltinESMExports(); await test.owner.settleAfterRuntimeStop(["python"]);});
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "not-started"});
    assert.equal(test.owner.status.pending, 0); assert.deepEqual(test.events, []);
    assert.equal(allocated.mock.callCount(), 1); assert.equal(written.mock.callCount(), 0);
    expect(test.registry.startTaskWithoutInstalling).not.toHaveBeenCalled();
  });

  it("does not release matches when permission retires during the final policy check", async t => {
    const test = admittedQueryFixture(t);
    test.control.matches = [{id: "chunk-0", excerpt: "private excerpt", score: 0.8,
      citation: {sourceArtifactId: "artifact.source", sourceDigest: "sha256:" + "1".repeat(64), chunkIndex: 0}}];
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => {enter = resolve;});
    const gate = new Promise<void>(resolve => {resume = resolve;});
    test.admission.stillAllowed = async () => {if (test.events.includes("status")) {enter(); await gate;} return true;};
    const running = test.adapter.queryAdmitted!(test.input, test.admission);
    await entered; test.control.current = false; resume();
    const result = await running;
    assert.deepEqual(result, {kind: "failed", cleanupPending: false});
    assert.doesNotMatch(JSON.stringify(result), /matches|private excerpt/);
    assert.equal(test.owner.status.pending, 0);
    expect(test.registry.startTaskWithoutInstalling).toHaveBeenCalledTimes(1);
  });

  it("copies a complete bounded citation before awaiting final result permission", async t => {
    const test = admittedQueryFixture(t);
    const citation = {sourceArtifactId: "artifact.source", sourceDigest: "sha256:" + "1".repeat(64), chunkIndex: 0,
      rowIndex: 1, field: "document.body", normalizedStart: 4, normalizedEnd: 24, pageNumber: 2, regionKind: "paragraph"};
    const match = {id: "chunk-0", excerpt: "private excerpt", score: 0.8, citation};
    const expected = structuredClone(match); test.control.matches = [match];
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => {enter = resolve;});
    const gate = new Promise<void>(resolve => {resume = resolve;});
    test.admission.stillAllowed = async () => {if (test.events.includes("status")) {enter(); await gate;} return true;};
    const running = test.adapter.queryAdmitted!(test.input, test.admission); await entered;
    Object.assign(citation, {sourceArtifactId: "artifact.foreign", privatePath: "private-worker-data"});
    match.excerpt = "substituted excerpt"; resume();
    assert.deepEqual(await running, {kind: "succeeded", matches: [expected], cleanupPending: false});
    assert.equal(test.owner.status.pending, 0);
  });

  it("rejects extra, oversized, malformed and accessor result/citation fields without disclosing them", async t => {
    let accessorReads = 0;
    for (const mutate of [
      (citation: Record<string, unknown>) => {citation.privatePath = "private-worker-data";},
      (citation: Record<string, unknown>) => {citation.sourceArtifactId = "x".repeat(513);},
      (citation: Record<string, unknown>) => {citation.sourceArtifactId = "   ";},
      (citation: Record<string, unknown>) => {citation.sourceDigest = "invalid";},
      (citation: Record<string, unknown>) => {citation.chunkIndex = Number.MAX_SAFE_INTEGER + 1;},
      (citation: Record<string, unknown>) => {citation.rowIndex = -1;},
      (citation: Record<string, unknown>) => {citation.field = "invalid field";},
      (citation: Record<string, unknown>) => {citation.normalizedStart = 1;},
      (citation: Record<string, unknown>) => {citation.normalizedStart = 2; citation.normalizedEnd = 2;},
      (citation: Record<string, unknown>) => {citation.pageNumber = 0;},
      (citation: Record<string, unknown>) => {citation.pageNumber = "1";},
      (citation: Record<string, unknown>) => {citation.regionKind = "x".repeat(65);},
      (citation: Record<string, unknown>) => {citation.regionKind = "paragraph\nprivate";},
      (citation: Record<string, unknown>) => {Object.defineProperty(citation, "sourceArtifactId", {enumerable: true, get() {accessorReads++; return "artifact.source";}});},
      (_citation: Record<string, unknown>, match: Record<string, unknown>) => {match.privatePath = "private-worker-data";},
      (_citation: Record<string, unknown>, match: Record<string, unknown>) => {Object.defineProperty(match, "excerpt", {enumerable: true, get() {accessorReads++; return "private excerpt";}});},
    ]) {
      const test = admittedQueryFixture(t);
      const citation: Record<string, unknown> = {sourceArtifactId: "artifact.source", sourceDigest: "sha256:" + "1".repeat(64), chunkIndex: 0};
      const match = {id: "chunk-0", excerpt: "private excerpt", score: 0.8, citation};
      mutate(citation, match); test.control.matches = [match];
      const result = await test.adapter.queryAdmitted!(test.input, test.admission);
      assert.deepEqual(result, {kind: "failed", cleanupPending: false});
      assert.doesNotMatch(JSON.stringify(result), /private excerpt|private-worker-data|matches/);
      assert.equal(accessorReads, 0); assert.equal(test.owner.status.pending, 0);
    }
  });

  it("rechecks synchronous liveness after each awaited admission or issue policy", async t => {
    for (const retireAt of [1, 2, 4, 5]) {
      const test = admittedQueryFixture(t); let checks = 0;
      test.admission.stillAllowed = async () => {
        if (++checks === retireAt) {await Promise.resolve(); test.control.current = false;}
        return true;
      };
      assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "not-started"});
      assert.equal(checks, retireAt); assert.equal(test.owner.status.pending, 0);
      expect(test.registry.startTaskWithoutInstalling).not.toHaveBeenCalled();
      assert.deepEqual(test.events, retireAt === 5 ? ["issue"] : []);
    }
  });

  for (const reason of ["full", "stopped"]) it(`reserves ownership before reading input, policy or staging when the owner is ${reason}`, async t => {
    const test = admittedQueryFixture(t);
    const reserved = reason === "full" ? Array.from({length: 256}, () => test.owner.reserve("python")) : [];
    if (reason === "stopped") test.owner.stopAccepting();
    let inputReads = 0;
    const descriptor = Object.getOwnPropertyDescriptor, allocate = fs.mkdtemp, write = fs.writeFile;
    const read = t.mock.method(Object, "getOwnPropertyDescriptor", (...args: Parameters<typeof Object.getOwnPropertyDescriptor>) => {
      if (args[0] === test.input || args[0] === test.admission) inputReads++;
      return descriptor(...args);
    });
    const allocated = t.mock.method(fs, "mkdtemp", allocate), written = t.mock.method(fs, "writeFile", write);
    const policy = testDouble.fn(async () => true); test.admission.stillAllowed = policy;
    syncBuiltinESMExports();
    t.after(async () => {read.mock.restore(); allocated.mock.restore(); written.mock.restore(); syncBuiltinESMExports(); reserved.forEach(lease => lease.release());});
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "not-started"});
    assert.equal(inputReads, 0); assert.equal(allocated.mock.callCount(), 0); assert.equal(written.mock.callCount(), 0);
    expect(policy).not.toHaveBeenCalled(); expect(test.registry.startTaskWithoutInstalling).not.toHaveBeenCalled();
    assert.equal(test.owner.status.pending, reserved.length);
    if (reason === "full") {
      reserved.pop()!.release();
      assert.equal((await test.adapter.queryAdmitted!(test.input, test.admission)).kind, "succeeded");
      assert.equal(test.owner.status.pending, 255);
    }
  });

  it("counts a held initial policy check against the existing ownership limit", async t => {
    const test = admittedQueryFixture(t), reserved = Array.from({length: 255}, () => test.owner.reserve("python"));
    let enter!: () => void, resume!: () => void;
    const entered = new Promise<void>(resolve => {enter = resolve;});
    const gate = new Promise<void>(resolve => {resume = resolve;});
    test.admission.stillAllowed = async () => {enter(); await gate; return false;};
    const running = test.adapter.queryAdmitted!(test.input, test.admission); await entered;
    assert.equal(test.owner.status.pending, 256);
    const otherPolicy = testDouble.fn(async () => true);
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, {...test.admission, taskId: randomUUID(), stillAllowed: otherPolicy}), {kind: "not-started"});
    expect(otherPolicy).not.toHaveBeenCalled(); expect(test.registry.startTaskWithoutInstalling).not.toHaveBeenCalled();
    resume(); assert.deepEqual(await running, {kind: "not-started"});
    assert.equal(test.owner.status.pending, 255); reserved.forEach(lease => lease.release());
    assert.equal(test.owner.status.pending, 0);
  });

  it("closed installed-only refusal proves non-start, while lost, mismatched and malformed starts retain custody", async t => {
    for (const scenario of ["unavailable", "lost", "unconfirmed", "wrong-id", "missing-status", "extra"]) {
      const test = admittedQueryFixture(t);
      if (["unavailable", "lost", "unconfirmed"].includes(scenario)) test.control.start = scenario;
      if (scenario === "wrong-id") test.control.ack.requestId = randomUUID();
      if (scenario === "missing-status") test.control.ack.status = undefined;
      if (scenario === "extra") test.control.ack.privatePath = "private-model";
      const result = await test.adapter.queryAdmitted!(test.input, test.admission);
      assert.deepEqual(result, scenario === "unavailable" ? {kind: "not-started"} : {kind: "unconfirmed", cleanupPending: true});
      expect(test.registry.getTaskStatus).not.toHaveBeenCalled(); assert.equal(test.events.includes("accept"), false);
      await test.owner.reconcileNow(); expect(test.registry.getTaskStatus).not.toHaveBeenCalled();
      await test.owner.settleAfterRuntimeStop(["python"]);
      await assert.rejects(fs.access(test.request().payload.localPath));
      expect(test.registry.startTask).not.toHaveBeenCalled();
    }
  });

  it("failed acceptance and foreign status cannot release staging, and revoked result permission discloses no matches", async t => {
    for (const scenario of ["accept", "foreign", "revoke"]) {
      const test = admittedQueryFixture(t);
      if (scenario === "accept") test.control.accept = false;
      if (scenario === "foreign") test.control.status.workspaceId = "workspace.foreign";
      if (scenario === "revoke") test.control.revokeAfterAccept = true;
      test.control.matches = [{id: "chunk-0", excerpt: "private excerpt", score: 0.8,
        citation: {sourceArtifactId: "artifact.source", sourceDigest: "sha256:" + "1".repeat(64), chunkIndex: 0}}];
      const result = await test.adapter.queryAdmitted!(test.input, test.admission);
      assert.deepEqual(result, scenario === "revoke" ? {kind: "failed", cleanupPending: false} : {kind: "unconfirmed", cleanupPending: true});
      assert.doesNotMatch(JSON.stringify(result), /private excerpt|private-model|localModelReference/);
      if (scenario !== "revoke") {
        await fs.access(test.request().payload.localPath);
        delete test.control.status.workspaceId;
        await test.owner.reconcileNow();
        await assert.rejects(fs.access(test.request().payload.localPath));
      }
    }
  });

  for (const scenario of ["denied", "finished"]) it(`retains ${scenario} query staging when cleanup fails and updates its proof after owned retry`, async t => {
    const test = admittedQueryFixture(t);
    const retired: string[] = [];
    Object.assign(test.admission, {cleanupRetired: (id: string) => {retired.push(id);}});
    if (scenario === "denied") test.control.issue = "denied";
    const write = fs.writeFile, remove = fs.rm;
    let directory: string | undefined, fail = true;
    const written = t.mock.method(fs, "writeFile", async (...args: Parameters<typeof fs.writeFile>) => {
      await write(...args); directory = dirname(String(args[0]));
    });
    const removed = t.mock.method(fs, "rm", async (...args: Parameters<typeof fs.rm>) => {
      if (directory !== undefined && String(args[0]) === directory && fail) {fail = false; throw new Error("private cleanup failure");}
      return remove(...args);
    });
    syncBuiltinESMExports();
    t.after(async () => {written.mock.restore(); removed.mock.restore(); syncBuiltinESMExports(); await test.owner.settleAfterRuntimeStop(["python"]);});
    const result = await test.adapter.queryAdmitted!(test.input, test.admission);
    assert.deepEqual(result, scenario === "denied" ? {kind: "unconfirmed", cleanupPending: true}
      : {kind: "succeeded", matches: [], cleanupPending: true});
    assert.ok(directory); await fs.access(directory); assert.equal(test.owner.status.pending, 1);
    assert.deepEqual(retired, []);
    const polls = test.registry.getTaskStatus.mock.calls.length;
    await test.owner.reconcileNow();
    assert.equal(test.owner.status.pending, 0); await assert.rejects(fs.access(directory));
    assert.deepEqual(retired, [test.admission.taskId]);
    expect(test.registry.getTaskStatus).toHaveBeenCalledTimes(polls);
    assert.deepEqual(await test.adapter.queryAdmitted!(test.input, test.admission), {kind: "unconfirmed", cleanupPending: false});
    expect(test.registry.startTask).not.toHaveBeenCalled();
    expect(test.registry.startTaskWithoutInstalling).toHaveBeenCalledTimes(scenario === "denied" ? 0 : 1);
  });
});

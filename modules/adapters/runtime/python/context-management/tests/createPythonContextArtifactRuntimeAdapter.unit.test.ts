import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname } from "node:path";
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

import { createHash } from "node:crypto";

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
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry);
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
    );
    const matches = await queryAdapter.query({
      workspaceId: createWorkspaceId("workspace.context"),
      artifactId: "artifact.rag",
      content,
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
      digest: digest(content),
      query: "release",
      maximumResults: 3,
    });
    expect(matches[0]).toMatchObject({
      score: 0.8,
      citation: { chunkIndex: 0 },
    });
  });

  it("rejects substituted bytes before starting a runtime task", async () => {
    const content = new TextEncoder().encode("sqlite bytes");
    const test = registryFor({});
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry);
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
    const adapter = createPythonContextArtifactRuntimeAdapter(test.registry);

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

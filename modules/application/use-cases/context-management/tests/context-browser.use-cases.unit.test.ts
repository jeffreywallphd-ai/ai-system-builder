import { createHash } from "node:crypto";

import {
  CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  type ContextArtifactManifest,
} from "../../../../contracts/context-management";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { ContextBrowserUseCases } from "../context-browser.use-cases";

function sha256(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

function harness(options?: {
  runtimeFailure?: boolean;
  manualPack?: boolean;
}) {
  const workspaceId = createWorkspaceId("workspace.context");
  const source = new TextEncoder().encode("Authoritative source text.");
  const rag = new TextEncoder().encode("sqlite bytes");
  const pack = new TextEncoder().encode("zip bytes");
  const bytes = new Map([
    ["artifact.source", source],
    ["generated/context/rag/release.sqlite3", rag],
    ["generated/context/pack/release.zip", pack],
  ]);
  const records = [
    {
      workspaceId,
      storageKey: "artifact.source",
      artifactFamily: "structured-text",
      mediaType: "text/markdown",
      sizeBytes: source.byteLength,
      sourceKind: "upload",
      originalName: "source.md",
      checksum: {
        algorithm: "sha256",
        value: sha256(source).slice(7),
      },
    },
    {
      workspaceId,
      storageKey: "generated/context/rag/release.sqlite3",
      artifactFamily: "binary",
      mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE,
      sizeBytes: rag.byteLength,
      sourceKind: "generated",
      originalName: "Release knowledge.sqlite3",
      createdAt: "2026-08-01T12:00:00.000Z",
      checksum: {
        algorithm: "sha256",
        value: sha256(rag).slice(7),
      },
    },
    {
      workspaceId,
      storageKey: "generated/context/pack/release.zip",
      artifactFamily: "binary",
      mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
      sizeBytes: pack.byteLength,
      sourceKind: "generated",
      originalName: "Release pack.zip",
      createdAt: "2026-08-01T11:00:00.000Z",
      checksum: {
        algorithm: "sha256",
        value: sha256(pack).slice(7),
      },
    },
    {
      workspaceId,
      storageKey: "ordinary.json",
      artifactFamily: "structured-text",
      mediaType: "application/json",
      sizeBytes: 10,
      checksum: { algorithm: "sha256", value: "0".repeat(64) },
    },
  ] as any[];
  const manifest = (
    kind: "rag-database" | "markdown-context-pack",
  ): ContextArtifactManifest => ({
    schemaVersion: "1",
    kind,
    name: kind === "rag-database" ? "Release knowledge" : "Release pack",
    mediaType:
      kind === "rag-database"
        ? CONTEXT_RAG_DATABASE_MEDIA_TYPE
        : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
    createdAt: "2026-08-01T12:00:00.000Z",
    sources: [{
      artifactId: "artifact.source",
      digest: sha256(source),
      mediaType: "text/markdown",
      originalName: "source.md",
      sizeBytes: source.byteLength,
      chunkCount: 1,
      chunkingMode: "extracted",
    }],
    manualEntries:
      kind === "markdown-context-pack" && options?.manualPack
        ? [{
            id: "manual-1",
            title: "Manual",
            digest: "sha256:" + "1".repeat(64),
          }]
        : [],
    chunking: {
      strategy: "section",
      chunkCharacters: 512,
      overlapCharacters: 0,
    },
    ...(kind === "rag-database"
      ? {
          embedding: {
            provider: "transformers",
            modelId: "local/test-embedding",
            dimensions: 2,
          },
        }
      : {
          contextPack: {
            method: "deterministic",
            topicCount: 4,
            maximumSummaryCharacters: 500,
          },
        }),
  });
  const runtime: any = {
    inspectSource: testDouble.fn(async (input: any) => ({
      artifactId: input.artifactId,
      digest: input.digest,
      mediaType: input.mediaType,
      originalName: input.originalName,
      sizeBytes: input.content.byteLength,
      ready: true,
      sourceKind: "document",
      format: "markdown",
      textFields: [],
      alreadyChunked: false,
      chunkCount: 1,
    })),
    inspectArtifact: testDouble.fn(async (input: any) => {
      if (options?.runtimeFailure) throw new Error("C:\private\source");
      const kind = input.mediaType === CONTEXT_RAG_DATABASE_MEDIA_TYPE
        ? "rag-database"
        : "markdown-context-pack";
      return {
        manifest: manifest(kind),
        chunkCount: 1,
        packageEntries:
          kind === "markdown-context-pack"
            ? ["README.md", "manifest.json", "sources.md", "topics.md"]
            : [],
        topics:
          kind === "markdown-context-pack"
            ? [{
                title: "Release",
                summary: "Verify each build.",
                citations: ["artifact.source#chunk-0"],
              }]
            : [],
      };
    }),
    query: testDouble.fn(async () => [{
      id: "chunk-0",
      excerpt: "Authoritative source text.",
      score: 0.9,
      citation: {
        sourceArtifactId: "artifact.source",
        sourceDigest: sha256(source),
        chunkIndex: 0,
      },
    }]),
  };
  const generation: any = {
    start: testDouble.fn(async (command: any) => ({
      ok: true,
      value: {
        requestId: "rebuild-1",
        taskType: "generate-context-artifact",
        accepted: true,
        status: "queued",
      },
      command,
    })),
  };
  const deleted: string[] = [];
  const deleteArtifact: any = {
    execute: testDouble.fn(async (command: any) => {
      deleted.push(command.storageKey);
      return { ok: true, value: { storageKey: command.storageKey } };
    }),
  };
  const catalog: any = {
    browseArtifactCatalogRecords: testDouble.fn(async (request: any) => ({
      ok: true,
      value: {
        records:
          request.workspaceId === workspaceId ? records : [],
      },
    })),
    readArtifactCatalogRecord: testDouble.fn(async (request: any) => {
      const record = records.find(
        (entry) =>
          entry.workspaceId === request.workspaceId &&
          entry.storageKey === request.storageKey,
      );
      return record
        ? { ok: true, value: { record } }
        : { ok: false, error: { code: "not-found", message: "missing" } };
    }),
    deleteArtifactCatalogRecord: testDouble.fn(),
  };
  const storage: any = {
    retrieveArtifact: testDouble.fn(async (request: any) => {
      const content = bytes.get(request.key);
      const record = records.find((entry) => entry.storageKey === request.key);
      return content && record
        ? {
            ok: true,
            value: {
              descriptor: {
                key: request.key,
                mediaType: record.mediaType,
                sizeBytes: content.byteLength,
                metadata: { originalFileName: record.originalName },
              },
              content,
            },
          }
        : { ok: false, error: { code: "not-found", message: "missing" } };
    }),
  };
  const storageBindings: any = {
    readArtifactStorageBindings: testDouble.fn(async () => ({
      ok: false,
      error: { code: "not-found", message: "no binding" },
    })),
  };
  const useCases = new ContextBrowserUseCases({
    catalog,
    storageBindings,
    storage,
    runtime,
    generation,
    deleteArtifact,
  });
  const context = { workspaceId };
  return {
    useCases,
    context,
    runtime,
    generation,
    deleted,
    records,
    bytes,
  };
}

describe("ContextBrowserUseCases", () => {
  it("lists only valid workspace context media types with readable names", async () => {
    const test = harness();
    const result = await test.useCases.list(test.context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.name)).toEqual([
      "Release knowledge",
      "Release pack",
    ]);
  });

  it("inspects source readiness through exact local bytes", async () => {
    const test = harness();
    const result = await test.useCases.inspectSource(
      {
        artifactId: "artifact.source",
        chunking: {
          strategy: "section",
          chunkCharacters: 512,
          overlapCharacters: 0,
        },
      },
      test.context,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      ready: true,
      locallyReadable: true,
      alreadyChunked: false,
      format: "markdown",
    });
    expect(test.runtime.inspectSource).toHaveBeenCalledTimes(1);
  });

  it("returns verified detail, freshness, topics, and exact query citations", async () => {
    const test = harness();
    const detail = await test.useCases.detail(
      "generated/context/pack/release.zip",
      test.context,
    );
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.freshness[0]).toMatchObject({
      state: "current",
    });
    expect(detail.value.topics[0]?.title).toBe("Release");
    expect(detail.value.rebuildAllowed).toBe(true);

    const query = await test.useCases.query(
      {
        artifactId: "generated/context/rag/release.sqlite3",
        query: "release policy",
        maximumResults: 3,
      },
      test.context,
    );
    expect(query.ok).toBe(true);
    if (!query.ok) return;
    expect(query.value.matches[0]).toMatchObject({
      score: 0.9,
      citation: { sourceArtifactId: "artifact.source", chunkIndex: 0 },
    });
  });

  it("rebuilds source-only artifacts and requires manual context to be re-entered", async () => {
    const sourceOnly = harness();
    const rebuilt = await sourceOnly.useCases.rebuild(
      "generated/context/rag/release.sqlite3",
      sourceOnly.context,
    );
    expect(rebuilt.ok).toBe(true);
    expect(sourceOnly.generation.start).toHaveBeenCalledTimes(1);

    const manual = harness({ manualPack: true });
    const denied = await manual.useCases.rebuild(
      "generated/context/pack/release.zip",
      manual.context,
    );
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.message).toContain("Re-enter");
  });

  it("deletes only context artifacts and sanitizes runtime inspection failure", async () => {
    const test = harness({ runtimeFailure: true });
    const failed = await test.useCases.detail(
      "generated/context/rag/release.sqlite3",
      test.context,
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.message).not.toContain("C:\\private");
    }
    const ordinary = await test.useCases.delete("ordinary.json", test.context);
    expect(ordinary.ok).toBe(false);
    const deleted = await test.useCases.delete(
      "generated/context/rag/release.sqlite3",
      test.context,
    );
    expect(deleted.ok).toBe(true);
    expect(test.deleted).toEqual([
      "generated/context/rag/release.sqlite3",
    ]);
  });

  it("returns opaque not found across workspace scope", async () => {
    const test = harness();
    const result = await test.useCases.detail(
      "generated/context/rag/release.sqlite3",
      { workspaceId: createWorkspaceId("workspace.other") },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not-found");
  });
});

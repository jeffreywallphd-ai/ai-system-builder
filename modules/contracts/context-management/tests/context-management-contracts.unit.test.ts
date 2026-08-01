import { createWorkspaceId } from "../../workspace";
import { describe, expect, it } from "../../../testing/node-test";
import {
  CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  evaluateContextSourceCapability,
  normalizeContextLaunchIntent,
  normalizeContextSaveName,
  validatePersistedContextChunks,
  validateStartContextGenerationCommand,
} from "..";

describe("context management contracts", () => {
  it("shares textual source capability truth with Dataset Preparation", () => {
    expect(
      evaluateContextSourceCapability({
        fileName: "prepared.parquet",
        mediaType: "application/vnd.apache.parquet",
      }),
    ).toMatchObject({
      ready: true,
      capability: { format: "parquet", kind: "structured" },
    });
    expect(
      evaluateContextSourceCapability({
        fileName: "notes.md",
        mediaType: "text/markdown",
      }),
    ).toMatchObject({
      ready: true,
      capability: { format: "markdown", kind: "document" },
    });
    expect(
      evaluateContextSourceCapability({
        fileName: "photo.png",
        mediaType: "image/png",
      }),
    ).toMatchObject({
      ready: false,
      code: "source-kind-unsupported",
    });
  });

  it("normalizes safe names and identifier-only handoffs", () => {
    expect(normalizeContextSaveName("  Support   Context  ")).toBe(
      "Support Context",
    );
    expect(() => normalizeContextSaveName("../private")).toThrow(
      "Context save name",
    );
    expect(
      normalizeContextLaunchIntent({
        workspaceId: createWorkspaceId("workspace-a"),
        artifactId: "artifact-1",
        targetTab: "rag-databases",
      }),
    ).toEqual({
      workspaceId: "workspace-a",
      artifactId: "artifact-1",
      targetTab: "rag-databases",
    });
  });

  it("keeps RAG and context-pack settings explicit and mutually exclusive", () => {
    const rag = validateStartContextGenerationCommand({
      kind: "rag-database",
      name: "Support RAG",
      sources: [{ artifactId: "artifact-1" }],
      chunking: {
        strategy: "fixed-length",
        chunkCharacters: 800,
        overlapCharacters: 80,
      },
      embedding: {
        provider: "transformers",
        modelId: "sentence-transformers/all-MiniLM-L6-v2",
      },
    });
    expect(rag.embedding?.modelId).toContain("MiniLM");

    const topicAware = validateStartContextGenerationCommand({
      ...rag,
      chunking: {
        strategy: "topic-aware",
        chunkCharacters: 1200,
        overlapCharacters: 0,
        maximumTokensPerChunk: 320,
        topicBoundarySensitivity: 0.22,
      },
    });
    expect(topicAware.chunking).toMatchObject({
      strategy: "topic-aware",
      maximumTokensPerChunk: 320,
      topicBoundarySensitivity: 0.22,
    });
    expect(() =>
      validateStartContextGenerationCommand({
        ...rag,
        chunking: {
          strategy: "fixed-length",
          chunkCharacters: 800,
          overlapCharacters: 80,
          maximumTokensPerChunk: 320,
        },
      }),
    ).toThrow("Context chunking settings");

    const pack = validateStartContextGenerationCommand({
      kind: "markdown-context-pack",
      name: "Support Pack",
      sources: [],
      manualEntries: [
        { id: "manual-1", title: "Policy", content: "Use safe defaults." },
      ],
      chunking: {
        strategy: "section",
        chunkCharacters: 800,
        overlapCharacters: 0,
      },
      contextPack: {
        inputMode: "manual",
        method: "none",
      },
    });
    expect(pack.contextPack?.method).toBe("none");
    expect(() =>
      validateStartContextGenerationCommand({
        ...pack,
        contextPack: {
          inputMode: "manual",
          method: "local-model",
          maximumSummaryLines: 200,
        },
      }),
    ).toThrow("Context-pack generation settings");
  });

  it("accepts persisted chunks only when source digest and exact lineage match", () => {
    const expected = {
      artifactId: "artifact-1",
      digest: "sha256:" + "a".repeat(64),
    };
    const chunks = validatePersistedContextChunks(
      [
        {
          id: "chunk-0",
          text: "A bounded source chunk.",
          citation: {
            sourceArtifactId: expected.artifactId,
            sourceDigest: expected.digest,
            chunkIndex: 0,
            normalizedStart: 0,
            normalizedEnd: 23,
          },
        },
      ],
      expected,
    );
    expect(chunks.length).toBe(1);
    expect(
      validatePersistedContextChunks(
        [
          {
            ...chunks[0],
            citation: { ...chunks[0]!.citation, chunkIndex: 12 },
          },
        ],
        expected,
      )[0]!.citation.chunkIndex,
    ).toBe(12);
    expect(() =>
      validatePersistedContextChunks(
        [
          {
            ...chunks[0],
            citation: {
              ...chunks[0]!.citation,
              sourceDigest: "sha256:" + "b".repeat(64),
            },
          },
        ],
        expected,
      ),
    ).toThrow("do not match");
  });

  it("uses context-specific materialized media types", () => {
    expect(CONTEXT_RAG_DATABASE_MEDIA_TYPE).toContain("sqlite3");
    expect(CONTEXT_MARKDOWN_PACK_MEDIA_TYPE).toContain("zip");
  });

  it("rejects oversized manual content and invalid chunk overlap", () => {
    expect(() =>
      validateStartContextGenerationCommand({
        kind: "markdown-context-pack",
        name: "Invalid",
        sources: [],
        manualEntries: [
          {
            id: "manual-1",
            title: "Oversized",
            content: "x".repeat(200_001),
          },
        ],
        chunking: {
          strategy: "fixed-length",
          chunkCharacters: 100,
          overlapCharacters: 100,
        },
        contextPack: {
          inputMode: "manual",
          method: "none",
        },
      }),
    ).toThrow();
  });

  it("rejects malformed manual Markdown before generation", () => {
    expect(() =>
      validateStartContextGenerationCommand({
        kind: "markdown-context-pack",
        name: "Invalid Markdown",
        sources: [],
        manualEntries: [
          {
            id: "manual-1",
            title: "Broken fence",
            content: "# Context\n\n```text\nnot closed",
          },
        ],
        chunking: {
          strategy: "section",
          chunkCharacters: 800,
          overlapCharacters: 0,
        },
        contextPack: { inputMode: "manual", method: "none" },
      }),
    ).toThrow("unclosed fenced code block");
  });

  it("accepts plain Markdown text that begins with a hash without a heading space", () => {
    const command = validateStartContextGenerationCommand({
      kind: "markdown-context-pack",
      name: "Test Pack",
      sources: [],
      manualEntries: [
        {
          id: "manual-1",
          title: "Test Pack",
          content:
            "#This is a test pack\r\n\r\nThis is a test of the pack capabilities.",
        },
      ],
      chunking: {
        strategy: "structure-aware",
        chunkCharacters: 1200,
        overlapCharacters: 120,
        maximumChunks: 10_000,
        textFields: [],
      },
      contextPack: { inputMode: "manual", method: "none" },
    });

    expect(command.manualEntries?.[0]?.content).toContain(
      "#This is a test pack",
    );
  });
});

import { describe, expect, it } from "../../testing/node-test";

import { createContractError } from "../shared";
import {
  createDeleteArtifactFailureResult,
  createDeleteArtifactRequest,
  createDeleteArtifactSuccessResult,
  createHasArtifactRequest,
  createHasArtifactSuccessResult,
  normalizeStorageInstanceReference,
  normalizeStoragePlacementDescriptor,
  normalizeStorageZoneKind,
  createRetrieveArtifactRequest,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactFailureResult,
  createStoreArtifactRequest,
  createStoreArtifactSuccessResult,
  createStoreArtifactInRepoRequest,
  createStoreArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoSuccessResult,
  createHasArtifactInRepoSuccessResult,
  normalizeArtifactStorageBinding,
  encodeArtifactRepoBackingLocator,
  decodeArtifactRepoBackingLocator,
  resolveArtifactRepoBackingTarget,
  normalizeStorageBackingReference,
} from ".";

describe("storage contracts", () => {
  it("creates store requests with artifact descriptors and boundary context", () => {
    const request = createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
      descriptor: {
        key: " artifacts/report-1 ",
        mediaType: "application/pdf",
        sizeBytes: 3,
        checksum: {
          algorithm: "sha256",
          value: "abc123",
        },
        metadata: {
          source: "runtime",
        },
      },
      overwrite: true,
      requestId: "req-1",
      correlationId: "corr-1",
    });

    expect(request).toEqual({
      descriptor: {
        key: "artifacts/report-1",
        mediaType: "application/pdf",
        sizeBytes: 3,
        checksum: {
          algorithm: "sha256",
          value: "abc123",
        },
        metadata: {
          source: "runtime",
        },
      },
      content: new Uint8Array([1, 2, 3]),
      overwrite: true,
      requestId: "req-1",
      correlationId: "corr-1",
    });
  });

  it("rejects empty artifact keys for key-based storage lookups and descriptors", () => {
    expect(() => createRetrieveArtifactRequest("   ")).toThrow(
      'Storage artifact key must be a non-empty, trimmed string key that remains path-agnostic. Received "   ".',
    );
    expect(() => createDeleteArtifactRequest("")).toThrow(
      'Storage artifact key must be a non-empty, trimmed string key that remains path-agnostic. Received "".',
    );
    expect(() =>
      createStoreArtifactRequest(new Uint8Array([1]), {
        descriptor: {
          key: " ",
        },
      }),
    ).toThrow(
      'Storage artifact key must be a non-empty, trimmed string key that remains path-agnostic. Received " ".',
    );
  });

  it("creates retrieve and has responses without persistence-record leakage", () => {
    const descriptor = {
      key: " artifacts/image-1 ",
      mediaType: "image/png",
      sizeBytes: 128,
      checksum: {
        algorithm: "sha256",
        value: "def456",
      },
      metadata: {
        purpose: "preview",
      },
    } as const;

    const retrieveResult = createRetrieveArtifactSuccessResult(
      descriptor,
      new Uint8Array([9, 8, 7]),
      {
        requestId: "req-2",
      },
    );

    expect(retrieveResult).toEqual({
      ok: true,
      value: {
        descriptor: {
          ...descriptor,
          key: "artifacts/image-1",
        },
        content: new Uint8Array([9, 8, 7]),
      },
      requestId: "req-2",
      correlationId: undefined,
    });

    const hasResult = createHasArtifactSuccessResult(true, {
      descriptor,
      correlationId: "corr-2",
    });

    expect(hasResult).toEqual({
      ok: true,
      value: {
        exists: true,
        descriptor: {
          ...descriptor,
          key: "artifacts/image-1",
        },
      },
      requestId: undefined,
      correlationId: "corr-2",
    });
  });

  it("creates delete success/failure results with shared contract error semantics", () => {
    const request = createDeleteArtifactRequest("artifacts/export-1", {
      requestId: "req-3",
    });

    expect(request).toEqual({
      key: "artifacts/export-1",
      requestId: "req-3",
      correlationId: undefined,
    });

    const success = createDeleteArtifactSuccessResult(false, {
      requestId: "req-3",
      correlationId: "corr-3",
    });

    expect(success).toEqual({
      ok: true,
      value: {
        deleted: false,
      },
      requestId: "req-3",
      correlationId: "corr-3",
    });

    const error = createContractError("unavailable", "Storage backend unavailable", {
      details: {
        adapter: "local-fs",
      },
      requestId: "req-3",
    });
    const failure = createDeleteArtifactFailureResult(error);

    expect(failure).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Storage backend unavailable",
        details: {
          adapter: "local-fs",
        },
        requestId: "req-3",
        correlationId: undefined,
      },
      requestId: "req-3",
      correlationId: undefined,
    });
  });

  it("creates explicit lookup requests for retrieve and existence checks", () => {
    const retrieveRequest = createRetrieveArtifactRequest(" artifacts/output-1 ", {
      requestId: "req-4",
      correlationId: "corr-4",
    });
    const hasRequest = createHasArtifactRequest(" artifacts/output-1 ", {
      requestId: "req-4",
    });

    expect(retrieveRequest).toEqual({
      key: "artifacts/output-1",
      requestId: "req-4",
      correlationId: "corr-4",
    });
    expect(hasRequest).toEqual({
      key: "artifacts/output-1",
      requestId: "req-4",
      correlationId: undefined,
    });
  });

  it("creates store success responses with artifact descriptor metadata", () => {
    const result = createStoreArtifactSuccessResult({
      key: " artifacts/new-file ",
      mediaType: "text/plain",
      sizeBytes: 12,
      checksum: {
        algorithm: "sha256",
        value: "ghi789",
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        key: "artifacts/new-file",
        mediaType: "text/plain",
        sizeBytes: 12,
        checksum: {
          algorithm: "sha256",
          value: "ghi789",
        },
      },
      requestId: undefined,
      correlationId: undefined,
    });
  });

  it("normalizes repo backing verification metadata and resolves structured repo targets", () => {
    const normalized = normalizeStorageBackingReference({
      kind: "artifact-repo",
      provider: "huggingface",
      locator: " openai/demo/images/a.png ",
      revision: " main ",
      verification: {
        exists: true,
        verifiedAt: " 2026-04-17T00:00:00.000Z ",
      },
    });

    expect(normalized.verification).toEqual({
      exists: true,
      verifiedAt: "2026-04-17T00:00:00.000Z",
    });
    expect(resolveArtifactRepoBackingTarget(normalized)).toEqual({
      provider: "huggingface",
      repository: "openai/demo",
      path: "images/a.png",
      revision: "main",
      locator: "openai/demo/images/a.png",
    });
  });

  it("prefers structured repo target over locator decoding when both are present", () => {
    const resolved = resolveArtifactRepoBackingTarget({
      provider: "huggingface",
      locator: "legacy-owner/legacy-repo/legacy/path.png",
      revision: "main",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/current.png",
        revision: "main",
      },
    });

    expect(resolved).toEqual({
      provider: "huggingface",
      repository: "openai/demo",
      path: "images/current.png",
      revision: "main",
      locator: "legacy-owner/legacy-repo/legacy/path.png",
    });
  });

  it("creates store failure responses with shared contract error semantics", () => {
    const error = createContractError("unavailable", "Storage backend unavailable", {
      details: {
        adapter: "memory",
      },
      correlationId: "corr-6",
    });

    const failure = createStoreArtifactFailureResult(error, {
      requestId: "req-6",
    });

    expect(failure).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Storage backend unavailable",
        details: {
          adapter: "memory",
        },
        requestId: undefined,
        correlationId: "corr-6",
      },
      requestId: "req-6",
      correlationId: "corr-6",
    });
  });

  it("normalizes storage instance and placement descriptors for zone-aware placement", () => {
    expect(normalizeStorageZoneKind(" Derived ")).toBe("derived");

    const placement = normalizeStoragePlacementDescriptor({
      instance: normalizeStorageInstanceReference({
        id: " local-main ",
        kind: " FileSystem ",
        zone: " staging ",
      }),
      key: " staging/artifacts/output-2 ",
    });

    expect(placement).toEqual({
      instance: {
        id: "local-main",
        kind: "filesystem",
        zone: "staging",
      },
      key: "staging/artifacts/output-2",
    });
  });

  it("creates repo-family requests and results with repo targets", () => {
    const storeRequest = createStoreArtifactInRepoRequest(new Uint8Array([7, 8, 9]), {
      target: {
        provider: " huggingface ",
        repository: " openai/demo-artifacts ",
        revision: " main ",
        path: " images/cat.png ",
      },
      mediaType: "image/png",
      overwrite: true,
    });

    expect(storeRequest).toEqual({
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        revision: "main",
        path: "images/cat.png",
      },
      content: new Uint8Array([7, 8, 9]),
      mediaType: "image/png",
      metadata: undefined,
      overwrite: true,
    });

    const descriptor = {
      target: storeRequest.target,
      mediaType: storeRequest.mediaType,
      sizeBytes: 3,
      checksum: {
        algorithm: "sha256",
        value: "repo123",
      },
    } as const;

    const storeResult = createStoreArtifactInRepoSuccessResult(descriptor);
    const retrieveResult = createRetrieveArtifactFromRepoSuccessResult(
      descriptor,
      new Uint8Array([7, 8, 9]),
    );
    const hasResult = createHasArtifactInRepoSuccessResult(true, {
      descriptor,
    });

    expect(storeResult.ok).toBe(true);
    expect(retrieveResult.ok).toBe(true);
    expect(hasResult.ok).toBe(true);
  });

  it("encodes and decodes artifact-repo backing locators through shared helpers", () => {
    const locator = encodeArtifactRepoBackingLocator({
      repository: " openai/demo-artifacts ",
      path: " images/cat.png ",
    });

    expect(locator).toBe("openai/demo-artifacts/images/cat.png");
    expect(decodeArtifactRepoBackingLocator(locator)).toEqual({
      repository: "openai/demo-artifacts",
      path: "images/cat.png",
    });
  });

  it("creates artifact storage bindings against thin shared backing references", () => {
    const binding = normalizeArtifactStorageBinding({
      artifactId: " artifact-42 ",
      backing: {
        kind: " artifact-repo ",
        provider: " huggingface ",
        locator: " openai/demo-artifacts/images/cat.png ",
        revision: " main ",
      },
      role: " imported-source ",
      createdAt: " 2026-04-17T00:00:00.000Z ",
    });

    expect(binding).toEqual({
      artifactId: "artifact-42",
      backing: {
        kind: "artifact-repo",
        provider: "huggingface",
        locator: "openai/demo-artifacts/images/cat.png",
        revision: "main",
      },
      role: "imported-source",
      createdAt: "2026-04-17T00:00:00.000Z",
    });
  });

});

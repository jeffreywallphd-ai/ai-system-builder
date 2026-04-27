import { describe, expect, it } from "../../testing/node-test";

import { createArtifactDescriptorFromStagedArtifactDescriptor } from "../artifact";
import { createContractError } from "../shared";
import {
  INGESTION_SOURCE_KINDS,
  createRegisterStagedArtifactFailureResult,
  createRegisterStagedArtifactRequest,
  createRegisterStagedArtifactSuccessResult,
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  normalizeIngestionSourceKind,
} from ".";

describe("ingestion contracts", () => {
  it("normalizes and constrains ingestion source kinds", () => {
    expect(INGESTION_SOURCE_KINDS).toEqual([
      "upload",
      "scrape",
      "generated",
      "api",
      "runtime",
    ]);
    expect(normalizeIngestionSourceKind(" Upload ")).toBe("upload");
    expect(() => normalizeIngestionSourceKind("other")).toThrow(
      'Ingestion source kind must be one of upload, scrape, generated, api, runtime. Received "other".',
    );
  });

  it("creates staged-artifact registration requests with normalized descriptor fields", () => {
    const request = createRegisterStagedArtifactRequest(new Uint8Array([9, 8]), {
      descriptor: {
        storage: {
          key: " staging/object-8 ",
        },
        sourceKind: " generated ",
        originalName: " generated-output.json ",
      },
      overwrite: true,
      requestId: "req-880",
      correlationId: "corr-880",
    });

    expect(request).toMatchObject({
      descriptor: {
        storage: {
          key: "staging/object-8",
        },
        sourceKind: "generated",
        originalName: "generated-output.json",
      },
      content: new Uint8Array([9, 8]),
      overwrite: true,
      requestId: "req-880",
      correlationId: "corr-880",
    });
  });

  it("creates staged-artifact descriptors from storage descriptors", () => {
    const descriptor = createStagedArtifactDescriptorFromStorageObjectDescriptor(
      {
        key: " uploads/images/kitten.png ",
        mediaType: "image/png",
        sizeBytes: 42,
      },
      {
        sourceKind: "upload",
        originalName: " kitten.png ",
      },
    );

    expect(descriptor).toMatchObject({
      sourceKind: "upload",
      originalName: "kitten.png",
      storage: {
        key: "uploads/images/kitten.png",
        mediaType: "image/png",
        sizeBytes: 42,
      },
    });

    const artifactDescriptor = createArtifactDescriptorFromStagedArtifactDescriptor(
      descriptor,
    );

    expect(artifactDescriptor.kind).toBe("raw-staged");
    expect(artifactDescriptor.key).toBe("uploads/images/kitten.png");
  });

  it("creates registration failure and success results using shared contract result semantics", () => {
    const success = createRegisterStagedArtifactSuccessResult({
      storage: {
        key: " staging/object-9 ",
      },
      sourceKind: "api",
      createdAt: " 2026-04-16T00:00:00.000Z ",
    });

    expect(success).toMatchObject({
      ok: true,
      value: {
        storage: {
          key: "staging/object-9",
        },
        sourceKind: "api",
        createdAt: "2026-04-16T00:00:00.000Z",
      },
      requestId: undefined,
      correlationId: undefined,
    });

    const failure = createRegisterStagedArtifactFailureResult(
      createContractError("unavailable", "Ingestion adapter unavailable", {
        details: {
          sourceKind: "api",
        },
      }),
      {
        requestId: "req-881",
      },
    );

    expect(failure).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Ingestion adapter unavailable",
        details: {
          sourceKind: "api",
        },
        requestId: undefined,
        correlationId: undefined,
      },
      requestId: "req-881",
      correlationId: undefined,
    });
  });
});

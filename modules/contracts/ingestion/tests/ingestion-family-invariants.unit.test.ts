import { describe, expect, it } from "../../../testing/node-test";

import * as ingestionContracts from "..";

describe("ingestion family invariants", () => {
  it("exports only ingestion-family surfaces from the family barrel", () => {
    expect(Object.keys(ingestionContracts).sort()).toEqual([
      "INGESTION_SOURCE_KINDS",
      "WEBSITE_HTML_ACQUISITION_MECHANISMS",
      "WEBSITE_INGESTION_MODES",
      "createIngestWebsitePageFailureResult",
      "createIngestWebsitePageRequest",
      "createIngestWebsitePageSuccessResult",
      "createIngestWebsitePagesBatchFailureResult",
      "createIngestWebsitePagesBatchRequest",
      "createIngestWebsitePagesBatchSuccessResult",
      "createRegisterStagedArtifactFailureResult",
      "createRegisterStagedArtifactRequest",
      "createRegisterStagedArtifactSuccessResult",
      "createStagedArtifactDescriptorFromStorageObjectDescriptor",
      "isIngestionSourceKind",
      "isWebsiteHtmlAcquisitionMechanism",
      "isWebsiteIngestionMode",
      "normalizeIngestWebsitePageSuccessValue",
      "normalizeIngestWebsitePagesBatchSuccessValue",
      "normalizeIngestionSourceKind",
      "normalizeOptionalWebsiteIngestionMode",
      "normalizeStagedArtifactDescriptor",
      "normalizeStagedArtifactDescriptorInput",
      "normalizeStagedArtifactStorageReference",
      "normalizeWebsiteHtmlAcquisitionMechanism",
      "normalizeWebsiteHtmlAcquisitionRequest",
      "normalizeWebsiteHtmlAcquisitionResult",
      "normalizeWebsiteIngestionMode",
      "normalizeWebsiteIngestionTarget",
    ]);
  });

  it("keeps staged-artifact registration semantics transport-neutral and storage-key aligned", () => {
    const request = ingestionContracts.createRegisterStagedArtifactRequest(
      new Uint8Array([1, 2, 3]),
      {
        descriptor: {
          storage: {
            key: " staged/uploads/object-1 ",
          },
          sourceKind: " Upload ",
          originalName: " kitten.png ",
        },
        requestId: "req-ingest-1",
      },
    );

    expect(request).toMatchObject({
      descriptor: {
        storage: {
          key: "staged/uploads/object-1",
        },
        sourceKind: "upload",
        originalName: "kitten.png",
      },
      content: new Uint8Array([1, 2, 3]),
      overwrite: undefined,
      requestId: "req-ingest-1",
      correlationId: undefined,
    });

    const result = ingestionContracts.createRegisterStagedArtifactSuccessResult({
      storage: {
        key: " staged/uploads/object-1 ",
      },
      sourceKind: " upload ",
      metadata: {
        surface: "test",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        storage: {
          key: "staged/uploads/object-1",
        },
        sourceKind: "upload",
        metadata: {
          surface: "test",
        },
      },
      requestId: undefined,
      correlationId: undefined,
    });
  });
});

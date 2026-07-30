import { describe, expect, it } from "../../../testing/node-test";

import * as ingestionContracts from "..";

describe("ingestion family invariants", () => {
  it("exports only ingestion-family surfaces from the family barrel", () => {
    expect(Object.keys(ingestionContracts).sort()).toEqual([
      "GOVERNED_WEBSITE_MAXIMUM_HTML_BYTES",
      "GOVERNED_WEBSITE_MAXIMUM_PAGES",
      "GOVERNED_WEBSITE_MAXIMUM_ROBOTS_BYTES",
      "GOVERNED_WEBSITE_MAXIMUM_SITEMAP_BYTES",
      "INGESTION_SOURCE_KINDS",
      "INGESTION_TASK_CHECKPOINT_RETENTION_MS",
      "INGESTION_TASK_LIST_LIMIT",
      "INGESTION_TASK_MAXIMUM_CHUNKS",
      "INGESTION_TASK_MAXIMUM_CHUNK_BYTES",
      "INGESTION_TASK_MAXIMUM_FILES",
      "INGESTION_TASK_MAXIMUM_FILE_BYTES",
      "INGESTION_TASK_MAXIMUM_TOTAL_BYTES",
      "INGESTION_TASK_RECOMMENDED_CHUNK_BYTES",
      "INGESTION_TASK_SCHEMA_VERSION",
      "INGESTION_TASK_TRANSPORT_ACTIONS",
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
      "normalizeGovernedWebsiteScopeRequest",
      "normalizeGovernedWebsiteUrl",
      "normalizeIngestWebsitePageSuccessValue",
      "normalizeIngestWebsitePagesBatchSuccessValue",
      "normalizeIngestionSha256Digest",
      "normalizeIngestionSourceId",
      "normalizeIngestionSourceKind",
      "normalizeIngestionSourceRefreshId",
      "normalizeIngestionSourceRefreshRecord",
      "normalizeIngestionSourceSnapshot",
      "normalizeIngestionSourceSnapshotId",
      "normalizeIngestionTaskFileId",
      "normalizeIngestionTaskId",
      "normalizeIngestionTaskRecord",
      "normalizeIngestionTaskTransportCommand",
      "normalizeIngestionTaskTransportValue",
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

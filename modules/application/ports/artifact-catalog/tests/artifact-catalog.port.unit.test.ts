import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";
import { createSuccessResult, type ContractResult } from "../../../../contracts/shared";
import type { ApplicationRequestContext } from "../../application-request-context";

import type {
  AppendArtifactCatalogRecordRequest,
  ArtifactCatalogAppendPort,
  ArtifactCatalogReadPort,
  BrowseArtifactCatalogRecordsRequest,
  ReadArtifactCatalogRecordRequest,
} from "..";

describe("artifact catalog application ports", () => {
  it("keeps explicit append/browse/read metadata seams for artifact catalog behavior", async () => {
    expectTypeOf<keyof ArtifactCatalogAppendPort>().toEqualTypeOf<"appendArtifactCatalogRecord">();
    expectTypeOf<keyof ArtifactCatalogReadPort>().toEqualTypeOf<
      "browseArtifactCatalogRecords" | "readArtifactCatalogRecord"
    >();

    expectTypeOf<Parameters<ArtifactCatalogAppendPort["appendArtifactCatalogRecord"]>[0]>().toExtend<
      AppendArtifactCatalogRecordRequest
    >();
    expectTypeOf<Parameters<ArtifactCatalogReadPort["browseArtifactCatalogRecords"]>[0]>().toExtend<
      BrowseArtifactCatalogRecordsRequest
    >();
    expectTypeOf<Parameters<ArtifactCatalogReadPort["readArtifactCatalogRecord"]>[0]>().toExtend<
      ReadArtifactCatalogRecordRequest
    >();
    expectTypeOf<Parameters<ArtifactCatalogAppendPort["appendArtifactCatalogRecord"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();
    expectTypeOf<Parameters<ArtifactCatalogReadPort["browseArtifactCatalogRecords"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();

    const appendPort: ArtifactCatalogAppendPort = {
      appendArtifactCatalogRecord: async (request) => createSuccessResult({ storageKey: request.record.storageKey }),
    };

    const readPort: ArtifactCatalogReadPort = {
      browseArtifactCatalogRecords: async () => createSuccessResult({ records: [] }),
      readArtifactCatalogRecord: async (request) =>
        createSuccessResult({
          record: {
            storageKey: request.storageKey,
            artifactFamily: "image",
            mediaType: "image/png",
          },
        }),
    };

    const append = await appendPort.appendArtifactCatalogRecord({
      record: { storageKey: "uploads/a.png", artifactFamily: "image" },
    });
    const browse = await readPort.browseArtifactCatalogRecords({ artifactFamily: "image" });
    const read = await readPort.readArtifactCatalogRecord({ storageKey: "uploads/a.png" });

    expectTypeOf<typeof append>().toEqualTypeOf<ContractResult<{ storageKey: string }>>();
    expect(append.ok).toBe(true);
    expect(browse.ok).toBe(true);
    expect(read.ok).toBe(true);
    expect("requestId" in { artifactFamily: "image" }).toBe(false);
  });
});

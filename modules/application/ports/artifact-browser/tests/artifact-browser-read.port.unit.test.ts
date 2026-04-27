import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";

import {
  createArtifactBrowserLocator,
  type ArtifactBrowseSuccessValue,
  type ArtifactContentReadSuccessValue,
  type ArtifactReadSuccessValue,
} from "../../../../contracts/artifact-browser";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
  type ContractResult,
} from "../../../../contracts/shared";
import type { StorageObjectMetadata } from "../../../../contracts/storage";

import type {
  ApplicationRequestContext,
  ArtifactBrowserContentReadPort,
  ArtifactBrowserMetadataReadPort,
  BrowseArtifactsRequest,
  ReadArtifactContentRequest,
  ReadArtifactDetailRequest,
} from "..";

describe("artifact browser application ports", () => {
  it("keeps metadata browse/detail and content-read seams thin and role-revealing", () => {
    expectTypeOf<keyof ArtifactBrowserMetadataReadPort>().toEqualTypeOf<
      "browseArtifacts" | "readArtifactDetail"
    >();
    expectTypeOf<keyof ArtifactBrowserContentReadPort>().toEqualTypeOf<"readArtifactContent">();

    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["browseArtifacts"]>[0]>().toExtend<
      BrowseArtifactsRequest
    >();
    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>[0]>().toExtend<
      ReadArtifactDetailRequest
    >();
    expectTypeOf<Parameters<ArtifactBrowserContentReadPort["readArtifactContent"]>[0]>().toExtend<
      ReadArtifactContentRequest
    >();

    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["browseArtifacts"]>[0]>().not.toExtend<{
      requestId: string;
      correlationId: string;
    }>();
    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["browseArtifacts"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();

    expectTypeOf<
      Awaited<ReturnType<ArtifactBrowserMetadataReadPort["browseArtifacts"]>>
    >().toEqualTypeOf<ContractResult<ArtifactBrowseSuccessValue>>();
    expectTypeOf<
      Awaited<ReturnType<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>>
    >().toEqualTypeOf<ContractResult<ArtifactReadSuccessValue<StorageObjectMetadata>>>();
    expectTypeOf<
      Awaited<ReturnType<ArtifactBrowserContentReadPort["readArtifactContent"]>>
    >().toEqualTypeOf<ContractResult<ArtifactContentReadSuccessValue>>();
  });

  it("keeps locator usage storage-key-based and path-agnostic for detail and content requests", async () => {
    const locator = createArtifactBrowserLocator(" staged/images/cat-1 ");

    const metadataPort: ArtifactBrowserMetadataReadPort = {
      browseArtifacts: async (request) =>
        createSuccessResult({
          items: [
            {
              storageKey: locator.storageKey,
              artifactFamily: request.artifactFamily,
              mediaType: "image/png",
            },
          ],
        }),
      readArtifactDetail: async () =>
        createSuccessResult({
          artifact: {
            locator,
            artifactFamily: "image",
            mediaType: "image/png",
          },
        }),
    };

    const contentPort: ArtifactBrowserContentReadPort = {
      readArtifactContent: async () =>
        createSuccessResult({
          content: {
            locator,
            mediaType: "image/png",
            sizeBytes: 4,
            availability: "available",
            retrieval: "inline",
          },
        }),
    };

    const detail = await metadataPort.readArtifactDetail({ locator });
    const content = await contentPort.readArtifactContent({ locator });

    expect(detail.ok).toBe(true);
    expect(content.ok).toBe(true);
    if (!detail.ok || !content.ok) {
      throw new Error("Expected successful detail/content responses.");
    }

    expect(detail.value.artifact.locator.storageKey).toBe("staged/images/cat-1");
    expect(content.value.content.locator.storageKey).toBe("staged/images/cat-1");
    expect("path" in detail.value.artifact.locator).toBe(false);
    expect("path" in content.value.content.locator).toBe(false);
    expect("bytes" in content.value.content).toBe(false);
    expect("content" in detail.value.artifact).toBe(false);
  });

  it("allows not-found failures for detail/content without collapsing contract families", async () => {
    const locator = createArtifactBrowserLocator("staged/images/missing-1");

    const metadataPort: ArtifactBrowserMetadataReadPort = {
      browseArtifacts: async () => createSuccessResult({ items: [] }),
      readArtifactDetail: async (request) =>
        createFailureResult(
          createContractError("not-found", `Artifact not found for ${request.locator.storageKey}.`),
        ),
    };

    const contentPort: ArtifactBrowserContentReadPort = {
      readArtifactContent: async (request) =>
        createFailureResult(
          createContractError(
            "not-found",
            `Artifact content not found for ${request.locator.storageKey}.`,
          ),
        ),
    };

    const detail = await metadataPort.readArtifactDetail({ locator });
    const content = await contentPort.readArtifactContent({ locator });

    expect(detail.ok).toBe(false);
    expect(content.ok).toBe(false);
    if (detail.ok || content.ok) {
      throw new Error("Expected not-found failures.");
    }

    expect(detail.error.code).toBe("not-found");
    expect(content.error.code).toBe("not-found");
  });
});

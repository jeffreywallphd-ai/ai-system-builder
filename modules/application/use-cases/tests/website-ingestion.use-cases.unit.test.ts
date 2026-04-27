import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";

import type { IngestWebsitePageRequest, WebsiteHtmlAcquisitionRequest } from "../../../contracts/ingestion";
import { createStoreArtifactSuccessResult, createStoreArtifactFailureResult } from "../../../contracts/storage";
import { createContractError } from "../../../contracts/shared";
import type { WebsiteHtmlAcquisitionPort } from "../../ports/ingestion";
import type { ArtifactObjectStoragePort } from "../../ports/storage";
import { IngestWebsitePageUseCase } from "../ingest-website-page.use-case";
import { IngestWebsitePagesBatchUseCase } from "../ingest-website-pages-batch.use-case";
import {
  mapAcquisitionResultToStorageDescriptorInput,
  mapDomainCommandToAcquisitionRequest,
  mapDomainResultToContractResult,
  mapIngestWebsitePageRequestToDomain,
  mapStoredWebsiteToStagedArtifactDescriptor,
} from "../website-ingestion/website-ingestion.mappers";

describe("website ingestion use cases", () => {
  it("orchestrates single-page ingestion with storage write and staged artifact derived from storage result", async () => {
    const acquireWebsiteHtml = testDouble
      .fn<WebsiteHtmlAcquisitionPort["acquireWebsiteHtml"]>()
      .mockResolvedValue({
        sourceKind: "scrape",
        resolvedUrl: "https://example.com/docs",
        html: "<html><body>hello</body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "simple-http",
        httpStatus: 200,
        contentTypeHeader: "text/html; charset=utf-8",
      });

    const storeArtifact = testDouble
      .fn<ArtifactObjectStoragePort["storeArtifact"]>()
      .mockResolvedValue(
        createStoreArtifactSuccessResult({
          key: "staged/real/object-1.html",
          mediaType: "text/html",
          sizeBytes: 123,
          checksum: { algorithm: "sha256", value: "abc" },
          metadata: {
            artifactFamily: "structured-text",
            sourceUrl: "https://example.com/docs",
            requestedMode: "automatic",
            acquisitionMechanismUsed: "simple-http",
          },
        }),
      );

    const useCase = new IngestWebsitePageUseCase({
      acquisition: { acquireWebsiteHtml },
      storage: {
        storeArtifact,
        retrieveArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      now: () => "2026-04-19T12:00:00.000Z",
    });

    const result = await useCase.execute({
      url: " https://example.com/docs ",
      mode: " automatic ",
    });

    expect(acquireWebsiteHtml).toHaveBeenCalledOnce();
    expect(storeArtifact).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.sourceKind).toBe("scrape");
    expect(result.value.acquisitionMechanismUsed).toBe("simple-http");
    expect(result.value.stagedArtifact?.storage.key).toBe("staged/real/object-1.html");
    expect(result.value.stagedArtifact?.storage.mediaType).toBe("text/html");
    expect(result.value.stagedArtifact?.originalName).toBe("example.com-docs.html");
    expect(result.value.stagedArtifact?.metadata).toMatchObject({
      artifactFamily: "structured-text",
      sourceUrl: "https://example.com/docs",
      requestedMode: "automatic",
      acquisitionMechanismUsed: "simple-http",
    });
  });

  it("returns failure when storage write fails", async () => {
    const useCase = new IngestWebsitePageUseCase({
      acquisition: {
        acquireWebsiteHtml: async () => ({
          sourceKind: "scrape",
          resolvedUrl: "https://example.com/docs",
          html: "<html><body>hello</body></html>",
          mediaType: "text/html",
          acquisitionMechanismUsed: "simple-http",
        }),
      },
      storage: {
        storeArtifact: async () =>
          createStoreArtifactFailureResult(createContractError("unavailable", "storage down")),
        retrieveArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
    });

    const result = await useCase.execute({ url: "https://example.com/docs" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: "unavailable", message: "storage down" });
    }
  });

  it("returns per-item batch results and continues on partial failures", async () => {
    const singlePage = new IngestWebsitePageUseCase({
      acquisition: {
        acquireWebsiteHtml: async (request) => {
          if (request.target.url.includes("fail")) {
            throw new Error("forced failure");
          }

          return {
            sourceKind: "scrape",
            resolvedUrl: request.target.url,
            html: `<html><body><main>${request.target.url}</main></body></html>`,
            mediaType: "text/html",
            acquisitionMechanismUsed: request.mode === "rendered" ? "rendered-browser" : "simple-http",
          };
        },
      },
      storage: {
        storeArtifact: async (request) =>
          createStoreArtifactSuccessResult({
            key: request.descriptor.key ?? "staged/website/default.html",
            mediaType: "text/html",
            sizeBytes: (request.content as Uint8Array).byteLength,
            metadata: request.descriptor.metadata,
          }),
        retrieveArtifact: testDouble.fn(),
        hasArtifact: testDouble.fn(),
        deleteArtifact: testDouble.fn(),
      },
      now: () => "2026-04-19T13:00:00.000Z",
    });

    const batchUseCase = new IngestWebsitePagesBatchUseCase({ ingestWebsitePage: singlePage });

    const result = await batchUseCase.execute({
      targets: [
        { url: " https://example.com/a " },
        { url: " https://example.com/fail " },
      ],
      mode: " automatic ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.summary).toEqual({
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(result.value.items.length).toBe(2);
    expect(result.value.items[0].result.ok).toBe(true);
    expect(result.value.items[1].result.ok).toBe(false);
  });

  it("maps contract requests into domain commands and domain results back to contracts", () => {
    const request: IngestWebsitePageRequest = {
      url: " https://example.com/path ",
      label: " Docs ",
      mode: " rendered ",
    };

    const domainCommand = mapIngestWebsitePageRequestToDomain(request);
    expect(domainCommand).toEqual({
      target: {
        url: "https://example.com/path",
        label: "Docs",
      },
      mode: "rendered",
    });

    const acquisitionRequest: WebsiteHtmlAcquisitionRequest = mapDomainCommandToAcquisitionRequest(domainCommand);
    expect(acquisitionRequest).toMatchObject({
      sourceKind: "scrape",
      target: { url: "https://example.com/path", label: "Docs" },
      mode: "rendered",
    });

    const storageDescriptorInput = mapAcquisitionResultToStorageDescriptorInput({
      command: domainCommand,
      acquisitionResult: {
        sourceKind: "scrape",
        resolvedUrl: "https://example.com/path",
        html: "<html>ok</html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
        httpStatus: 200,
        contentTypeHeader: "text/html",
      },
      retrievedAt: "2026-04-19T14:00:00.000Z",
    });

    const stagedArtifact = mapStoredWebsiteToStagedArtifactDescriptor({
      command: domainCommand,
      acquisitionResult: {
        sourceKind: "scrape",
        resolvedUrl: "https://example.com/path",
        html: "<html>ok</html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
      },
      storageDescriptor: {
        key: storageDescriptorInput.key ?? "staged/website/example.com/path.html",
        mediaType: "text/html",
        sizeBytes: 12,
        metadata: storageDescriptorInput.metadata,
      },
      expectedMetadata: storageDescriptorInput.metadata ?? {
        artifactFamily: "structured-text",
        sourceUrl: "https://example.com/path",
        resolvedUrl: "https://example.com/path",
        retrievedAt: "2026-04-19T14:00:00.000Z",
        requestedMode: "rendered",
        acquisitionMechanismUsed: "rendered-browser",
        rendered: true,
      },
    });

    const contractResult = mapDomainResultToContractResult({
      ingestion: {
        target: domainCommand.target,
        resolvedUrl: "https://example.com/path",
        acquisitionMechanismUsed: "rendered-browser",
      },
      stagedArtifact,
    });

    expect(contractResult.ok).toBe(true);
    if (!contractResult.ok) {
      return;
    }

    expect(contractResult.value.stagedArtifact?.storage.key).toContain("staged/website/example.com/path-");
    expect(contractResult.value.stagedArtifact?.storage.mediaType).toBe("text/html");
    expect(contractResult.value.stagedArtifact?.originalName).toBe("example.com-path.html");
    expect(contractResult.value.stagedArtifact?.metadata).toMatchObject({ artifactFamily: "structured-text", requestedMode: "rendered", acquisitionMechanismUsed: "rendered-browser" });
    expect(contractResult.value.sourceKind).toBe("scrape");
    expect(contractResult.value.acquisitionMechanismUsed).toBe("rendered-browser");
  });

  it("keeps ingestion use case dependent on ingestion+storage ports only", () => {
    const source = readFileSync(
      resolve("modules/application/use-cases/ingest-website-page.use-case.ts"),
      "utf8",
    );

    expect(source).toContain('import type { WebsiteHtmlAcquisitionPort } from "../ports/ingestion";');
    expect(source).toContain('import type { ArtifactObjectStoragePort } from "../ports/storage";');
    expect(source.includes("adapters/ingestion")).toBe(false);
    expect(source.includes("playwright")).toBe(false);
  });
});

import { describe, expect, it } from "../../../testing/node-test";

import {
  createIngestWebsitePageRequest,
  createIngestWebsitePageSuccessResult,
  createIngestWebsitePagesBatchRequest,
  createIngestWebsitePagesBatchSuccessResult,
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
} from "..";

describe("website ingestion contracts", () => {
  it("builds single-page website ingestion requests with normalized explicit target fields", () => {
    const request = createIngestWebsitePageRequest({
      url: " https://example.com/guide ",
      label: " Guide ",
      mode: " rendered ",
    });

    expect(request).toMatchObject({
      url: "https://example.com/guide",
      label: "Guide",
      mode: "rendered",
    });
  });

  it("builds explicit-list batch requests and rejects empty batch input", () => {
    const request = createIngestWebsitePagesBatchRequest({
      targets: [
        {
          url: " https://example.com/a ",
          label: " A ",
        },
        {
          url: " https://example.com/b ",
        },
      ],
      mode: " automatic ",
    });

    expect(request).toMatchObject({
      targets: [
        {
          url: "https://example.com/a",
          label: "A",
        },
        {
          url: "https://example.com/b",
        },
      ],
      mode: "automatic",
    });

    expect(() => createIngestWebsitePagesBatchRequest({ targets: [] })).toThrow(
      "Website batch ingestion request must include at least one target.",
    );
  });

  it("keeps single and batch result summaries aligned with staged artifact descriptors and scrape source-kind", () => {
    const pageResult = createIngestWebsitePageSuccessResult({
      target: {
        url: " https://example.com/a ",
      },
      resolvedUrl: " https://example.com/a?ref=canonical ",
      acquisitionMechanismUsed: " simple-http ",
      stagedArtifact: {
        sourceKind: " scrape ",
        storage: {
          key: " staged/web/example-a.html ",
        },
      },
      warnings: [" rendered fallback used ", " "],
    });

    expect(pageResult).toMatchObject({
      ok: true,
      value: {
        sourceKind: "scrape",
        target: {
          url: "https://example.com/a",
        },
        resolvedUrl: "https://example.com/a?ref=canonical",
        acquisitionMechanismUsed: "simple-http",
        stagedArtifact: {
          id: undefined,
          sourceKind: "scrape",
          originalName: undefined,
          createdAt: undefined,
          metadata: undefined,
          storage: {
            key: "staged/web/example-a.html",
            mediaType: undefined,
            sizeBytes: undefined,
            checksum: undefined,
          },
        },
        warnings: ["rendered fallback used"],
      },
      requestId: undefined,
      correlationId: undefined,
    });

    const batchResult = createIngestWebsitePagesBatchSuccessResult({
      items: [
        {
          target: pageResult.value.target,
          result: pageResult,
        },
      ],
      summary: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
      },
    });

    expect(batchResult.ok).toBe(true);
    if (batchResult.ok) {
      expect(batchResult.value.summary).toEqual({
        attempted: 1,
        succeeded: 1,
        failed: 0,
      });
    }
  });

  it("normalizes acquisition request/result shape for adapter-facing boundaries", () => {
    const acquisitionRequest = normalizeWebsiteHtmlAcquisitionRequest({
      target: {
        url: " https://example.com/page ",
      },
      mode: " automatic ",
    });

    expect(acquisitionRequest).toMatchObject({
      target: {
        url: "https://example.com/page",
      },
      mode: "automatic",
      sourceKind: "scrape",
    });

    const acquisitionResult = normalizeWebsiteHtmlAcquisitionResult({
      resolvedUrl: " https://example.com/page ",
      html: " <html><body>ok</body></html> ",
      mediaType: " text/html ",
      acquisitionMechanismUsed: " rendered-browser ",
      httpStatus: 200,
      contentTypeHeader: " text/html; charset=utf-8 ",
    });

    expect(acquisitionResult).toEqual({
      sourceKind: "scrape",
      resolvedUrl: "https://example.com/page",
      html: "<html><body>ok</body></html>",
      mediaType: "text/html",
      acquisitionMechanismUsed: "rendered-browser",
      httpStatus: 200,
      contentTypeHeader: "text/html; charset=utf-8",
    });
  });
});

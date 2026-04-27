import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL,
  createDesktopIngestWebsitePageRequest,
  createDesktopIngestWebsitePagesBatchRequest,
  createDesktopIngestWebsitePageSuccessResponse,
  getDesktopIngestWebsitePageChannel,
  getDesktopIngestWebsitePagesBatchChannel,
} from "..";

describe("desktop website ingestion ipc contract", () => {
  it("defines page and batch operation/channel identities", () => {
    expect(DESKTOP_INGEST_WEBSITE_PAGE_OPERATION).toBe("artifact.ingest-website-page");
    expect(DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL).toEqual({
      operation: "artifact.ingest-website-page",
      kind: "request",
      value: "ipc.artifact.ingest-website-page.request",
    });
    expect(DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL).toEqual({
      operation: "artifact.ingest-website-page",
      kind: "response",
      value: "ipc.artifact.ingest-website-page.response",
    });
    expect(getDesktopIngestWebsitePageChannel("request")).toEqual(DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL);

    expect(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION).toBe("artifact.ingest-website-pages-batch");
    expect(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL).toEqual({
      operation: "artifact.ingest-website-pages-batch",
      kind: "request",
      value: "ipc.artifact.ingest-website-pages-batch.request",
    });
    expect(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL).toEqual({
      operation: "artifact.ingest-website-pages-batch",
      kind: "response",
      value: "ipc.artifact.ingest-website-pages-batch.response",
    });
    expect(getDesktopIngestWebsitePagesBatchChannel("response")).toEqual(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL);
  });

  it("normalizes single-page and batch request payloads", () => {
    const pageRequest = createDesktopIngestWebsitePageRequest({
      request: { url: " https://example.com/docs ", mode: " rendered " },
      boundary: { host: "desktop", source: " desktop.renderer.artifact-upload.form " },
    });

    expect(pageRequest.payload.request).toEqual({ url: "https://example.com/docs", mode: "rendered", label: undefined });
    expect(pageRequest.payload.boundary.source).toBe("desktop.renderer.artifact-upload.form");

    const batchRequest = createDesktopIngestWebsitePagesBatchRequest({
      request: {
        targets: [{ url: " https://example.com/a " }, { url: " https://example.com/b " }],
        mode: " automatic ",
      },
      boundary: { host: "desktop", source: " desktop.renderer.artifact-upload.form " },
    });

    expect(batchRequest.payload.request.targets.map((target) => target.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("builds success envelopes", () => {
    const response = createDesktopIngestWebsitePageSuccessResponse({
      target: { url: "https://example.com" },
      resolvedUrl: "https://example.com",
      acquisitionMechanismUsed: "simple-http",
      sourceKind: "scrape",
    });

    expect(response).toMatchObject({
      ok: true,
      operation: "artifact.ingest-website-page",
      channel: "ipc.artifact.ingest-website-page.response",
      value: {
        result: {
          acquisitionMechanismUsed: "simple-http",
        },
      },
    });
  });
});

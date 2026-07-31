import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  registerWebsiteIngestionApiRoutes,
  type IngestWebsitePageUseCasePort,
  type IngestWebsitePagesBatchUseCasePort,
  type WebsiteIngestionExpressRoutePort,
} from "../website-ingestion/registerWebsiteIngestionApiRoutes";

describe("registerWebsiteIngestionApiRoutes", () => {
  it("registers website page ingestion and forwards workspace context", async () => {
    const handlers = new Map<string, Parameters<WebsiteIngestionExpressRoutePort["post"]>[1]>();
    const app: WebsiteIngestionExpressRoutePort = {
      post: testDouble.fn((path, handler) => {
        handlers.set(path, handler);
      }),
    };
    const ingestWebsitePageUseCase: IngestWebsitePageUseCasePort = {
      execute: testDouble.fn().mockResolvedValue({
        ok: true,
        value: {
          sourceKind: "scrape",
          target: { url: "https://example.com" },
          resolvedUrl: "https://example.com",
          acquisitionMechanismUsed: "simple-http",
          stagedArtifact: {
            sourceKind: "scrape",
            storage: { key: "workspaces/workspace-a/artifacts/files/uploads/example.html" },
          },
        },
      }),
    };
    const ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCasePort = {
      execute: testDouble.fn(),
    };
    registerWebsiteIngestionApiRoutes({
      app,
      ingestWebsitePageUseCase,
      ingestWebsitePagesBatchUseCase,
    });

    const json = testDouble.fn();
    const status = testDouble.fn().mockReturnValue({ json });
    await handlers.get("/api/artifact/ingest-website-page")?.(
      {
        body: {
          workspaceId: "workspace-a",
          request: { url: "https://example.com", mode: "automatic" },
        },
        headers: {
          "x-request-id": "req-scrape-1",
          "x-correlation-id": "corr-scrape-1",
        },
      },
      { status, json },
    );

    expect(ingestWebsitePageUseCase.execute).toHaveBeenCalledWith(
      { url: "https://example.com", mode: "automatic" },
      {
        requestId: "req-scrape-1",
        correlationId: "corr-scrape-1",
        workspaceId: "workspace-a",
      },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      ok: true,
      operation: "artifact.ingest-website-page",
      value: {
        result: { resolvedUrl: "https://example.com" },
      },
    });
  });

  it("rejects website batch ingestion without workspace context", async () => {
    const handlers = new Map<string, Parameters<WebsiteIngestionExpressRoutePort["post"]>[1]>();
    const app: WebsiteIngestionExpressRoutePort = {
      post: testDouble.fn((path, handler) => {
        handlers.set(path, handler);
      }),
    };
    const ingestWebsitePageUseCase: IngestWebsitePageUseCasePort = {
      execute: testDouble.fn(),
    };
    const ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCasePort = {
      execute: testDouble.fn(),
    };
    registerWebsiteIngestionApiRoutes({
      app,
      ingestWebsitePageUseCase,
      ingestWebsitePagesBatchUseCase,
    });

    const json = testDouble.fn();
    const status = testDouble.fn().mockReturnValue({ json });
    await handlers.get("/api/artifact/ingest-website-pages-batch")?.(
      {
        body: {
          request: { targets: [{ url: "https://example.com" }], mode: "automatic" },
        },
        headers: {},
      },
      { status, json },
    );

    expect(ingestWebsitePagesBatchUseCase.execute).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      ok: false,
      operation: "artifact.ingest-website-pages-batch",
      error: { code: "validation" },
    });
  });
});

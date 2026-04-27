import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  createDesktopIngestWebsitePageRequest,
  createDesktopIngestWebsitePagesBatchRequest,
} from "../../../../contracts/ipc";
import { createContractError } from "../../../../contracts/shared";
import {
  createDesktopIngestWebsitePageIpcHandler,
  registerWebsiteIngestionIpc,
  type IngestWebsitePageUseCasePort,
  type IngestWebsitePagesBatchUseCasePort,
  type RegisterWebsiteIngestionIpcDependencies,
} from "../website-ingestion/registerWebsiteIngestionIpc";

function createDependencies(overrides?: Partial<RegisterWebsiteIngestionIpcDependencies>): RegisterWebsiteIngestionIpcDependencies {
  return {
    ipcMain: { handle: testDouble.fn() },
    ingestWebsitePageUseCase: {
      execute: testDouble.fn<IngestWebsitePageUseCasePort["execute"]>(),
    },
    ingestWebsitePagesBatchUseCase: {
      execute: testDouble.fn<IngestWebsitePagesBatchUseCasePort["execute"]>(),
    },
    ...overrides,
  };
}

describe("registerWebsiteIngestionIpc", () => {
  it("maps single-page request/context and returns success envelope", async () => {
    const execute = testDouble.fn<IngestWebsitePageUseCasePort["execute"]>().mockResolvedValue({
      ok: true,
      value: {
        target: { url: "https://example.com" },
        resolvedUrl: "https://example.com",
        acquisitionMechanismUsed: "simple-http",
        sourceKind: "scrape",
      },
      requestId: "req-web-1",
      correlationId: "corr-web-1",
    });

    const handler = createDesktopIngestWebsitePageIpcHandler({ execute });
    const response = await handler({}, createDesktopIngestWebsitePageRequest({
      request: { url: "https://example.com" },
      boundary: { host: "desktop", source: "desktop.renderer.artifact-upload.form" },
    }, { requestId: "req-web-1", correlationId: "corr-web-1" }));

    expect(execute).toHaveBeenCalledWith(
      { url: "https://example.com", label: undefined, mode: undefined },
      { requestId: "req-web-1", correlationId: "corr-web-1" },
    );
    expect(response).toMatchObject({ ok: true, operation: "artifact.ingest-website-page" });
  });

  it("maps single-page failures to ipc failures", async () => {
    const execute = testDouble.fn<IngestWebsitePageUseCasePort["execute"]>().mockResolvedValue({
      ok: false,
      error: createContractError("validation", "bad url"),
    });
    const handler = createDesktopIngestWebsitePageIpcHandler({ execute });

    const response = await handler({}, createDesktopIngestWebsitePageRequest({
      request: { url: "https://example.com" },
      boundary: { host: "desktop", source: "desktop.renderer.artifact-upload.form" },
    }));

    expect(response.ok).toBe(false);
  });

  it("registers both website ingestion IPC channels", () => {
    const channels: string[] = [];
    const dependencies = createDependencies({
      ipcMain: {
        handle: testDouble.fn((channel: string) => {
          channels.push(channel);
        }),
      },
    });

    registerWebsiteIngestionIpc(dependencies);

    expect(channels).toEqual([
      DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value,
      DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value,
    ]);
  });

  it("invokes batch use case from registered handler", async () => {
    let batchHandler:
      | ((event: unknown, request: ReturnType<typeof createDesktopIngestWebsitePagesBatchRequest>) => Promise<unknown>)
      | undefined;

    const ingestWebsitePagesBatchUseCase = {
      execute: testDouble.fn<IngestWebsitePagesBatchUseCasePort["execute"]>().mockResolvedValue({
        ok: true,
        value: {
          items: [],
          summary: { attempted: 0, succeeded: 0, failed: 0 },
        },
      }),
    };

    registerWebsiteIngestionIpc(createDependencies({
      ipcMain: {
        handle: testDouble.fn((channel: string, listener: (event: unknown, request: ReturnType<typeof createDesktopIngestWebsitePagesBatchRequest>) => Promise<unknown>) => {
          if (channel === DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value) {
            batchHandler = listener;
          }
        }),
      },
      ingestWebsitePagesBatchUseCase,
    }));

    await batchHandler?.({}, createDesktopIngestWebsitePagesBatchRequest({
      request: { targets: [{ url: "https://example.com" }] },
      boundary: { host: "desktop", source: "desktop.renderer.artifact-upload.form" },
    }));

    expect(ingestWebsitePagesBatchUseCase.execute).toHaveBeenCalled();
  });
});

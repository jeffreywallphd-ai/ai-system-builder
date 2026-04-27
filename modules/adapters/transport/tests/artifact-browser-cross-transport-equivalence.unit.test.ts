import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createDesktopArtifactContentReadRequest,
} from "../../../contracts/ipc";
import {
  createDesktopArtifactContentReadIpcHandler,
} from "../ipc-electron/artifact-browser/registerArtifactBrowserIpc";
import {
  registerArtifactBrowserApiRoutes,
  type ExpressRoutePort,
} from "../api-express/artifact-browser/registerArtifactBrowserApiRoutes";
import type { ReadArtifactContentUseCasePort } from "../../../application/use-cases";

async function invokeApiArtifactContentReadRoute(
  execute: ReturnType<typeof testDouble.fn<ReadArtifactContentUseCasePort["execute"]>>,
) {
  let registeredHandler:
    | ((
      request: Parameters<Parameters<ExpressRoutePort["post"]>[1]>[0],
      response: Parameters<Parameters<ExpressRoutePort["post"]>[1]>[1],
    ) => Promise<void>)
    | undefined;
  const app: ExpressRoutePort = {
    post: testDouble.fn((path, handler) => {
      if (path === "/api/artifact/content/read") {
        registeredHandler = handler;
      }
    }),
    get: testDouble.fn(),
  };
  registerArtifactBrowserApiRoutes({
    app,
    browseArtifactsUseCase: { execute: testDouble.fn() },
    readArtifactDetailUseCase: { execute: testDouble.fn() },
    readArtifactContentUseCase: { execute },
    artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: testDouble.fn() },
  });

  const response = {
    status: testDouble.fn(() => response),
    json: testDouble.fn(),
  };

  await registeredHandler?.(
    {
      body: {
        locator: { storageKey: "uploads/cat.png" },
        source: "shared.artifact-browser",
      },
      headers: {
        "x-request-id": "req-artifact-1",
        "x-correlation-id": "corr-artifact-1",
      },
    },
    response,
  );
}

describe("artifact browser cross-transport equivalence", () => {
  it("maps equivalent IPC and API artifact.content.read inputs into the same command/context shape", async () => {
    const executeFromIpc = testDouble
      .fn<ReadArtifactContentUseCasePort["execute"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          content: {
            locator: { storageKey: "uploads/cat.png" },
            availability: "available",
            retrieval: "deferred",
          },
        },
      });

    const ipcHandler = createDesktopArtifactContentReadIpcHandler({
      execute: executeFromIpc,
    });

    await ipcHandler(
      {},
      createDesktopArtifactContentReadRequest(
        {
          locator: { storageKey: "uploads/cat.png" },
          boundary: { host: "desktop", source: "shared.artifact-browser" },
        },
        {
          requestId: "req-artifact-1",
          correlationId: "corr-artifact-1",
        },
      ),
    );

    const executeFromApi = testDouble
      .fn<ReadArtifactContentUseCasePort["execute"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          content: {
            locator: { storageKey: "uploads/cat.png" },
            availability: "available",
            retrieval: "deferred",
          },
        },
      });
    await invokeApiArtifactContentReadRoute(executeFromApi);

    expect(executeFromIpc).toHaveBeenCalledWith(
      { locator: { storageKey: "uploads/cat.png" } },
      { requestId: "req-artifact-1", correlationId: "corr-artifact-1" },
    );
    expect(executeFromApi).toHaveBeenCalledWith(
      { locator: { storageKey: "uploads/cat.png" } },
      { requestId: "req-artifact-1", correlationId: "corr-artifact-1" },
    );
  });
});

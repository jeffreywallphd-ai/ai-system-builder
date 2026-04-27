import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { createDesktopArtifactUploadRequest } from "../../../contracts/ipc";
import { createContractError } from "../../../contracts/shared";
import {
  createDesktopArtifactUploadIpcHandler,
  type StoreArtifactUploadUseCasePort as IpcStoreArtifactUploadUseCasePort,
} from "../ipc-electron/artifact-upload/registerArtifactUploadIpc";
import {
  registerArtifactUploadApiRoute,
  type ExpressPostRoutePort,
  type StoreArtifactUploadUseCasePort as ApiStoreArtifactUploadUseCasePort,
} from "../api-express/artifact-upload/registerArtifactUploadApiRoute";

function createIpcUseCaseStub(
  executeImpl?: ReturnType<typeof testDouble.fn<IpcStoreArtifactUploadUseCasePort["execute"]>>,
): IpcStoreArtifactUploadUseCasePort {
  return {
    execute:
      executeImpl
      ?? testDouble
        .fn<IpcStoreArtifactUploadUseCasePort["execute"]>()
        .mockRejectedValue(new Error("Missing execute mock implementation.")),
  };
}

function createApiUseCaseStub(
  executeImpl?: ReturnType<typeof testDouble.fn<ApiStoreArtifactUploadUseCasePort["execute"]>>,
): ApiStoreArtifactUploadUseCasePort {
  return {
    execute:
      executeImpl
      ?? testDouble
        .fn<ApiStoreArtifactUploadUseCasePort["execute"]>()
        .mockRejectedValue(new Error("Missing execute mock implementation.")),
    getAcceptedUploadPolicy: testDouble
      .fn<ApiStoreArtifactUploadUseCasePort["getAcceptedUploadPolicy"]>()
      .mockImplementation(() => ({
        acceptedMediaTypes: ["image/png"],
        acceptedExtensions: [".png"],
      })),
  };
}

async function invokeApiUploadRoute(
  execute: ReturnType<typeof testDouble.fn<ApiStoreArtifactUploadUseCasePort["execute"]>>,
) {
  let registeredHandler:
    | ((
      request: Parameters<Parameters<ExpressPostRoutePort["post"]>[1]>[0],
      response: Parameters<Parameters<ExpressPostRoutePort["post"]>[1]>[1],
    ) => Promise<void>)
    | undefined;
  const app: ExpressPostRoutePort = {
    get: testDouble.fn(),
    post: testDouble.fn((_, handler) => {
      registeredHandler = handler;
    }),
  };

  registerArtifactUploadApiRoute({
    app,
    storeArtifactUploadUseCase: createApiUseCaseStub(execute),
  });

  const json = testDouble.fn();
  const routeResponse = {
    status: testDouble.fn((_: number) => routeResponse),
    json,
  };

  await registeredHandler?.(
    {
      body: {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: [137, 80, 78, 71],
        source: "shared.upload.form",
      },
      headers: {
        "x-request-id": "req-transport-1",
        "x-correlation-id": "corr-transport-1",
      },
    },
    routeResponse,
  );

  return {
    status: routeResponse.status,
    json,
  };
}

describe("artifact upload cross-transport equivalence", () => {
  it("maps equivalent IPC and API upload input into the same application command shape", async () => {
    const executeFromIpc = testDouble
      .fn<IpcStoreArtifactUploadUseCasePort["execute"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      });
    const ipcHandler = createDesktopArtifactUploadIpcHandler(createIpcUseCaseStub(executeFromIpc));

    await ipcHandler(
      {},
      createDesktopArtifactUploadRequest(
        {
          fileName: "cat.png",
          mediaType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
          boundary: {
            host: "desktop",
            source: "shared.upload.form",
          },
        },
        {
          requestId: "req-transport-1",
          correlationId: "corr-transport-1",
        },
      ),
    );

    const executeFromApi = testDouble
      .fn<ApiStoreArtifactUploadUseCasePort["execute"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      });
    await invokeApiUploadRoute(executeFromApi);

    expect(executeFromIpc).toHaveBeenCalledWith(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      {
        source: "shared.upload.form",
      },
      {
        requestId: "req-transport-1",
        correlationId: "corr-transport-1",
      },
    );
    expect(executeFromApi).toHaveBeenCalledWith(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      {
        source: "shared.upload.form",
      },
      {
        requestId: "req-transport-1",
        correlationId: "corr-transport-1",
      },
    );
  });

  it("preserves equivalent success and failure semantics across IPC and API response envelopes", async () => {
    const ipcSuccess = await createDesktopArtifactUploadIpcHandler(
      createIpcUseCaseStub(
        testDouble.fn<IpcStoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
          ok: true,
          value: {
            storage: {
              key: "uploads/cat.png",
              mediaType: "image/png",
              sizeBytes: 4,
            },
            sourceKind: "upload",
          },
          requestId: "req-transport-2",
          correlationId: "corr-transport-2",
        }),
      ),
    )(
      {},
      createDesktopArtifactUploadRequest(
        {
          fileName: "cat.png",
          mediaType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
          boundary: {
            host: "desktop",
            source: "shared.upload.form",
          },
        },
        {
          requestId: "req-transport-2",
          correlationId: "corr-transport-2",
        },
      ),
    );

    const apiSuccessCall = await invokeApiUploadRoute(
      testDouble.fn<ApiStoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
        ok: true,
        value: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
        requestId: "req-transport-2",
        correlationId: "corr-transport-2",
      }),
    );

    expect(ipcSuccess.ok).toBe(true);
    expect(apiSuccessCall.status).toHaveBeenCalledWith(200);
    const apiSuccessBody = apiSuccessCall.json.mock.calls[0]?.[0];
    expect(apiSuccessBody).toMatchObject({
      ok: true,
      operation: "artifact.upload",
      requestId: "req-transport-2",
      correlationId: "corr-transport-2",
      value: {
        descriptor: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      },
    });

    const ipcFailure = await createDesktopArtifactUploadIpcHandler(
      createIpcUseCaseStub(
        testDouble.fn<IpcStoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
          ok: false,
          error: createContractError("validation", "Artifact type is not accepted: application/pdf."),
          requestId: "req-transport-3",
          correlationId: "corr-transport-3",
        }),
      ),
    )(
      {},
      createDesktopArtifactUploadRequest(
        {
          fileName: "cat.png",
          mediaType: "image/png",
          bytes: new Uint8Array([137, 80, 78, 71]),
          boundary: {
            host: "desktop",
            source: "shared.upload.form",
          },
        },
        {
          requestId: "req-transport-3",
          correlationId: "corr-transport-3",
        },
      ),
    );

    const apiFailureCall = await invokeApiUploadRoute(
      testDouble.fn<ApiStoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
        ok: false,
        error: createContractError("validation", "Artifact type is not accepted: application/pdf."),
        requestId: "req-transport-3",
        correlationId: "corr-transport-3",
      }),
    );

    expect(ipcFailure).toMatchObject({
      ok: false,
      operation: "artifact.upload",
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });
    expect(apiFailureCall.status).toHaveBeenCalledWith(400);
    const apiFailureBody = apiFailureCall.json.mock.calls[0]?.[0];
    expect(apiFailureBody).toMatchObject({
      ok: false,
      operation: "artifact.upload",
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });
  });
});

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  createDesktopArtifactUploadRequest,
} from "../../../../contracts/ipc";
import { createContractError } from "../../../../contracts/shared";
import {
  createDesktopArtifactUploadIpcHandler,
  registerArtifactUploadIpc,
  type IpcMainHandlePort,
  type StoreArtifactUploadUseCasePort,
} from "../artifact-upload/registerArtifactUploadIpc";

function createUseCaseStub(
  executeImpl?: ReturnType<typeof testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>>,
): StoreArtifactUploadUseCasePort {
  return {
    execute:
      executeImpl ??
      testDouble
        .fn<StoreArtifactUploadUseCasePort["execute"]>()
        .mockRejectedValue(new Error("Missing execute mock implementation.")),
    getAcceptedUploadPolicy: testDouble
      .fn<StoreArtifactUploadUseCasePort["getAcceptedUploadPolicy"]>()
      .mockImplementation(() => ({
        acceptedMediaTypes: ["image/png"],
        acceptedExtensions: [".png"],
      })),
  };
}

describe("registerArtifactUploadIpc desktop artifact upload handler", () => {
  it("maps request payload and context into the upload use case and returns a success response", async () => {
    const execute = testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
      ok: true,
      value: {
        storage: {
          key: "uploads/kitten.png",
          mediaType: "image/png",
          sizeBytes: 4,
        },
        sourceKind: "upload",
      },
      requestId: "req-upload-1",
      correlationId: "corr-upload-1",
    });

    const handler = createDesktopArtifactUploadIpcHandler(createUseCaseStub(execute));
    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "kitten.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );

    const response = await handler({}, request);

    expect(execute).toHaveBeenCalledWith(
      {
        fileName: "kitten.png",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      {
        source: "desktop.renderer.artifact-upload.form",
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );
    expect(response).toMatchObject({
      ok: true,
      value: {
        descriptor: {
          storage: {
            key: "uploads/kitten.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
          sourceKind: "upload",
        },
      },
      requestId: "req-upload-1",
      correlationId: "corr-upload-1",
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
    });
  });

  it("maps use-case failures to a structured ipc failure response envelope", async () => {
    const execute = testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
      ok: false,
      error: createContractError("validation", "Artifact type is not accepted: application/pdf.", {
        details: {
          field: "mediaType",
        },
      }),
      requestId: "req-upload-2",
      correlationId: "corr-upload-2",
    });

    const handler = createDesktopArtifactUploadIpcHandler(createUseCaseStub(execute));
    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "brochure.pdf",
        mediaType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      {
        requestId: "req-upload-2",
        correlationId: "corr-upload-2",
      },
    );

    const response = await handler({}, request);

    expect(response).toEqual({
      ok: false,
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
        details: {
          field: "mediaType",
        },
        requestId: "req-upload-2",
        correlationId: "corr-upload-2",
        metadata: undefined,
        operation: "artifact.upload",
        channel: "ipc.artifact.upload.response",
      },
      requestId: "req-upload-2",
      correlationId: "corr-upload-2",
      metadata: undefined,
    });
  });

  it("registers upload channels and delegates upload handler execution", async () => {
    let registeredHandler:
      | ((event: unknown, request: ReturnType<typeof createDesktopArtifactUploadRequest>) => Promise<unknown>)
      | undefined;
    const registeredChannels: string[] = [];
    const ipcMain: IpcMainHandlePort = {
      handle: testDouble.fn((channel: string, listener: Parameters<IpcMainHandlePort["handle"]>[1]) => {
        registeredChannels.push(channel);
        if (channel === DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value) {
          registeredHandler = listener;
        }
      }),
    };
    const execute = testDouble.fn<StoreArtifactUploadUseCasePort["execute"]>().mockResolvedValue({
      ok: true,
      value: {
        storage: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 16,
        },
        sourceKind: "upload",
      },
      requestId: "req-upload-3",
    });

    registerArtifactUploadIpc({
      ipcMain,
      storeArtifactUploadUseCase: createUseCaseStub(execute),
    });

    expect(ipcMain.handle).toHaveBeenCalledTimes(2);
    expect(registeredChannels).toContain(DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value);
    expect(registeredHandler).toBeDefined();
    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3, 4]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      {
        requestId: "req-upload-3",
      },
    );

    const response = await registeredHandler?.({}, request);

    expect(response).toMatchObject({
      ok: true,
      channel: "ipc.artifact.upload.response",
      operation: "artifact.upload",
    });
    expect(execute).toHaveBeenCalledWith(
      {
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
      {
        source: "desktop.renderer.artifact-upload.form",
      },
      {
        requestId: "req-upload-3",
        correlationId: undefined,
      },
    );
  });
});


describe("registerElectronIpc top-level aggregator surface", () => {
  it("remains a tiny registration-only aggregator without feature helper re-exports", () => {
    const aggregatorTypeScriptPath = fileURLToPath(new URL("../registerElectronIpc.ts", import.meta.url));
    const aggregatorPath = existsSync(aggregatorTypeScriptPath)
      ? aggregatorTypeScriptPath
      : aggregatorTypeScriptPath.replace(/\.ts$/, ".js");
    const source = readFileSync(aggregatorPath, "utf8");

    expect(source).not.toContain("export type");
    expect(source).not.toContain("mapIpcRequestPayload");
    expect(source).not.toContain("mapStoreArtifactUploadResultToIpcResponse");
    expect(source).not.toContain("createDesktopArtifactUploadIpcHandler");
  });
});

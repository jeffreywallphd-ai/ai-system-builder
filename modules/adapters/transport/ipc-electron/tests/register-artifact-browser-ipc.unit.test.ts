import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL,
  createDesktopArtifactBrowseRequest,
  createDesktopArtifactContentReadRequest,
  createDesktopArtifactMediaViewRequest,
  createDesktopArtifactPublishRequest,
  createDesktopArtifactPublishVerifyRequest,
  createDesktopArtifactSourceVerifyRequest,
  createDesktopArtifactRegisterFromRepoRequest,
  createDesktopArtifactLocalizeFromRepoRequest,
  createDesktopArtifactReadRequest,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import {
  createDesktopArtifactRegisterFromRepoIpcHandler,
  createDesktopArtifactPublishIpcHandler,
  createDesktopArtifactPublishVerifyIpcHandler,
  mapDesktopArtifactRequestContext,
  mapReadArtifactContentResultToDesktopResponse,
  registerArtifactBrowserIpc,
  type IpcMainHandlePort,
} from "../artifact-browser/registerArtifactBrowserIpc";

function createUseCases() {
  return {
    browseArtifactsUseCase: { execute: testDouble.fn() },
    browseUnregisteredArtifactsUseCase: { execute: testDouble.fn() },
    registerUnregisteredArtifactUseCase: { execute: testDouble.fn() },
    deleteUnregisteredArtifactUseCase: { execute: testDouble.fn() },
    readArtifactDetailUseCase: { execute: testDouble.fn() },
    readArtifactContentUseCase: { execute: testDouble.fn() },
    artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: testDouble.fn() },
    publishArtifactToRepoUseCase: { execute: testDouble.fn() },
    browseHuggingFaceNamespaceDatasetsUseCase: { execute: testDouble.fn() },
    browseHuggingFaceDatasetParquetFilesUseCase: { execute: testDouble.fn() },
    verifyPublishedArtifactBackingUseCase: { execute: testDouble.fn() },
    verifyImportedArtifactSourceBackingUseCase: { execute: testDouble.fn() },
    registerArtifactFromRepoUseCase: { execute: testDouble.fn() },
    localizeArtifactFromRepoUseCase: { execute: testDouble.fn() },
    getHuggingFaceTokenStatus: testDouble.fn(() => ({ configured: false })),
    setHuggingFaceToken: testDouble.fn(() => ({ configured: true, maskedToken: "••••1234" })),
    clearHuggingFaceToken: testDouble.fn(() => ({ configured: false })),
  };
}

describe("registerArtifactBrowserIpc", () => {
  it("registers browse/read/content channels and delegates to focused use case ports", async () => {
    const handlers = new Map<string, Parameters<IpcMainHandlePort["handle"]>[1]>();
    const ipcMain: IpcMainHandlePort = {
      handle: testDouble.fn((channel, listener) => {
        handlers.set(channel, listener);
      }),
    };

    const dependencies = createUseCases();
    (dependencies.browseArtifactsUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: { items: [] },
    });
    (dependencies.readArtifactDetailUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        artifact: {
          locator: { storageKey: "uploads/a.png" },
          artifactFamily: "image",
        },
      },
    });
    (dependencies.readArtifactContentUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        content: {
          locator: { storageKey: "uploads/a.png" },
          availability: "available",
          retrieval: "deferred",
        },
      },
    });

    (dependencies.artifactMediaViewRetrieval.retrieveArtifactViewerMediaByStorageKey as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: { storageKey: "uploads/a.png", mediaType: "image/png", bytes: new Uint8Array([1]) },
    });
    (dependencies.publishArtifactToRepoUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
          revision: "main",
          locator: "openai/demo/images/a.png",
        },
        verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
      },
    });
    (dependencies.verifyPublishedArtifactBackingUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
          revision: "main",
          locator: "openai/demo/images/a.png",
        },
        verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
      },
    });
    (dependencies.verifyImportedArtifactSourceBackingUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
          revision: "main",
          locator: "openai/demo/images/a.png",
        },
        verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
      },
    });
    (dependencies.registerArtifactFromRepoUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        artifactId: "artifacts/20260418000000-import001",
        backing: {
          role: "imported-source",
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/a.png",
            revision: "main",
            locator: "openai/demo/images/a.png",
          },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      },
    });
    (dependencies.localizeArtifactFromRepoUseCase.execute as ReturnType<typeof testDouble.fn>).mockResolvedValue({
      ok: true,
      value: {
        artifactId: "artifacts/20260418000000-local01",
        localObject: {
          key: "artifacts/20260418000000-local01",
          mediaType: "image/png",
          sizeBytes: 1,
        },
        source: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
          revision: "main",
          locator: "openai/demo/images/a.png",
        },
        localizedAt: "2026-04-18T00:00:00.000Z",
      },
    });

    registerArtifactBrowserIpc({ ipcMain, ...dependencies });

    expect(ipcMain.handle).toHaveBeenCalledTimes(18);
    expect(handlers.has(DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value)).toBe(true);
    expect(handlers.has(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value)).toBe(true);

    await handlers.get(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactBrowseRequest({
        artifactFamily: "image",
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactReadRequest({
        locator: { storageKey: "uploads/a.png" },
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactContentReadRequest({
        locator: { storageKey: "uploads/a.png" },
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactMediaViewRequest({
        storageKey: "uploads/a.png",
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactPublishRequest({
        artifactId: "uploads/a.png",
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
        },
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactPublishVerifyRequest({
        artifactId: "uploads/a.png",
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactSourceVerifyRequest({
        artifactId: "uploads/a.png",
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactRegisterFromRepoRequest({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
        },
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );
    await handlers.get(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value)?.(
      {},
      createDesktopArtifactLocalizeFromRepoRequest({
        artifactId: "artifacts/20260418000000-local01",
        boundary: { host: "desktop", source: "desktop.renderer" },
      }),
    );

    expect(dependencies.browseArtifactsUseCase.execute).toHaveBeenCalledWith(
      { artifactFamily: "image" },
      { requestId: undefined, correlationId: undefined },
    );
    expect(dependencies.readArtifactDetailUseCase.execute).toHaveBeenCalledWith(
      { locator: { storageKey: "uploads/a.png" } },
      { requestId: undefined, correlationId: undefined },
    );
    expect(dependencies.readArtifactContentUseCase.execute).toHaveBeenCalledWith(
      { locator: { storageKey: "uploads/a.png" } },
      { requestId: undefined, correlationId: undefined },
    );
    expect(dependencies.artifactMediaViewRetrieval.retrieveArtifactViewerMediaByStorageKey).toHaveBeenCalledWith(
      { storageKey: "uploads/a.png" },
      { requestId: undefined, correlationId: undefined },
    );
    expect(dependencies.publishArtifactToRepoUseCase.execute).toHaveBeenCalledWith({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
        revision: undefined,
      },
      mediaType: undefined,
    });
    expect(dependencies.verifyPublishedArtifactBackingUseCase.execute).toHaveBeenCalledWith({
      artifactId: "uploads/a.png",
    });
    expect(dependencies.verifyImportedArtifactSourceBackingUseCase.execute).toHaveBeenCalledWith({
      artifactId: "uploads/a.png",
    });
    expect(dependencies.registerArtifactFromRepoUseCase.execute).toHaveBeenCalledWith(
      {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/a.png",
          revision: undefined,
        },
        artifactFamily: undefined,
        mediaType: undefined,
      },
      { requestId: undefined, correlationId: undefined },
    );
    expect(dependencies.localizeArtifactFromRepoUseCase.execute).toHaveBeenCalledWith({
      artifactId: "artifacts/20260418000000-local01",
    });
  });

  it("maps descriptor-oriented content failures through explicit response helper", () => {
    const request = createDesktopArtifactContentReadRequest({
      locator: { storageKey: "uploads/missing.png" },
      boundary: { host: "desktop", source: "desktop.renderer" },
    });

    const response = mapReadArtifactContentResultToDesktopResponse(
      {
        ok: false,
        error: {
          code: "not-found",
          message: "not found",
          details: { storageKey: "uploads/missing.png" },
        },
      },
      request,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "not-found",
      },
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  });

  it("maps request correlation metadata with an explicit helper", () => {
    const request = createDesktopArtifactBrowseRequest({
      artifactFamily: "image",
      boundary: { host: "desktop", source: "desktop.renderer" },
    }, {
      requestId: "req-ipc-1",
      correlationId: "corr-ipc-1",
    });

    expect(mapDesktopArtifactRequestContext(request)).toEqual({
      requestId: "req-ipc-1",
      correlationId: "corr-ipc-1",
    });
  });

  it("fails register-from-repo requests with invalid artifact family at the IPC boundary", async () => {
    const registerFromRepoUseCase = { execute: testDouble.fn() };
    const handler = createDesktopArtifactRegisterFromRepoIpcHandler(registerFromRepoUseCase);
    const request = createDesktopArtifactRegisterFromRepoRequest({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
      },
      artifactFamily: "application",
      boundary: { host: "desktop", source: "desktop.renderer" },
    }, {
      requestId: "req-register-invalid-family",
      correlationId: "corr-register-invalid-family",
    });

    const response = await handler({}, request);

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value,
      operation: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.operation,
      error: {
        code: "validation",
      },
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
    expect(registerFromRepoUseCase.execute).not.toHaveBeenCalled();
  });

  it("maps publish and publish-verify failures to operation-specific IPC response channels", async () => {
    const publishRequest = createDesktopArtifactPublishRequest({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
      },
      boundary: { host: "desktop", source: "desktop.renderer" },
    }, {
      requestId: "req-publish",
      correlationId: "corr-publish",
    });
    const publishVerifyRequest = createDesktopArtifactPublishVerifyRequest({
      artifactId: "uploads/a.png",
      boundary: { host: "desktop", source: "desktop.renderer" },
    }, {
      requestId: "req-verify",
      correlationId: "corr-verify",
    });

    const publishHandler = createDesktopArtifactPublishIpcHandler({
      execute: testDouble.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "validation",
          message: "target.path must be set",
          details: { field: "target.path" },
        },
      }),
    });
    const publishVerifyHandler = createDesktopArtifactPublishVerifyIpcHandler({
      execute: testDouble.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "not-found",
          message: "No published backing exists",
          details: { artifactId: "uploads/a.png" },
        },
      }),
    });

    const publishFailure = await publishHandler({}, publishRequest);
    const verifyFailure = await publishVerifyHandler({}, publishVerifyRequest);

    expect(publishFailure).toMatchObject({
      ok: false,
      channel: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value,
      operation: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.operation,
      error: {
        channel: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value,
        operation: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.operation,
        code: "validation",
        details: { field: "target.path" },
      },
      metadata: undefined,
    });

    expect(verifyFailure).toMatchObject({
      ok: false,
      channel: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value,
      operation: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.operation,
      error: {
        channel: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value,
        operation: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.operation,
        code: "not-found",
        details: { artifactId: "uploads/a.png" },
      },
      metadata: undefined,
    });

    expect(publishFailure.channel).not.toBe(DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value);
    expect(verifyFailure.channel).not.toBe(DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL.value);
  });
});

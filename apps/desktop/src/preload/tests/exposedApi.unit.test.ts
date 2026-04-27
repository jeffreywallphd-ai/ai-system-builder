import { describe, expect, it, testDouble } from "../../../../../modules/testing/node-test";

import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  createDesktopArtifactBrowseSuccessResponse,
  createDesktopArtifactPublishSuccessResponse,
  createDesktopArtifactPublishVerifySuccessResponse,
  createDesktopArtifactSourceVerifySuccessResponse,
  createDesktopArtifactRegisterFromRepoSuccessResponse,
  createDesktopArtifactLocalizeFromRepoSuccessResponse,
  createDesktopArtifactMediaViewSuccessResponse,
  createDesktopArtifactUnregisteredBrowseSuccessResponse,
  createDesktopArtifactUnregisteredRegisterSuccessResponse,
  createDesktopArtifactUnregisteredDeleteSuccessResponse,
  createDesktopArtifactUploadSuccessResponse,
  createIpcChannel,
  createIpcError,
  createIpcFailureResponse,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  createDesktopHuggingFaceTokenGetSuccessResponse,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  createDesktopIngestWebsitePageSuccessResponse,
  createDesktopIngestWebsitePagesBatchSuccessResponse,
  DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL,
  createDesktopPrepareTrainingDatasetSuccessResponse,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  createDesktopPythonRuntimeStatusReadSuccessResponse,
  createDesktopPythonRuntimeControlSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import { createDesktopPreloadApi, type IpcRendererInvokePort } from "../exposedApi";

describe("desktop preload exposedApi bridge", () => {
  it("maps hugging face token status bridge calls to dedicated request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopHuggingFaceTokenGetSuccessResponse({ configured: true, maskedToken: "••••1234" }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.getHuggingFaceTokenStatus();

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value);
  });

  it("maps bridge input into desktop upload request envelope and invokes request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactUploadSuccessResponse(
        {
          sourceKind: "upload",
          storage: {
            key: "uploads/kitten.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
        },
        {
          requestId: "req-upload-1",
          correlationId: "corr-upload-1",
        },
      ),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    const response = await api.uploadArtifact(
      {
        fileName: " kitten.png ",
        mediaType: " image/png ",
        bytes: new Uint8Array([137, 80, 78, 71]),
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, request] = invoke.mock.calls[0] as [string, { operation: string; payload: { boundary: { host: string; source: string } } }];
    expect(channel).toBe(DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value);
    expect(request.operation).toBe("artifact.upload");
    expect(request.payload.boundary).toEqual({ host: "desktop", source: "desktop.renderer.artifact-upload.form" });
  });

  it("maps artifact browse and media-view operations to separate request channels", async () => {
    const responses = [
      createDesktopArtifactBrowseSuccessResponse({ items: [] }),
      createDesktopArtifactMediaViewSuccessResponse({
        storageKey: "uploads/cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2]),
      }),
    ];
    let index = 0;
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
      const response = responses[index];
      index += 1;
      return response;
    });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.browseArtifacts();
    const mediaResponse = await api.readArtifactViewerMedia({ storageKey: "uploads/cat.png" });

    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value);
    expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBeUndefined();
    expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value);
    expect(mediaResponse.ok).toBe(true);
  });

  it("maps artifact browse family filter using the contract artifact-family union", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactBrowseSuccessResponse({ items: [] }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.browseArtifacts({ artifactFamily: "structured-text" });

    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value);
    expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBe("structured-text");
  });

  it("maps publish bridge calls to artifact publish request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactPublishSuccessResponse({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    const response = await api.publishArtifactToRepo({
      artifactId: "uploads/cat.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
      },
    });

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value);
  });

  it("throws when IPC returns a response envelope for the wrong operation or channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createIpcFailureResponse(
        createIpcError(
          createIpcChannel("image.archive", "response"),
          "internal",
          "wrong channel",
        ),
      ),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await expect(
      api.uploadArtifact({
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow("Received invalid desktop artifact upload IPC response envelope.");
  });
});


it("maps publish verify bridge calls to artifact publish verify request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactPublishVerifySuccessResponse({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-17T00:00:00.000Z",
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.verifyPublishedArtifactBacking({ artifactId: "uploads/cat.png" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value);
});

it("maps register-from-repo bridge calls to artifact register-from-repo request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactRegisterFromRepoSuccessResponse({
      artifactId: "imports/huggingface/openai/demo/main/images/cat.png",
      backing: {
        role: "imported-source",
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-18T00:00:00.000Z",
        },
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.registerArtifactFromRepo({
    target: {
      provider: "huggingface",
      repository: "openai/demo",
      path: "images/cat.png",
    },
  });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value);
  expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBeUndefined();
});

it("maps localize-from-repo bridge calls to artifact localize-from-repo request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactLocalizeFromRepoSuccessResponse({
      artifactId: "artifacts/20260418000000-local01",
      localObject: {
        key: "artifacts/20260418000000-local01",
        mediaType: "image/png",
        sizeBytes: 3,
      },
      source: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      localizedAt: "2026-04-18T00:00:00.000Z",
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.localizeArtifactFromRepo({ artifactId: "artifacts/20260418000000-local01" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value);
});

it("maps source-verify bridge calls to artifact source-verify request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactSourceVerifySuccessResponse({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-18T00:00:00.000Z",
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.verifyImportedArtifactSourceBacking({ artifactId: "artifacts/20260418000000-local01" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value);
});

it("maps unregistered artifact browse/register/delete bridge calls to dedicated request channels", async () => {
  const responses = [
    createDesktopArtifactUnregisteredBrowseSuccessResponse({ items: [] }),
    createDesktopArtifactUnregisteredRegisterSuccessResponse({ storageKey: "uploads/orphan.txt" }),
    createDesktopArtifactUnregisteredDeleteSuccessResponse({ storageKey: "uploads/orphan.txt" }),
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.browseUnregisteredArtifacts();
  await api.registerUnregisteredArtifact({ storageKey: "uploads/orphan.txt" });
  await api.deleteUnregisteredArtifact({ storageKey: "uploads/orphan.txt" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[2]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value);
});


it("maps website page ingestion bridge calls to dedicated IPC request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopIngestWebsitePageSuccessResponse({
      target: { url: "https://example.com" },
      resolvedUrl: "https://example.com",
      acquisitionMechanismUsed: "simple-http",
      sourceKind: "scrape",
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const response = await api.ingestWebsitePage({ url: "https://example.com", mode: "automatic" });

  expect(response.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value);
});

it("maps training dataset preparation bridge calls to dedicated IPC request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopPrepareTrainingDatasetSuccessResponse({
      outputs: {
        local: {
          dataset: { sourceKind: "runtime", storage: { key: "stored-dataset", mediaType: "application/x-ndjson", sizeBytes: 10 } },
        },
      },
      provenance: {
        sourceArtifactIds: ["artifact-1"],
        recipe: {
          normalization: { targetFormat: "markdown" },
          chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
          generation: { mode: "qa", model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" } },
        },
        split: { trainRatio: 0.8, testRatio: 0.2, seed: 7, shuffle: true },
        output: { format: "jsonl" },
        generationModelId: "Qwen/Qwen2.5-1.5B-Instruct",
        summary: {
          sourceDocumentCount: 1,
          normalizedDocumentCount: 1,
          skippedDocumentCount: 0,
          chunkCount: 2,
          generatedExampleCount: 10,
          datasetRowCount: 10,
          trainRowCount: 10,
          testRowCount: 0,
        },
      },
      summary: {
        sourceDocumentCount: 1,
        normalizedDocumentCount: 1,
        skippedDocumentCount: 0,
        chunkCount: 2,
        generatedExampleCount: 10,
        datasetRowCount: 10,
        trainRowCount: 10,
        testRowCount: 0,
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const response = await api.prepareTrainingDatasetFromArtifacts({
    sourceArtifactIds: ["artifact-1"],
    recipe: {
      normalization: { targetFormat: "markdown" },
      chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
      generation: {
        mode: "qa",
        model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
        promptTemplate: "Prompt: {{text}}",
      },
    },
    split: { trainRatio: 0.8, testRatio: 0.2, seed: 7, shuffle: true },
    output: { format: "jsonl" },
  });

  expect(response.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL.value);
});

it("maps website pages batch ingestion bridge calls to dedicated IPC request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopIngestWebsitePagesBatchSuccessResponse({
      items: [],
      summary: { attempted: 0, succeeded: 0, failed: 0 },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const response = await api.ingestWebsitePagesBatch({
    targets: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
    mode: "rendered",
  });

  expect(response.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value);
});

it("maps python runtime status/control bridge calls to dedicated IPC request channels", async () => {
  const responses = [
    createDesktopPythonRuntimeStatusReadSuccessResponse({
      supervisorStatus: "ready",
      healthy: true,
      runtimeStatus: "ready",
      capabilities: ["prepare-training-dataset"],
      logs: [],
    }),
    createDesktopPythonRuntimeControlSuccessResponse({
      supervisorStatus: "starting",
      healthy: false,
      runtimeStatus: "starting",
      capabilities: [],
      logs: [],
    }),
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.readPythonRuntimeStatus();
  await api.controlPythonRuntime({ action: "restart" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value);
});

it("maps application settings bridge calls to dedicated settings channels", async () => {
  const responses = [
    {
      ok: true,
      operation: "application-settings.list-definitions",
      channel: "ipc.application-settings.list-definitions.response",
      value: { definitions: [] },
    },
    {
      ok: true,
      operation: "application-settings.read",
      channel: "ipc.application-settings.read.response",
      value: { values: [{ key: "huggingface.token", configured: true, masked: true, maskedValue: "********" }] },
    },
    {
      ok: true,
      operation: "application-settings.resolve-model-default",
      channel: "ipc.application-settings.resolve-model-default.response",
      value: { resolved: { provider: "transformers", modelId: "google/flan-t5-small", inferenceMode: "text2text", source: "builtin" } },
    },
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });

  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
  await api.listApplicationSettingDefinitions();
  const read = await api.readApplicationSettings({ keys: ["huggingface.token"] });
  const resolved = await api.resolveModelDefault({ taskKey: "qaGeneration" });

  expect(invoke.mock.calls[0]?.[0]).toBe("ipc.application-settings.list-definitions.request");
  expect(invoke.mock.calls[1]?.[0]).toBe("ipc.application-settings.read.request");
  expect(read.value.values[0]?.maskedValue).toBe("********");
  expect(resolved.value.resolved.inferenceMode).toBe("text2text");
});

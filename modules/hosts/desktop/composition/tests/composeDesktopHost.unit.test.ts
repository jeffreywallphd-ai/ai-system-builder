import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  describe,
  expect,
  expectTypeOf,
  it,
  testDouble,
} from "../../../../testing/node-test";

import type { LoggingPort } from "../../../../application/ports/logging";
import type { StructuredLogEvent } from "../../../../contracts/logging";
import { TaskType } from "../../../../contracts/runtime";
import type { HuggingFaceFetchImplementation } from "../../../../adapters/storage/huggingface";

import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../../../../adapters/transport/ipc-electron/ipcMainHandlePort";

import {
  composeDesktopHost,
  createDesktopRuntimeReadinessService,
  type ComposeDesktopHostOptions,
  type RegisterDesktopArtifactUploadIpcOptions,
} from "../composeDesktopHost";
import {
  resolveComfyUiLaunchPythonExecutable,
  resolveComfyUiPythonEnvironmentMode,
  resolveComfyUiRuntimeDeviceMode,
  resolveComfyUiInstallRoot,
} from "../composeDesktopComfyUiHelpers";
import {
  classifyPythonRuntimeStdioLogLevel,
  resolveDefaultManagedPythonRuntimePort,
  resolvePythonRuntimeBaseUrl,
} from "../desktopPythonRuntimeHelpers";

describe("composeDesktopHost", () => {
  it("resolves ComfyUI install root with COMFYUI_INSTALL_ROOT override", () => {
    expect(
      resolveComfyUiInstallRoot(
        { COMFYUI_INSTALL_ROOT: "/tmp/comfy" } as NodeJS.ProcessEnv,
        "/storage",
      ),
    ).toBe("/tmp/comfy");
  });

  it("resolves ComfyUI install root from runtime root directory by default", () => {
    expect(
      resolveComfyUiInstallRoot({} as NodeJS.ProcessEnv, "/desktop-data"),
    ).toBe(join("/desktop-data", "runtime-installs", "comfyui"));
  });

  it("resolves ComfyUI install root from DESKTOP_RUNTIME_ROOT without using artifact storage root", () => {
    expect(
      resolveComfyUiInstallRoot({
        DESKTOP_RUNTIME_ROOT: "/desktop-data",
        DESKTOP_STORAGE_ROOT: "/desktop-data/artifacts",
      } as NodeJS.ProcessEnv),
    ).toBe(join("/desktop-data", "runtime-installs", "comfyui"));
  });

  it("does not fall back to process cwd when ComfyUI root is unavailable", () => {
    expect(() => resolveComfyUiInstallRoot({} as NodeJS.ProcessEnv)).toThrow(
      "Unable to resolve ComfyUI install root. Set COMFYUI_INSTALL_ROOT or DESKTOP_RUNTIME_ROOT.",
    );
  });

  it("defaults to CPU when no accelerator is clearly confirmed", () => {
    expect(
      resolveComfyUiRuntimeDeviceMode({
        env: {},
        platform: "win32",
        hasNvidiaGpu: false,
      }),
    ).toBe("cpu");
    expect(
      resolveComfyUiRuntimeDeviceMode({ env: {}, platform: "win32" }),
    ).toBe("cpu");
  });

  it("honors explicit ComfyUI runtime device mode overrides", () => {
    expect(
      resolveComfyUiRuntimeDeviceMode({
        env: { COMFYUI_RUNTIME_DEVICE_MODE: "cpu" } as NodeJS.ProcessEnv,
        platform: "win32",
        hasNvidiaGpu: false,
      }),
    ).toBe("cpu");
    expect(
      resolveComfyUiRuntimeDeviceMode({
        env: { COMFYUI_ACCELERATOR: "cuda" } as NodeJS.ProcessEnv,
        platform: "win32",
        hasNvidiaGpu: false,
      }),
    ).toBe("cuda");
  });

  it("prefers env override over configured gpu type mapping", () => {
    expect(
      resolveComfyUiRuntimeDeviceMode({
        env: { COMFYUI_RUNTIME_DEVICE_MODE: "cpu" } as NodeJS.ProcessEnv,
        gpuType: "nvidia",
      }),
    ).toBe("cpu");
  });

  it("resolves ComfyUI runtime mode from configured GPU type when env override is not set", () => {
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "nvidia" })).toBe("cuda");
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "amd" })).toBe(
      "directml",
    );
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "intel" })).toBe(
      "directml",
    );
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "cpu" })).toBe("cpu");
  });

  it("uses CUDA by default when a torch CUDA wheel index is configured", () => {
    expect(
      resolveComfyUiRuntimeDeviceMode({
        hasNvidiaGpu: false,
        gpuType: "auto",
        cudaTorchWheelIndexUrl: "https://download.pytorch.org/whl/cu130",
      }),
    ).toBe("cuda");
  });

  it("resolves CUDA only when Nvidia is explicitly detected or configured", () => {
    expect(resolveComfyUiRuntimeDeviceMode({ hasNvidiaGpu: true })).toBe(
      "cuda",
    );
    expect(resolveComfyUiRuntimeDeviceMode({ hasNvidiaGpu: false })).toBe(
      "cpu",
    );
  });

  it("rejects unsupported ComfyUI runtime device mode overrides", () => {
    expect(() =>
      resolveComfyUiRuntimeDeviceMode({
        env: { COMFYUI_RUNTIME_DEVICE_MODE: "vulkan" } as NodeJS.ProcessEnv,
        platform: "win32",
        hasNvidiaGpu: false,
      }),
    ).toThrow("Unsupported COMFYUI_RUNTIME_DEVICE_MODE value");
  });

  it("uses a managed ComfyUI Python environment by default", () => {
    expect(resolveComfyUiPythonEnvironmentMode({} as NodeJS.ProcessEnv)).toBe(
      "managed-venv",
    );
    expect(
      resolveComfyUiLaunchPythonExecutable({
        installRoot: "/runtime/comfy",
        basePythonCommand: "python",
        pythonEnvironmentMode: "managed-venv",
        platform: "win32",
      }),
    ).toBe(join("/runtime/comfy", ".venv", "Scripts", "python.exe"));
  });

  it("allows explicit ambient ComfyUI Python environment mode", () => {
    expect(
      resolveComfyUiPythonEnvironmentMode({
        COMFYUI_PYTHON_ENVIRONMENT_MODE: "ambient",
      } as NodeJS.ProcessEnv),
    ).toBe("ambient");
    expect(
      resolveComfyUiLaunchPythonExecutable({
        installRoot: "/runtime/comfy",
        basePythonCommand: "python",
        pythonEnvironmentMode: "ambient",
        platform: "win32",
      }),
    ).toBe("python");
  });

  it("rejects unsupported ComfyUI Python environment modes", () => {
    expect(() =>
      resolveComfyUiPythonEnvironmentMode({
        COMFYUI_PYTHON_ENVIRONMENT_MODE: "global",
      } as NodeJS.ProcessEnv),
    ).toThrow("Unsupported COMFYUI_PYTHON_ENVIRONMENT_MODE value");
  });

  it("uses the canonical ipc-main handle port type for registration options", () => {
    expectTypeOf<
      RegisterDesktopArtifactUploadIpcOptions["ipcMain"]
    >().toEqualTypeOf<IpcMainHandlePort>();
  });

  it("uses the shared huggingface fetch implementation seam type instead of DOM-global fetch typing", () => {
    expectTypeOf<
      NonNullable<
        ComposeDesktopHostOptions["artifactRepo"]
      >["huggingFaceFetchImplementation"]
    >().toEqualTypeOf<HuggingFaceFetchImplementation | undefined>();
  });

  it("provides a LoggingPort-backed seam using the real logging adapter", async () => {
    const sink = testDouble.fn();
    const host = composeDesktopHost({
      logging: {
        verbosity: "verbose",
        level: "debug",
      },
      logSink: sink,
    });

    expectTypeOf<typeof host.loggingPort>().toExtend<LoggingPort>();
    expect(host.loggingConfig).toEqual({
      verbosity: "verbose",
      level: "debug",
      includeDiagnostics: undefined,
    });

    const event: StructuredLogEvent = {
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "upload.started",
      message: "Upload started",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
    };

    await host.loggingPort.log(event);

    expect(sink).toHaveBeenCalledOnce();
    const [, emittedEvent] = sink.mock.calls[0] as [string, StructuredLogEvent];
    expect(emittedEvent).toMatchObject({
      event: "upload.started",
      host: "desktop",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
    });
  });

  it("classifies routine Python runtime stderr output without warning noise", () => {
    expect(
      classifyPythonRuntimeStdioLogLevel(
        "stderr",
        "INFO:     Uvicorn running on http://127.0.0.1:47595",
      ),
    ).toBe("info");
    expect(
      classifyPythonRuntimeStdioLogLevel(
        "stderr",
        "Map: 100%|##########| 117/117 [00:00<00:00, 1393.06 examples/s]",
      ),
    ).toBe("info");
    expect(
      classifyPythonRuntimeStdioLogLevel(
        "stderr",
        "worker.py:1: UserWarning: model warning",
      ),
    ).toBe("warn");
    expect(
      classifyPythonRuntimeStdioLogLevel(
        "stderr",
        "Traceback (most recent call last):",
      ),
    ).toBe("error");
  });

  it("registers the desktop artifact upload IPC handler on the request channel", async () => {
    const ipcMain = {
      handle: testDouble.fn(),
    };
    const artifactRepoFetch = testDouble.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as HuggingFaceFetchImplementation;
    const host = composeDesktopHost({
      artifactRepo: {
        huggingFaceTokenConfigFilePath: join(
          tmpdir(),
          `desktop-host-token-${Date.now()}.json`,
        ),
        huggingFaceFetchImplementation: artifactRepoFetch,
      },
    });

    const storageRootDirectory = join(
      tmpdir(),
      `desktop-artifact-upload-test-${Date.now()}`,
    );
    const runtimeRootDirectory = join(
      tmpdir(),
      `desktop-runtime-test-${Date.now()}`,
    );

    host.registerArtifactUploadIpc({
      ipcMain,
      senderTrust: { isTrustedSender: () => true },
      storageRootDirectory,
      runtimeRootDirectory,
    });

    const channels = ipcMain.handle.mock.calls.map((call) => call[0]);
    const expectedChannels = [
      DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value,
      DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL.value,
      DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value,
      DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value,
      DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value,
      DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value,
      DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value,
      DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value,
      "ipc.image-generation.start.request",
      "ipc.image-generation.read.request",
      "ipc.image-generation.cancel.request",
      "ipc.image-generation.finalize-if-completed.request",
      "ipc.comfyui-runtime.read-install-status.request",
      "ipc.comfyui-runtime.repair-install.request",
      DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value,
      DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value,
      "ipc.user-library.promote-workspace-asset.request",
      "ipc.user-library.link-asset-to-workspace.request",
      "ipc.user-library.copy-asset-to-workspace.request",
      "ipc.user-library.import-workspace-asset.request",
      "ipc.user-library.list-assets.request",
      "ipc.user-library.read-asset.request",
      "ipc.user-library.list-workspace-links.request",
      "ipc.user-library.read-workspace-link.request",
      "ipc.user-library.list-workspace-effective-sources.request",
      DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL.value,
      DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL.value,
    ];
    for (const expectedChannel of expectedChannels) {
      expect(channels).toContain(expectedChannel);
    }
    expect(
      channels.filter(
        (channel) => channel === DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
      ),
    ).toEqual([DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value]);
    expect(
      channels.filter((channel) => String(channel).startsWith("ipc.asset.")),
    ).toEqual([
      DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    ]);
    expect(
      /asset\.(?:create|update|delete|patch|edit|seed|publish|scan|execute|run)/i.test(
        channels.join(" "),
      ),
    ).toBe(false);
    expect(
      existsSync(join(storageRootDirectory, "asset-kernel", "manifest.json")),
    ).toBe(false);
    expect(
      existsSync(join(runtimeRootDirectory, "asset-kernel", "manifest.json")),
    ).toBe(false);
    expect(host.getInternalAssetRegistry()).toBeUndefined();
    expect(artifactRepoFetch).not.toHaveBeenCalled();
    const preloadSource = [
      readFileSync(resolve("apps/desktop/src/preload/index.ts"), "utf8"),
      readFileSync(resolve("apps/desktop/src/preload/exposedApi.ts"), "utf8"),
    ].join("\n");
    expect(preloadSource).toContain("listAssetDefinitions");
    expect(preloadSource).toContain("readAssetDefinition");
    expect(preloadSource).toContain("registerResourceBackedViewAsAsset");
    expect(preloadSource).toContain("finalizeGeneratedOutputAsAsset");
    expect(preloadSource).toContain("importExternalRepositoryObjectAsAsset");
    expect(preloadSource).toContain("localizeExternalRepositoryObjectAsAsset");
    expect(preloadSource).toContain("listAssetDerivedCustomizationTargets");
    expect(preloadSource).toContain("createAssetDerivedCustomization");
    expect(
      /createAssetDefinition|updateAssetDefinition|deleteAssetDefinition|patchAsset|editAsset|seedAsset|publishAssetDefinition|publishAssetInstance|listAssetInstances|readAssetInstance/i.test(
        preloadSource,
      ),
    ).toBe(false);
    const hostSource = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );
    expect(hostSource).toContain(
      'await import("./composeDesktopAssetFeature")',
    );
    expect(hostSource).toContain("getDerivedCustomizations");
    expect(hostSource).not.toContain("import { composeInternalAssetRegistry");
    expect(hostSource).not.toContain(
      "assetRegistryRead: internalAssetRegistry,",
    );
    const listener = ipcMain.handle.mock.calls[0]?.[1];
    expect(listener).toBeTypeOf("function");
  });

  it("builds desktop runtime readiness providers from read-only runtime signals", async () => {
    const calls: string[] = [];
    const service = createDesktopRuntimeReadinessService({
      readPythonSupervisorState: () => {
        calls.push("read-python-status");
        return "stopped";
      },
      readComfyUiLifecycleState: () => {
        calls.push("read-comfyui-health");
        return "uninitialized";
      },
      readComfyUiInstallStatus: async () => {
        calls.push("read-comfyui-install-status");
        return "not-installed";
      },
      now: () => "2026-05-06T00:00:00.000Z",
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(
      snapshot.capabilities.map((capability) => capability.capabilityId),
    ).toEqual([
      "python-runtime",
      "comfyui-runtime",
      "image-generation",
      "dataset-preparation",
      "model-training",
      "model-validation",
      "model-publishing",
    ]);
    expect(
      snapshot.capabilities.find(
        (capability) => capability.capabilityId === "model-publishing",
      ),
    ).toMatchObject({
      status: "unavailable",
      reason: {
        code: "runtime.model-publishing.not-implemented",
        category: "unavailable",
      },
    });
    expect(
      snapshot.capabilities.find(
        (capability) => capability.capabilityId === "model-training",
      ),
    ).toMatchObject({
      status: "unavailable",
      dependencies: [{ capabilityId: "python-runtime", status: "unavailable" }],
    });
    expect(
      snapshot.capabilities.find(
        (capability) => capability.capabilityId === "model-validation",
      ),
    ).toMatchObject({
      status: "unavailable",
      dependencies: [{ capabilityId: "python-runtime", status: "unavailable" }],
    });
    expect(calls).toContain("read-python-status");
    expect(calls).toContain("read-comfyui-install-status");
    expect(calls).toContain("read-comfyui-health");
    expect(calls).not.toContain("start-python-runtime");
    expect(calls).not.toContain("start-comfyui-runtime");
    expect(calls).not.toContain("repair-comfyui-install");
  });

  it("keeps the composition seam usable for upload success and failure event logging", async () => {
    const sink = testDouble.fn();
    const host = composeDesktopHost({
      logging: {
        verbosity: "trace",
        level: "info",
      },
      logSink: sink,
    });

    await host.loggingPort.log({
      timestamp: "2026-04-14T12:00:01.000Z",
      level: "info",
      verbosity: "normal",
      event: "upload.stored_successfully",
      message: "Upload stored successfully",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
      outcome: "success",
    });
    await host.loggingPort.log({
      timestamp: "2026-04-14T12:00:02.000Z",
      level: "error",
      verbosity: "normal",
      event: "upload.failed",
      message: "Upload failed",
      component: "store-artifact-upload-use-case",
      useCase: "store-artifact-upload",
      outcome: "failure",
    });

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("keeps composeDesktopHost free of deferred feature implementation static imports", () => {
    const source = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );

    const forbiddenRuntimeImports = [
      "createPythonRuntimeAdapterFoundation",
      "createPythonRuntimeTaskRegistryAdapter",
      "createComfyUiRuntimeInstaller",
      "createComfyUiRuntimeSupervisor",
      "createFilesystemArtifactObjectStorageAdapter",
      "createHuggingFaceArtifactRepoStorageAdapter",
      "createLocalModelRegistryAdapter",
      "GenerateImageUseCase",
      "PrepareTrainingDatasetFromArtifactsUseCase",
      "composeInternalAssetRegistry",
      "TaskPowerLifecycleService",
      "createElectronPowerSuspensionBlocker",
    ];

    for (const forbidden of forbiddenRuntimeImports) {
      expect(source).not.toContain(`import { ${forbidden}`);
      expect(source).not.toContain(`import {\n  ${forbidden}`);
    }
    expect(source).toContain('await import("./composeDesktopModelFeature")');
    expect(source).toContain('await import("./composeDesktopArtifactFeature")');
    expect(source).toContain(
      'await import("./composeDesktopComfyUiInstallFeature")',
    );
    expect(source).toContain(
      'await import("./composeDesktopComfyUiImageRuntimeFeature")',
    );
  });

  it("keeps runtime task power blocker construction lazy until a task lifecycle action", async () => {
    const { composeDesktopRuntimeTaskFeature } =
      await import("../composeDesktopRuntimeTaskFeature");
    const milestones: string[] = [];

    const feature = await composeDesktopRuntimeTaskFeature({
      pythonRuntimeFoundation: {
        supervisor: { start: testDouble.fn(async () => undefined) },
        runtimePort: {},
      },
      imageRuntimeTaskRegistry: {
        startTask: testDouble.fn(),
        readTask: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      },
      runtimeReadiness: {
        readCapabilityStatus: testDouble.fn(async () => ({
          capabilityId: "runtime.test",
          status: "ready",
          checkedAt: "2026-05-15T00:00:00.000Z",
        })),
        readAllCapabilityStatuses: testDouble.fn(async () => []),
      },
      recordMilestone: (milestone) => milestones.push(milestone),
    });

    expect(milestones).not.toContain(
      "desktop.host.power-blocker.compose.before",
    );
    await feature.taskPowerLifecycle.startTask(
      "task.lazy-power",
      TaskType.DATASET_PREPARATION,
    );
    expect(milestones).toContain("desktop.host.power-blocker.compose.before");
    expect(milestones).toContain("desktop.host.power-blocker.compose.after");
  });

  it("starts the lazy Python runtime before allowing dataset preparation", async () => {
    const { composeDesktopRuntimeTaskFeature } =
      await import("../composeDesktopRuntimeTaskFeature");
    let supervisorStatus = "stopped";
    const start = testDouble.fn(async () => {
      supervisorStatus = "ready";
    });
    const feature = await composeDesktopRuntimeTaskFeature({
      pythonRuntimeFoundation: {
        supervisor: { start },
        runtimePort: {},
      },
      imageRuntimeTaskRegistry: {
        startTask: testDouble.fn(),
        readTask: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      },
      runtimeReadiness: {
        getCapabilityStatus: testDouble.fn(async (capabilityId: string) => ({
          capabilityId,
          status: supervisorStatus === "ready" ? "ready" : "unavailable",
        })),
        getReadinessSnapshot: testDouble.fn(),
      },
    });

    const ready = await feature.runtimeCapabilityGuard.requireCapabilityReady(
      "dataset-preparation",
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(ready).toMatchObject({
      capabilityId: "dataset-preparation",
      status: "ready",
    });
  });

  it("prepares text-training dependencies after runtime startup and before dispatch", async () => {
    const { composeDesktopRuntimeTaskFeature } =
      await import("../composeDesktopRuntimeTaskFeature");
    const callOrder: string[] = [];
    const feature = await composeDesktopRuntimeTaskFeature({
      pythonRuntimeFoundation: {
        supervisor: {
          start: testDouble.fn(async () => {
            callOrder.push("start-runtime");
          }),
        },
        prepareModelTrainingEnvironment: testDouble.fn(() => {
          callOrder.push("prepare-training");
        }),
        runtimePort: {
          startTask: testDouble.fn(async (request: { requestId: string }) => {
            callOrder.push("dispatch-training");
            return { requestId: request.requestId, status: "queued" };
          }),
        },
      },
      imageRuntimeTaskRegistry: {
        startTask: testDouble.fn(),
        readTask: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      },
      runtimeReadiness: {
        getCapabilityStatus: testDouble.fn(),
        getReadinessSnapshot: testDouble.fn(),
      },
    });

    await feature.runtimeTaskRegistry.startTask({
      workspaceId: "workspace.test" as never,
      requestId: "training-1",
      taskType: TaskType.MODEL_TRAINING,
      payload: {},
    });

    expect(callOrder).toEqual([
      "start-runtime",
      "prepare-training",
      "dispatch-training",
    ]);
  });

  it("prepares Context dependencies with progress before runtime startup and dispatch", async () => {
    const { composeDesktopRuntimeTaskFeature } =
      await import("../composeDesktopRuntimeTaskFeature");
    const callOrder: string[] = [];
    const feature = await composeDesktopRuntimeTaskFeature({
      pythonRuntimeFoundation: {
        supervisor: {
          start: testDouble.fn(async () => {
            callOrder.push("start-runtime");
          }),
        },
        prepareContextEnvironment: testDouble.fn(
          async (
            onProgress?: (progress: {
              phase: "installing" | "installed";
              message: string;
            }) => void,
          ) => {
            callOrder.push("prepare-context");
            onProgress?.({
              phase: "installing",
              message: "Installing the local vector database.",
            });
          },
        ),
        runtimePort: {
          startTask: testDouble.fn(async (request: { requestId: string }) => {
            callOrder.push("dispatch-context");
            return { requestId: request.requestId, status: "queued" };
          }),
        },
      },
      imageRuntimeTaskRegistry: {
        startTask: testDouble.fn(),
        readTask: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      },
      runtimeReadiness: {
        getCapabilityStatus: testDouble.fn(),
        getReadinessSnapshot: testDouble.fn(),
      },
    });

    await feature.runtimeTaskRegistry.startTask({
      workspaceId: "workspace.test" as never,
      requestId: "context-setup-1",
      taskType: TaskType.CONTEXT_GENERATION,
      payload: { kind: "rag-database" },
    });

    expect(callOrder).toEqual([
      "prepare-context",
      "start-runtime",
      "dispatch-context",
    ]);
  });

  it("reports the resolved Python supervisor state through desktop readiness", () => {
    const source = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );

    expect(source).not.toContain('readPythonSupervisorState: () => "stopped"');
    expect(source).toContain(
      "const status = pythonRuntimeFoundation?.supervisor.getStatus()",
    );
  });

  it("keeps desktop composition source free of DOM-global fetch typing to stay webpack main emit-safe", () => {
    const source = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );

    expect(source).not.toContain("typeof fetch");
  });

  it("moves deferred feature implementations into explicit dynamically imported composers", () => {
    const artifactRemoteSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopArtifactRemoteFeature.ts",
      ),
      "utf8",
    );
    const pythonSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts",
      ),
      "utf8",
    );
    const comfySource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopComfyUiImageRuntimeFeature.ts",
      ),
      "utf8",
    );
    const comfyInstallSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopComfyUiInstallFeature.ts",
      ),
      "utf8",
    );
    const imageSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopImageGenerationFeature.ts",
      ),
      "utf8",
    );

    expect(artifactRemoteSource).toContain("PublishArtifactToRepoUseCase");
    expect(artifactRemoteSource).toContain(
      "const huggingFaceArtifactRepoStorage = createHuggingFaceArtifactRepoStorageAdapter",
    );
    expect(artifactRemoteSource).toContain(
      "repoBrowser: huggingFaceArtifactRepoStorage",
    );
    expect(pythonSource).toContain("createPythonRuntimeAdapterFoundation");
    expect(pythonSource).toContain("ensurePythonRuntimeWorkerDependencies");
    expect(comfyInstallSource).toContain("createComfyUiRuntimeInstaller");
    expect(comfySource).toContain("createComfyUiRuntimeInstaller");
    expect(comfySource).toContain("detectNvidiaGpu()");
    expect(pythonSource).not.toContain("./composeDesktopHost");
    expect(imageSource).toContain(
      "ImageGenerationFinalizationOrchestratorService",
    );
    expect(imageSource).toContain(
      "createFilesystemGeneratedImagePersistenceAdapter",
    );
  });

  it("enforces cleanup import boundaries for ComfyUI, Python, runtime IPC, and typed providers", () => {
    const hostSource = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );
    const pythonFeatureSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopPythonRuntimeFeature.ts",
      ),
      "utf8",
    );
    const comfyRuntimeIpcSource = readFileSync(
      resolve(
        "modules/adapters/transport/ipc-electron/comfyui-runtime/registerComfyUiRuntimeIpc.ts",
      ),
      "utf8",
    );
    const runtimeIpcSource = readFileSync(
      resolve(
        "modules/adapters/transport/ipc-electron/registerDesktopRuntimeIpc.ts",
      ),
      "utf8",
    );
    const lazyProviderSource = readFileSync(
      resolve("modules/adapters/transport/ipc-electron/lazyFeatureProvider.ts"),
      "utf8",
    );

    expect(comfyRuntimeIpcSource).not.toContain(
      "../../../runtime/installer/comfyui",
    );
    expect(comfyRuntimeIpcSource).not.toContain("buildComfyUiInstallRequest");
    expect(runtimeIpcSource).not.toContain("RuntimeInstallerPort");
    expect(pythonFeatureSource).not.toContain("./composeDesktopHost");
    expect(hostSource).not.toContain(
      'from "./composeDesktopPythonRuntimeFeature"',
    );
    expect(hostSource).not.toContain("export {\n  detectNvidiaGpu");
    expect(lazyProviderSource).not.toContain("AsyncFeatureProvider<any>");

    for (const filePath of [
      "modules/adapters/transport/ipc-electron/registerDesktopArtifactIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopAssetIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopModelIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopImageGenerationIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopRuntimeIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopIngestionIpc.ts",
      "modules/adapters/transport/ipc-electron/registerDesktopDatasetPreparationIpc.ts",
    ]) {
      const source = readFileSync(resolve(filePath), "utf8");
      expect(source).not.toContain("AsyncFeatureProvider<any>");
    }
  });

  it("stores and exposes desktop Hugging Face token status", () => {
    const host = composeDesktopHost({
      artifactRepo: {
        huggingFaceTokenConfigFilePath: join(
          tmpdir(),
          `desktop-host-token-${Date.now()}.json`,
        ),
      },
    });
    expect(host.getHuggingFaceTokenStatus().configured).toBe(false);
    const saved = host.setHuggingFaceToken("hf_desktop_token");
    expect(saved.configured).toBe(true);
    expect(saved.maskedToken).toBe("••••oken");
    const cleared = host.clearHuggingFaceToken();
    expect(cleared.configured).toBe(false);
  });
  it("does not emit repeated diagnostics fetch warnings when runtime startup fails", async () => {
    const previousCommand = process.env.PYTHON_RUNTIME_COMMAND;
    const previousArgs = process.env.PYTHON_RUNTIME_ARGS;
    const previousBaseUrl = process.env.PYTHON_RUNTIME_BASE_URL;
    process.env.PYTHON_RUNTIME_COMMAND = "__missing_python_runtime_command__";
    process.env.PYTHON_RUNTIME_ARGS = "";
    process.env.PYTHON_RUNTIME_BASE_URL = "http://127.0.0.1:49998";

    try {
      const host = composeDesktopHost();

      await expect(host.startPythonRuntime()).rejects.toThrow();

      await host.readPythonRuntimeStatus();
      const statusAfterSecondRead = await host.readPythonRuntimeStatus();

      expect(statusAfterSecondRead.supervisorStatus).toBe("failed");
      const diagnosticsFetchWarnings = statusAfterSecondRead.logs.filter(
        (entry) =>
          entry.message.includes("Unable to read Python runtime diagnostics:"),
      );
      expect(diagnosticsFetchWarnings.length).toBe(0);
    } finally {
      if (previousCommand === undefined) {
        delete process.env.PYTHON_RUNTIME_COMMAND;
      } else {
        process.env.PYTHON_RUNTIME_COMMAND = previousCommand;
      }

      if (previousArgs === undefined) {
        delete process.env.PYTHON_RUNTIME_ARGS;
      } else {
        process.env.PYTHON_RUNTIME_ARGS = previousArgs;
      }

      if (previousBaseUrl === undefined) {
        delete process.env.PYTHON_RUNTIME_BASE_URL;
      } else {
        process.env.PYTHON_RUNTIME_BASE_URL = previousBaseUrl;
      }
    }
  });

  it("emits runtime health-change logs only when status transitions", async () => {
    const host = composeDesktopHost();

    const firstRead = await host.readPythonRuntimeStatus();
    const secondRead = await host.readPythonRuntimeStatus();

    const healthTransitionLogsFirstRead = firstRead.logs.filter((entry) =>
      entry.message.includes("Python runtime health changed:"),
    );
    const healthTransitionLogsSecondRead = secondRead.logs.filter((entry) =>
      entry.message.includes("Python runtime health changed:"),
    );

    expect(healthTransitionLogsFirstRead.length).toBe(1);
    expect(healthTransitionLogsSecondRead.length).toBe(1);
    expect(secondRead.generationCapacity).toMatchObject({
      schemaVersion: "1",
      decoderAvailable: false,
      schemaSupported: true,
    });
    expect(
      secondRead.generationCapacity?.logicalProcessorCount,
    ).toBeGreaterThan(0);
    expect(
      secondRead.generationCapacity?.totalSystemMemoryBytes,
    ).toBeGreaterThan(0);
    expect(
      secondRead.generationCapacity?.availableSystemMemoryBytes,
    ).toBeGreaterThan(0);
  });
});

describe("desktop host composition decomposition", () => {
  it("keeps runtime readiness wiring in a focused helper without IPC transport imports", () => {
    const hostSource = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );
    const helperSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopRuntimeReadiness.ts",
      ),
      "utf8",
    );

    expect(hostSource).toContain("./composeDesktopRuntimeReadiness");
    expect(helperSource).toContain("RuntimeReadinessService");
    expect(helperSource).not.toContain("ipc-electron");
    expect(helperSource).not.toContain("registerElectronIpc");
  });

  it("keeps runtime task registry routing in a focused helper without IPC transport imports", () => {
    const hostSource = readFileSync(
      resolve("modules/hosts/desktop/composition/composeDesktopHost.ts"),
      "utf8",
    );
    const helperSource = readFileSync(
      resolve(
        "modules/hosts/desktop/composition/composeDesktopRuntimeTaskRegistry.ts",
      ),
      "utf8",
    );

    expect(hostSource).toContain("./composeDesktopRuntimeTaskFeature");
    expect(helperSource).toContain("createRuntimeTaskRegistryRouter");
    expect(helperSource).not.toContain("ipc-electron");
    expect(helperSource).not.toContain("registerElectronIpc");
  });
});

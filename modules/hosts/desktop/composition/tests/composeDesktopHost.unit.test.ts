import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";

import type { LoggingPort } from "../../../../application/ports/logging";
import type { StructuredLogEvent } from "../../../../contracts/logging";
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
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
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
  classifyPythonRuntimeStdioLogLevel,
  composeDesktopHost,
  resolveComfyUiLaunchPythonExecutable,
  resolveComfyUiPythonEnvironmentMode,
  resolveComfyUiRuntimeDeviceMode,
  resolveComfyUiInstallRoot,
  resolveDefaultManagedPythonRuntimePort,
  resolvePythonRuntimeBaseUrl,
  type ComposeDesktopHostOptions,
  type RegisterDesktopArtifactUploadIpcOptions,
} from "../composeDesktopHost";

describe("composeDesktopHost", () => {
  it("resolves ComfyUI install root with COMFYUI_INSTALL_ROOT override", () => {
    expect(resolveComfyUiInstallRoot({ COMFYUI_INSTALL_ROOT: "/tmp/comfy" } as NodeJS.ProcessEnv, "/storage")).toBe("/tmp/comfy");
  });

  it("resolves ComfyUI install root from runtime root directory by default", () => {
    expect(resolveComfyUiInstallRoot({} as NodeJS.ProcessEnv, "/desktop-data")).toBe(join("/desktop-data", "runtime-installs", "comfyui"));
  });

  it("resolves ComfyUI install root from DESKTOP_RUNTIME_ROOT without using artifact storage root", () => {
    expect(resolveComfyUiInstallRoot({
      DESKTOP_RUNTIME_ROOT: "/desktop-data",
      DESKTOP_STORAGE_ROOT: "/desktop-data/artifacts",
    } as NodeJS.ProcessEnv)).toBe(join("/desktop-data", "runtime-installs", "comfyui"));
  });

  it("does not fall back to process cwd when ComfyUI root is unavailable", () => {
    expect(() => resolveComfyUiInstallRoot({} as NodeJS.ProcessEnv)).toThrow(
      "Unable to resolve ComfyUI install root. Set COMFYUI_INSTALL_ROOT or DESKTOP_RUNTIME_ROOT.",
    );
  });

  it("resolves DirectML for Windows machines without detected Nvidia GPUs", () => {
    expect(resolveComfyUiRuntimeDeviceMode({ env: {}, platform: "win32", hasNvidiaGpu: false })).toBe("directml");
  });

  it("honors explicit ComfyUI runtime device mode overrides", () => {
    expect(resolveComfyUiRuntimeDeviceMode({
      env: { COMFYUI_RUNTIME_DEVICE_MODE: "cpu" } as NodeJS.ProcessEnv,
      platform: "win32",
      hasNvidiaGpu: false,
    })).toBe("cpu");
    expect(resolveComfyUiRuntimeDeviceMode({
      env: { COMFYUI_ACCELERATOR: "cuda" } as NodeJS.ProcessEnv,
      platform: "win32",
      hasNvidiaGpu: false,
    })).toBe("cuda");
  });

  it("prefers env override over configured gpu type mapping", () => {
    expect(resolveComfyUiRuntimeDeviceMode({
      env: { COMFYUI_RUNTIME_DEVICE_MODE: "cpu" } as NodeJS.ProcessEnv,
      gpuType: "nvidia",
    })).toBe("cpu");
  });

  it("resolves ComfyUI runtime mode from configured GPU type when env override is not set", () => {
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "nvidia" })).toBe("cuda");
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "amd" })).toBe("directml");
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "intel" })).toBe("directml");
    expect(resolveComfyUiRuntimeDeviceMode({ gpuType: "cpu" })).toBe("cpu");
  });

  it("rejects unsupported ComfyUI runtime device mode overrides", () => {
    expect(() => resolveComfyUiRuntimeDeviceMode({
      env: { COMFYUI_RUNTIME_DEVICE_MODE: "vulkan" } as NodeJS.ProcessEnv,
      platform: "win32",
      hasNvidiaGpu: false,
    })).toThrow("Unsupported COMFYUI_RUNTIME_DEVICE_MODE value");
  });

  it("uses a managed ComfyUI Python environment by default", () => {
    expect(resolveComfyUiPythonEnvironmentMode({} as NodeJS.ProcessEnv)).toBe("managed-venv");
    expect(resolveComfyUiLaunchPythonExecutable({
      installRoot: "/runtime/comfy",
      basePythonCommand: "python",
      pythonEnvironmentMode: "managed-venv",
      platform: "win32",
    })).toBe(join("/runtime/comfy", ".venv", "Scripts", "python.exe"));
  });

  it("allows explicit ambient ComfyUI Python environment mode", () => {
    expect(resolveComfyUiPythonEnvironmentMode({ COMFYUI_PYTHON_ENVIRONMENT_MODE: "ambient" } as NodeJS.ProcessEnv)).toBe("ambient");
    expect(resolveComfyUiLaunchPythonExecutable({
      installRoot: "/runtime/comfy",
      basePythonCommand: "python",
      pythonEnvironmentMode: "ambient",
      platform: "win32",
    })).toBe("python");
  });

  it("rejects unsupported ComfyUI Python environment modes", () => {
    expect(() => resolveComfyUiPythonEnvironmentMode({
      COMFYUI_PYTHON_ENVIRONMENT_MODE: "global",
    } as NodeJS.ProcessEnv)).toThrow("Unsupported COMFYUI_PYTHON_ENVIRONMENT_MODE value");
  });

  it("uses the canonical ipc-main handle port type for registration options", () => {
    expectTypeOf<RegisterDesktopArtifactUploadIpcOptions["ipcMain"]>().toEqualTypeOf<IpcMainHandlePort>();
  });

  it("uses the shared huggingface fetch implementation seam type instead of DOM-global fetch typing", () => {
    expectTypeOf<NonNullable<ComposeDesktopHostOptions["artifactRepo"]>["huggingFaceFetchImplementation"]>()
      .toEqualTypeOf<HuggingFaceFetchImplementation | undefined>();
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

    expectTypeOf(host.loggingPort).toExtend<LoggingPort>();
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
    expect(classifyPythonRuntimeStdioLogLevel("stderr", "INFO:     Uvicorn running on http://127.0.0.1:47595")).toBe("info");
    expect(classifyPythonRuntimeStdioLogLevel("stderr", "Map: 100%|##########| 117/117 [00:00<00:00, 1393.06 examples/s]")).toBe("info");
    expect(classifyPythonRuntimeStdioLogLevel("stderr", "worker.py:1: UserWarning: model warning")).toBe("warn");
    expect(classifyPythonRuntimeStdioLogLevel("stderr", "Traceback (most recent call last):")).toBe("error");
  });


  it("registers the desktop artifact upload IPC handler on the request channel", () => {
    const ipcMain = {
      handle: testDouble.fn(),
    };
    const host = composeDesktopHost({
      artifactRepo: {
        huggingFaceTokenConfigFilePath: join(tmpdir(), `desktop-host-token-${Date.now()}.json`),
      },
    });

    host.registerArtifactUploadIpc({
      ipcMain,
      storageRootDirectory: join(tmpdir(), `desktop-artifact-upload-test-${Date.now()}`),
    });

    expect(ipcMain.handle).toHaveBeenCalledTimes(49);
    const channels = ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
      DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value,
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
    ]);
    const listener = ipcMain.handle.mock.calls[0]?.[1];
    expect(listener).toBeTypeOf("function");
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

  it("reuses the shared PublishArtifactToRepoUseCase in desktop host composition", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("PublishArtifactToRepoUseCase");
    expect(source).not.toContain("class DesktopPublish");
  });

  it("keeps desktop composition source free of DOM-global fetch typing to stay webpack main emit-safe", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("typeof fetch");
  });

  it("wires Hugging Face browse use-cases to the dedicated Hugging Face adapter seam", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const huggingFaceArtifactRepoStorage = createHuggingFaceArtifactRepoStorageAdapter");
    expect(source).toContain("adapter: huggingFaceArtifactRepoStorage");
    expect(source).toContain("repoBrowser: huggingFaceArtifactRepoStorage");
    expect(source).not.toContain("repoBrowser: artifactRepoStorage");
  });

  it("wires Python runtime foundation and dataset preparation use case into desktop composition", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("createPythonRuntimeAdapterFoundation");
    expect(source).toContain("createPythonRuntimeTaskRegistryAdapter");
    expect(source).not.toContain("createPythonDatasetPreparationPort");
    expect(source).toContain("ensureRuntimeReady: () => pythonRuntimeFoundation.supervisor.start()");
    expect(source).toContain("requiredCapabilities: PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES");
    expect(source).toContain("HF_HUB_DISABLE_XET");
    expect(source).toContain("PrepareTrainingDatasetFromArtifactsUseCase");
    expect(source).toContain("prepareTrainingDatasetFromArtifactsUseCase");
  });

  it("preserves the full Python runtime port when adding desktop composition logging wrappers", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");
    const runtimePortSpreadCount = source.match(/\.\.\.pythonRuntimeFoundation\.runtimePort/g)?.length ?? 0;

    expect(runtimePortSpreadCount >= 1).toBe(true);
    expect(source).not.toContain("getHealthStatus: () => pythonRuntimeFoundation.runtimePort.getHealthStatus()");
    expect(source).not.toContain("getCapabilities: () => pythonRuntimeFoundation.runtimePort.getCapabilities()");
    expect(source).not.toContain("unloadModels: () => pythonRuntimeFoundation.runtimePort.unloadModels()");
  });

  it("passes ComfyUI installer dependencies through the top-level desktop IPC composition", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const comfyUiInstallRoot = resolveComfyUiInstallRoot");
    expect(source).toContain("const comfyUiInstaller = createComfyUiRuntimeInstaller");
    expect(source).toContain("const configuredComfyUiInstallCommandTimeoutMs = Number(process.env.COMFYUI_INSTALL_COMMAND_TIMEOUT_MS)");
    expect(source).toContain("execFile: (file, args = []) => execFile(file, [...args], { timeout: comfyUiInstallCommandTimeoutMs, windowsHide: true })");
    expect(source).toContain("const resolvedRuntimeDeviceMode = resolveComfyUiRuntimeDeviceMode");
    expect(source).toContain("const comfyUiPythonEnvironmentMode = resolveComfyUiPythonEnvironmentMode");
    expect(source).toContain("pythonEnvironmentMode: comfyUiPythonEnvironmentMode");
    expect(source).toContain("runtimeDeviceMode: resolvedRuntimeDeviceMode");
    expect(source).toContain("IMAGE_GENERATION_GPU_TYPE_SETTING_KEY");
    expect(source).toContain("processReuse: modeChanged ? \"restarted_mode_changed\" : \"reused_or_started\"");
    expect(source).toContain("comfyUiInstaller,");
    expect(source).toContain("comfyUiInstallRoot,");
  });

  it("wires generated image finalization into desktop image generation IPC", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const imageGenerationFinalizationOrchestrator = new ImageGenerationFinalizationOrchestratorService");
    expect(source).toContain("createFilesystemGeneratedImagePersistenceAdapter");
    expect(source).toContain("artifactCatalogAppend: artifactCatalog");
    expect(source).toContain("imageGenerationFinalizationOrchestrator,");
  });

  it("derives the Python runtime client URL from host and port when no base URL is configured", () => {
    expect(resolvePythonRuntimeBaseUrl({ PYTHON_RUNTIME_PORT: "45123" })).toBe("http://127.0.0.1:45123");
    expect(resolvePythonRuntimeBaseUrl({
      PYTHON_RUNTIME_HOST: "localhost",
      PYTHON_RUNTIME_PORT: "45124",
    })).toBe("http://localhost:45124");
    expect(resolvePythonRuntimeBaseUrl({
      PYTHON_RUNTIME_BASE_URL: "http://192.0.2.10:46000",
      PYTHON_RUNTIME_HOST: "localhost",
      PYTHON_RUNTIME_PORT: "45124",
    })).toBe("http://192.0.2.10:46000");
  });

  it("uses a process-scoped managed Python runtime port when no runtime endpoint is configured", () => {
    expect(resolveDefaultManagedPythonRuntimePort(0)).toBe("43111");
    expect(resolveDefaultManagedPythonRuntimePort(1)).toBe("43112");
    expect(resolveDefaultManagedPythonRuntimePort(10_123)).toBe("43234");
  });

  it("passes the resolved managed Python runtime endpoint to spawned workers", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const pythonRuntimeEndpoint = resolvePythonRuntimeHostAndPort()");
    expect(source).toContain("PYTHON_RUNTIME_HOST: pythonRuntimeEndpoint.host");
    expect(source).toContain("PYTHON_RUNTIME_PORT: pythonRuntimeEndpoint.port");
  });

  it("configures Python runtime startup timeout for slower cold starts", () => {
    const canonicalSourcePath = resolve("modules/hosts/desktop/composition/composeDesktopHost.ts");
    const typeScriptPath = fileURLToPath(new URL("../composeDesktopHost.ts", import.meta.url));
    const sourcePath = existsSync(canonicalSourcePath)
      ? canonicalSourcePath
      : (existsSync(typeScriptPath) ? typeScriptPath : typeScriptPath.replace(/\.ts$/, ".js"));
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("PYTHON_RUNTIME_STARTUP_TIMEOUT_MS_DEFAULT = 60_000");
    expect(source).toContain("Number(process.env.PYTHON_RUNTIME_STARTUP_TIMEOUT_MS)");
    expect(source).toContain("startupTimeoutMs: pythonRuntimeStartupTimeoutMs");
  });

  it("stores and exposes desktop Hugging Face token status", () => {
    const host = composeDesktopHost({
      artifactRepo: {
        huggingFaceTokenConfigFilePath: join(tmpdir(), `desktop-host-token-${Date.now()}.json`),
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
    process.env.PYTHON_RUNTIME_BASE_URL = "http://127.0.0.1:1";

    try {
      const host = composeDesktopHost();

      await expect(host.startPythonRuntime()).rejects.toThrow();

      await host.readPythonRuntimeStatus();
      const statusAfterSecondRead = await host.readPythonRuntimeStatus();

      expect(statusAfterSecondRead.supervisorStatus).toBe("failed");
      const diagnosticsFetchWarnings = statusAfterSecondRead.logs.filter((entry) =>
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
  });
});

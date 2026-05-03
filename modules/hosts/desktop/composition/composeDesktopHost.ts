import { cpus, totalmem, freemem } from "node:os";
import { execFile as nodeExecFile, spawnSync } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LoggingPort } from "../../../application/ports/logging";
import { FinalizeImageGenerationService } from "../../../application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../application/services/image/image-generation-finalization-orchestrator.service";
import { TaskPowerLifecycleService } from "../../../application/services/runtime";
import { SystemArtifactIdFactory } from "../../../domain/artifact";
import {
  BrowseArtifactsUseCase,
  BrowseUnregisteredArtifactsUseCase,
  BrowseHuggingFaceDatasetParquetFilesUseCase,
  BrowseHuggingFaceNamespaceDatasetsUseCase,
  LocalizeArtifactFromRepoUseCase,
  PublishArtifactToRepoUseCase,
  ReadArtifactContentUseCase,
  ReadArtifactDetailUseCase,
  RegisterUnregisteredArtifactUseCase,
  RegisterArtifactFromRepoUseCase,
  StoreArtifactUploadUseCase,
  DeleteUnregisteredArtifactUseCase,
  DeleteRegisteredArtifactUseCase,
  VerifyImportedArtifactSourceBackingUseCase,
  VerifyPublishedArtifactBackingUseCase,
  IngestWebsitePageUseCase,
  IngestWebsitePagesBatchUseCase,
  PrepareTrainingDatasetFromArtifactsUseCase,
  ListSettingsDefinitionsUseCase,
  ReadSettingsUseCase,
  UpdateSettingUseCase,
  ClearSettingUseCase,
  ResolveModelDefaultUseCase,
  BrowseModelsUseCase,
  GetModelDetailsUseCase,
  ListModelsUseCase,
  SaveModelReferenceUseCase,
  DownloadModelUseCase,
  UpdateModelRecordUseCase,
  DeleteModelRecordUseCase,
  TrainModelUseCase,
  ValidateModelUseCase,
  PublishModelUseCase,
} from "../../../application/use-cases";
import { GenerateImageUseCase } from "../../../application/use-cases/image-generation/generate-image.use-case";
import { createLogger, type StructuredLogSink } from "../../../adapters/observability/logging";
import { createInMemorySecretsAdapter, createLocalApplicationSettingsAdapter } from "../../../adapters/persistence/settings";
import { DefaultModelDefaultResolver } from "../../../application/services/settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort, ModelDefaultResolverPort } from "../../../application/ports/settings";
import { createWebsiteHtmlAcquisitionPort } from "../../../adapters/ingestion";
import {
  createArtifactRepoStorageAdapter,
} from "../../../adapters/storage/artifact-repo";
import {
  createPythonRuntimeAdapterFoundation,
  ensurePythonRuntimeWorkerDependencies,
  createPythonRuntimeTaskRegistryAdapter,
} from "../../../adapters/runtime/python";
import {
  buildComfyUiManagedPythonExecutablePath,
  createComfyUiHttpClient,
  createComfyUiImageGenerationRuntimeAdapter,
  createComfyUiRuntimeSupervisor,
  type ComfyUiPythonEnvironmentMode,
  type ComfyUiRuntimeDeviceMode,
} from "../../../adapters/runtime/comfyui";
import { createComfyUiRuntimeInstaller } from "../../../adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";
import { createGitRuntimeInstallerAdapter } from "../../../adapters/runtime/installer/git/createGitRuntimeInstallerAdapter";
import { createRuntimeTaskRegistryRouter } from "../../../adapters/runtime/createRuntimeTaskRegistryRouter";
import { createElectronPowerSuspensionBlocker } from "../../../adapters/runtime/electron";
import {
  createFilesystemArtifactBrowserReadAdapter,
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
  createFilesystemGeneratedImagePersistenceAdapter,
  createLocalArtifactCatalogPersistenceAdapter,
  createLocalArtifactStorageBindingAdapter,
} from "../../../adapters/storage/filesystem";
import { createHuggingFaceArtifactRepoStorageAdapter } from "../../../adapters/storage/huggingface";
import type { HuggingFaceFetchImplementation } from "../../../adapters/storage/huggingface";
import { createHuggingFaceModelBrowseDetailsAdapter } from "../../../adapters/model/huggingface";
import { createHuggingFaceModelPublisherAdapter } from "../../../adapters/model/huggingface";
import { createLocalGeneratedModelStorageAdapter, createLocalModelCheckpointResolverAdapter } from "../../../adapters/model/local";
import { createLocalModelRegistryAdapter } from "../../../adapters/persistence/model";
import { createLocalImageAssetRegistryAdapter } from "../../../adapters/persistence/image";
import {
  createHuggingFaceTokenConfigStore,
  type HuggingFaceTokenStatus,
} from "../../shared/huggingFaceTokenConfigStore";
import {
  registerElectronIpc,
} from "../../../adapters/transport/ipc-electron/registerElectronIpc";
import type { IpcMainHandlePort } from "../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import { createLoggingConfig, type LoggingConfig } from "../../../contracts/config";
import { PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES } from "../../../contracts/runtime";
import type { LogLevel, LogVerbosity } from "../../../contracts/logging";
import type { PowerSuspensionBlockerPort } from "../../../application/ports/desktop";
import type { DesktopPythonRuntimeLogEntry, DesktopPythonRuntimeStatusPayload } from "../../../contracts/ipc";
import { IMAGE_GENERATION_GPU_TYPE_SETTING_KEY } from "../../../contracts/settings";

const HUGGING_FACE_TOKEN_SETTING_KEY = "huggingface.token" as const;
const execFile = promisify(nodeExecFile);

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function readMemoryUsagePercent(): number {
  const totalMemory = totalmem();
  if (totalMemory <= 0) {
    return 0;
  }

  const usedMemory = totalMemory - freemem();
  return clampPercent((usedMemory / totalMemory) * 100);
}

function readCpuUsagePercent(): number {
  const cpuEntries = cpus();
  if (cpuEntries.length === 0) {
    return 0;
  }

  let idleTotal = 0;
  let activeTotal = 0;
  for (const entry of cpuEntries) {
    const entryIdle = entry.times.idle;
    const entryActive = entry.times.user + entry.times.nice + entry.times.sys + entry.times.irq;
    idleTotal += entryIdle;
    activeTotal += entryActive;
  }

  const total = idleTotal + activeTotal;
  if (total <= 0) {
    return 0;
  }

  const previous = (readCpuUsagePercent as typeof readCpuUsagePercent & {
    previousSample?: { idleTotal: number; activeTotal: number };
  }).previousSample;
  (readCpuUsagePercent as typeof readCpuUsagePercent & {
    previousSample?: { idleTotal: number; activeTotal: number };
  }).previousSample = { idleTotal, activeTotal };

  if (!previous) {
    return clampPercent((activeTotal / total) * 100);
  }

  const idleDelta = idleTotal - previous.idleTotal;
  const activeDelta = activeTotal - previous.activeTotal;
  const totalDelta = idleDelta + activeDelta;
  if (totalDelta <= 0) {
    return 0;
  }

  return clampPercent((activeDelta / totalDelta) * 100);
}

function readGpuUsagePercent(): number {
  const result = spawnSync(
    "nvidia-smi",
    ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
    { encoding: "utf8", timeout: 800 },
  );
  if (result.status !== 0 || !result.stdout) {
    return 0;
  }

  const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return 0;
  }

  const percentages = lines
    .map((line) => Number.parseFloat(line.replace("%", "").trim()))
    .filter((value) => Number.isFinite(value));
  if (percentages.length === 0) {
    return 0;
  }

  const average = percentages.reduce((sum, value) => sum + value, 0) / percentages.length;
  return clampPercent(average);
}

export interface ComposeDesktopHostLoggingOptions {
  verbosity?: string;
  fallbackVerbosity?: LogVerbosity;
  level?: LogLevel;
  includeDiagnostics?: boolean;
}

export interface ComposeDesktopHostOptions {
  logging?: ComposeDesktopHostLoggingOptions;
  logSink?: StructuredLogSink;
  now?: () => string;
  artifactRepo?: {
    huggingFaceAccessToken?: string;
    huggingFaceTokenConfigFilePath?: string;
    huggingFaceFetchImplementation?: HuggingFaceFetchImplementation;
  };
  settings?: {
    localSettingsFilePath?: string;
  };
}

export interface RegisterDesktopArtifactUploadIpcOptions {
  ipcMain: IpcMainHandlePort;
  storageRootDirectory: string;
  runtimeRootDirectory?: string;
}

export interface DesktopHostComposition {
  loggingPort: LoggingPort;
  loggingConfig: LoggingConfig;
  applicationSettings: ApplicationSettingsPort;
  applicationSecrets: ApplicationSecretsPort;
  modelDefaultResolver: ModelDefaultResolverPort;
  getHuggingFaceTokenStatus: () => HuggingFaceTokenStatus;
  setHuggingFaceToken: (token: string) => HuggingFaceTokenStatus;
  clearHuggingFaceToken: () => HuggingFaceTokenStatus;
  startPythonRuntime: () => Promise<void>;
  stopPythonRuntime: () => Promise<void>;
  restartPythonRuntime: () => Promise<void>;
  unloadPythonRuntimeModel: () => Promise<void>;
  clearPythonRuntimeLogs: () => Promise<void>;
  readPythonRuntimeStatus: () => Promise<DesktopPythonRuntimeStatusPayload>;
  getPythonRuntimeDiagnostics: () => Promise<{ status: string; healthy: boolean; capabilities: string[] }>;
  powerSuspensionBlocker: PowerSuspensionBlockerPort;
  registerArtifactUploadIpc: (options: RegisterDesktopArtifactUploadIpcOptions) => void;
}

export function classifyPythonRuntimeStdioLogLevel(
  stream: "stdout" | "stderr",
  message: string,
): "info" | "warn" | "error" {
  if (stream === "stdout") {
    return "info";
  }

  const normalizedMessage = message.trim();
  if (/^(ERROR|CRITICAL):/i.test(normalizedMessage) || normalizedMessage.includes("Traceback (most recent call last)")) {
    return "error";
  }

  if (/^WARNING:/i.test(normalizedMessage) || /\b(?:UserWarning|FutureWarning|RuntimeWarning|DeprecationWarning):/.test(normalizedMessage)) {
    return "warn";
  }

  return "info";
}

export function resolvePythonRuntimeBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configuredBaseUrl = env.PYTHON_RUNTIME_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const { host, port } = resolvePythonRuntimeHostAndPort(env);

  return `http://${host}:${port}`;
}

const PYTHON_RUNTIME_MANAGED_BASE_PORT = 43111;
const PYTHON_RUNTIME_MANAGED_PORT_SPAN = 10_000;
const PYTHON_RUNTIME_STARTUP_TIMEOUT_MS_DEFAULT = 60_000;
const COMFYUI_INSTALL_COMMAND_TIMEOUT_MS_DEFAULT = 30 * 60 * 1000;
const DATASET_PREPARATION_TASK_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const DATASET_PREPARATION_INACTIVITY_TIMEOUT_MS = 20 * 60 * 1000;

export function resolveComfyUiInstallRoot(env: NodeJS.ProcessEnv = process.env, runtimeRootDirectory?: string): string {
  const configured = env.COMFYUI_INSTALL_ROOT?.trim();
  if (configured) return configured;
  const persistedBase = runtimeRootDirectory?.trim() || env.DESKTOP_RUNTIME_ROOT?.trim() || env.APPDATA?.trim() || env.HOME?.trim();
  if (!persistedBase) {
    throw new Error("Unable to resolve ComfyUI install root. Set COMFYUI_INSTALL_ROOT or DESKTOP_RUNTIME_ROOT.");
  }
  return join(persistedBase, "runtime-installs", "comfyui");
}

function normalizeComfyUiRuntimeDeviceMode(value: string | undefined): ComfyUiRuntimeDeviceMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "auto" || normalized === "cpu" || normalized === "directml" || normalized === "cuda") {
    return normalized;
  }

  throw new Error(`Unsupported COMFYUI_RUNTIME_DEVICE_MODE value "${value}". Use auto, cpu, directml, or cuda.`);
}

function readComfyUiEnvOverride(env: NodeJS.ProcessEnv = process.env): ComfyUiRuntimeDeviceMode | undefined {
  return normalizeComfyUiRuntimeDeviceMode(env.COMFYUI_RUNTIME_DEVICE_MODE ?? env.COMFYUI_ACCELERATOR);
}

function normalizeComfyUiPythonEnvironmentMode(value: string | undefined): ComfyUiPythonEnvironmentMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "managed-venv" || normalized === "ambient") {
    return normalized;
  }

  throw new Error(`Unsupported COMFYUI_PYTHON_ENVIRONMENT_MODE value "${value}". Use managed-venv or ambient.`);
}

export function resolveComfyUiPythonEnvironmentMode(env: NodeJS.ProcessEnv = process.env): ComfyUiPythonEnvironmentMode {
  return normalizeComfyUiPythonEnvironmentMode(env.COMFYUI_PYTHON_ENVIRONMENT_MODE) ?? "managed-venv";
}

export function resolveComfyUiLaunchPythonExecutable(input: {
  installRoot: string;
  basePythonCommand: string;
  pythonEnvironmentMode?: ComfyUiPythonEnvironmentMode;
  skipPythonSetup?: boolean;
  platform?: NodeJS.Platform;
}): string {
  if (input.pythonEnvironmentMode === "ambient" || input.skipPythonSetup === true) {
    return input.basePythonCommand;
  }

  return buildComfyUiManagedPythonExecutablePath({
    installRoot: input.installRoot,
    platform: input.platform,
  });
}

export function resolveComfyUiRuntimeDeviceMode(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  hasNvidiaGpu?: boolean;
  gpuType?: string | undefined;
} = {}): ComfyUiRuntimeDeviceMode {
  const configured = readComfyUiEnvOverride(input.env);
  if (configured) {
    return configured;
  }

  const configuredGpuType = input.gpuType?.trim().toLowerCase();
  if (configuredGpuType === "nvidia") {
    return "cuda";
  }
  if (configuredGpuType === "amd" || configuredGpuType === "intel") {
    return "directml";
  }
  if (configuredGpuType === "cpu") {
    return "cpu";
  }

  if ((input.platform ?? process.platform) === "win32" && input.hasNvidiaGpu === false) {
    return "directml";
  }

  return "auto";
}

export function detectNvidiaGpu(): boolean | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const result = spawnSync("nvidia-smi", ["-L"], { encoding: "utf8", windowsHide: true });
  if (result.error) {
    return false;
  }

  return result.status === 0 && result.stdout.trim().length > 0;
}

export function resolveDefaultManagedPythonRuntimePort(processId: number = process.pid): string {
  const processPortOffset = Math.abs(processId) % PYTHON_RUNTIME_MANAGED_PORT_SPAN;
  return String(PYTHON_RUNTIME_MANAGED_BASE_PORT + processPortOffset);
}

function resolvePythonRuntimeHostAndPort(env: NodeJS.ProcessEnv = process.env): { host: string; port: string } {
  const configuredBaseUrl = env.PYTHON_RUNTIME_BASE_URL?.trim();
  if (configuredBaseUrl) {
    try {
      const parsed = new URL(configuredBaseUrl);
      return {
        host: env.PYTHON_RUNTIME_HOST?.trim() || parsed.hostname || "127.0.0.1",
        port: env.PYTHON_RUNTIME_PORT?.trim() || parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
      };
    } catch {
      return {
        host: env.PYTHON_RUNTIME_HOST?.trim() || "127.0.0.1",
        port: env.PYTHON_RUNTIME_PORT?.trim() || resolveDefaultManagedPythonRuntimePort(),
      };
    }
  }

  return {
    host: env.PYTHON_RUNTIME_HOST?.trim() || "127.0.0.1",
    port: env.PYTHON_RUNTIME_PORT?.trim() || resolveDefaultManagedPythonRuntimePort(),
  };
}

export function composeDesktopHost(
  options: ComposeDesktopHostOptions = {},
): DesktopHostComposition {
  const loggingConfig = createLoggingConfig({
    verbosity: options.logging?.verbosity,
    fallbackVerbosity: options.logging?.fallbackVerbosity,
    level: options.logging?.level,
    includeDiagnostics: options.logging?.includeDiagnostics,
  });

  const loggingPort = createLogger({
    config: loggingConfig,
    host: "desktop",
    component: "desktop-host",
    sink: options.logSink,
    now: options.now,
  });
  const now = options.now ?? (() => new Date().toISOString());
  const runtimeLogs: DesktopPythonRuntimeLogEntry[] = [];
  let lastObservedRuntimeHealthSnapshot:
    | { supervisorStatus: string; runtimeStatus: string; healthy: boolean }
    | undefined;
  const pushRuntimeLog = (entry: DesktopPythonRuntimeLogEntry) => {
    runtimeLogs.push(entry);
    if (runtimeLogs.length > 200) {
      runtimeLogs.splice(0, runtimeLogs.length - 200);
    }
  };
  const recordRuntimeLog = (entry: Omit<DesktopPythonRuntimeLogEntry, "timestamp"> & { timestamp?: string }) => {
    const timestamp = entry.timestamp ?? now();
    const normalized: DesktopPythonRuntimeLogEntry = {
      timestamp,
      level: entry.level,
      message: entry.message,
    };
    pushRuntimeLog(normalized);
    void loggingPort.log({
      timestamp,
      level: entry.level,
      verbosity: "normal",
      event: "runtime.python.activity",
      message: normalized.message,
      component: "python-runtime-supervisor",
      data: {
        severity: entry.level,
      },
    });
  };
  const tokenConfigStore = createHuggingFaceTokenConfigStore({
    filePath: options.artifactRepo?.huggingFaceTokenConfigFilePath ?? "/tmp/ai-system-builder/desktop/hugging-face-token.json",
    fallbackToken: options.artifactRepo?.huggingFaceAccessToken,
  });
  const pythonRuntimeEndpoint = resolvePythonRuntimeHostAndPort();
  const pythonRuntimeBaseUrl = resolvePythonRuntimeBaseUrl();
  const configuredPythonRuntimeStartupTimeoutMs = Number(process.env.PYTHON_RUNTIME_STARTUP_TIMEOUT_MS);
  const pythonRuntimeStartupTimeoutMs =
    Number.isFinite(configuredPythonRuntimeStartupTimeoutMs) && configuredPythonRuntimeStartupTimeoutMs > 0
      ? configuredPythonRuntimeStartupTimeoutMs
      : PYTHON_RUNTIME_STARTUP_TIMEOUT_MS_DEFAULT;
  const pythonRuntimeEnvironment = {
    ...process.env,
    PYTHON_RUNTIME_HOST: pythonRuntimeEndpoint.host,
    PYTHON_RUNTIME_PORT: pythonRuntimeEndpoint.port,
    HF_HUB_DISABLE_XET: process.env.HF_HUB_DISABLE_XET ?? "1",
    HF_HUB_DISABLE_SYMLINKS_WARNING: process.env.HF_HUB_DISABLE_SYMLINKS_WARNING ?? "1",
  };
  const pythonRuntimeFoundation = createPythonRuntimeAdapterFoundation({
    client: {
      baseUrl: pythonRuntimeBaseUrl,
    },
    supervisor: {
      command: process.env.PYTHON_RUNTIME_COMMAND ?? (process.platform === "win32" ? "python" : "python3"),
      args: process.env.PYTHON_RUNTIME_ARGS?.split(" ").filter(Boolean) ?? ["main.py"],
      cwd: process.env.PYTHON_RUNTIME_WORKER_DIR ?? "modules/adapters/runtime/python/worker",
      env: pythonRuntimeEnvironment,
      startupTimeoutMs: pythonRuntimeStartupTimeoutMs,
      requiredCapabilities: PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES,
      prepareRuntimeEnvironment(context) {
        ensurePythonRuntimeWorkerDependencies({
          command: context.command,
          cwd: context.cwd,
          env: context.env,
        });
      },
      onEvent(event) {
        if (event.type === "stdio") {
          const message = event.detail?.trim();
          if (!message) {
            return;
          }
          const stream = event.data?.source === "stderr" ? "stderr" : "stdout";
          const level = classifyPythonRuntimeStdioLogLevel(stream, message);
          recordRuntimeLog({
            level,
            message: `Python runtime ${stream}: ${message}`,
          });
          return;
        }

        const message = event.detail ?? `Python runtime event: ${event.type}`;
        const level: "info" | "warn" | "error" = event.type === "process-error" || event.type === "startup-timeout"
          ? "error"
          : (event.type === "process-exit" ? "warn" : "info");
        recordRuntimeLog({
          level,
          message,
        });
      },
    },
  });
  const readPythonRuntimeStatus = async (): Promise<DesktopPythonRuntimeStatusPayload> => {
    const supervisorStatus = pythonRuntimeFoundation.supervisor.getStatus();
    let healthy = false;
    let runtimeStatus = supervisorStatus === "ready" ? "ready" : supervisorStatus;
    let capabilities: string[] = [];
    let loadedModels: DesktopPythonRuntimeStatusPayload["loadedModels"] = [];
    let activeTaskCount = 0;
    const shouldProbeRuntimeHttp = supervisorStatus === "starting" || supervisorStatus === "ready";
    if (shouldProbeRuntimeHttp) {
      try {
        const [health, runtimeCapabilities, modelStatus] = await Promise.all([
          pythonRuntimeFoundation.runtimePort.getHealthStatus(),
          pythonRuntimeFoundation.runtimePort.getCapabilities(),
          pythonRuntimeFoundation.runtimePort.getModelStatus(),
        ]);
        healthy = health.healthy;
        runtimeStatus = health.status.status;
        capabilities = runtimeCapabilities.capabilities;
        loadedModels = modelStatus.loadedModels;
        activeTaskCount = modelStatus.activeTaskCount;
      } catch (error) {
        runtimeStatus = "unavailable";
        const diagnosticsMessage = error instanceof Error ? error.message : String(error);
        const wasAlreadyUnavailable = lastObservedRuntimeHealthSnapshot?.runtimeStatus === "unavailable";
        if (!wasAlreadyUnavailable) {
          recordRuntimeLog({
            level: "warn",
            message: `Unable to read Python runtime diagnostics: ${diagnosticsMessage}`,
          });
        }
      }
    }

    const nextHealthSnapshot = { supervisorStatus, runtimeStatus, healthy };
    const healthChanged = lastObservedRuntimeHealthSnapshot === undefined
      || lastObservedRuntimeHealthSnapshot.supervisorStatus !== nextHealthSnapshot.supervisorStatus
      || lastObservedRuntimeHealthSnapshot.runtimeStatus !== nextHealthSnapshot.runtimeStatus
      || lastObservedRuntimeHealthSnapshot.healthy !== nextHealthSnapshot.healthy;
    if (healthChanged) {
      recordRuntimeLog({
        level: healthy ? "info" : "warn",
        message: `Python runtime health changed: supervisor=${supervisorStatus}, status=${runtimeStatus}, healthy=${healthy}.`,
      });
      lastObservedRuntimeHealthSnapshot = nextHealthSnapshot;
    }

    return {
      supervisorStatus,
      healthy,
      runtimeStatus,
      capabilities,
      loadedModels,
      activeTaskCount,
      systemResources: {
        memoryUsagePercent: readMemoryUsagePercent(),
        cpuUsagePercent: readCpuUsagePercent(),
        gpuUsagePercent: readGpuUsagePercent(),
      },
      logs: [...runtimeLogs],
    };
  };
  const applicationSettings = createLocalApplicationSettingsAdapter({
    filePath: options.settings?.localSettingsFilePath ?? "/tmp/ai-system-builder/desktop/application-settings.json",
  });
  const baseApplicationSecrets = createInMemorySecretsAdapter();
  const applicationSecrets: ApplicationSecretsPort = {
    async setSecret(key, value) {
      await baseApplicationSecrets.setSecret(key, value);
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY) {
        tokenConfigStore.setToken(value);
      }
    },
    async getSecret(key) {
      const inMemorySecret = await baseApplicationSecrets.getSecret(key);
      if (inMemorySecret?.trim()) {
        return inMemorySecret;
      }

      if (key === HUGGING_FACE_TOKEN_SETTING_KEY) {
        return tokenConfigStore.getToken();
      }

      return undefined;
    },
    async clearSecret(key) {
      await baseApplicationSecrets.clearSecret(key);
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY) {
        tokenConfigStore.clearToken();
      }
    },
    async hasSecret(key) {
      if (await baseApplicationSecrets.hasSecret(key)) {
        return true;
      }

      if (key === HUGGING_FACE_TOKEN_SETTING_KEY) {
        return Boolean(tokenConfigStore.getToken()?.trim());
      }

      return false;
    },
  };
  const modelDefaultResolver = new DefaultModelDefaultResolver({
    settings: applicationSettings,
  });

  const powerSuspensionBlocker = createElectronPowerSuspensionBlocker();
  const taskPowerLifecycle = new TaskPowerLifecycleService(powerSuspensionBlocker);
  const pythonRuntimeTaskRegistry = createPythonRuntimeTaskRegistryAdapter({ ...pythonRuntimeFoundation.runtimePort }, {
    ensureRuntimeReady: () => pythonRuntimeFoundation.supervisor.start(),
  });
  const comfyUiBaseUrl = process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188";

  return {
    loggingPort,
    loggingConfig,
    applicationSettings,
    applicationSecrets,
    modelDefaultResolver,
    powerSuspensionBlocker,
    getHuggingFaceTokenStatus() {
      return tokenConfigStore.getStatus();
    },
    setHuggingFaceToken(token: string) {
      return tokenConfigStore.setToken(token);
    },
    clearHuggingFaceToken() {
      return tokenConfigStore.clearToken();
    },
    async startPythonRuntime() {
      recordRuntimeLog({
        level: "info",
        message: "Starting Python runtime.",
      });
      await pythonRuntimeFoundation.supervisor.start();
    },
    async stopPythonRuntime() {
      recordRuntimeLog({
        level: "info",
        message: "Stopping Python runtime.",
      });
      await pythonRuntimeFoundation.supervisor.stop();
    },
    async restartPythonRuntime() {
      recordRuntimeLog({
        level: "info",
        message: "Restarting Python runtime.",
      });
      await pythonRuntimeFoundation.supervisor.restart();
    },
    async unloadPythonRuntimeModel() {
      recordRuntimeLog({
        level: "info",
        message: "Unloading Python runtime generation model from memory.",
      });
      const result = await pythonRuntimeFoundation.runtimePort.unloadModels();
      recordRuntimeLog({
        level: "info",
        message: `Unloaded ${result.unloadedModels.length} Python runtime generation model(s) from memory.`,
      });
    },
    async clearPythonRuntimeLogs() {
      runtimeLogs.splice(0, runtimeLogs.length);
      recordRuntimeLog({
        level: "info",
        message: "Cleared Python runtime activity log.",
      });
    },
    async readPythonRuntimeStatus() {
      return readPythonRuntimeStatus();
    },
    async getPythonRuntimeDiagnostics() {
      const status = await readPythonRuntimeStatus();
      return {
        status: status.runtimeStatus,
        healthy: status.healthy,
        capabilities: status.capabilities,
      };
    },
    registerArtifactUploadIpc(registerOptions) {
      const comfyUiInstallRoot = resolveComfyUiInstallRoot(process.env, registerOptions.runtimeRootDirectory);
      const comfyUiBasePythonCommand = process.env.COMFYUI_PYTHON_COMMAND ?? process.env.PYTHON_RUNTIME_COMMAND ?? (process.platform === "win32" ? "python" : "python3");
      const comfyUiPythonEnvironmentMode = resolveComfyUiPythonEnvironmentMode(process.env);
      const comfyUiSkipPythonSetup = process.env.COMFYUI_SKIP_PYTHON_SETUP === "1";
      const comfyUiPythonCommand = resolveComfyUiLaunchPythonExecutable({
        installRoot: comfyUiInstallRoot,
        basePythonCommand: comfyUiBasePythonCommand,
        pythonEnvironmentMode: comfyUiPythonEnvironmentMode,
        skipPythonSetup: comfyUiSkipPythonSetup,
      });
      const configuredComfyUiInstallCommandTimeoutMs = Number(process.env.COMFYUI_INSTALL_COMMAND_TIMEOUT_MS);
      const comfyUiInstallCommandTimeoutMs =
        Number.isFinite(configuredComfyUiInstallCommandTimeoutMs) && configuredComfyUiInstallCommandTimeoutMs > 0
          ? configuredComfyUiInstallCommandTimeoutMs
          : COMFYUI_INSTALL_COMMAND_TIMEOUT_MS_DEFAULT;
      const gitRuntimeInstaller = createGitRuntimeInstallerAdapter({ logging: loggingPort });
      const comfyUiInstaller = createComfyUiRuntimeInstaller({
        gitInstaller: gitRuntimeInstaller,
        pythonCommand: comfyUiBasePythonCommand,
        pythonEnvironmentMode: comfyUiPythonEnvironmentMode,
        runtimeDeviceMode: resolveComfyUiRuntimeDeviceMode({
          env: process.env,
          hasNvidiaGpu: detectNvidiaGpu(),
          gpuType: process.env.COMFYUI_GPU_TYPE,
        }),
        execFile: (file, args = []) => execFile(file, [...args], { timeout: comfyUiInstallCommandTimeoutMs, windowsHide: true }),
        skipPythonSetup: comfyUiSkipPythonSetup,
        skipPythonValidation: process.env.COMFYUI_SKIP_PYTHON_VALIDATION === "1",
        directMlTorchVersion: process.env.COMFYUI_DIRECTML_TORCH_VERSION,
        directMlTorchAudioVersion: process.env.COMFYUI_DIRECTML_TORCHAUDIO_VERSION,
        directMlTorchVisionVersion: process.env.COMFYUI_DIRECTML_TORCHVISION_VERSION,
        directMlPackageName: process.env.COMFYUI_DIRECTML_PACKAGE,
        logging: loggingPort,
      });
      let comfyUiSupervisor: ReturnType<typeof createComfyUiRuntimeSupervisor> | undefined;
      let activeRuntimeDeviceMode: ComfyUiRuntimeDeviceMode | undefined;
      const comfyUiSupervisorPort = {
        async start() {
          const persistedValue = (await applicationSettings.readValues({ keys: [IMAGE_GENERATION_GPU_TYPE_SETTING_KEY] }))[0]?.value;
          const persistedGpuType = typeof persistedValue === "string" ? persistedValue : undefined;
          const envOverride = readComfyUiEnvOverride(process.env);
          const resolvedRuntimeDeviceMode = resolveComfyUiRuntimeDeviceMode({
            env: process.env,
            hasNvidiaGpu: detectNvidiaGpu(),
            gpuType: persistedGpuType,
          });
          const modeChanged = activeRuntimeDeviceMode !== undefined && activeRuntimeDeviceMode !== resolvedRuntimeDeviceMode;
          if (modeChanged && comfyUiSupervisor) {
            await comfyUiSupervisor.stop();
            comfyUiSupervisor = undefined;
          }
          if (!comfyUiSupervisor) {
            const comfyUiInstaller = createComfyUiRuntimeInstaller({
              gitInstaller: gitRuntimeInstaller,
              pythonCommand: comfyUiBasePythonCommand,
              pythonEnvironmentMode: comfyUiPythonEnvironmentMode,
              runtimeDeviceMode: resolvedRuntimeDeviceMode,
              execFile: (file, args = []) => execFile(file, [...args], { timeout: comfyUiInstallCommandTimeoutMs, windowsHide: true }),
              skipPythonSetup: comfyUiSkipPythonSetup,
              skipPythonValidation: process.env.COMFYUI_SKIP_PYTHON_VALIDATION === "1",
              directMlTorchVersion: process.env.COMFYUI_DIRECTML_TORCH_VERSION,
              directMlTorchAudioVersion: process.env.COMFYUI_DIRECTML_TORCHAUDIO_VERSION,
              directMlTorchVisionVersion: process.env.COMFYUI_DIRECTML_TORCHVISION_VERSION,
              directMlPackageName: process.env.COMFYUI_DIRECTML_PACKAGE,
              logging: loggingPort,
            });
            comfyUiSupervisor = createComfyUiRuntimeSupervisor({
              workingDirectory: comfyUiInstallRoot,
              pythonExecutable: comfyUiPythonCommand,
              installer: comfyUiInstaller,
              installRoot: comfyUiInstallRoot,
              runtimeDeviceMode: resolvedRuntimeDeviceMode,
              autoInstall: true,
              installSourceRef: process.env.COMFYUI_INSTALL_REF,
              logging: loggingPort,
            });
            activeRuntimeDeviceMode = resolvedRuntimeDeviceMode;
          }
          await loggingPort.log({
            level: "info",
            message: "Resolved ComfyUI runtime mode before start.",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            event: "runtime.comfyui.mode.resolution",
            component: "desktop-host-composition",
            subsystem: "runtime",
            data: {
              persistedGpuType,
              envOverride,
              envOverrideWon: Boolean(envOverride),
              runtimeDeviceMode: resolvedRuntimeDeviceMode,
              processReuse: modeChanged ? "restarted_mode_changed" : "reused_or_started",
            },
          });
          await comfyUiSupervisor.start();
        },
        getRecentRuntimeOutput() {
          return comfyUiSupervisor?.getRecentRuntimeOutput() ?? [];
        },
        getRuntimeDeviceMode() {
          return activeRuntimeDeviceMode ?? "auto";
        },
      };
      const comfyUiRuntimeTaskRegistry = createComfyUiImageGenerationRuntimeAdapter({
        client: createComfyUiHttpClient({ baseUrl: comfyUiBaseUrl }),
        supervisor: comfyUiSupervisorPort,
        mapperOptions: { defaultCheckpoint: process.env.COMFYUI_DEFAULT_CHECKPOINT },
      });
      const runtimeTaskRegistry = createRuntimeTaskRegistryRouter({ python: pythonRuntimeTaskRegistry, image: comfyUiRuntimeTaskRegistry });

      const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
      });
      const artifactBindings = createLocalArtifactStorageBindingAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
      });
      const huggingFaceArtifactRepoStorage = createHuggingFaceArtifactRepoStorageAdapter({
        accessTokenProvider: () => tokenConfigStore.getToken(),
        fetchImplementation: options.artifactRepo?.huggingFaceFetchImplementation,
      });
      const artifactRepoStorage = createArtifactRepoStorageAdapter({
        providers: [
          {
            provider: "huggingface",
            adapter: huggingFaceArtifactRepoStorage,
          },
        ],
      });
      const storage = createFilesystemArtifactObjectStorageAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        host: "desktop",
        logging: loggingPort,
        now: options.now,
        artifactCatalogAppend: artifactCatalog,
      });
      const artifactBrowserRead = createFilesystemArtifactBrowserReadAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        artifactCatalogRead: artifactCatalog,
        artifactCatalogAppend: artifactCatalog,
        storage,
        artifactBindingRead: artifactBindings,
      });
      const artifactMediaViewRetrieval = createFilesystemArtifactContentRetrievalAdapter({
        storage,
        artifactCatalogRead: artifactCatalog,
      });
      const storeArtifactUploadUseCase = new StoreArtifactUploadUseCase({
        storage,
        logging: loggingPort,
        now: options.now,
      });

      const browseArtifacts = new BrowseArtifactsUseCase({
        artifactBrowserMetadataRead: artifactBrowserRead,
      });
      const readArtifactDetail = new ReadArtifactDetailUseCase({
        artifactBrowserMetadataRead: artifactBrowserRead,
      });
      const readArtifactContent = new ReadArtifactContentUseCase({
        artifactBrowserContentRead: artifactBrowserRead,
      });
      const browseUnregisteredArtifacts = new BrowseUnregisteredArtifactsUseCase({
        artifactBrowserUnregistered: artifactBrowserRead,
      });
      const registerUnregisteredArtifact = new RegisterUnregisteredArtifactUseCase({
        artifactBrowserUnregistered: artifactBrowserRead,
      });
      const deleteUnregisteredArtifact = new DeleteUnregisteredArtifactUseCase({
        artifactBrowserUnregistered: artifactBrowserRead,
      });
      const deleteRegisteredArtifact = new DeleteRegisteredArtifactUseCase({
        artifactCatalogRead: artifactCatalog,
        artifactCatalogDelete: artifactCatalog,
        storage,
        artifactBindingStorage: artifactBindings,
      });
      const publishArtifactToRepo = new PublishArtifactToRepoUseCase({
        artifactStorage: storage,
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        now: options.now,
      });
      const verifyPublishedArtifactBacking = new VerifyPublishedArtifactBackingUseCase({
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        now: options.now,
      });
      const verifyImportedArtifactSourceBacking = new VerifyImportedArtifactSourceBackingUseCase({
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        now: options.now,
      });
      const registerArtifactFromRepo = new RegisterArtifactFromRepoUseCase({
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        artifactCatalogAppend: artifactCatalog,
        logging: loggingPort,
        now: options.now,
        artifactIdFactory: new SystemArtifactIdFactory(),
      });
      const localizeArtifactFromRepo = new LocalizeArtifactFromRepoUseCase({
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        artifactStorage: storage,
        now: options.now,
      });
      const browseHuggingFaceNamespaceDatasets = new BrowseHuggingFaceNamespaceDatasetsUseCase({
        repoBrowser: huggingFaceArtifactRepoStorage,
        logging: loggingPort,
        now: options.now,
      });
      const browseHuggingFaceDatasetParquetFiles = new BrowseHuggingFaceDatasetParquetFilesUseCase({
        repoBrowser: huggingFaceArtifactRepoStorage,
        logging: loggingPort,
        now: options.now,
      });

      const websiteHtmlAcquisition = createWebsiteHtmlAcquisitionPort();
      const ingestWebsitePage = new IngestWebsitePageUseCase({
        acquisition: websiteHtmlAcquisition,
        storage,
        now: options.now,
      });
      const ingestWebsitePagesBatch = new IngestWebsitePagesBatchUseCase({
        ingestWebsitePage,
      });
      const prepareTrainingDatasetFromArtifactsUseCase = new PrepareTrainingDatasetFromArtifactsUseCase({
        runtimeTaskRegistry,
        storageBindings: artifactBindings,
        storage,
        artifactRepoStorage,
        artifactCatalog,
        now: options.now,
        taskPowerLifecycle,
      });
      const listSettingsDefinitions = new ListSettingsDefinitionsUseCase({
        settings: applicationSettings,
      });
      const readSettings = new ReadSettingsUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });
      const updateSetting = new UpdateSettingUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });
      const clearSetting = new ClearSettingUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });
      const resolveModelDefault = new ResolveModelDefaultUseCase({
        modelDefaultResolver,
      });
      const modelRegistry = createLocalModelRegistryAdapter({
        filePath: `${registerOptions.storageRootDirectory}/model-registry/models.json`,
        now,
      });
      const huggingFaceModelBrowseDetails = createHuggingFaceModelBrowseDetailsAdapter({
        accessTokenProvider: () => tokenConfigStore.getToken(),
      });
      const browseModels = new BrowseModelsUseCase({
        providers: {
          huggingface: huggingFaceModelBrowseDetails,
        },
      });
      const getModelDetails = new GetModelDetailsUseCase({
        providers: {
          huggingface: huggingFaceModelBrowseDetails,
        },
      });
      const listModels = new ListModelsUseCase({
        modelRegistry,
      });
      const modelPublisher = createHuggingFaceModelPublisherAdapter({
        tokenProvider: () => tokenConfigStore.getToken(),
        client: {
          async uploadFile(params) {
            const hub = await import("@huggingface/hub");
            await hub.uploadFile({
              repo: { type: "model", name: params.repo },
              file: {
                path: params.path,
                content: new Blob([new Uint8Array(params.content)]),
              },
              branch: params.revision,
              accessToken: params.token,
            });
          },
        },
      });
      const saveModelReference = new SaveModelReferenceUseCase({
        modelRegistry,
      });
      const downloadModel = new DownloadModelUseCase({
        modelRegistry,
        modelDownloader: {
          ensureModelDownloaded: async (request) => {
            await pythonRuntimeFoundation.supervisor.start();
            return pythonRuntimeFoundation.runtimePort.ensureModelDownloaded(request);
          },
        },
      });
      const updateModelRecord = new UpdateModelRecordUseCase({
        modelRegistry,
      });
      const deleteModelRecord = new DeleteModelRecordUseCase({
        modelRegistry,
        artifactCatalogDeletePort: artifactCatalog,
      });
      const trainModel = new TrainModelUseCase({
        runtimeTaskRegistry,
        modelRegistry,
        storageBindings: artifactBindings,
        storage,
        generatedModelStorage: createLocalGeneratedModelStorageAdapter({
          env: process.env,
        }),
        modelPublisher,
        taskPowerLifecycle,
      });
      const validateModel = new ValidateModelUseCase({
        runtimeTaskRegistry,
        modelRegistry,
      });
      // TODO(prompt-7): remove legacy modelPublisher/modelValidationPort wiring after executeTask deprecation cleanup.
      const publishModel = new PublishModelUseCase({
        modelRegistry,
        runtimeTaskRegistry,
      });
      const generateImageUseCase = new GenerateImageUseCase({
        runtimeTaskRegistry,
        modelCheckpointResolver: createLocalModelCheckpointResolverAdapter({
          modelRegistry,
          comfyUiCheckpointDirectory: join(comfyUiInstallRoot, "models", "checkpoints"),
          log: (entry) => recordRuntimeLog({ level: "info", message: `Image generation model checkpoint resolution: ${JSON.stringify(entry)}` }),
        }),
      });
      const imageGenerationFinalizationOrchestrator = new ImageGenerationFinalizationOrchestratorService({
        runtimeTaskRegistry,
        finalizeImageGenerationService: new FinalizeImageGenerationService({
          imageAssetRegistry: createLocalImageAssetRegistryAdapter({
            filePath: join(registerOptions.storageRootDirectory, ".catalog", "image-assets.json"),
            now,
          }),
          generatedImagePersistence: createFilesystemGeneratedImagePersistenceAdapter({
            comfyUiOutputRoot: join(comfyUiInstallRoot, "output"),
            artifactStorageRoot: registerOptions.storageRootDirectory,
            artifactCatalogAppend: artifactCatalog,
            logging: loggingPort,
            now,
          }),
          now,
        }),
      });

      registerElectronIpc({
        ipcMain: registerOptions.ipcMain,
        pythonRuntime: {
          startPythonRuntime: () => pythonRuntimeFoundation.supervisor.start(),
          stopPythonRuntime: () => pythonRuntimeFoundation.supervisor.stop(),
          restartPythonRuntime: () => pythonRuntimeFoundation.supervisor.restart(),
          unloadPythonRuntimeModel: async () => {
            recordRuntimeLog({
              level: "info",
              message: "Unloading Python runtime generation model from memory.",
            });
            const result = await pythonRuntimeFoundation.runtimePort.unloadModels();
            recordRuntimeLog({
              level: "info",
              message: `Unloaded ${result.unloadedModels.length} Python runtime generation model(s) from memory.`,
            });
          },
          clearPythonRuntimeLogs: async () => {
            runtimeLogs.splice(0, runtimeLogs.length);
            recordRuntimeLog({
              level: "info",
              message: "Cleared Python runtime activity log.",
            });
          },
          readPythonRuntimeStatus,
        },
        getHuggingFaceTokenStatus: () => tokenConfigStore.getStatus(),
        setHuggingFaceToken: (token) => tokenConfigStore.setToken(token),
        clearHuggingFaceToken: () => tokenConfigStore.clearToken(),
        storeArtifactUploadUseCase,
        browseArtifactsUseCase: browseArtifacts,
        browseUnregisteredArtifactsUseCase: browseUnregisteredArtifacts,
        registerUnregisteredArtifactUseCase: registerUnregisteredArtifact,
        deleteUnregisteredArtifactUseCase: deleteUnregisteredArtifact,
        deleteRegisteredArtifactUseCase: deleteRegisteredArtifact,
        readArtifactDetailUseCase: readArtifactDetail,
        readArtifactContentUseCase: readArtifactContent,
        artifactMediaViewRetrieval,
        publishArtifactToRepoUseCase: publishArtifactToRepo,
        browseHuggingFaceNamespaceDatasetsUseCase: browseHuggingFaceNamespaceDatasets,
        browseHuggingFaceDatasetParquetFilesUseCase: browseHuggingFaceDatasetParquetFiles,
        verifyPublishedArtifactBackingUseCase: verifyPublishedArtifactBacking,
        verifyImportedArtifactSourceBackingUseCase: verifyImportedArtifactSourceBacking,
        registerArtifactFromRepoUseCase: registerArtifactFromRepo,
        localizeArtifactFromRepoUseCase: localizeArtifactFromRepo,
        ingestWebsitePageUseCase: ingestWebsitePage,
        ingestWebsitePagesBatchUseCase: ingestWebsitePagesBatch,
        prepareTrainingDatasetUseCase: prepareTrainingDatasetFromArtifactsUseCase,
        listSettingsDefinitionsUseCase: listSettingsDefinitions,
        readSettingsUseCase: readSettings,
        updateSettingUseCase: updateSetting,
        clearSettingUseCase: clearSetting,
        resolveModelDefaultUseCase: resolveModelDefault,
        browseModelsUseCase: browseModels,
        getModelDetailsUseCase: getModelDetails,
        listModelsUseCase: listModels,
        saveModelReferenceUseCase: saveModelReference,
        downloadModelUseCase: downloadModel,
        updateModelRecordUseCase: updateModelRecord,
        deleteModelRecordUseCase: deleteModelRecord,
        trainModelUseCase: trainModel,
        validateModelUseCase: validateModel,
        publishModelUseCase: publishModel,
        generateImageUseCase,
        imageGenerationFinalizationOrchestrator,
        comfyUiInstaller,
        comfyUiInstallRoot,
      });
    },
  };
}

import type { LoggingPort } from "../../../application/ports/logging";
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
} from "../../../application/use-cases";
import { createLogger, type StructuredLogSink } from "../../../adapters/observability/logging";
import { createInMemorySecretsAdapter, createLocalApplicationSettingsAdapter } from "../../../adapters/persistence/settings";
import { DefaultModelDefaultResolver } from "../../../application/services/settings";
import type { ApplicationSecretsPort, ApplicationSettingsPort, ModelDefaultResolverPort } from "../../../application/ports/settings";
import { createWebsiteHtmlAcquisitionPort } from "../../../adapters/ingestion";
import {
  createArtifactRepoStorageAdapter,
} from "../../../adapters/storage/artifact-repo";
import {
  createPythonDatasetPreparationPort,
  createPythonRuntimeAdapterFoundation,
  ensurePythonRuntimeWorkerDependencies,
} from "../../../adapters/runtime/python";
import {
  createFilesystemArtifactBrowserReadAdapter,
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
  createLocalArtifactCatalogPersistenceAdapter,
  createLocalArtifactStorageBindingAdapter,
} from "../../../adapters/storage/filesystem";
import { createHuggingFaceArtifactRepoStorageAdapter } from "../../../adapters/storage/huggingface";
import type { HuggingFaceFetchImplementation } from "../../../adapters/storage/huggingface";
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
import type { DesktopPythonRuntimeLogEntry, DesktopPythonRuntimeStatusPayload } from "../../../contracts/ipc";

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
  readPythonRuntimeStatus: () => Promise<DesktopPythonRuntimeStatusPayload>;
  getPythonRuntimeDiagnostics: () => Promise<{ status: string; healthy: boolean; capabilities: string[] }>;
  registerArtifactUploadIpc: (options: RegisterDesktopArtifactUploadIpcOptions) => void;
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
          const level = stream === "stderr" ? "warn" : "info";
          recordRuntimeLog({
            level,
            message: `Python runtime ${stream}: ${message}`,
          });
          return;
        }

        const message = event.detail ?? `Python runtime event: ${event.type}`;
        const level: "info" | "warn" | "error" = event.type === "process-error" || event.type === "startup-timeout"
          ? "error"
          : (event.type === "health-probe-failed" || event.type === "process-exit" ? "warn" : "info");
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
      logs: [...runtimeLogs],
    };
  };
  const applicationSettings = createLocalApplicationSettingsAdapter({
    filePath: options.settings?.localSettingsFilePath ?? "/tmp/ai-system-builder/desktop/application-settings.json",
  });
  const applicationSecrets = createInMemorySecretsAdapter();
  const modelDefaultResolver = new DefaultModelDefaultResolver({
    settings: applicationSettings,
  });

  const datasetPreparationPort = createPythonDatasetPreparationPort({
    executeTask: async (request) => {
      recordRuntimeLog({
        level: "info",
        message: "Preparing dataset in Python runtime.",
      });
      const result = await pythonRuntimeFoundation.runtimePort.executeTask(request);
      if (result.success) {
        recordRuntimeLog({
          level: "info",
          message: "Dataset preparation finished successfully.",
        });
      } else {
        recordRuntimeLog({
          level: "error",
          message: `Dataset preparation failed: ${result.error?.message ?? "Unknown runtime error."}`,
        });
      }

      return result;
    },
    getHealthStatus: () => pythonRuntimeFoundation.runtimePort.getHealthStatus(),
    getCapabilities: () => pythonRuntimeFoundation.runtimePort.getCapabilities(),
    ensureModelDownloaded: async (request) => {
      const availability = await pythonRuntimeFoundation.runtimePort.ensureModelDownloaded(request);
      recordRuntimeLog({
        level: "info",
        message: availability.localPath
          ? `Generation model ${request.modelId} will be loaded from ${availability.localPath}.`
          : `Generation model ${request.modelId} will be loaded from the configured Transformers model reference.`,
      });
      return availability;
    },
    getModelStatus: () => pythonRuntimeFoundation.runtimePort.getModelStatus(),
    unloadModels: () => pythonRuntimeFoundation.runtimePort.unloadModels(),
  }, {
    ensureRuntimeReady: () => pythonRuntimeFoundation.supervisor.start(),
  });

  return {
    loggingPort,
    loggingConfig,
    applicationSettings,
    applicationSecrets,
    modelDefaultResolver,
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
      const prepareTrainingDatasetFromArtifacts = new PrepareTrainingDatasetFromArtifactsUseCase({
        datasetPreparation: datasetPreparationPort,
        storageBindings: artifactBindings,
        storage,
        artifactRepoStorage,
        artifactCatalog,
        now: options.now,
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
        prepareTrainingDatasetFromArtifactsUseCase: prepareTrainingDatasetFromArtifacts,
        listSettingsDefinitionsUseCase: listSettingsDefinitions,
        readSettingsUseCase: readSettings,
        updateSettingUseCase: updateSetting,
        clearSettingUseCase: clearSetting,
        resolveModelDefaultUseCase: resolveModelDefault,
      });
    },
  };
}

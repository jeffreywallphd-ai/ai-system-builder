import { randomUUID } from "node:crypto";
import { cpus, freemem, totalmem } from "node:os";
import path from "node:path";
import type { LoggingPort } from "../../../application/ports/logging";
import type {
  ApplicationSecretsPort,
  ApplicationSettingsPort,
  ModelDefaultResolverPort,
} from "../../../application/ports/settings";
import type { PowerSuspensionBlockerPort } from "../../../application/ports/desktop";
import type { AssetCustomizationTargetReaderPort } from "../../../application/ports/asset-authoring";
import { DefaultModelDefaultResolver } from "../../../application/services/settings";
import { ClearSettingUseCase } from "../../../application/use-cases/settings/clear-setting.use-case";
import { ListSettingsDefinitionsUseCase } from "../../../application/use-cases/settings/list-settings-definitions.use-case";
import { ReadSettingsUseCase } from "../../../application/use-cases/settings/read-settings.use-case";
import { ResolveModelDefaultUseCase } from "../../../application/use-cases/settings/resolve-model-default.use-case";
import { UpdateSettingUseCase } from "../../../application/use-cases/settings/update-setting.use-case";
import { CreateWorkspaceUseCase } from "../../../application/use-cases/workspace";
import { LinkUserLibraryAssetToWorkspaceUseCase } from "../../../application/use-cases/user-library";
import {
  CreateAssetDraftUseCase,
  CreateAssetOverrideUseCase,
  CreateWorkspaceAuthoredAssetUseCase,
  DisableAssetOverrideUseCase,
  PublishAssetDraftUseCase,
  UpdateAssetDraftUseCase,
  UpdateAssetOverrideUseCase,
} from "../../../application/use-cases/asset-authoring";
import {
  CreateAuthoredAssetEffectiveProjectionUseCase,
  CreateOverrideEffectiveProjectionUseCase,
  PreviewDraftEffectiveAssetProjectionUseCase,
  RefreshAuthoredAssetEffectiveProjectionUseCase,
  RefreshOverrideEffectiveProjectionUseCase,
} from "../../../application/use-cases/effective-asset-projections";
import {
  AddProjectionToCompositionPlanUseCase,
  ArchiveAssetCompositionPlanUseCase,
  ConnectCompositionNodesUseCase,
  CreateAssetCompositionPlanUseCase,
  DisconnectCompositionNodesUseCase,
  ListAssetCompositionPlansUseCase,
  ReadAssetCompositionPlanUseCase,
  RemoveProjectionFromCompositionPlanUseCase,
  UpdateAssetCompositionPlanUseCase,
  ValidateAssetCompositionPlanUseCase,
} from "../../../application/use-cases/asset-composition";
import {
  CreateRuntimeReadinessBindingUseCase,
  ValidateRuntimeReadinessBindingUseCase,
  RuntimeRequirementExtractionService,
  RuntimeCapabilityMatchingService,
  RuntimeBindingCandidateSelectionService,
  RuntimeReadinessValidationService,
} from "../../../application/use-cases/runtime-readiness";
import {
  WorkspaceAssetCompositionReadModelService,
  WorkspaceEffectiveAssetProjectionReadModelService,
} from "../../../application/services/asset";
import {
  RuntimeCapabilityInventoryService,
  RuntimeCapabilityInventorySummaryService,
  WorkspaceRuntimeReadinessReadModelService,
} from "../../../application/services/runtime-readiness";
import {
  normalizeRuntimeBindingCandidateId,
  normalizeRuntimeBindingId,
  normalizeRuntimeRequirementId,
} from "../../../contracts/runtime-readiness";
import {
  createLogger,
  type StructuredLogSink,
} from "../../../adapters/observability/logging";
import {
  createInMemorySecretsAdapter,
  createLocalApplicationSettingsAdapter,
} from "../../../adapters/persistence/settings";
import {
  createLocalWorkspaceRepository,
  createLocalWorkspaceSelectionRepository,
  createLocalWorkspaceSystemPackActivationRepository,
} from "../../../adapters/persistence/workspace";
import {
  createLocalUserLibraryAssetRepositoryAdapter,
  createLocalWorkspaceUserLibraryLinkRepositoryAdapter,
} from "../../../adapters/persistence/user-library";
import {
  createLocalAssetDraftRepositoryAdapter,
  createLocalAssetOverrideRepositoryAdapter,
  createLocalAssetRevisionRepositoryAdapter,
  createLocalAuthoredAssetRepositoryAdapter,
} from "../../../adapters/persistence/asset-authoring";
import { createLocalEffectiveAssetProjectionRepositoryAdapter } from "../../../adapters/persistence/effective-asset-projections";
import { createLocalAssetCompositionPlanRepositoryAdapter } from "../../../adapters/persistence/asset-composition";
import {
  createLocalRuntimeInventoryRepositoryAdapter,
  createLocalRuntimeReadinessBindingRepositoryAdapter,
} from "../../../adapters/persistence/runtime-readiness";
import { createLocalExecutionPlanRepositoryAdapter } from "../../../adapters/persistence/execution-plans";
import { createLocalConversationRepositoryAdapters } from "../../../adapters/persistence/conversations";
import { createLocalExecutionRunRepositoryAdapters } from "../../../adapters/persistence/execution-runs";
import { composeExecutionPlanServices } from "../../shared/composition/composeExecutionPlanServices";
import { composeConversationExecutionServices } from "../../shared/composition/composeConversationExecutionServices";
import { composeSystemPublishedConversationRuntime } from "../../shared/composition/composeSystemPublishedConversationRuntime";
import {
  createConversationWorkflowHandler,
  createSystemDataWorkflowHandler,
  createSystemDeploymentWorkflowHandler,
  createSystemReviewWorkflowHandler,
} from "../../../application/services/system-run-workflow";
import { composeSystemRunWorkflow } from "../../shared/composition/composeSystemRunWorkflow";
import { registerElectronIpc } from "../../../adapters/transport/ipc-electron/registerElectronIpc";
import type { IpcMainHandlePort } from "../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import type { IpcSenderTrustPolicy } from "../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import { createJsonlSecurityAuditLogAdapter } from "../../../adapters/security/audit/createJsonlSecurityAuditLogAdapter";
import {
  createOrganizationId,
  type LocalIdentityProfile,
} from "../../../contracts/organization";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";
import {
  createLoggingConfig,
  type LoggingConfig,
} from "../../../contracts/config";
import { SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY } from "../../../contracts/settings";
import type { LogLevel, LogVerbosity } from "../../../contracts/logging";
import type {
  DesktopPythonRuntimeLogEntry,
  DesktopPythonRuntimeStatusPayload,
} from "../../../contracts/ipc";
import type { HuggingFaceFetchImplementation } from "../../../adapters/storage/huggingface";
import {
  createHuggingFaceTokenConfigStore,
  type HuggingFaceTokenStatus,
} from "../../shared/huggingFaceTokenConfigStore";
import type { InternalAssetRegistryComposition } from "../../shared/composition/composeInternalAssetRegistry";
import { recordDesktopMemorySnapshot } from "../diagnostics";
import { createDesktopRuntimeReadinessService } from "./composeDesktopRuntimeReadiness";
import {
  createDesktopFeatureLifecycleRegistry,
  createDesktopFeatureFailureDetail,
  type DesktopFeatureDisposeReason,
  type DesktopFeatureDisposeResult,
  type DesktopFeatureLifecyclePolicy,
  type DesktopFeatureLifecycleStateEntry,
} from "./featureLifecycle";
import {
  createUnavailablePythonRuntimeStatus,
  resolvePythonRuntimeBaseUrl,
  type DesktopPythonRuntimeFeature,
} from "./desktopPythonRuntimeHelpers";
import {
  createPythonConversationalRuntimeAdapterCatalog,
  createPythonConversationalRuntimeGuard,
  createPythonConversationalTextGenerationInvocationAdapter,
} from "../../../adapters/runtime/conversational-text-generation";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import {
  createLocalSqliteSystemRuntimeDatabaseAdapter,
  type LocalSqliteSystemRuntimeDatabaseAdapter,
} from "../../../adapters/persistence/system-runtime";
import { composeSystemBuilder } from "../../shared/composition/composeSystemBuilder";
import type { SystemBuildArtifactPort } from "../../../application/ports/system-build";
import {
  createSha256SystemBuildHasher,
  createSystemBuildArtifactAdapter,
} from "../../../adapters/storage/system-build";
import { composeSystemBuild } from "../../shared/composition/composeSystemBuild";
import { composeSystemData } from "../../shared/composition/composeSystemData";
import { composeSystemReview } from "../../shared/composition/composeSystemReview";
import {
  composeSystemDeployment,
  createDefaultSystemDeploymentPolicy,
} from "../../shared/composition/composeSystemDeployment";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../../../adapters/runtime/system-deployment";
import { SystemDeploymentReleaseBindingService } from "../../../application/services/system-deployment";
import { normalizeSystemRuntimeInstanceId } from "../../../contracts/system-deployment";
import {
  createDesktopPublishedSystemRuntimeLifecycle,
  type DesktopPublishedSystemRuntimeWindowPort,
} from "./desktopPublishedSystemRuntimeLifecycle";
export {
  createDesktopRuntimeReadinessService,
  type CreateDesktopRuntimeReadinessServiceOptions,
} from "./composeDesktopRuntimeReadiness";

const HUGGING_FACE_TOKEN_SETTING_KEY = "huggingface.token" as const;
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function readMemoryUsagePercent(): number {
  const totalMemory = totalmem();
  if (totalMemory <= 0) return 0;
  return clampPercent(((totalMemory - freemem()) / totalMemory) * 100);
}

function readCpuUsagePercent(): number {
  const cpuEntries = cpus();
  if (cpuEntries.length === 0) return 0;
  let idleTotal = 0;
  let activeTotal = 0;
  for (const entry of cpuEntries) {
    idleTotal += entry.times.idle;
    activeTotal +=
      entry.times.user + entry.times.nice + entry.times.sys + entry.times.irq;
  }
  const total = idleTotal + activeTotal;
  if (total <= 0) return 0;
  const previous = (
    readCpuUsagePercent as typeof readCpuUsagePercent & {
      previousSample?: { idleTotal: number; activeTotal: number };
    }
  ).previousSample;
  (
    readCpuUsagePercent as typeof readCpuUsagePercent & {
      previousSample?: { idleTotal: number; activeTotal: number };
    }
  ).previousSample = { idleTotal, activeTotal };
  if (!previous) return clampPercent((activeTotal / total) * 100);
  const idleDelta = idleTotal - previous.idleTotal;
  const activeDelta = activeTotal - previous.activeTotal;
  const totalDelta = idleDelta + activeDelta;
  return totalDelta <= 0 ? 0 : clampPercent((activeDelta / totalDelta) * 100);
}

export const DESKTOP_FEATURE_LIFECYCLE_POLICIES = {
  "artifact-local": "retained",
  "artifact-remote": "disposable",
  "asset-registry": "retained",
  "comfyui-install": "retained",
  "comfyui-image-runtime": "explicit-unload-only",
  "runtime-task-registry": "explicit-unload-only",
  "model-registry": "retained",
  "image-generation": "disposable",
  "website-ingestion": "disposable",
  "dataset-preparation": "disposable",
} as const satisfies Record<string, DesktopFeatureLifecyclePolicy>;

export type DesktopFeatureLifecycleKey =
  keyof typeof DESKTOP_FEATURE_LIFECYCLE_POLICIES;

export interface ComposeDesktopHostLoggingOptions {
  verbosity?: string;
  fallbackVerbosity?: LogVerbosity;
  level?: LogLevel;
  includeDiagnostics?: boolean;
}

export interface ComposeDesktopHostOptions {
  localIdentity?: LocalIdentityProfile;
  persistence?: {
    documents: StructuredDocumentStore;
    organizationDocuments?: StructuredDocumentStore;
  };
  logging?: ComposeDesktopHostLoggingOptions;
  logSink?: StructuredLogSink;
  now?: () => string;
  artifactRepo?: {
    huggingFaceAccessToken?: string;
    huggingFaceTokenConfigFilePath?: string;
    huggingFaceFetchImplementation?: HuggingFaceFetchImplementation;
  };
  settings?: { localSettingsFilePath?: string };
  runtimeDataRootDirectory?: string;
  runtimeDatabases?: LocalSqliteSystemRuntimeDatabaseAdapter;
  folderPicker?: {
    selectFolder: (options?: {
      title?: string;
      defaultPath?: string;
    }) => Promise<{ canceled: boolean; path?: string }>;
  };
}

export interface RegisterDesktopArtifactUploadIpcOptions {
  ipcMain: IpcMainHandlePort;
  senderTrust: IpcSenderTrustPolicy;
  storageRootDirectory: string;
  runtimeRootDirectory?: string;
  systemRuntimeWindows?: DesktopPublishedSystemRuntimeWindowPort;
}

export interface DesktopHostComposition {
  loggingPort: LoggingPort;
  loggingConfig: LoggingConfig;
  applicationSettings: ApplicationSettingsPort;
  applicationSecrets: ApplicationSecretsPort;
  systemRuntimeDatabases?: LocalSqliteSystemRuntimeDatabaseAdapter;
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
  getPythonRuntimeDiagnostics: () => Promise<{
    status: string;
    healthy: boolean;
    capabilities: string[];
  }>;
  powerSuspensionBlocker: PowerSuspensionBlockerPort;
  registerDesktopIpc: (
    options: RegisterDesktopArtifactUploadIpcOptions,
  ) => void;
  registerArtifactUploadIpc: (
    options: RegisterDesktopArtifactUploadIpcOptions,
  ) => void;
  getInternalAssetRegistry: () => InternalAssetRegistryComposition | undefined;
  getFeatureLifecycleState: () => DesktopFeatureLifecycleStateEntry[];
  disposeFeature: (
    featureKey: string,
    reason?: DesktopFeatureDisposeReason,
  ) => Promise<DesktopFeatureDisposeResult>;
  markFeatureIdle: (
    featureKey: string,
    reason?: DesktopFeatureDisposeReason,
  ) => boolean;
  disposeIdleFeatures: (
    reason?: DesktopFeatureDisposeReason,
  ) => Promise<DesktopFeatureDisposeResult[]>;
}

export function composeDesktopHost(
  options: ComposeDesktopHostOptions = {},
): DesktopHostComposition {
  const recordHostMemorySnapshot = (
    milestone: string,
    detail?: Record<string, unknown>,
  ) =>
    recordDesktopMemorySnapshot({
      milestone,
      component: "desktop-host-composition",
      detail,
    });
  const memoizeSyncFeature = <T>(
    milestoneBase: string,
    compose: () => T,
  ): (() => T) => {
    let value: T | undefined;
    return () => {
      if (value !== undefined) return value;
      recordHostMemorySnapshot(`${milestoneBase}.before`);
      value = compose();
      recordHostMemorySnapshot(`${milestoneBase}.after`);
      return value;
    };
  };

  recordHostMemorySnapshot("desktop.host.compose.enter");
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
  recordHostMemorySnapshot("desktop.host.logging.ready");
  const featureLifecycle = createDesktopFeatureLifecycleRegistry({
    loggingPort,
    recordMilestone: recordHostMemorySnapshot,
  });

  const now = options.now ?? (() => new Date().toISOString());
  const organizationDocuments =
    options.persistence?.organizationDocuments ??
    options.persistence?.documents;
  const runtimeLogs: DesktopPythonRuntimeLogEntry[] = [];
  let lastObservedRuntimeHealthSnapshot:
    | { supervisorStatus: string; runtimeStatus: string; healthy: boolean }
    | undefined;
  const pushRuntimeLog = (entry: DesktopPythonRuntimeLogEntry) => {
    runtimeLogs.push(entry);
    if (runtimeLogs.length > 200)
      runtimeLogs.splice(0, runtimeLogs.length - 200);
  };
  const recordRuntimeLog = (
    entry: Omit<DesktopPythonRuntimeLogEntry, "timestamp"> & {
      timestamp?: string;
    },
  ) => {
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
      data: { severity: entry.level },
    });
  };

  const tokenConfigStore = createHuggingFaceTokenConfigStore({
    filePath:
      options.artifactRepo?.huggingFaceTokenConfigFilePath ??
      "/tmp/ai-system-builder/desktop/hugging-face-token.json",
    fallbackToken: options.artifactRepo?.huggingFaceAccessToken,
  });
  recordHostMemorySnapshot("desktop.host.token-config.ready", {
    tokenConfigured: Boolean(
      options.artifactRepo?.huggingFaceAccessToken?.trim(),
    ),
    tokenConfigPathConfigured: Boolean(
      options.artifactRepo?.huggingFaceTokenConfigFilePath?.trim(),
    ),
  });

  const applicationSettings = createLocalApplicationSettingsAdapter({
    filePath:
      options.settings?.localSettingsFilePath ??
      "/tmp/ai-system-builder/desktop/application-settings.json",
    documents: options.persistence?.documents,
  });
  recordHostMemorySnapshot("desktop.host.settings.ready", {
    settingsPathConfigured: Boolean(
      options.settings?.localSettingsFilePath?.trim(),
    ),
  });
  const baseApplicationSecrets = createInMemorySecretsAdapter();
  const applicationSecrets: ApplicationSecretsPort = {
    async setSecret(key, value) {
      await baseApplicationSecrets.setSecret(key, value);
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY)
        tokenConfigStore.setToken(value);
    },
    async getSecret(key) {
      const inMemorySecret = await baseApplicationSecrets.getSecret(key);
      if (inMemorySecret?.trim()) return inMemorySecret;
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY)
        return tokenConfigStore.getToken();
      return undefined;
    },
    async clearSecret(key) {
      await baseApplicationSecrets.clearSecret(key);
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY) tokenConfigStore.clearToken();
    },
    async hasSecret(key) {
      if (await baseApplicationSecrets.hasSecret(key)) return true;
      if (key === HUGGING_FACE_TOKEN_SETTING_KEY)
        return Boolean(tokenConfigStore.getToken()?.trim());
      return false;
    },
  };
  const modelDefaultResolver = new DefaultModelDefaultResolver({
    settings: applicationSettings,
  });
  const readRuntimeSettingString = async (
    key: string,
  ): Promise<string | undefined> => {
    const value = (await applicationSettings.readValues({ keys: [key] }))[0]
      ?.value;
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  };
  const readSharedModelStorageDirectory = () =>
    readRuntimeSettingString(SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY);

  let pythonRuntimeFoundationPromise:
    Promise<DesktopPythonRuntimeFeature> | undefined;
  const getPythonRuntimeFoundation = async () => {
    if (!pythonRuntimeFoundationPromise) {
      pythonRuntimeFoundationPromise = (async () => {
        recordHostMemorySnapshot(
          "desktop.host.python-runtime-foundation.import.before",
        );
        const module = await import("./composeDesktopPythonRuntimeFeature");
        recordHostMemorySnapshot(
          "desktop.host.python-runtime-foundation.import.after",
        );
        recordHostMemorySnapshot(
          "desktop.host.python-runtime-foundation.compose.before",
        );
        const feature = await module.composeDesktopPythonRuntimeFeature({
          loggingPort,
          now,
          runtimeLogs,
          recordRuntimeLog,
        });
        recordHostMemorySnapshot(
          "desktop.host.python-runtime-foundation.compose.after",
          { baseUrlConfigured: Boolean(resolvePythonRuntimeBaseUrl()) },
        );
        return feature;
      })();
    }
    return pythonRuntimeFoundationPromise;
  };

  const readPythonRuntimeStatus =
    async (): Promise<DesktopPythonRuntimeStatusPayload> => {
      if (!pythonRuntimeFoundationPromise) {
        const status = createUnavailablePythonRuntimeStatus({
          runtimeLogs,
          memoryUsagePercent: readMemoryUsagePercent(),
          cpuUsagePercent: readCpuUsagePercent(),
        });
        if (!lastObservedRuntimeHealthSnapshot) {
          lastObservedRuntimeHealthSnapshot = {
            supervisorStatus: "stopped",
            runtimeStatus: "unavailable",
            healthy: false,
          };
          recordRuntimeLog({
            level: "warn",
            message:
              "Python runtime health changed: supervisor=stopped, status=unavailable, healthy=false.",
          });
          return { ...status, logs: [...runtimeLogs] };
        }
        return status;
      }
      const pythonRuntimeFoundation = await pythonRuntimeFoundationPromise;
      const supervisorStatus = pythonRuntimeFoundation.supervisor.getStatus();
      let healthy = false;
      let runtimeStatus =
        supervisorStatus === "ready" ? "ready" : supervisorStatus;
      let capabilities: string[] = [];
      let loadedModels: DesktopPythonRuntimeStatusPayload["loadedModels"] = [];
      let activeTaskCount = 0;
      if (supervisorStatus === "starting" || supervisorStatus === "ready") {
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
          const diagnosticsMessage =
            error instanceof Error ? error.message : String(error);
          if (
            lastObservedRuntimeHealthSnapshot?.runtimeStatus !== "unavailable"
          )
            recordRuntimeLog({
              level: "warn",
              message: `Unable to read Python runtime diagnostics: ${diagnosticsMessage}`,
            });
        }
      }
      const nextHealthSnapshot = { supervisorStatus, runtimeStatus, healthy };
      const healthChanged =
        lastObservedRuntimeHealthSnapshot === undefined ||
        lastObservedRuntimeHealthSnapshot.supervisorStatus !==
          nextHealthSnapshot.supervisorStatus ||
        lastObservedRuntimeHealthSnapshot.runtimeStatus !==
          nextHealthSnapshot.runtimeStatus ||
        lastObservedRuntimeHealthSnapshot.healthy !==
          nextHealthSnapshot.healthy;
      if (healthChanged) {
        recordRuntimeLog({
          level: healthy ? "info" : "warn",
          message: `Python runtime health changed: supervisor=${supervisorStatus}, status=${runtimeStatus}, healthy=${healthy}.`,
        });
        lastObservedRuntimeHealthSnapshot = nextHealthSnapshot;
      }
      return {
        supervisorStatus:
          supervisorStatus as DesktopPythonRuntimeStatusPayload["supervisorStatus"],
        healthy,
        runtimeStatus,
        capabilities,
        loadedModels,
        activeTaskCount,
        systemResources: {
          memoryUsagePercent: readMemoryUsagePercent(),
          cpuUsagePercent: readCpuUsagePercent(),
          gpuUsagePercent: 0,
        },
        logs: [...runtimeLogs],
      };
    };

  const lazyPowerSuspensionBlocker: PowerSuspensionBlockerPort = {
    async startBlocker() {
      return { blockerId: "deferred-power-blocker", active: false };
    },
    async stopBlocker(blockerId: string) {
      return { blockerId, active: false };
    },
    async listBlockers() {
      return [];
    },
  };
  let internalAssetRegistry: InternalAssetRegistryComposition | undefined;
  const systemRuntimeDatabases =
    options.runtimeDatabases ??
    (options.runtimeDataRootDirectory
      ? createLocalSqliteSystemRuntimeDatabaseAdapter({
          dataRootDirectory: options.runtimeDataRootDirectory,
          now: options.now,
        })
      : undefined);
  recordHostMemorySnapshot("desktop.host.compose.return");

  return {
    loggingPort,
    loggingConfig,
    applicationSettings,
    applicationSecrets,
    systemRuntimeDatabases,
    modelDefaultResolver,
    powerSuspensionBlocker: lazyPowerSuspensionBlocker,
    getHuggingFaceTokenStatus: () => tokenConfigStore.getStatus(),
    setHuggingFaceToken: (token) => tokenConfigStore.setToken(token),
    clearHuggingFaceToken: () => tokenConfigStore.clearToken(),
    async startPythonRuntime() {
      recordRuntimeLog({ level: "info", message: "Starting Python runtime." });
      await (await getPythonRuntimeFoundation()).supervisor.start();
    },
    async stopPythonRuntime() {
      if (!pythonRuntimeFoundationPromise) return;
      recordRuntimeLog({ level: "info", message: "Stopping Python runtime." });
      await (await pythonRuntimeFoundationPromise).supervisor.stop();
    },
    async restartPythonRuntime() {
      recordRuntimeLog({
        level: "info",
        message: "Restarting Python runtime.",
      });
      await (await getPythonRuntimeFoundation()).supervisor.restart();
    },
    async unloadPythonRuntimeModel() {
      recordRuntimeLog({
        level: "info",
        message: "Unloading Python runtime generation model from memory.",
      });
      const result = await (
        await getPythonRuntimeFoundation()
      ).runtimePort.unloadModels();
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
    readPythonRuntimeStatus,
    async getPythonRuntimeDiagnostics() {
      const status = await readPythonRuntimeStatus();
      return {
        status: status.runtimeStatus,
        healthy: status.healthy,
        capabilities: status.capabilities,
      };
    },
    getInternalAssetRegistry() {
      return internalAssetRegistry;
    },
    getFeatureLifecycleState: featureLifecycle.getFeatureLifecycleState,
    disposeFeature: featureLifecycle.disposeFeature,
    markFeatureIdle: featureLifecycle.markFeatureIdle,
    disposeIdleFeatures: featureLifecycle.disposeIdleFeatures,
    registerDesktopIpc(registerOptions) {
      recordHostMemorySnapshot("desktop.host.ipc-registration.enter", {
        hasRuntimeRootDirectory: Boolean(registerOptions.runtimeRootDirectory),
        hasStorageRootDirectory: Boolean(registerOptions.storageRootDirectory),
      });
      const getStartupWorkspaceShell = memoizeSyncFeature(
        "desktop.host.startup-workspace-shell.compose",
        () => {
          const workspaceRepository = createLocalWorkspaceRepository({
            rootDirectory: registerOptions.storageRootDirectory,
            documents: organizationDocuments,
          });
          const workspaceSelectionRepository =
            createLocalWorkspaceSelectionRepository({
              rootDirectory: registerOptions.storageRootDirectory,
              documents: organizationDocuments,
            });
          const systemPackActivationRepository =
            createLocalWorkspaceSystemPackActivationRepository({
              rootDirectory: registerOptions.storageRootDirectory,
              documents: organizationDocuments,
            });
          const createWorkspaceUseCase = new CreateWorkspaceUseCase({
            workspaceRepository,
            workspaceSelectionRepository,
            systemPackActivationRepository,
            organizationId: organizationDocuments?.organizationId,
          });
          return {
            workspaceRepository,
            workspaceSelectionRepository,
            systemPackActivationRepository,
            createWorkspaceUseCase,
          };
        },
      );
      const startupWorkspaceShell = getStartupWorkspaceShell();
      const workspaceAuthorization =
        options.persistence?.documents && options.localIdentity
          ? composeDesktopWorkspaceAuthorization({
              documents: options.persistence.documents,
              localIdentity: options.localIdentity,
              audit: createJsonlSecurityAuditLogAdapter(
                path.join(
                  registerOptions.storageRootDirectory,
                  "security",
                  "authorization-audit.jsonl",
                ),
              ),
              now: options.now,
            })
          : undefined;
      const runtimeReadiness = createDesktopRuntimeReadinessService({
        readPythonSupervisorState: () => "stopped",
        readComfyUiLifecycleState: () => "uninitialized",
        async readComfyUiInstallStatus() {
          return "unknown";
        },
        now,
      });
      const getArtifactFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "artifact-local",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["artifact-local"],
        milestoneBase: "desktop.host.artifact-features",
        importFeature: async () => {
          const module = await import("./composeDesktopArtifactFeature");
          return () =>
            module.composeDesktopArtifactFeature({
              storageRootDirectory: registerOptions.storageRootDirectory,
              loggingPort,
              now: options.now,
              workspaceShell: startupWorkspaceShell,
              workspaceAuthorization,
              documents: organizationDocuments,
            });
        },
      });
      const getArtifactRemoteFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "artifact-remote",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["artifact-remote"],
        milestoneBase: "desktop.host.artifact-remote-features",
        importFeature: async () => {
          const module = await import("./composeDesktopArtifactRemoteFeature");
          return async () =>
            module.composeDesktopArtifactRemoteFeature({
              artifacts: await getArtifactFeatures(),
              workspaceShell: startupWorkspaceShell,
              workspaceAuthorization,
              loggingPort,
              now: options.now,
              tokenProvider: () => tokenConfigStore.getToken(),
              huggingFaceFetchImplementation:
                options.artifactRepo?.huggingFaceFetchImplementation,
            });
        },
      });
      const getAssetFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "asset-registry",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["asset-registry"],
        milestoneBase: "desktop.host.asset-features",
        importFeature: async () => {
          const module = await import("./composeDesktopAssetFeature");
          return async () =>
            module.composeDesktopAssetFeature({
              storageRootDirectory: registerOptions.storageRootDirectory,
              now,
              readSharedModelStorageDirectory,
              artifacts: await getArtifactFeatures(),
              documents: organizationDocuments,
              onInternalAssetRegistry: (registry) => {
                internalAssetRegistry = registry;
              },
            });
        },
      });
      const getComfyUiInstallFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "comfyui-install",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["comfyui-install"],
        milestoneBase: "desktop.host.comfyui-install-features",
        importFeature: async () => {
          const module = await import("./composeDesktopComfyUiInstallFeature");
          return () =>
            module.composeDesktopComfyUiInstallFeature({
              runtimeRootDirectory: registerOptions.runtimeRootDirectory,
              loggingPort,
            });
        },
      });
      const getComfyUiImageRuntimeFeatures =
        featureLifecycle.registerAsyncFeature({
          featureKey: "comfyui-image-runtime",
          policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["comfyui-image-runtime"],
          milestoneBase: "desktop.host.comfyui-image-runtime-features",
          importFeature: async () => {
            const module =
              await import("./composeDesktopComfyUiImageRuntimeFeature");
            return () =>
              module.composeDesktopComfyUiImageRuntimeFeature({
                runtimeRootDirectory: registerOptions.runtimeRootDirectory,
                loggingPort,
                applicationSettings,
                readRuntimeSettingString,
                getArtifacts: getArtifactFeatures,
              });
          },
        });
      const getRuntimeTaskFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "runtime-task-registry",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["runtime-task-registry"],
        milestoneBase: "desktop.host.runtime-task-features",
        importFeature: async () => {
          const module = await import("./composeDesktopRuntimeTaskFeature");
          return async () =>
            module.composeDesktopRuntimeTaskFeature({
              pythonRuntimeFoundation: await getPythonRuntimeFoundation(),
              imageRuntimeTaskRegistry: (await getComfyUiImageRuntimeFeatures())
                .imageRuntimeTaskRegistry,
              runtimeReadiness,
              recordMilestone: recordHostMemorySnapshot,
            });
        },
      });
      const getModelFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "model-registry",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["model-registry"],
        milestoneBase: "desktop.host.model-features",
        importFeature: async () => {
          const module = await import("./composeDesktopModelFeature");
          return () =>
            module.composeDesktopModelFeature({
              storageRootDirectory: registerOptions.storageRootDirectory,
              now,
              documents: organizationDocuments,
              tokenProvider: () => tokenConfigStore.getToken(),
              readSharedModelStorageDirectory,
              getArtifacts: getArtifactFeatures,
              getRuntimeTaskFeatures,
              getPythonRuntimeFoundation,
            });
        },
      });
      const getImageGenerationFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "image-generation",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["image-generation"],
        milestoneBase: "desktop.host.image-generation-features",
        importFeature: async () => {
          const module = await import("./composeDesktopImageGenerationFeature");
          return async () =>
            module.composeDesktopImageGenerationFeature({
              storageRootDirectory: registerOptions.storageRootDirectory,
              loggingPort,
              now,
              recordRuntimeLog,
              artifacts: await getArtifactFeatures(),
              assets: await getAssetFeatures(),
              runtime: await getRuntimeTaskFeatures(),
              comfyUi: await getComfyUiImageRuntimeFeatures(),
            });
        },
      });
      const getIngestionFeatures = featureLifecycle.registerAsyncFeature({
        featureKey: "website-ingestion",
        policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["website-ingestion"],
        milestoneBase: "desktop.host.ingestion-features",
        importFeature: async () => {
          const module = await import("./composeDesktopIngestionFeature");
          return async () =>
            module.composeDesktopIngestionFeature({
              artifacts: await getArtifactFeatures(),
              now: options.now,
            });
        },
      });
      const getDatasetPreparationFeatures =
        featureLifecycle.registerAsyncFeature({
          featureKey: "dataset-preparation",
          policy: DESKTOP_FEATURE_LIFECYCLE_POLICIES["dataset-preparation"],
          milestoneBase: "desktop.host.dataset-preparation-features",
          importFeature: async () => {
            const module =
              await import("./composeDesktopDatasetPreparationFeature");
            return async () =>
              module.composeDesktopDatasetPreparationFeature({
                artifacts: await getArtifactFeatures(),
                runtime: await getRuntimeTaskFeatures(),
                getArtifactRemoteFeatures,
                documents: organizationDocuments,
                workspaceRepository: startupWorkspaceShell.workspaceRepository,
                workspaceAuthorization,
                now: options.now,
              });
          },
        });
      const structuredRepositoryOptions = {
        rootDir: registerOptions.storageRootDirectory,
        now: options.now,
        documents: organizationDocuments,
      };
      const systemBuilder = organizationDocuments
        ? composeSystemBuilder({
            documents: organizationDocuments,
            definitions: {
              async readExactDefinition(reference) {
                await getAssetFeatures();
                return internalAssetRegistry?.assetKernel.repositories.definitionRepository.getDefinition(
                  reference,
                );
              },
            },
            assetRegistryRead: {
              listDefinitionCards: async (query) =>
                (
                  await getAssetFeatures()
                ).assetRegistryRead.listDefinitionCards(query),
              readDefinitionDetail: async (reference, readOptions) =>
                (
                  await getAssetFeatures()
                ).assetRegistryRead.readDefinitionDetail(
                  reference,
                  readOptions,
                ),
            },
            modelRegistry: {
              listModels: async (request) =>
                (await getModelFeatures()).modelRegistry.listModels(request),
              getModelRecord: async (workspaceId, modelRecordId) =>
                (await getModelFeatures()).modelRegistry.getModelRecord(
                  workspaceId,
                  modelRecordId,
                ),
            },
            generateSystemId: () => `system.${randomUUID()}`,
            now: options.now,
          })
        : undefined;
      const systemBuildArtifacts: SystemBuildArtifactPort = {
        async putImmutable(request) {
          return createSystemBuildArtifactAdapter(
            (await getArtifactFeatures()).storage,
          ).putImmutable(request);
        },
        async readVerified(workspaceId, descriptor) {
          return createSystemBuildArtifactAdapter(
            (await getArtifactFeatures()).storage,
          ).readVerified(workspaceId, descriptor);
        },
      };
      const systemBuild =
        organizationDocuments && systemBuilder
          ? composeSystemBuild({
              documents: organizationDocuments,
              systemBuilder,
              resolver: {
                async resolve(request) {
                  const implementation = (await getAssetFeatures())
                    .assetImplementation;
                  if (!implementation)
                    return {
                      status: "blocked",
                      definitionRef: request.definitionRef,
                      selectedFacets: [],
                      diagnostics: [
                        {
                          severity: "error",
                          code: "implementation.unavailable",
                          message:
                            "Asset implementation storage is unavailable.",
                        },
                      ],
                    };
                  return implementation.useCases.resolve.execute(request);
                },
              },
              artifacts: systemBuildArtifacts,
              hasher: createSha256SystemBuildHasher(),
              guidedProfile: {
                id: "local-desktop",
                label: "This computer",
                deploymentProfile: "local-desktop",
                availableCapabilities: [],
                permittedTrustLevels: [
                  "system-trusted",
                  "organization-approved",
                  "workspace-approved",
                ],
                hostApiVersion: "1.0.0",
                toolchainProfile: "ai-system-builder/1.0.0",
              },
              now: options.now,
            })
          : undefined;
      const systemData =
        organizationDocuments && systemBuild
          ? composeSystemData({
              documents: organizationDocuments,
              builds: systemBuild.repository,
              artifacts: systemBuildArtifacts,
              generateAuditId: () => `system-data-audit.${randomUUID()}`,
              now: options.now,
            })
          : undefined;
      const systemDeploymentReleaseBindings =
        systemBuild && systemBuilder
          ? new SystemDeploymentReleaseBindingService({
              builds: systemBuild.repository,
              modelAuthority: systemBuilder.modelAuthority,
              hasher: createSha256SystemBuildHasher(),
            })
          : undefined;
      const systemDeployment =
        organizationDocuments && systemBuild && systemRuntimeDatabases
          ? composeSystemDeployment({
              documents: organizationDocuments,
              builds: systemBuild.repository,
              artifacts: systemBuildArtifacts,
              runtime: createTrustedSystemDeploymentRuntimeAdapter({
                deploymentProfiles: ["local-desktop"],
                now: options.now,
                verifyReferenceRelease: async (deployment) => {
                  const release = await systemBuild.repository.readRelease(
                    deployment.workspaceId,
                    deployment.releaseId,
                  );
                  return (
                    !!release &&
                    release.releaseDigest === deployment.releaseDigest &&
                    release.systemId !== undefined
                  );
                },
                resolveReleaseBindings: (deployment) =>
                  systemDeploymentReleaseBindings!.resolve(deployment),
              }),
              runtimeDatabases: systemRuntimeDatabases,
              revocations: {
                async listRevokedImplementationReleaseIds(
                  _workspaceId,
                  releaseIds,
                ) {
                  const implementation = (await getAssetFeatures())
                    .assetImplementation;
                  if (!implementation)
                    throw new Error(
                      "Asset implementation revocation storage is unavailable.",
                    );
                  return (
                    await implementation.repository.listRevocations(releaseIds)
                  ).map((item) => item.releaseId);
                },
              },
              platformPolicy: createDefaultSystemDeploymentPolicy(),
              generateAuditId: () => `system-deployment-audit.${randomUUID()}`,
              generateRuntimeInstanceId: () =>
                normalizeSystemRuntimeInstanceId(
                  `system-runtime-instance.${randomUUID()}`,
                ),
              publishedLifecycle: {
                systems: systemBuilder!.repository,
                hostTargetId: "local-desktop",
                deploymentProfile: "local-desktop",
                hostApiVersion: "1.0.0",
                hostCapabilities: [],
                sandboxQualified: false,
                generateDeploymentId: () => `system-deployment.${randomUUID()}`,
                generateRunId: () => `system-deployment-run.${randomUUID()}`,
                resolveReleaseBindings: (deployment) =>
                  systemDeploymentReleaseBindings!.resolve(deployment),
              },
              now: options.now,
            })
          : undefined;
      let systemReviewPromise:
        Promise<ReturnType<typeof composeSystemReview>> | undefined;
      const getSystemReview =
        organizationDocuments && systemBuild
          ? () =>
              (systemReviewPromise ??= getArtifactFeatures().then((artifacts) =>
                composeSystemReview({
                  documents: organizationDocuments,
                  builds: systemBuild.repository,
                  buildArtifacts: systemBuildArtifacts,
                  artifacts: artifacts.artifactBrowserRead,
                  content: artifacts.artifactMediaViewRetrieval,
                  generateAuditId: () => `system-review-audit.${randomUUID()}`,
                  now: options.now,
                }),
              ))
          : undefined;
      const userLibraryAssetRepository =
        createLocalUserLibraryAssetRepositoryAdapter(
          structuredRepositoryOptions,
        );
      const authoredAssetRepository = createLocalAuthoredAssetRepositoryAdapter(
        structuredRepositoryOptions,
      );
      const assetDraftRepository = createLocalAssetDraftRepositoryAdapter(
        structuredRepositoryOptions,
      );
      const assetRevisionRepository = createLocalAssetRevisionRepositoryAdapter(
        structuredRepositoryOptions,
      );
      const assetOverrideRepository = createLocalAssetOverrideRepositoryAdapter(
        structuredRepositoryOptions,
      );
      const effectiveAssetProjectionRepository =
        createLocalEffectiveAssetProjectionRepositoryAdapter(
          structuredRepositoryOptions,
        );
      const assetCompositionPlanRepository =
        createLocalAssetCompositionPlanRepositoryAdapter(
          structuredRepositoryOptions,
        );
      const unavailableCustomizationTargetReader: AssetCustomizationTargetReaderPort =
        {
          async readCustomizationTargetByReference() {
            return undefined;
          },
        };

      const assetAuthoringUseCases = {
        createWorkspaceAuthoredAssetUseCase:
          new CreateWorkspaceAuthoredAssetUseCase({
            authoredAssetRepository,
            assetRevisionRepository,
            generateAuthoredAssetId: () => `authored.${randomUUID()}`,
            generateAssetRevisionId: () => `revision.${randomUUID()}`,
            now: options.now,
          }),
        createAssetDraftUseCase: new CreateAssetDraftUseCase({
          assetDraftRepository,
          generateAssetDraftId: () => `draft.${randomUUID()}`,
          now: options.now,
        }),
        updateAssetDraftUseCase: new UpdateAssetDraftUseCase({
          assetDraftRepository,
          now: options.now,
        }),
        publishAssetDraftUseCase: new PublishAssetDraftUseCase({
          assetDraftRepository,
          authoredAssetRepository,
          assetRevisionRepository,
          generateAuthoredAssetId: () => `authored.${randomUUID()}`,
          generateAssetRevisionId: () => `revision.${randomUUID()}`,
          now: options.now,
        }),
        createAssetOverrideUseCase: new CreateAssetOverrideUseCase({
          assetOverrideRepository,
          targetReader: {
            async readCustomizationTargetByReference() {
              return undefined;
            },
          },
          generateAssetOverrideId: () => `override.${randomUUID()}`,
          now: options.now,
        }),
        updateAssetOverrideUseCase: new UpdateAssetOverrideUseCase({
          assetOverrideRepository,
          now: options.now,
        }),
        disableAssetOverrideUseCase: new DisableAssetOverrideUseCase({
          assetOverrideRepository,
          now: options.now,
        }),
      };
      const effectiveAssetProjectionReadModel =
        new WorkspaceEffectiveAssetProjectionReadModelService({
          projectionRepository: effectiveAssetProjectionRepository,
        });
      const assetCompositionReadModel =
        new WorkspaceAssetCompositionReadModelService({
          compositionPlanRepository: assetCompositionPlanRepository,
        });
      const workspaceUserLibraryLinkRepository =
        createLocalWorkspaceUserLibraryLinkRepositoryAdapter(
          structuredRepositoryOptions,
        );

      const runtimeInventoryRepository =
        createLocalRuntimeInventoryRepositoryAdapter(
          structuredRepositoryOptions,
        );
      const runtimeReadinessBindingRepository =
        createLocalRuntimeReadinessBindingRepositoryAdapter(
          structuredRepositoryOptions,
        );
      const executionPlanRepository = createLocalExecutionPlanRepositoryAdapter(
        structuredRepositoryOptions,
      );
      const executionPlanServices = composeExecutionPlanServices({
        executionPlanRepository,
        runtimeReadinessBindingRepository,
        compositionPlanRepository: assetCompositionPlanRepository,
        now: options.now,
      });
      const conversationRepositories =
        createLocalConversationRepositoryAdapters(structuredRepositoryOptions);
      const executionRunRepositories =
        createLocalExecutionRunRepositoryAdapters(structuredRepositoryOptions);
      const conversationExecutionServices =
        composeConversationExecutionServices({
          ...conversationRepositories,
          ...executionRunRepositories,
          executionPlanRepository,
          runtimeReadinessBindingRepository,
          assetCompositionPlanRepository,
          adapterCatalog: createPythonConversationalRuntimeAdapterCatalog(),
          runtimeGuard: {
            async getRuntimeStatus(adapterId) {
              return createPythonConversationalRuntimeGuard(
                (await getPythonRuntimeFoundation()).runtimePort,
              ).getRuntimeStatus(adapterId);
            },
          },
          invocationPort: {
            async invokeConversationTurn(request) {
              return createPythonConversationalTextGenerationInvocationAdapter(
                (await getPythonRuntimeFoundation()).runtimePort,
                {
                  getModelRecord: (workspaceId, modelRecordId) =>
                    getModelFeatures().then((features) =>
                      features.modelRegistry.getModelRecord(
                        workspaceId,
                        modelRecordId,
                      ),
                    ),
                },
              ).invokeConversationTurn(request);
            },
          },
          hostCapabilities: {
            submitTurn: "supported",
            cancelTurn: "unsupported",
            retryTurn: "unsupported",
            streaming: false,
          },
          now: options.now,
        });
      const publishedConversationRuntime =
        systemDeployment?.publishedConversationAuthority
          ? composeSystemPublishedConversationRuntime({
              authority: systemDeployment.publishedConversationAuthority,
              runtimeRepositorySessions:
                systemDeployment.runtimeRepositorySessions,
              adapterCatalog: createPythonConversationalRuntimeAdapterCatalog(),
              runtimeGuard: {
                async getRuntimeStatus(adapterId) {
                  return createPythonConversationalRuntimeGuard(
                    (await getPythonRuntimeFoundation()).runtimePort,
                  ).getRuntimeStatus(adapterId);
                },
              },
              invocationPort: {
                async invokeConversationTurn(request) {
                  return createPythonConversationalTextGenerationInvocationAdapter(
                    (await getPythonRuntimeFoundation()).runtimePort,
                    {
                      getModelRecord: (workspaceId, modelRecordId) =>
                        getModelFeatures().then((features) =>
                          features.modelRegistry.getModelRecord(
                            workspaceId,
                            modelRecordId,
                          ),
                        ),
                    },
                  ).invokeConversationTurn(request);
                },
              },
              now: options.now,
            })
          : undefined;
      const loadSystemReview = getSystemReview;
      const systemRunWorkflow = composeSystemRunWorkflow({
        handlers: [
          createConversationWorkflowHandler({
            executionPlans: executionPlanRepository,
            conversations: conversationExecutionServices,
            now: options.now,
          }),
          ...(systemBuild && systemData
            ? [
                createSystemDataWorkflowHandler({
                  builds: systemBuild.repository,
                  definitions: systemData.definitions,
                  runtime: systemData.runtime,
                  now: options.now,
                }),
              ]
            : []),
          ...(systemBuild && loadSystemReview
            ? [
                createSystemReviewWorkflowHandler({
                  builds: systemBuild.repository,
                  definitions: {
                    resolve: async (workspaceId, releaseId) =>
                      (await loadSystemReview()).definitions.resolve(
                        workspaceId,
                        releaseId,
                      ),
                  },
                  runtime: {
                    describe: async (query) =>
                      (await loadSystemReview()).runtime.describe(query),
                    browse: async (query) =>
                      (await loadSystemReview()).runtime.browse(query),
                    detail: async (query) =>
                      (await loadSystemReview()).runtime.detail(query),
                    preview: async (query) =>
                      (await loadSystemReview()).runtime.preview(query),
                    listAudit: async (query) =>
                      (await loadSystemReview()).runtime.listAudit(query),
                  },
                  now: options.now,
                }),
              ]
            : []),
          ...(systemBuild && systemDeployment
            ? [
                createSystemDeploymentWorkflowHandler({
                  builds: systemBuild.repository,
                  useCases: systemDeployment.useCases,
                  deploymentProfiles: ["local-desktop"],
                  hostApiVersion: "1.0.0",
                  hostCapabilities: [],
                  sandboxQualified: false,
                  installationPolicy: createDefaultSystemDeploymentPolicy(),
                  generateDeploymentId: () =>
                    `system-deployment.${randomUUID()}`,
                  generateRunId: () => `system-deployment-run.${randomUUID()}`,
                  now: options.now,
                }),
              ]
            : []),
        ],
      });
      const runtimeReadinessV2 = {
        inventory: new RuntimeCapabilityInventoryService(
          runtimeInventoryRepository,
          [],
          now,
        ),
        inventorySummary: new RuntimeCapabilityInventorySummaryService(
          runtimeInventoryRepository,
        ),
        createBinding: new CreateRuntimeReadinessBindingUseCase({
          compositionRepository: assetCompositionPlanRepository,
          inventoryRepository: runtimeInventoryRepository,
          bindingRepository: runtimeReadinessBindingRepository,
          requirementExtractionService:
            new RuntimeRequirementExtractionService(),
          capabilityMatchingService: new RuntimeCapabilityMatchingService(),
          candidateSelectionService:
            new RuntimeBindingCandidateSelectionService(),
          nextReadinessBindingId: () => `rrb.${randomUUID()}`,
          nextRequirementId: () =>
            normalizeRuntimeRequirementId(`req.${randomUUID()}`),
          nextBindingCandidateId: () =>
            normalizeRuntimeBindingCandidateId(`rbc.${randomUUID()}`),
          nextBindingId: () => normalizeRuntimeBindingId(`rb.${randomUUID()}`),
          now: options.now,
        }),
        readModel: new WorkspaceRuntimeReadinessReadModelService({
          bindingRepository: runtimeReadinessBindingRepository,
          inventoryRepository: runtimeInventoryRepository,
        }),
        validateBinding: new ValidateRuntimeReadinessBindingUseCase({
          bindingRepository: runtimeReadinessBindingRepository,
          validationService: new RuntimeReadinessValidationService(),
          compositionRepository: assetCompositionPlanRepository,
          now: options.now,
        }),
      };

      const settingsUseCases = {
        listSettingsDefinitionsUseCase: new ListSettingsDefinitionsUseCase({
          settings: applicationSettings,
        }),
        readSettingsUseCase: new ReadSettingsUseCase({
          settings: applicationSettings,
          secrets: applicationSecrets,
        }),
        updateSettingUseCase: new UpdateSettingUseCase({
          settings: applicationSettings,
          secrets: applicationSecrets,
        }),
        clearSettingUseCase: new ClearSettingUseCase({
          settings: applicationSettings,
          secrets: applicationSecrets,
        }),
        resolveModelDefaultUseCase: new ResolveModelDefaultUseCase({
          modelDefaultResolver,
        }),
      };

      const markDisposableFeatureReleased = (featureKey: string) => ({
        afterCall: () => {
          featureLifecycle.markFeatureIdle(featureKey, "feature-release");
        },
      });
      recordHostMemorySnapshot(
        "desktop.host.ipc-registration.lazy-handlers.before",
      );
      registerElectronIpc({
        recordMilestone: recordHostMemorySnapshot,
        startup: {
          ipcMain: registerOptions.ipcMain,
          pythonRuntime: {
            startPythonRuntime: async () =>
              (await getPythonRuntimeFoundation()).supervisor.start(),
            stopPythonRuntime: async () => {
              if (pythonRuntimeFoundationPromise)
                await (await pythonRuntimeFoundationPromise).supervisor.stop();
            },
            restartPythonRuntime: async () =>
              (await getPythonRuntimeFoundation()).supervisor.restart(),
            unloadPythonRuntimeModel: async () => {
              const result = await (
                await getPythonRuntimeFoundation()
              ).runtimePort.unloadModels();
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
          runtimeReadiness,
          runtimeReadinessV2,
          executionPlans: {
            create: executionPlanServices.createPlan,
            validate: executionPlanServices.validatePlan,
            readModel: executionPlanServices.readModel,
          },
          workspaceServices: startupWorkspaceShell,
          settingsUseCases,
          selectFolder: options.folderPicker?.selectFolder,
          featureLifecycle: {
            getFeatureLifecycleState: featureLifecycle.getFeatureLifecycleState,
            disposeIdleFeatures: () =>
              featureLifecycle.disposeIdleFeatures("explicit-dev-action"),
          },
        },
        artifact: {
          ipcMain: registerOptions.ipcMain,
          senderTrust: registerOptions.senderTrust,
          tokens: {
            getHuggingFaceTokenStatus: () => tokenConfigStore.getStatus(),
            setHuggingFaceToken: (token) => tokenConfigStore.setToken(token),
            clearHuggingFaceToken: () => tokenConfigStore.clearToken(),
          },
          getArtifactFeature: getArtifactFeatures,
          getArtifactRemoteFeature: getArtifactRemoteFeatures,
          remoteLifecycle: markDisposableFeatureReleased("artifact-remote"),
        },
        asset: {
          ipcMain: registerOptions.ipcMain,
          getAssetFeature: getAssetFeatures,
        },
        model: {
          ipcMain: registerOptions.ipcMain,
          getModelFeature: getModelFeatures,
          reportOperationFailure: (operation, error) =>
            loggingPort.log({
              timestamp: new Date().toISOString(),
              level: "error",
              verbosity: "normal",
              event: "desktop.host.model.operation.failed",
              message:
                "A desktop model operation failed with bounded diagnostics.",
              component: "desktop-host-model-feature",
              data: {
                featureKey: "model-registry",
                stage: operation,
                ...createDesktopFeatureFailureDetail(error),
              },
            }),
        },
        imageGeneration: {
          ipcMain: registerOptions.ipcMain,
          getImageGenerationFeature: getImageGenerationFeatures,
          lifecycle: markDisposableFeatureReleased("image-generation"),
        },
        runtime: {
          ipcMain: registerOptions.ipcMain,
          getComfyUiFeature: getComfyUiInstallFeatures,
        },
        ingestion: {
          ipcMain: registerOptions.ipcMain,
          getIngestionFeature: getIngestionFeatures,
          lifecycle: markDisposableFeatureReleased("website-ingestion"),
        },
        datasetPreparation: {
          ipcMain: registerOptions.ipcMain,
          getDatasetPreparationFeature: getDatasetPreparationFeatures,
          lifecycle: markDisposableFeatureReleased("dataset-preparation"),
        },
        assetAuthoring: {
          ipcMain: registerOptions.ipcMain,
          ...assetAuthoringUseCases,
          authoredAssetRepository,
          assetDraftRepository,
          assetRevisionRepository,
          assetOverrideRepository,
          getDerivedCustomizations: async () =>
            (await getAssetFeatures()).derivedCustomizations?.service,
        },
        userLibrary: {
          ipcMain: registerOptions.ipcMain,
          userLibraryAssetRepository,
          workspaceUserLibraryLinkRepository,
          promoteUseCase: undefined,
          linkUseCase: new LinkUserLibraryAssetToWorkspaceUseCase({
            userLibraryAssetRepository,
            workspaceLinkRepository: workspaceUserLibraryLinkRepository,
            now: options.now,
            generateUserLibraryLinkId: () => `link.${randomUUID()}`,
          }),
          copyUseCase: undefined,
          importUseCase: undefined,
          assetRegistryRead: {
            listDefinitionCards: async (query) =>
              (await getAssetFeatures()).assetRegistryRead.listDefinitionCards(
                query,
              ),
            readDefinitionDetail: async (reference, options) =>
              (await getAssetFeatures()).assetRegistryRead.readDefinitionDetail(
                reference,
                options,
              ),
          },
        },
        effectiveAssetProjections: {
          ipcMain: registerOptions.ipcMain,
          projectionRepository: effectiveAssetProjectionRepository,
          readModel: effectiveAssetProjectionReadModel,
          createAuthored: new CreateAuthoredAssetEffectiveProjectionUseCase({
            projectionRepository: effectiveAssetProjectionRepository,
            authoredAssetRepository,
            assetRevisionRepository,
            generateEffectiveAssetProjectionId: () =>
              `projection.${randomUUID()}`,
            now: options.now,
          }),
          refreshAuthored: new RefreshAuthoredAssetEffectiveProjectionUseCase({
            projectionRepository: effectiveAssetProjectionRepository,
            authoredAssetRepository,
            assetRevisionRepository,
            now: options.now,
          }),
          previewDraft: new PreviewDraftEffectiveAssetProjectionUseCase({
            assetDraftRepository,
            generateEffectiveAssetProjectionId: () =>
              `projection.${randomUUID()}`,
            now: options.now,
          }),
          createOverride: new CreateOverrideEffectiveProjectionUseCase({
            projectionRepository: effectiveAssetProjectionRepository,
            assetOverrideRepository,
            targetReader: unavailableCustomizationTargetReader,
            generateEffectiveAssetProjectionId: () =>
              `projection.${randomUUID()}`,
            now: options.now,
          }),
          refreshOverride: new RefreshOverrideEffectiveProjectionUseCase({
            projectionRepository: effectiveAssetProjectionRepository,
            assetOverrideRepository,
            targetReader: unavailableCustomizationTargetReader,
            now: options.now,
          }),
        },
        assetComposition: {
          ipcMain: registerOptions.ipcMain,
          createPlan: new CreateAssetCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            generatePlanId: () => `plan.${randomUUID()}`,
            now: options.now,
          }),
          updatePlan: new UpdateAssetCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            now: options.now,
          }),
          readPlan: new ReadAssetCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
          }),
          listPlans: new ListAssetCompositionPlansUseCase({
            repository: assetCompositionPlanRepository,
          }),
          archivePlan: new ArchiveAssetCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            now: options.now,
          }),
          addProjection: new AddProjectionToCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            projectionRepository: effectiveAssetProjectionRepository,
            generateNodeId: () => `node.${randomUUID()}`,
            now: options.now,
          }),
          removeProjection: new RemoveProjectionFromCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            now: options.now,
          }),
          connectNodes: new ConnectCompositionNodesUseCase({
            repository: assetCompositionPlanRepository,
            generateRelationshipId: () => `rel.${randomUUID()}`,
            now: options.now,
          }),
          disconnectNodes: new DisconnectCompositionNodesUseCase({
            repository: assetCompositionPlanRepository,
            now: options.now,
          }),
          validatePlan: new ValidateAssetCompositionPlanUseCase({
            repository: assetCompositionPlanRepository,
            projectionRepository: effectiveAssetProjectionRepository,
            now: options.now,
          }),
          readModel: assetCompositionReadModel,
        },
        conversations: {
          ipcMain: registerOptions.ipcMain,
          conversations: conversationExecutionServices,
        },
        assetImplementations: {
          ipcMain: registerOptions.ipcMain,
          listReleases: {
            async execute(workspaceId) {
              const implementation = (await getAssetFeatures())
                .assetImplementation;
              if (!implementation)
                throw new Error("Asset implementation storage is unavailable.");
              return implementation.useCases.listReleases.execute(workspaceId);
            },
          },
          resolve: {
            async execute(request) {
              const implementation = (await getAssetFeatures())
                .assetImplementation;
              if (!implementation)
                throw new Error("Asset implementation storage is unavailable.");
              return implementation.useCases.resolve.execute(request);
            },
          },
        },
        assetPackages: {
          ipcMain: registerOptions.ipcMain,
          inspect: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.inspect.execute(command);
            },
          },
          admit: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.admit.execute(command);
            },
          },
          list: {
            async execute(workspaceId) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.list.execute(workspaceId);
            },
          },
          activate: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.activate.execute(command);
            },
          },
          disable: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.disable.execute(command);
            },
          },
          rollback: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetPackages;
              if (!feature)
                throw new Error("Asset package storage is unavailable.");
              return feature.useCases.rollback.execute(command);
            },
          },
        },
        assetStudio: {
          ipcMain: registerOptions.ipcMain,
          start: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.start.execute(command);
            },
          },
          propose: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.propose.execute(command);
            },
          },
          review: {
            async execute(command) {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.review.execute(command);
            },
          },
          read: {
            async execute(workspaceId, workflowId) {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.read.execute(workspaceId, workflowId);
            },
          },
          list: {
            async execute(workspaceId) {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.list.execute(workspaceId);
            },
          },
          assetDrafts: {
            create: async (command) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.create(command);
            },
            update: async (command) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.update(command);
            },
            read: async (query) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.read(query);
            },
            list: async (query) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.list(query);
            },
            review: async (command) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.review(command);
            },
            publish: async (command) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.publish(command);
            },
            abandon: async (command) => {
              const feature = (await getAssetFeatures()).assetStudio;
              if (!feature)
                throw new Error("Asset Studio storage is unavailable.");
              return feature.useCases.assetDrafts.abandon(command);
            },
          },
        },
        ...(systemBuilder
          ? {
              systemBuilder: {
                ipcMain: registerOptions.ipcMain,
                ...systemBuilder.useCases,
              },
            }
          : {}),
        ...(systemBuild
          ? {
              systemBuild: {
                ipcMain: registerOptions.ipcMain,
                ...systemBuild.useCases,
              },
            }
          : {}),
        ...(systemData
          ? {
              systemData: {
                ipcMain: registerOptions.ipcMain,
                runtime: systemData.runtime,
              },
            }
          : {}),
        ...(getSystemReview
          ? {
              systemReview: {
                ipcMain: registerOptions.ipcMain,
                runtime: {
                  describe: async (query) =>
                    (await getSystemReview()).runtime.describe(query),
                  browse: async (query) =>
                    (await getSystemReview()).runtime.browse(query),
                  detail: async (query) =>
                    (await getSystemReview()).runtime.detail(query),
                  preview: async (query) =>
                    (await getSystemReview()).runtime.preview(query),
                  listAudit: async (query) =>
                    (await getSystemReview()).runtime.listAudit(query),
                },
              },
            }
          : {}),
        ...(systemDeployment
          ? {
              systemDeployment: {
                ipcMain: registerOptions.ipcMain,
                authority: {
                  organizationId:
                    options.localIdentity?.organizationId ??
                    organizationDocuments?.organizationId ??
                    createOrganizationId("local"),
                  actorId: options.localIdentity?.principalId ?? "local-user",
                },
                host: {
                  deploymentProfiles: ["local-desktop"],
                  hostApiVersion: "1.0.0",
                  capabilities: [],
                  sandboxQualified: false,
                },
                ...systemDeployment.useCases,
                ...(systemDeployment.publishedLifecycle
                  ? {
                      lifecycleRead: systemDeployment.publishedLifecycle.read,
                      lifecycleInvoke:
                        registerOptions.systemRuntimeWindows &&
                        publishedConversationRuntime
                          ? createDesktopPublishedSystemRuntimeLifecycle({
                              lifecycle:
                                systemDeployment.publishedLifecycle.invoke,
                              windows: registerOptions.systemRuntimeWindows,
                              controller: publishedConversationRuntime,
                              prepareRuntime: async () =>
                                (
                                  await getPythonRuntimeFoundation()
                                ).supervisor.start(),
                            })
                          : systemDeployment.publishedLifecycle.invoke,
                    }
                  : {}),
              },
            }
          : {}),
        systemRunWorkflow: {
          ipcMain: registerOptions.ipcMain,
          workflows: systemRunWorkflow.useCases,
        },
      });
      recordHostMemorySnapshot(
        "desktop.host.ipc-registration.lazy-handlers.after",
      );
      recordHostMemorySnapshot("desktop.host.ipc-registration.return");
    },
    registerArtifactUploadIpc(registerOptions) {
      this.registerDesktopIpc(registerOptions);
    },
  };
}

import type { ArtifactRepoStoragePort } from "../../../application/ports/storage";
import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { cpus, freemem, totalmem } from "node:os";
import { spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { GenerateImageUseCase } from "../../../application/use-cases/image-generation/generate-image.use-case";
import { FinalizeImageGenerationService } from "../../../application/services/image/finalize-image-generation.service";
import { ImageGenerationFinalizationOrchestratorService } from "../../../application/services/image/image-generation-finalization-orchestrator.service";
import {
  createComfyUiHttpClient,
  createComfyUiRuntimeSupervisor,
} from "../../../adapters/runtime/comfyui";
import { createComfyUiRuntimeInstaller } from "../../../adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";
import {
  createPythonRuntimeAdapterFoundation,
  ensurePythonRuntimeWorkerDependencies,
} from "../../../adapters/runtime/python";
import { createGitRuntimeInstallerAdapter } from "../../../adapters/runtime/installer/git/createGitRuntimeInstallerAdapter";
import {
  createInMemorySecretsAdapter,
  createLocalApplicationSettingsAdapter,
} from "../../../adapters/persistence/settings";
import { createLocalModelRegistryAdapter } from "../../../adapters/persistence/model";
import { createHuggingFaceModelBrowseDetailsAdapter } from "../../../adapters/model/huggingface";
import { createLocalImageAssetRegistryAdapter } from "../../../adapters/persistence/image";
import { createLocalModelCheckpointResolverAdapter } from "../../../adapters/model/local";
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
import { createLocalRuntimeReadinessBindingRepositoryAdapter } from "../../../adapters/persistence/runtime-readiness";
import { createLocalExecutionPlanRepositoryAdapter } from "../../../adapters/persistence/execution-plans";
import { createLocalConversationRepositoryAdapters } from "../../../adapters/persistence/conversations";
import { createLocalExecutionRunRepositoryAdapters } from "../../../adapters/persistence/execution-runs";
import { LinkUserLibraryAssetToWorkspaceUseCase } from "../../../application/use-cases/user-library";
import type { LoggingPort } from "../../../application/ports/logging";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import { SystemArtifactIdFactory } from "../../../domain/artifact";
import {
  BrowseArtifactsUseCase,
  BrowseHuggingFaceDatasetParquetFilesUseCase,
  BrowseHuggingFaceNamespaceDatasetsUseCase,
  HasArtifactInRepoUseCase,
  ImportHuggingFaceFilesUseCase,
  LocalizeArtifactFromRepoUseCase,
  PublishArtifactToRepoUseCase,
  ReadArtifactContentUseCase,
  ReadArtifactDetailUseCase,
  RegisterArtifactFromRepoUseCase,
  StoreArtifactInRepoUseCase,
  StoreArtifactUploadUseCase,
  VerifyImportedArtifactSourceBackingUseCase,
  VerifyPublishedArtifactBackingUseCase,
  DeleteRegisteredArtifactUseCase,
  IngestWebsitePageUseCase,
  IngestWebsitePagesBatchUseCase,
  FinalizeGeneratedOutputAsAssetUseCase,
  ImportExternalRepositoryObjectAsAssetUseCase,
  BrowseModelsUseCase,
  GetModelDetailsUseCase,
  LocalizeExternalRepositoryObjectAsAssetUseCase,
  ListModelsUseCase,
  SaveModelReferenceUseCase,
  DownloadModelUseCase,
  UpdateModelRecordUseCase,
  DeleteModelRecordUseCase,
  ListSettingsDefinitionsUseCase,
  ReadSettingsUseCase,
  UpdateSettingUseCase,
  ClearSettingUseCase,
  RegisterResourceBackedViewAsAssetInstanceUseCase,
  CreateAssetDraftUseCase,
  CreateAssetOverrideUseCase,
  CreateWorkspaceAuthoredAssetUseCase,
  DisableAssetOverrideUseCase,
  PublishAssetDraftUseCase,
  UpdateAssetDraftUseCase,
  UpdateAssetOverrideUseCase,
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
} from "../../../application/use-cases";
import {
  createLogger,
  type StructuredLogSink,
} from "../../../adapters/observability/logging";
import { createArtifactRepoStorageAdapter } from "../../../adapters/storage/artifact-repo";
import {
  createFilesystemArtifactBrowserReadAdapter,
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
  createFilesystemGeneratedImagePersistenceAdapter,
  createLocalArtifactCatalogPersistenceAdapter,
  createLocalArtifactStorageBindingAdapter,
} from "../../../adapters/storage/filesystem";
import {
  createHuggingFaceArtifactRepoStorageAdapter,
  type CreateHuggingFaceArtifactRepoStorageAdapterOptions,
  type HuggingFaceFetchImplementation,
} from "../../../adapters/storage/huggingface";
import {
  createHuggingFaceTokenConfigStore,
  type HuggingFaceTokenStatus,
} from "../../shared/huggingFaceTokenConfigStore";
import { createRuntimePreparedModelCheckpointResolver } from "../../shared/createRuntimePreparedModelCheckpointResolver";
import { createWebsiteHtmlAcquisitionPort } from "../../../adapters/ingestion";
import {
  registerExpressApi,
  type RegisterExpressApiDependencies,
} from "../../../adapters/transport/api-express/registerExpressApi";
import {
  createLoggingConfig,
  type LoggingConfig,
} from "../../../contracts/config";
import type { LogLevel, LogVerbosity } from "../../../contracts/logging";
import {
  buildComfyUiManagedPythonExecutablePath,
  type ComfyUiPythonEnvironmentMode,
} from "../../../adapters/runtime/comfyui/comfyUiPythonEnvironment";
import type { ComfyUiRuntimeDeviceMode } from "../../../adapters/runtime/comfyui/createComfyUiRuntimeSupervisor";
import {
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
  SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY,
} from "../../../contracts/settings";
import { RuntimeCapabilityGuardService } from "../../../application/services/runtime/runtime-capability-guard.service";
import { createServerRuntimeReadinessService } from "./composeServerRuntimeReadiness";
import { createServerImageGenerationRuntimeTaskRegistry } from "./composeServerImageGenerationRuntimeTaskRegistry";
import {
  composeInternalAssetRegistry,
  type InternalAssetRegistryComposition,
} from "../../shared/composition/composeInternalAssetRegistry";
import { composeResourceBackedViewProviders } from "../../shared/composition/composeResourceBackedViewProviders";
import type { AssetCustomizationTargetReaderPort } from "../../../application/ports/asset-authoring";
import { WorkspaceAssetAuthoringReadModelService } from "../../../application/services/asset/workspace-asset-authoring-read-model.service";
import { WorkspaceAssetCompositionReadModelService } from "../../../application/services/asset/workspace-asset-composition-read-model.service";
import { composeExecutionPlanServices } from "../../shared/composition/composeExecutionPlanServices";
import { composeConversationExecutionServices } from "../../shared/composition/composeConversationExecutionServices";
import {
  createPythonConversationalRuntimeAdapterCatalog,
  createPythonConversationalRuntimeGuard,
  createPythonConversationalTextGenerationInvocationAdapter,
} from "../../../adapters/runtime/conversational-text-generation";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createAssetImplementationArtifactAdapter } from "../../../adapters/storage/asset-implementation";
import {
  createSha256SystemBuildHasher,
  createSystemBuildArtifactAdapter,
} from "../../../adapters/storage/system-build";
import { composeAssetImplementationKernel } from "../../shared/composition/composeAssetImplementationKernel";
import { composeAssetPackageLifecycle } from "../../shared/composition/composeAssetPackageLifecycle";
import { composeAssetStudioWorkflow } from "../../shared/composition/composeAssetStudioWorkflow";
import { composeAssetDerivedCustomization } from "../../shared/composition/composeAssetDerivedCustomization";
import { composeSystemBuilder } from "../../shared/composition/composeSystemBuilder";
import { composeSystemBuild } from "../../shared/composition/composeSystemBuild";
import { composeSystemData } from "../../shared/composition/composeSystemData";
import { composeSystemReview } from "../../shared/composition/composeSystemReview";
import {
  composeSystemDeployment,
  createDefaultSystemDeploymentPolicy,
} from "../../shared/composition/composeSystemDeployment";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../../../adapters/runtime/system-deployment";
import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";

const PYTHON_RUNTIME_WORKER_RELATIVE_PATH = join(
  "modules",
  "adapters",
  "runtime",
  "python",
  "worker",
);
const execFile = promisify(nodeExecFile);

function parseNumberEnv(
  value: string | undefined,
  name: string,
): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive number.`);
  return parsed;
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function resolveHostPath(value: string): string {
  return isPosixAbsolutePath(value)
    ? value.replace(/\/+$/, "") || "/"
    : resolve(value);
}

function joinHostPath(root: string, ...segments: string[]): string {
  return isPosixAbsolutePath(root)
    ? [root.replace(/\/+$/, ""), ...segments].filter(Boolean).join("/")
    : join(root, ...segments);
}

export function resolveServerPythonRuntimeWorkerDirectory(
  input: {
    configuredWorkerDirectory?: string;
    cwd?: string;
    initCwd?: string;
    startDirectory?: string;
    exists?: (path: string) => boolean;
  } = {},
): string {
  const exists = input.exists ?? existsSync;
  const configured = input.configuredWorkerDirectory?.trim();
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(input.cwd ?? process.cwd(), configured);
  }

  const candidates: string[] = [];
  const seedDirectories = [
    input.cwd ?? process.cwd(),
    input.initCwd ?? process.env.INIT_CWD,
    input.startDirectory,
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  for (const seedDirectory of seedDirectories) {
    let cursor = resolve(seedDirectory);
    while (true) {
      candidates.push(resolve(cursor, PYTHON_RUNTIME_WORKER_RELATIVE_PATH));
      const parent = dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }

  if (candidates.length === 0) {
    candidates.push(resolve(PYTHON_RUNTIME_WORKER_RELATIVE_PATH));
  }

  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}
export interface ComposeServerHostLoggingOptions {
  verbosity?: string;
  fallbackVerbosity?: LogVerbosity;
  level?: LogLevel;
  includeDiagnostics?: boolean;
}

export interface ComposeServerHostArtifactRepoOptions {
  huggingFaceAccessToken?: string;
  huggingFaceTokenConfigFilePath?: string;
  huggingFaceFetchImplementation?: HuggingFaceFetchImplementation;
  huggingFaceHubClient?: CreateHuggingFaceArtifactRepoStorageAdapterOptions["hubClient"];
}

export interface ComposeServerHostOptions {
  persistence?: {
    /** Deployment-local configuration and explicit legacy/unassigned records. */
    documents: StructuredDocumentStore;
    /** Organization-owned feature data; managed hosts must provide a context-required adapter. */
    organizationDocuments?: StructuredDocumentStore;
  };
  organizationContextProvider?: OrganizationRequestContextProviderPort;
  env?: NodeJS.ProcessEnv;
  logging?: ComposeServerHostLoggingOptions;
  logSink?: StructuredLogSink;
  now?: () => string;
  artifactRepo?: ComposeServerHostArtifactRepoOptions;
  restartServer?: () => void | Promise<void>;
  settings?: {
    localSettingsFilePath?: string;
  };
}

export function resolveServerSystemDeploymentProfile(
  env: NodeJS.ProcessEnv = process.env,
): AssetImplementationDeploymentProfile {
  return env.DEPLOYMENT_SHAPE?.trim().toLowerCase() === "cloud"
    ? "cloud-server"
    : "campus-server";
}

export interface RegisterServerApiOptions {
  app: RegisterExpressApiDependencies["app"];
  storageRootDirectory: string;
  runtimeRootDirectory?: string;
}

export type ServerComfyUiInstallRootSource =
  "SERVER_RUNTIME_ROOT" | "default-server-runtime-root";
export type ServerComfyUiLaunchPythonExecutableSource =
  "ambient" | "managed-venv" | "skip-python-setup";
export type ServerPythonRuntimeMode = "worker-sidecar";
export type ServerPythonRuntimeRootSource =
  "SERVER_RUNTIME_ROOT" | "default-server-runtime-root";

function normalizeComfyUiRuntimeDeviceMode(
  value: string | undefined,
): ComfyUiRuntimeDeviceMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "undefined") return undefined;
  if (
    normalized === "auto" ||
    normalized === "cpu" ||
    normalized === "directml" ||
    normalized === "cuda"
  )
    return normalized;
  return undefined;
}

function normalizeServerImageGenerationRuntimeMode(
  value: string | undefined,
): ComfyUiRuntimeDeviceMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "nvidia") return "cuda";
  if (normalized === "amd" || normalized === "intel") return "directml";
  return normalizeComfyUiRuntimeDeviceMode(normalized);
}

function isRecoverableCudaTorchInstallFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cuda torch|cuda-torch|no space left on device|errno 28/i.test(
    message,
  );
}

function parseBooleanEnvFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function extensionForImageReference(
  mediaType: string | undefined,
  artifactId: string,
): string {
  const media = mediaType?.trim().toLowerCase();
  if (media === "image/jpeg" || media === "image/jpg") return ".jpg";
  if (media === "image/webp") return ".webp";
  if (media === "image/png") return ".png";
  const match = artifactId.match(/\.(png|jpe?g|webp)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".png";
}

function parseServerComfyUiPort(env: NodeJS.ProcessEnv): number {
  const raw = env.SERVER_COMFYUI_PORT?.trim();
  if (!raw) return 8189;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "SERVER_COMFYUI_PORT must be an integer between 1 and 65535.",
    );
  }
  return port;
}

function classifyPythonRuntimeSupervisorLogLevel(
  eventType: string,
  source?: unknown,
): "info" | "warn" | "error" {
  if (eventType === "process-error" || eventType === "startup-timeout") {
    return "error";
  }
  if (eventType === "process-exit" || source === "stderr") {
    return "warn";
  }
  return "info";
}

export function resolveServerComfyUiPythonEnvironmentMode(
  env: NodeJS.ProcessEnv = process.env,
): {
  pythonEnvironmentMode: ComfyUiPythonEnvironmentMode;
  invalidValue?: string;
} {
  const raw = env.COMFYUI_PYTHON_ENVIRONMENT_MODE?.trim();
  const normalized = raw?.toLowerCase();
  if (!normalized) return { pythonEnvironmentMode: "managed-venv" };
  if (normalized === "managed-venv" || normalized === "ambient")
    return { pythonEnvironmentMode: normalized };
  return { pythonEnvironmentMode: "managed-venv", invalidValue: raw };
}

export function resolveServerComfyUiLaunchPythonExecutable(input: {
  installRoot: string;
  basePythonCommand: string;
  pythonEnvironmentMode: ComfyUiPythonEnvironmentMode;
  skipPythonSetup: boolean;
  platform?: NodeJS.Platform;
}): {
  launchPythonExecutable: string;
  source: ServerComfyUiLaunchPythonExecutableSource;
} {
  if (input.pythonEnvironmentMode === "ambient") {
    return {
      launchPythonExecutable: input.basePythonCommand,
      source: "ambient",
    };
  }
  if (input.skipPythonSetup) {
    return {
      launchPythonExecutable: input.basePythonCommand,
      source: "skip-python-setup",
    };
  }
  return {
    launchPythonExecutable: isPosixAbsolutePath(input.installRoot)
      ? joinHostPath(
          input.installRoot,
          ".venv",
          (input.platform ?? process.platform) === "win32" ? "Scripts" : "bin",
          (input.platform ?? process.platform) === "win32"
            ? "python.exe"
            : "python",
        )
      : buildComfyUiManagedPythonExecutablePath({
          installRoot: input.installRoot,
          platform: input.platform,
        }),
    source: "managed-venv",
  };
}

export function resolveServerComfyUiRuntimeDeviceMode(
  env: NodeJS.ProcessEnv = process.env,
  requestedRuntimeMode?: string,
): ComfyUiRuntimeDeviceMode {
  return (
    normalizeComfyUiRuntimeDeviceMode(
      env.COMFYUI_RUNTIME_DEVICE_MODE ?? env.COMFYUI_ACCELERATOR,
    ) ??
    normalizeServerImageGenerationRuntimeMode(requestedRuntimeMode) ??
    "cpu"
  );
}

export function resolveServerRuntimeRootDirectory(input: {
  env?: NodeJS.ProcessEnv;
  runtimeRootDirectory: string;
}): {
  runtimeRootDirectory: string;
  source: "SERVER_RUNTIME_ROOT" | "default-server-runtime-root";
} {
  const env = input.env ?? process.env;
  const configured = env.SERVER_RUNTIME_ROOT?.trim();
  if (configured) {
    return {
      runtimeRootDirectory: resolve(configured),
      source: "SERVER_RUNTIME_ROOT",
    };
  }
  return {
    runtimeRootDirectory: resolveHostPath(input.runtimeRootDirectory),
    source: "default-server-runtime-root",
  };
}

export function resolveServerComfyUiInstallRoot(input: {
  env?: NodeJS.ProcessEnv;
  runtimeRootDirectory: string;
}): { installRoot: string; source: ServerComfyUiInstallRootSource } {
  const env = input.env ?? process.env;
  const runtime = resolveServerRuntimeRootDirectory({
    env,
    runtimeRootDirectory: input.runtimeRootDirectory,
  });
  return {
    installRoot: joinHostPath(
      runtime.runtimeRootDirectory,
      "runtime-installs",
      "comfyui",
    ),
    source: runtime.source,
  };
}

export interface ServerHostComposition {
  loggingPort: LoggingPort;
  loggingConfig: LoggingConfig;
  artifactRepoStorage: ArtifactRepoStoragePort;
  getHuggingFaceTokenStatus: () => HuggingFaceTokenStatus;
  setHuggingFaceToken: (token: string) => HuggingFaceTokenStatus;
  clearHuggingFaceToken: () => HuggingFaceTokenStatus;
  registerApi: (options: RegisterServerApiOptions) => void;
  waitForAssetFoundation: () => Promise<void>;
  getInternalAssetRegistry: () => InternalAssetRegistryComposition | undefined;
}

export {
  createServerRuntimeReadinessService,
  type CreateServerRuntimeReadinessServiceOptions,
} from "./composeServerRuntimeReadiness";

export function composeServerHost(
  options: ComposeServerHostOptions = {},
): ServerHostComposition {
  const loggingConfig = createLoggingConfig({
    verbosity: options.logging?.verbosity,
    fallbackVerbosity: options.logging?.fallbackVerbosity,
    level: options.logging?.level,
    includeDiagnostics: options.logging?.includeDiagnostics,
  });

  const loggingPort = createLogger({
    config: loggingConfig,
    host: "server",
    component: "server-host",
    sink: options.logSink,
    now: options.now,
  });
  const tokenConfigStore = createHuggingFaceTokenConfigStore({
    filePath:
      options.artifactRepo?.huggingFaceTokenConfigFilePath ??
      "/tmp/ai-system-builder/server/hugging-face-token.json",
    fallbackToken: options.artifactRepo?.huggingFaceAccessToken,
  });

  const huggingFaceArtifactRepoStorage =
    createHuggingFaceArtifactRepoStorageAdapter({
      accessTokenProvider: () => tokenConfigStore.getToken(),
      fetchImplementation: options.artifactRepo?.huggingFaceFetchImplementation,
      hubClient: options.artifactRepo?.huggingFaceHubClient,
    });

  const artifactRepoStorage = createArtifactRepoStorageAdapter({
    providers: [
      {
        provider: "huggingface",
        adapter: huggingFaceArtifactRepoStorage,
      },
    ],
  });

  let internalAssetRegistry: InternalAssetRegistryComposition | undefined;
  let assetFoundationReady: Promise<void> = Promise.resolve();

  return {
    loggingPort,
    loggingConfig,
    artifactRepoStorage,
    getHuggingFaceTokenStatus() {
      return tokenConfigStore.getStatus();
    },
    setHuggingFaceToken(token: string) {
      return tokenConfigStore.setToken(token);
    },
    clearHuggingFaceToken() {
      return tokenConfigStore.clearToken();
    },
    getInternalAssetRegistry() {
      return internalAssetRegistry;
    },
    waitForAssetFoundation() {
      return assetFoundationReady;
    },
    registerApi(registerOptions) {
      const env = options.env ?? process.env;
      const organizationDocuments =
        options.persistence?.organizationDocuments ??
        options.persistence?.documents;
      const defaultRuntimeRootDirectory = joinHostPath(
        dirname(registerOptions.storageRootDirectory),
        "server-runtime",
      );
      const applicationSettings = createLocalApplicationSettingsAdapter({
        filePath:
          options.settings?.localSettingsFilePath ??
          joinHostPath(
            registerOptions.storageRootDirectory,
            "config",
            "application-settings.json",
          ),
        rootDirectory: registerOptions.storageRootDirectory,
        documents: options.persistence?.documents,
        now: options.now,
      });
      const applicationSecrets = createInMemorySecretsAdapter();
      const readRuntimeSettingString = async (
        key: string,
      ): Promise<string | undefined> => {
        const value = (await applicationSettings.readValues({ keys: [key] }))[0]
          ?.value;
        return typeof value === "string" && value.trim().length > 0
          ? value.trim()
          : undefined;
      };
      const serverRuntimeResolution = resolveServerRuntimeRootDirectory({
        env,
        runtimeRootDirectory:
          registerOptions.runtimeRootDirectory ?? defaultRuntimeRootDirectory,
      });
      const runtimeResolution = resolveServerComfyUiInstallRoot({
        env,
        runtimeRootDirectory: serverRuntimeResolution.runtimeRootDirectory,
      });
      const basePythonCommand =
        env.COMFYUI_PYTHON_COMMAND?.trim() ||
        (isPosixAbsolutePath(serverRuntimeResolution.runtimeRootDirectory)
          ? "python3"
          : process.platform === "win32"
            ? "python"
            : "python3");
      const {
        pythonEnvironmentMode,
        invalidValue: invalidPythonEnvironmentMode,
      } = resolveServerComfyUiPythonEnvironmentMode(env);
      const skipPythonSetup = parseBooleanEnvFlag(
        env.COMFYUI_SKIP_PYTHON_SETUP,
      );
      const skipPythonValidation = parseBooleanEnvFlag(
        env.COMFYUI_SKIP_PYTHON_VALIDATION,
      );
      const rawRuntimeDeviceMode =
        env.COMFYUI_RUNTIME_DEVICE_MODE ?? env.COMFYUI_ACCELERATOR;
      const normalizedRawRuntimeDeviceMode = rawRuntimeDeviceMode
        ?.trim()
        .toLowerCase();
      if (
        normalizedRawRuntimeDeviceMode &&
        normalizedRawRuntimeDeviceMode !== "undefined" &&
        !normalizeComfyUiRuntimeDeviceMode(rawRuntimeDeviceMode)
      ) {
        throw new Error(
          `Unsupported COMFYUI runtime mode "${rawRuntimeDeviceMode}". Use auto, cpu, directml, or cuda via COMFYUI_RUNTIME_DEVICE_MODE/COMFYUI_ACCELERATOR.`,
        );
      }
      const runtimeDeviceMode = resolveServerComfyUiRuntimeDeviceMode(env);
      const launchPythonResolution = resolveServerComfyUiLaunchPythonExecutable(
        {
          installRoot: runtimeResolution.installRoot,
          basePythonCommand,
          pythonEnvironmentMode,
          skipPythonSetup,
        },
      );
      const pythonRuntimeRoot = joinHostPath(
        serverRuntimeResolution.runtimeRootDirectory,
        "models",
        "huggingface",
      );
      const pythonRuntimeRootSource: ServerPythonRuntimeRootSource =
        serverRuntimeResolution.source;
      const hfHome = env.HF_HOME?.trim() || pythonRuntimeRoot;
      const transformersCache =
        env.TRANSFORMERS_CACHE?.trim() ||
        joinHostPath(pythonRuntimeRoot, "hub");
      const pythonRuntimeBaseUrl =
        env.PYTHON_RUNTIME_BASE_URL?.trim() || "http://127.0.0.1:43111";
      const pythonRuntimeEndpoint = new URL(pythonRuntimeBaseUrl);
      const pythonRuntimeWorkerDirectory =
        resolveServerPythonRuntimeWorkerDirectory({
          configuredWorkerDirectory: env.PYTHON_RUNTIME_WORKER_DIR,
          initCwd: env.INIT_CWD,
        });
      const pythonRuntimeCommand =
        env.PYTHON_RUNTIME_COMMAND ??
        (process.platform === "win32" ? "python" : "python3");
      const pythonRuntimeArgs = env.PYTHON_RUNTIME_ARGS?.split(" ").filter(
        Boolean,
      ) ?? ["main.py"];
      if (invalidPythonEnvironmentMode) {
        void loggingPort.log({
          timestamp: new Date().toISOString(),
          level: "warn",
          verbosity: "normal",
          event: "runtime.comfyui.server.configuration",
          host: "server",
          component: "server-host",
          message:
            "Invalid COMFYUI_PYTHON_ENVIRONMENT_MODE value. Falling back to managed-venv.",
          data: {
            invalidComfyUiPythonEnvironmentMode: invalidPythonEnvironmentMode,
            fallbackPythonEnvironmentMode: "managed-venv",
          },
        });
      }
      void loggingPort.log({
        timestamp: new Date().toISOString(),
        level: "info",
        verbosity: "normal",
        event: "runtime.python.server.configuration",
        host: "server",
        component: "server-host",
        message: "Resolved server Python runtime ownership.",
        data: {
          host: "server",
          serverStorageRootDirectory: registerOptions.storageRootDirectory,
          serverRuntimeRootDirectory:
            serverRuntimeResolution.runtimeRootDirectory,
          pythonRuntimeMode: "worker-sidecar" satisfies ServerPythonRuntimeMode,
          pythonRuntimeRootDirectory: pythonRuntimeRoot,
          pythonRuntimeRootSource,
          pythonRuntimeWorkerDirectory,
          pythonRuntimeBaseUrl,
          pythonRuntimeCommand,
          pythonRuntimeArgs,
          taskRegistryOwnership: "server",
        },
      });
      void loggingPort.log({
        timestamp: new Date().toISOString(),
        level: "info",
        verbosity: "normal",
        event: "runtime.comfyui.server.configuration",
        host: "server",
        component: "server-host",
        message: "Resolved server ComfyUI runtime roots.",
        data: {
          serverStorageRootDirectory: registerOptions.storageRootDirectory,
          serverRuntimeRootDirectory:
            serverRuntimeResolution.runtimeRootDirectory,
          comfyUiInstallRoot: runtimeResolution.installRoot,
          comfyUiInstallRootSource: runtimeResolution.source,
          storageRuntimeRootsDistinct:
            resolveHostPath(registerOptions.storageRootDirectory) !==
            serverRuntimeResolution.runtimeRootDirectory,
          autoInstall: true,
          runtimeDeviceMode,
          pythonEnvironmentMode,
          basePythonCommand,
          launchPythonExecutable: launchPythonResolution.launchPythonExecutable,
          launchPythonExecutableSource: launchPythonResolution.source,
          skipPythonSetup,
          skipPythonValidation,
          installRootSource: runtimeResolution.source,
        },
      });
      void loggingPort.log({
        timestamp: new Date().toISOString(),
        level: "info",
        verbosity: "normal",
        event: "runtime.python.server.paths",
        host: "server",
        component: "server-host",
        message: "Resolved Python runtime cache paths.",
        data: {
          serverPythonRuntimeRootDirectory: pythonRuntimeRoot,
          hfHomeSource: env.HF_HOME?.trim()
            ? "HF_HOME"
            : "SERVER_RUNTIME_ROOT/default-runtime-root",
          transformersCacheSource: env.TRANSFORMERS_CACHE?.trim()
            ? "TRANSFORMERS_CACHE"
            : "SERVER_RUNTIME_ROOT/default-runtime-root",
          taskRegistryOwnership: "server",
          hfHome,
          transformersCache,
        },
      });
      const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        documents: organizationDocuments,
      });
      const artifactBindings = createLocalArtifactStorageBindingAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        documents: organizationDocuments,
      });
      const storage = createFilesystemArtifactObjectStorageAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        host: "server",
        logging: loggingPort,
        now: options.now,
        artifactCatalogAppend: artifactCatalog,
        organizationContextProvider: options.organizationContextProvider,
      });
      const artifactBrowserRead = createFilesystemArtifactBrowserReadAdapter({
        rootDirectory: registerOptions.storageRootDirectory,
        artifactCatalogRead: artifactCatalog,
        artifactCatalogAppend: artifactCatalog,
        storage,
        artifactBindingRead: artifactBindings,
        organizationContextProvider: options.organizationContextProvider,
      });
      const artifactMediaViewRetrieval =
        createFilesystemArtifactContentRetrievalAdapter({
          storage,
          artifactCatalogRead: artifactCatalog,
        });

      const workspaceFoundation =
        internalAssetRegistry ??
        composeInternalAssetRegistry({
          rootDirectory: registerOptions.storageRootDirectory,
          now: options.now,
          documents: organizationDocuments,
        });
      internalAssetRegistry = workspaceFoundation;
      const storeArtifactUploadUseCase = new StoreArtifactUploadUseCase({
        storage,
        logging: loggingPort,
        now: options.now,
        workspaceRepository:
          workspaceFoundation.workspaceRepositories.workspaceRepository,
      });
      const websiteHtmlAcquisition = createWebsiteHtmlAcquisitionPort();
      const ingestWebsitePageUseCase = new IngestWebsitePageUseCase({
        acquisition: websiteHtmlAcquisition,
        storage,
        now: options.now,
      });
      const ingestWebsitePagesBatchUseCase = new IngestWebsitePagesBatchUseCase(
        {
          ingestWebsitePage: ingestWebsitePageUseCase,
        },
      );

      const browseArtifacts = new BrowseArtifactsUseCase({
        artifactBrowserMetadataRead: artifactBrowserRead,
        workspaceRepository:
          workspaceFoundation.workspaceRepositories.workspaceRepository,
      });
      const readArtifactDetail = new ReadArtifactDetailUseCase({
        artifactBrowserMetadataRead: artifactBrowserRead,
        workspaceRepository:
          workspaceFoundation.workspaceRepositories.workspaceRepository,
      });
      const readArtifactContent = new ReadArtifactContentUseCase({
        artifactBrowserContentRead: artifactBrowserRead,
        workspaceRepository:
          workspaceFoundation.workspaceRepositories.workspaceRepository,
      });

      const hasArtifactInRepo = new HasArtifactInRepoUseCase({
        artifactRepoStorage,
      });
      const browseHuggingFaceNamespaceDatasets =
        new BrowseHuggingFaceNamespaceDatasetsUseCase({
          repoBrowser: huggingFaceArtifactRepoStorage,
          logging: loggingPort,
          now: options.now,
        });
      const browseHuggingFaceDatasetParquetFiles =
        new BrowseHuggingFaceDatasetParquetFilesUseCase({
          repoBrowser: huggingFaceArtifactRepoStorage,
          logging: loggingPort,
          now: options.now,
        });
      const storeArtifactInRepo = new StoreArtifactInRepoUseCase({
        artifactRepoStorage,
      });
      const publishArtifactToRepo = new PublishArtifactToRepoUseCase({
        artifactStorage: storage,
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        now: options.now,
      });
      const verifyPublishedArtifactBacking =
        new VerifyPublishedArtifactBackingUseCase({
          artifactRepoStorage,
          artifactBindingStorage: artifactBindings,
          now: options.now,
        });
      const verifyImportedArtifactSourceBacking =
        new VerifyImportedArtifactSourceBackingUseCase({
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
      const importHuggingFaceFiles = new ImportHuggingFaceFilesUseCase({
        browseFiles: browseHuggingFaceDatasetParquetFiles,
        registerArtifact: registerArtifactFromRepo,
        logging: loggingPort,
        now: options.now,
      });
      const localizeArtifactFromRepo = new LocalizeArtifactFromRepoUseCase({
        artifactRepoStorage,
        artifactBindingStorage: artifactBindings,
        artifactStorage: storage,
        now: options.now,
      });
      const deleteRegisteredArtifact = new DeleteRegisteredArtifactUseCase({
        artifactCatalogRead: artifactCatalog,
        artifactCatalogDelete: artifactCatalog,
        storage,
        artifactBindingStorage: artifactBindings,
        workspaceRepository:
          workspaceFoundation.workspaceRepositories.workspaceRepository,
      });

      const resolvedRuntimeDeviceMode = runtimeDeviceMode;
      void loggingPort.log({
        level: "info",
        message: "Resolved ComfyUI runtime device mode.",
        timestamp: new Date().toISOString(),
        verbosity: "normal",
        event: "runtime.comfyui.configuration",
        component: "server-host",
        subsystem: "runtime",
        data: { runtimeDeviceMode: resolvedRuntimeDeviceMode },
      });

      const comfyUiInstallRoot = runtimeResolution.installRoot;
      const comfyUiHost = "127.0.0.1";
      const comfyUiPort = parseServerComfyUiPort(env);
      const comfyUiBaseUrl = `http://${comfyUiHost}:${comfyUiPort}`;
      const installCommandTimeoutMs = parseNumberEnv(
        env.COMFYUI_INSTALL_COMMAND_TIMEOUT_MS,
        "COMFYUI_INSTALL_COMMAND_TIMEOUT_MS",
      );
      const execFileWithTimeout = async (
        file: string,
        args: readonly string[] = [],
      ) =>
        execFile(file, [...args], {
          ...(installCommandTimeoutMs
            ? { timeout: installCommandTimeoutMs }
            : {}),
          windowsHide: true,
        }) as Promise<{ stdout: string; stderr: string }>;
      const gitRuntimeInstaller = createGitRuntimeInstallerAdapter({
        logging: loggingPort,
        execFile: execFileWithTimeout,
      });
      let comfyUiSupervisor:
        ReturnType<typeof createComfyUiRuntimeSupervisor> | undefined;
      let activeRuntimeDeviceMode: ComfyUiRuntimeDeviceMode | undefined;
      const createComfyUiInstallerForMode = async (
        mode: ComfyUiRuntimeDeviceMode,
      ) =>
        createComfyUiRuntimeInstaller({
          gitInstaller: gitRuntimeInstaller,
          pythonCommand: basePythonCommand,
          execFile: execFileWithTimeout,
          runtimeDeviceMode: mode,
          cudaTorchWheelIndexUrl: await readRuntimeSettingString(
            RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
          ),
          skipPythonSetup,
          skipPythonValidation,
          pythonEnvironmentMode,
          directMlTorchVersion: env.COMFYUI_DIRECTML_TORCH_VERSION,
          directMlTorchAudioVersion: env.COMFYUI_DIRECTML_TORCHAUDIO_VERSION,
          directMlTorchVisionVersion: env.COMFYUI_DIRECTML_TORCHVISION_VERSION,
          directMlPackageName: env.COMFYUI_DIRECTML_PACKAGE,
          logging: loggingPort,
        });
      const startComfyUiWithRuntimeDeviceMode = async (request: {
        runtimeDeviceMode?: ComfyUiRuntimeDeviceMode;
      }) => {
        const cudaTorchWheelIndexUrl = await readRuntimeSettingString(
          RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
        );
        const envOverride = normalizeComfyUiRuntimeDeviceMode(
          env.COMFYUI_RUNTIME_DEVICE_MODE ?? env.COMFYUI_ACCELERATOR,
        );
        const requestedMode = normalizeServerImageGenerationRuntimeMode(
          request.runtimeDeviceMode,
        );
        const autoSelectedCuda =
          !envOverride &&
          (requestedMode === undefined || requestedMode === "auto") &&
          Boolean(cudaTorchWheelIndexUrl);
        const resolvedRequestMode =
          envOverride ??
          (requestedMode === undefined || requestedMode === "auto"
            ? cudaTorchWheelIndexUrl
              ? "cuda"
              : "cpu"
            : resolveServerComfyUiRuntimeDeviceMode(
                env,
                request.runtimeDeviceMode,
              ));
        const startMode = async (
          mode: ComfyUiRuntimeDeviceMode,
          fallbackReason?: string,
        ) => {
          const modeChanged =
            activeRuntimeDeviceMode !== undefined &&
            activeRuntimeDeviceMode !== mode;
          if (modeChanged && comfyUiSupervisor) {
            await comfyUiSupervisor.stop();
            comfyUiSupervisor = undefined;
          }
          if (!comfyUiSupervisor) {
            comfyUiSupervisor = createComfyUiRuntimeSupervisor({
              workingDirectory: comfyUiInstallRoot,
              pythonExecutable: launchPythonResolution.launchPythonExecutable,
              installer: await createComfyUiInstallerForMode(mode),
              installRoot: comfyUiInstallRoot,
              host: comfyUiHost,
              port: comfyUiPort,
              runtimeDeviceMode: mode,
              autoInstall: true,
              installSourceRef: env.COMFYUI_INSTALL_REF,
              logging: loggingPort,
            });
            activeRuntimeDeviceMode = mode;
          }
          await loggingPort.log({
            level: "info",
            message: "Resolved server ComfyUI runtime mode before start.",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            event: "runtime.comfyui.mode.resolution",
            component: "server-host",
            subsystem: "runtime",
            data: {
              requestedRuntimeDeviceMode: request.runtimeDeviceMode,
              cudaTorchWheelIndexConfigured: Boolean(cudaTorchWheelIndexUrl),
              envOverrideWon: Boolean(envOverride),
              runtimeDeviceMode: mode,
              processReuse: modeChanged
                ? "restarted_mode_changed"
                : "reused_or_started",
              fallbackReason,
            },
          });
          await comfyUiSupervisor.start();
        };
        try {
          await startMode(resolvedRequestMode);
        } catch (error) {
          if (
            !autoSelectedCuda ||
            resolvedRequestMode !== "cuda" ||
            !isRecoverableCudaTorchInstallFailure(error)
          ) {
            throw error;
          }
          await loggingPort.log({
            level: "warn",
            message:
              "Automatic CUDA ComfyUI setup failed; falling back to CPU runtime mode.",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            event: "runtime.comfyui.mode.fallback",
            component: "server-host",
            subsystem: "runtime",
            data: {
              requestedRuntimeDeviceMode: request.runtimeDeviceMode,
              failedRuntimeDeviceMode: "cuda",
              fallbackRuntimeDeviceMode: "cpu",
              cudaTorchWheelIndexConfigured: true,
              reason: error instanceof Error ? error.message : String(error),
            },
          });
          if (comfyUiSupervisor) {
            await comfyUiSupervisor.stop();
          }
          comfyUiSupervisor = undefined;
          activeRuntimeDeviceMode = undefined;
          await startMode("cpu", "auto-cuda-install-failed");
        }
      };
      const comfyUiSupervisorPort = {
        async start() {
          await startComfyUiWithRuntimeDeviceMode({});
        },
        async startWithRuntimeDeviceMode(request: {
          runtimeDeviceMode?: ComfyUiRuntimeDeviceMode;
        }) {
          await startComfyUiWithRuntimeDeviceMode(request);
        },
        getRecentRuntimeOutput() {
          return comfyUiSupervisor?.getRecentRuntimeOutput() ?? [];
        },
        getRuntimeDeviceMode() {
          return activeRuntimeDeviceMode ?? runtimeDeviceMode;
        },
      };
      const comfyUiClient = createComfyUiHttpClient({
        baseUrl: comfyUiBaseUrl,
      });
      let previousCpuSample: { idle: number; total: number } | undefined;
      const imageGenerationRuntimeControl = {
        async unloadModel() {
          if (!comfyUiSupervisor?.isRunning()) {
            return {
              unloaded: true,
              message: "No running ComfyUI runtime process has a loaded model.",
            };
          }
          await comfyUiClient.unloadModels();
          return {
            unloaded: true,
            message: "ComfyUI model memory was released.",
          };
        },
        async readRuntimeResources() {
          const cpuSamples = cpus();
          const totalIdle = cpuSamples.reduce(
            (sum, cpu) => sum + cpu.times.idle,
            0,
          );
          const totalTick = cpuSamples.reduce(
            (sum, cpu) =>
              sum + Object.values(cpu.times).reduce((a, b) => a + b, 0),
            0,
          );
          const deltaIdle = previousCpuSample
            ? totalIdle - previousCpuSample.idle
            : 0;
          const deltaTotal = previousCpuSample
            ? totalTick - previousCpuSample.total
            : 0;
          previousCpuSample = { idle: totalIdle, total: totalTick };
          const cpuUsagePercent =
            deltaTotal > 0
              ? Math.max(0, Math.min(100, (1 - deltaIdle / deltaTotal) * 100))
              : 0;
          const totalMemory = totalmem();
          const memoryUsagePercent =
            totalMemory > 0
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    ((totalMemory - freemem()) / totalMemory) * 100,
                  ),
                )
              : 0;
          const gpuSample = spawnSync(
            "nvidia-smi",
            ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            { encoding: "utf8", timeout: 800 },
          );
          const gpuUsagePercent =
            gpuSample.status === 0 && gpuSample.stdout
              ? (() => {
                  const values = gpuSample.stdout
                    .split("\n")
                    .map((line) => Number.parseFloat(line.trim()))
                    .filter((value) => Number.isFinite(value));
                  if (values.length === 0) return 0;
                  const avg =
                    values.reduce((sum, value) => sum + value, 0) /
                    values.length;
                  return Math.max(0, Math.min(100, avg));
                })()
              : 0;
          return { memoryUsagePercent, cpuUsagePercent, gpuUsagePercent };
        },
      };
      const runtimeTaskRegistry =
        createServerImageGenerationRuntimeTaskRegistry({
          client: comfyUiClient,
          supervisor: comfyUiSupervisorPort,
          prepareLatentReferenceImage: async ({ artifactId }) => {
            const result = await storage.retrieveArtifact({ key: artifactId });
            if (!result.ok) {
              throw new Error(
                `Unable to read latent reference image artifact '${artifactId}': ${result.error.message}`,
              );
            }
            const content =
              result.value.content instanceof Uint8Array
                ? result.value.content
                : new Uint8Array(result.value.content as ArrayBufferLike);
            const mediaType = result.value.descriptor.mediaType;
            const extension = extensionForImageReference(mediaType, artifactId);
            const imageName = `ai-system-builder-latent-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
            const inputDirectory = joinHostPath(comfyUiInstallRoot, "input");
            await mkdir(inputDirectory, { recursive: true });
            await writeFile(joinHostPath(inputDirectory, imageName), content);
            return { imageName };
          },
          mapperOptions: { defaultCheckpoint: env.COMFYUI_DEFAULT_CHECKPOINT },
        });

      const modelManagementLogger = {
        info: (event: string, data: Record<string, unknown>) => {
          void loggingPort.log({
            level: "info",
            message: event,
            event,
            component: "model-management",
            subsystem: "api",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            data,
          });
        },
        warn: (event: string, data: Record<string, unknown>) => {
          void loggingPort.log({
            level: "warn",
            message: event,
            event,
            component: "model-management",
            subsystem: "api",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            data,
          });
        },
      };
      const imageGenerationLogger = {
        info: (event: string, data: Record<string, unknown>) => {
          void loggingPort.log({
            level: "info",
            message: event,
            event,
            component: "image-generation",
            subsystem: "api",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            data,
          });
        },
        warn: (event: string, data: Record<string, unknown>) => {
          void loggingPort.log({
            level: "warn",
            message: event,
            event,
            component: "image-generation",
            subsystem: "api",
            timestamp: new Date().toISOString(),
            verbosity: "normal",
            data,
          });
        },
      };

      const modelRegistry = createLocalModelRegistryAdapter({
        filePath: `${registerOptions.storageRootDirectory}/model-registry/models.json`,
        rootDirectory: registerOptions.storageRootDirectory,
        documents: organizationDocuments,
        now: options.now,
        discovery: {
          searchRoots: async () => {
            const root = await readRuntimeSettingString(
              SHARED_MODEL_STORAGE_DIRECTORY_SETTING_KEY,
            );
            return root ? [root] : [];
          },
        },
      });
      const imageAssetRegistry = createLocalImageAssetRegistryAdapter({
        filePath: joinHostPath(
          registerOptions.storageRootDirectory,
          ".catalog",
          "image-assets.json",
        ),
        rootDirectory: registerOptions.storageRootDirectory,
        documents: organizationDocuments,
        now: options.now,
      });
      internalAssetRegistry = composeInternalAssetRegistry({
        rootDirectory: registerOptions.storageRootDirectory,
        now: options.now,
        documents: organizationDocuments,
        definitionDocuments: options.persistence?.documents,
        resourceBackedViewProvider: composeResourceBackedViewProviders({
          artifactBrowserMetadataRead: artifactBrowserRead,
          imageAssetDescriptorRead: imageAssetRegistry,
          modelRegistry,
          publishedModelRegistry: modelRegistry,
        }),
      });
      const foundationReady = internalAssetRegistry.installSystemFoundationPack
        .install({
          allowSystemDefinitionRefresh: true,
        })
        .then((result) => {
          if (result.status === "failed") {
            throw new Error("System foundation assets are unavailable.");
          }
        });
      assetFoundationReady = foundationReady;
      const assetImplementation = organizationDocuments
        ? composeAssetImplementationKernel({
            documents: organizationDocuments,
            definitions:
              internalAssetRegistry.assetKernel.repositories
                .definitionRepository,
            artifacts: createAssetImplementationArtifactAdapter(storage),
            now: options.now ?? (() => new Date().toISOString()),
          })
        : undefined;
      const ensureAssetImplementationReady = async () => {
        await foundationReady;
        await assetImplementation?.ensureTrustedBuiltIns();
      };
      const assetPackages =
        organizationDocuments && assetImplementation
          ? composeAssetPackageLifecycle({
              documents: organizationDocuments,
              definitions:
                internalAssetRegistry.assetKernel.repositories
                  .definitionRepository,
              implementations: assetImplementation.repository,
              backingResources: assetImplementation.backingResources,
              artifacts: createAssetImplementationArtifactAdapter(storage),
              nextInspectionId: () => `package-inspection.${randomUUID()}`,
              now: options.now ?? (() => new Date().toISOString()),
            })
          : undefined;
      const assetStudio =
        organizationDocuments && assetImplementation
          ? composeAssetStudioWorkflow({
              documents: organizationDocuments,
              implementations: assetImplementation,
              artifacts: createAssetImplementationArtifactAdapter(storage),
              now: options.now ?? (() => new Date().toISOString()),
            })
          : undefined;
      const systemBuilder = organizationDocuments
        ? composeSystemBuilder({
            documents: organizationDocuments,
            definitions: {
              readExactDefinition: (reference) =>
                internalAssetRegistry!.assetKernel.repositories.definitionRepository.getDefinition(
                  reference,
                ),
            },
            generateSystemId: () => `system.${randomUUID()}`,
            now: options.now,
          })
        : undefined;
      const systemBuildArtifacts = createSystemBuildArtifactAdapter(storage);
      const systemBuild =
        organizationDocuments && systemBuilder && assetImplementation
          ? composeSystemBuild({
              documents: organizationDocuments,
              systemBuilder,
              resolver: {
                async resolve(request) {
                  await ensureAssetImplementationReady();
                  return assetImplementation.useCases.resolve.execute(request);
                },
              },
              artifacts: systemBuildArtifacts,
              hasher: createSha256SystemBuildHasher(),
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
      const systemReview =
        organizationDocuments && systemBuild
          ? composeSystemReview({
              documents: organizationDocuments,
              builds: systemBuild.repository,
              buildArtifacts: systemBuildArtifacts,
              artifacts: artifactBrowserRead,
              content: artifactMediaViewRetrieval,
              generateAuditId: () => `system-review-audit.${randomUUID()}`,
              now: options.now,
            })
          : undefined;
      const systemDeploymentProfile = resolveServerSystemDeploymentProfile(env);
      const systemDeployment =
        organizationDocuments && systemBuild
          ? composeSystemDeployment({
              documents: organizationDocuments,
              builds: systemBuild.repository,
              artifacts: systemBuildArtifacts,
              runtime: createTrustedSystemDeploymentRuntimeAdapter({
                deploymentProfiles: [systemDeploymentProfile],
                now: options.now,
              }),
              revocations: {
                async listRevokedImplementationReleaseIds(
                  _workspaceId,
                  releaseIds,
                ) {
                  return (
                    await assetImplementation!.repository.listRevocations(
                      releaseIds,
                    )
                  ).map((item) => item.releaseId);
                },
              },
              platformPolicy: createDefaultSystemDeploymentPolicy(),
              generateAuditId: () => `system-deployment-audit.${randomUUID()}`,
              now: options.now,
            })
          : undefined;
      const generateAssetInstanceId = () => `asset-instance.${randomUUID()}`;
      const assetMutationUseCases = {
        registerResourceBackedViewAsAsset:
          new RegisterResourceBackedViewAsAssetInstanceUseCase({
            assetRegistryRead: internalAssetRegistry.readFacade,
            definitionRepository:
              internalAssetRegistry.assetKernel.repositories
                .definitionRepository,
            instanceRepository:
              internalAssetRegistry.assetKernel.repositories.instanceRepository,
            now: options.now,
            generateInstanceId: generateAssetInstanceId,
          }),
        finalizeGeneratedOutputAsAsset:
          new FinalizeGeneratedOutputAsAssetUseCase({
            assetRegistryRead: internalAssetRegistry.readFacade,
            definitionRepository:
              internalAssetRegistry.assetKernel.repositories
                .definitionRepository,
            instanceRepository:
              internalAssetRegistry.assetKernel.repositories.instanceRepository,
            now: options.now,
            generateInstanceId: generateAssetInstanceId,
          }),
        importExternalRepositoryObjectAsAsset:
          new ImportExternalRepositoryObjectAsAssetUseCase({
            assetRegistryRead: internalAssetRegistry.readFacade,
            definitionRepository:
              internalAssetRegistry.assetKernel.repositories
                .definitionRepository,
            instanceRepository:
              internalAssetRegistry.assetKernel.repositories.instanceRepository,
            now: options.now,
            generateInstanceId: generateAssetInstanceId,
          }),
        localizeExternalRepositoryObjectAsAsset:
          new LocalizeExternalRepositoryObjectAsAssetUseCase({
            assetRegistryRead: internalAssetRegistry.readFacade,
            definitionRepository:
              internalAssetRegistry.assetKernel.repositories
                .definitionRepository,
            instanceRepository:
              internalAssetRegistry.assetKernel.repositories.instanceRepository,
            now: options.now,
            generateInstanceId: generateAssetInstanceId,
          }),
      };
      const huggingFaceModelBrowseDetails =
        createHuggingFaceModelBrowseDetailsAdapter({
          accessTokenProvider: () => tokenConfigStore.getToken(),
          logger: modelManagementLogger,
        });
      const browseModelsUseCase = new BrowseModelsUseCase({
        providers: { huggingface: huggingFaceModelBrowseDetails },
      });
      const getModelDetailsUseCase = new GetModelDetailsUseCase({
        providers: { huggingface: huggingFaceModelBrowseDetails },
      });
      const listModelsUseCase = new ListModelsUseCase({ modelRegistry });
      const saveModelReferenceUseCase = new SaveModelReferenceUseCase({
        modelRegistry,
      });
      const pythonRuntimeEnvironment = {
        ...env,
        PYTHON_RUNTIME_HOST: pythonRuntimeEndpoint.hostname,
        PYTHON_RUNTIME_PORT: pythonRuntimeEndpoint.port || "43111",
        HF_HOME: hfHome,
        TRANSFORMERS_CACHE: transformersCache,
        ...(env.HF_HUB_DISABLE_XET
          ? { HF_HUB_DISABLE_XET: env.HF_HUB_DISABLE_XET }
          : {}),
        HF_XET_CACHE:
          env.HF_XET_CACHE?.trim() || joinHostPath(pythonRuntimeRoot, "xet"),
        HF_HUB_DISABLE_SYMLINKS_WARNING:
          env.HF_HUB_DISABLE_SYMLINKS_WARNING ?? "1",
      };
      const pythonRuntimeFoundation = createPythonRuntimeAdapterFoundation({
        client: { baseUrl: pythonRuntimeBaseUrl },
        supervisor: {
          command: pythonRuntimeCommand,
          args: pythonRuntimeArgs,
          cwd: pythonRuntimeWorkerDirectory,
          env: pythonRuntimeEnvironment,
          prepareRuntimeEnvironment(context) {
            ensurePythonRuntimeWorkerDependencies({
              command: context.command,
              cwd: context.cwd,
              env: context.env,
            });
          },
          onEvent(event) {
            const source = event.data?.source;
            const detail = event.detail?.trim();
            const message =
              event.type === "stdio"
                ? `Python runtime ${source === "stderr" ? "stderr" : "stdout"}: ${detail ?? ""}`
                : (detail ?? `Python runtime event: ${event.type}`);
            void loggingPort.log({
              timestamp: new Date().toISOString(),
              level: classifyPythonRuntimeSupervisorLogLevel(
                event.type,
                source,
              ),
              verbosity: "normal",
              event: "runtime.python.server.activity",
              message,
              component: "python-runtime-supervisor",
              subsystem: "runtime",
              data: {
                eventType: event.type,
                supervisorStatus: event.status,
                ...event.data,
              },
            });
          },
        },
      });
      const downloadModelUseCase = new DownloadModelUseCase({
        modelRegistry,
        modelDownloader: {
          ensureModelDownloaded: async (request) => {
            const startedAt = Date.now();
            modelManagementLogger.info(
              "runtime.python.model_download.requested",
              {
                provider: request.provider,
                modelId: request.modelId,
              },
            );
            await pythonRuntimeFoundation.supervisor.start();
            modelManagementLogger.info(
              "runtime.python.model_download.runtime_ready",
              {
                provider: request.provider,
                modelId: request.modelId,
                elapsedMs: Date.now() - startedAt,
              },
            );
            try {
              const result =
                await pythonRuntimeFoundation.runtimePort.ensureModelDownloaded(
                  request,
                );
              modelManagementLogger.info(
                "runtime.python.model_download.succeeded",
                {
                  provider: result.provider,
                  modelId: result.modelId,
                  downloaded: result.downloaded,
                  fromCache: result.fromCache,
                  hasLocalPath:
                    typeof result.localPath === "string" &&
                    result.localPath.length > 0,
                  elapsedMs: Date.now() - startedAt,
                },
              );
              return result;
            } catch (error) {
              modelManagementLogger.warn(
                "runtime.python.model_download.failed",
                {
                  provider: request.provider,
                  modelId: request.modelId,
                  message:
                    error instanceof Error ? error.message : String(error),
                  elapsedMs: Date.now() - startedAt,
                },
              );
              throw error;
            }
          },
        },
      });
      const updateModelRecordUseCase = new UpdateModelRecordUseCase({
        modelRegistry,
      });
      const deleteModelRecordUseCase = new DeleteModelRecordUseCase({
        modelRegistry,
      });
      const runtimeReadiness = createServerRuntimeReadinessService({
        pythonSupervisor: pythonRuntimeFoundation.supervisor,
        readComfyUiSupervisor: () => comfyUiSupervisor,
        readComfyUiInstallStatus: async () => {
          const installer = await createComfyUiInstallerForMode(
            activeRuntimeDeviceMode ?? runtimeDeviceMode,
          );
          return (
            await installer.getInstallStatus({
              targetId: "comfyui",
              installRoot: comfyUiInstallRoot,
            })
          ).status;
        },
        now: options.now,
      });
      const runtimeCapabilityGuard = new RuntimeCapabilityGuardService(
        runtimeReadiness,
      );
      const localModelCheckpointResolver =
        createLocalModelCheckpointResolverAdapter({
          modelRegistry,
          comfyUiCheckpointDirectory: joinHostPath(
            comfyUiInstallRoot,
            "models",
            "checkpoints",
          ),
        });
      const generateImageUseCase = new GenerateImageUseCase({
        runtimeTaskRegistry,
        modelCheckpointResolver: createRuntimePreparedModelCheckpointResolver({
          runtime: comfyUiSupervisorPort,
          modelCheckpointResolver: localModelCheckpointResolver,
        }),
        runtimeCapabilityGuard,
      });
      const listSettingsDefinitionsUseCase = new ListSettingsDefinitionsUseCase(
        {
          settings: applicationSettings,
        },
      );
      const readSettingsUseCase = new ReadSettingsUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });
      const updateSettingUseCase = new UpdateSettingUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });
      const clearSettingUseCase = new ClearSettingUseCase({
        settings: applicationSettings,
        secrets: applicationSecrets,
      });

      const imageGenerationFinalizationOrchestrator =
        new ImageGenerationFinalizationOrchestratorService({
          runtimeTaskRegistry,
          organizationContextProvider: options.organizationContextProvider,
          finalizeImageGenerationService: new FinalizeImageGenerationService({
            imageAssetRegistry,
            generatedImagePersistence:
              createFilesystemGeneratedImagePersistenceAdapter({
                comfyUiOutputRoot: joinHostPath(comfyUiInstallRoot, "output"),
                artifactStorageRoot: registerOptions.storageRootDirectory,
                artifactCatalogAppend: artifactCatalog,
                artifactStorageBinding: artifactBindings,
                logging: loggingPort,
                now: options.now,
                organizationContextProvider:
                  options.organizationContextProvider,
              }),
            now: options.now,
          }),
        });

      const structuredRepositoryOptions = {
        rootDir: registerOptions.storageRootDirectory,
        now: options.now,
        documents: organizationDocuments,
      };
      const assetCompositionPlanRepository =
        createLocalAssetCompositionPlanRepositoryAdapter(
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
          runtimeGuard: createPythonConversationalRuntimeGuard(
            pythonRuntimeFoundation.runtimePort,
          ),
          invocationPort:
            createPythonConversationalTextGenerationInvocationAdapter(
              pythonRuntimeFoundation.runtimePort,
            ),
          hostCapabilities: {
            submitTurn: "supported",
            cancelTurn: "unsupported",
            retryTurn: "unsupported",
            streaming: false,
          },
          now: options.now,
        });

      registerExpressApi({
        app: registerOptions.app,
        getHuggingFaceTokenStatus: () => tokenConfigStore.getStatus(),
        setHuggingFaceToken: (token) => tokenConfigStore.setToken(token),
        clearHuggingFaceToken: () => tokenConfigStore.clearToken(),
        storeArtifactUploadUseCase,
        ingestWebsitePageUseCase,
        ingestWebsitePagesBatchUseCase,
        browseArtifactsUseCase: browseArtifacts,
        readArtifactDetailUseCase: readArtifactDetail,
        readArtifactContentUseCase: readArtifactContent,
        artifactMediaViewRetrieval,
        deleteRegisteredArtifactUseCase: deleteRegisteredArtifact,
        hasArtifactInRepoUseCase: hasArtifactInRepo,
        browseHuggingFaceNamespaceDatasetsUseCase:
          browseHuggingFaceNamespaceDatasets,
        browseHuggingFaceDatasetParquetFilesUseCase:
          browseHuggingFaceDatasetParquetFiles,
        importHuggingFaceFilesUseCase: importHuggingFaceFiles,
        storeArtifactInRepoUseCase: storeArtifactInRepo,
        publishArtifactToRepoUseCase: publishArtifactToRepo,
        verifyPublishedArtifactBackingUseCase: verifyPublishedArtifactBacking,
        verifyImportedArtifactSourceBackingUseCase:
          verifyImportedArtifactSourceBacking,
        registerArtifactFromRepoUseCase: registerArtifactFromRepo,
        localizeArtifactFromRepoUseCase: localizeArtifactFromRepo,
        browseModelsUseCase,
        getModelDetailsUseCase,
        listModelsUseCase,
        saveModelReferenceUseCase,
        downloadModelUseCase,
        updateModelRecordUseCase,
        deleteModelRecordUseCase,
        generateImageUseCase,
        imageGenerationFinalizationOrchestrator,
        imageGenerationRuntimeControl,
        imageGenerationLogger,
        listSettingsDefinitionsUseCase,
        readSettingsUseCase,
        updateSettingUseCase,
        clearSettingUseCase,
        modelManagementLogger,
        restartServer: options.restartServer,
        runtimeReadiness,
        assetRegistryRead: internalAssetRegistry.workspaceReadFacade,
        workspaceServices: {
          workspaceRepository:
            workspaceFoundation.workspaceRepositories.workspaceRepository,
          workspaceSelectionRepository:
            workspaceFoundation.workspaceRepositories
              .workspaceSelectionRepository,
          createWorkspaceUseCase:
            workspaceFoundation.workspaceUseCases.createWorkspace,
        },
        assetMutationUseCases,
        userLibraryServices: (() => {
          const userLibraryAssetRepository =
            createLocalUserLibraryAssetRepositoryAdapter(
              structuredRepositoryOptions,
            );
          const workspaceUserLibraryLinkRepository =
            createLocalWorkspaceUserLibraryLinkRepositoryAdapter(
              structuredRepositoryOptions,
            );
          return {
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
            assetRegistryRead: internalAssetRegistry.workspaceReadFacade,
          };
        })(),
        assetAuthoringServices: (() => {
          const assetAuthoringRepositories = {
            authoredAssetRepository: createLocalAuthoredAssetRepositoryAdapter(
              structuredRepositoryOptions,
            ),
            assetDraftRepository: createLocalAssetDraftRepositoryAdapter(
              structuredRepositoryOptions,
            ),
            assetRevisionRepository: createLocalAssetRevisionRepositoryAdapter(
              structuredRepositoryOptions,
            ),
            assetOverrideRepository: createLocalAssetOverrideRepositoryAdapter(
              structuredRepositoryOptions,
            ),
          };
          const unavailableTargetReader: AssetCustomizationTargetReaderPort = {
            async readCustomizationTargetByReference() {
              throw new Error(
                "asset-authoring.customization-target-reader.unavailable",
              );
            },
          };
          const effectiveSummaryReader =
            new WorkspaceAssetAuthoringReadModelService({
              ...assetAuthoringRepositories,
            });
          const derivedCustomizations =
            organizationDocuments && assetImplementation
              ? composeAssetDerivedCustomization({
                  documents: organizationDocuments,
                  definitions:
                    internalAssetRegistry!.assetKernel.repositories
                      .definitionRepository,
                  implementations: assetImplementation,
                  artifacts: createAssetImplementationArtifactAdapter(storage),
                  authoredAssets:
                    assetAuthoringRepositories.authoredAssetRepository,
                  ensureReady: ensureAssetImplementationReady,
                  now: options.now ?? (() => new Date().toISOString()),
                })
              : undefined;
          return {
            ...assetAuthoringRepositories,
            ...(derivedCustomizations
              ? { derivedCustomizations: derivedCustomizations.service }
              : {}),
            createWorkspaceAuthoredAssetUseCase:
              new CreateWorkspaceAuthoredAssetUseCase({
                authoredAssetRepository:
                  assetAuthoringRepositories.authoredAssetRepository,
                assetRevisionRepository:
                  assetAuthoringRepositories.assetRevisionRepository,
                now: options.now,
                generateAuthoredAssetId: () => randomUUID(),
                generateAssetRevisionId: () => randomUUID(),
              }),
            createAssetDraftUseCase: new CreateAssetDraftUseCase({
              assetDraftRepository:
                assetAuthoringRepositories.assetDraftRepository,
              now: options.now,
              generateAssetDraftId: () => randomUUID(),
            }),
            updateAssetDraftUseCase: new UpdateAssetDraftUseCase({
              assetDraftRepository:
                assetAuthoringRepositories.assetDraftRepository,
              now: options.now,
            }),
            publishAssetDraftUseCase: new PublishAssetDraftUseCase({
              authoredAssetRepository:
                assetAuthoringRepositories.authoredAssetRepository,
              assetDraftRepository:
                assetAuthoringRepositories.assetDraftRepository,
              assetRevisionRepository:
                assetAuthoringRepositories.assetRevisionRepository,
              now: options.now,
              generateAuthoredAssetId: () => randomUUID(),
              generateAssetRevisionId: () => randomUUID(),
            }),
            createAssetOverrideUseCase: new CreateAssetOverrideUseCase({
              assetOverrideRepository:
                assetAuthoringRepositories.assetOverrideRepository,
              targetReader: unavailableTargetReader,
              now: options.now,
              generateAssetOverrideId: () => randomUUID(),
            }),
            updateAssetOverrideUseCase: new UpdateAssetOverrideUseCase({
              assetOverrideRepository:
                assetAuthoringRepositories.assetOverrideRepository,
              now: options.now,
            }),
            disableAssetOverrideUseCase: new DisableAssetOverrideUseCase({
              assetOverrideRepository:
                assetAuthoringRepositories.assetOverrideRepository,
              now: options.now,
            }),
            effectiveSummaryReader,
          };
        })(),
        assetCompositionServices: (() => {
          const effectiveProjectionRepository =
            createLocalEffectiveAssetProjectionRepositoryAdapter(
              structuredRepositoryOptions,
            );
          return {
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
              projectionRepository: effectiveProjectionRepository,
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
              projectionRepository: effectiveProjectionRepository,
              now: options.now,
            }),
            readModel: new WorkspaceAssetCompositionReadModelService({
              compositionPlanRepository: assetCompositionPlanRepository,
            }),
          };
        })(),
        executionPlanServices: {
          executionPlans: {
            create: executionPlanServices.createPlan,
            validate: executionPlanServices.validatePlan,
            readModel: executionPlanServices.readModel,
          },
        },
        conversationExecutionServices: {
          conversations: conversationExecutionServices,
        },
        ...(assetImplementation
          ? {
              assetImplementationServices: {
                listReleases: {
                  async execute(workspaceId) {
                    await ensureAssetImplementationReady();
                    return assetImplementation.useCases.listReleases.execute(
                      workspaceId,
                    );
                  },
                },
                resolve: {
                  async execute(request) {
                    await ensureAssetImplementationReady();
                    return assetImplementation.useCases.resolve.execute(
                      request,
                    );
                  },
                },
              },
            }
          : {}),
        ...(assetPackages
          ? {
              assetPackageServices: {
                inspect: assetPackages.useCases.inspect,
                admit: assetPackages.useCases.admit,
                list: assetPackages.useCases.list,
                activate: assetPackages.useCases.activate,
                disable: assetPackages.useCases.disable,
                rollback: assetPackages.useCases.rollback,
              },
            }
          : {}),
        ...(assetStudio
          ? {
              assetStudioServices: {
                start: assetStudio.useCases.start,
                propose: assetStudio.useCases.propose,
                review: assetStudio.useCases.review,
                read: assetStudio.useCases.read,
                list: assetStudio.useCases.list,
              },
            }
          : {}),
        ...(systemBuilder
          ? { systemBuilderServices: systemBuilder.useCases }
          : {}),
        ...(systemData
          ? { systemDataServices: { runtime: systemData.runtime } }
          : {}),
        ...(systemReview
          ? { systemReviewServices: { runtime: systemReview.runtime } }
          : {}),
        ...(systemDeployment
          ? {
              systemDeploymentServices: {
                host: {
                  deploymentProfiles: [systemDeploymentProfile],
                  hostApiVersion: "1.0.0",
                  capabilities: [],
                  sandboxQualified: false,
                },
                ...systemDeployment.useCases,
              },
            }
          : {}),
        ...(systemBuild ? { systemBuildServices: systemBuild.useCases } : {}),
      });
    },
  };
}

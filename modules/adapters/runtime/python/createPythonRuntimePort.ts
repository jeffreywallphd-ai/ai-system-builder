import type { PythonRuntimePort } from "../../../application/ports/runtime";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { isWorkspaceId } from "../../../contracts/workspace";
import {isOrganizationId} from "../../../contracts/organization";
import { types } from "node:util";
import {ModelSourceRecipient} from "./client/modelSourceRecipient";
import {captureTrainingProfile, createOriginalTrainingPort, captureOriginalTrainingModelReader, type OriginalTrainingProfile, type OriginalTrainingCapture,
  type OriginalTrainingExitConfiguration, type OriginalTrainingOwnedChannel} from "./client/approvedTrainingTaskSession";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {createOriginalTrainingModelSourceFactory, type OriginalTrainingModelObservationPolicy,
  type OriginalTrainingModelObservation, type ObservedOriginalTrainingModelSource, bindOriginalTrainingSourceLaunch,
  type OriginalTrainingSourceReservationFactory, type OriginalTrainingSourceLaunch,
  type OriginalTrainingSourceReservation} from "./client/originalTrainingModelSource";
import {captureOriginalWorkerResourceProfile} from "./supervisor/windowsOriginalWorkerLaunch";
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingDefinition, BoundedLocalTrainingModelCopyStoragePort,
  BoundedLocalTrainingModelSource} from "../../../application/ports/model";
import type {ApplicationRequestContext} from "../../../application/ports/application-request-context";
import path from "node:path";
import type {ModelSourceTaskSession, CapturedModelSourceTask} from "./client/modelSourceTaskSession";
import type {GeneratedModelStoragePort} from "../../../application/ports/model";
import type {CreatePythonRuntimeTaskRegistryAdapterOptions} from "./createPythonRuntimeTaskRegistryAdapter";
import { normalizePythonRuntimeLoopbackBaseUrl, resolvePythonRuntimeLoopbackEndpoint } from "./config/pythonRuntimeEndpoint";
import type {
  CancelPythonRuntimeTaskResult,
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
  StartPythonRuntimeTaskResult,
} from "../../../contracts/runtime";

import {
  createPythonRuntimeHttpClient,
  resolveConfiguredModelCacheRoot,
  type CreatePythonRuntimeHttpClientOptions,
} from "./client/createPythonRuntimeHttpClient";
import {
  createPythonRuntimeSupervisor,
  type CreatePythonRuntimeSupervisorOptions,
  type PythonRuntimeSupervisor, createBoundedLocalTrainingStartupProfile, type BoundedLocalTrainingStartupProfile,
} from "./supervisor/createPythonRuntimeSupervisor";

export interface CreatePythonRuntimePortOptions {
  client: Omit<
    CreatePythonRuntimeHttpClientOptions,
    "authorizationToken" | "authorizationTokenProvider" | "captureProcessOwnership"
  >;
  supervisor: Omit<
    CreatePythonRuntimeSupervisorOptions,
    "runtimeClient" | "prepareLaunchEnvironment" | "requireOwnedStartupProof" | "assertHostCurrent"
  >;
  generateAuthorizationToken?: () => string;
}

export interface OriginalBoundedLocalTrainingConfiguration {
  readonly startupProfile: BoundedLocalTrainingStartupProfile;
  readonly observation: OriginalTrainingModelObservationPolicy;
  /** Synchronous capability binding only; the returned owner performs later IO. */
  readonly createModelCopy: (input: Readonly<{definition: ApprovedLocalTrainingDefinition;
    source: BoundedLocalTrainingModelSource; context: ApplicationRequestContext;
    control: {assertCurrent(): void; assertAllowed(): Promise<void>; assertCleanupAllowed(): Promise<void>}}>) => BoundedLocalTrainingModelCopyStoragePort;
}

export interface PythonRuntimeAdapterFoundation {
  /** Explicit cooperative profile; absent support never permits Native fallback. */
  createBoundedLocalTrainingPort?(configuration: OriginalBoundedLocalTrainingConfiguration): ApprovedLocalModelTrainingPort;
  /** Private trusted composition; no profile means no availability or startup. */
  createApprovedTrainingPort(profile?: OriginalTrainingProfile, observation?: OriginalTrainingModelObservationPolicy,
    sourceReservation?: OriginalTrainingSourceReservationFactory, exitConfiguration?: OriginalTrainingExitConfiguration): ApprovedLocalModelTrainingPort;
  runtimePort: PythonRuntimePort;
  supervisor: PythonRuntimeSupervisor;
  /** Trusted host composition, once only. It can add a guard, never replace it. */
  bindHostAdmission(assertAccepting: () => void): void;
  /** Trusted host-only source channel; never generic application task JSON. */
  captureModelSourceTaskSession(): Promise<ModelSourceTaskSession>;
  /** Private captured configuration; no file, provider or runtime operation. */
  createModelSourceDownloadConfiguration(createStorage: (cacheRoot: string) => GeneratedModelStoragePort):
    NonNullable<CreatePythonRuntimeTaskRegistryAdapterOptions["modelSource"]>;
}

type OriginalSourcePreparation = {returned: boolean; confirmed: boolean; uncertain: boolean;
  pending?: Promise<unknown>; observation?: Promise<{ok: boolean; value?: unknown}>; owner?: unknown};
type OriginalFoundationTrainingReservation = {settled: boolean; capture: OriginalTrainingCapture;
  source?: OriginalTrainingModelObservation; observed?: ObservedOriginalTrainingModelSource;
  sourceReservation?: OriginalTrainingSourceReservation; sourcePreparation?: OriginalSourcePreparation;
  local?: {owner?: unknown; calls: {kind: "prepare" | "locator" | "selection" | "discard" | "invalid-fence" | "invalid-factory" | "invalid-inspect"; original?: unknown; observation?: Promise<{ok: boolean; value: unknown}>; finished: boolean}[];
    prepared: boolean; uncertain: boolean; workerRetired: boolean; cleanupAttempted: boolean;
    storage?: BoundedLocalTrainingModelCopyStoragePort; context: ApplicationRequestContext}};
const sourcePreparationPromise = Promise, sourcePreparationPromisePrototype = Promise.prototype;
const sourcePreparationAsyncPrototype = Object.getPrototypeOf(async function originalSourcePreparation() {});

export function createPythonRuntimeAdapterFoundation(
  options: CreatePythonRuntimePortOptions,
): PythonRuntimeAdapterFoundation {
  const generateAuthorizationToken =
    options.generateAuthorizationToken ??
    (() => randomBytes(32).toString("base64url"));
  let authorizationToken = generateAuthorizationToken();
  const assertStrongToken = (token: string): string => {
    if (token.trim().length < 32) {
      throw new TypeError(
        "Python runtime launch authentication token must contain at least 32 characters.",
      );
    }
    return token.trim();
  };
  authorizationToken = assertStrongToken(authorizationToken);
  const clientBaseUrl = normalizePythonRuntimeLoopbackBaseUrl(options.client.baseUrl);
  const endpoint = resolvePythonRuntimeLoopbackEndpoint({env: options.supervisor.env ?? {}, defaultPort: new URL(clientBaseUrl).port});
  if (endpoint.baseUrl !== clientBaseUrl) throw new TypeError("Python runtime worker and client endpoints must match.");
  const runtimeEnvironment: NodeJS.ProcessEnv = {
    ...(options.supervisor.env ?? {}),
    PYTHON_RUNTIME_HOST: endpoint.host,
    PYTHON_RUNTIME_PORT: endpoint.port,
  };
  let hostAdmission: (() => void) | undefined;
  const assertHostAccepting = () => {
    const result: unknown = hostAdmission?.();
    if (result !== undefined) {
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      throw new Error("Python host admission must be synchronous.");
    }
  };
  const bindHostAdmission = (assertAccepting: () => void) => {
    if (hostAdmission || typeof assertAccepting !== "function") throw new Error("Python host admission is already bound or invalid.");
    hostAdmission = assertAccepting;
  };
  let ownedLaunch: object | undefined;
  const modelSourceCacheRoot = resolveConfiguredModelCacheRoot(runtimeEnvironment);
  // Canonicalize the captured host selection for Worker helpers and official SDKs.
  runtimeEnvironment.HF_HUB_CACHE = modelSourceCacheRoot;
  const client = createPythonRuntimeHttpClient({
    ...options.client,
    baseUrl: clientBaseUrl,
    environment: runtimeEnvironment,
    authorizationTokenProvider: () => authorizationToken,
    captureProcessOwnership() {
      const captured = ownedLaunch;
      const assertCurrent = () => {
        if (!captured || captured !== ownedLaunch) throw new Error("Python runtime process ownership is unavailable.");
      };
      assertCurrent();
      return assertCurrent;
    },
  });
  const trackedTasks = new Map<
    string,
    { taskType: string; deadline: number; sourceReceiver?: ModelSourceRecipient }
  >();
  // Original reservations survive worker exit, failed startup, and lost replies.
  // Their release is owned exclusively by permanent original session retirement.
  const trainingReservations = new Map<string, OriginalFoundationTrainingReservation>();
  let directModelDownloads = 0;
  const trainingCustodyLive = () => [...trainingReservations.values()].some(value => !value.settled);
  // A disconnected POST can already have started non-cancellable Dataset work.
  // Retain only identity/lifecycle facts, never request payloads, until proven done.
  const datasetAdmissions = new Map<string, {
    epoch: number;
    phase: "pending" | "accepted" | "uncertain";
  }>();
  const assertInstalledScope = (admission: {workspaceId?: string; organizationId?: string}, result: {metadata?: Record<string, unknown>}) => {
    if ((result.metadata?.workspaceId !== undefined && result.metadata.workspaceId !== admission.workspaceId) ||
        (result.metadata?.organizationId !== undefined && result.metadata.organizationId !== admission.organizationId))
      throw new Error("Installed-only Python task scope identity was not confirmed.");
  };
  const maximumDatasetAdmissions = 256;
  const installedContextAdmissions = new Map<string, {
    epoch: number;
    taskType: "generate-context-artifact" | "context-artifact-operation";
    phase: "pending" | "accepted" | "uncertain";
    workspaceId?: string;
    organizationId?: string;
  }>();
  let recoveryInFlight: Promise<boolean> | undefined;
  let recoveryUncertain = false;
  const terminalOverrides = new Map<string, PythonRuntimeTaskStatusResult>();
  const maximumRetainedOverrides = 256;
  const rememberOverride = (
    requestId: string,
    record: PythonRuntimeTaskStatusResult,
  ) => {
    terminalOverrides.delete(requestId);
    terminalOverrides.set(requestId, record);
    while (terminalOverrides.size > maximumRetainedOverrides) {
      const oldest = terminalOverrides.keys().next().value;
      if (typeof oldest !== "string") break;
      terminalOverrides.delete(oldest);
    }
  };
  let ownedExitEpoch = 0;
  const rememberOwnedExit = (requestId: string, taskType: string) => {
    const completedAt = new Date().toISOString();
    rememberOverride(requestId, {
      requestId, taskType, status: "failed",
      error: {
        code: "python_runtime_worker_exited",
        message: "Python runtime worker stopped before the task completed.",
        retryable: true,
      },
      completedAt, updatedAt: completedAt,
      metadata: { recovery: "worker-exited" },
    });
  };
  // Capture all effective controls before reading the new optional observer.
  // In particular its getter must not mutate an aliased args/capability list.
  const supervisorDescriptors = Object.getOwnPropertyDescriptors(options.supervisor);
  delete supervisorDescriptors.onStartupEvent;
  const supervisorInputs = { ...Object.defineProperties({}, supervisorDescriptors) } as CreatePythonRuntimePortOptions["supervisor"];
  if (supervisorInputs.args) supervisorInputs.args = [...supervisorInputs.args];
  if (supervisorInputs.requiredCapabilities) supervisorInputs.requiredCapabilities = [...supervisorInputs.requiredCapabilities];
  if (supervisorInputs.nativeWorkerResourceProfile !== undefined)
    supervisorInputs.nativeWorkerResourceProfile = captureOriginalWorkerResourceProfile(supervisorInputs.nativeWorkerResourceProfile);
  const hasNativeTrainingConfiguration = supervisorInputs.nativeWorkerResourceProfile !== undefined;
  const spawnWorker = supervisorInputs.spawnImplementation ?? spawn;
  const verifyEnvironment = supervisorInputs.verifyRuntimeEnvironment;
  const prepareEnvironment = supervisorInputs.prepareRuntimeEnvironment;
  let startupObserver: CreatePythonRuntimePortOptions["supervisor"]["onStartupEvent"];
  try { const observer = options.supervisor.onStartupEvent; if (typeof observer === "function") startupObserver = observer; } catch { /* Passive observer. */ }
  const supervisor = createPythonRuntimeSupervisor({
    ...supervisorInputs,
    onStartupEvent: startupObserver,
    env: runtimeEnvironment,
    spawnImplementation: ((...args: Parameters<typeof spawn>) => {
      assertHostAccepting();
      return spawnWorker(...args);
    }) as typeof spawn,
    verifyRuntimeEnvironment: verifyEnvironment ? async context => {
      assertHostAccepting(); const verified = await verifyEnvironment(context); assertHostAccepting(); return verified;
    } : undefined,
    prepareRuntimeEnvironment: prepareEnvironment ? async context => {
      assertHostAccepting(); await prepareEnvironment(context); assertHostAccepting();
    } : undefined,
    prepareLaunchEnvironment: (context) => {
      assertHostAccepting();
      authorizationToken = assertStrongToken(generateAuthorizationToken());
      context.env.PYTHON_RUNTIME_AUTH_TOKEN = authorizationToken;
    },
    runtimeClient: client,
    requireOwnedStartupProof: true,
    assertHostCurrent: assertHostAccepting,
    onEvent: (event) => {
      if (["start-requested", "startup-timeout", "process-exit", "process-error", "stop-requested", "stop-complete"].includes(event.type)) ownedLaunch = undefined;
      if (event.type === "owned-ready") ownedLaunch = {};
      // The supervisor emits this only for its currently owned process handle.
      // HTTP uncertainty and events from a previous generation cannot supply it.
      if (event.type === "process-exit") {
        ownedExitEpoch++;
        for (const [requestId, tracked] of trackedTasks) {
          if (tracked.sourceReceiver) tracked.sourceReceiver.retainUncertainty();
          else rememberOwnedExit(requestId, tracked.taskType);
        }
        for (const requestId of datasetAdmissions.keys()) {
          if (!terminalOverrides.has(requestId)) {
            rememberOwnedExit(requestId, "prepare-training-dataset");
          }
        }
        for (const [requestId, admission] of installedContextAdmissions) {
          if (!terminalOverrides.has(requestId)) rememberOwnedExit(requestId, admission.taskType);
        }
        datasetAdmissions.clear();
        installedContextAdmissions.clear();
        for (const [requestId, tracked] of trackedTasks) if (!tracked.sourceReceiver) trackedTasks.delete(requestId);
        recoveryUncertain = false;
      }
      if (event.type === "health-ready") recoveryUncertain = false;
      options.supervisor.onEvent?.(event);
    },
  });
  const boundedTaskTimeout = (request: StartPythonRuntimeTaskRequest) =>
    Math.min(
      Math.max(
        request.timeoutMs ?? options.client.defaultTaskTimeoutMs ?? 120_000,
        1_000,
      ),
      24 * 60 * 60 * 1_000,
    );
  const assertReplyIdentity = (
    requestId: string,
    reply: {requestId: string; taskType?: string},
    taskType = trackedTasks.get(requestId)?.taskType,
  ) => {
    if (reply.requestId !== requestId ||
        (taskType && reply.taskType !== undefined && reply.taskType !== taskType)) {
      throw new Error("Python runtime task response identity did not match the accepted request.");
    }
  };
  const recoverWorker = async (
    targetRequestId: string | undefined,
    targetStatus: "cancelled" | "failed",
  ) => {
    if (trainingCustodyLive() || datasetAdmissions.size || [...trackedTasks.values()].some(value => value.sourceReceiver)) return false;
    if (recoveryInFlight) return recoveryInFlight;
    if (recoveryUncertain) throw new Error("Python runtime recovery has not been confirmed.");
    const recoveringTasks = [...trackedTasks];
    // Capture policy before the owned stop clears task/admission maps. One
    // restrictive owner makes shared recovery noninstalling for this flight.
    const installedOnlyRecovery = installedContextAdmissions.size > 0;
    const startInstalled = supervisor.startWithoutInstalling?.bind(supervisor);
    // Publish the flight before stop/start can yield or emit lifecycle events.
    const operation = Promise.resolve().then(async () => {
      if (installedOnlyRecovery) {
        if (!startInstalled) throw new Error("Installed-only Python recovery is unavailable.");
        await supervisor.stop();
        await startInstalled();
      } else await supervisor.restart();
      const completedAt = new Date().toISOString();
      for (const [requestId, tracked] of recoveringTasks) {
        const retained = terminalOverrides.get(requestId);
        // A real terminal response observed before exit remains authoritative.
        if (retained && retained.error?.code !== "python_runtime_worker_exited") continue;
        const isTarget = requestId === targetRequestId;
        rememberOverride(requestId, {
          requestId,
          taskType: tracked.taskType,
          status: isTarget ? targetStatus : "failed",
          error:
            isTarget && targetStatus === "cancelled"
              ? undefined
              : {
                  code: isTarget
                    ? "python_runtime_task_timeout"
                    : "python_runtime_worker_restarted",
                  message: isTarget
                    ? "Python runtime task exceeded its execution deadline."
                    : "Python runtime task stopped during worker recovery.",
                  retryable: true,
                },
          completedAt,
          updatedAt: completedAt,
          metadata: { recovery: "worker-restarted" },
        });
        trackedTasks.delete(requestId);
      }
      return true;
    }).catch(error => {
      // A rejected stop/start is not proof that dispatch is safe again.
      recoveryUncertain = true;
      throw error;
    });
    recoveryInFlight = operation;
    try { return await operation; }
    finally { if (recoveryInFlight === operation) recoveryInFlight = undefined; }
  };
  const assertAdmissionAvailable = () => {
    if (trainingCustodyLive() || recoveryInFlight || recoveryUncertain) {
      throw new Error("Python runtime recovery is not complete. Retry after the runtime is ready.");
    }
  };

  const startTask = async (original: StartPythonRuntimeTaskRequest, installedOnly = false): Promise<StartPythonRuntimeTaskResult> => {
      const request = {...original, ...(original.metadata ? {metadata: {...original.metadata}} : {})};
      if (installedOnly && !hostAdmission) throw new Error("Installed-only Python host admission is unavailable.");
      assertHostAccepting();
      assertAdmissionAvailable();
      if (installedOnly && (request.taskType !== "generate-context-artifact" && request.taskType !== "context-artifact-operation"))
        throw new Error("Installed-only Python task type is unavailable.");
      if (installedOnly && ((request.metadata?.workspaceId !== undefined && !isWorkspaceId(request.metadata.workspaceId)) ||
          (request.metadata?.organizationId !== undefined && (typeof request.metadata.organizationId !== "string" || !request.metadata.organizationId.trim()))))
        throw new Error("Installed-only Python task scope is unavailable.");
      if (typeof request.requestId !== "string" || request.requestId.length > 128) {
        throw new TypeError("Python runtime task identifier exceeds its retention bound.");
      }
      // Match the HTTP client's canonical grammar before retaining an owner:
      // a locally rejected identifier cannot have reached the worker.
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId)) {
        throw new TypeError("Python runtime task identifier is invalid.");
      }
      if (datasetAdmissions.has(request.requestId) || installedContextAdmissions.has(request.requestId) || trackedTasks.has(request.requestId) || terminalOverrides.has(request.requestId)) {
        throw new Error("Python runtime task is already known. Read its current status before retrying.");
      }
      const admissionEpoch = ownedExitEpoch;
      const installedAdmission = installedOnly ? {epoch: admissionEpoch,
        taskType: request.taskType as "generate-context-artifact" | "context-artifact-operation",
        workspaceId: request.metadata?.workspaceId as string | undefined,
        organizationId: request.metadata?.organizationId as string | undefined,
        phase: "pending" as "pending" | "accepted" | "uncertain"} : undefined;
      if (installedAdmission) {
        if (installedContextAdmissions.size >= maximumDatasetAdmissions)
          throw new Error("Installed-only Python task admission capacity is unavailable.");
        installedContextAdmissions.set(request.requestId, installedAdmission);
      }
      const admission = request.taskType === "prepare-training-dataset"
        ? { epoch: admissionEpoch, phase: "pending" as "pending" | "accepted" | "uncertain" }
        : undefined;
      if (admission) {
        if (datasetAdmissions.size >= maximumDatasetAdmissions) {
          throw new Error("Python runtime task admission capacity is unavailable. Reconcile existing tasks before retrying.");
        }
        datasetAdmissions.set(request.requestId, admission);
      }
      // Reserve the original existing tracker before POST. A held ordinary ACK
      // must neither admit a same-ID source nor replace a later original owner.
      const tracker = {taskType: request.taskType, deadline: Date.now() + boundedTaskTimeout(request)};
      trackedTasks.set(request.requestId, tracker);
      try {
        const result = await client.startTask(request);
        assertReplyIdentity(request.requestId, result, request.taskType);
        if (installedAdmission) assertInstalledScope(installedAdmission, result);
        if (installedAdmission && (result.taskType !== request.taskType || result.accepted !== true ||
            (result.status !== "queued" && result.status !== "running")))
          throw new Error("Installed-only Python task acceptance was not confirmed.");
        if (admissionEpoch !== ownedExitEpoch) {
          if (!trackedTasks.has(request.requestId) && !terminalOverrides.has(request.requestId)) rememberOwnedExit(request.requestId, request.taskType);
        } else if (trackedTasks.get(request.requestId) !== tracker || (admission && datasetAdmissions.get(request.requestId) !== admission) ||
                   (installedAdmission && installedContextAdmissions.get(request.requestId) !== installedAdmission)) {
          // An exact terminal read/cancellation can beat the POST acknowledgement.
          return result;
        } else {
          if (admission) admission.phase = "accepted";
          if (installedAdmission) installedAdmission.phase = "accepted";
          terminalOverrides.delete(request.requestId);
          trackedTasks.set(request.requestId, tracker);
        }
        return result;
      } catch (error) {
        if (admissionEpoch !== ownedExitEpoch && !trackedTasks.has(request.requestId) && !terminalOverrides.has(request.requestId)) {
          rememberOwnedExit(request.requestId, request.taskType);
        }
        if (admission && datasetAdmissions.get(request.requestId) === admission) admission.phase = "uncertain";
        if (installedAdmission && installedContextAdmissions.get(request.requestId) === installedAdmission) installedAdmission.phase = "uncertain";
        // Preserve the established ordinary failed-start policy. This frame has
        // finished; it may remove only its own reservation, never a replacement.
        // Dataset/installed-only unknown admissions keep their existing guards.
        if (!admission && !installedAdmission && trackedTasks.get(request.requestId) === tracker) trackedTasks.delete(request.requestId);
        throw error;
      }
  };

  const runtimePort: PythonRuntimePort = {
    startTask: request => startTask(request),
    startTaskWithoutInstalling: typeof supervisorInputs.verifyRuntimeEnvironment === "function"
      ? request => startTask(request, true) : undefined,
    readTaskStatus: async (requestId) => {
      if (trackedTasks.get(requestId)?.sourceReceiver) throw new Error("Use the captured model source job to read its status.");
      const override = terminalOverrides.get(requestId);
      if (override) return override;
      const tracked = trackedTasks.get(requestId);
      const admission = datasetAdmissions.get(requestId);
      const installedAdmission = installedContextAdmissions.get(requestId);
      const observationEpoch = ownedExitEpoch;
      // Dataset Preparation cannot be force-cancelled. A sibling's recovery
      // cannot kill its shared worker either; keep observing actual state.
      const datasetWorkOwned = datasetAdmissions.size > 0;
      if (tracked && Date.now() >= tracked.deadline && !datasetWorkOwned && !recoveryUncertain) {
        await recoverWorker(requestId, "failed");
        const recovered = terminalOverrides.get(requestId);
        if (recovered) return recovered;
      }
      const status = await client.readTaskStatus(requestId).catch(error => {
        const exited = terminalOverrides.get(requestId);
        if (exited) return exited;
        throw error;
      });
      const afterReadOverride = terminalOverrides.get(requestId);
      if (afterReadOverride) return afterReadOverride;
      if (observationEpoch !== ownedExitEpoch ||
          trackedTasks.get(requestId) !== tracked || datasetAdmissions.get(requestId) !== admission ||
          installedContextAdmissions.get(requestId) !== installedAdmission) {
        throw new Error("Python runtime task observation is no longer current.");
      }
      assertReplyIdentity(requestId, status, admission ? "prepare-training-dataset" : tracked?.taskType);
      if (installedAdmission && status.taskType !== installedAdmission.taskType)
        throw new Error("Installed-only Python task response identity was not confirmed.");
      if (installedAdmission) assertInstalledScope(installedAdmission, status);
      if (admission && admission.phase !== "accepted" && status.taskType !== "prepare-training-dataset") {
        throw new Error("Python runtime task response identity did not match the pending request.");
      }
      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        if (tracked || admission || installedAdmission) rememberOverride(requestId, status);
        trackedTasks.delete(requestId);
        datasetAdmissions.delete(requestId);
        installedContextAdmissions.delete(requestId);
      }
      return status;
    },
    cancelTask: async (requestId): Promise<CancelPythonRuntimeTaskResult> => {
      if (trackedTasks.get(requestId)?.sourceReceiver) throw new Error("Use the captured model source job to request cancellation.");
      const override = terminalOverrides.get(requestId);
      if (override) {
        return {
          requestId,
          taskType: override.taskType,
          status: override.status,
          cancelled: override.status === "cancelled",
          message:
            override.status === "cancelled"
              ? "Task is already cancelled."
              : "Task is no longer cancellable.",
          metadata: override.metadata,
        };
      }
      const tracked = trackedTasks.get(requestId);
      const admission = datasetAdmissions.get(requestId);
      const installedAdmission = installedContextAdmissions.get(requestId);
      const observationEpoch = ownedExitEpoch;
      let result: CancelPythonRuntimeTaskResult;
      try { result = await client.cancelTask(requestId); }
      catch (error) {
        const terminal = terminalOverrides.get(requestId);
        if (!terminal) throw error;
        return { requestId, taskType: terminal.taskType, status: terminal.status,
          cancelled: terminal.status === "cancelled" };
      }
      const afterCancelOverride = terminalOverrides.get(requestId);
      if (afterCancelOverride) {
        return { requestId, taskType: afterCancelOverride.taskType,
          status: afterCancelOverride.status,
          cancelled: afterCancelOverride.status === "cancelled" };
      }
      if (observationEpoch !== ownedExitEpoch ||
          trackedTasks.get(requestId) !== tracked || datasetAdmissions.get(requestId) !== admission ||
          installedContextAdmissions.get(requestId) !== installedAdmission) {
        throw new Error("Python runtime task observation is no longer current.");
      }
      assertReplyIdentity(requestId, result, admission ? "prepare-training-dataset" : tracked?.taskType);
      if (installedAdmission && result.taskType !== installedAdmission.taskType)
        throw new Error("Installed-only Python cancellation identity was not confirmed.");
      if (installedAdmission) assertInstalledScope(installedAdmission, result);
      if (admission && admission.phase !== "accepted" && result.taskType !== "prepare-training-dataset") {
        throw new Error("Python runtime task response identity did not match the pending request.");
      }
      if (result.cancelled !== (result.status === "cancelled")) {
        throw new Error("Python runtime cancellation response is inconsistent.");
      }
      if (result.cancelled || result.status === "cancelled") {
        if (tracked || admission || installedAdmission) rememberOverride(requestId, {
          requestId, taskType: result.taskType ?? tracked?.taskType ?? "prepare-training-dataset", status: "cancelled",
          completedAt: new Date().toISOString(), metadata: result.metadata,
        });
        trackedTasks.delete(requestId);
        datasetAdmissions.delete(requestId);
        installedContextAdmissions.delete(requestId);
        return result;
      }
      if (result.status === "running" && trackedTasks.has(requestId)
          && !datasetAdmissions.size && !recoveryUncertain) {
        await recoverWorker(requestId, "cancelled");
        const terminal = terminalOverrides.get(requestId);
        if (!terminal) return result;
        return {
          requestId,
          taskType: terminal.taskType,
          status: terminal.status,
          cancelled: terminal.status === "cancelled",
          metadata: terminal.metadata,
        };
      }
      return result;
    },
    getHealthStatus: () => client.getHealthStatus(),
    getCapabilities: () => client.getCapabilities(),
    ensureModelDownloaded: async (request) => {
      directModelDownloads++;
      try {
        assertAdmissionAvailable();
        return await client.ensureModelDownloaded(request);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("model download timed out")
        ) {
          await recoverWorker(undefined, "failed");
        }
        throw error;
      } finally {directModelDownloads--;}
    },
    resolveModelDownloadTaskResult: (payload, expectedManifest) =>
      client.resolveModelDownloadTaskResult(payload, expectedManifest),
    getModelStatus: () => client.getModelStatus(),
    unloadModels: async () => {assertAdmissionAvailable(); return client.unloadModels();},
  };

  const createTrainingPort = (rawProfile?: OriginalTrainingProfile, rawObservation?: OriginalTrainingModelObservationPolicy,
    sourceReservation?: OriginalTrainingSourceReservationFactory, rawExitConfiguration?: OriginalTrainingExitConfiguration,
    localConfiguration?: OriginalBoundedLocalTrainingConfiguration): ApprovedLocalModelTrainingPort => {
      let exitConfiguration: OriginalTrainingExitConfiguration | undefined;
      if (rawExitConfiguration !== undefined) {
        if (!rawExitConfiguration || types.isProxy(rawExitConfiguration)) throw new Error("Original training retirement configuration is unavailable.");
        const row = readStrictPassiveRecord(rawExitConfiguration, ["retirementProtocol", "createOutputStorage"]);
        if (Object.keys(row).length !== 2 || row.retirementProtocol !== "original-exit-ready-v1" ||
            typeof row.createOutputStorage !== "function" || types.isProxy(row.createOutputStorage))
          throw new Error("Original training retirement configuration is unavailable.");
        const factory = row.createOutputStorage as OriginalTrainingExitConfiguration["createOutputStorage"];
        exitConfiguration = Object.freeze({retirementProtocol: "original-exit-ready-v1",
          createOutputStorage: (original: OriginalTrainingCapture) => Reflect.apply(factory, rawExitConfiguration, [original])});
      }
      if (rawProfile === undefined || !hasNativeTrainingConfiguration) return Object.freeze({createSession: () => undefined});
      if (sourceReservation !== undefined && (typeof sourceReservation !== "function" || types.isProxy(sourceReservation) || rawObservation === undefined))
        throw new Error("Original Model source reservation is unavailable.");
      const asyncSourceReservation = sourceReservation !== undefined && types.isAsyncFunction(sourceReservation);
      if (asyncSourceReservation && (types.isGeneratorFunction(sourceReservation!)
          || Object.getPrototypeOf(sourceReservation) !== sourcePreparationAsyncPrototype))
        throw new Error("Original Model source preparation is unavailable.");
      const profile = captureTrainingProfile(rawProfile);
      const sourceFactory = rawObservation === undefined ? undefined : createOriginalTrainingModelSourceFactory(rawObservation);
      // The already validated explicit observation bound also bounds private
      // async reservation setup. Capture its scalar before any caller wait.
      const sourcePreparationMs = rawObservation === undefined ? 0 : readStrictPassiveRecord(rawObservation,
        ["allowedRootDirectories", "maximumTotalBytes", "maximumDurationMs", "bufferBytes"]).maximumDurationMs as number;
      const startInstalled = supervisor.startWithoutInstalling?.bind(supervisor);
      const captureRetirement = supervisor.captureOriginalTrainingWorkerRetirement?.bind(supervisor);
      const captureOriginal = client.captureOriginalTrainingChannel.bind(client);
      return createOriginalTrainingPort({
        ...(localConfiguration ? {storageProfile: "bounded-local-v1" as const} : {}),
        ...(exitConfiguration ?? {}),
        reserve(capture) {
          const requestId = capture.definition.requestId;
          if (!hostAdmission || trainingCustodyLive() || trainingReservations.has(requestId) || trainingReservations.size >= 256 ||
              directModelDownloads || trackedTasks.size || datasetAdmissions.size || installedContextAdmissions.size || recoveryInFlight || recoveryUncertain)
            return undefined;
          // Binding has no IO. A configured missing reader refuses before the
          // original slot is reserved, with no presence/discovery fallback.
          const source = sourceFactory?.bind(capture);
          if (sourceFactory && !source) return undefined;
          const original: OriginalFoundationTrainingReservation = {settled: false, capture, source};
          trainingReservations.set(requestId, original);
          try {assertHostAccepting();} catch (error) {
            original.settled = true; // No preparation/IO was issued by this reservation.
            throw error;
          }
          return () => {
            if (trainingReservations.get(requestId) !== original) throw new Error("Original training retirement is unavailable.");
            if (original.source && !original.source.isSettled()) throw new Error("Original training source IO is still retained.");
            if (original.sourcePreparation && (!original.sourcePreparation.returned || !original.sourcePreparation.confirmed || original.sourcePreparation.uncertain))
              throw new Error("Original training source preparation is still retained.");
            if (original.local && (!original.local.workerRetired || !original.local.cleanupAttempted || original.local.uncertain
                || original.local.calls.some(call => !call.finished)))
              throw new Error("Original local Model copy is still retained.");
            original.settled = true;
          };
        },
        async captureChannel(capture) {
          const requestId = capture.definition.requestId, reservation = trainingReservations.get(requestId);
          const requestCurrent = capture.assertCurrent.bind(capture), requestAllowed = capture.assertAllowed.bind(capture);
          const currentCapture = () => {
            if (!reservation || reservation.settled || reservation.capture !== capture || trainingReservations.get(requestId) !== reservation)
              throw new Error("Original training reservation is unavailable.");
            requestCurrent(); assertHostAccepting(); requestCurrent();
          };
          const allowedCapture = async () => {currentCapture(); await requestAllowed(); currentCapture();};
          currentCapture();
          if (!startInstalled || !captureRetirement) throw new Error("Installed-only training startup is unavailable.");
          if (reservation!.source) {
            // The actual observation owner is retained in the original slot
            // before this first IO await. An unknown reply cannot release it.
            reservation!.observed = await reservation!.source.observe();
            currentCapture();
            if (!reservation!.source.isSettled()) throw new Error("Original training source IO is still retained.");
          }
          let localModelCopy: OriginalTrainingOwnedChannel["localModelCopy"];
          if (localConfiguration) {
            if (!reservation!.observed) throw new Error("Original local Model observation is unavailable.");
            const definition = capture.definition;
            const organizationId = definition.owner.organizationId;
            if (!isOrganizationId(organizationId)) throw new Error("Original local Model organization is unavailable.");
            const context: ApplicationRequestContext = Object.freeze({requestId: definition.requestId, workspaceId: definition.workspaceId,
              organizationId, principalId: definition.owner.principalId});
            const local = reservation!.local = {calls: [], prepared: false, uncertain: false, workerRetired: false,
              cleanupAttempted: false, context} as NonNullable<OriginalFoundationTrainingReservation["local"]>;
            const preparationDeadline = Date.now() + Math.min(localConfiguration.observation.maximumDurationMs,
              localConfiguration.startupProfile.maximumDurationSeconds * 1000);
            const invoke = async <T>(kind: typeof local.calls[number]["kind"], operation: () => Promise<T>): Promise<T> => {
              // Invalid results already exist. Always attach their safe
              // rejection observer even after the preparation budget expired.
              const deadline = kind === "discard" || kind.startsWith("invalid-")
                ? Date.now() + localConfiguration.observation.maximumDurationMs : preparationDeadline;
              if (local.calls.length >= 5 || Date.now() >= deadline) {local.uncertain = true; throw new Error("Original local Model operation limit reached.");}
              const call: typeof local.calls[number] = {kind, finished: false}; local.calls.push(call);
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                const original = operation(); call.original = original;
                if (!types.isPromise(original) || types.isProxy(original) || Object.getPrototypeOf(original) !== sourcePreparationPromisePrototype
                    || Object.getOwnPropertyDescriptor(original, "constructor") !== undefined
                    || Object.getOwnPropertyDescriptor(sourcePreparationPromisePrototype, "constructor")?.value !== sourcePreparationPromise)
                  throw new Error();
                call.observation = (async () => {
                  try {return {ok: true, value: await original};}
                  catch {return {ok: false, value: undefined};}
                  finally {call.finished = true;}
                })();
                if (Object.getOwnPropertyDescriptor(original, "then") !== undefined) throw new Error();
                const result = await Promise.race([call.observation, new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {local.uncertain = true; reject(new Error());}, Math.max(1, deadline - Date.now()));
                })]);
                if (!result.ok) throw new Error();
                return result.value as T;
              } catch {local.uncertain = true; throw new Error("Original local Model storage is unavailable.");}
              finally {if (timer) clearTimeout(timer);}
            };
            const control = Object.freeze({assertCurrent: currentCapture, assertAllowed: allowedCapture,
              async assertCleanupAllowed() {
                if (!local.workerRetired || !local.cleanupAttempted || trainingReservations.get(requestId) !== reservation || reservation!.settled
                    || local.calls.some(call => !call.finished && call.kind !== "discard")
                    || local.calls.filter(call => !call.finished && call.kind === "discard").length !== 1)
                  throw new Error("Original local Model cleanup is unavailable.");
              }});
            try {
              // The genuine existing observer's Native ABI uses bare hex.
              // The local storage/worker contract uses an algorithm-qualified
              // digest. Translate only the encoding, never source authority.
              const source: BoundedLocalTrainingModelSource = Object.freeze({...reservation!.observed,
                files: Object.freeze(reservation!.observed.files.map(row => {
                  if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error();
                  return Object.freeze({...row, sha256: "sha256:" + row.sha256});
                }))});
              const supplied = localConfiguration.createModelCopy(Object.freeze({definition, source, context, control}));
              local.owner = supplied; // Before reading properties or invoking preparation.
              if (types.isPromise(supplied)) {void invoke("invalid-factory", () => supplied).catch(() => {}); throw new Error();}
              if (!supplied || typeof supplied !== "object" || types.isProxy(supplied) || types.isPromise(supplied)) throw new Error();
              const row = readStrictPassiveRecord(supplied, ["profile", "identity", "prepare", "modelDirectory", "fence", "inspect", "discard"]);
              if (Object.keys(row).length !== 7 || row.profile !== "bounded-local-v1"
                  || ["prepare", "modelDirectory", "fence", "inspect", "discard"].some(key => typeof row[key] !== "function" || types.isProxy(row[key])))
                throw new Error();
              if (!row.identity || typeof row.identity !== "object" || types.isProxy(row.identity)) throw new Error();
              const identity = readStrictPassiveRecord(row.identity, ["requestId", "workspaceId", "modelRecordId", "modelUpdatedAt"]);
              if (Object.keys(identity).length !== 4 || identity.requestId !== requestId || identity.workspaceId !== definition.workspaceId
                  || identity.modelRecordId !== reservation!.observed.modelRecordId || identity.modelUpdatedAt !== reservation!.observed.modelUpdatedAt) throw new Error();
              local.storage = Object.freeze({profile: "bounded-local-v1", identity: Object.freeze({requestId, workspaceId: definition.workspaceId,
                modelRecordId: reservation!.observed.modelRecordId, modelUpdatedAt: reservation!.observed.modelUpdatedAt}),
                prepare: () => invoke<void>("prepare", () => Reflect.apply(row.prepare as Function, supplied, [context])),
                modelDirectory: () => invoke<string>("locator", () => Reflect.apply(row.modelDirectory as Function, supplied, [context])),
                fence: () => {
                  const result: unknown = Reflect.apply(row.fence as Function, supplied, []);
                  if (types.isPromise(result)) {
                    void invoke("invalid-fence", () => result).catch(() => {}); local.uncertain = true; throw new Error();
                  }
                  if (result !== undefined) {local.uncertain = true; throw new Error();}
                },
                inspect: () => {
                  const value: unknown = Reflect.apply(row.inspect as Function, supplied, []);
                  if (types.isPromise(value)) {
                    void invoke("invalid-inspect", () => value).catch(() => {}); local.uncertain = true; throw new Error();
                  }
                  if (!value || typeof value !== "object" || types.isProxy(value)) throw new Error();
                  const observed = readStrictPassiveRecord(value, ["phase", "fenced", "pendingOperations", "sourceHandlesOpen", "destinationIoClosed",
                    "fileCount", "declaredBytes", "preparationFinished", "physicalQuotaEnforced"]);
                  if (Object.keys(observed).length !== 9 || !["bound", "preparing", "ready", "unconfirmed", "discarded"].includes(observed.phase as string)
                      || ["fenced", "destinationIoClosed", "preparationFinished"].some(key => typeof observed[key] !== "boolean")
                      || ["pendingOperations", "sourceHandlesOpen", "fileCount", "declaredBytes"].some(key =>
                        typeof observed[key] !== "number" || !Number.isSafeInteger(observed[key]) || (observed[key] as number) < 0)
                      || observed.physicalQuotaEnforced !== false) throw new Error();
                  return Object.freeze(observed) as unknown as ReturnType<BoundedLocalTrainingModelCopyStoragePort["inspect"]>;
                },
                discard: () => invoke<boolean>("discard", () => Reflect.apply(row.discard as Function, supplied, [context]))}) as BoundedLocalTrainingModelCopyStoragePort;
              await allowedCapture();
              const prepared: unknown = await local.storage.prepare(context);
              if (prepared !== undefined) throw new Error();
              currentCapture();
              const directory = await local.storage.modelDirectory(context); currentCapture();
              const relative = path.relative(localConfiguration.startupProfile.stagingRoot, directory);
              if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error();
              const reader = captureOriginalTrainingModelReader(capture);
              if (!reader) throw new Error();
              const selected = await invoke("selection", () => reader.readModelSelection()); currentCapture();
              if (selected.modelRecordId !== reservation!.observed.modelRecordId || selected.modelUpdatedAt !== reservation!.observed.modelUpdatedAt
                  || selected.localModelReference !== reservation!.observed.logicalPath) throw new Error();
              const state = local.storage.inspect();
              if (state.phase !== "ready" || state.fenced !== false || state.pendingOperations !== 0 || state.sourceHandlesOpen !== 0
                  || state.destinationIoClosed !== true || state.preparationFinished !== true || state.physicalQuotaEnforced !== false
                  || state.fileCount !== reservation!.observed.files.length
                  || state.declaredBytes !== reservation!.observed.files.reduce((sum, row) => sum + row.sizeBytes, 0)
                  || local.calls.some(call => !call.finished)) throw new Error();
              localModelCopy = Object.freeze({modelRecordId: selected.modelRecordId, modelUpdatedAt: selected.modelUpdatedAt,
                directory, files: source.files});
              local.prepared = true;
            } catch {local.uncertain = true; throw new Error("Original local Model preparation is unavailable.");}
          }
          let originalModelSource: OriginalTrainingSourceLaunch | undefined;
          if (sourceReservation) {
            if (!reservation!.observed) throw new Error("Original Model source observation is unavailable.");
            await allowedCapture();
            const preparation: OriginalSourcePreparation = {returned: false, confirmed: false, uncertain: false};
            reservation!.sourcePreparation = preparation; // Own before the callback can perform IO or reenter.
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              const deadline = Date.now() + sourcePreparationMs;
              const supplied = sourceReservation(capture, reservation!.observed);
              let owner: OriginalTrainingSourceReservation;
              if (types.isPromise(supplied)) {
                preparation.pending = supplied;
                if (Object.getPrototypeOf(supplied) !== sourcePreparationPromisePrototype
                    || Object.getOwnPropertyDescriptor(supplied, "constructor") !== undefined
                    || Object.getOwnPropertyDescriptor(sourcePreparationPromisePrototype, "constructor")?.value !== sourcePreparationPromise)
                  throw new Error("Original Model source preparation is unavailable.");
                const observed = (async () => {
                  try {const value = await supplied; preparation.owner = value; preparation.returned = true; return {ok: true, value};}
                  catch {preparation.returned = true; return {ok: false};}
                })();
                preparation.observation = observed; // Retain actual settlement, even after the outward timer.
                if (!asyncSourceReservation || Object.getOwnPropertyDescriptor(supplied, "then") !== undefined)
                  throw new Error("Original Model source preparation is unavailable.");
                const result = await Promise.race([observed, new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(() => {preparation.uncertain = true; reject(new Error("Original Model source preparation is unavailable."));},
                    Math.max(1, deadline - Date.now()));
                })]);
                if (!result.ok || preparation.uncertain || Date.now() >= deadline)
                  throw new Error("Original Model source preparation is unavailable.");
                owner = result.value as OriginalTrainingSourceReservation;
              } else {owner = supplied; preparation.owner = owner; preparation.returned = true;}
              reservation!.sourceReservation = owner; // Before any owner-property callback or permission wait.
              await allowedCapture();
              if (asyncSourceReservation) {
                const reader = captureOriginalTrainingModelReader(capture);
                if (!reader) throw new Error("Original Model source preparation is unavailable.");
                const selected = await reader.readModelSelection(); currentCapture();
                if (selected.modelRecordId !== reservation!.observed.modelRecordId
                    || selected.modelUpdatedAt !== reservation!.observed.modelUpdatedAt
                    || selected.localModelReference !== reservation!.observed.logicalPath)
                  throw new Error("Original Model source preparation is unavailable.");
                await allowedCapture();
              }
              if (preparation.uncertain || asyncSourceReservation && Date.now() >= deadline)
                throw new Error("Original Model source preparation is unavailable.");
              originalModelSource = bindOriginalTrainingSourceLaunch(capture, reservation!.observed, owner);
              preparation.confirmed = true;
            } catch {preparation.uncertain = true; throw new Error("Original Model source preparation is unavailable.");}
            finally {if (timer) clearTimeout(timer);}
          }
          const admission = Object.freeze({assertCurrent: currentCapture, assertAllowed: allowedCapture,
            ...(originalModelSource ? {originalModelSource} : {}),
            ...(localConfiguration ? {boundedLocalTraining: localConfiguration.startupProfile} : {})});
          await startInstalled(admission); currentCapture();
          const worker = captureRetirement(), workerCurrent = worker.assertCurrent.bind(worker);
          const retire = worker.retireOriginal.bind(worker), unused = worker.releaseUnused.bind(worker);
          workerCurrent();
          await allowedCapture();
          const original = await captureOriginal(profile, exitConfiguration?.retirementProtocol);
          const channelCurrent = original.assertCurrent.bind(original), sendOriginal = original.send.bind(original);
          const current = () => {workerCurrent(); channelCurrent();};
          await allowedCapture(); current();
          return Object.freeze({identity: original.identity, assertCurrent: current,
            ...(localModelCopy ? {localModelCopy} : {}),
            async retireOriginalWorker() {
              const local = reservation!.local;
              if (!local?.workerRetired && await retire() !== true) return false;
              if (!local) return true;
              local.workerRetired = true; // Only the original actual Job capability can establish this fact.
              if (!local.prepared || local.uncertain || local.calls.some(call => !call.finished) || !local.storage) return false;
              if (local.cleanupAttempted) return local.storage.inspect().phase === "discarded";
              local.cleanupAttempted = true;
              try {
                const result: unknown = local.storage.fence();
                if (result !== undefined || await local.storage.discard(local.context) !== true) throw new Error();
                return true;
              } catch {local.uncertain = true; return false;}
            }, releaseUnusedWorker: unused,
            async send(endpoint: string, body: unknown, dispatch?: () => void) {
              current();
              const reply = await sendOriginal(endpoint, body, () => {current(); dispatch?.(); current();});
              current(); return reply;
            }});
        },
      });
  };

  const foundation: PythonRuntimeAdapterFoundation = {
    runtimePort,
    supervisor,
    bindHostAdmission,
    createApprovedTrainingPort(rawProfile, rawObservation, sourceReservation, rawExitConfiguration) {
      return createTrainingPort(rawProfile, rawObservation, sourceReservation, rawExitConfiguration);
    },
    createBoundedLocalTrainingPort(raw) {
      if (!raw || typeof raw !== "object" || types.isProxy(raw)) throw new Error("Local training composition is unavailable.");
      const row = readStrictPassiveRecord(raw, ["startupProfile", "observation", "createModelCopy"]);
      if (Object.keys(row).length !== 3 || typeof row.createModelCopy !== "function" || types.isProxy(row.createModelCopy)
          || types.isAsyncFunction(row.createModelCopy) || types.isGeneratorFunction(row.createModelCopy))
        throw new Error("Local training composition is unavailable.");
      if (!row.startupProfile || typeof row.startupProfile !== "object" || types.isProxy(row.startupProfile)
          || !row.observation || typeof row.observation !== "object" || types.isProxy(row.observation))
        throw new Error("Local training composition is unavailable.");
      const profile = readStrictPassiveRecord(row.startupProfile, ["profileId", "profileFingerprint", "maximumDurationSeconds", "stagingRoot",
        "maximumModelBytes", "maximumOutputBytes", "minimumFreeBytes"]);
      const {profileFingerprint, ...input} = profile;
      const startupProfile = createBoundedLocalTrainingStartupProfile(input as unknown as Parameters<typeof createBoundedLocalTrainingStartupProfile>[0]);
      if (startupProfile.profileFingerprint !== profileFingerprint) throw new Error("Local training composition is unavailable.");
      const observation = readStrictPassiveRecord(row.observation, ["allowedRootDirectories", "maximumTotalBytes", "maximumDurationMs", "bufferBytes"]);
      const roots = observation.allowedRootDirectories;
      if (!Array.isArray(roots) || types.isProxy(roots) || Object.getPrototypeOf(roots) !== Array.prototype
          || roots.length < 1 || roots.length > 8 || Reflect.ownKeys(roots).length !== roots.length + 1
          || typeof observation.maximumTotalBytes !== "number" || !Number.isSafeInteger(observation.maximumTotalBytes)
          || observation.maximumTotalBytes > startupProfile.maximumModelBytes)
        throw new Error("Local training composition is unavailable.");
      const capturedRoots: string[] = [];
      for (let index = 0; index < roots.length; index++) {
        const property = Object.getOwnPropertyDescriptor(roots, String(index));
        if (!property || !("value" in property) || typeof property.value !== "string") throw new Error("Local training composition is unavailable.");
        capturedRoots.push(property.value);
      }
      // The existing observer validates and captures all policy values before effects.
      const capturedObservation = Object.freeze({...observation, allowedRootDirectories: Object.freeze(capturedRoots)}) as unknown as OriginalTrainingModelObservationPolicy;
      createOriginalTrainingModelSourceFactory(capturedObservation);
      const factory = row.createModelCopy as OriginalBoundedLocalTrainingConfiguration["createModelCopy"];
      const local = Object.freeze({startupProfile, observation: capturedObservation,
        createModelCopy: (input: Parameters<typeof factory>[0]) => Reflect.apply(factory, raw, [input])});
      return createTrainingPort({profileId: startupProfile.profileId, profileFingerprint: startupProfile.profileFingerprint}, capturedObservation,
        undefined, undefined, local);
    },
    createModelSourceDownloadConfiguration(createStorage) {
      if (typeof createStorage !== "function") throw new TypeError("Model source storage composition is unavailable.");
      const storage = createStorage(modelSourceCacheRoot);
      return Object.freeze({cacheRoot: modelSourceCacheRoot,
        captureSession: () => foundation.captureModelSourceTaskSession(), storage});
    },
    async captureModelSourceTaskSession() {
      if (!hostAdmission) throw new Error("Model source host admission is unavailable.");
      assertHostAccepting(); assertAdmissionAvailable();
      const original = await client.captureModelSourceTaskSession();
      assertHostAccepting(); assertAdmissionAvailable(); original.identityProbe.assertCurrent();
      return Object.freeze({identityProbe: original.identityProbe, async start(receiver: unknown, workspaceId: string) {
        assertHostAccepting(); assertAdmissionAvailable(); original.identityProbe.assertCurrent();
        ModelSourceRecipient.assertPreparedSession(receiver, workspaceId, original.identityProbe);
        const binding = ModelSourceRecipient.capturedBinding(receiver);
        if (trackedTasks.has(binding.taskId) || terminalOverrides.has(binding.taskId) || datasetAdmissions.has(binding.taskId) ||
            installedContextAdmissions.has(binding.taskId) || [...trackedTasks.values()].some(value => value.sourceReceiver) ||
            trackedTasks.size >= maximumDatasetAdmissions) throw new Error("Model source custody must be settled before another acquisition.");
        const sourceReceiver = receiver as ModelSourceRecipient;
        const retained = {taskType: "ensure-model-download", deadline: Date.now() + sourceReceiver.transfer.maximumDurationSeconds * 1000, sourceReceiver};
        trackedTasks.set(binding.taskId, retained);
        // Preserve this original owner even after an unknown POST or actual worker exit.
        const started = await original.start(receiver, workspaceId);
        if (started.kind !== "accepted") return started;
        let settled = false;
        const release = () => {
          original.identityProbe.assertCurrent();
          if (settled) return;
          if (trackedTasks.get(binding.taskId) !== retained || retained.sourceReceiver.phase !== "settled")
            throw new Error("Model source custody could not be settled.");
          trackedTasks.delete(binding.taskId); settled = true;
        };
        const task: CapturedModelSourceTask = Object.freeze({...started.task,
          async acknowledge(phase: "receiver-observed" | "receiver-settled") {
            const reply = await started.task.acknowledge(phase);
            if (phase === "receiver-settled" && reply.phase === "released") release();
            return reply;
          },
          async retireEmptyReceiver() {await started.task.retireEmptyReceiver(); release();},
        });
        return {kind: "accepted" as const, task};
      }});
    },
  };
  return foundation;
}

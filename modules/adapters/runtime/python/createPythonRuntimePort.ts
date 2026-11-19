import type { PythonRuntimePort } from "../../../application/ports/runtime";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { isWorkspaceId } from "../../../contracts/workspace";
import { types } from "node:util";
import {ModelSourceRecipient} from "./client/modelSourceRecipient";
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
  type PythonRuntimeSupervisor,
} from "./supervisor/createPythonRuntimeSupervisor";

export interface CreatePythonRuntimePortOptions {
  client: Omit<
    CreatePythonRuntimeHttpClientOptions,
    "authorizationToken" | "authorizationTokenProvider" | "captureProcessOwnership"
  >;
  supervisor: Omit<
    CreatePythonRuntimeSupervisorOptions,
    "runtimeClient" | "prepareLaunchEnvironment" | "requireOwnedStartupProof"
  >;
  generateAuthorizationToken?: () => string;
}

export interface PythonRuntimeAdapterFoundation {
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
    if (datasetAdmissions.size || [...trackedTasks.values()].some(value => value.sourceReceiver)) return false;
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
    if (recoveryInFlight || recoveryUncertain) {
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
      assertAdmissionAvailable();
      try {
        return await client.ensureModelDownloaded(request);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("model download timed out")
        ) {
          await recoverWorker(undefined, "failed");
        }
        throw error;
      }
    },
    resolveModelDownloadTaskResult: (payload, expectedManifest) =>
      client.resolveModelDownloadTaskResult(payload, expectedManifest),
    getModelStatus: () => client.getModelStatus(),
    unloadModels: () => client.unloadModels(),
  };

  const foundation: PythonRuntimeAdapterFoundation = {
    runtimePort,
    supervisor,
    bindHostAdmission,
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

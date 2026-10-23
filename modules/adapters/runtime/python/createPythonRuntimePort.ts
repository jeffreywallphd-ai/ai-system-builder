import type { PythonRuntimePort } from "../../../application/ports/runtime";
import { randomBytes } from "node:crypto";
import type {
  CancelPythonRuntimeTaskResult,
  PythonRuntimeTaskStatusResult,
  StartPythonRuntimeTaskRequest,
} from "../../../contracts/runtime";

import {
  createPythonRuntimeHttpClient,
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
    "authorizationToken" | "authorizationTokenProvider"
  >;
  supervisor: Omit<
    CreatePythonRuntimeSupervisorOptions,
    "runtimeClient" | "prepareLaunchEnvironment"
  >;
  generateAuthorizationToken?: () => string;
}

export interface PythonRuntimeAdapterFoundation {
  runtimePort: PythonRuntimePort;
  supervisor: PythonRuntimeSupervisor;
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
  const runtimeEnvironment: NodeJS.ProcessEnv = {
    ...(options.supervisor.env ?? {}),
  };
  const client = createPythonRuntimeHttpClient({
    ...options.client,
    environment: runtimeEnvironment,
    authorizationTokenProvider: () => authorizationToken,
  });
  const trackedTasks = new Map<
    string,
    { taskType: string; deadline: number }
  >();
  // A disconnected POST can already have started non-cancellable Dataset work.
  // Retain only identity/lifecycle facts, never request payloads, until proven done.
  const datasetAdmissions = new Map<string, {
    epoch: number;
    phase: "pending" | "accepted" | "uncertain";
  }>();
  const maximumDatasetAdmissions = 256;
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
  const supervisor = createPythonRuntimeSupervisor({
    ...options.supervisor,
    env: runtimeEnvironment,
    prepareLaunchEnvironment: () => {
      authorizationToken = assertStrongToken(generateAuthorizationToken());
      runtimeEnvironment.PYTHON_RUNTIME_AUTH_TOKEN = authorizationToken;
    },
    runtimeClient: client,
    onEvent: (event) => {
      // The supervisor emits this only for its currently owned process handle.
      // HTTP uncertainty and events from a previous generation cannot supply it.
      if (event.type === "process-exit") {
        ownedExitEpoch++;
        for (const [requestId, tracked] of trackedTasks) {
          rememberOwnedExit(requestId, tracked.taskType);
        }
        for (const requestId of datasetAdmissions.keys()) {
          if (!terminalOverrides.has(requestId)) {
            rememberOwnedExit(requestId, "prepare-training-dataset");
          }
        }
        datasetAdmissions.clear();
        trackedTasks.clear();
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
    if (datasetAdmissions.size) return false;
    if (recoveryInFlight) return recoveryInFlight;
    if (recoveryUncertain) throw new Error("Python runtime recovery has not been confirmed.");
    const recoveringTasks = [...trackedTasks];
    // Publish the flight before stop/start can yield or emit lifecycle events.
    const operation = Promise.resolve().then(async () => {
      await supervisor.restart();
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

  const runtimePort: PythonRuntimePort = {
    startTask: async (request) => {
      assertAdmissionAvailable();
      if (typeof request.requestId !== "string" || request.requestId.length > 128) {
        throw new TypeError("Python runtime task identifier exceeds its retention bound.");
      }
      // Match the HTTP client's canonical grammar before retaining an owner:
      // a locally rejected identifier cannot have reached the worker.
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId)) {
        throw new TypeError("Python runtime task identifier is invalid.");
      }
      if (datasetAdmissions.has(request.requestId) || trackedTasks.has(request.requestId) || terminalOverrides.has(request.requestId)) {
        throw new Error("Python runtime task is already known. Read its current status before retrying.");
      }
      const admissionEpoch = ownedExitEpoch;
      const admission = request.taskType === "prepare-training-dataset"
        ? { epoch: admissionEpoch, phase: "pending" as "pending" | "accepted" | "uncertain" }
        : undefined;
      if (admission) {
        if (datasetAdmissions.size >= maximumDatasetAdmissions) {
          throw new Error("Python runtime task admission capacity is unavailable. Reconcile existing tasks before retrying.");
        }
        datasetAdmissions.set(request.requestId, admission);
      }
      try {
        const result = await client.startTask(request);
        assertReplyIdentity(request.requestId, result, request.taskType);
        if (admissionEpoch !== ownedExitEpoch) {
          if (!terminalOverrides.has(request.requestId)) rememberOwnedExit(request.requestId, request.taskType);
        } else if (admission && datasetAdmissions.get(request.requestId) !== admission) {
          // An exact terminal read/cancellation can beat the POST acknowledgement.
          return result;
        } else {
          if (admission) admission.phase = "accepted";
          terminalOverrides.delete(request.requestId);
          trackedTasks.set(request.requestId, {
            taskType: request.taskType,
            deadline: Date.now() + boundedTaskTimeout(request),
          });
        }
        return result;
      } catch (error) {
        if (admission && datasetAdmissions.get(request.requestId) === admission) admission.phase = "uncertain";
        throw error;
      }
    },
    readTaskStatus: async (requestId) => {
      const override = terminalOverrides.get(requestId);
      if (override) return override;
      const tracked = trackedTasks.get(requestId);
      const admission = datasetAdmissions.get(requestId);
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
          trackedTasks.get(requestId) !== tracked || datasetAdmissions.get(requestId) !== admission) {
        throw new Error("Python runtime task observation is no longer current.");
      }
      assertReplyIdentity(requestId, status, admission ? "prepare-training-dataset" : tracked?.taskType);
      if (admission && admission.phase !== "accepted" && status.taskType !== "prepare-training-dataset") {
        throw new Error("Python runtime task response identity did not match the pending request.");
      }
      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        if (tracked || admission) rememberOverride(requestId, status);
        trackedTasks.delete(requestId);
        datasetAdmissions.delete(requestId);
      }
      return status;
    },
    cancelTask: async (requestId): Promise<CancelPythonRuntimeTaskResult> => {
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
      const observationEpoch = ownedExitEpoch;
      const result = await client.cancelTask(requestId);
      const afterCancelOverride = terminalOverrides.get(requestId);
      if (afterCancelOverride) {
        return { requestId, taskType: afterCancelOverride.taskType,
          status: afterCancelOverride.status,
          cancelled: afterCancelOverride.status === "cancelled" };
      }
      if (observationEpoch !== ownedExitEpoch ||
          trackedTasks.get(requestId) !== tracked || datasetAdmissions.get(requestId) !== admission) {
        throw new Error("Python runtime task observation is no longer current.");
      }
      assertReplyIdentity(requestId, result, admission ? "prepare-training-dataset" : tracked?.taskType);
      if (admission && admission.phase !== "accepted" && result.taskType !== "prepare-training-dataset") {
        throw new Error("Python runtime task response identity did not match the pending request.");
      }
      if (result.cancelled !== (result.status === "cancelled")) {
        throw new Error("Python runtime cancellation response is inconsistent.");
      }
      if (result.cancelled || result.status === "cancelled") {
        if (tracked || admission) rememberOverride(requestId, {
          requestId, taskType: result.taskType ?? tracked?.taskType ?? "prepare-training-dataset", status: "cancelled",
          completedAt: new Date().toISOString(), metadata: result.metadata,
        });
        trackedTasks.delete(requestId);
        datasetAdmissions.delete(requestId);
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
    resolveModelDownloadTaskResult: (payload) =>
      client.resolveModelDownloadTaskResult(payload),
    getModelStatus: () => client.getModelStatus(),
    unloadModels: () => client.unloadModels(),
  };

  return {
    runtimePort,
    supervisor,
  };
}

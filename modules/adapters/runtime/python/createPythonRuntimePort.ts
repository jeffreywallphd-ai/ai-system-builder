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
        trackedTasks.clear();
      }
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
    targetRequestId: string,
    targetStatus: "cancelled" | "failed",
  ) => {
    const recoveringTasks = [...trackedTasks];
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
  };

  const runtimePort: PythonRuntimePort = {
    startTask: async (request) => {
      const admissionEpoch = ownedExitEpoch;
      const result = await client.startTask(request);
      assertReplyIdentity(request.requestId, result, request.taskType);
      if (admissionEpoch !== ownedExitEpoch) {
        rememberOwnedExit(request.requestId, request.taskType);
      } else {
        terminalOverrides.delete(request.requestId);
        trackedTasks.set(request.requestId, {
          taskType: request.taskType,
          deadline: Date.now() + boundedTaskTimeout(request),
        });
      }
      return result;
    },
    readTaskStatus: async (requestId) => {
      const override = terminalOverrides.get(requestId);
      if (override) return override;
      const tracked = trackedTasks.get(requestId);
      if (tracked && Date.now() >= tracked.deadline) {
        await recoverWorker(requestId, "failed");
        return terminalOverrides.get(requestId)!;
      }
      const status = await client.readTaskStatus(requestId).catch(error => {
        const exited = terminalOverrides.get(requestId);
        if (exited) return exited;
        throw error;
      });
      const afterReadOverride = terminalOverrides.get(requestId);
      if (afterReadOverride) return afterReadOverride;
      assertReplyIdentity(requestId, status);
      if (
        status.status === "succeeded" ||
        status.status === "failed" ||
        status.status === "cancelled"
      ) {
        if (trackedTasks.has(requestId)) rememberOverride(requestId, status);
        trackedTasks.delete(requestId);
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
      const result = await client.cancelTask(requestId);
      const afterCancelOverride = terminalOverrides.get(requestId);
      if (afterCancelOverride) {
        return { requestId, taskType: afterCancelOverride.taskType,
          status: afterCancelOverride.status,
          cancelled: afterCancelOverride.status === "cancelled" };
      }
      assertReplyIdentity(requestId, result);
      if (result.cancelled || result.status === "cancelled") {
        if (trackedTasks.has(requestId)) rememberOverride(requestId, {
          requestId, taskType: result.taskType ?? trackedTasks.get(requestId)!.taskType, status: "cancelled",
          completedAt: new Date().toISOString(), metadata: result.metadata,
        });
        trackedTasks.delete(requestId);
        return result;
      }
      if (result.status === "running" && trackedTasks.has(requestId)) {
        await recoverWorker(requestId, "cancelled");
        return {
          requestId,
          taskType: result.taskType,
          status: "cancelled",
          cancelled: true,
          message: "Cancelled task and recovered the Python runtime worker.",
          metadata: { recovery: "worker-restarted" },
        };
      }
      return result;
    },
    getHealthStatus: () => client.getHealthStatus(),
    getCapabilities: () => client.getCapabilities(),
    ensureModelDownloaded: async (request) => {
      try {
        return await client.ensureModelDownloaded(request);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("model download timed out")
        ) {
          await supervisor.restart();
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

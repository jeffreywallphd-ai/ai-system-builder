import { ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { platform } from "node:os";

import type { PythonRuntimeHttpClient } from "../client/createPythonRuntimeHttpClient";

export type PythonRuntimeSupervisorStatus =
  "stopped" | "starting" | "ready" | "failed";

export interface PythonRuntimeSupervisorEvent {
  type:
    | "start-requested"
    | "start-skipped"
    | "attached"
    | "spawned"
    | "health-probe-failed"
    | "health-unhealthy"
    | "capability-mismatch"
    | "health-ready"
    | "startup-timeout"
    | "process-exit"
    | "process-error"
    | "stop-requested"
    | "stop-complete"
    | "stdio";
  status: PythonRuntimeSupervisorStatus;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface PythonRuntimeSupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): PythonRuntimeSupervisorStatus;
}

export interface CreatePythonRuntimeSupervisorOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  prepareRuntimeEnvironment?: (context: {
    command: string;
    args: readonly string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }) => void | Promise<void>;
  prepareLaunchEnvironment?: (context: {
    command: string;
    args: readonly string[];
    cwd?: string;
    env: NodeJS.ProcessEnv;
  }) => void | Promise<void>;
  startupTimeoutMs?: number;
  healthCheckIntervalMs?: number;
  runtimeClient: Pick<PythonRuntimeHttpClient, "getHealthStatus"> &
    Partial<Pick<PythonRuntimeHttpClient, "getCapabilities">>;
  requiredCapabilities?: readonly string[];
  spawnImplementation?: typeof spawn;
  onEvent?: (event: PythonRuntimeSupervisorEvent) => void;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createPythonRuntimeSupervisor(
  options: CreatePythonRuntimeSupervisorOptions,
): PythonRuntimeSupervisor {
  const startupTimeoutMs = options.startupTimeoutMs ?? 5_000;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 100;
  const spawnImplementation = options.spawnImplementation ?? spawn;
  const onEvent = options.onEvent;
  const requiredCapabilities = options.requiredCapabilities ?? [];
  const runtimeEnvironment: NodeJS.ProcessEnv = options.env ?? {
    ...process.env,
  };

  let childProcess: ChildProcess | undefined;
  let status: PythonRuntimeSupervisorStatus = "stopped";
  let attachedToExistingRuntime = false;
  let lastHealthProbeError: string | undefined;
  let healthProbeFailureCount = 0;
  let lastEmittedHealthProbeError: string | undefined;
  let lastStartupFailure: string | undefined;
  let incompatibleExistingRuntimeFailure: string | undefined;
  const recentRuntimeOutput: string[] = [];

  const emitEvent = (
    type: PythonRuntimeSupervisorEvent["type"],
    detail?: string,
    data?: Record<string, unknown>,
  ) => {
    try {
      onEvent?.({
        type,
        status,
        detail,
        data,
      });
    } catch {
      // Runtime lifecycle must not fail because an optional diagnostics sink failed.
    }
  };

  const summarizeRuntimeOutput = (
    source: "stdout" | "stderr",
    text: string,
  ): string | undefined => {
    const normalized = text.trim();
    if (!normalized) return undefined;
    for (const line of normalized.split(/\r?\n/).slice(0, 8)) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const event =
          typeof parsed.event === "string" &&
          /^runtime\.[a-z0-9_.-]{1,96}$/.test(parsed.event)
            ? parsed.event
            : undefined;
        if (event) {
          const diagnosticClass =
            typeof parsed.diagnosticClass === "string" &&
            /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(parsed.diagnosticClass)
              ? parsed.diagnosticClass
              : undefined;
          return `${source}:${event}${diagnosticClass ? `:${diagnosticClass}` : ""}`;
        }
      } catch {
        // Non-structured subprocess output is intentionally represented by class only.
      }
    }
    return `${source}:unstructured-output`;
  };

  const appendRuntimeOutput = (source: "stdout" | "stderr", text: string) => {
    const summary = summarizeRuntimeOutput(source, text);
    if (!summary) return;
    recentRuntimeOutput.push(summary);
    if (recentRuntimeOutput.length > 10) {
      recentRuntimeOutput.splice(0, recentRuntimeOutput.length - 10);
    }
    return summary;
  };

  const startFailureMessage = (base: string): string => {
    const details = [
      lastStartupFailure,
      lastHealthProbeError
        ? `Last health probe error: ${lastHealthProbeError}`
        : undefined,
      healthProbeFailureCount > 0
        ? `Health probe failures during startup: ${healthProbeFailureCount}.`
        : undefined,
      recentRuntimeOutput.length > 0
        ? `Recent runtime output: ${recentRuntimeOutput.join(" | ")}`
        : undefined,
    ].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    if (details.length === 0) {
      return base;
    }

    return `${base} ${details.join(" ")}`;
  };

  const applyChildExitBinding = (processHandle: ChildProcess) => {
    processHandle.once("exit", (code, signal) => {
      const exitDetail = `Python runtime process exited during lifecycle (code=${String(code ?? "null")}, signal=${String(signal ?? "null")}).`;
      lastStartupFailure = exitDetail;
      childProcess = undefined;
      attachedToExistingRuntime = false;
      status = "stopped";
      emitEvent("process-exit", exitDetail, { code, signal });
    });
    processHandle.once("error", (error) => {
      lastStartupFailure = "Python runtime process failed to start.";
      status = "failed";
      emitEvent("process-error", lastStartupFailure, {
        errorName: error.name,
      });
    });

    const bindStream = (
      stream: NodeJS.ReadableStream | null,
      source: "stdout" | "stderr",
    ) => {
      if (!stream) {
        return;
      }

      stream.on("data", (chunk: string | Buffer) => {
        const text = chunk.toString();
        const summary = appendRuntimeOutput(source, text);
        if (summary) {
          emitEvent("stdio", summary, {
            source,
            truncated: Buffer.byteLength(text) > 16 * 1024,
          });
        }
      });
    };

    bindStream(processHandle.stdout, "stdout");
    bindStream(processHandle.stderr, "stderr");
  };

  const getDefaultCommand = () => {
    return platform() === "win32" ? "python" : "python3";
  };

  const resolveCommand = () => {
    const command = options.command.trim();
    return command.length > 0 ? command : getDefaultCommand();
  };

  const resolveArgs = () => {
    if (Array.isArray(options.args) && options.args.length > 0) {
      return options.args;
    }

    return ["main.py"];
  };

  const hasRuntimeExited = () => {
    return (
      (!childProcess && !attachedToExistingRuntime) || status === "stopped"
    );
  };

  const throwStartupFailure = (message: string): never => {
    status = "failed";
    throw new Error(startFailureMessage(message));
  };

  const assertRuntimeStillStarting = () => {
    if (hasRuntimeExited()) {
      throwStartupFailure(
        "Python runtime exited before health check completed.",
      );
    }
    if (status === "failed") {
      throwStartupFailure("Python runtime failed during startup.");
    }
  };

  const maybeWarnOnWindowsCommand = (command: string) => {
    if (platform() === "win32" && command === "python3") {
      emitEvent(
        "start-requested",
        "Configured python runtime command is `python3` on Windows; `python` is usually required.",
      );
      lastStartupFailure =
        "Configured command `python3` is uncommon on Windows.";
    }
  };

  const tryAttachToExistingRuntime = async (): Promise<boolean> => {
    try {
      const health = await options.runtimeClient.getHealthStatus();
      if (!health.healthy) {
        return false;
      }

      const missingCapabilities = await resolveMissingRequiredCapabilities();
      if (missingCapabilities.length > 0) {
        const detail = `Healthy Python runtime is missing required capability/capabilities: ${missingCapabilities.join(", ")}.`;
        lastStartupFailure = detail;
        incompatibleExistingRuntimeFailure = detail;
        emitEvent("capability-mismatch", detail, {
          runtimeStatus: health.status.status,
          runtimeId: health.status.runtimeId,
          missingCapabilities,
        });
        return false;
      }

      attachedToExistingRuntime = true;
      childProcess = undefined;
      status = "ready";
      emitEvent(
        "attached",
        "Attached to an already healthy Python runtime instead of spawning a new process.",
        {
          runtimeStatus: health.status.status,
          runtimeId: health.status.runtimeId,
        },
      );
      return true;
    } catch {
      return false;
    }
  };

  const resolveMissingRequiredCapabilities = async (): Promise<string[]> => {
    if (requiredCapabilities.length === 0) {
      return [];
    }

    if (typeof options.runtimeClient.getCapabilities !== "function") {
      return [...requiredCapabilities];
    }

    const capabilities = await options.runtimeClient.getCapabilities();
    const advertised = new Set(capabilities.capabilities);
    return requiredCapabilities.filter(
      (capability) => !advertised.has(capability),
    );
  };

  const startHealthPolling = async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      assertRuntimeStillStarting();
      try {
        const health = await options.runtimeClient.getHealthStatus();
        if (health.healthy) {
          const missingCapabilities =
            await resolveMissingRequiredCapabilities();
          if (missingCapabilities.length > 0) {
            const detail = `Python runtime is healthy but missing required capability/capabilities: ${missingCapabilities.join(", ")}.`;
            lastStartupFailure = detail;
            emitEvent("capability-mismatch", detail, {
              runtimeStatus: health.status.status,
              runtimeId: health.status.runtimeId,
              missingCapabilities,
            });
            await delay(healthCheckIntervalMs);
            continue;
          }

          status = "ready";
          const readyDetail =
            healthProbeFailureCount > 0
              ? `Python runtime reported healthy startup state after ${healthProbeFailureCount} failed health probe attempt(s).`
              : "Python runtime reported healthy startup state.";
          emitEvent("health-ready", readyDetail);
          return;
        }

        const unhealthyDetail = `Python runtime reported ${health.status.status} health status.`;
        lastStartupFailure = unhealthyDetail;
        emitEvent("health-unhealthy", unhealthyDetail, {
          runtimeStatus: health.status.status,
        });
      } catch (error) {
        const message = `Python runtime health probe failed (${error instanceof Error ? error.name : "Error"}).`;
        lastHealthProbeError = message;
        healthProbeFailureCount += 1;
        if (lastEmittedHealthProbeError !== message) {
          lastEmittedHealthProbeError = message;
          emitEvent("health-probe-failed", message);
        }
      }

      await delay(healthCheckIntervalMs);
    }

    emitEvent(
      "startup-timeout",
      `Python runtime failed to report healthy status within ${startupTimeoutMs}ms.`,
    );
    throwStartupFailure(
      "Python runtime failed to report healthy status during startup window.",
    );
  };

  return {
    async start() {
      if (childProcess && status !== "stopped") {
        emitEvent(
          "start-skipped",
          "Runtime start skipped because supervisor is already active.",
        );
        return;
      }
      if (status === "ready" && attachedToExistingRuntime) {
        if (await tryAttachToExistingRuntime()) {
          emitEvent(
            "start-skipped",
            "Runtime start skipped because supervisor is attached to an existing runtime.",
          );
          return;
        }
        attachedToExistingRuntime = false;
        status = "stopped";
      }

      lastHealthProbeError = undefined;
      healthProbeFailureCount = 0;
      lastEmittedHealthProbeError = undefined;
      lastStartupFailure = undefined;
      incompatibleExistingRuntimeFailure = undefined;
      recentRuntimeOutput.splice(0, recentRuntimeOutput.length);

      const command = resolveCommand();
      const args = resolveArgs();
      emitEvent("start-requested", "Starting Python runtime process.", {
        commandKind:
          command === "python" || command === "python3" ? command : "custom",
        argumentCount: args.length,
        workingDirectoryConfigured: Boolean(options.cwd),
      });
      maybeWarnOnWindowsCommand(command);

      status = "starting";
      if (await tryAttachToExistingRuntime()) {
        return;
      }
      if (incompatibleExistingRuntimeFailure) {
        throwStartupFailure(
          `${incompatibleExistingRuntimeFailure} Stop the existing Python runtime or use a different PYTHON_RUNTIME_BASE_URL/PYTHON_RUNTIME_PORT before starting a new worker.`,
        );
      }

      if (options.prepareRuntimeEnvironment) {
        try {
          await options.prepareRuntimeEnvironment({
            command,
            args,
            cwd: options.cwd,
            env: runtimeEnvironment,
          });
        } catch (error) {
          lastStartupFailure = "Python runtime environment preparation failed.";
          status = "failed";
          emitEvent("process-error", lastStartupFailure, {
            errorName: error instanceof Error ? error.name : "Error",
          });
          throw new Error(
            startFailureMessage("Python runtime failed during startup."),
          );
        }
      }

      if (options.prepareLaunchEnvironment) {
        try {
          await options.prepareLaunchEnvironment({
            command,
            args,
            cwd: options.cwd,
            env: runtimeEnvironment,
          });
        } catch (error) {
          lastStartupFailure = "Python runtime launch preparation failed.";
          status = "failed";
          emitEvent("process-error", lastStartupFailure, {
            errorName: error instanceof Error ? error.name : "Error",
          });
          throw new Error(
            startFailureMessage("Python runtime failed during startup."),
          );
        }
      }

      try {
        attachedToExistingRuntime = false;
        childProcess = spawnImplementation(command, args, {
          cwd: options.cwd,
          env: runtimeEnvironment,
          stdio: "pipe",
        } satisfies SpawnOptions);
      } catch (error) {
        lastStartupFailure = "Python runtime process failed to start.";
        status = "failed";
        emitEvent("process-error", lastStartupFailure, {
          errorName: error instanceof Error ? error.name : "Error",
        });
        throw new Error(
          startFailureMessage("Python runtime failed during startup."),
        );
      }
      applyChildExitBinding(childProcess);
      emitEvent("spawned", "Python runtime process spawned.");

      await startHealthPolling();
    },

    async stop() {
      emitEvent("stop-requested", "Stopping Python runtime process.");
      if (!childProcess) {
        attachedToExistingRuntime = false;
        status = "stopped";
        emitEvent(
          "stop-complete",
          "Python runtime process was already stopped.",
        );
        return;
      }

      const processHandle = childProcess;
      await new Promise<void>((resolve) => {
        processHandle.once("exit", () => resolve());
        processHandle.kill("SIGTERM");
      });

      childProcess = undefined;
      status = "stopped";
      emitEvent("stop-complete", "Python runtime process stopped.");
    },

    async restart() {
      await this.stop();
      await this.start();
    },

    getStatus() {
      return status;
    },
  };
}

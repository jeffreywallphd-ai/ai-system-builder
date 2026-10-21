import { ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { platform } from "node:os";
import { terminateOwnedProcess } from "../../shared/terminateOwnedProcess";

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
  let startFlight: Promise<void> | undefined;
  let startGeneration: number | undefined;
  let stopFlight: Promise<void> | undefined;
  let lifecycleGeneration = 0;
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
          const stage =
            typeof parsed.stage === "string" &&
            ["normalization", "chunking", "generation", "split"].includes(
              parsed.stage,
            )
              ? parsed.stage
              : undefined;
          const errorCode =
            typeof parsed.errorCode === "string" &&
            /^[a-z][a-z0-9_]{0,95}$/.test(parsed.errorCode)
              ? parsed.errorCode
              : undefined;
          return [
            `${source}:${event}`,
            diagnosticClass,
            stage ? `stage=${stage}` : undefined,
            errorCode ? `code=${errorCode}` : undefined,
          ]
            .filter((value): value is string => Boolean(value))
            .join(":");
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
    const onTerminal = (code: number | null, signal: NodeJS.Signals | null) => {
      if (childProcess !== processHandle) return;
      const exitDetail = `Python runtime process exited during lifecycle (code=${String(code ?? "null")}, signal=${String(signal ?? "null")}).`;
      const startupFailed = status === "failed";
      if (!startupFailed) lastStartupFailure = exitDetail;
      childProcess = undefined;
      attachedToExistingRuntime = false;
      status = startupFailed ? "failed" : "stopped";
      emitEvent("process-exit", exitDetail, { code, signal });
    };
    processHandle.once("exit", onTerminal);
    processHandle.once("close", onTerminal);
    processHandle.on("error", (error) => {
      if (childProcess !== processHandle) return;
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
        if (childProcess !== processHandle) return;
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

  const tryAttachToExistingRuntime = async (assertCurrent: () => void): Promise<boolean> => {
    try {
      const health = await options.runtimeClient.getHealthStatus();
      assertCurrent();
      if (!health.healthy) {
        return false;
      }

      const missingCapabilities = await resolveMissingRequiredCapabilities();
      assertCurrent();
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
      assertCurrent();
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

  const startHealthPolling = async (assertCurrent: () => void, owner: ChildProcess) => {
    const assertOwned = () => {
      assertCurrent();
      if (childProcess !== owner) throw new Error("Python runtime exited before health check completed.");
      assertRuntimeStillStarting();
    };
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      assertOwned();
      try {
        const health = await options.runtimeClient.getHealthStatus();
        assertOwned();
        if (health.healthy) {
          const missingCapabilities =
            await resolveMissingRequiredCapabilities();
          assertOwned();
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
        assertOwned();
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
      if (stopFlight) throw new Error("Python runtime is stopping; retry after confirmed termination.");
      if (startFlight) {
        if (startGeneration !== lifecycleGeneration) throw new Error("Previous Python runtime startup is still stopping.");
        return startFlight;
      }
      const generation = lifecycleGeneration;
      const assertCurrent = () => { if (generation !== lifecycleGeneration) throw new Error("Python runtime startup was stopped."); };
      const operation = (async () => {
      if (childProcess && status === "failed") throw new Error("Python runtime startup failed; stop the owned process before retrying.");
      if (childProcess && status !== "stopped") {
        emitEvent(
          "start-skipped",
          "Runtime start skipped because supervisor is already active.",
        );
        return;
      }
      if (attachedToExistingRuntime) {
        if (await tryAttachToExistingRuntime(assertCurrent)) {
          assertCurrent();
          emitEvent(
            "start-skipped",
            "Runtime start skipped because supervisor is attached to an existing runtime.",
          );
          return;
        }
        assertCurrent();
        status = "failed";
        throw new Error("Externally attached Python worker is unavailable; external termination must be confirmed before replacement.");
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
      if (await tryAttachToExistingRuntime(assertCurrent)) {
        assertCurrent();
        return;
      }
      assertCurrent();
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
          assertCurrent();
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

      assertCurrent();
      if (options.prepareLaunchEnvironment) {
        try {
          await options.prepareLaunchEnvironment({
            command,
            args,
            cwd: options.cwd,
            env: runtimeEnvironment,
          });
        } catch (error) {
          assertCurrent();
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

      assertCurrent();
      try {
        attachedToExistingRuntime = false;
        childProcess = spawnImplementation(command, args, {
          cwd: options.cwd,
          env: runtimeEnvironment,
          stdio: "pipe",
        } satisfies SpawnOptions);
      } catch (error) {
        assertCurrent();
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

      await startHealthPolling(assertCurrent, childProcess);
      assertCurrent();
      })();
      startFlight = operation;
      startGeneration = generation;
      try { await operation; } finally { if (startFlight === operation) { startFlight = undefined; startGeneration = undefined; } }
    },

    async stop() {
      if (stopFlight) return stopFlight;
      lifecycleGeneration++;
      emitEvent("stop-requested", "Stopping Python runtime process.");
      if (!childProcess) {
        if (attachedToExistingRuntime) {
          throw new Error("Externally attached Python worker termination cannot be confirmed; external shutdown remains required.");
        }
        attachedToExistingRuntime = false;
        status = "stopped";
        emitEvent(
          "stop-complete",
          "Python runtime process was already stopped.",
        );
        return;
      }

      const processHandle = childProcess;
      status = "failed";
      const operation = Promise.resolve().then(() => terminateOwnedProcess(processHandle)).then(() => {
        if (childProcess === processHandle) childProcess = undefined;
        status = "stopped";
        emitEvent("stop-complete", "Python runtime process stopped.");
      });
      stopFlight = operation;
      try { await operation; } finally { if (stopFlight === operation) stopFlight = undefined; }
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

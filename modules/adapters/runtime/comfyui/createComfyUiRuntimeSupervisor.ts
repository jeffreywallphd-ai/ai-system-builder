import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type { RuntimeInstallerPort } from "../../../application/ports/runtime-installer/runtime-installer.port";
import type { LoggingPort } from "../../../application/ports/logging";
import { DEFAULT_COMFYUI_REPOSITORY_URL } from "../installer/comfyui/createComfyUiRuntimeInstaller";
import { createComfyUiHttpClient, type ComfyUiHttpClient } from "./createComfyUiHttpClient";
import type { ComfyUiRuntimeHealth } from "./comfyUiRuntimeHealth";
import { buildComfyUiRuntimeEnvironment } from "./comfyUiPythonEnvironment";


export interface CreateComfyUiRuntimeSupervisorOptions {
  workingDirectory: string;
  pythonExecutable?: string;
  runtimeDeviceMode?: ComfyUiRuntimeDeviceMode;
  port?: number;
  host?: string;
  startupTimeoutMs?: number;
  healthCheckIntervalMs?: number;
  fetchImplementation?: typeof fetch;
  spawnImplementation?: typeof spawn;
  installer?: RuntimeInstallerPort;
  installRoot?: string;
  installSourceRef?: string;
  autoInstall?: boolean;
  logging?: LoggingPort;
}

export type ComfyUiRuntimeDeviceMode = "auto" | "cpu" | "directml" | "cuda";

export interface ComfyUiRuntimeSupervisor {
  start(): Promise<void>;
  isRunning(): boolean;
  getStatus(): ComfyUiRuntimeHealth["status"];
  getHealth(): Promise<ComfyUiRuntimeHealth>;
  getRecentRuntimeOutput(): string[];
  getRuntimeDeviceMode(): ComfyUiRuntimeDeviceMode;
  stop(): Promise<void>;
}
type DependencyMismatchReason = "torchaudio" | "torchvision" | "directml" | "unknown";
type DependencyMismatchConfidence = "high" | "medium" | "low";
interface DependencyMismatchClassification {
  isDependencyMismatch: boolean;
  reason: DependencyMismatchReason;
  confidence: DependencyMismatchConfidence;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRuntimeOutput(text: string): string | undefined {
  const normalized = text.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function waitForProcessExit(process: ChildProcess, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const complete = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      process.off("exit", complete);
      process.off("error", complete);
      resolve();
    };
    const timeout = setTimeout(complete, timeoutMs);
    process.once("exit", complete);
    process.once("error", complete);
  });
}

export function buildComfyUiRuntimeLaunchArguments(input: {
  host: string;
  port: number;
  runtimeDeviceMode?: ComfyUiRuntimeDeviceMode;
}): string[] {
  const deviceMode = input.runtimeDeviceMode ?? "cpu";
  const deviceArguments =
    deviceMode === "directml"
      ? ["--directml"]
      : deviceMode === "cpu"
        ? ["--cpu"]
        : [];

  return ["main.py", ...deviceArguments, "--listen", input.host, "--port", String(input.port)];
}

export function createComfyUiRuntimeSupervisor(options: CreateComfyUiRuntimeSupervisorOptions): ComfyUiRuntimeSupervisor {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8188;
  const runtimeDeviceMode = options.runtimeDeviceMode ?? "cpu";
  const url = `http://${host}:${port}`;
  const startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 1_000;
  const spawnImplementation = options.spawnImplementation ?? spawn;
  const pythonExecutable = options.pythonExecutable ?? "python";
  const client: Pick<ComfyUiHttpClient, "getSystemStats"> = createComfyUiHttpClient({ baseUrl: url, fetchImplementation: options.fetchImplementation });

  let processHandle: ChildProcess | undefined;
  let status: ComfyUiRuntimeHealth["status"] = "stopped";
  let lastCheckAt = Date.now();
  let startupFailure: string | undefined;
  const recentRuntimeOutput: string[] = [];
  let repairAttempted = false;

  const log = (level: "debug" | "info" | "error", message: string, details?: Record<string, unknown>) => {
    void options.logging?.log({
      level,
      message,
      timestamp: new Date().toISOString(),
      verbosity: "normal",
      event: "runtime.comfyui.supervisor.activity",
      component: "comfyui-runtime-supervisor",
      subsystem: "runtime",
      data: details,
    });
  };
  const elapsed = (startedAt: number) => Date.now() - startedAt;

  const appendRuntimeOutput = (text: string, stream?: "stdout" | "stderr") => {
    const normalized = normalizeRuntimeOutput(text);
    if (!normalized) {
      return;
    }

    recentRuntimeOutput.push(normalized);
    if (recentRuntimeOutput.length > 10) {
      recentRuntimeOutput.splice(0, recentRuntimeOutput.length - 10);
    }
    log(stream === "stderr" ? "info" : "debug", "ComfyUI runtime process output.", {
      stream,
      output: normalized,
    });
  };

  const bindRuntimeOutput = (stream: Readable | null | undefined, source: "stdout" | "stderr") => {
    stream?.on("data", (chunk: string | Buffer) => {
      appendRuntimeOutput(chunk.toString(), source);
    });
  };

  const formatStartupFailure = (base: string) => {
    const details = [
      startupFailure,
      recentRuntimeOutput.length > 0 ? `Recent runtime output: ${recentRuntimeOutput.join(" | ")}` : undefined,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    return details.length > 0 ? `${base} ${details.join(" ")}` : base;
  };
  const classifyDependencyMismatchFailure = (): DependencyMismatchClassification => {
    const haystack = [startupFailure, ...recentRuntimeOutput].join(" ").toLowerCase();
    const containsAny = (signals: string[]) => signals.some((signal) => haystack.includes(signal.toLowerCase()));
    const torchaudioSignals = ["torchaudio", "_torchaudio", "winerror 127", "specified procedure could not be found", "torch.ops.load_library", "dll load failed"];
    const torchvisionSignals = ["torchvision", "torchvision import failure", "failed to import torchvision"];
    const directmlSignals = ["torch_directml", "directml", "dml"];

    if (containsAny(torchaudioSignals)) return { isDependencyMismatch: true, reason: "torchaudio", confidence: "high" };
    if (containsAny(torchvisionSignals)) return { isDependencyMismatch: true, reason: "torchvision", confidence: "high" };
    if (containsAny(directmlSignals)) return { isDependencyMismatch: true, reason: "directml", confidence: "medium" };
    if (haystack.includes("dll load failed")) return { isDependencyMismatch: true, reason: "unknown", confidence: "medium" };
    return { isDependencyMismatch: false, reason: "unknown", confidence: "low" };
  };

  const throwStartupFailure = (message: string): never => {
    status = "unhealthy";
    lastCheckAt = Date.now();
    log("error", message, {
      startupFailure,
      recentRuntimeOutput: recentRuntimeOutput.length > 0 ? [...recentRuntimeOutput] : undefined,
    });
    throw new Error(formatStartupFailure(message));
  };

  const assertStartupProcessActive = () => {
    if (!processHandle) {
      throwStartupFailure("ComfyUI runtime exited before health check completed.");
    }
    if (startupFailure && status === "unhealthy") {
      throwStartupFailure("ComfyUI runtime failed during startup.");
    }
  };

  const throwMissingSpawnedProcess = (): never => {
    startupFailure = "ComfyUI runtime process spawn did not return a child process.";
    return throwStartupFailure("ComfyUI runtime failed during startup.");
  };

  return {
    async start() {
      if (processHandle && status !== "stopped") {
        log("info", "ComfyUI runtime start skipped because a process is already active.", {
          status,
          url,
        });
        return;
      }

      let spawnWorkingDirectory = options.workingDirectory;

      if (options.autoInstall === true) {
        const installStartedAt = Date.now();
        log("info", "Ensuring ComfyUI runtime install before start.", { installRoot: options.installRoot });
        if (!options.installRoot?.trim()) {
          throw new Error("ComfyUI install failed: installRoot is required when autoInstall is enabled");
        }
        if (!options.installer) {
          throw new Error("ComfyUI install failed: installer is required when autoInstall is enabled");
        }

        const installResult = await options.installer.ensureInstalled({
          targetId: "comfyui",
          installRoot: options.installRoot,
          source: {
            type: "git",
            repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL,
            ref: options.installSourceRef,
          },
        });

        if (installResult.status !== "installed") {
          log("error", "ComfyUI auto-install failed.", { installRoot: options.installRoot, error: installResult.error });
          if (installResult.error?.code === "unmanaged-install-root") {
            throw new Error(`ComfyUI install failed: The ComfyUI install root is non-empty but is not managed by AI System Builder. Set COMFYUI_INSTALL_ROOT to a managed ComfyUI checkout, set SERVER_RUNTIME_ROOT to a clean runtime directory, or move/delete the unmanaged directory if it is a failed partial install. Destructive repair is intentionally not automatic. [${installResult.error.code}]`);
          }
          throw new Error(`ComfyUI install failed: ${installResult.error?.message ?? "unknown install error"}`);
        }

        spawnWorkingDirectory = options.installRoot;
        log("info", "ComfyUI runtime install check completed before start.", {
          installRoot: options.installRoot,
          status: installResult.status,
          commitSha: installResult.commitSha,
          durationMs: elapsed(installStartedAt),
        });
      }

      const attemptStart = async (attempt: number): Promise<void> => {
        const startStartedAt = Date.now();
        startupFailure = undefined;
        status = "starting";
        lastCheckAt = Date.now();
        const launchArguments = buildComfyUiRuntimeLaunchArguments({ host, port, runtimeDeviceMode });
        log("info", "Starting ComfyUI runtime process.", { attempt, pythonExecutable, launchArguments, spawnWorkingDirectory, host, port, runtimeDeviceMode });
        let spawnedProcessCandidate: ChildProcess | undefined;
        try {
          spawnedProcessCandidate = spawnImplementation(pythonExecutable, launchArguments, {
            cwd: spawnWorkingDirectory,
            env: buildComfyUiRuntimeEnvironment(),
            stdio: "pipe",
          });
        } catch (error) {
          startupFailure = `ComfyUI runtime process failed to start: ${error instanceof Error ? error.message : String(error)}`;
          throwStartupFailure("ComfyUI runtime failed during startup.");
        }
        const spawnedProcess = spawnedProcessCandidate ?? throwMissingSpawnedProcess();
        processHandle = spawnedProcess;
        log("info", "ComfyUI runtime process spawned; polling health endpoint.", {
          attempt,
          url,
          startupTimeoutMs,
          healthCheckIntervalMs,
        });
        bindRuntimeOutput(spawnedProcess.stdout, "stdout");
        bindRuntimeOutput(spawnedProcess.stderr, "stderr");
        spawnedProcess.on("error", (error) => {
          startupFailure = `ComfyUI runtime process failed to start: ${error.message}`;
          status = "unhealthy";
          lastCheckAt = Date.now();
          log("error", "ComfyUI runtime process failed to spawn.", { attempt, error: error instanceof Error ? error.message : String(error), pythonExecutable });
        });

        spawnedProcess.once("exit", (code, signal) => {
          if (status === "starting") {
            startupFailure = `ComfyUI runtime process exited during startup (code=${String(code ?? "null")}, signal=${String(signal ?? "null")}).`;
          }
          processHandle = undefined;
          status = status === "starting" ? "unhealthy" : "stopped";
          lastCheckAt = Date.now();
          log(status === "unhealthy" ? "error" : "info", "ComfyUI runtime process exited.", {
            attempt, code, signal, status, startupFailure,
            recentRuntimeOutput: recentRuntimeOutput.length > 0 ? [...recentRuntimeOutput] : undefined,
          });
        });

        const timeoutAt = Date.now() + startupTimeoutMs;
        let healthCheckAttempts = 0;
        let lastHealthWaitLogAt = 0;
        while (Date.now() < timeoutAt) {
          assertStartupProcessActive();
          healthCheckAttempts += 1;
          try {
            await client.getSystemStats();
            assertStartupProcessActive();
            status = "ready";
            lastCheckAt = Date.now();
            log("info", "ComfyUI runtime is ready.", { attempt, url, healthCheckAttempts, durationMs: elapsed(startStartedAt) });
            return;
          } catch {
            assertStartupProcessActive();
            status = "starting";
            lastCheckAt = Date.now();
            if (Date.now() - lastHealthWaitLogAt >= 10_000) {
              lastHealthWaitLogAt = Date.now();
              log("info", "Waiting for ComfyUI runtime health endpoint.", {
                attempt, url, healthCheckAttempts, elapsedMs: elapsed(startStartedAt), startupTimeoutMs,
                recentRuntimeOutput: recentRuntimeOutput.length > 0 ? [...recentRuntimeOutput] : undefined,
              });
            }
            await delay(healthCheckIntervalMs);
          }
        }

        processHandle?.kill("SIGTERM");
        processHandle = undefined;
        status = "unhealthy";
        lastCheckAt = Date.now();
        log("error", "ComfyUI runtime startup timed out.", {
          attempt, startupTimeoutMs, url, durationMs: elapsed(startStartedAt),
          recentRuntimeOutput: recentRuntimeOutput.length > 0 ? [...recentRuntimeOutput] : undefined,
        });
        throw new Error(formatStartupFailure(`ComfyUI runtime failed to become ready within ${startupTimeoutMs}ms.`));
      };

      recentRuntimeOutput.splice(0, recentRuntimeOutput.length);
      repairAttempted = false;
      try {
        await attemptStart(1);
      } catch (firstError) {
        const classification = classifyDependencyMismatchFailure();
        log("info", "[ai-system-builder][comfyui][supervisor] Dependency mismatch classification result.", {
          classification,
          runtimeDeviceMode,
          startupFailure,
          recentRuntimeOutput: [...recentRuntimeOutput],
        });
        if (!classification.isDependencyMismatch || classification.confidence === "low") {
          throw firstError;
        }
        if (repairAttempted) {
          throw new Error("ComfyUI failed after dependency repair. See logs for details.");
        }
        repairAttempted = true;
        log("error", "[ai-system-builder][comfyui][supervisor] ComfyUI dependency mismatch detected during startup.", {
          attempt: 1, installRoot: options.installRoot, runtimeDeviceMode, classification, startupFailure, recentRuntimeOutput: [...recentRuntimeOutput],
        });
        if (options.autoInstall !== true) {
          throw firstError;
        }
        if (!options.installer?.repairInstall || !options.installRoot?.trim()) {
          throw new Error("ComfyUI dependency mismatch detected, but repair is unavailable.");
        }
        log("info", "[ai-system-builder][comfyui][supervisor] Starting ComfyUI dependency repair.", { attempt: 1, installRoot: options.installRoot, runtimeDeviceMode, repairStrategy: "targeted", reason: classification.reason, recentRuntimeOutput: [...recentRuntimeOutput] });
        const repairResult = await options.installer.repairInstall({
          targetId: "comfyui",
          installRoot: options.installRoot,
          source: { type: "git", repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL, ref: options.installSourceRef },
          allowUpdate: false,
          forceRepair: false,
          metadata: { repairReason: classification.reason, repairConfidence: classification.confidence },
        });
        if (repairResult.status !== "installed") {
          log("error", "[ai-system-builder][comfyui][supervisor] ComfyUI dependency repair failed.", { attempt: 1, installRoot: options.installRoot, runtimeDeviceMode, repairStatus: repairResult.status, repairError: repairResult.error });
          throw new Error(`ComfyUI dependency mismatch detected (torchaudio/torchvision). The system attempted repair but failed. runtimeDeviceMode=${runtimeDeviceMode}`);
        }
        log("info", "[ai-system-builder][comfyui][supervisor] ComfyUI dependency repair succeeded.", { attempt: 1, installRoot: options.installRoot, runtimeDeviceMode, repairStatus: repairResult.status });
        processHandle = undefined;
        startupFailure = undefined;
        recentRuntimeOutput.splice(0, recentRuntimeOutput.length);
        log("info", "[ai-system-builder][comfyui][supervisor] Retrying ComfyUI startup after dependency repair.", { attempt: 2, installRoot: options.installRoot, runtimeDeviceMode });
        try {
          await attemptStart(2);
          log("info", "[ai-system-builder][comfyui][supervisor] ComfyUI retry startup succeeded after dependency repair.", { attempt: 2, installRoot: options.installRoot, runtimeDeviceMode });
        } catch (retryError) {
          log("error", "[ai-system-builder][comfyui][supervisor] ComfyUI retry startup failed after dependency repair.", {
            attempt: 2, installRoot: options.installRoot, runtimeDeviceMode, startupFailure, recentRuntimeOutput: [...recentRuntimeOutput],
          });
          throw new Error("ComfyUI failed after dependency repair. See logs for details.");
        }
      }
    },
    getRecentRuntimeOutput() {
      return [...recentRuntimeOutput];
    },
    getRuntimeDeviceMode() {
      return runtimeDeviceMode;
    },

    isRunning() {
      return Boolean(processHandle) && status !== "stopped";
    },

    getStatus() {
      return status;
    },

    async getHealth() {
      if (!processHandle || status === "stopped") {
        return { status: "stopped", url, port, lastCheckAt };
      }

      try {
        await client.getSystemStats();
        status = "ready";
      } catch {
        status = status === "starting" ? "starting" : "unhealthy";
      }
      lastCheckAt = Date.now();
      return { status, url, port, lastCheckAt };
    },

    async stop() {
      if (!processHandle) {
        status = "stopped";
        lastCheckAt = Date.now();
        return;
      }

      const processToStop = processHandle;
      const stopped = waitForProcessExit(processToStop);
      processToStop.kill("SIGTERM");
      await stopped;
      processHandle = undefined;
      status = "stopped";
      lastCheckAt = Date.now();
    },
  };
}

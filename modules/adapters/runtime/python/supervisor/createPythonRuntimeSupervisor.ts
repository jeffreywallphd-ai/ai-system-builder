import { ChildProcess, spawn, type SpawnOptions } from "node:child_process";
import { platform } from "node:os";
import { randomBytes } from "node:crypto";
import { createOwnedPythonRuntimeProof } from "./ownedPythonRuntimeProof";
import { terminateOwnedProcess } from "../../shared/terminateOwnedProcess";
import path from "node:path";
import {types} from "node:util";
import {captureOriginalWorkerResourceProfile, createWindowsOriginalWorkerLaunch,
  type ManagedOriginalPythonWorker, type WindowsOriginalWorkerResourceProfile} from "./windowsOriginalWorkerLaunch";

import type { PythonRuntimeHttpClient } from "../client/createPythonRuntimeHttpClient";
import type { PythonStartupEvent } from "../pythonRuntimeStartupDiagnostics";

export type PythonRuntimeSupervisorStatus =
  "stopped" | "starting" | "ready" | "failed";

export interface PythonRuntimeSupervisorEvent {
  type:
    | "start-requested"
    | "start-skipped"
    | "attached"
    | "spawned"
    | "owned-ready"
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
  /** Host-only restrictive path. Absence is not permission to call start(). */
  startWithoutInstalling?(): Promise<void>;
  /** Private original-child capability. HTTP identity alone cannot supply it. */
  captureOriginalWorkerRetirement?(): OriginalPythonWorkerRetirement;
  /** Strict resource-bound path. Never falls back to a plain child. */
  captureOriginalTrainingWorkerRetirement?(): OriginalPythonWorkerRetirement;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): PythonRuntimeSupervisorStatus;
}

export interface OriginalPythonWorkerRetirement {
  assertCurrent(): void;
  /** At most one termination attempt; later calls observe the same close. */
  retireOriginal(): Promise<boolean>;
  /** Positive original no-effect preparation only; never stops the worker. */
  releaseUnused(): void;
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
    startupToken?: object;
  }) => void | Promise<void>;
  verifyRuntimeEnvironment?: (context: {
    command: string;
    args: readonly string[];
    cwd?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<boolean>;
  prepareLaunchEnvironment?: (context: {
    command: string;
    args: readonly string[];
    cwd?: string;
    env: NodeJS.ProcessEnv;
  }) => void | Promise<void>;
  startupTimeoutMs?: number;
  /** Managed foundations require current child bind proof; HTTP is not identity. */
  requireOwnedStartupProof?: boolean;
  /** Trusted boot-only configuration; no production limits are inferred. */
  nativeWorkerResourceProfile?: WindowsOriginalWorkerResourceProfile;
  /** Adapter platform dependency; production uses the actual Node platform. */
  nativePlatform?: () => {platform: NodeJS.Platform; arch: string};
  /** Trusted owning-host lifetime, never request metadata or a readiness flag. */
  assertHostCurrent?: () => void;
  healthCheckIntervalMs?: number;
  runtimeClient: Pick<PythonRuntimeHttpClient, "getHealthStatus"> &
    Partial<Pick<PythonRuntimeHttpClient, "getCapabilities">>;
  requiredCapabilities?: readonly string[];
  spawnImplementation?: typeof spawn;
  onEvent?: (event: PythonRuntimeSupervisorEvent) => void;
  onStartupEvent?: (event: PythonStartupEvent) => unknown;
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
  const nativeSelection = options.nativeWorkerResourceProfile;
  const nativeProfile = nativeSelection === undefined ? undefined : captureOriginalWorkerResourceProfile(nativeSelection);
  const nativePlatform = options.nativePlatform ?? (() => ({platform: process.platform, arch: process.arch}));
  const hostAdmission = options.assertHostCurrent;
  const assertHostCurrent = () => {
    const result: unknown = hostAdmission?.call(options);
    if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
    if (result !== undefined) throw new Error("Python host admission is unavailable.");
  };
  const requireOwnedStartupProof = options.requireOwnedStartupProof === true || nativeProfile !== undefined;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? 100;
  const spawnImplementation = options.spawnImplementation ?? spawn;
  const requiredCapabilities = [...(options.requiredCapabilities ?? [])];
  const runtimeEnvironment: NodeJS.ProcessEnv = { ...(options.env ?? process.env) };
  const configuredCommand = options.command;
  const configuredArgs = options.args ? [...options.args] : undefined;
  const workingDirectory = options.cwd;
  const prepareRuntimeEnvironment = options.prepareRuntimeEnvironment;
  const verifyRuntimeEnvironment = options.verifyRuntimeEnvironment;
  const prepareLaunchEnvironment = options.prepareLaunchEnvironment;
  const runtimeClient = {
    getHealthStatus: options.runtimeClient.getHealthStatus.bind(options.runtimeClient),
    getCapabilities: options.runtimeClient.getCapabilities?.bind(options.runtimeClient),
  };
  const onEvent = options.onEvent;
  let startupObserver: CreatePythonRuntimeSupervisorOptions["onStartupEvent"];
  try { const observer = options.onStartupEvent; if (typeof observer === "function") startupObserver = observer; } catch { /* Optional observer. */ }

  let childProcess: ChildProcess | undefined;
  let boundReadyProcess: ChildProcess | undefined;
  let managedWorker: ManagedOriginalPythonWorker | undefined, boundReadyManaged: ManagedOriginalPythonWorker | undefined;
  let managedStopping = false, managedClaim: OriginalPythonWorkerRetirement | undefined;
  type WorkerClose = {closed: boolean; observers: Set<() => void>; retirement?: OriginalPythonWorkerRetirement};
  const workerCloses = new WeakMap<ChildProcess, WorkerClose>();
  // Keep the original claim after exit clears childProcess. Exit is not close.
  let privateWorkerClaim: {process: ChildProcess; close: WorkerClose; attempted: boolean;
    capability: OriginalPythonWorkerRetirement} | undefined;
  let startupToken: object | undefined;
  const observeStartup = (type: PythonStartupEvent["type"], token = startupToken) => {
    if (!token) return;
    try { void Promise.resolve(startupObserver?.({ token, type })).catch(() => {}); } catch { /* Passive observer. */ }
  };
  let startFlight: Promise<void> | undefined;
  let startGeneration: number | undefined;
  let startPolicy: "ordinary" | "installed-only" | undefined;
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

  const applyChildExitBinding = (processHandle: ChildProcess, proof?: ReturnType<typeof createOwnedPythonRuntimeProof>) => {
    const close: WorkerClose = {closed: false, observers: new Set()};
    workerCloses.set(processHandle, close);
    processHandle.once("close", () => {
      close.closed = true;
      for (const observer of close.observers) observer();
      close.observers.clear();
    });
    const onTerminal = (code: number | null, signal: NodeJS.Signals | null) => {
      if (childProcess !== processHandle) return;
      const exitDetail = `Python runtime process exited during lifecycle (code=${String(code ?? "null")}, signal=${String(signal ?? "null")}).`;
      const startupFailed = status === "failed";
      if (!startupFailed) lastStartupFailure = exitDetail;
      childProcess = undefined;
      boundReadyProcess = undefined;
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
        if (source === "stdout" && status === "starting" && processHandle.exitCode == null && processHandle.signalCode == null
          && proof?.push(chunk) && boundReadyProcess !== processHandle) {
          boundReadyProcess = processHandle;
          emitEvent("owned-ready", "The owned Python worker confirmed its listening socket.");
        }
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
    const command = configuredCommand.trim();
    return command.length > 0 ? command : getDefaultCommand();
  };

  const resolveArgs = () => {
    if (configuredArgs && configuredArgs.length > 0) {
      return [...configuredArgs];
    }

    return ["main.py"];
  };

  const hasRuntimeExited = () => {
    return (
      (!childProcess && !managedWorker && !attachedToExistingRuntime) || status === "stopped"
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
      const health = await runtimeClient.getHealthStatus();
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

    if (typeof runtimeClient.getCapabilities !== "function") {
      return [...requiredCapabilities];
    }

    const capabilities = await runtimeClient.getCapabilities!();
    const advertised = new Set(capabilities.capabilities);
    return requiredCapabilities.filter(
      (capability) => !advertised.has(capability),
    );
  };

  const startHealthPolling = async (assertCurrent: () => void, assertOriginal: () => void, isBound: () => boolean) => {
    const assertOwned = () => {
      assertCurrent();
      assertOriginal();
      assertRuntimeStillStarting();
    };
    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      assertOwned();
      if (requireOwnedStartupProof && !isBound()) {
        await delay(healthCheckIntervalMs);
        continue;
      }
      try {
        const health = await runtimeClient.getHealthStatus();
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

  const start = async (policy: "ordinary" | "installed-only") => {
      const installedOnly = policy === "installed-only" || nativeProfile !== undefined;
      if (installedOnly && !verifyRuntimeEnvironment)
        throw new Error("Installed Python runtime verification is unavailable.");
      if (stopFlight) throw new Error("Python runtime is stopping; retry after confirmed termination.");
      if (privateWorkerClaim && !privateWorkerClaim.close.closed &&
          (privateWorkerClaim.attempted || childProcess !== privateWorkerClaim.process))
        throw new Error("Original training worker closure is still unconfirmed.");
      if (startFlight) {
        if (startGeneration !== lifecycleGeneration) throw new Error("Previous Python runtime startup is still stopping.");
        if (startPolicy !== policy) throw new Error("Python runtime startup authority differs from the active attempt.");
        return startFlight;
      }
      const generation = lifecycleGeneration;
      let operationToken: object | undefined;
      const assertCurrent = () => { if (generation !== lifecycleGeneration) throw new Error("Python runtime startup was stopped."); };
      const operation = (async () => {
      if (installedOnly) {
        let verified = false;
        try { verified = await verifyRuntimeEnvironment!({command: resolveCommand(), args: Object.freeze(resolveArgs()),
          cwd: workingDirectory, env: { ...runtimeEnvironment }}); } catch { /* Closed refusal, without private probe output. */ }
        assertCurrent();
        if (verified !== true) throw new Error("Installed Python runtime verification is unavailable.");
      }
      if ((childProcess || managedWorker) && status === "failed") throw new Error("Python runtime startup failed; stop the owned process before retrying.");
      if ((childProcess || managedWorker) && status !== "stopped") {
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
        observeStartup("unavailable");
        throw new Error("Externally attached Python worker is unavailable; external termination must be confirmed before replacement.");
      }

      lastHealthProbeError = undefined;
      healthProbeFailureCount = 0;
      lastEmittedHealthProbeError = undefined;
      lastStartupFailure = undefined;
      incompatibleExistingRuntimeFailure = undefined;
      recentRuntimeOutput.splice(0, recentRuntimeOutput.length);

      const command = resolveCommand();
      const args = Object.freeze(resolveArgs());
      const launchEnvironment = { ...runtimeEnvironment };
      operationToken = startupToken = {};
      observeStartup("begin", operationToken);
      emitEvent("start-requested", "Starting Python runtime process.", {
        commandKind:
          command === "python" || command === "python3" ? command : "custom",
        argumentCount: args.length,
        workingDirectoryConfigured: Boolean(workingDirectory),
      });
      maybeWarnOnWindowsCommand(command);

      status = "starting";
      observeStartup("health", operationToken);
      if (!requireOwnedStartupProof && await tryAttachToExistingRuntime(assertCurrent)) {
        assertCurrent();
        observeStartup("ready", operationToken);
        return;
      }
      assertCurrent();
      if (incompatibleExistingRuntimeFailure) {
        throwStartupFailure(
          `${incompatibleExistingRuntimeFailure} Stop the existing Python runtime or use a different PYTHON_RUNTIME_BASE_URL/PYTHON_RUNTIME_PORT before starting a new worker.`,
        );
      }

      if (!installedOnly && prepareRuntimeEnvironment) {
        try {
          await prepareRuntimeEnvironment({
            command,
            args,
            cwd: workingDirectory,
            env: { ...launchEnvironment },
            startupToken: operationToken,
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
      observeStartup("launch", operationToken);
      if (prepareLaunchEnvironment) {
        try {
          await prepareLaunchEnvironment({
            command,
            args,
            cwd: workingDirectory,
            env: launchEnvironment,
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
      const ownedNonce = requireOwnedStartupProof ? randomBytes(32).toString("hex") : undefined;
      const ownedProof = ownedNonce ? createOwnedPythonRuntimeProof(ownedNonce, {
        host: runtimeEnvironment.PYTHON_RUNTIME_HOST ?? "", port: runtimeEnvironment.PYTHON_RUNTIME_PORT ?? "",
      }) : undefined;
      if (ownedNonce) launchEnvironment.PYTHON_RUNTIME_STARTUP_PROOF = ownedNonce;
      boundReadyProcess = undefined;
      boundReadyManaged = undefined;
      if (nativeProfile) {
        const platformValue: unknown = nativePlatform.call(options);
        if (types.isPromise(platformValue)) void Promise.prototype.then.call(platformValue, undefined, () => {});
        const platformFacts = platformValue && typeof platformValue === "object" && !types.isProxy(platformValue) ?
          Object.getOwnPropertyDescriptors(platformValue) : {};
        if (Object.keys(platformFacts).length !== 2 || platformFacts.platform?.value !== "win32" || platformFacts.arch?.value !== "x64" || !workingDirectory ||
            args.length !== 1 || path.resolve(workingDirectory, args[0]!) !== path.resolve(workingDirectory, "main.py"))
          throw new Error("The configured native Python worker is unavailable.");
        assertHostCurrent();
        const owner = managedWorker = createWindowsOriginalWorkerLaunch({command, cwd: workingDirectory,
          environment: launchEnvironment, profile: nativeProfile, spawnImplementation,
          nativePlatform: () => ({platform: "win32", arch: "x64"}),
          assertHostCurrent: () => {assertCurrent(); assertHostCurrent(); assertCurrent();}});
        managedStopping = false; managedClaim = undefined;
        owner.onUnavailable(() => {
          if (managedWorker !== owner) return;
          boundReadyManaged = undefined;
          status = "failed";
          if (!managedStopping) emitEvent("process-error", "Original managed Python worker readiness was lost.");
        });
        owner.onRetired(() => {
          if (managedWorker !== owner) return;
          managedWorker = undefined; boundReadyManaged = undefined; status = "stopped";
          emitEvent("process-exit", "Original managed Python worker and Job retired.");
        });
        for (const source of ["stdout", "stderr"] as const) owner[source].on("data", (chunk: Buffer) => {
          if (managedWorker !== owner) return;
          if (source === "stdout" && status === "starting" && ownedProof?.push(chunk) && boundReadyManaged !== owner) {
            try {owner.assertCurrent(); boundReadyManaged = owner; emitEvent("owned-ready", "The original managed Python worker confirmed its listening socket.");}
            catch {status = "failed";}
          }
          const summary = appendRuntimeOutput(source, chunk.toString());
          if (summary) emitEvent("stdio", summary, {source, truncated: chunk.length > 16 * 1024});
        });
        await owner.prepare(); assertCurrent();
        await owner.resume(); assertCurrent();
        emitEvent("spawned", "Original managed Python worker resumed under configured limits.");
        observeStartup("health", operationToken);
        await startHealthPolling(assertCurrent, () => {
          if (managedWorker !== owner) throw new Error("Original managed Python worker is unavailable.");
          owner.assertCurrent();
        }, () => boundReadyManaged === owner);
        assertCurrent(); observeStartup("ready", operationToken); return;
      }
      try {
        attachedToExistingRuntime = false;
        childProcess = spawnImplementation(command, args, {
          cwd: workingDirectory,
          env: launchEnvironment,
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
      applyChildExitBinding(childProcess, ownedProof);
      emitEvent("spawned", "Python runtime process spawned.");

      observeStartup("health", operationToken);
      const owner = childProcess;
      await startHealthPolling(assertCurrent, () => {
        if (childProcess !== owner || owner.exitCode != null || owner.signalCode != null)
          throw new Error("Python runtime exited before health check completed.");
      }, () => boundReadyProcess === owner);
      assertCurrent();
      observeStartup("ready", operationToken);
      })();
      startFlight = operation;
      startGeneration = generation;
      startPolicy = policy;
      try { await operation; } catch (error) {
        if (operationToken) observeStartup("failed", operationToken);
        if (nativeProfile) {
          if (generation === lifecycleGeneration && status === "starting") {
            status = "failed";
            lastStartupFailure = "The configured native Python worker is unavailable.";
          }
          throw new Error("The configured native Python worker is unavailable.");
        }
        throw error;
      }
      finally { if (startFlight === operation) { startFlight = undefined; startGeneration = undefined; startPolicy = undefined; } }
  };

  const retireManaged = (owner: ManagedOriginalPythonWorker, retire: () => Promise<boolean>) => {
    if (managedWorker === owner && !managedStopping) {
      managedStopping = true; lifecycleGeneration++; boundReadyManaged = undefined; status = "failed";
      observeStartup("retired"); emitEvent("stop-requested", "Stopping the original managed Python worker and Job.");
    }
    return retire();
  };
  const captureManagedRetirement = (): OriginalPythonWorkerRetirement => {
    const owner = managedWorker;
    if (!owner || managedStopping || boundReadyManaged !== owner || status !== "ready" || stopFlight || startFlight)
      throw new Error("Original managed training worker ownership is unavailable.");
    owner.assertCurrent();
    if (managedClaim) {managedClaim.assertCurrent(); return managedClaim;}
    const generation = lifecycleGeneration, originalCurrent = owner.assertCurrent.bind(owner), retire = owner.retireOriginal.bind(owner);
    let active = true;
    const current = () => {
      if (!active || managedWorker !== owner || generation !== lifecycleGeneration || managedStopping ||
          boundReadyManaged !== owner || status !== "ready") throw new Error("Original managed training worker ownership is unavailable.");
      originalCurrent();
    };
    const claim: OriginalPythonWorkerRetirement = Object.freeze({assertCurrent: current,
      releaseUnused() {
        current(); active = false;
        if (managedClaim === claim) managedClaim = undefined;
        // This disarms only the training lease, never the launch/Job owner.
      },
      retireOriginal() {return active ? retireManaged(owner, retire) : Promise.resolve(false);},
    });
    managedClaim = claim; return claim;
  };

  return {
    start: () => start("ordinary"),
    startWithoutInstalling: () => start("installed-only"),

    captureOriginalTrainingWorkerRetirement: captureManagedRetirement,

    captureOriginalWorkerRetirement() {
      if (nativeProfile) return captureManagedRetirement();
      const owner = childProcess, close = owner && workerCloses.get(owner);
      const unavailable = () => new Error("Original training worker ownership is unavailable.");
      if (!requireOwnedStartupProof || !owner || !close || close.closed || status !== "ready" ||
          boundReadyProcess !== owner || owner.exitCode != null || owner.signalCode != null || stopFlight || startFlight)
        throw unavailable();
      if (close.retirement) {close.retirement.assertCurrent(); return close.retirement;}
      const generation = lifecycleGeneration, kill = owner.kill.bind(owner);
      let active = true, flight: Promise<boolean> | undefined;
      const claim = {process: owner, close, attempted: false, capability: undefined as unknown as OriginalPythonWorkerRetirement};
      const assertCurrent = () => {
        if (!active || claim.attempted || close.closed || privateWorkerClaim !== claim || childProcess !== owner ||
            boundReadyProcess !== owner || lifecycleGeneration !== generation || status !== "ready" ||
            owner.exitCode != null || owner.signalCode != null) throw unavailable();
      };
      const observeClose = () => close.closed ? Promise.resolve(true) : new Promise<boolean>(resolve => {
        let timer: ReturnType<typeof setTimeout>;
        const finished = () => {clearTimeout(timer); close.observers.delete(finished); resolve(true);};
        close.observers.add(finished);
        timer = setTimeout(() => {close.observers.delete(finished); resolve(close.closed);}, 5_000);
        if (close.closed) finished();
      });
      const capability: OriginalPythonWorkerRetirement = Object.freeze({assertCurrent,
        releaseUnused() {
          assertCurrent(); active = false;
          if (close.retirement === capability) close.retirement = undefined;
          if (privateWorkerClaim === claim) privateWorkerClaim = undefined;
        },
        retireOriginal() {
          if (!active) return Promise.resolve(false);
          if (close.closed) return Promise.resolve(true);
          if (flight) return flight;
          const first = !claim.attempted;
          if (first) {
            try {assertCurrent();} catch {return Promise.resolve(false);}
            claim.attempted = true;
            lifecycleGeneration++; boundReadyProcess = undefined; status = "failed";
          }
          // Publish before diagnostics/kill callbacks can reenter supervisor.stop.
          const operation = Promise.resolve().then(() => {
            if (first) {
              observeStartup("retired");
              emitEvent("stop-requested", "Stopping the original training worker.");
              try {if (!kill("SIGTERM")) return close.closed;} catch {return close.closed;}
            }
            return observeClose();
          });
          flight = operation;
          void operation.finally(() => {if (flight === operation) flight = undefined;});
          return operation;
        },
      });
      claim.capability = capability; close.retirement = capability; privateWorkerClaim = claim;
      return capability;
    },

    async stop() {
      if (stopFlight) return stopFlight;
      if (managedWorker) {
        const owner = managedWorker, retire = owner.retireOriginal.bind(owner);
        const operation = Promise.resolve().then(async () => {
          if (await retireManaged(owner, retire) !== true) throw new Error("Original managed worker and Job retirement is unconfirmed.");
        });
        stopFlight = operation;
        try {await operation;} finally {if (stopFlight === operation) stopFlight = undefined;}
        return;
      }
      const original = childProcess ? workerCloses.get(childProcess)?.retirement :
        privateWorkerClaim && !privateWorkerClaim.close.closed ? privateWorkerClaim.capability : undefined;
      if (original) {
        const retire = original.retireOriginal.bind(original);
        const operation = Promise.resolve().then(async () => {
          if (await retire() !== true) throw new Error("Original training worker closure is still unconfirmed.");
        });
        stopFlight = operation;
        try {await operation;} finally {if (stopFlight === operation) stopFlight = undefined;}
        return;
      }
      observeStartup("retired");
      lifecycleGeneration++;
      boundReadyProcess = undefined;
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

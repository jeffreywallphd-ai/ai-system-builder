#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createVisualComposerQualificationRunId,
  resolveVisualComposerQualificationPaths,
  sanitizeVisualComposerQualificationDiagnostic,
} from "./visual-composer-qualification-core.mjs";

export const DEFAULT_VISUAL_COMPOSER_SERVER_PORT = 43_170;
export const DEFAULT_VISUAL_COMPOSER_THIN_CLIENT_PORT = 43_171;
export const DEFAULT_VISUAL_COMPOSER_RUNTIME_PORT = 43_172;
export const DEFAULT_VISUAL_COMPOSER_STARTUP_TIMEOUT_MS = 30_000;
export const DEFAULT_VISUAL_COMPOSER_SHUTDOWN_TIMEOUT_MS = 5_000;
export const VISUAL_COMPOSER_PROCESS_LOG_LIMIT = 16_000;

const LOOPBACK_HOST = "127.0.0.1";
const SERVER_ENTRY_RELATIVE_PATH = path.join(
  "dev-tools",
  "scripts",
  "qualification",
  "visual-composer",
  "visual-composer-server-entry.ts",
);
const THIN_CLIENT_RELATIVE_PATH = path.join("apps", "thin-client");
const VITE_CLI_RELATIVE_PATH = path.join(
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const DESKTOP_IDENTITY_SEED_RELATIVE_PATH = path.join(
  "dev-tools",
  "scripts",
  "qualification",
  "visual-composer",
  "visual-composer-desktop-seed.ts",
);
const CONTROLLED_CONVERSATION_WORKER_RELATIVE_PATH = path.join(
  "dev-tools",
  "scripts",
  "qualification",
  "visual-composer",
  "controlled-conversation-runtime-worker.mjs",
);

export function getVisualComposerRepositoryRoot(scriptUrl = import.meta.url) {
  return path.resolve(
    path.dirname(fileURLToPath(scriptUrl)),
    "..",
    "..",
    "..",
    "..",
  );
}

export function createVisualComposerHostLaunchPlan(options = {}) {
  const repoRoot = path.resolve(
    options.repoRoot ?? getVisualComposerRepositoryRoot(),
  );
  const runId =
    options.runId ?? createVisualComposerQualificationRunId(options.now);
  const serverPort = normalizePort(
    options.serverPort,
    DEFAULT_VISUAL_COMPOSER_SERVER_PORT,
    "server",
  );
  const thinClientPort = normalizePort(
    options.thinClientPort,
    DEFAULT_VISUAL_COMPOSER_THIN_CLIENT_PORT,
    "thin client",
  );
  const runtimePort = normalizePort(
    options.runtimePort,
    DEFAULT_VISUAL_COMPOSER_RUNTIME_PORT,
    "controlled runtime",
  );
  if (new Set([serverPort, thinClientPort, runtimePort]).size !== 3) {
    throw new Error("Visual composer qualification ports must be different.");
  }

  const paths = resolveVisualComposerQualificationPaths(repoRoot, runId);
  const serverOrigin = new URL(`http://${LOOPBACK_HOST}:${serverPort}`);
  const thinClientOrigin = new URL(`http://${LOOPBACK_HOST}:${thinClientPort}`);
  const baseEnvironment = normalizeEnvironment(
    options.environment ?? process.env,
  );
  const serverEnvironment = createServerEnvironment(
    baseEnvironment,
    paths,
    serverPort,
  );
  const thinClientEnvironment = createThinClientEnvironment(
    baseEnvironment,
    serverOrigin,
  );
  const desktopExecutablePath = path.resolve(
    options.desktopExecutablePath ??
      baseEnvironment.VISUAL_COMPOSER_DESKTOP_EXECUTABLE ??
      path.join(
        repoRoot,
        "out",
        "ai-system-builder-win32-x64",
        "ai-system-builder.exe",
      ),
  );
  const electronNodeExecutablePath = path.resolve(
    options.electronNodeExecutablePath ??
      path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe"),
  );
  const desktopEnvironment = {
    ...baseEnvironment,
    VISUAL_COMPOSER_DESKTOP_DATA_ROOT: paths.desktopDataRoot,
    PYTHON_RUNTIME_BASE_URL: `http://${LOOPBACK_HOST}:${runtimePort}`,
    PYTHON_RUNTIME_HOST: LOOPBACK_HOST,
    PYTHON_RUNTIME_PORT: String(runtimePort),
    PYTHON_RUNTIME_COMMAND: process.execPath,
    PYTHON_RUNTIME_ARGS:
      CONTROLLED_CONVERSATION_WORKER_RELATIVE_PATH.replaceAll("\\", "/"),
    PYTHON_RUNTIME_WORKER_DIR: repoRoot,
    PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000",
  };

  return {
    repoRoot,
    runId,
    paths,
    serverOrigin,
    thinClientOrigin,
    runtimeOrigin: new URL(`http://${LOOPBACK_HOST}:${runtimePort}`),
    server: {
      command: process.execPath,
      args: [
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        "--import",
        "tsx",
        path.join(repoRoot, SERVER_ENTRY_RELATIVE_PATH),
      ],
      cwd: repoRoot,
      env: serverEnvironment,
    },
    thinClient: {
      command: process.execPath,
      args: [
        "--preserve-symlinks",
        "--preserve-symlinks-main",
        path.join(repoRoot, VITE_CLI_RELATIVE_PATH),
        "--configLoader",
        "runner",
        "--host",
        LOOPBACK_HOST,
        "--port",
        String(thinClientPort),
        "--strictPort",
      ],
      cwd: path.join(repoRoot, THIN_CLIENT_RELATIVE_PATH),
      env: thinClientEnvironment,
    },
    desktop: {
      executablePath: desktopExecutablePath,
      args: [`--user-data-dir=${paths.desktopDataRoot}`, "--disable-gpu"],
      env: desktopEnvironment,
      seed: {
        command: electronNodeExecutablePath,
        args: [
          "--preserve-symlinks",
          "--preserve-symlinks-main",
          "--import",
          "tsx",
          path.join(repoRoot, DESKTOP_IDENTITY_SEED_RELATIVE_PATH),
        ],
        cwd: repoRoot,
        env: {
          ...desktopEnvironment,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
    },
  };
}

export async function startVisualComposerHostLifecycle(options = {}) {
  const launchPlan =
    options.launchPlan ?? createVisualComposerHostLaunchPlan(options);
  const spawnProcess = options.spawnProcess ?? spawn;
  const request = options.request ?? requestHttpStatus;
  const timeoutMs =
    options.startupTimeoutMs ?? DEFAULT_VISUAL_COMPOSER_STARTUP_TIMEOUT_MS;
  const logger = options.logger ?? (() => undefined);

  assertLoopbackOrigin(launchPlan.serverOrigin);
  assertLoopbackOrigin(launchPlan.thinClientOrigin);
  await assertTcpPortAvailable(launchPlan.serverOrigin, options);
  await assertTcpPortAvailable(launchPlan.thinClientOrigin, options);
  mkdirSync(
    launchPlan.paths.serverStorageRoot ?? launchPlan.paths.thinStorageRoot,
    {
      recursive: true,
    },
  );
  mkdirSync(launchPlan.paths.thinRuntimeRoot, { recursive: true });

  const children = [];
  try {
    const server = startOwnedProcess("server", launchPlan.server, spawnProcess);
    children.push(server);
    await waitForVisualComposerEndpoint(
      new URL("/health/live", launchPlan.serverOrigin),
      {
        request,
        timeoutMs,
        child: server.child,
        diagnostics: server.output,
        repoRoot: launchPlan.repoRoot,
        userRoot: options.userRoot,
      },
    );
    await enableVisualComposerTokenEnforcement(launchPlan.serverOrigin);

    const thinClient = startOwnedProcess(
      "thin-client",
      launchPlan.thinClient,
      spawnProcess,
    );
    children.push(thinClient);
    await waitForVisualComposerEndpoint(launchPlan.thinClientOrigin, {
      request,
      timeoutMs,
      child: thinClient.child,
      diagnostics: thinClient.output,
      repoRoot: launchPlan.repoRoot,
      userRoot: options.userRoot,
    });
    logger({
      event: "visual-composer-hosts-ready",
      serverOrigin: launchPlan.serverOrigin.origin,
      thinClientOrigin: launchPlan.thinClientOrigin.origin,
    });

    let stopped = false;
    return {
      ...launchPlan,
      async stop() {
        if (stopped) return;
        stopped = true;
        await stopOwnedProcesses(children, options);
      },
    };
  } catch (error) {
    await stopOwnedProcesses(children, options);
    throw error;
  }
}

export async function waitForVisualComposerEndpoint(endpoint, options = {}) {
  const target = endpoint instanceof URL ? endpoint : new URL(endpoint);
  assertLoopbackOrigin(target);
  const request = options.request ?? requestHttpStatus;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_VISUAL_COMPOSER_STARTUP_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  let lastDiagnostic = "Endpoint did not respond.";

  while (now() <= deadline) {
    if (
      options.child &&
      (options.child.exitCode !== null || options.child.signalCode !== null)
    ) {
      throw hostStartupError(
        target,
        "Host process exited before it became ready.",
        options,
      );
    }
    try {
      const status = await request(target, {
        timeoutMs: Math.min(2_000, Math.max(1, deadline - now())),
      });
      if (status >= 200 && status < 400) return status;
      lastDiagnostic = `Endpoint returned HTTP ${status}.`;
    } catch (error) {
      lastDiagnostic =
        error instanceof Error ? error.message : "Endpoint request failed.";
    }
    if (now() >= deadline) break;
    await sleep(Math.min(200, Math.max(1, deadline - now())));
  }

  throw hostStartupError(target, lastDiagnostic, options);
}

export function createBoundedProcessOutput(
  maximumCharacters = VISUAL_COMPOSER_PROCESS_LOG_LIMIT,
) {
  let output = "";
  return {
    append(value) {
      output = `${output}${String(value)}`.slice(-maximumCharacters);
    },
    read() {
      return output;
    },
  };
}

export async function stopVisualComposerOwnedProcess(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const timeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_VISUAL_COMPOSER_SHUTDOWN_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const waitForExit = waitForChildExit(child);

  if (platform === "win32") {
    if (Number.isInteger(child.pid) && child.pid > 0) {
      const terminateTree =
        options.terminateWindowsTree ?? terminateWindowsTree;
      terminateTree(child.pid);
    } else {
      child.kill("SIGTERM");
    }
  } else if (child.pid && options.detached !== false) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }

  if (await settleWithin(waitForExit, timeoutMs)) return;
  if (platform === "win32") {
    try {
      child.kill("SIGKILL");
    } catch {
      // The owned process may have exited between the timeout and fallback.
    }
  } else {
    try {
      if (child.pid && options.detached !== false) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
  }
  await settleWithin(waitForExit, Math.min(1_000, timeoutMs));
}

function createServerEnvironment(baseEnvironment, paths, serverPort) {
  const environment = {
    ...baseEnvironment,
    NODE_ENV: "development",
    PORT: String(serverPort),
    SERVER_STORAGE_ROOT: paths.thinStorageRoot,
    SERVER_RUNTIME_ROOT: paths.thinRuntimeRoot,
    AI_SYSTEM_BUILDER_SECURITY_MODE: "disabled-dev",
    AI_SYSTEM_BUILDER_HTTPS_ENABLED: "false",
    AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED: "true",
    AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE: "dedicated",
    AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID: "qualification.local",
  };
  for (const key of [
    "DEPLOYMENT_SHAPE",
    "AI_SYSTEM_BUILDER_DATABASE_URL",
    "DATABASE_URL",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
  ]) {
    delete environment[key];
  }
  return environment;
}

async function enableVisualComposerTokenEnforcement(serverOrigin) {
  const response = await fetch(
    new URL("/api/security/dev-mode", serverOrigin),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "lan-token-enforced" }),
    },
  );
  if (!response.ok) {
    throw new Error(
      "Visual composer qualification could not enable controlled token enforcement.",
    );
  }
}

function createThinClientEnvironment(baseEnvironment, serverOrigin) {
  return {
    ...baseEnvironment,
    NODE_ENV: "development",
    AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false",
    AI_SYSTEM_BUILDER_HTTPS_ENABLED: "false",
    AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: serverOrigin.origin,
  };
}

function normalizeEnvironment(environment) {
  if (process.platform !== "win32") return { ...environment };
  const normalized = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(environment)) {
    const normalizedKey = key.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    normalized[key] = value;
  }
  return normalized;
}

function normalizePort(value, fallback, label) {
  const port = value ?? fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Visual composer qualification ${label} port is invalid.`);
  }
  return port;
}

function startOwnedProcess(label, command, spawnProcess) {
  const output = createBoundedProcessOutput();
  const child = spawnProcess(command.command, command.args, {
    cwd: command.cwd,
    env: command.env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => output.append(value));
  child.stderr?.on("data", (value) => output.append(value));
  child.once("error", (error) => output.append(error.message));
  return { label, child, output };
}

async function stopOwnedProcesses(children, options) {
  for (const owned of [...children].reverse()) {
    await stopVisualComposerOwnedProcess(owned.child, options);
  }
}

async function assertTcpPortAvailable(origin, options = {}) {
  if (options.skipPortCheck) return;
  const check = options.checkPort ?? checkTcpPortAvailable;
  if (!(await check(Number(origin.port), origin.hostname))) {
    throw new Error(
      `Visual composer qualification port ${origin.port} is already in use.`,
    );
  }
}

function checkTcpPortAvailable(port, host) {
  return new Promise((resolveCheck, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolveCheck(false);
        return;
      }
      reject(error);
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolveCheck(true);
      });
    });
  });
}

async function requestHttpStatus(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 2_000,
  );
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

function assertLoopbackOrigin(origin) {
  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  ) {
    throw new Error(
      "Visual composer qualification hosts must use loopback HTTP origins.",
    );
  }
}

function hostStartupError(endpoint, diagnostic, options) {
  const processOutput = options.diagnostics?.read()?.trim();
  const details = sanitizeVisualComposerQualificationDiagnostic(
    [diagnostic, processOutput].filter(Boolean).join(" "),
    {
      repoRoot: options.repoRoot,
      userRoot: options.userRoot,
      maximumCharacters: 900,
    },
  );
  return new Error(
    `Visual composer qualification host did not become ready at ${endpoint.origin}. ${details}`,
  );
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function settleWithin(promise, timeoutMs) {
  return Promise.race([
    promise.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function terminateWindowsTree(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
}

async function runUntilInterrupted() {
  const lifecycle = await startVisualComposerHostLifecycle();
  const probeOnly = process.argv.slice(2).includes("--probe");
  process.stdout.write(
    `${JSON.stringify({
      operation: "visual-composer-host-lifecycle",
      status: probeOnly ? "verified" : "ready",
      serverOrigin: lifecycle.serverOrigin.origin,
      thinClientOrigin: lifecycle.thinClientOrigin.origin,
      runId: lifecycle.runId,
    })}\n`,
  );
  if (probeOnly) {
    await lifecycle.stop();
    return;
  }
  const signals = new EventEmitter();
  const stop = () => signals.emit("stop");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await once(signals, "stop");
  await lifecycle.stop();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runUntilInterrupted().catch((error) => {
    process.stderr.write(
      `${sanitizeVisualComposerQualificationDiagnostic(
        error instanceof Error ? error.message : error,
        {
          repoRoot: getVisualComposerRepositoryRoot(),
          userRoot: process.env.USERPROFILE ?? process.env.HOME,
        },
      )}\n`,
    );
    process.exitCode = 1;
  });
}

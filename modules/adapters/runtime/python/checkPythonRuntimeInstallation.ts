import { execFile, spawnSync } from "node:child_process";

import { CONTEXT_DEPENDENCY_PROBE_SCRIPT } from "./ensurePythonRuntimeContextDependencies";
import { WORKER_DEPENDENCY_PROBE_SCRIPT } from "./ensurePythonRuntimeWorkerDependencies";

export type PythonRuntimeInstallation = "ready" | "missing" | "unsupported" | "incomplete";

const INSTALLATION_READY = "ASB_WORKER_INSTALLATION_READY";
const INSTALLATION_PROBE = [
  CONTEXT_DEPENDENCY_PROBE_SCRIPT,
  WORKER_DEPENDENCY_PROBE_SCRIPT,
  "import pip",
  "import torch",
  "import fastapi",
  "import uvicorn",
  `print("${INSTALLATION_READY}")`,
].join("\n");

/** Check the installed worker environment without starting it or running pip. */
export function checkPythonRuntimeInstallation(
  options: { command: string; cwd: string; env?: NodeJS.ProcessEnv },
  run: typeof spawnSync = spawnSync,
): PythonRuntimeInstallation {
  const result = run(options.command, ["-I", "-B", "-c", INSTALLATION_PROBE], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: 12_000,
    maxBuffer: 32_768,
    windowsHide: true,
  });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return "missing";
  if (result.status === 11 && !result.error) return "unsupported";
  const lines = result.stdout?.trim().split(/\r?\n/u);
  if (result.status === 0 && !result.error && lines?.[lines.length - 1] === INSTALLATION_READY) return "ready";
  return "incomplete";
}

/** The same read-only probe for active hosts; never blocks their event loop. */
export function checkPythonRuntimeInstallationAsync(
  options: { command: string; cwd: string; env?: NodeJS.ProcessEnv },
  run: typeof execFile = execFile,
): Promise<PythonRuntimeInstallation> {
  const command = options.command, cwd = options.cwd;
  const env = options.env ? { ...options.env } : undefined;
  return new Promise(resolve => {
    try {
      run(command, ["-I", "-B", "-c", INSTALLATION_PROBE], {
        cwd, env, encoding: "utf8", timeout: 12_000, maxBuffer: 32_768, windowsHide: true,
      }, (error, stdout) => {
        if (error?.code === "ENOENT") return resolve("missing");
        if (error?.code === 11 && !error.killed && !error.signal) return resolve("unsupported");
        const lines = typeof stdout === "string" ? stdout.trim().split(/\r?\n/u) : [];
        resolve(!error && lines[lines.length - 1] === INSTALLATION_READY ? "ready" : "incomplete");
      });
    } catch { resolve("incomplete"); }
  });
}

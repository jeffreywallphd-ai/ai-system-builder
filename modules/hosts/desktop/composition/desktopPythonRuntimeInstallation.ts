import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

import { checkPythonRuntimeInstallation, type PythonRuntimeInstallation } from "../../../adapters/runtime/python";
import {
  desktopPythonProbeEnvironment,
  resolveDesktopPythonRuntimeCommand,
  resolveDesktopPythonRuntimeWorkerDirectory,
  shouldPreparePythonRuntimeWorkerDependencies,
} from "./desktopPythonRuntimeHelpers";

export interface DesktopPythonRuntimeLaunch {
  command: string;
  args: readonly string[];
  cwd: string;
}

export function resolveDesktopPythonRuntimeLaunch(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): DesktopPythonRuntimeLaunch {
  const cwd = resolve(resolveDesktopPythonRuntimeWorkerDirectory({
    configuredWorkerDirectory: env.PYTHON_RUNTIME_WORKER_DIR,
    resourcesPath,
  }));
  const command = resolveDesktopPythonRuntimeCommand({ configuredCommand: env.PYTHON_RUNTIME_COMMAND, env });
  return {
    command: !isAbsolute(command) && /[/\\]/u.test(command) ? resolve(cwd, command) : command,
    args: env.PYTHON_RUNTIME_ARGS?.split(" ").filter(Boolean) ?? ["main.py"],
    cwd,
  };
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

export function desktopPythonWorkerEntryPresent(launch: DesktopPythonRuntimeLaunch): boolean {
  // The host starts a script. Preserve interpreter switches used by the controlled
  // workers, while refusing inline code, module mode, and switches that skip site packages.
  const args = [...launch.args];
  while (/^-[BEIOPbsqu]+$/u.test(args[0] ?? "")) args.shift();
  const script = args[0] === "--" ? args[1] : args[0];
  return Boolean(script && !script.startsWith("-") && isFile(resolve(launch.cwd, script)));
}

export function checkDesktopPythonRuntimeInstallation(
  launch: DesktopPythonRuntimeLaunch,
  env: NodeJS.ProcessEnv = process.env,
  checkPython = checkPythonRuntimeInstallation,
): PythonRuntimeInstallation {
  try {
    if (shouldPreparePythonRuntimeWorkerDependencies(launch.command)) {
      if (!desktopPythonWorkerEntryPresent(launch)) return "incomplete";
      return checkPython({ ...launch, env: desktopPythonProbeEnvironment(env) });
    }

    // Existing controlled host fixtures explicitly select a Node worker.
    // Check its installed entry point without running the worker's code.
    if (!isAbsolute(launch.command) || !/^node(?:\.exe)?$/iu.test(basename(launch.command)) ||
        launch.args.length !== 1 || !/\.[cm]?js$/iu.test(launch.args[0])) return "incomplete";
    if (!isFile(launch.command)) return "missing";
    const entryPoint = resolve(launch.cwd, launch.args[0]);
    const fromWorkerRoot = relative(launch.cwd, entryPoint);
    if (isAbsolute(fromWorkerRoot) || /^\.\.(?:[/\\]|$)/u.test(fromWorkerRoot) || !isFile(entryPoint)) return "incomplete";
    const check = spawnSync(launch.command, ["--check", entryPoint], {
      cwd: launch.cwd, env: {}, stdio: "ignore", timeout: 5_000, windowsHide: true,
    });
    return check.status === 0 && !check.error ? "ready" : "incomplete";
  } catch {
    return "incomplete";
  }
}

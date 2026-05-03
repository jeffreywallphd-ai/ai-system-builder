import path from "node:path";

export type ComfyUiPythonEnvironmentMode = "managed-venv" | "ambient";

export const COMFYUI_MANAGED_PYTHON_ENVIRONMENT_DIRECTORY = ".venv";

export function buildComfyUiManagedPythonExecutablePath(input: {
  installRoot: string;
  platform?: NodeJS.Platform;
}): string {
  return path.join(
    input.installRoot,
    COMFYUI_MANAGED_PYTHON_ENVIRONMENT_DIRECTORY,
    (input.platform ?? process.platform) === "win32" ? "Scripts" : "bin",
    (input.platform ?? process.platform) === "win32" ? "python.exe" : "python",
  );
}

export function buildComfyUiManagedPythonEnvironmentRoot(installRoot: string): string {
  return path.join(installRoot, COMFYUI_MANAGED_PYTHON_ENVIRONMENT_DIRECTORY);
}

export function buildComfyUiRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    PYTHONNOUSERSITE: "1",
  };
}

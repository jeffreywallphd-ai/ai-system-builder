import { spawnSync } from "node:child_process";
import { join } from "node:path";

export type ComfyUiPythonEnvironmentMode = "managed-venv" | "ambient";
export type ComfyUiRuntimeDeviceMode = "auto" | "cpu" | "directml" | "cuda";

export function resolveComfyUiInstallRoot(env: NodeJS.ProcessEnv = process.env, runtimeRootDirectory?: string): string {
  const configured = env.COMFYUI_INSTALL_ROOT?.trim();
  if (configured) return configured;
  const persistedBase = runtimeRootDirectory?.trim() || env.DESKTOP_RUNTIME_ROOT?.trim() || env.APPDATA?.trim() || env.HOME?.trim();
  if (!persistedBase) throw new Error("Unable to resolve ComfyUI install root. Set COMFYUI_INSTALL_ROOT or DESKTOP_RUNTIME_ROOT.");
  return join(persistedBase, "runtime-installs", "comfyui");
}

function normalizeComfyUiRuntimeDeviceMode(value: string | undefined): ComfyUiRuntimeDeviceMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "auto" || normalized === "cpu" || normalized === "directml" || normalized === "cuda") return normalized;
  throw new Error(`Unsupported COMFYUI_RUNTIME_DEVICE_MODE value "${value}". Use auto, cpu, directml, or cuda.`);
}

export function readComfyUiEnvOverride(env: NodeJS.ProcessEnv = process.env): ComfyUiRuntimeDeviceMode | undefined {
  return normalizeComfyUiRuntimeDeviceMode(env.COMFYUI_RUNTIME_DEVICE_MODE ?? env.COMFYUI_ACCELERATOR);
}

function normalizeComfyUiPythonEnvironmentMode(value: string | undefined): ComfyUiPythonEnvironmentMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "managed-venv" || normalized === "ambient") return normalized;
  throw new Error(`Unsupported COMFYUI_PYTHON_ENVIRONMENT_MODE value "${value}". Use managed-venv or ambient.`);
}

export function resolveComfyUiPythonEnvironmentMode(env: NodeJS.ProcessEnv = process.env): ComfyUiPythonEnvironmentMode {
  return normalizeComfyUiPythonEnvironmentMode(env.COMFYUI_PYTHON_ENVIRONMENT_MODE) ?? "managed-venv";
}

export function resolveComfyUiLaunchPythonExecutable(input: {
  installRoot: string;
  basePythonCommand: string;
  pythonEnvironmentMode?: ComfyUiPythonEnvironmentMode;
  skipPythonSetup?: boolean;
  platform?: NodeJS.Platform;
}): string {
  if (input.pythonEnvironmentMode === "ambient" || input.skipPythonSetup === true) return input.basePythonCommand;
  const platform = input.platform ?? process.platform;
  return join(input.installRoot, ".venv", platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python");
}

export function resolveComfyUiRuntimeDeviceMode(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  hasNvidiaGpu?: boolean;
  gpuType?: string | undefined;
  cudaTorchWheelIndexUrl?: string | undefined;
} = {}): ComfyUiRuntimeDeviceMode {
  const configured = readComfyUiEnvOverride(input.env);
  if (configured) return configured;
  const configuredGpuType = input.gpuType?.trim().toLowerCase();
  if (configuredGpuType === "nvidia") return "cuda";
  if (configuredGpuType === "amd" || configuredGpuType === "intel") return "directml";
  if (configuredGpuType === "cpu") return "cpu";
  if ((!configuredGpuType || configuredGpuType === "auto") && input.cudaTorchWheelIndexUrl?.trim()) return "cuda";
  if (input.hasNvidiaGpu === true) return "cuda";
  return "cpu";
}

export function detectNvidiaGpu(): boolean | undefined {
  if (process.platform !== "win32") return undefined;
  const result = spawnSync("nvidia-smi", ["-L"], { encoding: "utf8", windowsHide: true });
  if (result.error) return false;
  return result.status === 0 && result.stdout.trim().length > 0;
}

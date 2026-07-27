import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LoggingPort } from "../../../application/ports/logging";
import type { ApplicationSettingsPort } from "../../../application/ports/settings";
import type { RuntimeInstallerPort } from "../../../application/ports/runtime-installer";
import {
  createComfyUiHttpClient,
  createComfyUiImageGenerationRuntimeAdapter,
  createComfyUiRuntimeSupervisor,
} from "../../../adapters/runtime/comfyui";
import { createComfyUiRuntimeInstaller } from "../../../adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";
import { createGitRuntimeInstallerAdapter } from "../../../adapters/runtime/installer/git/createGitRuntimeInstallerAdapter";
import {
  IMAGE_GENERATION_GPU_TYPE_SETTING_KEY,
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
} from "../../../contracts/settings";
import {
  detectNvidiaGpu,
  readComfyUiEnvOverride,
  resolveComfyUiInstallRoot,
  resolveComfyUiLaunchPythonExecutable,
  resolveComfyUiPythonEnvironmentMode,
  resolveComfyUiRuntimeDeviceMode,
  type ComfyUiRuntimeDeviceMode,
} from "./composeDesktopComfyUiHelpers";

const execFile = promisify(nodeExecFile);
const COMFYUI_INSTALL_COMMAND_TIMEOUT_MS_DEFAULT = 30 * 60 * 1000;

function extensionForImageReference(
  mediaType: string | undefined,
  artifactId: string,
): string {
  const media = mediaType?.trim().toLowerCase();
  if (media === "image/jpeg" || media === "image/jpg") return ".jpg";
  if (media === "image/webp") return ".webp";
  if (media === "image/png") return ".png";
  const match = artifactId.match(/\.(png|jpe?g|webp)$/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".png";
}

export interface ComposeDesktopComfyUiImageRuntimeFeatureOptions {
  runtimeRootDirectory?: string;
  loggingPort: LoggingPort;
  applicationSettings: ApplicationSettingsPort;
  readRuntimeSettingString: (key: string) => Promise<string | undefined>;
  getArtifacts: () => Promise<any>;
}

export function composeDesktopComfyUiImageRuntimeFeature(
  options: ComposeDesktopComfyUiImageRuntimeFeatureOptions,
): any {
  const installRoot = resolveComfyUiInstallRoot(
    process.env,
    options.runtimeRootDirectory,
  );
  const comfyUiBasePythonCommand =
    process.env.COMFYUI_PYTHON_COMMAND ??
    process.env.PYTHON_RUNTIME_COMMAND ??
    (process.platform === "win32" ? "python" : "python3");
  const comfyUiPythonEnvironmentMode = resolveComfyUiPythonEnvironmentMode(
    process.env,
  );
  const comfyUiSkipPythonSetup = process.env.COMFYUI_SKIP_PYTHON_SETUP === "1";
  const comfyUiPythonCommand = resolveComfyUiLaunchPythonExecutable({
    installRoot,
    basePythonCommand: comfyUiBasePythonCommand,
    pythonEnvironmentMode: comfyUiPythonEnvironmentMode,
    skipPythonSetup: comfyUiSkipPythonSetup,
  });
  const configuredComfyUiInstallCommandTimeoutMs = Number(
    process.env.COMFYUI_INSTALL_COMMAND_TIMEOUT_MS,
  );
  const comfyUiInstallCommandTimeoutMs =
    Number.isFinite(configuredComfyUiInstallCommandTimeoutMs) &&
    configuredComfyUiInstallCommandTimeoutMs > 0
      ? configuredComfyUiInstallCommandTimeoutMs
      : COMFYUI_INSTALL_COMMAND_TIMEOUT_MS_DEFAULT;
  const createConfiguredComfyUiInstaller = async (
    runtimeDeviceMode?: ComfyUiRuntimeDeviceMode,
  ) =>
    createComfyUiRuntimeInstaller({
      gitInstaller: createGitRuntimeInstallerAdapter(),
      pythonCommand: comfyUiBasePythonCommand,
      execFile: (file, args = []) =>
        execFile(file, [...args], {
          timeout: comfyUiInstallCommandTimeoutMs,
          windowsHide: true,
        }),
      pythonEnvironmentMode: comfyUiPythonEnvironmentMode,
      runtimeDeviceMode,
      skipPythonSetup: comfyUiSkipPythonSetup,
      directMlTorchVersion: process.env.COMFYUI_DIRECTML_TORCH_VERSION,
      directMlTorchVisionVersion:
        process.env.COMFYUI_DIRECTML_TORCHVISION_VERSION,
      directMlPackageName: process.env.COMFYUI_DIRECTML_PACKAGE,
      logging: options.loggingPort,
    });
  const comfyUiInstaller = {
    async ensureInstalled(request) {
      return (await createConfiguredComfyUiInstaller()).ensureInstalled(
        request,
      );
    },
    async getInstallStatus(request) {
      return (await createConfiguredComfyUiInstaller()).getInstallStatus(
        request,
      );
    },
    async repairInstall(request) {
      const installer = await createConfiguredComfyUiInstaller();
      return (
        installer.repairInstall?.(request) ??
        installer.ensureInstalled({ ...request, allowUpdate: false })
      );
    },
  } satisfies RuntimeInstallerPort;
  let comfyUiSupervisor:
    ReturnType<typeof createComfyUiRuntimeSupervisor> | undefined;
  let activeRuntimeDeviceMode: ComfyUiRuntimeDeviceMode | undefined;
  const comfyUiSupervisorPort = {
    async start() {
      const persistedValue = (
        await options.applicationSettings.readValues({
          keys: [IMAGE_GENERATION_GPU_TYPE_SETTING_KEY],
        })
      )[0]?.value;
      const persistedGpuType =
        typeof persistedValue === "string" ? persistedValue : undefined;
      const cudaTorchWheelIndexUrl = await options.readRuntimeSettingString(
        RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
      );
      const envOverride = readComfyUiEnvOverride(process.env);
      const resolvedRuntimeDeviceMode = resolveComfyUiRuntimeDeviceMode({
        env: process.env,
        hasNvidiaGpu: detectNvidiaGpu(),
        gpuType: persistedGpuType,
        cudaTorchWheelIndexUrl,
      });
      const modeChanged =
        activeRuntimeDeviceMode !== undefined &&
        activeRuntimeDeviceMode !== resolvedRuntimeDeviceMode;
      if (modeChanged && comfyUiSupervisor) {
        await comfyUiSupervisor.stop();
        comfyUiSupervisor = undefined;
      }
      if (!comfyUiSupervisor) {
        const configuredInstaller = await createConfiguredComfyUiInstaller(
          resolvedRuntimeDeviceMode,
        );
        comfyUiSupervisor = createComfyUiRuntimeSupervisor({
          workingDirectory: installRoot,
          pythonExecutable: comfyUiPythonCommand,
          installer: configuredInstaller,
          installRoot,
          runtimeDeviceMode: resolvedRuntimeDeviceMode,
          autoInstall: true,
          installSourceRef: process.env.COMFYUI_INSTALL_REF,
          logging: options.loggingPort,
        });
        activeRuntimeDeviceMode = resolvedRuntimeDeviceMode;
      }
      await options.loggingPort.log({
        level: "info",
        message: "Resolved ComfyUI runtime mode before start.",
        timestamp: new Date().toISOString(),
        verbosity: "normal",
        event: "runtime.comfyui.mode.resolution",
        component: "desktop-host-composition",
        subsystem: "runtime",
        data: {
          persistedGpuType,
          cudaTorchWheelIndexConfigured: Boolean(cudaTorchWheelIndexUrl),
          envOverride,
          envOverrideWon: Boolean(envOverride),
          runtimeDeviceMode: resolvedRuntimeDeviceMode,
          processReuse: modeChanged
            ? "restarted_mode_changed"
            : "reused_or_started",
        },
      });
      await comfyUiSupervisor.start();
    },
    getRecentRuntimeOutput() {
      return comfyUiSupervisor?.getRecentRuntimeOutput() ?? [];
    },
    getRuntimeDeviceMode() {
      return activeRuntimeDeviceMode ?? "cpu";
    },
  };
  const imageRuntimeTaskRegistry = createComfyUiImageGenerationRuntimeAdapter({
    client: createComfyUiHttpClient({
      baseUrl: process.env.COMFYUI_BASE_URL?.trim() || "http://127.0.0.1:8188",
    }),
    supervisor: comfyUiSupervisorPort,
    prepareLatentReferenceImage: async ({ artifactId }) => {
      const artifacts = await options.getArtifacts();
      const result = await artifacts.storage.retrieveArtifact({
        key: artifactId,
      });
      if (!result.ok)
        throw new Error(
          `Unable to read latent reference image artifact '${artifactId}': ${result.error.message}`,
        );
      const content =
        result.value.content instanceof Uint8Array
          ? result.value.content
          : new Uint8Array(result.value.content as ArrayBufferLike);
      const imageName = `ai-system-builder-latent-${Date.now()}-${Math.random().toString(36).slice(2)}${extensionForImageReference(result.value.descriptor.mediaType, artifactId)}`;
      const inputDirectory = join(installRoot, "input");
      await mkdir(inputDirectory, { recursive: true });
      await writeFile(join(inputDirectory, imageName), content);
      return { imageName };
    },
    mapperOptions: {
      defaultCheckpoint: process.env.COMFYUI_DEFAULT_CHECKPOINT,
    },
  });
  return {
    installRoot,
    installer: comfyUiInstaller,
    supervisorPort: comfyUiSupervisorPort,
    imageRuntimeTaskRegistry,
  };
}

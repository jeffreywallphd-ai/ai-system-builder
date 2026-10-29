import { resolve } from "node:path";
import type { RuntimeInstallerPort } from "../../application/ports/runtime-installer";
import { DEFAULT_COMFYUI_REPOSITORY_URL } from "../../adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";

/** Restricts automatic startup effects; explicit installer operations stay separate. */
export function resolveComfyUiAutoInstall(
  environment: { COMFYUI_AUTO_INSTALL?: string },
): boolean {
  const value = environment.COMFYUI_AUTO_INSTALL;
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  // Do not include an untrusted environment value in diagnostics.
  throw new Error("COMFYUI_AUTO_INSTALL must be 0 or 1 when configured.");
}

/** Preserve the host's managed-source admission without installation or repair. */
export async function requireManagedComfyUiInstall(
  installer: Pick<RuntimeInstallerPort, "getInstallStatus">,
  installRoot: string,
  installSourceRef?: string,
): Promise<void> {
  try {
    const requestedRef = installSourceRef?.trim() || undefined;
    const status = await installer.getInstallStatus({
      targetId: "comfyui", installRoot,
      source: { type: "git", repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL, ref: requestedRef },
    });
    if (status.status !== "installed" || status.error !== undefined ||
        status.targetId !== "comfyui" || typeof status.installRoot !== "string" ||
        resolve(status.installRoot) !== resolve(installRoot) ||
        status.source?.type !== "git" || status.source.repositoryUrl !== DEFAULT_COMFYUI_REPOSITORY_URL ||
        requestedRef !== undefined && status.requestedRef !== requestedRef) {
      throw new Error("Unconfirmed managed installation");
    }
  } catch {
    // Status metadata proves only managed-source admission, not runtime readiness.
    throw new Error("ComfyUI automatic setup is disabled. A matching managed installation is required before startup.");
  }
}

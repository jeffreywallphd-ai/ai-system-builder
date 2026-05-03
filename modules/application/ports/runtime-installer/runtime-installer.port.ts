import type {
  RuntimeInstallRequest,
  RuntimeInstallResult,
  RuntimeInstallStatusRequest,
  RuntimeInstallStatusResult,
} from "../../../contracts/runtime-installer";

export interface RuntimeInstallerPort {
  getInstallStatus(request: RuntimeInstallStatusRequest): Promise<RuntimeInstallStatusResult>;
  ensureInstalled(request: RuntimeInstallRequest): Promise<RuntimeInstallResult>;
  repairInstall?(request: RuntimeInstallRequest): Promise<RuntimeInstallResult>;
}

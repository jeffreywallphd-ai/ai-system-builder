import type { RuntimeInstallSource } from "./runtime-install-source";
import type { RuntimeInstallTargetId } from "./runtime-install-target";

export interface RuntimeInstallStatusRequest {
  targetId: RuntimeInstallTargetId;
  installRoot?: string;
  source?: RuntimeInstallSource;
  metadata?: Record<string, unknown>;
}

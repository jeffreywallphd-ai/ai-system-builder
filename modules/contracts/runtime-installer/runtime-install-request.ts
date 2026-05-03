import type { RuntimeInstallSource } from "./runtime-install-source";
import type { RuntimeInstallTargetId } from "./runtime-install-target";

export interface RuntimeInstallRequest {
  targetId: RuntimeInstallTargetId;
  installRoot: string;
  source: RuntimeInstallSource;
  forceRepair?: boolean;
  allowUpdate?: boolean;
  metadata?: Record<string, unknown>;
}

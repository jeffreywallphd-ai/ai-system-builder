import type { RuntimeInstallError } from "./runtime-install-result";
import type { RuntimeInstallSource } from "./runtime-install-source";
import type { RuntimeInstallStatus } from "./runtime-install-status";
import type { RuntimeInstallTargetId } from "./runtime-install-target";

export interface RuntimeInstallStatusResult {
  targetId: RuntimeInstallTargetId;
  status: RuntimeInstallStatus;
  installRoot?: string;
  source?: RuntimeInstallSource;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
  installedAt?: string;
  lastCheckedAt?: string;
  warnings?: string[];
  metadata?: Record<string, unknown>;
  error?: RuntimeInstallError;
}

import type { RuntimeInstallSource } from "./runtime-install-source";
import type { RuntimeInstallStatus } from "./runtime-install-status";
import type { RuntimeInstallTargetId } from "./runtime-install-target";

export interface RuntimeInstallError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeInstallResult {
  targetId: RuntimeInstallTargetId;
  status: RuntimeInstallStatus;
  installRoot: string;
  source: RuntimeInstallSource;
  requestedRef?: string;
  resolvedRef?: string;
  commitSha?: string;
  installedAt?: string;
  lastCheckedAt?: string;
  warnings?: string[];
  metadata?: Record<string, unknown>;
  error?: RuntimeInstallError;
}

import type { HostIdentity } from "../host";
import type { RuntimeCapabilityStatus } from "./runtime-capability-status";
import type { RuntimeReadinessReason } from "./runtime-readiness-reason";
import type { RuntimeReadinessStatus } from "./runtime-readiness-status";

export interface RuntimeReadinessSnapshot {
  status: RuntimeReadinessStatus;
  healthy: boolean;
  available: boolean;
  capabilities: RuntimeCapabilityStatus[];
  summary?: string;
  reason?: RuntimeReadinessReason;
  recommendedActions?: RuntimeCapabilityStatus["recommendedActions"];
  details?: Record<string, unknown>;
  updatedAt?: string;
  host?: HostIdentity;
}

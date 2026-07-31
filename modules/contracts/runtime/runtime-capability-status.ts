import type { HostIdentity } from "../host";
import {
  normalizeRuntimeCapabilityId,
  type RuntimeCapabilityId,
} from "./runtime-capability-id";
import {
  normalizeRuntimeReadinessAction,
  type RuntimeReadinessAction,
} from "./runtime-readiness-action";
import type { RuntimeReadinessReason } from "./runtime-readiness-reason";
import {
  normalizeRuntimeReadinessStatus,
  type RuntimeReadinessStatus,
} from "./runtime-readiness-status";

export interface RuntimeCapabilityDependencyStatus {
  capabilityId: RuntimeCapabilityId;
  status: RuntimeReadinessStatus;
  healthy?: boolean;
  available?: boolean;
  summary?: string;
  reason?: RuntimeReadinessReason;
  details?: Record<string, unknown>;
  updatedAt?: string;
}

export interface RuntimeCapabilityStatus extends RuntimeCapabilityDependencyStatus {
  recommendedActions?: RuntimeReadinessAction[];
  dependencies?: RuntimeCapabilityDependencyStatus[];
  host?: HostIdentity;
}

export type RuntimeCapabilityDependencyStatusInput = Omit<
  RuntimeCapabilityDependencyStatus,
  "capabilityId" | "status"
> & {
  capabilityId: string;
  status: string;
};

export interface RuntimeCapabilityStatusInput
  extends Omit<
    RuntimeCapabilityStatus,
    "capabilityId" | "status" | "recommendedActions" | "dependencies"
  > {
  capabilityId: string;
  status: string;
  recommendedActions?: string[];
  dependencies?: RuntimeCapabilityDependencyStatusInput[];
}

function defaultHealthy(status: RuntimeReadinessStatus): boolean {
  return status === "ready";
}

function defaultAvailable(status: RuntimeReadinessStatus): boolean {
  return status === "ready" || status === "degraded";
}

function normalizeDependency(
  dependency: RuntimeCapabilityDependencyStatusInput,
): RuntimeCapabilityDependencyStatus {
  const status = normalizeRuntimeReadinessStatus(dependency.status);

  return {
    ...dependency,
    capabilityId: normalizeRuntimeCapabilityId(dependency.capabilityId),
    status,
    healthy: dependency.healthy ?? defaultHealthy(status),
    available: dependency.available ?? defaultAvailable(status),
  };
}

export function createRuntimeCapabilityStatus(
  input: RuntimeCapabilityStatusInput,
): RuntimeCapabilityStatus {
  const status = normalizeRuntimeReadinessStatus(input.status);

  return {
    ...input,
    capabilityId: normalizeRuntimeCapabilityId(input.capabilityId),
    status,
    healthy: input.healthy ?? defaultHealthy(status),
    available: input.available ?? defaultAvailable(status),
    recommendedActions: input.recommendedActions?.map(normalizeRuntimeReadinessAction),
    dependencies: input.dependencies?.map(normalizeDependency),
  };
}

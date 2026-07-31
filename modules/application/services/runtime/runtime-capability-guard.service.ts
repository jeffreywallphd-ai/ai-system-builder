import type {
  RuntimeCapabilityId,
  RuntimeCapabilityStatus,
  RuntimeReadinessAction,
  RuntimeReadinessReasonCategory,
} from "../../../contracts/runtime";
import { createRuntimeCapabilityStatus } from "../../../contracts/runtime";
import type { RuntimeReadinessPort } from "../../ports/runtime";

export interface RuntimeCapabilityGuardOptions {
  allowDegraded?: boolean;
}

export interface RuntimeCapabilityActivationPort {
  prepareCapability(capabilityId: RuntimeCapabilityId): Promise<void>;
}

export interface RuntimeCapabilityUnavailableDetails extends Readonly<
  Record<string, unknown>
> {
  capabilityId: RuntimeCapabilityId;
  status: RuntimeCapabilityStatus["status"];
  summary?: string;
  reason?: {
    code: string;
    category?: RuntimeReadinessReasonCategory;
  };
  recommendedActions?: RuntimeReadinessAction[];
}

export class RuntimeCapabilityUnavailableError extends Error {
  public readonly code = "unavailable" as const;
  public readonly capabilityStatus: RuntimeCapabilityStatus;
  public readonly details: RuntimeCapabilityUnavailableDetails;

  public constructor(capabilityStatus: RuntimeCapabilityStatus) {
    super(
      `Runtime capability '${capabilityStatus.capabilityId}' is ${capabilityStatus.status}.`,
    );
    this.name = "RuntimeCapabilityUnavailableError";
    this.capabilityStatus = capabilityStatus;
    this.details = toRuntimeCapabilityUnavailableDetails(capabilityStatus);
  }
}

export function toRuntimeCapabilityUnavailableDetails(
  capabilityStatus: RuntimeCapabilityStatus,
): RuntimeCapabilityUnavailableDetails {
  return {
    capabilityId: capabilityStatus.capabilityId,
    status: capabilityStatus.status,
    summary: capabilityStatus.summary,
    reason: capabilityStatus.reason
      ? {
          code: capabilityStatus.reason.code,
          category: capabilityStatus.reason.category,
        }
      : undefined,
    recommendedActions: capabilityStatus.recommendedActions,
  };
}

export function isRuntimeCapabilityUnavailableError(
  error: unknown,
): error is RuntimeCapabilityUnavailableError {
  return (
    error instanceof RuntimeCapabilityUnavailableError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name ===
        "RuntimeCapabilityUnavailableError" &&
      (error as { code?: unknown }).code === "unavailable")
  );
}

export class RuntimeCapabilityGuardService {
  public constructor(
    private readonly runtimeReadiness: RuntimeReadinessPort,
    private readonly runtimeCapabilityActivation?: RuntimeCapabilityActivationPort,
  ) {}

  public async requireCapabilityReady(
    capabilityId: RuntimeCapabilityId,
    options?: RuntimeCapabilityGuardOptions,
  ): Promise<RuntimeCapabilityStatus> {
    let capabilityStatus =
      await this.runtimeReadiness.getCapabilityStatus(capabilityId);
    if (isAllowedCapabilityStatus(capabilityStatus, options)) {
      return capabilityStatus;
    }

    if (this.runtimeCapabilityActivation) {
      try {
        await this.runtimeCapabilityActivation.prepareCapability(capabilityId);
      } catch {
        // Re-read readiness below. A supervisor can report ready even when its
        // start request races with another caller and rejects as already active.
      }

      try {
        capabilityStatus =
          await this.runtimeReadiness.getCapabilityStatus(capabilityId);
      } catch {
        capabilityStatus = createRuntimeCapabilityStatus({
          capabilityId,
          status: "unavailable",
          summary:
            "Runtime readiness could not be confirmed after preparation.",
          reason: {
            code: "runtime.capability.preparation-readiness-unavailable",
            message:
              "Runtime readiness could not be confirmed after preparation.",
            category: "unavailable",
            retryable: true,
          },
          recommendedActions: ["retry"],
        });
      }

      if (isAllowedCapabilityStatus(capabilityStatus, options)) {
        return capabilityStatus;
      }
    }

    throw new RuntimeCapabilityUnavailableError(capabilityStatus);
  }
}

function isAllowedCapabilityStatus(
  capabilityStatus: RuntimeCapabilityStatus,
  options?: RuntimeCapabilityGuardOptions,
): boolean {
  return (
    capabilityStatus.status === "ready" ||
    (capabilityStatus.status === "degraded" && options?.allowDegraded === true)
  );
}

export async function requireRuntimeCapabilityReady(
  runtimeReadiness: RuntimeReadinessPort,
  capabilityId: RuntimeCapabilityId,
  options?: RuntimeCapabilityGuardOptions,
): Promise<RuntimeCapabilityStatus> {
  return new RuntimeCapabilityGuardService(
    runtimeReadiness,
  ).requireCapabilityReady(capabilityId, options);
}

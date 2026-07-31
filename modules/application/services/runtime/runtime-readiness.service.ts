import {
  RUNTIME_CAPABILITY_IDS,
  createRuntimeCapabilityStatus,
  normalizeRuntimeCapabilityId,
  type RuntimeCapabilityDependencyStatus,
  type RuntimeCapabilityId,
  type RuntimeCapabilityStatus,
  type RuntimeReadinessAction,
  type RuntimeReadinessSnapshot,
  type RuntimeReadinessStatus,
} from "../../../contracts/runtime";
import type { RuntimeInstallStatus } from "../../../contracts/runtime-installer";
import type { RuntimeReadinessPort } from "../../ports/runtime";

export type PythonRuntimeLifecycleState = "stopped" | "starting" | "ready" | "failed";
export type ComfyUiRuntimeLifecycleState = "stopped" | "starting" | "ready" | "unhealthy";

export interface RuntimeReadinessProviderContext {
  getCapabilityStatus(capabilityId: RuntimeCapabilityId): Promise<RuntimeCapabilityStatus>;
}

export interface RuntimeCapabilityStatusProvider {
  capabilityId: RuntimeCapabilityId;
  getStatus(context?: RuntimeReadinessProviderContext): RuntimeCapabilityStatus | Promise<RuntimeCapabilityStatus>;
}

export interface RuntimeReadinessServiceOptions {
  providers: readonly RuntimeCapabilityStatusProvider[];
  capabilityIds?: readonly RuntimeCapabilityId[];
  now?: () => string;
}

export interface PythonRuntimeCapabilityStatusProviderOptions {
  readState: () => PythonRuntimeLifecycleState | Promise<PythonRuntimeLifecycleState>;
  now?: () => string;
}

export interface ComfyUiRuntimeCapabilityStatusProviderOptions {
  readState: () => ComfyUiRuntimeLifecycleState | Promise<ComfyUiRuntimeLifecycleState>;
  now?: () => string;
}

export interface RuntimeInstallerCapabilityStatusProviderOptions {
  capabilityId: RuntimeCapabilityId;
  readStatus: () => RuntimeInstallStatus | Promise<RuntimeInstallStatus>;
  targetId?: string;
  now?: () => string;
}

export interface DerivedRuntimeCapabilityStatusProviderOptions {
  capabilityId: RuntimeCapabilityId;
  dependencies: readonly RuntimeCapabilityId[];
  readDependencyStatus: (capabilityId: RuntimeCapabilityId) => RuntimeCapabilityStatus | Promise<RuntimeCapabilityStatus>;
  now?: () => string;
}

export interface CompositeRuntimeCapabilityStatusProviderOptions {
  capabilityId: RuntimeCapabilityId;
  providers: readonly RuntimeCapabilityStatusProvider[];
  now?: () => string;
}

const DEFAULT_NOW = () => new Date().toISOString();

const SNAPSHOT_STATUS_PRIORITY: readonly RuntimeReadinessStatus[] = [
  "failed",
  "installing",
  "starting",
  "not-installed",
  "degraded",
  "unavailable",
  "unknown",
  "ready",
];

const DERIVED_BLOCKING_STATUS_PRIORITY: readonly RuntimeReadinessStatus[] = [
  "failed",
  "not-installed",
  "installing",
  "starting",
  "unavailable",
  "unknown",
  "degraded",
  "ready",
];

const COMPOSITE_STATUS_PRIORITY: readonly RuntimeReadinessStatus[] = [
  "failed",
  "not-installed",
  "installing",
  "starting",
  "unavailable",
  "degraded",
  "unknown",
  "ready",
];

function providerFailureStatus(
  capabilityId: RuntimeCapabilityId,
  now: () => string,
): RuntimeCapabilityStatus {
  return createRuntimeCapabilityStatus({
    capabilityId,
    status: "failed",
    summary: `Unable to read ${capabilityId} readiness provider.`,
    reason: {
      code: "runtime.readiness.provider-failed",
      message: "Runtime readiness provider failed. See logs for diagnostic details.",
      category: "unknown",
      retryable: true,
      details: { failureKind: "provider-threw", capabilityId },
    },
    recommendedActions: ["retry", "view-logs"],
    updatedAt: now(),
  });
}

function highestPriorityStatus(
  statuses: readonly RuntimeReadinessStatus[],
  priority: readonly RuntimeReadinessStatus[],
): RuntimeReadinessStatus {
  for (const status of priority) {
    if (statuses.includes(status)) {
      return status;
    }
  }
  return "unknown";
}

function isCapabilityAvailable(status: RuntimeCapabilityStatus): boolean {
  return status.available === true;
}

function statusActions(status: RuntimeReadinessStatus): RuntimeReadinessAction[] | undefined {
  switch (status) {
    case "not-installed":
      return ["install"];
    case "installing":
    case "starting":
      return ["wait"];
    case "unavailable":
      return ["start"];
    case "failed":
      return ["retry", "view-logs"];
    case "unknown":
      return ["retry"];
    case "degraded":
      return ["view-logs"];
    case "ready":
      return undefined;
  }
}

export function mapPythonRuntimeLifecycleStateToReadinessStatus(
  state: PythonRuntimeLifecycleState,
): RuntimeReadinessStatus {
  switch (state) {
    case "stopped":
      return "unavailable";
    case "starting":
      return "starting";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
  }
}

export function mapComfyUiRuntimeLifecycleStateToReadinessStatus(
  state: ComfyUiRuntimeLifecycleState,
): RuntimeReadinessStatus {
  switch (state) {
    case "stopped":
      return "unavailable";
    case "starting":
      return "starting";
    case "ready":
      return "ready";
    case "unhealthy":
      return "failed";
  }
}

export function mapRuntimeInstallStatusToReadinessStatus(
  status: RuntimeInstallStatus,
): RuntimeReadinessStatus {
  switch (status) {
    case "not-installed":
      return "not-installed";
    case "installing":
    case "checking":
      return "installing";
    case "installed":
      return "unknown";
    case "update-available":
      return "degraded";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
  }
}

function normalizeRuntimeCapabilityIds(
  capabilityIds: readonly RuntimeCapabilityId[],
): readonly RuntimeCapabilityId[] {
  const normalized = capabilityIds.map((capabilityId) => normalizeRuntimeCapabilityId(capabilityId));
  return Array.from(new Set(normalized));
}

function mergeDetails(
  statuses: readonly RuntimeCapabilityStatus[],
): Record<string, unknown> | undefined {
  const details = Object.assign(
    {},
    ...statuses.map((status) => status.details ?? {}),
  ) as Record<string, unknown>;
  return Object.keys(details).length > 0 ? details : undefined;
}

function mergeDependencies(
  statuses: readonly RuntimeCapabilityStatus[],
): RuntimeCapabilityDependencyStatus[] | undefined {
  const dependencies = statuses.flatMap((status) => status.dependencies ?? []);
  return dependencies.length > 0 ? dependencies : undefined;
}

function mergeRecommendedActions(
  statuses: readonly RuntimeCapabilityStatus[],
  status: RuntimeReadinessStatus,
): RuntimeReadinessAction[] | undefined {
  const actions = new Set<RuntimeReadinessAction>();
  for (const action of statusActions(status) ?? []) {
    actions.add(action);
  }
  for (const capabilityStatus of statuses) {
    for (const action of capabilityStatus.recommendedActions ?? []) {
      actions.add(action);
    }
  }
  return actions.size > 0 ? Array.from(actions) : undefined;
}

function selectCompositeReason(
  statuses: readonly RuntimeCapabilityStatus[],
  status: RuntimeReadinessStatus,
): RuntimeCapabilityStatus["reason"] {
  if (status === "ready") {
    return undefined;
  }
  return statuses.find((capabilityStatus) => capabilityStatus.status === status && capabilityStatus.reason)?.reason
    ?? statuses.find((capabilityStatus) => capabilityStatus.reason)?.reason;
}

function readInstallStatus(status: RuntimeCapabilityStatus): RuntimeInstallStatus | undefined {
  const installStatus = status.details?.installStatus;
  if (
    installStatus === "not-installed"
    || installStatus === "installing"
    || installStatus === "checking"
    || installStatus === "installed"
    || installStatus === "update-available"
    || installStatus === "failed"
    || installStatus === "unknown"
  ) {
    return installStatus;
  }
  return undefined;
}

function supervisorStatusesForComposite(
  statuses: readonly RuntimeCapabilityStatus[],
): readonly RuntimeReadinessStatus[] {
  return statuses
    .filter((status) => readInstallStatus(status) === undefined)
    .map((status) => status.status);
}

function combineInstallAndSupervisorStatus(
  installStatus: RuntimeInstallStatus,
  supervisorStatuses: readonly RuntimeReadinessStatus[],
): RuntimeReadinessStatus {
  switch (installStatus) {
    case "failed":
      return "failed";
    case "not-installed":
      return "not-installed";
    case "installing":
    case "checking":
      return "installing";
    case "installed":
      return supervisorStatuses.length > 0
        ? highestPriorityStatus(supervisorStatuses, COMPOSITE_STATUS_PRIORITY)
        : "unknown";
    case "update-available": {
      const supervisorStatus = supervisorStatuses.length > 0
        ? highestPriorityStatus(supervisorStatuses, COMPOSITE_STATUS_PRIORITY)
        : "unknown";
      return supervisorStatus === "ready" || supervisorStatus === "degraded"
        ? "degraded"
        : supervisorStatus;
    }
    case "unknown": {
      const supervisorStatus = supervisorStatuses.length > 0
        ? highestPriorityStatus(supervisorStatuses, COMPOSITE_STATUS_PRIORITY)
        : "unknown";
      return supervisorStatus === "ready" ? "degraded" : supervisorStatus;
    }
  }
}

function combineRuntimeCapabilityStatuses(
  capabilityId: RuntimeCapabilityId,
  statuses: readonly RuntimeCapabilityStatus[],
  now: () => string,
): RuntimeCapabilityStatus {
  if (statuses.length === 0) {
    return createRuntimeCapabilityStatus({
      capabilityId,
      status: "unknown",
      summary: `No runtime readiness signals are composed for ${capabilityId}.`,
      reason: {
        code: "runtime.readiness.composite-empty",
        message: `No runtime readiness signals are composed for ${capabilityId}.`,
        category: "unknown",
        retryable: false,
      },
      recommendedActions: ["configure"],
      updatedAt: now(),
    });
  }

  const installStatuses = statuses
    .map(readInstallStatus)
    .filter((status): status is RuntimeInstallStatus => Boolean(status));
  const status = installStatuses.length > 0
    ? combineInstallAndSupervisorStatus(installStatuses[0], supervisorStatusesForComposite(statuses))
    : statuses.every((capabilityStatus) => capabilityStatus.status === "ready")
      ? "ready"
      : highestPriorityStatus(statuses.map((capabilityStatus) => capabilityStatus.status), COMPOSITE_STATUS_PRIORITY);

  return createRuntimeCapabilityStatus({
    capabilityId,
    status,
    summary: status === "ready"
      ? `${capabilityId} readiness signals are ready.`
      : `${capabilityId} readiness signals combine to ${status}.`,
    reason: selectCompositeReason(statuses, status),
    recommendedActions: mergeRecommendedActions(statuses, status),
    details: mergeDetails(statuses),
    dependencies: mergeDependencies(statuses),
    updatedAt: now(),
  });
}

export class RuntimeReadinessService implements RuntimeReadinessPort {
  private readonly providersByCapabilityId: Map<RuntimeCapabilityId, RuntimeCapabilityStatusProvider>;
  private readonly snapshotCapabilityIds?: readonly RuntimeCapabilityId[];
  private readonly now: () => string;

  public constructor(options: RuntimeReadinessServiceOptions) {
    this.now = options.now ?? DEFAULT_NOW;
    this.providersByCapabilityId = new Map();
    this.snapshotCapabilityIds = options.capabilityIds
      ? normalizeRuntimeCapabilityIds(options.capabilityIds)
      : undefined;

    for (const provider of options.providers) {
      if (this.providersByCapabilityId.has(provider.capabilityId)) {
        throw new Error(`Duplicate runtime readiness provider for capability '${provider.capabilityId}'.`);
      }
      this.providersByCapabilityId.set(provider.capabilityId, provider);
    }
  }

  public async getCapabilityStatus(capabilityId: RuntimeCapabilityId): Promise<RuntimeCapabilityStatus> {
    return this.readCapabilityStatus(capabilityId);
  }

  public async getReadinessSnapshot(): Promise<RuntimeReadinessSnapshot> {
    const capabilityIds = this.snapshotCapabilityIds ?? this.defaultSnapshotCapabilityIds();
    const snapshotStatusReads = new Map<RuntimeCapabilityId, Promise<RuntimeCapabilityStatus>>();
    const context: RuntimeReadinessProviderContext = {
      getCapabilityStatus: (capabilityId) => {
        const existing = snapshotStatusReads.get(capabilityId);
        if (existing) {
          return existing;
        }
        const statusRead = Promise.resolve().then(() => this.readCapabilityStatus(capabilityId, context));
        snapshotStatusReads.set(capabilityId, statusRead);
        return statusRead;
      },
    };
    const capabilities = await Promise.all(
      capabilityIds.map((capabilityId) => context.getCapabilityStatus(capabilityId)),
    );
    const status = this.aggregateSnapshotStatus(capabilities);
    const available = capabilities.some(isCapabilityAvailable);
    const healthy = capabilities.length > 0 && capabilities.every((capability) => capability.healthy === true);
    const recommendedActions = Array.from(
      new Set(capabilities.flatMap((capability) => capability.recommendedActions ?? [])),
    );

    return {
      status,
      healthy,
      available,
      capabilities,
      summary: this.snapshotSummary(status),
      recommendedActions: recommendedActions.length > 0 ? recommendedActions : undefined,
      updatedAt: this.now(),
    };
  }

  private async readCapabilityStatus(
    capabilityId: RuntimeCapabilityId,
    context?: RuntimeReadinessProviderContext,
  ): Promise<RuntimeCapabilityStatus> {
    const provider = this.providersByCapabilityId.get(capabilityId);
    if (!provider) {
      return createRuntimeCapabilityStatus({
        capabilityId,
        status: "unknown",
        summary: `No runtime readiness provider is composed for ${capabilityId}.`,
        reason: {
          code: "runtime.readiness.provider-missing",
          message: `No runtime readiness provider is composed for ${capabilityId}.`,
          category: "unknown",
          retryable: false,
        },
        recommendedActions: ["configure"],
        updatedAt: this.now(),
      });
    }

    try {
      return await provider.getStatus(context);
    } catch {
      return providerFailureStatus(capabilityId, this.now);
    }
  }

  private defaultSnapshotCapabilityIds(): readonly RuntimeCapabilityId[] {
    const composedCapabilityIds = new Set(this.providersByCapabilityId.keys());
    return RUNTIME_CAPABILITY_IDS.filter((capabilityId) => composedCapabilityIds.has(capabilityId));
  }

  private aggregateSnapshotStatus(capabilities: readonly RuntimeCapabilityStatus[]): RuntimeReadinessStatus {
    if (capabilities.length === 0) {
      return "unknown";
    }
    if (capabilities.every((capability) => capability.status === "ready")) {
      return "ready";
    }
    if (capabilities.some(isCapabilityAvailable)) {
      if (capabilities.some((capability) => capability.status === "failed")) {
        return "failed";
      }
      return "degraded";
    }
    return highestPriorityStatus(capabilities.map((capability) => capability.status), SNAPSHOT_STATUS_PRIORITY);
  }

  private snapshotSummary(status: RuntimeReadinessStatus): string {
    switch (status) {
      case "ready":
        return "All runtime capabilities are ready.";
      case "degraded":
        return "Some runtime capabilities are available with limitations.";
      case "failed":
        return "One or more runtime capabilities failed readiness checks.";
      case "installing":
        return "One or more runtime capabilities are installing or checking installation.";
      case "starting":
        return "One or more runtime capabilities are starting.";
      case "not-installed":
        return "One or more runtime capabilities are not installed.";
      case "unavailable":
        return "Runtime capabilities are unavailable on this host.";
      case "unknown":
        return "Runtime capability readiness is unknown.";
    }
  }
}

export function createPythonRuntimeCapabilityStatusProvider(
  options: PythonRuntimeCapabilityStatusProviderOptions,
): RuntimeCapabilityStatusProvider {
  const now = options.now ?? DEFAULT_NOW;
  return {
    capabilityId: "python-runtime",
    async getStatus() {
      const state = await options.readState();
      const status = mapPythonRuntimeLifecycleStateToReadinessStatus(state);
      return createRuntimeCapabilityStatus({
        capabilityId: "python-runtime",
        status,
        summary: `Python runtime is ${state}.`,
        reason: status === "ready" ? undefined : {
          code: `runtime.python.${state}`,
          message: `Python runtime is ${state}.`,
          category: state === "failed" ? "startup" : "unavailable",
          retryable: state !== "starting",
        },
        recommendedActions: statusActions(status),
        updatedAt: now(),
      });
    },
  };
}

export function createComfyUiRuntimeCapabilityStatusProvider(
  options: ComfyUiRuntimeCapabilityStatusProviderOptions,
): RuntimeCapabilityStatusProvider {
  const now = options.now ?? DEFAULT_NOW;
  return {
    capabilityId: "comfyui-runtime",
    async getStatus() {
      const state = await options.readState();
      const status = mapComfyUiRuntimeLifecycleStateToReadinessStatus(state);
      return createRuntimeCapabilityStatus({
        capabilityId: "comfyui-runtime",
        status,
        summary: `ComfyUI runtime is ${state}.`,
        reason: status === "ready" ? undefined : {
          code: `runtime.comfyui.${state}`,
          message: `ComfyUI runtime is ${state}.`,
          category: state === "unhealthy" ? "health" : "unavailable",
          retryable: state !== "starting",
        },
        recommendedActions: statusActions(status),
        updatedAt: now(),
      });
    },
  };
}

export function createRuntimeInstallerCapabilityStatusProvider(
  options: RuntimeInstallerCapabilityStatusProviderOptions,
): RuntimeCapabilityStatusProvider {
  const now = options.now ?? DEFAULT_NOW;
  return {
    capabilityId: options.capabilityId,
    async getStatus() {
      const installStatus = await options.readStatus();
      const status = mapRuntimeInstallStatusToReadinessStatus(installStatus);
      return createRuntimeCapabilityStatus({
        capabilityId: options.capabilityId,
        status,
        summary: `Runtime install status is ${installStatus}.`,
        details: {
          installStatus,
          targetId: options.targetId,
        },
        reason: status === "ready" ? undefined : {
          code: `runtime.install.${installStatus}`,
          message: installStatus === "installed"
            ? "Runtime is installed; process readiness must be read from its supervisor."
            : `Runtime install status is ${installStatus}.`,
          category: "installation",
          retryable: installStatus === "failed" || installStatus === "unknown",
        },
        recommendedActions: statusActions(status),
        updatedAt: now(),
      });
    },
  };
}

export function createCompositeRuntimeCapabilityStatusProvider(
  options: CompositeRuntimeCapabilityStatusProviderOptions,
): RuntimeCapabilityStatusProvider {
  if (options.providers.length === 0) {
    throw new Error(
      `Composite provider for '${options.capabilityId}' requires at least one signal provider.`,
    );
  }
  for (const provider of options.providers) {
    if (provider.capabilityId !== options.capabilityId) {
      throw new Error(
        `Composite provider for '${options.capabilityId}' received signal provider for '${provider.capabilityId}'.`,
      );
    }
  }

  const now = options.now ?? DEFAULT_NOW;
  return {
    capabilityId: options.capabilityId,
    async getStatus() {
      const statuses = await Promise.all(
        options.providers.map(async (provider) => {
          try {
            return await provider.getStatus();
          } catch {
            return providerFailureStatus(options.capabilityId, now);
          }
        }),
      );
      return combineRuntimeCapabilityStatuses(options.capabilityId, statuses, now);
    },
  };
}

export function createDerivedRuntimeCapabilityStatusProvider(
  options: DerivedRuntimeCapabilityStatusProviderOptions,
): RuntimeCapabilityStatusProvider {
  const now = options.now ?? DEFAULT_NOW;
  return {
    capabilityId: options.capabilityId,
    async getStatus(context) {
      const readDependencyStatus = context?.getCapabilityStatus ?? options.readDependencyStatus;
      const dependencies = await Promise.all(
        options.dependencies.map(async (dependencyId): Promise<RuntimeCapabilityDependencyStatus> => {
          try {
            const dependency = await readDependencyStatus(dependencyId);
            return {
              capabilityId: dependency.capabilityId,
              status: dependency.status,
              healthy: dependency.healthy,
              available: dependency.available,
              summary: dependency.summary,
              reason: dependency.reason,
              updatedAt: dependency.updatedAt,
            };
          } catch {
            const failed = providerFailureStatus(dependencyId, now);
            return {
              capabilityId: failed.capabilityId,
              status: failed.status,
              healthy: failed.healthy,
              available: failed.available,
              summary: failed.summary,
              reason: failed.reason,
              updatedAt: failed.updatedAt,
            };
          }
        }),
      );
      const status = deriveFeatureStatus(dependencies);
      const unavailableDependencies = dependencies.filter((dependency) => dependency.available !== true);

      return createRuntimeCapabilityStatus({
        capabilityId: options.capabilityId,
        status,
        summary: status === "ready"
          ? `${options.capabilityId} is ready.`
          : `${options.capabilityId} is ${status} because required runtime dependencies are not ready.`,
        reason: status === "ready" ? undefined : {
          code: "runtime.capability.dependency-not-ready",
          message: `${options.capabilityId} depends on ${unavailableDependencies.map((dependency) => dependency.capabilityId).join(", ")}.`,
          category: "dependency",
          retryable: true,
        },
        recommendedActions: statusActions(status),
        dependencies,
        updatedAt: now(),
      });
    },
  };
}

function deriveFeatureStatus(dependencies: readonly RuntimeCapabilityDependencyStatus[]): RuntimeReadinessStatus {
  if (dependencies.length === 0) {
    return "unknown";
  }
  if (dependencies.every((dependency) => dependency.status === "ready")) {
    return "ready";
  }
  if (dependencies.every((dependency) => dependency.available === true)) {
    return "degraded";
  }
  return highestPriorityStatus(dependencies.map((dependency) => dependency.status), DERIVED_BLOCKING_STATUS_PRIORITY);
}

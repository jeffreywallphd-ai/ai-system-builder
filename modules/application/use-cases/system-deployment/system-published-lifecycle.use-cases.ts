import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";
import {
  SYSTEM_PUBLISHED_LIFECYCLE_SCHEMA_VERSION,
  SYSTEM_RUNTIME_PROFILE_IDS,
  isSystemRuntimeInstanceBoundToDeployment,
  normalizeSystemDeploymentId,
  normalizeSystemDeploymentRunId,
  normalizeSystemDeploymentRuntimeIdentity,
  systemDeploymentFailure,
  systemDeploymentSuccess,
  type InvokeSystemPublishedLifecycleCommand,
  type ReadSystemPublishedLifecycleQuery,
  type SystemDeployment,
  type SystemDeploymentCapabilityPolicy,
  type SystemDeploymentResult,
  type SystemDeploymentRun,
  type SystemPublishedLifecycleAction,
  type SystemPublishedLifecycleProjection,
} from "../../../contracts/system-deployment";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemDeploymentRepositoryPort } from "../../ports/system-deployment";
import type { SystemRuntimeInstanceRepositoryPort } from "../../ports/system-deployment";
import type { SystemDeploymentReleaseBindingResolution } from "../../services/system-deployment";
import type {
  ActivateSystemDeploymentUseCase,
  CancelSystemDeploymentRunUseCase,
  DeactivateSystemDeploymentUseCase,
  InstallSystemDeploymentUseCase,
  StartSystemDeploymentRunUseCase,
  UninstallSystemDeploymentUseCase,
} from "./system-deployment-use-cases";

export interface SystemPublishedLifecycleHostPolicy {
  readonly hostTargetId: string;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly hostCapabilities: readonly string[];
  readonly sandboxQualified: boolean;
  readonly installationPolicy: SystemDeploymentCapabilityPolicy;
}

export interface SystemPublishedLifecycleDependencies {
  readonly repository: SystemDeploymentRepositoryPort;
  readonly runtimeInstances: Pick<
    SystemRuntimeInstanceRepositoryPort,
    "readRuntimeInstanceByDeployment"
  >;
  readonly builds: SystemBuildRepositoryPort;
  readonly systems: SystemBuilderRepositoryPort;
  readonly host: SystemPublishedLifecycleHostPolicy;
  readonly install: Pick<InstallSystemDeploymentUseCase, "execute">;
  readonly activate: Pick<ActivateSystemDeploymentUseCase, "execute">;
  readonly deactivate: Pick<DeactivateSystemDeploymentUseCase, "execute">;
  readonly uninstall: Pick<UninstallSystemDeploymentUseCase, "execute">;
  readonly start: Pick<StartSystemDeploymentRunUseCase, "execute">;
  readonly stop: Pick<CancelSystemDeploymentRunUseCase, "execute">;
  readonly resolveReleaseBindings?: (
    deployment: SystemDeployment,
  ) => Promise<SystemDeploymentReleaseBindingResolution>;
  readonly generateDeploymentId: () => string;
  readonly generateRunId: () => string;
}

export class ReadSystemPublishedLifecycleUseCase {
  public constructor(
    private readonly d: SystemPublishedLifecycleDependencies,
  ) {}

  async execute(
    query: ReadSystemPublishedLifecycleQuery,
  ): Promise<SystemDeploymentResult<SystemPublishedLifecycleProjection>> {
    const source = await readActiveReleaseSource(this.d, query);
    if (!source.ok) return source;
    return systemDeploymentSuccess(await project(this.d, query));
  }
}

export class InvokeSystemPublishedLifecycleUseCase {
  public constructor(
    private readonly d: SystemPublishedLifecycleDependencies,
    private readonly read = new ReadSystemPublishedLifecycleUseCase(d),
  ) {}

  async execute(
    command: InvokeSystemPublishedLifecycleCommand,
  ): Promise<SystemDeploymentResult<SystemPublishedLifecycleProjection>> {
    const before = await this.read.execute(command);
    if (!before.ok) return before;
    if (before.value.revision !== command.expectedRevision)
      return systemDeploymentFailure(
        "deployment.lifecycle.stale",
        "Lifecycle state changed. Refresh before trying again.",
      );
    if (!before.value.eligibleActions.includes(command.action))
      return systemDeploymentFailure(
        "deployment.lifecycle.conflict",
        "That lifecycle action is not available in the current state.",
      );

    const current = await this.d.repository.readCurrentDeployment(
      command.organizationId,
      command.workspaceId,
      command.releaseId,
      this.d.host.hostTargetId,
    );
    let result: SystemDeploymentResult<unknown>;
    switch (command.action) {
      case "install": {
        if (current)
          return systemDeploymentFailure(
            "deployment.lifecycle.conflict",
            "This release is already installed at the current target.",
          );
        const installed = await this.d.install.execute({
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          actorId: command.actorId,
          deploymentId: normalizeSystemDeploymentId(
            this.d.generateDeploymentId(),
          ),
          releaseId: command.releaseId,
          deploymentProfile: this.d.host.deploymentProfile,
          hostTargetId: this.d.host.hostTargetId,
          hostApiVersion: this.d.host.hostApiVersion,
          ...(this.d.host.runtimeAbiVersion
            ? { runtimeAbiVersion: this.d.host.runtimeAbiVersion }
            : {}),
          hostCapabilities: this.d.host.hostCapabilities,
          sandboxQualified: this.d.host.sandboxQualified,
          policy: this.d.host.installationPolicy,
        });
        if (!installed.ok) {
          const reconciled = await this.d.repository.readCurrentDeployment(
            command.organizationId,
            command.workspaceId,
            command.releaseId,
            this.d.host.hostTargetId,
          );
          if (!reconciled) return installed;
          result = await this.d.activate.execute({
            organizationId: command.organizationId,
            workspaceId: command.workspaceId,
            actorId: command.actorId,
            deploymentId: reconciled.deploymentId,
          });
          break;
        }
        result = await this.d.activate.execute({
          organizationId: command.organizationId,
          workspaceId: command.workspaceId,
          actorId: command.actorId,
          deploymentId: installed.value.deploymentId,
        });
        break;
      }
      case "activate":
        result = current
          ? await this.d.activate.execute(internalCommand(command, current))
          : notInstalled();
        break;
      case "deactivate":
        result = current
          ? await this.d.deactivate.execute(internalCommand(command, current))
          : notInstalled();
        break;
      case "uninstall":
        result = current
          ? await this.d.uninstall.execute(internalCommand(command, current))
          : notInstalled();
        break;
      case "start": {
        if (!current) {
          result = notInstalled();
          break;
        }
        const started = await this.d.start.execute({
          ...internalCommand(command, current),
          runId: normalizeSystemDeploymentRunId(this.d.generateRunId()),
          requestedCapabilities: [],
          requestedSecretReferences: [],
          requestedEgressOrigins: [],
        });
        if (started.ok && started.value.status !== "running")
          return systemDeploymentFailure(
            "deployment.lifecycle.start-failed",
            "The published system could not be started. Review its status before trying again.",
          );
        result = started;
        break;
      }
      case "stop": {
        const activeRun = current
          ? await readActiveRun(this.d.repository, current)
          : undefined;
        result = activeRun
          ? await this.d.stop.execute({
              organizationId: command.organizationId,
              workspaceId: command.workspaceId,
              actorId: command.actorId,
              runId: activeRun.runId,
            })
          : systemDeploymentFailure(
              "deployment.lifecycle.not-running",
              "The system is not running.",
            );
        break;
      }
    }
    if (!result.ok) return result;
    return this.read.execute(command);
  }
}

async function readActiveReleaseSource(
  d: SystemPublishedLifecycleDependencies,
  query: ReadSystemPublishedLifecycleQuery,
): Promise<SystemDeploymentResult<true>> {
  const release = await d.builds.readRelease(
    query.workspaceId,
    query.releaseId,
  );
  if (
    !release ||
    String(release.targetWorkspaceId) !== String(query.workspaceId)
  )
    return systemDeploymentFailure(
      "deployment.release.not-found",
      "The published release is unavailable in this workspace.",
    );
  const system = await d.systems.readRecord(
    query.workspaceId,
    release.systemId,
  );
  if (!system || system.status === "archived")
    return systemDeploymentFailure(
      "deployment.release.inactive-source",
      "The published release does not belong to an active system.",
    );
  return systemDeploymentSuccess(true);
}

async function project(
  d: SystemPublishedLifecycleDependencies,
  query: ReadSystemPublishedLifecycleQuery,
): Promise<SystemPublishedLifecycleProjection> {
  const deployment = await d.repository.readCurrentDeployment(
    query.organizationId,
    query.workspaceId,
    query.releaseId,
    d.host.hostTargetId,
  );
  if (!deployment)
    return {
      schemaVersion: SYSTEM_PUBLISHED_LIFECYCLE_SCHEMA_VERSION,
      releaseId: query.releaseId,
      state: "not-installed",
      revision: "not-installed",
      eligibleActions: ["install"],
      health: "stopped",
      diagnostics: [],
    };
  const activeRun = await readActiveRun(d.repository, deployment);
  const runtimeDiagnostic = activeRun
    ? undefined
    : await readRuntimeReadinessDiagnostic(d, deployment);
  const status = lifecycleStatus(
    deployment,
    activeRun,
    runtimeDiagnostic !== undefined,
  );
  return {
    schemaVersion: SYSTEM_PUBLISHED_LIFECYCLE_SCHEMA_VERSION,
    releaseId: query.releaseId,
    state: status.state,
    revision: `deployment:${deployment.revision}:session:${activeRun?.revision ?? "none"}`,
    eligibleActions: status.actions,
    health: deployment.health.status,
    ...(activeRun?.runtimeKind ? { runtimeKind: activeRun.runtimeKind } : {}),
    ...(activeRun?.launchDescriptor
      ? { launchDescriptor: activeRun.launchDescriptor }
      : {}),
    diagnostics: [
      ...(runtimeDiagnostic ? [runtimeDiagnostic] : []),
      ...deployment.health.diagnostics,
      ...(activeRun?.diagnostics ?? []),
    ].slice(0, 20),
  };
}

function lifecycleStatus(
  deployment: SystemDeployment,
  activeRun?: SystemDeploymentRun,
  runtimeBlocked = false,
): {
  readonly state: SystemPublishedLifecycleProjection["state"];
  readonly actions: readonly SystemPublishedLifecycleAction[];
} {
  if (activeRun) return { state: "running", actions: ["stop"] };
  if (deployment.status === "active")
    return {
      state: "active-stopped",
      actions: runtimeBlocked
        ? ["deactivate", "uninstall"]
        : ["start", "deactivate", "uninstall"],
    };
  if (
    ["installed", "inactive", "failed", "degraded"].includes(deployment.status)
  )
    return {
      state: "inactive-stopped",
      actions: runtimeBlocked ? ["uninstall"] : ["activate", "uninstall"],
    };
  if (deployment.status === "uninstalling")
    return { state: "recovering", actions: ["uninstall"] };
  return { state: "recovering", actions: [] };
}

async function readRuntimeReadinessDiagnostic(
  d: SystemPublishedLifecycleDependencies,
  deployment: SystemDeployment,
) {
  let runtimeProfileId: string;
  try {
    runtimeProfileId =
      normalizeSystemDeploymentRuntimeIdentity(deployment).runtimeProfileId;
  } catch {
    return runtimeDiagnostic(
      "deployment.lifecycle.runtime-identity-invalid",
      "This published build has an invalid runtime identity and cannot be started.",
    );
  }

  if (
    runtimeProfileId === SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot &&
    !d.resolveReleaseBindings
  )
    return runtimeDiagnostic(
      "deployment.lifecycle.binding-authority-unavailable",
      "The published chatbot runtime configuration cannot be verified on this host.",
    );

  if (d.resolveReleaseBindings) {
    let bindings: SystemDeploymentReleaseBindingResolution;
    try {
      bindings = await d.resolveReleaseBindings(deployment);
    } catch {
      return runtimeDiagnostic(
        "deployment.lifecycle.binding-unavailable",
        "The published system runtime configuration cannot be verified right now.",
      );
    }
    if (bindings.status === "denied") {
      if (bindings.code === "runtime-binding-missing")
        return runtimeDiagnostic(
          "deployment.lifecycle.runtime-binding-missing",
          "This published chatbot does not contain a release-bound model configuration. In Compose, select a compatible model for the message composer, save the system, create and publish a new build, then install that build.",
        );
      if (bindings.code === "runtime-binding-stale")
        return runtimeDiagnostic(
          "deployment.lifecycle.runtime-binding-stale",
          "The model selected by this published system changed or is unavailable. Correct the model selection in Compose and publish a new build before starting it.",
        );
      return runtimeDiagnostic(
        "deployment.lifecycle.release-unavailable",
        "The exact published runtime configuration is unavailable and cannot be started.",
      );
    }
  }

  if (!deployment.runtimeInstanceId)
    return runtimeDiagnostic(
      "deployment.lifecycle.runtime-instance-missing",
      "This installation predates isolated runtime data. Uninstall and reinstall this published build before starting it.",
    );

  let instance;
  try {
    instance = await d.runtimeInstances.readRuntimeInstanceByDeployment(
      deployment.organizationId,
      deployment.workspaceId,
      deployment.deploymentId,
    );
  } catch {
    return runtimeDiagnostic(
      "deployment.lifecycle.runtime-instance-unavailable",
      "The isolated system data allocation cannot be verified right now.",
    );
  }
  if (
    !instance ||
    instance.runtimeInstanceId !== deployment.runtimeInstanceId ||
    !isSystemRuntimeInstanceBoundToDeployment(
      instance,
      deployment.deploymentId,
      deployment.releaseId,
    ) ||
    instance.status === "deleting" ||
    instance.status === "deleted"
  )
    return runtimeDiagnostic(
      "deployment.lifecycle.runtime-instance-invalid",
      "The isolated system data allocation is unavailable. Uninstall and reinstall this published build before starting it.",
    );
  return undefined;
}

function runtimeDiagnostic(code: string, message: string) {
  return { severity: "error" as const, code, message };
}

async function readActiveRun(
  repository: SystemDeploymentRepositoryPort,
  deployment: SystemDeployment,
): Promise<SystemDeploymentRun | undefined> {
  return (
    await repository.listRuns(
      deployment.organizationId,
      deployment.workspaceId,
      deployment.deploymentId,
    )
  ).find((run) => ["queued", "running", "stopping"].includes(run.status));
}

function internalCommand(
  command: InvokeSystemPublishedLifecycleCommand,
  deployment: SystemDeployment,
) {
  return {
    organizationId: command.organizationId,
    workspaceId: command.workspaceId,
    actorId: command.actorId,
    deploymentId: deployment.deploymentId,
  };
}

const notInstalled = () =>
  systemDeploymentFailure(
    "deployment.lifecycle.not-installed",
    "The published release is not installed at this target.",
  );

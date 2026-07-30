import type { SystemDeploymentRepositoryPort } from "../../ports/system-deployment";
import type { SystemRuntimeInstanceRepositoryPort } from "../../ports/system-deployment";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type {
  SystemBuildRuntimeInteractionBinding,
  SystemBuildRuntimeResourceBinding,
  SystemBuildDigest,
  SystemReleaseId,
} from "../../../contracts/system-build";
import type { OrganizationId } from "../../../contracts/organization";
import {
  SYSTEM_RUNTIME_PROFILE_IDS,
  isSystemRuntimeInstanceBoundToDeployment,
  type SystemDeployment,
  type SystemDeploymentRun,
  type SystemRuntimeInstance,
} from "../../../contracts/system-deployment";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemDeploymentReleaseBindingResolution } from "./system-deployment-release-binding.service";

export interface SystemPublishedConversationRuntimeQuery {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
}

export interface SystemPublishedConversationRuntimeAuthority {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly releaseDigest: SystemBuildDigest;
  readonly deployment: SystemDeployment;
  readonly run: SystemDeploymentRun;
  readonly runtimeInstance: SystemRuntimeInstance;
  readonly systemLabel: string;
  readonly authorityRevision: string;
  readonly resourceBinding: SystemBuildRuntimeResourceBinding;
  readonly interactionBinding: SystemBuildRuntimeInteractionBinding;
}

export type SystemPublishedConversationRuntimeAuthorityResult =
  | Readonly<{ status: "ready"; authority: SystemPublishedConversationRuntimeAuthority }>
  | Readonly<{
      status: "denied";
      code: "deployment-unavailable" | "runtime-instance-unavailable" | "release-unavailable" | "runtime-binding-unavailable" | "runtime-run-unavailable";
      message: string;
    }>;

export class SystemPublishedConversationRuntimeAuthorityService {
  public constructor(
    private readonly dependencies: {
      readonly deployments: Pick<SystemDeploymentRepositoryPort, "readCurrentDeployment" | "listRuns">;
      readonly runtimeInstances: Pick<SystemRuntimeInstanceRepositoryPort, "readRuntimeInstance">;
      readonly builds: Pick<SystemBuildRepositoryPort, "readRelease">;
      readonly systems: Pick<SystemBuilderRepositoryPort, "readRecord">;
      readonly hostTargetId: string;
      readonly resolveReleaseBindings: (deployment: SystemDeployment) => Promise<SystemDeploymentReleaseBindingResolution>;
    },
  ) {}

  public async resolve(query: SystemPublishedConversationRuntimeQuery): Promise<SystemPublishedConversationRuntimeAuthorityResult> {
    const deployment = await this.dependencies.deployments.readCurrentDeployment(
      query.organizationId,
      query.workspaceId,
      query.releaseId,
      this.dependencies.hostTargetId,
    );
    if (!deployment || deployment.status !== "active" || !deployment.runtimeInstanceId || deployment.releaseId !== query.releaseId) {
      return denied("deployment-unavailable", "The running published system is unavailable.");
    }

    const runtimeInstance = await this.dependencies.runtimeInstances.readRuntimeInstance(
      query.organizationId,
      query.workspaceId,
      deployment.runtimeInstanceId,
    );
    if (
      !runtimeInstance ||
      runtimeInstance.status !== "active" ||
      runtimeInstance.organizationId !== query.organizationId ||
      runtimeInstance.workspaceId !== query.workspaceId ||
      !isSystemRuntimeInstanceBoundToDeployment(runtimeInstance, deployment.deploymentId, deployment.releaseId)
    ) {
      return denied("runtime-instance-unavailable", "The published system data session is unavailable.");
    }

    const release = await this.dependencies.builds.readRelease(query.workspaceId, query.releaseId);
    if (!release || release.releaseDigest !== deployment.releaseDigest || release.targetWorkspaceId !== query.workspaceId) {
      return denied("release-unavailable", "The exact published system version is unavailable.");
    }

    const bindings = await this.dependencies.resolveReleaseBindings(deployment).catch(() => undefined);
    if (
      !bindings ||
      bindings.status !== "ready" ||
      bindings.resourceBindings.length !== 1 ||
      bindings.interactionBindings.length !== 1 ||
      bindings.resourceBindings[0]?.instanceId !== bindings.interactionBindings[0]?.composerInstanceId ||
      deployment.runtimeProfileId !== SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot
    ) {
      return denied("runtime-binding-unavailable", "The published conversation configuration is unavailable.");
    }

    const runs = await this.dependencies.deployments.listRuns(
      query.organizationId,
      query.workspaceId,
      deployment.deploymentId,
    );
    const run = [...runs]
      .filter(
        (candidate) =>
          candidate.status === "running" &&
          candidate.releaseId === query.releaseId &&
          launchMatches(candidate, deployment, bindings.resourceBindings[0]!, bindings.interactionBindings[0]!),
      )
      .sort((left, right) =>
        (right.startedAt ?? right.createdAt).localeCompare(left.startedAt ?? left.createdAt),
      )[0];
    if (!run) return denied("runtime-run-unavailable", "The published system is not running.");

    const system = await this.dependencies.systems.readRecord(query.workspaceId, release.systemId);
    if (!system || system.archivedAt) {
      return denied("release-unavailable", "The published system definition is unavailable.");
    }

    return {
      status: "ready",
      authority: {
        organizationId: query.organizationId,
        workspaceId: query.workspaceId,
        releaseId: query.releaseId,
        releaseDigest: release.releaseDigest,
        deployment,
        run,
        runtimeInstance,
        systemLabel: system.name.slice(0, 240),
        authorityRevision: release.createdAt,
        resourceBinding: bindings.resourceBindings[0]!,
        interactionBinding: bindings.interactionBindings[0]!,
      },
    };
  }
}

function launchMatches(
  run: SystemDeploymentRun,
  deployment: SystemDeployment,
  resourceBinding: SystemBuildRuntimeResourceBinding,
  interactionBinding: SystemBuildRuntimeInteractionBinding,
): boolean {
  const launch = run.launchDescriptor;
  return Boolean(
    launch &&
      launch.releaseId === deployment.releaseId &&
      launch.releaseDigest === deployment.releaseDigest &&
      launch.runtimeProfileId === deployment.runtimeProfileId &&
      launch.runtimeResourceBindings?.length === 1 &&
      launch.runtimeInteractionBindings?.length === 1 &&
      launch.runtimeResourceBindings[0]?.instanceId === resourceBinding.instanceId &&
      launch.runtimeResourceBindings[0]?.modelRecordId === resourceBinding.modelRecordId &&
      launch.runtimeResourceBindings[0]?.modelRevisionDigest === resourceBinding.modelRevisionDigest &&
      launch.runtimeInteractionBindings[0]?.composerInstanceId === interactionBinding.composerInstanceId &&
      launch.runtimeInteractionBindings[0]?.historyInstanceId === interactionBinding.historyInstanceId &&
      launch.runtimeInteractionBindings[0]?.transcriptMode === interactionBinding.transcriptMode,
  );
}

function denied(
  code: Extract<SystemPublishedConversationRuntimeAuthorityResult, { status: "denied" }>["code"],
  message: string,
): SystemPublishedConversationRuntimeAuthorityResult {
  return { status: "denied", code, message };
}

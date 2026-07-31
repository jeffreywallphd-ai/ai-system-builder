import type {
  SystemBuildHasherPort,
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import {
  canonicalizeSystemBuildValue,
} from "../system-build";
import {
  createSystemBuilderModelRevisionValue,
  type SystemBuilderModelAuthorityService,
} from "../system-builder";
import {
  createSystemBuilderModelBinding,
} from "../../../contracts/system-builder";
import type {
  SystemBuildRuntimeInteractionBinding,
  SystemBuildRuntimeResourceBinding,
} from "../../../contracts/system-build";
import {
  SYSTEM_RUNTIME_PROFILE_IDS,
  normalizeSystemDeploymentRuntimeIdentity,
  type SystemDeployment,
} from "../../../contracts/system-deployment";

export type SystemDeploymentReleaseBindingResolution =
  | Readonly<{
      status: "ready";
      resourceBindings: readonly SystemBuildRuntimeResourceBinding[];
      interactionBindings: readonly SystemBuildRuntimeInteractionBinding[];
    }>
  | Readonly<{
      status: "denied";
      code:
        | "release-unavailable"
        | "runtime-binding-missing"
        | "runtime-binding-stale";
      message: string;
    }>;

export class SystemDeploymentReleaseBindingService {
  public constructor(
    private readonly dependencies: {
      readonly builds: Pick<SystemBuildRepositoryPort, "readRelease">;
      readonly modelAuthority: SystemBuilderModelAuthorityService;
      readonly hasher: SystemBuildHasherPort;
    },
  ) {}

  public async resolve(
    deployment: Pick<
      SystemDeployment,
      | "workspaceId"
      | "releaseId"
      | "releaseDigest"
      | "runtimeProfileId"
      | "referenceRuntimeKind"
    >,
  ): Promise<SystemDeploymentReleaseBindingResolution> {
    const release = await this.dependencies.builds.readRelease(
      deployment.workspaceId,
      deployment.releaseId,
    );
    if (
      !release ||
      release.releaseDigest !== deployment.releaseDigest ||
      release.targetWorkspaceId !== deployment.workspaceId
    ) {
      return denied(
        "release-unavailable",
        "The release-bound runtime configuration is unavailable.",
      );
    }

    const resourceBindings = [...(release.lock.runtimeResourceBindings ?? [])]
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
    const interactionBindings = [
      ...(release.lock.runtimeInteractionBindings ?? []),
    ].sort((left, right) =>
      left.composerInstanceId.localeCompare(right.composerInstanceId),
    );
    const runtimeProfileId =
      normalizeSystemDeploymentRuntimeIdentity(deployment).runtimeProfileId;
    if (
      runtimeProfileId === SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot &&
      (resourceBindings.length !== 1 ||
        interactionBindings.length !== 1 ||
        interactionBindings[0]?.composerInstanceId !==
          resourceBindings[0]?.instanceId)
    ) {
      return denied(
        "runtime-binding-missing",
        "The published conversation runtime configuration is incomplete.",
      );
    }

    for (const binding of resourceBindings) {
      let normalized;
      try {
        normalized = createSystemBuilderModelBinding(binding.modelRecordId);
      } catch {
        return denied(
          "runtime-binding-stale",
          "The published model selection is no longer available.",
        );
      }
      const resolution = await this.dependencies.modelAuthority.resolve(
        deployment.workspaceId,
        normalized,
      );
      if (resolution.status !== "ready") {
        return denied("runtime-binding-stale", resolution.message);
      }
      const currentDigest = this.dependencies.hasher.digest(
        canonicalizeSystemBuildValue(
          createSystemBuilderModelRevisionValue(resolution.record),
        ),
      );
      if (currentDigest !== binding.modelRevisionDigest) {
        return denied(
          "runtime-binding-stale",
          "The published model selection changed and must be rebuilt.",
        );
      }
    }

    return {
      status: "ready",
      resourceBindings,
      interactionBindings,
    };
  }
}

function denied(
  code: Extract<SystemDeploymentReleaseBindingResolution, { status: "denied" }>["code"],
  message: string,
): SystemDeploymentReleaseBindingResolution {
  return { status: "denied", code, message };
}

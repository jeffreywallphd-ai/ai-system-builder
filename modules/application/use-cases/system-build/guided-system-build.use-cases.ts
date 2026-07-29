import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationTrustLevel,
} from "../../../contracts/asset-implementation";
import {
  systemBuildFailure,
  systemBuildSuccess,
  type ListSystemPublicationWorkspaceQuery,
  type PrepareGuidedSystemBuildQuery,
  type RequestGuidedSystemBuildCommand,
  type SystemBuildPreparation,
  type SystemBuildPreparationCheck,
  type SystemBuildRecord,
  type SystemBuildResult,
  type SystemPublicationBuildSummary,
  type SystemPublicationWorkspace,
} from "../../../contracts/system-build";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemBuildImplementationResolverPort } from "../../ports/system-build";
import type { ValidateSystemBuilderRevisionService } from "../../services/system-builder";
import {
  resolveFirstSystemBuildFacet,
  type RequestSystemBuildUseCase,
} from "./system-build-use-cases";

export interface GuidedSystemBuildProfile {
  readonly id: string;
  readonly label: string;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly availableCapabilities: readonly string[];
  readonly permittedTrustLevels: readonly AssetImplementationTrustLevel[];
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly toolchainProfile: string;
}

export class PrepareGuidedSystemBuildUseCase {
  public constructor(
    private readonly systems: SystemBuilderRepositoryPort,
    private readonly validator: ValidateSystemBuilderRevisionService,
    private readonly profile: GuidedSystemBuildProfile,
    private readonly resolver: SystemBuildImplementationResolverPort,
  ) {}

  public async execute(
    query: PrepareGuidedSystemBuildQuery,
  ): Promise<SystemBuildResult<SystemBuildPreparation>> {
    const [system, revision] = await Promise.all([
      this.systems.readRecord(query.workspaceId, query.systemId),
      this.systems.readRevision(
        query.workspaceId,
        query.systemId,
        query.systemRevisionId,
      ),
    ]);
    if (!system || !revision) {
      return systemBuildFailure(
        "not-found",
        "The selected saved system version is no longer available in this workspace.",
      );
    }

    const validation = await this.validator.execute(revision);
    const implementationsReady = await this.implementationsReady(
      query.workspaceId,
      revision,
    );
    const checks: SystemBuildPreparationCheck[] = [
      {
        id: "saved",
        label: "Saved version",
        status: "passed",
        message: `Version ${revision.revisionNumber} is saved and ready to check.`,
      },
      {
        id: "active",
        label: "System availability",
        status: system.status === "archived" ? "blocked" : "passed",
        message:
          system.status === "archived"
            ? "Restore this system before building it."
            : "This system is active in the current workspace.",
      },
      {
        id: "current",
        label: "Current version",
        status:
          system.currentRevisionId === revision.revisionId
            ? "passed"
            : "blocked",
        message:
          system.currentRevisionId === revision.revisionId
            ? "This is the current saved version."
            : "A newer saved version exists. Reopen it before building.",
      },
      {
        id: "valid",
        label: "Design checks",
        status: validation.status === "invalid" ? "blocked" : "passed",
        message:
          validation.status === "invalid"
            ? "Resolve the design issues shown in Compose before building."
            : "The saved design passed its required checks.",
      },
      {
        id: "implementations",
        label: "Build support",
        status: implementationsReady ? "passed" : "blocked",
        message: implementationsReady
          ? "All system parts are supported at this build location."
          : "One or more system parts are not available at this build location.",
      },
    ];

    return systemBuildSuccess({
      systemId: system.systemId,
      systemRevisionId: revision.revisionId,
      systemName: system.name,
      revisionNumber: revision.revisionNumber,
      targetLabel: this.profile.label,
      status: checks.some((check) => check.status === "blocked")
        ? "blocked"
        : "ready",
      checks,
    });
  }

  private async implementationsReady(
    workspaceId: PrepareGuidedSystemBuildQuery["workspaceId"],
    revision: Awaited<
      ReturnType<SystemBuilderRepositoryPort["readRevision"]>
    > & {},
  ): Promise<boolean> {
    try {
      for (const instance of revision.instances) {
        const result = await resolveFirstSystemBuildFacet(
          this.resolver,
          {
            workspaceId,
            deploymentProfile: this.profile.deploymentProfile,
            availableCapabilities: this.profile.availableCapabilities,
            permittedTrustLevels: this.profile.permittedTrustLevels,
            hostApiVersion: this.profile.hostApiVersion,
            ...(this.profile.runtimeAbiVersion
              ? { runtimeAbiVersion: this.profile.runtimeAbiVersion }
              : {}),
          },
          instance.definitionRef,
        );
        if (result.status !== "ready" || !result.selectedRelease) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}

export class RequestGuidedSystemBuildUseCase {
  public constructor(
    private readonly prepare: PrepareGuidedSystemBuildUseCase,
    private readonly request: Pick<RequestSystemBuildUseCase, "execute">,
    private readonly profile: GuidedSystemBuildProfile,
  ) {}

  public async execute(
    command: RequestGuidedSystemBuildCommand,
  ): Promise<SystemBuildResult<SystemBuildRecord>> {
    const prepared = await this.prepare.execute(command);
    if (!prepared.ok) {
      return systemBuildFailure(
        prepared.error.code,
        prepared.error.message,
        prepared.error.field,
      );
    }
    if (prepared.value.status !== "ready") {
      return systemBuildFailure(
        "conflict",
        "The selected saved system version is not ready to build.",
      );
    }
    return this.request.execute({
      buildId: command.buildId,
      workspaceId: command.workspaceId,
      systemId: command.systemId,
      systemRevisionId: command.systemRevisionId,
      deploymentProfile: this.profile.deploymentProfile,
      availableCapabilities: this.profile.availableCapabilities,
      permittedTrustLevels: this.profile.permittedTrustLevels,
      hostApiVersion: this.profile.hostApiVersion,
      ...(this.profile.runtimeAbiVersion
        ? { runtimeAbiVersion: this.profile.runtimeAbiVersion }
        : {}),
      toolchainProfile: this.profile.toolchainProfile,
      actorId: command.actorId,
    });
  }
}

export class ListSystemPublicationWorkspaceUseCase {
  public constructor(
    private readonly systems: SystemBuilderRepositoryPort,
    private readonly builds: SystemBuildRepositoryPort,
  ) {}

  public async execute(
    query: ListSystemPublicationWorkspaceQuery,
  ): Promise<SystemPublicationWorkspace> {
    const records = (await this.systems.listRecords(query.workspaceId, false))
      .filter((system) => system.status !== "archived")
      .sort((left, right) =>
        left.name.localeCompare(right.name) ||
        String(left.systemId).localeCompare(String(right.systemId)),
      );
    const systems = await Promise.all(
      records.map(async (system) => {
        const [buildRecords, releases] = await Promise.all([
          this.builds.listBuilds(query.workspaceId, system.systemId),
          this.builds.listReleases(query.workspaceId, system.systemId),
        ]);
        const releaseByBuild = new Map(
          releases.map((release) => [String(release.sourceBuildId), release]),
        );
        const ordered = [...buildRecords].sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            String(left.buildId).localeCompare(String(right.buildId)),
        );
        const builds: SystemPublicationBuildSummary[] = ordered
          .map((build, index) => {
            const release = releaseByBuild.get(String(build.buildId));
            const publicationStatus: SystemPublicationBuildSummary["publicationStatus"] = release
              ? "published"
              : build.status === "succeeded" && build.lockDigest
                ? "ready"
                : "unavailable";
            return {
              buildId: build.buildId,
              systemRevisionId: build.systemRevisionId,
              versionNumber: index + 1,
              status: build.status,
              publicationStatus,
              statusMessage: publicationMessage(build.status, publicationStatus),
              createdAt: build.createdAt,
              ...(build.completedAt ? { completedAt: build.completedAt } : {}),
              ...(build.lockDigest
                ? { expectedLockDigest: build.lockDigest }
                : {}),
              ...(release
                ? {
                    releaseId: release.releaseId,
                    publishedAt: release.approvedAt,
                  }
                : {}),
              outputCount: build.outputArtifacts.length,
              evidenceCount: build.evidenceArtifacts.length,
              diagnosticCount: build.diagnostics.length,
            };
          })
          .sort(
            (left, right) =>
              right.versionNumber - left.versionNumber,
          );
        return { systemId: system.systemId, name: system.name, builds };
      }),
    );
    return { systems };
  }
}

function publicationMessage(
  buildStatus: SystemPublicationBuildSummary["status"],
  publicationStatus: SystemPublicationBuildSummary["publicationStatus"],
): string {
  if (publicationStatus === "published") return "Published";
  if (publicationStatus === "ready") return "Ready to publish";
  if (buildStatus === "failed") return "Build checks did not pass";
  if (buildStatus === "cancelled") return "Build was cancelled";
  if (buildStatus === "running" || buildStatus === "queued")
    return "Build is still in progress";
  return "This build cannot be published";
}

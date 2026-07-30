import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type {
  SystemBuildArtifactPort,
  SystemBuildHasherPort,
  SystemBuildImplementationResolverPort,
  SystemBuildMaterializerPort,
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import {
  createSystemBuilderModelRevisionValue,
  type SystemBuilderModelAuthorityService,
  type ValidateSystemBuilderRevisionService,
} from "../../services/system-builder";
import { canonicalizeSystemBuildValue } from "../../services/system-build";
import type {
  AssetImplementationFacetKind,
  AssetImplementationResolutionResult,
} from "../../../contracts/asset-implementation";
import type { AssetReference } from "../../../contracts/asset";
import {
  readSystemBuilderConversationInteraction,
  readSystemBuilderModelBinding,
  SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
} from "../../../contracts/system-builder";
import {
  normalizeSystemReleaseId,
  systemBuildFailure,
  systemBuildSuccess,
  type ApproveSystemReleaseCommand,
  type CancelSystemBuildCommand,
  type CompareSystemReleasesQuery,
  type ListSystemBuildsQuery,
  type ListSystemReleasesQuery,
  type ReadSystemBuildQuery,
  type ReadSystemReleaseQuery,
  type RequestSystemBuildCommand,
  type SystemBuildDiagnostic,
  type SystemBuildLockManifest,
  type SystemBuildRecord,
  type SystemBuildRuntimeResourceBinding,
  type SystemBuildRuntimeInteractionBinding,
  type SystemBuildResolvedImplementation,
  type SystemBuildResult,
  type SystemRelease,
  type SystemReleaseComparison,
} from "../../../contracts/system-build";

const FACET_RESOLUTION_ORDER: readonly AssetImplementationFacetKind[] = [
  "ui",
  "logic",
  "workflow",
  "data",
  "migration",
  "policy",
  "test",
  "declarative",
];
const MAX_DIAGNOSTICS = 200;
const MAX_SYSTEM_INSTANCES = 5_000;

export interface SystemBuildUseCaseDependencies {
  readonly repository: SystemBuildRepositoryPort;
  readonly systems: SystemBuilderRepositoryPort;
  readonly validator: ValidateSystemBuilderRevisionService;
  readonly resolver: SystemBuildImplementationResolverPort;
  readonly artifacts: SystemBuildArtifactPort;
  readonly hasher: SystemBuildHasherPort;
  readonly materializer: SystemBuildMaterializerPort;
  readonly modelAuthority?: SystemBuilderModelAuthorityService;
  readonly now?: () => string;
}

export class RequestSystemBuildUseCase {
  private readonly now: () => string;
  public constructor(
    private readonly dependencies: SystemBuildUseCaseDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    command: RequestSystemBuildCommand,
  ): Promise<SystemBuildResult<SystemBuildRecord>> {
    const queued: SystemBuildRecord = {
      buildId: command.buildId,
      targetWorkspaceId: command.workspaceId,
      systemId: command.systemId,
      systemRevisionId: command.systemRevisionId,
      status: "queued",
      revision: 0,
      outputArtifacts: [],
      evidenceArtifacts: [],
      diagnostics: [],
      assurance: "not-verified",
      cancellationRequested: false,
      createdAt: this.now(),
      requestedBy: command.actorId,
    };
    try {
      await this.dependencies.repository.createBuild(queued);
    } catch {
      return systemBuildFailure(
        "conflict",
        "A build with this id already exists.",
        "buildId",
      );
    }

    let running = {
      ...queued,
      status: "running" as const,
      revision: 1,
      startedAt: this.now(),
    };
    await this.dependencies.repository.updateBuild(running, 0);
    try {
      const systemRevision = await this.dependencies.systems.readRevision(
        command.workspaceId,
        command.systemId,
        command.systemRevisionId,
      );
      if (!systemRevision)
        return await this.fail(running, [
          {
            severity: "error",
            code: "system.revision.not-found",
            message:
              "The requested immutable system revision was not found in this workspace.",
          },
        ]);
      if (systemRevision.instances.length > MAX_SYSTEM_INSTANCES)
        return await this.fail(running, [
          {
            severity: "error",
            code: "system.build.instance-count-exceeded",
            message: `System builds support at most ${MAX_SYSTEM_INSTANCES} instances.`,
          },
        ]);
      const validation =
        await this.dependencies.validator.execute(systemRevision);
      const validationDiagnostics: SystemBuildDiagnostic[] =
        validation.issues.map((issue) => ({
          severity: issue.severity,
          code: `system.validation.${issue.category}`,
          message: issue.message,
          ...(issue.path ? { path: issue.path } : {}),
        }));
      if (validation.status === "invalid")
        return await this.fail(running, validationDiagnostics);

      const runtimeResourceBindings: SystemBuildRuntimeResourceBinding[] = [];
      for (const instance of systemRevision.instances) {
        if (
          String(instance.definitionRef.id) !==
          "conversation.message-composer"
        ) {
          continue;
        }
        const binding = readSystemBuilderModelBinding(
          instance.selectedConfiguration?.[
            SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID
          ],
        );
        const resolution = this.dependencies.modelAuthority
          ? await this.dependencies.modelAuthority.resolve(
              command.workspaceId,
              binding,
            )
          : undefined;
        if (!resolution || resolution.status === "denied") {
          return await this.fail(running, [
            ...validationDiagnostics,
            {
              severity: "error",
              code: "system.build.model-binding-unavailable",
              message:
                resolution?.status === "denied"
                  ? resolution.message
                  : "Model selection authority is unavailable.",
              path: [
                "instances",
                String(instance.instanceId),
                "selectedConfiguration",
                SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
              ],
            },
          ]);
        }
        runtimeResourceBindings.push({
          instanceId: String(instance.instanceId),
          bindingKind: "model-record",
          capabilityKind: "text-generation",
          modelRecordId: resolution.binding.modelRecordId,
          modelRevisionDigest: this.dependencies.hasher.digest(
            canonicalizeSystemBuildValue(
              createSystemBuilderModelRevisionValue(resolution.record),
            ),
          ),
        });
      }

      const runtimeInteractionBindings: SystemBuildRuntimeInteractionBinding[] =
        [];
      const instancesById = new Map(
        systemRevision.instances.map((instance) => [
          String(instance.instanceId),
          instance,
        ]),
      );
      for (const binding of systemRevision.bindings) {
        const interaction = readSystemBuilderConversationInteraction(binding);
        if (!interaction) continue;
        const composer = instancesById.get(interaction.composerInstanceId);
        const history = instancesById.get(interaction.historyInstanceId);
        if (
          String(composer?.definitionRef.id) !==
            "conversation.message-composer" ||
          String(history?.definitionRef.id) !==
            "conversation.message-history-display"
        ) {
          return await this.fail(running, [
            ...validationDiagnostics,
            {
              severity: "error",
              code: "system.build.conversation-interaction-invalid",
              message:
                "The conversation interaction does not connect the required composer and history assets.",
              path: ["bindings", String(binding.bindingId)],
            },
          ]);
        }
        runtimeInteractionBindings.push({
          interactionKind: interaction.kind,
          composerInstanceId: interaction.composerInstanceId,
          historyInstanceId: interaction.historyInstanceId,
          transcriptMode: interaction.transcriptMode,
        });
      }
      if (
        runtimeResourceBindings.length > 0 &&
        (runtimeInteractionBindings.length !== runtimeResourceBindings.length ||
          runtimeResourceBindings.some(
            (resource) =>
              !runtimeInteractionBindings.some(
                (interaction) =>
                  interaction.composerInstanceId === resource.instanceId,
              ),
          ))
      ) {
        return await this.fail(running, [
          ...validationDiagnostics,
          {
            severity: "error",
            code: "system.build.conversation-interaction-missing",
            message:
              "Each conversation model binding requires one persisted-history interaction.",
            path: ["bindings"],
          },
        ]);
      }

      const resolved: SystemBuildResolvedImplementation[] = [];
      const resolutionDiagnostics: SystemBuildDiagnostic[] = [];
      for (const instance of systemRevision.instances) {
        const result = await resolveFirstSystemBuildFacet(
          this.dependencies.resolver,
          command,
          instance.definitionRef,
        );
        if (result.status !== "ready" || !result.selectedRelease) {
          resolutionDiagnostics.push(
            ...result.diagnostics.map((item) => ({
              severity: item.severity,
              code: item.code,
              message: item.message,
              path: [
                "instances",
                String(instance.instanceId),
                "implementation",
              ],
            })),
          );
          continue;
        }
        resolved.push({
          instanceId: String(instance.instanceId),
          definitionRef: instance.definitionRef,
          releaseId: String(result.selectedRelease.releaseId),
          releaseVersion: result.selectedRelease.version,
          packageDigest: result.selectedRelease.packageDigest,
          trustLevel: result.selectedRelease.trustLevel,
          facets: result.selectedFacets,
        });
      }
      if (resolutionDiagnostics.some((item) => item.severity === "error"))
        return await this.fail(running, [
          ...validationDiagnostics,
          ...resolutionDiagnostics,
        ]);
      if (await this.cancelled(command.workspaceId, command.buildId))
        return (await this.dependencies.repository.readBuild(
          command.workspaceId,
          command.buildId,
        ))
          ? systemBuildSuccess(
              (await this.dependencies.repository.readBuild(
                command.workspaceId,
                command.buildId,
              ))!,
            )
          : systemBuildFailure("not-found", "Build was not found.");

      const revisionDigest = this.dependencies.hasher.digest(
        canonicalizeSystemBuildValue(systemRevision),
      );
      const lock: SystemBuildLockManifest = {
        schemaVersion: "1.0",
        systemId: command.systemId,
        systemRevisionId: command.systemRevisionId,
        systemRevisionDigest: revisionDigest,
        deploymentProfile: command.deploymentProfile,
        hostApiVersion: command.hostApiVersion,
        ...(command.runtimeAbiVersion
          ? { runtimeAbiVersion: command.runtimeAbiVersion }
          : {}),
        toolchainProfile: command.toolchainProfile,
        policyCompilerVersion: "policy-compiler/1.0.0",
        workflowCompilerVersion: "workflow-compiler/1.0.0",
        schemaCompilerVersion: "schema-compiler/1.0.0",
        resolvedImplementations: resolved.sort((left, right) =>
          left.instanceId.localeCompare(right.instanceId),
        ),
        runtimeResourceBindings: runtimeResourceBindings.sort((left, right) =>
          left.instanceId.localeCompare(right.instanceId),
        ),
        runtimeInteractionBindings: runtimeInteractionBindings.sort(
          (left, right) =>
            left.composerInstanceId.localeCompare(right.composerInstanceId),
        ),
      };
      const lockDigest = this.dependencies.hasher.digest(
        canonicalizeSystemBuildValue(lock),
      );
      const materialized = await this.dependencies.materializer.materialize({
        revision: systemRevision,
        lock,
      });
      const outputs = [];
      for (const artifact of materialized)
        outputs.push(
          await this.dependencies.artifacts.putImmutable({
            workspaceId: command.workspaceId,
            ...artifact,
          }),
        );
      if (await this.cancelled(command.workspaceId, command.buildId))
        return systemBuildSuccess(
          (await this.dependencies.repository.readBuild(
            command.workspaceId,
            command.buildId,
          ))!,
        );
      const provenance = createProvenance(lock, lockDigest, outputs);
      const evidence = createEvidence(
        validationDiagnostics,
        resolutionDiagnostics,
        outputs,
      );
      const provenanceArtifact = await this.dependencies.artifacts.putImmutable(
        {
          workspaceId: command.workspaceId,
          kind: "provenance",
          mediaType: "application/vnd.in-toto+json",
          content: canonicalizeSystemBuildValue(provenance),
        },
      );
      const evidenceArtifact = await this.dependencies.artifacts.putImmutable({
        workspaceId: command.workspaceId,
        kind: "evidence",
        mediaType: "application/vnd.ai-system-builder.build-evidence+json",
        content: canonicalizeSystemBuildValue(evidence),
      });
      const completed: SystemBuildRecord = {
        ...running,
        status: "succeeded",
        revision: running.revision + 1,
        lock,
        lockDigest,
        outputArtifacts: outputs,
        evidenceArtifacts: [provenanceArtifact, evidenceArtifact],
        diagnostics: [...validationDiagnostics, ...resolutionDiagnostics].slice(
          0,
          MAX_DIAGNOSTICS,
        ),
        assurance: "repeatable",
        completedAt: this.now(),
      };
      return systemBuildSuccess(
        await this.dependencies.repository.updateBuild(
          completed,
          running.revision,
        ),
      );
    } catch (error) {
      const safe =
        error instanceof Error &&
        /^(A mutating system|Raw secret-like configuration|System build artifact)/.test(
          error.message,
        )
          ? error.message
          : "The system build failed safely. Review the build inputs and retry.";
      return this.fail(running, [
        { severity: "error", code: "system.build.failed", message: safe },
      ]);
    }
  }

  private async cancelled(
    workspaceId: RequestSystemBuildCommand["workspaceId"],
    buildId: RequestSystemBuildCommand["buildId"],
  ): Promise<boolean> {
    return (
      (await this.dependencies.repository.readBuild(workspaceId, buildId))
        ?.cancellationRequested === true
    );
  }

  private async fail(
    current: SystemBuildRecord,
    diagnostics: readonly SystemBuildDiagnostic[],
  ): Promise<SystemBuildResult<SystemBuildRecord>> {
    const latest = await this.dependencies.repository.readBuild(
      current.targetWorkspaceId,
      current.buildId,
    );
    if (latest?.status === "cancelled") return systemBuildSuccess(latest);
    const failed: SystemBuildRecord = {
      ...current,
      status: "failed",
      revision: current.revision + 1,
      diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
      completedAt: this.now(),
    };
    return systemBuildSuccess(
      await this.dependencies.repository.updateBuild(failed, current.revision),
    );
  }
}

export async function resolveFirstSystemBuildFacet(
  resolver: SystemBuildImplementationResolverPort,
  command: Pick<
    RequestSystemBuildCommand,
    | "workspaceId"
    | "deploymentProfile"
    | "availableCapabilities"
    | "permittedTrustLevels"
    | "hostApiVersion"
    | "runtimeAbiVersion"
  >,
  definitionRef: AssetReference,
): Promise<AssetImplementationResolutionResult> {
  let mostActionable: AssetImplementationResolutionResult | undefined;
  for (const facet of FACET_RESOLUTION_ORDER) {
    const result = await resolver.resolve({
      workspaceId: command.workspaceId,
      definitionRef,
      requiredFacets: [facet],
      deploymentProfile: command.deploymentProfile,
      availableCapabilities: command.availableCapabilities,
      permittedTrustLevels: command.permittedTrustLevels,
      hostApiVersion: command.hostApiVersion,
      ...(command.runtimeAbiVersion
        ? { runtimeAbiVersion: command.runtimeAbiVersion }
        : {}),
    });
    if (result.status === "ready") return result;
    if (
      !mostActionable ||
      ["revoked", "blocked", "setup-required"].includes(result.status)
    )
      mostActionable = result;
  }
  return mostActionable!;
}

export class CancelSystemBuildUseCase {
  private readonly now: () => string;
  public constructor(
    private readonly repository: SystemBuildRepositoryPort,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.now = now;
  }
  public async execute(
    command: CancelSystemBuildCommand,
  ): Promise<SystemBuildResult<SystemBuildRecord>> {
    const build = await this.repository.readBuild(
      command.workspaceId,
      command.buildId,
    );
    if (!build) return systemBuildFailure("not-found", "Build was not found.");
    if (["succeeded", "failed", "cancelled"].includes(build.status))
      return systemBuildFailure(
        "conflict",
        "Only queued or running builds can be cancelled.",
      );
    return systemBuildSuccess(
      await this.repository.updateBuild(
        {
          ...build,
          status: "cancelled",
          cancellationRequested: true,
          revision: build.revision + 1,
          completedAt: this.now(),
          diagnostics: [
            ...build.diagnostics,
            {
              severity: "info",
              code: "system.build.cancelled",
              message: "Build cancellation was requested.",
            },
          ],
        },
        build.revision,
      ),
    );
  }
}

export class ApproveSystemReleaseUseCase {
  private readonly now: () => string;
  public constructor(
    private readonly repository: SystemBuildRepositoryPort,
    private readonly artifacts: SystemBuildArtifactPort,
    private readonly hasher: SystemBuildHasherPort,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.now = now;
  }
  public async execute(
    command: ApproveSystemReleaseCommand,
  ): Promise<SystemBuildResult<SystemRelease>> {
    const build = await this.repository.readBuild(
      command.workspaceId,
      command.buildId,
    );
    if (!build) return systemBuildFailure("not-found", "Build was not found.");
    if (build.status !== "succeeded" || !build.lock || !build.lockDigest)
      return systemBuildFailure(
        "conflict",
        "Only a successful evidence-backed build can be approved.",
      );
    if (build.lockDigest !== command.expectedLockDigest)
      return systemBuildFailure(
        "conflict",
        "The build lock changed; review the build again before approval.",
        "expectedLockDigest",
      );
    const allArtifacts = [...build.outputArtifacts, ...build.evidenceArtifacts];
    try {
      for (const artifact of allArtifacts)
        await this.artifacts.readVerified(command.workspaceId, artifact);
    } catch {
      return systemBuildFailure(
        "integrity",
        "A build artifact failed integrity verification; release publication was denied.",
      );
    }
    const releaseDigest = this.hasher.digest(
      canonicalizeSystemBuildValue({
        lockDigest: build.lockDigest,
        artifacts: allArtifacts
          .map((item) => ({ kind: item.kind, digest: item.digest }))
          .sort((left, right) =>
            `${left.kind}:${left.digest}`.localeCompare(
              `${right.kind}:${right.digest}`,
            ),
          ),
      }),
    );
    const derivedReleaseId = normalizeSystemReleaseId(
      `system-release:${releaseDigest.slice("sha256:".length)}`,
    );
    if (command.releaseId && command.releaseId !== derivedReleaseId)
      return systemBuildFailure(
        "validation",
        "Release id must match the content-addressed release digest.",
        "releaseId",
      );
    const createdAt = this.now();
    const release: SystemRelease = {
      releaseId: derivedReleaseId,
      targetWorkspaceId: command.workspaceId,
      systemId: build.systemId,
      systemRevisionId: build.systemRevisionId,
      sourceBuildId: build.buildId,
      lockDigest: build.lockDigest,
      releaseDigest,
      lock: build.lock,
      artifacts: allArtifacts,
      compatibility: {
        deploymentProfiles: compatibleDeploymentProfiles(build.lock),
        hostApiVersion: build.lock.hostApiVersion,
        ...(build.lock.runtimeAbiVersion
          ? { runtimeAbiVersion: build.lock.runtimeAbiVersion }
          : {}),
      },
      assurance: build.assurance,
      approvedAt: createdAt,
      approvedBy: command.actorId,
      createdAt,
    };
    try {
      return systemBuildSuccess(await this.repository.saveRelease(release));
    } catch {
      return systemBuildFailure(
        "conflict",
        "A different release already uses this content address.",
      );
    }
  }
}

function compatibleDeploymentProfiles(
  lock: SystemBuildLockManifest,
): SystemRelease["compatibility"]["deploymentProfiles"] {
  if (
    lock.resolvedImplementations.length === 0 ||
    lock.resolvedImplementations.some(
      (implementation) => implementation.facets.length === 0,
    )
  )
    return [lock.deploymentProfile];
  const candidates = [
    "local-desktop",
    "campus-server",
    "cloud-server",
    "thin-client",
  ] as const;
  const supported = candidates.filter((profile) =>
    lock.resolvedImplementations.every((implementation) =>
      implementation.facets.every((facet) =>
        facet.compatibility.deploymentProfiles.includes(profile),
      ),
    ),
  );
  return supported.length ? supported : [lock.deploymentProfile];
}

export class ReadSystemBuildUseCase {
  public constructor(private readonly repository: SystemBuildRepositoryPort) {}
  public async execute(query: ReadSystemBuildQuery) {
    const value = await this.repository.readBuild(
      query.workspaceId,
      query.buildId,
    );
    return value
      ? systemBuildSuccess(value)
      : systemBuildFailure("not-found", "Build was not found.");
  }
}
export class ListSystemBuildsUseCase {
  public constructor(private readonly repository: SystemBuildRepositoryPort) {}
  public execute(query: ListSystemBuildsQuery) {
    return this.repository.listBuilds(query.workspaceId, query.systemId);
  }
}
export class ReadSystemReleaseUseCase {
  public constructor(private readonly repository: SystemBuildRepositoryPort) {}
  public async execute(query: ReadSystemReleaseQuery) {
    const value = await this.repository.readRelease(
      query.workspaceId,
      query.releaseId,
    );
    return value
      ? systemBuildSuccess(value)
      : systemBuildFailure("not-found", "Release was not found.");
  }
}
export class ListSystemReleasesUseCase {
  public constructor(private readonly repository: SystemBuildRepositoryPort) {}
  public execute(query: ListSystemReleasesQuery) {
    return this.repository.listReleases(query.workspaceId, query.systemId);
  }
}

export class CompareSystemReleasesUseCase {
  public constructor(private readonly repository: SystemBuildRepositoryPort) {}
  public async execute(
    query: CompareSystemReleasesQuery,
  ): Promise<SystemBuildResult<SystemReleaseComparison>> {
    const [left, right] = await Promise.all([
      this.repository.readRelease(query.workspaceId, query.leftReleaseId),
      this.repository.readRelease(query.workspaceId, query.rightReleaseId),
    ]);
    if (!left || !right)
      return systemBuildFailure(
        "not-found",
        "Both releases must exist in this workspace.",
      );
    const leftArtifacts = new Set(left.artifacts.map((item) => item.digest));
    const rightArtifacts = new Set(right.artifacts.map((item) => item.digest));
    const leftImpl = new Map(
      left.lock.resolvedImplementations.map((item) => [item.instanceId, item]),
    );
    const changedImplementationInstanceIds = right.lock.resolvedImplementations
      .filter(
        (item) => leftImpl.get(item.instanceId)?.releaseId !== item.releaseId,
      )
      .map((item) => item.instanceId);
    return systemBuildSuccess({
      sameInputs: left.lockDigest === right.lockDigest,
      sameArtifacts: left.releaseDigest === right.releaseDigest,
      changedImplementationInstanceIds,
      addedArtifactDigests: [...rightArtifacts].filter(
        (item) => !leftArtifacts.has(item),
      ),
      removedArtifactDigests: [...leftArtifacts].filter(
        (item) => !rightArtifacts.has(item),
      ),
    });
  }
}

function createProvenance(
  lock: SystemBuildLockManifest,
  lockDigest: string,
  outputs: readonly { kind: string; digest: string }[],
) {
  return {
    _type: "https://in-toto.io/Statement/v1",
    subject: outputs.map((item) => ({
      name: item.kind,
      digest: { sha256: item.digest.replace(/^sha256:/, "") },
    })),
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://ai-system-builder.local/system-build/v1",
        externalParameters: {
          deploymentProfile: lock.deploymentProfile,
          hostApiVersion: lock.hostApiVersion,
        },
        internalParameters: { lockDigest },
        resolvedDependencies: lock.resolvedImplementations.map((item) => ({
          uri: `asset:${item.definitionRef.id}@${item.definitionRef.version}`,
          digest: { sha256: item.packageDigest.replace(/^sha256:/, "") },
        })),
      },
      runDetails: {
        builder: { id: lock.toolchainProfile },
        metadata: { invocationId: lockDigest },
      },
    },
  };
}
function createEvidence(
  validation: readonly SystemBuildDiagnostic[],
  resolution: readonly SystemBuildDiagnostic[],
  outputs: readonly { kind: string; digest: string }[],
) {
  return {
    schemaVersion: "1.0",
    assurance: "repeatable",
    checks: {
      compositionValidation: validation.every(
        (item) => item.severity !== "error",
      ),
      implementationResolution: resolution.every(
        (item) => item.severity !== "error",
      ),
      deterministicMaterialization: true,
      artifactIntegrityAtWrite: true,
      independentRebuild: false,
    },
    outputDigests: outputs.map((item) => ({
      kind: item.kind,
      digest: item.digest,
    })),
  };
}

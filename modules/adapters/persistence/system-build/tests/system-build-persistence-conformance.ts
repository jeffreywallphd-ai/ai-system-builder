import assert from "node:assert/strict";

import { ListSystemPublicationWorkspaceUseCase } from "../../../../application/use-cases/system-build";
import type { SystemBuilderRepositoryPort } from "../../../../application/ports/system-builder";
import type { SystemBuildRecord, SystemRelease } from "../../../../contracts/system-build";
import type { StructuredDocumentStore } from "../../shared";
import { createStructuredSystemBuildRepository } from "../createStructuredSystemBuildRepository";

const BUILD_NAMESPACE = "system-build/builds";
const RELEASE_NAMESPACE = "system-build/releases";

export interface SystemBuildPersistenceConformanceResult {
  readonly buildCount: number;
  readonly releaseCount: number;
  readonly staleConflict: boolean;
  readonly immutableReleaseConflict: boolean;
  readonly workspaceIsolation: boolean;
  readonly rollbackSafe: boolean;
  readonly restartSafe: boolean;
  readonly newestVersionNumber: number;
  readonly elapsedMs: number;
}

export async function runSystemBuildPersistenceConformance(
  documents: StructuredDocumentStore,
  prefix: string,
): Promise<SystemBuildPersistenceConformanceResult> {
  const startedAt = performance.now();
  const workspaceId = `workspace-${prefix}`;
  const otherWorkspaceId = `workspace-other-${prefix}`;
  const systemId = `system-${prefix}`;
  const revisionId = `revision-${prefix}`;
  const repository = createStructuredSystemBuildRepository(documents);
  const builds = Array.from({ length: 36 }, (_, index) =>
    buildFixture({ workspaceId, systemId, revisionId, prefix, index }),
  );
  const release = releaseFixture(builds[3]!, prefix);
  let staleConflict = false;
  let immutableReleaseConflict = false;
  let rollbackSafe = false;
  try {
    for (const build of builds) await repository.createBuild(build);
    await repository.updateBuild(
      { ...builds[0]!, status: "running", revision: 1, startedAt: builds[0]!.createdAt },
      0,
    );
    try {
      await repository.updateBuild(
        { ...builds[0]!, status: "failed", revision: 1 },
        0,
      );
    } catch {
      staleConflict = true;
    }

    await repository.saveRelease(release);
    await repository.saveRelease(release);
    try {
      await repository.saveRelease({ ...release, approvedBy: "different-person" });
    } catch {
      immutableReleaseConflict = true;
    }

    try {
      await documents.runInTransaction(async (transaction) => {
        await transaction.writeDocument(BUILD_NAMESPACE, `${workspaceId}/rolled-back`, {
          value: "temporary",
        });
        throw new Error("expected rollback");
      });
    } catch (error) {
      assert.match(String(error), /expected rollback/);
    }
    rollbackSafe =
      (await documents.readDocument(BUILD_NAMESPACE, `${workspaceId}/rolled-back`)) ===
      undefined;

    const restarted = createStructuredSystemBuildRepository(documents);
    const listed = await restarted.listBuilds(workspaceId as never, systemId as never);
    const releases = await restarted.listReleases(workspaceId as never, systemId as never);
    const workspaceIsolation =
      (await restarted.listBuilds(otherWorkspaceId as never)).length === 0 &&
      (await restarted.listReleases(otherWorkspaceId as never)).length === 0;
    const restartSafe =
      listed.length === builds.length &&
      releases.length === 1 &&
      String(releases[0]?.releaseId) === String(release.releaseId);

    const systemRepository = {
      listRecords: async () => [
        {
          systemId,
          targetWorkspaceId: workspaceId,
          name: "Qualified system",
          status: "validated",
        },
      ],
    } as unknown as SystemBuilderRepositoryPort;
    const publication = await new ListSystemPublicationWorkspaceUseCase(
      systemRepository,
      restarted,
    ).execute({ workspaceId: workspaceId as never });
    const projectedBuilds = publication.systems[0]?.builds ?? [];

    assert.equal(staleConflict, true);
    assert.equal(immutableReleaseConflict, true);
    assert.equal(workspaceIsolation, true);
    assert.equal(rollbackSafe, true);
    assert.equal(restartSafe, true);
    assert.equal(projectedBuilds.length, builds.length);
    assert.equal(projectedBuilds[0]?.versionNumber, builds.length);
    assert.equal(
      projectedBuilds.some((build) => build.publicationStatus === "published"),
      true,
    );
    assert.equal(
      projectedBuilds.some((build) => build.publicationStatus === "ready"),
      true,
    );

    const elapsedMs = Math.round(performance.now() - startedAt);
    assert.ok(elapsedMs < 30_000, `Conformance exceeded 30 seconds: ${elapsedMs}ms`);
    return {
      buildCount: listed.length,
      releaseCount: releases.length,
      staleConflict,
      immutableReleaseConflict,
      workspaceIsolation,
      rollbackSafe,
      restartSafe,
      newestVersionNumber: projectedBuilds[0]?.versionNumber ?? 0,
      elapsedMs,
    };
  } finally {
    for (const build of builds) {
      await documents.deleteDocument(
        BUILD_NAMESPACE,
        `${workspaceId}/${String(build.buildId)}`,
      );
    }
    await documents.deleteDocument(
      RELEASE_NAMESPACE,
      `${workspaceId}/${String(release.releaseId)}`,
    );
    await documents.deleteDocument(BUILD_NAMESPACE, `${workspaceId}/rolled-back`);
  }
}

function buildFixture(input: {
  readonly workspaceId: string;
  readonly systemId: string;
  readonly revisionId: string;
  readonly prefix: string;
  readonly index: number;
}): SystemBuildRecord {
  const status = input.index % 4 === 0
    ? "cancelled"
    : input.index % 4 === 1
      ? "failed"
      : "succeeded";
  return {
    buildId: `build-${input.prefix}-${String(input.index + 1).padStart(3, "0")}`,
    targetWorkspaceId: input.workspaceId,
    systemId: input.systemId,
    systemRevisionId: input.revisionId,
    status,
    revision: 0,
    ...(status === "succeeded" ? { lockDigest: digest(String((input.index % 9) + 1)) } : {}),
    outputArtifacts: [],
    evidenceArtifacts: [],
    diagnostics: [],
    assurance: status === "succeeded" ? "repeatable" : "not-verified",
    cancellationRequested: status === "cancelled",
    createdAt: new Date(Date.UTC(2026, 6, 28, 12, 0, input.index)).toISOString(),
    completedAt: new Date(Date.UTC(2026, 6, 28, 12, 1, input.index)).toISOString(),
    requestedBy: "qualification-user",
  } as unknown as SystemBuildRecord;
}

function releaseFixture(build: SystemBuildRecord, prefix: string): SystemRelease {
  return {
    releaseId: `release-${prefix}`,
    targetWorkspaceId: build.targetWorkspaceId,
    systemId: build.systemId,
    systemRevisionId: build.systemRevisionId,
    sourceBuildId: build.buildId,
    lockDigest: build.lockDigest ?? digest("1"),
    releaseDigest: digest("f"),
    lock: {
      schemaVersion: "1.0",
      systemId: build.systemId,
      systemRevisionId: build.systemRevisionId,
      systemRevisionDigest: digest("e"),
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      toolchainProfile: "system-builder/1.0.0",
      policyCompilerVersion: "1",
      workflowCompilerVersion: "1",
      schemaCompilerVersion: "1",
      resolvedImplementations: [],
    },
    artifacts: [],
    compatibility: {
      deploymentProfiles: ["local-desktop"],
      hostApiVersion: "1.0.0",
    },
    assurance: "repeatable",
    approvedAt: "2026-07-28T13:00:00.000Z",
    approvedBy: "qualification-approver",
    createdAt: "2026-07-28T13:00:00.000Z",
  } as unknown as SystemRelease;
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import type { SystemBuilderRepositoryPort } from "../../../ports/system-builder";
import type { SystemBuildRepositoryPort } from "../../../ports/system-build";
import type { SystemBuildImplementationResolverPort } from "../../../ports/system-build";
import type { ValidateSystemBuilderRevisionService } from "../../../services/system-builder";
import type {
  SystemBuildRecord,
  SystemRelease,
} from "../../../../contracts/system-build";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import {
  ListSystemPublicationWorkspaceUseCase,
  PrepareGuidedSystemBuildUseCase,
  RequestGuidedSystemBuildUseCase,
  type GuidedSystemBuildProfile,
} from "../guided-system-build.use-cases";

const profile: GuidedSystemBuildProfile = {
  id: "local-desktop",
  label: "This computer",
  deploymentProfile: "local-desktop",
  availableCapabilities: ["approved.capability"],
  permittedTrustLevels: ["system-trusted"],
  hostApiVersion: "1.0.0",
  toolchainProfile: "ai-system-builder/1.0.0",
};
const readyResolver = {
  resolve: testDouble.fn(),
} as unknown as SystemBuildImplementationResolverPort;

describe("guided system build use cases", () => {
  it("prepares the exact current saved revision and injects host-owned build policy", async () => {
    const systems = systemsRepository(record(), revision());
    const validator = validatorWith("valid");
    const prepare = new PrepareGuidedSystemBuildUseCase(
      systems,
      validator,
      profile,
      readyResolver,
    );
    const rawRequest = {
      execute: testDouble.fn(async (command: unknown) => ({
        ok: true as const,
        value: command,
      })),
    };
    const guided = new RequestGuidedSystemBuildUseCase(
      prepare,
      rawRequest as never,
      profile,
    );

    const prepared = await prepare.execute({
      workspaceId: "workspace-a" as never,
      systemId: "system-1" as never,
      systemRevisionId: "revision-1" as never,
    });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.value.status).toBe("ready");
      expect(prepared.value.targetLabel).toBe("This computer");
      expect(prepared.value.checks.every((check) => check.status === "passed")).toBe(true);
    }

    await guided.execute({
      workspaceId: "workspace-a" as never,
      buildId: "build-1" as never,
      systemId: "system-1" as never,
      systemRevisionId: "revision-1" as never,
      actorId: "person-1",
    });
    expect(rawRequest.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentProfile: "local-desktop",
        availableCapabilities: ["approved.capability"],
        permittedTrustLevels: ["system-trusted"],
        hostApiVersion: "1.0.0",
        toolchainProfile: "ai-system-builder/1.0.0",
        actorId: "person-1",
      }),
    );
  });

  it("fails closed for stale, archived, or invalid saved revisions", async () => {
    const stale = { ...record(), currentRevisionId: "revision-2" } as SystemBuilderRecord;
    const prepare = new PrepareGuidedSystemBuildUseCase(
      systemsRepository(stale, revision()),
      validatorWith("invalid"),
      profile,
      readyResolver,
    );
    const rawRequest = { execute: testDouble.fn() };
    const guided = new RequestGuidedSystemBuildUseCase(
      prepare,
      rawRequest as never,
      profile,
    );
    const result = await guided.execute({
      workspaceId: "workspace-a" as never,
      buildId: "build-1" as never,
      systemId: "system-1" as never,
      systemRevisionId: "revision-1" as never,
      actorId: "person-1",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(rawRequest.execute).not.toHaveBeenCalled();
  });

  it("reports friendly blocked readiness when an implementation is unavailable", async () => {
    const resolver = {
      resolve: testDouble.fn(async () => ({
        status: "blocked" as const,
        definitionRef: {
          kind: "asset-definition-version" as const,
          id: "builtin.system.system",
          version: "3.0.0",
        },
        selectedFacets: [],
        diagnostics: [
          {
            severity: "error" as const,
            code: "private.resolver.detail",
            message: "private resolver detail",
          },
        ],
      })),
    } as unknown as SystemBuildImplementationResolverPort;
    const saved = {
      ...revision(),
      instances: [
        {
          instanceId: "instance-1",
          definitionRef: {
            kind: "asset-definition-version",
            id: "builtin.system.system",
            version: "3.0.0",
          },
        },
      ],
    } as unknown as SystemBuilderRevision;
    const prepare = new PrepareGuidedSystemBuildUseCase(
      systemsRepository(record(), saved),
      validatorWith("valid"),
      profile,
      resolver,
    );

    const result = await prepare.execute({
      workspaceId: "workspace-a" as never,
      systemId: "system-1" as never,
      systemRevisionId: "revision-1" as never,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("blocked");
      expect(
        result.value.checks.find((check) => check.id === "implementations"),
      ).toEqual({
        id: "implementations",
        label: "Build support",
        status: "blocked",
        message:
          "One or more system parts are not available at this build location.",
      });
    }
    expect(JSON.stringify(result)).not.toContain("private resolver detail");
  });

  it("projects friendly build versions and authoritative publication eligibility", async () => {
    const records = [record()];
    const builds = [
      build("build-failed", "failed", "2026-01-01T00:00:00.000Z"),
      build("build-ready", "succeeded", "2026-01-02T00:00:00.000Z"),
      build("build-published", "succeeded", "2026-01-03T00:00:00.000Z"),
    ];
    const releases = [release("build-published")];
    const systems = {
      listRecords: testDouble.fn(async () => records),
    } as unknown as SystemBuilderRepositoryPort;
    const repository = {
      listBuilds: testDouble.fn(async () => builds),
      listReleases: testDouble.fn(async () => releases),
    } as unknown as SystemBuildRepositoryPort;
    const useCase = new ListSystemPublicationWorkspaceUseCase(
      systems,
      repository,
    );
    const result = await useCase.execute({ workspaceId: "workspace-a" as never });

    expect(result.systems[0]?.builds.map((item) => [
      item.versionNumber,
      item.publicationStatus,
      item.statusMessage,
    ])).toEqual([
      [3, "published", "Published"],
      [2, "ready", "Ready to publish"],
      [1, "unavailable", "Build checks did not pass"],
    ]);
    expect(repository.listBuilds).toHaveBeenCalledWith(
      "workspace-a",
      "system-1",
    );
  });
});

function record(): SystemBuilderRecord {
  return {
    systemId: "system-1",
    targetWorkspaceId: "workspace-a",
    name: "Helpful system",
    status: "validated",
    revision: 1,
    currentRevisionId: "revision-1",
  } as unknown as SystemBuilderRecord;
}

function revision(): SystemBuilderRevision {
  return {
    revisionId: "revision-1",
    systemId: "system-1",
    targetWorkspaceId: "workspace-a",
    revisionNumber: 1,
    instances: [],
  } as unknown as SystemBuilderRevision;
}

function systemsRepository(
  system: SystemBuilderRecord,
  saved: SystemBuilderRevision,
): SystemBuilderRepositoryPort {
  return {
    readRecord: testDouble.fn(async () => system),
    readRevision: testDouble.fn(async () => saved),
  } as unknown as SystemBuilderRepositoryPort;
}

function validatorWith(status: "valid" | "invalid") {
  return {
    execute: testDouble.fn(async () => ({ status, issues: [] })),
  } as unknown as ValidateSystemBuilderRevisionService;
}

function build(
  buildId: string,
  status: SystemBuildRecord["status"],
  createdAt: string,
): SystemBuildRecord {
  return {
    buildId,
    targetWorkspaceId: "workspace-a",
    systemId: "system-1",
    systemRevisionId: "revision-1",
    status,
    revision: 1,
    lockDigest:
      status === "succeeded" ? `sha256:${"a".repeat(64)}` : undefined,
    outputArtifacts: [],
    evidenceArtifacts: [],
    diagnostics: status === "failed" ? [{ severity: "error", code: "safe", message: "Checks failed." }] : [],
    assurance: status === "succeeded" ? "repeatable" : "not-verified",
    cancellationRequested: false,
    createdAt,
    requestedBy: "person-1",
  } as unknown as SystemBuildRecord;
}

function release(sourceBuildId: string): SystemRelease {
  return {
    releaseId: "release-1",
    targetWorkspaceId: "workspace-a",
    systemId: "system-1",
    systemRevisionId: "revision-1",
    sourceBuildId,
    approvedAt: "2026-01-04T00:00:00.000Z",
  } as unknown as SystemRelease;
}

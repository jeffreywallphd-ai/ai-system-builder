import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredSystemDeploymentRepository } from "../createStructuredSystemDeploymentRepository";
import { runSystemDeploymentPersistenceConformance } from "./system-deployment-persistence-conformance";

const deployment = (
  organizationId: string,
  workspaceId: string,
  deploymentId = "deployment-1",
) =>
  ({
    deploymentId,
    organizationId,
    workspaceId,
    releaseId: "release-1",
    releaseDigest: `sha256:${"a".repeat(64)}`,
    referenceRuntimeKind: "secured-data-entry",
    deploymentProfile: "local-desktop",
    status: "installed",
    revision: 0,
    compatibility: {
      compatible: true,
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      runtimeKinds: ["trusted-built-in"],
      trustLevels: ["system-trusted"],
      sandboxRequired: false,
      sandboxQualified: false,
      checkedAt: "2026-07-17T00:00:00.000Z",
      diagnostics: [],
    },
    policy: {
      allowedCapabilities: [],
      allowedSecretReferences: [],
      egress: { mode: "deny-all", allowedOrigins: [] },
      quotas: {
        maximumRunSeconds: 60,
        maximumMemoryMiB: 256,
        maximumOutputBytes: 1024,
        maximumConcurrentRuns: 1,
      },
    },
    health: {
      status: "unknown",
      checkedAt: "2026-07-17T00:00:00.000Z",
      diagnostics: [],
    },
    installedAt: "2026-07-17T00:00:00.000Z",
    installedBy: "person-1",
    updatedAt: "2026-07-17T00:00:00.000Z",
  }) as any;

describe("structured system deployment repository", () => {
  it("passes the retained lifecycle persistence conformance", async () => {
    await expect(
      runSystemDeploymentPersistenceConformance(
        createInMemoryStructuredDocumentStore(),
        "memory",
      ),
    ).resolves.toMatchObject({
      currentConflict: true,
      retainedDeploymentCount: 2,
      retainedRunCount: 1,
      restartSafe: true,
      workspaceIsolation: true,
    });
  });

  it("isolates organization/workspace scopes and enforces optimistic updates", async () => {
    const repository = createStructuredSystemDeploymentRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const value = deployment("org-a", "workspace-a");
    await repository.createDeployment(value);
    await expect(
      repository.readDeployment(
        "org-a" as any,
        "workspace-a" as any,
        "deployment-1" as any,
      ),
    ).resolves.toMatchObject({
      runtimeProfileId: "builtin.runtime.secured-data-entry@1.0.0",
    });
    expect(
      await repository.readDeployment(
        "org-b" as any,
        "workspace-a" as any,
        "deployment-1" as any,
      ),
    ).toBeUndefined();
    expect(
      await repository.readDeployment(
        "org-a" as any,
        "workspace-b" as any,
        "deployment-1" as any,
      ),
    ).toBeUndefined();
    await expect(
      repository.updateDeployment(
        { ...value, status: "active", revision: 1 },
        0,
      ),
    ).resolves.toMatchObject({ status: "active", revision: 1 });
    await expect(
      repository.updateDeployment(
        { ...value, status: "failed", revision: 1 },
        0,
      ),
    ).rejects.toThrow();
  });

  it("rejects legacy runtime kinds that have no stable runtime-profile mapping", async () => {
    const repository = createStructuredSystemDeploymentRepository(
      createInMemoryStructuredDocumentStore(),
    );

    await expect(
      repository.createDeployment({
        ...deployment("org-a", "workspace-a"),
        referenceRuntimeKind: "unknown-runtime",
      }),
    ).rejects.toThrow("System deployment runtime identity is missing");
  });

  it("atomically retains one current deployment per exact release and host target", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const repository = createStructuredSystemDeploymentRepository(documents);
    const first = {
      ...deployment("org-a", "workspace-a", "deployment-current-a"),
      hostTargetId: "local-desktop",
    };
    const second = {
      ...deployment("org-a", "workspace-a", "deployment-current-b"),
      hostTargetId: "local-desktop",
    };

    const attempts = await Promise.allSettled([
      repository.createCurrentDeployment(first),
      repository.createCurrentDeployment(second),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled").length).toBe(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected").length).toBe(1);

    const current = await repository.readCurrentDeployment(
      "org-a" as any,
      "workspace-a" as any,
      "release-1" as any,
      "local-desktop",
    );
    expect(current?.deploymentId).toBe(
      attempts[0]?.status === "fulfilled"
        ? "deployment-current-a"
        : "deployment-current-b",
    );
    expect(
      await repository.readCurrentDeployment(
        "org-b" as any,
        "workspace-a" as any,
        "release-1" as any,
        "local-desktop",
      ),
    ).toBeUndefined();
  });

  it("retires the current pointer without deleting history and recovers after restart", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const firstRepository = createStructuredSystemDeploymentRepository(documents);
    const first = await firstRepository.createCurrentDeployment({
      ...deployment("org-a", "workspace-a", "deployment-generation-1"),
      hostTargetId: "local-desktop",
    });
    await firstRepository.retireCurrentDeployment(
      {
        ...first,
        status: "uninstalled",
        revision: 1,
        uninstalledAt: "2026-07-17T00:01:00.000Z",
        uninstalledBy: "person-1",
      },
      0,
    );

    const restarted = createStructuredSystemDeploymentRepository(documents);
    expect(
      await restarted.readCurrentDeployment(
        "org-a" as any,
        "workspace-a" as any,
        "release-1" as any,
        "local-desktop",
      ),
    ).toBeUndefined();
    expect(
      await restarted.readDeployment(
        "org-a" as any,
        "workspace-a" as any,
        "deployment-generation-1" as any,
      ),
    ).toMatchObject({ status: "uninstalled", revision: 1 });

    await restarted.createCurrentDeployment({
      ...deployment("org-a", "workspace-a", "deployment-generation-2"),
      hostTargetId: "local-desktop",
    });
    expect(
      (
        await restarted.listDeployments(
          "org-a" as any,
          "workspace-a" as any,
          "release-1" as any,
        )
      ).map((entry) => entry.deploymentId),
    ).toEqual(["deployment-generation-1", "deployment-generation-2"]);
  });

  it("reads a compatible legacy deployment when no current pointer exists", async () => {
    const repository = createStructuredSystemDeploymentRepository(
      createInMemoryStructuredDocumentStore(),
    );
    await repository.createDeployment(
      deployment("org-a", "workspace-a", "deployment-legacy"),
    );

    await expect(
      repository.readCurrentDeployment(
        "org-a" as any,
        "workspace-a" as any,
        "release-1" as any,
        "local-desktop",
      ),
    ).resolves.toMatchObject({ deploymentId: "deployment-legacy" });
  });
});

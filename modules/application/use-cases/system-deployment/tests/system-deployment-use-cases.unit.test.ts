import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../../../../adapters/runtime/system-deployment";
import { composeSystemDeployment } from "../../../../hosts/shared/composition/composeSystemDeployment";
import type {
  SystemBuildArtifactDescriptor,
  SystemReleaseId,
} from "../../../../contracts/system-build";
import type { WorkspaceId } from "../../../../contracts/workspace";
import type { AssetImplementationDeploymentProfile } from "../../../../contracts/asset-implementation";
import type { SystemDeploymentRuntimePort } from "../../../ports/system-deployment";
import { normalizeSystemRuntimeInstanceId } from "../../../../contracts/system-deployment";
import { createRuntimeDatabaseTestAdapter } from "./runtimeDatabaseTestAdapter";

const workspaceId = "workspace-a" as any;
const organizationId = "org-a" as any;
const now = () => "2026-07-17T00:00:00.000Z";
let auditSequence = 0;

const policy = {
  allowedCapabilities: ["artifact:read"],
  allowedSecretReferences: ["secret-ref.model-provider"],
  egress: {
    mode: "allowlist" as const,
    allowedOrigins: ["https://api.example.invalid"],
  },
  quotas: {
    maximumRunSeconds: 60,
    maximumMemoryMiB: 256,
    maximumOutputBytes: 1024,
    maximumConcurrentRuns: 1,
  },
};

function release(
  id: string,
  referenceSystemKind: string,
  runtimeKind = "trusted-built-in",
  trustLevel = "system-trusted",
) {
  const digestCharacter = id.endsWith("2") ? "b" : "a";
  return {
    releaseId: id,
    targetWorkspaceId: workspaceId,
    systemId: "system-1",
    systemRevisionId: "revision-1",
    sourceBuildId: "build-1",
    lockDigest: `sha256:${"c".repeat(64)}`,
    releaseDigest: `sha256:${digestCharacter.repeat(64)}`,
    lock: {
      schemaVersion: "1.0",
      systemId: "system-1",
      systemRevisionId: "revision-1",
      systemRevisionDigest: `sha256:${"d".repeat(64)}`,
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      toolchainProfile: "builder/1",
      policyCompilerVersion: "1",
      workflowCompilerVersion: "1",
      schemaCompilerVersion: "1",
      resolvedImplementations: [
        {
          instanceId: "instance-1",
          definitionRef: {
            kind: "asset-definition-version",
            id: "builtin.system.system",
            version: "1.0.0",
          },
          releaseId: "implementation-1",
          releaseVersion: "1.0.0",
          packageDigest: `sha256:${"e".repeat(64)}`,
          trustLevel,
          facets: [
            {
              facetId: "facet-1",
              kind: "logic",
              runtimeKind,
              entryKey: "main",
              requiredCapabilities: [],
              compatibility: {
                definitionVersion: "1.0.0",
                hostApiRange: ">=1.0.0 <2.0.0",
                deploymentProfiles: [
                  "local-desktop",
                  "campus-server",
                  "cloud-server",
                  "thin-client",
                ],
              },
            },
          ],
        },
      ],
    },
    artifacts: [
      {
        artifactId: `artifact-${id}`,
        kind: "manifest",
        digest: `sha256:${"f".repeat(64)}`,
        mediaType: "application/vnd.ai-system-builder.system-manifest+json",
        sizeBytes: 256,
      },
    ],
    compatibility: {
      deploymentProfiles: [
        "local-desktop",
        "campus-server",
        "cloud-server",
        "thin-client",
      ],
      hostApiVersion: "1.0.0",
    },
    assurance: "repeatable",
    approvedAt: now(),
    approvedBy: "approver-1",
    createdAt: now(),
    referenceSystemKind,
  } as any;
}

function fixture(
  releases: readonly ReturnType<typeof release>[],
  options: {
    profiles?: readonly AssetImplementationDeploymentProfile[];
    runtime?: SystemDeploymentRuntimePort;
    revokedReleaseIds?: Set<string>;
    revocationsUnavailable?: boolean;
  } = {},
) {
  const byId = new Map(releases.map((item) => [item.releaseId, item]));
  const runtime =
    options.runtime ??
    createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: options.profiles ?? ["local-desktop"],
      resolveReleaseBindings: async () => readyConversationBindings(),
      now,
    });
  const root = composeSystemDeployment({
    documents: createInMemoryStructuredDocumentStore(now),
    builds: {
      async readRelease(
        candidateWorkspace: WorkspaceId,
        candidateRelease: SystemReleaseId,
      ) {
        return candidateWorkspace === workspaceId
          ? byId.get(String(candidateRelease))
          : undefined;
      },
    } as any,
    artifacts: {
      async readVerified(
        _workspace: WorkspaceId,
        descriptor: SystemBuildArtifactDescriptor,
      ) {
        const item = releases.find(
          (candidate) =>
            candidate.artifacts[0].artifactId === descriptor.artifactId,
        )!;
        return new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: "1.0",
            instances: [
              {
                metadata: {
                  referenceSystemKind: item.referenceSystemKind,
                },
              },
            ],
          }),
        ) as any;
      },
    } as any,
    runtime,
    runtimeDatabases: createRuntimeDatabaseTestAdapter(),
    revocations: {
      async listRevokedImplementationReleaseIds(_workspace, releaseIds) {
        if (options.revocationsUnavailable)
          throw new Error("revocation storage unavailable");
        return releaseIds.filter((releaseId) =>
          options.revokedReleaseIds?.has(String(releaseId)),
        );
      },
    },
    platformPolicy: policy,
    generateAuditId: () => `audit-${++auditSequence}`,
    generateRuntimeInstanceId: () =>
      normalizeSystemRuntimeInstanceId(`runtime-instance-${++auditSequence}`),
    now,
  });
  return root;
}

function readyConversationBindings() {
  return {
    status: "ready" as const,
    resourceBindings: [
      {
        instanceId: "controlled-chatbot.composer",
        bindingKind: "model-record" as const,
        capabilityKind: "text-generation" as const,
        modelRecordId: "model.chat.local",
        modelRevisionDigest: `sha256:${"d".repeat(64)}`,
      },
    ],
    interactionBindings: [
      {
        interactionKind: "conversation-turn" as const,
        composerInstanceId: "controlled-chatbot.composer",
        historyInstanceId: "controlled-chatbot.history-display",
        transcriptMode: "persisted-only" as const,
      },
    ],
  };
}

const install = (deploymentId: string, releaseId: string) => ({
  deploymentId: deploymentId as any,
  releaseId: releaseId as any,
  organizationId,
  workspaceId,
  deploymentProfile: "local-desktop" as const,
  hostApiVersion: "1.0.0",
  hostCapabilities: [],
  sandboxQualified: false,
  policy,
  actorId: "person-1",
});

describe("system deployment lifecycle", () => {
  it("installs, activates, records a bounded run, rolls back, revokes, and isolates tenants", async () => {
    const root = fixture([
      release("release-1", "secured-data-entry"),
      release("release-2", "secured-data-review"),
    ]);
    const first = await root.useCases.install.execute(
      install("deployment-1", "release-1"),
    );
    expect(first.ok).toBe(true);
    const firstActive = await root.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      actorId: "person-1",
    });
    expect(firstActive.ok && firstActive.value.status).toBe("active");

    const run = await root.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: "run-1" as any,
      requestedCapabilities: ["artifact:read"],
      requestedSecretReferences: ["secret-ref.model-provider"],
      requestedEgressOrigins: ["https://api.example.invalid"],
      actorId: "person-1",
    });
    expect(run.ok && run.value.status).toBe("running");
    expect(run.ok && run.value.runtimeKind).toBe("visual");
    expect(run.ok && run.value.launchDescriptor?.releaseId).toBe("release-1");

    await root.useCases.install.execute(install("deployment-2", "release-2"));
    const secondActive = await root.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-2" as any,
      actorId: "person-1",
    });
    expect(secondActive.ok && secondActive.value.status).toBe("active");
    expect(
      (
        await root.repository.readDeployment(
          organizationId,
          workspaceId,
          "deployment-1" as any,
        )
      )?.status,
    ).toBe("inactive");

    const rolledBack = await root.useCases.rollback.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-2" as any,
      actorId: "person-1",
    });
    expect(rolledBack.ok && rolledBack.value.deploymentId).toBe("deployment-1");
    expect(
      await root.repository.readDeployment(
        "org-b" as any,
        workspaceId,
        "deployment-1" as any,
      ),
    ).toBeUndefined();
    const revoked = await root.useCases.revoke.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      actorId: "person-1",
    });
    expect(revoked.ok && revoked.value.status).toBe("revoked");
    expect(
      await root.useCases.listAudit.execute({
        organizationId,
        workspaceId,
        deploymentId: "deployment-1" as any,
        actorId: "person-1",
      }),
    ).not.toEqual([]);
  });

  it("denies thin-client authority, unqualified sandboxes, capability escalation, and invalid quotas before execution", async () => {
    const trusted = fixture([release("release-1", "secured-data-entry")]);
    const invalidQuota = await trusted.useCases.install.execute({
      ...install("deployment-invalid", "release-1"),
      policy: {
        ...policy,
        quotas: { ...policy.quotas, maximumRunSeconds: 0 },
      },
    });
    expect(invalidQuota.ok || invalidQuota.error.code).toBe(
      "deployment.policy.quota-invalid",
    );
    const thin = await trusted.useCases.install.execute({
      ...install("deployment-thin", "release-1"),
      deploymentProfile: "thin-client",
    });
    expect(thin.ok || thin.error.code).toBe(
      "deployment.thin-client.server-owned",
    );

    await trusted.useCases.install.execute(
      install("deployment-1", "release-1"),
    );
    await trusted.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      actorId: "person-1",
    });
    const escalated = await trusted.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: "run-denied" as any,
      requestedCapabilities: ["host:filesystem"],
      requestedSecretReferences: [],
      requestedEgressOrigins: [],
      actorId: "person-1",
    });
    expect(escalated.ok || escalated.error.code).toBe(
      "deployment.capability.denied",
    );
    const secret = await trusted.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: "run-secret-denied" as any,
      requestedCapabilities: [],
      requestedSecretReferences: ["secret-ref.unapproved"],
      requestedEgressOrigins: [],
      actorId: "person-1",
    });
    expect(secret.ok || secret.error.code).toBe(
      "deployment.secret-reference.denied",
    );
    const egress = await trusted.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: "run-egress-denied" as any,
      requestedCapabilities: [],
      requestedSecretReferences: [],
      requestedEgressOrigins: ["https://unapproved.example.invalid"],
      actorId: "person-1",
    });
    expect(egress.ok || egress.error.code).toBe("deployment.egress.denied");

    const untrusted = fixture([
      release(
        "release-untrusted",
        "custom",
        "isolated-worker",
        "workspace-approved",
      ),
    ]);
    const sandbox = await untrusted.useCases.install.execute(
      install("deployment-untrusted", "release-untrusted"),
    );
    expect(sandbox.ok || sandbox.error.code).toBe(
      "deployment.sandbox-unavailable",
    );
    expect(
      await untrusted.repository.listDeployments(organizationId, workspaceId),
    ).toEqual([]);
  });

  it("hands all three reference release kinds to the same trusted runtime model on local and managed profiles", async () => {
    const kinds = [
      "secured-data-entry",
      "controlled-chatbot",
      "secured-data-review",
    ];
    for (const profile of [
      "local-desktop",
      "campus-server",
      "cloud-server",
    ] as const) {
      const releases = kinds.map((kind, index) =>
        release(`release-${index + 1}`, kind),
      );
      const root = fixture(releases, { profiles: [profile] });
      for (const [index, item] of releases.entries()) {
        const deploymentId = `deployment-${profile}-${index}`;
        const installed = await root.useCases.install.execute({
          ...install(deploymentId, item.releaseId),
          deploymentProfile: profile,
        });
        expect(installed.ok).toBe(true);
        const active = await root.useCases.activate.execute({
          organizationId,
          workspaceId,
          deploymentId: deploymentId as any,
          actorId: "person-1",
        });
        expect(active.ok && active.value.health.status).toBe("ready");
        const run = await root.useCases.startRun.execute({
          organizationId,
          workspaceId,
          deploymentId: deploymentId as any,
          runId: `run-${profile}-${index}` as any,
          requestedCapabilities: [],
          requestedSecretReferences: [],
          requestedEgressOrigins: [],
          actorId: "person-1",
        });
        expect(run.ok && run.value.status).toBe("running");
      }
    }
  });

  it("persists safe terminal states for interrupted activation or runs", async () => {
    const base = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      now,
    });
    const activationInterrupted = fixture(
      [release("release-1", "secured-data-entry")],
      {
        runtime: {
          ...base,
          activate: async () => {
            throw new Error("private runtime failure");
          },
        },
      },
    );
    await activationInterrupted.useCases.install.execute(
      install("deployment-interrupted", "release-1"),
    );
    const activation = await activationInterrupted.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-interrupted" as any,
      actorId: "person-1",
    });
    expect(activation.ok || activation.error.code).toBe(
      "deployment.activation.failed",
    );
    expect(
      (
        await activationInterrupted.repository.readDeployment(
          organizationId,
          workspaceId,
          "deployment-interrupted" as any,
        )
      )?.status,
    ).toBe("failed");

    const runInterrupted = fixture(
      [release("release-1", "secured-data-entry")],
      {
        runtime: {
          ...base,
          start: async () => {
            throw new Error("private runner failure");
          },
        },
      },
    );
    await runInterrupted.useCases.install.execute(
      install("deployment-run", "release-1"),
    );
    await runInterrupted.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-run" as any,
      actorId: "person-1",
    });
    const run = await runInterrupted.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-run" as any,
      runId: "run-interrupted" as any,
      requestedCapabilities: [],
      requestedSecretReferences: [],
      requestedEgressOrigins: [],
      actorId: "person-1",
    });
    expect(run.ok || run.error.code).toBe("deployment.run.failed");
    expect(
      (
        await runInterrupted.repository.readRun(
          organizationId,
          workspaceId,
          "run-interrupted" as any,
        )
      )?.status,
    ).toBe("failed");
  });

  it("enforces concurrent-run quota before a second runtime call", async () => {
    const base = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      now,
    });
    let starts = 0;
    const root = fixture([release("release-1", "secured-data-entry")], {
      runtime: {
        ...base,
        start: async () => {
          starts += 1;
          return { status: "running", diagnostics: [] };
        },
      },
    });
    await root.useCases.install.execute(install("deployment-1", "release-1"));
    await root.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      actorId: "person-1",
    });
    const command = (runId: string) => ({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: runId as any,
      requestedCapabilities: [],
      requestedSecretReferences: [],
      requestedEgressOrigins: [],
      actorId: "person-1",
    });
    expect((await root.useCases.startRun.execute(command("run-1"))).ok).toBe(
      true,
    );
    const second = await root.useCases.startRun.execute(command("run-2"));
    expect(second.ok || second.error.code).toBe(
      "deployment.quota.concurrent-runs",
    );
    expect(starts).toBe(1);
  });

  it("marks an interrupted installation failed when its required audit cannot be written", async () => {
    const root = fixture([release("release-1", "secured-data-entry")]);
    (root.repository as any).appendAudit = async () => {
      throw new Error("audit unavailable");
    };

    const result = await root.useCases.install.execute(
      install("deployment-audit-failure", "release-1"),
    );

    expect(result.ok).toBe(false);
    const persisted = await root.repository.readDeployment(
      organizationId,
      workspaceId,
      "deployment-audit-failure" as any,
    );
    expect(persisted?.status).toBe("failed");
    expect(persisted?.health.status).toBe("unhealthy");
    expect(persisted?.health.diagnostics[0]?.code).toBe(
      "deployment.audit.unavailable",
    );
  });

  it("denies unavailable revocation truth and propagates a later implementation revocation before run start", async () => {
    const unavailable = fixture(
      [release("release-unavailable", "secured-data-entry")],
      { revocationsUnavailable: true },
    );
    const unavailableInstall = await unavailable.useCases.install.execute(
      install("deployment-unavailable", "release-unavailable"),
    );
    expect(unavailableInstall.ok || unavailableInstall.error.code).toBe(
      "deployment.revocation.unavailable",
    );

    const revokedReleaseIds = new Set<string>();
    const base = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      now,
    });
    let starts = 0;
    const root = fixture([release("release-1", "secured-data-entry")], {
      revokedReleaseIds,
      runtime: {
        ...base,
        start: async () => {
          starts += 1;
          return { status: "running", diagnostics: [] };
        },
      },
    });
    await root.useCases.install.execute(install("deployment-1", "release-1"));
    await root.useCases.activate.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      actorId: "person-1",
    });
    revokedReleaseIds.add("implementation-1");

    const result = await root.useCases.startRun.execute({
      organizationId,
      workspaceId,
      deploymentId: "deployment-1" as any,
      runId: "run-revoked" as any,
      requestedCapabilities: [],
      requestedSecretReferences: [],
      requestedEgressOrigins: [],
      actorId: "person-1",
    });

    expect(result.ok || result.error.code).toBe("deployment.release.revoked");
    expect(starts).toBe(0);
    expect(
      (
        await root.repository.readDeployment(
          organizationId,
          workspaceId,
          "deployment-1" as any,
        )
      )?.status,
    ).toBe("revoked");
    expect(
      (
        await root.useCases.listAudit.execute({
          organizationId,
          workspaceId,
          deploymentId: "deployment-1" as any,
          actorId: "person-1",
        })
      ).some((entry) => entry.reasonCode === "deployment.release.revoked"),
    ).toBe(true);
  });
});

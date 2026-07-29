import { describe, expect, it } from "../../../../testing/node-test";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../createTrustedSystemDeploymentRuntimeAdapter";

describe("trusted system deployment runtime", () => {
  it("starts a verified visual exact release as a long-lived bounded session", async () => {
    const runtime = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      verifyReferenceRelease: async () => true,
      resolveReleaseBindings: async () => readyBindings(),
      now: () => "2026-07-29T12:00:00.000Z",
    });
    const deployment = deploymentFixture();
    const result = await runtime.start(deployment, runFixture());

    expect(result.status).toBe("running");
    expect(result.runtimeKind).toBe("visual");
    expect(result.launchDescriptor).toEqual({
      schemaVersion: "1.0",
      kind: "trusted-declarative",
      releaseId: deployment.releaseId,
      releaseDigest: deployment.releaseDigest,
      runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
      runtimeResourceBindings: readyBindings().resourceBindings,
      runtimeInteractionBindings: readyBindings().interactionBindings,
    });
  });

  it("starts a nonvisual trusted service without a launch descriptor", async () => {
    const runtime = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["campus-server"],
      verifyReferenceRelease: async () => true,
      classifyRuntime: () => "service",
    });
    const result = await runtime.start(
      {
        ...deploymentFixture(),
        runtimeProfileId: "builtin.runtime.secured-data-entry@1.0.0",
        deploymentProfile: "campus-server",
      },
      runFixture(),
    );

    expect(result.status).toBe("running");
    expect(result.runtimeKind).toBe("service");
    expect(result.launchDescriptor).toBeUndefined();
  });

  it("fails closed when a controlled chatbot release binding is missing or cannot be revalidated", async () => {
    const missingAuthority = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      verifyReferenceRelease: async () => true,
    });
    const missing = await missingAuthority.start(
      deploymentFixture(),
      runFixture(),
    );
    expect(missing.status).toBe("failed");
    expect(missing.diagnostics[0]?.code).toBe(
      "deployment.runtime.binding-authority-unavailable",
    );

    let reads = 0;
    const staleAfterActivation = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      verifyReferenceRelease: async () => true,
      resolveReleaseBindings: async () => {
        reads += 1;
        if (reads === 1) return readyBindings();
        return {
          status: "denied",
          code: "runtime-binding-stale",
          message: "The published model selection changed and must be rebuilt.",
        };
      },
    });
    const stale = await staleAfterActivation.start(
      deploymentFixture(),
      runFixture(),
    );
    expect(stale.status).toBe("failed");
    expect(stale.launchDescriptor).toBeUndefined();
    expect(stale.diagnostics[0]?.code).toBe(
      "deployment.runtime.runtime-binding-stale",
    );
  });

  it("fails closed for an unverified or unsupported runtime without leaking adapter detail", async () => {
    const unverified = createTrustedSystemDeploymentRuntimeAdapter({
      deploymentProfiles: ["local-desktop"],
      verifyReferenceRelease: async () => false,
    });
    const denied = await unverified.start(deploymentFixture(), runFixture());
    expect(denied.status).toBe("failed");
    expect(denied.launchDescriptor).toBeUndefined();
    expect(denied.diagnostics[0]?.code).toBe(
      "deployment.runtime.release-invalid",
    );

    const unsupported = await unverified.start(
      {
        ...deploymentFixture(),
        runtimeProfileId: "custom.runtime.unqualified@1.0.0",
        compatibility: {
          ...deploymentFixture().compatibility,
          sandboxRequired: true,
        },
      },
      runFixture(),
    );
    expect(unsupported.status).toBe("failed");
    expect(unsupported.launchDescriptor).toBeUndefined();
    expect(unsupported.diagnostics[0]?.message).not.toContain("path");
  });
});

function deploymentFixture() {
  return {
    deploymentId: "deployment-a",
    organizationId: "org-a",
    workspaceId: "workspace-a",
    releaseId: "release-a",
    releaseDigest: `sha256:${"a".repeat(64)}`,
    runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
    deploymentProfile: "local-desktop",
    hostTargetId: "local-desktop",
    status: "active",
    revision: 2,
    compatibility: {
      compatible: true,
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      runtimeKinds: ["trusted-built-in"],
      trustLevels: ["system-trusted"],
      sandboxRequired: false,
      sandboxQualified: false,
      checkedAt: "2026-07-29T12:00:00.000Z",
      diagnostics: [],
    },
    policy: {
      allowedCapabilities: [],
      allowedSecretReferences: [],
      egress: { mode: "deny-all", allowedOrigins: [] },
      quotas: {
        maximumRunSeconds: 300,
        maximumMemoryMiB: 512,
        maximumOutputBytes: 1_024,
        maximumConcurrentRuns: 1,
      },
    },
    health: {
      status: "ready",
      checkedAt: "2026-07-29T12:00:00.000Z",
      diagnostics: [],
    },
    installedAt: "2026-07-29T12:00:00.000Z",
    installedBy: "person-a",
    updatedAt: "2026-07-29T12:00:00.000Z",
  } as any;
}

function runFixture() {
  return {
    runId: "run-a",
    deploymentId: "deployment-a",
    organizationId: "org-a",
    workspaceId: "workspace-a",
    releaseId: "release-a",
    status: "running",
    revision: 1,
    cancellationRequested: false,
    requestedCapabilities: [],
    requestedSecretReferences: [],
    requestedEgressOrigins: [],
    diagnostics: [],
    createdAt: "2026-07-29T12:00:00.000Z",
    startedAt: "2026-07-29T12:00:00.000Z",
    requestedBy: "person-a",
  } as any;
}

function readyBindings() {
  return {
    status: "ready" as const,
    resourceBindings: [
      {
        instanceId: "controlled-chatbot.composer",
        bindingKind: "model-record" as const,
        capabilityKind: "text-generation" as const,
        modelRecordId: "model.chat.local",
        modelRevisionDigest: `sha256:${"b".repeat(64)}`,
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

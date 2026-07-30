import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createTrustedSystemDeploymentRuntimeAdapter } from "../../../../adapters/runtime/system-deployment";
import { composeSystemDeployment } from "../../../../hosts/shared/composition/composeSystemDeployment";
import type { SystemDeploymentRuntimePort } from "../../../ports/system-deployment";
import type { SystemDeploymentReleaseBindingResolution } from "../../../services/system-deployment";
import {
  normalizeSystemRuntimeInstanceId,
  type SystemDeployment,
} from "../../../../contracts/system-deployment";
import { createRuntimeDatabaseTestAdapter } from "./runtimeDatabaseTestAdapter";

const organizationId = "org-a" as any;
const workspaceId = "workspace-a" as any;
const releaseId = "release-a" as any;
const now = () => "2026-07-29T12:00:00.000Z";
let sequence = 0;

const policy = {
  allowedCapabilities: [],
  allowedSecretReferences: [],
  egress: { mode: "deny-all" as const, allowedOrigins: [] },
  quotas: {
    maximumRunSeconds: 300,
    maximumMemoryMiB: 512,
    maximumOutputBytes: 1_024,
    maximumConcurrentRuns: 1,
  },
};

describe("published system lifecycle", () => {
  it("implements install-and-activate, start/stop, deactivate/activate, and retained uninstall", async () => {
    const root = fixture();
    const initial = await root.publishedLifecycle!.read.execute(context());
    expect(initial.ok && initial.value.state).toBe("not-installed");
    expect(initial.ok && initial.value.eligibleActions).toEqual(["install"]);

    const installed = await invoke(root, initial, "install");
    expect(installed.ok && installed.value.state).toBe("active-stopped");
    expect(installed.ok && installed.value.eligibleActions).toEqual([
      "start",
      "deactivate",
      "uninstall",
    ]);

    const staleInstall = await root.publishedLifecycle!.invoke.execute({
      ...context(),
      action: "install",
      expectedRevision: "not-installed",
    });
    expect(staleInstall.ok || staleInstall.error.code).toBe(
      "deployment.lifecycle.stale",
    );

    const started = await invoke(root, installed, "start");
    expect(started.ok && started.value.state).toBe("running");
    expect(started.ok && started.value.eligibleActions).toEqual(["stop"]);

    const stopped = await invoke(root, started, "stop");
    expect(stopped.ok && stopped.value.state).toBe("active-stopped");

    const deactivated = await invoke(root, stopped, "deactivate");
    expect(deactivated.ok && deactivated.value.state).toBe("inactive-stopped");
    expect(deactivated.ok && deactivated.value.eligibleActions).toEqual([
      "activate",
      "uninstall",
    ]);

    const reactivated = await invoke(root, deactivated, "activate");
    expect(reactivated.ok && reactivated.value.state).toBe("active-stopped");
    const uninstalled = await invoke(root, reactivated, "uninstall");
    expect(uninstalled.ok && uninstalled.value.state).toBe("not-installed");

    const retained = await root.repository.listDeployments(
      organizationId,
      workspaceId,
      releaseId,
    );
    expect(retained.length).toBe(1);
    expect(retained[0]?.status).toBe("uninstalled");
    expect(
      await root.repository.readCurrentDeployment(
        organizationId,
        workspaceId,
        releaseId,
        "local-desktop",
      ),
    ).toBeUndefined();
  });

  it("retains recoverable installed state when activation fails", async () => {
    const base = trustedRuntime();
    const root = fixture({
      runtime: {
        ...base,
        activate: async () => ({
          status: "not-ready",
          checkedAt: now(),
          diagnostics: [
            {
              severity: "error",
              code: "deployment.runtime.unavailable",
              message: "The runtime is unavailable.",
            },
          ],
        }),
      },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const result = await invoke(root, initial, "install");
    expect(result.ok || result.error.code).toBe("deployment.not-ready");

    const recovered = await root.publishedLifecycle!.read.execute(context());
    expect(recovered.ok && recovered.value.state).toBe("inactive-stopped");
    expect(recovered.ok && recovered.value.eligibleActions).toEqual([
      "activate",
      "uninstall",
    ]);
  });

  it("keeps Stop as the only retry after a runtime stop failure", async () => {
    const base = trustedRuntime();
    const root = fixture({
      runtime: {
        ...base,
        start: async () => ({ status: "running", diagnostics: [] }),
        cancel: async () => {
          throw new Error("private host detail");
        },
      },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const installed = await invoke(root, initial, "install");
    const running = await invoke(root, installed, "start");
    const failedStop = await invoke(root, running, "stop");
    expect(failedStop.ok || failedStop.error.code).toBe(
      "deployment.run.cancel-failed",
    );
    expect(failedStop.ok ? "" : failedStop.error.message).not.toContain(
      "private host detail",
    );
    const retained = await root.publishedLifecycle!.read.execute(context());
    expect(retained.ok && retained.value.state).toBe("running");
    expect(retained.ok && retained.value.eligibleActions).toEqual(["stop"]);
  });

  it("retains Uninstall as the only retry after an interrupted uninstall", async () => {
    const base = trustedRuntime();
    let failDeactivate = true;
    const root = fixture({
      runtime: {
        ...base,
        deactivate: async () => {
          if (failDeactivate) {
            failDeactivate = false;
            throw new Error("private adapter detail");
          }
        },
      },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const installed = await invoke(root, initial, "install");
    const failed = await invoke(root, installed, "uninstall");
    expect(failed.ok || failed.error.code).toBe("deployment.uninstall.failed");
    expect(failed.ok ? "" : failed.error.message).not.toContain(
      "private adapter detail",
    );

    const recovering = await root.publishedLifecycle!.read.execute(context());
    expect(recovering.ok && recovering.value.state).toBe("recovering");
    expect(recovering.ok && recovering.value.eligibleActions).toEqual([
      "uninstall",
    ]);

    const retried = await invoke(root, recovering, "uninstall");
    expect(retried.ok && retried.value.state).toBe("not-installed");
  });

  it("hides Start and explains how to replace a legacy chatbot release without runtime bindings", async () => {
    let bindingsAvailable = true;
    const root = fixture({
      resolveReleaseBindings: async () =>
        bindingsAvailable
          ? readyConversationBindings()
          : {
              status: "denied" as const,
              code: "runtime-binding-missing" as const,
              message:
                "The published conversation runtime configuration is incomplete.",
            },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const installed = await invoke(root, initial, "install");
    bindingsAvailable = false;

    const legacy = await root.publishedLifecycle!.read.execute(context());
    expect(legacy.ok && legacy.value.state).toBe("active-stopped");
    expect(legacy.ok && legacy.value.eligibleActions).toEqual([
      "deactivate",
      "uninstall",
    ]);
    expect(legacy.ok && legacy.value.diagnostics[0]?.code).toBe(
      "deployment.lifecycle.runtime-binding-missing",
    );
    expect(legacy.ok && legacy.value.diagnostics[0]?.message).toContain(
      "publish a new build",
    );

    const forgedStart = await root.publishedLifecycle!.invoke.execute({
      ...context(),
      action: "start",
      expectedRevision: legacy.ok ? legacy.value.revision : "missing",
    });
    expect(forgedStart.ok || forgedStart.error.code).toBe(
      "deployment.lifecycle.conflict",
    );
    expect(installed.ok).toBe(true);
  });

  it("allows explicit cleanup of a legacy installation without a recorded runtime-instance id", async () => {
    let bindingsAvailable = true;
    const root = fixture({
      resolveReleaseBindings: async () =>
        bindingsAvailable
          ? readyConversationBindings()
          : {
              status: "denied" as const,
              code: "runtime-binding-missing" as const,
              message:
                "The published conversation runtime configuration is incomplete.",
            },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const installed = await invoke(root, initial, "install");
    if (!installed.ok) throw new Error(installed.error.message);
    const current = await root.repository.readCurrentDeployment(
      organizationId,
      workspaceId,
      releaseId,
      "local-desktop",
    );
    if (!current) throw new Error("Missing installed deployment.");
    const { runtimeInstanceId: _legacyMissingRuntimeId, ...legacy } = current;
    await root.repository.updateDeployment(
      { ...legacy, revision: current.revision + 1 },
      current.revision,
    );
    bindingsAvailable = false;

    const blocked = await root.publishedLifecycle!.read.execute(context());
    expect(blocked.ok && blocked.value.eligibleActions).toEqual([
      "deactivate",
      "uninstall",
    ]);
    const uninstalled = await invoke(root, blocked, "uninstall");
    expect(uninstalled.ok && uninstalled.value.state).toBe("not-installed");
  });

  it("reports a failed runtime start instead of projecting it as an unchanged success", async () => {
    const base = trustedRuntime();
    const root = fixture({
      runtime: {
        ...base,
        start: async () => ({
          status: "failed" as const,
          diagnostics: [
            {
              severity: "error" as const,
              code: "deployment.runtime.binding-stale",
              message: "The runtime binding changed.",
            },
          ],
        }),
      },
    });
    const initial = await root.publishedLifecycle!.read.execute(context());
    const installed = await invoke(root, initial, "install");
    const started = await invoke(root, installed, "start");
    expect(started.ok || started.error.code).toBe(
      "deployment.lifecycle.start-failed",
    );
    expect(started.ok ? "" : started.error.message).not.toContain(
      "binding changed",
    );
  });

  it("denies archived, cross-workspace, and forged release sources", async () => {
    const archived = fixture({ systemStatus: "archived" });
    const denied = await archived.publishedLifecycle!.read.execute(context());
    expect(denied.ok || denied.error.code).toBe(
      "deployment.release.inactive-source",
    );
    const otherWorkspace = await fixture().publishedLifecycle!.read.execute({
      ...context(),
      workspaceId: "workspace-b" as any,
    });
    expect(otherWorkspace.ok || otherWorkspace.error.code).toBe(
      "deployment.release.not-found",
    );
    const forged = await fixture().publishedLifecycle!.read.execute({
      ...context(),
      releaseId: "release-forged" as any,
    });
    expect(forged.ok || forged.error.code).toBe("deployment.release.not-found");
  });
});

function fixture(
  options: {
    runtime?: SystemDeploymentRuntimePort;
    systemStatus?: "active" | "archived";
    resolveReleaseBindings?: (
      deployment: SystemDeployment,
    ) => Promise<SystemDeploymentReleaseBindingResolution>;
  } = {},
) {
  const release = releaseFixture();
  const resolveReleaseBindings =
    options.resolveReleaseBindings ?? (async () => readyConversationBindings());
  return composeSystemDeployment({
    documents: createInMemoryStructuredDocumentStore(now),
    builds: {
      async readRelease(candidateWorkspace: string, candidateRelease: string) {
        return candidateWorkspace === workspaceId &&
          candidateRelease === releaseId
          ? release
          : undefined;
      },
    } as any,
    artifacts: {
      async readVerified() {
        return new TextEncoder().encode(
          JSON.stringify({
            schemaVersion: "1.0",
            instances: [
              { metadata: { referenceSystemKind: "controlled-chatbot" } },
            ],
          }),
        ) as any;
      },
    } as any,
    runtime: options.runtime ?? trustedRuntime(resolveReleaseBindings),
    runtimeDatabases: createRuntimeDatabaseTestAdapter(),
    revocations: {
      async listRevokedImplementationReleaseIds() {
        return [];
      },
    },
    platformPolicy: policy,
    generateAuditId: () => `audit-${++sequence}`,
    generateRuntimeInstanceId: () =>
      normalizeSystemRuntimeInstanceId(`runtime-instance-${++sequence}`),
    publishedLifecycle: {
      systems: {
        async readRecord(candidateWorkspace: string, systemId: string) {
          return candidateWorkspace === workspaceId && systemId === "system-a"
            ? { systemId, status: options.systemStatus ?? "active" }
            : undefined;
        },
      } as any,
      hostTargetId: "local-desktop",
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      hostCapabilities: [],
      sandboxQualified: false,
      generateDeploymentId: () => `deployment-${++sequence}`,
      generateRunId: () => `run-${++sequence}`,
      resolveReleaseBindings,
    },
    now,
  });
}

function trustedRuntime(
  resolveReleaseBindings: (
    deployment: SystemDeployment,
  ) => Promise<SystemDeploymentReleaseBindingResolution> = async () =>
    readyConversationBindings(),
): SystemDeploymentRuntimePort {
  const base = createTrustedSystemDeploymentRuntimeAdapter({
    deploymentProfiles: ["local-desktop"],
    resolveReleaseBindings,
    now,
  });
  return {
    ...base,
    start: async () => ({ status: "running", diagnostics: [] }),
  };
}

function readyConversationBindings(): SystemDeploymentReleaseBindingResolution {
  return {
    status: "ready",
    resourceBindings: [
      {
        instanceId: "controlled-chatbot.composer",
        bindingKind: "model-record",
        capabilityKind: "text-generation",
        modelRecordId: "model.chat.local",
        modelRevisionDigest: `sha256:${"d".repeat(64)}`,
      },
    ],
    interactionBindings: [
      {
        interactionKind: "conversation-turn",
        composerInstanceId: "controlled-chatbot.composer",
        historyInstanceId: "controlled-chatbot.history-display",
        transcriptMode: "persisted-only",
      },
    ],
  };
}

function context() {
  return {
    organizationId,
    workspaceId,
    releaseId,
    actorId: "person-a",
  };
}

async function invoke(
  root: ReturnType<typeof fixture>,
  current: Awaited<
    ReturnType<
      NonNullable<
        ReturnType<typeof fixture>["publishedLifecycle"]
      >["read"]["execute"]
    >
  >,
  action:
    "install" | "activate" | "deactivate" | "start" | "stop" | "uninstall",
) {
  if (!current.ok) throw new Error(current.error.message);
  return root.publishedLifecycle!.invoke.execute({
    ...context(),
    action,
    expectedRevision: current.value.revision,
  });
}

function releaseFixture() {
  return {
    releaseId,
    targetWorkspaceId: workspaceId,
    systemId: "system-a",
    systemRevisionId: "revision-a",
    sourceBuildId: "build-a",
    lockDigest: `sha256:${"a".repeat(64)}`,
    releaseDigest: `sha256:${"b".repeat(64)}`,
    lock: {
      schemaVersion: "1.0",
      systemId: "system-a",
      systemRevisionId: "revision-a",
      systemRevisionDigest: `sha256:${"c".repeat(64)}`,
      deploymentProfile: "local-desktop",
      hostApiVersion: "1.0.0",
      toolchainProfile: "builder/1",
      policyCompilerVersion: "1",
      workflowCompilerVersion: "1",
      schemaCompilerVersion: "1",
      resolvedImplementations: [
        {
          instanceId: "instance-a",
          definitionRef: {
            kind: "asset-definition-version",
            id: "builtin.system.system",
            version: "1.0.0",
          },
          releaseId: "implementation-a",
          releaseVersion: "1.0.0",
          packageDigest: `sha256:${"d".repeat(64)}`,
          trustLevel: "system-trusted",
          facets: [
            {
              facetId: "facet-a",
              kind: "logic",
              runtimeKind: "trusted-built-in",
              entryKey: "main",
              requiredCapabilities: [],
              compatibility: {
                definitionVersion: "1.0.0",
                hostApiRange: ">=1.0.0 <2.0.0",
                deploymentProfiles: ["local-desktop"],
              },
            },
          ],
        },
      ],
    },
    artifacts: [
      {
        artifactId: "artifact-a",
        kind: "manifest",
        digest: `sha256:${"e".repeat(64)}`,
        mediaType: "application/vnd.ai-system-builder.system-manifest+json",
        sizeBytes: 256,
      },
    ],
    compatibility: {
      deploymentProfiles: ["local-desktop"],
      hostApiVersion: "1.0.0",
    },
    assurance: "repeatable",
    approvedAt: now(),
    approvedBy: "approver-a",
    createdAt: now(),
  } as any;
}

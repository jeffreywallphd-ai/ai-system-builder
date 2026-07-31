import { describe, expect, it } from "../../../../testing/node-test";
import { createSystemDeploymentWorkflowHandler } from "../system-deployment-workflow-handler.service";

const release = {
  releaseId: "release-1",
  targetWorkspaceId: "workspace-1",
  releaseDigest: `sha256:${"a".repeat(64)}`,
  artifacts: [],
} as any;

const context = {
  actorId: "person-1",
  roles: ["operator"],
  authenticated: true,
  organizationId: "org-1",
};

const source = {
  kind: "approved-release" as const,
  sourceId: "release-1",
  sourceDigest: release.releaseDigest,
  label: "Release release-1",
};

const fixture = () => {
  let installs = 0;
  let lists = 0;
  const deployment = {
    deploymentId: "deployment-op-1",
    organizationId: "org-1",
    workspaceId: "workspace-1",
    releaseId: "release-1",
    releaseDigest: release.releaseDigest,
    runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
    deploymentProfile: "local-desktop",
    status: "installed",
    revision: 0,
    health: { status: "unknown" },
    updatedAt: "2026-07-28T00:00:00.000Z",
  } as any;
  const handler = createSystemDeploymentWorkflowHandler({
    builds: {
      async listReleases() {
        return [release];
      },
      async readRelease(workspaceId: any, releaseId: any) {
        return String(workspaceId) === "workspace-1" &&
          String(releaseId) === "release-1"
          ? release
          : undefined;
      },
    } as any,
    useCases: {
      list: {
        async execute() {
          lists += 1;
          return installs ? [deployment] : [];
        },
      },
      install: {
        async execute(command: any) {
          installs += 1;
          expect(command.policy.egress.mode).toBe("deny-all");
          return { ok: true, value: deployment };
        },
      },
      read: {
        async execute() {
          return { ok: true, value: deployment };
        },
      },
      listRuns: { async execute() { return []; } },
      listAudit: { async execute() { return []; } },
      activate: { async execute() { return { ok: true, value: deployment }; } },
      health: { async execute() { return { ok: true, value: deployment }; } },
      rollback: { async execute() { return { ok: true, value: deployment }; } },
      revoke: { async execute() { return { ok: true, value: deployment }; } },
      startRun: { async execute() { return { ok: true, value: {} as any }; } },
      cancelRun: { async execute() { return { ok: true, value: {} as any }; } },
    },
    deploymentProfiles: ["local-desktop"],
    hostApiVersion: "1.0.0",
    hostCapabilities: [],
    sandboxQualified: false,
    installationPolicy: {
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
    generateDeploymentId: (operationId) => `deployment-${operationId}`,
    generateRunId: (operationId) => `run-${operationId}`,
    now: () => "2026-07-28T00:00:00.000Z",
  });
  return {
    handler,
    counts: () => ({ installs, lists }),
  };
};

describe("system deployment workflow handler", () => {
  it("discovers exact releases without touching deployment runtime state", async () => {
    const test = fixture();
    const result = await test.handler.discover(
      { workspaceId: "workspace-1" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(test.counts()).toEqual({ installs: 0, lists: 0 });
  });

  it("prepares lazily and installs only after a confirmed catalog invocation", async () => {
    const test = fixture();
    const prepared = await test.handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: test.handler.profileId,
        source,
      },
      context,
    );
    expect(prepared.ok).toBe(true);
    expect(
      prepared.ok
        ? prepared.value.actions.map((action) => action.actionId)
        : [],
    ).toEqual([
      "refresh",
      "install",
      "open-deployment",
      "activate",
      "health",
      "rollback",
      "revoke",
      "start-run",
      "cancel-run",
    ]);
    expect(test.counts()).toEqual({ installs: 0, lists: 1 });
    const result = await test.handler.invoke(
      {
        workspaceId: "workspace-1",
        profileId: test.handler.profileId,
        source,
        actionId: "install",
        operationId: "op-1",
        values: { deploymentProfile: "local-desktop" },
      },
      context,
    );
    expect(result.ok).toBe(true);
    expect(test.counts().installs).toBe(1);
  });

  it("rejects stale release digests before reading deployments", async () => {
    const test = fixture();
    const result = await test.handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: test.handler.profileId,
        source: { ...source, sourceDigest: `sha256:${"b".repeat(64)}` },
      },
      context,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "workflow.source-stale" },
    });
    expect(test.counts().lists).toBe(0);
  });
});

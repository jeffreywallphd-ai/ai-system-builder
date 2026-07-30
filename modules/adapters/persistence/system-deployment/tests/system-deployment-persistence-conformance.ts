import assert from "node:assert/strict";

import type { StructuredDocumentStore } from "../../shared";
import { createStructuredSystemDeploymentRepository } from "../createStructuredSystemDeploymentRepository";

const DEPLOYMENTS = "system-deployment/deployments";
const CURRENT = "system-deployment/current-deployments";
const RUNS = "system-deployment/runs";

export interface SystemDeploymentPersistenceConformanceResult {
  readonly currentConflict: boolean;
  readonly retainedDeploymentCount: number;
  readonly retainedRunCount: number;
  readonly restartSafe: boolean;
  readonly workspaceIsolation: boolean;
}

export async function runSystemDeploymentPersistenceConformance(
  documents: StructuredDocumentStore,
  prefix: string,
): Promise<SystemDeploymentPersistenceConformanceResult> {
  const organizationId = `org-${prefix}`;
  const workspaceId = `workspace-${prefix}`;
  const releaseId = `release-${prefix}`;
  const hostTargetId = "local-desktop";
  const firstId = `deployment-${prefix}-1`;
  const secondId = `deployment-${prefix}-2`;
  const runId = `run-${prefix}-1`;
  const repository = createStructuredSystemDeploymentRepository(documents);
  let currentConflict = false;
  try {
    const first = await repository.createCurrentDeployment(
      deploymentFixture(firstId, organizationId, workspaceId, releaseId),
    );
    try {
      await repository.createCurrentDeployment(
        deploymentFixture(secondId, organizationId, workspaceId, releaseId),
      );
    } catch {
      currentConflict = true;
    }
    await repository.retireCurrentDeployment(
      { ...first, status: "uninstalled", revision: 1 },
      0,
    );
    const second = await repository.createCurrentDeployment(
      deploymentFixture(secondId, organizationId, workspaceId, releaseId),
    );
    await repository.createRun({
      runId,
      deploymentId: second.deploymentId,
      organizationId,
      workspaceId,
      releaseId,
      status: "running",
      revision: 0,
      cancellationRequested: false,
      requestedCapabilities: [],
      requestedSecretReferences: [],
      requestedEgressOrigins: [],
      diagnostics: [],
      createdAt: "2026-07-29T12:00:00.000Z",
      startedAt: "2026-07-29T12:00:00.000Z",
      requestedBy: "qualification-user",
    } as any);

    const restarted = createStructuredSystemDeploymentRepository(documents);
    const current = await restarted.readCurrentDeployment(
      organizationId as any,
      workspaceId as any,
      releaseId as any,
      hostTargetId,
    );
    const retained = await restarted.listDeployments(
      organizationId as any,
      workspaceId as any,
      releaseId as any,
    );
    const runs = await restarted.listRuns(
      organizationId as any,
      workspaceId as any,
      second.deploymentId,
    );
    const workspaceIsolation =
      (
        await restarted.listDeployments(
          organizationId as any,
          `other-${workspaceId}` as any,
        )
      ).length === 0;
    const restartSafe =
      String(current?.deploymentId) === secondId &&
      retained.length === 2 &&
      runs.length === 1 &&
      runs[0]?.status === "running";

    assert.equal(currentConflict, true);
    assert.equal(workspaceIsolation, true);
    assert.equal(restartSafe, true);
    return {
      currentConflict,
      retainedDeploymentCount: retained.length,
      retainedRunCount: runs.length,
      restartSafe,
      workspaceIsolation,
    };
  } finally {
    await documents.deleteDocument(
      DEPLOYMENTS,
      `${organizationId}/${workspaceId}/${firstId}`,
    );
    await documents.deleteDocument(
      DEPLOYMENTS,
      `${organizationId}/${workspaceId}/${secondId}`,
    );
    await documents.deleteDocument(
      CURRENT,
      `${organizationId}/${workspaceId}/${releaseId}/${hostTargetId}`,
    );
    await documents.deleteDocument(
      RUNS,
      `${organizationId}/${workspaceId}/${runId}`,
    );
  }
}

function deploymentFixture(
  deploymentId: string,
  organizationId: string,
  workspaceId: string,
  releaseId: string,
) {
  return {
    deploymentId,
    organizationId,
    workspaceId,
    releaseId,
    releaseDigest: `sha256:${"a".repeat(64)}`,
    runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
    deploymentProfile: "local-desktop",
    hostTargetId: "local-desktop",
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
      status: "unknown",
      checkedAt: "2026-07-29T12:00:00.000Z",
      diagnostics: [],
    },
    installedAt: "2026-07-29T12:00:00.000Z",
    installedBy: "qualification-user",
    updatedAt: "2026-07-29T12:00:00.000Z",
  } as any;
}

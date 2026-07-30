import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId, type SystemBuildRuntimeInteractionBinding, type SystemBuildRuntimeResourceBinding } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemDeploymentRunId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  SYSTEM_RUNTIME_PROFILE_IDS,
} from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemPublishedConversationRuntimeAuthorityService } from "../system-published-conversation-runtime-authority.service";

const at = "2026-07-29T16:00:00.000Z";
const organizationId = createOrganizationId("org-runtime-authority");
const workspaceId = createWorkspaceId("workspace-runtime-authority");
const releaseId = normalizeSystemReleaseId("release-runtime-authority");
const deploymentId = normalizeSystemDeploymentId("deployment-runtime-authority");
const runtimeInstanceId = normalizeSystemRuntimeInstanceId("runtime-authority");
const releaseDigest = `sha256:${"a".repeat(64)}` as const;
const modelDigest = `sha256:${"b".repeat(64)}` as const;
const resourceBinding: SystemBuildRuntimeResourceBinding = {
  instanceId: "chat.composer",
  bindingKind: "model-record",
  capabilityKind: "text-generation",
  modelRecordId: "model.chat.local",
  modelRevisionDigest: modelDigest,
};
const interactionBinding: SystemBuildRuntimeInteractionBinding = {
  interactionKind: "conversation-turn",
  composerInstanceId: resourceBinding.instanceId,
  historyInstanceId: "chat.history",
  transcriptMode: "persisted-only",
};

const deployment = {
  deploymentId,
  organizationId,
  workspaceId,
  releaseId,
  releaseDigest,
  runtimeInstanceId,
  runtimeProfileId: SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot,
  deploymentProfile: "local-desktop",
  hostTargetId: "local-desktop",
  status: "active",
  revision: 2,
  compatibility: {
    compatible: true,
    deploymentProfile: "local-desktop",
    hostApiVersion: "1.0.0",
    runtimeKinds: [],
    trustLevels: [],
    sandboxRequired: false,
    sandboxQualified: false,
    checkedAt: at,
    diagnostics: [],
  },
  policy: {
    allowedCapabilities: [],
    allowedSecretReferences: [],
    egress: { mode: "deny-all", allowedOrigins: [] },
    quotas: { maximumRunSeconds: 300, maximumMemoryMiB: 512, maximumOutputBytes: 1024, maximumConcurrentRuns: 1 },
  },
  health: { status: "ready", checkedAt: at, diagnostics: [] },
  installedAt: at,
  installedBy: "person-test",
  updatedAt: at,
} as const;

const runtimeInstance = {
  runtimeInstanceId,
  dataBindingId: normalizeSystemRuntimeDataBindingId("sqlite:runtime-authority"),
  databaseEngine: "sqlite",
  organizationId,
  workspaceId,
  deploymentId,
  releaseId,
  status: "active",
  revision: 2,
  createdAt: at,
  updatedAt: at,
} as const;

const run = {
  runId: normalizeSystemDeploymentRunId("run-runtime-authority"),
  deploymentId,
  organizationId,
  workspaceId,
  releaseId,
  runtimeKind: "visual",
  launchDescriptor: {
    schemaVersion: "1.0",
    kind: "trusted-declarative",
    releaseId,
    releaseDigest,
    runtimeProfileId: SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot,
    runtimeResourceBindings: [resourceBinding],
    runtimeInteractionBindings: [interactionBinding],
  },
  status: "running",
  revision: 1,
  cancellationRequested: false,
  requestedCapabilities: [],
  requestedSecretReferences: [],
  requestedEgressOrigins: [],
  diagnostics: [],
  createdAt: at,
  startedAt: at,
} as const;

function fixture(options: { currentDeployment?: unknown; instance?: unknown; runs?: readonly unknown[]; bindings?: unknown } = {}) {
  return new SystemPublishedConversationRuntimeAuthorityService({
    deployments: {
      readCurrentDeployment: async () => (options.currentDeployment === undefined ? deployment : options.currentDeployment) as never,
      listRuns: async () => (options.runs === undefined ? [run] : options.runs) as never,
    },
    runtimeInstances: {
      readRuntimeInstance: async () => (options.instance === undefined ? runtimeInstance : options.instance) as never,
    },
    builds: {
      readRelease: async () => ({ releaseId, targetWorkspaceId: workspaceId, systemId: "system-runtime-authority", releaseDigest, createdAt: at }) as never,
    },
    systems: { readRecord: async () => ({ name: "Controlled chatbot" }) as never },
    hostTargetId: "local-desktop",
    resolveReleaseBindings: async () => (options.bindings === undefined
      ? { status: "ready", resourceBindings: [resourceBinding], interactionBindings: [interactionBinding] }
      : options.bindings) as never,
  });
}

const query = { organizationId, workspaceId, releaseId };

test("resolves only a running exact release, runtime instance, model, and interaction binding", async () => {
  const result = await fixture().resolve(query);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.authority.runtimeInstance.runtimeInstanceId, runtimeInstanceId);
  assert.equal(result.authority.resourceBinding.modelRecordId, "model.chat.local");
  assert.equal(result.authority.interactionBinding.transcriptMode, "persisted-only");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("connectionString"), false);
  assert.equal(serialized.includes("databasePath"), false);
});

test("fails closed for stopped, foreign, stale-binding, and missing-run state", async () => {
  assert.equal((await fixture({ currentDeployment: { ...deployment, status: "inactive" } }).resolve(query)).status, "denied");
  assert.equal((await fixture({ instance: { ...runtimeInstance, workspaceId: createWorkspaceId("workspace-foreign") } }).resolve(query)).status, "denied");
  assert.equal((await fixture({ bindings: { status: "denied", code: "runtime-binding-stale", message: "internal provider/path detail" } }).resolve(query)).status, "denied");
  const missingRun = await fixture({ runs: [] }).resolve(query);
  assert.deepEqual(missingRun, {
    status: "denied",
    code: "runtime-run-unavailable",
    message: "The published system is not running.",
  });
  assert.equal(JSON.stringify(missingRun).includes("provider"), false);
});

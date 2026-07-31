import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import { SystemBuilderModelAuthorityService } from "../../system-builder";
import { SystemDeploymentReleaseBindingService } from "../system-deployment-release-binding.service";

const workspaceId = createWorkspaceId("workspace.release-binding");
const modelRecord = {
  workspaceId,
  modelRecordId: "model.chat.local",
  displayName: "Local chat",
  source: "local",
  lifecycleStatus: "validated",
  artifactForm: "full-model",
  provider: "huggingface",
  modelId: "local/chat-v1",
  taskTags: ["chat"],
  validationStatus: "valid",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T01:00:00.000Z",
} as const;

const resourceBinding = {
  instanceId: "controlled-chatbot.composer",
  bindingKind: "model-record" as const,
  capabilityKind: "text-generation" as const,
  modelRecordId: modelRecord.modelRecordId,
  modelRevisionDigest: `sha256:${"a".repeat(64)}`,
};
const interactionBinding = {
  interactionKind: "conversation-turn" as const,
  composerInstanceId: resourceBinding.instanceId,
  historyInstanceId: "controlled-chatbot.history-display",
  transcriptMode: "persisted-only" as const,
};
const deployment = {
  workspaceId,
  releaseId: "release.chat",
  releaseDigest: `sha256:${"b".repeat(64)}`,
  runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
};

const release = {
  releaseId: deployment.releaseId,
  releaseDigest: deployment.releaseDigest,
  targetWorkspaceId: workspaceId,
  lock: {
    runtimeResourceBindings: [resourceBinding],
    runtimeInteractionBindings: [interactionBinding],
  },
};

function service(options: {
  release?: unknown;
  record?: unknown;
  digest?: string;
} = {}) {
  const record = options.record === undefined ? modelRecord : options.record;
  return new SystemDeploymentReleaseBindingService({
    builds: {
      readRelease: async () =>
        (options.release === undefined ? release : options.release) as never,
    },
    modelAuthority: new SystemBuilderModelAuthorityService({
      listModels: async () => ({ models: [] }),
      getModelRecord: async () => record as never,
    }),
    hasher: {
      digest: () =>
        (options.digest ??
          resourceBinding.modelRevisionDigest) as `sha256:${string}`,
    },
  });
}

test("resolves only the exact current model and interaction binding from the release", async () => {
  const result = await service().resolve(deployment as never);
  assert.deepEqual(result, {
    status: "ready",
    resourceBindings: [resourceBinding],
    interactionBindings: [interactionBinding],
  });
  assert.equal(JSON.stringify(result).includes(modelRecord.modelId), false);
  assert.equal(JSON.stringify(result).includes(modelRecord.provider), false);
});

test("fails closed for unavailable releases, incomplete chat bindings, unavailable models, and changed model revisions", async () => {
  const unavailableRelease = await service({ release: null }).resolve(
    deployment as never,
  );
  assert.deepEqual(unavailableRelease, {
    status: "denied",
    code: "release-unavailable",
    message: "The release-bound runtime configuration is unavailable.",
  });

  const incomplete = await service({
    release: { ...release, lock: { runtimeResourceBindings: [] } },
  }).resolve(deployment as never);
  assert.equal(incomplete.status, "denied");
  if (incomplete.status === "denied") {
    assert.equal(incomplete.code, "runtime-binding-missing");
  }

  const missingModel = await service({ record: null }).resolve(
    deployment as never,
  );
  assert.equal(missingModel.status, "denied");
  if (missingModel.status === "denied") {
    assert.equal(missingModel.code, "runtime-binding-stale");
    assert.equal(JSON.stringify(missingModel).includes("provider"), false);
  }

  const changed = await service({
    digest: `sha256:${"c".repeat(64)}`,
  }).resolve(deployment as never);
  assert.deepEqual(changed, {
    status: "denied",
    code: "runtime-binding-stale",
    message: "The published model selection changed and must be rebuilt.",
  });
});

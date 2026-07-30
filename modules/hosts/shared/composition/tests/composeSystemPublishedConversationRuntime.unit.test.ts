import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationTurnInvocationRequest } from "../../../../application/ports/conversational-execution";
import type { SystemPublishedConversationRuntimeAuthority } from "../../../../application/services/system-deployment";
import { createSystemRuntimeRepositorySessionFactory } from "../../../../adapters/persistence/system-runtime";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemDeploymentRunId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  SYSTEM_RUNTIME_PROFILE_IDS,
} from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeSystemPublishedConversationRuntime } from "../composeSystemPublishedConversationRuntime";

const at = "2026-07-29T17:00:00.000Z";
const organizationId = createOrganizationId("org-published-chat");
const workspaceId = createWorkspaceId("workspace-published-chat");
const releaseId = normalizeSystemReleaseId("release-published-chat");
const releaseDigest = `sha256:${"c".repeat(64)}` as const;

function authority(): SystemPublishedConversationRuntimeAuthority {
  const deploymentId = normalizeSystemDeploymentId("deployment-published-chat");
  const runtimeInstanceId = normalizeSystemRuntimeInstanceId("runtime-published-chat");
  const resourceBinding = {
    instanceId: "chat.composer",
    bindingKind: "model-record" as const,
    capabilityKind: "text-generation" as const,
    modelRecordId: "model.chat.local",
    modelRevisionDigest: `sha256:${"d".repeat(64)}` as const,
  };
  const interactionBinding = {
    interactionKind: "conversation-turn" as const,
    composerInstanceId: resourceBinding.instanceId,
    historyInstanceId: "chat.history",
    transcriptMode: "persisted-only" as const,
  };
  const deployment = {
    deploymentId,
    organizationId,
    workspaceId,
    releaseId,
    releaseDigest,
    runtimeInstanceId,
    runtimeProfileId: SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot,
    status: "active",
  } as never;
  return {
    organizationId,
    workspaceId,
    releaseId,
    releaseDigest,
    deployment,
    run: {
      runId: normalizeSystemDeploymentRunId("run-published-chat"),
      deploymentId,
      releaseId,
      status: "running",
    } as never,
    runtimeInstance: {
      runtimeInstanceId,
      dataBindingId: normalizeSystemRuntimeDataBindingId("sqlite:runtime-published-chat"),
      databaseEngine: "sqlite",
      organizationId,
      workspaceId,
      deploymentId,
      releaseId,
      status: "active",
      revision: 1,
      createdAt: at,
      updatedAt: at,
    },
    systemLabel: "Controlled chatbot",
    authorityRevision: at,
    resourceBinding,
    interactionBinding,
  };
}

function fixture() {
  const stores = new Map<string, ReturnType<typeof createInMemoryStructuredDocumentStore>>();
  const runtimeRepositorySessions = createSystemRuntimeRepositorySessionFactory({
    async acquire(instance) {
      let documents = stores.get(instance.runtimeInstanceId);
      if (!documents) {
        documents = createInMemoryStructuredDocumentStore(() => at);
        stores.set(instance.runtimeInstanceId, documents);
      }
      return {
        runtimeInstanceId: instance.runtimeInstanceId,
        documents,
        health: { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 },
      };
    },
    async release() {},
  });
  const bound = authority();
  let available = true;
  const invocations: ConversationTurnInvocationRequest[] = [];
  const controller = composeSystemPublishedConversationRuntime({
    authority: {
      async resolve() {
        return available
          ? { status: "ready" as const, authority: bound }
          : {
              status: "denied" as const,
              code: "runtime-binding-unavailable" as const,
              message: "The published conversation configuration is unavailable.",
            };
      },
    },
    runtimeRepositorySessions,
    adapterCatalog: {
      async resolveForRuntime() {
        return {
          status: "supported" as const,
          adapterId: "python-runtime.conversation-text-generation.v1",
          capabilityKind: "text-generation" as const,
          capabilities: { progress: false, cancellation: false },
        };
      },
    },
    runtimeGuard: { async getRuntimeStatus() { return "ready"; } },
    invocationPort: {
      async invokeConversationTurn(request) {
        invocations.push(request);
        return {
          status: "completed" as const,
          assistantResponseText: `Echo: ${request.context.userTurnContent}`,
        };
      },
    },
    now: () => at,
  });
  return {
    controller,
    invocations,
    deny() { available = false; },
  };
}

const query = { organizationId, workspaceId, releaseId };

test("starts empty, persists real turns, carries bounded history, and recovers after reopen", async () => {
  const root = fixture();
  const session = await root.controller.open(query);
  const empty = await session.read();
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  assert.deepEqual(empty.value.messages, []);

  const first = await session.submit({ text: "Hello", operationId: "operation.1" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.value.messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(first.value.messages[1]?.text, "Echo: Hello");

  const second = await session.submit({ text: "Again", operationId: "operation.2" });
  assert.equal(second.ok, true);
  assert.equal(root.invocations.length, 2);
  assert.deepEqual(root.invocations[1]?.context.history, [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Echo: Hello" },
  ]);
  await session.close();

  const reopened = await root.controller.open(query);
  const recovered = await reopened.read();
  assert.equal(recovered.ok, true);
  if (recovered.ok) assert.equal(recovered.value.messages.length, 4);
  await reopened.close();
});

test("rejects malformed and stale submissions with sanitized failures", async () => {
  const root = fixture();
  const session = await root.controller.open(query);
  const malformed = await session.submit({ text: " ", operationId: "operation.invalid" });
  assert.deepEqual(malformed, {
    ok: false,
    error: { code: "invalid-request", message: "Enter between 1 and 16000 characters." },
  });
  root.deny();
  const stale = await session.submit({ text: "Hello", operationId: "operation.stale" });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, "runtime-conflict");
    assert.equal(JSON.stringify(stale).includes("model.chat.local"), false);
    assert.equal(JSON.stringify(stale).includes("sqlite"), false);
  }
  await session.close();
});

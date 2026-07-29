import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import {
  normalizeConversationMessageId,
  normalizeConversationSessionId,
  normalizeConversationTurnId,
} from "../../../../contracts/conversations";
import { normalizeExecutionApprovalId } from "../../../../contracts/execution-runs";
import { normalizeExecutionPlanId } from "../../../../contracts/execution-plans";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import {
  normalizeSystemDeploymentId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstance,
} from "../../../../contracts/system-deployment";
import type {
  SystemDataAuditEntry,
  SystemDataRecord,
} from "../../../../contracts/system-data";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createSystemRuntimeRepositorySessionFactory } from "../createSystemRuntimeRepositorySession";
import type { SystemRuntimeStructuredDataSessionProvider } from "../system-runtime-structured-data-session";

const now = "2026-07-29T15:30:00.000Z";
const organizationId = createOrganizationId("org-runtime");
const workspaceId = createWorkspaceId("workspace-runtime");
const releaseId = normalizeSystemReleaseId("release-runtime");

function runtime(id: string): SystemRuntimeInstance {
  const runtimeInstanceId = normalizeSystemRuntimeInstanceId(id);
  return {
    runtimeInstanceId,
    dataBindingId: normalizeSystemRuntimeDataBindingId(
      `sqlite:${runtimeInstanceId}`,
    ),
    databaseEngine: "sqlite",
    organizationId,
    workspaceId,
    deploymentId: normalizeSystemDeploymentId(`deployment-${id}`),
    releaseId,
    status: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test("runtime repository sessions isolate conversation and system data by physical instance", async () => {
  const stores = new Map<string, ReturnType<typeof createInMemoryStructuredDocumentStore>>();
  const provider: SystemRuntimeStructuredDataSessionProvider = {
    async acquire(instance) {
      let documents = stores.get(instance.runtimeInstanceId);
      if (!documents) {
        documents = createInMemoryStructuredDocumentStore(() => now);
        stores.set(instance.runtimeInstanceId, documents);
      }
      return {
        runtimeInstanceId: instance.runtimeInstanceId,
        documents,
        health: { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 },
      };
    },
    async release() {},
  };
  const factory = createSystemRuntimeRepositorySessionFactory(provider);
  const first = await factory.open(runtime("runtime-session-a"));
  const second = await factory.open(runtime("runtime-session-b"));
  const sessionId = normalizeConversationSessionId("session-shared");
  const turnId = normalizeConversationTurnId("turn-shared");
  const messageId = normalizeConversationMessageId("message-shared");
  await first.conversationMessageRepository.saveConversationMessage({
    id: messageId,
    workspaceId,
    conversationSessionId: sessionId,
    conversationTurnId: turnId,
    role: "user",
    contentKind: "plain-text",
    text: "first runtime",
    createdAt: now,
  });
  await second.conversationMessageRepository.saveConversationMessage({
    id: messageId,
    workspaceId,
    conversationSessionId: sessionId,
    conversationTurnId: turnId,
    role: "user",
    contentKind: "plain-text",
    text: "second runtime",
    createdAt: now,
  });
  assert.equal(
    (
      await first.conversationMessageRepository.getConversationMessageById(
        workspaceId,
        messageId,
      )
    )?.text,
    "first runtime",
  );
  assert.equal(
    (
      await second.conversationMessageRepository.getConversationMessageById(
        workspaceId,
        messageId,
      )
    )?.text,
    "second runtime",
  );

  const record: SystemDataRecord = {
    recordId: "record-shared",
    targetWorkspaceId: workspaceId,
    releaseId,
    entityType: "runtime-state",
    revision: 1,
    values: { owner: "first" },
    createdAt: now,
    createdBy: "person-test",
    updatedAt: now,
    updatedBy: "person-test",
  };
  const audit: SystemDataAuditEntry = {
    auditId: "audit-shared",
    targetWorkspaceId: workspaceId,
    releaseId,
    entityType: "runtime-state",
    action: "create",
    outcome: "allowed",
    actorId: "person-test",
    recordId: record.recordId,
    changedFields: ["owner"],
    occurredAt: now,
  };
  await first.systemDataRepository.createRecordWithAudit(record, audit);
  assert.equal(
    await second.systemDataRepository.readRecord(
      workspaceId,
      releaseId,
      "runtime-state",
      record.recordId,
    ),
    undefined,
  );

  const approvalId = normalizeExecutionApprovalId("approval-shared");
  await first.executionApprovalRepository.saveExecutionApproval({
    id: approvalId,
    workspaceId,
    sourceExecutionPlanId: normalizeExecutionPlanId("plan-shared"),
    approvalKind: "conversation-session-execution",
    approvalStatus: "granted",
    label: "First runtime approval",
    createdAt: now,
    updatedAt: now,
    grantedAt: now,
    provenance: [],
    blockers: [],
    diagnostics: [],
  });
  assert.equal(
    await second.executionApprovalRepository.getExecutionApprovalById(
      workspaceId,
      approvalId,
    ),
    undefined,
  );

  await first.close();
  const reopened = await factory.open(runtime("runtime-session-a"));
  assert.equal(
    (
      await reopened.conversationMessageRepository.getConversationMessageById(
        workspaceId,
        messageId,
      )
    )?.text,
    "first runtime",
  );
  assert.equal(
    (
      await reopened.executionApprovalRepository.getExecutionApprovalById(
        workspaceId,
        approvalId,
      )
    )?.label,
    "First runtime approval",
  );
});

test("runtime repository sessions reject terminal lifecycle states and identity substitution", async () => {
  const selected = runtime("runtime-session-denied");
  const provider: SystemRuntimeStructuredDataSessionProvider = {
    async acquire() {
      return {
        runtimeInstanceId: normalizeSystemRuntimeInstanceId("runtime-foreign"),
        documents: createInMemoryStructuredDocumentStore(() => now),
        health: { healthy: true, schemaVersion: 2, expectedSchemaVersion: 2 },
      };
    },
    async release() {},
  };
  const factory = createSystemRuntimeRepositorySessionFactory(provider);
  await assert.rejects(
    () => factory.open(selected),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-repositories.identity-mismatch",
  );
  await assert.rejects(
    () => factory.open({ ...selected, status: "deleted" }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "runtime-repositories.lifecycle-conflict",
  );
});

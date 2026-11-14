import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesktopPreloadApi } from "../../../../../apps/desktop/src/preload/exposedApi";
import { createLocalConversationRepositoryAdapters } from "../../../../adapters/persistence/conversations";
import { createLocalExecutionRunRepositoryAdapters } from "../../../../adapters/persistence/execution-runs";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { normalizeConversationMessageId, normalizeConversationSessionId, normalizeConversationTurnId } from "../../../../contracts/conversations";
import { normalizeExecutionRunId, type ExecutionRunRecord } from "../../../../contracts/execution-runs";
import {
  DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL, DESKTOP_HEADLESS_CHAT_TASK_LIMIT, readDesktopHeadlessChatTasks,
} from "../../../../contracts/headless/desktop-headless-chat-tasks";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { registerDesktopHeadlessTaskList } from "../registerDesktopHeadlessTaskList";

const workspaceId = createWorkspaceId("chat-task-fixture");
const other = createWorkspaceId("chat-task-foreign");
const organizationId = createOrganizationId("chat-task-fixture-org");
const otherOrganizationId = createOrganizationId("chat-task-foreign-org");
const sessionId = normalizeConversationSessionId("session-1");
const turnId = normalizeConversationTurnId("turn-1");
const runId = normalizeExecutionRunId("run-1");
const at = "2026-11-13T00:00:00.000Z";
const later = "2026-11-13T00:01:00.000Z";
const unavailable = { status: "unavailable" };
const lifecycle = { workspaceId, createdAt: at, updatedAt: at, blockers: [], diagnostics: [], provenance: [] };
const provenance: ExecutionRunRecord["provenance"] = [{ at, kind: "execution-run-delegated-conversation", actorId: "application" }];
const validRun: ExecutionRunRecord = { ...lifecycle, id: runId, sourceExecutionPlanId: "fixture-plan",
  sourceContextKind: "conversation-turn", sourceContextId: turnId, status: "running", attemptIds: [],
  eventIds: [], resultIds: [], provenance };

test("lists only recent saved delegated turns through the trusted workspace-bound desktop bridge", async () => {
  const platformDocuments = createInMemoryStructuredDocumentStore();
  const documents = platformDocuments.forOrganization(organizationId);
  const identity = { organizationId, principalId: "fixture-owner", principalDisplayName: "Fixture owner", createdAt: at, updatedAt: at };
  const { organizations, memberships } = createStructuredOrganizationRepositories(platformDocuments);
  await organizations.saveOrganization({ organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at });
  const membership = { organizationId, principalId: identity.principalId, role: "owner", status: "active", createdAt: at, updatedAt: at } as const;
  await memberships.saveMembership(membership);
  const options = { rootDir: ".", documents, now: () => at };
  const { executionRunRepository } = createLocalExecutionRunRepositoryAdapters(options);
  const { conversationTurnRepository, conversationSessionRepository } = createLocalConversationRepositoryAdapters(options);
  await executionRunRepository.saveExecutionRun(validRun);
  await executionRunRepository.saveExecutionRun({ ...validRun, id: normalizeExecutionRunId("wrong-run"), updatedAt: later });
  for (let index = 0; index < DESKTOP_HEADLESS_CHAT_TASK_LIMIT + 1; index++) {
    await executionRunRepository.saveExecutionRun({ ...validRun, id: normalizeExecutionRunId("ordinary-" + index),
      updatedAt: later, provenance: [] });
  }
  await conversationTurnRepository.saveConversationTurn({ ...lifecycle, id: turnId, conversationSessionId: sessionId,
    sourceExecutionPlanId: "fixture-plan", userMessageId: normalizeConversationMessageId("message-1"), executionRunId: runId,
    status: "generating", sequence: 1 });
  await conversationSessionRepository.saveConversationSession({ ...lifecycle, id: sessionId, sourceExecutionPlanId: "fixture-plan",
    status: "active", systemLabel: "Private fixture label", turnIds: [turnId] });

  const trustedFrame = {};
  let trusted = true;
  let losePolicyOnRead = false;
  let loseTrustOnRead = false;
  let runReads = 0;
  let calls = 0;
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined;
  registerDesktopHeadlessTaskList({
    ipcMain: { handle(channel, invoke) {
      assert.equal(channel, DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL);
      handler = (event, payload) => invoke(event, payload as never);
    } },
    senderTrust: { isTrustedSender: (event) => trusted && event === trustedFrame },
    workspaces: { async readWorkspace(id) {
      return { ...lifecycle, workspaceId: id, organizationId: id === other ? otherOrganizationId : organizationId,
        displayName: "Fixture", status: "active" };
    } },
    documents: platformDocuments, identity, isOpen: () => true,
    runs: { async listExecutionRuns(query) {
      runReads++;
      assert.deepEqual(query, { workspaceId, delegatedConversationOnly: true, limit: DESKTOP_HEADLESS_CHAT_TASK_LIMIT });
      if (losePolicyOnRead) await memberships.saveMembership({ ...membership, status: "suspended" });
      if (loseTrustOnRead) trusted = false;
      return executionRunRepository.listExecutionRuns(query);
    } },
    turns: conversationTurnRepository, sessions: conversationSessionRepository,
  });
  assert.ok(handler);
  assert.deepEqual(await handler({}, { workspaceId }), unavailable);
  assert.deepEqual(await handler(trustedFrame, { workspaceId, principalId: "fixture" }), unavailable);
  assert.deepEqual(await handler(trustedFrame, { workspaceId: other }), unavailable);
  assert.equal(runReads, 0);
  const bridge = createDesktopPreloadApi({ ipcRenderer: { async invoke(channel, payload) {
    calls++;
    assert.equal(channel, DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL);
    return handler!(trustedFrame, payload);
  } } });
  assert.deepEqual(await bridge.readRecentHeadlessChatTasks("../invalid"), unavailable);
  assert.equal(calls, 0);
  assert.deepEqual(await bridge.readRecentHeadlessChatTasks(workspaceId), {
    status: "ready", workspaceId, tasks: [{ sessionId, turnId, runId, status: "running" }],
  });
  await executionRunRepository.updateExecutionRun({ ...validRun, status: "succeeded" });
  const completed = await bridge.readRecentHeadlessChatTasks(workspaceId);
  assert.equal(completed.status, "ready");
  assert.equal(completed.tasks[0]?.status, "succeeded");
  assert.equal(JSON.stringify(completed).includes("Private"), false);
  losePolicyOnRead = true;
  assert.deepEqual(await bridge.readRecentHeadlessChatTasks(workspaceId), unavailable);
  await memberships.saveMembership(membership);
  losePolicyOnRead = false;
  loseTrustOnRead = true;
  assert.deepEqual(await bridge.readRecentHeadlessChatTasks(workspaceId), unavailable);
  assert.deepEqual(await bridge.readRecentHeadlessChatTasks(workspaceId), unavailable);
  assert.equal(runReads, 4);
});

test("the task-list result parser refuses foreign, oversized, duplicate or active fields", () => {
  const task = { sessionId, turnId, runId, status: "running" };
  const ready = { status: "ready", workspaceId, tasks: [task] };
  assert.deepEqual(readDesktopHeadlessChatTasks(ready, workspaceId), ready);
  assert.deepEqual(readDesktopHeadlessChatTasks(ready, other), unavailable);
  for (const tasks of [
    [task, task], Array.from({ length: DESKTOP_HEADLESS_CHAT_TASK_LIMIT + 1 }, () => task),
    [{ ...task, status: "Running" }], [{ ...task, transcript: "Synthetic private output" }],
    [{ ...task, runId: "hf_" + "a".repeat(20) }],
    [{ ...task, get runId(): string { throw new Error("Accessor must not run"); } }],
    new Array(1),
  ]) assert.deepEqual(readDesktopHeadlessChatTasks({ ...ready, tasks }, workspaceId), unavailable);
});

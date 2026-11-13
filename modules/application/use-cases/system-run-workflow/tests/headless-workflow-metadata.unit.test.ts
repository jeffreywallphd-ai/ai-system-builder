import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemRunWorkflowHandlerPort } from "../../../ports/system-run-workflow";
import { systemRunWorkflowFailure, systemRunWorkflowSuccess, type SystemRunWorkflowAction, type SystemRunWorkflowProfileSummary } from "../../../../contracts/system-run-workflow";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { HeadlessWorkflowMetadataUseCase } from "../headless-workflow-metadata.use-case";
import { createSystemRunWorkflowUseCases } from "../system-run-workflow-use-cases";

const workspaceId = createWorkspaceId("workflow-workspace");
const source = { kind: "approved-release", sourceId: "fixture.release", sourceDigest: "sha256:" + "a".repeat(64) } as const;
const profile = {
  schemaVersion: "1.0", profileId: "builtin.workflow.records.service-request@1.0.0",
  source: { ...source, label: "Private release label" }, title: "Private title", description: "Private description",
  category: "records", availability: "blocked",
  blockers: [{ code: "record-unavailable", message: "Private reason" }],
} as const satisfies SystemRunWorkflowProfileSummary;
const action = {
  actionId: "read-record", label: "Private label", description: "Private action note",
  intent: "read", emphasis: "normal", requiresConfirmation: false, enabled: true,
  fields: [{ fieldId: "recordId", label: "Record", kind: "text", required: true, maximumLength: 120, defaultValue: "Private default" }],
} as const satisfies SystemRunWorkflowAction;
const target = { profileId: profile.profileId, source };
const context = { actorId: "paired-actor", organizationId: "paired-org", authenticated: true, roles: [] };
const access = { context, canRead: async () => true };

function setup(options: { revokeOnPrepare?: boolean; sensitive?: boolean } = {}) {
  let prepared = 0;
  const handler: SystemRunWorkflowHandlerPort = {
    profileId: profile.profileId,
    async discover() { return systemRunWorkflowSuccess([profile]); },
    async prepare({ source: requested }) {
      prepared++;
      if (requested.sourceDigest !== source.sourceDigest) return systemRunWorkflowFailure("workflow.source-stale", "Private stale cause");
      return systemRunWorkflowSuccess({
        schemaVersion: "1.0", snapshotRevision: "fixture.snapshot:2", profile, refreshedAt: "2026-11-13T00:00:00Z",
        actions: [
          options.sensitive ? { ...action, fields: [{ ...action.fields[0], sensitive: true }] } : action,
          { ...action, actionId: "update-record", intent: "mutate", requiresConfirmation: true },
          { ...action, actionId: "publish" },
        ],
        blocks: [{ blockId: "private", kind: "transcript", title: "Private transcript", entries: [] }],
      });
    },
    async invoke() { assert.fail("Metadata cannot invoke a workflow"); },
  };
  const metadata = new HeadlessWorkflowMetadataUseCase(createSystemRunWorkflowUseCases({ handlers: [handler] }));
  return { metadata, count: () => prepared, auth: { ...access, canRead: async () => !options.revokeOnPrepare || prepared === 0 } };
}

test("reads exact release readiness and typed action shape without relaying private presentation", async () => {
  const { metadata } = setup();
  const expectedProfile = { ...target, title: "Service request records", availability: "blocked", blockers: [{ code: "record-unavailable" }] };
  assert.deepEqual(await metadata.list(workspaceId, "approved-release", access), { ok: true, value: [expectedProfile] });
  assert.deepEqual(await metadata.prepare(workspaceId, target, access), {
    ok: true, value: { profile: expectedProfile, snapshotRevision: "fixture.snapshot:2", actions: [
      { actionId: "read-record", intent: "read", enabled: true, requiresConfirmation: false,
        fields: [{ fieldId: "recordId", kind: "text", required: true, maximumLength: 120 }] },
    ] },
  });
});

test("omits secret-dependent actions and denies invalid, stale and no-longer-granted reads", async () => {
  const { metadata, count } = setup({ sensitive: true });
  const invalid = { ok: false, code: "headless.invalid-request" };
  assert.deepEqual(await metadata.prepare(workspaceId, { ...target, profileId: "builtin.workflow.deployment@1.0.0" }, access), invalid);
  assert.deepEqual(await metadata.prepare(workspaceId, { ...target, source: { ...source, label: "spoofed" } }, access), invalid);
  assert.equal(count(), 0);
  assert.deepEqual(await metadata.prepare(workspaceId, { ...target, source: { ...source, sourceDigest: "sha256:" + "b".repeat(64) } }, access),
    { ok: false, code: "headless.stale" });
  const limited = await metadata.prepare(workspaceId, target, access);
  assert.ok(limited.ok);
  assert.deepEqual(limited.value.actions, []);
  const revoked = setup({ revokeOnPrepare: true });
  assert.deepEqual(await revoked.metadata.prepare(workspaceId, target, revoked.auth), { ok: false, code: "headless.forbidden" });
});

test("prepares only approved session IDs for a current exact conversation grant", async () => {
  const conversationSource = { kind: "reviewed-execution-plan", sourceId: "fixture-plan", sourceRevision: "plan-r1" } as const;
  const conversation = { ...profile, profileId: "builtin.workflow.conversation@1.0.0",
    source: { ...conversationSource, label: "Private plan" }, category: "conversation" as const,
    availability: "available" as const, blockers: [] };
  const conversationTarget = { profileId: conversation.profileId, source: conversationSource };
  const row = (sessionId: string, status: string, approval: string, maySubmitMessage: boolean) =>
    ({ rowId: sessionId, values: { sessionId, status, approval, maySubmitMessage } });
  const rows = [
    row("session-active", "active", "approved", true), row("session-awaiting", "awaiting-approval", "approval-required", false),
    row("session-revoked", "active", "approval-invalidated", true), row("session-closed", "closed", "approved", true),
    row("session-busy", "active", "approved", false), row("session-runtime-unavailable", "approved", "approved", false),
    { rowId: "session-unknown", values: { sessionId: "session-unknown", status: "approved", approval: "approved" } },
  ];
  let duplicate = false;
  const handler: SystemRunWorkflowHandlerPort = {
    profileId: conversation.profileId,
    async discover() { return systemRunWorkflowSuccess([conversation]); },
    async prepare() {
      return systemRunWorkflowSuccess({ schemaVersion: "1.0", profile: conversation,
        snapshotRevision: "fixture-snapshot-r1", refreshedAt: "2026-11-13T00:00:00Z", actions: [],
        blocks: [{ blockId: "sessions", kind: "table", title: "Private session table",
          columns: [{ columnId: "sessionId", label: "Private label" }, { columnId: "status", label: "Status" },
            { columnId: "approval", label: "Approval" }],
          rows: duplicate ? [...rows, rows[0]!] : rows }],
      });
    },
    async invoke() { assert.fail("Metadata cannot invoke a workflow"); },
  };
  const metadata = new HeadlessWorkflowMetadataUseCase(createSystemRunWorkflowUseCases({ handlers: [handler] }));
  const ordinary = await metadata.prepare(workspaceId, conversationTarget, access);
  assert.ok(ordinary.ok);
  assert.equal("approvedSessionIds" in ordinary.value, false);
  const delegated = { ...access, canDiscoverApprovedTurns: async (targetWorkspace: typeof workspaceId) => targetWorkspace === workspaceId };
  const prepared = await metadata.prepare(workspaceId, conversationTarget, delegated);
  assert.ok(prepared.ok);
  assert.deepEqual(prepared.value.approvedSessionIds, ["session-active"]);
  assert.ok(!JSON.stringify(prepared).includes("maySubmitMessage"));
  assert.equal(prepared.value.snapshotRevision, "fixture-snapshot-r1");
  assert.ok(!JSON.stringify(prepared).includes("Private"));
  let checks = 0;
  assert.deepEqual(await metadata.prepare(workspaceId, conversationTarget, {
    ...access, canDiscoverApprovedTurns: async () => ++checks === 1,
  }), { ok: false, code: "headless.forbidden" });
  duplicate = true;
  assert.deepEqual(await metadata.prepare(workspaceId, conversationTarget, delegated), { ok: false, code: "headless.unavailable" });
});

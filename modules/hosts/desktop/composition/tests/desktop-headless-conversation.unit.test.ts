import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../../adapters/persistence/workspace";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { normalizeConversationSessionRecord } from "../../../../contracts/conversations";
import { HEADLESS_READ_OPERATIONS, isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeDesktopHeadlessConversation } from "../composeDesktopHeadlessConversation";
import { composeDesktopWorkspaceAuthorization } from "../composeDesktopWorkspaceAuthorization";

test("desktop binds saved handles to the current client and holds one existing runtime invocation per session", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const now = "2026-11-13T00:00:00.000Z";
  let id = 0;
  const identity = await initializeLocalIdentityProfile({
    documents, organizationDisplayName: "Synthetic org", principalDisplayName: "Synthetic operator",
    now: () => now, createId: () => `synthetic.${++id}`,
  });
  const workspaceId = createWorkspaceId("synthetic-workspace");
  const workspaces = createLocalWorkspaceRepository({ rootDirectory: ".", documents: documents.forOrganization(identity.organizationId) });
  await workspaces.saveWorkspace({ workspaceId, organizationId: identity.organizationId, status: "active",
    displayName: "Synthetic workspace", createdAt: now, updatedAt: now });
  const hostIncarnationId = "f06f4016-f0ee-43fa-808f-09f815df8d6b";
  assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const input = { workspaceId, planId: "fixture-plan", planRevision: "plan-r1", sessionId: "fixture-session",
    snapshotRevision: "snapshot-r1", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic input" };
  let open = true;
  let allowed = true;
  let calls = 0;
  let revision = input.snapshotRevision;
  let session = normalizeConversationSessionRecord({ id: input.sessionId, workspaceId, sourceExecutionPlanId: input.planId,
    executionApprovalId: "fixture-approval", runtimeReferenceId: "fixture-runtime", status: "approved", systemLabel: "Synthetic",
    turnIds: [], blockers: [], diagnostics: [], provenance: [], createdAt: now, updatedAt: now });
  let release!: () => void;
  const running = new Promise<void>(resolve => { release = resolve; });
  let resolveRuntime!: () => void;
  const started = new Promise<void>(resolve => { resolveRuntime = resolve; });
  const reference = { turnId: "fixture-turn", runId: "fixture-run" };
  const host = composeDesktopHeadlessConversation({
    hostIncarnationId, identity, platformDocuments: documents, rootDirectory: ".", workspaces,
    authorization: composeDesktopWorkspaceAuthorization({ documents, localIdentity: identity }),
    isOpen: () => open, readRole: async () => "owner",
    sessions: { async getConversationSessionById() { return session; } },
    workflows: { async prepare(workspace, target, access) {
      assert.equal(workspace, workspaceId);
      assert.deepEqual(target.source, { kind: "reviewed-execution-plan", sourceId: input.planId, sourceRevision: input.planRevision });
      if (!await access.canRead(workspace, "reviewed-execution-plan")) return { ok: false, code: "headless.forbidden" };
      return { ok: true, value: { profile: { ...target, title: "Controlled conversation", availability: "available", blockers: [] },
        snapshotRevision: revision, approvedSessionIds: [input.sessionId], actions: [] } };
    } },
    submit: { async execute(command, delegation) {
      calls++;
      assert.ok(delegation);
      assert.equal(command.conversationSessionId, input.sessionId);
      const prepared = { workspaceId, planId: input.planId, planRevision: input.planRevision,
        snapshotRevision: input.snapshotRevision, sessionId: input.sessionId, approvalId: "fixture-approval",
        runtimeReferenceId: "fixture-runtime" };
      assert.equal(await delegation.validate({ ...prepared, phase: "before-record" }), true);
      session = normalizeConversationSessionRecord({ ...session, status: "active", turnIds: [reference.turnId] });
      revision = "snapshot-after-admission";
      assert.equal(await delegation.onAdmitted?.(reference), true);
      assert.equal(await delegation.validate({ ...prepared, phase: "before-runtime", turnId: reference.turnId }), true);
      resolveRuntime();
      await running;
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId, status: "succeeded" } };
    } },
  });
  const grant = {
    organizationId: identity.organizationId, principalId: identity.principalId, registeredClientId: "06f56324-2051-462c-b45b-d9b49bf6dd4a",
    conversation: true as const, workspaceIds: [workspaceId], operations: HEADLESS_READ_OPERATIONS, isCurrent: () => allowed,
  };
  const authority = { grant, currentGrant: async () => allowed ? grant : undefined,
    fingerprint: (value: string) => createHmac("sha256", "fixture-key").update(value).digest("hex") };
  try {
    const forbidden = { ok: false, code: "headless.forbidden" };
    assert.deepEqual(await host.execute(input, { ...authority, grant: { ...grant, conversation: undefined } }), forbidden);
    assert.deepEqual(await host.execute({ ...input, workspaceId: createWorkspaceId("foreign-workspace") }, authority), forbidden);
    assert.deepEqual(await host.execute({ ...input, snapshotRevision: "stale" }, authority), forbidden);
    assert.equal(calls, 0);
    const expected = { ok: true, value: reference };
    assert.deepEqual(await host.execute(input, authority), expected);
    await started;
    assert.deepEqual(await host.execute(input, authority), expected);
    assert.deepEqual(await host.execute({ ...input, text: "Different synthetic input" }, authority),
      { ok: false, code: "headless.idempotency-conflict" });
    assert.equal(calls, 1);
    allowed = false;
    assert.deepEqual(await host.execute(input, authority), forbidden);
    open = false;
    host.stopAdmission();
    assert.deepEqual(await host.execute(input, authority), forbidden);
  } finally { release(); await host.drain(); }
});

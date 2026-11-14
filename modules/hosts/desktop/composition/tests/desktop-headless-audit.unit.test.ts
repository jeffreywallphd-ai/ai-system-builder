import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createUiControlAuthority } from "../../../../application/services/ui-control/ui-control-authority.service";
import { createUiControlDelivery } from "../../../../application/services/ui-control/ui-control-delivery.service";
import { isHeadlessHostIncarnationId, UI_CONTROL_VERSION } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import type { SecurityEvent } from "../../../../contracts/security";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createDesktopHeadlessAudit, createStoredDesktopHeadlessAudit } from "../desktopHeadlessAudit";

const workspaceId = createWorkspaceId("audit-fixture-workspace");
const organizationId = createOrganizationId("audit-fixture-org");
const at = "2026-11-13T00:00:00.000Z";
const identity = { organizationId, principalId: "local-fixture-principal", principalDisplayName: "Private fixture display",
  createdAt: at, updatedAt: at };
const hostIncarnationId = randomUUID();
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const window = { hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID() };

test("separates real authority, delivery and backend results, with no private values in audit", async () => {
  const rows: SecurityEvent[] = [];
  const audit = createDesktopHeadlessAudit({ async recordSecurityEvent(event) { rows.push(event); } }, identity);
  const current = { ...identity, isCurrent: () => true };
  const agent = { ...current, registeredClientId: randomUUID(), agentSessionId: randomUUID() };
  const authority = createUiControlAuthority({
    hostIncarnationId, issueId: randomUUID, now: () => 0, audit: audit.window, authorize: async () => true,
  });
  assert.equal(authority.registerWindow(window, current), true);
  const request = { version: UI_CONTROL_VERSION, target: window, taskId: randomUUID(), requestKey: randomUUID() };
  const issued = await authority.request(request, agent);
  assert.equal(issued.status, "ok");
  if (issued.status !== "ok") return;
  assert.equal((await authority.request(request, agent)).status, "ok");
  assert.equal((await authority.accept(issued.value.target, { ...current })).status, "denied");
  const accepted = await authority.accept(issued.value.target, current);
  assert.equal(accepted.status, "ok");
  if (accepted.status !== "ok") return;
  const { target } = accepted.value;
  assert.equal((await authority.ready({ ...target, generation: 99 }, current)).status, "denied");
  assert.equal((await authority.ready(target, current)).status, "ok");
  const delivery = createUiControlDelivery({ target, now: () => 0, isCurrent: () => !!authority.readAgentLease(target, agent),
    audit: (status, commandId, sequence) => audit.window(`command-${status}`, target, commandId, sequence),
  });
  const presentation = { target, commandId: randomUUID(),
    intent: { action: "open-system", systemId: "fixture-hidden-system", revisionId: "fixture-hidden-revision" } };
  assert.equal(delivery.submit(presentation).status, "accepted");
  assert.equal(delivery.next(target, 1).status, "delivered");
  assert.equal(delivery.next(target, 1).status, "delivered");
  assert.equal(delivery.acknowledge(target, 1, presentation.commandId, "applied")?.status, "applied");
  assert.equal(delivery.acknowledge(target, 1, presentation.commandId, "applied")?.status, "applied");
  assert.equal(delivery.submit({ ...presentation, intent: { ...presentation.intent, revisionId: "different-revision" } }).status, "conflict");
  assert.equal(authority.revoke(target, current).status, "ok");
  assert.equal(authority.revoke(target, current).status, "ok");
  audit.backend("system-authoring", workspaceId, "committed");
  audit.backend("approved-conversation", workspaceId, "handle-observed");
  audit.window("requested", { ...target, unexpectedText: "fixture-private-prompt" } as typeof target);
  await audit.close();

  assert.deepEqual(rows.map(row => row.operation), [
    "headless.window.requested", "headless.window.accepted", "headless.window.activated",
    "headless.window.command-delivered", "headless.window.command-applied", "headless.window.command-conflict",
    "headless.window.local-revoke-received", "headless.window.host-revoke-applied", "headless.system-authoring.committed",
    "headless.approved-conversation.handle-observed",
  ]);
  for (const row of rows.filter(row => row.kind === "headless.presentation")) {
    assert.equal(row.requestId, target.requestId);
    assert.equal(row.resource?.workspaceId, workspaceId);
  }
  const output = JSON.stringify(rows);
  for (const value of [identity.principalDisplayName, agent.registeredClientId, request.requestKey, request.taskId, target.leaseId,
    presentation.intent.systemId, presentation.intent.revisionId, "fixture-private-prompt"]) assert.ok(!output.includes(value));
});

test("bounds a held sink, records fixed failure counts, and admits no new audit on shutdown", async () => {
  let resume!: () => void;
  const held = new Promise<void>(resolve => { resume = resolve; });
  let attempts = 0;
  const audit = createDesktopHeadlessAudit({ async recordSecurityEvent() {
    if (++attempts === 1) { await held; throw new Error("fixture-private-exception"); }
  } }, identity);
  audit.backend("approved-conversation", workspaceId, "unconfirmed");
  await Promise.resolve();
  for (let index = 0; index < 140; index++) audit.backend("system-authoring", workspaceId, "committed");
  assert.deepEqual(audit.counts(), { pending: 128, dropped: 12, failed: 0 });
  resume();
  await audit.close();
  audit.backend("system-authoring", workspaceId, "committed");
  assert.equal(attempts, 129);
  assert.deepEqual(audit.counts(), { pending: 0, dropped: 12, failed: 1 });
});

test("the scoped persisted cap survives a fresh writer and preserves earlier records", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const owned = documents.forOrganization(organizationId);
  const other = documents.forOrganization(createOrganizationId("outside-audit-fixture"));
  assert.throws(() => createStoredDesktopHeadlessAudit(documents, identity));
  assert.throws(() => createStoredDesktopHeadlessAudit(other, identity));
  const first = createStoredDesktopHeadlessAudit(owned, identity, 2);
  first.backend("system-authoring", workspaceId, "committed");
  await first.close();
  const later = createStoredDesktopHeadlessAudit(owned, identity, 2);
  later.backend("system-authoring", workspaceId, "replayed");
  later.backend("approved-conversation", workspaceId, "unconfirmed");
  await later.close();
  assert.deepEqual(later.counts(), { pending: 0, dropped: 0, failed: 1 });
  const namespace = "headless-security-audit";
  const rows = await owned.listDocuments<SecurityEvent>(namespace);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter(row => row.key.startsWith("event-")).map(row => row.value.operation).sort(),
    ["headless.system-authoring.committed", "headless.system-authoring.replayed"]);
  assert.equal(await other.readDocument(namespace, "count"), undefined);
});

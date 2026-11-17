import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { DESKTOP_SYSTEM_CHANGE_POLL_CHANNEL } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { registerDesktopSystemChangePoll } from "../registerDesktopSystemChangePoll";

test("reports only the exact current workspace watermark to a trusted main frame", async () => {
  const organizationId = createOrganizationId("fixture-org");
  const workspaceId = createWorkspaceId("fixture-workspace");
  const other = createWorkspaceId("fixture-other-workspace");
  const trustedFrame = {};
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined;
  let allowed = true;
  let policyReads = 0;
  let open = true;
  const at = "2026-11-13T12:00:00.000Z";
  registerDesktopSystemChangePoll({
    ipcMain: { handle(channel, invoke) {
      assert.equal(channel, DESKTOP_SYSTEM_CHANGE_POLL_CHANNEL);
      handler = async (event, payload) => invoke(event, payload as never);
    } },
    senderTrust: { isTrustedSender: (event) => event === trustedFrame },
    workspaces: { async readWorkspace(id) {
      return id === workspaceId ? { workspaceId, organizationId, displayName: "Fixture", status: "active", createdAt: at, updatedAt: at } : undefined;
    } },
    authorization: { async authorizeWorkspaceOperation() { policyReads++; if (!allowed) throw new Error("Fixture denied."); } },
    documents, organizationId, isOpen: () => open,
  });
  assert.ok(handler);
  assert.deepEqual(await handler({}, { workspaceId }), { status: "unavailable" });
  assert.deepEqual(await handler(trustedFrame, { workspaceId, principalId: "ignored" }), { status: "unavailable" });
  assert.deepEqual(await handler(trustedFrame, { workspaceId: other }), { status: "unavailable" });
  assert.equal(policyReads, 0);
  assert.deepEqual(await handler(trustedFrame, { workspaceId }), { status: "ready", sequence: 0 });
  assert.equal(policyReads, 2);
  await documents.writeDocument("headless/system-builder/changes", workspaceId, {
    watermark: 1, events: [{ sequence: 1, systemId: "fixture-system", recordRevision: 1, revisionId: "fixture-system.r1" }],
  });
  assert.deepEqual(await handler(trustedFrame, { workspaceId }), { status: "ready", sequence: 1 });
  allowed = false;
  assert.deepEqual(await handler(trustedFrame, { workspaceId }), { status: "unavailable" });
  open = false;
  assert.deepEqual(await handler(trustedFrame, { workspaceId }), { status: "unavailable" });
});
